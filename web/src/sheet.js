// The Survey sheet's printed parts (looks.js draws the paper, hillshade, contours, slope classes, grid and neat line in
// the terrain shader): the slope per vertex the classes come from, labelled index contours, and the map furniture (key,
// title block, scale bar, north arrow, grid ticks, plan labels on the footprints) as an HTML layer over the canvas, so
// it stays crisp. Slope inside the site box is the site's slope_10m_window grid (the one the checks read); where that
// has no value, and outside the box, it is the slope over 10 m from an elevation grid (the site's, then the trip area's).
import * as THREE from 'three';
import { sampleGrid, cellOf } from './catalog.js';
import { inBox } from './frame.js';
import { LOOKS } from './looks.js';

const R = 3396190, DEG = Math.PI / 180;
const SLOPE_BASE_M = 10; // the slope baseline, as slope_10m_window
const INDEX_M = 10; // index contours, labelled
const LABEL_BIN_M = 40, LABEL_SAME_M = 90, LABEL_ANY_M = 30, LABEL_MAX = 60000; // candidates; the screen declutters
const SHOWN_MAX = 160; // labels on screen at once
const SAME_PX = 220; // on screen, labels of one level stay this far apart
const hex = (c) => '#' + new THREE.Color(c).getHexString();
const fmtElev = (m) => (m < 0 ? '−' : '') + Math.abs(Math.round(m));

// Slope (degrees) over SLOPE_BASE_M from an elevation grid, by central differences; NaN off the grid or at a gap.
export function slopeFrom(grid, lon, lat) {
  if (!grid) return NaN;
  const dLat = SLOPE_BASE_M / 2 / (R * DEG), dLon = dLat / Math.cos(lat * DEG);
  const e = sampleGrid(grid, lon + dLon, lat), w = sampleGrid(grid, lon - dLon, lat);
  const n = sampleGrid(grid, lon, lat + dLat), s = sampleGrid(grid, lon, lat - dLat);
  if (![e, w, n, s].every(Number.isFinite)) return NaN;
  return Math.atan(Math.hypot((e - w) / SLOPE_BASE_M, (n - s) / SLOPE_BASE_M)) / DEG;
}

// Slope at a point and the grid it came from: {deg, source: 'slope10' | 'site' | 'trip' | null, label}.
export function sheetSlopeAt(site, lon, lat) {
  const g = site.grids || {};
  if (inBox(site.bounds, lon, lat)) {
    const c = g.slope10 && cellOf(g.slope10, lon, lat), v = c ? g.slope10.data[c.row * g.slope10.width + c.col] : NaN;
    if (v === v && v !== g.slope10.nodata && Number.isFinite(v)) return { deg: v, source: 'slope10', grid: g.slope10, label: 'Slope (10 m)' };
    const d = slopeFrom(g.elevation, lon, lat);
    if (Number.isFinite(d)) return { deg: d, source: 'site', grid: g.elevation, label: 'Slope (10 m, from the ' + res(g.elevation) + ' elevation)' };
  }
  const d = slopeFrom(site.tripArea, lon, lat);
  if (Number.isFinite(d)) return { deg: d, source: 'trip', grid: site.tripArea, label: 'Slope (10 m, ' + res(site.tripArea) + ' trip-area grid)' };
  return { deg: NaN, source: null, grid: null, label: 'Slope (10 m)' };
}
const res = (g) => (g && g.resolutionM ? g.resolutionM + ' m' : 'coarse');

// Fill each geometry's sheetSlope attribute (-1 without data).
export function fillSheetSlope(site, frame, geometries) {
  const v = new THREE.Vector3();
  for (const geo of geometries) {
    if (!geo) continue;
    const pos = geo.attributes.position, a = geo.attributes.sheetSlope.array;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const ll = frame.toLonLat(v), d = sheetSlopeAt(site, ll.lon, ll.lat).deg;
      a[i] = Number.isFinite(d) ? d : -1;
    }
    geo.attributes.sheetSlope.needsUpdate = true;
  }
}

