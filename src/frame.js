// The site's local frame on the Mars sphere: x east, y up, z south, true-scale metres.
// It needs no globe: plain sphere math with R, so the navigation lane can build it from a Site alone.
import * as THREE from 'three';
import { sampleGrid } from './catalog.js';

const R = 3396190; // IAU Mars 2000 sphere, the catalog CRS
const DEG = Math.PI / 180;

function minFinite(grid) {
  if (!grid) return Infinity;
  const d = grid.data, nd = grid.nodata;
  let m = Infinity;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (v < m && v === v && v !== nd) m = v; // v === v skips NaN
  }
  return m;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const inBox = (b, lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

// Elevation (m, the grid's datum) at a point: the site grid inside the site box, the trip-area grid
// outside it, NaN elsewhere or in a gap. Inside the box the point is clamped to the site grid, whose
// bounds can differ from the box by a fraction of a cell.
export function elevationAt(site, lon, lat) {
  const g = site.grids && site.grids.elevation, trip = site.tripArea;
  if (inBox(site.bounds, lon, lat)) {
    if (g) return sampleGrid(g, clamp(lon, g.bounds[0], g.bounds[2]), clamp(lat, g.bounds[1], g.bounds[3]));
    return trip ? sampleGrid(trip, lon, lat) : NaN; // no site grid loaded: the coarser grid is all there is
  }
  return trip ? sampleGrid(trip, lon, lat) : NaN;
}

export function siteFrame(site) {
  const [w, s, e, n] = site.bounds;
  const lon0 = (w + e) / 2, lat0 = (s + n) / 2;
  const lo = Math.min(minFinite(site.grids && site.grids.elevation), minFinite(site.tripArea));
  const elevRef = Number.isFinite(lo) ? lo : 0;

  // East-north-up basis at (lat0, lon0) on the sphere, as plain numbers for double-precision maths.
  const cl = Math.cos(lat0 * DEG), sl = Math.sin(lat0 * DEG), cn = Math.cos(lon0 * DEG), sn = Math.sin(lon0 * DEG);
  const E = [-sn, cn, 0], N = [-sl * cn, -sl * sn, cl], U = [cl * cn, cl * sn, sl];
  const O = [R * U[0], R * U[1], R * U[2]];
  const enu = new THREE.Matrix4().makeBasis(new THREE.Vector3(...E), new THREE.Vector3(...N), new THREE.Vector3(...U))
    .setPosition(O[0], O[1], O[2]);
  // ENU is z-up; rotating +90 deg about x maps local (x, y, z) to ENU (x, -z, y): y up, z south.
  const matrix = enu.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

  // (lon, lat, h) -> local metres. y = h - elevRef at the centre; the sphere's curvature is included.
  function toLocal(lon, lat, h, target = new THREE.Vector3()) {
    const a = lat * DEG, b = lon * DEG, r = R + h - elevRef, ca = Math.cos(a);
    const dx = r * ca * Math.cos(b) - O[0], dy = r * ca * Math.sin(b) - O[1], dz = r * Math.sin(a) - O[2];
    return target.set(
      dx * E[0] + dy * E[1] + dz * E[2],
      dx * U[0] + dy * U[1] + dz * U[2],
      -(dx * N[0] + dy * N[1] + dz * N[2]));
  }

  // Local point -> the lon/lat straight below (or above) it on the sphere.
  function toLonLat(v) {
    const x = O[0] + E[0] * v.x + U[0] * v.y - N[0] * v.z;
    const y = O[1] + E[1] * v.x + U[1] * v.y - N[1] * v.z;
    const z = O[2] + E[2] * v.x + U[2] * v.y - N[2] * v.z;
    return { lon: Math.atan2(y, x) / DEG, lat: Math.atan2(z, Math.hypot(x, y)) / DEG };
  }

  // Local y of the terrain at local (x, z), so (x, heightAt(x, z), z) lies on the ground. NaN off the data.
  const tmp = new THREE.Vector3(), probe = { x: 0, y: 0, z: 0 };
  function heightAt(x, z) {
    probe.x = x; probe.z = z;
    let y = 0;
    for (let k = 0; k < 2; k++) { // the second pass corrects the lon/lat for the point's own height
      probe.y = y;
      const ll = toLonLat(probe);
      const h = elevationAt(site, ll.lon, ll.lat);
      if (!Number.isFinite(h)) return NaN;
      y = toLocal(ll.lon, ll.lat, h, tmp).y;
    }
    return y;
  }

  return { lon0, lat0, elevRef, matrix, toLocal, toLonLat, heightAt };
}
