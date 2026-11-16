import { footprintSpecs, placeLayout, clampPlacement, cellsUnder, bestSpot, createLayoutStore } from '../src/layout.js';
import { makeGrid, fixtureSite } from './fixtures.js';
import { sizeBrief, briefSetup } from '../src/sizing/index.js';
import { loadBundle } from '../src/sizing/engine.js';

const M = 3396190 * Math.PI / 180;
const byId = (a) => Object.fromEntries(a.map((x) => [x.id, x]));

test('specs 150 kW top-up', () => {
  const s = byId(footprintSpecs({ loadKw: 150, power: 'topup' }));
  assertClose(s.radiator.h, 64.29, 0.01);
  assertEq(s.radiator.w, 60);
  assertEq(s.compound.w, 60);
  assertEq(s.solar.w, 100);
  assertEq(s.solar.h, 100);
});

test('specs base_only has no solar plot', () => {
  const s = byId(footprintSpecs({ loadKw: 60, power: 'base_only' }));
  assert(!s.solar, 'no solar');
  assert(s.compound && s.radiator, 'compound and radiator remain');
});

test('specs solar_batteries 250 kW side', () => {
  const s = byId(footprintSpecs({ loadKw: 250, power: 'solar_batteries' }));
  assertClose(s.solar.w, 187.08, 0.01);
  assertClose(s.solar.h, 187.08, 0.01);
  assertEq(byId(footprintSpecs({ loadKw: 60, power: 'solar_fission' })).solar.w, 100);
});

test('radiator sits north of compound at rotation 0', () => {
  const specs = footprintSpecs({ loadKw: 150, power: 'topup' });
  const lay = placeLayout(specs, { centerLon: 137.44, centerLat: -4.57, rotationDeg: 0 });
  const f = byId(lay.footprints);
  assert(f.radiator.center.lat > f.compound.center.lat, 'radiator north');
  assert(f.solar.center.lat < f.compound.center.lat, 'solar south');
  assertClose((f.radiator.center.lat - f.compound.center.lat) * M, 40 + f.radiator.h / 2, 1e-6);
  assertEq(f.compound.polygon.length, 4);
  assertEq(lay.placement.rotationDeg, 0);
});

test('rotation is clockwise from north', () => {
  const specs = footprintSpecs({ loadKw: 150, power: 'topup' });
  const f = byId(placeLayout(specs, { centerLon: 10, centerLat: 0, rotationDeg: 90 }).footprints);
  assert(f.radiator.center.lon > f.compound.center.lon, 'radiator turns to east');
  assertClose(f.radiator.center.lat, f.compound.center.lat, 1e-9);
});

const inside = (b, lay) => lay.footprints.every((f) => f.polygon.every(([lo, la]) => lo >= b[0] - 1e-12 && lo <= b[2] + 1e-12 && la >= b[1] - 1e-12 && la <= b[3] + 1e-12));

test('clamp keeps all corners inside after drag past east edge', async () => {
  const site = await fixtureSite();
  const specs = footprintSpecs({ loadKw: 60, power: 'topup' });
  const p = clampPlacement(site, specs, { centerLon: site.bounds[2] + 0.01, centerLat: (site.bounds[1] + site.bounds[3]) / 2, rotationDeg: 0 });
  assert(inside(site.bounds, placeLayout(specs, p)), 'inside');
  const q = { centerLon: (site.bounds[0] + site.bounds[2]) / 2, centerLat: (site.bounds[1] + site.bounds[3]) / 2, rotationDeg: 0 };
  assertEq(clampPlacement(site, specs, q), q);
});

test('clamp handles 45 degree rotation at a corner', async () => {
  const site = await fixtureSite();
  const specs = footprintSpecs({ loadKw: 60, power: 'topup' });
  const p = clampPlacement(site, specs, { centerLon: site.bounds[2] + 0.1, centerLat: site.bounds[3] + 0.1, rotationDeg: 45 });
  assertEq(p.rotationDeg, 45);
  assert(inside(site.bounds, placeLayout(specs, p)), 'inside');
});

test('clamp centres the layout when it cannot fit', async () => {
  const site = await fixtureSite();
  site.bounds = [site.bounds[0], site.bounds[1] + 0.003, site.bounds[2], site.bounds[3] - 0.003]; // about 300 m tall
  const specs = footprintSpecs({ loadKw: 250, power: 'solar_batteries' }); // 367 m tall
  const p = clampPlacement(site, specs, { centerLon: 0, centerLat: 0, rotationDeg: 0 });
  const lay = placeLayout(specs, p);
  const lats = lay.footprints.flatMap((f) => f.polygon.map((q) => q[1]));
  assertClose((Math.min(...lats) + Math.max(...lats)) / 2, (site.bounds[1] + site.bounds[3]) / 2, 1e-9);
});

