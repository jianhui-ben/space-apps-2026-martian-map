// Environment metrics (Task 12): pure, on small fixtures.
import { shadingLoss, plotPoints, pvSeries, fluxAt, environmentChecks, duneSetback, grsBin, horizonDeg, worstNoonSun,
  regionDataset, ETA } from '../src/environment.js';
import { placeLayout, footprintSpecs } from '../src/layout.js';
import { STATUS } from '../src/status.js';

const M_PER_DEG = 3396190 * Math.PI / 180;
const BOUNDS = [137.40, -4.60, 137.43, -4.57];
const LON0 = 137.415, LAT0 = -4.585;

// A 3 x 3 horizon grid (u8 x 0.25 degrees, 360 azimuth bands) with skyline(az) degrees everywhere.
function horizonGrid(skyline) {
  const w = 3, h = 3, data = new Uint8Array(w * h * 360);
  for (let k = 0; k < w * h; k++) for (let az = 0; az < 360; az++) data[k * 360 + az] = Math.round(skyline(az) / 0.25);
  return { data, width: w, height: h, bands: 360, bounds: BOUNDS, pixelDeg: [0.01, 0.01], nodata: 255 };
}
// An equatorial sun: rises due east at 6 h, overhead at 12 h, sets due west at 18 h; the same every season.
function sunTable() {
  const ls = Array.from({ length: 24 }, (_, i) => i * 15), t = Array.from({ length: 48 }, (_, j) => j * 0.5);
  const el = ls.map(() => t.map((x) => 90 - Math.abs(x - 12) * 15));
  const az = ls.map(() => t.map((x) => (x < 12 ? 90 : 270)));
  return { ls, ltst_h: t, elevation_deg: el, azimuth_deg: az };
}
// A flat 500 W/m2 MCD scenario on 25 local times, daytime only.
function mcd(flux = 500, ls = Array.from({ length: 24 }, (_, i) => i * 15)) {
  const lt = Array.from({ length: 25 }, (_, j) => j);
  return { ls, local_time_h: lt, surface_solar_flux_down_w_m2: ls.map(() => lt.map((x) => (x >= 6 && x <= 18 ? flux : 0))) };
}
const layoutFor = (setup, at = { centerLon: LON0, centerLat: LAT0, rotationDeg: 0 }) => placeLayout(footprintSpecs(setup), at);
const siteWith = (skyline) => ({ id: 's', bounds: BOUNDS, horizon: horizonGrid(skyline), sunTable: sunTable(), loadErrors: {} });
const TOPUP = { loadKw: 150, power: 'topup' }, BATT = { loadKw: 150, power: 'solar_batteries' }, BASE = { loadKw: 150, power: 'base_only' };

test('SC-01 zero with a flat horizon', () => {
  const site = siteWith(() => 0), solar = layoutFor(TOPUP).footprints.find((f) => f.id === 'solar');
  const pts = plotPoints(site.horizon, solar);
  assert(pts.length >= 1, 'at least the nearest point');
  assertClose(shadingLoss(site.sunTable, site.horizon, pts), 0, 1e-9);
  assertEq(horizonDeg(site.horizon, 0, 0, 359.6), 0); // wraps to band 0
});

test('SC-01 blocks the low eastern sun', () => {
  const site = siteWith((az) => (az > 45 && az < 135 ? 30 : 0));
  const solar = layoutFor(TOPUP).footprints.find((f) => f.id === 'solar');
  const loss = shadingLoss(site.sunTable, site.horizon, plotPoints(site.horizon, solar));
  assert(loss > 0 && loss < 50, 'some morning sun lost, got ' + loss);
  const r = environmentChecks(site, layoutFor(TOPUP), TOPUP, {}).get('SC-01');
  assertClose(r.value, loss, 1e-9);
  assertEq([r.unit, r.evidence, r.target.baseline], ['%', 'model', '≤ 10%']);
  assertEq(r.status, loss <= 10 ? STATUS.MET : STATUS.NOT_MET);
});

test('PV scales with plot area and η', () => {
  const site = siteWith(() => 0), solar = layoutFor(TOPUP).footprints.find((f) => f.id === 'solar');
  const pts = plotPoints(site.horizon, solar);
  assertClose(fluxAt(mcd(), 0, 12.5), 500, 1e-9);
  assertClose(fluxAt(mcd(), 0, 4.5), 0, 1e-9);
  assertClose(fluxAt(mcd(), 0, 5.5), 250, 1e-9); // linear between the MCD's hours
  assertClose(fluxAt(mcd(), 0, 17.5), 500, 1e-9);
  const a = pvSeries(site.sunTable, site.horizon, pts, mcd(), 5000)[0].kw[24]; // noon
  assertClose(a, 500 * ETA * 5000 / 1000, 1e-6); // 500 kW: flux × η × A / 1000
  assertClose(pvSeries(site.sunTable, site.horizon, pts, mcd(), 10000)[0].kw[24], 2 * a, 1e-6);
  assertClose(pvSeries(site.sunTable, site.horizon, pts, mcd(), 5000, 0.1)[0].kw[24], a / 2, 1e-6);
  // SC-03: the mean over the climatology, with A_panel half the 100 x 100 m plot
  const env = { mcdSolar: { scenarios: { climatology: mcd() } } };
  const r = environmentChecks(site, layoutFor(TOPUP), TOPUP, env).get('SC-03');
  const sunUp = sunTable().ltst_h.filter((t) => t > 6 && t < 18).length; // sun above the horizon, flux on
  assertClose(r.value, 500 * ETA * 5000 / 1000 * sunUp / 48, 1e-6);
  assertEq([r.unit, r.target.baseline, r.target.ideal, r.assumption, r.status], ['kW', '≥ 100 kW', '≥ 120 kW', true, STATUS.MET]);
});

