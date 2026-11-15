// A tiny keyed store. Keys used by the app: stage ('landing' | 'brief' | 'facility' | 'explore'), brief (the construction
// brief, Task 9d) and briefTab (its tab, 0-3: Project, Robots, Operations, Review), setup (always FIXED_SETUP;
// __map.applySetup can change it in tests), layouts (siteId -> placement), results (siteId -> Map of id -> Result),
// priority (regionId -> prioritize() rows), records, openSiteId, selectedSite (the candidate card last chosen), view (the
// factor tab: null | 'BT' | 'GI' | 'SC' | 'TC' | 'IR'), look ('diorama' | 'survey' | 'hud', R32), plus region (the region in view) and regions (regionId -> {state, error}).
// Values are replaced, never mutated in place, and every set notifies.

// One fixed case, the reference facility: 150 kW IT (225 kW total), firm base power plus a solar top-up. The UI
// offers no load or power choice; every function that takes a setup gets this. It is shown as an illustrative
// reference, never as an estimate from the brief: the sizing model is planned, not implemented.
export const FIXED_SETUP = Object.freeze({ loadKw: 150, power: 'topup' });

// The construction brief's editable example, as in the Guided brief mockup (design-reference/mars-construction-intake.html)
// and scenario/gale.json construction_project: 4 survey, 10 excavation and 6 transport robots, 12 h / sol, a one-hour
// turnaround; the extent, duration and retention unknown. Each quantity is {mode: 'known' | 'range' | 'unknown', value,
// min, max, unit}; only the parts its mode names count (the others are kept for when the mode changes back). The brief
// is recorded and shown; it never sizes the facility, changes a status or the priority.
export function defaultBrief() {
  return {
    name: 'Gale landing pad & access road',
    types: ['Landing pad', 'Road'],
    other: '',
    location: 'Gale study region — site not selected',
    fleet: [
      { id: 1, role: 'Survey', count: 4, active: 4 },
      { id: 2, role: 'Excavation', count: 10, active: 8 },
      { id: 3, role: 'Transport', count: 6, active: 4 },
    ],
    phase: 'Site preparation',
    quality: 'Earthworks check',
    jobs: { map: true, progress: true, inspection: false, plan: true },
    cadence: { map: 'Once per sol', progress: 'Once per sol', inspection: 'At phase end', plan: 'Every 4 hours' },
    late: 'Pause dependent work',
    power: 'Unknown',
    continuity: 'Unknown',
    deployment: 'Compare both',
    q: {
      area: { mode: 'unknown', value: 20000, min: 10000, max: 30000, unit: 'm²' },
      road: { mode: 'unknown', value: 1000, min: 500, max: 2000, unit: 'm' },
      hours: { mode: 'known', value: 12, min: 8, max: 12, unit: 'h / sol' },
      deadline: { mode: 'known', value: 1, min: 1, max: 4, unit: 'hours' },
      duration: { mode: 'unknown', value: 180, min: 90, max: 180, unit: 'sols' },
      retention: { mode: 'unknown', value: 30, min: 7, max: 30, unit: 'sols' },
    },
  };
}
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
export const DEFAULT_BRIEF = deepFreeze(defaultBrief());

export function createStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  const listeners = new Map(); // key -> Set of callbacks
  return {
    get: (key) => values.get(key),
    set(key, value) {
      const prev = values.get(key);
      values.set(key, value);
      const set = listeners.get(key);
      if (!set) return;
      for (const cb of [...set]) if (set.has(cb)) cb(value, prev); // skip any removed during this notification
    },
    subscribe(key, cb) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      const set = listeners.get(key);
      set.add(cb);
      return () => set.delete(cb);
    },
  };
}
