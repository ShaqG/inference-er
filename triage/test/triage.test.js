'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const simulation = require('../sim.js');
const { case02 } = require('../case.js');

function runCase(policy = () => simulation.defaults, rebalanceAt = []) {
  const run = simulation.newRun();
  while (run.second < simulation.duration) {
    if (rebalanceAt.includes(run.second + 1)) simulation.rebalance(run);
    simulation.step(run, policy(run.second + 1));
  }
  return run;
}

const mean = (run, from, to, key) => {
  const steps = run.history.slice(from - 1, to);
  return steps.reduce((a, s) => a + s[key], 0) / steps.length;
};
const hosts = (run, expert) => run.placement.filter(rank => rank.includes(expert)).length;

test('every token reaches two experts, nothing is dropped, and the default policy keeps its results', () => {
  assert.equal(case02.steps.length, simulation.duration);
  runCase().history.forEach((step, index) => {
    assert.equal(case02.steps[index].counts.reduce((a, b) => a + b, 0), case02.steps[index].tokens * case02.topK);
    assert.ok(Math.abs(step.total - case02.steps[index].tokens * case02.topK) < 1e-6);
  });
  const baseline = simulation.baseline();
  assert.equal(baseline.meanMs.toFixed(2), '126.75');
  assert.equal(baseline.ratioAll.toFixed(2), '1.80');
  assert.equal((baseline.idleAll * 100).toFixed(1), '44.5');
  assert.equal(baseline.movedMs, 0);
  assert.equal(baseline.replicas, 0);
});

test('the slowest rank sets the step latency and the idle share', () => {
  for (const step of runCase().history) {
    assert.equal(step.slowest, Math.max(...step.rows));
    assert.ok(Math.abs(step.ms - simulation.cost.fixed - simulation.cost.row * step.slowest) < 1e-9);
    assert.ok(Math.abs(step.ratio - step.slowest * case02.ranks / step.total) < 1e-12);
    assert.equal(simulation.stats({ history: [step], placement: case02.placement }).idle, 1 - step.total / (step.slowest * case02.ranks));
  }
});

test('a rebalance needs an observation and moves weights only when it helps', () => {
  assert.equal(simulation.rebalance(simulation.newRun()), false);
  const early = runCase(undefined, [14]);
  assert.equal(early.rebalances, 1);
  assert.equal(early.movedMs, 0);
  assert.deepEqual(early.placement, case02.placement);
  const run = runCase(undefined, [16]);
  const moving = run.history[15];
  assert.equal(moving.moves, 2);
  assert.equal(run.movedMs, 2 * simulation.cost.move);
  assert.ok(Math.abs(moving.ms - simulation.cost.fixed - simulation.cost.row * moving.slowest - run.movedMs) < 1e-9);
  assert.notEqual(run.placement.findIndex(rank => rank.includes(5)), run.placement.findIndex(rank => rank.includes(6)));
  assert.ok(run.placement.every(rank => rank.length === case02.experts / case02.ranks));
  assert.equal(run.placement.flat().length, case02.experts);
  assert.ok(mean(run, 17, 38, 'ratio') < mean(runCase(), 17, 38, 'ratio') * .75);
  assert.equal(simulation.rebalance(run), false);
});

test('the plan only sees the last four steps', () => {
  const run = simulation.newRun();
  for (let second = 0; second < 7; second++) simulation.step(run, simulation.defaults);
  assert.equal(run.recent.reduce((a, b) => a + b, 0), simulation.window * case02.steps[0].tokens * case02.topK);
});

test('placement alone cannot fix a dominant expert', () => {
  const run = runCase(undefined, [16, 43]);
  assert.equal(run.history[42].moves, 0);
  assert.equal(run.movedMs, 2 * simulation.cost.move);
  assert.ok(mean(run, 44, 60, 'ratio') > 1.9);
});

