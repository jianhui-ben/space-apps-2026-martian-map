// Synthetic data for tests.

// makeGrid({width, height, bounds: [w, s, e, n], fn: (col, row) => value, nodata = NaN})
// Row 0 is the north edge.
export function makeGrid({ width, height, bounds, fn, nodata = NaN, datasetId = 'fixture', resolutionM = 1, evidence = 'observation' }) {
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) data[row * width + col] = fn(col, row);
  }
  const [w, s, e, n] = bounds;
  return {
    datasetId, data, width, height, bounds,
    pixelDeg: [(e - w) / width, (n - s) / height],
    nodata, resolutionM, evidence,
  };
}

// ---- catalog fixtures (Task 3) ----
import { catalogFromRaw, getSite } from '../src/catalog.js';

const M_PER_DEG = 3396190 * Math.PI / 180;
const FIX_BASE_URL = 'http://fixture.test/data/';

function f32File(path, grid) {
  return {
    path, format: 'f32',
    grid: { width: grid.width, height: grid.height, bounds: grid.bounds, pixel_deg: grid.pixelDeg, dtype: 'f32', nodata: 'NaN' },
    buffer: grid.data.buffer,
  };
}

// Catalog with one 400 x 400 m site at 1 m, centred on (137.44, -4.57), base 300 m south of its south edge.
// opts: {missing: [path], truncate: path}
export function fixtureCatalog(opts = {}) {
  const half = 200 / M_PER_DEG;
  const lon0 = 137.44, lat0 = -4.57;
  const bounds = [lon0 - half, lat0 - half, lon0 + half, lat0 + half];
  const base = { lon: lon0, lat: bounds[1] - 300 / M_PER_DEG };
  const pad = 400 / M_PER_DEG;
  const tripBounds = [bounds[0] - pad, base.lat - pad, bounds[2] + pad, bounds[3] + pad];
  const studyBounds = [bounds[0] - 4 * pad, base.lat - 4 * pad, bounds[2] + 4 * pad, bounds[3] + 4 * pad];

  const files = new Map();
  const mk = (id, metrics, area, resolution_m, grid, file) => {
    const f = f32File(file, grid);
    files.set(f.path, f.buffer);
    const { buffer, ...pub } = f;
    return { id, metrics, coverage: { area, bounds: grid.bounds }, resolution_m, evidence_type: 'derived', files: [pub] };
  };
  const site = (fn, res = 1, n = 400) => makeGrid({ width: n, height: n, bounds, fn });
  const hBuf = new Uint8Array(4 * 4 * 360).fill(5).buffer;
  files.set('horizon_a.u8', hBuf);
  files.set('sun_a.json', new TextEncoder().encode(JSON.stringify({ ok: true })).buffer);

  const datasets = [
    mk('elev_a_fine', ['BT-04'], 'site_a', 1, site((c, r) => 0.1 * c + 0.05 * r), 'elev_a_fine.f32'),
    mk('elev_a_coarse', ['BT-04'], 'site_a', 5, makeGrid({ width: 80, height: 80, bounds, fn: (c) => c }), 'elev_a_coarse.f32'),
    mk('slope_a', ['BT-05'], 'site_a', 1, site(() => 3), 'slope_a.f32'),
    mk('rough_a', ['BT-08'], 'site_a', 1, site(() => 0.1), 'rough_a.f32'),
    {
      id: 'horizon_a', metrics: ['SC-01'], coverage: { area: 'site_a', bounds }, resolution_m: 100, evidence_type: 'derived',
      files: [{ path: 'horizon_a.u8', format: 'u8', grid: { width: 4, height: 4, bands: 360, bounds, pixel_deg: [(bounds[2] - bounds[0]) / 4, (bounds[3] - bounds[1]) / 4], dtype: 'u8', nodata: 255 } }],
    },
    { id: 'sun_a', metrics: ['SC-03'], coverage: { area: 'site_a', bounds }, resolution_m: 100, evidence_type: 'model', files: [{ path: 'sun_a.json', format: 'json' }] },
    mk('trip_2m', ['BT-17', 'BT-18'], 'trip_area', 2, makeGrid({ width: 40, height: 40, bounds: tripBounds, fn: (c) => c, resolutionM: 2 }), 'trip_2m.f32'),
    mk('study_10m', ['BT-17'], 'study_area', 10, makeGrid({ width: 20, height: 20, bounds: studyBounds, fn: (c) => c, resolutionM: 10 }), 'study_10m.f32'),
  ];

  const raw = {
    areas: { gale_region: studyBounds, study_area: studyBounds, trip_area: tripBounds, base, sites: { site_a: bounds } },
    datasets,
  };
  const scenario = {
    sites: [{ id: 'site_a', name: 'Site A', bounds }],
    assumptions: {
      max_local_pad_slope_deg: { value: 10, ideal: 5 },
      max_construction_slope_deg: { value: 5, ideal: 2 },
      max_roughness_m: { value: 0.3 },
      dem_vertical_precision_m: { value: 0.25 },
    },
  };
  const missing = new Set(opts.missing || []);
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname.replace(/^\/data\//, '');
    if (missing.has(path) || !files.has(path)) return new Response('not found', { status: 404 });
    let buf = files.get(path);
    if (opts.truncate === path) buf = buf.slice(0, 16);
    return new Response(buf, { status: 200 });
  };
  return catalogFromRaw(raw, scenario, FIX_BASE_URL, fetchImpl);
}

