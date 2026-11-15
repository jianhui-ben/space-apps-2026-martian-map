// Plain words first (Task 9c): the five factors' names, a failure phrase per computed metric, and the sentences the
// site card, the candidate cards and the pin rows read before any detail. Metric ids and the technical verdicts stay
// in the Details. Pure: Results in, strings out.
import { STATUS } from './status.js';

export const FACTORS = [
  { id: 'BT', name: 'Terrain', doc: 'Buildable terrain' },
  { id: 'GI', name: 'Ground & ice', doc: 'Ground and ice evidence' },
  { id: 'SC', name: 'Solar', doc: 'Solar conditions' },
  { id: 'TC', name: 'Thermal', doc: 'Thermal conditions' },
  { id: 'IR', name: 'Routes', doc: 'Investigation routes' },
];

// The failure phrase of each computed metric. They are read in this order: the ground conditions first, then the
// fits they cause, then the cable, so a steep spot leads with "too steep" rather than "doesn't fit"; then Task 12's
// environment metrics. A metric with no phrase reads as its lowercased name.
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
  // Task 12: the environment metrics, read after the terrain ones
  'BT-15': 'too close to a dune field',
  'BT-16': 'in the path of moving sand',
  'GI-05': 'possible ground ice under the compound',
  'SC-01': 'the skyline blocks too much sun',
  'SC-03': 'not enough solar energy on average',
  'SC-04': 'not enough solar energy in the worst season',
  'TC-01': 'temperature cases not covered',
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
// Missing data (no value yet, or a file that failed): unresolved too. prioritize() leaves it out of its count, but the
// copy must never let it read as fine.
const needsData = (r) => r.status === STATUS.NEEDS_CONFIRMATION;

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
  const field = new Set(unknowns.map((id) => factorOf(id, metrics)));
  const data = new Set(all.filter(needsData).map((r) => factorOf(r.id, metrics)));
  const n = new Set([...field, ...data]).size;
  if (!n) return 'No failures found from orbit';
  // worded so it never contradicts a factor's ✓ (R37): a ✓ is from orbit, and its field checks can still be open
  const what = !data.size ? 'field checks open' : !field.size ? 'data missing' : 'data missing or field checks open';
  return 'No failures from orbit; ' + what + ' in ' + plural(n, 'factor', 'factors');
}

// The estimates behind a factor's icon (R33, decided by availability per R36): the factor's estimate_today metrics,
// unless not applicable or waiting on design input. A placeholder no check has filled yet (initialStatuses' blank,
// evidence "reference") is an uncomputed estimate: it keeps the icon at "?", never ✓. A field check (needs fieldwork
// without a straddle) never makes the icon "?": it is counted in the sentence instead.
const isPlaceholder = (r) => !r || r.evidence === 'reference';
const estimatesOf = (factorId, results, metrics) => metrics
  .filter((m) => m.factor === factorId && m.availability === 'estimate_today')
  .map((m) => ({ id: m.id, r: results && results.get(m.id) }))
  .filter(({ r }) => !r || (r.status !== STATUS.NOT_APPLICABLE && r.status !== STATUS.NEEDS_DESIGN_INPUT));
// Results exist once any check has filled one in (terrain, environment or a field record); before that, or when the
// region failed to load, a factor reads "?" rather than simulated.
const hasResults = (results) => [...((results && results.values()) || [])].some((r) => !isPlaceholder(r));

// A deterministic simulated estimate for a factor with no orbital estimate at a site, seeded by site id + factor, for
// the demo only: it never changes a Result, the priority or the verdict, and always says it is simulated.
const SIM_TEXT = {
  '✓': { BT: 'the ground looks buildable', GI: 'firm ground and no ice expected near the surface', SC: 'good sun', TC: 'temperatures in range', IR: 'a passable route to the base' },
  '?': { BT: 'the ground needs a closer look', GI: 'ground strength and ice still unknown', SC: 'sunlight still unknown', TC: 'temperatures still unknown', IR: 'the route needs a closer look' },
  '✗': { BT: 'the ground looks difficult', GI: 'weak ground or shallow ice possible', SC: 'too much shade', TC: 'temperatures out of range', IR: 'a route crosses steep or loose ground' },
};
export function seededUnit(key) { // FNV-1a, 0 <= x < 1
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
export function simulatedEstimate(siteId, factorId) {
  const u = seededUnit(String(siteId) + ':' + factorId);
  const icon = u < 0.5 ? '✓' : u < 0.8 ? '?' : '✗';
  return { icon, text: 'Simulated for the demo: ' + SIM_TEXT[icon][factorId], simulated: true };
}

// One factor's row on the card: {icon, text, simulated?}. ✗ when any of its metrics fails (a field result too);
// otherwise from its orbital estimates (R36): ✓ only when every one is computed and met; ? when one is unresolved (not
// computed yet, no data, or straddling its target). With no computed orbital estimate at all, a simulated one once the
// site's results exist (siteId given), or ? before then. The field checks still to do and the other items still
// needing data are counted, so the sentence never reads as fine while something is missing.
export function factorSentence(factorId, results, metrics, { siteId = null } = {}) {
  const mine = [...((results && results.values()) || [])].filter((r) => factorOf(r.id, metrics) === factorId);
  const failed = mine.filter((r) => r.status === STATUS.NOT_MET).map((r) => r.id).sort(byReading);
  if (failed.length) return { icon: '✗', text: listOf(failed.map((id) => phraseFor(id, metrics))) };
  const checks = mine.filter(isFieldCheck).map((r) => r.id).sort();
  const todo = (named) => {
    const missing = mine.filter((r) => needsData(r) && r.id !== named).length;
    return (checks.length ? ' · ' + plural(checks.length, 'field check', 'field checks') + ' to confirm' : '')
      + (missing ? ' · ' + missing + ' still ' + (missing === 1 ? 'needs' : 'need') + ' data' : '');
  };
  const est = estimatesOf(factorId, results, metrics);
  const done = est.filter(({ r }) => !isPlaceholder(r));
  if (done.length) {
    // the computed open ones first (more telling), then the ones not computed yet, each in reading order
    const open = [...done.filter(({ r }) => r.status !== STATUS.MET), ...est.filter(({ r }) => isPlaceholder(r))];
    if (!open.length) return { icon: '✓', text: 'meets the screening criteria from orbit' + todo(null) };
    const [{ id, r }] = open.sort((a, b) => isPlaceholder(a.r) - isPlaceholder(b.r) || byReading(a.id, b.id));
    const why = isPlaceholder(r) ? ' is not estimated yet' : r.straddles ? ' is too close to its target to call' : ' needs data';
    return { icon: '?', text: 'not settled from orbit: ' + nameOf(id, metrics) + why + todo(id) };
  }
  if (!mine.some((r) => r.status !== STATUS.NOT_APPLICABLE)) return { icon: '—', text: 'not applicable here' };
  if (siteId && hasResults(results)) { const sim = simulatedEstimate(siteId, factorId); return { ...sim, text: sim.text + todo(null) }; }
  return { icon: '?', text: 'not settled from orbit' + todo(null) };
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
