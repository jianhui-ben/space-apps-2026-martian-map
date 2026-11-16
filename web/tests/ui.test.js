// Pure parts of the construction brief, priority list, site card, chips, references and the factor bar (Tasks 9-9d).
import { STATUS, initialStatuses, mergeResults } from '../src/status.js';
import { regionInView, cameraTarget, factorCells, iconEl, shortName, nextCheck, createList } from '../src/ui/list.js';
import { cardModel, createCard, statusLabel, footprintStatus } from '../src/ui/card.js';
import { resultChips, alignmentCaveat } from '../src/ui/chips.js';
import { facilityLine, facilityEl, facilityLabel, createFacility, createLanding, FACILITY_LABEL } from '../src/ui/landing.js';
import { briefLine, toSizingBrief, intakeError, REVIEW_FACTORS, createBrief } from '../src/ui/brief.js';
import { referencesFor, createReferences } from '../src/ui/references.js';
import { FACTORS, PLAIN, plainVerdict, factorSentence, plainWhy, simulatedEstimate } from '../src/plain.js';
import { createViewRegistry, createFactorBar, slopeFromLegend, demoParts } from '../src/ui/factors.js';
import { simulatedTexture, simulatedKey, SIMULATED_TEXT } from '../src/layers.js';
import { slopeClass } from '../src/site.js';
import { placeCard } from '../src/ui/pins.js';
import { FIXED_SETUP, DEFAULT_BRIEF, defaultBrief } from '../src/state.js';
import { sizeBrief, briefSetup } from '../src/sizing/index.js';
import { loadBundle } from '../src/sizing/engine.js';

const sizingBundle = await loadBundle(new URL('../sizing/screening-v1.json', import.meta.url));
const sizingCases = await (await fetch(new URL('./fixtures/sizing.json', import.meta.url))).json();
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
  // nothing computed yet and no site to seed a simulation: unresolved, never "none apply" and never fine
  assertEq(cells.find((c) => c.factor === 'GI').icon, '?');
  assertEq(cells.find((c) => c.factor === 'BT').icon, '?');
  // before any check has run, a site's factors read "?", not simulated (R36)
  assert(factorCells(res, metrics, 'near_base_north').every((c) => c.icon === '?' && !c.simulated), 'simulated before results');
  // once results exist: a factor with no computed orbital estimate is simulated, and marked so; Terrain has one
  const some = new Map(res).set('BT-04', computed('BT-04', { value: 0.4, display: '0.4°' }));
  const simCells = factorCells(some, metrics, 'near_base_north');
  const simulated = simCells.filter((c) => c.factor !== 'BT');
  assert(simulated.every((c) => c.simulated && /simulated/.test(c.title)), JSON.stringify(simCells.map((c) => c.title)));
  assertEq(simCells.find((c) => c.factor === 'BT').simulated, false);
  const gi = cells.find((c) => c.factor === 'GI');
  assert(/^Ground & ice: /.test(gi.title), gi.title); // the plain name, never the code
  assert(gi.fieldwork > 0 && gi.design > 0, JSON.stringify(gi));
  assert(/fieldwork/.test(gi.title) && /design/.test(gi.title), gi.title);
  const sc = factorCells(initialStatuses(metrics, { loadKw: 150, power: 'base_only' }), metrics).find((c) => c.factor === 'SC');
  assertEq([sc.icon, sc.fieldwork, sc.design], ['—', 0, 0]);
  // each icon is a named image for screen readers (an aria-label on a bare span is not read)
  const el = iconEl(gi);
  assertEq([el.getAttribute('role'), el.getAttribute('aria-label')], ['img', 'Ground & ice: unresolved']);
  // R37: a shape per status, not colour alone; an instant tooltip from factorSentence (no native title); a simulated
  // icon is a dashed hollow ring, still marked "sim"
  assertEq(el.querySelector('svg.st-svg').dataset.shape, '?');
  assert(el.querySelector('svg .dot') && !el.hasAttribute('title') && !el.querySelector('[tabindex]'), el.outerHTML);
  assertEq(el.dataset.tip, 'Ground & ice — ' + factorSentence('GI', res, metrics).text);
  const shapes = ['✓', '✗', '?', '—'].map((i) => iconEl({ ...gi, icon: i }).querySelector('svg'));
  assertEq(shapes.map((v) => [v.dataset.shape, v.querySelectorAll('circle.ring').length]), [['✓', 1], ['✗', 1], ['?', 1], ['—', 0]]);
  assertEq(new Set(shapes.map((v) => v.querySelector('path').getAttribute('d'))).size, 4);
  const simEl = iconEl(simulated[0]);
  assert(simEl.querySelector('svg').classList.contains('sim') && simEl.querySelector('.sim-mark'), simEl.outerHTML);
  assertEq(simEl.dataset.tip, simulated[0].name + ' — simulated for the demo, not a real result');
  assert(!iconEl(simCells.find((c) => c.factor === 'BT')).querySelector('svg').classList.contains('sim'), 'a real result is not dashed');
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

const SIZED_LABEL = 'Calculated from your brief with screening assumptions — not a validated design.';
const sizedSetup = (name) => { const b = sizingCases.find((c) => c.name === name).brief; return briefSetup(sizeBrief(b, sizingBundle), b); };
const textOf = (el) => el.innerText.replace(/\s+/g, ' ').trim();

test('ui facility: the label is the reference label for the reference facility, the sized label for a brief setup', () => {
  assertEq(facilityLabel(FIXED_SETUP), FACILITY_LABEL);
  assertEq(facilityLabel(sizedSetup('example_filled')), SIZED_LABEL);
});