test('SC-04 only for solar_batteries', () => {
  const site = siteWith(() => 0);
  const env = { mcdSolar: { scenarios: { climatology: mcd(), dust_storm: mcd(100, [180, 225, 270, 315]) } } };
  assertEq(environmentChecks(site, layoutFor(TOPUP), TOPUP, env).get('SC-04').status, STATUS.NEEDS_DESIGN_INPUT);
  const b = environmentChecks(site, layoutFor(BATT), BATT, env);
  const sc04 = b.get('SC-04');
  assert(Number.isFinite(sc04.value) && sc04.value > 0, 'a ratio, got ' + sc04.value);
  assert(/dust storm/.test(sc04.note), 'the note gives the dust-storm ratio: ' + sc04.note);
  assert(/≥ 225 kW/.test(b.get('SC-03').target.baseline), 'solar-only SC-03 is against the load: ' + b.get('SC-03').target.baseline);
  const base = environmentChecks(site, layoutFor(BASE), BASE, env);
  assertEq([base.get('SC-03').status, base.get('SC-04').status, base.has('SC-01')], [STATUS.NOT_APPLICABLE, STATUS.NOT_APPLICABLE, false]);
});

test('BT-15 is 0 inside a dune polygon', () => {
  const lay = layoutFor(TOPUP);
  const square = (lon, lat, d) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] } });
  assertEq(duneSetback(lay.footprints, { features: [square(LON0, LAT0, 0.05)] }), 0);
  // a dune 1 km east of the layout's east edge (the solar plot, 100 m wide, is the widest footprint)
  const k = M_PER_DEG * Math.cos(LAT0 * Math.PI / 180), d = 0.002;
  const east = LON0 + (50 + 1000) / k + d;
  assertClose(duneSetback(lay.footprints, { features: [square(east, LAT0, d)] }), 1000, 2);
  const r = environmentChecks(siteWith(() => 0), lay, TOPUP, { dunes: { features: [square(east, LAT0, d)] } }).get('BT-15');
  assertEq([r.status, r.unit], [STATUS.NEEDS_FIELDWORK, 'm']);
  // a region with no dune features, or none of the data: needs confirmation, never fine
  const none = environmentChecks(siteWith(() => 0), lay, TOPUP, { dunes: { type: 'FeatureCollection', features: [] } });
  assertEq(none.get('BT-15').status, STATUS.NEEDS_CONFIRMATION);
  assertEq(none.get('BT-16').status, STATUS.NEEDS_CONFIRMATION);
});

test('TC-01 counts the THEMIS cases over the radiator; GI-05 reads its GRS bin and stays needs confirmation', () => {
  const lay = layoutFor(TOPUP);
  const grid = (v) => ({ data: new Float32Array(400).fill(v), width: 20, height: 20, bounds: BOUNDS, pixelDeg: [0.0015, 0.0015], nodata: NaN });
  const env = { themis: { dayAph: grid(250), nightAph: grid(190), dayPeri: grid(NaN), nightPeri: null },
    mcdThermal: { scenarios: { climatology: { ls: [75, 255], local_time_h: [6, 17], surface_temperature_k: [[180, 260], [200, 280]] } } },
    grs: { bin_deg: 5, bins: [{ lat: -7.5, lon: 137.5, h2o_wt_pct: 5.403, sigma_wt_pct: 0.364 }, { lat: -2.5, lon: 137.5, h2o_wt_pct: 5.415, sigma_wt_pct: 0.392 }] } };
  const r = environmentChecks(siteWith(() => 0), lay, TOPUP, env);
  const tc = r.get('TC-01');
  assertEq([tc.value, tc.display, tc.status], [2, '2 of 4 cases observed', STATUS.NEEDS_FIELDWORK]);
  assert(/190–250 K/.test(tc.note) && /day, perihelion 280–280 K/.test(tc.note), tc.note);
  const gi = r.get('GI-05');
  assertEq([gi.value, gi.status, gi.evidence], [5.415, STATUS.NEEDS_CONFIRMATION, 'observation']);
  assert(/SWIM ice data pending/.test(gi.note), gi.note);
  assertEq(grsBin(env.grs, 137.44, -4.57).lat, -2.5);
  assertEq(grsBin(env.grs, 137.44, -12), null);
  assertEq(environmentChecks(siteWith(() => 0), lay, TOPUP, {}).get('TC-01').status, STATUS.NEEDS_CONFIRMATION);
});

