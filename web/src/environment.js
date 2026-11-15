// Environment metrics (Task 12): solar shading and energy (SC-01, SC-03, SC-04), thermal cases (TC-01), dune setback and
// movement (BT-15, BT-16) and the orbital water background (GI-05). Pure functions over the Site, the layout, the setup
// and the region's environment data (loadEnvironment). Every dataset is found per region (regionDataset), never another
// region's by name; a region without the data reads needs_confirmation. Missing data never reads as fine.
import { datasetsInRegion } from './catalog.js';
import { cellsUnder, LOADS } from './layout.js';
import { STATUS, statusFor } from './status.js';

const R = 3396190;
const RAD = Math.PI / 180;
const M_PER_DEG = R * RAD;
export const ETA = 0.20; // panel efficiency (assumption; reproduces docs/reference-facility.md's 20-60 W/m2 net)
export const APHELION_LS = 71, PERIHELION_LS = 251;
export const THEMIS_CASES = [
  { key: 'dayAph', base: 'themis_temp_day_aphelion', name: 'day, aphelion', ls: APHELION_LS, hour: 17 },
  { key: 'dayPeri', base: 'themis_temp_day_perihelion', name: 'day, perihelion', ls: PERIHELION_LS, hour: 17 },
  { key: 'nightAph', base: 'themis_temp_night_aphelion', name: 'night, aphelion', ls: APHELION_LS, hour: 6 },
  { key: 'nightPeri', base: 'themis_temp_night_perihelion', name: 'night, perihelion', ls: PERIHELION_LS, hour: 6 },
];

// ---------- finding a region's copy of a dataset ----------

// The region's copy of a dataset: the one the catalog marks with that region, else the `__<region>` copy, else an
// unsuffixed one whose coverage lies in the region (datasetsInRegion). Null when the region has none.
export function regionDataset(catalog, regionId, base) {
  const all = catalog.raw.datasets.filter((d) => (d.dataset || d.id.split('__')[0]) === base);
  return all.find((d) => d.region === regionId)
    || all.find((d) => d.id === base + '__' + regionId)
    || (all.some((d) => d.region) ? null : datasetsInRegion(catalog, regionId).find((d) => d.id === base))
    || null;
}
const fileOf = (d, format) => (d && (d.files || []).find((f) => f.format === format)) || null;

// The region's environment data. Each part is null where the region has no such file; errors[key] says why a file
// that exists failed. ids[key] is the dataset id each part came from (References, Details).
export async function loadEnvironment(catalog, regionId) {
  const errors = {}, ids = {};
  const json = async (key, base, format = 'json') => {
    const d = regionDataset(catalog, regionId, base), f = fileOf(d, format);
    if (!f) return null;
    ids[key] = d.id;
    try {
      const res = await catalog.fetch(new URL(f.path, catalog.baseUrl));
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + f.path);
      return await res.json();
    } catch (e) { errors[key] = String((e && e.message) || e); return null; }
  };
  const grid = async (key, base) => {
    const d = regionDataset(catalog, regionId, base), f = fileOf(d, 'f32');
    if (!f || !f.grid) return null;
    ids[key] = d.id;
    try {
      const res = await catalog.fetch(new URL(f.path, catalog.baseUrl));
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + f.path);
      const g = f.grid, data = new Float32Array(await res.arrayBuffer());
      if (data.length !== g.width * g.height) throw new Error(f.path + ': expected ' + g.width * g.height + ' values, got ' + data.length);
      const [w, s, e, n] = g.bounds;
      return { datasetId: d.id, data, width: g.width, height: g.height, bounds: g.bounds, nodata: NaN,
        pixelDeg: g.pixel_deg || [(e - w) / g.width, (n - s) / g.height], evidence: d.evidence_type, observation: d.observation_time || {} };
    } catch (e) { errors[key] = String((e && e.message) || e); return null; }
  };
  const [mcdSolar, mcdThermal, dunes, duneShifts, grs, ...themis] = await Promise.all([
    json('mcdSolar', 'dust_climate_mcd'), json('mcdThermal', 'temperature_climate_mcd'),
    json('dunes', 'dune_fields', 'geojson'), json('duneShifts', 'dune_change_imagery'), json('grs', 'water_odyssey_grs'),
    ...THEMIS_CASES.map((c) => grid(c.key, c.base)),
  ]);
  const grsEntry = regionDataset(catalog, regionId, 'water_odyssey_grs');
  return {
    regionId, mcdSolar, mcdThermal, dunes, duneShifts, grs, errors, ids,
    themis: Object.fromEntries(THEMIS_CASES.map((c, i) => [c.key, themis[i]])),
    evidence: { dunes: (regionDataset(catalog, regionId, 'dune_fields') || {}).evidence_type, grs: grsEntry && grsEntry.evidence_type },
  };
}

