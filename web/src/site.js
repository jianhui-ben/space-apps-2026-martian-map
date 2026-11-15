// One candidate site inside the globe: real 3D terrain, a lower-detail trip-area surround, a HiRISE drape
// (or an elevation ramp where no HiRISE layer covers the site), skirts down to the globe, vertical
// exaggeration, and the data-center layout that the user drags and rotates while the checks update.
// Ported from prototypes/globe-spike/web/app.js (ENU placement, mesh, drape, drag), with the look of
// prototypes/terrain-diorama/web/app.js (palette, lighting, footprints, hover readout). The local frame
// is y-up (x east, y up, z south); see frame.js.
import * as THREE from 'three';
import { CSS2DObject } from '../vendor/three/CSS2DRenderer.js';
import { sampleGrid, cellOf, findGrid } from './catalog.js';
import { clampPlacement } from './layout.js';
import { siteFrame, elevationAt, inBox } from './frame.js';
import { createReadout } from './ui/readout.js';
import { mapHasFocus } from './ui/controls.js';

export { siteFrame } from './frame.js'; // the route module imports it from here when site.frame is absent

const R = 3396190;
const DEG = Math.PI / 180;
const EXAGGERATION = 2;
const SITE_CELL_M = 4; // site lattice: stride ceil(4 m / resolution) cells
const TRIP_STRIDE = 4; // trip lattice: every 4th cell
const TRIP_MARGIN_M = 3000; // the trip mesh covers the trip grid within 3 km of the site box and the base
const MAX_VERTS = 400000; // per mesh; only an oversized grid (the 10 m study fallback) widens the stride
const PICK_EVERY = 4; // pick lattices (raycasts) keep every 4th line of the drawn lattice
const SKIRT_BELOW_M = 1; // skirts end 1 m under the sphere, so they always meet the globe
const SITE_ZOOM = 15, TRIP_ZOOM = 14, DRAPE_MAX_PX = 4096, TILE_PX = 256;
const HIRISE = 'imagery_hirise_gray';
// The HiRISE drape's tint, so the lit site terrain sits with the tinted HiRISE on the globe around it (ruling R31: fitted
// like the globe's tints, the site terrain drawn and hidden over the same pixels at near_base_north's fly-in view).
const TINT = 0xd67961;
const MISSING_MIN = 0.005; // report imagery missing over at least 0.5% of a mesh (any failed tile is reported)
// Elevation ramp, low to high, in the rust brown of the graded Viking globe around it, so a site without HiRISE reads
// as ground rather than a pale slab: the plains sit near the globe's tone and craters and channels go darker. Fitted
// (ruling R31) at arcadia_north's fly-in view: the lit ramp and the globe under it over the same pixels, the ramp scaled
// per channel in linear light until the means agree. The photo view's key (ui/factors.js) gives the range it spans.
export const RAMP = ['#270d08', '#3a170f', '#4e2117', '#612c1f', '#743728', '#874331'];
// The Terrain view (Task 9c): slope over 10 m in three classes, the requirement's limits, blended over the photo or the
// ramp so the ground still reads. ≤ 5° the ideal pad, 5–10° usable, > 10° too steep for a pad.
export const SLOPE_CLASSES = [
  { max: 5, colour: '#b8dfc2', words: 'green ≤ 5° (ideal pad)' },
  { max: 10, colour: '#e3c78f', words: 'amber 5–10° (usable)' },
  { max: Infinity, colour: '#ffb19b', words: 'red > 10°' },
];
export const SLOPE_MIX = 0.55;
// The class of a slope in degrees, or -1 when there is no value (no colour, never green).
export const slopeClass = (deg) => (Number.isFinite(deg) ? SLOPE_CLASSES.findIndex((c) => deg <= c.max) : -1);
const FP_CELL_M = 4; // footprint drape spacing
const FILL_LIFT_M = 1.2; // footprintScreen points this far above the ground, in true-scale metres
const HANDLE_GAP_M = 25; // turn handle: this far past the selected footprint's east side (layout frame)
const HANDLE_MIN_PX = 36; // the handles show once the compound is this wide on screen, so they never cover the layout
const TAG_MIN_PX = 20; // ...and the plot tags once the plots can be told apart
const STEP_M = 5, TURN_DEG = 15; // a layout arrow key moves it 5 m; [ and ] turn it 15 degrees
const M_PER_DEG = R * DEG;
const OUTLINE_PX = 3; // footprint outlines are ribbons about this wide on screen, so the layout reads from the fly-in on
const OUTLINE_MIN_M = 0.4, OUTLINE_MAX_M = 12, OUTLINE_REBUILD = 0.25; // ...rebuilt when the width needed changes by 25%
const INK = 0x241c17;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const norm360 = (d) => ((d % 360) + 360) % 360;
const containsBox = (b, o) => o[0] >= b[0] && o[2] <= b[2] && o[1] >= b[1] && o[3] <= b[3];

// ---------- lattices ----------

// Sample positions along one grid axis in fractional cell index (cell centres are integers): the ends and
// the cuts exactly, and the multiples of stride between them (decimation). A multiple closer than half a
// stride to an end or a cut is dropped, so there are no slivers.
export function axisSamples(lo, hi, stride, cuts = []) {
  const fixed = [lo, hi, ...cuts.filter((c) => c > lo && c < hi)];
  const out = fixed.slice();
  for (let v = Math.ceil(lo / stride) * stride; v <= hi; v += stride) {
    if (fixed.every((c) => Math.abs(c - v) >= stride / 2)) out.push(v);
  }
  out.sort((a, b) => a - b);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-9);
}

const fcol = (g, lon) => (lon - g.bounds[0]) / g.pixelDeg[0] - 0.5;
const frow = (g, lat) => (g.bounds[3] - lat) / g.pixelDeg[1] - 0.5;
const lonAt = (g, c) => g.bounds[0] + (c + 0.5) * g.pixelDeg[0];
const latAt = (g, r) => g.bounds[3] - (r + 0.5) * g.pixelDeg[1];

// Grid value at a lattice point: the cell itself at a cell centre, bilinear elsewhere (clamped to the grid).
function heightOf(g, c, r, lon, lat) {
  if (Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < g.width && r < g.height) {
    const v = g.data[r * g.width + c];
    return v === v && v !== g.nodata ? v : NaN;
  }
  return sampleGrid(g, clamp(lon, g.bounds[0], g.bounds[2]), clamp(lat, g.bounds[1], g.bounds[3]));
}

