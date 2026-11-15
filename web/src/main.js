// Boot and wiring: landing -> 1 construction brief -> 2 facility specifications -> 3 location assessment (globe -> region
// priority list -> site card), in one working panel on the left with the map beside it, the stepper under the header
// on every screen, the factor bar in the region and site views, and References at the bottom left.
// The UI and the window.__map hooks call the same functions, so a test drives exactly what a user does.
import * as THREE from 'three';
import { loadCatalog, getSite, regionOf } from './catalog.js';
import { createGlobe, R, START } from './globe.js';
import { footprintSpecs, bestSpot, clampPlacement, createLayoutStore } from './layout.js';
import { terrainChecks } from './checks.js';
import { initialStatuses, mergeResults } from './status.js';
import { prioritize } from './priority.js';
import { openSite, assertOpenable } from './site.js';
import { createStore, FIXED_SETUP, DEFAULT_BRIEF } from './state.js';
import { addRegionPins, addSitePins, addBasePins, regionCentre, REGION_FLY_ALT_M } from './ui/pins.js';
import { createLanding, createStepper, createFacility } from './ui/landing.js';
import { createBrief, briefLine } from './ui/brief.js';
import { createList, cameraTarget, regionInView } from './ui/list.js';
import { createCard, cardModel, footprintStatus } from './ui/card.js';
import { createReferences } from './ui/references.js';
import { createFactorBar, registerView, hasView, viewDatasets, photoView, terrainView } from './ui/factors.js';
import { createControls } from './ui/controls.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// The fly-in ends this high over the layout centre, tilted, facing north (R23). The canvas is the map area right of the
// panel, so the layout lands in its middle.
const SITE_FLY = { altM: 700, tiltDeg: 55, ms: 1600 };
const REGION_CHECK_MS = 200;

function showDebug(globe) {
  const box = document.createElement('div');
  box.id = 'debug';
  box.className = 'panel';
  document.body.append(box);
  let last = 0;
  globe.onFrame((dt, now) => {
    if (now - last < 1000) return;
    last = now;
    const alt = globe.altitude();
    const rows = Object.entries(globe.stats.layers).map(([k, v]) =>
      `${k.padEnd(7)} ok ${v.ok}  bad ${v.bad}  pending ${v.pending}  maxZ ${v.maxZ}`);
    box.textContent = `alt ${alt > 1e4 ? (alt / 1000).toFixed(0) + ' km' : alt.toFixed(0) + ' m'}   fps ${globe.stats.fps}\n` + rows.join('\n');
  });
}

const errText = (e) => String((e && e.message) || e);

