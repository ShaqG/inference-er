(function (root) {
  const duration = 60;
  const defaults = { batch: 4, reserve: false, limit: false };

  function newRun() {
    return { second: 0, jobs: [], history: [], nextId: 1, tokens: 0 };
  }

  function step(run, settings) {
    if (run.second >= duration) return;
    const now = ++run.second;
    function admit(kind) {
      const long = kind === 'long';
      const activeLong = run.jobs.filter(j => j.kind === 'long' && j.status === 'active').length;
      const rejected = long && settings.limit && activeLong >= 2;
      run.jobs.push({
        id: run.nextId++, kind, at: now, deadline: now + (long ? 23 : 9),
        prompt: long ? 34 : 4, remaining: long ? 25 : 5,
        first: null, status: rejected ? 'rejected' : 'active',
      });
    }
    if (now % 2 === 1 || (now >= 17 && now <= 28)) admit('short');
    if ([8, 9, 10, 11, 13, 16, 23, 27, 36, 37, 40, 48].includes(now)) admit('long');
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
    const first = run.jobs.filter(j => j.first !== null).map(j => j.first).sort((a, b) => a - b);
    return {
      done: count('done'), timeout: count('timeout'), rejected: count('rejected'),
      pending: count('active'), short: run.jobs.filter(j => j.kind === 'short' && j.status === 'done').length,
      p95: first.length ? first[Math.ceil(first.length * .95) - 1] : null,
      rate: run.second ? run.tokens / run.second : 0,
    };
  }

  function baseline() {
    const run = newRun();
    for (let second = 0; second < duration; second++) step(run, defaults);
    return stats(run);
  }

  const api = { duration, defaults, newRun, step, stats, baseline };
  if (typeof module === 'object') module.exports = api;
  else root.ER = api;
})(globalThis);
