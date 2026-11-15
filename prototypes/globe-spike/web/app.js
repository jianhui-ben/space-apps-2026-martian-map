// SPIKE - throwaway. One continuous three.js scene: Mars globe (Trek tiles) down to a Gale site
// mesh (1 m DEM) with a draggable 60 x 60 m footprint.
import * as THREE from 'three';
import { TilesRenderer, GlobeControls } from '3d-tiles-renderer/three';
import { GeneratedSurfacePlugin, ImageOverlayPlugin, XYZTilesOverlay } from '3d-tiles-renderer/three/plugins';

const R = 3396190;
const DEG = Math.PI / 180;
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/';
const TAIL = '/1.0.0/default/default028mm/{z}/{y}/{x}';
const SITE_ID = 'near_base_north';
const LIFT = 1.0; // metres above the smooth sphere for the lowest site point

const stats = { layers: {}, frames: 0, fps: 0, siteReady: false, readout: '', drags: 0, errors: [] };
window.spike = stats;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 4e7);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));

// ---------- globe ----------
const tiles = new TilesRenderer();
tiles.ellipsoid.radius.set(R, R, R);

function counted(name, overlay) {
  const L = (stats.layers[name] = { ok: 0, bad: 0, ms: 0, maxZ: -1 });
  const fetch0 = overlay.fetch.bind(overlay);
  overlay.fetch = async (url, opts) => {
    const t0 = performance.now();
    const z = +String(url).split('/').slice(-3)[0];
    if (z > L.maxZ) L.maxZ = z;
    const res = await fetch0(url, opts);
    L.ms += performance.now() - t0;
    if (res.ok) L.ok++; else L.bad++;
    return res;
  };
  return overlay;
}
function bounded(overlay, [w, s, e, n]) {
  const src = overlay.imageSource;
  const init0 = src.init.bind(src);
  src.init = async () => { await init0(); src.tiling.setContentBounds(w * DEG, s * DEG, e * DEG, n * DEG); };
  return overlay;
}
const xyz = (layer, ext, levels) => new XYZTilesOverlay({ url: TREK + layer + TAIL + ext, levels, projection: 'EPSG:4326' });

tiles.registerPlugin(new GeneratedSurfacePlugin({ overlay: xyz('Mars_Viking_MDIM21_ClrMosaic_global_232m', '.jpg', 18) }));
tiles.registerPlugin(new ImageOverlayPlugin({
  overlays: [
    counted('viking', xyz('Mars_Viking_MDIM21_ClrMosaic_global_232m', '.jpg', 8)),
    counted('ctx', bounded(xyz('Gale_CTX_BlockAdj_dd', '.png', 13), [135.1842593, -6.5732988, 139.2413012, -2.8077809])),
    counted('hirise', bounded(xyz('curiosity_hirise_mosaic', '.png', 17), [137.1224669, -4.9254743, 137.7298129, -4.2489588])),
  ],
}));
scene.add(tiles.group);
tiles.setCamera(camera);
tiles.setResolutionFromRenderer(camera, renderer);

const controls = new GlobeControls(scene, camera, renderer.domElement);
controls.setEllipsoid(tiles.ellipsoid, tiles.group);
controls.enableDamping = true;

const _e = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3();
function setView(latDeg, lonDeg, alt) {
  tiles.ellipsoid.getCartographicToPosition(latDeg * DEG, lonDeg * DEG, alt, camera.position);
  tiles.ellipsoid.getEastNorthUpAxes(latDeg * DEG, lonDeg * DEG, _e, _n, _u);
  camera.up.copy(_n);
  camera.lookAt(tiles.ellipsoid.getCartographicToPosition(latDeg * DEG, lonDeg * DEG, 0, new THREE.Vector3()));
  camera.updateMatrixWorld();
}
setView(-4.6, 137.44, 9.0e6);

// ---------- site ----------
const site = { group: new THREE.Group() };
stats.siteObj = site;
scene.add(site.group);

