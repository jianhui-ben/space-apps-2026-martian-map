// The continuous Mars globe: NASA Trek tiles on a sphere, from the whole planet down to HiRISE.
// Ported from prototypes/globe-spike/web/app.js.
import * as THREE from 'three';
import { TilesRenderer, GlobeControls } from '3d-tiles-renderer/three';
import { GeneratedSurfacePlugin, ImageOverlayPlugin, XYZTilesOverlay } from '3d-tiles-renderer/three/plugins';
import { CSS2DRenderer, CSS2DObject } from '../vendor/three/CSS2DRenderer.js';

export const R = 3396190; // IAU Mars 2000 sphere, the catalog CRS
const DEG = Math.PI / 180;
// CTX and HiRISE are greyscale; each is tinted to sit with the graded Viking colour around it (ruling R31). Fitted by
// drawing the same pixels with and without the layer: CTX against the graded Viking under it (Gale, 420 km up), HiRISE
// against the tinted CTX under it (45 km up), the tint scaled per channel in linear light until the means agree.
const CTX_TINT = 0xfb8d70;
const HIRISE_TINT = 0xe07d63; // HiRISE is about 1.3 times brighter than CTX over the same ground
const RELIEF_OPACITY = 0.6;
const SURFACE_LEVELS = 18; // depth of the generated surface tiling, one past HiRISE's 17 levels
export const START = { lon: 137.44, lat: -4.6, alt: 9.0e6 }; // whole planet, Gale in the middle

// The display grade of the Viking colour mosaic (Task 9c): a saturation lift (w) and a colour multiply (xyz), in linear
// light, so the disc reads as the mockup's warm rust brown (its mean (128, 65, 47); ungraded Viking measures (117, 92, 90)).
// It runs inside the overlay shader on the Viking layer alone, so CTX, HiRISE, the relief and the site terrain keep
// their own colours. For display only; the References page says so.
const VIKING_GRADE = new THREE.Vector4(1.046, 0.535, 0.314, 1.5); // fitted on the landing view: disc mean (128, 65, 48)
const NO_GRADE = new THREE.Vector4(1, 1, 1, 1);
const LAYER_TINT = /tint\.rgb \*= layerInfo\[ i \]\.color;/; // ImageOverlayPlugin 0.5.4's per-layer colour, inside its unrolled loop
const GRADED = Symbol('viking-grade');

// Globe layers: catalog dataset, draw order (lower is drawn first), tint, fenced to the coverage box or not.
const LAYERS = {
  viking: { id: 'imagery_viking', order: 0 },
  relief: { id: 'relief_mola', order: 1 },
  ctx: { id: 'imagery_ctx', order: 2, color: CTX_TINT, bounded: true },
  hirise: { id: 'imagery_hirise_gray', order: 3, color: HIRISE_TINT, bounded: true },
};

// The catalog's live block for one dataset, as overlay options. Only CORS-open Trek (wmts-eq) layers
// can be drawn; their url_template already uses the {z}/{y}/{x} placeholders XYZTilesOverlay reads.
export function overlaySpec(catalog, datasetId) {
  const d = catalog.byId.get(datasetId);
  if (!d || !d.live) throw new Error('catalog has no live layer ' + datasetId);
  const { url_template: url, scheme, cors, max_zoom: maxZoom } = d.live;
  if (scheme !== 'wmts-eq') throw new Error(datasetId + ': the globe draws wmts-eq layers, not ' + scheme);
  if (cors !== '*') throw new Error(datasetId + ': live layer CORS is "' + cors + '", the globe needs "*"');
  if (!/\{z\}\/\{y\}\/\{x\}/.test(url || '')) throw new Error(datasetId + ': url_template lacks {z}/{y}/{x}');
  if (!Number.isInteger(maxZoom)) throw new Error(datasetId + ': live layer has no max_zoom');
  return { url, levels: maxZoom + 1, bounds: (d.coverage && d.coverage.bounds) || null };
}

const xyz = (url, levels, extra = {}) => new XYZTilesOverlay({ url, levels, projection: 'EPSG:4326', ...extra });