test('ui facility: the compact line for a brief setup names computers, peak kW and the parts', () => {
  const setup = sizedSetup('example_filled');
  assertEq(facilityLine(setup), '11 computers, 8.3 kW peak; compound 18 × 20 m, radiator 8 × 8 m, solar 13 × 13 m'); // 100 Gbps backbone, compact block
  const p = facilityEl(setup, { lead: 'Facility' });
  assert(p.querySelector('.ev-assumption'), 'the assumption chip');
  assertEq(p.querySelector('.illustrative').textContent, SIZED_LABEL);
  assertEq(facilityEl(setup, { label: false }).querySelector('.illustrative'), null);
  assertEq(facilityEl(FIXED_SETUP).querySelector('.illustrative').textContent, FACILITY_LABEL);
});

test('ui facility step: a brief setup lists the calculated facility, kept for the whole project', () => {
  const el = document.createElement('section');
  document.body.append(el);
  try {
    createFacility(el, { setup: () => sizedSetup('example_filled'), onAssess: () => {} }).open();
    const t = textOf(el);
    for (const want of ['11 computers', 'Results are kept for the whole project', SIZED_LABEL, '17 TB', '8.3 kW', '3.5 kW', '85.8 kWh', '87 m²', '174 m²', '48 m²', '71 m²',
      '6.5 kWh', '360 m²', '605 m²', '6.2 kPa']) assert(t.includes(want), 'missing ' + want + ' in: ' + t);
    assert(!t.includes(FACILITY_LABEL) && !t.includes('Sizing model: planned'), 'no reference label or planned line');
    assert(el.querySelectorAll('.ev-assumption').length >= 10, 'every value carries the assumption chip');
    assertEq(el.querySelector('#facility-assess').textContent, 'Assess locations →');
  } finally { el.remove(); }
});

test('ui facility step: ranges show both scenarios and mark the assessed one; compare and inside-the-base lines', () => {
  const show = (name) => { const el = document.createElement('section'); document.body.append(el); createFacility(el, { setup: () => sizedSetup(name), onAssess: () => {} }).open(); const t = textOf(el); el.remove(); return [t, el]; };
  const [ranges] = show('ranges');
  assert(ranges.includes('Lower end of your ranges') && ranges.includes('Upper end of your ranges'), ranges);
  assertEq(ranges.split('Assessed on the map').length, 2);
  assert(ranges.includes('Inside the base: needs the base\'s space and services'), ranges);
  const [inside] = show('inside_base');
  assert(inside.includes('the map still places the dedicated outline'), inside);
  assert(!inside.includes('Inside the base: needs'), inside);
  const [single] = show('example_filled');
  assert(single.includes('Inside the base: needs the base\'s space and services'), single); // compare both is the default
});

test('ui facility step: a base connection says the base supplies the power', () => {
  const el = document.createElement('section');
  document.body.append(el);
  try {
    createFacility(el, { setup: () => sizedSetup('base_connection'), onAssess: () => {} }).open();
    assert(textOf(el).includes('base supplies'), textOf(el));
  } finally { el.remove(); }
});

// ---- the construction brief: the Twin Trails intake (Task 9) ----
const TT_DEFAULTS = { workType: 'earthworks', robots: 20, hours: 12, duration: 180, deadline: 4, name: 'Gale landing pad & access road',
  surveyPercent: 20, excPercent: 50, surveyActive: 100, otherActive: 80, cadence: 'Once per sol', precision: 'Earthworks check',
  rawRetention: 30, productRetention: 180, power: 'Solar + storage', basePower: 0, backup: 12 };

test('brief defaults: the Twin Trails example, frozen in the store default', () => {
  assertEq(defaultBrief(), TT_DEFAULTS);
  assertEq(DEFAULT_BRIEF, TT_DEFAULTS);
  assert(Object.isFrozen(DEFAULT_BRIEF), 'the defaults cannot be changed in place');
  assertEq(briefLine(DEFAULT_BRIEF), 'Gale landing pad & access road · 20 robots');
  assertEq(briefLine({ ...DEFAULT_BRIEF, name: '  ', robots: 1 }), 'Untitled project · 1 robot');
});

test('toSizingBrief: the defaults are an earthworks fleet of 4 survey, 10 excavation and 6 transport robots', () => {
  const b = toSizingBrief(defaultBrief());
  assertEq(b.fleet.map((f) => [f.role, f.count, f.active]), [['Survey', 4, 4], ['Excavation', 10, 8], ['Transport', 6, 4]]);
  assertEq(b.jobs, { map: true, progress: true, inspection: false, plan: true });
  assertEq(b.cadence, { map: 'Once per sol', progress: 'Once per sol', plan: 'Once per sol' });
  assertEq([b.quality, b.power, b.deployment, b.name, b.types], ['Earthworks check', 'Solar + storage', 'Dedicated installation', 'Gale landing pad & access road', []]);
  assertEq(Object.fromEntries(Object.entries(b.q).map(([k, v]) => [k, [v.mode, v.value]])), {
    hours: ['known', 12], duration: ['known', 180], deadline: ['known', 4], retention: ['known', 30], products: ['known', 180],
    backup: ['known', 12], basePower: ['known', 0] });
});

