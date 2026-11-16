// The four remaining factor views (Task 12, R27): Ground & ice, Solar, Thermal and Routes, each registered on the factor
// bar (ui/factors.js registerView) and working at region scale (patches and lines on the globe) and site scale (an
// overlay on the site terrain, lines on its ground, the Solar view's sun). Every dataset is found per region
// (environment.js regionDataset), never another region's by name; where a region has none, the key says so and reads
// missing. A view only draws; it never changes a status or the priority, demo or not.
import * as THREE from 'three';
import { regionDataset, THEMIS_CASES, worstNoonSun, sunPath, skyline, APHELION_LS, PERIHELION_LS } from './environment.js';
import { seededUnit } from './plain.js';
import { groundProbe, solarProbe, thermalProbe, routesProbe, slopeAspect, tiltFactor } from './probes.js';

const R = 3396190; // the Mars sphere the globe draws (globe.js)
const DEG = Math.PI / 180;
const LINE_H = 60, PATCH_H = 40;
const fileOf = (d, format) => (d && (d.files || []).find((f) => f.format === format)) || null;
const ev = (d) => (d && d.evidence_type) || 'derived';
const missingKey = (what) => ({ text: 'No ' + what + ' here: needs confirmation', source: '', missing: true });
const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- drawing on the globe ----------

const sphere = (lon, lat, r, v = new THREE.Vector3()) =>
  v.set(r * Math.cos(lat * DEG) * Math.cos(lon * DEG), r * Math.cos(lat * DEG) * Math.sin(lon * DEG), r * Math.sin(lat * DEG));

// A curved patch (64 x 64 segments) of the sphere hm above the globe over bounds, textured; positions are relative to
// the patch centre so float32 keeps its precision.
export function spherePatch(bounds, texture, { name, opacity = 0.6, hm = PATCH_H, N = 64 } = {}) {
  const [w, s, e, n] = bounds, r = R + hm, centre = sphere((w + e) / 2, (s + n) / 2, r), p = new THREE.Vector3();
  const pos = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2), idx = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      sphere(w + (e - w) * i / N, s + (n - s) * j / N, r, p).sub(centre);
      pos.set([p.x, p.y, p.z], 3 * k);
      uv.set([i / N, j / N], 2 * k);
      if (i < N && j < N) idx.push(k, k + 1, k + N + 1, k + 1, k + N + 2, k + N + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  mesh.position.copy(centre);
  mesh.name = name || 'patch';
  return mesh;
}

// Lines on the sphere hm above the globe: lines is [[ [lon, lat], ... ], ...].
export function sphereLines(lines, { name, colour = 0xffffff, opacity = 0.85, hm = LINE_H } = {}) {
  const r = R + hm, all = lines.flat();
  if (!all.length) return null;
  const c = all.reduce((a, [lo, la]) => [a[0] + lo / all.length, a[1] + la / all.length], [0, 0]);
  const centre = sphere(c[0], c[1], r), p = new THREE.Vector3(), out = [];
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      for (const q of [line[i], line[i + 1]]) { sphere(q[0], q[1], r, p).sub(centre); out.push(p.x, p.y, p.z); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const o = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false }));
  o.position.copy(centre);
  o.name = name || 'lines';
  o.raycast = () => {};
  return o;
}

export function spherePoints(points, { name, colour = 0xffffff, size = 4, hm = LINE_H } = {}) {
  if (!points.length) return null;
  const r = R + hm, c = points.reduce((a, [lo, la]) => [a[0] + lo / points.length, a[1] + la / points.length], [0, 0]);
  const centre = sphere(c[0], c[1], r), p = new THREE.Vector3(), out = [];
  for (const q of points) { sphere(q[0], q[1], r, p).sub(centre); out.push(p.x, p.y, p.z); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const o = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: false, depthWrite: false }));
  o.position.copy(centre);
  o.name = name || 'points';
  o.raycast = () => {};
  return o;
}

