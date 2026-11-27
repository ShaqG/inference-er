'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const simulation = require('../sim.js');
const { case03 } = require('../case.js');

const bounds = [0, ...case03.phases.map(phase => phase.until)];
const speedup = (k, phase) => simulation.play(k, bounds[phase], bounds[phase + 1]).meanSpeedup;
// One draft length per phase: chat, code completion, peak, creative writing.
const policy = drafts => second => ({ draft: drafts[case03.steps[second - 1].phase] });

function runCase(drafts) {
  const run = simulation.newRun();
  while (run.second < simulation.duration) simulation.step(run, policy(drafts)(run.second + 1));
  return simulation.stats(run);
}

// The first step from `from` with one draft length.
function first(draft, from) {
  const run = simulation.newRun();
  run.second = from;
  simulation.step(run, { draft });
  return run.history[0];
}

test('without speculation every request gets one token per step and the default keeps its results', () => {
  assert.equal(case03.steps.length, simulation.duration);
  assert.deepEqual(simulation.lengths, [0, 2, 4, 8]);
  const run = simulation.newRun();
  while (run.second < simulation.duration) simulation.step(run, simulation.defaults);
  for (const [index, step] of run.history.entries()) {
    assert.equal(step.batch, case03.steps[index].batch);
    assert.equal(step.emitted, step.batch);
    assert.equal(step.kept, 0);
    assert.equal(step.drafting, 0);
    assert.ok(Math.abs(step.ms - Math.hypot(simulation.cost.target, simulation.cost.token * step.batch)) < 1e-9);
    assert.equal(step.speedup, 1);
  }
  const baseline = simulation.baseline();
  assert.equal(baseline.meanMs.toFixed(2), '24.77');
  assert.equal(baseline.meanSpeedup, 1);
  assert.equal(baseline.meanLength, 1);
  assert.equal(baseline.wasteAll, null);
  assert.equal(runCase([0, 0, 0, 0]).meanSpeedup, baseline.meanSpeedup);
});

test('the draft runs k steps and the target checks the drafts plus one token of its own', () => {
  const { cost } = simulation;
  const current = case03.steps[0];
  const step = first(4, 0);
  // Recount by hand: a request keeps drafted tokens up to its first mismatch.
  let kept = 0;
  for (let r = 0; r < current.batch; r++) {
    let n = 0;
    while (n < 4 && current.accept[r * case03.slots + n]) n++;
    kept += n;
  }
  assert.equal(step.kept, kept);
  assert.equal(step.emitted, step.batch + kept);
  assert.equal(step.length, step.emitted / step.batch);
  assert.ok(Math.abs(step.drafting - 4 * Math.hypot(cost.draft, cost.draftToken * step.batch)) < 1e-9);
  assert.ok(Math.abs(step.verifying - Math.hypot(cost.target, cost.token * step.batch * 5)) < 1e-9);
  assert.ok(Math.abs(step.ms - step.drafting - step.verifying) < 1e-9);
  assert.ok(Math.abs(step.speedup - step.length * step.plain / step.ms) < 1e-12);
  const stats = simulation.play(4, 0, 1);
  assert.equal(stats.length, step.length);
  assert.equal(stats.waste, 1 - kept / (4 * step.batch));
});

test('a small batch is bound by reading weights and a large batch by compute', () => {
  const { target, token } = simulation.cost;
  // 16 requests checking 3 tokens each: 48 tokens cost little more than the weight read.
  assert.ok(first(2, 0).verifying < target * 1.07);
  // 256 requests checking one token each already double the step.
  assert.ok(first(0, 35).verifying > target * 2);
  // 256 requests checking 9 tokens each is almost pure compute.
  assert.ok(first(8, 35).verifying > token * 256 * 9 * 0.99);
  assert.ok(first(8, 35).plain < first(8, 35).verifying / 7);
});

test('a shorter draft sees the same matches', () => {
  const short = simulation.newRun();
  const long = simulation.newRun();
  while (short.second < 15) {
    simulation.step(short, { draft: 2 });
    simulation.step(long, { draft: 8 });
  }
  short.history.forEach((step, index) => {
    const accept = case03.steps[index].accept;
    let full = 0;
    let cut = 0;
    for (let r = 0; r < step.batch; r++) {
      let n = 0;
      while (n < 8 && accept[r * case03.slots + n]) n++;
      full += n;
      cut += Math.min(n, 2);
    }
    assert.equal(long.history[index].kept, full);
    assert.equal(step.kept, cut);
  });
});

