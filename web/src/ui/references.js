// References (Task 9c): one disclosure at the bottom left on every screen, in place of the separate legend, chip key
// and credits. Four parts: how to read the map (factor icons, status colours, footprint colours, evidence chips and the
// globe's colour grade), the data on screen (each source with its link, and the shaded-relief toggle), all the data
// in the catalog, grouped, and the demo parts (Task 12). The current view's one-line key stays in the panel (ui/factors.js).
import { FOOTPRINT_COLOURS } from '../site.js';
import { EVIDENCE, EVIDENCE_MEANING, chipEl } from './chips.js';
import { FACILITY_LABEL } from './landing.js';
import { statusSvg } from './icons.js';

// The catalog references of the given datasets, each once, in the order first met. Unknown ids are skipped.
export function referencesFor(catalog, datasetIds) {
  const refs = (catalog.raw && catalog.raw.references) || {};
  const seen = new Set(), out = [];
  for (const id of datasetIds) {
    const d = catalog.byId.get(id);
    for (const r of (d && d.references) || []) {
      if (seen.has(r) || !refs[r]) continue;
      seen.add(r);
      out.push({ id: r, ...refs[r] });
    }
  }
  return out;
}

const GROUP_NAMES = { nasa: 'NASA missions, instruments and services', partner: 'Partner agencies', other: 'Models, studies and this project' };
const GLOBE_NOTE = 'Globe colour: Viking MDIM 2.1 mosaic, colour-graded warmer for display.';
// Each status: its icon (the factor rows, the list, the pins and the bar) and its colour with the design guide's label.
const STATUSES = [
  { icon: '✓', kind: 'met', label: 'Meets screening criterion', icons: 'every check orbital data can settle here is met' },
  { icon: '✗', kind: 'conflict', label: 'Requirement conflict (the card names it)', icons: 'a requirement fails' },
  { icon: '?', kind: 'unresolved', label: 'Unresolved: missing evidence (the card says what settles it)', icons: 'not settled yet, from orbit or in the field' },
];
const CAVEAT = 'the dataset disagrees with rover heights; see its tooltip';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};

