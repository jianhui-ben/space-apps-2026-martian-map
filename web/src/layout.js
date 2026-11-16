// Facility footprints on a candidate site: sizing, placement, clamping, cell visits and best spot.

const R = 3396190;
const RAD = Math.PI / 180;
const M_PER_DEG = R * RAD;
const GAP = 10;
export const LOADS = { 60: 100, 150: 225, 250: 350 }; // IT load (kW) -> total facility load L (kW)

// A brief setup (briefSetup in sizing/index.js) is sized from the assessed option; `size` ({solarPlotM2, radiatorPlotM2}, from
// requirements.js siteSizing) replaces the engine's generic plots with the site's own.
function briefSpecs(setup, size) {
  const { assessed, params } = setup.sizing;
  const v = (k) => (assessed.specifications[k].status === 'resolved' ? assessed.specifications[k].value : 0);
  const clr = 2 * params.module_clearance_m;
  const modules = v('modules'), radiator = size ? size.radiatorPlotM2 : v('radiator_plot_m2'), solar = size ? size.solarPlotM2 : v('solar_plot_m2');
  // The module block from the engine's compact layout (a near-square grid of modules); the row formula for a layout
  // without block dimensions. The plots sit north and south of the block, GAP metres clear of it.
  const L = assessed.layout || {};
  const cw = Number.isFinite(L.block_width_m) ? L.block_width_m : modules * (params.module_length_m + clr);
  const ch = Number.isFinite(L.block_height_m) ? L.block_height_m : params.module_width_m + clr;
  const rs = Math.sqrt(radiator), ss = Math.sqrt(solar);
  const specs = [
    { id: 'compound', w: cw, h: ch },
    { id: 'radiator', w: rs, h: rs, dy: ch / 2 + GAP + rs / 2 },
  ];
  if (setup.power !== 'base_only' && solar > 0) specs.push({ id: 'solar', w: ss, h: ss, dy: -(ch / 2 + GAP + ss / 2) });
  return specs;
}

export function footprintSpecs(setup, size = null) {
  if (setup.source === 'brief') return briefSpecs(setup, size);
  const L = LOADS[setup.loadKw];
  const specs = [
    { id: 'compound', w: 60, h: 60 },
    { id: 'radiator', w: 60, h: 6000 * L / 350 / 60 },
  ];
  if (setup.power === 'topup' || setup.power === 'solar_fission') specs.push({ id: 'solar', w: 100, h: 100 });
  else if (setup.power === 'solar_batteries') {
    const s = Math.sqrt(10000 * L / 100);
    specs.push({ id: 'solar', w: s, h: s });
  }
  return specs;
}

// Local offset (metres, x east, y north, before rotation) of a footprint centre from the compound centre.
function localOffset(spec) {
  if (Number.isFinite(spec.dy)) return [0, spec.dy]; // sized footprints carry their offset from the compound's height
  if (spec.id === 'radiator') return [0, 30 + GAP + spec.h / 2];
  if (spec.id === 'solar') return [0, -(30 + GAP + spec.h / 2)];
  return [0, 0];
}

// Rotate clockwise from north: north (0,1) goes to (sin t, cos t).
function rot(x, y, deg) {
  const t = deg * RAD, s = Math.sin(t), c = Math.cos(t);
  return [x * c + y * s, -x * s + y * c];
}

export function placeLayout(specs, placement) {
  const { centerLon, centerLat, rotationDeg } = placement;
  const kx = M_PER_DEG * Math.cos(centerLat * RAD);
  const toLL = (e, n) => [centerLon + e / kx, centerLat + n / M_PER_DEG];
  const footprints = specs.map((sp) => {
    const [ox, oy] = localOffset(sp);
    const [ce, cn] = rot(ox, oy, rotationDeg);
    const polygon = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const [e, n] = rot(ox + sx * sp.w / 2, oy + sy * sp.h / 2, rotationDeg);
      return toLL(e, n);
    });
    const [lon, lat] = toLL(ce, cn);
    const fp = { id: sp.id, w: sp.w, h: sp.h, center: { lon, lat }, rotationDeg, polygon };
    if (Number.isFinite(sp.dy)) fp.dy = sp.dy; // a sized footprint keeps its offset, so it can be placed again
    return fp;
  });
  return { placement: { centerLon, centerLat, rotationDeg }, footprints };
}

