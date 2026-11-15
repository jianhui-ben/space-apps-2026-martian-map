// Factor probes (probes.js): each factor's rows at a point, from small fixtures, and their no-data paths.
import { terrainRows, groundRows, solarRows, thermalRows, routesRows, gridAt, slopeAspect, tiltFactor, sunHoursAt, featureAt,
  nearestPoint, distanceToLines, gradeFromBase, distanceM, compassWord, simulatedIceDepth, SIMULATED } from '../src/probes.js';

const M_PER_DEG = 3396190 * Math.PI / 180;
const BOUNDS = [0, 0, 0.01, 0.01];
// a 10 x 10 grid of f(col, row), 0.001° cells
const gridOf = (f, w = 10, h = 10) => {
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = f(c, r);
  return { data, width: w, height: h, bounds: BOUNDS, pixelDeg: [0.001, 0.001], nodata: NaN };
};
const texts = (o) => Object.fromEntries(o.rows.map((r) => [r.label, r.text !== undefined ? r.text : r.value]));
const labels = (o) => o.rows.map((r) => r.label);
const noIds = (o) => assert(!/\b(BT|GI|SC|TC|IR)-\d\d\b/.test(JSON.stringify(o)), 'no metric ids in ' + JSON.stringify(o));

test('probe: grid cell, slope and aspect', () => {
  const g = gridOf((c) => c * 0.001 * M_PER_DEG * Math.tan(10 * Math.PI / 180)); // rises 10° to the east
  assertClose(gridAt(g, 0.0055, 0.0055), 5 * 0.001 * M_PER_DEG * Math.tan(10 * Math.PI / 180), 1e-3);
  assert(Number.isNaN(gridAt(g, 0.02, 0.005)), 'outside: NaN');
  const sa = slopeAspect(g, 0.0055, 0.0055);
  assertClose(sa.slopeDeg, 10, 0.05);
  assertClose(sa.aspectDeg, 270, 0.5); // downhill faces west
  const edge = slopeAspect(g, 0.0095, 0.0055);
  assert(Number.isNaN(edge.slopeDeg), 'no neighbour east: no data');
  assertEq(compassWord(270), 'west');
  assertEq(compassWord(NaN), 'no data');
});

test('probe: tilt factor and sun hours', () => {
  assertClose(tiltFactor(0, NaN, 30, 180), 1, 1e-9); // level ground: as level
  assert(tiltFactor(20, 180, 30, 180) > 1, 'facing the sun: more');
  assert(tiltFactor(20, 0, 30, 180) < 1, 'facing away: less');
  assert(Number.isNaN(tiltFactor(10, 90, -5, 180)), 'sun down: no data');
  const t = Array.from({ length: 48 }, (_, j) => j * 0.5);
  const table = { ls: [0, 180], ltst_h: t, elevation_deg: [0, 1].map(() => t.map((x) => 90 - Math.abs(x - 12) * 15)), azimuth_deg: [0, 1].map(() => t.map((x) => (x < 12 ? 90 : 270))) };
  const hz = { data: new Uint8Array(4 * 360), width: 2, height: 2, bands: 360, bounds: BOUNDS, pixelDeg: [0.005, 0.005], nodata: 255 };
  const flat = sunHoursAt(table, hz, 0.002, 0.002);
  assertClose(flat, 11.5, 0.6); // 6 h to 18 h, half-hour steps
  for (let az = 45; az < 135; az++) hz.data[az] = 120; // 30° skyline to the east at cell 0
  assert(sunHoursAt(table, hz, 0.002, 0.008) < flat, 'the eastern ridge costs morning sun');
  assert(Number.isNaN(sunHoursAt(null, hz, 0.002, 0.002)) && Number.isNaN(sunHoursAt(table, hz, 1, 1)), 'no table or outside: no data');
});