// A 1 x 1 transparent PNG, served in place of a tile that failed.
const BLANK_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const blankTile = () => new Response(new Blob([BLANK_PNG], { type: 'image/png' }), { status: 200 });

// Count requests per layer for tests and the debug readout (the spike's counted()). A tile that fails (an HTTP
// error or a network failure, not an abort) counts as bad and comes back blank: the overlay would otherwise
// try to decode the error body and throw an uncaught error. The layer below shows through the gap.
function counted(L, overlay) {
  const fetch0 = overlay.fetch.bind(overlay);
  overlay.fetch = async (url, opts) => {
    const z = +String(url).split('/').slice(-3)[0]; // .../{z}/{y}/{x}.ext
    if (z > L.maxZ) L.maxZ = z;
    L.pending++;
    try {
      const res = await fetch0(url, opts);
      if (res.ok) { L.ok++; return res; }
      L.bad++;
      return blankTile();
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      L.bad++;
      return blankTile();
    } finally {
      L.pending--;
    }
  };
  return overlay;
}

// Fence an overlay to its coverage box so no tiles are requested outside it.
function bounded(overlay, [w, s, e, n]) {
  const src = overlay.imageSource;
  const init0 = src.init.bind(src);
  src.init = async () => { await init0(); src.tiling.setContentBounds(w * DEG, s * DEG, e * DEG, n * DEG); };
  return overlay;
}

const lerp = (a, b, t) => a + (b - a) * t;
const NUDGE_MS = 350; // the keyboard buttons' brief move
const NUDGE_SHARE = 0.1; // an arrow moves the view by a tenth of its ground width
const ZOOM_MIN_M = 200, ZOOM_MAX_M = 2e7; // +/- stay above the site terrain and inside the far plane
// Under prefers-reduced-motion every fly-to jumps; checked per flight, so a change in the setting applies at once.
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;

function enuAxes(lon, lat) {
  const cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG), cn = Math.cos(lon * DEG), sn = Math.sin(lon * DEG);
  return {
    e: new THREE.Vector3(-sn, cn, 0),
    n: new THREE.Vector3(-sl * cn, -sl * sn, cl),
    u: new THREE.Vector3(cl * cn, cl * sn, sl),
  };
}

// Camera looking at (lon, lat), targetAltM above the sphere, from altM above that point. tiltDeg pitches the
// view away from straight down; headingDeg is the compass direction it faces (0 = north, 90 = east).
export function cameraPose(lon, lat, altM, { tiltDeg = 0, headingDeg = 0, targetAltM = 0 } = {}) {
  const { e, n, u } = enuAxes(lon, lat);
  const t = tiltDeg * DEG, h = headingDeg * DEG;
  const f = n.clone().multiplyScalar(Math.cos(h)).addScaledVector(e, Math.sin(h)); // horizontal forward
  const target = u.clone().multiplyScalar(R + targetAltM);
  const position = target.clone().addScaledVector(u, altM).addScaledVector(f, -altM * Math.tan(t));
  const up = u.clone().multiplyScalar(Math.sin(t)).addScaledVector(f, Math.cos(t)); // screen up, square to the view
  return { position, target, up };
}