// ---------- sun and horizon ----------

// Horizon elevation (degrees) at a horizon cell for an azimuth (0 north, clockwise; 1 degree bands), NaN where no data.
export function horizonDeg(grid, col, row, azDeg) {
  const bands = grid.bands || 360, band = ((Math.round(azDeg) % bands) + bands) % bands;
  const v = grid.data[(row * grid.width + col) * bands + band];
  return v === 255 ? NaN : v * 0.25;
}

// The horizon cells inside a footprint, or the one nearest its centre when none is.
export function plotPoints(grid, fp) {
  const pts = [];
  cellsUnder(grid, fp, (col, row) => pts.push({ col, row }));
  if (pts.length) return pts;
  const [w, , , n] = grid.bounds;
  const col = Math.min(grid.width - 1, Math.max(0, Math.floor((fp.center.lon - w) / grid.pixelDeg[0])));
  const row = Math.min(grid.height - 1, Math.max(0, Math.floor((n - fp.center.lat) / grid.pixelDeg[1])));
  return [{ col, row }];
}

// Share of the points with the sun above their skyline at sun table step (ls index i, time index j); NaN without data.
export function sunlitShare(table, grid, points, i, j) {
  const el = table.elevation_deg[i][j], az = table.azimuth_deg[i][j];
  let n = 0, lit = 0;
  for (const p of points) {
    const hz = horizonDeg(grid, p.col, p.row, az);
    if (!Number.isFinite(hz)) continue;
    n += 1;
    if (el > hz) lit += 1;
  }
  return n ? lit / n : NaN;
}

// SC-01: 1 − Σ sin⁺(el)·sunlit / Σ sin⁺(el) over every (ls, t) of the sun table, in %.
export function shadingLoss(table, grid, points) {
  let num = 0, den = 0;
  for (let i = 0; i < table.ls.length; i++) {
    for (let j = 0; j < table.ltst_h.length; j++) {
      const s = Math.sin(table.elevation_deg[i][j] * RAD);
      if (!(s > 0)) continue;
      const f = sunlitShare(table, grid, points, i, j);
      if (!Number.isFinite(f)) return NaN;
      num += s * f; den += s;
    }
  }
  return den > 0 ? 100 * (1 - num / den) : NaN;
}

// A Mars Climate Database scenario's flux at season index k, linearly interpolated from its local times to hour t.
export function fluxAt(scenario, k, t) {
  const lt = scenario.local_time_h, row = scenario.surface_solar_flux_down_w_m2[k];
  if (t <= lt[0]) return row[0];
  for (let j = 0; j + 1 < lt.length; j++) {
    if (t <= lt[j + 1]) { const a = (t - lt[j]) / (lt[j + 1] - lt[j]); return row[j] * (1 - a) + row[j + 1] * a; }
  }
  return row[row.length - 1];
}
const nearestIndex = (list, v) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);

