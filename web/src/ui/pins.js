// Region pins on the globe: one per catalog region. Before a region's sites are checked the pin says how many it has;
// once they are, it lists them in priority order (one row per site: priority, name and the five factor icons under their
// plain names; a site that fails says why in plain words), as in the spec's globe sketch. The name flies to the region
// at 250 km; a row opens the site.
import { factorCells, iconEl, factorHeader, shortName } from './list.js';
import { plainVerdict } from '../plain.js';

export const REGION_FLY_ALT_M = 250000;

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export const regionCentre = (r) => ({ lon: (r.bounds[0] + r.bounds[2]) / 2, lat: (r.bounds[1] + r.bounds[3]) / 2 });

// ---------- where a region pin's card goes ----------
const CARD_GAP = 12, MAP_MARGIN = 6; // px between the dot and its card; kept clear inside the map edge and keep-outs
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const insideBox = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

// The top-left (map pixels) of a pin card of size {w, h} beside its dot at {x, y}: inside the map box (less a margin),
// clear of the keep-out boxes (the globe buttons) and, where it can be, of the cards already placed. It hangs away from
// the map's middle first (up from the dot in the upper half, down in the lower), right of the dot before left. When no
// side fits it is pushed back inside and off the keep-outs; {leader: true} then asks for a line back to the dot.
export function placeCard(dot, size, map, keepOut = [], placed = []) {
  const area = { x: map.x + MAP_MARGIN, y: map.y + MAP_MARGIN, w: map.w - 2 * MAP_MARGIN, h: map.h - 2 * MAP_MARGIN };
  const pad = (b) => ({ x: b.x - MAP_MARGIN, y: b.y - MAP_MARGIN, w: b.w + 2 * MAP_MARGIN, h: b.h + 2 * MAP_MARGIN });
  const blocks = keepOut.map(pad);
  const up = dot.y < map.y + map.h / 2;
  const away = up ? dot.y - size.h + CARD_GAP / 2 : dot.y - CARD_GAP / 2, toward = up ? dot.y - CARD_GAP / 2 : dot.y - size.h + CARD_GAP / 2;
  const ys = [away, dot.y - size.h / 2, toward];
  const xs = [dot.x + CARD_GAP, dot.x - CARD_GAP - size.w];
  const cands = ys.flatMap((y) => xs.map((x) => ({ x, y, w: size.w, h: size.h })));
  const fits = (c, others) => insideBox(c, area) && !blocks.some((b) => overlaps(c, b)) && !others.some((b) => overlaps(c, b));
  const hit = cands.find((c) => fits(c, placed)) || cands.find((c) => fits(c, []));
  if (hit) return { x: hit.x, y: hit.y, leader: false };
  // nothing fits as it is: push the first choice inside the map, then off each keep-out by the shorter way out
  const c = { ...cands[0] };
  const clampIn = () => {
    c.x = Math.min(Math.max(c.x, area.x), area.x + area.w - c.w);
    c.y = Math.min(Math.max(c.y, area.y), area.y + area.h - c.h);
  };
  clampIn();
  for (const b of blocks) {
    if (!overlaps(c, b)) continue;
    const moves = [
      { dx: b.x - (c.x + c.w), dy: 0 }, { dx: b.x + b.w - c.x, dy: 0 },
      { dx: 0, dy: b.y - (c.y + c.h) }, { dx: 0, dy: b.y + b.h - c.y },
    ].filter((m) => insideBox({ ...c, x: c.x + m.dx, y: c.y + m.dy }, area));
    moves.sort((m, n) => Math.hypot(m.dx, m.dy) - Math.hypot(n.dx, n.dy));
    if (moves.length) { c.x += moves[0].dx; c.y += moves[0].dy; }
  }
  return { x: c.x, y: c.y, leader: true };
}