test('toSizingBrief: the defaults are sized; survey work is an all-survey fleet making maps only; a 0.1 h turnaround cannot be sized', () => {
  const s = sizeBrief(toSizingBrief(defaultBrief()), sizingBundle);
  assertEq([s.status, s.missing, s.problems], ['sized', [], []]);
  const survey = toSizingBrief({ ...defaultBrief(), workType: 'survey' });
  assertEq(survey.fleet.map((f) => [f.role, f.count, f.active]), [['Survey', 20, 20]]);
  assertEq(survey.jobs, { map: true, progress: false, inspection: false, plan: false });
  assertEq(sizeBrief(survey, sizingBundle).status, 'sized');
  const tight = sizeBrief(toSizingBrief({ ...defaultBrief(), deadline: 0.1 }), sizingBundle);
  assertEq(tight.status, 'cannot_size');
  assert(tight.problems.length && tight.problems[0].message.startsWith("The results can't be ready within 0.1 hours"), JSON.stringify(tight.problems));
  // the shares round down, and transport takes the remainder; actives round down
  const odd = toSizingBrief({ ...defaultBrief(), robots: 7, surveyPercent: 30, excPercent: 30, surveyActive: 50, otherActive: 50 });
  assertEq(odd.fleet.map((f) => [f.role, f.count, f.active]), [['Survey', 2, 1], ['Excavation', 2, 1], ['Transport', 3, 1]]);
});

test('toSizingBrief: keeping no raw data and no backup are answers, and are sized', () => {
  const s = sizeBrief(toSizingBrief({ ...defaultBrief(), rawRetention: 0, backup: 0 }), sizingBundle);
  assertEq([s.status, s.missing, s.problems], ['sized', [], []]);
});

test('toSizingBrief: 3 earthworks robots leave no survey robot; the reason names the intake fields to change', () => {
  const s = sizeBrief(toSizingBrief({ ...defaultBrief(), robots: 3 }), sizingBundle);
  assertEq(s.status, 'cannot_size');
  assert(s.problems.some((x) => x.message === 'Terrain maps needs Survey robots: raise Construction robots or the robot shares in Planning defaults.'),
    JSON.stringify(s.problems));
});

test('intakeError: the shares, each required number, then base power for hybrid or base-connected operation', () => {
  const d = defaultBrief();
  assertEq(intakeError(d), null);
  assertEq(intakeError({ ...d, surveyPercent: 60, excPercent: 50 }), { message: 'Survey and excavation shares must add up to 100% or less.', key: 'surveyPercent', defaults: true });
  assertEq(intakeError({ ...d, workType: 'survey', surveyPercent: 60, excPercent: 50 }), null); // survey work ignores the shares
  assertEq(intakeError({ ...d, robots: 0 }), { message: 'Construction robots: enter a whole number from 1 to 10,000 robots.', key: 'robots', defaults: false });
  assertEq(intakeError({ ...d, robots: 2.5 }).key, 'robots');
  assertEq(intakeError({ ...d, hours: 25 }), { message: 'Working time: enter a number from 0.1 to 24.65 h / sol.', key: 'hours', defaults: false });
  assertEq(intakeError({ ...d, duration: null }).key, 'duration');
  assertEq(intakeError({ ...d, deadline: 0 }).message, 'Results needed within: enter a number from 0.1 to 8,760 hours.');
  assertEq(intakeError({ ...d, surveyActive: 120 }), { message: 'Survey robots active together: enter a whole number from 0 to 100%.', key: 'surveyActive', defaults: true });
  assertEq(intakeError({ ...d, power: 'Solar + storage', basePower: 0 }), null); // base power applies to hybrid or base connection only
  for (const power of ['Hybrid', 'Base connection']) {
    assertEq(intakeError({ ...d, power, basePower: 0 }), { message: 'Enter the available base power for hybrid or base-connected operation.', key: 'basePower', defaults: true });
    assertEq(intakeError({ ...d, power, basePower: 20 }), null);
  }
});

function intake(extra = {}, state = defaultBrief()) {
  const el = document.createElement('section'), side = document.createElement('aside');
  document.body.append(el, side);
  const seen = { done: 0, close: 0, state: null };
  const ui = createBrief(el, side, { onChange: (s) => { seen.state = s; }, onDone: () => { seen.done += 1; }, onClose: () => { seen.close += 1; }, ...extra });
  ui.open(state);
  const set = (key, value) => {
    const c = el.querySelector('[data-input="' + key + '"]');
    c.value = String(value);
    c.dispatchEvent(new Event(c.tagName === 'SELECT' ? 'change' : 'input'));
  };
  return { el, side, ui, seen, set, find: () => el.querySelector('#brief-find').click(), close: () => { el.remove(); side.remove(); } };
}
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((e) => e.textContent.trim());