function refEl(r) {
  const el = h('div', 'ref');
  el.dataset.ref = r.id;
  el.append(h('b', '', r.title || r.id));
  if (r.credit) el.append(h('span', 'credit', 'Credit: ' + r.credit));
  if (r.role) el.append(h('span', 'role', r.role));
  if (r.citation) el.append(h('span', 'cite', r.citation));
  const meta = h('span', 'meta');
  if (r.license) meta.append(h('span', 'lic', r.license));
  if (r.url && /^https:\/\//.test(r.url)) { // https links only
    const a = h('a', '', r.url.replace(/^https:\/\//, '').replace(/\/$/, ''));
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    meta.append(a);
  }
  if (meta.childElementCount) el.append(meta);
  return el;
}

function part(key, title) {
  const s = h('section', 'part');
  s.dataset.part = key;
  s.append(h('h3', '', title));
  return s;
}

function howToRead() {
  const s = part('read', 'How to read the map');
  s.append(h('p', '', 'Each site is judged on five factors: Terrain, Ground & ice, Solar, Thermal and Routes. Each has an icon:'));
  // the icon's shape, as the list, the pins and the card draw it (R37), with its glyph for screen readers
  const keyIcon = (kind, icon, simulated = false) => {
    const i = h('span', 'st-icon k-' + kind);
    i.append(statusSvg(icon, { simulated }), h('span', 'sr-only', icon));
    return i;
  };
  for (const st of STATUSES) {
    const row = h('p', 'keyrow');
    row.append(keyIcon(st.kind, st.icon), ' ' + st.icons);
    s.append(row);
  }
  const na = h('p', 'keyrow');
  na.append(keyIcon('na', '—'), ' nothing here applies (for example, no solar plot in the layout)');
  const sim = h('p', 'keyrow');
  sim.append(keyIcon('met', '✓', true), ' a dashed, hollow icon marked "sim": simulated for the demo where there is no orbital '
    + 'estimate here, not a real result; it never changes a status or the priority. Hover an icon in the list for its meaning.');
  s.append(na, sim);
  const fp = h('p', 'fp-note', 'The same three colours mark each status, always with its label and icon, never colour alone. The facility layout '
    + '(compound, radiator plot north and solar plot south) is the reference facility: ');
  fp.append(h('span', 'illustrative', FACILITY_LABEL), ' It is drawn as 5 m boxes, each coloured by its own checks:');
  s.append(fp);
  for (const st of STATUSES) {
    const row = h('p', 'fp');
    const sw = h('span', 'swatch');
    sw.style.setProperty('--c', FOOTPRINT_COLOURS[st.kind]);
    row.append(sw, h('span', 'st-icon k-' + st.kind, st.icon), ' ' + st.label);
    s.append(row);
  }
  s.append(h('p', 'fp-note', 'Every value carries a chip saying how it was obtained:'));
  for (const ev of [...EVIDENCE, 'caveat']) {
    const row = h('div', 'evrow');
    row.append(chipEl({ kind: ev, text: ev }), h('span', '', ev === 'caveat' ? CAVEAT : EVIDENCE_MEANING[ev]));
    s.append(row);
  }
  s.append(h('p', 'globe-note', GLOBE_NOTE));
  return s;
}

// el: the container. onScreen() -> dataset ids drawn right now. globe: for the shaded-relief toggle. demoParts() ->
// [{id, name, text}]: the factor views that are illustrative here and what each rests on (Task 12).
export function createReferences(el, catalog, { onScreen, globe = null, demoParts = () => [] }) {
  const d = h('details', 'disclosure');
  d.id = 'references';
  const summary = h('summary', '', 'References');
  summary.id = 'references-open';
  const body = h('div', 'disc-body panel');
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', 'References');
  d.append(summary, body);
  el.replaceChildren(d);

  const head = h('header', '');
  head.append(h('h2', '', 'References'));
  const close = h('button', 'text-action', 'Close');
  close.type = 'button';
  close.id = 'references-close';
  close.addEventListener('click', hide);
  head.append(close);

  const screen = part('screen', 'Data on screen');
  const screenList = h('div', 'list');
  let relief = false;
  const lab = h('label', 'tog');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'relief-toggle';
  cb.addEventListener('change', () => { relief = cb.checked; if (globe) globe.setRelief(relief); refresh(true); });
  lab.append(cb, ' Show MOLA shaded relief on the globe');
  screen.append(h('p', 'intro', 'The sources of the imagery and data drawn now.'), screenList, lab);

  const raw = (catalog.raw && catalog.raw.references) || {};
  const allRefs = Object.entries(raw).map(([id, r]) => ({ id, ...r }));
  const all = part('all', 'All the data');
  all.append(h('p', 'intro', 'Every source in the data catalog: ' + allRefs.length + ' references. Numbers marked "assumption" are scenario '
    + 'choices, not data.'));
  const groups = new Map();
  for (const r of allRefs) { const g = r.group || 'other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  for (const [g, rs] of groups) {
    all.append(h('h4', '', GROUP_NAMES[g] || g));
    for (const r of rs) all.append(refEl(r));
  }
  const demo = part('demo', 'Demo parts');
  const demoList = h('ul', 'demo-list');
  demo.append(h('p', 'intro', 'Views that are illustrative because the data is thin here (coarse, partial, model-based or not '
    + 'collected yet), and what each rests on. A demo view never changes a status or the priority.'), demoList);
  body.append(head, howToRead(), screen, all, demo);

  let shownKey = null;
  // The data on screen, refreshed while the page is open (the view or the region can change under it).
  function refresh(force = false) {
    if (!d.open && !force) return;
    const refs = referencesFor(catalog, onScreen()), parts = demoParts();
    const key = refs.map((r) => r.id).join('|') + '#' + JSON.stringify(parts);
    if (key === shownKey && !force) return;
    shownKey = key;
    demoList.replaceChildren(...(parts.length ? parts.map((p) => {
      const li = h('li', '');
      li.dataset.view = p.id;
      li.append(h('strong', '', p.name + ': '), p.text + '.');
      return li;
    }) : [h('li', 'none', 'No demo views here.')]));
    screenList.replaceChildren(...(refs.length ? refs.map(refEl) : [h('p', 'none', 'No references listed for these layers.')]));
  }
  function hide() { d.open = false; summary.focus({ preventScroll: true }); }
  d.addEventListener('toggle', () => { if (d.open) refresh(true); });
  // Escape closes the page only while it is open and focus is in it (or nowhere): a focused layout keeps its own
  // Escape (deselect) without closing References too.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !d.open || e.defaultPrevented) return;
    const a = document.activeElement;
    if (a && a !== document.body && !d.contains(a)) return;
    e.preventDefault();
    hide();
  });
  return { refresh, hide };
}