// A terrain surface on a lattice of grid positions. skip(lonC, latC) drops a quad by its centre; a quad
// with a missing corner is dropped too, so gaps show the globe instead of a made-up surface.
// Returns {geometry, skirt, nx, ny, quads}. geometry has position, normal, elevation (m) and, with a
// drape frame {w, n, spanX, spanY}, uv.
function buildSurface(frame, g, cols, rows, { skip = null, drape = null, skirt = true } = {}) {
  const nx = cols.length, ny = rows.length, nv = nx * ny;
  const lons = cols.map((c) => lonAt(g, c)), lats = rows.map((r) => latAt(g, r));
  const pos = new Float32Array(nv * 3), elev = new Float32Array(nv), ok = new Uint8Array(nv);
  const uv = drape ? new Float32Array(nv * 2) : null;
  const v = new THREE.Vector3();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, lon = lons[i], lat = lats[j];
      const h = heightOf(g, cols[i], rows[j], lon, lat);
      ok[k] = Number.isFinite(h) ? 1 : 0;
      elev[k] = ok[k] ? h : frame.elevRef;
      frame.toLocal(lon, lat, elev[k], v); // unused vertices still get a finite position for the bounds
      pos[3 * k] = v.x; pos[3 * k + 1] = v.y; pos[3 * k + 2] = v.z;
      if (uv) { uv[2 * k] = (lon - drape.w) / drape.spanX; uv[2 * k + 1] = 1 - (drape.n - lat) / drape.spanY; }
    }
  }
  const qx = nx - 1, qy = ny - 1, drawn = new Uint8Array(Math.max(0, qx * qy));
  let quads = 0;
  for (let j = 0; j < qy; j++) {
    for (let i = 0; i < qx; i++) {
      const a = j * nx + i;
      if (!(ok[a] && ok[a + 1] && ok[a + nx] && ok[a + nx + 1])) continue;
      if (skip && skip((lons[i] + lons[i + 1]) / 2, (lats[j] + lats[j + 1]) / 2)) continue;
      drawn[j * qx + i] = 1;
      quads += 1;
    }
  }
  const index = new Uint32Array(quads * 6);
  let p = 0;
  for (let j = 0; j < qy; j++) {
    for (let i = 0; i < qx; i++) {
      if (!drawn[j * qx + i]) continue;
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // (a, c, b) faces +y: a->c runs south (+z), a->b east (+x), and z x x = +y
      index[p++] = a; index[p++] = c; index[p++] = b;
      index[p++] = b; index[p++] = c; index[p++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('elevation', new THREE.BufferAttribute(elev, 1));
  if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const out = { geometry, nx, ny, quads, skirt: null };
  if (skirt) out.skirt = buildSkirt(frame, { nx, ny, lons, lats, pos, elev, uv, drawn, normal: geometry.attributes.normal.array });
  return out;
}

// Skirts: a wall from every rim edge of the drawn quads (outer rim, the trip mesh's hole, data gaps) down
// to just under the sphere. They take the rim's drape or colour and its surface normal, so they shade like
// the ground beside them and the terrain doesn't read as a raised slab.
function buildSkirt(frame, { nx, ny, lons, lats, pos, elev, uv, drawn, normal }) {
  const qx = nx - 1, qy = ny - 1;
  const q = (j, i) => (i >= 0 && j >= 0 && i < qx && j < qy ? drawn[j * qx + i] : 0);
  // Each rim edge (a, b) is ordered so the wall (a top, a bottom, b top) faces away from its drawn quad:
  // (-y) x (+x) = +z, so an edge running east faces south; (-y) x (+z) = -x, so one running south faces west.
  // The walls are drawn front side only; their inner face is always under the surface.
  const edges = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < qx; i++) {
      const north = q(j - 1, i), south = q(j, i), a = j * nx + i;
      if (north !== south) edges.push(...(north ? [a, a + 1] : [a + 1, a]));
    }
  }
  for (let j = 0; j < qy; j++) {
    for (let i = 0; i < nx; i++) {
      const west = q(j, i - 1), east = q(j, i), a = j * nx + i;
      if (west !== east) edges.push(...(east ? [a, a + nx] : [a + nx, a]));
    }
  }
  const n = edges.length / 2;
  const P = new Float32Array(n * 18), Nn = new Float32Array(n * 18), E = new Float32Array(n * 6), U = uv ? new Float32Array(n * 12) : null;
  const bottom = new THREE.Vector3();
  let o = 0;
  const put = (k, low) => {
    if (low) {
      frame.toLocal(lons[k % nx], lats[Math.floor(k / nx)], frame.elevRef - SKIRT_BELOW_M, bottom);
      P[3 * o] = bottom.x; P[3 * o + 1] = bottom.y; P[3 * o + 2] = bottom.z;
    } else {
      P[3 * o] = pos[3 * k]; P[3 * o + 1] = pos[3 * k + 1]; P[3 * o + 2] = pos[3 * k + 2];
    }
    Nn[3 * o] = normal[3 * k]; Nn[3 * o + 1] = normal[3 * k + 1]; Nn[3 * o + 2] = normal[3 * k + 2];
    E[o] = elev[k];
    if (U) { U[2 * o] = uv[2 * k]; U[2 * o + 1] = uv[2 * k + 1]; }
    o += 1;
  };
  for (let m = 0; m < n; m++) {
    const a = edges[2 * m], b = edges[2 * m + 1];
    put(a, false); put(a, true); put(b, false);
    put(b, false); put(a, true); put(b, true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  g.setAttribute('elevation', new THREE.BufferAttribute(E, 1));
  if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.computeBoundingSphere();
  return g;
}

// Widen a stride until the lattice fits MAX_VERTS (about (cellsX / s) * (cellsY / s) vertices).
const capStride = (stride, cellsX, cellsY) => Math.max(stride, Math.ceil(Math.sqrt((cellsX * cellsY) / MAX_VERTS)));

// The site box from the site's own elevation grid, decimated to about 4 m, edges exactly on the box.
export function siteSurface(frame, site, { stride = null, drape = null, skirt = true } = {}) {
  const g = site.grids && site.grids.elevation;
  if (!g) return null;
  const [w, s, e, n] = site.bounds;
  const c0 = fcol(g, w), c1 = fcol(g, e), r0 = frow(g, n), r1 = frow(g, s);
  const st = stride || capStride(Math.max(1, Math.ceil(SITE_CELL_M / (g.resolutionM || 1))), c1 - c0, r1 - r0);
  return { ...buildSurface(frame, g, axisSamples(c0, c1, st), axisSamples(r0, r1, st), { drape, skirt }), stride: st };
}

// Trip grid bounds the trip mesh covers: within TRIP_MARGIN_M of the site box and the base.
export function tripWindow(site) {
  const g = site.tripArea;
  if (!g) return null;
  const b = site.bounds, base = site.base || { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
  const lat0 = (b[1] + b[3]) / 2;
  const dLat = TRIP_MARGIN_M / (R * DEG), dLon = dLat / Math.cos(lat0 * DEG);
  const gb = g.bounds;
  return [
    Math.max(gb[0], Math.min(b[0], base.lon) - dLon), Math.max(gb[1], Math.min(b[1], base.lat) - dLat),
    Math.min(gb[2], Math.max(b[2], base.lon) + dLon), Math.min(gb[3], Math.max(b[3], base.lat) + dLat),
  ];
}

// The trip-area surround at stride 4, with a hole that is exactly the site box: the box edges are lattice
// lines and quads whose centre is inside the box are skipped, so the two meshes never overlap (no z-fight).
export function tripSurface(frame, site, { stride = null, drape = null, skirt = true } = {}) {
  const g = site.tripArea;
  if (!g) return null;
  const win = tripWindow(site);
  const c0 = Math.max(0, Math.ceil(fcol(g, win[0]))), c1 = Math.min(g.width - 1, Math.floor(fcol(g, win[2])));
  const r0 = Math.max(0, Math.ceil(frow(g, win[3]))), r1 = Math.min(g.height - 1, Math.floor(frow(g, win[1])));
  if (!(c1 > c0 && r1 > r0)) return null;
  const st = stride || capStride(TRIP_STRIDE, c1 - c0, r1 - r0);
  const hole = !!(site.grids && site.grids.elevation);
  const [w, s, e, n] = site.bounds;
  const cols = axisSamples(c0, c1, st, hole ? [fcol(g, w), fcol(g, e)] : []);
  const rows = axisSamples(r0, r1, st, hole ? [frow(g, n), frow(g, s)] : []);
  const skip = hole ? (lon, lat) => lon > w && lon < e && lat > s && lat < n : null;
  return { ...buildSurface(frame, g, cols, rows, { skip, drape, skirt }), stride: st, window: win };
}

// ---------- drape ----------

// Trek wmts-eq tiles covering box at zoom z (2^(z+1) x 2^z tiles, {y} from the top), clipped to the layer's
// coverage; the zoom drops until the tiles fit one canvas of maxPx. Null when the box misses the coverage.
export function drapeTiles(box, zoom, coverage, maxPx = DRAPE_MAX_PX) {
  const b = coverage
    ? [Math.max(box[0], coverage[0]), Math.max(box[1], coverage[1]), Math.min(box[2], coverage[2]), Math.min(box[3], coverage[3])]
    : box;
  if (!(b[0] < b[2] && b[1] < b[3])) return null;
  for (let z = zoom; z >= 0; z--) {
    const span = 180 / 2 ** z;
    const x0 = Math.floor((b[0] + 180) / span), x1 = Math.ceil((b[2] + 180) / span) - 1;
    const y0 = Math.floor((90 - b[3]) / span), y1 = Math.ceil((90 - b[1]) / span) - 1;
    if ((x1 - x0 + 1) * TILE_PX <= maxPx && (y1 - y0 + 1) * TILE_PX <= maxPx) {
      return { z, x0, x1, y0, y1, w: x0 * span - 180, n: 90 - y0 * span, spanX: (x1 - x0 + 1) * span, spanY: (y1 - y0 + 1) * span };
    }
  }
  return null;
}

// Fetch the tiles into one canvas texture (the spike's hiriseFrame), through the catalog's fetch. The canvas
// starts transparent: a tile that is pending, failed or has no pixels leaves alpha 0 there, and the drape
// material shows the elevation ramp instead, so missing imagery never passes for a photo. The texture is
// premultiplied (the blend in drapeMaterial relies on it) and re-uploads at most once a frame (flush).
// onSettle runs after each tile, loaded or not.
function loadDrape(t, urlTemplate, { fetch: fetchImpl, signal, anisotropy, onSettle }) {
  const nx = t.x1 - t.x0 + 1, ny = t.y1 - t.y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = nx * TILE_PX;
  canvas.height = ny * TILE_PX;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.anisotropy = anisotropy;
  const stats = { z: t.z, tiles: nx * ny, ok: 0, bad: 0, pending: nx * ny, done: false };
  let dirty = false;
  const one = async (tx, ty) => {
    const url = urlTemplate.replace('{z}', t.z).replace('{y}', ty).replace('{x}', tx);
    try {
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bmp = await createImageBitmap(await res.blob());
      if (signal.aborted) { bmp.close(); return; }
      ctx.drawImage(bmp, (tx - t.x0) * TILE_PX, (ty - t.y0) * TILE_PX, TILE_PX, TILE_PX);
      bmp.close();
      stats.ok += 1;
      dirty = true;
    } catch (e) {
      if (!e || e.name !== 'AbortError') stats.bad += 1;
    } finally {
      stats.pending -= 1;
      stats.done = stats.pending === 0;
      if (!signal.aborted && onSettle) onSettle();
    }
  };
  for (let ty = t.y0; ty <= t.y1; ty++) for (let tx = t.x0; tx <= t.x1; tx++) one(tx, ty);
  return {
    texture, stats,
    flush() { if (dirty) { dirty = false; texture.needsUpdate = true; } },
    // Share of the drawn vertices (drawn[i] = 1) with no imagery: outside the canvas or on a transparent pixel.
    missingShare(uv, drawn) {
      const W = canvas.width, H = canvas.height, px = ctx.getImageData(0, 0, W, H).data;
      let n = 0, miss = 0;
      for (let i = 0; i < drawn.length; i++) {
        if (!drawn[i]) continue;
        n += 1;
        const u = uv[2 * i], v = uv[2 * i + 1];
        if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) { miss += 1; continue; }
        const x = Math.min(W - 1, Math.floor(u * W)), y = Math.min(H - 1, Math.floor((1 - v) * H));
        if (px[(y * W + x) * 4 + 3] < 128) miss += 1;
      }
      return n ? miss / n : 0;
    },
  };
}

// Vertices referenced by a geometry's triangles.
function drawnVertices(geometry) {
  const drawn = new Uint8Array(geometry.attributes.position.count), idx = geometry.index.array;
  for (let i = 0; i < idx.length; i++) drawn[idx[i]] = 1;
  return drawn;
}
// Share of the drawn vertices whose uv falls outside the drape (beyond the HiRISE coverage).
export function outsideShare(uv, drawn) {
  let n = 0, out = 0;
  for (let i = 0; i < drawn.length; i++) {
    if (!drawn[i]) continue;
    n += 1;
    const u = uv[2 * i], v = uv[2 * i + 1];
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) out += 1;
  }
  return n ? out / n : 0;
}

// Lambert with the photo where the drape has pixels and the elevation-ramp vertex colour elsewhere: outside the
// drape (uv beyond 0..1, where ClampToEdge would otherwise stretch the edge pixel) and wherever the premultiplied
// texture is transparent (a tile pending, failed or without data). The photo is tinted like the globe.
export function drapeMaterial(texture, { tint = TINT } = {}) {
  const m = new THREE.MeshLambertMaterial({ map: texture, color: tint, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', [
        'vec4 drapeTexel = texture2D( map, vMapUv );',
        'float inDrape = step( 0.0, vMapUv.x ) * step( vMapUv.x, 1.0 ) * step( 0.0, vMapUv.y ) * step( vMapUv.y, 1.0 );',
        'float photo = drapeTexel.a * inDrape;',
        'diffuseColor.rgb = vColor * ( 1.0 - photo ) + drapeTexel.rgb * inDrape * diffuse;',
      ].join('\n'))
      .replace('#include <color_fragment>', '');
  };
  m.customProgramCacheKey = () => 'site-drape-ramp-v1';
  return m;
}

