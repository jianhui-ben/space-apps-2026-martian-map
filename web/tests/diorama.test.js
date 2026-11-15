import { STATUS } from '../src/status.js';
import { calloutContent, plaqueModel, CALLOUTS } from '../src/diorama.js';
import { profileLine } from '../src/ui/profiles.js';
import { makeGrid, fixtureSite } from './fixtures.js';

const IDS = /\b(BT|GI|SC|TC|IR)-\d\d\b/;
const metrics = [
  { id: 'BT-05', factor: 'BT', name: 'Steep share under the compound' },
  { id: 'TC-01', factor: 'TC', name: 'Temperature cases covered' },
];

test('diorama callouts: plain factor names and sentences, an icon with every status, no metric ids', () => {
  const compound = CALLOUTS.find((c) => c.footprint === 'compound');
  const fail = calloutContent(compound, new Map([['BT-05', { id: 'BT-05', status: STATUS.NOT_MET }]]), metrics);
  assertEq(fail.cls, 'bad');
  assert(fail.html.includes('✗') && fail.html.includes('Compound · Terrain') && fail.html.includes('Too steep in places under the compound'), fail.html);
  assert(!IDS.test(fail.html), fail.html);
  const thermal = calloutContent(CALLOUTS.find((c) => c.footprint === 'radiator'),
    new Map([['TC-01', { id: 'TC-01', status: STATUS.NEEDS_FIELDWORK }]]), metrics);
  assertEq(thermal.cls, 'open'); // missing evidence never reads as fine
  assert(thermal.html.includes('?') && thermal.html.includes('Radiator plot · Thermal') && !IDS.test(thermal.html), thermal.html);
  assertEq(CALLOUTS.map((c) => c.footprint).sort(), ['compound', 'radiator', 'solar']);
});

test('diorama plaque: the site name, the priority and the plain verdict', () => {
  const p = plaqueModel({ site: { id: 's', name: 'Near base, north (crater floor)' }, row: { priority: 2, failures: ['BT-05'], criticalUnknowns: [] },
    results: new Map(), metrics, regionName: 'Gale crater' });
  assertEq([p.name, p.place, p.priority, p.failed], ['Near base, north', 'Gale crater · candidate site', 'Priority 2', true]);
  assertEq(p.verdict, 'Not recommended: too steep in places under the compound');
  assertEq(plaqueModel({ site: { id: 's', name: 'S' }, row: null, results: new Map(), metrics }).priority, 'not ranked yet');
});

test('diorama profiles: west-east and south-north lines across the box, gaps stay NaN, footprints become bands', async () => {
  const site = await fixtureSite();
  const [w, s, e, n] = site.bounds;
  const c = { lon: (w + e) / 2, lat: (s + n) / 2 };
  const fp = { id: 'compound', polygon: [[c.lon - (e - w) / 10, c.lat - (n - s) / 10], [c.lon + (e - w) / 10, c.lat - (n - s) / 10],
    [c.lon + (e - w) / 10, c.lat + (n - s) / 10], [c.lon - (e - w) / 10, c.lat + (n - s) / 10]] };
  const ew = profileLine(site, c, 'ew', { n: 51, footprints: [fp] });
  assertEq(ew.x.length, 51);
  assertClose(ew.x[0], 0, 1e-9);
  assert(ew.lengthM > 0 && Math.abs(ew.x[50] - ew.lengthM) < 1e-6);
  assertEq(ew.bands.length, 1);
  assert(ew.bands[0].x0 > ew.lengthM * 0.35 && ew.bands[0].x1 < ew.lengthM * 0.65, JSON.stringify(ew.bands));
  const ns = profileLine(site, c, 'ns', { n: 51 });
  assertEq(ns.lonLat[0][1], s);
  assertEq(ns.lonLat[50][1], n);
  // a grid with a hole in its west half: those samples are NaN, never 0 or flat
  const g = site.grids.elevation;
  const holed = makeGrid({ width: g.width, height: g.height, bounds: g.bounds, fn: (x) => (x < g.width / 2 ? NaN : 100 + x) });
  const gap = profileLine({ ...site, grids: { ...site.grids, elevation: holed }, tripArea: null }, c, 'ew', { n: 51 });
  assert(gap.missing > 0.3 && gap.missing < 0.7, gap.missing);
  assert(Number.isNaN(gap.elev[0]) && Number.isNaN(gap.slope[0]));
  assert(Number.isFinite(gap.elev[50]));
});
