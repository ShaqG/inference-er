(function (root) {
  const duration = 60;
  // The longest draft a policy can ask for.
  const slots = 8;
  const seed = 20261337;
  // batch: requests decoding together. accept: chance that a drafted token matches the target.
  // Only the peak changes the batch, so chat and peak differ in nothing but their size.
  const phases = [
    { until: 15, batch: 16, accept: 0.75 },
    { until: 35, batch: 16, accept: 0.92 },
    { until: 47, batch: 256, accept: 0.75 },
    { until: 60, batch: 16, accept: 0.45 },
  ];

  function mulberry32(a) {
    return () => {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // For every step, request and draft slot: does the drafted token match the target?
  function build() {
    const random = mulberry32(seed);
    const steps = [];
    phases.forEach((phase, index) => {
      while (steps.length < phase.until) {
        const accept = new Uint8Array(phase.batch * slots);
        for (let i = 0; i < accept.length; i++) accept[i] = random() < phase.accept ? 1 : 0;
        steps.push({ batch: phase.batch, phase: index, accept });
      }
    });
    return steps;
  }

  const case03 = {
    version: 1, source: 'synthetic', slots,
    phases: phases.map(({ until, batch, accept }) => ({ until, batch, accept })),
    steps: build(),
  };

  const api = { duration, case03 };
  if (typeof module === 'object') module.exports = api;
  else root.ERCases = api;
})(globalThis);
