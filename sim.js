(function (root) {
  const { duration, case01 } = typeof module === 'object' ? require('./case.js') : root.ERCases;
  const defaults = { batch: 4, reserve: false, limit: false };

  function newRun(workload = case01) {
    return { second: 0, jobs: [], history: [], requests: workload.requests, cursor: 0, tokens: 0 };
  }

  function step(run, settings) {
    if (run.second >= duration) return;
    const now = ++run.second;
    while (run.requests[run.cursor]?.at === now) {
      const { kind, prefillWork, outputTokens, timeout } = run.requests[run.cursor++];
      const rejected = kind === 'long' && settings.limit
        && run.jobs.filter(j => j.kind === 'long' && j.status === 'active').length >= 2;
      run.jobs.push({
        id: run.cursor, kind, at: now, deadline: now + timeout,
        prompt: prefillWork, remaining: outputTokens,
        first: null, status: rejected ? 'rejected' : 'active',
      });
    }
    for (const job of run.jobs) {
      if (job.status === 'active' && now > job.deadline) job.status = 'timeout';
    }
    const active = run.jobs.filter(j => j.status === 'active');
    const prefill = active.filter(j => j.prompt > 0);
    const decode = active.filter(j => j.prompt === 0);
    if (settings.reserve) {
      prefill.sort((a, b) => Number(a.kind === 'long') - Number(b.kind === 'long'));
      decode.sort((a, b) => Number(a.kind === 'long') - Number(b.kind === 'long'));
    }
    let budget = { 2: 10, 4: 14, 8: 18 }[settings.batch];
    for (const job of decode.slice(0, settings.batch)) {
      const made = Math.min(2, budget, job.remaining);
      if (!made) break;
      if (job.first === null) job.first = now - job.at;
      job.remaining -= made;
      budget -= made;
      run.tokens += made;
      if (!job.remaining) job.status = 'done';
    }
    for (const job of prefill) {
      const work = Math.min(budget, job.prompt);
      job.prompt -= work;
      budget -= work;
      if (!budget) break;
    }
    run.history.push(run.jobs.filter(j => j.status === 'active').length);
  }

  function stats(run) {
    const count = status => run.jobs.filter(j => j.status === status).length;
    function p95(jobs) {
      const first = jobs.filter(j => j.first !== null).map(j => j.first).sort((a, b) => a - b);
      return first.length ? first[Math.ceil(first.length * .95) - 1] : null;
    }
    return {
      done: count('done'), timeout: count('timeout'), rejected: count('rejected'),
      pending: count('active'), short: run.jobs.filter(j => j.kind === 'short' && j.status === 'done').length,
      p95: p95(run.jobs), shortP95: p95(run.jobs.filter(j => j.kind === 'short')),
      rate: run.second ? run.tokens / run.second : 0,
    };
  }

  function baseline(workload = case01) {
    const run = newRun(workload);
    for (let second = 0; second < duration; second++) step(run, defaults);
    return stats(run);
  }

  const api = { duration, defaults, newRun, step, stats, baseline };
  if (typeof module === 'object') module.exports = api;
  else root.ER = api;
})(globalThis);
