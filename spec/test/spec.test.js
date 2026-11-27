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
    assert.ok(Math.abs(step.ms - simulation.cost.target - simulation.cost.token * step.batch) < 1e-9);
    assert.equal(step.speedup, 1);
  }
  const baseline = simulation.baseline();
  assert.equal(baseline.meanMs.toFixed(2), '30.26');
  assert.equal(baseline.meanSpeedup, 1);
  assert.equal(baseline.meanLength, 1);
  assert.equal(baseline.wasteAll, null);
  assert.equal(runCase([0, 0, 0, 0]).meanSpeedup, baseline.meanSpeedup);
});

test('the draft runs k steps and the target checks the drafts plus one token of its own', () => {
  const { cost } = simulation;
  const current = case03.steps[0];
  const run = simulation.newRun();
  simulation.step(run, { draft: 4 });
  const step = run.history[0];
  // Recount by hand: a request keeps drafted tokens up to its first mismatch.
  let kept = 0;
  for (let r = 0; r < current.batch; r++) {
    let n = 0;
    while (n < 4 && current.accept[r * case03.slots + n]) n++;
    kept += n;
  }
  assert.equal(step.kept, kept);
  assert.equal(step.emitted, step.batch + kept);
  assert.ok(Math.abs(step.drafting - 4 * (cost.draft + cost.draftToken * step.batch)) < 1e-9);
  assert.ok(Math.abs(step.verifying - cost.target - cost.token * step.batch * 5) < 1e-9);
  assert.ok(Math.abs(step.ms - step.drafting - step.verifying) < 1e-9);
  assert.ok(Math.abs(step.speedup - step.emitted * step.plain / (step.batch * step.ms)) < 1e-12);
  const stats = simulation.stats(run);
  assert.equal(stats.length, step.emitted / step.batch);
  assert.equal(stats.waste, 1 - kept / (4 * step.batch));
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
    assert.ok(Math.abs(ones / draws - phase.accept) < 0.01);
  });
  assert.deepEqual(case03.phases.map(phase => phase.batch), [16, 24, 256, 24]);
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
  assert.ok(speedup(8, 2) < 0.6);
});

test('long drafts are wasted when few tokens are accepted', () => {
  assert.ok(speedup(2, 3) > speedup(0, 3));
  assert.ok(speedup(0, 3) > speedup(4, 3));
  assert.ok(speedup(4, 3) > speedup(8, 3));
});

test('changing the draft length with the traffic beats every fixed length', () => {
  const best = runCase([4, 8, 0, 2]);
  assert.equal(best.meanSpeedup.toFixed(2), '1.72');
  assert.equal(best.wasteAll.toFixed(2), '0.39');
  for (const k of simulation.lengths) assert.ok(runCase([k, k, k, k]).meanSpeedup < best.meanSpeedup);
  const peak = runCase([4, 8, 8, 2]);
  assert.ok(peak.meanSpeedup < best.meanSpeedup);
});

test('a replay sees the same matches', () => {
  runCase([2, 4, 2, 8]);
  assert.deepEqual(runCase([8, 8, 8, 8]), runCase([8, 8, 8, 8]));
  assert.deepEqual(runCase([4, 8, 0, 2]), runCase([4, 8, 0, 2]));
  assert.ok(Math.abs(runCase([4, 8, 0, 2]).meanSpeedup - speedup(4, 0) * 15 / 60
    - speedup(8, 1) * 20 / 60 - speedup(2, 3) * 13 / 60 - 12 / 60) < 1e-12);
});