test('worst-season noon sun, and a region copy found by its region, never another region\'s', () => {
  const t = sunTable();
  t.elevation_deg[5][24] = 60;
  assertEq(worstNoonSun(t), { ls: 75, azDeg: 270, elDeg: 60 });
  const catalog = { regions: [{ id: 'gale', bounds: [136, -6.5, 139, -3.5] }, { id: 'jezero', bounds: [76, 17, 79, 20] }],
    raw: { datasets: [
      { id: 'dune_fields', dataset: 'dune_fields', region: 'gale', coverage: { bounds: [136, -6.5, 139, -3.5] } },
      { id: 'dune_fields__jezero', dataset: 'dune_fields', region: 'jezero', coverage: { bounds: [76, 17, 79, 20] } },
      { id: 'rover_path', dataset: 'rover_path', region: 'gale', coverage: {} },
    ] } };
  assertEq(regionDataset(catalog, 'jezero', 'dune_fields').id, 'dune_fields__jezero');
  assertEq(regionDataset(catalog, 'gale', 'dune_fields').id, 'dune_fields');
  assertEq(regionDataset(catalog, 'jezero', 'rover_path'), null);
  assertEq(regionDataset(catalog, 'arcadia', 'dune_fields'), null);
});

// ---- the brief's facility: panels sized for the site, SC-03 met when so, SC-04 the worst season over the requirement ----
const briefOf = (power, kw = 3.869) => ({ source: 'brief', power,
  sizing: { params: { solar_land_coverage: 0.5, radiator_plot_factor: 1.5 }, assessed: { specifications: {
    required_solar_average_kw: { status: 'resolved', value: kw, unit: 'kW' }, solar_panel_area_m2: { status: 'resolved', value: 50 },
    solar_plot_m2: { status: 'resolved', value: 100 } } } } });
// a climate with a dim second half of the year, so the worst season is a quarter of the best
const seasonal = () => { const m = mcd(), half = m.ls.length / 2; m.surface_solar_flux_down_w_m2 = m.surface_solar_flux_down_w_m2.map((r, i) => (i < half ? r : r.map((x) => x / 4))); return m; };
const ENV = () => ({ mcdSolar: { scenarios: { climatology: seasonal(), dust_storm: mcd(100) } } });

test('SC-03 for a brief setup is met when the panels are sized from site data, from your brief', () => {
  const setup = briefOf('topup'), lay = layoutFor(TOPUP);
  const r = environmentChecks(siteWith(() => 0), lay, setup, ENV()).get('SC-03');
  assertEq(r.status, STATUS.MET);
  assertEq(r.target.baseline, '≥ 3.9 kW (from your brief)');
  assertEq(r.target.ideal, '');
  assertEq([r.ideal, r.assumption], [false, true]);
  assertClose(r.value, 3.869, 1e-6); // the annual-mean panels give the required average
  assertEq(r.display, '3.9 kW');
  assert(/panels sized for this site: \d+ m² for the year's average/.test(r.note), r.note);
  const batt = environmentChecks(siteWith(() => 0), layoutFor(BATT), briefOf('solar_batteries'), ENV()).get('SC-03');
  assertEq(batt.status, STATUS.MET);
  assert(/for the worst season/.test(batt.note), batt.note);
  assert(batt.value > 3.869, 'worst-season panels make more than the average: ' + batt.value);
});

test('SC-03 for a brief setup needs confirmation when the size is generic; SC-04 follows the power option', () => {
  const lay = layoutFor(TOPUP);
  assertEq(environmentChecks(siteWith(() => 0), lay, briefOf('topup'), {}).get('SC-03').status, STATUS.NEEDS_CONFIRMATION);
  assertEq(environmentChecks(siteWith(() => 0), layoutFor(BATT), briefOf('solar_batteries'), {}).get('SC-04').status, STATUS.NEEDS_CONFIRMATION);
  assertEq(environmentChecks(siteWith(() => 0), lay, briefOf('topup'), ENV()).get('SC-04').status, STATUS.NEEDS_DESIGN_INPUT);
  const base = environmentChecks(siteWith(() => 0), lay, briefOf('base_only'), ENV());
  assertEq([base.get('SC-03').status, base.get('SC-04').status], [STATUS.NOT_APPLICABLE, STATUS.NOT_APPLICABLE]);
});

test('SC-04 for a brief solar-and-batteries setup is 1.0 when site-sized, met, with the dust storm in the note', () => {
  const r = environmentChecks(siteWith(() => 0), layoutFor(BATT), briefOf('solar_batteries'), ENV()).get('SC-04');
  assertEq([r.status, r.value, r.display, r.target.baseline, r.target.ideal], [STATUS.MET, 1, '1.00', '≥ 1.0', '≥ 1.2']);
  assertEq(r.ideal, false);
  assert(/3\.9 kW required/.test(r.note) && /in a global dust storm/.test(r.note), r.note);
});
