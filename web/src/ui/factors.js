// The view control (Task 9c; R32, then R33): the three looks (Diorama · Survey sheet · Helmet HUD) over the open site,
// the registry the factor views join, the current view's one-line key, "Hide factor view" while one is on, and a place
// under the key, in a closed "View options", for a view's own panel (a chart, a case selector). Factor views are switched by the site card's rows
// ("View"); they are site-scale only (R33), so the control shows only with a site open.
//
// A view is {apply(ctx), clear(ctx), key(ctx) -> {text, source, missing, demo?}, datasets?(ctx) -> [dataset ids],
// panel?(ctx) -> Node | null, probe?(lon, lat, ctx) -> {title?, rows} (the view's own data at a hovered point of the
// open site, probes.js)}, with ctx = {globe, siteView, site, regionId}. The control applies the chosen view, and
// clears it again when the view or the open site changes. A factor view lies over the current look. key().demo names
// what a demo view rests on: the key then carries a "Demo" chip, and References lists it under "Demo parts". Demo and
// simulated views never touch statuses.
import * as THREE from 'three';
import { FACTORS } from '../plain.js';
import { datasetsInRegion } from '../catalog.js';
import { SLOPE_CLASSES, SLOPE_MIX, slopeClass } from '../site.js';
import { LOOKS, LOOK_ORDER } from '../looks.js';
import { showSimulated, simulatedKey } from '../layers.js';
import { setActiveProbe, terrainProbe } from '../probes.js';

export const VIEW_ORDER = ['BT', 'GI', 'SC', 'TC', 'IR'];
const R = 3396190; // the Mars sphere the globe draws (globe.js)
const VIEW_NAMES = Object.fromEntries(FACTORS.map((f) => [f.id, f.name]));

