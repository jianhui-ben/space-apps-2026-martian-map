// The Diorama look's extras (Task 10): a plaque (the site's name, priority and plain verdict), callouts at the
// compound, the solar plot and the radiator plot (each with its factor's plain sentence, decluttered like the
// prototype), and the west-east and south-north elevation profiles through the compound. They exist only while a site
// is open in the Diorama look; switching to the Survey sheet or the Helmet HUD removes them and switching back
// restores them. Plain words only: metric ids stay in the card's Details.
import * as THREE from 'three';
import { FACTORS, factorSentence, plainVerdict, shortName } from './plain.js';
import { createCallout, declutter } from './ui/callouts.js';
import { profileLine, renderProfiles } from './ui/profiles.js';

// Where each callout stands and what it reads: the footprint, its factor, its order in the collision pass (lower wins)
// and the box's offset from the ground point in pixels (y down). The three fan out east of the layout (the footprint
// tags sit on its west side) and upward, stacked in the layout's north-south order: the radiator plot (north) highest,
// then the compound, then the solar plot (south) level with its plot, so all three clear the profile panel below the
// layout at 1280 x 800 (the solar box used to hang down under it and be culled).
export const CALLOUTS = [
  { footprint: 'compound', name: 'Compound', factor: 'BT', priority: 1, dx: 110, dy: -32 },
  { footprint: 'radiator', name: 'Radiator plot', factor: 'TC', priority: 2, dx: 90, dy: -60 },
  { footprint: 'solar', name: 'Solar plot', factor: 'SC', priority: 3, dx: 130, dy: 0 },
];
const ICON_CLASS = { '✗': 'bad', '✓': 'ok', '?': 'open', '—': 'none' };
const DECLUTTER_MS = 120;
const OBSTACLES = ['header', 'stepper', 'left', 'controls', 'foot', 'diorama-plaque', 'diorama-profiles'];

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const factorName = (id) => (FACTORS.find((f) => f.id === id) || { name: id }).name;

// One callout's words: {cls, html}. The icon is in the text, so the colour is never the only cue. Pure.
export function calloutContent(spec, results, metrics) {
  const { icon, text, simulated } = factorSentence(spec.factor, results || new Map(), metrics, { siteId: spec.siteId || null });
  // the headline only (the card has the rest), so three callouts fit side by side
  const short = text.split(' · ')[0].split(': ')[0].split(', starting with ')[0] + (simulated ? ' (simulated)' : '');
  const html = '<div class="t"><span class="st-icon">' + esc(icon) + '</span> ' + esc(spec.name) + ' · ' + esc(factorName(spec.factor))
    + '</div><div class="v">' + esc(short.charAt(0).toUpperCase() + short.slice(1)) + '</div>';
  return { cls: ICON_CLASS[icon] || 'none', html };
}

// The plaque's words: {name, place, priority, verdict, failed}, as the site card says them. Pure.
export function plaqueModel({ site, row, results, metrics, regionName = '' }) {
  return {
    name: shortName(site.name || site.id),
    place: (regionName ? regionName + ' · ' : '') + 'candidate site',
    priority: row ? 'Priority ' + row.priority : 'not ranked yet',
    verdict: plainVerdict(row, results, metrics),
    failed: !!(row && row.failures.length),
  };
}