async function loadSite() {
  const cat = await (await fetch('/data/catalog.json')).json();
  const ds = (id) => cat.datasets.find((d) => d.id === id);
  const f32 = (id) => ds(id).files.find((f) => f.format === 'f32');
  const ef = f32(`elevation_1m_${SITE_ID}`), sf = f32(`slope_10m_window_${SITE_ID}`);
  const [eb, sb] = await Promise.all([ef, sf].map((f) => fetch('/data/' + f.path).then((r) => r.arrayBuffer())));
  const g = ef.grid;
  Object.assign(site, {
    W: g.width, H: g.height, b: g.bounds, dx: g.pixel_deg[0], dy: g.pixel_deg[1],
    elev: new Float32Array(eb), slope: new Float32Array(sb), base: cat.areas.base,
  });
  let hMin = Infinity, nan = 0;
  for (const v of site.elev) { if (Number.isNaN(v)) nan++; else if (v < hMin) hMin = v; }
  site.hMin = hMin; site.nan = nan;
  site.lat0 = (g.bounds[1] + g.bounds[3]) / 2; site.lon0 = (g.bounds[0] + g.bounds[2]) / 2;

  // east-north-up frame at the site centre (sphere height 0)
  const enu = new THREE.Matrix4();
  tiles.ellipsoid.getEastNorthUpFrame(site.lat0 * DEG, site.lon0 * DEG, 0, enu);
  site.group.matrixAutoUpdate = false;
  site.group.matrix.copy(enu);
  site.group.updateMatrixWorld(true);
  site.inv = enu.clone().invert();

  // terrain mesh, decimated to 4 m
  const S = 4, nx = Math.floor((site.W - 1) / S) + 1, ny = Math.floor((site.H - 1) / S) + 1;
  const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
  const hr = hiriseFrame();
  const v = new THREE.Vector3();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const col = i * S, row = j * S;
      const lon = site.b[0] + (col + 0.5) * site.dx, lat = site.b[3] - (row + 0.5) * site.dy;
      let h = site.elev[row * site.W + col];
      if (Number.isNaN(h)) h = hMin;
      toLocal(lat, lon, h - hMin + LIFT, v);
      const k = j * nx + i;
      pos.set([v.x, v.y, v.z], k * 3);
      uv[k * 2] = (lon - hr.w) / hr.spanX;
      uv[k * 2 + 1] = 1 - (hr.n - lat) / hr.spanY;
    }
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.set([a, c, b, b, c, d], p); p += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xd8b48e, map: hr.texture });
  site.mesh = new THREE.Mesh(geo, mat);
  site.group.add(site.mesh);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-600, 800, 900);
  site.group.add(sun, sun.target);

  site.fp = { x: -300, y: 200 };
  buildFootprint();
  stats.siteReady = true;
  stats.site = { nx, ny, hMin, nan, verts: nx * ny };
}

function toLocal(lat, lon, h, target) {
  tiles.ellipsoid.getCartographicToPosition(lat * DEG, lon * DEG, h, target);
  return target.applyMatrix4(site.inv);
}
function localToLonLat(x, y) {
  return { lon: site.lon0 + x / (R * Math.cos(site.lat0 * DEG)) / DEG, lat: site.lat0 + y / R / DEG };
}
function sampleGrid(arr, lat, lon) {
  const c = (lon - site.b[0]) / site.dx - 0.5, r = (site.b[3] - lat) / site.dy - 0.5;
  const c0 = Math.max(0, Math.min(site.W - 2, Math.floor(c))), r0 = Math.max(0, Math.min(site.H - 2, Math.floor(r)));
  const fc = Math.min(1, Math.max(0, c - c0)), fr = Math.min(1, Math.max(0, r - r0));
  const at = (rr, cc) => { const x = arr[rr * site.W + cc]; return Number.isNaN(x) ? site.hMin : x; };
  return (at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc) * (1 - fr) + (at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc) * fr;
}

