'use strict';

const $ = id => document.getElementById(id);
const baseline = ER.baseline();
let run = ER.newRun();
let timer = null;

function settings() {
  return {
    batch: Number(document.querySelector('input[name="batch"]:checked').value),
    reserve: $('reserve').checked,
    limit: $('limit').checked,
  };
}

function render() {
  const stats = ER.stats(run);
  const remaining = ER.duration - run.second;
  $('clock').textContent = remaining === 60 ? '01:00' : '00:' + String(remaining).padStart(2, '0');
  $('progress').style.width = remaining / ER.duration * 100 + '%';
  $('done').textContent = stats.done;
  $('timeout').textContent = stats.timeout;
  $('p95').textContent = stats.p95 === null ? '—' : stats.p95 + 's';
  $('rate').textContent = stats.rate.toFixed(1);
  $('pending').textContent = stats.pending + ' 活跃 · ' + stats.rejected + ' 拒绝';
  const peak = Math.max(16, ...run.history);
  const points = run.history.map((n, i) => [(i + 1) * 10, 129 - n * 114 / peak]);
  const line = [[0, 129], ...points].map(p => p.join(',')).join(' ');
  $('line').setAttribute('points', line);
  $('area').setAttribute('d', points.length ? 'M' + line.replaceAll(' ', ' L') + ' L' + (points.length * 10) + ',129 Z' : '');
  const jobs = run.jobs.filter(j => j.status === 'active').slice(-12);
  $('queue').replaceChildren();
  if (!jobs.length) {
    $('queue').textContent = run.second ? '当前没有在途请求。' : '接管后在这里查看请求处于 Prefill 还是 Decode。';
  }
  for (const job of jobs) {
    const badge = document.createElement('span');
    badge.className = 'job ' + job.kind;
    badge.textContent = '#' + job.id + ' ' + (job.kind === 'long' ? '长' : '短') + ' · ' + (job.prompt ? 'Prefill' : 'Decode');
    $('queue').append(badge);
  }
}

function finish() {
  clearInterval(timer);
  timer = null;
  $('state').textContent = '已结束';
  $('phase').textContent = '本轮结束 · 可以重开同一批请求';
  $('start').textContent = '本轮已结束';
  const result = ER.stats(run);
  const difference = result.done - baseline.done;
  const verdict = difference > 0 ? '比默认策略多完成 ' + difference + ' 条'
    : difference < 0 ? '比默认策略少完成 ' + -difference + ' 条' : '与默认策略完成数持平';
  $('report-summary').textContent = '完成 ' + result.done + ' 条请求，' + verdict + '。';
  const rows = [
    ['完成请求', 'done'], ['完成短请求', 'short'], ['超时', 'timeout'],
    ['主动拒绝', 'rejected'], ['结束时仍在途', 'pending'],
    ['首 Token P95', 'p95', ' s'], ['输出 token/s', 'rate', '', 1],
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
  $('report').hidden = false;
  $('report-title').focus();
}

$('start').addEventListener('click', () => {
  if (timer !== null || run.second >= ER.duration) return;
  $('start').disabled = true;
  $('start').textContent = '●  正在接管';
  $('state').textContent = '运行中';
  $('phase').textContent = '同一批请求 · 调度策略实时生效';
  timer = setInterval(() => {
    ER.step(run, settings());
    render();
    if (run.second === ER.duration) finish();
  }, 1000);
});

$('reset').addEventListener('click', () => {
  clearInterval(timer);
  timer = null;
  run = ER.newRun();
  $('report').hidden = true;
  $('start').disabled = false;
  $('start').textContent = '▶  接管服务';
  $('state').textContent = '待命';
  $('phase').textContent = '待命 · 保留当前策略，可直接再试';
  render();
});

render();
