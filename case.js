(function (root) {
  const duration = 60;
  const longArrivals = new Set([8, 9, 10, 11, 13, 16, 23, 27, 36, 37, 40, 48]);
  const requests = [];
  for (let at = 1; at <= duration; at++) {
    if (at % 2 === 1 || (at >= 17 && at <= 28)) {
      requests.push({ at, kind: 'short', prefillWork: 4, outputTokens: 5, timeout: 9 });
    }
    if (longArrivals.has(at)) {
      requests.push({ at, kind: 'long', prefillWork: 34, outputTokens: 25, timeout: 23 });
    }
  }

  const case01 = { version: 1, source: 'synthetic', requests };

  function inRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  function validate(raw) {
    if (!raw || raw.version !== 1 || !['synthetic', 'trace-derived'].includes(raw.source)) {
      throw new Error('caseHeader');
    }
    if (!Array.isArray(raw.requests) || !inRange(raw.requests.length, 1, 600)) {
      throw new Error('caseRequests');
    }
    let previous = 1;
    const requests = raw.requests.map((row, index) => {
      if (!row || !inRange(row.at, previous, duration) || !['short', 'long'].includes(row.kind)
        || !inRange(row.prefillWork, 1, 10000) || !inRange(row.outputTokens, 1, 10000)
        || !inRange(row.timeout, 1, duration)) {
        throw new Error('caseRow:' + (index + 1));
      }
      const { at, kind, prefillWork, outputTokens, timeout } = row;
      previous = at;
      return { at, kind, prefillWork, outputTokens, timeout };
    });
    return { version: 1, source: raw.source, requests };
  }

  const api = { duration, case01, validate };
  if (typeof module === 'object') module.exports = api;
  else root.ERCases = api;
})(globalThis);