// HiRISE z15 tiles over the site, composited into one canvas texture
function hiriseFrame() {
  const z = 15, span = 180 / 2 ** z;
  const x0 = Math.floor((site.b[0] + 180) / span), x1 = Math.floor((site.b[2] + 180) / span);
  const y0 = Math.floor((90 - site.b[3]) / span), y1 = Math.floor((90 - site.b[1]) / span);
  const ntx = x1 - x0 + 1, nty = y1 - y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = ntx * 256; canvas.height = nty * 256;
  const ctx2 = canvas.getContext('2d');
  ctx2.fillStyle = '#b08a68'; ctx2.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  let left = ntx * nty;
  stats.hiriseDrape = { tiles: left, ok: 0, bad: 0 };
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { ctx2.drawImage(img, (tx - x0) * 256, (ty - y0) * 256); stats.hiriseDrape.ok++; if (--left === 0) texture.needsUpdate = true; else if (left % 8 === 0) texture.needsUpdate = true; };
    img.onerror = () => { stats.hiriseDrape.bad++; if (--left === 0) texture.needsUpdate = true; };
    img.src = `${TREK}curiosity_hirise_mosaic/1.0.0/default/default028mm/${z}/${ty}/${tx}.png`;
  }
  return { texture, w: x0 * span - 180, n: 90 - y0 * span, spanX: ntx * span, spanY: nty * span };
}

// ---------- footprint ----------
const FP = 60, FPN = 12;
function buildFootprint() {
  const half = FP / 2, v = new THREE.Vector3();
  const pos = new Float32Array((FPN + 1) * (FPN + 1) * 3);
  for (let j = 0; j <= FPN; j++) for (let i = 0; i <= FPN; i++) {
    const x = site.fp.x - half + (i / FPN) * FP, y = site.fp.y - half + (j / FPN) * FP;
    const { lat, lon } = localToLonLat(x, y);
    toLocal(lat, lon, sampleGrid(site.elev, lat, lon) - site.hMin + LIFT + 0.6, v);
    pos.set([v.x, v.y, v.z], (j * (FPN + 1) + i) * 3);
  }
  if (!site.fpMesh) {
    const geo = new THREE.PlaneGeometry(1, 1, FPN, FPN);
    site.fpMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x37c8ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    site.fpMesh.renderOrder = 2;
    site.fpEdge = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9fe6ff }));
    site.fpEdge.renderOrder = 3;
    site.group.add(site.fpMesh, site.fpEdge);
  }
  // PlaneGeometry vertex order is row-major from top-left (y descending); re-map to our row order
  const g = site.fpMesh.geometry.attributes.position;
  for (let j = 0; j <= FPN; j++) for (let i = 0; i <= FPN; i++) {
    const src = (j * (FPN + 1) + i) * 3, dst = ((FPN - j) * (FPN + 1) + i);
    g.setXYZ(dst, pos[src], pos[src + 1], pos[src + 2]);
  }
  g.needsUpdate = true;
  site.fpMesh.geometry.computeBoundingSphere();
  const ring = [];
  for (let i = 0; i < FPN; i++) ring.push(i);
  for (let j = 0; j < FPN; j++) ring.push(j * (FPN + 1) + FPN);
  for (let i = FPN; i > 0; i--) ring.push(FPN * (FPN + 1) + i);
  for (let j = FPN; j > 0; j--) ring.push(j * (FPN + 1));
  const lp = new Float32Array(ring.length * 3);
  ring.forEach((k, n) => lp.set([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2] + 0.3], n * 3));
  site.fpEdge.geometry.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  site.fpEdge.geometry.computeBoundingSphere();
  updateReadout();
}

function updateReadout() {
  const half = FP / 2;
  const a = localToLonLat(site.fp.x - half, site.fp.y - half), b = localToLonLat(site.fp.x + half, site.fp.y + half);
  const c0 = Math.max(0, Math.floor((a.lon - site.b[0]) / site.dx)), c1 = Math.min(site.W - 1, Math.floor((b.lon - site.b[0]) / site.dx));
  const r0 = Math.max(0, Math.floor((site.b[3] - b.lat) / site.dy)), r1 = Math.min(site.H - 1, Math.floor((site.b[3] - a.lat) / site.dy));
  let mx = -Infinity, n = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const s = site.slope[r * site.W + c];
    if (!Number.isNaN(s)) { n++; if (s > mx) mx = s; }
  }
  const ctr = localToLonLat(site.fp.x, site.fp.y);
  stats.readout = n ? `max slope ${mx.toFixed(2)}° (BT-05, 10 m window, ${n} cells)` : 'no data';
  document.getElementById('slope').textContent = stats.readout;
  document.getElementById('pos').textContent = `centre ${ctr.lat.toFixed(5)}°, ${ctr.lon.toFixed(5)}°  (${site.fp.x.toFixed(0)} m E, ${site.fp.y.toFixed(0)} m N of site centre)`;
}