// The Terrain view's hook on a terrain material: a per-vertex slope colour (rgb, a = has a value) mixed into the
// surface colour by mix.value before lighting. At 0 the branch is skipped, so the photo or ramp comes back exactly.
function slopeBlend(material, mix) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  const base = prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(material) : 'site-ramp';
  material.onBeforeCompile = (sh, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, renderer);
    sh.uniforms.slopeMix = mix;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 slopeColor;\nvarying vec4 vSlope;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlope = slopeColor;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float slopeMix;\nvarying vec4 vSlope;')
      .replace('#include <alphamap_fragment>',
        'if ( slopeMix > 0.0 ) diffuseColor.rgb = mix( diffuseColor.rgb, vSlope.rgb, slopeMix * vSlope.a );\n#include <alphamap_fragment>');
  };
  material.customProgramCacheKey = () => base + '+slope-v1';
  return material;
}

const pct = (share) => (share < 0.1 ? (100 * share).toFixed(1) : Math.round(100 * share)) + '%';

// The imagery problem of one drape, or null: failed tiles, or imagery missing over at least MISSING_MIN of the mesh
// (beyond the coverage at open; measured on the canvas once every tile has settled).
function imageryProblem({ label, drape, outside, missing }) {
  const bad = drape.stats.bad, share = missing === null ? outside : missing;
  if (!(bad > 0) && !(share >= MISSING_MIN)) return null;
  const parts = [share >= MISSING_MIN
    ? 'HiRISE imagery missing over ' + pct(share) + ' of the ' + label
    : 'HiRISE imagery incomplete for the ' + label];
  if (bad > 0) parts.push(bad + ' of ' + drape.stats.tiles + ' tiles failed to load');
  return { kind: 'imagery_incomplete', datasetId: HIRISE, message: parts.join('; ') + '; those parts are coloured by elevation' };
}

// Problems known when the site loaded: each load error, and a missing trip-area grid.
export function loadProblems(site) {
  const out = [];
  const byId = site.catalog && site.catalog.byId;
  for (const key of Object.keys(site.loadErrors || {}).sort()) {
    const msg = site.loadErrors[key];
    out.push(byId && byId.has(key)
      ? { kind: 'data_failed', datasetId: key, message: key + ' failed to load: ' + msg }
      : { kind: 'data_failed', message: key.replace('@', ' at ') + ': ' + msg });
  }
  if (!site.tripArea) out.push({ kind: 'no_elevation', message: 'No trip-area elevation grid, so the surround of ' + site.id + ' is not drawn' });
  return out;
}

// openSite draws nothing without the site's own elevation grid; this says why, with the load error if there was one.
export function assertOpenable(site) {
  if (site.grids && site.grids.elevation) return;
  const entry = site.catalog && site.catalog.raw ? findGrid(site.catalog, 'BT-04', site.id) : null;
  const key = entry ? entry.id : 'BT-04@' + site.id;
  const why = site.loadErrors && site.loadErrors[key];
  throw new Error(site.id + ' cannot be opened: it has no elevation grid (' + (why ? key + ': ' + why : 'none loaded') + ')');
}

