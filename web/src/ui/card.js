// The site card, in the left panel, in plain words first and expert detail on demand (Task 9c), kept compact: a small
// Back, the name with its priority, the plain verdict on one line, and a closed "About this site" (the brief, the
// region and terrain, "equal with", and "Why this priority" with its technical Details); five one-line factor rows
// (shape icon, name, a short headline, "View" where the factor has a view, the plain sentence as an instant hover tip,
// and a closed Details holding the sentence and Task 9's metric lines for that factor: value, "baseline / ideal",
// status label and icon, chips, what settles it, critical unknowns marked); and the next check, closed. Metric ids appear only inside Details. The card lays out whatever Results it is given,
// so metrics computed later (environment, field records, route) appear without a change here.
import { STATUS, fieldCounts } from '../status.js';
import { failSide } from '../priority.js';
import { FACTORS, factorSentence, plainVerdict, plainWhy, plainIds, shortName } from '../plain.js';
import { statusSvg } from './icons.js';
import { resultChips, alignmentCaveat, chipEl } from './chips.js';
import { nextCheck, nextCheckEl } from './list.js';
import { facilityEl } from './landing.js';
import { routeMetricIds } from '../nav.js';

const LOAD_FAILED = 'data failed to load';
const GAPS = 'elevation gaps under the layout';
// The grid each terrain check reads (checks.js), for the caveat chip when a Result names no dataset itself.
const GRID_OF = {
  'BT-01': 'slope10', 'BT-02': 'slope10', 'BT-05': 'slope10', 'SC-10': 'slope10', 'TC-08': 'slope10',
  'BT-04': 'elevation', 'BT-06': 'elevation', 'BT-08': 'roughness',
};
export const STEP_NAMES = {
  1: 'Step 1 · failures go last',
  2: 'Step 2 · fewer critical unknowns go higher',
  3: 'Step 3 · less effort and risk go higher',
  4: 'Step 4 · otherwise equal',
};
const GROUPS = [
  { key: 'fieldwork', status: STATUS.NEEDS_FIELDWORK, title: (n) => '⚠ ' + n + ' more critical unknowns: fieldwork with no orbital estimate' },
  { key: 'design', status: STATUS.NEEDS_DESIGN_INPUT, title: (n) => n + ' need design input' },
  { key: 'data', status: null, title: (n) => n + ' need data: estimates not computed yet, or no data here' },
];