// Adds the pins. onRegion(region) runs on the name or the dot (default: fly there), onSite(siteId) on a row.
// keepOut() -> elements the cards must stay clear of (the globe buttons). Returns {pins: {regionId: CSS2DObject},
// update(regionId, state), setHidden(bool)}. A collapsed pin (its region's list is on screen) is hidden.
export function addRegionPins(globe, catalog, { onRegion = null, onSite = () => {}, keepOut = () => [] } = {}) {
  const pins = {}, parts = {};
  for (const r of catalog.regions) {
    const { lon, lat } = regionCentre(r);
    const n = r.sites.length;
    const el = h('div', 'pin' + (n ? '' : ' unconfirmed')); // the dot; the card is placed beside it (placeCard)
    el.dataset.region = r.id;
    const dot = h('span', 'dot');
    const lead = h('span', 'lead');
    lead.hidden = true;
    const label = h('div', 'label');
    const head = h(n ? 'button' : 'div', 'pin-head');
    const note = h('span', 'note', n ? n + (n === 1 ? ' site' : ' sites') + ' · not yet checked' : 'needs confirmation');
    head.append(h('span', 'name', r.name), note);
    if (n) {
      const fly = () => (onRegion ? onRegion(r) : globe.flyTo(lon, lat, REGION_FLY_ALT_M));
      head.type = 'button';
      head.title = 'Fly to ' + r.name;
      head.addEventListener('click', fly);
      dot.addEventListener('click', fly);
    }
    const rows = h('div', 'pin-rows');
    label.append(head, rows);
    el.append(lead, dot, label);
    pins[r.id] = globe.addPin({ lon, lat, el });
    pins[r.id].center.set(0.5, 0.5); // the dot's centre on the region
    parts[r.id] = { el, label, lead, note, rows, n, key: null, collapsed: false };
  }
  // Place the visible cards a few times a second: inside the map, clear of the globe buttons and of one another.
  let lastPlace = -Infinity;
  globe.onFrame((dt, now) => {
    if (now - lastPlace < 200) return;
    lastPlace = now;
    const canvas = globe.renderer.domElement, cr = canvas.getBoundingClientRect();
    const map = { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight };
    const keep = keepOut().filter(Boolean).map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height)
      .map((b) => ({ x: b.left - cr.left, y: b.top - cr.top, w: b.width, h: b.height }));
    const placed = [];
    for (const id of Object.keys(pins)) {
      const obj = pins[id], p = parts[id];
      if (!obj.visible || !p.label.offsetWidth) continue;
      const v = obj.position.clone().project(globe.camera);
      const dot = { x: (v.x + 1) / 2 * map.w, y: (1 - v.y) / 2 * map.h };
      const size = { w: p.label.offsetWidth, h: p.label.offsetHeight };
      const at = placeCard(dot, size, map, keep, placed);
      placed.push({ x: at.x, y: at.y, ...size });
      p.label.style.left = (at.x - dot.x + 6) + 'px'; // the pin element is the 12 px dot, its centre at (6, 6)
      p.label.style.top = (at.y - dot.y + 6) + 'px';
      // a leader line from the dot to the nearest point of a card pushed away from it
      const nx = Math.min(Math.max(dot.x, at.x), at.x + size.w), ny = Math.min(Math.max(dot.y, at.y), at.y + size.h);
      const len = Math.hypot(nx - dot.x, ny - dot.y);
      p.lead.hidden = !(at.leader && len > CARD_GAP);
      p.lead.style.width = len + 'px';
      p.lead.style.transform = 'rotate(' + Math.atan2(ny - dot.y, nx - dot.x) + 'rad)';
    }
  });
  let siteOpen = false;
  // A pin is hidden while a site is open, and while its own region's list is on screen (the list names the region,
  // and the pin would sit on the site markers).
  const refresh = (id) => { pins[id].userData.hidden = siteOpen || parts[id].collapsed; };

  // state: {status: {state, error}, rows (prioritize rows), results, metrics, names, collapsed}
  function update(regionId, { status, rows, results, metrics, names, collapsed = false }) {
    const p = parts[regionId];
    if (!p || !p.n) return;
    p.collapsed = !!collapsed;
    p.el.classList.toggle('collapsed', p.collapsed);
    refresh(regionId);
    const state = status ? status.state : null;
    const ready = state === 'ready' && rows && rows.length;
    const sites = p.n + (p.n === 1 ? ' site' : ' sites');
    p.note.textContent = ready ? '' : state === 'loading' ? sites + ' · checking…' : state === 'failed' ? sites + ' · check failed' : sites + ' · not yet checked';
    p.note.hidden = !!ready;
    if (!ready) { if (p.key !== null) { p.rows.replaceChildren(); p.key = null; } return; }
    if (p.key === rows) return; // rows are replaced whenever anything they show changes
    p.key = rows;
    p.rows.replaceChildren(factorHeader('pin-cols'));
    for (const row of rows) {
      const b = h('button', 'pin-row' + (row.failures.length ? ' failed' : ''));
      b.type = 'button';
      b.dataset.site = row.siteId;
      const name = names.get(row.siteId) || row.siteId;
      const verdict = plainVerdict(row, results.get(row.siteId), metrics);
      b.title = name + ': ' + verdict;
      b.append(h('span', 'prio', String(row.priority)), h('span', 'sname', shortName(name)));
      const icons = h('span', 'icons');
      for (const c of factorCells(results.get(row.siteId), metrics, row.siteId)) icons.append(iconEl(c));
      b.append(icons);
      if (row.failures.length) b.append(h('span', 'nr', verdict));
      b.addEventListener('click', () => onSite(row.siteId));
      p.rows.append(b);
    }
  }

  // Hidden while a site is open (cullPins honours userData.hidden).
  function setHidden(hidden) { siteOpen = !!hidden; for (const id of Object.keys(pins)) refresh(id); }

  return { pins, update, setHidden };
}