// Label points on the index contours of the drawn meshes: where a 10 m level crosses a lattice quad, binned and spaced
// so labels are spread along each line. Returns [{x, y, z, dx, dz, level}] in root-local (true-scale) coordinates.
export function contourLabelPoints(geometries) {
  const bins = new Map(), cand = [];
  for (const geo of geometries) {
    if (!geo) continue;
    const P = geo.attributes.position.array, E = geo.attributes.elevation.array, I = geo.index.array;
    for (let q = 0; q + 5 < I.length; q += 6) {
      const a = I[q], c = I[q + 1], b = I[q + 2], d = I[q + 5]; // (a, c, b), (b, c, d): a NW, b NE, c SW, d SE
      const ring = [a, b, d, c];
      let lo = Infinity, hi = -Infinity;
      for (const k of ring) { lo = Math.min(lo, E[k]); hi = Math.max(hi, E[k]); }
      for (let L = Math.ceil(lo / INDEX_M) * INDEX_M; L < hi; L += INDEX_M) {
        const pts = [];
        for (let m = 0; m < 4; m++) {
          const p = ring[m], r = ring[(m + 1) % 4], ep = E[p], er = E[r];
          if ((ep < L) === (er < L)) continue;
          const t = (L - ep) / (er - ep);
          pts.push([P[3 * p] + (P[3 * r] - P[3 * p]) * t, P[3 * p + 1] + (P[3 * r + 1] - P[3 * p + 1]) * t, P[3 * p + 2] + (P[3 * r + 2] - P[3 * p + 2]) * t]);
        }
        if (pts.length < 2) continue;
        const [p0, p1] = pts, dx = p1[0] - p0[0], dz = p1[2] - p0[2], len = Math.hypot(dx, dz);
        if (!(len > 0)) continue;
        const x = (p0[0] + p1[0]) / 2, z = (p0[2] + p1[2]) / 2;
        const key = L + ':' + Math.floor(x / LABEL_BIN_M) + ':' + Math.floor(z / LABEL_BIN_M);
        if (bins.has(key)) continue;
        bins.set(key, 1);
        cand.push({ x, y: (p0[1] + p1[1]) / 2, z, dx: dx / len, dz: dz / len, level: L });
      }
    }
  }
  // spread: no two labels of one level within LABEL_SAME_M, no two of any level within LABEL_ANY_M
  const out = [], cell = new Map(), C = LABEL_SAME_M;
  const near = (p, r, same) => {
    const i0 = Math.floor(p.x / C), j0 = Math.floor(p.z / C);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const o of cell.get(i + ':' + j) || []) {
        if ((!same || o.level === p.level) && Math.hypot(o.x - p.x, o.z - p.z) < r) return true;
      }
    }
    return false;
  };
  // a fixed shuffle first, so a cap or the spacing never favours the first rows scanned
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  for (const p of cand) {
    if (out.length >= LABEL_MAX) break;
    if (near(p, LABEL_ANY_M, false) || near(p, LABEL_SAME_M, true)) continue;
    out.push(p);
    const k = Math.floor(p.x / C) + ':' + Math.floor(p.z / C);
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(p);
  }
  return out;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NICE = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

