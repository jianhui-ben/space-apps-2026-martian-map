// Per-site plot sizing and the brief's BT-17 / BT-21 / GI-01 / TC-03 results, on a really sized brief.
import { radiatorFluxWm2, warmestAirK, sitePanelWm2, siteSizing, briefChecks, EMISSIVITY, RADIATOR_K } from '../src/requirements.js';
import { sizeBrief, briefSetup } from '../src/sizing/index.js';
import { loadBundle } from '../src/sizing/engine.js';
import { STATUS } from '../src/status.js';

const M_PER_DEG = 3396190 * Math.PI / 180;
const BOUNDS = [137.40, -4.60, 137.43, -4.57];
const LON0 = 137.415, LAT0 = -4.585;
const cases = await (await fetch(new URL('./fixtures/sizing.json', import.meta.url))).json();
const bundle = await loadBundle(new URL('../sizing/screening-v1.json', import.meta.url));
const brief = cases.find((c) => c.name === 'example_filled').brief;
const setup = briefSetup(sizeBrief(brief, bundle), brief);
const spec = (k) => setup.sizing.assessed.specifications[k].value;

// A 3 x 3 flat horizon, an equatorial sun table and a flat 500 W/m2 daytime climate scenario.
function horizonGrid() {
  const w = 3, h = 3;
  return { data: new Uint8Array(w * h * 360), width: w, height: h, bands: 360, bounds: BOUNDS, pixelDeg: [0.01, 0.01], nodata: 255 };
}
function sunTable() {
  const ls = Array.from({ length: 24 }, (_, i) => i * 15), t = Array.from({ length: 48 }, (_, j) => j * 0.5);
  return { ls, ltst_h: t, elevation_deg: ls.map(() => t.map((x) => 90 - Math.abs(x - 12) * 15)), azimuth_deg: ls.map(() => t.map((x) => (x < 12 ? 90 : 270))) };
}
function mcdSolar() {
  const ls = Array.from({ length: 24 }, (_, i) => i * 15), lt = Array.from({ length: 25 }, (_, j) => j);
  return { scenarios: { climatology: { ls, local_time_h: lt, surface_solar_flux_down_w_m2: ls.map(() => lt.map((x) => (x >= 6 && x <= 18 ? 500 : 0))) } } };
}
const scenario = (k) => ({ ls: Array.from({ length: 24 }, (_, i) => i * 15), local_time_h: Array.from({ length: 25 }, (_, j) => j),
  air_temperature_2m_k: Array.from({ length: 24 }, () => Array.from({ length: 25 }, () => k)) });
const thermal = (...temps) => ({ scenarios: Object.fromEntries(temps.map((k, i) => ['s' + i, scenario(k)])) });
const siteOf = (extra = {}) => ({ id: 's', bounds: BOUNDS, base: { lon: LON0, lat: LAT0 - 1500 / M_PER_DEG }, horizon: horizonGrid(), sunTable: sunTable(), loadErrors: {}, ...extra });
const envOf = (tSink = 258) => ({ mcdSolar: mcdSolar(), mcdThermal: thermal(tSink - 20, tSink), errors: {} });
const compoundLayout = (lat = LAT0) => ({ placement: {}, footprints: [{ id: 'compound', w: 18, h: 10, center: { lon: LON0, lat }, rotationDeg: 0, polygon: [] }] });

test('radiator flux follows emissivity, 300 K and the sink', () => {
  assertEq(EMISSIVITY, 0.85); assertEq(RADIATOR_K, 300);
  assertClose(radiatorFluxWm2(258), 176.85, 0.01);
  assert(radiatorFluxWm2(305) < 0, 'a sink warmer than the radiator gives no net flux');
});

test('warmestAirK is the maximum over every scenario, season and time', () => {
  const t = thermal(230, 262.6, 250);
  t.scenarios.s0.air_temperature_2m_k[3][7] = 270;
  assertEq(warmestAirK(t), 270);
  assertEq(warmestAirK(thermal(230, 262.6)), 262.6);
  assert(Number.isNaN(warmestAirK({})), 'no data');
  assert(Number.isNaN(warmestAirK(undefined)), 'undefined');
});