test('cellsUnder never leaves the grid', () => {
  const g = makeGrid({ width: 50, height: 50, bounds: [0, 0, 50 / M, 50 / M], fn: () => 0 });
  const fp = { id: 'compound', w: 60, h: 60, center: { lon: 50 / M, lat: 25 / M }, rotationDeg: 30 };
  let n = 0, bad = 0;
  cellsUnder(g, fp, (c, r) => { n++; if (c < 0 || r < 0 || c >= 50 || r >= 50) bad++; });
  assert(n > 0, 'visits some');
  assertEq(bad, 0);
});

test('cellsUnder counts about the rectangle area', () => {
  const g = makeGrid({ width: 200, height: 200, bounds: [0, 0, 200 / M, 200 / M], fn: () => 0 });
  const fp = { id: 'x', w: 60, h: 40, center: { lon: 100 / M, lat: 100 / M }, rotationDeg: 0 };
  let n = 0; cellsUnder(g, fp, () => { n++; });
  assert(Math.abs(n - 2400) <= 130, 'axis aligned area ' + n);
  n = 0; cellsUnder(g, { ...fp, rotationDeg: 33 }, () => { n++; });
  assert(Math.abs(n - 2400) <= 130, 'rotated area ' + n);
});

// 400 x 400 site, slope 12 except flat patches given as [c0, r0, c1, r1]
async function slopeSite(patches, extra = {}) {
  const site = await fixtureSite();
  const slope10 = makeGrid({ width: 400, height: 400, bounds: site.bounds, fn: (c, r) => (patches.some(([a, b, d, e]) => c >= a && c < d && r >= b && r < e) ? 2 : 12) });
  Object.assign(site, extra);
  site.grids = { ...site.grids, slope10 };
  return site;
}
const centerCell = (site, p) => ({
  col: (p.centerLon - site.bounds[0]) / ((site.bounds[2] - site.bounds[0]) / 400),
  row: (site.bounds[3] - p.centerLat) / ((site.bounds[3] - site.bounds[1]) / 400),
});
const base60 = footprintSpecs({ loadKw: 60, power: 'base_only' }); // compound 60x60 + radiator 60 x 34.29

test('bestSpot finds the only flat patch', async () => {
  const site = await slopeSite([[100, 50, 300, 350]]);
  const p = bestSpot(site, base60);
  const c = centerCell(site, p);
  assertEq(p.rotationDeg, 0);
  assert(c.col >= 130 && c.col <= 270, 'col ' + c.col);
  assert(c.row >= 80 && c.row <= 350, 'row ' + c.row);
  const lay = placeLayout(base60, p);
  assert(inside(site.bounds, lay), 'inside site');
});

test('bestSpot breaks ties toward the base', async () => {
  // base is south of the site; the southern patch is nearer
  const site = await slopeSite([[20, 20, 140, 140], [20, 260, 140, 380]]);
  const p = bestSpot(site, base60);
  assert(centerCell(site, p).row > 200, 'southern patch chosen: row ' + centerCell(site, p).row);
});

test('bestSpot reads the thresholds from the scenario', async () => {
  const site = await slopeSite([]);
  // everywhere 12; lift the limit to 15 and every spot qualifies, so the nearest to base wins
  site.catalog = { ...site.catalog, scenario: { assumptions: { max_local_pad_slope_deg: { value: 15, ideal: 13 } } } };
  const p = bestSpot(site, base60);
  assert(centerCell(site, p).row > 300, 'near the base side');
});

test('bestSpot falls back to the fewest unusable cells', async () => {
  const site = await slopeSite([[0, 0, 400, 400]]);
  site.grids.slope10.data.fill(12);
  site.grids.slope10.data[200 * 400 + 200] = 2; // one fine cell only
  const p = bestSpot(site, base60);
  assertEq(p.rotationDeg, 0);
  assert(Number.isFinite(p.centerLon) && Number.isFinite(p.centerLat), 'finite');
});

