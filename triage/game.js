'use strict';

const $ = id => document.getElementById(id);
const { case02 } = ERCases;
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
  $('chart').setAttribute('aria-label', t.chart);
  render();
  ERLocale.apply(language);
}

function settings() {
  return { redundant: $('redundant').checked };
}

const percent = value => value === null ? '—' : (value * 100).toFixed(1) + '%';

function tag(text) {
  const badge = document.createElement('span');
  badge.className = 'tag';
  badge.textContent = text;
  return badge;
}

function renderRanks(last, t) {
  const peak = last ? Math.max(...last.rows) : 0;
  const even = last ? last.total / last.rows.length : 0;
  const rows = [];
  for (let r = 0; r < case02.ranks; r++) {
    const load = last ? last.rows[r] : 0;
    const slow = last && load >= even * 1.25;
    const row = document.createElement('div');
    row.className = 'rank' + (slow ? ' slow' : '');
    const name = document.createElement('span');
    name.className = 'rank-name';
    name.textContent = 'R' + r;
    const track = document.createElement('div');
    track.className = 'rank-track';
    const fill = document.createElement('div');
    fill.className = 'rank-fill';
    fill.style.width = peak ? load / peak * 100 + '%' : '0%';
    track.append(fill);
    if (peak) {
      const mark = document.createElement('div');
      mark.className = 'rank-even';
      mark.style.left = even / peak * 100 + '%';
      track.append(mark);
    }
    const num = document.createElement('span');
    num.className = 'rank-num';
    num.textContent = last ? Math.round(load) + ' · ' + (load / even).toFixed(2) + '×' : '—';
    if (slow) num.append(tag(t.bottleneck));
    row.append(name, track, num);
    rows.push(row);
  }
  $('ranks').replaceChildren(...rows);
}

function renderExperts(last) {
  const total = last ? last.total : 0;
  const copies = new Array(case02.experts).fill(0);
  for (const rank of run.placement) {
    for (const e of rank) copies[e]++;
  }
  const shown = new Array(case02.experts).fill(0);
  const rows = run.placement.map((rank, r) => {
    const row = document.createElement('div');
    row.className = 'expert-row' + (rank.length === 4 ? ' four' : '');
    const name = document.createElement('span');
    name.className = 'rank-name';
    name.textContent = 'R' + r;
    row.append(name);
    for (const e of rank) {
      const cell = document.createElement('span');
      cell.className = 'expert';
      cell.textContent = e;
      if (shown[e]++) cell.classList.add('copy');
      if (last) {
        const heat = Math.max(0, Math.min(1, (last.counts[e] / copies[e] / total * case02.experts - 2) / 2));
        cell.style.setProperty('--heat', heat.toFixed(2));
        cell.classList.toggle('hot', heat > .5);
      }
      row.append(cell);
    }
    return row;
  });
  $('experts').replaceChildren(...rows);
}

function render() {
  const t = strings[language];
  const stats = ER.stats(run);
  const remaining = ER.duration - run.second;
  const finished = remaining === 0;
  const running = timer !== null;
  const last = run.history[run.second - 1];
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
  $('ratio').textContent = last ? last.ratio.toFixed(2) + '×' : '—';
  $('ratio').classList.toggle('danger', !!last && last.ratio >= 1.25);
  $('idle').textContent = percent(stats.idle);
  $('idle').classList.toggle('danger', !!last && stats.idle >= .25);
  $('moved').textContent = Math.round(run.movedMs) + ' ms';
  const peak = Math.max(16, ...run.history.map(h => h.ms));
  const points = run.history.map((h, i) => [(i + 1) * 10, 129 - h.ms * 114 / peak]);
  const line = [[0, 129], ...points].map(p => p.join(',')).join(' ');
  $('line').setAttribute('points', line);
  $('area').setAttribute('d', points.length ? 'M' + line.replaceAll(' ', ' L') + ' L' + (points.length * 10) + ',129 Z' : '');
  $('marks').setAttribute('d', run.history.flatMap((h, i) => h.moves ? ['M' + (i + 1) * 10 + ' 15V129'] : []).join(' '));
  $('moving-note').textContent = run.lastMove ? t.movedNote(run.lastMove.moves, run.lastMove.second) : '';
  renderRanks(last, t);
  renderExperts(last);
  $('rebalance').disabled = !running || finished || run.moving || !run.second;
  $('pending').textContent = run.moving ? t.pending : '';
  $('report').hidden = !finished;
  if (finished) renderReport(stats, t);
}

function renderReport(result, t) {
  $('report-summary').textContent = t.reportSummary(result.meanMs, baseline.meanMs, result.idleAll, baseline.idleAll,
    result.movedMs, result.replicas / case02.experts);
  const rows = [
    [t.reportMean, 'meanMs', n => n.toFixed(1) + ' ms'], [t.reportRatio, 'ratioAll', n => n.toFixed(2) + '×'],
    [t.reportIdle, 'idleAll', n => (n * 100).toFixed(1) + '%'],
    [t.reportMoved, 'movedMs', n => Math.round(n) + ' ms'],
    [t.reportMemory, 'replicas', n => (n ? '+' : '') + Math.round(n / case02.experts * 100) + '%'],
  ];
  $('results').replaceChildren();
  for (const [label, key, format] of rows) {
    const delta = result[key] - baseline[key];
    const change = key === 'replicas' ? format(delta) : (delta > 0 ? '+' : '') + format(delta);
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
$('rebalance').addEventListener('click', () => {
  if (ER.rebalance(run)) render();
});

for (const button of document.querySelectorAll('[data-language]')) {
  button.addEventListener('click', () => {
    language = button.dataset.language;
    ERLocale.select(language);
    translate();
  });
}

translate();
