// Test stub for the navigation lane's route module: a fixed two-stop route. Every call is recorded on
// window.__routeCalls as {fn, args} so browser tests can check what the host passed.
import * as THREE from 'three';

const calls = () => (window.__routeCalls = window.__routeCalls || []);

export const STUB_ROUTE_IDS = ['IR-05', 'IR-06'];

export function planRoute(args) {
  const { site, mode = 'walk', statuses, order } = args || {};
  calls().push({ fn: 'planRoute', args: { ...args, statusIds: statuses ? [...statuses.keys()] : [] } });
  const stops = [
    { id: 'stop-1', lon: 0, lat: 0, metricIds: ['BT-15'] },
    { id: 'stop-2', lon: 0, lat: 0, metricIds: ['BT-16'] },
  ];
  if (Array.isArray(order) && order[0] === 'stop-2') stops.reverse();
  const fieldwork = statuses ? [...statuses].filter(([, r]) => r && r.status === 'needs_fieldwork').map(([id]) => id) : [];
  const reached = new Set(stops.flatMap((s) => s.metricIds));
  return {
    siteId: site && site.id, mode, stops,
    metrics: new Map(STUB_ROUTE_IDS.map((id) => [id, { id, status: 'needs_confirmation', evidence: 'derived', note: 'stub route' }])),
    notOnTrip: fieldwork.filter((id) => !reached.has(id)),
  };
}

export function drawRoute(route, siteRoot) {
  calls().push({ fn: 'drawRoute', args: { stops: route.stops.map((s) => s.id) } });
  const g = new THREE.Group();
  g.name = 'stub-route';
  if (siteRoot && siteRoot.add) siteRoot.add(g);
  return g;
}

export function renderTripPanel(route, container, { onChange } = {}) {
  calls().push({ fn: 'renderTripPanel', args: { stops: route.stops.map((s) => s.id) } });
  window.__routeOnChange = onChange;
  if (container) container.textContent = 'Stub trip: ' + route.stops.map((s) => s.id).join(' → ');
}
