import { loadCatalog, getSite } from '../src/catalog.js';
import { footprintSpecs, placeLayout, bestSpot } from '../src/layout.js';
import { terrainChecks } from '../src/checks.js';

test('real: near_base_north best spot meets BT-02 and BT-05', async () => {
  const site = await getSite(await loadCatalog('/data/'), 'near_base_north');
  const setup = { loadKw: 150, power: 'topup' };
  const specs = footprintSpecs(setup);
  const layout = placeLayout(specs, bestSpot(site, specs));
  const m = terrainChecks(site, layout, setup, site.catalog.scenario);
  for (const id of ['BT-01', 'BT-02', 'BT-04', 'BT-05', 'BT-06', 'BT-08', 'BT-21']) {
    const r = m.get(id);
    console.log('REAL', id, r.value, r.display, r.status, r.ideal, r.note);
  }
  assertEq(m.get('BT-02').status, 'met');
  assertEq(m.get('BT-05').status, 'met');
});
