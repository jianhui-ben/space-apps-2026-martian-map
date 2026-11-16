// Loader and small pure helpers for the navigation lane (src/route/, src/walk/), which this map
// only reaches through a dynamic import. Until src/navigation.json marks both modules present,
// loadNavigation resolves to null and the "Plan route" button stays hidden.
//
// Expected host wiring (main.js / ui/card.js):
//   const nav = await loadNavigation(params.get('navstub') ? './tests/fixtures/route-stub/' : './src/');
//   if (!nav) hide the "Plan route" button.
//   let lastRoute = null, planArgs = null, group = null;
//   function plan(args) {
//     planArgs = { ...args, statuses: replanStatuses(store.get('results').get(siteId), lastRoute) };
//     lastRoute = nav.route.planRoute(planArgs);   // {site, layout, base, mode, statuses, order, assumptions?}
//     if (group) group.removeFromParent();
//     group = nav.route.drawRoute(lastRoute, siteView.root);
//     nav.route.renderTripPanel(lastRoute, cardTripEl, { onChange });
//   }
//   function onChange(change) {
//     if (change.action === 'walk') { setExaggeration(1); disable globe controls;
//       nav.walk.enterWalk(lastRoute, {renderer, scene, root, terrain, tripTerrain, frame, hudRoot, site, onTag, onExit});
//       return; }
//     const next = nextPlanArgs(planArgs, change); if (next) plan(next);
//   }
//   onExit(result): restore controls and exaggeration, then records.addSimTag(...) for each result.tags.
//   Re-plan (plan(planArgs)) on layout drag end (final), setup change and records.subscribe; never on a
//   route-derived id. Show route.metrics in the card under "Route" (not in prioritize) and route.notOnTrip.

const ROUTE_EXPORTS = ['planRoute', 'drawRoute', 'renderTripPanel'];
const WALK_EXPORTS = ['enterWalk', 'exitWalk'];

const hasAll = (mod, names) => !!mod && names.every((n) => typeof mod[n] === 'function');

// Resolves to {route, walk} when both modules load with the expected exports, else null. Never throws.
// `${base}navigation.json` ({version: 1, route: bool, walk: bool}) says whether the lane is present: a
// browser logs every 404 as a console error, so the map never requests a module that isn't there.
// When src/route/ and src/walk/ land, set both flags in src/navigation.json to true.
export async function loadNavigation(base = './src/') {
  try {
    const root = new URL(base, document.baseURI);
    const res = await fetch(new URL('navigation.json', root), { cache: 'no-store' });
    if (!res.ok) return null;
    const flags = await res.json();
    if (!flags || flags.version !== 1 || flags.route !== true || flags.walk !== true) return null;
    const [route, walk] = await Promise.all([
      import(new URL('route/index.js', root).href),
      import(new URL('walk/index.js', root).href),
    ]);
    if (!hasAll(route, ROUTE_EXPORTS) || !hasAll(walk, WALK_EXPORTS)) return null;
    return { route, walk };
  } catch (e) {
    return null;
  }
}

// The ids a route derived, whatever shape route.metrics takes (Map, array of ids or {id}, or object).
export function routeMetricIds(route) {
  const m = route && route.metrics;
  if (!m) return new Set();
  if (m instanceof Map) return new Set(m.keys());
  if (Array.isArray(m)) return new Set(m.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean));
  if (typeof m === 'object') return new Set(Object.keys(m));
  return new Set();
}

// The statuses to plan with: the site's results minus every id the last route produced, so a route
// never plans against its own output.
export function replanStatuses(results, lastRoute) {
  const drop = routeMetricIds(lastRoute);
  const out = new Map();
  for (const [id, r] of results || []) if (!drop.has(id)) out.set(id, r);
  return out;
}

// Next planRoute args for one trip-panel change, or null when the change isn't a re-plan (walk).
//   {mode} / {order} -> merged in; {assumptions} -> merged in; {action: 'reorder'} -> order dropped.
export function nextPlanArgs(prev, change) {
  const base = { ...(prev || {}) };
  if (!change || typeof change !== 'object') return null;
  if (change.action === 'reorder') {
    delete base.order;
    return base;
  }
  if (change.action) return null;
  let touched = false;
  for (const k of ['mode', 'order', 'assumptions']) {
    if (k in change) { base[k] = change[k]; touched = true; }
  }
  return touched ? base : null;
}
