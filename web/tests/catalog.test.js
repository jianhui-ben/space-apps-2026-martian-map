import { loadCatalog, catalogFromRaw, findGrid, findTripGrid, loadGrid, getSite, sampleGrid, cellOf, cellCenter, regionOf, datasetsInRegion } from '../src/catalog.js';
import { makeGrid, fixtureCatalog, fixtureCatalogWithMissing, fixtureSite, fixtureRegionsCatalog } from './fixtures.js';

test('findGrid picks elevation by metric, not name', async () => {
  const c = fixtureCatalog();
  assertEq(findGrid(c, 'BT-04', 'site_a').id, 'elev_a_fine');
  assertEq(findGrid(c, 'BT-05', 'site_a').id, 'slope_a');
  assertEq(findGrid(c, 'BT-04', 'nowhere'), null);
});

test('findTripGrid needs base and site inside, finest wins', async () => {
  const c = fixtureCatalog();
  const site = c.sites.find((s) => s.id === 'site_a');
  assertEq(findTripGrid(c, site).id, 'trip_2m');
  const far = { id: 'far', bounds: [10, 10, 10.01, 10.01] };
  assertEq(findTripGrid(c, far), null);
  // a site inside the 10 m study grid but outside the 2 m trip grid falls back to the study grid
  const t = c.areas.trip_area, st = c.areas.study_area;
  const out = { id: 'out', bounds: [st[0] + 0.0001, st[1] + 0.0001, st[0] + 0.0002, st[1] + 0.0002] };
  assert(out.bounds[0] < t[0], 'test setup: site is outside the trip grid');
  assertEq(findTripGrid(c, out).id, 'study_10m');
});

test('sampleGrid bilinear and NaN-aware', () => {
  const g = makeGrid({ width: 4, height: 4, bounds: [0, 0, 4, 4], fn: (c) => c });
  assertClose(sampleGrid(g, 1.0, 2.0), 0.5, 1e-9); // between centres of col 0 and col 1
  assertClose(sampleGrid(g, 2.5, 2.0), 2, 1e-9);
  assert(Number.isNaN(sampleGrid(g, -1, 2)), 'outside');
  const h = makeGrid({ width: 4, height: 4, bounds: [0, 0, 4, 4], fn: (c, r) => (c === 1 && r === 1 ? NaN : 1) });
  assert(Number.isNaN(sampleGrid(h, 1.5, 2.5)), 'nan corner');
  assertClose(sampleGrid(h, 3.5, 0.5), 1, 1e-9);
});

test('sampleGrid: a NaN neighbour with zero weight does not spoil an exact cell centre', () => {
  const h = makeGrid({ width: 4, height: 4, bounds: [0, 0, 4, 4], fn: (c, r) => (c === 1 && r === 1 ? NaN : 10 * c + r) });
  assertClose(sampleGrid(h, 0.5, 2.5), 1, 1e-9); // centre of (col 0, row 1); (1, 1) is NaN but weighs 0
  assertClose(sampleGrid(h, 1.5, 3.5), 10, 1e-9); // centre of (col 1, row 0); the row below holds the NaN
  assertClose(sampleGrid(h, 0.5, 0.5), 3, 1e-9); // south-west corner cell, clamped
  assert(Number.isNaN(sampleGrid(h, 1.0, 2.5)), 'half weight on the NaN cell');
});

test('cellOf and cellCenter, row 0 is north', () => {
  const g = makeGrid({ width: 4, height: 2, bounds: [10, 0, 14, 2], fn: () => 0 });
  assertEq(cellOf(g, 10.5, 1.5), { col: 0, row: 0 });
  assertEq(cellOf(g, 13.5, 0.5), { col: 3, row: 1 });
  assertEq(cellOf(g, 9, 1), null);
  const c = cellCenter(g, 3, 1);
  assertClose(c.lon, 13.5, 1e-9);
  assertClose(c.lat, 0.5, 1e-9);
});

test('getSite loads grids, trip grid, horizon and sun table', async () => {
  const s = await getSite(fixtureCatalog(), 'site_a');
  assertEq(s.id, 'site_a');
  assertEq(s.name, 'Site A');
  assertEq(s.grids.elevation.width, 400);
  assertEq(s.grids.elevation.datasetId, 'elev_a_fine');
  assert(Number.isNaN(s.grids.elevation.nodata), 'f32 nodata normalised to NaN');
  assertEq(s.tripArea.datasetId, 'trip_2m');
  assertEq(s.horizon.bands, 360);
  assertEq(s.horizon.nodata, 255);
  assertEq(s.sunTable.ok, true);
  assertEq(Object.keys(s.loadErrors).length, 0);
  assertEq(s.base, s.catalog.areas.base);
});

