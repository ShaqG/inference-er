'use strict';

const $ = id => document.getElementById(id);
const { case03 } = ERCases;
let language = ERLocale.initial;
let baseline = ER.baseline();
let run = ER.newRun();
let timer = null;
let restarted = false;

function translate() {
  const t = strings[language];
  document.title = t.pageTitle;
  document.querySelector('meta[name="description"]').content = t.intro;
  for (const element of document.querySelectorAll('[data-text]')) {
    element.textContent = t[element.dataset.text];
  }
  ERProgress.renderNav(t);
  $('chart').setAttribute('aria-label', t.chart);
  $('drafts').setAttribute('aria-label', t.draftsChart);
  render();
  ERLocale.apply(language);
}

function settings() {
  return { draft: Number(document.querySelector('input[name="draft"]:checked').value) };
}

const share = value => value === null ? '—' : (value * 100).toFixed(1) + '%';

// The step's latency as one bar: drafting, then verifying. The tick marks the same step without
// speculation. Only the latest step is shown, so the bars are sized against its own latency.
function renderSplit(last, t) {
  const slow = !!last && last.speedup < 1;
  $('split').classList.toggle('slow', slow);
  $('draft').style.width = last ? last.drafting / last.ms * 100 + '%' : '0%';
  $('verify').style.width = last ? last.verifying / last.ms * 100 + '%' : '0%';
  $('tick').style.left = last ? last.plain / last.ms * 100 + '%' : '0%';
  $('draft-label').textContent = last ? t.draftMs(last.drafting) : '';
  $('verify-label').textContent = last ? t.verifyMs(last.verifying) : '';
  $('plain-label').textContent = last ? t.plainMs(last.plain) : '';
}

// One bar per step: the tokens drafted for a request, accepted part at the bottom.
function renderDrafts() {
  const shown = run.history.slice(-20);
  const unit = 100 / Math.max(4, ...shown.map(h => h.k));
  const bars = shown.map((h, i) => {
    const x = i * 30 + 5;
    if (!h.k) return `<rect class="idle" x="${x}" y="96" width="20" height="4"/>`;
    const kept = h.kept / h.batch * unit;
    const drafted = h.k * unit;
    return `<rect class="dropped" x="${x}" y="${100 - drafted}" width="20" height="${drafted - kept}"/>`
      + `<rect class="kept" x="${x}" y="${100 - kept}" width="20" height="${kept}"/>`;
  });
  $('bars').innerHTML = bars.join('');
}

function render() {
  const t = strings[language];
  const stats = ER.stats(run);
  const remaining = ER.duration - run.second;
  const finished = remaining === 0;
  const running = timer !== null;
  const last = run.history[run.second - 1];
  // The note belongs to the latency chart, so it shows the batch of the step that just ran.
  const batch = case03.steps[Math.max(0, run.second - 1)].batch;
  $('source-note').textContent = t.sourceSynthetic;
  $('state').textContent = finished ? t.finished : running ? t.running : t.idle;
  const phase = last ? t.phases[last.phase] + ' · ' : '';
  $('phase').textContent = finished ? t.finishedNote : running ? phase + t.runningNote
    : restarted ? t.resetNote : t.idleNote;
  $('start').disabled = finished || running;
  $('start').textContent = finished ? t.finishedButton : running ? t.runningButton : t.start;
  $('clock').textContent = String(Math.floor(remaining / 60)).padStart(2, '0')
    + ':' + String(remaining % 60).padStart(2, '0');
  $('progress').style.width = remaining / ER.duration * 100 + '%';
  $('ms').textContent = last ? last.ms.toFixed(1) : '—';
  $('length').textContent = last ? stats.length.toFixed(2) : '—';
  $('waste').textContent = share(stats.waste);
  $('speedup').textContent = last ? stats.speedup.toFixed(2) + '×' : '—';
  $('speedup').classList.toggle('danger', !!last && stats.speedup < 1);
  $('batch-note').textContent = t.concurrent(batch) + ' · ' + t.batchNote;
  const peak = Math.max(16, ...run.history.flatMap(h => [h.ms, h.plain]));
  const y = value => 129 - value * 114 / peak;
  const points = run.history.map((h, i) => [(i + 1) * 10, y(h.ms)]);
  const line = [[0, 129], ...points].map(p => p.join(',')).join(' ');
  const plain = [[0, 129], ...run.history.map((h, i) => [(i + 1) * 10, y(h.plain)])].map(p => p.join(',')).join(' ');
  $('line').setAttribute('points', line);
  $('base').setAttribute('points', plain);
  $('area').setAttribute('d', points.length ? 'M' + line.replaceAll(' ', ' L') + ' L' + (points.length * 10) + ',129 Z' : '');
  renderSplit(last, t);
  renderDrafts();
  $('report').hidden = !finished;
  $('diagnosis').hidden = !finished;
  if (finished) {
    renderReport(stats, t);
    // Phase 2 is the 256-request peak: verification turns compute-bound there, so a
    // draft that is not shortened drags every step below the no-speculation line.
    const peak = run.history.filter(h => h.phase === 2);
    const peakSpeedup = peak.reduce((a, h) => a + h.speedup * h.batch, 0)
      / peak.reduce((a, h) => a + h.batch, 0);
    ERProgress.renderDiagnosis($('diagnosis'), t, {
      id: 'c03',
      recordable: true,
      goals: [
        { label: t.goal03a, ok: stats.meanSpeedup > (baseline.meanSpeedup ?? 1) + 1e-9 },
        { label: t.goal03b, ok: peakSpeedup >= 1 - 1e-9 },
      ],
    });
  }
}

function renderReport(result, t) {
  $('report-summary').textContent = t.reportSummary(result.meanSpeedup, result.wasteAll);
  const rows = [
    [t.reportSpeedup, 'meanSpeedup', n => n.toFixed(2) + '×'], [t.reportLength, 'meanLength', n => n.toFixed(2)],
    [t.reportWaste, 'wasteAll', share],
  ];
  $('results').replaceChildren();
  for (const [label, key, format] of rows) {
    const change = baseline[key] === null ? '—' : (result[key] - baseline[key] > 0 ? '+' : '') + format(result[key] - baseline[key]);
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    for (const value of [format(result[key]), format(baseline[key]), change]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    $('results').append(row);
  }
  $('phases').replaceChildren();
  case03.phases.forEach((phase, index) => {
    const steps = run.history.filter(h => h.phase === index);
    // A phase keeps one batch size, so its requests are counted step by step.
    const mean = key => steps.reduce((a, s) => a + s[key], 0) / steps.length;
    const speedup = mean('speedup');
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = `${t.phases[index]} · ${t.concurrent(phase.batch)}`;
    row.append(heading);
    for (const [value, danger] of [[mean('length').toFixed(2), false], [speedup.toFixed(2) + '×', speedup < 1]]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      cell.classList.toggle('danger', danger);
      row.append(cell);
    }
    $('phases').append(row);
  });
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
  run = ER.newRun();
  render();
}

$('reset').addEventListener('click', replay);

for (const button of document.querySelectorAll('[data-language]')) {
  button.addEventListener('click', () => {
    language = button.dataset.language;
    ERLocale.select(language);
    translate();
  });
}

translate();