export function createViewRegistry() {
  const views = new Map();
  return {
    register(id, view) {
      if (!VIEW_ORDER.includes(id)) throw new Error('unknown view ' + id + ' (one of ' + VIEW_ORDER.join(', ') + ')');
      views.set(id, view);
    },
    get: (id) => views.get(id) || null,
    has: (id) => views.has(id),
    ids: () => VIEW_ORDER.filter((id) => views.has(id)),
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
const demoChip = () => h('span', 'demo-chip', 'Demo');
const keyOf = (v, ctx) => { try { return v.key(ctx); } catch (e) { return { text: 'This view failed: needs confirmation', source: '', missing: true }; } };

// Every registered view's demo text at the open site, for References' "Demo parts": [{id, name, text}].
export function demoParts(reg = registry, ctx = {}) {
  const out = [];
  if (!ctx.siteView) return out;
  for (const id of reg.ids()) {
    const k = keyOf(reg.get(id), ctx);
    if (k && k.demo) out.push({ id, name: VIEW_NAMES[id], text: k.demo });
  }
  return out;
}

// el: the control's container. onView(id | null) asks for a factor view (null: none); onLook(id) for a look.
// lookKey(look, ctx) is the key line when no factor view is on.
export function createFactorBar(el, { registry: reg = registry, onView = () => {}, onLook = () => {}, lookKey = () => null } = {}) {
  el.classList.add('factor-bar');
  const looks = h('div', 'looks');
  looks.setAttribute('role', 'group');
  looks.setAttribute('aria-label', 'Look');
  const lookButtons = new Map();
  for (const id of LOOK_ORDER) {
    const b = h('button', 'look', LOOKS[id].name);
    b.type = 'button';
    b.dataset.look = id;
    b.addEventListener('click', () => onLook(id));
    looks.append(b);
    lookButtons.set(id, b);
  }
  // The key line: with no factor view on it is the look's long caption, shown at once on hover or focus of the
  // active look (or the small i, which also pins it); with a factor view on it shows in place, as that view's legend.
  const key = h('p', 'view-key');
  key.id = 'view-key';
  key.setAttribute('aria-live', 'polite');
  const info = h('button', 'look-info');
  info.append(h('span', 'i-dot', 'i'));
  info.type = 'button';
  info.setAttribute('aria-label', 'About this look');
  info.setAttribute('aria-controls', 'view-key');
  info.setAttribute('aria-expanded', 'false');
  info.addEventListener('click', () => {
    const pin = !key.classList.contains('pinned');
    key.classList.toggle('pinned', pin);
    info.setAttribute('aria-expanded', String(pin));
  });
  looks.append(info);
  const hide = h('button', 'view-hide secondary', 'Hide factor view');
  hide.type = 'button';
  hide.id = 'view-hide';
  hide.hidden = true;
  hide.addEventListener('click', () => onView(null));
  const panel = h('div', 'view-panel');
  panel.id = 'view-panel';
  const more = h('details', 'view-more'); // a view's own panel (layer and case choices, a chart), collapsed
  more.append(h('summary', '', 'View options'), panel);
  el.replaceChildren(looks, key, hide, more);
  let active = null, keyShown = null, panelNode = null;

  // state: {show, view (the store's: null or a factor id), look, ctx}
  function render({ show, view = null, look = 'diorama', ctx }) {
    const on = !!(show && ctx.siteView);
    el.hidden = !on;
    if (ctx.siteView && ctx.siteView.setLook) ctx.siteView.setLook(look);
    for (const [id, b] of lookButtons) b.setAttribute('aria-pressed', String(id === look));
    // the factor view in force: the chosen one with a site open, if registered; else none
    const id = on && view && reg.has(view) ? view : null;
    if (!active || active.id !== id || active.ctx.siteView !== ctx.siteView) {
      if (active && active.id && reg.has(active.id)) reg.get(active.id).clear(active.ctx);
      if (id) reg.get(id).apply(ctx);
      active = { id, ctx };
    } else active.ctx = ctx;
    setActiveProbe(id && ctx.siteView && ctx.site ? { id, view: reg.get(id), ctx } : null);
    hide.hidden = !id;
    el.classList.toggle('view-on', !!id);
    for (const [lid, b] of lookButtons) {
      if (lid === look) b.setAttribute('aria-describedby', 'view-key'); else b.removeAttribute('aria-describedby');
    }
    const k = on ? (id ? keyOf(reg.get(id), ctx) : lookKey(look, ctx)) : null;
    const kk = JSON.stringify(k);
    if (kk !== keyShown) {
      keyShown = kk;
      key.replaceChildren();
      key.dataset.view = id || '';
      key.classList.toggle('missing', !!(k && k.missing));
      if (k) {
        if (k.demo) key.append(demoChip(), ' ');
        if (k.missing) key.append(h('span', 'st-icon k-unresolved', '?'), ' ');
        key.append(h('span', 'k-text', k.text));
        if (k.source) key.append(' ', h('span', 'k-source', k.source));
        if (k.demo) key.append(' ', h('span', 'k-demo', 'Demo: ' + k.demo + '.'));
      }
    }
    const node = id && reg.get(id).panel ? reg.get(id).panel(ctx) : null;
    if (node !== panelNode) { panelNode = node; panel.replaceChildren(...(node ? [node] : [])); }
    panel.hidden = !node;
    more.hidden = !node;
  }
  return { render, active: () => (active ? active.id : null) };
}

// The datasets the view in force draws, for the References page's "Data on screen".
export function viewDatasets(id, ctx) {
  const v = registry.get(id);
  return v && v.datasets ? v.datasets(ctx) : [];
}

// ---------- the looks' key: the map as it is drawn ----------

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

// The key line with no factor view on: the look's (a site) or the globe's photo (the region view).
export function lookKey({ catalog }) {
  const ctxBox = catalog.byId.get('imagery_ctx'), ctxBounds = ctxBox && ctxBox.coverage && ctxBox.coverage.bounds;
  const TREK = 'From NASA Mars Trek.';
  return (look, { siteView, regionId }) => {
    if (siteView) {
      const range = rampRange(siteView), k = siteView.root.scale.y, hirise = siteView.debug.drape().mode === 'hirise';
      const span = range ? 'dark (' + metres(range.lo) + ') to light (' + metres(range.hi) + ')' : 'dark low to light high';
      if (look === 'survey') {
        return { text: 'Survey sheet: a topographic plan. Hillshade, contours every 2 m (labelled every 10 m), slope classes: buildable ≤ 5° (faint green), marginal 5–15° (amber), too steep > 15° (red-orange, hatched), no data (grey, hatched); 500 m grid. Heights ×' + k + '.',
          source: 'From the 1 m HiRISE elevation model inside the site box and the trip-area grid around it (derived).', missing: false };
      }
      if (look === 'hud') {
        return { text: (hirise ? 'Helmet HUD: the HiRISE photo in true grey, dimmed' : 'Helmet HUD: grey by elevation, ' + span + ' (no HiRISE photo here)')
          + ', cyan contours every 5 m, line-drawn sides. Heights ×' + k + '.', source: hirise ? TREK : 'From the 1 m HiRISE elevation model (derived).', missing: false };
      }
      if (hirise) {
        return { text: 'Photo: HiRISE (tinted) on the 1 m elevation model, heights ×' + k + '; any gaps are coloured by elevation.', source: TREK, missing: false };
      }
      return { text: 'Coloured by elevation, ' + span + ': no HiRISE photo covers this site. Heights ×' + k + '.',
        source: 'From the 1 m HiRISE elevation model (derived).', missing: false };
    }
    const region = catalog.regions.find((r) => r.id === regionId);
    if (region && intersects(ctxBounds, region.bounds)) {
      return { text: 'Photo: CTX and HiRISE (tinted) over the Viking mosaic, graded warmer for display.', source: TREK, missing: false };
    }
    return { text: 'Photo: the Viking mosaic, graded warmer for display; no CTX or HiRISE here.', source: TREK, missing: false };
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
      if (ctx.siteView && ctx.site && ctx.site.grids && ctx.site.grids.slope10) ctx.siteView.setSlopeColouring(true); // the site's own 10 m window slope
      else if (ctx.siteView) showSimulated(ctx, 'BT'); // no slope grid here: a simulated field, labelled so
      else if (ctx.regionId) showPatch(ctx.globe, ctx.regionId, true);
    },
    clear(ctx) {
      if (ctx.siteView) { ctx.siteView.setSlopeColouring(false); ctx.siteView.setOverlay(null); }
      if (ctx.regionId) showPatch(ctx.globe, ctx.regionId, false);
    },
    key(ctx) {
      if (ctx.siteView) {
        const g = ctx.site && ctx.site.grids && ctx.site.grids.slope10, entry = g && catalog.byId.get(g.datasetId);
        return entry ? slopeKey(entry) : simulatedKey('slope');
      }
      const entry = ctx.regionId && studyOf(ctx.regionId);
      if (!entry) return MISSING_SLOPE;
      const p = patches.get(ctx.regionId);
      if (p && p.state === 'failed') return { text: 'The slope data failed to load here: needs confirmation', source: '', missing: true };
      return slopeKey(entry);
    },
    probe: terrainProbe(catalog),
    datasets(ctx) {
      if (ctx.siteView) { const g = ctx.site && ctx.site.grids && ctx.site.grids.slope10; return g ? [g.datasetId] : []; }
      const entry = ctx.regionId && studyOf(ctx.regionId);
      return entry ? [entry.id] : [];
    },
  };
}