// The app's state and actions: loading a region's sites, placing their layouts, checking them, ranking them,
// opening and closing a site, changing the setup.
function createApp({ store, catalog, metrics, globe, layoutStore }) {
  const sites = new Map(); // siteId -> Site, every site loaded so far
  const terrainBySite = new Map(); // siteId -> the last terrainChecks Map (keeps BT-01 through a drag)
  const regionLoads = new Map(); // regionId -> Promise
  let view = null, opening = 0;

  const regionById = (id) => catalog.regions.find((r) => r.id === id) || null;
  const setRegionStatus = (id, status) => store.set('regions', new Map(store.get('regions')).set(id, status));

  // The best spot when there is a slope grid to judge it; otherwise the box centre, kept inside the box.
  function placeFor(site, specs) {
    if (site.grids && site.grids.slope10) return bestSpot(site, specs);
    const [w, s, e, n] = site.bounds;
    return clampPlacement(site, specs, { centerLon: (w + e) / 2, centerLat: (s + n) / 2, rotationDeg: 0 });
  }

  // Results for one site: initial statuses from the setup, then the computed checks, then field records.
  // Environment metrics (Task 12) join `computed` here; field records (Task 11) come through the records key.
  function computeResults(siteId, final) {
    const site = sites.get(siteId), setup = store.get('setup');
    const terrain = terrainChecks(site, layoutStore.get(siteId), setup, catalog.scenario, { final });
    const prev = terrainBySite.get(siteId);
    if (!final && !terrain.has('BT-01') && prev && prev.has('BT-01')) terrain.set('BT-01', prev.get('BT-01'));
    terrainBySite.set(siteId, terrain);
    const records = (store.get('records') || []).filter((r) => r.siteId === siteId);
    const merged = mergeResults(initialStatuses(metrics, setup), terrain, records);
    store.set('results', new Map(store.get('results')).set(siteId, merged));
  }

  // The region's priority, once every one of its sites has results. Only prioritize() orders sites.
  function reprioritize(regionId) {
    const region = regionById(regionId), results = store.get('results');
    if (!region || !region.sites.every((s) => results.has(s.id))) return;
    const rows = prioritize(region.sites.map((s) => ({ id: s.id, results: results.get(s.id) })), metrics);
    store.set('priority', new Map(store.get('priority')).set(regionId, rows));
  }

  // Every layout change (a drag, a setup change, the first placement) rechecks that site and reranks its region.
  layoutStore.onLayoutChange((siteId, layout, { final }) => {
    if (!sites.has(siteId)) return;
    computeResults(siteId, final);
    store.set('layouts', new Map(store.get('layouts')).set(siteId, layout.placement));
    const r = regionOf(catalog, siteId);
    if (r) reprioritize(r.id);
  });

  // First entry to a region: load all its sites, place each layout on its best spot, check and rank them.
  function ensureRegion(regionId) {
    if (regionLoads.has(regionId)) return regionLoads.get(regionId);
    const region = regionById(regionId);
    if (!region) return Promise.reject(new Error('unknown region ' + regionId));
    setRegionStatus(regionId, { state: 'loading' });
    const p = (async () => {
      const loaded = await Promise.all(region.sites.map((s) => getSite(catalog, s.id)));
      for (const site of loaded) sites.set(site.id, site);
      const specs = footprintSpecs(store.get('setup')); // the setup now, not when loading began
      for (const site of loaded) layoutStore.set(site.id, placeFor(site, specs), { final: true, specs });
      reprioritize(regionId);
      setRegionStatus(regionId, { state: 'ready' });
    })();
    p.catch((e) => setRegionStatus(regionId, { state: 'failed', error: errText(e) }));
    regionLoads.set(regionId, p);
    return p;
  }

  // The facility is fixed (FIXED_SETUP); this test-only hook (__map.applySetup) re-sizes the footprints and puts every
  // loaded site's layout back on its best spot; the layout listener then rechecks and reranks. An open site's camera
  // follows its layout to the new spot.
  function applySetup(setup) {
    const s = { loadKw: setup.loadKw, power: setup.power };
    store.set('setup', s);
    const specs = footprintSpecs(s);
    for (const site of sites.values()) layoutStore.set(site.id, placeFor(site, specs), { final: true, specs });
    const id = store.get('openSiteId');
    if (view && id) flyToLayout(id, 1200);
  }

  function disposeView() {
    if (view) view.dispose(); // before anything else changes, so it hears nothing more
    view = null;
    window.__map.siteView = null;
  }

  // 700 m above the layout's bounding-box centre (on the drawn ground), tilted, facing north.
  function flyToLayout(siteId, ms) {
    const t = view.flyTarget();
    return globe.flyTo(t.lon, t.lat, SITE_FLY.altM, ms, { tiltDeg: SITE_FLY.tiltDeg, targetAltM: t.targetAltM });
  }

  // Open a site: its region is loaded and ranked first, so the card has its priority. Resolves to the SiteView after
  // the fly-in, or to null when a later open or close superseded this one while loading. Rejects, leaving the open
  // view alone, when the site has no elevation grid to draw.
  async function openSiteById(siteId, { flyMs = SITE_FLY.ms } = {}) {
    const ticket = ++opening;
    const region = regionOf(catalog, siteId);
    if (!region) throw new Error('unknown site ' + siteId);
    await ensureRegion(region.id);
    if (ticket !== opening) return null;
    const site = sites.get(siteId);
    assertOpenable(site);
    disposeView();
    const v = openSite(globe, site, { layoutStore });
    view = v;
    window.__map.siteView = v;
    v.onProblems((list) => store.set('problems', list));
    store.set('problems', v.problems);
    pins.setHidden(true);
    store.set('selectedSite', siteId);
    store.set('openSiteId', siteId);
    if (store.get('stage') !== 'explore') store.set('stage', 'explore'); // the site card is the working panel now
    await flyToLayout(siteId, flyMs);
    return ticket === opening ? v : null;
  }

  // Close the open site and fly back up to its region.
  function closeSite({ flyMs = 1600 } = {}) {
    ++opening;
    const id = store.get('openSiteId');
    disposeView();
    pins.setHidden(false);
    store.set('problems', []);
    store.set('openSiteId', null);
    if (!id) return Promise.resolve();
    const { lon, lat } = regionCentre(regionOf(catalog, id));
    return globe.flyTo(lon, lat, REGION_FLY_ALT_M, flyMs);
  }

  // Region the camera is over (R13), checked a few times a second; first entry starts the loading.
  const dir = new THREE.Vector3();
  let lastCheck = -Infinity, target = null;
  globe.onFrame((dt, now) => {
    if (now - lastCheck < REGION_CHECK_MS) return;
    lastCheck = now;
    globe.camera.getWorldDirection(dir);
    target = cameraTarget(globe.camera.position, dir, R);
    const r = regionInView(catalog, target, globe.altitude());
    const id = r ? r.id : null;
    if (id !== store.get('region')) {
      store.set('region', id);
      if (id) ensureRegion(id).catch(() => {}); // a failure is shown in the list
    }
  });

  // Dataset ids drawn right now (the photo layers and the open site's data), for the References page.
  function onScreen() {
    const ids = ['imagery_viking'];
    if (globe.overlays.relief.opacity > 0) ids.push('relief_mola');
    for (const k of ['imagery_ctx', 'imagery_hirise_gray']) {
      const b = catalog.byId.get(k) && catalog.byId.get(k).coverage && catalog.byId.get(k).coverage.bounds;
      if (b && target && target.lon > b[0] - 3 && target.lon < b[2] + 3 && target.lat > b[1] - 3 && target.lat < b[3] + 3) ids.push(k);
    }
    if (view) {
      const site = view.site;
      for (const d of catalog.raw.datasets) if (d.coverage && d.coverage.area === site.id && (d.files || []).length) ids.push(d.id);
      if (site.tripArea) ids.push(site.tripArea.datasetId);
      if (view.debug.drape().mode === 'hirise' && !ids.includes('imagery_hirise_gray')) ids.push('imagery_hirise_gray');
    }
    return ids;
  }

  let pins = null;
  const setPins = (p) => { pins = p; };
  return {
    sites, ensureRegion, openSiteById, closeSite, applySetup, onScreen, setPins,
    get view() { return view; },
    results: (siteId) => (store.get('results').get(siteId) || null),
  };
}

