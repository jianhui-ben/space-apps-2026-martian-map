// A tiny keyed store. Keys used by the app: stage ('landing' | 'brief' | 'facility' | 'explore'), brief (the Twin Trails
// intake's values, Task 9), setup (FIXED_SETUP until the brief is sized, then the facility sized from it; __map.applySetup
// can change it in tests), layouts (siteId -> placement), results (siteId -> Map of id -> Result), priority (regionId ->
// prioritize() rows), records, openSiteId, selectedSite (the candidate card last chosen), view (the factor tab: null | 'BT'
// | 'GI' | 'SC' | 'TC' | 'IR'), look ('diorama' | 'survey' | 'hud', R32), plus region (the region in view) and regions
// (regionId -> {state, error}).
// Values are replaced, never mutated in place, and every set notifies.

// The legacy reference facility: 150 kW IT (225 kW total), firm base power plus a solar top-up. It is the setup until the
// brief is sized, and is shown as an illustrative reference, never as an estimate from the brief.
export const FIXED_SETUP = Object.freeze({ loadKw: 150, power: 'topup' });

// The construction brief's editable defaults, the Twin Trails intake's (design-reference/mars-construction-twin-trails.html):
// 20 robots on site preparation & earthworks, 12 h / sol for 180 sols, results within 4 hours; the planning defaults split
// the fleet (20% survey, 50% excavation, the rest transport) and set processing, retention, power and backup. Every value
// is editable; ui/brief.js toSizingBrief turns them into the brief the sizing engine reads.
export function defaultBrief() {
  return {
    workType: 'earthworks', robots: 20, hours: 12, duration: 180, deadline: 4, name: 'Gale landing pad & access road',
    surveyPercent: 20, excPercent: 50, surveyActive: 100, otherActive: 80, cadence: 'Once per sol', precision: 'Earthworks check',
    rawRetention: 30, productRetention: 180, power: 'Solar + storage', basePower: 0, backup: 12,
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