// The HTML layer: built once, shown only in the Survey sheet. opts: {site, root, camera, canvas, geometries (the drawn
// terrain), footprints() -> [{id, name, w, h, centre, east}], heightAt(x, z) (root-local), limitDeg (the buildable limit)}.
export function createSheetLayer({ site, root, camera, canvas, geometries, footprints, heightAt, limitDeg = LOOKS.survey.slopeLimitDeg }) {
  const t = LOOKS.survey, C = t.classes;
  const layer = el('div', 'sheet-layer');
  layer.hidden = true;
  layer.setAttribute('aria-hidden', 'true'); // the key is repeated in the factor bar's key line for screen readers
  const labelsEl = el('div', 'sheet-labels'), ticksEl = el('div', 'sheet-ticks'), planEl = el('div', 'sheet-plan');
  layer.append(labelsEl, ticksEl, planEl);

  // ---- key (top left) ----
  const key = el('div', 'sheet-key');
  key.append(el('b', null, 'Slope over 10 m'));
  const sw = (fill, alpha, hatch, ink) => {
    const s = el('span', 'sheet-sw');
    const bg = 'color-mix(in srgb, ' + hex(fill) + ' ' + Math.round(alpha * 100) + '%, ' + hex(t.paper) + ')';
    s.style.background = hatch
      ? 'repeating-linear-gradient(' + (hatch > 0 ? '-45deg' : '45deg') + ', ' + hex(ink) + ' 0 1.5px, transparent 1.5px 6px), ' + bg
      : bg;
    return s;
  };
  const row = (swatch, text) => { const r = el('div', 'sheet-row'); r.append(swatch, el('span', null, text)); return r; };
  const lim = limitDeg, steep = t.steepDeg;
  key.append(
    row(sw(C.buildable, 0.12), 'Buildable ≤ ' + lim + '°'),
    row(sw(C.marginal, 0.45), 'Marginal ' + lim + '–' + steep + '°'),
    row(sw(C.steep, 0.4, 1, C.steepInk), 'Too steep > ' + steep + '° (hatched)'),
    row(sw(C.nodata, 0.3, -1, 0x505050), 'No data (cross-hatched)'),
  );
  const line = (colour, w, dash) => { const s = el('span', 'sheet-ln'); s.style.borderTop = w + 'px ' + (dash ? 'dashed' : 'solid') + ' ' + hex(colour); return s; };
  const g = site.grids || {}, eRes = res(g.elevation), tRes = res(site.tripArea);
  key.append(
    el('b', null, 'Lines'),
    row(line(t.contourColor, 1), 'Contour every 2 m'),
    row(line(t.contourColor, 2.5), 'Index contour every 10 m, labelled (m)'),
    row(line(t.gridColor, 1), 'Grid ' + t.gridStepM + ' m, from the site centre'),
    row(line(t.neatColor, 2), 'Site box: ' + eRes + ' grid inside, ' + (site.tripArea ? tRes + ' trip-area grid outside' : 'nothing drawn outside')),
  );
  // ---- title block (bottom left) with the scale bar ----
  const title = el('div', 'sheet-title');
  const ev = site.catalog && site.catalog.byId && g.elevation ? site.catalog.byId.get(g.elevation.datasetId) : null;
  const src = ev && ev.source && ev.source.name ? ev.source.name : '';
  const product = (src.match(/DTEEC_[0-9A-Z_]+/) || [])[0];
  const fetched = ev && ev.source && ev.source.fetched_at ? String(ev.source.fetched_at).slice(0, 10) : null;
  title.append(
    el('b', null, site.name || site.id),
    el('span', null, 'Survey sheet · contours 2 m / 10 m · from the ' + eRes + ' elevation model (HiRISE DTM)'),
    el('span', 'sheet-meta', (product ? product + ' · ' : '') + 'image dates on the source page'
      + (fetched ? ' · fetched ' + fetched : '') + ' · heights ×' + root.scale.y + ' in 3D only'),
  );
  const scale = el('div', 'sheet-scale');
  const bar = el('div', 'sheet-bar'), nums = el('div', 'sheet-nums');
  scale.append(bar, nums);
  title.append(scale);
  // ---- north arrow (top right) ----
  const north = el('div', 'sheet-north');
  north.innerHTML = '<svg viewBox="0 0 40 52" width="34" height="44"><path d="M20 4 L31 40 L20 32 L9 40 Z" fill="#1d2226"/>'
    + '<path d="M20 4 L20 32 L9 40 Z" fill="#f4efe3" stroke="#1d2226" stroke-width="1.2"/></svg><span>N</span>';
  layer.append(key, title, north);

  // contour labels
  const points = contourLabelPoints(geometries);
  const pool = []; // label elements, reused: only the labels on screen have one
  const labelEl = (i) => {
    while (pool.length <= i) pool.push(labelsEl.appendChild(el('span', 'sheet-clabel')));
    return pool[i];
  };
  let shown = 0;
  // grid ticks: points along each grid line (local x east, z south), on the ground
  const box = new THREE.Box3();
  for (const geo of geometries) if (geo) { geo.computeBoundingBox(); box.union(geo.boundingBox); }
  const step = t.gridStepM, lines = [];
  const along = (fixed, axis) => {
    const pts = [], lo = axis === 'x' ? box.min.z : box.min.x, hi = axis === 'x' ? box.max.z : box.max.x;
    for (let u = lo; u <= hi; u += 25) {
      const x = axis === 'x' ? fixed : u, z = axis === 'x' ? u : fixed, y = heightAt(x, z);
      if (Number.isFinite(y)) pts.push(new THREE.Vector3(x, y, z));
    }
    return pts;
  };
  for (let x = Math.ceil(box.min.x / step) * step; x <= box.max.x; x += step) lines.push({ axis: 'x', v: x, pts: along(x, 'x'), e: el('span', 'sheet-tick', (x === 0 ? '0' : (x > 0 ? 'E ' : 'W ') + Math.abs(x)) + ' m') });
  for (let z = Math.ceil(box.min.z / step) * step; z <= box.max.z; z += step) lines.push({ axis: 'z', v: z, pts: along(z, 'z'), e: el('span', 'sheet-tick', (z === 0 ? '0' : (z < 0 ? 'N ' : 'S ') + Math.abs(z)) + ' m') });
  for (const l of lines) ticksEl.append(l.e);
  const plans = new Map(); // footprint id -> element

  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  let W = 0, H = 0;
  const toScreen = (local, out) => {
    v.copy(local).applyMatrix4(root.matrixWorld).project(camera);
    out.x = ((v.x + 1) / 2) * W; out.y = ((1 - v.y) / 2) * H; out.z = v.z;
    return out;
  };
  const s0 = { x: 0, y: 0, z: 0 }, s1 = { x: 0, y: 0, z: 0 };
  let lastKey = '';
  function update(force = false) {
    if (layer.hidden) return;
    W = canvas.clientWidth; H = canvas.clientHeight;
    const k = camera.matrixWorld.elements.join(',') + W + 'x' + H + root.scale.y + (force ? Math.random() : '');
    if (k === lastKey) return;
    lastKey = k;
    // contour labels: along the line, upright, greedy declutter on screen boxes
    const taken = [], byLevel = new Map();
    const farFromLevel = (L, x, y) => (byLevel.get(L) || []).every((q) => Math.hypot(q[0] - x, q[1] - y) >= SAME_PX);
    const free = (x, y, w, h) => {
      for (const b of taken) if (Math.abs(b[0] - x) < (b[2] + w) / 2 && Math.abs(b[1] - y) < (b[3] + h) / 2) return false;
      return true;
    };
    // the furniture and the map's own controls (outside this layer) are kept clear
    const lr = layer.getBoundingClientRect();
    const pad = document.querySelector('.pad'), hint = pad && pad.parentElement;
    for (const node of [key, title, north, hint]) {
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 0) taken.push([r.left - lr.left + r.width / 2, r.top - lr.top + r.height / 2, r.width + 8, r.height + 8]);
    }
    const furniture = taken.slice();
    const clear = (x, y) => furniture.every((b) => !(Math.abs(b[0] - x) < b[2] / 2 + 30 && Math.abs(b[1] - y) < b[3] / 2 + 10));
    // grid ticks: where each line enters the view (east lines at the top, north lines at the left), clear of the furniture
    for (const l of lines) {
      let best = null;
      for (const q of l.pts) {
        toScreen(q, s0);
        if (s0.z > 1 || s0.x < 4 || s0.x > W - 4 || s0.y < 4 || s0.y > H - 4 || !clear(s0.x, s0.y)) continue;
        const score = l.axis === 'x' ? s0.y : s0.x;
        if (!best || score < best.s) best = { s: score, x: s0.x, y: s0.y };
      }
      if (!best) { l.e.style.display = 'none'; continue; }
      l.e.style.display = '';
      l.e.style.transform = l.axis === 'x'
        ? 'translate(' + best.x.toFixed(1) + 'px,' + best.y.toFixed(1) + 'px) translate(-50%, 2px)'
        : 'translate(' + best.x.toFixed(1) + 'px,' + best.y.toFixed(1) + 'px) translate(2px, -50%)';
      taken.push(l.axis === 'x' ? [best.x, best.y + 10, 80, 22] : [best.x + 40, best.y, 80, 22]);
    }
    let n = 0;
    for (const p of points) {
      if (n >= SHOWN_MAX) break;
      toScreen(v2.set(p.x, p.y, p.z), s0);
      if (s0.z > 1 || s0.x < 10 || s0.y < 10 || s0.x > W - 10 || s0.y > H - 10) continue;
      toScreen(v2.set(p.x + p.dx * 10, p.y, p.z + p.dz * 10), s1);
      let a = Math.atan2(s1.y - s0.y, s1.x - s0.x) / DEG;
      if (a > 90) a -= 180; else if (a < -90) a += 180;
      const w = 34, h = 16, r = Math.abs(a * DEG), bw = w * Math.abs(Math.cos(r)) + h * Math.abs(Math.sin(r)), bh = w * Math.abs(Math.sin(r)) + h * Math.abs(Math.cos(r));
      if (!farFromLevel(p.level, s0.x, s0.y) || !free(s0.x, s0.y, bw + 16, bh + 16)) continue;
      taken.push([s0.x, s0.y, bw + 16, bh + 16]);
      if (!byLevel.has(p.level)) byLevel.set(p.level, []);
      byLevel.get(p.level).push([s0.x, s0.y]);
      const e = labelEl(n++);
      e.textContent = fmtElev(p.level);
      e.style.display = '';
      e.style.transform = 'translate(' + s0.x.toFixed(1) + 'px,' + s0.y.toFixed(1) + 'px) translate(-50%,-50%) rotate(' + a.toFixed(1) + 'deg)';
    }
    for (let i = n; i < pool.length; i++) pool[i].style.display = 'none';
    shown = n;
    // scale bar and north arrow, at the layout (or the frame centre)
    const fps = footprints(), f0 = fps.find((f) => f.id === 'compound') || fps[0];
    const c = f0 ? new THREE.Vector3(f0.centre.x, f0.centre.y, f0.centre.z) : new THREE.Vector3(0, heightAt(0, 0) || 0, 0);
    toScreen(c, s0);
    toScreen(v2.set(c.x + 100, c.y, c.z), s1);
    const pxPerM = Math.hypot(s1.x - s0.x, s1.y - s0.y) / 100;
    if (pxPerM > 0 && Number.isFinite(pxPerM)) {
      const L = NICE.reduce((best, n) => (Math.abs(n * pxPerM - 160) < Math.abs(best * pxPerM - 160) ? n : best), NICE[0]);
      bar.style.width = (L * pxPerM).toFixed(1) + 'px';
      nums.replaceChildren(el('span', null, '0'), el('span', null, String(L / 2)), el('span', null, L + ' m'));
      nums.style.width = (L * pxPerM).toFixed(1) + 'px';
    }
    toScreen(v2.set(c.x, c.y, c.z - 100), s1); // local z is south
    const na = Math.atan2(s1.x - s0.x, -(s1.y - s0.y)) / DEG;
    north.firstChild.style.transform = 'rotate(' + na.toFixed(1) + 'deg)';
    // plan labels on the footprints: name and size, once the plot is big enough on screen
    for (const [id, e] of plans) if (!fps.some((f) => f.id === id)) { e.remove(); plans.delete(id); }
    for (const f of fps) {
      let e = plans.get(f.id);
      if (!e) { e = el('span', 'sheet-planlabel'); planEl.append(e); plans.set(f.id, e); }
      e.textContent = Math.round(f.w) + ' × ' + Math.round(f.h) + ' m'; // the plot's size, east of it (the tag names it, west)
      toScreen(v2.set(f.centre.x + f.east.x * f.w / 2, f.centre.y, f.centre.z + f.east.z * f.w / 2), s0);
      const big = f.w * pxPerM >= 12;
      e.style.display = big && s0.z <= 1 ? '' : 'none';
      e.style.transform = 'translate(' + s0.x.toFixed(1) + 'px,' + s0.y.toFixed(1) + 'px) translate(6px,-50%)';
    }
  }
  canvas.after(layer);
  return {
    show(on) { layer.hidden = !on; lastKey = ''; if (on) update(true); },
    update,
    dispose() { layer.remove(); },
    debug: () => ({ candidates: points.length, shown, ticks: lines.length }),
  };
}