// PV (kW) at every season of an MCD scenario × every sun table time: flux × sunlit × η × A_panel / 1000.
// Returns [{ls, kw: [per time]}], one per scenario season (matched to the sun table's nearest season).
export function pvSeries(table, grid, points, scenario, areaM2, eta = ETA) {
  return scenario.ls.map((ls, k) => {
    const i = nearestIndex(table.ls, ls);
    return { ls, kw: table.ltst_h.map((t, j) => {
      const f = sunlitShare(table, grid, points, i, j);
      return fluxAt(scenario, k, t) * (Number.isFinite(f) ? f : NaN) * eta * areaM2 / 1000;
    }) };
  });
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// The sun at the worst season's noon (the season whose noon sun is lowest): {ls, azDeg, elDeg}.
export function worstNoonSun(table) {
  const j = nearestIndex(table.ltst_h, 12);
  let best = 0;
  for (let i = 1; i < table.ls.length; i++) if (table.elevation_deg[i][j] < table.elevation_deg[best][j]) best = i;
  return { ls: table.ls[best], azDeg: table.azimuth_deg[best][j], elDeg: table.elevation_deg[best][j] };
}

// The sun's path at a season (nearest sun table season): [{t, azDeg, elDeg}] above the horizontal.
export function sunPath(table, ls) {
  const i = nearestIndex(table.ls, ls);
  return table.ltst_h.map((t, j) => ({ t, azDeg: table.azimuth_deg[i][j], elDeg: table.elevation_deg[i][j] })).filter((p) => p.elDeg > 0);
}

// The skyline (degrees per azimuth 0..359) seen from the horizon cell nearest a point.
export function skyline(grid, fp) {
  const [p] = plotPoints(grid, { ...fp, w: 0, h: 0 });
  return Array.from({ length: grid.bands || 360 }, (_, az) => horizonDeg(grid, p.col, p.row, az));
}

// ---------- dunes ----------

const local = (lon0, lat0) => { const kx = M_PER_DEG * Math.cos(lat0 * RAD); return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG]; };
function rings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const ringDist = (pts, ring) => {
  let d = Infinity;
  for (const p of pts) for (let i = 0; i + 1 < ring.length; i++) d = Math.min(d, segDist(p, ring[i], ring[i + 1]));
  return d;
};

// Metres from the nearest footprint edge to the nearest dune-field edge; 0 when they touch or overlap. NaN without
// polygons. (Vertex-to-edge both ways is exact for polygons that don't cross; crossing ones are caught as inside.)
export function duneSetback(footprints, geojson) {
  const polys = ((geojson && geojson.features) || []).flatMap((f) => rings(f.geometry)).filter((r) => r.length > 2);
  if (!polys.length || !footprints.length) return NaN;
  const c = footprints[0].center, to = local(c.lon, c.lat);
  const fps = footprints.map((f) => { const r = f.polygon.map(to); return r.concat([r[0]]); });
  const dunes = polys.map((r) => r.map(to));
  let d = Infinity;
  for (const f of fps) {
    for (const r of dunes) {
      if (f.some((p) => inside(p, r)) || r.some((p) => inside(p, f))) return 0;
      d = Math.min(d, ringDist(f, r), ringDist(r, f));
    }
  }
  return d;
}

// ---------- the Results ----------

const META = {
  'SC-01': { unit: '%', pd: 'P', appliesTo: 'solar' },
  'SC-03': { unit: 'kW', pd: 'P', appliesTo: 'solar' },
  'SC-04': { unit: '', pd: 'D', appliesTo: 'solar' },
  'TC-01': { unit: '', pd: 'D', appliesTo: 'radiator' },
  'BT-15': { unit: 'm', pd: 'D', appliesTo: 'layout' },
  'BT-16': { unit: 'm/yr', pd: 'D', appliesTo: 'layout' },
  'GI-05': { unit: 'wt% H₂O', pd: 'D', appliesTo: 'compound' },
};
function result(id, o) {
  const m = META[id];
  return {
    id, value: o.value === undefined || o.value === null || !Number.isFinite(o.value) ? null : o.value, unit: m.unit, display: o.display || '—',
    target: { baseline: o.baseline || '', ideal: o.ideal || '', label: m.pd },
    status: o.status, ideal: !!o.isIdeal, evidence: o.evidence || 'model', note: o.note || '',
    assumption: !!o.assumption, straddles: false, appliesTo: m.appliesTo,
  };
}
const fmt = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const km = (m) => (m >= 1000 ? fmt(m / 1000, 1) + ' km' : fmt(m, 0) + ' m');
const NO_DATA = (what) => 'no ' + what + ' here: needs confirmation';
const failed = (env, key) => env.errors && env.errors[key] ? key + ' failed to load: ' + env.errors[key] : null;