test('NaN slope counts as unusable', async () => {
  const site = await slopeSite([[0, 0, 400, 400]]);
  for (let r = 0; r < 400; r++) for (let c = 0; c < 200; c++) site.grids.slope10.data[r * 400 + c] = NaN;
  const p = bestSpot(site, base60);
  assert(centerCell(site, p).col > 200, 'east half only');
});

test('numeric nodata is unusable, not flat', async () => {
  const site = await slopeSite([[0, 0, 400, 400]]);
  site.grids.slope10.nodata = -9999;
  for (let r = 0; r < 400; r++) for (let c = 0; c < 200; c++) site.grids.slope10.data[r * 400 + c] = -9999;
  const p = bestSpot(site, base60);
  assert(centerCell(site, p).col > 225, 'east half only, col ' + centerCell(site, p).col);
});

test('layout store get, set, final, per-site specs, unsubscribe', () => {
  const st = createLayoutStore();
  const pl = { centerLon: 1, centerLat: 2, rotationDeg: 0 };
  const a = footprintSpecs({ loadKw: 60, power: 'base_only' }), b = footprintSpecs({ loadKw: 60, power: 'topup' });
  assertEq(st.get('A'), null);
  let threw = false;
  try { st.set('A', pl); } catch (e) { threw = true; }
  assert(threw, 'set without specs throws');
  const seen = [];
  const off = st.onLayoutChange((id, lay, o) => seen.push([id, lay.footprints.length, o.final]));
  st.set('A', pl, { final: false, specs: a });
  st.set('B', pl, { specs: b });
  st.set('A', pl); // A keeps its own specs
  assertEq(seen, [['A', 2, false], ['B', 3, true], ['A', 2, true]]);
  assertEq(st.get('B').footprints.length, 3);
  off();
  st.set('A', pl);
  assertEq(seen.length, 3);
});

// ---- the facility sized from the brief ----
const sizingBundle = await loadBundle(new URL('../sizing/screening-v1.json', import.meta.url));
const sizingCases = Object.fromEntries((await (await fetch(new URL('./fixtures/sizing.json', import.meta.url))).json()).map((c) => [c.name, c]));
const sizedSetup = (name) => { const b = sizingCases[name].brief; return briefSetup(sizeBrief(b, sizingBundle), b); };

test('specs from a brief setup: the module block, radiator and solar squares of the plots', () => {
  const setup = sizedSetup('example_filled');
  const a = setup.sizing.assessed.specifications;
  const s = byId(footprintSpecs(setup));
  assertEq([s.compound.w, s.compound.h], [18, 20]); // two 12 x 4 m modules (3 m clearance) stacked in a compact block
  assertClose(s.radiator.w, Math.sqrt(a.radiator_plot_m2.value), 1e-9);
  assertClose(s.radiator.h, Math.sqrt(a.radiator_plot_m2.value), 1e-9);
  assertClose(s.solar.w, Math.sqrt(a.solar_plot_m2.value), 1e-9);
  assertClose(s.solar.h, s.solar.w, 1e-9);
});

test('specs from a brief setup use the site plot sizes when given', () => {
  const s = byId(footprintSpecs(sizedSetup('example_filled'), { solarPlotM2: 400, radiatorPlotM2: 100 }));
  assertEq([s.solar.w, s.solar.h, s.radiator.w, s.radiator.h], [20, 20, 10, 10]);
});

test('specs from a brief setup: a base connection has no solar part', () => {
  const setup = sizedSetup('base_connection');
  assertEq(setup.power, 'base_only');
  assertEq(footprintSpecs(setup).map((x) => x.id), ['compound', 'radiator']);
});

test('specs from a brief setup: thousands of robots give a compact block, and the plots clear it', () => {
  const setup = sizedSetup('large_fleet');
  const L = setup.sizing.assessed.layout;
  const s = byId(footprintSpecs(setup));
  assertEq([s.compound.w, s.compound.h], [L.block_width_m, L.block_height_m]);
  assert(Math.max(s.compound.w, s.compound.h) / Math.min(s.compound.w, s.compound.h) <= 3, JSON.stringify(s.compound));
  const lay = placeLayout(footprintSpecs(setup), { centerLon: 137.44, centerLat: -4.57, rotationDeg: 0 });
  const box = (f) => { const xs = f.polygon.map((p) => p[0]), ys = f.polygon.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const fps = lay.footprints.map(box);
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) {
    const [a, b] = [fps[i], fps[j]];
    assert(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], lay.footprints[i].id + ' overlaps ' + lay.footprints[j].id);
  }
});
