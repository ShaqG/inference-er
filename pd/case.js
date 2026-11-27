(function (root) {
  const duration = 60;
  const gpus = 8;
  const seed = 20261127;
  // rate: requests per second on average. prompt and output: token ranges, drawn uniformly.
  const phases = [
    { until: 12, rate: 2, prompt: [4000, 6000], output: [150, 250] },
    { until: 30, rate: 110, prompt: [400, 600], output: [30, 50] },
    { until: 45, rate: 11.5, prompt: [4000, 6000], output: [100, 140] },
    { until: 60, rate: 27, prompt: [800, 1200], output: [700, 900] },
  ];

  function mulberry32(a) {
    return () => {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function build() {
    const random = mulberry32(seed);
    const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
    // Poisson draws by multiplication, with a fallback to the large-rate method.
    const poisson = mean => {
      if (mean < 30) {
        const limit = Math.exp(-mean);
        let product = 1;
        let n = 0;
        do { product *= random(); n++; } while (product > limit);
        return n - 1;
      }
      return Math.max(0, Math.round(mean + Math.sqrt(mean) * (random() + random() + random() - 1.5) * 2));
    };
    const steps = [];
    phases.forEach((phase, index) => {
      while (steps.length < phase.until) {
        const arrivals = [];
        const count = poisson(phase.rate);
        for (let i = 0; i < count; i++) {
          arrivals.push({ l: between(...phase.prompt), o: between(...phase.output) });
        }
        steps.push({ phase: index, arrivals });
      }
    });
    return steps;
  }

  const case04 = {
    version: 1, source: 'synthetic', gpus,
    phases: phases.map(({ until, rate, prompt, output }) => ({ until, rate, prompt, output })),
    steps: build(),
  };

  const api = { duration, case04 };
  if (typeof module === 'object') module.exports = api;
  else root.ERCases = api;
})(globalThis);
