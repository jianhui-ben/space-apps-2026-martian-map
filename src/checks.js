// Terrain metrics under the facility layout.
import { cellOf } from './catalog.js';
import { cellsUnder } from './layout.js';
import { STATUS, statusFor } from './status.js';

const R = 3396190;
const RAD = Math.PI / 180;
const M_PER_DEG = R * RAD;
const GAP_FRACTION = 0.05;
const LOAD_FAILED = 'data failed to load';
const GAPS = 'elevation gaps under the layout';

const META = {
  'BT-01': { unit: '', pd: 'P', appliesTo: 'layout' },
  'BT-02': { unit: '%', pd: 'D', appliesTo: 'layout' },
  'BT-04': { unit: '°', pd: 'P', appliesTo: 'layout' },
  'BT-05': { unit: '°', pd: 'P', appliesTo: 'layout' },
  'BT-06': { unit: 'm', pd: 'D', appliesTo: 'layout' },
  'BT-08': { unit: 'm', pd: 'D', appliesTo: 'layout' },
  'BT-21': { unit: 'm', pd: 'D', appliesTo: 'layout' },
  'SC-10': { unit: '%', pd: 'D', appliesTo: 'solar' },
  'TC-08': { unit: '%', pd: 'D', appliesTo: 'radiator' },
};

const num = (v, d) => (Number.isFinite(v) ? v : d);
function assumed(scenario, key, field, fallback) {
  const a = scenario && scenario.assumptions && scenario.assumptions[key];
  return num(a && a[field], fallback);
}

function result(id, o) {
  const m = META[id];
  return {
    id, value: o.value === undefined ? null : o.value, unit: m.unit, display: o.display || '—',
    target: { baseline: o.baseline, ideal: o.ideal === undefined ? '' : o.ideal, label: m.pd },
    status: o.status, ideal: !!o.isIdeal, evidence: o.evidence || 'derived', note: o.note || '',
    assumption: !!o.assumption, straddles: !!o.straddles, appliesTo: m.appliesTo,
  };
}

const missing = (g, v) => Number.isNaN(v) || v === g.nodata;

// Collect values under a footprint: {n, gaps, values (finite only)}.
function under(grid, fp) {
  const o = { n: 0, gaps: 0, values: [] };
  cellsUnder(grid, fp, (col, row) => {
    const v = grid.data[row * grid.width + col];
    o.n += 1;
    if (missing(grid, v)) o.gaps += 1; else o.values.push(v);
  });
  return o;
}
const gappy = (u) => u.n === 0 || u.gaps / u.n > GAP_FRACTION;

function plane(grid, fp) {
  const cx = fp.center.lon, cy = fp.center.lat;
  const kx = M_PER_DEG * Math.cos(cy * RAD);
  const pts = [];
  cellsUnder(grid, fp, (col, row) => {
    const z = grid.data[row * grid.width + col];
    if (missing(grid, z)) return;
    const lon = grid.bounds[0] + (col + 0.5) * grid.pixelDeg[0];
    const lat = grid.bounds[3] - (row + 0.5) * grid.pixelDeg[1];
    pts.push([(lon - cx) * kx, (lat - cy) * M_PER_DEG, z]);
  });
  const n = pts.length;
  if (n < 3) return null;
  let me = 0, mn = 0, mz = 0;
  for (const p of pts) { me += p[0]; mn += p[1]; mz += p[2]; }
  me /= n; mn /= n; mz /= n;
  let see = 0, snn = 0, sen = 0, sez = 0, snz = 0;
  for (const [e, nn, z] of pts) {
    const de = e - me, dn = nn - mn, dz = z - mz;
    see += de * de; snn += dn * dn; sen += de * dn; sez += de * dz; snz += dn * dz;
  }
  const det = see * snn - sen * sen;
  if (!(Math.abs(det) > 1e-9)) return null;
  const b = (sez * snn - snz * sen) / det, c = (snz * see - sez * sen) / det;
  let maxDev = 0;
  for (const [e, nn, z] of pts) maxDev = Math.max(maxDev, Math.abs(z - (mz + b * (e - me) + c * (nn - mn))));
  return { slopeDeg: Math.atan(Math.hypot(b, c)) / RAD, maxDev };
}

