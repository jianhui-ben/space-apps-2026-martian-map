// The factor bar and its views (Task 9c): a segmented control under the header in the region and site views (Photo ·
// Terrain · Ground & ice · Solar · Thermal · Routes), the registry the views join, and the current view's one-line key.
//
// A view is {apply(ctx), clear(ctx), key(ctx) -> {text, source, missing}, datasets?(ctx) -> [dataset ids]}, with
// ctx = {globe, siteView, site, regionId}. The bar applies the chosen view, and clears it again when the view or its
// place (the open site, the region) changes. Views that aren't registered are not shown. This task registers the photo
// view and Terrain; Task 12 calls registerView() for Ground & ice, Solar, Thermal and Routes, with no change here or in
// the card (its rows show "View" for whatever is registered).
import * as THREE from 'three';
import { FACTORS, factorSentence } from '../plain.js';
import { ICON_WORDS, ICON_CLASS } from './list.js';
import { datasetsInRegion } from '../catalog.js';
import { SLOPE_CLASSES, SLOPE_MIX, slopeClass } from '../site.js';

export const VIEW_ORDER = ['photo', 'BT', 'GI', 'SC', 'TC', 'IR'];
const R = 3396190; // the Mars sphere the globe draws (globe.js)
const VIEW_NAMES = { photo: 'Photo', ...Object.fromEntries(FACTORS.map((f) => [f.id, f.name])) };

export function createViewRegistry() {
  const views = new Map();
  return {
    register(id, view) {
      if (!VIEW_ORDER.includes(id)) throw new Error('unknown view ' + id + ' (one of ' + VIEW_ORDER.join(', ') + ')');
      views.set(id, view);
    },
    get: (id) => views.get(id) || null,
    has: (id) => views.has(id),
    ids: () => VIEW_ORDER.filter((id) => views.has(id)), // the bar's order, whatever the order of registration
  };
}
const registry = createViewRegistry();
export const registerView = (id, view) => registry.register(id, view);
export const hasView = (id) => registry.has(id);
export const getView = (id) => registry.get(id);

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};

// el: the bar's container. onView(id) asks for a view (main.js sets the store's view key).
export function createFactorBar(el, { registry: reg = registry, onView = () => {} } = {}) {
  el.classList.add('factor-bar');
  const segs = h('div', 'segs');
  segs.setAttribute('role', 'group');
  segs.setAttribute('aria-label', 'Map view');
  const key = h('p', 'view-key');
  key.id = 'view-key';
  key.setAttribute('aria-live', 'polite');
  el.replaceChildren(segs, key);
  let shownIds = null, active = null, keyShown = null;
  const buttons = new Map();

  function build(ids) {
    buttons.clear();
    segs.replaceChildren();
    for (const id of ids) {
      const b = h('button', 'seg');
      b.type = 'button';
      b.dataset.view = id;
      const icon = h('span', 'seg-icon');
      icon.hidden = true;
      b.append(icon, h('span', 'seg-name', VIEW_NAMES[id]));
      b.addEventListener('click', () => onView(id));
      segs.append(b);
      buttons.set(id, { b, icon });
    }
    shownIds = ids.join('|');
  }

  // state: {show, view (the store's), ctx, results (the open site's, or null), metrics}
  function render({ show, view, ctx, results = null, metrics = [] }) {
    el.hidden = !show;
    const ids = reg.ids();
    if (ids.join('|') !== shownIds) build(ids);
    // the view in force: the chosen one where the bar is shown and it is registered, else the photo view
    const id = show && reg.has(view) ? view : reg.has('photo') ? 'photo' : null;
    if (!active || active.id !== id || active.ctx.siteView !== ctx.siteView || active.ctx.regionId !== ctx.regionId) {
      if (active && active.id && reg.has(active.id)) reg.get(active.id).clear(active.ctx);
      if (id) reg.get(id).apply(ctx);
      active = { id, ctx };
    } else active.ctx = ctx;
    for (const [vid, { b, icon }] of buttons) {
      b.setAttribute('aria-pressed', String(vid === id));
      const f = vid !== 'photo' && ctx.siteView && results ? factorSentence(vid, results, metrics).icon : null;
      icon.hidden = !f;
      if (f) { icon.textContent = f; icon.className = 'seg-icon ' + ICON_CLASS[f]; b.setAttribute('aria-label', VIEW_NAMES[vid] + ': ' + ICON_WORDS[f]); } else b.removeAttribute('aria-label');
    }
    const k = id && show ? reg.get(id).key(ctx) : null;
    const kk = JSON.stringify(k);
    if (kk !== keyShown) {
      keyShown = kk;
      key.replaceChildren();
      key.dataset.view = id || '';
      key.classList.toggle('missing', !!(k && k.missing));
      if (k) {
        if (k.missing) key.append(h('span', 'st-icon k-unresolved', '?'), ' ');
        key.append(h('span', 'k-text', k.text));
        if (k.source) key.append(' ', h('span', 'k-source', k.source));
      }
    }
  }
  return { render, active: () => (active ? active.id : null) };
}

