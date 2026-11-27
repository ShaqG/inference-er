'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const simulation = require('../sim.js');
const { case04 } = require('../case.js');

// One split per phase: night batch, short chat rush, document Q&A, long-form reasoning.
const best = [0, 6, 7, 3];
const share = result => result.good / result.total;

function play(splits) {
  const run = simulation.newRun();
  while (run.second < simulation.duration) simulation.step(run, { prefill: splits[case04.steps[run.second].phase] });
  return run;
}

const fixed = split => play([split, split, split, split]);
// Phase `index` on `split`, with the other phases on their best split.
const phase = (index, split) => simulation.phases(play(best.map((b, i) => i === index ? split : b)))[index];

test('the workload moves through four phases at their nominal rates', () => {
  assert.equal(case04.gpus, 8);
  assert.equal(case04.steps.length, simulation.duration);
  assert.deepEqual(simulation.splits, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(simulation.defaults.prefill, 0);
  let arrivals = 0;
  case04.phases.forEach((phase, index) => {
    const steps = case04.steps.filter(step => step.phase === index);
    const from = index ? case04.phases[index - 1].until : 0;
    assert.equal(steps.length, phase.until - from);
    arrivals += steps.reduce((n, step) => n + step.arrivals.length, 0);
    const rate = steps.reduce((n, step) => n + step.arrivals.length, 0) / steps.length;
    assert.ok(Math.abs(rate - phase.rate) < phase.rate * 0.05);
    for (const { l, o } of steps.flatMap(step => step.arrivals)) {
      assert.ok(l >= phase.prompt[0] && l <= phase.prompt[1]);
      assert.ok(o >= phase.output[0] && o <= phase.output[1]);
    }
  });
  assert.equal(arrivals, 2626);
});

test('the default keeps every GPU mixed, and prefill then slows every decode step', () => {
  const mixed = fixed(0);
  const baseline = simulation.baseline();
  assert.deepEqual(simulation.stats(mixed), baseline);
  assert.equal(baseline.total, 2626);
  assert.equal(baseline.good, 278);
  assert.equal(baseline.ttft95.toFixed(0), '655');
  assert.equal(baseline.tpot.toFixed(2), '23.10');
  assert.equal(baseline.done, 2227);
  assert.equal(baseline.pending, 399);
  assert.ok(mixed.history.every(second => second.split === 0 && second.prefill === 8 && second.decoders === 8));
  // The same second of the chat rush with the same prompts to process.
  const [onMixed, split] = [mixed.history[14], fixed(6).history[14]];
  assert.ok(Math.abs(onMixed.prefillMs - split.prefillMs) < 1e-6);
  assert.ok(onMixed.steps < split.steps / 2);
  assert.ok(onMixed.tpot > simulation.slo.tpot && split.tpot < simulation.slo.tpot);
  // The night batch is light, so mixed GPUs already keep every request on time.
  assert.equal(phase(0, 0).good, 23);
  assert.ok(phase(0, 1).good < 23);
});

test('too few prefill GPUs leave the queue growing through the chat rush', () => {
  const rush = play([0, 4, 7, 3]).history.slice(12, 30);
  assert.ok(rush.every(second => second.prefillMs > 3999));
  assert.ok(rush.at(-1).queued > 200 && rush.at(-1).queued - rush[0].queued > 150);
  assert.ok(phase(1, 4).ttft95 > simulation.slo.ttft * 2);
  assert.ok(share(phase(1, 4)) < 0.3);
  // Five GPUs keep up, with a queue of at most one prompt.
  assert.ok(fixed(5).history.slice(12, 30).every(second => second.queued <= 1));
  assert.ok(share(phase(1, 5)) > 0.99);
  assert.ok(fixed(6).history.slice(12, 30).every(second => second.queued === 0));
});

test('too few decode GPUs slow the tokens or leave requests without KV room', () => {
  // One decode GPU takes the whole chat rush: the first token is fast, the tokens are slow.
  const rush = phase(1, 7);
  assert.ok(rush.ttft95 < simulation.slo.ttft);
  assert.ok(rush.tpot > simulation.slo.tpot);
  assert.ok(share(rush) < 0.15);
  // Three decode GPUs in the long-form phase: KV fills up and finished prompts wait.
  const late = play([0, 6, 7, 5]).history.slice(54);
  assert.ok(late.every(second => second.kv > 0.99 && second.ready > 0 && second.active <= 250));
  assert.ok(phase(3, 5).ttft95 > 4000);
  assert.ok(play(best).history.slice(45).every(second => second.ready === 0));
  assert.equal(share(phase(3, 3)), 1);
});

test('shrinking the decode pool pauses the requests admitted last', () => {
  const run = simulation.newRun();
  const step = split => simulation.step(run, { prefill: split });
  while (run.second < 55) step(best[case04.steps[run.second].phase]);
  assert.ok(run.active.length > 250);
  step(7);
  const kept = run.active.slice();
  const paused = run.ready.filter(r => r.last !== null);
  assert.ok(kept.length < 100 && paused.length > 150);
  assert.ok(run.history[55].kv <= 1);
  // The requests still decoding were all admitted before any paused one.
  assert.ok(Math.max(...kept.map(r => r.ready)) <= Math.min(...paused.map(r => r.ready)));
  assert.ok(paused.every(r => r.last < 55000));
  // Back to five decode GPUs: every paused request resumes and decodes again.
  step(3);
  assert.equal(run.ready.length, 0);
  assert.ok(run.active.length > 300);
  assert.ok(paused.every(r => r.last >= 56000));
});

test('changing the split with the traffic keeps every request on time and beats every fixed split', () => {
  const result = simulation.stats(play(best));
  assert.equal(result.good, 2626);
  assert.equal(result.ttft95.toFixed(0), '798');
  assert.equal(result.tpot.toFixed(2), '15.93');
  assert.equal(result.done, 2282);
  assert.equal(result.pending, 344);
  for (const split of simulation.splits) assert.ok(simulation.stats(fixed(split)).good < result.good);
  assert.equal(simulation.stats(fixed(5)).good, 2434);
  assert.equal(simulation.stats(fixed(6)).good, 2382);
});

test('each phase wants its own split', () => {
  // Night batch: a few long prompts, not worth taking GPUs away from decoding.
  assert.equal(phase(0, 0).good, 23);
  // Short chat rush: five or six prefill GPUs. Four queue up and one decode GPU is too slow.
  assert.equal(phase(1, 6).good, 2027);
  assert.ok(phase(1, 5).good > 2000);
  assert.ok(phase(1, 4).good < 600 && phase(1, 7).good < 300);
  // Document Q&A: long prompts want more prefill GPUs, and decoding is light.
  assert.equal(phase(2, 7).good, 172);
  assert.ok(phase(2, 6).good > phase(2, 5).good && phase(2, 5).good < 160);
  // Long-form reasoning: long outputs need the KV room and compute of five decode GPUs.
  assert.equal(phase(3, 3).good, 404);
  assert.ok(phase(3, 4).good < 380 && phase(3, 5).good < 260);
  // The debrief names the split each phase mostly used and scores every request once.
  assert.deepEqual(simulation.phases(play([5, 6, 7, 3])).map(p => p.split), [5, 6, 7, 3]);
  const report = simulation.phases(play(best));
  assert.deepEqual(report.map(p => p.split), [0, 6, 7, 3]);
  assert.equal(report.reduce((n, p) => n + p.total, 0), 2626);
});

test('the per-second record adds up', () => {
  const { cost } = simulation;
  const run = play([5, 7, 4, 2]);
  assert.equal(run.history.length, simulation.duration);
  assert.equal(run.history.reduce((n, second) => n + second.tokens, 0), run.requests.reduce((n, r) => n + r.tokens, 0));
  for (const second of run.history) {
    assert.ok(second.kv >= 0 && second.kv <= 1);
    assert.equal(second.prefill + second.decoders, second.split ? 8 : 16);
    assert.ok(second.prefillMs <= second.prefill * 1000 + 1e-6);
    if (second.steps) {
      assert.ok(second.stepMs >= cost.decode);
      assert.ok(second.steps * second.stepMs <= 1000 + 1e-6);
    }
  }
  for (const r of run.requests) {
    assert.ok(r.tokens <= r.o);
    if (r.first !== null) assert.ok(r.first >= r.ready);
    if (r.end !== null) {
      assert.equal(r.tokens, r.o);
      assert.ok(r.end < simulation.duration * 1000 && r.end - r.first <= r.time);
    }
  }
});

test('a request is on time only when its first token and its token pace both meet the target', () => {
  const request = { at: 0, l: 500, o: 40, tokens: 10, first: 300, last: 300, time: 150, ready: 100, end: null };
  const late = { ...request, first: 1200 };
  const slow = { ...request, time: 300 };
  const waiting = { ...request, tokens: 0, first: null, time: 0 };
  const requests = [late, slow, request, waiting, { ...request, end: 450 }];
  assert.deepEqual(simulation.stats({ requests }), {
    total: 5, good: 2, ttft95: 1200, tpot: 18.75, done: 1, pending: 4,
  });
  assert.deepEqual(simulation.stats(simulation.newRun()), { total: 0, good: 0, ttft95: null, tpot: null, done: 0, pending: 0 });
});

test('a replay sees the same requests', () => {
  assert.deepEqual(play([5, 7, 4, 2]), play([5, 7, 4, 2]));
  assert.notDeepEqual(play([5, 7, 4, 2]), play([0, 7, 4, 2]));
  assert.deepEqual(simulation.baseline(), simulation.baseline());
});
