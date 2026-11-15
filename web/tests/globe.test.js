import { catalogFromRaw } from '../src/catalog.js';
import * as THREE from 'three';
import { overlaySpec, cameraPose, R as GLOBE_R } from '../src/globe.js';

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/';
const live = (url, o = {}) => ({ url_template: url, scheme: 'wmts-eq', min_zoom: 0, max_zoom: 12, cors: '*', ...o });
const fixture = () => catalogFromRaw({
  areas: {},
  datasets: [
    { id: 'imagery_ctx', coverage: { bounds: [135.18, -6.57, 139.24, -2.81] },
      live: live(TREK + 'Gale_CTX_BlockAdj_dd/1.0.0/default/default028mm/{z}/{y}/{x}.png') },
    { id: 'labels', live: live('https://mars.nasa.gov/x/{z}/{x}/{y}.png', { scheme: 'tms-webmercator' }) },
    { id: 'point', live: live(TREK + 'a/{z}/{y}/{x}.png', { cors: 'echoes Origin' }) },
    { id: 'no_live' },
  ],
}, {}, 'http://fixture.test/data/');

const throws = (fn) => { try { fn(); } catch (e) { return String(e.message || e); } return null; };

test('globe overlaySpec: url is the catalog template, levels = max_zoom + 1, bounds from coverage', () => {
  const s = overlaySpec(fixture(), 'imagery_ctx');
  assertEq(s.url, TREK + 'Gale_CTX_BlockAdj_dd/1.0.0/default/default028mm/{z}/{y}/{x}.png');
  assertEq(s.levels, 13);
  assertEq(s.bounds, [135.18, -6.57, 139.24, -2.81]);
});

test('globe overlaySpec: rejects layers the globe cannot draw', () => {
  const c = fixture();
  assert(/wmts-eq/.test(throws(() => overlaySpec(c, 'labels')) || ''), 'tms-webmercator rejected');
  assert(/cors/i.test(throws(() => overlaySpec(c, 'point')) || ''), 'non-* CORS rejected');
  assert(/no live layer/.test(throws(() => overlaySpec(c, 'no_live')) || ''), 'missing live block rejected');
  assert(/no live layer/.test(throws(() => overlaySpec(c, 'absent')) || ''), 'unknown id rejected');
});

// ---- camera pose (R14: flyTo tilt) ----

const D = Math.PI / 180;
const enuAt = (lon, lat) => ({
  e: new THREE.Vector3(-Math.sin(lon * D), Math.cos(lon * D), 0),
  n: new THREE.Vector3(-Math.sin(lat * D) * Math.cos(lon * D), -Math.sin(lat * D) * Math.sin(lon * D), Math.cos(lat * D)),
  u: new THREE.Vector3(Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)),
});

test('globe cameraPose: no tilt is the old nadir view, north up', () => {
  const p = cameraPose(137.44, -4.57, 4000);
  const { n, u } = enuAt(137.44, -4.57);
  assert(p.position.distanceTo(u.clone().multiplyScalar(GLOBE_R + 4000)) < 1e-6, 'straight above');
  assert(p.target.distanceTo(u.clone().multiplyScalar(GLOBE_R)) < 1e-6, 'looks at the surface point');
  assert(p.up.distanceTo(n) < 1e-9, 'north up');
});

test('globe cameraPose: tilt pitches the view away from straight down, altitude kept', () => {
  const p = cameraPose(137.44, -4.57, 4000, { tiltDeg: 50 });
  const { n, u } = enuAt(137.44, -4.57);
  const look = p.target.clone().sub(p.position).normalize();
  assertClose(look.angleTo(u.clone().negate()) / D, 50, 1e-6, 'pitch from nadir');
  assertClose(p.position.length() - GLOBE_R, 4000, 5, 'altitude about altM');
  assert(p.position.clone().sub(p.target).dot(n) < 0, 'heading 0: the camera is south of the target, looking north');
  assertClose(p.up.dot(look), 0, 1e-9, 'up is perpendicular to the view');
  const east = cameraPose(137.44, -4.57, 4000, { tiltDeg: 50, headingDeg: 90 });
  const { e } = enuAt(137.44, -4.57);
  assert(east.target.clone().sub(east.position).dot(e) > 0, 'heading 90 looks east');
  const raised = cameraPose(137.44, -4.57, 4000, { tiltDeg: 50, targetAltM: 1200 });
  assertClose(raised.target.length() - GLOBE_R, 1200, 1e-6, 'target height');
  assertClose(raised.position.length() - GLOBE_R, 5200, 6, 'altM is measured from the target');
});
