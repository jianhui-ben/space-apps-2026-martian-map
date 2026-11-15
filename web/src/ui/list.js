// The results panel ("Explore areas"): the brief's name, the base context, then one card per region while no
// region is in view, or the region's candidate cards in the order prioritize() gives (priority, name, the plain verdict
// as the reason to investigate, and the five factor icons under their plain names). Choosing a card shows its next check.
import { fieldCounts } from '../status.js';
import { FACTORS, factorSentence, plainVerdict, plainIds, shortName } from '../plain.js';

export { shortName };

export const LIST_MAX_ALT_M = 2e6; // the list shows below 2,000 km...
export const REGION_MARGIN_DEG = 5; // ...with the camera target inside the region's bounds grown by 5 degrees
export const ICON_WORDS = { '✓': 'every orbital check met', '✗': 'a requirement fails', '?': 'unresolved', '—': 'nothing here applies' };
export const ICON_CLASS = { '✓': 'ok', '✗': 'bad', '?': 'open', '—': 'none' };

const DEG = 180 / Math.PI;
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;

// Where the camera's view ray meets the sphere (lon, lat in degrees); the point under the camera when it misses.
export function cameraTarget(p, d, R) {
  const b = p.x * d.x + p.y * d.y + p.z * d.z;
  const c = p.x * p.x + p.y * p.y + p.z * p.z - R * R;
  const disc = b * b - c;
  let q = p;
  if (disc > 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0) q = { x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t };
  }
  const r = Math.hypot(q.x, q.y, q.z);
  return { lon: Math.atan2(q.y, q.x) * DEG, lat: Math.asin(q.z / r) * DEG };
}

// The region the camera is over, or null: altitude under LIST_MAX_ALT_M and target within its bounds +- the margin.
export function regionInView(catalog, target, altM, { maxAltM = LIST_MAX_ALT_M, marginDeg = REGION_MARGIN_DEG } = {}) {
  if (!target || !(altM < maxAltM)) return null;
  let best = null, bestD = Infinity;
  for (const r of catalog.regions) {
    const [w, s, e, n] = r.bounds;
    const dLon = wrap180(target.lon - (w + e) / 2);
    if (Math.abs(dLon) > (e - w) / 2 + marginDeg || target.lat < s - marginDeg || target.lat > n + marginDeg) continue;
    const d = Math.hypot(dLon, target.lat - (s + n) / 2);
    if (d < bestD) { best = r; bestD = d; }
  }
  return best;
}

// The five factor icons of a site (plain.js factorSentence, the same icons as the site card's rows), each named in words.
export function factorCells(results, metrics) {
  return FACTORS.map((f) => {
    const { icon } = factorSentence(f.id, results, metrics);
    const { fieldwork, design } = fieldCounts(results, metrics, f.id);
    return {
      factor: f.id, name: f.name, icon, fieldwork, design,
      title: f.name + ': ' + ICON_WORDS[icon] + '; ' + fieldwork + ' fieldwork and ' + design + ' design items open',
    };
  });
}

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// One factor icon; its name is the column header above it and, for screen readers, its label.
export function iconEl(cell) {
  const s = h('span', 'icon ' + ICON_CLASS[cell.icon]);
  s.dataset.factor = cell.factor;
  s.dataset.icon = cell.icon;
  s.title = cell.title;
  s.setAttribute('aria-label', cell.name + ': ' + ICON_WORDS[cell.icon]);
  s.append(h('span', 'glyph', cell.icon));
  return s;
}

// The column headers over the icons: the factors' plain names (never their codes).
export function factorHeader(cls) {
  const row = h('div', cls);
  row.setAttribute('aria-hidden', 'true');
  row.append(h('span', 'sp'), h('span', 'sp'));
  const icons = h('span', 'icons');
  for (const f of FACTORS) {
    const c = h('span', 'fc', f.name);
    c.title = f.name + ' (' + f.doc.toLowerCase() + ')';
    icons.append(c);
  }
  row.append(icons);
  return row;
}

// Row warnings that are not part of the priority: data that failed, a site that cannot be opened.
export function siteWarnings(site, metrics = []) {
  if (!site) return [];
  const out = [];
  const keys = Object.keys(site.loadErrors || {});
  if (!(site.grids && site.grids.elevation)) out.push('cannot be opened: no elevation grid');
  if (keys.length) out.push('data failed to load: ' + keys.map((k) => plainIds(k.replace('@', ' at '), metrics)).join(', '));
  return out;
}

// The next check for a ranked site: its first critical unknown and the measurement that settles it, or null.
export function nextCheck(row, metrics) {
  const id = row && row.criticalUnknowns && row.criticalUnknowns[0];
  if (!id) return null;
  const m = metrics.find((x) => x.id === id);
  return { id, name: m ? m.name : id, settledBy: (m && m.fieldwork) || '' };
}

// The next check in words: the measurement's name and what settles it (its id stays in the card's Details).
export function nextCheckEl(next, title) {
  const box = h('div', 'next-check');
  box.setAttribute('aria-live', 'polite');
  if (title) box.append(h('b', '', title));
  if (!next) {
    box.append(h('span', '', 'No critical unknowns: the open items need design input or data.'));
    return box;
  }
  box.dataset.metric = next.id;
  box.append(h('span', 'what', next.name));
  if (next.settledBy) box.append(h('span', 'settled', 'Settled by: ' + next.settledBy));
  return box;
}

