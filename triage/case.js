(function (root) {
  const duration = 60;
  const ranks = 4;
  const experts = 16;
  const topK = 2;
  const tokens = 4096;
  const seed = 20261126;
  const placement = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
  // hot: routing weight of hot experts at each step (the rest weigh 1).
  const phases = [
    { until: 14, hot: {} },
    { until: 38, hot: { 5: 6, 6: 6 } },
    { until: 60, hot: { 9: 16 } },
  ];

  function mulberry32(a) {
    return () => {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function pick(weights, total, random, skip) {
    let left = random() * total;
    for (let e = 0; e < experts; e++) {
      if (e === skip) continue;
      left -= weights[e];
      if (left < 0) return e;
    }
    return skip === experts - 1 ? experts - 2 : experts - 1;
  }

  function build() {
    const random = mulberry32(seed);
    const steps = [];
    phases.forEach((phase, index) => {
      const weights = new Array(experts).fill(1);
      for (const e of Object.keys(phase.hot)) weights[e] = phase.hot[e];
      const total = weights.reduce((a, b) => a + b, 0);
      while (steps.length < phase.until) {
        const counts = new Array(experts).fill(0);
        for (let t = 0; t < tokens; t++) {
          const first = pick(weights, total, random, -1);
          const second = pick(weights, total - weights[first], random, first);
          counts[first]++;
          counts[second]++;
        }
        steps.push({ tokens, phase: index, counts });
      }
    });
    return steps;
  }

  const case02 = { version: 1, source: 'synthetic', ranks, experts, topK, placement, steps: build() };

  const api = { duration, case02 };
  if (typeof module === 'object') module.exports = api;
  else root.ERCases = api;
})(globalThis);