// The ARES header: the outlined wordmark and what the app is, and the base context at the right.
function createHeader(el) {
  const brand = document.createElement('div');
  brand.className = 'brand';
  const word = document.createElement('span');
  word.className = 'wordmark';
  word.textContent = 'ARES';
  const tag = document.createElement('span');
  tag.className = 'tagline';
  tag.textContent = 'Mars data center explorer';
  brand.append(word, tag);
  const ctx = document.createElement('p');
  ctx.className = 'base-context';
  el.replaceChildren(brand, ctx);
  return { setContext(text) { if (ctx.textContent !== text) ctx.textContent = text; } };
}

// "Gale crater base · Demo" for the region in view; every base when none is, the established Gale base first.
const CONTEXT_ORDER = ['gale', 'jezero', 'arcadia'];
const contextRank = (r) => { const i = CONTEXT_ORDER.indexOf(r.id); return i < 0 ? CONTEXT_ORDER.length : i; };
function baseContext(catalog, region) {
  if (region) return region.name + ' base · Demo';
  const names = catalog.regions.filter((r) => r.base).sort((a, b) => contextRank(a) - contextRank(b)).map((r) => r.name.split(' ')[0]);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || 'Your';
  return list + (names.length > 1 ? ' bases' : ' base') + ' · Demo';
}

// The header's context while the construction is planned (steps 1 and 2); then the base context.
const PLANNING_CONTEXT = 'Gale crater · Construction planning';
const PLANNING = new Set(['brief', 'facility']);