test('redundant experts put a dominant expert on every rank and cost weight moves and memory', () => {
  // On from second 45, so the plan at 45 has seen four steps of the dominant expert.
  const on = second => ({ redundant: second >= 45 });
  const run = runCase(on, [16, 45]);
  // One new copy per rank, and the copies alone even out the ranks, so nothing is swapped.
  assert.equal(run.history[44].moves, case02.ranks);
  assert.equal(run.movedMs, (2 + case02.ranks) * simulation.cost.move);
  assert.equal(simulation.stats(run).replicas, case02.ranks);
  assert.equal(hosts(run, 9), case02.ranks);
  assert.ok(run.placement.every(rank => rank.length === case02.experts / case02.ranks + 1));
  assert.ok(mean(run, 46, 60, 'ratio') < 1.1);
  assert.ok(mean(runCase(undefined, [16]), 46, 60, 'ratio') > 1.9);
  // A later rebalance has nothing left to improve, so it moves nothing.
  const later = second => ({ redundant: second >= 39 });
  assert.equal(runCase(later, [16, 43, 46, 50]).movedMs, runCase(later, [16, 43]).movedMs);
  assert.equal(runCase(() => ({ redundant: true }), [5]).movedMs, 0);
});

test('two hot experts get a second copy each, and a cold phase adds none', () => {
  // Rebalanced at 20, once the last four steps are all from the hot pair.
  const pair = runCase(second => ({ redundant: second >= 19 }), [20]);
  assert.equal(hosts(pair, 5), 2);
  assert.equal(hosts(pair, 6), 2);
  assert.equal(simulation.stats(pair).replicas, case02.ranks);
  assert.ok(mean(pair, 21, 38, 'ratio') < mean(runCase(undefined, [20]), 21, 38, 'ratio'));
  const steady = runCase(() => ({ redundant: true }), [10]);
  assert.equal(simulation.stats(steady).replicas, 0);
  assert.deepEqual(steady.placement, case02.placement);
});

test('turning redundancy off drops the copies at the next step without moving weights', () => {
  const off = runCase(second => ({ redundant: second >= 45 && second < 52 }), [16, 45]);
  assert.equal(simulation.stats(off).replicas, 0);
  assert.ok(off.placement.every(rank => rank.length === case02.experts / case02.ranks));
  // Second 52 is the first step with redundancy off.
  assert.equal(off.history[51].moves, 0);
  assert.ok(off.history.slice(51).every(step => step.moves === 0));
  assert.equal(off.movedMs, (2 + case02.ranks) * simulation.cost.move);
  assert.deepEqual(off.placement, runCase(undefined, [16]).placement);
  assert.equal(hosts(off, 9), 1);
});

test('a copy never lands on a rank that already has the expert', () => {
  // Loads seen in play that used to end with two copies of one expert on the same rank.
  const spread = [[8, 2, 3, 6], [4, 1, 7, 11], [9, 10, 12, 0], [13, 14, 15, 5]];
  const swap = case02.placement;
  for (const [placement, load] of [
    [spread, [1343, 1302, 1340, 1389, 1336, 6927, 7153, 1301, 1360, 1353, 1355, 1315, 1273, 1327, 1359, 1335]],
    [swap, [1356, 1396, 1365, 1327, 1328, 7013, 7039, 1254, 1298, 1355, 1324, 1344, 1316, 1391, 1366, 1296]],
  ]) {
    const plan = simulation.plan(placement, load, true, case02);
    assert.ok(plan.placement.every(rank => new Set(rank).size === rank.length));
    assert.ok(plan.placement.every(rank => rank.length === 5));
    assert.ok(plan.copies.every((n, e) => n === hosts(plan, e)));
    assert.equal(hosts(plan, 5), 2);
    assert.equal(hosts(plan, 6), 2);
  }
  // Any sequence of switches and rebalances keeps at most one copy of an expert per rank, and
  // copies exist only while redundancy is on.
  let seed = 7;
  const random = () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  for (let trial = 0; trial < 150; trial++) {
    const run = simulation.newRun();
    while (run.second < simulation.duration) {
      const redundant = random() < 0.4;
      if (random() < 0.25) simulation.rebalance(run);
      simulation.step(run, { redundant });
      assert.ok(run.placement.every(rank => new Set(rank).size === rank.length), `second ${run.second}`);
      assert.ok(run.placement.every(rank => rank.length >= case02.experts / case02.ranks && rank.length <= case02.experts / case02.ranks + 1));
      if (!redundant) assert.equal(run.placement.flat().length, case02.experts, `second ${run.second}`);
    }
  }
});