test('sitePanelWm2 is the year mean of 1 m2 of panel at the centre cell', () => {
  // 23 of 48 half-hours have the sun above a flat horizon: 500 W/m2 x 0.2 x 23/48
  assertClose(sitePanelWm2(siteOf(), envOf()), 500 * 0.2 * 23 / 48, 1e-9);
  assert(Number.isNaN(sitePanelWm2(siteOf({ horizon: null }), envOf())), 'no horizon');
  assert(Number.isNaN(sitePanelWm2(siteOf({ sunTable: null }), envOf())), 'no sun table');
  assert(Number.isNaN(sitePanelWm2(siteOf(), { mcdSolar: null })), 'no climate');
});

test('siteSizing sizes solar plus storage for the worst season and a top-up for the annual mean', () => {
  const m = mcdSolar(), half = 12;
  m.scenarios.climatology.surface_solar_flux_down_w_m2 = m.scenarios.climatology.surface_solar_flux_down_w_m2.map((r, i) => (i < half ? r : r.map((x) => x / 4)));
  const env = { ...envOf(), mcdSolar: m };
  const req = spec('required_solar_average_kw') * 1000, cov = setup.sizing.params.solar_land_coverage;
  const top = siteSizing(siteOf(), { ...setup, power: 'topup' }, env), bat = siteSizing(siteOf(), { ...setup, power: 'solar_batteries' }, env);
  assertEq([top.solarBasis, bat.solarBasis], ['annual_mean', 'worst_season']);
  assertClose(top.panelWm2, bat.panelWm2, 1e-9);
  assertClose(bat.worstWm2, top.panelWm2 * 0.4, 1e-9); // seasons at 1 and 1/4: mean 0.625, worst 0.25
  assertClose(top.solarPanelM2, req / top.panelWm2, 1e-6);
  assertClose(bat.solarPanelM2, req / bat.worstWm2, 1e-6);
  assertClose(bat.solarPlotM2, req / bat.worstWm2 / cov, 1e-6);
  assert(bat.solarPlotM2 > top.solarPlotM2, 'worst-season panels are larger');
});

test('siteSizing sizes the solar plot from the site panel output', () => {
  const size = siteSizing(siteOf(), { ...setup, power: 'topup' }, envOf());
  const panelWm2 = sitePanelWm2(siteOf(), envOf());
  assertEq(size.solarFrom, 'site');
  assertClose(size.panelWm2, panelWm2, 1e-9);
  assertClose(size.solarPanelM2, spec('required_solar_average_kw') * 1000 / panelWm2, 1e-6);
  assertClose(size.solarPlotM2, spec('required_solar_average_kw') * 1000 / panelWm2 / setup.sizing.params.solar_land_coverage, 1e-6);
});

test('siteSizing sizes the radiator from the warmest air at the site', () => {
  const size = siteSizing(siteOf(), setup, envOf(258));
  assertEq(size.radiatorFrom, 'site');
  assertEq(size.tSinkK, 258);
  assertClose(size.radiatorWm2, radiatorFluxWm2(258), 1e-9);
  assertClose(size.radiatorAreaM2, spec('heat_rejection_kw') * 1000 / radiatorFluxWm2(258), 1e-6);
  assertClose(size.radiatorPlotM2, size.radiatorAreaM2 * setup.sizing.params.radiator_plot_factor, 1e-6);
});

test('siteSizing keeps the generic sizes without site data', () => {
  const size = siteSizing(siteOf({ horizon: null }), setup, { mcdSolar: mcdSolar(), errors: {} });
  assertEq(size.solarFrom, 'generic'); assertEq(size.radiatorFrom, 'generic');
  assertEq(size.solarPlotM2, spec('solar_plot_m2'));
  assertEq(size.solarPanelM2, spec('solar_panel_area_m2'));
  assertEq(size.radiatorAreaM2, spec('radiator_emitting_area_m2'));
  assertEq(size.radiatorPlotM2, spec('radiator_plot_m2'));
});

test('a sink at or above 300 K is a site size with infinite area', () => {
  const size = siteSizing(siteOf(), setup, envOf(305));
  assertEq(size.radiatorFrom, 'site');
  assertEq(size.radiatorAreaM2, Infinity);
});

test('BT-21 is the straight-line distance over the service limit', () => {
  const limit = spec('service_distance_limit_m');
  const near = briefChecks(siteOf(), compoundLayout(), setup, siteSizing(siteOf(), setup, envOf())).get('BT-21');
  assertClose(near.value, 1500 / limit, 1e-3);
  assertEq(near.status, STATUS.MET); assert(near.ideal, 'ideal at 0.5'); assert(near.assumption, 'assumption');
  assert(near.display.includes('m of ' + limit + ' m'), near.display);
  const far = siteOf({ base: { lon: LON0, lat: LAT0 - 13000 / M_PER_DEG } });
  const r = briefChecks(far, compoundLayout(), setup, siteSizing(far, setup, envOf())).get('BT-21');
  assertEq(r.status, STATUS.NOT_MET); assert(!r.ideal, 'not ideal');
});

