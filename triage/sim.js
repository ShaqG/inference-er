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
      moving: false, rebalances: 0, movedMs: 0,
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

  // Copies per expert: the spare slots go to the hottest expert, by per-copy load, split over
  // the hottest two, or one each to the hottest four. Keep the policy that packs best.
  function replication(load, redundant, work) {
    const copies = new Array(work.experts).fill(1);
    if (!redundant) return copies;
    const order = load.map((n, e) => [n, e]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, e]) => e);
    const policies = [];
    for (const spread of [1, 2, 4]) {
      const policy = new Array(work.experts).fill(1);
      for (let i = 0; i < work.ranks; i++) policy[order[i % spread]]++;
      policies.push(policy);
    }
    const greedy = new Array(work.experts).fill(1);
    for (let i = 0; i < work.ranks; i++) {
      const hot = order.reduce((a, b) => load[a] / greedy[a] > load[b] / greedy[b] ? a : b);
      greedy[hot]++;
    }
    policies.push(greedy);
    const slots = work.experts / work.ranks + 1;
    return policies.reduce((best, policy) =>
      packed(policy, load, slots, work.ranks) < packed(best, load, slots, work.ranks) ? policy : best);
  }

  // Re-place experts from observed loads. Every new copy and every swapped pair costs weight moves.
  function plan(placement, load, redundant, work) {
    const copies = replication(load, redundant, work);
    const out = placement.map(rank => rank.slice());
    const slots = work.experts / work.ranks + (redundant ? 1 : 0);
    const count = e => out.reduce((n, rank) => n + rank.filter(x => x === e).length, 0);
    let moves = 0;
    for (let e = 0; e < work.experts; e++) {
      while (count(e) > copies[e]) {
        const loads = rankLoads(out, load, copies);
        let host = 0;
        for (let r = 1; r < work.ranks; r++) {
          if (out[r].includes(e) && (!out[host].includes(e) || loads[r] > loads[host])) host = r;
        }
        out[host].splice(out[host].indexOf(e), 1);
      }
    }
    // Keep the slot counts even: an overcrowded rank hands its lightest expert to an emptier rank.
    const widest = () => out.reduce((a, rank, r) => rank.length > out[a].length ? r : a, 0);
    const narrowest = () => out.reduce((a, rank, r) => rank.length < out[a].length ? r : a, 0);
    while (out[widest()].length > out[narrowest()].length + 1) {
      const from = widest();
      const to = narrowest();
      const lightest = out[from].reduce((a, e, i) => load[e] / copies[e] < load[out[from][a]] / copies[out[from][a]] ? i : a, 0);
      out[to].push(out[from].splice(lightest, 1)[0]);
      moves++;
    }
    for (let e = 0; e < work.experts; e++) {
      while (count(e) < copies[e]) {
        const loads = rankLoads(out, load, copies);
        let best = -1;
        for (let r = 0; r < work.ranks; r++) {
          if (out[r].length >= slots) continue;
          const here = out[r].includes(e);
          if (best < 0 || here < out[best].includes(e) || here === out[best].includes(e) && loads[r] < loads[best]) best = r;
        }
        out[best].push(e);
        moves++;
      }
    }
    for (let round = 0; round < 64; round++) {
      const loads = rankLoads(out, load, copies);
      const peak = Math.max(...loads);
      const high = loads.indexOf(peak);
      const low = loads.indexOf(Math.min(...loads));
      const rest = Math.max(...loads.filter((_, r) => r !== high && r !== low));
      let best = null;
      out[high].forEach((a, ai) => out[low].forEach((b, bi) => {
        if (a === b) return;
        const after = Math.max(rest, peak - load[a] / copies[a] + load[b] / copies[b],
          loads[low] - load[b] / copies[b] + load[a] / copies[a]);
        if (after < peak * (1 - gain) && (!best || after < best.after)) best = { ai, bi, after };
      }));
      if (!best) break;
      [out[high][best.ai], out[low][best.bi]] = [out[low][best.bi], out[high][best.ai]];
      moves += 2;
    }
    return { placement: out, copies, moves };
  }

  function step(run, settings, work = case02) {
    if (run.second >= duration) return;
    const now = ++run.second;
    const current = work.steps[now - 1];
    let moves = 0;
    if (run.moving) {
      const result = plan(run.placement, run.recent, settings.redundant, work);
      moves = result.moves;
      run.placement = result.placement;
      run.moving = false;
      run.rebalances++;
      run.movedMs += moves * cost.move;
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