test('probe: features, nearest point, lines and grade', () => {
  const fc = { features: [{ properties: { Unit: 'Htu', UnitDesc: 'Hesperian transition unit' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }] };
  assertEq(featureAt(fc, 0.5, 0.5).properties.Unit, 'Htu');
  assertEq(featureAt(fc, 2, 2), null);
  const pts = { features: [{ geometry: { type: 'Point', coordinates: [0, 0.01] }, properties: {} }, { geometry: { type: 'Point', coordinates: [0, 0.1] }, properties: {} }] };
  assertClose(nearestPoint(pts, 0, 0).m, 0.01 * M_PER_DEG, 1);
  assertEq(nearestPoint({ features: [] }, 0, 0), null);
  assertClose(distanceToLines([[[0, -1], [0, 1]]], 0.001, 0), 0.001 * M_PER_DEG, 0.5);
  assert(Number.isNaN(distanceToLines([], 0, 0)), 'no lines: no data');
  const up = gradeFromBase((lon) => lon * M_PER_DEG * 0.1, { lon: 0, lat: 0 }, 0.001, 0); // 10% uphill east
  assertClose(up, Math.atan(0.1) * 180 / Math.PI, 0.05);
  assert(Number.isNaN(gradeFromBase(() => 0, null, 0, 0)), 'no base: no data');
  assertClose(distanceM(0, 0, 0, 0.001), 0.001 * M_PER_DEG, 1e-6);
});

test('probe: terrain rows', () => {
  const ok = terrainRows({ elevation: -4400, slope: 2, roughness: 0.1, onDune: false, ev: { slope: 'derived' } });
  assertEq(labels(ok), ['Elevation', 'Slope (10 m)', 'Roughness', 'On a dune field', 'Buildable here']);
  assert(texts(ok)['Buildable here'].startsWith('Yes'), texts(ok)['Buildable here']);
  assertEq(texts(ok)['On a dune field'], 'No');
  const steep = texts(terrainRows({ elevation: 0, slope: 8, roughness: 0.5, onDune: false }));
  assert(steep['Buildable here'].includes('steeper than 5°') && steep['Buildable here'].includes('rougher than 0.3 m'), steep['Buildable here']);
  assert(texts(terrainRows({ elevation: 0, slope: 1, roughness: 0.1, onDune: true }))['Buildable here'].startsWith('No: on a dune'));
  const none = texts(terrainRows({ elevation: NaN, slope: NaN, roughness: NaN, onDune: null }));
  assert(Number.isNaN(none.Elevation) && none['On a dune field'] === 'no data' && none['Buildable here'] === 'no data', JSON.stringify(none));
  noIds(ok);
});

test('probe: ground rows, ice simulated', () => {
  const o = groundRows({ unit: { code: 'Htu', name: 'Hesperian transition unit' }, mineral: { type: 'Hydrous Mineral Detection', instrument: 'OMEGA', m: 2500 },
    ti: 320, grs: { h2o: 5.4, sigma: 0.4 }, iceSim: 1.2 });
  const t = texts(o);
  assertEq(t['Geologic unit'], 'Hesperian transition unit (Htu)');
  assert(t['Nearest mineral find'].includes('2.50 km away'), t['Nearest mineral find']);
  assertEq(t['Water (5° cell)'], '5.4 ± 0.4 wt% H₂O');
  assertEq(o.rows.find((r) => r.label === 'Ground ice depth').evidence, SIMULATED);
  const none = texts(groundRows({ iceSim: NaN }));
  assert(none['Geologic unit'] === 'no data' && none['Nearest mineral find'] === 'no data' && Number.isNaN(none['Thermal inertia']) && none['Water (5° cell)'] === 'no data');
  assertEq(simulatedIceDepth('s', 137.4, -4.6), simulatedIceDepth('s', 137.4, -4.6)); // same point, same value
  noIds(o);
});

test('probe: solar, thermal and routes rows', () => {
  const s = texts(solarRows({ slope: 6, aspect: 180, factor: 1.12, sun: { elDeg: 50, azDeg: 0 }, sunHours: 11.2 }));
  assertEq(s['Ground faces'], 'south (180°)');
  assertEq(s['Worst-season noon sun'], '× 1.12 of level ground');
  assertEq(texts(solarRows({ slope: 0.2, aspect: 10 }))['Ground faces'], 'level');
  const sn = texts(solarRows({}));
  assert(sn['Ground faces'] === 'no data' && sn['Worst-season noon sun'] === 'no data' && Number.isNaN(sn['Sun above skyline']));
  const th = texts(thermalRows({ k: 250, caseName: 'day, aphelion', hour: 17 }));
  assertEq(th['Surface temperature'], '250 K (−23 °C)');
  assertEq(texts(thermalRows({ k: NaN, caseName: 'night, perihelion' }))['Surface temperature'], 'no data'); // never a number
  const r = texts(routesRows({ toBase: 1830, bearing: 0, grade: 3.2, toPath: 420, pathName: 'Curiosity\'s path' }));
  assertEq(r['To the base'], '1.83 km straight, north of it');
  assertEq(r['Grade from the base'], 'uphill 3.2°');
  assertEq(r['To Curiosity\'s path'], '420 m');
  const rn = texts(routesRows({}));
  assert(rn['To the base'] === 'no data' && rn['Grade from the base'] === 'no data' && rn['To the rover path'] === 'no data', JSON.stringify(rn));
  const all = [terrainRows({}), groundRows({}), solarRows({}), thermalRows({}), routesRows({})].map((o) => labels(o).join('|'));
  assertEq(new Set(all).size, 5);
});

test('probe overlays: rings round the base, the tilt ramp', async () => {
  const { baseRings, TILT_STOPS } = await import('../src/layers.js');
  const base = { lon: 137.4, lat: -4.6 }, k = M_PER_DEG * Math.cos(-4.6 * Math.PI / 180);
  const rings = baseRings(base, [137.4, -4.6, 137.4 + 1600 / k, -4.6 + 10 / M_PER_DEG], 500);
  assertEq(rings.length, 3); // 500, 1000, 1500 m reach a box 1.6 km east
  const [lon, lat] = rings[1][32]; // a quarter round: due east
  assertClose(distanceM(base.lon, base.lat, lon, lat), 1000, 1);
  assertEq(TILT_STOPS.map((s) => s[0]), [0.7, 1.0, 1.3]);
});