const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

export function createList(el, { onSite, onRegion, onEdit }) {
  let lastKey = null;

  // state: {region, status: {state, error}, rows, results (siteId -> Map), sites (siteId -> Site), metrics, openSiteId,
  // names, context (base context), brief (the brief's line, Task 9d), regions (catalog regions), regionStatus (id -> status),
  // selectedSite}
  function render(state) {
    const { region, status, rows, results, sites, metrics, openSiteId, names, context, brief, regions, regionStatus, selectedSite } = state;
    const key = [region && region.id, status && status.state, rows, results, openSiteId, context, brief, regionStatus, selectedSite]
      .map((x) => (x && typeof x === 'object' ? objId(x) : String(x))).join('|');
    if (key === lastKey) return;
    lastKey = key;
    const scroll = el.scrollTop;
    el.replaceChildren();
    el.className = 'panel';
    if (region) { el.dataset.region = region.id; el.dataset.state = (status && status.state) || 'loading'; } else { delete el.dataset.region; delete el.dataset.state; }
    el.setAttribute('aria-label', region ? 'Candidate sites in ' + region.name : 'Explore areas');

    const top = h('div', 'panel-top');
    const title = h('h2', '', 'Explore areas');
    title.tabIndex = -1;
    const edit = h('button', 'text-action', 'Edit');
    edit.type = 'button';
    edit.id = 'results-edit';
    edit.setAttribute('aria-label', 'Edit the construction brief');
    edit.addEventListener('click', onEdit);
    top.append(title, edit);
    if (brief) el.append(top, h('p', 'brief-line', brief), h('p', 'sub', context));
    else el.append(top, h('p', 'sub', context));
    el.append(h('p', 'panel-intro', 'Compare the tradeoffs, then select an area to see what needs checking.'));

    if (!region) { // the whole planet: one card per region, flying there
      const list = h('div', 'region-cards');
      for (const r of regions) {
        const st = regionStatus.get(r.id);
        const b = h('button', 'region-card');
        b.type = 'button';
        b.dataset.region = r.id;
        const n = r.sites.length;
        const note = n ? plural(n, 'candidate site') + (st && st.state === 'loading' ? ' · checking…' : st && st.state === 'failed' ? ' · check failed' : '')
          : 'needs confirmation: no site data';
        b.append(h('strong', '', r.name), h('small', '', note));
        if (n) b.addEventListener('click', () => onRegion(r)); else b.disabled = true;
        list.append(b);
      }
      el.append(list);
      el.scrollTop = scroll;
      return;
    }

    const head = h('div', 'region-head');
    head.append(h('h3', 'region-name', region.name), h('span', 'count', plural(region.sites.length, 'candidate site')));
    el.append(head);
    if (!status || status.state === 'loading') {
      const n = region.sites.length;
      el.append(h('p', 'loading', 'Checking ' + plural(n, 'site') + ': loading the elevation, slope and roughness grids and placing the facility…'));
      return;
    }
    if (status.state === 'failed') {
      el.append(h('p', 'failed', 'The sites could not be checked: ' + status.error + '. Nothing here is ranked.'));
      return;
    }
    el.append(factorHeader('cols'));
    const list = h('ol', 'rows');
    let chosen = null;
    for (const row of rows || []) {
      const site = sites.get(row.siteId);
      const res = results.get(row.siteId);
      const li = h('li', '');
      const b = h('button', 'site-row' + (row.failures.length ? ' failed' : ''));
      b.type = 'button';
      b.dataset.site = row.siteId;
      const isChosen = row.siteId === selectedSite;
      if (isChosen) chosen = row;
      b.setAttribute('aria-pressed', String(isChosen));
      if (row.siteId === openSiteId) b.setAttribute('aria-current', 'true');
      b.title = 'Open ' + names.get(row.siteId) + ' on the terrain';
      const prio = h('span', 'prio', String(row.priority));
      prio.setAttribute('aria-label', 'Priority ' + row.priority);
      const nm = h('span', 'nm', shortName(names.get(row.siteId) || row.siteId));
      const verdict = h('span', 'verdict', plainVerdict(row, res, metrics));
      const facts = h('span', 'facts');
      const icons = h('span', 'icons');
      for (const c of factorCells(res, metrics)) icons.append(iconEl(c));
      facts.append(icons);
      b.append(prio, nm, verdict, facts);
      const more = h('span', 'more');
      if (row.equalWith.length) more.append(h('span', 'eq', 'equal with ' + row.equalWith.map((id) => shortName(names.get(id) || id)).join(', ')));
      for (const w of siteWarnings(site, metrics)) more.append(h('span', 'warn', '⚠ ' + w));
      if (more.childElementCount) b.append(more);
      b.addEventListener('click', () => onSite(row.siteId));
      li.append(b);
      list.append(li);
    }
    el.append(list);
    if (chosen) el.append(nextCheckEl(nextCheck(chosen, metrics), 'Next check · ' + shortName(names.get(chosen.siteId) || chosen.siteId)));
    el.scrollTop = scroll;
  }
  return { render, focus: () => { const t = el.querySelector('h2'); if (t) t.focus({ preventScroll: true }); } };
}

// Identity tags for objects, so a re-render happens only when an input was replaced.
const ids = new WeakMap();
let nextId = 1;
function objId(o) {
  if (!ids.has(o)) ids.set(o, nextId++);
  return '#' + ids.get(o);
}
