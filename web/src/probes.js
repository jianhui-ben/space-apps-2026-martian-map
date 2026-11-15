// Factor probes: what each factor view reads at one point of the open site, for the hover readout. A view registers
// probe(lon, lat, ctx) -> {title?, rows} (ui/factors.js); the factor bar marks the view in force here (setActiveProbe)
// and the site's hover asks probeAt. The row builders below are pure: values in, readout rows out. Missing values read
// "no data"; simulated values carry the "Simulated" chip and never feed a status, the priority or a verdict.
import { regionDataset, THEMIS_CASES, worstNoonSun, horizonDeg, grsBin } from './environment.js';
import { elevationAt } from './frame.js';
import { seededUnit } from './plain.js';

const R = 3396190, DEG = Math.PI / 180, M_PER_DEG = R * DEG;
export const SIMULATED = 'Simulated';

// ---------- the view in force ----------

let active = null; // {id, view, ctx} or null
export function setActiveProbe(a) {
  const next = a && a.view && a.view.probe && a.ctx && a.ctx.site ? a : null;
  const fresh = next && (!active || active.id !== next.id || active.ctx.site !== next.ctx.site);
  active = next;
  if (fresh) { // start the view's loads now, so the first hover finds them ready
    const [w, s, e, n] = next.ctx.site.bounds;
    probeAt((w + e) / 2, (s + n) / 2);
  }
}
export const activeProbeId = () => (active ? active.id : null);
export function probeAt(lon, lat) {
  if (!active) return null;
  try { return active.view.probe(lon, lat, active.ctx); } catch (e) { return { rows: [{ label: 'This view', text: 'no data' }] }; }
}

// ---------- small maths ----------

const fin = Number.isFinite;
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const metresText = (m) => (!fin(m) ? 'no data' : m >= 1000 ? fmt(m / 1000, 2) + ' km' : fmt(m, 0) + ' m');
// Local flat distance in metres (fine over a few km).
export function distanceM(lon1, lat1, lon2, lat2) {
  const kx = M_PER_DEG * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * M_PER_DEG);
}
// Bearing (0 north, clockwise) from a to b.
export function bearingDeg(lon1, lat1, lon2, lat2) {
  const kx = M_PER_DEG * Math.cos(((lat1 + lat2) / 2) * DEG);
  return ((Math.atan2((lon2 - lon1) * kx, (lat2 - lat1) * M_PER_DEG) / DEG) + 360) % 360;
}
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassWord = (deg) => (fin(deg) ? COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] : 'no data');

// The value of a grid's cell under (lon, lat), NaN outside or at nodata.
export function gridAt(grid, lon, lat) {
  if (!grid) return NaN;
  const [w, , , n] = grid.bounds, col = Math.floor((lon - w) / grid.pixelDeg[0]), row = Math.floor((n - lat) / grid.pixelDeg[1]);
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return NaN;
  const v = grid.data[row * grid.width + col];
  return v === v && v !== grid.nodata ? v : NaN;
}

// Slope (degrees) and aspect (the downhill direction, 0 north, clockwise) from an elevation grid's central differences.
// halfM: the half-span the differences take (5 m: a 10 m window, like the site's slope grid), at least one cell.
export function slopeAspect(grid, lon, lat, halfM = 5) {
  if (!grid) return { slopeDeg: NaN, aspectDeg: NaN };
  const dx = Math.max(grid.pixelDeg[0], halfM / (M_PER_DEG * Math.cos(lat * DEG))), dy = Math.max(grid.pixelDeg[1], halfM / M_PER_DEG);
  const e = gridAt(grid, lon + dx, lat), w = gridAt(grid, lon - dx, lat), n = gridAt(grid, lon, lat + dy), s = gridAt(grid, lon, lat - dy);
  if (![e, w, n, s].every(fin)) return { slopeDeg: NaN, aspectDeg: NaN };
  const mx = dx * M_PER_DEG * Math.cos(lat * DEG), my = dy * M_PER_DEG;
  const gx = (e - w) / (2 * mx), gy = (n - s) / (2 * my); // uphill east, uphill north
  const slopeDeg = Math.atan(Math.hypot(gx, gy)) / DEG;
  const aspectDeg = Math.hypot(gx, gy) < 1e-6 ? NaN : ((Math.atan2(-gx, -gy) / DEG) + 360) % 360;
  return { slopeDeg, aspectDeg };
}

