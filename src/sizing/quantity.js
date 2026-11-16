// Quantity propagation and provenance; unknown never means zero. Port of sizing/contracts.py.
const uniqueSorted = (items) => [...new Set(items)].sort();

export function known(value, unit, refs, conditional = true) {
  if (!Number.isFinite(value)) throw new Error('non-finite derived quantity');
  return { status: 'resolved', value, unit, provenance_ids: uniqueSorted(refs), conditional };
}

export function unknown(unit, missing, refs = []) {
  return { status: 'unresolved', unit, missing_inputs: uniqueSorted(missing), provenance_ids: uniqueSorted(refs) };
}

export function calc(unit, inputs, fn) {
  const refs = inputs.flatMap((x) => x.provenance_ids || []);
  const missing = inputs.filter((x) => x.status === 'unresolved').flatMap((x) => x.missing_inputs);
  if (missing.length) return unknown(unit, missing, refs);
  return known(fn(...inputs.map((x) => x.value)), unit, refs, inputs.some((x) => x.conditional === true));
}

export function createContext(request, bundle, endpoint) {
  const issues = [];
  return {
    request, bundle, endpoint, issues,
    param(key) {
      const ref = 'model:' + key;
      const p = Object.hasOwn(bundle.parameters, key) ? bundle.parameters[key] : null;
      if (p === null) return unknown('unknown', [ref]);
      return known(p.value, p.unit, [ref], p.status === 'engineering_assumption' || p.status === 'synthetic_demo');
    },
    answer(q, path) {
      const ref = 'input:' + path;
      if (q.state === 'unknown') return unknown('unknown', [ref], [ref]);
      const value = q.state === 'specified' ? q.value : q[endpoint];
      return known(value, q.unit, [ref], false);
    },
    issue(code, message) { issues.push({ code, message }); },
  };
}
