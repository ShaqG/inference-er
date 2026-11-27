'use strict';

const strings = {
  zh: {
    titleLead: '投机 ', titleAccent: '代诊',
    pageTitle: '投机代诊 | Inference ER',
    case03: 'CASE 03 / 实习医生先写，主治一次审完',
    intro: '小模型先替每条请求写几个 token，大模型一次审完，写到第一个错为止。你有 60 秒决定草稿写多长。',
    nav01: 'CASE 01 · 调度', nav02: 'CASE 02 · 分诊台', nav03: 'CASE 03 · 代诊', nav04: 'CASE 04 · PD 分离',
    start: '▶ 开始代诊', reset: '↻ 重开同一局', remaining: '剩余时间',
    idle: '待命', idleNote: '待命 · 开始后可实时调整策略',
    resetNote: '待命 · 保留当前策略，可直接再试',
    running: '运行中', runningButton: '● 代诊中',
    runningNote: '每秒一步 · 草稿长度实时生效',
    finished: '已结束', finishedButton: '本轮已结束',
    finishedNote: '本轮结束 · 可以重开同一批草稿',
    phases: ['日常对话', '代码补全', '晚高峰', '创意写作'],
    monitor: '解码监控',
    ms: '步延迟 ms', length: '接受长度', waste: '草稿浪费率', speedup: '加速比',
    chart: '最近 60 步的延迟，单位毫秒', chartTitle: '每步延迟',
    concurrent: n => `并发 ${n} 条`,
    batchNote: '虚线是不开投机的步延迟',
    split: '本步耗时拆分', splitNote: '竖线是不开投机时的步延迟',
    draftMs: n => `起草 ${n.toFixed(1)} ms`, verifyMs: n => `验证 ${n.toFixed(1)} ms`,
    plainMs: n => `不开投机 ${n.toFixed(1)} ms`,
    drafts: '最近 20 步的草稿', draftsNote: '绿色是接受的草稿 token，橙色是被拒绝的',
    draftsChart: '最近 20 步每条请求起草的 token 数，以及其中被接受的数量',
    controls: '代诊台', live: '实时生效',
    draft: '草稿长度 k', off: '关',
    draftHelp: '小模型为每条请求先写 k 个 token，大模型一次验证 k+1 个。写得多可能多收，但每多写一个都要多花时间。',
    hintTitle: '值班提示',
    hint: '第 16 秒切到代码补全，第 36 秒进入晚高峰（并发 256），第 48 秒是创意写作。并发小时，多验证几个草稿 token 花不了多少时间；并发大了，每多验证一个都要真算一遍。草稿被拒得越多，写得越长越亏。',
    report: '本轮复盘', metric: '指标', thisRun: '本轮', baseline: '默认策略', change: '变化',
    reportSpeedup: '平均加速比', reportLength: '平均接受长度',
    reportWaste: '草稿浪费率', byPhase: '分阶段', phase: '阶段',
    reportSummary: (speedup, waste) => {
      const gap = Math.round((speedup - 1) * 100);
      const head = gap === 0 ? '每条请求的平均速度与默认策略持平'
        : `每条请求的平均速度比默认策略${gap > 0 ? '高' : '低'} ${Math.abs(gap)}%`;
      return waste === null ? '全程没有开启投机解码，与默认策略一致。'
        : `${head}，起草的 token 有 ${(waste * 100).toFixed(1)}% 被拒绝。`;
    },
    reportNote: '默认策略关闭投机解码。加速比是同一步里每条请求的产出速度与不开投机时之比，接受长度是每条请求每步产出的 token 数。两者都按各步的并发数加权，所以高峰里的每条请求都算进去。',
    sourceLink: '源代码', sourceSynthetic: '合成草稿 · 所有结果为模拟值',
  },
  en: {
    titleLead: 'Second ', titleAccent: 'Opinion',
    pageTitle: 'Second Opinion | Inference ER',
    case03: 'CASE 03 / DRAFT FIRST, VERIFY ONCE',
    intro: 'A small draft model writes a few tokens for every request and the target model checks them all in one pass, up to the first miss. You have 60 seconds to set the draft length.',
    nav01: 'CASE 01 · SCHEDULING', nav02: 'CASE 02 · TRIAGE', nav03: 'CASE 03 · SECOND OPINION', nav04: 'CASE 04 · P/D SPLIT',
    start: '▶ Start rounds', reset: '↻ Replay this case', remaining: 'Time remaining',
    idle: 'Standby', idleNote: 'Standby · Change policies live once you start',
    resetNote: 'Standby · Your current settings are ready to replay',
    running: 'Running', runningButton: '● In progress',
    runningNote: 'one step per second · Draft length applies live',
    finished: 'Finished', finishedButton: 'Run complete',
    finishedNote: 'Run complete · Replay the same drafts to try another policy',
    phases: ['Chat', 'Code completion', 'Peak hours', 'Creative writing'],
    monitor: 'Decode monitor',
    ms: 'Step latency ms', length: 'Accepted length', waste: 'Drafts rejected', speedup: 'Speedup',
    chart: 'Latency of the last 60 steps in milliseconds', chartTitle: 'Latency per step',
    concurrent: n => `${n} in flight`,
    batchNote: 'Dashed line: no speculation',
    split: 'Where this step went', splitNote: 'The tick is the step latency without speculation',
    draftMs: n => `Drafting ${n.toFixed(1)} ms`, verifyMs: n => `Verifying ${n.toFixed(1)} ms`,
    plainMs: n => `No speculation ${n.toFixed(1)} ms`,
    drafts: 'Drafts in the last 20 steps', draftsNote: 'Green tokens were accepted, orange ones were rejected',
    draftsChart: 'Tokens drafted per request in the last 20 steps, and how many of them were accepted',
    controls: 'Clinic', live: 'Applies live',
    draft: 'Draft length k', off: 'Off',
    draftHelp: 'The draft model writes k tokens for every request and the target checks k+1 in one pass. Longer drafts can land more tokens, and every extra one costs time.',
    hintTitle: 'On-call tip',
    hint: 'Traffic switches to code completion at second 16, hits a peak of 256 concurrent requests at second 36, and turns to creative writing at second 48. With a small batch, verifying a few extra tokens costs little. With a large batch, every extra token is real compute. The more drafts get rejected, the more a long draft costs.',
    report: 'Debrief', metric: 'Metric', thisRun: 'This run', baseline: 'Default', change: 'Change',
    reportSpeedup: 'Mean speedup', reportLength: 'Mean accepted length',
    reportWaste: 'Drafts rejected', byPhase: 'By phase', phase: 'Phase',
    reportSummary: (speedup, waste) => {
      const gap = Math.round((speedup - 1) * 100);
      const head = gap === 0 ? 'Mean speed per request matches the default policy'
        : `Mean speed per request is ${Math.abs(gap)}% ${gap > 0 ? 'higher' : 'lower'} than the default policy`;
      return waste === null ? 'Speculation stayed off for the whole run, same as the default policy.'
        : `${head}, with ${(waste * 100).toFixed(1)}% of the drafted tokens rejected.`;
    },
    reportNote: 'The default keeps speculation off. Speedup compares a step\'s output per request with the same step without speculation, and accepted length is the tokens a request gets per step. Both are weighted by the batch of each step, so every request in the peak counts.',
    sourceLink: 'Source code', sourceSynthetic: 'Synthetic drafts · All results are simulated',
  },
};
