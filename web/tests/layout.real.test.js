import { loadCatalog, getSite } from '../src/catalog.js';
import { footprintSpecs, placeLayout, bestSpot } from '../src/layout.js';

test('real: bestSpot on near_base_north under 500 ms and inside the site', async () => {
  const site = await getSite(await loadCatalog('/data/'), 'near_base_north');
  const specs = footprintSpecs({ loadKw: 150, power: 'topup' });
  const t0 = performance.now();
  const p = bestSpot(site, specs);
  const ms = performance.now() - t0;
  console.log('bestSpot ms', ms);
  assert(ms < 500, 'bestSpot took ' + ms.toFixed(0) + ' ms');
  const b = site.bounds;
  assert(p.centerLon > b[0] && p.centerLon < b[2] && p.centerLat > b[1] && p.centerLat < b[3], 'inside');
  const lay = placeLayout(specs, p);
  assert(lay.footprints.length === 3, 'three footprints');
});
