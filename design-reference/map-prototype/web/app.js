// PROTOTYPE - throwaway. 3D terrain-diorama viewer: real Trek 1 m elevation + HiRISE photo for two Gale sites.
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/three/CSS2DRenderer.js';

// ---------------------------------------------------------------- variant + theme
const VARIANTS = ['diorama', 'hud', 'survey'];
const qv = new URLSearchParams(location.search).get('v');
const VARIANT = VARIANTS.includes(qv) ? qv : 'diorama';
const root = document.getElementById('root');
root.dataset.v = VARIANT;
document.querySelectorAll('#variants a').forEach(a => {
  if (a.getAttribute('href') === `?v=${VARIANT}`) a.setAttribute('aria-current', 'page');
});

const THEMES = {
  diorama: {
    layer: 'photo_tint', exag: 2, contours: false, contourInterval: 5, contourColor: 0x3a1d10, contourOpacity: 0.35,
    wallTop: 0x93583a, wallBottom: 0x3b2015, wallMode: 'solid', ground: 'shadow', shadowOpacity: 0.2,
    hemiSky: 0xfff4e8, hemiGround: 0x7a4a33, hemi: 1.25, sun: 2.3, sunColor: 0xfff0dc, exposure: 1.0, photoDim: 1,
    fpOk: 0xffffff, fpWarn: 0xfab219, fpBad: 0xd03b3b, fpOpacity: 0.3, stem: 0xffffff, ink: 0x241c17, camera: 'oblique',
  },
  hud: {
    layer: 'photo_grey', exag: 2.5, contours: true, contourInterval: 5, contourColor: 0x6fe3ff, contourOpacity: 0.55,
    wallTop: 0x6fe3ff, wallBottom: 0x6fe3ff, wallMode: 'lines', ground: 'grid',
    hemiSky: 0xa9dcff, hemiGround: 0x0a1422, hemi: 0.9, sun: 1.7, sunColor: 0xe6f6ff, exposure: 0.95, photoDim: 0.72,
    fpOk: 0x6fe3ff, fpWarn: 0xfab219, fpBad: 0xff6b5e, fpOpacity: 0.16, stem: 0x6fe3ff, ink: 0x6fe3ff, camera: 'oblique',
  },
  survey: {
    layer: 'slope', exag: 2, contours: true, contourInterval: 10, contourColor: 0x1d2226, contourOpacity: 0.3,
    wallTop: 0xdedbd2, wallBottom: 0xc6c3b9, wallMode: 'solid', ground: 'none',
    hemiSky: 0xffffff, hemiGround: 0xbdbdb4, hemi: 1.5, sun: 1.3, sunColor: 0xffffff, exposure: 1.0, photoDim: 1,
    fpOk: 0x0ca30c, fpWarn: 0xfab219, fpBad: 0xd03b3b, fpOpacity: 0.22, stem: 0x1d2226, ink: 0x1d2226, camera: 'steep',
  },
};
const T = THEMES[VARIANT];
const BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const WALL = 70; // display-only block thickness below each site's lowest point (scene metres)
const GAP = 520;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  layer: T.layer, exag: T.exag, callouts: true, footprints: true, contours: T.contours, walls: true, high: false,
};

// ---------------------------------------------------------------- renderer, scene, camera
const glEl = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = T.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
glEl.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
labelRenderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 5, 80000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomToCursor = true;
controls.screenSpacePanning = false;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
controls.minDistance = 30;
controls.maxDistance = 16000;

scene.add(new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemi));
const sun = new THREE.DirectionalLight(T.sunColor, T.sun);
sun.position.set(-1700, 4300, -1300); // from the north-west, high enough to keep ground shadows short
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -3300, right: 3300, top: 2600, bottom: -2600, near: 100, far: 10000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.5;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);

if (T.ground === 'shadow') {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: T.shadowOpacity }));
  g.position.y = -WALL - 0.5;
  g.receiveShadow = true;
  scene.add(g);
} else if (T.ground === 'grid') {
  const grid = new THREE.GridHelper(20000, 100, 0x2f6f8a, 0x1a3a4c);
  grid.position.y = -WALL - 0.5;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);
}

// Contour uniforms shared by every terrain material.
const CU = {
  uContour: { value: state.contours ? 1 : 0 },
  uInterval: { value: T.contourInterval },
  uContourColor: { value: new THREE.Color(T.contourColor) },
  uContourOpacity: { value: T.contourOpacity },
};

// ---------------------------------------------------------------- data
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); }
async function getF32(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return new Float32Array(await r.arrayBuffer()); }
const texLoader = new THREE.TextureLoader();
function getTex(u) {
  return new Promise((res, rej) => texLoader.load(u, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    res(t);
  }, undefined, () => rej(new Error(`${u}: failed to load`))));
}