// Vertex colours from the elevation attribute through RAMP, lo..hi.
const RAMP_LINEAR = RAMP.map((c) => new THREE.Color(c));
function paintRamp(geometry, lo, hi) {
  const e = geometry.attributes.elevation, col = new Float32Array(e.count * 3), span = hi - lo || 1, c = new THREE.Color();
  for (let i = 0; i < e.count; i++) {
    const t = clamp((e.getX(i) - lo) / span, 0, 1) * (RAMP_LINEAR.length - 1), k = Math.min(Math.floor(t), RAMP_LINEAR.length - 2);
    c.copy(RAMP_LINEAR[k]).lerp(RAMP_LINEAR[k + 1], t - k);
    col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// Raycasts against a drawn terrain go to its coarse pick lattice instead (about 16 m), which keeps the
// globe controls' per-frame ground checks, the drag and the hover cheap. Hits are reported on the terrain.
function pickThrough(mesh, pickGeometry) {
  const proxy = new THREE.Mesh(pickGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.raycast = function raycastPick(raycaster, intersects) {
    proxy.matrixWorld.copy(this.matrixWorld);
    const hits = [];
    proxy.raycast(raycaster, hits);
    for (const h of hits) { h.object = this; intersects.push(h); }
  };
  return proxy;
}

// ---------- layout meshes ----------

// Each plot is an upright translucent box (docs/design-guidance.md §8): BOX_M tall in the exaggerated root, so the
// height is display only. Its colour comes from its own checks (ui/card.js footprintStatus).
const BOX_M = 5;
const FILL_OPACITY = 0.35;
const TOP_LIFT_M = 0.05; // the top edge and pattern sit just over the top face
export const FOOTPRINT_COLOURS = { met: '#b8dfc2', conflict: '#ffb19b', unresolved: '#e3c78f' };
const FOOTPRINT_ICONS = { met: '✓', conflict: '✗', unresolved: '?' };
const FOOTPRINT_NAMES = { compound: 'Compound', radiator: 'Radiator', solar: 'Solar' };
const ACCENT = 0xedc49b;

// One plot: walls from the draped ground line up BOX_M, a draped top face, a solid top edge (a ribbon about
// OUTLINE_PX wide on screen plus a thin rim), a ground line, and the diorama's pattern lines on the top. The top face
// and the walls take the picks for drags.
function footprintObject(frame, fp, mats, outlineM) {
  // polygon corners in layout order (-w/2,-h/2), (w/2,-h/2), (w/2,h/2), (-w/2,h/2); local x/z on the sphere
  const P = fp.polygon.map(([lon, lat]) => frame.toLocal(lon, lat, frame.elevRef));
  const nu = Math.max(2, Math.ceil(fp.w / FP_CELL_M)), nv = Math.max(2, Math.ceil(fp.h / FP_CELL_M));
  const at = (u, v) => ({ x: P[0].x + (P[1].x - P[0].x) * u + (P[3].x - P[0].x) * v, z: P[0].z + (P[1].z - P[0].z) * u + (P[3].z - P[0].z) * v });
  const ys = [];
  const grid = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = at(i / nu, j / nv), y = frame.heightAt(p.x, p.z);
      grid.push([p.x, y, p.z]);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
  const fallback = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0; // a gap under the footprint
  for (const g of grid) if (!Number.isFinite(g[1])) g[1] = fallback;
  const yAt = (p) => { const y = frame.heightAt(p.x, p.z); return Number.isFinite(y) ? y : fallback; };

  // top face, draped BOX_M over the ground
  const pos = new Float32Array(grid.length * 3);
  grid.forEach(([x, y, z], k) => { pos[3 * k] = x; pos[3 * k + 1] = y + BOX_M; pos[3 * k + 2] = z; });
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  topGeo.setIndex(idx);
  topGeo.computeBoundingSphere();
  const top = new THREE.Mesh(topGeo, mats.fill);
  top.renderOrder = 2;
  top.name = 'top:' + fp.id;
  top.userData.footprintId = fp.id;

  // walls: the perimeter lattice points, each a (ground, ground + BOX_M) pair
  const per = [];
  for (let i = 0; i < nu; i++) per.push([i, 0]);
  for (let j = 0; j < nv; j++) per.push([nu, j]);
  for (let i = nu; i > 0; i--) per.push([i, nv]);
  for (let j = nv; j > 0; j--) per.push([0, j]);
  const wpos = new Float32Array(per.length * 6);
  per.forEach(([i, j], k) => {
    const [x, y, z] = grid[j * (nu + 1) + i];
    wpos.set([x, y, z, x, y + BOX_M, z], 6 * k);
  });
  const widx = [];
  for (let k = 0; k < per.length; k++) {
    const a = 2 * k, b = 2 * ((k + 1) % per.length);
    widx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
  wallGeo.setIndex(widx);
  wallGeo.computeBoundingSphere();
  const walls = new THREE.Mesh(wallGeo, mats.fill);
  walls.renderOrder = 2;
  walls.name = 'walls:' + fp.id;
  walls.userData.footprintId = fp.id;

  const ringAt = (lift) => per.map(([i, j]) => { const g = grid[j * (nu + 1) + i]; return [g[0], g[1] + lift, g[2]]; }).flat();
  const loop = (lift, mat, order) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ringAt(lift)), 3));
    const l = new THREE.LineLoop(geo, mat);
    l.renderOrder = order;
    l.raycast = () => {};
    return l;
  };
  const rim = loop(BOX_M + TOP_LIFT_M, mats.line, 4); // thin rim round the top: dark, or the accent when selected
  const foot = loop(0.3, mats.edge, 3); // where the box meets the ground

  // solid top edge: a ribbon outlineM wide just inside the top's edge (the inset ring keeps mitred corners)
  const du = Math.min(0.25, outlineM / fp.w), dv = Math.min(0.25, outlineM / fp.h);
  const uv = [];
  for (let i = 0; i < nu; i++) uv.push([i / nu, 0]);
  for (let j = 0; j < nv; j++) uv.push([1, j / nv]);
  for (let i = nu; i > 0; i--) uv.push([i / nu, 1]);
  for (let j = nv; j > 0; j--) uv.push([0, j / nv]);
  const rpos = new Float32Array(uv.length * 6);
  const lift = BOX_M + TOP_LIFT_M;
  uv.forEach(([u, v], k) => {
    const o = at(u, v), q = at(du + u * (1 - 2 * du), dv + v * (1 - 2 * dv));
    rpos.set([o.x, yAt(o) + lift, o.z, q.x, yAt(q) + lift, q.z], 6 * k);
  });
  const ridx = [];
  for (let k = 0; k < uv.length; k++) {
    const a = 2 * k, b = 2 * ((k + 1) % uv.length);
    ridx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  ribbonGeo.setIndex(ridx);
  ribbonGeo.computeBoundingSphere();
  const ribbon = new THREE.Mesh(ribbonGeo, mats.ribbon);
  ribbon.renderOrder = 3;
  ribbon.name = 'outline:' + fp.id;
  ribbon.raycast = () => {}; // decoration; drags pick the top and the walls

  // inner pattern on the top, as in the diorama: panel rows on the solar plot, fins on the radiator plot
  const lineAt = (i, j) => { const g = grid[j * (nu + 1) + i]; return [g[0], g[1] + lift, g[2]]; };
  const seg = [];
  const every = fp.id === 'solar' ? 20 : fp.id === 'radiator' ? 12 : 0;
  if (every) {
    for (let m = every; m < fp.h - every / 2; m += every) {
      const j = Math.round((m / fp.h) * nv);
      for (let i = 0; i < nu; i++) seg.push(...lineAt(i, j), ...lineAt(i + 1, j));
    }
  }
  const group = new THREE.Group();
  group.name = 'footprint:' + fp.id;
  group.add(walls, top, ribbon, rim, foot);
  if (seg.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
    const lines = new THREE.LineSegments(sg, mats.pattern);
    lines.renderOrder = 3;
    lines.raycast = () => {};
    group.add(lines);
  }
  // anchors (layout frame): the centre and east axis for the handles, the west edge's middle for the tag
  const ex = new THREE.Vector3(P[1].x - P[0].x, 0, P[1].z - P[0].z).normalize();
  const c = at(0.5, 0.5), west = at(0, 0.5);
  return {
    group, walls, picks: [top, walls], east: ex,
    centre: { x: c.x, y: yAt(c), z: c.z }, west: { x: west.x, y: yAt(west) + BOX_M, z: west.z },
  };
}

const bearing = (c, p) => Math.atan2(p.x - c.x, -(p.z - c.z)) / DEG; // clockwise from north; local z is south

// ---------- the view ----------

// Open a site in the globe. The layout comes from layoutStore (set it, with specs, before opening). Drags go
// back through layoutStore.set, at most once an animation frame with {final: false} and once more with
// {final: true} on pointer up; onLayoutChange(siteId, layout, {final}) hears every change to this site's
// layout while the view is open, whoever made it. Throws, before touching the globe, if the site has no
// elevation grid. view.problems lists what the view cannot show as data, and onProblems(cb) hears changes
// (tile failures arrive after opening).
export function openSite(globe, site, { layoutStore, onLayoutChange = null, exaggeration = EXAGGERATION } = {}) {
  const t0 = performance.now();
  assertOpenable(site);
  if (!layoutStore) throw new Error('openSite needs a layoutStore');
  let layout = layoutStore.get(site.id);
  if (!layout) throw new Error('openSite: the layout store has no layout for ' + site.id);
  const frame = siteFrame(site);
  const canvas = globe.renderer.domElement;

  // ---- drape: HiRISE only where its live layer covers the whole site box (R16) ----
  const hi = site.catalog && site.catalog.byId ? site.catalog.byId.get(HIRISE) : null;
  const cov = hi && hi.coverage && hi.coverage.bounds;
  const live = hi && hi.live;
  const useHirise = !!(cov && live && live.cors === '*' && live.url_template && containsBox(cov, site.bounds));
  const win = tripWindow(site);
  const siteTiles = useHirise ? drapeTiles(site.bounds, SITE_ZOOM, cov) : null;
  const tripTiles = useHirise && win ? drapeTiles(win, TRIP_ZOOM, cov) : null;

  // ---- meshes ----
  const S = siteSurface(frame, site, { drape: siteTiles });
  const T = tripSurface(frame, site, { drape: tripTiles });
  const SP = S && siteSurface(frame, site, { stride: S.stride * PICK_EVERY, skirt: false });
  const TP = T && tripSurface(frame, site, { stride: T.stride * PICK_EVERY, skirt: false });

  // ---- problems: what the view cannot show as data (Task 9 shows them) ----
  const problemListeners = new Set();
  const known = loadProblems(site);
  const imagery = []; // {label, drape, outside, missing, drawn, uv}, one per drape
  let problems = [], disposed = false;
  function refreshProblems() {
    if (disposed) return;
    for (const im of imagery) {
      if (im.missing === null && im.drape.stats.done) im.missing = im.drape.missingShare(im.uv, im.drawn);
    }
    const next = [...known, ...imagery.map(imageryProblem).filter(Boolean)];
    if (JSON.stringify(next) === JSON.stringify(problems)) return;
    problems = next;
    for (const cb of [...problemListeners]) cb(problems.slice());
  }

  // One ramp over both meshes so the colours meet at the box edge. With a drape the ramp still shows wherever
  // there is no imagery; without one (R16) it is the whole colouring.
  let lo = Infinity, hiE = -Infinity;
  for (const s of [S, T]) {
    if (!s) continue;
    const e = s.geometry.attributes.elevation.array, idx = s.geometry.index.array;
    for (let i = 0; i < idx.length; i++) { const v = e[idx[i]]; if (v < lo) lo = v; if (v > hiE) hiE = v; }
  }
  for (const s of [S, T]) if (s) { paintRamp(s.geometry, lo, hiE); paintRamp(s.skirt, lo, hiE); }

  const abort = new AbortController();
  const drapeOpts = {
    fetch: (site.catalog && site.catalog.fetch) || ((u, o) => fetch(u, o)), signal: abort.signal,
    anisotropy: Math.min(8, globe.renderer.capabilities.getMaxAnisotropy()), onSettle: () => refreshProblems(),
  };
  const siteDrape = siteTiles ? loadDrape(siteTiles, live.url_template, drapeOpts) : null;
  const tripDrape = tripTiles ? loadDrape(tripTiles, live.url_template, drapeOpts) : null;
  for (const [label, drape, surf] of [['site', siteDrape, S], ['trip area', tripDrape, T]]) {
    if (!drape || !surf) continue;
    const drawn = drawnVertices(surf.geometry), uv = surf.geometry.attributes.uv.array;
    imagery.push({ label, drape, drawn, uv, outside: outsideShare(uv, drawn), missing: null });
  }
  refreshProblems();

  const materials = [];
  const slopeMix = { value: 0 }; // the Terrain view's blend on the site terrain (setSlopeColouring)
  const surfaceMaterial = (drape, slope) => {
    const m = drape ? drapeMaterial(drape.texture) : new THREE.MeshLambertMaterial({ vertexColors: true });
    if (slope) slopeBlend(m, slopeMix);
    materials.push(m);
    return m;
  };
  // the slope colour per vertex starts empty (alpha 0) and is filled the first time the Terrain view is on
  if (S) for (const g of [S.geometry, S.skirt]) g.setAttribute('slopeColor', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 4), 4));

  const group = new THREE.Group(); // placement: matrix = frame.matrix
  group.name = 'site:' + site.id;
  group.matrixAutoUpdate = false;
  group.matrix.copy(frame.matrix);
  const root = new THREE.Group(); // exaggerated: the navigation lane adds its route here
  root.name = 'site-root';
  root.scale.y = exaggeration;
  group.add(root);

  const mkTerrain = (surf, pick, drape, name, slope = false) => {
    if (!surf) return null;
    const material = surfaceMaterial(drape, slope);
    const m = new THREE.Mesh(surf.geometry, material);
    m.name = name;
    const sk = new THREE.Mesh(surf.skirt, material); // same look; the walls carry the rim's uv or colour
    sk.name = 'skirt';
    sk.raycast = () => {}; // decoration; ground hits come from the surface
    m.add(sk);
    pickThrough(m, pick.geometry);
    root.add(m);
    return m;
  };
  const terrain = mkTerrain(S, SP, siteDrape, 'terrain', true);
  const tripTerrain = mkTerrain(T, TP, tripDrape, 'tripTerrain');
  const surfaces = [terrain, tripTerrain].filter(Boolean);

  // lights (the globe tiles are unlit, so these only shade the site): a near-white sky over the diorama's
  // warm ground and a high north-west sun; flat ground comes out about as bright as the unlit globe.
  const sun = new THREE.DirectionalLight(0xfffaf2, 2.2);
  sun.position.set(-1700, 4300, -1300);
  const sky = new THREE.HemisphereLight(0xffffff, 0x7a4a33, 1.0);
  group.add(sun, sun.target, sky);

  // ---- layout ----
  const fpMats = new Map(); // footprint id -> its own materials, so each plot takes its own status colour
  const fpStatus = new Map(); // footprint id -> 'met' | 'conflict' | 'unresolved'
  function matsFor(id) {
    if (!fpMats.has(id)) {
      const c = new THREE.Color(FOOTPRINT_COLOURS[fpStatus.get(id) || 'unresolved']);
      fpMats.set(id, {
        fill: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: FILL_OPACITY, depthWrite: false, side: THREE.DoubleSide }),
        ribbon: new THREE.MeshBasicMaterial({ color: c, depthWrite: false, side: THREE.DoubleSide }),
        line: new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.8 }), // the rim outside the ribbon
        edge: new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 }),
        pattern: new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.8 }),
      });
    }
    return fpMats.get(id);
  }
  const layoutGroup = new THREE.Group();
  layoutGroup.name = 'layout';
  root.add(layoutGroup);
  const fills = []; // the picks: top faces and walls
  const footprints = new Map(); // id -> {fp, group, walls, centre, east, west}
  let selected = null; // the footprint the handles sit on; selecting any footprint selects the whole layout
  const stem = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }));
  stem.renderOrder = 3;
  stem.raycast = () => {}; // decoration (and empty until a footprint is selected); the globe controls raycast the scene
  root.add(stem);
  const css2d = []; // every CSS2DObject's element, removed on dispose
  const label2d = (el, cx = 0.5, cy = 0.5) => {
    const o = new CSS2DObject(el);
    o.center.set(cx, cy);
    root.add(o);
    css2d.push(el);
    return o;
  };
  const handleButton = (cls, title, label, svg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.title = title;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    return b;
  };
  const handleEl = handleButton('site-handle', 'Drag to turn the layout (or hold R and drag a footprint)', 'Turn the layout',
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19.5 3.5v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  const moveEl = handleButton('site-move', 'Drag to move the layout', 'Move the layout',
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  const handle = label2d(handleEl);
  const mover = label2d(moveEl);
  handle.visible = mover.visible = stem.visible = false;
  const tags = new Map(); // footprint id -> CSS2DObject: icon and name, so the colour is never the only cue
  function tagFor(id) {
    if (!tags.has(id)) {
      const el = document.createElement('span');
      el.className = 'fp-tag';
      el.dataset.footprint = id;
      tags.set(id, label2d(el, 1, 0.5)); // the tag's right end sits on the plot's west edge
      paintTag(id);
    }
    return tags.get(id);
  }
  function paintTag(id) {
    const t = tags.get(id);
    if (!t) return;
    const st = fpStatus.get(id) || 'unresolved';
    const icon = document.createElement('span');
    icon.className = 'st-icon';
    icon.textContent = FOOTPRINT_ICONS[st];
    t.element.className = 'fp-tag fp-' + st;
    t.element.replaceChildren(icon, ' ' + (FOOTPRINT_NAMES[id] || id));
  }
  // The base stays in view as a marker on the ground (spec, Visual design).
  const regionName = ((site.catalog && site.catalog.regions) || []).find((r) => r.id === site.regionId);
  const baseEl = document.createElement('div');
  baseEl.className = 'base-pin';
  const bdot = document.createElement('span');
  bdot.className = 'bdot';
  const blabel = document.createElement('span');
  blabel.className = 'blabel';
  blabel.textContent = (regionName ? regionName.name : 'The') + ' base';
  baseEl.append(bdot, blabel);
  const baseMark = label2d(baseEl, 1, 0.5); // the label hangs to the left of the base
  if (site.base) {
    const h = elevationAt(site, site.base.lon, site.base.lat);
    baseMark.position.copy(frame.toLocal(site.base.lon, site.base.lat, Number.isFinite(h) ? h : frame.elevRef));
  } else baseMark.visible = false;

  let outlineM = 2; // ribbon width in true-scale metres, kept about OUTLINE_PX on screen by fitOutlines

  function rebuildLayout(lay) {
    for (const c of [...layoutGroup.children]) {
      layoutGroup.remove(c);
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    fills.length = 0;
    footprints.clear();
    for (const fp of lay.footprints) {
      const o = footprintObject(frame, fp, matsFor(fp.id), outlineM);
      layoutGroup.add(o.group);
      fills.push(...o.picks);
      footprints.set(fp.id, { ...o, fp });
      tagFor(fp.id).position.set(o.west.x, o.west.y, o.west.z);
    }
    for (const [id, t] of tags) if (!footprints.has(id)) { t.visible = false; t.userData.gone = true; } else t.userData.gone = false;
    if (selected && !footprints.has(selected)) selected = footprints.has('compound') ? 'compound' : null;
    placeHandles();
    showHandles();
  }
  // Move handle on the selected footprint's top, turn handle and its stem past its east side (turning with the layout).
  function placeHandles() {
    const f = selected && footprints.get(selected);
    if (!f) return;
    const { centre: c, east: ex, fp } = f;
    mover.position.set(c.x, c.y + BOX_M + TOP_LIFT_M, c.z);
    const a = { x: c.x + ex.x * fp.w / 2, z: c.z + ex.z * fp.w / 2 };
    const b = { x: c.x + ex.x * (fp.w / 2 + HANDLE_GAP_M), z: c.z + ex.z * (fp.w / 2 + HANDLE_GAP_M) };
    const ya = frame.heightAt(a.x, a.z), yb = frame.heightAt(b.x, b.z);
    const yy = (y) => (Number.isFinite(y) ? y : c.y) + BOX_M + TOP_LIFT_M;
    stem.geometry.dispose();
    stem.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, yy(ya), a.z), new THREE.Vector3(b.x, yy(yb), b.z)]);
    handle.position.set(b.x, yy(yb), b.z);
  }
  // Metres per screen pixel at the compound, or NaN when that cannot be known (no compound, no canvas size).
  const _c = new THREE.Vector3();
  function metresPerPixel() {
    const f = footprints.get('compound') || footprints.values().next().value;
    if (!f) return NaN;
    const cam = globe.camera;
    root.localToWorld(_c.set(f.centre.x, f.centre.y, f.centre.z));
    return (2 * _c.distanceTo(cam.position) * Math.tan((cam.fov * DEG) / 2)) / canvas.clientHeight;
  }
  // The handles show on the selected footprint once the compound is big enough on screen that they sit on it rather
  // than over the whole layout; the tags once the plots are big enough to tell apart.
  function showHandles() {
    const c = footprints.get('compound'), px = (c ? c.fp.w : 60) / metresPerPixel();
    handle.visible = mover.visible = stem.visible = !!selected && footprints.has(selected) && px >= HANDLE_MIN_PX;
    for (const t of tags.values()) t.visible = !t.userData.gone && px >= TAG_MIN_PX;
  }
  // Keep the outline ribbons about OUTLINE_PX wide on screen as the camera moves (cheap: a few hundred vertices).
  function fitOutlines() {
    const mpp = metresPerPixel();
    if (!(mpp > 0 && Number.isFinite(mpp))) return;
    const w = clamp(OUTLINE_PX * mpp, OUTLINE_MIN_M, OUTLINE_MAX_M);
    if (Math.abs(w / outlineM - 1) > OUTLINE_REBUILD) { outlineM = w; rebuildLayout(layout); }
  }
  // Colours from each plot's own checks (main.js passes ui/card.js footprintStatus); only the materials change.
  function setFootprintStatus(map) {
    for (const id of new Set([...Object.keys(map || {}), ...fpMats.keys()])) {
      const st = FOOTPRINT_COLOURS[map && map[id]] ? map[id] : 'unresolved';
      if (fpStatus.get(id) === st && fpMats.has(id)) continue;
      fpStatus.set(id, st);
      const m = matsFor(id), c = new THREE.Color(FOOTPRINT_COLOURS[st]);
      for (const k of ['fill', 'ribbon', 'edge', 'pattern']) m[k].color.copy(c);
      paintTag(id);
    }
  }
  function paintSelection() {
    for (const m of fpMats.values()) m.line.color.setHex(selected ? ACCENT : INK);
  }
  function select(id) {
    if (selected === id) return;
    selected = footprints.has(id) ? id : null;
    paintSelection();
    placeHandles();
    showHandles();
  }
  function deselect() { select(null); }
  rebuildLayout(layout);

  // Tab from the map reaches the layout through this (visually hidden) button; focusing it selects the layout.
  const focusEl = document.createElement('button');
  focusEl.type = 'button';
  focusEl.className = 'sr-only layout-focus';
  focusEl.textContent = 'Facility layout';
  focusEl.setAttribute('aria-label', 'Facility layout: arrow keys move it 5 m, [ and ] turn it 15°, Escape deselects');
  canvas.after(focusEl);
  const onFocusLayout = () => { if (!selected) select('compound'); moveEl.classList.add('focused'); };
  const onBlurLayout = () => moveEl.classList.remove('focused');
  focusEl.addEventListener('focus', onFocusLayout);
  focusEl.addEventListener('blur', onBlurLayout);

  let finals = 0;
  const offStore = layoutStore.onLayoutChange((id, lay, opts) => {
    if (id !== site.id || disposed) return;
    layout = lay;
    rebuildLayout(lay);
    if (opts && opts.final) finals += 1;
    if (onLayoutChange) onLayoutChange(id, lay, opts || { final: true });
  });

  // ---- pointer: drag, rotate, hover ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const readout = createReadout(document.body);
  let drag = null, hover = null, rHeld = false;

  function setRay(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, globe.camera);
  }
  function ground(x, y) { // root-local (true-scale) point on the terrain under a client position
    setRay(x, y);
    const hit = ray.intersectObjects(surfaces, false)[0];
    return hit ? root.worldToLocal(hit.point.clone()) : null;
  }
  function footprintUnder(x, y) {
    setRay(x, y);
    const hit = ray.intersectObjects(fills, false)[0];
    return hit ? hit.object.userData.footprintId : null;
  }
  const centreLocal = () => frame.toLocal(layout.placement.centerLon, layout.placement.centerLat, frame.elevRef);
  const specsOf = (lay) => lay.footprints.map((f) => ({ id: f.id, w: f.w, h: f.h }));

  function placementFor(d, x, y) {
    const v = ground(x, y);
    if (!v) return null;
    const p = layout.placement;
    if (d.mode === 'move') {
      const ll = frame.toLonLat({ x: v.x - d.grab.x, y: 0, z: v.z - d.grab.z });
      return { centerLon: ll.lon, centerLat: ll.lat, rotationDeg: p.rotationDeg };
    }
    // the turn handle, or R + drag: the layout turns by the change in bearing round its centre
    const b = bearing(centreLocal(), v);
    return { centerLon: p.centerLon, centerLat: p.centerLat, rotationDeg: norm360(d.rot0 + (b - d.bearing0)) };
  }
  function commit(placement, final) {
    layoutStore.set(site.id, clampPlacement(site, specsOf(layout), placement), { final });
  }
  function startDrag(e, mode, target) {
    const v = ground(e.clientX, e.clientY);
    const c = centreLocal();
    e.stopImmediatePropagation();
    e.preventDefault();
    try { target.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointers */ }
    drag = {
      mode, target, pointerId: e.pointerId, pending: null, moved: false, controls: globe.controls.enabled,
      grab: v ? { x: v.x - c.x, z: v.z - c.z } : { x: 0, z: 0 },
      bearing0: v ? bearing(c, v) : 0, rot0: layout.placement.rotationDeg,
    };
    globe.controls.enabled = false;
    readout.hide();
    canvas.style.cursor = 'grabbing';
  }
  function endDrag() {
    const d = drag;
    drag = null;
    try { d.target.releasePointerCapture(d.pointerId); } catch (_) { /* already released */ }
    globe.controls.enabled = d.controls;
    canvas.style.cursor = '';
  }
  // A press on a footprint selects the layout and drags it; a press anywhere else is the camera's, and deselects.
  function onDown(e) {
    if (e.button !== 0 || drag || !e.isPrimary) return;
    const id = footprintUnder(e.clientX, e.clientY);
    if (!id) { deselect(); return; }
    select(id);
    focusEl.focus({ preventScroll: true });
    startDrag(e, rHeld ? 'turn' : 'move', canvas);
  }
  function onMove(e) {
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      drag.pending = { x: e.clientX, y: e.clientY };
      e.stopImmediatePropagation();
      return;
    }
    hover = { x: e.clientX, y: e.clientY };
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopImmediatePropagation();
    const d = drag;
    const p = d.moved || d.pending ? placementFor(d, e.clientX, e.clientY) : null;
    endDrag();
    if (p) commit(p, true);
    else if (d.moved) commit(layout.placement, true);
  }
  function onLeave() { hover = null; readout.hide(); }
  const onHandleDown = (mode) => (e) => {
    if (e.button !== 0 || drag) return;
    focusEl.focus({ preventScroll: true });
    startDrag(e, mode === 'move' && rHeld ? 'turn' : mode, e.currentTarget);
  };
  const onMoveDown = onHandleDown('move'), onTurnDown = onHandleDown('turn');
  const onKey = (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    // typing an R into a field is not the rotate key; a release anywhere still ends the rotate mode
    const t = e.target;
    if (e.type === 'keydown' && t && t.matches && t.matches('input, textarea, select')) return;
    rHeld = e.type === 'keydown';
  };
  // With the layout selected and the map focused: arrows move it 5 m (east, west, north, south), [ and ] turn it 15°,
  // Escape deselects. Each key is a final change, clamped like a drag, so every check (BT-01 too) reruns.
  const onLayoutKey = (e) => {
    if (!selected || e.ctrlKey || e.metaKey || e.altKey || !mapHasFocus()) return;
    if (e.key === 'Escape') { deselect(); return; }
    const p = layout.placement, kx = M_PER_DEG * Math.cos(p.centerLat * DEG);
    const move = { ArrowRight: [STEP_M, 0], ArrowLeft: [-STEP_M, 0], ArrowUp: [0, STEP_M], ArrowDown: [0, -STEP_M] }[e.key];
    const turn = { ']': TURN_DEG, '[': -TURN_DEG }[e.key];
    if (!move && !turn) return;
    e.preventDefault();
    if (drag) return;
    commit(move
      ? { ...p, centerLon: p.centerLon + move[0] / kx, centerLat: p.centerLat + move[1] / M_PER_DEG }
      : { ...p, rotationDeg: norm360(p.rotationDeg + turn) }, true);
  };
  const onBlur = () => { rHeld = false; };
  const onHandleWheel = (e) => { // scrolling over a handle still zooms the globe
    e.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', e));
  };
  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove, { capture: true });
  canvas.addEventListener('pointerup', onUp, { capture: true });
  canvas.addEventListener('pointercancel', onUp, { capture: true });
  canvas.addEventListener('pointerleave', onLeave);
  for (const [el, down] of [[handleEl, onTurnDown], [moveEl, onMoveDown]]) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onHandleWheel, { passive: false });
  }
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);
  addEventListener('keydown', onLayoutKey);
  addEventListener('blur', onBlur);

  const g = site.grids || {};
  const cellValue = (grid, lon, lat) => {
    if (!grid) return NaN;
    const c = cellOf(grid, lon, lat);
    if (!c) return NaN;
    const v = grid.data[c.row * grid.width + c.col];
    return v === v && v !== grid.nodata ? v : NaN;
  };
  function showHover(x, y) {
    const v = ground(x, y);
    if (!v) { readout.hide(); canvas.style.cursor = ''; return; }
    canvas.style.cursor = footprintUnder(x, y) ? 'grab' : '';
    const { lon, lat } = frame.toLonLat(v);
    const inside = inBox(site.bounds, lon, lat);
    const eg = inside && g.elevation ? g.elevation : site.tripArea;
    readout.show({
      title: inside ? site.name : 'Around ' + site.name,
      lon, lat, positionEvidence: eg && eg.evidence,
      rows: [
        { label: 'Elevation', value: elevationAt(site, lon, lat), digits: 1, unit: 'm', evidence: eg && eg.evidence },
        { label: 'Slope (10 m)', value: inside ? cellValue(g.slope10, lon, lat) : NaN, digits: 1, unit: '°', evidence: g.slope10 && g.slope10.evidence },
        { label: 'Roughness', value: inside ? cellValue(g.roughness, lon, lat) : NaN, digits: 2, unit: 'm', evidence: g.roughness && g.roughness.evidence },
      ],
    }, x, y);
  }

  const offFrame = globe.onFrame(() => {
    if (drag && drag.pending) {
      const pt = drag.pending;
      drag.pending = null;
      const p = placementFor(drag, pt.x, pt.y);
      if (p) { drag.moved = true; commit(p, false); }
    } else if (hover && !drag) {
      const pt = hover;
      hover = null;
      showHover(pt.x, pt.y);
    }
    if (!drag) { fitOutlines(); showHandles(); }
    if (siteDrape) siteDrape.flush();
    if (tripDrape) tripDrape.flush();
  });

  globe.scene.add(group);
  group.updateMatrixWorld(true);
  const openMs = performance.now() - t0;

  // ---- debug and test hooks ----
  const screenOf = (local) => {
    const w = root.localToWorld(local.clone()).project(globe.camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((w.x + 1) / 2) * r.width, y: r.top + ((1 - w.y) / 2) * r.height };
  };
  const onGround = (lon, lat, lift = 0) => {
    const v = frame.toLocal(lon, lat, elevationAt(site, lon, lat));
    v.y += lift;
    return v;
  };
  const verts = (geo) => (geo ? geo.attributes.position.count : 0);
  const debug = {
    site: () => ({ id: site.id, bounds: site.bounds.slice() }),
    stats: () => ({
      terrain: verts(S && S.geometry), tripTerrain: verts(T && T.geometry),
      terrainSkirt: verts(S && S.skirt), tripSkirt: verts(T && T.skirt),
      terrainTriangles: S ? S.quads * 2 : 0, tripTriangles: T ? T.quads * 2 : 0,
      pickTriangles: (SP ? SP.quads * 2 : 0) + (TP ? TP.quads * 2 : 0),
      siteStride: S ? S.stride : null, tripStride: T ? T.stride : null, tripWindow: T ? T.window : null, openMs,
    }),
    drape: () => {
      const st = (d) => {
        if (!d) return null;
        const im = imagery.find((x) => x.drape === d);
        return { ...d.stats, outside: im ? im.outside : 0, missing: im ? im.missing : null };
      };
      return { mode: useHirise ? 'hirise' : 'elevation', site: st(siteDrape), trip: st(tripDrape),
        done: (!siteDrape || siteDrape.stats.done) && (!tripDrape || tripDrape.stats.done) };
    },
    footprintScreen(id) {
      const fp = layout.footprints.find((f) => f.id === id);
      if (!fp) return null;
      return screenOf(onGround(fp.center.lon, fp.center.lat, FILL_LIFT_M));
    },
    handleScreen: () => screenOf(handle.position),
    lonLatScreen: (lon, lat) => screenOf(onGround(lon, lat)),
    groundAt: (lon, lat) => root.localToWorld(onGround(lon, lat)).length() - R, // drawn height above the sphere
    finals: () => finals,
    selected: () => selected,
    // [{id, box, heightM, heightMaxM, opacity, colour}]: the wall heights as drawn (root-local, under the exaggeration)
    footprints: () => [...footprints.values()].map((f) => {
      const a = f.walls.geometry.attributes.position.array;
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < a.length; k += 6) { const d = a[k + 4] - a[k + 1]; lo = Math.min(lo, d); hi = Math.max(hi, d); }
      const m = fpMats.get(f.fp.id);
      return { id: f.fp.id, box: a.length > 0, heightM: lo, heightMaxM: hi, opacity: m.fill.opacity, colour: '#' + m.fill.color.getHexString() };
    }),
  };

  // The fly-in target: the layout's bounding-box centre and the drawn ground there (main.js flies 700 m above it).
  function flyTarget() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of layout.footprints) {
      for (const [lo, la] of f.polygon) { x0 = Math.min(x0, lo); x1 = Math.max(x1, lo); y0 = Math.min(y0, la); y1 = Math.max(y1, la); }
    }
    const lon = (x0 + x1) / 2, lat = (y0 + y1) / 2, ground = debug.groundAt(lon, lat);
    return { lon, lat, targetAltM: Number.isFinite(ground) ? ground : 0 };
  }

  // ---- the Terrain view (Task 9c): the site terrain coloured by slope_10m_window ----
  const SLOPE_LINEAR = SLOPE_CLASSES.map((c) => new THREE.Color(c.colour));
  let slopeOn = false, slopePainted = false, slopeShare = 0;
  function paintSlope() {
    const g = site.grids && site.grids.slope10, v = new THREE.Vector3();
    for (const geo of [S.geometry, S.skirt]) {
      const pos = geo.attributes.position, col = geo.attributes.slopeColor.array;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const ll = frame.toLonLat(v), cell = cellOf(g, ll.lon, ll.lat);
        const val = cell ? g.data[cell.row * g.width + cell.col] : NaN;
        const k = slopeClass(val === g.nodata ? NaN : val);
        if (k < 0) { col[4 * i + 3] = 0; continue; }
        const c = SLOPE_LINEAR[k];
        col[4 * i] = c.r; col[4 * i + 1] = c.g; col[4 * i + 2] = c.b; col[4 * i + 3] = 1;
      }
      geo.attributes.slopeColor.needsUpdate = true;
    }
    const drawn = drawnVertices(S.geometry), a = S.geometry.attributes.slopeColor.array; // share of drawn vertices with a class
    let n = 0, hit = 0;
    for (let i = 0; i < drawn.length; i++) if (drawn[i]) { n += 1; if (a[4 * i + 3] > 0) hit += 1; }
    slopeShare = n ? hit / n : 0;
  }
  // On: blend the slope classes over the photo or ramp at SLOPE_MIX. Off: the terrain exactly as before. A site with no
  // slope grid stays uncoloured (the view's key says so).
  function setSlopeColouring(on) {
    if (disposed || !S) return;
    const can = !!(on && site.grids && site.grids.slope10);
    if (can && !slopePainted) { paintSlope(); slopePainted = true; }
    slopeOn = can;
    slopeMix.value = can ? SLOPE_MIX : 0;
  }
  debug.slope = () => ({ on: slopeOn, share: slopeShare, mix: slopeMix.value });

  function setExaggeration(k) {
    root.scale.y = k;
    root.updateMatrixWorld(true);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    problemListeners.clear();
    if (drag) endDrag();
    abort.abort();
    offStore();
    offFrame();
    canvas.removeEventListener('pointerdown', onDown, { capture: true });
    canvas.removeEventListener('pointermove', onMove, { capture: true });
    canvas.removeEventListener('pointerup', onUp, { capture: true });
    canvas.removeEventListener('pointercancel', onUp, { capture: true });
    canvas.removeEventListener('pointerleave', onLeave);
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKey);
    removeEventListener('keydown', onLayoutKey);
    removeEventListener('blur', onBlur);
    readout.dispose();
    for (const el of css2d) el.remove(); // CSS2DObject only removes its element when it is the object removed
    focusEl.remove();
    globe.scene.remove(group);
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const s of [SP, TP]) if (s) s.geometry.dispose();
    for (const m of [...materials, ...[...fpMats.values()].flatMap((x) => Object.values(x)), stem.material]) m.dispose();
    for (const d of [siteDrape, tripDrape]) if (d) d.texture.dispose();
    canvas.style.cursor = '';
  }

  return {
    root, terrain, tripTerrain, frame, site, setExaggeration, dispose, debug, setFootprintStatus, flyTarget, deselect, setSlopeColouring,
    get selected() { return selected; },
    // [{kind: 'imagery_incomplete' | 'no_elevation' | 'data_failed', message, datasetId?}]
    get problems() { return problems.slice(); },
    onProblems(cb) { problemListeners.add(cb); return () => problemListeners.delete(cb); },
  };
}
