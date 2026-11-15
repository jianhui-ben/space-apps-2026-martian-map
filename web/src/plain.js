// Plain words first (Task 9c): the five factors' names, a failure phrase per computed metric, and the sentences the
// site card, the candidate cards and the pin rows read before any detail. Metric ids and the technical verdicts stay
// in the Details. Pure: Results in, strings out.
import { STATUS, factorIcon } from './status.js';

export const FACTORS = [
  { id: 'BT', name: 'Terrain', doc: 'Buildable terrain' },
  { id: 'GI', name: 'Ground & ice', doc: 'Ground and ice evidence' },
  { id: 'SC', name: 'Solar', doc: 'Solar conditions' },
  { id: 'TC', name: 'Thermal', doc: 'Thermal conditions' },
  { id: 'IR', name: 'Routes', doc: 'Investigation routes' },
];

// The failure phrase of each computed metric. They are read in this order: the ground conditions first, then the
// fits they cause, then the cable, so a steep spot leads with "too steep" rather than "doesn't fit". Task 12 adds
// SC-01, SC-03, SC-04, TC-01, BT-15, BT-16 and GI-05; a metric with no phrase reads as its lowercased name.
export const PLAIN = {
  'BT-05': 'too steep in places under the compound',
  'BT-04': 'the building pad is too tilted',
  'BT-08': 'too rough under the layout',
  'BT-06': 'too much grading needed',
  'BT-02': "the layout doesn't fit on usable ground",
  'SC-10': "the solar plot doesn't fit on usable ground",
  'TC-08': "the radiator plot doesn't fit on usable ground",
  'BT-01': 'not enough connected flat ground',
  'BT-21': 'the cable route to the base is too long',
};

export const shortName = (name) => String(name).split(' (')[0];

const ORDER = Object.keys(PLAIN);
const rank = (id) => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i; };
const byReading = (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
const metricOf = (id, metrics) => (metrics || []).find((m) => m.id === id) || null;
const factorOf = (id, metrics) => { const m = metricOf(id, metrics); return m ? m.factor : String(id).slice(0, 2); };
const nameOf = (id, metrics) => { const m = metricOf(id, metrics); return m ? m.name.toLowerCase() : id; };
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
// "a", "a and b", "a, b and c"
const listOf = (items) => (items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]);

export const phraseFor = (id, metrics) => PLAIN[id] || nameOf(id, metrics);

// A critical unknown, as prioritize() counts them: an unresolved metric that could still turn into a failure here.
const isFieldCheck = (r) => r.status !== STATUS.NOT_APPLICABLE && (r.status === STATUS.NEEDS_FIELDWORK || !!r.straddles);

// Metric ids in a message (a load error, a row warning) put into words: "BT-08 at s1" -> "detrended roughness at s1".
export const plainIds = (text, metrics) => String(text).replace(/\b(BT|GI|SC|TC|IR)-\d\d\b/g, (id) => nameOf(id, metrics));

// The site's verdict in plain words, from its priority row (or, before the region is ranked, its own Results).
export function plainVerdict(row, results, metrics = []) {
  const all = [...((results && results.values()) || [])];
  const failures = row ? row.failures : all.filter((r) => r.status === STATUS.NOT_MET).map((r) => r.id);
  if (failures.length) {
    const ids = [...failures].sort(byReading);
    return 'Not recommended: ' + ids.slice(0, 2).map((id) => phraseFor(id, metrics)).join(' and ')
      + (ids.length > 2 ? ', and ' + (ids.length - 2) + ' more' : '');
  }
  const unknowns = row ? row.criticalUnknowns : all.filter(isFieldCheck).map((r) => r.id);
  const n = new Set(unknowns.map((id) => factorOf(id, metrics))).size;
  if (!n) return 'No failures found from orbit';
  return 'No failures; ' + plural(n, 'factor still needs', 'factors still need') + ' field checks';
}

