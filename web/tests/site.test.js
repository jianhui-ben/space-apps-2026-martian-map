import { siteFrame } from '../src/frame.js';
import { axisSamples, siteSurface, tripSurface, drapeTiles } from '../src/site.js';
import { fixtureSite } from './fixtures.js';

const R = 3396190;
const DEG = Math.PI / 180;

test('site axisSamples: ends and cuts exact, steps at most the stride, no slivers', () => {
  const a = axisSamples(-0.5, 402.5, 4, [100.25, 300.75]);
  assertEq(a[0], -0.5);
  assertEq(a[a.length - 1], 402.5);
  assert(a.includes(100.25) && a.includes(300.75), 'cuts kept exactly');
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    assert(d > 0, 'sorted, no duplicates');
    assert(d <= 6 + 1e-9, 'step ' + d + ' at ' + a[i - 1]); // a multiple next to a cut is dropped: at most 1.5 strides
    assert(d >= 2 - 1e-9, 'sliver ' + d + ' at ' + a[i - 1]);
  }
  assert(a.includes(8) && a.includes(200), 'interior samples sit on stride multiples (decimation)');
  assertEq(axisSamples(0, 12, 4, [-3, 20]), [0, 4, 8, 12]); // cuts outside the range are ignored
});

// Lon/lat of each vertex, recovered from the local positions.
function lonLats(frame, geometry) {
  const p = geometry.attributes.position, out = [];
  for (let i = 0; i < p.count; i++) out.push(frame.toLonLat({ x: p.getX(i), y: p.getY(i), z: p.getZ(i) }));
  return out;
}

test('site surface spans exactly the site box, decimated to 4 m', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  const s = siteSurface(f, site);
  const ll = lonLats(f, s.geometry);
  const [w, so, e, n] = site.bounds;
  const lons = ll.map((v) => v.lon), lats = ll.map((v) => v.lat);
  assertClose(Math.min(...lons), w, 1e-9);
  assertClose(Math.max(...lons), e, 1e-9);
  assertClose(Math.min(...lats), so, 1e-9);
  assertClose(Math.max(...lats), n, 1e-9);
  assertEq(s.stride, 4); // ceil(4 / 1 m)
  assert(s.nx >= 100 && s.nx <= 102, 'about 400 m / 4 m columns, got ' + s.nx);
  assert(s.geometry.index.count / 3 === 2 * (s.nx - 1) * (s.ny - 1), 'no NaN in the fixture, so every quad is drawn');
});

test('site trip surface leaves a hole that is exactly the site box', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  const t = tripSurface(f, site);
  assert(t && t.geometry.index.count > 0, 'trip mesh built');
  const ll = lonLats(f, t.geometry);
  const [w, s, e, n] = site.bounds;
  const idx = t.geometry.index.array;
  for (let k = 0; k < idx.length; k += 3) {
    const a = ll[idx[k]], b = ll[idx[k + 1]], c = ll[idx[k + 2]];
    const lon = (a.lon + b.lon + c.lon) / 3, lat = (a.lat + b.lat + c.lat) / 3;
    assert(!(lon > w && lon < e && lat > s && lat < n), 'triangle inside the site box at ' + lon + ', ' + lat);
  }
  // the hole's rim lies on the box edges
  const onEdge = (v) => (Math.abs(v.lon - w) < 1e-9 || Math.abs(v.lon - e) < 1e-9) && v.lat >= s - 1e-9 && v.lat <= n + 1e-9;
  assert(ll.filter(onEdge).length >= 4, 'vertices on the west and east box edges');
});

test('site skirts reach the globe surface on every rim edge', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  for (const surf of [siteSurface(f, site), tripSurface(f, site)]) {
    const p = surf.skirt.attributes.position;
    assert(p.count > 0, 'skirt has vertices');
    let below = 0;
    for (let i = 0; i < p.count; i++) {
      const v = { x: p.getX(i), y: p.getY(i), z: p.getZ(i) };
      const ll = f.toLonLat(v);
      const ground = f.toLocal(ll.lon, ll.lat, f.elevRef).y; // the sphere, where the globe is drawn
      if (v.y < ground) below += 1;
    }
    assert(below >= p.count / 3, 'bottom vertices sit under the sphere (' + below + ' of ' + p.count + ')');
  }
});

