// Evidence chips, in the diorama prototype's colours: one per evidence label, an assumption chip wherever a
// target comes from the scenario, and a caveat chip on values from a dataset whose alignment check is flagged.

export const EVIDENCE = ['observation', 'derived', 'model', 'interpretation', 'assumption', 'reference'];

export const EVIDENCE_MEANING = {
  observation: 'measured directly (from orbit or on the ground)',
  derived: 'computed from observations',
  model: 'from a physical or climate model',
  interpretation: 'a scientist\'s reading of the data',
  assumption: 'a scenario number, not data',
  reference: 'a requirement or published figure',
};

const fmt = (v, d) => (Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d).toFixed(d) : null);

// The caveat for a catalog dataset entry, or null. The catalog keeps alignment checks either flat ({flag, note}) or
// one per comparison ({dem_vs_rover: {flag, note, median_offset_m, n}, ...}); any check with flag === true counts.
export function alignmentCaveat(entry) {
  const a = entry && entry.alignment;
  if (!a || typeof a !== 'object') return null;
  const checks = 'flag' in a ? [a] : Object.values(a).filter((x) => x && typeof x === 'object');
  const hit = checks.find((c) => c.flag === true);
  if (!hit) return null;
  const parts = [hit.note || 'alignment check flagged'];
  const off = fmt(hit.median_offset_m, 1);
  if (off !== null) parts.push('median offset ' + off + ' m');
  if (Number.isFinite(hit.p90_abs_dev_m)) parts.push('90% within ' + fmt(hit.p90_abs_dev_m, 1) + ' m');
  if (Number.isFinite(hit.n)) parts.push('n = ' + hit.n);
  return { kind: 'caveat', text: 'caveat', title: parts.length > 1 ? parts[0] + ': ' + parts.slice(1).join(', ') : parts[0] };
}

// Chip specs for one Result: its evidence label, an assumption chip when its target comes from the scenario (unless
// the evidence label already says so), and the caveat when given.
export function resultChips(result, { caveat = null } = {}) {
  const ev = EVIDENCE.includes(result.evidence) ? result.evidence : 'reference';
  const out = [{ kind: ev, text: ev, title: EVIDENCE_MEANING[ev] }];
  if (result.assumption && ev !== 'assumption') {
    out.push({ kind: 'assumption', text: 'assumption', title: 'the target or a limit used here is a scenario assumption' });
  }
  if (caveat) out.push(caveat);
  return out;
}

export function chipEl({ kind, text, title }) {
  const s = document.createElement('span');
  s.className = 'ev ev-' + kind;
  s.textContent = text || kind;
  if (title) s.title = title;
  return s;
}

export const assumptionChip = (title = 'a scenario number, not data') => chipEl({ kind: 'assumption', text: 'assumption', title });