export function clampPlacement(site, specs, placement) {
  const b = site.bounds;
  const bbox = (p) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of placeLayout(specs, p).footprints) {
      for (const [lo, la] of f.polygon) { x0 = Math.min(x0, lo); x1 = Math.max(x1, lo); y0 = Math.min(y0, la); y1 = Math.max(y1, la); }
    }
    return [x0, y0, x1, y1];
  };
  const shift = (lo, hi, a, z) => {
    if (hi - lo > z - a) return (a + z) / 2 - (lo + hi) / 2; // cannot fit: centre
    if (lo < a) return a - lo;
    if (hi > z) return z - hi;
    return 0;
  };
  let p = { ...placement };
  for (let i = 0; i < 3; i++) { // the lon scale depends on latitude, so settle with a second pass
    const [x0, y0, x1, y1] = bbox(p);
    const dx = shift(x0, x1, b[0], b[2]), dy = shift(y0, y1, b[1], b[3]);
    if (dx === 0 && dy === 0) break;
    p = { ...p, centerLon: p.centerLon + dx, centerLat: p.centerLat + dy };
  }
  return p;
}

// Visit every grid cell whose centre lies inside the rotated rectangle.
export function cellsUnder(grid, footprint, cb) {
  const { w, h, center, rotationDeg } = footprint;
  const [gw, gs, ge, gn] = grid.bounds;
  const kx = M_PER_DEG * Math.cos(center.lat * RAD);
  const t = rotationDeg * RAD, s = Math.sin(t), c = Math.cos(t);
  const ext = Math.abs(w / 2 * c) + Math.abs(h / 2 * s); // east half extent, metres
  const ext2 = Math.abs(w / 2 * s) + Math.abs(h / 2 * c); // north half extent
  const [dx, dy] = grid.pixelDeg;
  const colF = (lon) => (lon - gw) / dx;
  const rowF = (lat) => (gn - lat) / dy;
  const c0 = Math.max(0, Math.floor(colF(center.lon - ext / kx) - 0.5));
  const c1 = Math.min(grid.width - 1, Math.ceil(colF(center.lon + ext / kx) + 0.5));
  const r0 = Math.max(0, Math.floor(rowF(center.lat + ext2 / M_PER_DEG) - 0.5));
  const r1 = Math.min(grid.height - 1, Math.ceil(rowF(center.lat - ext2 / M_PER_DEG) + 0.5));
  for (let row = r0; row <= r1; row++) {
    const n = (gn - (row + 0.5) * dy - center.lat) * M_PER_DEG;
    for (let col = c0; col <= c1; col++) {
      const e = (gw + (col + 0.5) * dx - center.lon) * kx;
      // inverse of the clockwise rotation
      const x = e * c - n * s, y = e * s + n * c;
      if (x >= -w / 2 && x < w / 2 && y >= -h / 2 && y < h / 2) cb(col, row);
    }
  }
}

function buildSat(W, H, flag) {
  const sat = new Int32Array((W + 1) * (H + 1));
  for (let r = 0; r < H; r++) {
    let run = 0;
    for (let c = 0; c < W; c++) {
      run += flag(r * W + c);
      sat[(r + 1) * (W + 1) + c + 1] = sat[r * (W + 1) + c + 1] + run;
    }
  }
  return sat;
}
const rectCount = (sat, W, c0, r0, c1, r1) => sat[(r1 + 1) * (W + 1) + (c1 + 1)] - sat[r0 * (W + 1) + (c1 + 1)] - sat[(r1 + 1) * (W + 1) + c0] + sat[r0 * (W + 1) + c0];

