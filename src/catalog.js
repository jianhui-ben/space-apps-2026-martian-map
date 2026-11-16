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

// A response body as an ArrayBuffer; with onBytes, read as a stream and each chunk's size reported as it arrives.
async function readBuffer(res, onBytes) {
  if (!onBytes || !res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    if (onBytes) onBytes(buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader(), len = Number(res.headers.get('content-length')) || 0;
  let out = new Uint8Array(len), n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.byteLength > out.length) { const grown = new Uint8Array(Math.max(out.length * 2, n + value.byteLength)); grown.set(out.subarray(0, n)); out = grown; }
    out.set(value, n);
    n += value.byteLength;
    onBytes(value.byteLength);
  }
  return n === out.length ? out.buffer : out.slice(0, n).buffer;
}

export async function loadGrid(catalog, entry, format = 'f32', { onBytes = null } = {}) {
  const file = fileOf(entry, format);
  if (!file || !file.grid) throw new Error('no ' + format + ' grid in ' + entry.id);
  const res = await catalog.fetch(new URL(file.path, catalog.baseUrl));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file.path);
  const buf = await readBuffer(res, onBytes);
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

// The site's trip-area grid (BT-17), loaded once per dataset and shared by every site it covers. Only the site view
// draws it (the checks never read it), so the region load skips it (getSite { tripArea: false }) and opening a site
// awaits this. Sets site.tripArea (null when there is none or it failed; the failure goes to site.loadErrors).
export function loadTripArea(catalog, site) {
  if (!site) return Promise.resolve(null);
  if (site.tripLoad) return site.tripLoad;
  const info = catalog.sites.find((s) => s.id === site.id) || site;
  const entry = findTripGrid(catalog, info);
  if (!catalog.tripGrids) catalog.tripGrids = new Map(); // dataset id -> Promise<grid>
  if (entry && !catalog.tripGrids.has(entry.id)) catalog.tripGrids.set(entry.id, loadGrid(catalog, entry));
  site.tripLoad = (async () => {
    if (!entry) { site.loadErrors['BT-17@trip'] = 'no dataset in the catalog'; site.tripArea = null; return null; }
    try { site.tripArea = await catalog.tripGrids.get(entry.id); } catch (e) {
      catalog.tripGrids.delete(entry.id); // a later open may retry
      site.loadErrors[entry.id] = String((e && e.message) || e); site.tripArea = null; site.tripLoad = null;
    }
    return site.tripArea;
  })();
  return site.tripLoad;
}

// The files getSite loads for a site (its grids, horizon and sun table; not the trip area), by format and dataset.
function siteFiles(catalog, siteId) {
  const withFile = (m, fmt) => catalog.raw.datasets.find((d) => hasMetric(d, m) && d.coverage && d.coverage.area === siteId && fileOf(d, fmt)) || null;
  return { BT04: findGrid(catalog, 'BT-04', siteId), BT05: findGrid(catalog, 'BT-05', siteId), BT08: findGrid(catalog, 'BT-08', siteId),
    SC01: withFile('SC-01', 'u8'), SC03: withFile('SC-03', 'json') };
}

// The bytes getSite({ tripArea: false }) downloads for one site, from the catalog's file sizes (0 where it gives none).
export function siteBytes(catalog, siteId) {
  const fmt = { BT04: 'f32', BT05: 'f32', BT08: 'f32', SC01: 'u8', SC03: 'json' };
  let total = 0;
  for (const [k, d] of Object.entries(siteFiles(catalog, siteId))) { const f = d && fileOf(d, fmt[k]); total += (f && f.bytes) || 0; }
  return total;
}

// The same for every site of a region, or for those of its sites in ids (a progress line's denominator).
export function regionSiteBytes(catalog, regionId, ids = null) {
  const region = catalog.regions.find((r) => r.id === regionId);
  if (!region) return 0;
  return region.sites.filter((s) => !ids || ids.includes(s.id)).reduce((t, s) => t + siteBytes(catalog, s.id), 0);
}

// onBytes(n), when given, hears every chunk of the site's own files as it arrives (a progress line).
export async function getSite(catalog, siteId, { tripArea: withTrip = true, onBytes = null } = {}) {
  const info = catalog.sites.find((s) => s.id === siteId);
  if (!info) throw new Error('unknown site ' + siteId);
  const loadErrors = {};
  const attempt = async (key, entry, run) => {
    if (!entry) { loadErrors[key] = 'no dataset in the catalog'; return null; }
    try { return await run(entry); } catch (e) { loadErrors[entry.id] = String((e && e.message) || e); return null; }
  };
  const files = siteFiles(catalog, siteId);
  const gridRun = (e) => loadGrid(catalog, e, 'f32', { onBytes });
  const site = {
    id: info.id, name: info.name, bounds: info.bounds, regionId: info.regionId,
    base: (catalog.regions.find((r) => r.id === info.regionId) || catalog.regions[0]).base,
    grids: null, tripArea: null, horizon: null, sunTable: null,
    catalog, baseUrl: catalog.baseUrl, loadErrors,
  };
  const trip = withTrip ? loadTripArea(catalog, site) : null; // alongside the site's own grids
  const [elevation, slope10, roughness, horizon, sunTable] = await Promise.all([
    attempt('BT-04@' + siteId, files.BT04, gridRun),
    attempt('BT-05@' + siteId, files.BT05, gridRun),
    attempt('BT-08@' + siteId, files.BT08, gridRun),
    attempt('SC-01@' + siteId, files.SC01, (e) => loadGrid(catalog, e, 'u8', { onBytes })),
    attempt('SC-03@' + siteId, files.SC03, async (e) => {
      const file = fileOf(e, 'json');
      const res = await catalog.fetch(new URL(file.path, catalog.baseUrl));
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file.path);
      if (!onBytes) return res.json();
      return JSON.parse(new TextDecoder().decode(await readBuffer(res, onBytes)));
    }),
  ]);
  Object.assign(site, { grids: { elevation, slope10, roughness }, horizon, sunTable });
  await trip;
  return site;
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