// Sun on tilted ground against the same sun on level ground: cos(incidence) / sin(elevation), 0 when facing away.
export function tiltFactor(slopeDeg, aspectDeg, sunElDeg, sunAzDeg) {
  if (![slopeDeg, sunElDeg, sunAzDeg].every(fin) || sunElDeg <= 0) return NaN;
  const s = slopeDeg * DEG, el = sunElDeg * DEG, rel = fin(aspectDeg) ? (sunAzDeg - aspectDeg) * DEG : Math.PI / 2;
  const cosI = Math.sin(el) * Math.cos(s) + Math.cos(el) * Math.sin(s) * Math.cos(rel);
  return Math.max(0, cosI) / Math.sin(el);
}

// Mean hours a sol with the sun above the skyline at one horizon cell, over every season of the sun table. NaN without.
export function sunHoursAt(table, horizon, lon, lat) {
  if (!table || !horizon) return NaN;
  const [w, , , n] = horizon.bounds, col = Math.floor((lon - w) / horizon.pixelDeg[0]), row = Math.floor((n - lat) / horizon.pixelDeg[1]);
  if (col < 0 || row < 0 || col >= horizon.width || row >= horizon.height) return NaN;
  const t = table.ltst_h, step = t.length > 1 ? t[1] - t[0] : NaN;
  if (!fin(step)) return NaN;
  let sum = 0, seasons = 0;
  for (let i = 0; i < table.ls.length; i++) {
    let lit = 0, seen = 0;
    for (let j = 0; j < t.length; j++) {
      const el = table.elevation_deg[i][j];
      if (!(el > 0)) continue;
      const hz = horizonDeg(horizon, col, row, table.azimuth_deg[i][j]);
      if (!fin(hz)) continue;
      seen += 1;
      if (el > hz) lit += 1;
    }
    if (seen) { sum += lit * step; seasons += 1; }
  }
  return seasons ? sum / seasons : NaN;
}

