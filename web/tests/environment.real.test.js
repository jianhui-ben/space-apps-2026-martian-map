// Environment metrics on the real data (Task 12). window.__envReal collects the values for the report.
import { loadCatalog, getSite } from '../src/catalog.js';
import { footprintSpecs, placeLayout, bestSpot } from '../src/layout.js';
import { loadEnvironment, environmentChecks } from '../src/environment.js';

const TOPUP = { loadKw: 150, power: 'topup' };
const IDS = ['SC-01', 'SC-03', 'SC-04', 'TC-01', 'BT-15', 'BT-16', 'GI-05'];
window.__envReal = {};
async function checksAt(siteId) {
  const catalog = await loadCatalog('/data/');
  const site = await getSite(catalog, siteId);
  const specs = footprintSpecs(TOPUP), layout = placeLayout(specs, bestSpot(site, specs));
  const env = await loadEnvironment(catalog, site.regionId);
  const m = environmentChecks(site, layout, TOPUP, env);
  window.__envReal[siteId] = Object.fromEntries(IDS.map((id) => [id, m.get(id) && { value: m.get(id).value, display: m.get(id).display, status: m.get(id).status, note: m.get(id).note }]));
  return { m, env };
}

test('real: near_base_north SC-01 under 10% and SC-03 a finite kW', async () => {
  const { m, env } = await checksAt('near_base_north');
  assert(m.get('SC-01').value < 10 && m.get('SC-01').status === 'met', JSON.stringify(m.get('SC-01')));
  assert(Number.isFinite(m.get('SC-03').value) && m.get('SC-03').value > 0, JSON.stringify(m.get('SC-03')));
  assertEq(m.get('SC-04').status, 'needs_design_input');
  assertEq(env.ids.mcdSolar, 'dust_climate_mcd');
  const tc = m.get('TC-01');
  assert(tc.value >= 1 && tc.status === 'needs_fieldwork', JSON.stringify(tc));
  assert(Number.isFinite(m.get('BT-15').value) && m.get('BT-15').status === 'needs_fieldwork', JSON.stringify(m.get('BT-15')));
  assertClose(m.get('BT-16').value, 0.406, 1e-9);
  assert(/0\.4 m\/yr/.test(m.get('BT-16').note), m.get('BT-16').note);
});

test('real: GI-05 reads the Gale GRS bin', async () => {
  const { m } = await checksAt('near_base_north');
  const gi = m.get('GI-05');
  assertEq([gi.value, gi.status, gi.evidence], [5.415, 'needs_confirmation', 'observation']);
  assert(/SWIM ice data pending/.test(gi.note), gi.note);
});

test('real: jezero_north reads its own data and needs confirmation where it has none', async () => {
  const { m, env } = await checksAt('jezero_north');
  for (const [k, id] of Object.entries(env.ids)) assert(/__jezero$/.test(id), k + ' came from ' + id + ', not Jezero\'s copy');
  assertEq(m.get('BT-15').status, 'needs_confirmation'); // no dune fields mapped at Jezero: never fine, never Gale's
  assertEq(m.get('BT-16').status, 'needs_confirmation'); // no dune-change images at Jezero
  assert(Number.isFinite(m.get('SC-01').value), 'its own skyline: ' + JSON.stringify(m.get('SC-01')));
  assert(m.get('GI-05').value !== 5.415, 'its own GRS bin, not Gale\'s');
  assert(['needs_fieldwork', 'needs_confirmation'].includes(m.get('TC-01').status), JSON.stringify(m.get('TC-01')));
});