test('intake panel: the mockup copy, every control labelled, the defaults filled in, the summary aside unused', () => {
  const p = intake();
  try {
    const el = p.el;
    assertEq(el.querySelector('#brief-title').textContent, 'Construction site');
    assertEq([el.querySelector('#brief-close').textContent, el.querySelector('#brief-close').getAttribute('aria-label')], ['Close', 'Close construction brief']);
    assertEq(el.querySelector('.panel-intro').textContent, 'A few project details. A place to begin.');
    assertEq(texts(el, '.input-section h3'), ['01 · The construction', '02 · The schedule']);
    assertEq(texts(el, '.input-section .field-name'), ['Type of work', 'Construction robots', 'Working time', 'Project duration', 'Results needed within']);
    assertEq(texts(el, '.input-section .required'), Array(5).fill('Required'));
    assertEq([...el.querySelectorAll('[data-input="workType"] option')].map((o) => [o.value, o.textContent]),
      [['earthworks', 'Site preparation & earthworks'], ['survey', 'Surveying & terrain mapping']]);
    const attrs = (k) => { const i = el.querySelector('[data-input="' + k + '"]'); return [i.min, i.max, i.step, i.value, i.nextElementSibling.textContent]; };
    assertEq(['robots', 'hours', 'duration', 'deadline'].map(attrs), [['1', '10000', '1', '20', 'robots'], ['0.1', '24.65', 'any', '12', 'h / sol'],
      ['0.1', '10000', 'any', '180', 'sols'], ['0.1', '8760', 'any', '4', 'hours']]);
    const defaults = el.querySelector('details[data-defaults]');
    assert(!defaults.open, 'the planning defaults start closed');
    assert(defaults.querySelector('summary').textContent.startsWith('Planning defaults · optional to customize'), defaults.querySelector('summary').textContent);
    assert(defaults.querySelector('summary .ev-assumption'), 'the defaults read as assumptions');
    assertEq(defaults.querySelector('summary + p').textContent, 'Change any assumption below. Your edits are used in the calculation.');
    assertEq(texts(defaults, '.default-group h3'), ['Robot mix', 'Processing & retention', 'Power & backup']);
    assertEq(defaults.querySelector('.default-group .sub').textContent, 'Earthworks uses these shares; the remainder is transport. Survey-only work uses an all-survey fleet. Counts round down; transport takes the remainder.');
    assertEq(texts(defaults, '.field-name'), ['Project name', 'Survey share', 'Excavation share', 'Survey robots active together', 'Other robots active together',
      'Processing frequency', 'Processing precision', 'Keep raw data', 'Keep processed outputs', 'Power approach', 'Available base power', 'Essential backup duration']);
    assertEq(defaults.querySelector('.optional').textContent, 'Optional');
    const opts = (k) => [...el.querySelectorAll('[data-input="' + k + '"] option')].map((o) => o.textContent);
    assertEq([opts('cadence'), opts('precision'), opts('power')], [['Once per sol', 'Every 4 hours', 'At phase end'],
      ['Coarse survey', 'Earthworks check', 'Precision assembly'], ['Solar + storage', 'Hybrid', 'Base connection']]);
    assertEq(defaults.querySelector(':scope > p.sub').textContent,
      'Planning assumptions, not validated design recommendations. Base power applies to hybrid or base-connected operation.');
    const sorted = (pairs) => pairs.sort(([a], [b]) => (a < b ? -1 : 1));
    assertEq(sorted([...el.querySelectorAll('[data-input]')].map((c) => [c.dataset.input, c.value])), sorted(Object.entries(TT_DEFAULTS).map(([k, v]) => [k, String(v)])));
    const labelled = (c) => c.labels.length > 0 || c.getAttribute('aria-label');
    assertEq([...el.querySelectorAll('input, select')].filter((c) => !labelled(c)).map((c) => c.outerHTML.slice(0, 80)), []);
    const alert = el.querySelector('.form-error');
    assertEq([alert.getAttribute('role'), alert.textContent], ['alert', '']);
    assertEq(el.querySelector('.input-caption').textContent, 'Editable defaults · required fields are marked');
    assertEq(texts(el, 'button.primary'), ['Find area']);
    assertEq(el.querySelectorAll('.tabs, [data-tab], #brief-next').length, 0);
    assertEq(p.side.children.length, 0);
  } finally { p.close(); }
});

test('intake panel: every edit goes to onChange with numbers as numbers; Close keeps the values', () => {
  const p = intake();
  try {
    p.set('robots', 30);
    assertEq(p.seen.state.robots, 30);
    p.set('name', 'North trench');
    p.set('workType', 'survey');
    p.set('power', 'Hybrid');
    assertEq([p.seen.state.name, p.seen.state.workType, p.seen.state.power, p.seen.state.hours], ['North trench', 'survey', 'Hybrid', 12]);
    p.set('hours', '');
    assertEq(p.seen.state.hours, null);
    p.el.querySelector('#brief-close').click();
    assertEq([p.seen.close, p.seen.done], [1, 0]);
    p.ui.open(p.seen.state); // reopened with the values kept
    assertEq([p.el.querySelector('[data-input="robots"]').value, p.el.querySelector('[data-input="name"]').value], ['30', 'North trench']);
  } finally { p.close(); }
});

test('intake panel: shares over 100% open the defaults and say so; Find area waits', () => {
  const p = intake();
  try {
    p.set('surveyPercent', 60);
    p.set('excPercent', 50);
    p.find();
    assertEq(p.el.querySelector('.form-error').textContent, 'Survey and excavation shares must add up to 100% or less.');
    assert(p.el.querySelector('details[data-defaults]').open, 'the disclosure is open');
    assertEq(p.seen.done, 0);
    p.set('excPercent', 40);
    p.find();
    assertEq([p.seen.done, p.el.querySelector('.form-error').textContent], [1, '']);
  } finally { p.close(); }
});

test('intake panel: hybrid or base connection needs the available base power', () => {
  const p = intake();
  try {
    p.set('power', 'Base connection');
    p.find();
    assertEq(p.el.querySelector('.form-error').textContent, 'Enter the available base power for hybrid or base-connected operation.');
    assertEq([...p.el.querySelectorAll('[aria-invalid="true"]')].map((c) => c.dataset.input), ['basePower']);
    assert(p.el.querySelector('details[data-defaults]').open, 'the disclosure is open');
    assertEq(p.seen.done, 0);
  } finally { p.close(); }
});