// Lines and points on a site's drawn ground (root-local, so they follow the exaggeration), only where there is ground.
function groundLines(view, lines, { name, colour, opacity = 0.9, lift = 1.5 }) {
  const out = [];
  for (const line of lines) {
    let prev = null;
    for (const [lon, lat] of line) {
      const p = view.groundPoint(lon, lat, lift);
      const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
      if (ok && prev) out.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = ok ? p : null;
    }
  }
  if (!out.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const o = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, depthTest: false }));
  o.renderOrder = 4;
  o.name = name;
  o.raycast = () => {};
  return o;
}
function groundPoints(view, points, { name, colour, size = 6, lift = 1.5 }) {
  const out = [];
  for (const [lon, lat] of points) {
    const p = view.groundPoint(lon, lat, lift);
    if (Number.isFinite(p.y)) out.push(p.x, p.y, p.z);
  }
  if (!out.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const o = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: false, depthTest: false }));
  o.renderOrder = 4;
  o.name = name;
  o.raycast = () => {};
  return o;
}
const dispose = (o) => { if (!o) return; if (o.parent) o.parent.remove(o); o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); }); };

// ---------- loading ----------

const cache = new Map(); // url -> Promise
function fetchJson(catalog, path) {
  const url = new URL(path, catalog.baseUrl).href;
  if (!cache.has(url)) {
    cache.set(url, catalog.fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path); return r.json(); }));
  }
  return cache.get(url);
}
function loadTexture(catalog, file, { nearest = false, crop = null } = {}) {
  const url = new URL(file.path, catalog.baseUrl).href, k = url + (crop ? '#' + crop.join(',') : '');
  if (!cache.has(k)) {
    cache.set(k, (async () => {
      const img = new Image();
      img.src = url;
      await img.decode();
      let src = img, bounds = file.bounds;
      if (crop) { // a part of a global PNG (the GRS map), on whole pixels
        const [w, s, e, n] = file.bounds, px = (e - w) / img.naturalWidth, py = (n - s) / img.naturalHeight;
        const c0 = Math.max(0, Math.floor((crop[0] - w) / px)), c1 = Math.min(img.naturalWidth, Math.ceil((crop[2] - w) / px));
        const r0 = Math.max(0, Math.floor((n - crop[3]) / py)), r1 = Math.min(img.naturalHeight, Math.ceil((n - crop[1]) / py));
        const cv = document.createElement('canvas');
        cv.width = c1 - c0; cv.height = r1 - r0;
        cv.getContext('2d').drawImage(img, c0, r0, cv.width, cv.height, 0, 0, cv.width, cv.height);
        src = cv;
        bounds = [w + c0 * px, n - r1 * py, w + c1 * px, n - r0 * py];
      }
      const tex = src === img ? new THREE.Texture(img) : new THREE.CanvasTexture(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (nearest) { tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; }
      tex.needsUpdate = true;
      return { texture: tex, bounds };
    })());
  }
  return cache.get(k);
}

// A raster layer of a view: a patch on the globe (region) or an overlay on the site terrain. Holds one load per place.
function rasterLayer(catalog, onChange) {
  const patches = new Map(); // key -> {mesh, state}
  let siteOn = null; // the site view the overlay is on
  return {
    // ctx: the view ctx; entry/file: the dataset and PNG; key: what identifies the image (region + dataset)
    show(ctx, entry, { opacity = 0.6, nearest = false, crop = null } = {}) {
      const file = fileOf(entry, 'png');
      if (!file) return;
      const want = ctx.siteView || null, key = (want ? 'site:' : ctx.regionId + ':') + entry.id;
      this.hide(ctx);
      if (want) {
        siteOn = want;
        loadTexture(catalog, file, { nearest, crop }).then(({ texture, bounds }) => {
          if (siteOn === want) want.setOverlay({ texture, bounds, opacity });
          onChange();
        }, () => onChange());
        return;
      }
      let p = patches.get(key);
      if (!p) {
        p = { mesh: null, state: 'loading', want: true };
        patches.set(key, p);
        loadTexture(catalog, file, { nearest, crop }).then(({ texture, bounds }) => {
          p.mesh = spherePatch(bounds, texture, { name: 'patch:' + key, opacity });
          p.mesh.userData.ready = true;
          p.mesh.visible = p.want;
          ctx.globe.scene.add(p.mesh);
          p.state = 'ready';
          onChange();
        }, () => { p.state = 'failed'; onChange(); });
      }
      p.want = true;
      if (p.mesh) p.mesh.visible = true;
      this.shown = p;
    },
    hide(ctx) {
      if (siteOn) { siteOn.setOverlay(null); siteOn = null; }
      if (ctx && ctx.siteView) ctx.siteView.setOverlay(null); // a simulated field too
      for (const p of patches.values()) { p.want = false; if (p.mesh) p.mesh.visible = false; }
      this.shown = null;
    },
    failed: () => [...patches.values()].some((p) => p.want && p.state === 'failed'),
    shown: null,
  };
}

// Vector layers (lines/points), on the globe per region or on the open site's ground; rebuilt per place.
function vectorLayer() {
  let objs = [];
  return {
    set(list) { this.clear(); objs = list.filter(Boolean); },
    add(parent) { for (const o of objs) if (!o.parent) parent.add(o); },
    clear() { for (const o of objs) dispose(o); objs = []; },
    get count() { return objs.length; },
  };
}

const linesOf = (geom) => {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
};
const pointsOf = (fc) => ((fc && fc.features) || []).filter((f) => f.geometry && f.geometry.type === 'Point').map((f) => f.geometry.coordinates);
const inBounds = (b, [lon, lat]) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
const grow = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
const regionOfCtx = (catalog, ctx) => catalog.regions.find((r) => r.id === (ctx.site ? ctx.site.regionId : ctx.regionId)) || null;
const regionIdOf = (ctx) => (ctx.site ? ctx.site.regionId : ctx.regionId);

// ---------- simulated views (R33): where a site has no data for a view, a smooth seeded field in its palette ----------

export const SIM_PALETTES = {
  BT: ['#B8DFC2', '#E3C78F', '#FFB19B'], GI: ['#ffffcc', '#41b6c4', '#0c2c84'], SC: ['#3b2a1a', '#ffd27a', '#fff6d8'],
  TC: ['#313695', '#fee090', '#a50026'], IR: ['#1a9850', '#fee08b', '#a50026'],
};
export const SIMULATED_TEXT = 'Simulated view: data not collected for this site';
const simCache = new Map();
// A 64 x 64 texture: a few seeded waves (site id + factor), through the factor's palette. Same site, same picture.
export function simulatedTexture(siteId, factorId) {
  const k = siteId + ':' + factorId;
  if (simCache.has(k)) return simCache.get(k);
  const N = 64, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d'), im = g.createImageData(N, N), pal = SIM_PALETTES[factorId].map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  const waves = [0, 1, 2, 3].map((i) => ({ fx: 1 + 4 * seededUnit(k + 'x' + i), fy: 1 + 4 * seededUnit(k + 'y' + i), ph: 6.283 * seededUnit(k + 'p' + i) }));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += Math.sin((w.fx * x + w.fy * y) / N * 6.283 + w.ph);
      const t = Math.min(1, Math.max(0, 0.5 + v / 5)) * (pal.length - 1), i = Math.min(pal.length - 2, Math.floor(t)), f = t - i, o = 4 * (y * N + x);
      for (let c = 0; c < 3; c++) im.data[o + c] = pal[i][c] * (1 - f) + pal[i + 1][c] * f;
      im.data[o + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  simCache.set(k, tex);
  return tex;
}
// Lay the simulated field over the open site and its surround.
export function showSimulated(ctx, factorId) {
  if (!ctx.siteView || !ctx.site) return;
  const [w, s, e, n] = ctx.site.bounds, d = 0.06;
  ctx.siteView.setOverlay({ texture: simulatedTexture(ctx.site.id, factorId), bounds: [w - d, s - d, e + d, n + d], opacity: 0.55, simulated: true });
}
export const simulatedKey = (what) => ({ text: SIMULATED_TEXT, source: '', missing: true, simulated: true, demo: 'a simulated ' + what + ' field, not data' });

// ---------- Ground & ice ----------

const GI_LAYERS = [
  { id: 'grs', base: 'water_odyssey_grs', label: 'Water (Odyssey GRS)' },
  { id: 'ti', base: 'thermal_inertia_themis_1km', label: 'Thermal inertia (THEMIS)' },
];
export function groundView({ catalog, onChange = () => {}, resultOf = () => null }) {
  const raster = rasterLayer(catalog, onChange), outlines = vectorLayer();
  let layer = 'grs', place = null, unitName = new Map(); // regionId -> the geology unit under each site centre
  const entryOf = (ctx, id) => regionDataset(catalog, regionIdOf(ctx), GI_LAYERS.find((l) => l.id === id).base);
  const geology = (ctx) => regionDataset(catalog, regionIdOf(ctx), 'geology_units');
  function draw(ctx) {
    const e = entryOf(ctx, layer), region = regionOfCtx(catalog, ctx);
    if (e && fileOf(e, 'png')) raster.show(ctx, e, layer === 'grs' ? { opacity: 0.45, nearest: true, crop: region ? grow(region.bounds, 10) : null } : { opacity: 0.6 });
    else { raster.hide(ctx); showSimulated(ctx, 'GI'); }
  }
  let panelEl = null;
  function panel(ctx) {
    if (!panelEl) panelEl = h('div', 'view-choices');
    const b = panelEl;
    b.replaceChildren();
    b.setAttribute('role', 'group');
    b.setAttribute('aria-label', 'Ground & ice layer');
    for (const l of GI_LAYERS) {
      const have = !!fileOf(entryOf(ctx, l.id), 'png');
      const btn = h('button', 'choice', l.label + (have ? '' : ' (missing)'));
      btn.type = 'button';
      btn.dataset.layer = l.id;
      btn.disabled = !have;
      btn.setAttribute('aria-pressed', String(l.id === layer));
      btn.addEventListener('click', () => { layer = l.id; if (place) draw(place); onChange(); });
      b.append(btn);
    }
    return b;
  }
  return {
    apply(ctx) {
      place = ctx;
      draw(ctx);
      const g = geology(ctx), f = fileOf(g, 'geojson');
      if (!f || ctx.siteView) return; // the unit outlines are hundreds of km: drawn on the globe in the region view
      fetchJson(catalog, f.path).then((fc) => {
        if (place !== ctx) return;
        outlines.set([sphereLines(fc.features.flatMap((x) => linesOf(x.geometry)), { name: 'geology:' + ctx.regionId, colour: 0xedc49b, opacity: 0.7 })]);
        outlines.add(ctx.globe.scene);
        onChange();
      }, () => onChange());
    },
    clear(ctx) { place = null; raster.hide(ctx); outlines.clear(); },
    key(ctx) {
      const e = entryOf(ctx, layer);
      if (!e || !fileOf(e, 'png')) return ctx.siteView ? simulatedKey('ground') : missingKey(layer === 'grs' ? 'orbital water data' : 'thermal-inertia data');
      if (raster.failed()) return { text: 'The ground data failed to load here: needs confirmation', source: '', missing: true };
      const gi = ctx.site ? resultOf(ctx.site.id, 'GI-05') : null;
      const here = gi && Number.isFinite(gi.value) ? ' Here: ' + gi.display + '.' : '';
      const geo = geology(ctx) && fileOf(geology(ctx), 'geojson') ? (ctx.siteView ? '' : ' Outlines: geologic units (USGS, interpretation).') : ' No geologic map here.';
      if (layer === 'grs') {
        return { text: 'Water in the top layer of the ground: light 2 to dark 20 wt% H₂O, from orbit in 5° cells.' + here + geo,
          source: 'From Mars Odyssey GRS (' + ev(e) + ').', missing: false,
          demo: 'Odyssey GRS cells are about 300 km across, and the SWIM ice data is not collected yet' };
      }
      return { text: 'Thermal inertia: purple low (dust, sand) to orange high (rock), 1 km cells.' + here + geo,
        source: 'From THEMIS night images (' + ev(e) + ').', missing: false,
        demo: 'thermal inertia is a 1 km stand-in for rockiness, and the SWIM ice data is not collected yet' };
    },
    datasets(ctx) {
      return [entryOf(ctx, layer), ctx.siteView ? null : geology(ctx)].filter((d) => d && (d.files || []).length).map((d) => d.id);
    },
    panel,
    probe: groundProbe(catalog),
    debug: () => ({ layer, outlines: outlines.count }),
  };
}

// ---------- Solar ----------

// The skyline chart: the horizon seen from the solar plot's centre, and the sun's paths at aphelion and perihelion.
export function skylineChart(table, grid, fp) {
  const W = 300, H = 120, sky = skyline(grid, fp), top = Math.max(45, ...sky.filter(Number.isFinite).map((v) => v + 5));
  const x = (az) => (az / 360) * W, y = (el) => H - (Math.max(0, el) / top) * H;
  const svgNS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + 16));
  svg.setAttribute('class', 'skyline');
  svg.setAttribute('role', 'img');
  const el = (tag, attrs) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
  const pts = sky.map((v, az) => x(az) + ',' + y(Number.isFinite(v) ? v : 0)).join(' ');
  el('polygon', { points: '0,' + H + ' ' + pts + ' ' + W + ',' + H, class: 'horizon' });
  const paths = [['aph', APHELION_LS, 'Aphelion (Ls 71)'], ['peri', PERIHELION_LS, 'Perihelion (Ls 251)']];
  for (const [cls, ls] of paths) {
    const p = sunPath(table, ls);
    let d = '', last = null;
    for (const q of p) { // break the line where the path wraps through north
      d += (last === null || Math.abs(q.azDeg - last) > 180 ? 'M' : 'L') + x(q.azDeg).toFixed(1) + ' ' + y(q.elDeg).toFixed(1) + ' ';
      last = q.azDeg;
    }
    el('path', { d, class: 'sun ' + cls });
  }
  for (const [az, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']]) {
    const tx = el('text', { x: Math.min(W - 6, Math.max(2, x(az) - 3)), y: H + 13, class: 'axis' });
    tx.textContent = t;
  }
  const maxH = Math.max(...sky.filter(Number.isFinite));
  const label = 'Skyline from the solar plot, highest ' + fmt(maxH, 1) + '° above the horizontal; the sun paths at aphelion and perihelion.';
  svg.setAttribute('aria-label', label);
  const wrap = h('figure', 'skyline-chart');
  const cap = h('figcaption', '');
  cap.append(h('span', 'lg horizon-lg', 'Skyline'), ' ', h('span', 'lg aph-lg', paths[0][2]), ' ', h('span', 'lg peri-lg', paths[1][2]));
  wrap.append(svg, cap);
  return wrap;
}

// The worst-season noon sun on the site's ground against level ground (probes.js tiltFactor), 128 x 128 over the site:
// dark brown × 0.7 and less, pale × 1.0, bright yellow × 1.3 and more. Derived from the elevation grid; cached per site.
export const TILT_STOPS = [[0.7, '#3b2a1a'], [1.0, '#e8d8b0'], [1.3, '#ffd23a']];
const tiltCache = new WeakMap();
export function tiltTexture(site, sun, N = 128) {
  if (tiltCache.has(site)) return tiltCache.get(site);
  const g = site.grids && site.grids.elevation;
  if (!g || !sun) return null;
  const [w, s, e, n] = site.bounds, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c2 = cv.getContext('2d'), im = c2.createImageData(N, N);
  const rgb = TILT_STOPS.map(([v, c]) => [v, ...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const lon = w + (e - w) * (x + 0.5) / N, lat = n - (n - s) * (y + 0.5) / N, o = 4 * (y * N + x); // canvas row 0 is north
      const { slopeDeg, aspectDeg } = slopeAspect(g, lon, lat);
      const f = tiltFactor(slopeDeg, aspectDeg, sun.elDeg, sun.azDeg);
      if (!Number.isFinite(f)) { im.data[o + 3] = 0; continue; } // no data: left clear
      const v = Math.min(rgb[2][0], Math.max(rgb[0][0], f)), i = v <= rgb[1][0] ? 0 : 1, t = (v - rgb[i][0]) / (rgb[i + 1][0] - rgb[i][0]);
      for (let k = 1; k <= 3; k++) im.data[o + k - 1] = rgb[i][k] * (1 - t) + rgb[i + 1][k] * t;
      im.data[o + 3] = 255;
    }
  }
  c2.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  const out = { texture: tex, bounds: site.bounds.slice() };
  tiltCache.set(site, out);
  return out;
}

export function solarView({ catalog, onChange = () => {}, layoutOf = () => null, resultOf = () => null }) {
  let chart = null, chartFor = null, tilt = false;
  const ready = (site) => site && site.horizon && site.sunTable;
  const solarFp = (site) => { const l = layoutOf(site.id); return l ? l.footprints.find((f) => f.id === 'solar') || l.footprints[0] : null; };
  return {
    apply(ctx) {
      tilt = false;
      if (ctx.siteView && ready(ctx.site)) {
        const sun = worstNoonSun(ctx.site.sunTable), t = tiltTexture(ctx.site, sun);
        ctx.siteView.setSun(sun);
        if (t) { ctx.siteView.setOverlay({ ...t, opacity: 0.5 }); tilt = true; }
      } else showSimulated(ctx, 'SC');
    },
    clear(ctx) { if (ctx.siteView) { ctx.siteView.setSun(null); ctx.siteView.setOverlay(null); } chart = chartFor = null; tilt = false; },
    debug: () => ({ tilt }),
    key(ctx) {
      const demo = 'the sun and the energy come from models (the site\'s sun table, the Mars Climate Database) over a 100 m skyline';
      if (!ctx.siteView) {
        const region = catalog.regions.find((r) => r.id === ctx.regionId);
        const n = region ? region.sites.filter((s) => catalog.raw.datasets.some((d) => d.coverage && d.coverage.area === s.id && (d.metrics || []).includes('SC-01') && (d.files || []).length)).length : 0;
        if (!n) return missingKey('skyline or sun table');
        return { text: 'Solar: open a site to light its terrain by the worst-season noon sun and see its skyline. ' + n + ' of ' + region.sites.length + ' sites here have a skyline and sun table.',
          source: 'From the elevation models (derived) and Mars24 (model).', missing: false, demo };
      }
      if (!ready(ctx.site)) return simulatedKey('sunlight');
      const s = worstNoonSun(ctx.site.sunTable), sc = resultOf(ctx.site.id, 'SC-01');
      return { text: 'Lit by the worst-season noon sun (Ls ' + s.ls + ', ' + fmt(s.elDeg, 0) + '° up, azimuth ' + fmt(s.azDeg, 0) + '°), with terrain shadows.'
        + (tilt ? ' Ground tint: that sun on the ground against level ground, brown × 0.7 to pale × 1.0 to yellow × 1.3.' : '')
        + (sc && Number.isFinite(sc.value) ? ' Sun lost to the skyline at the solar plot: ' + sc.display + '.' : ''),
        source: 'From the site skyline (derived) and sun table (model).', missing: false, demo };
    },
    datasets(ctx) {
      if (!ctx.site) return [];
      return [ctx.site.horizon && ctx.site.horizon.datasetId, ...catalog.raw.datasets.filter((d) => d.coverage && d.coverage.area === ctx.site.id && /^sun_table/.test(d.id)).map((d) => d.id)].filter(Boolean);
    },
    probe: solarProbe(),
    panel(ctx) {
      if (!ctx.siteView || !ready(ctx.site)) return null;
      const fp = solarFp(ctx.site);
      const k = ctx.site.id + ':' + (fp ? fp.center.lon.toFixed(5) + ',' + fp.center.lat.toFixed(5) : '');
      if (fp && k !== chartFor) { chart = skylineChart(ctx.site.sunTable, ctx.site.horizon, fp); chartFor = k; }
      return fp ? chart : null;
    },
  };
}

// ---------- Thermal ----------

export function thermalView({ catalog, onChange = () => {} }) {
  const raster = rasterLayer(catalog, onChange);
  let caseKey = null, place = null, panelEl = null;
  const entry = (ctx, c) => regionDataset(catalog, regionIdOf(ctx), c.base);
  const have = (ctx, c) => { const e = entry(ctx, c), f = fileOf(e, 'png'); return !!f; };
  const covers = (ctx, c) => { // the case's image covers the open site (or, in the region view, exists)
    if (!have(ctx, c)) return false;
    if (!ctx.site) return true;
    const b = fileOf(entry(ctx, c), 'png').bounds, sb = ctx.site.bounds;
    return !!b && b[0] <= sb[0] && b[1] <= sb[1] && b[2] >= sb[2] && b[3] >= sb[3];
  };
  const current = (ctx) => THEMIS_CASES.find((c) => c.key === caseKey) || THEMIS_CASES.find((c) => covers(ctx, c)) || THEMIS_CASES[0];
  function draw(ctx) {
    const c = current(ctx);
    caseKey = c.key;
    if (covers(ctx, c)) raster.show(ctx, entry(ctx, c), { opacity: 0.65 }); else { raster.hide(ctx); showSimulated(ctx, 'TC'); }
  }
  return {
    apply(ctx) { place = ctx; caseKey = null; draw(ctx); },
    clear(ctx) { place = null; raster.hide(ctx); },
    key(ctx) {
      const c = current(ctx), n = THEMIS_CASES.filter((x) => covers(ctx, x)).length;
      const where = ctx.site ? 'this site' : 'this region';
      if (!n) return ctx.siteView ? simulatedKey('surface temperature') : missingKey('thermal-imaging data covering ' + where);
      if (!covers(ctx, c)) return { text: 'No thermal-imaging data covers ' + where + ' for ' + c.name + ': needs confirmation', source: '', missing: true,
        demo: 'THEMIS covers ' + n + ' of 4 temperature cases here' };
      if (raster.failed()) return { text: 'The thermal data failed to load here: needs confirmation', source: '', missing: true };
      const e = entry(ctx, c), o = e.observation_time || {};
      return { text: 'Surface temperature, ' + c.name + (Number.isFinite(o.local_solar_time_h) ? ' (' + fmt(o.local_solar_time_h, 1) + ' h, Ls ' + fmt(o.ls, 0) + ')' : '')
          + ': blue 160 K to red 310 K, about 100 m pixels.', source: 'From THEMIS (' + ev(e) + ').', missing: false,
        ...(n < 4 ? { demo: 'THEMIS covers ' + n + ' of 4 temperature cases here' } : {}) };
    },
    datasets(ctx) { const c = current(ctx); return covers(ctx, c) ? [entry(ctx, c).id] : []; },
    panel(ctx) {
      if (!panelEl) panelEl = h('div', 'view-choices');
      panelEl.replaceChildren();
      panelEl.setAttribute('role', 'group');
      panelEl.setAttribute('aria-label', 'Temperature case');
      const cur = current(ctx);
      for (const c of THEMIS_CASES) {
        const ok = covers(ctx, c);
        const b = h('button', 'choice', c.name.charAt(0).toUpperCase() + c.name.slice(1) + (ok ? '' : ' (missing)'));
        b.type = 'button';
        b.dataset.case = c.key;
        b.disabled = !ok;
        b.setAttribute('aria-pressed', String(c.key === cur.key));
        b.addEventListener('click', () => { caseKey = c.key; if (place) draw(place); onChange(); });
        panelEl.append(b);
      }
      return panelEl;
    },
    probe: thermalProbe(catalog, (ctx) => current(ctx)),
    debug: () => ({ caseKey }),
  };
}

// ---------- Routes ----------

const TRAVERSE_COLOUR = 0xffffff, STOP_COLOUR = 0xedc49b, CABLE_COLOUR = 0x6fe3ff, RING_COLOUR = 0xedc49b;
export const RING_STEP_M = 500;
// Circles round the base every RING_STEP_M metres, the ones that reach into box ([w, s, e, n]), as [lon, lat] lines.
export function baseRings(base, box, step = RING_STEP_M) {
  const kx = R * DEG * Math.cos(base.lat * DEG), ky = R * DEG, out = [];
  const far = Math.max(...[[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map(([x, y]) => Math.hypot((x - base.lon) * kx, (y - base.lat) * ky)));
  for (let r = step; r <= far && out.length < 40; r += step) {
    out.push(Array.from({ length: 129 }, (_, i) => [base.lon + r * Math.sin(i / 128 * 2 * Math.PI) / kx, base.lat + r * Math.cos(i / 128 * 2 * Math.PI) / ky]));
  }
  return out;
}
export function routesView({ catalog, onChange = () => {}, layoutOf = () => null, resultOf = () => null }) {
  const raster = rasterLayer(catalog, onChange), vectors = vectorLayer();
  let place = null, counts = { path: 0, stops: 0 }, ringCount = 0;
  const ds = (ctx, base) => regionDataset(catalog, regionIdOf(ctx), base);
  const trip = (ctx) => ds(ctx, 'slope_2m_trip_area');
  return {
    apply(ctx) {
      place = ctx;
      const t = trip(ctx);
      if (t && fileOf(t, 'png')) raster.show(ctx, t, { opacity: 0.5 });
      else showSimulated(ctx, 'IR');
      const region = regionOfCtx(catalog, ctx);
      const sites = ctx.site ? [ctx.site.id] : region ? region.sites.map((s) => s.id) : [];
      const cables = sites.map((id) => {
        const l = layoutOf(id), c = l && l.footprints.find((f) => f.id === 'compound');
        return c && region && region.base ? [[c.center.lon, c.center.lat], [region.base.lon, region.base.lat]] : null;
      }).filter(Boolean);
      const path = ds(ctx, 'rover_path'), stops = ds(ctx, 'rover_stops');
      const pf = fileOf(path, 'geojson'), sf = fileOf(stops, 'geojson');
      Promise.all([pf ? fetchJson(catalog, pf.path).catch(() => null) : null, sf ? fetchJson(catalog, sf.path).catch(() => null) : null]).then(([pj, sj]) => {
        if (place !== ctx) return;
        let lines = pj ? pj.features.flatMap((f) => linesOf(f.geometry)).map((l) => l.map((q) => [q[0], q[1]])) : [];
        let pts = pointsOf(sj).map((q) => [q[0], q[1]]);
        if (ctx.siteView) {
          const box = grow(ctx.site.bounds, 0.06); // the trip window, about 3 km round the site
          lines = lines.map((l) => l.filter((q) => inBounds(box, q))).filter((l) => l.length > 1);
          pts = pts.filter((q) => inBounds(box, q));
          // densify the cable so it follows the ground
          const dense = cables.map(([a, b]) => Array.from({ length: 65 }, (_, i) => [a[0] + (b[0] - a[0]) * i / 64, a[1] + (b[1] - a[1]) * i / 64]));
          const rings = region && region.base ? baseRings(region.base, box) : [];
          ringCount = rings.length;
          vectors.set([
            groundLines(ctx.siteView, lines, { name: 'rover-path', colour: TRAVERSE_COLOUR, opacity: 0.8 }),
            groundPoints(ctx.siteView, pts, { name: 'rover-stops', colour: STOP_COLOUR, size: 5 }),
            groundLines(ctx.siteView, dense, { name: 'cable', colour: CABLE_COLOUR, opacity: 1, lift: 3 }),
            groundLines(ctx.siteView, rings, { name: 'base-rings', colour: RING_COLOUR, opacity: 0.75, lift: 2 }),
          ]);
          vectors.add(ctx.siteView.root);
        } else {
          vectors.set([
            sphereLines(lines, { name: 'rover-path:' + ctx.regionId, colour: TRAVERSE_COLOUR, opacity: 0.8 }),
            spherePoints(pts, { name: 'rover-stops:' + ctx.regionId, colour: STOP_COLOUR, size: 3 }),
            sphereLines(cables, { name: 'cables:' + ctx.regionId, colour: CABLE_COLOUR, opacity: 1, hm: 80 }),
          ]);
          vectors.add(ctx.globe.scene);
        }
        counts = { path: lines.length, stops: pts.length };
        onChange();
      });
    },
    clear(ctx) { place = null; raster.hide(ctx); vectors.clear(); counts = { path: 0, stops: 0 }; ringCount = 0; },
    key(ctx) {
      const path = ds(ctx, 'rover_path'), t = trip(ctx);
      const hasPath = !!fileOf(path, 'geojson'), hasTrip = !!fileOf(t, 'png');
      const bt21 = ctx.site ? resultOf(ctx.site.id, 'BT-21') : null;
      const parts = [ctx.site
        ? 'Cable to the base (cyan): ' + (bt21 && Number.isFinite(bt21.value) ? bt21.display + ' in a straight line' : 'length not known') + '.'
        : 'Cables from each site to the base in cyan.'];
      if (ctx.siteView) parts.push('Tan rings: every ' + RING_STEP_M + ' m from the base.');
      parts.push(hasPath ? 'The rover\'s driven path in white, its stops in tan.' : 'No rover traverse here.');
      parts.push(hasTrip ? 'Trip-area slope over 2 m: green flat, yellow 10°, red 35° and steeper.' : SIMULATED_TEXT + ' (trip-area slope).');
      return { text: parts.join(' '), source: 'From ' + [hasPath ? 'the rover team\'s traverse (' + ev(path) + ')' : null, hasTrip ? 'the 2 m elevation model (' + ev(t) + ')' : null].filter(Boolean).join(' and ') + '.',
        missing: !hasTrip, demo: 'the cable is a straight line to the base, not a planned route' };
    },
    datasets(ctx) { return ['rover_path', 'rover_stops', 'slope_2m_trip_area'].map((b) => ds(ctx, b)).filter((d) => d && (d.files || []).length).map((d) => d.id); },
    probe: routesProbe(catalog),
    debug: () => ({ ...counts, vectors: vectors.count, rings: ringCount }),
  };
}
