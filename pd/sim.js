(function (root) {
  const { duration, case04 } = typeof module === 'object' ? require('./case.js') : root.ERCases;
  // prefill: GPUs that only prefill. 0 keeps every GPU doing both, the default.
  const defaults = { prefill: 0 };
  const splits = [0, 1, 2, 3, 4, 5, 6, 7];
  // Sized from a reference deployment, not measured: a 32B dense model with FP8 weights (about
  // 33 GB) and a BF16 KV cache of 256 KiB per token, one copy per H100 80GB, on 8 GPUs.
  // prefill: ms of one GPU per prompt token, about 12,500 tokens/s.
  // decode: ms to read the weights once per decode step. token: ms of compute per request in the step.
  // kv: KV tokens one GPU can hold for decoding.
  const cost = { prefill: 0.08, decode: 14, token: 0.16, kv: 150000 };
  // A request is on time when its first token arrives within ttft ms and its output tokens
  // are at most tpot ms apart.
  const slo = { ttft: 1000, tpot: 20 };
  const tick = 1000;

  function newRun() {
    return { second: 0, requests: [], queue: [], ready: [], active: [], history: [] };
  }

  // One second. Prompts are processed in arrival order, then decode steps run back to back for
  // the time left in the second.
  function step(run, settings) {
    if (run.second >= duration) return;
    const now = ++run.second;
    const start = (now - 1) * tick;
    const end = start + tick;
    const current = case04.steps[now - 1];
    for (const { l, o } of current.arrivals) {
      const request = { at: start, l, o, prefill: 0, tokens: 0, first: null, last: null, time: 0, ready: null, end: null };
      run.requests.push(request);
      run.queue.push(request);
    }
    const mixed = settings.prefill === 0;
    const workers = mixed ? case04.gpus : settings.prefill;
    const decoders = mixed ? case04.gpus : case04.gpus - settings.prefill;

    // Prefill workers take queued prompts in order, each until its second is used up.
    const free = new Array(workers).fill(start);
    let prefillMs = 0;
    while (run.queue.length) {
      let w = 0;
      for (let i = 1; i < workers; i++) if (free[i] < free[w]) w = i;
      const room = end - free[w];
      if (room < cost.prefill) break;
      const request = run.queue[0];
      const tokens = Math.min(request.l - request.prefill, Math.floor(room / cost.prefill));
      request.prefill += tokens;
      free[w] += tokens * cost.prefill;
      prefillMs += tokens * cost.prefill;
      if (request.prefill === request.l) {
        run.queue.shift();
        request.ready = free[w];
        run.ready.push(request);
      }
    }

    // Decoding requests reserve KV for their whole context. A smaller decode pool pauses the
    // requests admitted last until room frees up.
    const capacity = decoders * cost.kv;
    let used = run.active.reduce((sum, r) => sum + r.l + r.o, 0);
    while (used > capacity && run.active.length) {
      const request = run.active.pop();
      used -= request.l + request.o;
      run.ready.unshift(request);
    }
    // Requests join decoding in the order their prompts were processed, paused ones first.
    run.ready.sort((a, b) => a.ready - b.ready);

    // Decode steps for the rest of the second. On mixed GPUs the prefill work comes first.
    let clock = start + (mixed ? prefillMs / case04.gpus : 0);
    let steps = 0;
    let stepMs = 0;
    let load = 0;
    let produced = 0;
    let spent = 0;
    let served = 0;
    let waits = 0;
    while (true) {
      while (run.ready.length && run.ready[0].ready <= clock && used + run.ready[0].l + run.ready[0].o <= capacity) {
        const request = run.ready.shift();
        run.active.push(request);
        used += request.l + request.o;
      }
      if (!run.active.length) {
        // Nothing is decoding. Wait for the next prompt only if its KV fits.
        if (!run.ready.length || used + run.ready[0].l + run.ready[0].o > capacity) break;
        clock = run.ready[0].ready;
        continue;
      }
      const ms = Math.hypot(cost.decode, cost.token * run.active.length / decoders);
      if (clock + ms > end) break;
      clock += ms;
      steps++;
      stepMs += ms;
      load += run.active.length;
      const decoding = run.active;
      run.active = [];
      for (const request of decoding) {
        // Time since the previous token, or one step for the first token.
        const gap = request.last === null ? ms : clock - request.last;
        request.last = clock;
        request.tokens++;
        request.time += gap;
        produced++;
        spent += gap;
        if (request.first === null) {
          request.first = clock;
          served++;
          waits += clock - request.at;
        }
        if (request.tokens >= request.o) {
          request.end = clock;
          used -= request.l + request.o;
        } else {
          run.active.push(request);
        }
      }
    }
    run.history.push({
      phase: current.phase, split: settings.prefill, prefill: workers, decoders, prefillMs,
      queued: run.queue.length, ready: run.ready.length, active: run.active.length,
      batch: steps ? load / steps / decoders : 0, stepMs: steps ? stepMs / steps : null, steps,
      kv: used / capacity, tokens: produced, ttft: served ? waits / served : null,
      tpot: produced ? spent / produced : null,
    });
  }

  // A request is scored on what is known: one still waiting for its first token counts as late.
  function score(requests) {
    const served = requests.filter(r => r.first !== null);
    const waits = served.map(r => r.first - r.at).sort((a, b) => a - b);
    const tokens = requests.reduce((sum, r) => sum + r.tokens, 0);
    return {
      total: requests.length,
      good: served.filter(r => r.first - r.at <= slo.ttft && r.time / r.tokens <= slo.tpot).length,
      ttft95: waits.length ? waits[Math.ceil(waits.length * .95) - 1] : null,
      tpot: tokens ? requests.reduce((sum, r) => sum + r.time, 0) / tokens : null,
      done: requests.reduce((n, r) => n + (r.end !== null), 0),
      pending: requests.reduce((n, r) => n + (r.end === null), 0),
    };
  }

  function stats(run) {
    return score(run.requests);
  }

  // Per phase, scored on the requests that arrived in it. split is the one used in most of its seconds.
  function phases(run) {
    return case04.phases.map((_, index) => {
      const seconds = run.history.filter(h => h.phase === index);
      const counts = new Map();
      let split = seconds.length ? seconds[0].split : 0;
      for (const h of seconds) {
        counts.set(h.split, (counts.get(h.split) || 0) + 1);
        if (counts.get(h.split) > counts.get(split)) split = h.split;
      }
      return { index, split, ...score(run.requests.filter(r => case04.steps[Math.floor(r.at / tick)].phase === index)) };
    });
  }

  function baseline() {
    const run = newRun();
    for (let second = 0; second < duration; second++) step(run, defaults);
    return stats(run);
  }

  const api = { duration, defaults, splits, cost, slo, tick, newRun, step, stats, phases, baseline };
  if (typeof module === 'object') module.exports = api;
  else root.ER = api;
})(globalThis);