export function bestSpot(site, specs) {
  const grid = site.grids.slope10;
  const a = site.catalog && site.catalog.scenario && site.catalog.scenario.assumptions && site.catalog.scenario.assumptions.max_local_pad_slope_deg;
  const limit = a && Number.isFinite(a.value) ? a.value : 10;
  const ideal = a && Number.isFinite(a.ideal) ? a.ideal : 5;
  const W = grid.width, H = grid.height, d = grid.data, nd = grid.nodata;
  const satBad = buildSat(W, H, (i) => (Number.isFinite(d[i]) && d[i] !== nd && d[i] <= limit ? 0 : 1));
  const satSteep = buildSat(W, H, (i) => (Number.isFinite(d[i]) && d[i] !== nd && d[i] <= ideal ? 0 : 1));

  const [gw, gs, ge, gn] = grid.bounds;
  const lat0 = (gs + gn) / 2;
  const kx = M_PER_DEG * Math.cos(lat0 * RAD);
  const mx = grid.pixelDeg[0] * kx, my = grid.pixelDeg[1] * M_PER_DEG; // metres per cell
  const totW = (ge - gw) * kx, totH = (gn - gs) * M_PER_DEG;
  const bx = (site.base.lon - gw) * kx, by = (site.base.lat - gs) * M_PER_DEG; // base, metres from SW corner

  const rects = specs.map((sp) => {
    const [, oy] = localOffset(sp);
    return { hw: sp.w / 2, yLo: oy - sp.h / 2, yHi: oy + sp.h / 2 };
  });
  let minY = Infinity, maxY = -Infinity, maxHw = 0;
  for (const r of rects) { minY = Math.min(minY, r.yLo); maxY = Math.max(maxY, r.yHi); maxHw = Math.max(maxHw, r.hw); }

  // the search stays inside both the grid and the site box (clampPlacement's box), so a placed layout is never nudged
  const sb = site.bounds || grid.bounds;
  const xLo = Math.max(0, (sb[0] - gw) * kx), xHi = Math.min(totW, (sb[2] - gw) * kx);
  const yLo = Math.max(0, (sb[1] - gs) * M_PER_DEG), yHi = Math.min(totH, (sb[3] - gs) * M_PER_DEG);
  const STEP = 5;
  let best = null, bestAny = null;
  for (let y = Math.ceil((yLo - minY) / STEP) * STEP; y <= yHi - maxY; y += STEP) {
    for (let x = Math.ceil((xLo + maxHw) / STEP) * STEP; x <= xHi - maxHw; x += STEP) {
      let bad = 0, steep = 0, ok = true;
      for (const r of rects) {
        // cells whose centres lie in [lo, hi) metres
        const c0 = Math.ceil((x - r.hw) / mx - 0.5), c1 = Math.ceil((x + r.hw) / mx - 0.5) - 1;
        const rowN = Math.ceil((totH - (y + r.yHi)) / my - 0.5), rowS = Math.ceil((totH - (y + r.yLo)) / my - 0.5) - 1;
        if (c1 < c0 || rowS < rowN) continue;
        if (c0 < 0 || rowN < 0 || c1 >= W || rowS >= H) { ok = false; break; }
        bad += rectCount(satBad, W, c0, rowN, c1, rowS);
        steep += rectCount(satSteep, W, c0, rowN, c1, rowS);
      }
      if (!ok) continue;
      const dist = Math.hypot(x - bx, y - by);
      if (bad === 0) {
        if (!best || steep < best.steep || (steep === best.steep && dist < best.dist)) best = { x, y, steep, dist };
      } else if (!bestAny || bad < bestAny.bad || (bad === bestAny.bad && dist < bestAny.dist)) bestAny = { x, y, bad, dist };
    }
  }
  const pick = best || bestAny;
  const rotationDeg = 0;
  if (!pick) return { centerLon: (gw + ge) / 2, centerLat: (gs + gn) / 2, rotationDeg };
  return { centerLon: gw + pick.x / kx, centerLat: gs + pick.y / M_PER_DEG, rotationDeg };
}

export function createLayoutStore() {
  const layouts = new Map(), specsBySite = new Map(), listeners = new Set();
  return {
    get: (siteId) => layouts.get(siteId) || null,
    // specs are remembered per site; the first set for a site must supply them.
    set(siteId, placement, { final = true, specs } = {}) {
      if (specs) specsBySite.set(siteId, specs);
      const sp = specsBySite.get(siteId);
      if (!sp) throw new Error('layout store: no footprint specs known for site ' + siteId);
      const layout = placeLayout(sp, placement);
      layouts.set(siteId, layout);
      for (const cb of [...listeners]) cb(siteId, layout, { final });
      return layout;
    },
    onLayoutChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}
