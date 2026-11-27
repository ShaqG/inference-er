(function (root) {
  const { duration, case03 } = typeof module === 'object' ? require('./case.js') : root.ERCases;
  const defaults = { draft: 0 };
  // Milliseconds per step, sized from a reference deployment: a 70B dense target and a 1B draft,
  // both in BF16, on 8 A100 80GB with tensor parallel 8. Reading the target's weights (about
  // 140 GB) takes about 20 ms per step and each verified token adds about 0.15 ms of compute.
  // A draft step is a fixed 1 ms of launch and sync overhead plus 0.01 ms per drafted token.
  const cost = { target: 20, token: 0.15, draft: 1, draftToken: 0.01 };
  const lengths = [0, 2, 4, 8];

  function newRun() {
    return { second: 0, history: [] };
  }

  // The draft runs one step per drafted token, for the whole batch.
  function draftMs(k, batch) {
    return k * (cost.draft + cost.draftToken * batch);
  }

  // The target checks k+1 tokens per request: the drafts plus one of its own.
  function verifyMs(tokens) {
    return cost.target + cost.token * tokens;
  }

  // A request keeps drafted tokens up to the first mismatch.
  function accepted(accept, request, k) {
    let n = 0;
    while (n < k && accept[request * case03.slots + n]) n++;
    return n;
  }

  function step(run, settings) {
    if (run.second >= duration) return;
    const current = case03.steps[run.second];
    ++run.second;
    const k = settings.draft;
    const batch = current.batch;
    const plain = verifyMs(batch);
    let kept = 0;
    for (let r = 0; r < batch; r++) kept += accepted(current.accept, r, k);
    const drafting = draftMs(k, batch);
    const verifying = verifyMs(batch * (k + 1));
    const emitted = kept + batch;
    run.history.push({
      k, batch, phase: current.phase, ms: drafting + verifying, drafting, verifying, plain,
      kept, emitted, speedup: emitted * plain / (batch * (drafting + verifying)),
    });
  }

  // ms, length, waste and speedup describe the latest step; the other fields describe the run.
  function stats(run) {
    const h = run.history;
    const last = h[h.length - 1];
    const mean = key => h.length ? h.reduce((a, s) => a + s[key], 0) / h.length : null;
    const drafted = h.reduce((a, s) => a + s.k * s.batch, 0);
    return {
      ms: last ? last.ms : null,
      length: last ? last.emitted / last.batch : null,
      waste: last && last.k ? 1 - last.kept / (last.k * last.batch) : null,
      speedup: last ? last.speedup : null,
      meanMs: mean('ms'),
      meanLength: h.length ? h.reduce((a, s) => a + s.emitted / s.batch, 0) / h.length : null,
      meanSpeedup: mean('speedup'),
      wasteAll: drafted ? 1 - h.reduce((a, s) => a + s.kept, 0) / drafted : null,
    };
  }

  // Steps from `from` to `to` with one draft length, used to score a policy on part of the case.
  function play(k, from, to) {
    const run = newRun();
    for (run.second = from; run.second < to;) step(run, { draft: k });
    return stats(run);
  }

  function baseline() {
    return play(defaults.draft, 0, duration);
  }

  const api = { duration, defaults, cost, lengths, newRun, step, stats, play, baseline };
  if (typeof module === 'object') module.exports = api;
  else root.ER = api;
})(globalThis);