test('getSite survives a missing file', async () => {
  const s = await getSite(fixtureCatalogWithMissing(), 'site_a');
  assertEq(s.grids.roughness, null);
  assert(s.loadErrors.rough_a, 'error recorded');
  assertEq(s.grids.elevation.width, 400);
});

test('loadGrid rejects a size mismatch', async () => {
  const c = fixtureCatalog({ truncate: 'elev_a_fine.f32' });
  let err = null;
  try { await loadGrid(c, c.byId.get('elev_a_fine')); } catch (e) { err = e; }
  assert(err, 'rejected');
});

test('fixtureSite returns a loaded site', async () => {
  const s = await fixtureSite();
  assertEq(s.grids.elevation.width, 400);
  assertEq(s.catalog.scenario.assumptions.max_local_pad_slope_deg.ideal, 5);
});

test('regions: built from areas.regions with names', () => {
  const c = fixtureRegionsCatalog();
  assertEq(c.regions.map((r) => r.id), ['a', 'b']);
  const b = c.regions[1];
  assertEq(b.name, 'Region B');
  assertEq(b.base, { lon: 50, lat: -20 });
  assertEq(b.bounds, [48.5, -21.5, 51.5, -18.5]);
  assertEq(b.studyArea, [49.7, -20.3, 50.3, -19.7]);
  assertEq(b.tripBounds, [49.95, -20.05, 50.05, -19.95]);
  assertEq(b.sites.map((s) => [s.id, s.name, s.regionId]), [['site_b', 'Site b', 'b']]); // name derived from the id
  assertEq(c.regions[0].sites[0].name, 'Alpha site'); // scenario name wins when the id matches
  assertEq(c.sites.map((s) => s.id), ['site_a', 'site_b']);
  assertEq(c.sites.map((s) => s.regionId), ['a', 'b']);
});

test('regions: legacy catalog without areas.regions gives one gale region', () => {
  const c = fixtureCatalog();
  assertEq(c.regions.length, 1);
  const g = c.regions[0];
  assertEq(g.id, 'gale');
  assertEq(g.name, 'Gale crater');
  assertEq(g.bounds, c.areas.gale_region);
  assertEq(g.base, c.areas.base);
  assertEq(g.tripBounds, c.areas.trip_area);
  assertEq(g.sites.map((s) => [s.id, s.name, s.regionId]), [['site_a', 'Site A', 'gale']]);
  assertEq(c.sites[0].regionId, 'gale');
  assertEq(regionOf(c, 'site_a').id, 'gale');
  assertEq(regionOf(c, 'nope'), null);
});

test('getSite uses the site region base', async () => {
  const c = fixtureRegionsCatalog();
  const site = await getSite(c, 'site_b');
  assertEq(site.base, { lon: 50, lat: -20 });
  assertEq(site.regionId, 'b');
  assertEq(regionOf(c, 'site_b').id, 'b');
  assertEq((await getSite(c, 'site_a')).base, { lon: 10, lat: 10 });
});

test('findTripGrid tests the site region base', async () => {
  const c = fixtureRegionsCatalog();
  const sb = c.sites.find((s) => s.id === 'site_b');
  assertEq(findTripGrid(c, sb).id, 'trip_b');
  assertEq(findTripGrid(c, c.sites.find((s) => s.id === 'site_a')).id, 'trip_a');
  const site = await getSite(c, 'site_b');
  assertEq(site.tripArea.datasetId, 'trip_b');
  assertEq(Object.keys(site.loadErrors).filter((k) => k.startsWith('BT-17')).length, 0);
});

test('datasetsInRegion includes global and in-bounds datasets only', () => {
  const c = fixtureRegionsCatalog();
  const ids = (r) => datasetsInRegion(c, r).map((d) => d.id).sort();
  assertEq(ids('a'), ['banded_thermal', 'climate_a', 'global_tes', 'trip_a']);
  assertEq(ids('b'), ['banded_thermal', 'climate_b', 'global_tes', 'trip_b']);
  assert(!ids('a').includes('polar_cap') && !ids('b').includes('polar_cap'), 'full-longitude band outside the region latitudes is left out');
  assertEq(datasetsInRegion(c, 'nope'), []);
});