test('the workload matches its nominal acceptance rates', () => {
  case03.phases.forEach((phase, index) => {
    const steps = case03.steps.slice(bounds[index], bounds[index + 1]);
    const draws = steps.reduce((n, step) => n + step.accept.length, 0);
    const ones = steps.reduce((n, step) => n + step.accept.reduce((a, b) => a + b, 0), 0);
    assert.ok(steps.every(step => step.batch === phase.batch && step.accept.length === phase.batch * case03.slots));
    assert.ok(Math.abs(ones / draws - phase.accept) < 0.005);
  });
  assert.deepEqual(case03.phases.map(phase => phase.batch), [16, 16, 256, 16]);
  assert.deepEqual(case03.phases.map(phase => phase.accept), [0.75, 0.92, 0.75, 0.45]);
});

test('long drafts pay off when the target accepts almost everything', () => {
  assert.ok(speedup(8, 1) > speedup(4, 1));
  assert.ok(speedup(4, 1) > speedup(2, 1));
  assert.ok(speedup(2, 1) > 1);
  assert.ok(speedup(4, 0) > speedup(2, 0));
  assert.ok(speedup(4, 0) > speedup(8, 0));
});

test('a large batch makes every verified token cost real compute', () => {
  assert.ok(speedup(0, 2) > speedup(2, 2));
  assert.ok(speedup(2, 2) > speedup(4, 2));
  assert.ok(speedup(4, 2) > speedup(8, 2));
  assert.ok(speedup(8, 2) < 0.5);
});

test('long drafts stop paying off when few tokens are accepted', () => {
  assert.ok(speedup(2, 3) > 1.3);
  assert.ok(speedup(2, 3) > speedup(4, 3));
  assert.ok(speedup(4, 3) > speedup(8, 3));
  assert.ok(speedup(8, 3) < speedup(2, 3) * 0.7);
});

test('changing the draft length with the traffic beats every fixed length', () => {
  const best = runCase([4, 8, 0, 2]);
  assert.equal(best.meanSpeedup.toFixed(2), '1.31');
  assert.equal(best.meanLength.toFixed(2), '1.63');
  assert.equal(best.wasteAll.toFixed(2), '0.39');
  for (const k of simulation.lengths) assert.ok(runCase([k, k, k, k]).meanSpeedup < best.meanSpeedup);
  assert.ok(runCase([8, 8, 8, 8]).meanSpeedup < 0.85);
  assert.ok(runCase([4, 8, 8, 2]).meanSpeedup < best.meanSpeedup);
});

test('the debrief counts requests, so the peak weighs more than the quiet hours', () => {
  const run = runCase([4, 8, 0, 2]);
  // Each phase keeps one batch, so the mean is the phase speedups weighted by requests served.
  const expected = (16 * 15 * speedup(4, 0) + 16 * 20 * speedup(8, 1) + 256 * 12 + 16 * 13 * speedup(2, 3)) / (16 * 48 + 256 * 12);
  assert.ok(Math.abs(run.meanSpeedup - expected) < 1e-12);
  assert.ok(speedup(8, 1) > 3);
  assert.ok(run.meanSpeedup < speedup(4, 0));
  const history = simulation.newRun();
  simulation.step(history, { draft: 8 });
  simulation.step(history, { draft: 8 });
  const one = simulation.stats({ history: history.history.slice(0, 1) });
  assert.equal(one.meanSpeedup, history.history[0].speedup);
  assert.ok(Math.abs(simulation.stats(history).meanSpeedup - (one.meanSpeedup + history.history[1].speedup) / 2) < 1e-12);
});

test('a replay sees the same matches', () => {
  runCase([2, 4, 2, 8]);
  assert.deepEqual(runCase([8, 8, 8, 8]), runCase([8, 8, 8, 8]));
  assert.deepEqual(runCase([4, 8, 0, 2]), runCase([4, 8, 0, 2]));
});