test('intake panel: a required number out of range is named; the defaults are valid and Find area calls onDone once', () => {
  const p = intake();
  try {
    p.set('robots', 0);
    p.find();
    assertEq([p.seen.done, p.el.querySelector('.form-error').textContent], [0, 'Construction robots: enter a whole number from 1 to 10,000 robots.']);
    assert(!p.el.querySelector('details[data-defaults]').open, 'a main field keeps the defaults closed');
    p.set('robots', 20);
    p.find();
    assertEq(p.seen.done, 1);
  } finally { p.close(); }
});

test('intake panel: while the sizing model loads, "Sizing in progress" with Back to brief, which cancels', async () => {
  let release = null;
  const loading = () => new Promise((r) => { release = r; });
  let p = intake({ pending: loading });
  try {
    p.find();
    assertEq(p.el.querySelector('[role="status"]').textContent, 'Sizing in progress');
    assertEq(p.el.querySelector('#brief-cancel').textContent, 'Back to brief');
    p.el.querySelector('#brief-cancel').click();
    assert(p.el.querySelector('#brief-find'), 'the intake again');
    release();
    await new Promise((r) => setTimeout(r, 0));
    assertEq(p.seen.done, 0);
  } finally { p.close(); }
  p = intake({ pending: loading });
  try {
    p.find();
    assertEq(p.seen.done, 0);
    release();
    await new Promise((r) => setTimeout(r, 0));
    assertEq(p.seen.done, 1);
  } finally { p.close(); }
});

// ---- the facility step: ready for location matching, or review your brief (Task 9) ----
const ttSized = (state = defaultBrief()) => { const sb = toSizingBrief(state); return { sb, setup: briefSetup(sizeBrief(sb, sizingBundle), sb) }; };

test('facility step ready: the calculated facility, then what it needs from a site, Edit brief and Assess locations', () => {
  const el = document.createElement('section');
  document.body.append(el);
  let edit = 0, assess = 0;
  try {
    const { sb, setup } = ttSized();
    createFacility(el, { setup: () => setup, brief: () => sb, onAssess: () => { assess += 1; }, onEdit: () => { edit += 1; } }).open();
    assertEq(el.querySelector('#facility-title').textContent, 'Ready for location matching.');
    assertEq(el.querySelector('.panel-intro').textContent, 'Your construction requirements have been calculated.');
    const t = textOf(el);
    assert(t.includes(SIZED_LABEL) && t.includes('Results are kept for the whole project.') && !t.includes('Prototype ends here'), t);
    assertEq(el.querySelector('.site-needs h3').textContent, 'What the facility needs from a site');
    const rows = [...el.querySelectorAll('.site-needs .factor-list li')];
    assertEq(rows.map((li) => li.firstChild.textContent), REVIEW_FACTORS);
    assert(rows.every((li) => li.querySelector('.factor-value.sized') && li.querySelector('.ev-assumption')), 'every requirement sized, with its chip');
    assertEq(texts(el, '.form-actions button'), ['Edit brief', 'Assess locations →']);
    assertEq(texts(el, 'button.primary'), ['Assess locations →']);
    el.querySelector('#facility-edit').click();
    el.querySelector('#facility-assess').click();
    assertEq([edit, assess], [1, 1]);
    // processed outputs kept for less than the project say so
    const short = ttSized({ ...defaultBrief(), productRetention: 90 });
    createFacility(el, { setup: () => short.setup, brief: () => short.sb, onAssess: () => {}, onEdit: () => {} }).open();
    assert(textOf(el).includes('Processed outputs are kept for 90 sols.'), textOf(el));
  } finally { el.remove(); }
});

test('facility step review: the Sizing says what to change; no way on to the locations', () => {
  const el = document.createElement('section');
  document.body.append(el);
  let edit = 0;
  try {
    const { setup } = ttSized();
    const f = createFacility(el, { setup: () => setup, brief: () => null, onAssess: () => {}, onEdit: () => { edit += 1; } });
    const tight = sizeBrief(toSizingBrief({ ...defaultBrief(), deadline: 0.1 }), sizingBundle);
    f.open(tight);
    assertEq(el.querySelector('#facility-title').textContent, 'Review your brief.');
    assertEq(el.querySelector('.panel-intro').textContent, 'This workload needs a revised schedule or equipment assumptions. Try allowing more time for processed results.');
    assertEq(texts(el, '.sizing-problem'), tight.problems.map((x) => x.message));
    assertEq(el.querySelector('#facility-assess'), null);
    assertEq(texts(el, 'button.primary'), ['Edit brief']);
    el.querySelector('#facility-edit').click();
    assertEq(edit, 1);
    f.open({ status: 'needs_answers', missing: [{ label: 'Keep raw data' }, { label: 'Essential backup duration' }], problems: [], options: [], assessed: null });
    assertEq(el.querySelector('.panel-intro').textContent, "This brief can't be sized as entered.");
    assertEq(texts(el, '.sizing-problem'), ['Answer these to size the facility: Keep raw data, Essential backup duration.']);
    const few = sizeBrief(toSizingBrief({ ...defaultBrief(), robots: 3 }), sizingBundle);
    f.open(few); // not a schedule problem: the plain lead
    assertEq(el.querySelector('.panel-intro').textContent, "This brief can't be sized as entered.");
    assertEq(texts(el, '.sizing-problem'), few.problems.map((x) => x.message));
    f.open(); // the ready view again, from the setup
    assertEq(el.querySelector('#facility-title').textContent, 'Ready for location matching.');
  } finally { el.remove(); }
});