export function fixtureCatalogWithMissing() {
  return fixtureCatalog({ missing: ['rough_a.f32'] });
}

// A loaded Site over the fixture catalog. overrides.grids is merged into site.grids; other keys replace site fields.
export async function fixtureSite(overrides = {}) {
  const site = await getSite(fixtureCatalog(), 'site_a');
  const { grids, ...rest } = overrides;
  Object.assign(site, rest);
  if (grids) site.grids = { ...site.grids, ...grids };
  return site;
}

// ---- two-region fixture (Task 7b): regions A (10 E, 10 N) and B (50 E, -20 N), each a base, a site and a trip grid ----
// withRegions: false builds the legacy form (no areas.regions), which describes region A only.
export function fixtureRegionsCatalog({ withRegions = true } = {}) {
  const files = new Map();
  const box = (lon, lat, h) => [lon - h, lat - h, lon + h, lat + h];
  const defs = {
    a: { lon: 10, lat: 10, name: 'Region A' },
    b: { lon: 50, lat: -20, name: 'Region B' },
  };
  const datasets = [];
  const regions = {};
  for (const [id, d] of Object.entries(defs)) {
    const region = box(d.lon, d.lat, 1.5), study = box(d.lon, d.lat, 0.3), trip = box(d.lon, d.lat, 0.05);
    const site = box(d.lon, d.lat + 0.02, 0.01);
    const base = { lon: d.lon, lat: d.lat };
    const grid = makeGrid({ width: 4, height: 4, bounds: trip, fn: (c) => c, resolutionM: 2 });
    const file = f32File('trip_' + id + '.f32', grid);
    files.set(file.path, file.buffer);
    const { buffer, ...pub } = file;
    datasets.push({ id: 'trip_' + id, metrics: ['BT-17'], coverage: { area: 'trip_area', bounds: trip }, resolution_m: 2, evidence_type: 'derived', files: [pub] });
    datasets.push({ id: 'climate_' + id, metrics: [], coverage: { point: [d.lon, d.lat] }, resolution_m: 1000, evidence_type: 'model', files: [] });
    regions[id] = { region_id: id, name: d.name, region, study_area: study, base, sites: { ['site_' + id]: site }, trip_area: trip };
  }
  datasets.push({ id: 'global_tes', metrics: [], coverage: { bounds: [-180, -90, 180, 90] }, resolution_m: 100000, evidence_type: 'observation', files: [] });
  datasets.push({ id: 'banded_thermal', metrics: [], coverage: { bounds: [-180, -65, 180, 65] }, resolution_m: 100000, evidence_type: 'observation', files: [] });
  datasets.push({ id: 'polar_cap', metrics: [], coverage: { bounds: [-180, 70, 180, 90] }, resolution_m: 100000, evidence_type: 'observation', files: [] });
  datasets.push({ id: 'far_away', metrics: [], coverage: { bounds: [100, 40, 101, 41] }, resolution_m: 10, evidence_type: 'observation', files: [] });
  datasets.push({ id: 'no_coverage', metrics: [], resolution_m: 10, evidence_type: 'observation', files: [] });
  const a = regions.a;
  const raw = {
    areas: withRegions
      ? { gale_region: a.region, study_area: a.study_area, trip_area: a.trip_area, base: a.base, sites: a.sites, regions }
      : { gale_region: a.region, study_area: a.study_area, trip_area: a.trip_area, base: a.base, sites: a.sites },
    datasets,
  };
  const scenario = { sites: [{ id: 'site_a', name: 'Alpha site', bounds: a.sites.site_a }] };
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname.replace(/^\/data\//, '');
    return files.has(path) ? new Response(files.get(path), { status: 200 }) : new Response('not found', { status: 404 });
  };
  return catalogFromRaw(raw, scenario, FIX_BASE_URL, fetchImpl);
}
