import { terrainChecks } from '../src/checks.js';
import { footprintSpecs, placeLayout } from '../src/layout.js';
import { makeGrid, fixtureSite } from './fixtures.js';

const M = 3396190 * Math.PI / 180;
const setup = { loadKw: 150, power: 'topup' };

async function setupSite(grids = {}, st = setup) {
  const site = await fixtureSite({ grids });
  const b = site.bounds;
  const layout = placeLayout(footprintSpecs(st), { centerLon: (b[0] + b[2]) / 2, centerLat: (b[1] + b[3]) / 2, rotationDeg: 0 });
  return { site, layout, run: (opts) => terrainChecks(site, layout, st, site.catalog.scenario, opts) };
}
const mk = (site, fn) => makeGrid({ width: 400, height: 400, bounds: site.bounds, fn });
// compound rows are 170..229, cols 170..229 at the site centre
const inCompound = (c, r) => c >= 170 && c < 230 && r >= 170 && r < 230;

test('BT-04 on a 3 degree tilted plane', async () => {
  const { site } = await setupSite();
  const mPerCol = (site.bounds[2] - site.bounds[0]) / 400 * M * Math.cos(-4.57 * Math.PI / 180);
  const { run } = await setupSite({ elevation: mk(site, (c) => c * mPerCol * Math.tan(3 * Math.PI / 180)) });
  const r = run().get('BT-04');
  assertClose(r.value, 3, 0.05);
  assertEq(r.status, 'met');
  assertEq(r.ideal, false);
  assertEq(r.evidence, 'derived');
  assertEq(r.assumption, true);
  assertEq(r.target.baseline, '≤ 5°');
  assertEq(r.target.ideal, '≤ 2°');
  assertEq(r.target.label, 'P');
  assertEq(r.appliesTo, 'layout');
});

test('BT-05 reads the slope10 max', async () => {
  const { site } = await setupSite();
  const { run } = await setupSite({ slope10: mk(site, (c, r) => (c === 200 && r === 200 ? 7 : 3)) });
  const r = run().get('BT-05');
  assertEq(r.value, 7);
  assertEq(r.status, 'met');
  assertEq(r.ideal, false);
});

test('BT-05 straddling the limit needs fieldwork', async () => {
  const { site } = await setupSite();
  const { run } = await setupSite({ slope10: mk(site, (c, r) => (c === 200 && r === 200 ? 9 : 3)) });
  assertEq(run().get('BT-05').status, 'needs_fieldwork');
});

test('BT-06 measures deviation from plane', async () => {
  const { site } = await setupSite();
  const { run } = await setupSite({ elevation: mk(site, (c, r) => (c === 200 && r === 200 ? 0.8 : 0)) });
  const r = run().get('BT-06');
  assertClose(r.value, 0.8, 0.05);
  assertEq(r.status, 'needs_design_input');
});

test('BT-02 falls to 75% when a quarter is steep', async () => {
  const { site } = await setupSite();
  const { run } = await setupSite({ slope10: mk(site, (c, r) => (inCompound(c, r) && r < 185 ? 15 : 3)) });
  const r = run().get('BT-02');
  assertClose(r.value, 75, 2);
  assertEq(r.status, 'not_met');
  assertEq(r.evidence, 'derived');
  assertEq(r.assumption, true);
});

test('BT-02, SC-10 and TC-08 met on flat ground', async () => {
  const { run } = await setupSite();
  const m = run();
  for (const id of ['BT-02', 'SC-10', 'TC-08']) {
    assertEq(m.get(id).value, 100, id);
    assertEq(m.get(id).status, 'met', id);
  }
});

test('SC-10 and TC-08 fail on their own plot', async () => {
  const { site } = await setupSite();
  // solar is south of the compound (rows > 230), radiator north (rows < 170)
  const { run } = await setupSite({ slope10: mk(site, (c, r) => (r > 260 ? 15 : r < 100 ? 15 : 3)) });
  const m = run();
  assertEq(m.get('BT-02').status, 'met');
  assertEq(m.get('SC-10').status, 'not_met');
  assertEq(m.get('TC-08').status, 'not_met');
});