async function loadSite(id) {
  const b = `data/${id}/`;
  const meta = await getJSON(b + 'meta.json');
  const [elev, slope, rough] = await Promise.all(['elev_2m', 'slope_2m', 'rough_2m'].map(f => getF32(`${b}${f}.f32`)));
  const names = ['photo_tint', 'photo_grey', 'slope', 'rough', 'hillshade'];
  const texs = await Promise.all(names.map(n => getTex(`${b}${n}.jpg`)));
  const tex = Object.fromEntries(names.map((n, i) => [n, texs[i]]));
  return { id, meta, elev, slope, rough, tex, n: meta.grid.n, group: new THREE.Group(), parts: {} };
}

function sample(site, arr, x, y) {
  const n = site.n, [cx, cy] = site.meta.grid.cell_m;
  const fx = Math.max(0, Math.min(n - 1.001, x / cx - 0.5));
  const fy = Math.max(0, Math.min(n - 1.001, y / cy - 0.5));
  const j = Math.floor(fx), i = Math.floor(fy), tx = fx - j, ty = fy - i;
  const a = arr[i * n + j], b = arr[i * n + j + 1], c = arr[(i + 1) * n + j], d = arr[(i + 1) * n + j + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
const sceneY = (site, elev) => (elev - site.meta.elev.min) * state.exag;
const local = (site, x, y) => new THREE.Vector3(x - site.meta.size_m[0] / 2, sceneY(site, sample(site, site.elev, x, y)), y - site.meta.size_m[1] / 2);

// ---------------------------------------------------------------- geometry builders
function terrainGeometry(site, stride) {
  const n = site.n, m = Math.floor((n - 1) / stride) + 1;
  const [cx, cy] = site.meta.grid.cell_m, [W, H] = site.meta.size_m;
  const pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2), el = new Float32Array(m * m);
  for (let a = 0; a < m; a++) {
    const i = a * stride;
    for (let b = 0; b < m; b++) {
      const j = b * stride, k = a * m + b, e = site.elev[i * n + j];
      pos[3 * k] = (j + 0.5) * cx - W / 2;
      pos[3 * k + 1] = sceneY(site, e);
      pos[3 * k + 2] = (i + 0.5) * cy - H / 2;
      uv[2 * k] = (j + 0.5) / n;
      uv[2 * k + 1] = 1 - (i + 0.5) / n;
      el[k] = e;
    }
  }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let p = 0;
  for (let a = 0; a < m - 1; a++) for (let b = 0; b < m - 1; b++) {
    const k = a * m + b;
    idx[p++] = k; idx[p++] = k + m; idx[p++] = k + 1;
    idx[p++] = k + 1; idx[p++] = k + m; idx[p++] = k + m + 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aElev', new THREE.BufferAttribute(el, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.userData.m = m;
  return g;
}

function terrainMaterial(site) {
  const mat = new THREE.MeshStandardMaterial({ map: site.tex[state.layer], roughness: 0.97, metalness: 0 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aElev;\nvarying float vElev;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = aElev;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vElev;
uniform float uContour; uniform float uInterval; uniform vec3 uContourColor; uniform float uContourOpacity;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uContour > 0.5) {
  float t = vElev / uInterval; float w = fwidth(t);
  float line = 1.0 - clamp(abs(fract(t - 0.5) - 0.5) / max(w, 1e-4) - 0.3, 0.0, 1.0);
  float tm = t / 5.0; float wm = fwidth(tm);
  float major = 1.0 - clamp(abs(fract(tm - 0.5) - 0.5) / max(wm, 1e-4) - 0.8, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.2, 0.55, w);
  diffuseColor.rgb = mix(diffuseColor.rgb, uContourColor, max(line * 0.55 * fade, major) * uContourOpacity);
}`);
  };
  applyLayerColor(mat);
  return mat;
}
function applyLayerColor(mat) {
  mat.color.setScalar(state.layer.startsWith('photo') ? T.photoDim : 1);
}

function edgeLoops(geo) {
  const m = geo.userData.m, P = geo.attributes.position.array;
  const pt = k => new THREE.Vector3(P[3 * k], P[3 * k + 1], P[3 * k + 2]);
  const N = [], E = [], S = [], Wl = [];
  for (let b = 0; b < m; b++) N.push(pt(b));
  for (let a = 0; a < m; a++) E.push(pt(a * m + m - 1));
  for (let b = m - 1; b >= 0; b--) S.push(pt((m - 1) * m + b));
  for (let a = m - 1; a >= 0; a--) Wl.push(pt(a * m));
  return [[N, [0, 0, -1]], [E, [1, 0, 0]], [S, [0, 0, 1]], [Wl, [-1, 0, 0]]];
}

function wallObject(geo) {
  const loops = edgeLoops(geo);
  const top = new THREE.Color(T.wallTop), bot = new THREE.Color(T.wallBottom);
  const pos = [], nor = [], col = [];
  const push = (v, n, c) => { pos.push(v.x, v.y, v.z); nor.push(...n); col.push(c.r, c.g, c.b); };
  for (const [pts, n] of loops) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const pb = new THREE.Vector3(p.x, -WALL, p.z), qb = new THREE.Vector3(q.x, -WALL, q.z);
      push(p, n, top); push(pb, n, bot); push(q, n, top);
      push(q, n, top); push(pb, n, bot); push(qb, n, bot);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const grp = new THREE.Group();
  if (T.wallMode === 'lines') {
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: T.wallTop, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
    grp.add(mesh);
    const lp = [];
    for (const [pts] of loops) {
      for (let i = 0; i < pts.length - 1; i++) lp.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      for (let i = 0; i < pts.length; i += Math.max(1, Math.round(pts.length / 20))) lp.push(pts[i].x, pts[i].y, pts[i].z, pts[i].x, -WALL, pts[i].z);
      const a = pts[0], b = pts[pts.length - 1];
      lp.push(a.x, -WALL, a.z, b.x, -WALL, b.z);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    grp.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: T.wallTop, transparent: true, opacity: 0.7 })));
  } else {
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    grp.add(mesh);
  }
  return grp;
}

function lineMat(color, opacity = 1) { return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }); }

function footprintObject(site, f) {
  const [W, H] = site.meta.size_m;
  const w = f.x1 - f.x0, d = f.y1 - f.y0;
  const cx = (f.x0 + f.x1) / 2 - W / 2, cz = (f.y0 + f.y1) / 2 - H / 2;
  const y = sceneY(site, f.pad_elev);
  const color = { ok: T.fpOk, warn: T.fpWarn, bad: T.fpBad }[fpStatus(f)];
  const grp = new THREE.Group();
  if (f.id === 'dc') {
    const h = f.height_m * state.exag;
    const box = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: T.fpOpacity + 0.12, roughness: 0.35, depthWrite: false }));
    mesh.position.set(cx, y + h / 2, cz);
    mesh.castShadow = T.ground === 'shadow';
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), lineMat(color, 0.95));
    edges.position.copy(mesh.position);
    grp.add(mesh, edges);
  } else {
    const yy = y + 1.5 * state.exag;
    const plane = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: T.fpOpacity, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(cx, yy, cz);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(plane), lineMat(color, 0.95));
    outline.position.copy(mesh.position);
    grp.add(mesh, outline);
    const lp = [];
    if (f.id === 'solar') {
      for (let x = -w / 2 + 25; x < w / 2; x += 25) lp.push(x, 0, -d / 2, x, 0, d / 2);
      for (let z = -d / 2 + 50; z < d / 2; z += 50) lp.push(-w / 2, 0, z, w / 2, 0, z);
    } else {
      for (let i = 0; i < 3; i++) {
        const ox = -w / 2 + (i + 0.5) * (w / 3);
        for (let s = 0; s < 32; s++) {
          const a0 = s / 32 * Math.PI * 2, a1 = (s + 1) / 32 * Math.PI * 2, r = Math.min(w / 8, d / 3);
          lp.push(ox + r * Math.cos(a0), 0, r * Math.sin(a0), ox + r * Math.cos(a1), 0, r * Math.sin(a1));
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, lineMat(color, 0.7));
    lines.position.set(cx, yy + 0.5, cz);
    grp.add(lines);
  }
  return grp;
}

function evChip(kind) { return `<span class="ev ev-${kind}">${kind === 'display' ? 'display only' : kind}</span>`; }

const allCallouts = new Set();
// Map-style label collision: when two callouts overlap on screen, hide the lower-priority one (and its leader).
function declutter() {
  const placed = ['title', 'controls', 'bottom', 'variants'].map(id => document.getElementById(id)?.getBoundingClientRect()).filter(Boolean);
  const items = [...allCallouts].filter(g => g.parent?.visible).sort((a, b) => a.userData.priority - b.userData.priority);
  for (const g of items) {
    const el = g.userData.label;
    if (el.style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    const hit = placed.some(q => r.left < q.right + 6 && r.right > q.left - 6 && r.top < q.bottom + 4 && r.bottom > q.top - 4);
    el.classList.toggle('culled', hit);
    g.children.forEach(c => { if (!c.isCSS2DObject) c.visible = !hit; });
    if (!hit) placed.push(r);
  }
}
function callout(at, offset, html, cls = '', priority = 5) {
  const grp = new THREE.Group();
  grp.userData.priority = priority;
  const top = at.clone().add(offset);
  grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([at, top]), lineMat(T.stem, 0.9)));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: T.stem }));
  dot.position.copy(at);
  grp.add(dot);
  const el = document.createElement('div');
  el.className = `callout ${cls}`;
  el.innerHTML = `<div class="box">${html}</div>`;
  const lab = new CSS2DObject(el);
  lab.position.copy(top);
  lab.center.set(0.5, 1);
  grp.add(lab);
  grp.userData.label = el;
  allCallouts.add(grp);
  grp.addEventListener('removed', () => allCallouts.delete(grp));
  return grp;
}
// Push each label outward from the block centre so labels fan out instead of stacking.
function outward(at, fallback, spread, lift) {
  const d = new THREE.Vector2(at.x, at.z);
  if (d.length() < 200) d.set(...fallback);
  d.normalize().multiplyScalar(spread);
  return new THREE.Vector3(d.x, lift, d.y);
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const pct = v => `${Math.round(v * 100)}%`;
// Placeholder fit rule (assumption): share of the footprint steeper than the slope limit.
const fpStatus = f => f.steep_frac <= 0.05 ? 'ok' : f.steep_frac <= 0.25 ? 'warn' : 'bad';
const STATUS_WORD = { ok: 'fits', warn: 'needs grading', bad: 'too steep' };

function buildSite(site, offsetX) {
  const g = site.group;
  for (const c of [...g.children]) { g.remove(c); c.traverse(o => { if (o.isCSS2DObject) o.element.remove(); o.geometry?.dispose(); if (o.material && !o.material.isTerrain) o.material.dispose?.(); }); }
  g.position.x = offsetX;
  const meta = site.meta, [W, H] = meta.size_m;

  const geo = terrainGeometry(site, state.high ? 1 : 2);
  site.material ??= Object.assign(terrainMaterial(site), { isTerrain: true });
  const terrain = new THREE.Mesh(geo, site.material);
  terrain.castShadow = terrain.receiveShadow = true;
  g.add(terrain);

  const pick = new THREE.Mesh(terrainGeometry(site, 8), new THREE.MeshBasicMaterial({ visible: false }));
  pick.userData.site = site;
  g.add(pick);
  site.parts.pick = pick;

  const walls = wallObject(geo);
  walls.visible = state.walls;
  g.add(walls);
  site.parts.walls = walls;

  // footprints + transect
  const fp = new THREE.Group();
  for (const f of meta.footprints) fp.add(footprintObject(site, f));
  const tr = meta.transect, tpts = tr.x.map(x => local(site, x, tr.y).add(new THREE.Vector3(0, 1.5, 0)));
  fp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tpts), lineMat(T.ink, 0.75)));
  fp.visible = state.footprints;
  g.add(fp);
  site.parts.footprints = fp;

  // callouts: one combined layout callout plus the derived features and the base
  const co = new THREE.Group();
  const lim = meta.assumptions.slope_limit_deg;
  const rank = { ok: 0, warn: 1, bad: 2 };
  const worst = meta.footprints.map(fpStatus).reduce((a, b) => rank[b] > rank[a] ? b : a, 'ok');
  const dc = meta.footprints.find(f => f.id === 'dc');
  const dcAt = local(site, (dc.x0 + dc.x1) / 2, (dc.y0 + dc.y1) / 2);
  dcAt.y = sceneY(site, dc.pad_elev) + dc.height_m * state.exag;
  const rows = meta.footprints.map(f => `<div class="v">${f.label}: ${pct(f.steep_frac)} over ${lim}°</div>`).join('');
  co.add(callout(dcAt, outward(dcAt, [-0.8, 0.6], 420, 160),
    `<div class="t">Facility layout: ${STATUS_WORD[worst]}${evChip('assumption')}</div>${rows}`, worst, 1));
  const fall = { flat: [0.7, 0.7], steep: [0.8, -0.6], rough: [-0.6, 0.8] };
  const lifts = { flat: 120, steep: 260, rough: 90 };
  for (const ft of meta.features) {
    const at = local(site, ft.x, ft.y);
    const html = `<div class="t">${ft.title}${evChip(ft.evidence)}</div><div class="v">${ft.value}</div>`;
    co.add(callout(at, outward(at, fall[ft.kind] ?? [1, 0], 300, lifts[ft.kind] ?? 150), html, '', { flat: 3, steep: 4, rough: 5 }[ft.kind] ?? 6));
  }
  const base = meta.base;
  if (base.inside) {
    const at = local(site, base.x, base.y);
    co.add(callout(at, new THREE.Vector3(160, 300, -260), `<div class="t">Assumed base${evChip('assumption')}</div><div class="v">Bradbury Landing</div>`, '', 2));
  } else {
    const dx = base.x - W / 2, dy = base.y - H / 2, s = Math.min((W / 2 - 40) / Math.abs(dx || 1e-9), (H / 2 - 40) / Math.abs(dy || 1e-9));
    const dir = COMPASS[Math.round(base.bearing_deg / 45) % 8];
    const at = local(site, W / 2 + dx * s, H / 2 + dy * s);
    co.add(callout(at, outward(at, [0, -1], 160, 120),
      `<div class="t">To the assumed base${evChip('assumption')}</div><div class="v">${base.dist_km.toFixed(0)} km ${dir}</div>`, '', 2));
  }
  co.visible = state.callouts;
  g.add(co);
  site.parts.callouts = co;

  // site header, scale bar, north arrow (always on)
  const st = meta.stats;
  const head = document.createElement('div');
  head.className = 'sitehead';
  head.innerHTML = `<div class="name">Site ${site.id}: ${meta.name}</div><div class="sub">${meta.subtitle}</div>
    <div class="stats">${st.relief_m.toFixed(0)} m relief, median slope ${st.median_slope.toFixed(1)}°, ${pct(st.flat_frac)} of ground under ${lim}°</div>`;
  const ho = new CSS2DObject(head);
  ho.position.set(0, -WALL, H / 2 + 120);
  ho.center.set(0.5, 0);
  g.add(ho);

  const z0 = H / 2 + 60, x0 = -W / 2;
  const sb = [x0, -WALL, z0, x0 + 500, -WALL, z0, x0, -WALL, z0 - 12, x0, -WALL, z0 + 12, x0 + 500, -WALL, z0 - 12, x0 + 500, -WALL, z0 + 12];
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sb, 3));
  g.add(new THREE.LineSegments(sg, lineMat(T.ink, 0.8)));
  const sl = document.createElement('div');
  sl.className = 'scalelabel';
  sl.textContent = '500 m';
  const so = new CSS2DObject(sl);
  so.position.set(x0 + 250, -WALL, z0 + 16);
  so.center.set(0.5, 0);
  g.add(so);
  if (site.id === 'A') {
    const na = [-W / 2 - 90, -WALL, -H / 2 + 120, -W / 2 - 90, -WALL, -H / 2 - 20,
      -W / 2 - 90, -WALL, -H / 2 - 20, -W / 2 - 110, -WALL, -H / 2 + 20, -W / 2 - 90, -WALL, -H / 2 - 20, -W / 2 - 70, -WALL, -H / 2 + 20];
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(na, 3));
    g.add(new THREE.LineSegments(ng, lineMat(T.ink, 0.9)));
    const nl = document.createElement('div');
    nl.className = 'scalelabel';
    nl.textContent = 'N';
    const no = new CSS2DObject(nl);
    no.position.set(-W / 2 - 90, -WALL, -H / 2 - 30);
    no.center.set(0.5, 1);
    g.add(no);
  }

  // profile marker (moved by the profile chart hover)
  const mk = new THREE.Group();
  mk.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 90, 0)]), lineMat(T.ink, 0.9)));
  const mdot = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 10), new THREE.MeshBasicMaterial({ color: T.ink }));
  mk.add(mdot);
  mk.visible = false;
  g.add(mk);
  site.parts.marker = mk;
}

// ---------------------------------------------------------------- interaction
const sites = [];
let offsets = {};
function rebuildAll() {
  for (const s of sites) buildSite(s, offsets[s.id]);
  setupViews();
}
let rebuildTimer;
function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildAll, 90); }

const VIEWS = {};
function setupViews() {
  const steep = T.camera === 'steep';
  const both = steep ? [0, 7600, 4300] : [0, 3300, 5900];
  VIEWS.both = { target: [0, 0, 0], pos: both };
  for (const s of sites) {
    const x = offsets[s.id];
    const ty = sceneY(s, s.meta.elev.mean);
    VIEWS[s.id] = { target: [x, ty, -100], pos: steep ? [x, ty + 3000, 1500] : [x + 500, ty + 1700, 2300] };
  }
  VIEWS.top = { target: [0, 0, 0], pos: [0, 8200, 1] };
}
let flight = null;
function flyTo(target, pos, ms = 1000) {
  const t = new THREE.Vector3(...target), p = new THREE.Vector3(...pos);
  if (reduceMotion) { controls.target.copy(t); camera.position.copy(p); return; }
  flight = { t0: performance.now(), ms, fromT: controls.target.clone(), fromP: camera.position.clone(), t, p };
}
function stepFlight(now) {
  if (!flight) return;
  const k = Math.min(1, (now - flight.t0) / flight.ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  controls.target.lerpVectors(flight.fromT, flight.t, e);
  camera.position.lerpVectors(flight.fromP, flight.p, e);
  if (k >= 1) flight = null;
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(sites.map(s => s.parts.pick), false)[0];
  if (!hit) return null;
  const site = hit.object.userData.site, [W, H] = site.meta.size_m;
  const x = hit.point.x - offsets[site.id] + W / 2, y = hit.point.z + H / 2;
  return { site, x, y, point: hit.point };
}

const cursor = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: T.ink, transparent: true, opacity: 0.85, depthTest: false }));
cursor.renderOrder = 10;
cursor.visible = false;
scene.add(cursor);

const readout = document.getElementById('readout'), hint = document.getElementById('hint');
let pendingMove = null;
const lastPointer = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointermove', ev => { pendingMove = ev; lastPointer.x = ev.clientX; lastPointer.y = ev.clientY; });
renderer.domElement.addEventListener('pointerdown', () => { hint.style.display = 'none'; }, { once: true });
renderer.domElement.addEventListener('pointerleave', () => { pendingMove = null; readout.style.display = 'none'; cursor.visible = false; });
renderer.domElement.addEventListener('dblclick', ev => {
  const h = pickAt(ev);
  if (!h) return;
  const dir = camera.position.clone().sub(controls.target).normalize();
  const dist = Math.min(camera.position.distanceTo(controls.target), 700);
  flyTo(h.point.toArray(), h.point.clone().add(dir.multiplyScalar(dist)).toArray(), 900);
});
function handleMove() {
  if (!pendingMove) return;
  const h = pickAt(pendingMove);
  pendingMove = null;
  if (!h) { readout.style.display = 'none'; cursor.visible = false; return; }
  const { site, x, y } = h, bb = site.meta.bbox, [W, H] = site.meta.size_m;
  const lon = bb.west + (x / W) * (bb.east - bb.west), lat = bb.north - (y / H) * (bb.north - bb.south);
  const e = sample(site, site.elev, x, y), s = sample(site, site.slope, x, y), r = sample(site, site.rough, x, y);
  readout.innerHTML = `<b>Site ${site.id}: ${site.meta.name}</b><dl>
    <dt>Position</dt><dd>${Math.abs(lat).toFixed(4)}° S, ${lon.toFixed(4)}° E</dd>
    <dt>Elevation</dt><dd>${e.toFixed(1)} m</dd>
    <dt>Slope (5 m)</dt><dd>${s.toFixed(1)}°</dd>
    <dt>Roughness</dt><dd>${r.toFixed(2)} m RMS</dd></dl>`;
  readout.style.display = 'block';
  const rw = readout.offsetWidth, rh = readout.offsetHeight;
  const px = lastPointer.x + 18 + rw > innerWidth ? lastPointer.x - rw - 18 : lastPointer.x + 18;
  const py = Math.min(innerHeight - rh - 8, lastPointer.y + 18);
  readout.style.transform = `translate(${px}px, ${py}px)`;
  cursor.position.copy(h.point).add(new THREE.Vector3(0, 0.5, 0));
  cursor.scale.setScalar(camera.position.distanceTo(h.point) * 0.012);
  cursor.visible = true;
}

// ---------------------------------------------------------------- panels
function setPressed(container, attr, value) {
  container.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
}
function renderLegend() {
  const el = document.getElementById('legend');
  if (state.layer !== 'slope' && state.layer !== 'rough') { el.hidden = true; return; }
  const sc = sites[0].meta.scales, lim = sites[0].meta.assumptions.slope_limit_deg;
  const max = state.layer === 'slope' ? sc.slope_max : sc.rough_max;
  const ticks = state.layer === 'slope' ? [0, 10, 20, 30] : [0, max / 2, max];
  const fmt = v => state.layer === 'slope' ? `${v}°` : `${v.toFixed(2)} m`;
  el.innerHTML = `<div class="bar" style="background:linear-gradient(90deg,${BLUE.join(',')})"></div>
    <div class="ticks">${ticks.map(t => `<span style="left:${t / max * 100}%">${fmt(t)}${t === max ? '+' : ''}</span>`).join('')}
    ${state.layer === 'slope' ? `<i class="limit" style="left:${lim / max * 100}%" title="assumed limit"></i>` : ''}</div>
    <div class="cap">${state.layer === 'slope'
      ? `Steepness over 5 m. The black tick is the assumed ${lim}° build limit. Same scale for both sites.`
      : 'Bumps left after removing the tilt in each 5 m window. Same scale for both sites.'}</div>`;
  el.hidden = false;
}
function setLayer(layer) {
  state.layer = layer;
  for (const s of sites) { s.material.map = s.tex[layer]; applyLayerColor(s.material); }
  setPressed(document.getElementById('layers'), 'layer', layer);
  renderLegend();
}

function renderCompare() {
  const wrap = document.getElementById('compareWrap');
  if (VARIANT !== 'survey') { wrap.hidden = true; return; }
  const lim = sites[0].meta.assumptions.slope_limit_deg;
  const rows = [
    ['Relief', s => `${s.meta.stats.relief_m.toFixed(0)} m`],
    ['Median slope', s => `${s.meta.stats.median_slope.toFixed(1)}°`],
    [`Under ${lim}°`, s => pct(s.meta.stats.flat_frac)],
    ['Roughness', s => `${s.meta.stats.median_rough.toFixed(2)} m`],
    ['Photo coverage', s => pct(s.meta.photo.coverage)],
  ];
  document.getElementById('compare').innerHTML = `<tr><th></th>${sites.map(s => `<th>Site ${s.id}</th>`).join('')}</tr>` +
    rows.map(([k, f]) => `<tr><td>${k}</td>${sites.map(s => `<td>${f(s)}</td>`).join('')}</tr>`).join('');
}

const SVGNS = 'http://www.w3.org/2000/svg';
function renderProfiles() {
  const spans = sites.map(s => Math.max(...s.meta.transect.elev) - Math.min(...s.meta.transect.elev));
  const span = Math.max(...spans) * 1.1 || 1;
  for (const s of sites) {
    const el = document.getElementById(`prof${s.id}`), tr = s.meta.transect;
    const lo = Math.min(...tr.elev), mean = tr.slope.reduce((a, b) => a + b, 0) / tr.slope.length;
    el.innerHTML = `<h3>Site ${s.id}: west to east through the data center</h3>
      <div class="sub">${(Math.max(...tr.elev) - lo).toFixed(1)} m relief, mean slope ${mean.toFixed(1)}°. Both profiles share one height scale.</div>`;
    const svg = document.createElementNS(SVGNS, 'svg');
    el.appendChild(svg);
    const draw = () => {
      const Wpx = svg.clientWidth || 400, Hpx = 104, padL = 44, padB = 16;
      const xs = v => padL + v / s.meta.size_m[0] * (Wpx - padL), ys = v => (Hpx - padB) - (v - lo) / span * (Hpx - padB - 6);
      const pts = tr.x.map((x, i) => `${xs(x).toFixed(1)},${ys(tr.elev[i]).toFixed(1)}`);
      const ink = getComputedStyle(root).getPropertyValue('--ink-2');
      const bands = s.meta.footprints.filter(f => f.id !== 'solar').map(f =>
        `<rect x="${xs(f.x0)}" y="0" width="${xs(f.x1) - xs(f.x0)}" height="${Hpx - padB}" fill="currentColor" opacity="0.08"/>
         <text x="${(xs(f.x0) + xs(f.x1)) / 2}" y="10" text-anchor="middle" class="tip" opacity="0.7">${f.id === 'dc' ? 'data center' : 'heat'}</text>`).join('');
      const yt = [lo, lo + span / 2, lo + span];
      svg.innerHTML = `${bands}
        ${yt.map(v => `<line x1="${padL}" x2="${Wpx}" y1="${ys(v)}" y2="${ys(v)}" stroke="${ink}" stroke-opacity="0.18"/>
          <text x="${padL - 6}" y="${ys(v) + 4}" text-anchor="end" class="tip" opacity="0.75">${v.toFixed(0)} m</text>`).join('')}
        <path d="M${xs(tr.x[0])},${Hpx - padB} L${pts.join(' L')} L${xs(tr.x[tr.x.length - 1])},${Hpx - padB} Z" fill="var(--profile-fill)" opacity="0.85"/>
        <polyline points="${pts.join(' ')}" fill="none" stroke="var(--profile-line)" stroke-width="2" stroke-linejoin="round"/>
        <text x="${padL}" y="${Hpx - 2}" class="tip" opacity="0.75">0 km</text>
        <text x="${Wpx}" y="${Hpx - 2}" text-anchor="end" class="tip" opacity="0.75">${(s.meta.size_m[0] / 1000).toFixed(1)} km</text>
        <g class="hover" visibility="hidden"><line y1="0" y2="${Hpx - padB}" stroke="var(--ink)" stroke-width="1"/>
          <circle r="4" fill="var(--ink)"/><text class="tip" y="22"></text></g>`;
      const hov = svg.querySelector('.hover');
      svg.onpointermove = ev => {
        const r = svg.getBoundingClientRect(), px = ev.clientX - r.left;
        const xm = Math.max(0, Math.min(s.meta.size_m[0], (px - padL) / (Wpx - padL) * s.meta.size_m[0]));
        const i = Math.min(tr.x.length - 1, Math.max(0, Math.round(xm / (tr.x[1] - tr.x[0]) - 0.5)));
        const X = xs(tr.x[i]), Y = ys(tr.elev[i]);
        hov.setAttribute('visibility', 'visible');
        hov.querySelector('line').setAttribute('x1', X); hov.querySelector('line').setAttribute('x2', X);
        hov.querySelector('circle').setAttribute('cx', X); hov.querySelector('circle').setAttribute('cy', Y);
        const t = hov.querySelector('text');
        t.textContent = `${(tr.x[i] / 1000).toFixed(2)} km, ${tr.elev[i].toFixed(1)} m, ${tr.slope[i].toFixed(1)}°`;
        t.setAttribute('x', X + (X > Wpx * 0.7 ? -6 : 6)); t.setAttribute('text-anchor', X > Wpx * 0.7 ? 'end' : 'start');
        const mk = s.parts.marker;
        mk.position.copy(local(s, tr.x[i], tr.y));
        mk.visible = true;
      };
      svg.onpointerleave = () => { hov.setAttribute('visibility', 'hidden'); s.parts.marker.visible = false; };
    };
    requestAnimationFrame(draw);
    s.redrawProfile = draw;
  }
}

function wireControls() {
  document.getElementById('layers').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLayer(b.dataset.layer); });
  const exag = document.getElementById('exag'), out = document.getElementById('exagOut');
  exag.value = state.exag; out.textContent = `${state.exag}×`;
  exag.addEventListener('input', () => { state.exag = +exag.value; out.textContent = `${state.exag}×`; scheduleRebuild(); });
  const tog = (id, key, fn) => {
    const el = document.getElementById(id);
    el.checked = state[key];
    el.addEventListener('change', () => { state[key] = el.checked; fn(); });
  };
  tog('tCallouts', 'callouts', () => sites.forEach(s => { s.parts.callouts.visible = state.callouts; }));
  tog('tFootprints', 'footprints', () => sites.forEach(s => { s.parts.footprints.visible = state.footprints; }));
  tog('tWalls', 'walls', () => sites.forEach(s => { s.parts.walls.visible = state.walls; }));
  tog('tContours', 'contours', () => { CU.uContour.value = state.contours ? 1 : 0; });
  tog('tHigh', 'high', scheduleRebuild);
  document.getElementById('views').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = VIEWS[b.dataset.view];
    setPressed(document.getElementById('views'), 'view', b.dataset.view);
    flyTo(v.target, v.pos);
  });
}

function frameCamera() {
  camera.aspect = innerWidth / innerHeight;
  camera.setViewOffset(innerWidth, innerHeight, innerWidth > 900 ? 120 : 0, innerWidth > 900 ? -10 : 0, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
}
frameCamera();
addEventListener('resize', () => {
  frameCamera();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  sites.forEach(s => s.redrawProfile?.());
});

let lastDeclutter = 0;
function loop(now) {
  stepFlight(now);
  controls.update();
  handleMove();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  if (now - lastDeclutter > 120) { declutter(); lastDeclutter = now; }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- start
(async () => {
  try {
    const idx = await getJSON('data/sites.json');
    sites.push(...await Promise.all(idx.sites.map(loadSite)));
    const W0 = sites[0].meta.size_m[0];
    offsets = Object.fromEntries(sites.map((s, i) => [s.id, (i - (sites.length - 1) / 2) * (W0 + GAP)]));
    for (const s of sites) scene.add(s.group);
    rebuildAll();
    setupViews();
    camera.position.set(...VIEWS.both.pos);
    controls.target.set(...VIEWS.both.target);
    wireControls();
    setLayer(state.layer);
    setPressed(document.getElementById('views'), 'view', 'both');
    renderCompare();
    renderProfiles();
    document.getElementById('loading').remove();
    window.__proto = { sites, state, camera, controls, renderer };
    requestAnimationFrame(loop);
  } catch (err) {
    document.getElementById('loading').textContent = `Could not load the site data: ${err.message}. Run prepare.py first, then reload.`;
    throw err;
  }
})();
