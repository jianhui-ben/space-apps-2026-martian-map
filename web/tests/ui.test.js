// Pure parts of the construction brief, priority list, site card, chips, references and the factor bar (Tasks 9-9d).
import { STATUS, initialStatuses, mergeResults } from '../src/status.js';
import { regionInView, cameraTarget, factorCells, shortName, nextCheck } from '../src/ui/list.js';
import { cardModel, createCard, statusLabel, footprintStatus } from '../src/ui/card.js';
import { resultChips, alignmentCaveat } from '../src/ui/chips.js';
import { facilityLine, FACILITY_LABEL } from '../src/ui/landing.js';
import { qtext, quantityError, ERRORS, fleetTotal, activeTotal, briefLine, summaryRows, reviewRows, stillToConfirm,
  stillToConfirmText, tabError, REVIEW_FACTORS, createBrief, SOL_HOURS } from '../src/ui/brief.js';
import { referencesFor } from '../src/ui/references.js';
import { FACTORS, PLAIN, plainVerdict, factorSentence, plainWhy } from '../src/plain.js';
import { createViewRegistry, createFactorBar, slopeFromLegend } from '../src/ui/factors.js';
import { slopeClass } from '../src/site.js';
import { placeCard } from '../src/ui/pins.js';
import { FIXED_SETUP, DEFAULT_BRIEF, defaultBrief } from '../src/state.js';

const metrics = (await (await fetch('../metrics.json')).json()).metrics;
const R = 3396190;
const TOPUP = { loadKw: 150, power: 'topup' };

// ---- list: which region the camera is over ----
const regions = { regions: [{ id: 'gale', bounds: [136, -6.5, 139, -3.5] }, { id: 'jezero', bounds: [76, 17, 79, 20] }] };

test('ui regionInView: inside the bounds, within 5 degrees of them, and under 2,000 km only', () => {
  assertEq(regionInView(regions, { lon: 137.5, lat: -5 }, 250000).id, 'gale');
  assertEq(regionInView(regions, { lon: 143.9, lat: -5 }, 250000).id, 'gale'); // 4.9 degrees east of the box
  assertEq(regionInView(regions, { lon: 137.5, lat: 1.4 }, 250000).id, 'gale');
  assertEq(regionInView(regions, { lon: 144.1, lat: -5 }, 250000), null);
  assertEq(regionInView(regions, { lon: 137.5, lat: -5 }, 2100000), null);
  assertEq(regionInView(regions, { lon: 77, lat: 18 }, 1999000).id, 'jezero');
  assertEq(regionInView(regions, null, 1000), null);
});