export function createGlobe(container, catalog, { labelsElement = null } = {}) {
  const width = () => container.clientWidth || innerWidth;
  const height = () => container.clientHeight || innerHeight;

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
  renderer.setClearColor(0x000000, 0); // the page background shows behind the planet
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width(), height());
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width() / height(), 1, 4e7);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  let labelsRoot = labelsElement;
  if (!labelsRoot) {
    labelsRoot = container.appendChild(document.createElement('div'));
    labelsRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1';
  }
  const labels = new CSS2DRenderer({ element: labelsRoot });
  labels.setSize(width(), height());

  // ---------- tiles ----------
  const specs = Object.fromEntries(Object.entries(LAYERS).map(([k, l]) => [k, overlaySpec(catalog, l.id)]));
  const stats = { layers: {}, frames: 0, fps: 0 };
  const overlays = {};
  for (const [k, l] of Object.entries(LAYERS)) {
    const s = specs[k];
    stats.layers[k] = { ok: 0, bad: 0, maxZ: -1, pending: 0 };
    let o = xyz(s.url, s.levels, l.color === undefined ? {} : { color: l.color });
    if (l.bounded) {
      if (!s.bounds) throw new Error(l.id + ': no coverage.bounds to fence the overlay');
      o = bounded(o, s.bounds);
    }
    overlays[k] = counted(stats.layers[k], o);
  }

  const tiles = new TilesRenderer();
  tiles.ellipsoid.radius.set(R, R, R);
  tiles.registerPlugin(new GeneratedSurfacePlugin({ overlay: xyz(specs.viking.url, SURFACE_LEVELS) }));
  const imagery = new ImageOverlayPlugin();
  overlays.relief.opacity = 0; // off until setRelief(true)
  for (const k of Object.keys(LAYERS)) imagery.addOverlay(overlays[k], LAYERS[k].order);
  tiles.registerPlugin(imagery);

  // Each tile's material: after the overlay plugin has wrapped it (processTileModel runs before load-model), grade the
  // Viking layer's texel in its own unrolled loop step; the other layers' steps are left as they are.
  const grade = { value: VIKING_GRADE.clone() };
  const gradeMaterial = (m) => {
    if (m[GRADED]) return;
    m[GRADED] = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = function gradeViking(sh, r) {
      prev.call(this, sh, r);
      const k = imagery.overlays.indexOf(overlays.viking);
      if (k < 0 || !LAYER_TINT.test(sh.fragmentShader)) return; // nothing to grade: the colours stay as Trek serves them
      sh.uniforms.vikingGrade = grade;
      sh.fragmentShader = sh.fragmentShader
        .replace(/void main\(/, 'uniform vec4 vikingGrade;\nvoid main(')
        .replace(LAYER_TINT, (t) => t + '\n#if UNROLLED_LOOP_INDEX == ' + k + '\n{ float vgL = dot( tint.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );\n'
          + 'tint.rgb = max( mix( vec3( vgL ), tint.rgb, vikingGrade.w ) * vikingGrade.xyz, 0.0 ); }\n#endif');
    };
    m.needsUpdate = true;
  };
  tiles.addEventListener('load-model', ({ scene: s }) => s.traverse((o) => { if (o.material) gradeMaterial(o.material); }));
  const setGrade = (on) => { grade.value.copy(on ? VIKING_GRADE : NO_GRADE); };
  scene.add(tiles.group);
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  const controls = new GlobeControls(scene, camera, renderer.domElement);
  controls.setEllipsoid(tiles.ellipsoid, tiles.group);
  controls.enableDamping = true;

  // ---------- camera ----------
  // Look at (lon, lat) from altM; straight down with north up unless opts tilts it (see cameraPose).
  function setView(lon, lat, altM, opts) {
    const p = cameraPose(lon, lat, altM, opts);
    camera.position.copy(p.position);
    camera.up.copy(p.up);
    camera.lookAt(p.target);
    camera.updateMatrixWorld();
  }
  const altitude = () => camera.position.length() - R;
  // The camera's present view in cameraPose terms, so a flight starts where the camera is.
  const _d = new THREE.Vector3(), _t = new THREE.Vector3(), _v = new THREE.Vector3();
  function currentPose() {
    const p = camera.position, r = p.length();
    const nadir = { lon: Math.atan2(p.y, p.x) / DEG, lat: Math.asin(p.z / r) / DEG, alt: r - R, tilt: 0, heading: 0, targetAlt: 0 };
    camera.getWorldDirection(_d);
    const b = p.dot(_d), disc = b * b - (r * r - R * R);
    const hit = disc > 0 ? -b - Math.sqrt(disc) : -1;
    if (!(hit > 0)) return nadir; // looking past the planet
    _t.copy(p).addScaledVector(_d, hit);
    const lon = Math.atan2(_t.y, _t.x) / DEG, lat = Math.asin(_t.z / R) / DEG;
    const { e, n, u } = enuAxes(lon, lat);
    _v.subVectors(p, _t);
    const h = _v.dot(u);
    const horiz = _v.addScaledVector(u, -h);
    const tilt = Math.atan2(horiz.length(), h) / DEG;
    if (!(h > 0) || tilt > 85) return nadir;
    const f = horiz.length() > 1e-6 * h ? horiz.negate() : camera.up.clone().addScaledVector(u, -camera.up.dot(u));
    return { lon, lat, alt: h, tilt, heading: Math.atan2(f.dot(e), f.dot(n)) / DEG, targetAlt: 0 };
  }
  function stopControls() {
    controls.enabled = false; // resets any drag in progress
    if (controls.dragInertia) controls.dragInertia.set(0, 0, 0);
    if (controls.rotationInertia) controls.rotationInertia.set(0, 0);
    if (controls.globeInertia) controls.globeInertia.identity();
    controls.globeInertiaFactor = 0;
    controls.zoomDelta = 0;
  }

  let flight = null;
  function endFlight() {
    const f = flight;
    flight = null;
    controls.enabled = true;
    if (f) f.resolve();
  }
  // Fly to look at (lon, lat) from altM metres. Long hops rise on the way. Without options the view ends
  // straight down, north up; tiltDeg pitches it away from straight down, facing headingDeg (R14), and
  // targetAltM raises the point looked at (for terrain drawn above the sphere). The flight starts from
  // the camera's present view, tilted or not. Under reduced motion it lands in one frame.
  function flyTo(lon, lat, altM, ms = 1200, { tiltDeg = 0, headingDeg = 0, targetAltM = 0 } = {}) {
    if (flight) endFlight(); // a new flight supersedes the old one
    stopControls();
    const to = { tiltDeg, headingDeg, targetAltM };
    if (!(ms > 0) || reducedMotion()) {
      setView(lon, lat, altM, to);
      controls.adjustCamera(camera);
      controls.enabled = true;
      return Promise.resolve();
    }
    const from = currentPose();
    const dLon = wrap180(lon - from.lon);
    const arc = Math.acos(Math.min(1, Math.max(-1,
      Math.sin(from.lat * DEG) * Math.sin(lat * DEG) + Math.cos(from.lat * DEG) * Math.cos(lat * DEG) * Math.cos(dLon * DEG))));
    const L0 = Math.log(Math.max(1, from.alt)), L1 = Math.log(Math.max(1, altM));
    const peak = Math.log(Math.max(1, arc * R * 0.5));
    const Lc = peak > Math.max(L0, L1) ? 2 * peak - (L0 + L1) / 2 : (L0 + L1) / 2; // log-altitude Bezier control
    return new Promise((resolve) => {
      flight = { from, dLon, dHeading: wrap180(headingDeg - from.heading), lon, lat, altM, to, L0, Lc, L1, t0: performance.now(), ms, resolve };
    });
  }
  function stepFlight(now) {
    const f = flight;
    const t = Math.min(1, Math.max(0, (now - f.t0) / f.ms)), e = ease(t);
    if (t >= 1) setView(f.lon, f.lat, f.altM, f.to);
    else {
      const L = (1 - e) * (1 - e) * f.L0 + 2 * e * (1 - e) * f.Lc + e * e * f.L1;
      setView(f.from.lon + f.dLon * e, lerp(f.from.lat, f.lat, e), Math.exp(L), {
        tiltDeg: lerp(f.from.tilt, f.to.tiltDeg, e),
        headingDeg: f.from.heading + f.dHeading * e,
        targetAltM: lerp(f.from.targetAlt, f.to.targetAltM, e),
      });
    }
    controls.adjustCamera(camera); // near/far planes; controls.update() is idle while flying
    if (t >= 1) endFlight();
  }

  // ---------- keyboard nudges ----------
  // Width of the ground across the view at the point looked at (no wider than the planet).
  function groundWidth(pose) {
    const hfov = 2 * Math.atan(Math.tan((camera.fov * DEG) / 2) * camera.aspect);
    const d = pose.alt / Math.cos(pose.tilt * DEG);
    return Math.min(2 * R, 2 * d * Math.tan(hfov / 2));
  }
  // Rotate the camera about the planet: dx, dy in {-1, 0, 1} move the view right/left and up/down on screen by a
  // tenth of the ground width; the altitude, tilt and heading stay.
  function nudge(dx, dy, ms = NUDGE_MS) {
    const p = currentPose();
    const delta = (NUDGE_SHARE * groundWidth(p)) / R; // radians along the great circle
    const brg = (p.heading + (Math.atan2(dx, dy) / DEG)) * DEG;
    const la1 = p.lat * DEG, lo1 = p.lon * DEG;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(delta) + Math.cos(la1) * Math.sin(delta) * Math.cos(brg));
    const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(delta) * Math.cos(la1), Math.cos(delta) - Math.sin(la1) * Math.sin(la2));
    return flyTo(wrap180(lo2 / DEG), la2 / DEG, p.alt, ms, { tiltDeg: p.tilt, headingDeg: p.heading });
  }
  // Scale the height over the point looked at (+ is 0.6, − is 1 / 0.6).
  function zoomBy(factor, ms = NUDGE_MS) {
    const p = currentPose();
    const alt = Math.min(ZOOM_MAX_M, Math.max(ZOOM_MIN_M, p.alt * factor));
    return flyTo(p.lon, p.lat, alt, ms, { tiltDeg: p.tilt, headingDeg: p.heading });
  }

  // ---------- pins ----------
  const pins = [];
  function addPin({ lon, lat, el }) {
    const obj = new CSS2DObject(el);
    obj.center.set(0, 0.5); // the element's left middle sits on the point
    el.addEventListener('wheel', (e) => { // scrolling over a pin still zooms the globe toward the cursor
      e.preventDefault();
      renderer.domElement.dispatchEvent(new WheelEvent('wheel', e));
    }, { passive: false });
    tiles.ellipsoid.getCartographicToPosition(lat * DEG, lon * DEG, 0, obj.position);
    scene.add(obj);
    pins.push(obj);
    return obj;
  }
  // A point on the sphere faces the camera when p·c > R²; pins over the horizon are hidden each frame.
  // To hide a pin for other reasons set pin.userData.hidden = true (pin.visible is overwritten here).
  function cullPins() {
    for (const p of pins) p.visible = !p.userData.hidden && p.position.dot(camera.position) > R * R;
  }

  // ---------- relief ----------
  // The overlay shader reads opacity every frame, so toggling it is enough. (Adding an overlay at run
  // time while tiles are still loading throws inside ImageOverlayPlugin 0.5.4, so relief is added up front.)
  function setRelief(on) { overlays.relief.opacity = on ? RELIEF_OPACITY : 0; }

  // ---------- loop ----------
  let tilesVisible = true;
  function setTilesVisible(v) { tilesVisible = !!v; tiles.group.visible = tilesVisible; }
  const frameCallbacks = new Set();
  function onFrame(cb) { frameCallbacks.add(cb); return () => frameCallbacks.delete(cb); }

  function resize() {
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
    renderer.setSize(width(), height());
    labels.setSize(width(), height());
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(container);
  else addEventListener('resize', resize);

  let tPrev = performance.now(), fCount = 0, tLast = tPrev;
  function frame(now = performance.now()) {
    if (flight) stepFlight(now);
    else controls.update();
    camera.updateMatrixWorld();
    if (tilesVisible) {
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
    }
    const dt = (now - tLast) / 1000;
    tLast = now;
    for (const cb of frameCallbacks) cb(dt, now);
    cullPins();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    stats.frames++; fCount++;
    if (now - tPrev > 1000) { stats.fps = Math.round(fCount * 1000 / (now - tPrev)); fCount = 0; tPrev = now; }
  }

  setView(START.lon, START.lat, START.alt);
  renderer.setAnimationLoop(frame);

  return {
    renderer, scene, camera, tiles, controls, labels, overlays, stats,
    altitude, flyTo, addPin, onFrame, setTilesVisible, setRelief, nudge, zoomBy, grade, setGrade,
    flying: () => !!flight,
  };
}
