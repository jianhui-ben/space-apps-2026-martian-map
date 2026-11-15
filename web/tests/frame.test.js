import * as THREE from 'three';
import { siteFrame } from '../src/frame.js';
import { siteFrame as siteFrameFromSite } from '../src/site.js';
import { sampleGrid } from '../src/catalog.js';
import { makeGrid, fixtureSite } from './fixtures.js';

const R = 3396190;
const DEG = Math.PI / 180;
const ecef = (lon, lat, r) => new THREE.Vector3(
  r * Math.cos(lat * DEG) * Math.cos(lon * DEG), r * Math.cos(lat * DEG) * Math.sin(lon * DEG), r * Math.sin(lat * DEG));

test('frame: 100 m north is z ≈ -100', async () => {
  const f = siteFrame(await fixtureSite());
  const v = f.toLocal(f.lon0, f.lat0 + 100 / R * 180 / Math.PI, f.elevRef);
  assertClose(v.z, -100, 0.01);
  assertClose(v.y, 0, 0.01);
  assertClose(v.x, 0, 1e-6);
});

test('frame: 100 m east is x ≈ 100, and height is y = h - elevRef at the centre', async () => {
  const f = siteFrame(await fixtureSite());
  const dLon = 100 / (R * Math.cos(f.lat0 * DEG)) / DEG;
  const v = f.toLocal(f.lon0 + dLon, f.lat0, f.elevRef);
  assertClose(v.x, 100, 0.01);
  assertClose(v.z, 0, 0.01); // a parallel bends toward the pole by d² tan(lat) / 2R, about 0.1 mm here
  const up = f.toLocal(f.lon0, f.lat0, f.elevRef + 37.5);
  assertClose(up.y, 37.5, 1e-6);
  assertClose(up.x, 0, 1e-6);
  assertClose(up.z, 0, 1e-6);
});

test('frame: centre is the site box centre; elevRef is the min over site and trip grids', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  const [w, s, e, n] = site.bounds;
  assertClose(f.lon0, (w + e) / 2, 1e-12);
  assertClose(f.lat0, (s + n) / 2, 1e-12);
  assertEq(f.elevRef, 0); // site grid 0.1c + 0.05r and trip grid = col both bottom out at 0
  const trip = site.tripArea;
  const lower = { ...trip, data: Float32Array.from(trip.data, (v, i) => (i === 7 ? -50 : v)) };
  assertEq(siteFrame({ ...site, tripArea: lower }).elevRef, -50);
  const gappy = { ...lower, data: Float32Array.from(lower.data, (v, i) => (i === 8 ? NaN : v)) };
  assertEq(siteFrame({ ...site, tripArea: gappy }).elevRef, -50); // NaN cells are skipped
});

test('frame: toLonLat inverts toLocal', async () => {
  const f = siteFrame(await fixtureSite());
  for (const [dl, dp, h] of [[0, 0, 0], [0.003, -0.002, 12.5], [-0.004, 0.0035, -3], [0.0101, 0.0099, 250]]) {
    const lon = f.lon0 + dl, lat = f.lat0 + dp;
    const back = f.toLonLat(f.toLocal(lon, lat, f.elevRef + h));
    assertClose(back.lon, lon, 1e-9, 'lon');
    assertClose(back.lat, lat, 1e-9, 'lat');
  }
});

test('frame: matrix matches the sphere position', async () => {
  const f = siteFrame(await fixtureSite());
  assert(f.matrix && f.matrix.isMatrix4, 'matrix is a Matrix4');
  for (const [dl, dp, h] of [[0, 0, 0], [0.002, 0.001, 30], [-0.006, -0.004, 4.25], [0.02, -0.015, 800]]) {
    const lon = f.lon0 + dl, lat = f.lat0 + dp, hh = f.elevRef + h;
    const world = f.toLocal(lon, lat, hh).applyMatrix4(f.matrix);
    const want = ecef(lon, lat, R + hh - f.elevRef);
    assert(world.distanceTo(want) < 0.01, 'off by ' + world.distanceTo(want) + ' m at ' + [dl, dp, h]);
  }
  // y is up, z is south: the local axes in world space
  const o = new THREE.Vector3().applyMatrix4(f.matrix);
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(f.matrix).sub(o);
  const south = new THREE.Vector3(0, 0, 1).applyMatrix4(f.matrix).sub(o);
  assert(up.angleTo(o) < 1e-9, 'local +y is the radial up at the centre');
  assert(south.dot(ecef(f.lon0, f.lat0 + 0.001, R).sub(o)) < 0, 'local +z points south');
});

test('frame: heightAt uses trip grid outside the site box and NaN beyond', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  const at = (lon, lat) => f.toLocal(lon, lat, f.elevRef);
  const yOf = (grid, lon, lat) => f.toLocal(lon, lat, sampleGrid(grid, lon, lat)).y;
  // inside the box: the 1 m site grid (0.1 col + 0.05 row ≈ 29.9 at the centre; the trip grid reads ≈ 19.5 there)
  const c = at(f.lon0, f.lat0);
  assertClose(f.heightAt(c.x, c.z), yOf(site.grids.elevation, f.lon0, f.lat0), 1e-3, 'centre');
  assert(Math.abs(f.heightAt(c.x, c.z) - yOf(site.tripArea, f.lon0, f.lat0)) > 5, 'not the trip grid inside the box');
  const inLon = f.lon0 + 0.0012, inLat = f.lat0 - 0.0015;
  const p = at(inLon, inLat);
  assertClose(f.heightAt(p.x, p.z), yOf(site.grids.elevation, inLon, inLat), 1e-3, 'inside');
  // 300 m east of the centre is outside the 400 m box but inside the trip grid
  const dLon = 300 / (R * Math.cos(f.lat0 * DEG)) / DEG;
  const q = at(f.lon0 + dLon, f.lat0);
  assert(Number.isNaN(sampleGrid(site.grids.elevation, f.lon0 + dLon, f.lat0)), 'test setup: outside the site grid');
  assertClose(f.heightAt(q.x, q.z), yOf(site.tripArea, f.lon0 + dLon, f.lat0), 1e-3, 'trip');
  // 2 km east is beyond the trip grid
  const far = at(f.lon0 + 2000 / (R * Math.cos(f.lat0 * DEG)) / DEG, f.lat0);
  assert(Number.isNaN(f.heightAt(far.x, far.z)), 'NaN beyond the trip grid');
  // a gap in the site grid reads NaN, never the trip value
  const holed = makeGrid({ width: 400, height: 400, bounds: site.bounds, fn: () => NaN });
  const g = siteFrame({ ...site, grids: { ...site.grids, elevation: holed } });
  assert(Number.isNaN(g.heightAt(c.x, c.z)), 'site gap is NaN');
});

test('frame: heightAt puts (x, heightAt, z) on the terrain toLocal gives', async () => {
  const site = await fixtureSite();
  const f = siteFrame(site);
  const lon = f.lon0 + 0.0013, lat = f.lat0 + 0.0011;
  const v = f.toLocal(lon, lat, sampleGrid(site.grids.elevation, lon, lat));
  assertClose(f.heightAt(v.x, v.z), v.y, 1e-3);
});

test('frame: needs no globe and site.js re-exports siteFrame', async () => {
  assertEq(siteFrameFromSite, siteFrame);
  const site = await fixtureSite();
  assert(!('frame' in site), 'getSite never sets a frame key');
});
