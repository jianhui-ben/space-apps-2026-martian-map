import { createRecords, applyFieldRecords } from '../src/records.js';
import { initialStatuses, mergeResults } from '../src/status.js';
import { loadNavigation, replanStatuses, nextPlanArgs } from '../src/nav.js';

const metrics = (await (await fetch('../metrics.json')).json()).metrics;

// An in-memory stand-in for localStorage.
function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

const KEY = 'martian-map.records.v1';

test('records: field result overrides status', () => {
  const recs = createRecords(memStorage());
  const initial = initialStatuses(metrics, { loadKw: 150, power: 'topup' });
  const before = initial.get('BT-15').status;
  recs.addField({ siteId: 's1', stopId: 'stop-1', metricId: 'BT-15', value: 12, pass: true, note: 'ok' });
  recs.addField({ siteId: 's1', stopId: 'stop-2', metricId: 'BT-16', value: 3, pass: false, note: 'no' });
  recs.addField({ siteId: 's2', metricId: 'BT-17', pass: true });
  const out = applyFieldRecords(initial, recs.list(), 's1');
  assertEq(out.get('BT-15').status, 'met');
  assertEq(out.get('BT-15').evidence, 'observation');
  assertEq(out.get('BT-15').note, 'field result');
  assertEq(out.get('BT-15').assumption, false);
  assertEq(out.get('BT-15').value, 12);
  assertEq(out.get('BT-16').status, 'not_met');
  assertEq(out.get('BT-17').status, initial.get('BT-17').status, 'other site not applied');
  assertEq(initial.get('BT-15').status, before, 'input untouched');
  // An assumed computed value loses its assumption flag once a field result lands.
  const computed = new Map([['BT-15', { ...initial.get('BT-15'), status: 'needs_fieldwork', assumption: true }]]);
  assertEq(mergeResults(initial, computed, recs.list().filter((r) => r.siteId === 's1')).get('BT-15').assumption, false);
});

test('records: field record never overrides not_applicable', () => {
  const recs = createRecords(memStorage());
  const initial = initialStatuses(metrics, { loadKw: 60, power: 'base_only' });
  const sc = metrics.find((m) => m.factor === 'SC').id;
  assertEq(initial.get(sc).status, 'not_applicable');
  recs.addField({ siteId: 's1', metricId: sc, pass: true });
  const out = applyFieldRecords(initial, recs.list(), 's1');
  assertEq(out.get(sc).status, 'not_applicable');
  assertEq(out.get(sc).evidence, 'reference');
});

test('records: simulated tag never changes status', () => {
  const recs = createRecords(memStorage());
  const initial = initialStatuses(metrics, { loadKw: 150, power: 'topup' });
  recs.addSimTag({ siteId: 's1', lon: 137.4, lat: -4.6, note: 'looks flat' });
  // Even a tag shaped like a field record is ignored by mergeResults.
  const sneaky = [{ kind: 'simulated_tag', siteId: 's1', metricId: 'BT-15', pass: true, lon: 0, lat: 0 }];
  const a = applyFieldRecords(initial, recs.list(), 's1');
  const b = mergeResults(initial, null, sneaky);
  for (const m of metrics) {
    assertEq(a.get(m.id), initial.get(m.id), m.id);
    assertEq(b.get(m.id), initial.get(m.id), m.id);
  }
  assertEq(recs.list().length, 1);
  assertEq(recs.list()[0].kind, 'simulated_tag');
});

test('records: malformed import rejected, state unchanged', () => {
  const store = memStorage();
  const recs = createRecords(store, KEY);
  recs.addField({ siteId: 's1', metricId: 'BT-15', pass: true });
  const before = recs.exportJson();
  const stored = store.getItem(KEY);
  let notified = 0;
  recs.subscribe(() => { notified += 1; });
  const bad = [
    'not json',
    JSON.stringify([]),
    JSON.stringify({ version: 2, records: [] }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, records: [{ kind: 'rumour', siteId: 's1' }] }),
    JSON.stringify({ version: 1, records: [{ kind: 'field', siteId: 's1', metricId: 'BT-15', pass: 'yes' }] }),
    JSON.stringify({ version: 1, records: [{ kind: 'simulated_tag', lon: 'x', lat: 0 }] }),
  ];
  for (const t of bad) {
    const r = recs.importJson(t);
    assertEq(r.ok, false, t);
    assert(typeof r.error === 'string' && r.error.length > 0, 'error message for ' + t);
  }
  assertEq(recs.exportJson(), before);
  assertEq(store.getItem(KEY), stored);
  assertEq(notified, 0);
});

