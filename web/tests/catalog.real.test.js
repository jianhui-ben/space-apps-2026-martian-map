import { loadCatalog, findGrid, findTripGrid, getSite, regionOf, datasetsInRegion } from '../src/catalog.js';

test('real: near_base_north grids and 2 m trip area', async () => {
  const s = await getSite(await loadCatalog('/data/'), 'near_base_north');
  assertEq(s.grids.elevation.width, 2003);
  assertEq(s.tripArea.datasetId, 'elevation_2m_trip_area');
  assertEq(s.horizon.bands, 360);
  assertEq(s.name, 'Near base, north (crater floor)');
  assert(s.sunTable && typeof s.sunTable === 'object', 'sun table');
  assertEq(Object.keys(s.loadErrors).length, 0);
});

test('real: curiosity_recent falls back to the 10 m study grid', async () => {
  const c = await loadCatalog('/data/');
  const site = c.sites.find((x) => x.id === 'curiosity_recent');
  assertEq(findTripGrid(c, site).id, 'elevation_10m_study');
  assertEq(findGrid(c, 'BT-05', 'curiosity_recent').id, 'slope_10m_window_curiosity_recent');
  assertEq(findGrid(c, 'BT-08', 'curiosity_recent').id, 'roughness_1m_curiosity_recent');
});

test('real: three regions gale, jezero, arcadia', async () => {
  const c = await loadCatalog('/data/');
  assertEq(c.regions.map((r) => r.id).sort(), ['arcadia', 'gale', 'jezero']);
  const by = Object.fromEntries(c.regions.map((r) => [r.id, r]));
  assertEq(by.gale.name, 'Gale crater');
  assertEq(by.jezero.name, 'Jezero crater');
  assertEq(by.arcadia.name, 'Arcadia Planitia');
  assertEq(by.gale.sites.map((s) => s.id), ['curiosity_recent', 'near_base_north', 'near_base_west']);
  assertEq(by.jezero.sites.map((s) => s.id), ['jezero_north', 'jezero_south']);
  assertEq(by.arcadia.sites.map((s) => s.id), ['arcadia_north', 'arcadia_south']);
  assertEq(by.arcadia.sites.map((s) => s.name), ['Arcadia north', 'Arcadia south']);
  assertEq(c.sites.length, 7);
  assertEq(regionOf(c, 'jezero_south').id, 'jezero');
  assert(datasetsInRegion(c, 'jezero').some((d) => d.id === 'dust_climate_mcd__jezero'), 'jezero climate');
  assert(!datasetsInRegion(c, 'jezero').some((d) => d.id === 'dust_climate_mcd__arcadia'), 'no arcadia climate in jezero');
  assert(datasetsInRegion(c, 'gale').some((d) => d.id === 'dust_climate_mcd'), 'gale climate');
});

test('real: arcadia_north grids, base and trip area', async () => {
  const c = await loadCatalog('/data/');
  const s = await getSite(c, 'arcadia_north');
  assert(s.grids.elevation && s.grids.elevation.width > 0, 'elevation');
  assertEq(s.tripArea.datasetId, 'elevation_2m_trip_area__arcadia');
  assertEq(s.base, { lon: -167.097, lat: 39.089 });
  assertEq(s.regionId, 'arcadia');
  assertEq(Object.keys(s.loadErrors).length, 0);
});

test('real: every web/datasets.json id exists in the catalog', async () => {
  const c = await loadCatalog('/data/');
  const list = await (await fetch('/datasets.json')).json();
  assert(list.length > 60, 'list covers all three regions');
  for (const e of list) {
    const id = typeof e === 'string' ? e : e.id;
    assert(c.byId.has(id), 'missing from catalog: ' + id);
    if (typeof e !== 'string') {
      for (const f of e.formats) assert(c.byId.get(id).files.some((x) => x.format === f), id + ' has no ' + f);
    }
  }
});