test('site drapeTiles: zoom 15 over a site box fits one canvas, big boxes drop zoom, clipped to coverage', () => {
  const box = [137.4247, -4.5844, 137.4585, -4.5507];
  const cov = [137.1224669, -4.9254743, 137.7298129, -4.2489588];
  const t = drapeTiles(box, 15, cov);
  assertEq(t.z, 15);
  const span = 180 / 2 ** 15;
  assertEq(t.x0, Math.floor((box[0] + 180) / span));
  assertEq(t.y0, Math.floor((90 - box[3]) / span));
  assert((t.x1 - t.x0 + 1) * 256 <= 4096 && (t.y1 - t.y0 + 1) * 256 <= 4096, 'fits 4096 px');
  assertClose(t.w, t.x0 * span - 180, 1e-12);
  assertClose(t.n, 90 - t.y0 * span, 1e-12);
  const big = drapeTiles([137.31, -4.89, 137.49, -4.54], 14, cov);
  assert(big.z < 14, 'zoom dropped to fit, got ' + big.z);
  assert((big.x1 - big.x0 + 1) * 256 <= 4096 && (big.y1 - big.y0 + 1) * 256 <= 4096, 'big box fits');
  const edge = drapeTiles([137.0, -4.6, 137.2, -4.5], 12, cov); // west part is outside the coverage
  assert(edge.x0 >= Math.floor((cov[0] + 180) / (180 / 2 ** edge.z)), 'no tiles west of the coverage');
  assertEq(drapeTiles([10, 10, 10.01, 10.01], 15, cov), null);
});

test('site surfaces need no globe: true-scale metres, x east and z south', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  const s = siteSurface(f, site);
  s.geometry.computeBoundingBox();
  const bb = s.geometry.boundingBox;
  const width = 2 * R * Math.cos(f.lat0 * DEG) * ((site.bounds[2] - site.bounds[0]) / 2) * DEG;
  assertClose(bb.max.x - bb.min.x, width, 0.5);
  assert(bb.min.y >= -0.1 && bb.max.y < 70, 'heights are h - elevRef in metres, got ' + bb.min.y + '..' + bb.max.y);
});