test('facility step ready: a base connection has no solar plot', () => {
  const el = document.createElement('section');
  document.body.append(el);
  try {
    const { sb, setup } = ttSized({ ...defaultBrief(), power: 'Base connection', basePower: 50 });
    assertEq(setup.sizing.status, 'sized');
    createFacility(el, { setup: () => setup, brief: () => sb, onAssess: () => {}, onEdit: () => {} }).open();
    const solar = [...el.querySelectorAll('.site-needs .factor-list li')].find((li) => li.firstChild.textContent === 'Solar conditions');
    assert(/^No solar plot: the base supplies 50 kW, the facility peaks at \d+\.\d kW$/.test(solar.querySelector('.factor-value').textContent), solar.textContent);
  } finally { el.remove(); }
});

test('landing: the Twin Trails copy and one primary action, which becomes Continue project brief', () => {
  const el = document.createElement('section');
  document.body.append(el);
  let started = 0;
  try {
    createLanding(el, { onStart: () => { started += 1; } });
    assertEq(texts(el, 'h1 span'), ['Your project.', 'Your next frontier.']);
    assertEq(el.querySelector('.support').textContent, 'Start with the construction your robots will do. Find where its supporting facility could be built.');
    const start = el.querySelector('#landing-start');
    assertEq([start.className, start.textContent], ['primary', 'Define construction project']);
    start.click();
    assertEq([started, start.textContent], [1, 'Continue project brief']);
  } finally { el.remove(); }
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
test('References: Escape closes it only while open and focus is in it, never from a focused layout', () => {
  const host = document.createElement('div'), outside = document.createElement('button');
  document.body.append(host, outside);
  try {
    createReferences(host, { raw: { references: {} }, byId: new Map() }, { onScreen: () => [] });
    const d = host.querySelector('#references');
    const esc = () => dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    esc(); // closed: nothing to do
    assertEq(d.open, false);
    d.open = true;
    outside.focus(); // focus elsewhere (the facility layout): its own Escape deselects; References stays open
    esc();
    assertEq(d.open, true);
    host.querySelector('#references-close').focus();
    esc();
    assertEq(d.open, false);
  } finally { host.remove(); outside.remove(); }
});

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
    // Task 12's environment metrics, after the terrain ones
    ['BT-15', 'too close to a dune field'], ['BT-16', 'in the path of moving sand'], ['GI-05', 'possible ground ice under the compound'],
    ['SC-01', 'the skyline blocks too much sun'], ['SC-03', 'not enough solar energy on average'],
    ['SC-04', 'not enough solar energy in the worst season'], ['TC-01', 'temperature cases not covered'],
  ]);
  assertEq(plainVerdict({ failures: ['SC-03', 'BT-05'], criticalUnknowns: [] }, new Map(), metrics),
    'Not recommended: too steep in places under the compound and not enough solar energy on average');
  const v = (failures, criticalUnknowns = []) => plainVerdict({ failures, criticalUnknowns }, new Map(), metrics);
  assertEq(v(['BT-01', 'BT-02', 'BT-05', 'BT-08', 'SC-10', 'TC-08']),
    'Not recommended: too steep in places under the compound and too rough under the layout, and 4 more');
  assertEq(v(['BT-21', 'BT-04', 'TC-08']), "Not recommended: the building pad is too tilted and the radiator plot doesn't fit on usable ground, and 1 more");
  assertEq(v(['BT-21', 'BT-02']), "Not recommended: the layout doesn't fit on usable ground and the cable route to the base is too long");
  assertEq(v(['SC-10']), "Not recommended: the solar plot doesn't fit on usable ground");
  assertEq(v(['GI-01']), 'Not recommended: bearing-capacity adequacy'); // no phrase yet: the metric's name, lowercased
  assertEq(v([], ['BT-08', 'BT-10', 'GI-01', 'SC-05']), 'No failures from orbit; field checks open in 3 factors');
  assertEq(v([], ['GI-01']), 'No failures from orbit; field checks open in 1 factor');
  assertEq(v([]), 'No failures found from orbit');
  // missing data never reads as fine (triage MUST-FIX): needs_confirmation counts as unresolved, row or not
  const nc = new Map([['SC-03', computed('SC-03', { status: STATUS.NEEDS_CONFIRMATION, note: 'data failed to load' })]]);
  assertEq(plainVerdict({ failures: [], criticalUnknowns: [] }, nc, metrics), 'No failures from orbit; data missing in 1 factor');
  assertEq(plainVerdict(null, nc, metrics), 'No failures from orbit; data missing in 1 factor');
  assertEq(plainVerdict({ failures: [], criticalUnknowns: ['GI-01', 'SC-05'] }, nc, metrics), 'No failures from orbit; data missing or field checks open in 2 factors');
  assertEq(plainVerdict(null, initialStatuses(metrics, TOPUP), metrics).startsWith('No failures from orbit; data missing'), true); // nothing computed yet
  // before the region is ranked, the site's own Results say the same
  const res = new Map([['BT-05', computed('BT-05', { status: STATUS.NOT_MET })], ['GI-01', computed('GI-01', { status: STATUS.NEEDS_FIELDWORK })]]);
  assertEq(plainVerdict(null, res, metrics), 'Not recommended: too steep in places under the compound');
  for (const t of [v(['BT-01', 'BT-02', 'BT-05']), v([], ['GI-01'])]) assert(!ID_RE.test(t), t);
});