async function boot() {
  const store = createStore({
    stage: 'landing', brief: DEFAULT_BRIEF, briefTab: 0, setup: FIXED_SETUP, layouts: new Map(), results: new Map(), priority: new Map(),
    records: [], openSiteId: null, selectedSite: null, region: null, regions: new Map(), problems: [], view: 'photo',
  });
  window.__map.store = store;
  const header = createHeader($('header'));

  // The landing, the brief and the facility step work before the catalog arrives. Every brief change goes to the store,
  // so the stepper, Back and Edit keep the values. The brief never sizes the facility: it is recorded and shown.
  let list = null, assessed = () => {};
  const landing = createLanding($('landing'), { onStart: () => go('brief') });
  const brief = createBrief($('brief'), $('brief-summary'), {
    onChange: (b) => store.set('brief', b),
    onTab: (t) => store.set('briefTab', t),
    onDone: () => go('facility'),
  });
  const facility = createFacility($('facility'), { setup: () => store.get('setup'), onAssess: () => { go('explore'); assessed(); } });
  const stepper = createStepper($('stepper'), { onStep: (stage) => go(stage) });
  function go(stage) {
    store.set('stage', stage);
    if (stage === 'landing') landing.focus();
    else if (stage === 'brief') brief.open(store.get('brief'), store.get('briefTab'));
    else if (stage === 'facility') facility.open();
    else requestAnimationFrame(() => { if (list) list.focus(); });
  }
  // One working panel at a time: landing, brief (with its summary beside it), facility, results, or the site card in
  // the results' place.
  function showStage() {
    const stage = store.get('stage'), open = !!store.get('openSiteId');
    $('landing').hidden = stage !== 'landing';
    $('brief').hidden = $('brief-summary').hidden = stage !== 'brief';
    $('facility').hidden = stage !== 'facility';
    $('panel').hidden = !(stage === 'explore' && !open);
    $('card').hidden = !(stage === 'explore' && open);
    stepper.render(stage);
    if (PLANNING.has(stage)) header.setContext(PLANNING_CONTEXT);
    document.body.dataset.stage = stage;
  }
  for (const k of ['stage', 'openSiteId']) store.subscribe(k, showStage);
  showStage();

  const [catalog, metrics] = await Promise.all([
    loadCatalog('./data/'),
    fetch('./metrics.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' for metrics.json'); return r.json(); }).then((j) => j.metrics),
  ]);
  const globe = createGlobe($('app'), catalog, { labelsElement: $('labels') });
  if (params.get('debug') === '1') showDebug(globe);
  const layoutStore = createLayoutStore();
  const app = createApp({ store, catalog, metrics, globe, layoutStore });
  const names = new Map(catalog.sites.map((s) => [s.id, s.name]));

  const toast = $('toast');
  let toastTimer = 0;
  const say = (text) => {
    toast.textContent = text;
    toast.className = 'panel';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.textContent = ''; }, 9000);
  };
  const open = (siteId) => {
    store.set('selectedSite', siteId); // the card shows its next check while the site opens
    const p = app.openSiteById(siteId);
    window.__map.opening = p.catch(() => null);
    p.catch((e) => say(errText(e)));
    return p;
  };
  const flyToRegion = (r) => { const c = regionCentre(r); return globe.flyTo(c.lon, c.lat, REGION_FLY_ALT_M, 1600); };
  const pins = addRegionPins(globe, catalog, { onRegion: flyToRegion, onSite: (id) => open(id), keepOut: () => [$('controls'), $('brief-summary')] });
  const sitePins = addSitePins(globe, catalog, { onSite: (id) => open(id) });
  const basePins = addBasePins(globe, catalog);
  app.setPins({ setHidden: (v) => { pins.setHidden(v); sitePins.setHidden(v); } });
  list = createList($('panel'), { onSite: (id) => open(id), onRegion: flyToRegion, onEdit: () => go('brief') });
  // "Assess locations →" goes to the globe: the whole planet, Gale in the middle, unless a region or a site is in view.
  assessed = () => { if (!store.get('region') && !store.get('openSiteId')) globe.flyTo(START.lon, START.lat, START.alt, 1200); };
  // The factor bar's views: the photo view and Terrain here; Task 12 registers the other four the same way.
  registerView('photo', photoView({ catalog }));
  registerView('BT', terrainView({ catalog, onChange: () => schedule() }));
  const onView = (id) => store.set('view', id);
  const bar = createFactorBar($('factors'), { onView });
  const card = createCard($('card'), { onBack: () => app.closeSite(), onView, hasView });
  let viewCtx = { globe, siteView: null, site: null, regionId: null };
  const references = createReferences($('refs'), catalog, {
    globe, onScreen: () => [...app.onScreen(), ...viewDatasets(bar.active(), viewCtx)],
  });
  createControls($('controls'), { globe, layoutSelected: () => !!(app.view && app.view.selected) });

  // One render per animation frame, whatever changed.
  let scheduled = false, cardKey = null;
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => { if (!o) return '-'; if (!ids.has(o)) ids.set(o, nextId++); return ids.get(o); };
  function render() {
    scheduled = false;
    const s = store.get('setup'), results = store.get('results'), priority = store.get('priority'), regions = store.get('regions');
    const regionId = store.get('region'), region = regionId ? catalog.regions.find((r) => r.id === regionId) : null;
    const openId = store.get('openSiteId'), stage = store.get('stage');
    const context = baseContext(catalog, region);
    header.setContext(PLANNING.has(stage) ? PLANNING_CONTEXT : context);
    const line = briefLine(store.get('brief'));
    list.render({
      region, status: region && regions.get(region.id), rows: region && priority.get(region.id), results, sites: app.sites, metrics,
      openSiteId: openId, names, context: region ? 'Near ' + context : context, brief: line,
      regions: catalog.regions, regionStatus: regions, selectedSite: store.get('selectedSite'),
    });
    const listShown = stage === 'explore' && !openId;
    for (const r of catalog.regions) {
      pins.update(r.id, { status: regions.get(r.id), rows: priority.get(r.id), results, metrics, names, collapsed: listShown && r.id === regionId });
    }
    sitePins.update(openId ? null : regionId, region && regions.get(region.id) && regions.get(region.id).state === 'ready' ? priority.get(region.id) : null);
    basePins.update(openId ? null : regionId);
    const view = openId ? app.view : null;
    // the factor bar in the region and site views; it applies the chosen view to whichever of them is on screen
    viewCtx = { globe, siteView: view, site: view ? view.site : null, regionId };
    bar.render({ show: stage === 'explore' && !!(regionId || view), view: store.get('view'), ctx: viewCtx,
      results: view ? results.get(openId) : null, metrics });
    if (openId && view) {
      const siteRegion = regionOf(catalog, openId);
      const rows = priority.get(siteRegion.id) || [];
      const row = rows.find((x) => x.siteId === openId) || null;
      const problems = store.get('problems');
      const key = [openId, idOf(results.get(openId)), idOf(row), idOf(rows), idOf(s), JSON.stringify(problems), line].join('|');
      if (key !== cardKey) {
        cardKey = key;
        const model = cardModel({ site: view.site, results: results.get(openId), row, metrics, setup: s, catalog, rows, allResults: results, names });
        card.render(model, { problems, regionName: siteRegion.name, setup: s, names, metrics, brief: line });
        view.setFootprintStatus(footprintStatus(results.get(openId)));
      }
    } else if (cardKey !== null) { card.clear(); cardKey = null; }
    references.refresh();
  }
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(render); } };
  for (const k of ['stage', 'brief', 'setup', 'layouts', 'results', 'priority', 'records', 'openSiteId', 'selectedSite', 'region', 'regions', 'problems', 'view']) {
    store.subscribe(k, schedule);
  }
  render(); // the header and panels are filled before ready resolves

  Object.assign(window.__map, {
    globe, catalog, metrics, layoutStore,
    openSite: (siteId, { setup: s = null, flyMs } = {}) => { // R15, now the UI's own open
      if (s && (s.loadKw !== store.get('setup').loadKw || s.power !== store.get('setup').power)) app.applySetup(s);
      const p = app.openSiteById(siteId, flyMs === undefined ? {} : { flyMs });
      window.__map.opening = p.catch(() => null);
      return p;
    },
    closeSite: () => app.closeSite(),
    applySetup: (s) => app.applySetup(s), // test-only: the UI offers no load or power choice
    loadRegion: (id) => app.ensureRegion(id),
    results: (siteId) => app.results(siteId),
    site: (siteId) => app.sites.get(siteId) || null,
  });
}

window.__map = { globe: null, catalog: null, ready: null, siteView: null, store: null, opening: Promise.resolve(null) };
const ready = boot().catch((e) => {
  const box = document.createElement('div');
  box.id = 'boot-error';
  box.className = 'panel';
  box.textContent = 'The map could not start: ' + errText(e);
  document.body.append(box);
  console.error(e);
  throw e;
});
ready.catch(() => {}); // reported above; awaiting __map.ready still sees the rejection
window.__map.ready = ready;