// Wire the extras to the app: they follow the store's openSiteId, look, results, priority and layouts.
// app.view is the open SiteView (site.js openSite); layoutStore holds its layout.
export function attachDiorama({ globe, store, app, metrics = [], layoutStore }) {
  let built = null, scheduled = false, lastDeclutter = 0;

  function build(view) {
    const plaque = document.createElement('aside');
    plaque.id = 'diorama-plaque';
    plaque.className = 'panel';
    plaque.setAttribute('aria-label', 'Site plaque');
    const profiles = document.createElement('section');
    profiles.id = 'diorama-profiles';
    profiles.className = 'panel';
    profiles.setAttribute('aria-label', 'Elevation profiles through the compound');
    document.body.append(plaque, profiles);
    const callouts = CALLOUTS.map((spec) => {
      const c = createCallout({ priority: spec.priority, footprint: spec.footprint, dx: spec.dx, dy: spec.dy });
      view.root.add(c.object);
      return { spec, c };
    });
    const marker = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 10), new THREE.MeshBasicMaterial({ color: 0xedc49b, depthTest: false }));
    marker.name = 'profile-marker';
    marker.renderOrder = 5;
    marker.visible = false;
    marker.raycast = () => {};
    view.root.add(marker);
    built = { view, plaque, profiles, callouts, marker, profileKey: null };
  }

  function teardown() {
    if (!built) return;
    for (const { c } of built.callouts) c.dispose();
    if (built.marker.parent) built.marker.parent.remove(built.marker);
    built.marker.geometry.dispose();
    built.marker.material.dispose();
    built.plaque.remove();
    built.profiles.remove();
    built = null;
  }

  function refresh() {
    const { view, plaque, profiles, callouts, marker } = built;
    const site = view.site, results = store.get('results').get(site.id) || null;
    const rows = store.get('priority').get(site.regionId) || [];
    const row = rows.find((r) => r.siteId === site.id) || null;
    const region = ((site.catalog && site.catalog.regions) || []).find((r) => r.id === site.regionId);
    const p = plaqueModel({ site, row, results, metrics, regionName: region ? region.name : '' });
    plaque.innerHTML = '<p class="kicker">' + esc(p.place) + '</p><h2>' + esc(p.name) + '</h2>'
      + '<p class="prio-line"><span class="prio-badge' + (p.failed ? ' failed' : '') + '">' + esc(p.priority) + '</span></p>'
      + '<p class="verdict' + (p.failed ? ' failed' : '') + '">' + esc(p.verdict) + '</p>';

    const layout = layoutStore && layoutStore.get(site.id);
    const fps = (layout && layout.footprints) || [];
    for (const { spec, c } of callouts) {
      const fp = fps.find((f) => f.id === spec.footprint);
      const at = fp && view.groundPoint(fp.center.lon, fp.center.lat, 2);
      c.object.visible = !!(at && Number.isFinite(at.y)); // no such plot in this layout, or no ground there: no callout
      if (!c.object.visible) continue;
      c.setAt(at);
      const { cls, html } = calloutContent(spec, results, metrics);
      c.setContent(html, cls);
    }

    const compound = fps.find((f) => f.id === 'compound');
    const key = compound ? fps.map((f) => f.id + ':' + f.center.lon + ',' + f.center.lat + ',' + f.rotationDeg).join('|') : 'none';
    if (key === built.profileKey) return;
    built.profileKey = key;
    if (!compound) { profiles.textContent = 'No compound placed: no profiles to draw.'; return; }
    const lines = ['ew', 'ns'].map((axis) => profileLine(site, compound.center, axis, { footprints: fps }));
    const g = site.grids && site.grids.elevation;
    renderProfiles(profiles, lines, {
      source: g && g.resolutionM ? 'the site elevation grid (' + g.resolutionM + ' m)' : 'the site elevation grid',
      onHover: (ll) => { // a marker on the ground under the chart's cursor
        if (!built || built.marker !== marker) return;
        marker.visible = !!ll;
        if (ll) marker.position.copy(view.groundPoint(ll[0], ll[1], 3));
      },
    });
  }

  function update() {
    scheduled = false;
    const view = app.view;
    const on = !!(view && store.get('openSiteId') === view.site.id && store.get('look') === 'diorama');
    if (built && (!on || built.view !== view)) teardown();
    if (!on) return;
    if (!built) build(view);
    refresh();
    // the elevation profiles are terrain data: shown with no factor view or the Terrain view, hidden under the others
    const fv = store.get('view'), prof = document.getElementById('diorama-profiles');
    if (prof) prof.hidden = !!fv && fv !== 'BT';
  }
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } };
  for (const k of ['openSiteId', 'look', 'view', 'results', 'priority', 'layouts', 'stage']) store.subscribe(k, schedule);
  if (layoutStore) layoutStore.onLayoutChange(schedule); // drags move the callouts with the layout

  globe.onFrame((dt, now) => {
    if (!built || now - lastDeclutter < DECLUTTER_MS) return;
    lastDeclutter = now;
    if (built.view !== app.view) { schedule(); return; }
    declutter(built.callouts.filter((x) => x.c.object.visible).map((x) => x.c), OBSTACLES.map((id) => document.getElementById(id)));
  });
  schedule();
  return { update: schedule, get on() { return !!built; } };
}