function floodArea(grid, fp, limit) {
  const start = cellOf(grid, fp.center.lon, fp.center.lat);
  if (!start) return null;
  const W = grid.width, H = grid.height, d = grid.data;
  const ok = (i) => { const v = d[i]; return Number.isFinite(v) && v !== grid.nodata && v <= limit; };
  const s = start.row * W + start.col;
  const sv = d[s];
  if (missing(grid, sv)) return null;
  if (!ok(s)) return 0;
  const seen = new Uint8Array(W * H);
  const stack = [s];
  seen[s] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop();
    count += 1;
    const c = i % W, r = (i - c) / W;
    if (c > 0 && !seen[i - 1] && ok(i - 1)) { seen[i - 1] = 1; stack.push(i - 1); }
    if (c < W - 1 && !seen[i + 1] && ok(i + 1)) { seen[i + 1] = 1; stack.push(i + 1); }
    if (r > 0 && !seen[i - W] && ok(i - W)) { seen[i - W] = 1; stack.push(i - W); }
    if (r < H - 1 && !seen[i + W] && ok(i + W)) { seen[i + W] = 1; stack.push(i + W); }
  }
  const [gw, gs, ge, gn] = grid.bounds;
  const mx = grid.pixelDeg[0] * M_PER_DEG * Math.cos(((gs + gn) / 2) * RAD);
  const my = grid.pixelDeg[1] * M_PER_DEG;
  return count * mx * my;
}

