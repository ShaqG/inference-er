(function (root) {
  const { duration, case02 } = typeof module === 'object' ? require('./case.js') : root.ERCases;
  const defaults = { redundant: false };
  // Milliseconds for the whole model, sized from a reference deployment: 58 MoE layers, experts
  // with hidden size 7168 and intermediate size 2048 in BF16, about 150 TFLOPS of effective
  // compute and a 150 GB/s link between ranks. A step waits for its slowest rank.
  const cost = { fixed: 1.2, row: 0.034, move: 34 };
  const window = 4;
  // A swap must cut the slowest rank's load by this share to be worth moving weights.
  const gain = 0.05;

  function newRun(work = case02) {
    return {
      second: 0, history: [], seen: [],
      recent: new Array(work.experts).fill(0),
      placement: work.placement.map(rank => rank.slice()),
      moving: false, rebalances: 0, movedMs: 0, lastMove: null,
    };
  }

  function copyCounts(placement, work) {
    const copies = new Array(work.experts).fill(0);
    for (const rank of placement) for (const e of rank) copies[e]++;
    return copies;
  }

  // Rows each rank receives in a step. An expert's load is split evenly across its copies.
  function arriving(placement, counts, work) {
    const copies = copyCounts(placement, work);
    return placement.map(rank => rank.reduce((rows, e) => rows + counts[e] / copies[e], 0));
  }

  function rankLoads(placement, load, copies) {
    return placement.map(rank => rank.reduce((sum, e) => sum + load[e] / copies[e], 0));
  }

  // Heaviest copy first into the emptiest rank. Used only to score replication policies.
  function packed(copies, load, slots, ranks) {
    const items = [];
    copies.forEach((n, e) => { for (let i = 0; i < n; i++) items.push(load[e] / n); });
    items.sort((a, b) => b - a);
    const sums = new Array(ranks).fill(0);
    const used = new Array(ranks).fill(0);
    for (const weight of items) {
      let best = 0;
      for (let r = 1; r < ranks; r++) {
        if (used[r] < slots && (used[best] >= slots || sums[r] < sums[best])) best = r;
      }
      sums[best] += weight;
      used[best]++;
    }
    return Math.max(...sums);
  }

  // Copies per expert: the spare slots go to the hottest experts by per-copy load, to the hottest
  // two, or one each to the hottest four. An expert never gets more than one copy per rank.
  // Keep the policy that packs best.
  function replication(load, redundant, work) {
    const copies = new Array(work.experts).fill(1);
    if (!redundant) return copies;
    const order = load.map((n, e) => [n, e]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, e]) => e);
    const policies = [];
    for (const spread of [2, 4]) {
      const policy = new Array(work.experts).fill(1);
      for (let i = 0; i < work.ranks; i++) policy[order[i % spread]]++;
      policies.push(policy);
    }
    const hottest = new Array(work.experts).fill(1);
    for (let i = 0; i < work.ranks; i++) {
      const open = order.filter(e => hottest[e] < work.ranks);
      hottest[open.reduce((a, b) => load[a] / hottest[a] > load[b] / hottest[b] ? a : b)]++;
    }
    policies.push(hottest);
    const slots = work.experts / work.ranks + 1;
    return policies.reduce((best, policy) =>
      packed(policy, load, slots, work.ranks) < packed(best, load, slots, work.ranks) ? policy : best);
  }

  // A rank for every new copy, or -1 for a copy that no rank can take. A copy only lands on a
  // rank without the expert and with a free slot. The assignments are searched together: the
  // most copies placed win, then the lightest peak, then the most even ranks.
  function place(placement, pending, load, slots) {
    const free = placement.map(rank => slots - rank.length);
    const taken = placement.map(() => []);
    const hosts = e => placement.filter(rank => rank.includes(e)).length + taken.filter(rank => rank.includes(e)).length;
    const choice = [];
    let best = null;
    const walk = index => {
      if (index === pending.length) {
        const loads = placement.map((rank, r) => rank.concat(taken[r]).reduce((sum, e) => sum + load[e] / hosts(e), 0));
        const peak = Math.max(...loads);
        const spread = loads.reduce((a, b) => a + b * b, 0);
        const placed = choice.filter(r => r >= 0).length;
        if (!best || placed > best.placed || placed === best.placed && (peak < best.peak || peak === best.peak && spread < best.spread)) {
          best = { placed, peak, spread, choice: choice.slice() };
        }
        return;
      }
      const e = pending[index];
      for (let r = 0; r <= placement.length; r++) {
        const fits = r < placement.length && taken[r].length < free[r] && !placement[r].includes(e) && !taken[r].includes(e);
        if (r < placement.length && !fits) continue;
        if (fits) taken[r].push(e);
        choice.push(fits ? r : -1);
        walk(index + 1);
        if (fits) taken[r].pop();
        choice.pop();
      }
    };
    walk(0);
    return best.choice;
  }

  // Drop the copies beyond the plan. Every choice is searched: the fewest ranks over their slots
  // win, then the most even ranks, then the lightest peak. Dropping a copy moves no weights.
  function drop(out, extra, load, slots, work) {
    const choice = [];
    let best = null;
    const walk = index => {
      if (index === extra.length) {
        const sizes = out.map(rank => rank.length);
        const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
        const score = [
          sizes.reduce((n, size) => n + Math.max(0, size - slots), 0),
          sizes.reduce((n, size) => n + (size - mean) ** 2, 0),
          Math.max(...rankLoads(out, load, copyCounts(out, work))),
        ];
        if (!best) {
          best = { score, choice: choice.slice() };
        } else {
          const first = score.findIndex((v, i) => v !== best.score[i]);
          if (first >= 0 && score[first] < best.score[first]) best = { score, choice: choice.slice() };
        }
        return;
      }
      const e = extra[index];
      for (let r = 0; r < out.length; r++) {
        const at = out[r].indexOf(e);
        if (at < 0) continue;
        out[r].splice(at, 1);
        choice.push(r);
        walk(index + 1);
        out[r].splice(at, 0, e);
        choice.pop();
      }
    };
    walk(0);
    best.choice.forEach((r, i) => out[r].splice(out[r].indexOf(extra[i]), 1));
  }

  // Re-place experts from observed loads. Every new copy and every swapped pair costs weight moves.
  function plan(placement, load, redundant, work) {
    let copies = replication(load, redundant, work);
    const out = placement.map(rank => rank.slice());
    const slots = work.experts / work.ranks + (redundant ? 1 : 0);
    const count = e => out.reduce((n, rank) => n + rank.filter(x => x === e).length, 0);
    let moves = 0;
    const extra = [];
    for (let e = 0; e < work.experts; e++) for (let n = copies[e]; n < count(e); n++) extra.push(e);
    drop(out, extra, load, slots, work);
    // Keep the slot counts even: an overcrowded rank hands its lightest expert to an emptier
    // rank that does not have it yet.
    const widest = () => out.reduce((a, rank, r) => rank.length > out[a].length ? r : a, 0);
    const narrowest = () => out.reduce((a, rank, r) => rank.length < out[a].length ? r : a, 0);
    while (out[widest()].length > out[narrowest()].length + 1) {
      const from = widest();
      const to = narrowest();
      const movable = out[from].map((e, i) => i).filter(i => !out[to].includes(out[from][i]));
      if (!movable.length) break;
      const lightest = movable.reduce((a, i) => load[out[from][i]] / copies[out[from][i]] < load[out[from][a]] / copies[out[from][a]] ? i : a);
      out[to].push(out[from].splice(lightest, 1)[0]);
      moves++;
    }
    // Add the missing copies. A copy on a rank that already has the expert would share that
    // rank's compute, so it is left out when no other rank has room.
    const pending = [];
    for (let e = 0; e < work.experts; e++) for (let n = count(e); n < copies[e]; n++) pending.push(e);
    place(out, pending, load, slots).forEach((r, i) => {
      if (r < 0) return;
      out[r].push(pending[i]);
      moves++;
    });
    copies = copyCounts(out, work);
    for (let round = 0; round < 64; round++) {
      const loads = rankLoads(out, load, copies);
      const peak = Math.max(...loads);
      const high = loads.indexOf(peak);
      const low = loads.indexOf(Math.min(...loads));
      const rest = Math.max(...loads.filter((_, r) => r !== high && r !== low));
      let best = null;
      // A swap must not put a second copy of an expert on either rank.
      out[high].forEach((a, ai) => out[low].forEach((b, bi) => {
        if (a === b || out[high].includes(b) || out[low].includes(a)) return;
        const after = Math.max(rest, peak - load[a] / copies[a] + load[b] / copies[b],
          loads[low] - load[b] / copies[b] + load[a] / copies[a]);
        if (after < peak * (1 - gain) && (!best || after < best.after)) best = { ai, bi, after };
      }));
      if (!best) break;
      [out[high][best.ai], out[low][best.bi]] = [out[low][best.bi], out[high][best.ai]];
      moves += 2;
    }
    // Keep the current layout unless the new one is clearly better. Turning redundancy off always applies.
    const cleanup = !redundant && placement.flat().length > work.experts;
    const before = Math.max(...rankLoads(placement, load, copyCounts(placement, work)));
    if (!cleanup && Math.max(...rankLoads(out, load, copies)) > before * (1 - gain)) {
      return { placement, copies: copyCounts(placement, work), moves: 0 };
    }
    return { placement: out, copies, moves };
  }

  function step(run, settings, work = case02) {
    if (run.second >= duration) return;
    const now = ++run.second;
    const current = work.steps[now - 1];
    let moves = 0;
    // A scheduled rebalance, or redundancy switched off while copies exist: dropping copies is free.
    if (run.moving || !settings.redundant && run.placement.flat().length > work.experts) {
      const result = plan(run.placement, run.recent, settings.redundant, work);
      moves = result.moves;
      run.placement = result.placement;
      run.moving = false;
      run.rebalances++;
      run.movedMs += moves * cost.move;
      if (moves) run.lastMove = { second: now, moves };
    }
    const rows = arriving(run.placement, current.counts, work);
    const slowest = Math.max(...rows);
    const total = rows.reduce((a, b) => a + b, 0);
    run.history.push({
      ms: cost.fixed + cost.row * slowest + moves * cost.move,
      rows, slowest, total, ratio: slowest * work.ranks / total, moves,
      phase: current.phase, counts: current.counts,
    });
    for (let e = 0; e < work.experts; e++) run.recent[e] += current.counts[e];
    run.seen.push(current.counts);
    if (run.seen.length > window) {
      const oldest = run.seen.shift();
      for (let e = 0; e < work.experts; e++) run.recent[e] -= oldest[e];
    }
  }

  // Schedule a rebalance for the next step. It needs at least one observed step.
  function rebalance(run) {
    if (!run.second || run.second >= duration) return false;
    run.moving = true;
    return true;
  }

  // ms, ratio and idle describe the latest step; the other fields describe the whole run so far.
  function stats(run, work = case02) {
    const h = run.history;
    const last = h[h.length - 1];
    const sum = key => h.reduce((a, s) => a + s[key], 0);
    return {
      ms: last ? last.ms : null,
      ratio: last ? last.ratio : null,
      idle: last ? 1 - last.total / (last.slowest * work.ranks) : null,
      meanMs: h.length ? sum('ms') / h.length : null,
      ratioAll: h.length ? sum('ratio') / h.length : null,
      idleAll: h.length ? 1 - sum('total') / (sum('slowest') * work.ranks) : null,
      movedMs: run.movedMs,
      replicas: run.placement.flat().length - work.experts,
    };
  }

  function baseline(work = case02) {
    const run = newRun(work);
    for (let second = 0; second < duration; second++) step(run, defaults, work);
    return stats(run, work);
  }

  const api = { duration, defaults, cost, window, gain, newRun, step, rebalance, stats, baseline, plan, arriving };
  if (typeof module === 'object') module.exports = api;
  else root.ER = api;
})(globalThis);