// ---------- drag ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let dragging = false;
function pick(e, obj) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(obj, false)[0];
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!site.fpMesh || !pick(e, site.fpMesh)) return;
  dragging = true; controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
  e.stopImmediatePropagation(); e.preventDefault();
}, { capture: true });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  e.stopImmediatePropagation();
  const hit = pick(e, site.mesh);
  if (!hit) return;
  const p = hit.point.clone().applyMatrix4(site.inv);
  const hx = (site.b[2] - site.b[0]) * DEG * R * Math.cos(site.lat0 * DEG) / 2 - FP / 2;
  const hy = (site.b[3] - site.b[1]) * DEG * R / 2 - FP / 2;
  site.fp.x = Math.max(-hx, Math.min(hx, p.x));
  site.fp.y = Math.max(-hy, Math.min(hy, p.y));
  buildFootprint();
}, { capture: true });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false; controls.enabled = true; stats.drags++;
  e.stopImmediatePropagation();
}, { capture: true });

// ---------- test hooks ----------
stats.setView = setView;
stats.setLocalView = (east, north, up, lookE = 0, lookN = 0) => {
  const eye = new THREE.Vector3(east, north, up).applyMatrix4(site.group.matrixWorld);
  const at = new THREE.Vector3(lookE, lookN, 0).applyMatrix4(site.group.matrixWorld);
  camera.position.copy(eye);
  tiles.ellipsoid.getEastNorthUpAxes(site.lat0 * DEG, site.lon0 * DEG, _e, _n, _u);
  camera.up.copy(_u);
  camera.lookAt(at);
  camera.updateMatrixWorld();
};
stats.footprintScreen = () => {
  const v = new THREE.Vector3(site.fp.x, site.fp.y, sampleGrid(site.elev, ...Object.values(localToLonLat(site.fp.x, site.fp.y)).reverse()) - site.hMin + LIFT)
    .applyMatrix4(site.group.matrixWorld).project(camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
};
stats.localScreen = (east, north) => {
  const { lat, lon } = localToLonLat(east, north);
  const v = new THREE.Vector3(east, north, sampleGrid(site.elev, lat, lon) - site.hMin + LIFT).applyMatrix4(site.group.matrixWorld).project(camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
};
stats.altitude = () => camera.position.length() - R;
stats.pendingTiles = () => tiles.stats ? { ...tiles.stats } : null;

// ---------- loop ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
let tPrev = performance.now(), fCount = 0;
const info = document.getElementById('info');
function frame() {
  requestAnimationFrame(frame);
  controls.update();
  camera.updateMatrixWorld();
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.update();
  renderer.render(scene, camera);
  stats.frames++; fCount++;
  const now = performance.now();
  if (now - tPrev > 1000) {
    stats.fps = Math.round(fCount * 1000 / (now - tPrev)); fCount = 0; tPrev = now;
    const L = stats.layers, alt = stats.altitude();
    info.textContent = `alt ${alt > 1e4 ? (alt / 1000).toFixed(0) + ' km' : alt.toFixed(0) + ' m'}   fps ${stats.fps}\n` +
      Object.entries(L).map(([k, v]) => `${k.padEnd(7)} ok ${v.ok}  bad ${v.bad}  maxZ ${v.maxZ}  avg ${(v.ms / Math.max(1, v.ok + v.bad)).toFixed(0)} ms`).join('\n') +
      `\nsite ${stats.siteReady ? 'ready' : 'loading'}  drape ${stats.hiriseDrape ? stats.hiriseDrape.ok + '/' + stats.hiriseDrape.tiles : '-'}`;
  }
}
frame();
loadSite().catch((err) => { console.error('site load failed', err); stats.errors.push(String(err)); });