test('GI-01 needs fieldwork against the required bearing; BT-17 needs a route', () => {
  const out = briefChecks(siteOf(), compoundLayout(), setup, siteSizing(siteOf(), setup, envOf()));
  const gi = out.get('GI-01'), bt = out.get('BT-17');
  assertEq(gi.status, STATUS.NEEDS_FIELDWORK);
  assertEq(gi.target.baseline, '≥ ' + spec('required_allowable_bearing_kpa').toFixed(1) + ' kPa');
  assert(gi.target.baseline.startsWith('≥ 6.2'), gi.target.baseline);
  assert(gi.note.includes('not been measured'), gi.note);
  assertEq(bt.status, STATUS.NEEDS_DESIGN_INPUT);
  assertEq(bt.target.baseline, '≥ ' + spec('corridor_width_m') + ' m, grade ≤ ' + spec('vehicle_grade_limit_deg') + '°');
  assertEq(bt.note, 'needs a planned route; route planning is not part of this screening');
});

test('TC-03 is met when the radiator rejects the heat, not met when the sink is too warm, unconfirmed when generic', () => {
  const run = (site, env) => briefChecks(site, compoundLayout(), setup, siteSizing(site, setup, env)).get('TC-03');
  const met = run(siteOf(), envOf(258));
  assertEq(met.status, STATUS.MET); assertEq(met.value, 1.0); assertEq(met.evidence, 'model'); assert(met.assumption, 'assumption');
  assert(met.display.includes('W/m²') && met.display.includes('m² of radiator'), met.display);
  for (const s of ['0.85', '300 K', '258 K', 'absorbed sunlight and nearby surfaces are not modelled']) assert(met.note.includes(s), met.note);
  const hot = run(siteOf(), envOf(305));
  assertEq(hot.status, STATUS.NOT_MET); assertEq(hot.display, 'too warm for a 300 K radiator');
  const generic = run(siteOf(), { mcdSolar: mcdSolar(), errors: {} });
  assertEq(generic.status, STATUS.NEEDS_CONFIRMATION); assert(generic.status !== STATUS.MET, 'never met');
});

test('briefChecks returns exactly the four ids', () => {
  const out = briefChecks(siteOf(), compoundLayout(), setup, siteSizing(siteOf(), setup, envOf()));
  assertEq([...out.keys()].sort(), ['BT-17', 'BT-21', 'GI-01', 'TC-03']);
  for (const r of out.values()) assert(r.target && 'appliesTo' in r && 'straddles' in r, r.id);
});

// A copy of the real sized setup with one specification replaced.
const patched = (key, value) => {
  const s = structuredClone(setup);
  s.sizing.assessed.specifications[key] = value;
  return s;
};
const UNRESOLVED = { status: 'unresolved', value: null, unit: '', missing_inputs: ['input:x'], provenance_ids: [], assumption: false };
const checksFor = (s, env = envOf(258)) => briefChecks(siteOf(), compoundLayout(), s, siteSizing(siteOf(), s, env));

test('an unresolved heat load never reads as a met radiator', () => {
  const s = patched('heat_rejection_kw', UNRESOLVED);
  const size = siteSizing(siteOf(), s, envOf(258));
  assert(size.radiatorFrom !== 'site', 'not a site size');
  const r = checksFor(s).get('TC-03');
  assertEq(r.status, STATUS.NEEDS_CONFIRMATION);
  assert(!r.display.includes('NaN'), r.display);
});

test('an unresolved solar demand never reads as a site solar size', () => {
  const size = siteSizing(siteOf(), patched('required_solar_average_kw', UNRESOLVED), envOf(258));
  assert(size.solarFrom !== 'site', 'not a site size');
  assert(!Number.isFinite(size.solarPlotM2) || size.solarFrom === 'generic', 'no NaN site plot');
});

test('a setup without an assessed facility does not throw', () => {
  const s = structuredClone(setup);
  s.sizing.assessed = null;
  const size = siteSizing(siteOf(), s, envOf(258));
  assertEq(size.radiatorFrom, 'generic'); assertEq(size.solarFrom, 'generic');
  assertEq(checksFor(s).get('TC-03').status, STATUS.NEEDS_CONFIRMATION);
});