test('factorSentence per status (R33, R36: the icon from orbital estimates by availability, field checks counted)', () => {
  const base = initialStatuses(metrics, TOPUP);
  const computedBT = ['BT-01', 'BT-02', 'BT-04', 'BT-05', 'BT-06', 'BT-21']; // what checks.js computes
  const met = new Map(base);
  for (const id of computedBT) met.set(id, computed(id, { value: 1, display: '1' }));
  // R36: an estimate not computed yet (BT-13, BT-17, BT-18, BT-19) keeps the icon at ?, named; the rest still needing
  // data and the open field checks are counted, so the sentence never reads as fine
  assertEq(factorSentence('BT', met, metrics),
    { icon: '?', text: 'not settled from orbit: residual clearance margin is not estimated yet · 11 field checks to confirm · 3 still need data' });
  const allMet = new Map(met);
  for (const id of ['BT-13', 'BT-17', 'BT-18', 'BT-19']) allMet.set(id, computed(id, { value: 1, display: '1' }));
  assertEq(factorSentence('BT', allMet, metrics), { icon: '✓', text: 'meets the screening criteria from orbit · 11 field checks to confirm' });
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
  // an estimate with no data reads ?, named; a field check (needs fieldwork, no straddle) never makes it ?
  const nc = new Map(met).set('SC-01', computed('SC-01', { status: STATUS.NEEDS_CONFIRMATION, evidence: 'model' }));
  assertEq(factorSentence('SC', nc, metrics).icon, '?');
  assert(/^not settled from orbit: terrain-shading energy loss needs data/.test(factorSentence('SC', nc, metrics).text), factorSentence('SC', nc, metrics).text);
  const tc = new Map(base).set('TC-08', computed('TC-08')).set('TC-01', computed('TC-01', { status: STATUS.NEEDS_FIELDWORK, evidence: 'observation' }));
  // R36 regression: TC-07 not computed, so Thermal can't read ✓ (it did, keyed on evidence)
  assertEq(factorSentence('TC', tc, metrics, { siteId: 'near_base_north' }),
    { icon: '?', text: 'not settled from orbit: adverse-environment rejection penalty is not estimated yet · 4 field checks to confirm' });
  tc.set('TC-07', computed('TC-07'));
  assertEq(factorSentence('TC', tc, metrics).icon, '✓'); // every orbital estimate computed and met
  const straddle = new Map(met).set('BT-05', computed('BT-05', { status: STATUS.NEEDS_FIELDWORK, straddles: true }));
  assertEq(factorSentence('BT', straddle, metrics).icon, '?'); // an estimate straddling its target can't be settled from orbit
  // no computed orbital estimate here (R36: IR-10 not computed): a simulated one once results exist, seeded by site and
  // factor, the same every time, and saying so; before any result, ? rather than simulated
  assertEq(factorSentence('IR', base, metrics, { siteId: 'near_base_north' }).simulated, undefined);
  assertEq(factorSentence('IR', base, metrics, { siteId: 'near_base_north' }).icon, '?');
  const sim = factorSentence('IR', met, metrics, { siteId: 'near_base_north' });
  assertEq(sim, factorSentence('IR', met, metrics, { siteId: 'near_base_north' }));
  assert(/ · 1 still needs data$/.test(sim.text), sim.text); // IR-10 is still missing, and says so
  assert(sim.simulated && ['✓', '?', '✗'].includes(sim.icon) && /^Simulated for the demo: /.test(sim.text), JSON.stringify(sim));
  assertEq(simulatedEstimate('near_base_north', 'IR'), simulatedEstimate('near_base_north', 'IR'));
  const icons = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((s) => simulatedEstimate(s, 'IR').icon));
  assert(icons.size >= 2, 'different sites get different simulated results');
  assertEq(factorSentence('IR', base, metrics).icon, '?'); // without a site: unresolved, never fine
  // nothing applies: no solar plot under base power only
  assertEq(factorSentence('SC', initialStatuses(metrics, { loadKw: 150, power: 'base_only' }), metrics, { siteId: 's' }), { icon: '—', text: 'not applicable here' });
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
    assert(/Terrain/.test(seen) && /About this site/.test(seen) && /Next check/.test(seen), seen); // the rest is collapsed
    assert(/Why this priority/.test(el.textContent), 'Why this priority, inside About this site');
    for (const d of el.querySelectorAll('details')) d.open = true; // expert detail on demand: the ids are there
    assert(/BT-04/.test(visibleText(el)) && /GI-01/.test(visibleText(el)), 'Details list the metric ids');
  }
  assertEq(clean.verdict, 'No failures from orbit; data missing or field checks open in 5 factors'); // most estimates have no data here
  assertEq(clean.why.plain, 'No rule separates it from Site two; the trade-off: less grading, longer cable.');
  assert(/same priority as s2/.test(clean.why.text), 'the technical text stays for the Details');
});

