// Real-data smoke test: the server exposes the snapshot folder under /data/.
test('real: /data/catalog.json is served', async () => {
  const res = await fetch('../data/catalog.json');
  assert(res.ok, 'catalog.json status ' + res.status);
  const cat = await res.json();
  assert(cat && typeof cat === 'object', 'catalog is an object');
});