test('ui cameraTarget: where the view ray meets the sphere, the nadir when it misses', () => {
  const down = cameraTarget({ x: R + 5000, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, R);
  assertClose(down.lon, 0, 1e-9); assertClose(down.lat, 0, 1e-9);
  const k = Math.SQRT1_2; // 45 degrees off straight down, toward +y (east at lon 0)
  const tilted = cameraTarget({ x: R + 1000, y: 0, z: 0 }, { x: -k, y: k, z: 0 }, R);
  assert(tilted.lon > 0.0165 && tilted.lon < 0.0175, 'about 1 km east: ' + tilted.lon);
  const away = cameraTarget({ x: R + 1000, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, R); // looks past the planet
  assertClose(away.lon, 0, 1e-9); assertClose(away.lat, 0, 1e-9);
});

test('ui factorCells: five factors in order, with the icon and the fieldwork and design counts', () => {
  const res = initialStatuses(metrics, TOPUP);
  const cells = factorCells(res, metrics);
  assertEq(cells.map((c) => c.factor), ['BT', 'GI', 'SC', 'TC', 'IR']);
  // no GI metric is an estimate today, but its field checks are open: unresolved, never "none apply" (Task 9c)
  assertEq(cells.find((c) => c.factor === 'GI').icon, '?');
  assertEq(cells.find((c) => c.factor === 'BT').icon, '?'); // estimates not computed are unresolved, never fine
  const gi = cells.find((c) => c.factor === 'GI');
  assert(/^Ground & ice: /.test(gi.title), gi.title); // the plain name, never the code
  assert(gi.fieldwork > 0 && gi.design > 0, JSON.stringify(gi));
  assert(/fieldwork/.test(gi.title) && /design/.test(gi.title), gi.title);
  const sc = factorCells(initialStatuses(metrics, { loadKw: 150, power: 'base_only' }), metrics).find((c) => c.factor === 'SC');
  assertEq([sc.icon, sc.fieldwork, sc.design], ['—', 0, 0]);
});

test('ui shortName drops the bracketed description', () => {
  assertEq(shortName('Near base, west (crater floor, on Curiosity\'s early path)'), 'Near base, west');
  assertEq(shortName('Arcadia north'), 'Arcadia north');
});

// ---- card ----
const computed = (id, o) => ({
  id, value: null, unit: '', display: '—', target: { baseline: '', ideal: '', label: 'P' }, status: STATUS.MET, ideal: false,
  evidence: 'derived', note: '', assumption: false, straddles: false, appliesTo: 'layout', ...o,
});
function fixture({ setup = TOPUP, extra = [], flag = true } = {}) {
  const terrain = new Map([
    ['BT-04', computed('BT-04', { value: 0.4, display: '0.4°', target: { baseline: '≤ 5°', ideal: '≤ 2°', label: 'P' }, ideal: true, assumption: true })],
    ['BT-05', computed('BT-05', { value: 14.2, display: '14.2°', target: { baseline: '≤ 10°', ideal: '≤ 5°', label: 'P' }, status: STATUS.NOT_MET, assumption: true })],
    ['BT-08', computed('BT-08', { value: 0.17, display: '0.17 m', target: { baseline: '≤ 0.3 m', ideal: '', label: 'D' }, status: STATUS.NEEDS_FIELDWORK, straddles: true, note: 'screening only; needs field survey', assumption: true })],
    ['BT-21', computed('BT-21', { value: 634, display: '634 m', target: { baseline: '≤ allowance', ideal: '≤ 0.8 × allowance', label: 'D' }, status: STATUS.NEEDS_DESIGN_INPUT, note: 'straight line; no distance allowance yet' })],
    ['BT-02', computed('BT-02', { value: null, status: STATUS.NEEDS_CONFIRMATION, note: 'data failed to load', target: { baseline: '100%', ideal: '100%', label: 'D' } })],
    ...extra.map((r) => [r.id, r]),
  ]);
  const results = mergeResults(initialStatuses(metrics, setup), terrain, []);
  const catalog = {
    byId: new Map([
      ['elev_x', { id: 'elev_x', alignment: { dem_vs_rover: { n: 356, median_offset_m: 18.06, flag, note: 'grid height minus rover stop height' } } }],
      ['slope_x', { id: 'slope_x', alignment: { dem_vs_rover: { n: 0, flag: null, note: 'no rover heights in this area' } } }],
    ]),
  };
  const site = { id: 's1', name: 'Site one (flat floor)', regionId: 'r', grids: { elevation: { datasetId: 'elev_x' }, slope10: { datasetId: 'slope_x' }, roughness: null }, loadErrors: {} };
  const row = {
    siteId: 's1', priority: 2, step: 1, whyHere: 'Fails BT-05: 14.2° > 10°.', failures: ['BT-05'],
    criticalUnknowns: ['BT-08', 'GI-01'], equalWith: [], tradeoff: null, verdict: 'not recommended under the stated requirements (BT-05: 14.2° > 10°)',
  };
  return cardModel({ site, results, row, metrics, setup, catalog });
}
const all = (m) => [...m.sections.met, ...m.sections.failed, ...m.sections.open.lines, ...m.sections.open.groups.flatMap((g) => g.lines), ...m.sections.na];
const lineOf = (m, id) => all(m).find((l) => l.id === id);
const sectionOf = (m, id) => {
  for (const k of ['met', 'failed', 'na']) if (m.sections[k].some((l) => l.id === id)) return k;
  if (m.sections.open.lines.some((l) => l.id === id)) return 'open';
  const g = m.sections.open.groups.find((x) => x.lines.some((l) => l.id === id));
  return g ? 'open:' + g.key : null;
};

test('ui card: each Result lands in Met, Failed, Open or Not applicable by its status', () => {
  const m = fixture();
  assertEq(sectionOf(m, 'BT-04'), 'met');
  assertEq(sectionOf(m, 'BT-05'), 'failed');
  assertEq(sectionOf(m, 'BT-08'), 'open'); // a computed value stays in view
  assertEq(sectionOf(m, 'BT-21'), 'open');
  assertEq(sectionOf(m, 'BT-02'), 'open'); // failed data stays in view, never folded away
  assertEq(sectionOf(m, 'GI-01'), 'open:fieldwork');
  assertEq(sectionOf(m, 'SC-02'), 'open:design');
  assertEq(sectionOf(m, 'SC-01'), 'open:data');
  assertEq(m.sections.na.length, 0);
  assertEq(all(m).length, metrics.length);
  assertEq([m.priority, m.technicalVerdict, m.why.step, m.why.text], [2, 'not recommended under the stated requirements (BT-05: 14.2° > 10°)', 1, 'Fails BT-05: 14.2° > 10°.']);
  assertEq(m.verdict, 'Not recommended: too steep in places under the compound'); // Task 9c: the header reads the plain verdict
  assert(/failures/i.test(m.why.stepName), m.why.stepName);
});

test('ui card: a line has value, baseline / ideal, status words and chips', () => {
  const m = fixture();
  const bt04 = lineOf(m, 'BT-04');
  assertEq([bt04.display, bt04.target, bt04.words, bt04.ideal], ['0.4°', '≤ 5° / ideal ≤ 2°', 'Meets screening criterion', true]);
  assertEq(bt04.name, 'Overall building-pad slope');
  assertEq(bt04.chips.map((c) => c.kind), ['derived', 'assumption', 'caveat']); // scenario target; flagged DEM
  assert(/rover/.test(bt04.chips[2].title) && /18\.1 m/.test(bt04.chips[2].title), bt04.chips[2].title);
  assertEq(lineOf(m, 'BT-05').chips.map((c) => c.kind), ['derived', 'assumption']); // slope grid has no flag
  const bt01 = lineOf(m, 'BT-01'); // not yet computed: the docs' targets, P: prefix dropped
  assertEq([bt01.display, bt01.target, bt01.words], ['—', '≥ 1.0 / ideal ≥ 1.3', 'Unresolved: needs data']);
  assertEq(lineOf(m, 'BT-02').words, 'Unresolved: needs data');
  assertEq(lineOf(m, 'BT-05').words, 'Local pad slope 14.2° over the 10° target'); // the specific conflict
  assertEq(lineOf(m, 'BT-05').plot, 'compound'); // ...and the plot it concerns
  assert(lineOf(m, 'BT-02').failedData, 'data that failed to load is marked');
  assertEq(fixture({ flag: false }).sections.met[0].chips.map((c) => c.kind), ['derived', 'assumption']);
});

test('ui card: open items are marked critical from the priority row and say what settles them', () => {
  const m = fixture();
  assert(lineOf(m, 'BT-08').critical && lineOf(m, 'GI-01').critical, 'critical unknowns marked');
  assert(!lineOf(m, 'BT-21').critical && !lineOf(m, 'GI-02').critical, 'others not');
  assertEq(lineOf(m, 'GI-01').settledBy, 'Soil/rock characterization and appropriate probing/load tests');
  assertEq(lineOf(m, 'BT-08').settledBy, 'Measure finer surface irregularities');
  for (const l of [...m.sections.open.lines, ...m.sections.open.groups.flatMap((g) => g.lines)]) {
    assert(l.settledBy && l.settledBy.length > 5, 'settled by text for ' + l.id);
  }
  assertEq(lineOf(m, 'BT-04').settledBy, ''); // met lines need nothing more
  const crit = m.sections.open.lines.filter((l) => l.critical).map((l) => l.id);
  assertEq(crit, ['BT-08']); // critical with a value first, in view
});

test('ui card: base power only puts every solar metric under not applicable with the reason', () => {
  const m = fixture({ setup: { loadKw: 150, power: 'base_only' } });
  const sc = m.sections.na.filter((l) => l.id.startsWith('SC-'));
  assertEq(sc.length, 13);
  assert(sc.every((l) => l.words === 'Not applicable: no solar plot in this power option'), sc[0].words);
});

test('ui card: power notes for fission and batteries', () => {
  const fission = fixture({ setup: { loadKw: 150, power: 'solar_fission' } });
  const reactor = fission.sections.open.lines.find((l) => l.id === 'power:reactor');
  assert(reactor && reactor.label === 'Reactor link' && reactor.words === 'base decision, needs confirmation', JSON.stringify(reactor));
  assertEq(fixture().sections.open.lines.some((l) => l.id === 'power:reactor'), false);
  const batt = { loadKw: 150, power: 'solar_batteries' };
  assertEq(fixture({ setup: batt }).warnings.filter((w) => w.kind === 'dust').length, 0); // no SC-04 Result yet
  const sc04 = computed('SC-04', { value: 0.9, display: '0.90', status: STATUS.NOT_MET, evidence: 'model', note: 'dust storm: 0.31', appliesTo: 'solar' });
  const w = fixture({ setup: batt, extra: [sc04] }).warnings.filter((x) => x.kind === 'dust');
  assert(w.length === 1 && /dust storm: 0\.31/.test(w[0].text), JSON.stringify(w));
  assertEq(fixture({ extra: [sc04] }).warnings.filter((x) => x.kind === 'dust').length, 0); // only for solar + batteries
});

test('ui card: Results it has never seen show without a code change', () => {
  const sc01 = computed('SC-01', { value: 3.2, display: '3.2%', target: { baseline: '≤ 10%', ideal: '≤ 5%', label: 'P' }, ideal: true, evidence: 'model', appliesTo: 'solar' });
  const odd = computed('XX-99', { value: 1, display: '1', status: STATUS.NEEDS_FIELDWORK, evidence: 'interpretation', datasetId: 'elev_x' });
  const m = fixture({ extra: [sc01, odd] });
  assertEq(sectionOf(m, 'SC-01'), 'met');
  assertEq(lineOf(m, 'SC-01').chips.map((c) => c.kind), ['model']);
  assertEq(sectionOf(m, 'XX-99'), 'open');
  assertEq(lineOf(m, 'XX-99').name, 'XX-99');
  assertEq(lineOf(m, 'XX-99').chips.map((c) => c.kind), ['interpretation', 'caveat']); // its own datasetId is honoured
});

// ---- chips ----
test('ui chips: one per evidence label, assumption for scenario targets, caveat when the dataset is flagged', () => {
  assertEq(resultChips({ evidence: 'observation', assumption: false }).map((c) => c.kind), ['observation']);
  assertEq(resultChips({ evidence: 'derived', assumption: true }).map((c) => c.kind), ['derived', 'assumption']);
  assertEq(resultChips({ evidence: 'assumption', assumption: true }).map((c) => c.kind), ['assumption']);
  assertEq(resultChips({ evidence: 'weird', assumption: false }).map((c) => c.kind), ['reference']);
  const cav = alignmentCaveat({ alignment: { dem_vs_rover: { flag: true, median_offset_m: -0.39, n: 34, note: 'grid height minus rover stop height' } } });
  assert(cav && cav.kind === 'caveat' && /-0\.4 m/.test(cav.title) && /34/.test(cav.title), JSON.stringify(cav));
  assertEq(alignmentCaveat({ alignment: { dem_vs_rover: { flag: false } } }), null);
  assertEq(alignmentCaveat({ alignment: { flag: true, note: 'flat form' } }).title, 'flat form');
  assertEq(alignmentCaveat({}), null);
  assertEq(alignmentCaveat(null), null);
});

// ---- the fixed facility (Task 9b), now the illustrative reference (Task 9d) ----
test('ui facility: one fixed case, the reference facility, labelled illustrative', () => {
  assertEq(FIXED_SETUP, { loadKw: 150, power: 'topup' });
  assertEq(facilityLine(FIXED_SETUP), '150 kW IT, 225 kW total; compound 60 × 60 m, radiator 60 × 64 m, solar 100 × 100 m');
  assertEq(facilityLine({ loadKw: 150, power: 'base_only' }), '150 kW IT, 225 kW total; compound 60 × 60 m, radiator 60 × 64 m');
  assertEq(FACILITY_LABEL, 'Illustrative reference — not calculated from your project.');
});

// ---- the construction brief (Task 9d) ----
test('brief defaults match the mockup example', () => {
  const b = DEFAULT_BRIEF;
  assertEq(b.name, 'Gale landing pad & access road');
  assertEq(b.types, ['Landing pad', 'Road']);
  assertEq(b.location, 'Gale study region — site not selected');
  assertEq(b.fleet.map((f) => [f.role, f.count, f.active]), [['Survey', 4, 4], ['Excavation', 10, 8], ['Transport', 6, 4]]);
  assertEq([fleetTotal(b), activeTotal(b)], [20, 16]);
  assertEq([b.q.area.mode, b.q.area.unit, b.q.road.mode, b.q.road.unit], ['unknown', 'm²', 'unknown', 'm']); // survey area, road length
  assertEq([b.q.hours.mode, b.q.hours.value, b.q.hours.unit], ['known', 12, 'h / sol']);
  assertEq([b.q.deadline.mode, b.q.deadline.value, b.q.deadline.unit], ['known', 1, 'hours']);
  assertEq([b.q.duration.mode, b.q.retention.mode], ['unknown', 'unknown']);
  assertEq([b.phase, b.quality, b.late], ['Site preparation', 'Earthworks check', 'Pause dependent work']);
  assertEq(b.jobs, { map: true, progress: true, inspection: false, plan: true });
  assertEq(b.cadence, { map: 'Once per sol', progress: 'Once per sol', inspection: 'At phase end', plan: 'Every 4 hours' });
  assertEq([b.power, b.continuity, b.deployment], ['Unknown', 'Unknown', 'Compare both']);
  assertEq(briefLine(b), 'Gale landing pad & access road · 20 robots');
  assertEq(summaryRows(b), [['Build', 'Landing pad + Road'], ['Robots', '20 total'], ['Active together', '16'],
    ['Operating time', '12 h / sol'], ['Turnaround', '1 hour']]);
  assert(Object.isFrozen(b) && Object.isFrozen(b.fleet[0]) && Object.isFrozen(b.q.hours), 'the defaults cannot be changed in place');
  const fresh = defaultBrief();
  fresh.fleet[0].count = 5;
  assertEq([DEFAULT_BRIEF.fleet[0].count, fleetTotal(fresh), briefLine(fresh)], [4, 21, 'Gale landing pad & access road · 21 robots']);
  assertEq(briefLine({ ...fresh, name: '  ', fleet: [{ id: 1, role: 'Survey', count: 1, active: 1 }] }), 'Untitled project · 1 robot');
});

test('quantity modes', () => {
  // unknown needs nothing, even with an earlier value kept for when the mode changes back
  assertEq(quantityError({ mode: 'unknown', unit: 'm²' }), null);
  assertEq(quantityError({ mode: 'unknown', value: -1, unit: 'm²' }), null);
  // known needs a value above zero
  assertEq(quantityError({ mode: 'known', value: 20000, unit: 'm²' }), null);
  for (const v of [undefined, null, '', 0, -5, NaN]) assertEq(quantityError({ mode: 'known', value: v, unit: 'm²' }), ERRORS.known, 'known ' + v);
  // range needs both ends above zero and min ≤ max
  assertEq(quantityError({ mode: 'range', min: 10000, max: 30000, unit: 'm²' }), null);
  assertEq(quantityError({ mode: 'range', min: 500, max: 500, unit: 'm' }), null);
  for (const [min, max] of [[30, 10], [0, 10], [undefined, 10], [10, undefined], [-1, 4]]) {
    assertEq(quantityError({ mode: 'range', min, max, unit: 'm' }), ERRORS.range, 'range ' + min + '–' + max);
  }
  // operating time cannot exceed one sol
  assertEq(SOL_HOURS, 24.65);
  assertEq(quantityError({ mode: 'known', value: 24.65, unit: 'h / sol' }, { max: SOL_HOURS }), null);
  assertEq(quantityError({ mode: 'known', value: 25, unit: 'h / sol' }, { max: SOL_HOURS }), ERRORS.hours);
  assertEq(quantityError({ mode: 'range', min: 8, max: 25, unit: 'h / sol' }, { max: SOL_HOURS }), ERRORS.hours);
  assertEq(ERRORS.range, 'Enter a positive range with the minimum no greater than the maximum.');
  assertEq(ERRORS.hours, 'Operating time cannot exceed one Mars day (about 24.65 hours).');
  // the words for each mode: unknown never reads as zero
  assertEq(qtext({ mode: 'unknown', value: 20000, unit: 'm²' }), 'Unknown');
  assertEq(qtext({ mode: 'range', min: 10000, max: 30000, unit: 'm²' }), '10,000–30,000 m²');
  assertEq(qtext({ mode: 'known', value: 12, unit: 'h / sol' }), '12 h / sol');
  assertEq([qtext({ mode: 'known', value: 1, unit: 'hours' }), qtext({ mode: 'known', value: 2, unit: 'hours' })], ['1 hour', '2 hours']);
  assertEq(qtext({ mode: 'known', value: 12, unit: 'h / sol' }, 'hours per sol'), '12 hours per sol');
  // the tab that holds a bad value says so, and the others pass
  const b = defaultBrief();
  b.q.area = { ...b.q.area, mode: 'range', min: 3, max: 1 };
  b.q.hours = { ...b.q.hours, value: 30 };
  assertEq([tabError(b, 0), tabError(b, 1), tabError(b, 2)], [ERRORS.range, null, ERRORS.hours]);
  const c = defaultBrief();
  assertEq([0, 1, 2, 3].map((t) => tabError(c, t)), [null, null, null, null]);
  assertEq(tabError({ ...c, name: ' ' }, 0), ERRORS.name);
  assertEq(tabError({ ...c, types: [] }, 0), ERRORS.types);
  assertEq(tabError({ ...c, types: ['Other'], other: '' }, 0), ERRORS.other);
  assertEq(tabError({ ...c, fleet: [] }, 1), ERRORS.fleet);
  for (const f of [{ count: 2, active: 3 }, { count: 1.5, active: 1 }, { count: -1, active: 0 }]) {
    assertEq(tabError({ ...c, fleet: [{ id: 1, role: 'Survey', ...f }] }, 1), ERRORS.counts, JSON.stringify(f));
  }
  assertEq(tabError({ ...c, jobs: { map: false, progress: false, inspection: false, plan: false } }, 2), ERRORS.jobs);
  assertEq(tabError({ ...c, q: { ...c.q, road: { mode: 'known', unit: 'm' } } }, 0), ERRORS.known); // a road is built: its length counts
  assertEq(tabError({ ...c, types: ['Landing pad'], q: { ...c.q, road: { mode: 'known', unit: 'm' } } }, 0), null); // no road: not asked
  assertEq(tabError(b, 3), ERRORS.range); // the review checks every tab, the first problem first
});

test('review lists what is still to confirm', () => {
  const b = defaultBrief();
  assertEq(stillToConfirm(b), ['Survey area', 'Road length', 'Project duration', 'Data retention']);
  assertEq(stillToConfirmText(b), 'Survey area, Road length, Project duration, Data retention');
  assertEq(stillToConfirm({ ...b, types: ['Landing pad'] }), ['Survey area', 'Project duration', 'Data retention']); // no road
  b.q.area = { ...b.q.area, mode: 'known', value: 20000 };
  b.q.hours = { ...b.q.hours, mode: 'unknown' };
  b.q.deadline = { ...b.q.deadline, mode: 'unknown' };
  assertEq(stillToConfirm(b), ['Road length', 'Operating schedule', 'Turnaround', 'Project duration', 'Data retention']);
  const all = defaultBrief();
  for (const k of Object.keys(all.q)) all.q[k] = { ...all.q[k], mode: 'known', value: 5 };
  assertEq(stillToConfirmText(all), 'No unanswered quantity fields');
  assertEq(reviewRows(defaultBrief()), [['Construction', 'Landing pad, Road'], ['Work schedule', '12 hours per sol'],
    ['Results needed', '1 hour'], ['Still to confirm', 'Survey area, Road length, Project duration, Data retention']]);
  assertEq(REVIEW_FACTORS, ['Buildable terrain', 'Ground & ice evidence', 'Solar conditions', 'Thermal conditions', 'Investigation routes']);
});

test('brief panel: a label on every control, robot groups added and removed by name, focus kept across tabs', () => {
  const el = document.createElement('section'), side = document.createElement('aside');
  document.body.append(el, side);
  let brief = defaultBrief(), tab = 0, done = 0;
  const ui = createBrief(el, side, { onChange: (b) => { brief = b; }, onTab: (t) => { tab = t; }, onDone: () => { done += 1; } });
  try {
    ui.open(brief, 0);
    const labelled = (c) => c.labels.length > 0 || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby');
    const unlabelled = () => [...el.querySelectorAll('input, select, textarea')].filter((c) => !labelled(c)).map((c) => c.outerHTML.slice(0, 80));
    assertEq(unlabelled(), []);
    assertEq([...el.querySelectorAll('.tabs [data-tab]')].map((t) => t.textContent), ['Project', 'Robots', 'Operations', 'Review']);
    assertEq(el.querySelector('.tabs [aria-current="step"]').dataset.tab, '0');
    assertEq([...el.querySelectorAll('select[data-mode]')].map((s) => [s.getAttribute('aria-label'), s.value]),
      [['Survey area certainty', 'unknown'], ['Road length certainty', 'unknown']]);
    // the name is kept as typed, and the summary beside the tabs follows
    const name = el.querySelector('#brief-name');
    name.value = 'Pad B';
    name.dispatchEvent(new Event('input'));
    assertEq(brief.name, 'Pad B');
    // a known area asks for its value with its unit, and keeps the example when switched back
    const mode = el.querySelector('select[data-mode="area"]');
    mode.value = 'range';
    mode.dispatchEvent(new Event('change'));
    assertEq([...el.querySelectorAll('input[data-q="area"]')].map((i) => i.getAttribute('aria-label')), ['Survey area minimum', 'Survey area maximum']);
    // the Robots tab, focus on its tab button
    el.querySelector('.tabs [data-tab="1"]').focus();
    el.querySelector('.tabs [data-tab="1"]').click();
    assertEq([tab, document.activeElement && document.activeElement.dataset.tab], [1, '1']);
    assertEq(unlabelled(), []);
    const rows = () => [...el.querySelectorAll('.robot-row')].map((r) => [r.querySelector('select').value, ...[...r.querySelectorAll('input')].map((i) => i.value)]);
    assertEq(rows(), [['Survey', '4', '4'], ['Excavation', '10', '8'], ['Transport', '6', '4']]);
    assertEq([...el.querySelectorAll('[data-remove]')].map((b) => b.getAttribute('aria-label')), ['Remove Survey group', 'Remove Excavation group', 'Remove Transport group']);
    const total = el.querySelector('input[data-prop="count"]');
    total.value = '5';
    total.dispatchEvent(new Event('input'));
    assertEq([fleetTotal(brief), el.querySelector('[data-total]').textContent], [21, '21']);
    assertEq(side.querySelector('[data-summary="Robots"]').textContent, '21 total');
    el.querySelector('[data-add]').click();
    assertEq(rows().length, 4);
    assertEq(document.activeElement, el.querySelector('.robot-row:last-child select')); // the new group, ready to set
    el.querySelector('.robot-row:last-child [data-remove]').click();
    assertEq([rows().length, fleetTotal(brief)], [3, 21]);
    // Continue keeps focus on Continue in the next tab; Back goes back
    el.querySelector('#brief-next').focus();
    el.querySelector('#brief-next').click();
    assertEq([tab, document.activeElement && document.activeElement.id], [2, 'brief-next']);
    assertEq(unlabelled(), []);
    el.querySelector('#brief-back').click();
    assertEq(tab, 1);
    // an invalid value blocks Continue with its correction
    total.value = '1';
    const t2 = el.querySelector('input[data-prop="count"]');
    t2.value = '1';
    t2.dispatchEvent(new Event('input'));
    el.querySelector('#brief-next').click();
    assertEq([tab, el.querySelector('.alert').textContent], [1, ERRORS.counts]);
    t2.value = '4';
    t2.dispatchEvent(new Event('input'));
    for (let i = 0; i < 2; i++) el.querySelector('#brief-next').click();
    assertEq(tab, 3);
    assert(el.textContent.includes('Review before sizing'), 'the review');
    el.querySelector('#brief-next').click(); // Continue from the review: on to the facility step
    assertEq(done, 1);
  } finally { el.remove(); side.remove(); }
});

// ---- status labels (Task 9b) ----
test('status label texts', () => {
  const r = (o) => computed(o.id || 'BT-04', o);
  const met = statusLabel(r({ value: 0.4, display: '0.4°', status: STATUS.MET, ideal: true, target: { baseline: '≤ 5°', ideal: '≤ 2°' } }));
  assertEq([met.text, met.kind, met.icon, met.ideal], ['Meets screening criterion', 'met', '✓', true]);
  assertEq(statusLabel(r({ value: 4, display: '4.0°', status: STATUS.MET, ideal: false })).ideal, false);
  const bad = statusLabel(r({ value: 6.4, display: '6.4°', status: STATUS.NOT_MET, target: { baseline: '≤ 5°', ideal: '≤ 2°' } }));
  assertEq([bad.text, bad.kind, bad.icon, bad.plot], ['Pad slope 6.4° over the 5° target', 'conflict', '✗', 'compound']);
  const fit = statusLabel(r({ id: 'SC-10', value: 92, display: '92%', status: STATUS.NOT_MET, target: { baseline: '100%', ideal: '100%' } }));
  assertEq([fit.text, fit.plot], ['Array fit 92% under the 100% target', 'solar']);
  const ratio = statusLabel(r({ id: 'BT-01', value: 0.8, display: '0.80', status: STATUS.NOT_MET, target: { baseline: '≥ 1.0', ideal: '≥ 1.3' } }));
  assertEq([ratio.text, ratio.plot], ['Connected area ratio 0.80 under the 1.0 target', null]);
  assertEq(statusLabel(r({ status: STATUS.NEEDS_FIELDWORK })).text, 'Unresolved: needs fieldwork');
  assertEq(statusLabel(r({ status: STATUS.NEEDS_DESIGN_INPUT })).text, 'Unresolved: needs design input');
  const data = statusLabel(r({ status: STATUS.NEEDS_CONFIRMATION }));
  assertEq([data.text, data.kind, data.icon], ['Unresolved: needs data', 'unresolved', '?']);
  const na = statusLabel(r({ status: STATUS.NOT_APPLICABLE, note: 'no solar plot in this power option' }));
  assertEq([na.text, na.kind, na.icon], ['Not applicable: no solar plot in this power option', 'na', '—']);
  assertEq(statusLabel(r({ status: STATUS.NOT_APPLICABLE })).text, 'Not applicable');
});

test('footprint colours follow their own checks only', () => {
  const res = (pairs) => new Map(pairs.map(([id, status]) => [id, computed(id, { status })]));
  const ok = [['BT-02', STATUS.MET], ['BT-04', STATUS.MET], ['BT-05', STATUS.MET], ['SC-10', STATUS.MET], ['TC-08', STATUS.MET]];
  assertEq(footprintStatus(res(ok)), { compound: 'met', solar: 'met', radiator: 'met' });
  const steep = res([...ok.slice(0, 2), ['BT-05', STATUS.NOT_MET], ...ok.slice(3), ['BT-21', STATUS.NOT_MET]]);
  assertEq(footprintStatus(steep), { compound: 'conflict', solar: 'met', radiator: 'met' }); // BT-21 is no plot's
  const open = res([['BT-02', STATUS.MET], ['BT-04', STATUS.NEEDS_FIELDWORK], ['BT-05', STATUS.MET], ['SC-10', STATUS.NEEDS_CONFIRMATION]]);
  assertEq(footprintStatus(open), { compound: 'unresolved', solar: 'unresolved', radiator: 'unresolved' }); // TC-08 missing
});

test('nextCheck: the first critical unknown and what settles it', () => {
  const row = { criticalUnknowns: ['BT-08', 'GI-01'] };
  assertEq(nextCheck(row, metrics), { id: 'BT-08', name: 'Detrended roughness', settledBy: 'Measure finer surface irregularities' });
  assertEq(nextCheck({ criticalUnknowns: [] }, metrics), null);
  assertEq(nextCheck(null, metrics), null);
});

// ---- references (Task 9c: the credits' helper moved into ui/references.js) ----
test('ui credits: references of the given datasets, each once, in order', () => {
  const catalog = {
    byId: new Map([['a', { id: 'a', references: ['r1', 'r2'] }], ['b', { id: 'b', references: ['r2', 'r3', 'nope'] }]]),
    raw: { references: { r1: { title: 'One' }, r2: { title: 'Two' }, r3: { title: 'Three' } } },
  };
  assertEq(referencesFor(catalog, ['a', 'b', 'missing']).map((r) => r.id + ':' + r.title), ['r1:One', 'r2:Two', 'r3:Three']);
});

test('ui card DOM: five factor rows, notices for problems, critical marks, and open groups kept across re-renders', () => {
  const el = document.createElement('section');
  let backs = 0;
  const views = [];
  const card = createCard(el, { onBack: () => { backs += 1; }, onView: (id) => views.push(id), hasView: (id) => id === 'BT' });
  const problems = [
    { kind: 'data_failed', datasetId: 'rough_a', message: 'rough_a failed to load: HTTP 404 for rough_a.f32' },
    { kind: 'data_failed', message: 'BT-08 at s1: no dataset in the catalog' },
    { kind: 'imagery_incomplete', datasetId: 'imagery_hirise_gray', message: 'HiRISE imagery missing over 12% of the site; those parts are coloured by elevation' },
  ];
  card.render(fixture(), { problems, regionName: 'Region R', setup: TOPUP, names: new Map([['s1', 'Site one (flat floor)']]), metrics,
    brief: 'Gale landing pad & access road · 20 robots' });
  assertEq(el.dataset.site, 's1');
  assertEq(el.querySelector('.card-head .brief-line').textContent, 'Gale landing pad & access road · 20 robots'); // the brief's name (Task 9d)
  assertEq([...el.querySelectorAll('.factor')].map((f) => f.dataset.factor), ['BT', 'GI', 'SC', 'TC', 'IR']);
  assertEq([...el.querySelectorAll('.factor .f-name')].map((f) => f.textContent), ['Terrain', 'Ground & ice', 'Solar', 'Thermal', 'Routes']);
  const bt = el.querySelector('.factor[data-factor="BT"]');
  assertEq([bt.querySelector('.f-icon').textContent, bt.querySelector('.f-text').textContent], ['✗', 'too steep in places under the compound']);
  assertEq(el.querySelector('.card-head .verdict').textContent, 'Not recommended: too steep in places under the compound');
  // Details hold Task 9's metric lines, by factor, with the facility line and the drag help in Terrain's
  const det = bt.querySelector(':scope > details');
  assert(det && !det.open && det.querySelector('summary').textContent === 'Details', 'a closed Details disclosure');
  assertEq([...det.querySelectorAll('[data-section]')].map((x) => x.dataset.section), ['met', 'failed', 'open']);
  assert(det.querySelector('.facility') && det.querySelector('.howto'), 'facility line and drag help in Terrain Details');
  assertEq(det.querySelector('.facility .illustrative').textContent, FACILITY_LABEL); // the same label wherever the facility appears (Task 9d)
  assertEq(el.querySelectorAll('.card-body > .facility, .card-body > .howto').length, 0);
  // the View button where a view is registered (Task 12 adds the others), and it asks for that view
  assertEq([...el.querySelectorAll('.factor .view')].map((b) => b.closest('.factor').dataset.factor), ['BT']);
  bt.querySelector('.view').click();
  assertEq(views, ['BT']);
  const notes = [...el.querySelectorAll('.notice')].map((n) => n.textContent);
  assertEq(notes, [
    '⚠ rough_a failed to load: HTTP 404 for rough_a.f32.',
    '⚠ Data failed to load: detrended roughness at s1: no dataset in the catalog.', // metric ids stay inside Details
    '⚠ HiRISE imagery missing over 12% of the site; those parts are coloured by elevation.',
  ]);
  assertEq(el.querySelectorAll('.notice.bad').length, 2);
  assertEq([...el.querySelectorAll('.line.critical')].map((l) => l.dataset.metric).sort(), ['BT-08', 'GI-01']);
  assert(el.querySelector('.line[data-metric="BT-02"] .note.bad').textContent === 'data failed to load', 'failed data in red');
  assertEq(el.querySelector('.line[data-metric="BT-04"] .words').textContent, 'Meets screening criterion');
  assertEq(el.querySelector('.line[data-metric="BT-04"] .badge-ideal').textContent, 'ideal');
  assertEq(el.querySelector('.line[data-metric="BT-04"] .st-icon').textContent, '✓'); // never colour alone
  assert(/on the compound/.test(el.querySelector('.line[data-metric="BT-05"]').textContent), 'the Failed line names the plot');
  assert(el.querySelector('.line[data-metric="BT-05"]').closest('.factor').dataset.factor === 'BT', 'lines sit in their factor');
  assert(el.querySelector('.line[data-metric="GI-01"]').closest('.factor').dataset.factor === 'GI', 'lines sit in their factor');
  const next = el.querySelector('[data-section="next"] .next-check');
  assert(/Detrended roughness/.test(next.textContent) && !/BT-08/.test(next.textContent), next.textContent); // name, no id
  assert(/Back to Region R/.test(el.querySelector('.back').textContent));
  el.querySelector('.back').click();
  assertEq(backs, 1);
  const g = el.querySelector('details[data-group="GI:open:fieldwork"]');
  assert(g && !g.open, 'groups start closed');
  g.open = true;
  g.dispatchEvent(new Event('toggle'));
  det.open = true;
  det.dispatchEvent(new Event('toggle'));
  card.render(fixture(), { problems: [], regionName: 'Region R', setup: TOPUP, metrics });
  assert(el.querySelector('details[data-group="GI:open:fieldwork"]').open, 'still open after a re-render');
  assert(el.querySelector('.factor[data-factor="BT"] > details').open, 'Details still open after a re-render');
  assertEq(el.querySelectorAll('.notice').length, 0);
  card.clear();
  assertEq(el.childElementCount, 0);
});

// ---- region pin cards stay on the map (Task 9b fix round 1) ----
test('placeCard: inside the map, clear of the keep-outs and of placed cards, else pushed back with a leader', () => {
  const map = { x: 0, y: 0, w: 880, h: 720 }, card = { w: 240, h: 46 };
  const box = (at) => ({ x: at.x, y: at.y, w: card.w, h: card.h });
  const inMap = (b) => b.x >= 6 && b.y >= 6 && b.x + b.w <= 874 && b.y + b.h <= 714;
  const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const upper = placeCard({ x: 300, y: 200 }, card, map); // room on the right: right of the dot, hanging up
  assert(upper.x > 300 && upper.y + card.h <= 200 + 6 && !upper.leader, JSON.stringify(upper));
  const lower = placeCard({ x: 300, y: 500 }, card, map); // lower half: hanging down
  assert(lower.x > 300 && lower.y >= 500 - 6 && !lower.leader, JSON.stringify(lower));
  const edge = placeCard({ x: 830, y: 160 }, card, map); // too near the right edge: flips to the left of the dot
  assert(edge.x + card.w < 830 && inMap(box(edge)), JSON.stringify(edge));
  const controls = { x: 790, y: 470, w: 92, h: 200 };
  const near = placeCard({ x: 600, y: 560 }, card, map, [controls]); // the right side would run under the buttons
  assert(inMap(box(near)) && !hits(box(near), controls) && !near.leader, JSON.stringify(near));
  const first = placeCard({ x: 300, y: 200 }, card, map);
  const second = placeCard({ x: 320, y: 210 }, card, map, [], [box(first)]); // a neighbour's card is avoided when it can be
  assert(!hits(box(second), box(first)), JSON.stringify([first, second]));
  const wide = { w: 860, h: 200 }; // nothing fits: pushed back inside the map and off the keep-out, with a leader
  const forced = placeCard({ x: 700, y: 600 }, wide, map, [{ x: 800, y: 500, w: 70, h: 210 }]);
  assert(forced.leader && forced.x >= 6 && forced.y >= 6 && forced.x + wide.w <= 874 && forced.y + wide.h <= 714, JSON.stringify(forced));
  assert(!hits({ x: forced.x, y: forced.y, ...wide }, { x: 800, y: 500, w: 70, h: 210 }), JSON.stringify(forced));
});

// ---- plain words first (Task 9c) ----
const ID_RE = /\b(BT|GI|SC|TC|IR)-\d\d\b/;

test('plainVerdict for failing, unresolved and clean sites', () => {
  assertEq(FACTORS, [
    { id: 'BT', name: 'Terrain', doc: 'Buildable terrain' }, { id: 'GI', name: 'Ground & ice', doc: 'Ground and ice evidence' },
    { id: 'SC', name: 'Solar', doc: 'Solar conditions' }, { id: 'TC', name: 'Thermal', doc: 'Thermal conditions' },
    { id: 'IR', name: 'Routes', doc: 'Investigation routes' },
  ]);
  // the brief's phrases, kept in reading order: the ground conditions before the fits they cause
  assertEq(Object.entries(PLAIN), [
    ['BT-05', 'too steep in places under the compound'], ['BT-04', 'the building pad is too tilted'],
    ['BT-08', 'too rough under the layout'], ['BT-06', 'too much grading needed'],
    ['BT-02', "the layout doesn't fit on usable ground"], ['SC-10', "the solar plot doesn't fit on usable ground"],
    ['TC-08', "the radiator plot doesn't fit on usable ground"], ['BT-01', 'not enough connected flat ground'],
    ['BT-21', 'the cable route to the base is too long'],
  ]);
  const v = (failures, criticalUnknowns = []) => plainVerdict({ failures, criticalUnknowns }, new Map(), metrics);
  assertEq(v(['BT-01', 'BT-02', 'BT-05', 'BT-08', 'SC-10', 'TC-08']),
    'Not recommended: too steep in places under the compound and too rough under the layout, and 4 more');
  assertEq(v(['BT-21', 'BT-04', 'TC-08']), "Not recommended: the building pad is too tilted and the radiator plot doesn't fit on usable ground, and 1 more");
  assertEq(v(['BT-21', 'BT-02']), "Not recommended: the layout doesn't fit on usable ground and the cable route to the base is too long");
  assertEq(v(['SC-10']), "Not recommended: the solar plot doesn't fit on usable ground");
  assertEq(v(['GI-01']), 'Not recommended: bearing-capacity adequacy'); // no phrase yet: the metric's name, lowercased
  assertEq(v([], ['BT-08', 'BT-10', 'GI-01', 'SC-05']), 'No failures; 3 factors still need field checks');
  assertEq(v([], ['GI-01']), 'No failures; 1 factor still needs field checks');
  assertEq(v([]), 'No failures found from orbit');
  // before the region is ranked, the site's own Results say the same
  const res = new Map([['BT-05', computed('BT-05', { status: STATUS.NOT_MET })], ['GI-01', computed('GI-01', { status: STATUS.NEEDS_FIELDWORK })]]);
  assertEq(plainVerdict(null, res, metrics), 'Not recommended: too steep in places under the compound');
  for (const t of [v(['BT-01', 'BT-02', 'BT-05']), v([], ['GI-01'])]) assert(!ID_RE.test(t), t);
});

test('factorSentence per status', () => {
  const base = initialStatuses(metrics, TOPUP);
  const orbital = (f) => metrics.filter((m) => m.factor === f && m.availability === 'estimate_today').map((m) => m.id);
  const met = new Map(base);
  for (const id of orbital('BT')) met.set(id, computed(id, { value: 1, display: '1' }));
  assertEq(factorSentence('BT', met, metrics), { icon: '✓', text: 'meets the screening criteria' });
  const bad = new Map(met);
  bad.set('BT-05', computed('BT-05', { value: 14.2, status: STATUS.NOT_MET }));
  bad.set('BT-02', computed('BT-02', { value: 66, status: STATUS.NOT_MET }));
  assertEq(factorSentence('BT', bad, metrics), { icon: '✗', text: "too steep in places under the compound and the layout doesn't fit on usable ground" });
  bad.set('BT-21', computed('BT-21', { value: 3000, status: STATUS.NOT_MET }));
  assertEq(factorSentence('BT', bad, metrics).text,
    "too steep in places under the compound, the layout doesn't fit on usable ground and the cable route to the base is too long");
  // a field result that fails counts too, whatever the metric's availability
  const gi = new Map(base).set('GI-01', computed('GI-01', { status: STATUS.NOT_MET, evidence: 'observation' }));
  assertEq(factorSentence('GI', gi, metrics), { icon: '✗', text: 'bearing-capacity adequacy' });
  // unresolved: what settles it, counted, first one named
  assertEq(factorSentence('GI', base, metrics), { icon: '?', text: 'not settled from orbit: 9 field checks, starting with bearing-capacity adequacy' });
  assertEq(factorSentence('BT', base, metrics), { icon: '?', text: 'not settled from orbit: 11 field checks, starting with required spatial connections' });
  const one = new Map(base);
  for (const id of ['TC-01', 'TC-06', 'TC-10']) one.set(id, computed(id, { status: STATUS.MET }));
  assertEq(factorSentence('TC', one, metrics).text, 'not settled from orbit: 1 field check, starting with model validation utilization');
  const data = new Map(base); // IR's field checks done, its one orbital estimate not computed yet
  for (const id of ['IR-03', 'IR-12', 'IR-14']) data.set(id, computed(id, { status: STATUS.MET }));
  assertEq(factorSentence('IR', data, metrics), { icon: '?', text: 'not settled from orbit: estimates still need data' });
  // nothing applies: no solar plot under base power only
  assertEq(factorSentence('SC', initialStatuses(metrics, { loadKw: 150, power: 'base_only' }), metrics), { icon: '—', text: 'not applicable here' });
});

test('plainWhy says which step placed the site, in plain words', () => {
  const names = new Map([['a', 'Site A (flat)'], ['b', 'Site B'], ['c', 'Site C']]);
  const r = (siteId, priority, step, o = {}) => ({ siteId, priority, step, failures: [], criticalUnknowns: [], equalWith: [], tradeoff: null, ...o });
  const crit = (n) => Array.from({ length: n }, (_, i) => 'XX-' + String(i).padStart(2, '0'));
  const step2 = [r('a', 1, 2, { criticalUnknowns: crit(29) }), r('c', 2, 2, { criticalUnknowns: crit(30) })];
  assertEq(plainWhy(step2[0], { rows: step2, names }), 'Fewer unresolved checks than Site C (29 against 30).');
  assertEq(plainWhy(step2[1], { rows: step2, names }), 'More unresolved checks than Site A (30 against 29).');
  const vals = (g, c) => new Map([['BT-06', computed('BT-06', { value: g })], ['BT-21', computed('BT-21', { value: c })]]);
  const results = new Map([['a', vals(0.54, 634)], ['b', vals(0.62, 837)]]);
  const step3 = [r('a', 1, 3), r('b', 2, 3)];
  assertEq(plainWhy(step3[0], { rows: step3, results, names }), 'Less grading and a shorter cable than Site B.');
  assertEq(plainWhy(step3[1], { rows: step3, results, names }), 'More grading and a longer cable than Site A.');
  const step4 = [r('a', 1, 4, { equalWith: ['b'], tradeoff: 'less grading, longer cable' }), r('b', 1, 4, { equalWith: ['a'], tradeoff: 'more grading, shorter cable' })];
  assertEq(plainWhy(step4[0], { rows: step4, names }), 'No rule separates it from Site B; the trade-off: less grading, longer cable.');
  const step1 = [r('a', 1, 2), r('b', 2, 1, { failures: ['BT-05'] })];
  assertEq(plainWhy(step1[1], { rows: step1, names }), "It fails a requirement, so it ranks below every site that doesn't.");
  assertEq(plainWhy(step1[0], { rows: step1, names }), 'No failures, while Site B fails a requirement.');
  assertEq(plainWhy(r('a', 1, 2), { rows: [r('a', 1, 2)], names }), 'It is the only candidate in this region.');
});

// The text a reader sees with every disclosure closed: anything inside a closed <details> but outside its summary is hidden.
function visibleText(root) {
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    let hidden = false;
    for (let e = n.parentElement; e && e !== root.parentElement; e = e.parentElement) {
      if (e.tagName !== 'DETAILS' || e.open) continue;
      const sum = e.querySelector(':scope > summary');
      if (!(sum && sum.contains(n))) { hidden = true; break; }
    }
    if (!hidden && n.textContent.trim()) out.push(n.textContent.trim());
  }
  return out.join(' | ');
}

test('no factor codes outside Details', () => {
  const failing = fixture();
  const clean = (() => {
    const terrain = new Map([['BT-04', computed('BT-04', { value: 0.4, display: '0.4°', target: { baseline: '≤ 5°', ideal: '≤ 2°', label: 'P' } })]]);
    const results = mergeResults(initialStatuses(metrics, TOPUP), terrain, []);
    const row = { siteId: 's1', priority: 1, step: 4, whyHere: 'No failures; 2 critical unknowns; same priority as s2 (trade-off: less grading, longer cable).',
      failures: [], criticalUnknowns: ['BT-08', 'GI-01'], equalWith: ['s2'], tradeoff: 'less grading, longer cable', verdict: 'no requirement fails; 2 critical unknowns' };
    const site = { id: 's1', name: 'Site one (flat floor)', regionId: 'r', grids: {}, loadErrors: {} };
    const peer = { ...row, siteId: 's2', equalWith: ['s1'], tradeoff: 'more grading, shorter cable' };
    return cardModel({ site, results, row, metrics, setup: TOPUP, catalog: { byId: new Map() }, rows: [row, peer], names: new Map([['s2', 'Site two']]) });
  })();
  for (const m of [failing, clean]) {
    const outside = [m.verdict, m.why.plain, m.nextCheck && m.nextCheck.name, m.nextCheck && m.nextCheck.settledBy,
      ...m.factors.flatMap((f) => [f.name, f.text]), ...m.warnings.map((w) => w.text)];
    for (const t of outside) assert(!ID_RE.test(t || ''), 'a metric id outside Details: ' + t);
    const el = document.createElement('section');
    createCard(el, { onBack() {} }).render(m, { regionName: 'Region R', setup: TOPUP, metrics, problems: [{ kind: 'data_failed', message: 'BT-08 at s1: no dataset in the catalog' }] });
    const seen = visibleText(el), hit = seen.match(new RegExp('.{0,60}' + ID_RE.source + '.{0,20}'));
    assert(!hit, 'visible text has a metric id: ' + (hit && hit[0]));
    assert(/Terrain/.test(seen) && /Why this priority/.test(seen) && /Next check/.test(seen), seen);
    for (const d of el.querySelectorAll('details')) d.open = true; // expert detail on demand: the ids are there
    assert(/BT-04/.test(visibleText(el)) && /GI-01/.test(visibleText(el)), 'Details list the metric ids');
  }
  assertEq(clean.verdict, 'No failures; 2 factors still need field checks');
  assertEq(clean.why.plain, 'No rule separates it from Site two; the trade-off: less grading, longer cable.');
  assert(/same priority as s2/.test(clean.why.text), 'the technical text stays for the Details');
});

test('registerView: unregistered views are not in the bar', () => {
  const reg = createViewRegistry();
  const calls = [];
  const view = (id, key) => ({ apply: (ctx) => calls.push('apply ' + id + ' ' + ctx.regionId), clear: () => calls.push('clear ' + id), key: () => key });
  reg.register('BT', view('BT', { text: 'Slope key.', source: 'From a grid (derived).', missing: false }));
  reg.register('photo', view('photo', { text: 'Photo key.', source: '', missing: false }));
  const el = document.createElement('nav');
  const asked = [];
  const bar = createFactorBar(el, { registry: reg, onView: (id) => asked.push(id) });
  const ctx = { globe: null, siteView: null, site: null, regionId: 'gale' };
  const segs = () => [...el.querySelectorAll('.seg')].map((b) => [b.dataset.view, b.querySelector('.seg-name').textContent, b.getAttribute('aria-pressed')]);
  bar.render({ show: true, view: 'photo', ctx, results: null, metrics });
  assertEq(segs(), [['photo', 'Photo', 'true'], ['BT', 'Terrain', 'false']]); // only what is registered, in the bar's order
  assertEq(el.querySelector('.view-key').textContent, 'Photo key.');
  assertEq(calls, ['apply photo gale']);
  el.querySelector('.seg[data-view="BT"]').click();
  assertEq(asked, ['BT']);
  bar.render({ show: true, view: 'BT', ctx, results: null, metrics });
  assertEq(calls, ['apply photo gale', 'clear photo', 'apply BT gale']);
  assertEq(el.querySelector('.view-key').textContent, 'Slope key. From a grid (derived).');
  bar.render({ show: true, view: 'BT', ctx: { ...ctx }, results: null, metrics }); // the same view and place: nothing re-applied
  assertEq(calls.length, 3);
  bar.render({ show: true, view: 'SC', ctx, results: null, metrics }); // not registered: the photo view
  assertEq(segs().map((x) => x[2]), ['true', 'false']);
  assertEq(calls.slice(3), ['clear BT', 'apply photo gale']);
  // Task 12 registers a view: it takes its place in the bar, with nothing else changed
  reg.register('GI', view('GI', { text: 'No ground-ice data here: needs confirmation', source: '', missing: true }));
  bar.render({ show: true, view: 'GI', ctx: { ...ctx, siteView: {}, site: {} }, results: initialStatuses(metrics, TOPUP), metrics });
  assertEq(segs().map((x) => x[0] + ':' + x[2]), ['photo:false', 'BT:false', 'GI:true']);
  assert(el.querySelector('.view-key').classList.contains('missing'), 'no data reads as missing, never as fine');
  // with a site open each factor segment carries its icon, so a failing or unresolved factor shows at a glance
  assertEq([...el.querySelectorAll('.seg')].map((b) => (b.querySelector('.seg-icon') || {}).textContent || ''), ['', '?', '?']);
  assert(/Terrain: unresolved/.test(el.querySelector('.seg[data-view="BT"]').getAttribute('aria-label')), 'the icon has words');
  bar.render({ show: false, view: 'GI', ctx, results: null, metrics }); // the whole globe: no bar, the photo view
  assert(el.hidden, 'hidden off the region and site views');
  assertEq(calls.slice(-2), ['clear GI', 'apply photo gale']);
});

test('terrain view: slope classes, and the study legend read back to degrees', () => {
  assertEq([0, 4.9, 5, 5.01, 10, 10.01, 31].map(slopeClass), [0, 0, 0, 1, 1, 2, 2]); // ≤ 5° green, 5–10° amber, > 10° red
  assertEq(slopeClass(NaN), -1); // no value: no colour, never green
  const stops = [[0, '#1a9850'], [10, '#fee08b'], [20, '#f46d43'], [35, '#a50026']];
  assertClose(slopeFromLegend(26, 152, 80, stops), 0, 0.01);
  assertClose(slopeFromLegend(254, 224, 139, stops), 10, 0.01);
  assertClose(slopeFromLegend(140, 188, 110, stops), 5, 0.1);
  assertClose(slopeFromLegend(87, 171, 96, stops), 2.7, 0.1); // the commonest Gale study colour
  assertClose(slopeFromLegend(244, 109, 67, stops), 20, 0.01);
  assertClose(slopeFromLegend(165, 0, 38, stops), 35, 0.01);
});
