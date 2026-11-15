// Test stub for the navigation lane's walk module. Calls are recorded on window.__routeCalls.
const calls = () => (window.__routeCalls = window.__routeCalls || []);
let ctx = null;

export function enterWalk(route, siteContext) {
  calls().push({ fn: 'enterWalk', args: { stops: route.stops.map((s) => s.id) } });
  ctx = siteContext || null;
}

// Ends the walk with one tag and hands the result to the host's onExit.
export function exitWalk() {
  calls().push({ fn: 'exitWalk', args: {} });
  const result = { tags: [{ lon: 137.4, lat: -4.6, note: 'stub tag' }] };
  const c = ctx;
  ctx = null;
  if (c && typeof c.onExit === 'function') c.onExit(result);
  return result;
}