// Polygons and points of GeoJSON, and distances to them.
const ringsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
function inRing([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// The first feature whose polygon (outer ring in, holes out) contains the point, or null.
export function featureAt(fc, lon, lat) {
  for (const f of (fc && fc.features) || []) {
    for (const poly of ringsOf(f.geometry)) {
      if (poly.length && inRing([lon, lat], poly[0]) && !poly.slice(1).some((h) => inRing([lon, lat], h))) return f;
    }
  }
  return null;
}
// The nearest Point feature: {feature, m}, or null without points.
export function nearestPoint(fc, lon, lat) {
  let best = null;
  for (const f of (fc && fc.features) || []) {
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    const [x, y] = f.geometry.coordinates, m = distanceM(lon, lat, x, y);
    if (!best || m < best.m) best = { feature: f, m };
  }
  return best;
}
// Metres to the nearest segment of a set of polylines ([[ [lon, lat], ... ], ...]); NaN without lines.
export function distanceToLines(lines, lon, lat) {
  const kx = M_PER_DEG * Math.cos(lat * DEG), to = ([x, y]) => [(x - lon) * kx, (y - lat) * M_PER_DEG];
  let d = Infinity;
  for (const line of lines || []) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = to(line[i]), [bx, by] = to(line[i + 1]), dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
      d = Math.min(d, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return fin(d) ? d : NaN;
}
// Grade (degrees, + uphill) walking from the base toward the point, over the last stepM metres before it.
export function gradeFromBase(elevAt, base, lon, lat, stepM = 10) {
  if (!base) return NaN;
  const d = distanceM(base.lon, base.lat, lon, lat);
  if (!(d > stepM)) return NaN;
  const f = stepM / d, z1 = elevAt(lon, lat), z0 = elevAt(lon + (base.lon - lon) * f, lat + (base.lat - lat) * f);
  return fin(z0) && fin(z1) ? Math.atan((z1 - z0) / stepM) / DEG : NaN;
}

// ---------- the rows of each factor (pure) ----------

const num = (label, value, digits, unit, evidence) => ({ label, value: fin(value) ? value : NaN, digits, unit, evidence });
const txt = (label, text, evidence) => ({ label, text: text === null || text === undefined || text === '' ? 'no data' : text, evidence });

// Terrain: {elevation, slope, roughness, onDune (true | false | null: no map), slopeLimit, roughLimit, ev: {...}}
export function terrainRows({ elevation, slope, roughness, onDune, slopeLimit = 5, roughLimit = 0.3, ev = {} }) {
  let build = null;
  if (fin(slope) && fin(roughness)) {
    const steep = slope > slopeLimit, rough = roughness > roughLimit;
    build = !steep && !rough ? 'Yes: within ' + slopeLimit + '° and ' + roughLimit + ' m'
      : 'No: ' + [steep ? 'steeper than ' + slopeLimit + '°' : null, rough ? 'rougher than ' + roughLimit + ' m' : null].filter(Boolean).join(', ');
    if (onDune === true) build = 'No: on a dune field';
  }
  return { title: 'Terrain', rows: [
    num('Elevation', elevation, 1, 'm', ev.elevation),
    num('Slope (10 m)', slope, 1, '°', ev.slope),
    num('Roughness', roughness, 2, 'm', ev.roughness),
    txt('On a dune field', onDune === true ? 'Yes' : onDune === false ? 'No' : null, ev.dunes),
    txt('Buildable here', build, build ? 'derived' : null),
  ] };
}

// Ground & ice: {unit: {code, name} | null, mineral: {type, instrument, m} | null, ti, grs: {h2o, sigma} | null, iceSim}
export function groundRows({ unit = null, mineral = null, ti = NaN, grs = null, iceSim = NaN, ev = {} }) {
  return { title: 'Ground & ice', rows: [
    txt('Geologic unit', unit ? unit.name + (unit.code ? ' (' + unit.code + ')' : '') : null, ev.unit || 'interpretation'),
    txt('Nearest mineral find', mineral ? mineral.type + (mineral.instrument ? ', ' + mineral.instrument : '') + ', ' + metresText(mineral.m) + ' away' : null, ev.mineral || 'observation'),
    num('Thermal inertia', ti, 0, 'TIU', ev.ti || 'derived'),
    txt('Water (5° cell)', grs && fin(grs.h2o) ? fmt(grs.h2o, 1) + (fin(grs.sigma) ? ' ± ' + fmt(grs.sigma, 1) : '') + ' wt% H₂O' : null, ev.grs || 'observation'),
    num('Ground ice depth', iceSim, 1, 'm', SIMULATED),
  ] };
}
// A seeded, smooth stand-in for ice depth (m) at a point: no ice data is collected yet. Same point, same value.
export function simulatedIceDepth(siteId, lon, lat) {
  const k = String(siteId), a = 6.283 * seededUnit(k + 'a'), b = 6.283 * seededUnit(k + 'b');
  const v = Math.sin(lon * 900 + a) + Math.sin(lat * 700 + b);
  return 0.5 + 1.5 * (0.5 + v / 4) + seededUnit(k + 'd');
}

// Solar: {slope, aspect, factor, sun: {elDeg, azDeg, ls} | null, sunHours}
export function solarRows({ slope = NaN, aspect = NaN, factor = NaN, sun = null, sunHours = NaN }) {
  const faces = fin(slope) && slope < 0.5 ? 'level' : fin(aspect) ? compassWord(aspect) + ' (' + fmt(aspect, 0) + '°)' : null;
  return { title: 'Solar', rows: [
    txt('Ground faces', faces, 'derived'),
    num('Ground tilt', slope, 1, '°', 'derived'),
    txt('Worst-season noon sun', fin(factor) && sun ? '× ' + fmt(factor, 2) + ' of level ground' : null, 'derived'),
    num('Sun above skyline', sunHours, 1, 'h / sol', 'derived'),
  ] };
}

// Thermal: {k (kelvin), caseName, hour, covered}
export function thermalRows({ k = NaN, caseName = null, hour = NaN }) {
  return { title: 'Thermal', rows: [
    txt('Surface temperature', fin(k) ? fmt(k, 0) + ' K (' + fmt(k - 273.15, 0).replace('-', '−') + ' °C)' : null, 'observation'),
    txt('Temperature case', caseName ? caseName + (fin(hour) ? ', about ' + fmt(hour, 1) + ' h' : '') : null, 'reference'),
  ] };
}

// Routes: {toBase (m), bearing (deg from the base), grade (deg), toPath (m), pathName}
export function routesRows({ toBase = NaN, bearing = NaN, grade = NaN, toPath = NaN, pathName = 'the rover path' }) {
  const g = fin(grade) ? (Math.abs(grade) < 0.5 ? 'level' : (grade > 0 ? 'uphill ' : 'downhill ') + fmt(Math.abs(grade), 1) + '°') : null;
  return { title: 'Routes', rows: [
    txt('To the base', fin(toBase) ? metresText(toBase) + ' straight' + (fin(bearing) ? ', ' + compassWord(bearing) + ' of it' : '') : null, 'derived'),
    txt('Grade from the base', g, 'derived'),
    txt('To ' + pathName, fin(toPath) ? metresText(toPath) : null, 'observation'),
  ] };
}

// ---------- the data a probe reads, per region, loaded once ----------

const store = new Map(); // url -> {state, value}
const fileOf = (d, format) => (d && (d.files || []).find((f) => f.format === format)) || null;
function load(catalog, path, kind, grid) {
  const url = new URL(path, catalog.baseUrl).href;
  let e = store.get(url);
  if (e) return e;
  e = { state: 'loading', value: null };
  store.set(url, e);
  catalog.fetch(url).then(async (r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (kind === 'json') e.value = await r.json();
    else {
      const data = new Float32Array(await r.arrayBuffer()), [w, s, ee, n] = grid.bounds;
      e.value = { data, width: grid.width, height: grid.height, bounds: grid.bounds, nodata: NaN, pixelDeg: grid.pixel_deg || [(ee - w) / grid.width, (n - s) / grid.height] };
    }
    e.state = 'ready';
  }).catch(() => { e.state = 'failed'; });
  return e;
}
// The region's copy of a dataset, loaded (json/geojson or an f32 grid): {value, entry, state} with value null until ready.
export function regionData(catalog, regionId, base, format) {
  const d = regionDataset(catalog, regionId, base), f = fileOf(d, format);
  if (!f) return { value: null, entry: d, state: 'none' };
  const e = load(catalog, f.path, format === 'f32' ? 'grid' : 'json', f.grid);
  return { value: e.value, entry: d, state: e.state };
}

const scen = (catalog, key, fallback) => {
  const a = catalog && catalog.scenario && catalog.scenario.assumptions && catalog.scenario.assumptions[key];
  return a && fin(a.value) ? a.value : fallback;
};

// ---------- the probes the views register ----------

export function terrainProbe(catalog) {
  return (lon, lat, ctx) => {
    const site = ctx.site, g = site.grids || {}, dunes = regionData(catalog, site.regionId, 'dune_fields', 'geojson');
    return terrainRows({
      elevation: elevationAt(site, lon, lat), slope: gridAt(g.slope10, lon, lat), roughness: gridAt(g.roughness, lon, lat),
      onDune: dunes.value ? !!featureAt(dunes.value, lon, lat) : null,
      slopeLimit: scen(catalog, 'max_construction_slope_deg', 5), roughLimit: scen(catalog, 'max_roughness_m', 0.3),
      ev: { elevation: (g.elevation || site.tripArea || {}).evidence, slope: g.slope10 && g.slope10.evidence, roughness: g.roughness && g.roughness.evidence,
        dunes: dunes.entry && dunes.entry.evidence_type },
    });
  };
}

export function groundProbe(catalog) {
  return (lon, lat, ctx) => {
    const rid = ctx.site.regionId;
    const units = regionData(catalog, rid, 'geology_units', 'geojson'), min = regionData(catalog, rid, 'minerals_detections', 'geojson');
    const ti = regionData(catalog, rid, 'thermal_inertia_themis_1km', 'f32'), grs = regionData(catalog, rid, 'water_odyssey_grs', 'json');
    const u = units.value ? featureAt(units.value, lon, lat) : null, p = u && u.properties;
    const near = min.value ? nearestPoint(min.value, lon, lat) : null, mp = near && near.feature.properties;
    const bin = grs.value && grs.value.bins ? grsBin(grs.value, lon, lat) : null;
    return groundRows({
      unit: p ? { code: p.Unit || '', name: p.UnitDesc || p.Unit || 'unnamed unit' } : null,
      mineral: mp ? { type: mp.Type || 'mineral detection', instrument: mp.Instrument || '', m: near.m } : null,
      ti: gridAt(ti.value, lon, lat), grs: bin ? { h2o: bin.h2o_wt_pct, sigma: bin.sigma_wt_pct } : null,
      iceSim: simulatedIceDepth(ctx.site.id, lon, lat),
      ev: { unit: units.entry && units.entry.evidence_type, mineral: min.entry && min.entry.evidence_type, ti: ti.entry && ti.entry.evidence_type, grs: grs.entry && grs.entry.evidence_type },
    });
  };
}

export function solarProbe() {
  return (lon, lat, ctx) => {
    const site = ctx.site, eg = (site.grids && site.grids.elevation) || site.tripArea;
    const { slopeDeg, aspectDeg } = slopeAspect(eg, lon, lat);
    const sun = site.sunTable ? worstNoonSun(site.sunTable) : null;
    return solarRows({ slope: slopeDeg, aspect: aspectDeg, sun, factor: sun ? tiltFactor(slopeDeg, aspectDeg, sun.elDeg, sun.azDeg) : NaN,
      sunHours: sunHoursAt(site.sunTable, site.horizon, lon, lat) });
  };
}

// caseOf(ctx) -> the THEMIS case shown (environment.js THEMIS_CASES entry)
export function thermalProbe(catalog, caseOf) {
  return (lon, lat, ctx) => {
    const c = caseOf(ctx) || THEMIS_CASES[0], g = regionData(catalog, ctx.site.regionId, c.base, 'f32');
    const o = (g.entry && g.entry.observation_time) || {};
    return thermalRows({ k: gridAt(g.value, lon, lat), caseName: c.name, hour: fin(o.local_solar_time_h) ? o.local_solar_time_h : c.hour });
  };
}

export function routesProbe(catalog) {
  return (lon, lat, ctx) => {
    const site = ctx.site, base = site.base, path = regionData(catalog, site.regionId, 'rover_path', 'geojson');
    const lines = path.value ? path.value.features.flatMap((f) => {
      const g = f.geometry;
      return !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    }) : null;
    const name = site.regionId === 'gale' ? 'Curiosity\'s path' : site.regionId === 'jezero' ? 'Perseverance\'s path' : 'the rover path';
    return routesRows({
      toBase: base ? distanceM(base.lon, base.lat, lon, lat) : NaN, bearing: base ? bearingDeg(base.lon, base.lat, lon, lat) : NaN,
      grade: gradeFromBase((x, y) => elevationAt(site, x, y), base, lon, lat), toPath: lines ? distanceToLines(lines, lon, lat) : NaN, pathName: name,
    });
  };
}