const clean = (t) => String(t || '').replace(/^\s*(D\/P|P|D):\s*/, '').replace(/`/g, '').trim();

// Each plot's colour comes from its own checks: met when all of them meet, a conflict when any fails, else unresolved.
export const FOOTPRINT_CHECKS = { compound: ['BT-02', 'BT-04', 'BT-05'], solar: ['SC-10'], radiator: ['TC-08'] };
const PLOT_OF = Object.fromEntries(Object.entries(FOOTPRINT_CHECKS).flatMap(([plot, ids]) => ids.map((id) => [id, plot])));
const PLOT_NAMES = { compound: 'the compound', solar: 'the solar plot', radiator: 'the radiator plot' };
export function footprintStatus(results) {
  const out = {};
  for (const [plot, ids] of Object.entries(FOOTPRINT_CHECKS)) {
    const st = ids.map((id) => results && results.get(id) && results.get(id).status);
    out[plot] = st.includes(STATUS.NOT_MET) ? 'conflict' : st.every((x) => x === STATUS.MET) ? 'met' : 'unresolved';
  }
  return out;
}

// Short names for the conflict labels of the computed checks; any other metric uses its name.
const CONFLICT_NAMES = {
  'BT-01': 'Connected area ratio', 'BT-02': 'Layout fit', 'BT-04': 'Pad slope', 'BT-05': 'Local pad slope',
  'BT-08': 'Roughness', 'SC-10': 'Array fit', 'TC-08': 'Radiator fit',
};
const UNRESOLVED = {
  [STATUS.NEEDS_FIELDWORK]: 'needs fieldwork', [STATUS.NEEDS_DESIGN_INPUT]: 'needs design input', [STATUS.NEEDS_CONFIRMATION]: 'needs data',
};

// The specific conflict, e.g. "Pad slope 6.4° over the 5° target".
function conflictText(r, name) {
  const label = CONFLICT_NAMES[r.id] || name || r.id;
  const { base, limit, above } = failSide(r); // the same reading as the verdict (priority.js)
  if (!Number.isFinite(r.value) || !limit || above === null) return label + ' fails the ' + (base || 'current') + ' target';
  return label + ' ' + r.display + (above ? ' over' : ' under') + ' the ' + limit + ' target';
}

// {text, kind ('met' | 'conflict' | 'unresolved' | 'na'), icon, ideal, plot} for one Result, in the design guide's words.
export function statusLabel(r, name = '') {
  switch (r.status) {
    case STATUS.MET: return { text: 'Meets screening criterion', kind: 'met', icon: '✓', ideal: !!r.ideal, plot: null };
    case STATUS.NOT_MET: return { text: conflictText(r, name), kind: 'conflict', icon: '✗', ideal: false, plot: PLOT_OF[r.id] || null };
    case STATUS.NOT_APPLICABLE:
      return { text: r.note ? 'Not applicable: ' + r.note : 'Not applicable', kind: 'na', icon: '—', ideal: false, plot: null };
    default: return { text: 'Unresolved: ' + (UNRESOLVED[r.status] || 'needs data'), kind: 'unresolved', icon: '?', ideal: false, plot: null };
  }
}
export function targetText(target) {
  if (!target) return '';
  const b = clean(target.baseline), i = clean(target.ideal);
  if (!b) return i ? 'ideal ' + i : '';
  return i ? b + ' / ideal ' + i : b;
}

const byId = (cmp) => (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * cmp;

// Lines into Task 9's sections: Met, Failed, Open (lines with a value, then folded groups of the rest), Not applicable.
function sectionsOf(lines) {
  const sections = { met: [], failed: [], open: { lines: [], groups: [] }, na: [] };
  const grouped = new Map(GROUPS.map((g) => [g.key, []]));
  for (const line of lines) {
    if (line.status === STATUS.MET) sections.met.push(line);
    else if (line.status === STATUS.NOT_MET) sections.failed.push(line);
    else if (line.status === STATUS.NOT_APPLICABLE) sections.na.push(line);
    else if ((line.value !== null && line.value !== undefined) || line.failedData || line.id.startsWith('power:')) sections.open.lines.push(line);
    else grouped.get((GROUPS.find((x) => x.status === line.status) || GROUPS[2]).key).push(line);
  }
  sections.open.lines.sort((a, b) => (b.id.startsWith('power:') - a.id.startsWith('power:')) || (b.critical - a.critical)
    || (b.failedData - a.failedData) || (a.id < b.id ? -1 : 1));
  for (const g of GROUPS) {
    const ls = grouped.get(g.key);
    if (ls.length) sections.open.groups.push({ key: g.key, title: g.title(ls.length), lines: ls });
  }
  return sections;
}

// ctx: site, results (this site's), row (its priority row), metrics, setup, catalog; rows, allResults (siteId -> Results)
// and names (siteId -> name) for the plain "why", which names the peer that placed it.
export function cardModel({ site, results, row, metrics, setup, catalog, rows = null, allResults = null, names = new Map() }) {
  const meta = new Map(metrics.map((m) => [m.id, m]));
  const crit = row ? new Set(row.criticalUnknowns) : null;
  const entries = (catalog && catalog.byId) || new Map();
  const caveatFor = (r) => {
    let ids = r.datasets || (r.datasetId ? [r.datasetId] : null);
    if (!ids) {
      const key = GRID_OF[r.id], g = key && site.grids && site.grids[key];
      ids = g && r.value !== null && r.value !== undefined ? [g.datasetId] : [];
    }
    for (const id of ids) { const c = alignmentCaveat(entries.get(id)); if (c) return c; }
    return null;
  };

  const lines = [];
  for (const r of [...results.values()].sort(byId(1))) {
    const m = meta.get(r.id);
    const open = r.status !== STATUS.MET && r.status !== STATUS.NOT_MET && r.status !== STATUS.NOT_APPLICABLE;
    const label = statusLabel(r, m && m.name);
    lines.push({
      id: r.id, factor: m ? m.factor : String(r.id).slice(0, 2), name: m ? m.name : r.id, display: r.display || '—', value: r.value,
      target: targetText(r.target), words: label.text, kind: label.kind, icon: label.icon, plot: label.plot,
      status: r.status, ideal: label.ideal, note: r.note || '',
      critical: open && (crit ? crit.has(r.id) : (r.status === STATUS.NEEDS_FIELDWORK || r.straddles)),
      chips: resultChips(r, { caveat: caveatFor(r) }),
      settledBy: open ? ((m && m.fieldwork) || '') : '',
      failedData: r.note === LOAD_FAILED || r.note === GAPS,
      appliesTo: r.appliesTo,
    });
  }
  const warnings = [];
  if (setup && setup.power === 'solar_fission') {
    lines.push({
      id: 'power:reactor', factor: 'SC', label: 'Reactor link', name: 'Reactor link', display: '—', value: null, target: '',
      words: 'base decision, needs confirmation', kind: 'unresolved', icon: '?', plot: null, status: STATUS.NEEDS_CONFIRMATION, ideal: false,
      note: 'no reactor site is assumed; where it goes and how it connects is for the base to decide', critical: false,
      chips: [{ kind: 'assumption', text: 'assumption', title: 'power option chosen in the setup' }], settledBy: '', failedData: false,
    });
  }
  const sc04 = results.get('SC-04');
  if (setup && setup.power === 'solar_batteries' && sc04 && sc04.value !== null && sc04.value !== undefined) {
    warnings.push({ kind: 'dust', text: 'Dust storms: solar and batteries carry the whole load. In the worst season the array covers '
      + sc04.display + (sc04.note ? '; ' + plainIds(sc04.note, metrics) : '') + '.' });
  }

  const known = new Set(FACTORS.map((f) => f.id));
  const factors = FACTORS.map((f) => {
    const s = factorSentence(f.id, results, metrics, { siteId: site.id });
    const failedIds = lines.filter((l) => l.factor === f.id && l.status === STATUS.NOT_MET).map((l) => l.id);
    return {
      id: f.id, name: f.name, ...s, head: factorHeadline(s, failedIds),
      counts: fieldCounts(results, metrics, f.id), sections: sectionsOf(lines.filter((l) => l.factor === f.id)),
    };
  });
  const other = lines.filter((l) => !known.has(l.factor)); // Results of no known factor still show, in their own Details
  return {
    siteId: site.id, name: site.name, regionId: site.regionId,
    priority: row ? row.priority : null, verdict: plainVerdict(row, results, metrics), technicalVerdict: row ? row.verdict : 'not ranked yet',
    equalWith: row ? row.equalWith : [], tradeoff: row ? row.tradeoff : null, failures: row ? row.failures : [],
    criticalCount: row ? row.criticalUnknowns.length : null, nextCheck: row ? nextCheck(row, metrics) : null, ranked: !!row,
    why: {
      step: row ? row.step : null, stepName: row ? STEP_NAMES[row.step] || 'Step ' + row.step : '', text: row ? row.whyHere : '',
      tradeoff: row ? row.tradeoff : null, plain: plainWhy(row, { rows: rows || (row ? [row] : []), results: allResults || new Map([[site.id, results]]), names }),
    },
    warnings, factors, other: other.length ? sectionsOf(other) : null, sections: sectionsOf(lines),
  };
}

// ---------- DOM ----------

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};

function lineEl(l) {
  const el = h('div', 'line s-' + l.status + ' k-' + l.kind + (l.critical ? ' critical' : '') + (l.failedData ? ' data-failed' : '') + (l.ideal ? ' is-ideal' : ''));
  el.dataset.metric = l.id;
  el.dataset.status = l.status;
  const l1 = h('div', 'l1');
  if (l.critical) { const mk = h('span', 'mk', '⚠'); mk.title = 'critical unknown: could still turn into a failure here'; l1.append(mk); }
  if (!l.label) l1.append(h('span', 'id', l.id));
  l1.append(h('span', 'nm', l.label || l.name), h('span', 'val', l.display));
  const l2 = h('div', 'l2');
  const st = h('span', 'status');
  st.append(h('span', 'st-icon', l.icon), h('span', 'words', l.words));
  if (l.ideal) st.append(h('span', 'badge-ideal', 'ideal'));
  if (l.plot) st.append(h('span', 'plot', 'on ' + PLOT_NAMES[l.plot]));
  l2.append(st);
  if (l.target) l2.append(h('span', 'target', l.target));
  for (const c of l.chips) l2.append(chipEl(c));
  el.append(l1, l2);
  if (l.failedData) el.append(h('div', 'note bad', l.note));
  else if (l.note && !l.words.includes(l.note)) el.append(h('div', 'note', l.note));
  if (l.settledBy) el.append(h('div', 'settled', 'settled by: ' + l.settledBy));
  return el;
}

const KIND = { '✓': 'met', '✗': 'conflict', '?': 'unresolved', '—': 'na' };
// A factor row's headline, five words or fewer; the full sentence is the row's tip and opens its Details.
const FAIL_WORDS = {
  'BT-01': 'flat area', 'BT-02': 'layout fit', 'BT-04': 'slope', 'BT-05': 'slope', 'BT-08': 'roughness',
  'SC-10': 'array fit', 'TC-08': 'radiator fit',
};
export function factorHeadline(f, failedIds = []) {
  if (f.icon === '✗') {
    const words = [...new Set(failedIds.map((id) => FAIL_WORDS[id] || 'a requirement'))];
    if (!words.length) return 'Fails a requirement';
    return 'Fails: ' + words[0] + (words.length > 1 ? ' +' + (words.length - 1) : '');
  }
  if (f.simulated) return 'Simulated estimate'; // never read as an orbital result
  if (f.icon === '✓') return 'Meets from orbit';
  if (f.icon === '—') return 'Not applicable here';
  return 'Not settled from orbit'; // missing data never reads as fine
}
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

// onBack() closes the site; onView(id) asks for a factor's view; hasView(id) says whether that factor has one yet.
export function createCard(el, { onBack, onView = () => {}, hasView = () => false }) {
  const openGroups = new Set(); // <details> left open by the user survive re-renders
  let siteId = null;
  const tripEl = h('div', 'trip-panel'); // the navigation lane's trip panel (renderTripPanel) lives here through re-renders
  tripEl.id = 'trip-panel';

  function clear() {
    el.replaceChildren();
    delete el.dataset.site;
    siteId = null;
  }

  const details = (key, summary, cls = 'group') => {
    const d = h('details', cls);
    d.dataset.group = key;
    d.open = openGroups.has(key);
    d.append(h('summary', '', summary));
    d.addEventListener('toggle', () => { if (d.open) openGroups.add(key); else openGroups.delete(key); });
    return d;
  };

  // A factor's metric lines, in Task 9's sections, inside its Details.
  function sectionsEl(fid, S, into) {
    const sub = (key, title, n) => {
      const s = h('section', 'sub sub-' + key);
      s.dataset.section = key;
      const t = h('h4', '', title + ' ');
      t.append(h('span', 'n', String(n)));
      s.append(t);
      return s;
    };
    if (S.met.length) { const s = sub('met', 'Met', S.met.length); for (const l of S.met) s.append(lineEl(l)); into.append(s); }
    if (S.failed.length) { const s = sub('failed', 'Failed', S.failed.length); for (const l of S.failed) s.append(lineEl(l)); into.append(s); }
    const nOpen = S.open.lines.filter((l) => !l.id.startsWith('power:')).length + S.open.groups.reduce((a, g) => a + g.lines.length, 0);
    if (nOpen || S.open.lines.length) {
      const s = sub('open', 'Open', nOpen);
      for (const l of S.open.lines) s.append(lineEl(l));
      for (const g of S.open.groups) {
        const d = details(fid + ':open:' + g.key, g.title);
        for (const l of g.lines) d.append(lineEl(l));
        s.append(d);
      }
      into.append(s);
    }
    if (S.na.length) {
      const s = sub('na', 'Not applicable', S.na.length);
      const solar = S.na.every((l) => l.id.startsWith('SC-'));
      const d = details(fid + ':na', solar ? 'All ' + S.na.length + ' solar metrics: no solar plot in this power option' : plural(S.na.length, 'metric') + ' that do not apply here');
      for (const l of S.na) d.append(lineEl(l));
      s.append(d);
      into.append(s);
    }
  }

  function factorEl(f, setup) {
    const box = h('div', 'factor k-' + KIND[f.icon]);
    box.dataset.factor = f.id;
    box.dataset.icon = f.icon;
    box.dataset.tip = f.name + ': ' + f.text; // the full sentence, at once on hover (R37); it also opens the Details
    const icon = h('span', 'f-icon st-icon k-' + KIND[f.icon] + (f.simulated ? ' simulated' : ''));
    icon.append(statusSvg(f.icon, { simulated: f.simulated }), h('span', 'sr-only', f.icon)); // the shape shows; the glyph is read
    const words = h('div', 'f-words');
    words.append(h('span', 'f-name', f.name));
    const head = h('span', 'f-head');
    if (f.simulated) { // the chip is the headline's first word: still labelled, never presented as data
      const c = h('span', 'demo-chip sim-chip', 'Simulated');
      c.title = 'Simulated for the demo: not data, and it changes no status or priority';
      head.append(c, ' ' + f.head.replace(/^Simulated\s*/, ''));
    } else head.textContent = f.head;
    words.append(head);
    box.append(icon, words);
    if (hasView(f.id)) {
      const v = h('button', 'view secondary', 'View');
      v.type = 'button';
      v.dataset.factor = f.id;
      v.setAttribute('aria-pressed', 'false'); // main.js marks the factor view in force
      v.setAttribute('aria-label', 'Show ' + f.name + ' on the map');
      v.addEventListener('click', () => onView(f.id));
      box.append(v);
    }
    const d = details('factor:' + f.id, 'Details', 'f-details');
    const body = h('div', 'f-body');
    body.append(h('p', 'f-text', f.text));
    body.append(h('p', 'counts', plural(f.counts.fieldwork, 'fieldwork item') + ' and ' + plural(f.counts.design, 'design item') + ' open.'));
    if (f.id === 'BT') { // the layout lives on the terrain: what it is and how to move it
      if (setup) body.append(facilityEl(setup, { lead: 'Facility' })); // with its label: an illustrative reference
      body.append(h('p', 'howto', 'Drag a plot to move the layout, or select it (click, or Tab from the map) and use the arrow keys (5 m) '
        + 'and [ ] (15°); drag the round handle, or hold R and drag, to turn it. The checks and the priority update as you go.'));
    }
    sectionsEl(f.id, f.sections, body);
    d.append(body);
    box.append(d);
    return box;
  }

  // "Route" (T11), only when the navigation lane loaded (routing set): "Plan route for N field checks", the trip panel,
  // the route's own results (route.metrics: shown here only, never ranked) with what is not on the trip, and the walk's
  // tags as SIMULATED notes, which change no status.
  function routeEl(routing, metrics) {
    const sec = h('section', 'sec sec-route');
    sec.dataset.section = 'route';
    sec.append(h('h3', '', 'Route'));
    const nameOf = (id) => { const m = metrics.find((x) => x.id === id); return (m && m.name) || 'An unnamed check'; };
    const b = h('button', 'secondary plan-route', 'Plan route for ' + plural(routing.checks, 'field check'));
    b.type = 'button';
    b.id = 'plan-route';
    b.addEventListener('click', routing.onPlan);
    sec.append(b, tripEl);
    const route = routing.route;
    if (route) {
      const ids = [...routeMetricIds(route)];
      const m = route.metrics;
      const resultOf = (id) => (m instanceof Map ? m.get(id) : Array.isArray(m) ? m.find((x) => x && typeof x === 'object' && x.id === id) : m[id]) || null;
      if (ids.length) {
        const ul = h('ul', 'route-metrics');
        ul.setAttribute('aria-label', 'From the route, not ranked');
        for (const id of ids) {
          const r = resultOf(id);
          const li = h('li', '');
          li.dataset.metric = id;
          const label = r && r.status ? statusLabel(r, nameOf(id)) : { text: 'Unresolved: needs data', kind: 'unresolved' }; // missing never reads as fine
          li.append(h('span', 'nm', nameOf(id)), ' ', h('span', 'st k-' + label.kind, label.text), ' ', h('span', 'demo-chip', 'Route estimate'));
          ul.append(li);
        }
        sec.append(ul, h('p', 'route-note', 'Route results are estimates from the plan; they do not change the priority.'));
      }
      const off = route.notOnTrip || [];
      if (off.length) sec.append(h('p', 'not-on-trip', 'Not on this trip: ' + off.map(nameOf).join(', ') + '.'));
    }
    if (routing.tags.length) {
      const ul = h('ul', 'sim-tags');
      ul.setAttribute('aria-label', 'Simulated walk tags');
      for (const t of routing.tags) {
        const li = h('li', 'sim-tag');
        li.append(h('span', 'demo-chip sim-chip', 'SIMULATED'), ' ' + (t.note || 'Tag') + ' · ' + t.lat.toFixed(3) + '°, ' + t.lon.toFixed(3) + '°');
        li.title = 'Simulated for the demo: not data, and it changes no status or priority';
        ul.append(li);
      }
      sec.append(ul);
    }
    return sec;
  }

  // ctx: {problems: [{kind, message}], regionName, setup, names (siteId -> name), metrics, brief (the brief's line, Task 9d),
  // routing ({checks, route, tags, onPlan}, or null without the navigation lane)}
  function render(model, { problems = [], regionName = '', setup = null, names = new Map(), metrics = [], brief = '', routing = null } = {}) {
    if (model.siteId !== siteId) { openGroups.clear(); siteId = model.siteId; }
    const body0 = el.querySelector('.card-body');
    const scroll = body0 ? body0.scrollTop : 0;
    el.replaceChildren();
    el.dataset.site = model.siteId;
    el.className = 'panel';
    el.setAttribute('aria-label', 'Site card: ' + model.name);

    const head = h('header', 'card-head');
    const back = h('button', 'back text-action', '← Back');
    back.type = 'button';
    back.append(h('span', 'sr-only', ' to ' + (regionName || 'the region'))); // read in full; shown short
    back.addEventListener('click', onBack);
    head.append(back);
    const title = h('div', 'title-line');
    title.append(h('h2', '', shortName(model.name)),
      h('span', 'prio-badge' + (model.failures.length ? ' failed' : ''), model.priority === null ? 'not ranked yet' : 'Priority ' + model.priority));
    const verdict = h('p', 'verdict' + (model.failures.length ? ' failed' : ''), model.verdict);
    verdict.dataset.tip = model.verdict; // one line; the whole verdict at once on hover
    head.append(title, verdict);

    // About this site, closed: the brief, the region and terrain, "equal with", and why this priority
    const about = details('about', 'About this site', 'about');
    const ab = h('div', 'f-body');
    if (brief) ab.append(h('p', 'brief-line', brief));
    const desc = model.name.slice(shortName(model.name).length).trim().replace(/^\((.*)\)$/, '$1');
    ab.append(h('p', 'desc', (regionName ? regionName + ' · ' : '') + 'candidate site' + (desc ? ' · ' + desc : '')));
    if (model.equalWith.length) ab.append(h('p', 'eq', 'equal with ' + model.equalWith.map((id) => shortName(names.get(id) || id)).join(', ')));
    about.append(ab);
    head.append(about);
    el.append(head);

    const body = h('div', 'card-body');
    const notices = h('div', 'notices');
    for (const p of problems) { // what the view cannot show as data: failed files, missing imagery, no surround
      const failed = p.kind === 'data_failed';
      const n = h('p', 'notice ' + (failed ? 'bad' : 'warn'));
      n.dataset.kind = p.kind;
      const msg = plainIds(failed && !/failed to load/.test(p.message) ? 'Data failed to load: ' + p.message : p.message, metrics);
      n.textContent = '⚠ ' + msg + (/[.]$/.test(msg) ? '' : '.');
      notices.append(n);
    }
    for (const w of model.warnings) {
      const n = h('p', 'notice warn', '⚠ ' + w.text);
      n.dataset.kind = w.kind;
      notices.append(n);
    }
    if (notices.childElementCount) body.append(notices);

    const rows = h('section', 'factors');
    rows.setAttribute('aria-label', 'The five factors');
    for (const f of model.factors) rows.append(factorEl(f, setup));
    if (model.other) {
      const box = h('div', 'factor k-unresolved');
      box.dataset.factor = 'other';
      box.dataset.tip = 'Other checks: results that belong to none of the five factors';
      const d = details('factor:other', 'Other checks', 'f-details');
      const b = h('div', 'f-body');
      sectionsEl('other', model.other, b);
      d.append(b);
      box.append(d);
      rows.append(box);
    }
    body.append(rows);

    const why = h('section', 'sec sec-why');
    why.dataset.section = 'why';
    why.append(h('h3', '', 'Why this priority'), h('p', 'why-text', model.why.plain));
    const wd = details('why', 'Details');
    const wb = h('div', 'f-body');
    if (model.ranked) {
      wb.append(h('p', 'step', model.why.stepName), h('p', 'verdict-tech', model.technicalVerdict), h('p', 'why-tech', model.why.text));
    }
    wb.append(h('p', 'rule', 'Sites are ordered by four steps from the project plan, with no scores or weights: failures go last, then fewer '
      + 'critical unknowns go higher, then less grading, shorter cable, less shading and more dune setback, otherwise equal.'));
    wd.append(wb);
    why.append(wd);
    ab.append(why);

    const next = h('section', 'sec sec-next');
    next.dataset.section = 'next';
    const nd = details('next', 'Next check', 'next');
    if (model.ranked) nd.append(nextCheckEl(model.nextCheck));
    else nd.append(h('p', 'none', 'The next check appears once every site in the region has been checked.'));
    next.append(nd);
    body.append(next);
    if (routing) body.append(routeEl(routing, metrics));
    el.append(body);
    body.scrollTop = scroll;
  }
  return { render, clear, tripEl };
}
