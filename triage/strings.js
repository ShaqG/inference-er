'use strict';

const strings = {
  zh: {
    titleLead: 'MoE ', titleAccent: '分诊台',
    pageTitle: 'MoE 分诊台 | Inference ER',
    case02: 'CASE 02 / 热门专家突袭',
    intro: '一批 token 涌向同几个专家，所在的 rank 拖慢了每一步。你有 60 秒重新安放专家。',
    nav01: 'CASE 01 · 调度', nav02: 'CASE 02 · 分诊台', nav03: 'CASE 03 · 代诊', nav04: 'CASE 04 · PD 分离',
    start: '▶ 开始分诊', reset: '↻ 重开同一局', remaining: '剩余时间',
    idle: '待命', idleNote: '待命 · 开始后可实时调整策略',
    resetNote: '待命 · 保留当前策略，可直接再试',
    running: '运行中', runningButton: '● 正在分诊',
    runningNote: '每秒一步 · 策略实时生效',
    finished: '已结束', finishedButton: '本轮已结束',
    finishedNote: '本轮结束 · 可以重开同一批 token',
    phases: ['平稳', '热门专家', '超级热门'],
    monitor: '专家并行监控',
    ms: '步延迟 ms', ratio: '倾斜倍数', idle: '空转率', moved: '权重搬运',
    chart: '最近 60 步的延迟，单位毫秒', chartTitle: '每步延迟',
    ranks: '各 rank 负载', rankNote: '竖线是平均负载，步延迟由最慢的 rank 决定',
    experts: '专家布局', current: '这一步的路由占比',
    bottleneck: '瓶颈', movedNote: (n, second) => `第 ${second} 步搬了 ${n} 个专家`,
    controls: '分诊台', live: '实时生效',
    redundant: '冗余专家',
    redundantHelp: '每个 rank 多放一个专家位，权重显存增加 25%。重平衡时会把最热的专家复制到其他 rank，它的 token 由各副本均分；关掉后下一步就撤掉副本。',
    rebalance: '专家重平衡', rebalanceButton: '⇄ 立即重平衡',
    rebalanceHelp: '按最近 4 步的负载重新安放专家。只有新布局能把最慢 rank 的负载降低 5% 以上时才会搬权重，每搬一个专家都让这一步变慢。',
    pending: '已预约：下一步重新安放专家',
    hintTitle: '值班提示',
    hint: '第 15 秒起两个专家变热，第 39 秒起只剩一个超级热门的专家。重平衡只看最近 4 步，刚变热时要等它进入统计。挪动位置能分开两个热门专家，单个专家过热则要靠冗余专家。',
    report: '本轮复盘', metric: '指标', thisRun: '本轮', baseline: '默认策略', change: '变化',
    reportMean: '平均步延迟', reportRatio: '倾斜倍数', reportIdle: '空转率',
    reportMoved: '权重搬运', reportMemory: '权重显存',
    reportSummary: (mean, base, idle, baseIdle, moved, memory) => {
      const gap = Math.round((mean / base - 1) * 100);
      const latency = gap === 0 ? '平均步延迟与默认策略持平' : `平均步延迟比默认策略${gap > 0 ? '高' : '低'} ${Math.abs(gap)}%`;
      const share = n => (n * 100).toFixed(1) + '%';
      const parts = [];
      if (moved) parts.push(`${Math.round(moved)} ms 的权重搬运`);
      if (memory) parts.push(`权重显存 +${Math.round(memory * 100)}%`);
      return `${latency}，空转率 ${share(baseIdle)} → ${share(idle)}，${parts.length ? '代价是 ' + parts.join('和') : '没有额外代价'}。`;
    },
    reportNote: '默认策略不做重平衡，也不用冗余专家。倾斜倍数是最慢 rank 的负载除以平均负载，每搬一个专家计 34 ms。',
    sourceLink: '源代码', sourceSynthetic: '合成路由 · 所有结果为模拟值',
  },
  en: {
    titleLead: 'MoE ', titleAccent: 'Triage',
    pageTitle: 'MoE Triage | Inference ER',
    case02: 'CASE 02 / HOT EXPERT SURGE',
    intro: 'A burst of tokens is heading for the same few experts, and their rank is slowing every step. You have 60 seconds to re-place the experts.',
    nav01: 'CASE 01 · SCHEDULING', nav02: 'CASE 02 · TRIAGE', nav03: 'CASE 03 · SECOND OPINION', nav04: 'CASE 04 · P/D SPLIT',
    start: '▶ Start triage', reset: '↻ Replay this case', remaining: 'Time remaining',
    idle: 'Standby', idleNote: 'Standby · Change policies live once you start',
    resetNote: 'Standby · Your current settings are ready to replay',
    running: 'Running', runningButton: '● In progress',
    runningNote: 'one step per second · Policy changes apply live',
    finished: 'Finished', finishedButton: 'Run complete',
    finishedNote: 'Run complete · Replay the same tokens to try another policy',
    phases: ['Steady', 'Hot pair', 'Dominant expert'],
    monitor: 'Expert parallelism',
    ms: 'Step latency ms', ratio: 'Imbalance', idle: 'Idle share', moved: 'Weight moves',
    chart: 'Latency of the last 60 steps in milliseconds', chartTitle: 'Latency per step',
    ranks: 'Load per rank', rankNote: 'The tick is the even share. The slowest rank sets the step latency',
    experts: 'Expert placement', current: 'Routing share in this step',
    bottleneck: 'Bottleneck', movedNote: (n, second) => `Moved ${n} experts at step ${second}`,
    controls: 'Triage desk', live: 'Applies live',
    redundant: 'Redundant experts',
    redundantHelp: 'Give every rank one extra expert slot for 25% more weight memory. The next rebalance copies the hottest experts to other ranks, and their tokens are split evenly across the copies. Turning it off drops the copies on the next step.',
    rebalance: 'Expert rebalance', rebalanceButton: '⇄ Rebalance now',
    rebalanceHelp: 'Re-place experts by their load over the last 4 steps. Weights only move when the new layout cuts the slowest rank\'s load by at least 5%, and every moved expert slows the step.',
    pending: 'Scheduled: experts move on the next step',
    hintTitle: 'On-call tip',
    hint: 'Two experts heat up at second 15, and one dominant expert takes over at second 39. Rebalancing only sees the last 4 steps, so let a new hot expert show up in the stats first. Moving experts apart separates a hot pair. A single dominant expert needs redundant experts.',
    report: 'Debrief', metric: 'Metric', thisRun: 'This run', baseline: 'Default', change: 'Change',
    reportMean: 'Mean step latency', reportRatio: 'Imbalance', reportIdle: 'Idle share',
    reportMoved: 'Weight moves', reportMemory: 'Weight memory',
    reportSummary: (mean, base, idle, baseIdle, moved, memory) => {
      const gap = Math.round((mean / base - 1) * 100);
      const latency = gap === 0 ? 'Mean step latency matches the default policy' : `Mean step latency is ${Math.abs(gap)}% ${gap > 0 ? 'higher' : 'lower'} than the default policy`;
      const share = n => (n * 100).toFixed(1) + '%';
      const parts = [];
      if (moved) parts.push(`${Math.round(moved)} ms of weight moves`);
      if (memory) parts.push(`${Math.round(memory * 100)}% more weight memory`);
      return `${latency}, with the idle share going from ${share(baseIdle)} to ${share(idle)} ${parts.length ? 'at a cost of ' + parts.join(' and ') : 'at no extra cost'}.`;
    },
    reportNote: 'The default never rebalances and uses no redundant experts. Imbalance is the slowest rank\'s load divided by the even share. Each moved expert costs 34 ms.',
    sourceLink: 'Source code', sourceSynthetic: 'Synthetic routing · All results are simulated',
  },
};