// Site markers for the region in view: a dot at each site's box centre and a label with its priority and name.
// Sites close together (the near-base pair is about 10 px apart at 250 km) get their labels stacked, with a leader
// line from the dot. Returns {update(regionId | null, rows, names), setHidden(bool)}.
export function addSitePins(globe, catalog, { onSite = () => {} } = {}) {
  const marks = new Map(); // siteId -> {obj, el, label, prio, lead, regionId}
  for (const r of catalog.regions) {
    for (const s of r.sites) {
      const [w, so, e, n] = s.bounds;
      const el = h('button', 'site-pin');
      el.type = 'button';
      el.dataset.site = s.id;
      el.title = 'Open ' + s.name + ' on the terrain';
      const lead = h('span', 'lead');
      const label = h('span', 'slabel');
      const prio = h('span', 'sprio', '·');
      label.append(prio, h('span', 'sname', shortName(s.name)));
      el.append(h('span', 'sdot'), lead, label);
      el.addEventListener('click', () => onSite(s.id));
      const obj = globe.addPin({ lon: (w + e) / 2, lat: (so + n) / 2, el });
      obj.userData.hidden = true;
      marks.set(s.id, { obj, el, label, prio, lead, regionId: r.id, order: 0 });
    }
  }
  let region = null, hidden = false;

  function update(regionId, rows) {
    region = rows && rows.length ? regionId : null;
    const byId = new Map((rows || []).map((x, i) => [x.siteId, { row: x, i }]));
    for (const [id, m] of marks) {
      const hit = byId.get(id);
      m.obj.userData.hidden = hidden || !hit || m.regionId !== region;
      if (!hit) continue;
      m.prio.textContent = String(hit.row.priority);
      m.el.classList.toggle('failed', hit.row.failures.length > 0);
      m.order = hit.i;
    }
  }
  function setHidden(v) { hidden = !!v; for (const m of marks.values()) if (hidden) m.obj.userData.hidden = true; }

  // Stack labels that would overlap, in priority order, a few times a second.
  const v = globe.camera.position.clone();
  let last = 0;
  globe.onFrame((dt, now) => {
    if (!region || hidden || now - last < 200) return;
    last = now;
    const W = globe.renderer.domElement.clientWidth, H = globe.renderer.domElement.clientHeight;
    const shown = [...marks.values()].filter((m) => m.regionId === region).sort((a, b) => a.order - b.order);
    const placed = [];
    for (const m of shown) {
      v.copy(m.obj.position).project(globe.camera);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H, lw = m.label.offsetWidth || 120, lh = 44; // 44 px targets
      let dy = 0;
      const hits = (yy) => placed.some((p) => x + 10 < p.x + p.w && x + 10 + lw > p.x && yy - lh / 2 < p.y + p.h / 2 && yy + lh / 2 > p.y - p.h / 2);
      while (hits(y + dy) && dy < 200) dy += lh + 2;
      placed.push({ x: x + 10, y: y + dy, w: lw, h: lh });
      m.label.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
      m.lead.style.height = dy ? dy + 'px' : '0';
    }
  });
  return { update, setHidden };
}

// The base of the region in view, as a small labelled marker ("Gale crater base"). Not shown on the whole globe, where
// the region pin stands for it, nor while a site is open (site.js draws it on the site's terrain then).
// Returns {update(regionId | null)}.
export function addBasePins(globe, catalog) {
  const marks = new Map();
  for (const r of catalog.regions) {
    if (!r.base) continue;
    const el = h('div', 'base-pin');
    el.dataset.region = r.id;
    el.append(h('span', 'bdot'), h('span', 'blabel', r.name + ' base'));
    const obj = globe.addPin({ lon: r.base.lon, lat: r.base.lat, el });
    obj.center.set(1, 0.5); // the label hangs to the left of the base
    obj.userData.hidden = true;
    marks.set(r.id, obj);
  }
  return { update(regionId) { for (const [id, obj] of marks) obj.userData.hidden = id !== regionId; } };
}
