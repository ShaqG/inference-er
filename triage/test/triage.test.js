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

test('redundant experts spread a dominant expert and cost weight moves and memory', () => {
  const run = runCase(second => ({ redundant: second >= 45 && second < 52 }), [16, 45]);
  assert.ok(run.history[44].moves >= case02.ranks + 2);
  assert.equal(run.movedMs, (2 + run.history[44].moves) * simulation.cost.move);
  assert.equal(simulation.stats(run).replicas, case02.ranks);
  assert.ok(hosts(run, 9) >= case02.ranks - 1);
  assert.ok(run.placement.every(rank => rank.length === case02.experts / case02.ranks + 1));
  assert.ok(mean(run, 46, 60, 'ratio') < 1.5);
  assert.ok(mean(runCase(undefined, [16]), 46, 60, 'ratio') > 1.9);
  const off = runCase(second => ({ redundant: second >= 45 && second < 52 }), [16, 45, 52]);
  assert.equal(simulation.stats(off).replicas, 0);
  assert.ok(off.placement.every(rank => rank.length === case02.experts / case02.ranks));
});