test('records: export → import round trip', () => {
  const a = createRecords(memStorage(), KEY);
  a.addField({ siteId: 's1', stopId: 'stop-1', metricId: 'BT-15', value: 4.2, pass: false, note: 'soft' });
  a.addSimTag({ siteId: 's1', lon: 137.41, lat: -4.58, note: 'tag' });
  const text = a.exportJson();
  assertEq(JSON.parse(text).version, 1);
  const storeB = memStorage();
  const b = createRecords(storeB, KEY);
  let seen = null;
  b.subscribe((list) => { seen = list; });
  assertEq(b.importJson(text), { ok: true, error: null });
  assertEq(b.list(), a.list());
  assertEq(seen, a.list());
  // Persisted: a fresh instance over the same storage reads the same records back.
  assertEq(createRecords(storeB, KEY).list(), a.list());
});

test('nav: loadNavigation of a missing lane resolves null', async () => {
  assertEq(await loadNavigation('./fixtures/no-lane/'), null, 'flags false');
  assertEq(await loadNavigation('http://['), null, 'unusable base');
  assertEq(await loadNavigation('../src/'), null, 'the app base until the lane lands');
});

test('nav: stub base loads route and walk', async () => {
  window.__routeCalls = [];
  const nav = await loadNavigation('./fixtures/route-stub/');
  assert(nav && nav.route && nav.walk, 'loaded');
  for (const f of ['planRoute', 'drawRoute', 'renderTripPanel']) assertEq(typeof nav.route[f], 'function', f);
  for (const f of ['enterWalk', 'exitWalk']) assertEq(typeof nav.walk[f], 'function', f);
  const route = nav.route.planRoute({ site: { id: 's1' }, mode: 'walk', statuses: new Map() });
  assertEq(route.stops.length, 2);
  assertEq(window.__routeCalls[0].fn, 'planRoute');
});

test('nav: replanStatuses excludes route ids', async () => {
  const nav = await loadNavigation('./fixtures/route-stub/');
  const results = initialStatuses(metrics, { loadKw: 150, power: 'topup' });
  assertEq(replanStatuses(results, null).size, results.size, 'no route yet keeps every id');
  const route = nav.route.planRoute({ site: { id: 's1' }, mode: 'walk', statuses: results });
  const ids = [...route.metrics.keys()];
  assert(ids.length > 0 && ids.every((id) => results.has(id)), 'stub ids are real metric ids');
  const s = replanStatuses(results, route);
  assertEq(s.size, results.size - ids.length);
  for (const id of ids) assert(!s.has(id), id);
  assert(s !== results && results.has(ids[0]), 'input untouched');
  // Array shapes for route.metrics are accepted too.
  assertEq(replanStatuses(results, { metrics: [{ id: 'IR-05' }, 'IR-06'] }).size, results.size - 2);
});

test('nav: nextPlanArgs reducer cases', () => {
  const prev = { site: { id: 's1' }, mode: 'walk', order: ['stop-2', 'stop-1'], assumptions: { speed: 1 } };
  assertEq(nextPlanArgs(prev, { mode: 'rover' }).mode, 'rover');
  assertEq(nextPlanArgs(prev, { mode: 'rover' }).order, prev.order, 'mode keeps order');
  assertEq(nextPlanArgs(prev, { order: ['stop-1', 'stop-2'] }).order, ['stop-1', 'stop-2']);
  assertEq(nextPlanArgs(prev, { assumptions: { speed: 2 } }).assumptions, { speed: 2 });
  const re = nextPlanArgs(prev, { action: 'reorder' });
  assert(!('order' in re), 'reorder drops order');
  assertEq(re.mode, 'walk');
  assertEq(nextPlanArgs(prev, { action: 'walk' }), null);
  assertEq(nextPlanArgs(prev, {}), null);
  assertEq(prev.order, ['stop-2', 'stop-1'], 'prev untouched');
});
