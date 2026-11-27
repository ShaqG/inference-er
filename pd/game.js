'use strict';

const $ = id => document.getElementById(id);
const { case04 } = ERCases;
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
  $('ttft-chart').setAttribute('aria-label', t.ttftAria);
  $('tpot-chart').setAttribute('aria-label', t.tpotAria);
  $('gpus').setAttribute('aria-label', t.gpusAria);
  render();
  ERLocale.apply(language);
}

function settings() {
  return { prefill: Number(document.querySelector('input[name="prefill"]:checked').value) };
}

const percent = value => Math.round(value * 100) + '%';
const rate = value => (value * 100).toFixed(1) + '%';
const splitName = (split, t) => split === 0 ? t.mixed : `${split}P·${case04.gpus - split}D`;

// One line over the 60 seconds. Values above the cap are clipped at the top of the chart, so a
// queue that keeps growing does not flatten the rest. The dashed line is the target, half way up.
function renderLine(id, value, cap) {
  const points = run.history.flatMap((second, i) => {
    const v = value(second);
    return v === null ? [] : [[(i + 1) * 10, Math.max(15, 129 - v * 114 / cap)]];
  });
  $(id).setAttribute('points', points.map(point => point.join(',')).join(' '));
}

// One card per GPU. Prefill cards show the share of the second spent on prompts, decode cards
// their KV use and the requests decoding per card. A meter 90% full or more is marked.
function renderGpus(second, t) {
  const split = second ? second.split : settings().prefill;
  const prefilling = split === 0 ? case04.gpus : split;
  const prompts = second ? second.prefillMs / prefilling / ER.tick : 0;
  const kv = second ? second.kv : 0;
  const meter = (name, value, share) => `<div class="meter${second && share >= 0.9 ? ' busy' : ''}"><span>${name}<b>${second ? value : '—'}</b></span>`
    + `<div><i style="width:${Math.min(100, share * 100)}%"></i></div></div>`;
  $('gpus').innerHTML = Array.from({ length: case04.gpus }, (_, i) => {
    const role = split === 0 ? 'mixed' : i < prefilling ? 'prefill' : 'decode';
    const rows = role === 'decode'
      ? meter(t.kv, percent(kv), kv) + meter(t.batch, String(Math.round(second?.batch || 0)), 0)
      : meter(t.prefill, percent(prompts), prompts) + (role === 'mixed' ? meter(t.kv, percent(kv), kv) : '');
    return `<div class="gpu ${role}"><div class="gpu-head"><span>${i + 1}</span><span class="gpu-role">${t[role + 'Short']}</span></div>${rows}</div>`;
  }).join('');
  $('flow').textContent = t.flow(...['queued', 'ready', 'active'].map(key => second ? second[key] : 0));
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
  $('good').textContent = stats.total ? rate(stats.good / stats.total) : '—';
  $('ttft').textContent = last && last.ttft !== null ? (last.ttft / 1000).toFixed(2) + ' s' : '—';
  $('ttft').classList.toggle('danger', !!last && last.ttft > ER.slo.ttft);
  $('tpot').textContent = last && last.tpot !== null ? last.tpot.toFixed(1) + ' ms' : '—';
  $('tpot').classList.toggle('danger', !!last && last.tpot > ER.slo.tpot);
  $('queued').textContent = last ? String(last.queued) : '—';
  $('queued').classList.toggle('danger', !!last && last.queued > 0);
  renderLine('ttft-line', second => second.ttft, ER.slo.ttft * 2);
  renderLine('tpot-line', second => second.tpot, ER.slo.tpot * 2);
  renderGpus(last, t);
  $('report').hidden = !finished;
  $('diagnosis').hidden = !finished;
  if (finished) {
    renderReport(stats, t);
    ERProgress.renderDiagnosis($('diagnosis'), t, {
      id: 'c04',
      recordable: true,
      goals: [
        { label: t.goal04a, ok: stats.total > 0 && stats.good / stats.total >= .9 },
        { label: t.goal04b, ok: stats.total > 0 && stats.good === stats.total },
      ],
    });
  }
}

function renderReport(result, t) {
  $('report-summary').textContent = t.reportSummary(result.good, result.total, baseline.good / baseline.total);
  const rows = [
    [t.reportGood, r => r.good / r.total, v => (v * 100).toFixed(1) + '%'],
    [t.reportTtft, r => r.ttft95 === null ? null : r.ttft95 / 1000, v => v.toFixed(2) + ' s'],
    [t.reportTpot, r => r.tpot, v => v.toFixed(1) + ' ms'],
    [t.reportDone, r => r.done, String],
    [t.reportPending, r => r.pending, String],
  ];
  $('results').replaceChildren();
  for (const [label, pick, format] of rows) {
    const mine = pick(result);
    const base = pick(baseline);
    const gap = mine === null || base === null ? null : mine - base;
    const change = gap === null ? '—' : gap === 0 ? format(0) : (gap > 0 ? '+' : '-') + format(Math.abs(gap));
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    for (const value of [mine === null ? '—' : format(mine), base === null ? '—' : format(base), change]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    $('results').append(row);
  }
  $('phases').replaceChildren();
  for (const phase of ER.phases(run)) {
    const onTime = phase.good / phase.total;
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = `${t.phases[phase.index]} · ${t.requestCount(phase.total)}`;
    row.append(heading);
    for (const [value, late] of [
      [splitName(phase.split, t), false],
      [rate(onTime), onTime < 1],
      [phase.ttft95 === null ? '—' : (phase.ttft95 / 1000).toFixed(2) + ' s', phase.ttft95 > ER.slo.ttft],
      [phase.tpot === null ? '—' : phase.tpot.toFixed(1) + ' ms', phase.tpot > ER.slo.tpot],
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      cell.classList.toggle('danger', late);
      row.append(cell);
    }
    $('phases').append(row);
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

for (const button of document.querySelectorAll('[data-language]')) {
  button.addEventListener('click', () => {
    language = button.dataset.language;
    ERLocale.select(language);
    translate();
  });
}

translate();