test('site skirt walls face away from the surface they hang from', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  const p = siteSurface(f, site).skirt.attributes.position;
  let inward = 0;
  for (let k = 0; k < p.count; k += 3) {
    const a = [p.getX(k), p.getY(k), p.getZ(k)], b = [p.getX(k + 1), p.getY(k + 1), p.getZ(k + 1)], c = [p.getX(k + 2), p.getY(k + 2), p.getZ(k + 2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * v[2] - u[2] * v[1], nz = u[0] * v[1] - u[1] * v[0]; // winding normal, horizontal part
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3; // the box centre is the local origin
    if (nx * cx + nz * cz <= 0) inward += 1;
  }
  assertEq(inward, 0, 'walls facing into the site box');
});

// ---- problems (fix round 1: missing or failed data never reads as fine) ----
import * as THREE from 'three';
import { openSite, assertOpenable, loadProblems, drapeMaterial } from '../src/site.js';
import { createLayoutStore, footprintSpecs, bestSpot } from '../src/layout.js';
import { getSite } from '../src/catalog.js';
import { fixtureCatalog, fixtureCatalogWithMissing } from './fixtures.js';

let sharedRenderer = null;
const renderer = () => sharedRenderer || (sharedRenderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') }));
// The parts of a Globe that openSite uses; tick() runs the frame callbacks.
function fakeGlobe() {
  const frames = new Set();
  return {
    renderer: renderer(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(40, 1, 1, 1e7), controls: { enabled: true },
    onFrame(cb) { frames.add(cb); return () => frames.delete(cb); },
    tick() { for (const cb of [...frames]) cb(0.016, performance.now()); },
  };
}
function storeFor(site) {
  const store = createLayoutStore(), specs = footprintSpecs({ loadKw: 150, power: 'topup' });
  store.set(site.id, bestSpot(site, specs), { final: true, specs });
  return store;
}
async function until(pred, ms = 8000) {
  const t0 = performance.now();
  while (!pred()) {
    if (performance.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const TILE_URL = 'http://fixture.test/tiles/{z}/{y}/{x}.png';
let redPng = null;
async function tilePng() {
  if (!redPng) {
    const cv = new OffscreenCanvas(256, 256), g = cv.getContext('2d');
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 256, 256);
    redPng = await cv.convertToBlob({ type: 'image/png' });
  }
  return redPng;
}
// The fixture site with a HiRISE live layer over coverage(siteBounds); tiles come from the catalog's fetch,
// failing (404) where failTile(z, y, x) says so. No network, so no console noise.
async function hiriseSite({ coverage, failTile = () => false }) {
  const c = fixtureCatalog();
  c.byId.set('imagery_hirise_gray', {
    id: 'imagery_hirise_gray', coverage: { bounds: coverage(c.areas.sites.site_a) },
    live: { url_template: TILE_URL, scheme: 'wmts-eq', cors: '*', min_zoom: 0, max_zoom: 16 },
  });
  const png = await tilePng(), base = c.fetch, asked = [];
  c.fetch = async (u, o) => {
    const m = /\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(String(u));
    if (!m) return base(u, o);
    asked.push(String(u));
    return failTile(+m[1], +m[2], +m[3]) ? new Response('gone', { status: 404 }) : new Response(png, { status: 200 });
  };
  return { site: await getSite(c, 'site_a'), asked };
}
const grow = (d) => (b) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];

test('site openSite throws a clear error without an elevation grid, before touching the globe', async () => {
  const site = await getSite(fixtureCatalog({ missing: ['elev_a_fine.f32'] }), 'site_a');
  assertEq(site.grids.elevation, null);
  const g = fakeGlobe();
  let err = null;
  try { openSite(g, site, { layoutStore: storeFor(site) }); } catch (e) { err = e; }
  assert(err, 'openSite threw');
  assertEq(err.message, 'site_a cannot be opened: it has no elevation grid (elev_a_fine: HTTP 404 for elev_a_fine.f32)');
  assertEq(g.scene.children.length, 0, 'nothing added to the scene');
  assert(!document.getElementById('readout'), 'no readout left behind');
  const bare = await fixtureSite({ grids: { elevation: null }, loadErrors: {} });
  let msg = '';
  try { assertOpenable(bare); } catch (e) { msg = e.message; }
  assertEq(msg, 'site_a cannot be opened: it has no elevation grid (none loaded)');
});

test('site problems fold load errors in and name a missing trip grid', async () => {
  const site = await getSite(fixtureCatalogWithMissing(), 'site_a'); // rough_a.f32 is missing
  const v = openSite(fakeGlobe(), site, { layoutStore: storeFor(site) });
  assertEq(v.problems, [{ kind: 'data_failed', datasetId: 'rough_a', message: 'rough_a failed to load: HTTP 404 for rough_a.f32' }]);
  v.dispose();
  const noTrip = await fixtureSite({ tripArea: null });
  const w = openSite(fakeGlobe(), noTrip, { layoutStore: storeFor(noTrip) });
  assertEq(w.tripTerrain, null);
  assertEq(w.problems.map((p) => p.kind), ['no_elevation']);
  w.dispose();
  assertEq(loadProblems({ id: 'x', tripArea: {}, loadErrors: { 'BT-08@x': 'no dataset in the catalog' }, catalog: { byId: new Map() } }),
    [{ kind: 'data_failed', message: 'BT-08 at x: no dataset in the catalog' }]);
});

test('site failed HiRISE tiles yield imagery_incomplete, heard through onProblems', async () => {
  const { site, asked } = await hiriseSite({ coverage: grow(1), failTile: (z, y, x) => x % 2 === 0 });
  const v = openSite(fakeGlobe(), site, { layoutStore: storeFor(site) });
  const heard = [];
  v.onProblems((p) => heard.push(p));
  await until(() => v.debug.drape().done);
  assert(asked.length > 0, 'tiles were asked for');
  const d = v.debug.drape();
  assert(d.mode === 'hirise' && d.site.bad > 0 && d.site.ok > 0, JSON.stringify(d));
  assert(d.site.missing > 0.1 && d.site.missing < 1, 'site share without imagery ' + d.site.missing);
  const img = v.problems.filter((p) => p.kind === 'imagery_incomplete');
  assert(img.length >= 1 && img.every((p) => p.datasetId === 'imagery_hirise_gray'), JSON.stringify(v.problems));
  assert(img.some((p) => /of the site/.test(p.message) && /tiles failed to load/.test(p.message) && /coloured by elevation/.test(p.message)), JSON.stringify(img));
  assert(heard.length > 0 && heard[heard.length - 1].some((p) => p.kind === 'imagery_incomplete'), 'onProblems fired');
  v.dispose();
});

test('site all HiRISE tiles loaded: no problems', async () => {
  const { site } = await hiriseSite({ coverage: grow(1) });
  const v = openSite(fakeGlobe(), site, { layoutStore: storeFor(site) });
  await until(() => v.debug.drape().done);
  const d = v.debug.drape();
  assert(d.site.bad === 0 && d.trip.bad === 0, JSON.stringify(d));
  assert(d.site.missing === 0 && d.trip.missing === 0, JSON.stringify(d));
  assertEq(v.problems, []);
  v.dispose();
});

test('site trip area beyond the HiRISE coverage is reported at open', async () => {
  const { site } = await hiriseSite({ coverage: grow(0.0005) }); // about 55 m round the site box only
  const v = openSite(fakeGlobe(), site, { layoutStore: storeFor(site) });
  const d = v.debug.drape();
  assert(d.trip.outside > 0.1, 'trip share outside the drape ' + d.trip.outside); // whole z14 tiles reach a little past the coverage
  assertEq(d.site.outside, 0);
  const p = v.problems.find((x) => x.kind === 'imagery_incomplete');
  assert(p && /missing over \d+% of the trip area/.test(p.message), JSON.stringify(v.problems));
  v.dispose();
});

test('site drape material: photo where the drape has pixels, the ramp elsewhere, never the stretched edge pixel', () => {
  const r = renderer();
  const cv = document.createElement('canvas');
  cv.width = 2; cv.height = 1;
  const g = cv.getContext('2d');
  g.fillStyle = '#ff0000';
  g.fillRect(1, 0, 1, 1); // left texel transparent (no imagery), right texel red (also the edge ClampToEdge would stretch)
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const mat = drapeMaterial(tex, { tint: 0xffffff });
  // three quads side by side, each with one uv: inside on the transparent texel, inside on red, outside the drape
  const pos = [], uv = [], col = [], nor = [], idx = [];
  [0.25, 0.75, 1.5].forEach((u, q) => {
    const k = pos.length / 3;
    for (const [x, y] of [[q, 0], [q + 1, 0], [q, 1], [q + 1, 1]]) { pos.push(x, y, 0); uv.push(u, 0.5); col.push(0, 1, 0); nor.push(0, 0, 1); }
    idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, mat), new THREE.AmbientLight(0xffffff, Math.PI)); // Lambert then returns its albedo
  const cam = new THREE.OrthographicCamera(0, 3, 1, 0, -1, 1);
  const rt = new THREE.WebGLRenderTarget(30, 10);
  r.setRenderTarget(rt);
  r.render(scene, cam);
  r.setRenderTarget(null);
  const px = new Uint8Array(30 * 10 * 4);
  r.readRenderTargetPixels(rt, 0, 0, 30, 10, px);
  const at = (x) => Array.from(px.slice((5 * 30 + x) * 4, (5 * 30 + x) * 4 + 3));
  const [none, photo, outside] = [at(5), at(15), at(25)];
  assert(none[1] > 200 && none[0] < 50, 'transparent texel shows the ramp colour, got ' + none);
  assert(photo[0] > 200 && photo[1] < 50, 'imagery shows the photo, got ' + photo);
  assert(outside[1] > 200 && outside[0] < 50, 'outside the drape shows the ramp, not the red edge texel, got ' + outside);
  rt.dispose(); mat.dispose(); tex.dispose(); geo.dispose();
});