// environmentChecks(site, layout, setup, env) -> Map<id, Result>. SC metrics are left out for base_only (their initial
// not_applicable stands) and BT-16/BT-15/GI-05/TC-01 read needs_confirmation where the region has no data.
export function environmentChecks(site, layout, setup, env) {
  const out = new Map();
  const fp = (id) => (layout && layout.footprints || []).find((f) => f.id === id) || null;
  const solar = fp('solar'), radiator = fp('radiator');
  const power = setup && setup.power, L = LOADS[setup && setup.loadKw] || NaN;
  env = env || { errors: {}, themis: {} };

  // ---- solar: SC-01 shading, SC-03 average, SC-04 worst season ----
  if (power !== 'base_only') {
    const grid = site.horizon, table = site.sunTable;
    const points = grid && table && solar ? plotPoints(grid, solar) : null;
    const loss = points ? shadingLoss(table, grid, points) : NaN;
    if (Number.isFinite(loss)) {
      const s = statusFor({ value: loss, baseline: 10, ideal: 5, compare: '<=' });
      out.set('SC-01', result('SC-01', { value: loss, display: fmt(loss, 1) + '%', baseline: '≤ 10%', ideal: '≤ 5%', status: s.status, isIdeal: s.ideal,
        evidence: 'model', note: 'share of daytime sun blocked by the skyline at the solar plot (' + points.length + ' horizon point' + (points.length === 1 ? '' : 's') + ', 100 m)' }));
    } else {
      out.set('SC-01', result('SC-01', { status: STATUS.NEEDS_CONFIRMATION, baseline: '≤ 10%', ideal: '≤ 5%',
        note: (site.loadErrors && Object.keys(site.loadErrors).find((k) => /SC-0[13]|horizon|sun_table/.test(k))) ? 'the horizon or sun table failed to load' : NO_DATA('horizon or sun table') }));
    }
    const clim = env.mcdSolar && env.mcdSolar.scenarios && env.mcdSolar.scenarios.climatology;
    const storm = env.mcdSolar && env.mcdSolar.scenarios && env.mcdSolar.scenarios.dust_storm;
    const area = solar ? solar.w * solar.h / 2 : NaN; // A_panel: half the plot (assumption)
    const pv = points && clim ? pvSeries(table, grid, points, clim, area) : null;
    const avg = pv ? mean(pv.flatMap((s) => s.kw)) : NaN;
    const solarOnly = power === 'solar_batteries';
    const sc03base = solarOnly ? '≥ ' + fmt(L, 0) + ' kW (the load, assumption)' : '≥ 100 kW', sc03ideal = solarOnly ? '' : '≥ 120 kW';
    const how = 'η 0.20 and panels on half the plot (' + fmt(area, 0) + ' m²), assumptions; Mars Climate Database climatology flux (model)';
    if (Number.isFinite(avg)) {
      const s = statusFor({ value: avg, baseline: solarOnly ? L : 100, ideal: solarOnly ? undefined : 120, compare: '>=' });
      out.set('SC-03', result('SC-03', { value: avg, display: fmt(avg, 0) + ' kW', baseline: sc03base, ideal: sc03ideal, status: s.status, isIdeal: s.ideal,
        evidence: 'model', assumption: true, note: how }));
    } else {
      out.set('SC-03', result('SC-03', { status: STATUS.NEEDS_CONFIRMATION, baseline: sc03base, ideal: sc03ideal,
        note: failed(env, 'mcdSolar') || (clim ? NO_DATA('horizon or sun table') : NO_DATA('climate model data')) }));
    }
    if (solarOnly) {
      const worst = pv ? Math.min(...pv.map((s) => mean(s.kw))) / L : NaN;
      const sp = points && storm ? pvSeries(table, grid, points, storm, area) : null;
      const stormRatio = sp ? Math.min(...sp.map((s) => mean(s.kw))) / L : NaN;
      if (Number.isFinite(worst)) {
        const s = statusFor({ value: worst, baseline: 1.0, ideal: 1.2, compare: '>=' });
        out.set('SC-04', result('SC-04', { value: worst, display: fmt(worst, 2), baseline: '≥ 1.0', ideal: '≥ 1.2', status: s.status, isIdeal: s.ideal,
          evidence: 'model', assumption: true,
          note: 'worst season of the climatology against the ' + fmt(L, 0) + ' kW load' + (Number.isFinite(stormRatio) ? '; ' + fmt(stormRatio, 2) + ' in a global dust storm' : '') }));
      } else {
        out.set('SC-04', result('SC-04', { status: STATUS.NEEDS_CONFIRMATION, baseline: '≥ 1.0', ideal: '≥ 1.2', note: NO_DATA('climate model data') }));
      }
    } else {
      out.set('SC-04', result('SC-04', { status: STATUS.NEEDS_DESIGN_INPUT, baseline: '≥ 1.0', ideal: '≥ 1.2',
        note: 'needs the solar share of the load: the solar option is a top-up here' }));
    }
  } else {
    for (const id of ['SC-03', 'SC-04']) out.set(id, result(id, { status: STATUS.NOT_APPLICABLE, note: 'no solar plot in this power option' }));
  }

  // ---- TC-01: THEMIS temperature cases over the radiator plot ----
  if (radiator) {
    const seen = [], missing = [], anyThemis = THEMIS_CASES.some((c) => env.themis && env.themis[c.key]);
    for (const c of THEMIS_CASES) {
      const g = env.themis && env.themis[c.key];
      const vals = [];
      if (g) {
        cellsUnder(g, radiator, (col, row) => { const v = g.data[row * g.width + col]; if (Number.isFinite(v)) vals.push(v); });
        if (!vals.length) { // a plot smaller than a pixel: the pixel under its centre
          const col = Math.floor((radiator.center.lon - g.bounds[0]) / g.pixelDeg[0]), row = Math.floor((g.bounds[3] - radiator.center.lat) / g.pixelDeg[1]);
          const v = col >= 0 && row >= 0 && col < g.width && row < g.height ? g.data[row * g.width + col] : NaN;
          if (Number.isFinite(v)) vals.push(v);
        }
      }
      if (vals.length) seen.push({ ...c, k: mean(vals) }); else missing.push(c);
    }
    const parts = [];
    if (seen.length) parts.push('THEMIS ' + fmt(Math.min(...seen.map((c) => c.k)), 0) + '–' + fmt(Math.max(...seen.map((c) => c.k)), 0) + ' K over ' + seen.map((c) => c.name).join(', '));
    const th = env.mcdThermal && env.mcdThermal.scenarios;
    if (missing.length) {
      const model = th ? missing.map((c) => {
        const ks = ['climatology', 'cold', 'warm'].filter((s) => th[s]).map((s) => {
          const sc = th[s], i = nearestIndex(sc.ls, c.ls), j = nearestIndex(sc.local_time_h, c.hour);
          return sc.surface_temperature_k[i][j];
        });
        return c.name + ' ' + (ks.length ? fmt(Math.min(...ks), 0) + '–' + fmt(Math.max(...ks), 0) + ' K' : 'no value');
      }) : [];
      parts.push(th ? 'not observed: ' + missing.map((c) => c.name).join(', ') + ' (Mars Climate Database surface, model: ' + model.join('; ') + ')'
        : 'not observed: ' + missing.map((c) => c.name).join(', ') + ', and no climate model data here');
    }
    out.set('TC-01', result('TC-01', { value: seen.length, display: seen.length + ' of 4 cases observed', baseline: '4 of 4 cases', ideal: '4 of 4, with observations',
      // a region with THEMIS data keeps the field check open even where no case covers the plot, so a site never ranks
      // higher for missing data; a region with none at all reads needs confirmation
      status: seen.length || anyThemis ? STATUS.NEEDS_FIELDWORK : STATUS.NEEDS_CONFIRMATION, evidence: seen.length ? 'observation' : 'model',
      note: (seen.length ? '' : anyThemis ? 'no THEMIS case covers the radiator plot: needs confirmation; ' : NO_DATA('thermal-imaging data') + '; ') + parts.join('; ') }));
  }

  // ---- BT-15 dune setback, BT-16 dune movement ----
  const dunesN = env.dunes && env.dunes.features ? env.dunes.features.length : 0;
  const d = env.dunes && dunesN ? duneSetback(layout ? layout.footprints : [], env.dunes) : NaN;
  if (Number.isFinite(d)) {
    out.set('BT-15', result('BT-15', { value: d, display: km(d) + ' to the nearest mapped dune field', baseline: '≥ required setback', ideal: '≥ 1.5 × required setback',
      status: STATUS.NEEDS_FIELDWORK, evidence: env.evidence && env.evidence.dunes || 'interpretation',
      note: 'the required setback needs material and stability evidence; global dune survey outlines (small dunes inside a site are not mapped)' }));
  } else {
    out.set('BT-15', result('BT-15', { status: STATUS.NEEDS_CONFIRMATION, baseline: '≥ required setback', ideal: '≥ 1.5 × required setback',
      note: failed(env, 'dunes') || (env.dunes ? 'no dune fields mapped here: needs confirmation' : NO_DATA('dune-field map')) }));
  }
  const edges = env.duneShifts && env.duneShifts.summary && env.duneShifts.summary.sand_edges;
  const rate = edges ? edges.moving_rate_m_per_earth_year : NaN;
  if (Number.isFinite(rate)) {
    const pub = ((env.duneShifts.published_rates || [])[0]) || null;
    out.set('BT-16', result('BT-16', { value: rate, display: fmt(rate, 3) + ' m per Earth year', baseline: '> 0 m clearance', ideal: '> lifecycle reserve',
      status: STATUS.NEEDS_FIELDWORK, evidence: 'observation',
      note: 'measured sand-edge movement between two HiRISE images' + (pub ? '; published ' + pub.value_m_per_earth_year + ' m/yr (' + String(pub.source).split('(')[0].trim() + ')' : '') }));
  } else {
    out.set('BT-16', result('BT-16', { status: STATUS.NEEDS_CONFIRMATION, baseline: '> 0 m clearance', ideal: '> lifecycle reserve',
      note: failed(env, 'duneShifts') || NO_DATA('measured dune movement') }));
  }

  // ---- GI-05: the Odyssey GRS bin containing the site centre ----
  const [w, s, e, n] = site.bounds, lon = (w + e) / 2, lat = (s + n) / 2;
  const bin = env.grs && env.grs.bins ? grsBin(env.grs, lon, lat) : null;
  if (bin && Number.isFinite(bin.h2o_wt_pct)) {
    out.set('GI-05', result('GI-05', { value: bin.h2o_wt_pct, display: fmt(bin.h2o_wt_pct, 1) + ' ± ' + fmt(bin.sigma_wt_pct, 1) + ' wt% H₂O (5° cell)',
      baseline: '0 unresolved ice interactions', ideal: '0, no ice mitigation', status: STATUS.NEEDS_CONFIRMATION, evidence: 'observation',
      note: 'SWIM ice data pending; Odyssey GRS water in the top tens of centimetres, a cell about 300 km across (centre ' + bin.lat + '°, ' + bin.lon + '°)' }));
  } else {
    out.set('GI-05', result('GI-05', { status: STATUS.NEEDS_CONFIRMATION, baseline: '0 unresolved ice interactions', ideal: '0, no ice mitigation',
      evidence: 'observation', note: 'SWIM ice data pending; ' + (failed(env, 'grs') || NO_DATA('orbital water data')) }));
  }
  return out;
}

// The GRS bin whose 5° cell contains (lon, lat).
export function grsBin(grs, lon, lat) {
  const half = (grs.bin_deg || 5) / 2, L = ((lon + 180) % 360 + 360) % 360 - 180;
  return grs.bins.find((b) => Math.abs(b.lat - lat) <= half && Math.abs(b.lon - L) <= half) || null;
}