// The datasets the view in force draws, for the References page's "Data on screen".
export function viewDatasets(id, ctx) {
  const v = registry.get(id);
  return v && v.datasets ? v.datasets(ctx) : [];
}

// ---------- the photo view: the map as it is drawn, with its key ----------

const metres = (v) => Math.round(v).toLocaleString('en-US').replace('-', '−') + ' m';
const intersects = (a, b) => a && b && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

// Elevation range of the site's colour ramp: the drawn vertices of the site and trip meshes (as site.js paints them).
const ranges = new WeakMap();
export function rampRange(view) {
  if (!view) return null;
  if (ranges.has(view)) return ranges.get(view);
  let lo = Infinity, hi = -Infinity;
  for (const m of [view.terrain, view.tripTerrain]) {
    if (!m) continue;
    const e = m.geometry.attributes.elevation, idx = m.geometry.index;
    if (!e || !idx) continue;
    const ea = e.array, ia = idx.array;
    for (let i = 0; i < ia.length; i++) { const v = ea[ia[i]]; if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const out = Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
  ranges.set(view, out);
  return out;
}

export function photoView({ catalog }) {
  const ctxBox = catalog.byId.get('imagery_ctx'), ctxBounds = ctxBox && ctxBox.coverage && ctxBox.coverage.bounds;
  const TREK = 'From NASA Mars Trek.';
  return {
    apply() {}, clear() {}, // the map as drawn
    key({ siteView, regionId }) {
      if (siteView) {
        const range = rampRange(siteView), k = siteView.root.scale.y;
        if (siteView.debug.drape().mode === 'hirise') {
          return { text: 'Photo: HiRISE (tinted) on the 1 m elevation model, heights ×' + k + '; any gaps are coloured by elevation.', source: TREK, missing: false };
        }
        const span = range ? 'dark (' + metres(range.lo) + ') to light (' + metres(range.hi) + ')' : 'dark low to light high';
        return { text: 'Coloured by elevation, ' + span + ': no HiRISE photo covers this site. Heights ×' + k + '.',
          source: 'From the 1 m HiRISE elevation model (derived).', missing: false };
      }
      const region = catalog.regions.find((r) => r.id === regionId);
      if (region && intersects(ctxBounds, region.bounds)) {
        return { text: 'Photo: CTX and HiRISE (tinted) over the Viking mosaic, graded warmer for display.', source: TREK, missing: false };
      }
      return { text: 'Photo: the Viking mosaic, graded warmer for display; no CTX or HiRISE here.', source: TREK, missing: false };
    },
  };
}

// ---------- the Terrain view: slope colouring on the site, the study slope on the globe in the region view ----------

// A colour of a PNG drawn with a legend's stops ([[value, '#rrggbb'], ...], linear between them) read back to its value:
// the nearest point on the polyline through the stops in RGB.
export function slopeFromLegend(r, g, b, stops) {
  const rgb = stops.map(([v, c]) => [v, parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  let best = Infinity, out = NaN;
  for (let i = 0; i + 1 < rgb.length; i++) {
    const [v0, r0, g0, b0] = rgb[i], [v1, r1, g1, b1] = rgb[i + 1];
    const dr = r1 - r0, dg = g1 - g0, db = b1 - b0, len = dr * dr + dg * dg + db * db;
    const t = len ? Math.min(1, Math.max(0, ((r - r0) * dr + (g - g0) * dg + (b - b0) * db) / len)) : 0;
    const d = (r - r0 - t * dr) ** 2 + (g - g0 - t * dg) ** 2 + (b - b0 - t * db) ** 2;
    if (d < best) { best = d; out = v0 + t * (v1 - v0); }
  }
  return out;
}

const pngOf = (d) => (d.files || []).find((f) => f.format === 'png') || null;
const MISSING_SLOPE = { text: 'No slope data here: needs confirmation', source: '', missing: true };

// The key for a slope dataset: the window it averages over and the elevation model it comes from, in words.
function slopeKey(entry) {
  const m = /^slope_(\d+)m/.exec(entry.id), src = (entry.source && entry.source.name) || '';
  const model = /CTX/.test(src) ? 'the CTX elevation model' : /HiRISE/.test(src) ? 'the 1 m HiRISE elevation model' : 'its elevation model';
  return {
    text: 'Slope over ' + (m ? m[1] : '10') + ' m: ' + SLOPE_CLASSES.map((c) => c.words).join(', ') + '.',
    source: 'From ' + model + ' (' + (entry.evidence_type || 'derived') + ').', missing: false,
  };
}

// The study slope PNG, its colours read back to degrees (its legend) and redrawn in the three classes, on a patch of the
// sphere 40 m above the globe over the dataset's bounds.
async function slopePatch(catalog, entry, regionId) {
  const file = pngOf(entry), stops = file.legend && file.legend.stops;
  if (!stops) throw new Error(entry.id + ': the PNG has no legend');
  const img = new Image();
  img.src = new URL(file.path, catalog.baseUrl).href;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g2 = cv.getContext('2d', { willReadFrequently: true });
  g2.drawImage(img, 0, 0);
  const im = g2.getImageData(0, 0, cv.width, cv.height), px = im.data;
  const classes = SLOPE_CLASSES.map((c) => [1, 3, 5].map((i) => parseInt(c.colour.slice(i, i + 2), 16)));
  const memo = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) { px[i + 3] = 0; continue; } // no data: left clear
    const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let c = memo.get(k);
    if (c === undefined) { c = slopeClass(slopeFromLegend(px[i], px[i + 1], px[i + 2], stops)); memo.set(k, c); }
    if (c < 0) { px[i + 3] = 0; continue; }
    px[i] = classes[c][0]; px[i + 1] = classes[c][1]; px[i + 2] = classes[c][2]; px[i + 3] = 255;
  }
  g2.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const [w, s, e, n] = file.bounds || entry.coverage.bounds, DEG = Math.PI / 180, r = R + 40, N = 64;
  const centre = new THREE.Vector3(), p = new THREE.Vector3();
  const at = (lon, lat, v) => v.set(r * Math.cos(lat * DEG) * Math.cos(lon * DEG), r * Math.cos(lat * DEG) * Math.sin(lon * DEG), r * Math.sin(lat * DEG));
  at((w + e) / 2, (s + n) / 2, centre); // positions relative to the patch centre keep float32 precision
  const pos = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2), idx = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      at(w + (e - w) * i / N, s + (n - s) * j / N, p).sub(centre);
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: SLOPE_MIX, depthWrite: false, side: THREE.DoubleSide }));
  mesh.position.copy(centre);
  mesh.name = 'slope-patch:' + regionId;
  mesh.userData.ready = true;
  return mesh;
}

