'use strict';

const $ = id => document.getElementById(id);
const { case01, validate } = ERCases;
let language = ERLocale.initial;
let workload = case01;
let baseline = ER.baseline(workload);
let run = ER.newRun(workload);
let timer = null;
let restarted = false;
let importStatus = [];
let fileRequest = 0;

function translate() {
  const t = strings[language];
  document.title = t.pageTitle;
  document.querySelector('meta[name="description"]').content = t.intro;
  for (const element of document.querySelectorAll('[data-text]')) {
    element.textContent = t[element.dataset.text];
  }
  for (const button of document.querySelectorAll('[data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
  $('chart').setAttribute('aria-label', t.chart);
  render();
  ERLocale.apply(language);
}

function settings() {
  return {
    batch: Number(document.querySelector('input[name="batch"]:checked').value),
    reserve: $('reserve').checked,
    limit: $('limit').checked,
  };
}

function render() {
  const t = strings[language];
  const stats = ER.stats(run);
  const remaining = ER.duration - run.second;
  const finished = remaining === 0;
  const running = timer !== null;
  const custom = workload !== case01;
  $('case-label').textContent = custom ? t.importedCase : t.case01;
  $('case-intro').textContent = custom ? t.importedIntro(workload.requests.length) : t.intro;
  $('hint').textContent = custom ? t.importedHint : t.hint;
  $('source-note').textContent = workload.source === 'trace-derived' ? t.sourceTrace : t.sourceSynthetic;
  $('restore-case').hidden = !custom;
  const [status, detail] = importStatus;
  const message = typeof t[status] === 'function' ? t[status](detail) : t[status] ?? '';
  if ($('case-status').textContent !== message) $('case-status').textContent = message;
  $('state').textContent = finished ? t.finished : running ? t.running : t.idle;
  $('phase').textContent = finished ? t.finishedNote : running ? t.runningNote
    : restarted ? t.resetNote : t.idleNote;
  $('start').disabled = finished || running;
  $('start').textContent = finished ? t.finishedButton : running ? t.runningButton : t.start;
  $('clock').textContent = String(Math.floor(remaining / 60)).padStart(2, '0')
    + ':' + String(remaining % 60).padStart(2, '0');
  $('progress').style.width = remaining / ER.duration * 100 + '%';
  $('done').textContent = stats.done;
  $('timeout').textContent = stats.timeout;
  $('p95').textContent = stats.shortP95 === null ? '—' : stats.shortP95 + 's';
  $('rate').textContent = stats.rate.toFixed(1);
  $('pending').textContent = t.pending(stats.pending, stats.rejected);
  const peak = Math.max(16, ...run.history);
  const points = run.history.map((n, i) => [(i + 1) * 10, 129 - n * 114 / peak]);
  const line = [[0, 129], ...points].map(p => p.join(',')).join(' ');
  $('line').setAttribute('points', line);
  $('area').setAttribute('d', points.length ? 'M' + line.replaceAll(' ', ' L') + ' L' + (points.length * 10) + ',129 Z' : '');
  const jobs = run.jobs.filter(j => j.status === 'active').slice(-12);
  $('queue').replaceChildren();
  if (!jobs.length) {
    $('queue').textContent = run.second ? t.noJobs : t.queueIntro;
  }
  for (const job of jobs) {
    const badge = document.createElement('span');
    badge.className = 'job ' + job.kind;
    badge.textContent = '#' + job.id + ' ' + t[job.kind] + ' · ' + (job.prompt ? 'Prefill' : 'Decode');
    $('queue').append(badge);
  }
  $('report').hidden = !finished;
  if (finished) renderReport(stats, t);
}

function renderReport(result, t) {
  $('report-summary').textContent = t.reportSummary(result.done, result.done - baseline.done);
  const rows = [
    [t.reportDone, 'done'], [t.reportShort, 'short'], [t.reportTimeout, 'timeout'],
    [t.reportRejected, 'rejected'], [t.reportPending, 'pending'],
    [t.shortP95, 'shortP95', ' s'], [t.reportP95, 'p95', ' s'], [t.rate, 'rate', '', 1],
  ];
  $('results').replaceChildren();
  for (const [label, key, unit = '', precision = 0] of rows) {
    const a = result[key];
    const b = baseline[key];
    const delta = a === null || b === null ? null : a - b;
    const format = n => n === null ? '—' : n.toFixed(precision) + unit;
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    for (const value of [format(a), format(b), (delta > 0 ? '+' : '') + format(delta)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    $('results').append(row);
  }
}

$('start').addEventListener('click', () => {
  if (timer !== null || run.second >= ER.duration) return;
  timer = setInterval(() => {
    ER.step(run, settings());
    const finished = run.second === ER.duration;
    if (finished) {
      clearInterval(timer);
      timer = null;
    }
    render();
    if (finished) $('report-title').focus();
  }, 1000);
  render();
});

function replay() {
  clearInterval(timer);
  timer = null;
  restarted = true;
  run = ER.newRun(workload);
  render();
}

$('reset').addEventListener('click', replay);
$('import-case').addEventListener('click', () => $('case-file').click());
$('case-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const load = ++fileRequest;
  try {
    if (file.size > 128 * 1024) throw new Error('fileError');
    const candidate = validate(JSON.parse(await file.text()));
    if (load !== fileRequest) return;
    workload = candidate;
    baseline = ER.baseline(workload);
    importStatus = ['importOK', workload.requests.length];
    replay();
  } catch (error) {
    if (load !== fileRequest) return;
    const [key, row] = error.message.split(':');
    importStatus = ['caseHeader', 'caseRequests', 'caseRow'].includes(key) ? [key, row] : ['fileError'];
    render();
  }
});
$('restore-case').addEventListener('click', () => {
  fileRequest++;
  workload = case01;
  baseline = ER.baseline(workload);
  importStatus = [];
  replay();
});

for (const button of document.querySelectorAll('[data-language]')) {
  button.addEventListener('click', () => {
    language = button.dataset.language;
    ERLocale.select(language);
    translate();
  });
}

translate();