// One factor's row on the card: {icon, text}. ✗ when any of its metrics fails (a field result too); otherwise the
// factor icon of the metrics orbital data can settle (status.js), except that a factor whose only open items are field
// checks reads ? and "not settled from orbit", never "not applicable": missing evidence never reads as fine.
export function factorSentence(factorId, results, metrics) {
  const mine = [...((results && results.values()) || [])].filter((r) => factorOf(r.id, metrics) === factorId);
  const failed = mine.filter((r) => r.status === STATUS.NOT_MET).map((r) => r.id).sort(byReading);
  if (failed.length) return { icon: '✗', text: listOf(failed.map((id) => phraseFor(id, metrics))) };
  const icon = factorIcon(results || new Map(), metrics, factorId);
  if (icon === '✓') return { icon, text: 'meets the screening criteria' };
  const checks = mine.filter(isFieldCheck).map((r) => r.id).sort();
  if (checks.length) {
    return { icon: '?', text: 'not settled from orbit: ' + plural(checks.length, 'field check', 'field checks') + ', starting with ' + nameOf(checks[0], metrics) };
  }
  if (icon === '?') return { icon, text: 'not settled from orbit: estimates still need data' };
  return { icon: '—', text: 'not applicable here' };
}

// Step 3's indicators in plain words (priority.js INDICATORS); BT-15 counts the other way.
const INDICATOR_WORDS = [
  { id: 'BT-06', better: 'less grading', worse: 'more grading' },
  { id: 'BT-21', better: 'a shorter cable', worse: 'a longer cable' },
  { id: 'SC-01', better: 'less shading', worse: 'more shading' },
  { id: 'BT-15', better: 'more dune setback', worse: 'less dune setback', negate: true },
];

// "Why this priority" in plain words: which of the four steps placed the row, and against which peer.
// rows: the region's priority rows; results: siteId -> Results; names: siteId -> site name.
export function plainWhy(row, { rows = [], results = new Map(), names = new Map() } = {}) {
  if (!row) return 'The priority appears once every site in the region has been checked.';
  const nm = (id) => shortName(names.get(id) || id);
  const sorted = [...rows].sort((a, b) => (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0));
  const clean = sorted.filter((r) => !r.failures.length);
  const count = (r) => r.criticalUnknowns.length;
  if (rows.length <= 1) return 'It is the only candidate in this region' + (row.failures.length ? ', and it fails a requirement.' : '.');
  if (row.failures.length) {
    return clean.length ? "It fails a requirement, so it ranks below every site that doesn't." : 'It fails a requirement, like every site here.';
  }
  if (row.step === 4) {
    return 'No rule separates it from ' + listOf(row.equalWith.map(nm)) + (row.tradeoff ? '; the trade-off: ' + row.tradeoff : '') + '.';
  }
  if (row.step === 3) {
    const vec = (r) => INDICATOR_WORDS.map((w) => {
      const x = results.get(r.siteId) && results.get(r.siteId).get(w.id);
      const v = x && Number.isFinite(x.value) ? x.value : NaN;
      return w.negate ? -v : v;
    });
    // the indicators on which a beats b (lower is better), or null when b is better on any of them
    const wins = (a, b) => {
      const va = vec(a), vb = vec(b), out = [];
      for (let i = 0; i < va.length; i++) {
        if (!Number.isFinite(va[i]) || !Number.isFinite(vb[i])) continue;
        if (va[i] > vb[i]) return null;
        if (va[i] < vb[i]) out.push(i);
      }
      return out.length ? out : null;
    };
    const same = clean.filter((r) => r.siteId !== row.siteId && count(r) === count(row));
    for (const peer of same.filter((r) => r.priority > row.priority).sort((a, b) => a.priority - b.priority)) {
      const w = wins(row, peer);
      if (w) return capital(listOf(w.map((i) => INDICATOR_WORDS[i].better))) + ' than ' + nm(peer.siteId) + '.';
    }
    for (const peer of same.filter((r) => r.priority < row.priority).sort((a, b) => b.priority - a.priority)) {
      const w = wins(peer, row);
      if (w) return capital(listOf(w.map((i) => INDICATOR_WORDS[i].worse))) + ' than ' + nm(peer.siteId) + '.';
    }
    return 'Placed on grading, cable length, shading and dune setback against the sites with as many unresolved checks.';
  }
  const c = count(row);
  const counts = [...new Set(clean.map(count))].sort((a, b) => a - b);
  const higher = counts.find((x) => x > c), lower = counts.filter((x) => x < c).pop();
  const first = (n) => clean.find((r) => count(r) === n);
  if (higher !== undefined) return 'Fewer unresolved checks than ' + nm(first(higher).siteId) + ' (' + c + ' against ' + higher + ').';
  if (lower !== undefined) return 'More unresolved checks than ' + nm(first(lower).siteId) + ' (' + c + ' against ' + lower + ').';
  const failing = sorted.find((r) => r.failures.length);
  return failing ? 'No failures, while ' + nm(failing.siteId) + ' fails a requirement.' : 'No failures.';
}