test('view control: the three looks only; factor views from the card, site-scale, with Hide (R33)', () => {
  const reg = createViewRegistry();
  const calls = [];
  const view = (id, key) => ({ apply: (ctx) => calls.push('apply ' + id), clear: () => calls.push('clear ' + id), key: () => key });
  assert(!(() => { try { reg.register('photo', view('photo', {})); return true; } catch (e) { return false; } })(), 'photo is a look now, not a view');
  reg.register('BT', view('BT', { text: 'Slope key.', source: 'From a grid (derived).', missing: false }));
  reg.register('GI', view('GI', { text: 'Water tint.', source: 'From Odyssey GRS (derived).', missing: false, demo: 'cells about 300 km across' }));
  const el = document.createElement('nav');
  const asked = [], looked = [], applied = [];
  const bar = createFactorBar(el, { registry: reg, onView: (id) => asked.push(id), onLook: (id) => looked.push(id),
    lookKey: (look) => ({ text: 'Look ' + look + '.', source: '', missing: false }) });
  const looks = () => [...el.querySelectorAll('.look')].map((b) => [b.dataset.look, b.textContent, b.getAttribute('aria-pressed')]);
  const region = { globe: null, siteView: null, site: null, regionId: 'gale' };
  const site = { ...region, siteView: { setLook: (l) => applied.push(l) }, site: {} };
  // the region view: no control and no factor overlay
  bar.render({ show: true, view: 'BT', look: 'diorama', ctx: region });
  assert(el.hidden, 'nothing in the region view');
  assertEq(calls, []);
  assertEq(el.querySelectorAll('.seg').length, 0); // no factor tabs any more
  // a site open: the three looks, the look's key
  bar.render({ show: true, view: null, look: 'survey', ctx: site });
  assert(!el.hidden, 'shown with a site open');
  assertEq(looks(), [['diorama', 'Diorama', 'false'], ['survey', 'Survey sheet', 'true'], ['hud', 'Helmet HUD', 'false']]);
  assertEq(applied, ['survey']);
  assertEq(el.querySelector('.view-key').textContent, 'Look survey.');
  assert(el.querySelector('#view-hide').hidden, 'no Hide without a factor view');
  el.querySelector('.look[data-look="hud"]').click();
  assertEq(looked, ['hud']);
  // a factor view (asked for by the card): applied over the look, its key, Hide shown
  bar.render({ show: true, view: 'BT', look: 'survey', ctx: site });
  assertEq(calls, ['apply BT']);
  assertEq(bar.active(), 'BT');
  assertEq(el.querySelector('.view-key').textContent, 'Slope key. From a grid (derived).');
  assert(!el.querySelector('#view-hide').hidden, 'Hide factor view shows while one is on');
  el.querySelector('#view-hide').click();
  assertEq(asked, [null]);
  bar.render({ show: true, view: 'BT', look: 'survey', ctx: { ...site } }); // the same view and site: nothing re-applied
  assertEq(calls.length, 1);
  // a demo view: the key carries a Demo chip and says what it rests on; References lists it
  bar.render({ show: true, view: 'GI', look: 'survey', ctx: site });
  assertEq(calls, ['apply BT', 'clear BT', 'apply GI']);
  assert(el.querySelector('.view-key .demo-chip'), 'the key has a Demo chip');
  assert(/Demo: cells about 300 km across/.test(el.querySelector('.view-key').textContent), el.querySelector('.view-key').textContent);
  assertEq(demoParts(reg, site), [{ id: 'GI', name: 'Ground & ice', text: 'cells about 300 km across' }]);
  assertEq(demoParts(reg, region), []); // site-scale only
  bar.render({ show: true, view: 'GI', look: 'survey', ctx: region }); // back to the region: the view goes
  assert(el.hidden, 'hidden off the site');
  assertEq(calls.slice(-1), ['clear GI']);
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

test('simulated views: the same seeded field per site and factor, labelled as simulated (R33)', () => {
  const px = (t) => Array.from(t.image.getContext('2d').getImageData(0, 0, 64, 64).data.filter((_, i) => i % 97 === 0));
  assertEq(px(simulatedTexture('site_x', 'TC')), px(simulatedTexture('site_x', 'TC')));
  assert(JSON.stringify(px(simulatedTexture('site_x', 'TC'))) !== JSON.stringify(px(simulatedTexture('site_y', 'TC'))), 'another site, another field');
  const k = simulatedKey('surface temperature');
  assertEq([k.text, k.missing, k.simulated], [SIMULATED_TEXT, true, true]);
  assertEq(SIMULATED_TEXT, 'Simulated view: data not collected for this site');
});

// ---- the list's line when no candidate meets every requirement ----
function listHtml(rows) {
  const el = document.createElement('div'), region = { id: 'r', name: 'Region R', sites: rows.map((r) => ({ id: r.siteId })) };
  const names = new Map(rows.map((r) => [r.siteId, r.siteId]));
  createList(el, { onSite() {}, onRegion() {}, onEdit() {} }).render({ region, status: { state: 'ready' }, rows,
    results: new Map(rows.map((r) => [r.siteId, new Map()])), sites: new Map(), metrics, openSiteId: null, names, context: 'ctx', brief: '',
    regions: [region], regionStatus: new Map(), selectedSite: null });
  return el;
}
const rowOf = (siteId, failures) => ({ siteId, priority: 1, failures, equalWith: [], criticalUnknowns: [] });

test('ui list: every row failed says no candidate meets every requirement, above the rows; one clean row does not', () => {
  const none = listHtml([rowOf('a', ['BT-05']), rowOf('b', ['BT-04'])]);
  const line = none.querySelector('.no-candidate');
  assertEq(line.textContent, 'No candidate meets every requirement for this facility');
  assert(line.compareDocumentPosition(none.querySelector('ol.rows')) & Node.DOCUMENT_POSITION_FOLLOWING, 'above the rows');
  assertEq(listHtml([rowOf('a', ['BT-05']), rowOf('b', [])]).querySelector('.no-candidate'), null);
  assertEq(listHtml([]).querySelector('.no-candidate'), null);
});
