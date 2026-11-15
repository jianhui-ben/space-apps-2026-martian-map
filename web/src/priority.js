// Priority list in four reasoned steps. No weights and no score: sites are only
// grouped, layered and compared. Pure and deterministic whatever the input order.

import { STATUS } from './status.js';

// Vector order; every component is "lower is better". BT-15 enters negated.
const INDICATORS = [
  { id: 'BT-06', better: 'less grading', worse: 'more grading' },
  { id: 'BT-21', better: 'shorter cable', worse: 'longer cable' },
  { id: 'SC-01', better: 'less shading', worse: 'more shading' },
  { id: 'BT-15', better: 'more dune setback', worse: 'less dune setback', negate: true },
];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

// A Result's limit, and which side of it a failing value lies on: above a "≤" target, below a "≥" one. The baseline's
// own operator says; a baseline with none (e.g. "100%", a share that must be reached) is read from the value against
// the limit. above is null when neither tells. The verdict here and the card's conflict line (ui/card.js) both use it.
const cleanTarget = (t) => String(t || '').replace(/^\s*(D\/P|P|D):\s*/, '').replace(/`/g, '').trim();
export function failSide(r) {
  const base = cleanTarget(r.target && r.target.baseline);
  const m = /^([≤≥<>]=?)?\s*(.*)$/.exec(base);
  const limit = m[2].split(/[;,]| for /)[0].trim();
  let above = null;
  if (m[1]) above = m[1][0] === '≤' || m[1][0] === '<';
  else if (Number.isFinite(r.value) && Number.isFinite(parseFloat(limit))) above = r.value > parseFloat(limit);
  return { base, limit, above };
}

function failureText(r) {
  const { base, limit, above } = failSide(r);
  if (above === null || !limit) return r.id + ': ' + r.display + ' fails ' + (base || 'its target');
  return r.id + ': ' + r.display + (above ? ' > ' : ' < ') + limit;
}

function describe(site) {
  const failed = [];
  const unknown = new Set();
  for (const r of site.results.values()) {
    if (r.status === STATUS.NOT_MET) failed.push(r);
    if (r.status !== STATUS.NOT_APPLICABLE && r.status === STATUS.NEEDS_FIELDWORK) unknown.add(r.id);
    if (r.straddles) unknown.add(r.id);
  }
  failed.sort((a, b) => cmp(a.id, b.id));
  return { id: site.id, results: site.results, failed, unknown: [...unknown].sort() };
}

// Vector entry for one indicator: a number, or NaN when unusable.
function component(ind, results) {
  const r = results.get(ind.id);
  if (ind.id === 'SC-01' && r && r.status === STATUS.NOT_APPLICABLE) return 0;
  if (!r || r.value === null || r.value === undefined || !Number.isFinite(r.value)) return NaN;
  return ind.negate ? -r.value : r.value;
}

function dominates(a, b, kept) {
  let strict = false;
  for (const i of kept) {
    const x = a.vec[i], y = b.vec[i];
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x > y) return false;
    if (x < y) strict = true;
  }
  return strict;
}

// Non-dominated layers, best first. Each layer's members are sorted by id.
function layers(group) {
  const kept = [];
  INDICATORS.forEach((ind, i) => { // R4: drop an indicator no site has a usable value for (a null Result counts as none)
    if (group.some((s) => Number.isFinite(component(ind, s.results)))) kept.push(i);
  });
  const items = group.map((s) => ({ s, vec: INDICATORS.map((ind) => component(ind, s.results)) }));
  let rest = items;
  const out = [];
  while (rest.length) {
    const top = rest.filter((x) => !rest.some((y) => y !== x && dominates(y, x, kept)));
    out.push(top.map((x) => x.s).sort((a, b) => cmp(a.id, b.id)));
    rest = rest.filter((x) => !top.includes(x));
  }
  return { layers: out, kept, vecs: new Map(items.map((x) => [x.s.id, x.vec])) };
}

function tradeoff(a, b, vecs, kept) {
  const va = vecs.get(a.id), vb = vecs.get(b.id);
  let better = null, worse = null;
  for (const i of kept) {
    if (Number.isNaN(va[i]) || Number.isNaN(vb[i]) || va[i] === vb[i]) continue;
    if (va[i] < vb[i] && better === null) better = i;
    if (va[i] > vb[i] && worse === null) worse = i;
  }
  if (better === null || worse === null) return null;
  return better < worse
    ? INDICATORS[better].better + ', ' + INDICATORS[worse].worse
    : INDICATORS[worse].worse + ', ' + INDICATORS[better].better;
}

export function prioritize(sites, metrics) { // eslint-disable-line no-unused-vars
  const all = sites.map(describe).sort((a, b) => cmp(a.id, b.id));
  const only = all.length === 1;
  const clean = all.filter((s) => s.failed.length === 0);
  const failed = all.filter((s) => s.failed.length > 0);

  const counts = [...new Set(clean.map((s) => s.unknown.length))].sort((a, b) => a - b);
  const rows = [];
  let priority = 0;

  counts.forEach((count, gi) => {
    const group = clean.filter((s) => s.unknown.length === count);
    const lay = layers(group);
    const lower = counts[gi - 1], higher = counts[gi + 1];
    const neighbour = (c) => {
      const s = clean.find((x) => x.unknown.length === c);
      return s.id + ' (' + c + ')';
    };
    lay.layers.forEach((members, li) => {
      priority += 1;
      for (const s of members) {
        const equalWith = members.filter((m) => m !== s).map((m) => m.id);
        let tr = null;
        for (const id of equalWith) {
          tr = tradeoff(s, members.find((m) => m.id === id), lay.vecs, lay.kept);
          if (tr) break;
        }
        const n = plural(s.unknown.length, 'critical unknown');
        let step, why;
        if (equalWith.length) {
          step = 4;
          why = 'No failures; ' + n + '; same priority as ' + equalWith.join(', ') +
            (tr ? ' (trade-off: ' + tr + ').' : ' (not comparable on the indicators they share).');
        } else if (lay.layers.length > 1) {
          step = 3;
          why = li === 0
            ? 'No failures; ' + n + '; no site with the same count is better on every indicator.'
            : 'No failures; ' + n + '; a site with the same count is at least as good on every indicator.';
        } else {
          step = 2;
          why = 'No failures; ' + n +
            (higher !== undefined ? ', fewer than ' + neighbour(higher)
              : lower !== undefined ? ', more than ' + neighbour(lower) : '') + '.';
        }
        if (only) why = 'Only candidate; no failures; ' + n + '.';
        rows.push({
          siteId: s.id, priority, step, whyHere: why, failures: [], criticalUnknowns: s.unknown, equalWith,
          tradeoff: tr,
          verdict: 'no requirement fails; ' + n,
        });
      }
    });
  });

  if (failed.length) {
    priority += 1;
    for (const s of failed) {
      const texts = s.failed.map(failureText);
      rows.push({
        siteId: s.id, priority, step: 1,
        whyHere: (only ? 'Only candidate; fails ' : 'Fails ') + texts.join(', ') + '.',
        failures: s.failed.map((r) => r.id), criticalUnknowns: s.unknown,
        equalWith: failed.filter((m) => m !== s).map((m) => m.id), tradeoff: null,
        verdict: 'not recommended under the stated requirements (' + texts.join(', ') + ')',
      });
    }
  }
  return rows.sort((a, b) => a.priority - b.priority || cmp(a.siteId, b.siteId));
}
