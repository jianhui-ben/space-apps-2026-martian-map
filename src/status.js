// How every metric's status is decided. Missing data or a failed file never reads as fine.

export const STATUS = Object.freeze({
  MET: 'met',
  NOT_MET: 'not_met',
  NEEDS_FIELDWORK: 'needs_fieldwork',
  NEEDS_DESIGN_INPUT: 'needs_design_input',
  NEEDS_CONFIRMATION: 'needs_confirmation',
  NOT_APPLICABLE: 'not_applicable',
});

const NO_SOLAR = 'no solar plot in this power option';

// Decide a status for one numeric value against its baseline (and optional ideal).
export function statusFor({ value, baseline, ideal, compare, uncertainty = 0, availability }) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) {
    return { status: STATUS.NEEDS_CONFIRMATION, ideal: false, straddles: false };
  }
  const passes = (limit) => (compare === '<=' ? value <= limit : value >= limit);
  if (Math.abs(value - baseline) < uncertainty) {
    return { status: STATUS.NEEDS_FIELDWORK, ideal: false, straddles: true };
  }
  const pass = passes(baseline);
  if (availability === 'partial') {
    return { status: pass ? STATUS.NEEDS_FIELDWORK : STATUS.NOT_MET, ideal: false, straddles: false };
  }
  if (!pass) return { status: STATUS.NOT_MET, ideal: false, straddles: false };
  return { status: STATUS.MET, ideal: Number.isFinite(ideal) && passes(ideal), straddles: false };
}

function blank(m, status, note) {
  return {
    id: m.id, value: null, unit: m.unit || '', display: '—',
    target: { baseline: m.baseline, ideal: m.ideal, label: m.pd },
    status, ideal: false, evidence: 'reference', note: note || '', assumption: false, straddles: false,
    appliesTo: m.appliesTo,
  };
}

export function initialStatuses(metrics, setup) {
  const out = new Map();
  for (const m of metrics) {
    if (m.factor === 'SC' && setup && setup.power === 'base_only') {
      out.set(m.id, blank(m, STATUS.NOT_APPLICABLE, NO_SOLAR));
    } else if (m.availability === 'estimate_today') {
      out.set(m.id, blank(m, STATUS.NEEDS_CONFIRMATION, 'not yet computed'));
    } else if (m.availability === 'planning') {
      out.set(m.id, blank(m, STATUS.NEEDS_DESIGN_INPUT, ''));
    } else {
      out.set(m.id, blank(m, STATUS.NEEDS_FIELDWORK, ''));
    }
  }
  return out;
}

export function displayWords(r) {
  switch (r.status) {
    case STATUS.MET: return r.ideal ? 'meets ideal' : 'meets baseline';
    case STATUS.NOT_MET: return 'fails current target';
    case STATUS.NEEDS_FIELDWORK: return 'unresolved (needs fieldwork)';
    case STATUS.NEEDS_DESIGN_INPUT: return 'unresolved (needs design input)';
    case STATUS.NEEDS_CONFIRMATION: return 'unresolved (needs data)';
    case STATUS.NOT_APPLICABLE: return r.note ? 'not applicable (' + r.note + ')' : 'not applicable';
    default: return 'unresolved (needs data)';
  }
}

export function factorIcon(results, metrics, factor) {
  let n = 0, bad = false, unresolved = false;
  for (const m of metrics) {
    if (m.factor !== factor || m.availability !== 'estimate_today') continue;
    const r = results.get(m.id);
    if (r && (r.status === STATUS.NOT_APPLICABLE || r.status === STATUS.NEEDS_DESIGN_INPUT)) continue;
    n += 1;
    if (!r) unresolved = true;
    else if (r.status === STATUS.NOT_MET) bad = true;
    else if (r.status !== STATUS.MET) unresolved = true;
  }
  if (n === 0) return '—';
  if (bad) return '✗';
  return unresolved ? '?' : '✓';
}

// Counts shown beside the icon: applicable fieldwork and design items of a factor, any availability.
export function fieldCounts(results, metrics, factor) {
  const out = { fieldwork: 0, design: 0 };
  for (const m of metrics) {
    if (m.factor !== factor) continue;
    const r = results.get(m.id);
    if (!r) continue;
    if (r.status === STATUS.NEEDS_FIELDWORK) out.fieldwork += 1;
    else if (r.status === STATUS.NEEDS_DESIGN_INPUT) out.design += 1;
  }
  return out;
}

// Precedence: field records, then computed values, then initial statuses.
export function mergeResults(initial, computed, fieldRecords) {
  const out = new Map(initial);
  if (computed) for (const [id, r] of computed) out.set(id, r);
  for (const rec of fieldRecords || []) {
    if (rec.kind && rec.kind !== 'field') continue; // simulated tags never change a status
    if (rec.pass !== true && rec.pass !== false) continue;
    const base = out.get(rec.metricId);
    if (!base || base.status === STATUS.NOT_APPLICABLE) continue; // a field record can't make a metric apply
    out.set(rec.metricId, {
      ...base,
      value: Number.isFinite(rec.value) ? rec.value : base.value,
      display: Number.isFinite(rec.value) ? String(rec.value) + (base.unit ? ' ' + base.unit : '') : base.display,
      status: rec.pass ? STATUS.MET : STATUS.NOT_MET,
      ideal: false, straddles: false, assumption: false, evidence: 'observation', note: 'field result',
    });
  }
  return out;
}