export function terrainView({ catalog, onChange = () => {} }) {
  const patches = new Map(); // regionId -> {state: 'loading' | 'ready' | 'failed', mesh, want}
  const studyOf = (regionId) => datasetsInRegion(catalog, regionId).find((d) => /^slope_\d+m_study/.test(d.id) && pngOf(d)) || null;
  function showPatch(globe, regionId, on) {
    let p = patches.get(regionId);
    if (!p) {
      const entry = studyOf(regionId);
      if (!entry || !on) return;
      p = { state: 'loading', mesh: null, want: on };
      patches.set(regionId, p);
      slopePatch(catalog, entry, regionId).then((mesh) => {
        p.state = 'ready'; p.mesh = mesh; mesh.visible = p.want;
        globe.scene.add(mesh);
        onChange();
      }, () => { p.state = 'failed'; onChange(); }); // the key says the data failed; nothing is drawn in its place
    }
    p.want = on;
    if (p.mesh) p.mesh.visible = on;
  }
  return {
    apply(ctx) {
      if (ctx.siteView) ctx.siteView.setSlopeColouring(true); // the site's own 10 m window slope; the patch stays off
      else if (ctx.regionId) showPatch(ctx.globe, ctx.regionId, true);
    },
    clear(ctx) {
      if (ctx.siteView) ctx.siteView.setSlopeColouring(false);
      if (ctx.regionId) showPatch(ctx.globe, ctx.regionId, false);
    },
    key(ctx) {
      if (ctx.siteView) {
        const g = ctx.site && ctx.site.grids && ctx.site.grids.slope10, entry = g && catalog.byId.get(g.datasetId);
        return entry ? slopeKey(entry) : MISSING_SLOPE;
      }
      const entry = ctx.regionId && studyOf(ctx.regionId);
      if (!entry) return MISSING_SLOPE;
      const p = patches.get(ctx.regionId);
      if (p && p.state === 'failed') return { text: 'The slope data failed to load here: needs confirmation', source: '', missing: true };
      return slopeKey(entry);
    },
    datasets(ctx) {
      if (ctx.siteView) { const g = ctx.site && ctx.site.grids && ctx.site.grids.slope10; return g ? [g.datasetId] : []; }
      const entry = ctx.regionId && studyOf(ctx.regionId);
      return entry ? [entry.id] : [];
    },
  };
}
