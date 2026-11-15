// Catalog loading, grids by metric id, and the Site object every later module uses.

const absolute = (u) => new URL(u, globalThis.location ? globalThis.location.href : undefined).href;
const withSlash = (u) => (u.endsWith('/') ? u : u + '/');

export async function loadCatalog(baseUrl = './data/', { fetch: fetchImpl } = {}) {
  const f = fetchImpl || ((u, o) => globalThis.fetch(u, o));
  const base = withSlash(absolute(baseUrl));
  const getJson = async (name) => {
    const res = await f(new URL(name, base));
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + name);
    return res.json();
  };
  const [raw, scenario] = await Promise.all([getJson('catalog.json'), getJson('scenario.json')]);
  return catalogFromRaw(raw, scenario, base, f);
}

export function catalogFromRaw(raw, scenario, baseUrl, fetchImpl) {
  const base = withSlash(absolute(baseUrl));
  const f = fetchImpl || ((u, o) => globalThis.fetch(u, o));
  const byId = new Map((raw.datasets || []).map((d) => [d.id, d]));
  const areas = raw.areas || {};
  const names = new Map(((scenario && scenario.sites) || []).map((s) => [s.id, s.name]));
  const regions = buildRegions(areas, names);
  const sites = regions.flatMap((r) => r.sites);
  return { raw, baseUrl: base, fetch: f, byId, areas, regions, sites, scenario: scenario || {} };
}

// "arcadia_north" -> "Arcadia north"
const siteNameFromId = (id) => { const t = id.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

function buildRegions(areas, names) {
  const mkRegion = (id, name, bounds, studyArea, base, siteBoxes, tripBounds) => ({
    id, name, bounds, studyArea, base, tripBounds,
    sites: Object.entries(siteBoxes || {}).map(([sid, b]) => ({ id: sid, name: names.get(sid) || siteNameFromId(sid), bounds: b, regionId: id })),
  });
  if (areas.regions && Object.keys(areas.regions).length) {
    return Object.entries(areas.regions).map(([key, r]) => {
      const id = r.region_id || key;
      return mkRegion(id, r.name || siteNameFromId(id), r.region || r.gale_region, r.study_area, r.base, r.sites, r.trip_area);
    });
  }
  return [mkRegion('gale', 'Gale crater', areas.gale_region, areas.study_area, areas.base, areas.sites, areas.trip_area)];
}

export function regionOf(catalog, siteId) {
  return catalog.regions.find((r) => r.sites.some((s) => s.id === siteId)) || null;
}

// Datasets whose coverage lies inside the region bounds (grown by 1 degree) or spans every longitude and reaches the region's latitudes.
export function datasetsInRegion(catalog, regionId) {
  const region = catalog.regions.find((r) => r.id === regionId);
  if (!region) return [];
  const [w, s, e, n] = region.bounds;
  const grown = [w - 1, s - 1, e + 1, n + 1];
  return catalog.raw.datasets.filter((d) => {
    const cov = d.coverage;
    if (!cov) return false;
    if (cov.bounds) {
      const b = cov.bounds;
      const allLon = b[2] - b[0] >= 359; // spans every longitude; latitude must still reach the region
      return containsBox(grown, b) || (allLon && b[1] <= grown[1] && b[3] >= grown[3]);
    }
    if (cov.point) return contains(grown, cov.point[0], cov.point[1]);
    return false;
  });
}

const fileOf = (entry, format) => (entry.files || []).find((x) => x.format === format) || null;
const hasMetric = (d, m) => (d.metrics || []).includes(m);
const finest = (list) => list.reduce((best, d) => (!best || d.resolution_m < best.resolution_m ? d : best), null);

export function findGrid(catalog, metricId, areaId) {
  return finest(catalog.raw.datasets.filter((d) =>
    hasMetric(d, metricId) && d.coverage && d.coverage.area === areaId && fileOf(d, 'f32')));
}

const contains = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const containsBox = (b, o) => contains(b, o[0], o[1]) && contains(b, o[2], o[3]);

export function findTripGrid(catalog, site) {
  const region = regionOf(catalog, site.id) || catalog.regions.find((r) => r.id === site.regionId) || catalog.regions[0];
  const base = region.base;
  return finest(catalog.raw.datasets.filter((d) => {
    const file = fileOf(d, 'f32');
    if (!hasMetric(d, 'BT-17') || !file) return false;
    const b = (file.grid && file.grid.bounds) || (d.coverage && d.coverage.bounds);
    return !!b && contains(b, base.lon, base.lat) && containsBox(b, site.bounds);
  }));
}

export async function loadGrid(catalog, entry, format = 'f32') {
  const file = fileOf(entry, format);
  if (!file || !file.grid) throw new Error('no ' + format + ' grid in ' + entry.id);
  const res = await catalog.fetch(new URL(file.path, catalog.baseUrl));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file.path);
  const buf = await res.arrayBuffer();
  const g = file.grid;
  const bands = format === 'u8' ? (g.bands || 1) : 1;
  const count = g.width * g.height * bands;
  const bytes = format === 'u8' ? 1 : 4;
  if (buf.byteLength !== count * bytes) {
    throw new Error(file.path + ': expected ' + count * bytes + ' bytes, got ' + buf.byteLength);
  }
  const data = format === 'u8' ? new Uint8Array(buf) : new Float32Array(buf);
  const [w, s, e, n] = g.bounds;
  const grid = {
    datasetId: entry.id, data, width: g.width, height: g.height, bounds: g.bounds,
    pixelDeg: g.pixel_deg || [(e - w) / g.width, (n - s) / g.height],
    nodata: g.nodata === 'NaN' || g.nodata === undefined || g.nodata === null ? NaN : g.nodata,
    resolutionM: entry.resolution_m, evidence: entry.evidence_type,
  };
  if (format === 'u8') grid.bands = bands;
  return grid;
}

