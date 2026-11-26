'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const simulation = require('../sim.js');
const { case01, validate } = require('../case.js');
const example = require('../examples/request-replay.json');

function runCase(workload, settings = simulation.defaults) {
  const run = simulation.newRun(workload);
  while (run.second < simulation.duration) simulation.step(run, settings);
  return run;
}

test('the built-in workload preserves the original default results', () => {
  assert.deepEqual(validate(case01), case01);
  assert.deepEqual(simulation.baseline(), {
    done: 10, timeout: 30, rejected: 0, pending: 8, short: 6,
    p95: 15, shortP95: 9, rate: 4.8,
  });
});

test('imported requests keep their order and have their own baseline', () => {
  const workload = validate(example);
  const first = runCase(workload);
  const second = runCase(workload, { ...simulation.defaults, limit: true });
  const arrivals = run => run.jobs.map(({ at, kind }) => [at, kind]);
  assert.deepEqual(arrivals(first), arrivals(second));
  assert.deepEqual(arrivals(first), workload.requests.map(({ at, kind }) => [at, kind]));
  assert.equal(simulation.stats(second).rejected, 1);
  assert.deepEqual(simulation.stats(first), simulation.baseline(workload));
  assert.notDeepEqual(simulation.baseline(workload), simulation.baseline());
});

test('the importer rejects unsupported versions, unsorted arrivals and malformed rows', () => {
  assert.throws(() => validate({ ...example, version: 2 }), /^Error: caseHeader$/);
  assert.throws(() => validate({ ...example, requests: [] }), /^Error: caseRequests$/);
  const [early, late] = example.requests;
  assert.throws(() => validate({ ...example, requests: [late, early] }), /^Error: caseRow:2$/);
  assert.throws(() => validate({ ...example, requests: [{ ...early, outputTokens: 0 }] }), /^Error: caseRow:1$/);
});