test('base_only: SC-10 not_applicable', async () => {
  const { run } = await setupSite({}, { loadKw: 60, power: 'base_only' });
  const r = run().get('SC-10');
  assertEq(r.status, 'not_applicable');
  assertEq(r.note, 'no solar plot in this power option');
});

test('BT-01 flat site is met, boxed-in compound is not', async () => {
  const { run, site } = await setupSite();
  assertEq(run().get('BT-01').status, 'met');
  assertEq(run().get('BT-01').ideal, true);
  const boxed = await setupSite({ slope10: mk(site, (c, r) => (c >= 165 && c < 235 && r >= 165 && r < 235 ? 3 : 15)) });
  const r = boxed.run().get('BT-01');
  assertEq(r.status, 'not_met');
  assert(r.value < 0.5 && r.value > 0.2, 'ratio ' + r.value);
});

test('final:false omits BT-01', async () => {
  const { run } = await setupSite();
  const m = run({ final: false });
  assert(!m.has('BT-01'), 'no BT-01');
  assert(m.has('BT-02'), 'has BT-02');
});

test('NaN gap over 5% -> needs_confirmation', async () => {
  const { site } = await setupSite();
  const { run } = await setupSite({
    elevation: mk(site, (c, r) => (inCompound(c, r) && r < 178 ? NaN : 0)),
    slope10: mk(site, (c, r) => (inCompound(c, r) && r < 178 ? NaN : 3)),
  });
  const m = run();
  for (const id of ['BT-02', 'BT-04', 'BT-05', 'BT-06']) {
    assertEq(m.get(id).status, 'needs_confirmation', id);
    assertEq(m.get(id).note, 'elevation gaps under the layout', id);
  }
  assertEq(m.get('SC-10').status, 'met');
});

test('small NaN gap under 5% counts as unusable cells, not as fine', async () => {
  const { site } = await setupSite();
  const { run } = await setupSite({ slope10: mk(site, (c, r) => (c === 200 && r === 200 ? NaN : 3)) });
  const r = run().get('BT-02');
  assertEq(r.status, 'not_met');
});

test('numeric nodata counts as missing', async () => {
  const { site } = await setupSite();
  const g = makeGrid({ width: 400, height: 400, bounds: site.bounds, fn: (c, r) => (inCompound(c, r) ? -9999 : 3), nodata: -9999 });
  const { run } = await setupSite({ slope10: g });
  assertEq(run().get('BT-02').status, 'needs_confirmation');
});

test('null roughness grid -> BT-08 needs_confirmation "data failed to load"', async () => {
  const { run } = await setupSite({ roughness: null });
  const r = run().get('BT-08');
  assertEq(r.status, 'needs_confirmation');
  assertEq(r.note, 'data failed to load');
  assertEq(run().get('BT-02').status, 'met');
});

test('null slope grid blocks slope metrics', async () => {
  const { site } = await setupSite();
  const { run } = await setupSite({ slope10: null, elevation: mk(site, () => 0) });
  const m = run();
  for (const id of ['BT-01', 'BT-02', 'BT-05', 'SC-10', 'TC-08']) {
    assertEq(m.get(id).status, 'needs_confirmation', id);
    assertEq(m.get(id).note, 'data failed to load', id);
  }
  assertEq(m.get('BT-04').status, 'met');
});

test('BT-08 partial: never met, fails when rough', async () => {
  const { site } = await setupSite();
  const flat = await setupSite();
  assertEq(flat.run().get('BT-08').status, 'needs_fieldwork');
  const rough = await setupSite({ roughness: mk(site, (c, r) => (c === 200 && r === 200 ? 0.9 : 0.1)) });
  const r = rough.run().get('BT-08');
  assertEq(r.status, 'not_met');
  assertClose(r.value, 0.9, 1e-6);
});

test('BT-21 is the distance to base', async () => {
  const { run } = await setupSite();
  const r = run().get('BT-21');
  assertClose(r.value, 500, 1);
  assertEq(r.status, 'needs_design_input');
  assertEq(r.unit, 'm');
});