export async function getSite(catalog, siteId) {
  const info = catalog.sites.find((s) => s.id === siteId);
  if (!info) throw new Error('unknown site ' + siteId);
  const loadErrors = {};
  const attempt = async (key, entry, run) => {
    if (!entry) { loadErrors[key] = 'no dataset in the catalog'; return null; }
    try { return await run(entry); } catch (e) { loadErrors[entry.id] = String((e && e.message) || e); return null; }
  };
  const withFile = (m, fmt) => catalog.raw.datasets.find((d) => hasMetric(d, m) && d.coverage && d.coverage.area === siteId && fileOf(d, fmt)) || null;
  const gridRun = (e) => loadGrid(catalog, e);
  const [elevation, slope10, roughness, tripArea, horizon, sunTable] = await Promise.all([
    attempt('BT-04@' + siteId, findGrid(catalog, 'BT-04', siteId), gridRun),
    attempt('BT-05@' + siteId, findGrid(catalog, 'BT-05', siteId), gridRun),
    attempt('BT-08@' + siteId, findGrid(catalog, 'BT-08', siteId), gridRun),
    attempt('BT-17@trip', findTripGrid(catalog, info), gridRun),
    attempt('SC-01@' + siteId, withFile('SC-01', 'u8'), (e) => loadGrid(catalog, e, 'u8')),
    attempt('SC-03@' + siteId, withFile('SC-03', 'json'), async (e) => {
      const file = fileOf(e, 'json');
      const res = await catalog.fetch(new URL(file.path, catalog.baseUrl));
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file.path);
      return res.json();
    }),
  ]);
  return {
    id: info.id, name: info.name, bounds: info.bounds, regionId: info.regionId,
    base: (catalog.regions.find((r) => r.id === info.regionId) || catalog.regions[0]).base,
    grids: { elevation, slope10, roughness }, tripArea, horizon, sunTable,
    catalog, baseUrl: catalog.baseUrl, loadErrors,
  };
}

export function cellOf(grid, lon, lat) {
  const [w, , , n] = grid.bounds;
  const col = Math.floor((lon - w) / grid.pixelDeg[0]);
  const row = Math.floor((n - lat) / grid.pixelDeg[1]);
  if (!(col >= 0 && col < grid.width && row >= 0 && row < grid.height)) return null;
  return { col, row };
}

export function cellCenter(grid, col, row) {
  const [w, , , n] = grid.bounds;
  return { lon: w + (col + 0.5) * grid.pixelDeg[0], lat: n - (row + 0.5) * grid.pixelDeg[1] };
}

export function sampleGrid(grid, lon, lat) {
  const [w, , , n] = grid.bounds;
  const fx = (lon - w) / grid.pixelDeg[0] - 0.5;
  const fy = (n - lat) / grid.pixelDeg[1] - 0.5;
  if (!(fx >= -0.5 && fx <= grid.width - 0.5 && fy >= -0.5 && fy <= grid.height - 0.5)) return NaN;
  const cx = Math.min(Math.max(fx, 0), grid.width - 1);
  const cy = Math.min(Math.max(fy, 0), grid.height - 1);
  const c0 = Math.min(Math.floor(cx), grid.width - 2 < 0 ? 0 : grid.width - 2);
  const r0 = Math.min(Math.floor(cy), grid.height - 2 < 0 ? 0 : grid.height - 2);
  const c1 = Math.min(c0 + 1, grid.width - 1), r1 = Math.min(r0 + 1, grid.height - 1);
  const tx = cx - c0, ty = cy - r0;
  // A corner with zero weight is skipped, so a NaN neighbour cannot spoil an exact cell centre.
  const at = (c, r, wt) => {
    if (wt === 0) return 0;
    const v = grid.data[r * grid.width + c];
    return Number.isNaN(v) || v === grid.nodata ? NaN : v * wt;
  };
  return at(c0, r0, (1 - tx) * (1 - ty)) + at(c1, r0, tx * (1 - ty)) + at(c0, r1, (1 - tx) * ty) + at(c1, r1, tx * ty);
}