const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export function terrainChecks(site, layout, setup, scenario, { final = true } = {}) {
  const out = new Map();
  const p = assumed(scenario, 'dem_vertical_precision_m', 'value', 0.25);
  // A brief setup's calculated limits replace the scenario's; one the brief left unresolved keeps the scenario value.
  const specs = setup && setup.source === 'brief' && setup.sizing && setup.sizing.assessed && setup.sizing.assessed.specifications;
  const fromBrief = (key, fallback) => {
    const v = specs && specs[key];
    return v && v.status === 'resolved' && Number.isFinite(v.value) ? v.value : fallback;
  };
  const padLimit = fromBrief('local_slope_limit_deg', assumed(scenario, 'max_local_pad_slope_deg', 'value', 10));
  const padIdeal = assumed(scenario, 'max_local_pad_slope_deg', 'ideal', 5);
  const conLimit = fromBrief('pad_slope_limit_deg', assumed(scenario, 'max_construction_slope_deg', 'value', 5));
  const conIdeal = assumed(scenario, 'max_construction_slope_deg', 'ideal', 2);
  const maxRough = fromBrief('roughness_limit_m', assumed(scenario, 'max_roughness_m', 'value', 0.3));
  const grids = site.grids || {};
  const fps = Object.fromEntries(layout.footprints.map((f) => [f.id, f]));
  const compound = fps.compound;

  const unresolved = (id, baseline, ideal, note, assumption) =>
    out.set(id, result(id, { status: STATUS.NEEDS_CONFIRMATION, baseline, ideal, note, assumption }));

  // ---- usable-area share on one footprint ----
  const usableShare = (id, fp) => {
    const baseline = '100%', ideal = '100%';
    if (!fp) {
      out.set(id, result(id, { status: STATUS.NOT_APPLICABLE, baseline, ideal, note: 'no solar plot in this power option' }));
      return;
    }
    const g = grids.slope10;
    if (!g) return unresolved(id, baseline, ideal, LOAD_FAILED, true);
    let n = 0, gaps = 0, usable = 0;
    cellsUnder(g, fp, (col, row) => {
      const v = g.data[row * g.width + col];
      n += 1;
      if (missing(g, v)) gaps += 1; else if (v <= padLimit) usable += 1;
    });
    if (n === 0 || gaps / n > GAP_FRACTION) return unresolved(id, baseline, ideal, GAPS, true);
    const pct = 100 * usable / n;
    const s = statusFor({ value: pct, baseline: 100, ideal: undefined, compare: '>=' });
    out.set(id, result(id, {
      value: pct, display: fmt(pct, 0) + '%', baseline, ideal, status: s.status, isIdeal: false,
      note: 'slope ≤ ' + padLimit + '° counts as usable', assumption: true,
    }));
  };
  usableShare('BT-02', compound);
  usableShare('SC-10', fps.solar);
  usableShare('TC-08', fps.radiator);

  // ---- BT-04 and BT-06 from the fitted plane ----
  {
    const bl = '≤ ' + conLimit + '°', id4 = '≤ ' + conIdeal + '°';
    const dl = '≤ design limit D_allow', di = '≤ 0.5 × D_allow';
    const g = grids.elevation;
    if (!g) {
      unresolved('BT-04', bl, id4, LOAD_FAILED, true);
      unresolved('BT-06', dl, di, LOAD_FAILED, false);
    } else if (gappy(under(g, compound))) {
      unresolved('BT-04', bl, id4, GAPS, true);
      unresolved('BT-06', dl, di, GAPS, false);
    } else {
      const pl = plane(g, compound);
      if (!pl) {
        unresolved('BT-04', bl, id4, 'plane fit failed', true);
        unresolved('BT-06', dl, di, 'plane fit failed', false);
      } else {
        const s = statusFor({ value: pl.slopeDeg, baseline: conLimit, ideal: conIdeal, compare: '<=', uncertainty: Math.atan(p / 30) / RAD });
        out.set('BT-04', result('BT-04', {
          value: pl.slopeDeg, display: fmt(pl.slopeDeg, 1) + '°', baseline: bl, ideal: id4,
          status: s.status, isIdeal: s.ideal, straddles: s.straddles, assumption: true,
          note: s.straddles ? 'within elevation uncertainty of the limit' : '',
        }));
        out.set('BT-06', result('BT-06', {
          value: pl.maxDev, display: fmt(pl.maxDev, 2) + ' m', baseline: dl, ideal: di,
          status: STATUS.NEEDS_DESIGN_INPUT, note: 'no D_allow yet',
        }));
      }
    }
  }

  // ---- BT-05 max slope under the compound ----
  {
    const bl = '≤ ' + padLimit + '°', id5 = '≤ ' + padIdeal + '°';
    const g = grids.slope10;
    if (!g) unresolved('BT-05', bl, id5, LOAD_FAILED, true);
    else {
      const u = under(g, compound);
      if (gappy(u) || u.values.length === 0) unresolved('BT-05', bl, id5, GAPS, true);
      else {
        let max = -Infinity;
        for (const v of u.values) if (v > max) max = v;
        const s = statusFor({ value: max, baseline: padLimit, ideal: padIdeal, compare: '<=', uncertainty: Math.atan(p / 5) / RAD });
        out.set('BT-05', result('BT-05', {
          value: max, display: fmt(max, 1) + '°', baseline: bl, ideal: id5,
          status: s.status, isIdeal: s.ideal, straddles: s.straddles, assumption: true,
          note: s.straddles ? 'within elevation uncertainty of the limit' : '',
        }));
      }
    }
  }

  // ---- BT-08 roughness under each footprint ----
  {
    const bl = '≤ ' + maxRough + ' m';
    const g = grids.roughness;
    if (!g) unresolved('BT-08', bl, '', LOAD_FAILED, true);
    else {
      let max = -Infinity, bad = false;
      for (const fp of layout.footprints) {
        const u = under(g, fp);
        if (gappy(u) || u.values.length === 0) { bad = true; break; }
        for (const v of u.values) if (v > max) max = v;
      }
      if (bad) unresolved('BT-08', bl, '', GAPS, true);
      else {
        const s = statusFor({ value: max, baseline: maxRough, compare: '<=', uncertainty: p, availability: 'partial' });
        out.set('BT-08', result('BT-08', {
          value: max, display: fmt(max, 2) + ' m', baseline: bl, ideal: '',
          status: s.status, straddles: s.straddles, assumption: true,
          note: s.status === STATUS.NEEDS_FIELDWORK ? 'screening only; needs field survey' : '',
        }));
      }
    }
  }

  // ---- BT-21 distance to base ----
  {
    const kx = M_PER_DEG * Math.cos(compound.center.lat * RAD);
    const e = (site.base.lon - compound.center.lon) * kx, n = (site.base.lat - compound.center.lat) * M_PER_DEG;
    const d = Math.hypot(e, n);
    out.set('BT-21', result('BT-21', {
      value: d, display: fmt(d, 0) + ' m', baseline: '≤ allowance', ideal: '≤ 0.8 × allowance',
      status: STATUS.NEEDS_DESIGN_INPUT, note: 'straight line; no distance allowance yet',
    }));
  }

  // ---- BT-01 connected area ratio (drag end only) ----
  if (final) {
    const bl = '≥ 1.0', id1 = '≥ 1.3';
    const g = grids.slope10;
    if (!g) unresolved('BT-01', bl, id1, LOAD_FAILED, true);
    else if (layout.footprints.some((f) => gappy(under(g, f)))) unresolved('BT-01', bl, id1, GAPS, true);
    else {
      const area = floodArea(g, compound, padLimit);
      if (area === null) unresolved('BT-01', bl, id1, 'no slope data at the compound centre', true);
      else {
        const need = layout.footprints.reduce((s, f) => s + f.w * f.h, 0);
        const ratio = area / need;
        const s = statusFor({ value: ratio, baseline: 1.0, ideal: 1.3, compare: '>=' });
        out.set('BT-01', result('BT-01', {
          value: ratio, display: fmt(ratio, 2), baseline: bl, ideal: id1,
          status: s.status, isIdeal: s.ideal, assumption: true,
          note: 'connected area with slope ≤ ' + padLimit + '° from the compound centre',
        }));
      }
    }
  }
  return out;
}
