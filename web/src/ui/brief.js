// The construction brief (Task 9d): the Guided brief's four tabs (Project, Robots, Operations, Review) from
// design-reference/mars-construction-intake.html, its visible variant, with its copy verbatim, and the "Project brief"
// summary beside them. The brief is recorded and shown; it never sizes the facility, changes a status or the priority,
// because the sizing model is planned, not implemented.

export const TABS = ['Project', 'Robots', 'Operations', 'Review'];
export const ROLES = ['Survey', 'Excavation', 'Transport', 'Assembly', 'Inspection'];
export const BUILD_TYPES = ['Landing pad', 'Road', 'Habitat', 'Power installation', 'Utility network', 'Other'];
export const SOL_HOURS = 24.65; // a sol, in hours: operating time cannot exceed it
export const REVIEW_FACTORS = ['Buildable terrain', 'Ground & ice evidence', 'Solar conditions', 'Thermal conditions', 'Investigation routes'];
const LOCATIONS = ['Gale study region — site not selected', 'Coordinates not yet known'];
const PRECISION = ['Coarse survey', 'Earthworks check', 'Precision assembly', 'Unknown'];
const JOBS = [['map', 'Terrain maps'], ['progress', 'Progress comparisons'], ['inspection', 'Inspection reports'], ['plan', 'Fleet work plans']];
const CADENCES = ['Once per sol', 'Every 4 hours', 'At phase end', 'Unknown'];
const LATE = ['Pause dependent work', 'Use previous result', 'Defer nonessential work', 'Unknown'];
const POWER = ['Unknown', 'Base connection', 'Solar + storage', 'Hybrid'];
const CONTINUITY = ['Unknown', 'Up to 1 hour', 'Up to 4 hours', 'Work can pause'];
const DEPLOYMENT = ['Compare both', 'Inside the base', 'Dedicated installation'];
const MODES = [['known', 'Known'], ['range', 'Range'], ['unknown', 'Unknown']];

// Each quantity: its field label, its name under "Still to confirm" (the mockup's), and the tab that asks for it.
// The order is the mockup's, and the order of "Still to confirm".
const QUANTITIES = {
  area: { label: 'Survey area', missing: 'Survey area', tab: 0 },
  road: { label: 'Road length', missing: 'Road length', tab: 0 },
  hours: { label: 'Operating time', missing: 'Operating schedule', tab: 2, max: SOL_HOURS },
  deadline: { label: 'Results needed within', missing: 'Turnaround', tab: 2 },
  duration: { label: 'Project duration', missing: 'Project duration', tab: 2 },
  retention: { label: 'Keep raw survey data', missing: 'Data retention', tab: 2 },
};
const asked = (brief, key) => key !== 'road' || brief.types.includes('Road'); // a road's length only when a road is built

// The mockup's corrections, plus two it leaves to the browser (a known value, the other construction type).
export const ERRORS = {
  name: 'Enter a project name.',
  types: 'Choose at least one construction type.',
  other: 'Describe the other construction type.',
  fleet: 'Add at least one robot group.',
  counts: 'Active robots must be whole numbers between zero and the group total.',
  jobs: 'Choose at least one required output.',
  known: 'Enter a number greater than zero, or choose Range or Unknown.',
  range: 'Enter a positive range with the minimum no greater than the maximum.',
  hours: 'Operating time cannot exceed one Mars day (about 24.65 hours).',
};

const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// null when the quantity is usable in its mode: unknown needs nothing, known a value above zero, range both ends above
// zero with min ≤ max; and nothing above max (one sol, for the operating time).
export function quantityError(q, { max = Infinity } = {}) {
  if (!q || q.mode === 'unknown') return null;
  if (q.mode === 'range') {
    if (!positive(q.min) || !positive(q.max) || q.min > q.max) return ERRORS.range;
    return q.max > max ? ERRORS.hours : null;
  }
  if (!positive(q.value)) return ERRORS.known;
  return q.value > max ? ERRORS.hours : null;
}

const num = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '?');
// A quantity in words: "Unknown" (never zero), "10,000–30,000 m²", "12 h / sol", "1 hour".
export function qtext(q, unit = q && q.unit) {
  if (!q || q.mode === 'unknown') return 'Unknown';
  if (q.mode === 'range') return num(q.min) + '–' + num(q.max) + ' ' + unit;
  return num(q.value) + ' ' + (q.value === 1 && unit === 'hours' ? 'hour' : unit);
}

const sum = (fleet, k) => fleet.reduce((n, f) => n + (Number.isFinite(f[k]) ? f[k] : 0), 0);
export const fleetTotal = (brief) => sum(brief.fleet, 'count');
export const activeTotal = (brief) => sum(brief.fleet, 'active');

// "Gale landing pad & access road · 20 robots": the brief's name on the location-assessment panels.
export function briefLine(brief) {
  const n = fleetTotal(brief);
  return ((brief.name || '').trim() || 'Untitled project') + ' · ' + n + (n === 1 ? ' robot' : ' robots');
}

// The "Project brief" summary beside the tabs.
export const summaryRows = (b) => [
  ['Build', b.types.join(' + ') || 'Not selected'],
  ['Robots', fleetTotal(b) + ' total'],
  ['Active together', String(activeTotal(b))],
  ['Operating time', qtext(b.q.hours, 'h / sol')],
  ['Turnaround', qtext(b.q.deadline, 'hours')],
];

// The quantities still unknown, by their mockup names.
export const stillToConfirm = (b) => Object.keys(QUANTITIES).filter((k) => asked(b, k) && b.q[k].mode === 'unknown').map((k) => QUANTITIES[k].missing);
export const stillToConfirmText = (b) => stillToConfirm(b).join(', ') || 'No unanswered quantity fields';

export const reviewRows = (b) => [
  ['Construction', b.types.join(', ') || 'Not selected'],
  ['Work schedule', qtext(b.q.hours, 'hours per sol')],
  ['Results needed', qtext(b.q.deadline, 'hours')],
  ['Still to confirm', stillToConfirmText(b)],
];

// The first problem on a tab, or null; the review (tab 3) checks every tab, the first problem first.
function problems(b, tab) {
  const out = [];
  if (tab === 0) {
    if (!(b.name || '').trim()) out.push(ERRORS.name);
    if (!b.types.length) out.push(ERRORS.types);
    if (b.types.includes('Other') && !(b.other || '').trim()) out.push(ERRORS.other);
  }
  if (tab === 1) {
    if (!b.fleet.length) out.push(ERRORS.fleet);
    else if (b.fleet.some((f) => !Number.isInteger(f.count) || !Number.isInteger(f.active) || f.count < 0 || f.active < 0 || f.active > f.count)) out.push(ERRORS.counts);
  }
  if (tab === 2 && !Object.values(b.jobs).some(Boolean)) out.push(ERRORS.jobs);
  for (const [k, spec] of Object.entries(QUANTITIES)) {
    if (spec.tab !== tab || !asked(b, k)) continue;
    const e = quantityError(b.q[k], spec);
    if (e) out.push(e);
  }
  return out;
}
function firstProblem(b, tab) {
  for (const t of tab === 3 ? [0, 1, 2] : [tab]) { const p = problems(b, t); if (p.length) return { tab: t, message: p[0] }; }
  return null;
}
export function tabError(b, tab) { const p = firstProblem(b, tab); return p ? p.message : null; }

// ---------- the panel ----------

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};
const button = (cls, text, attrs = {}) => {
  const b = h('button', cls, text);
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
};
const options = (sel, list, value) => { for (const x of list) { const o = h('option', '', x); o.value = x; o.selected = x === value; sel.append(o); } };

// el: the brief panel; side: the "Project brief" summary beside it. onChange(brief) gets every change (so the stepper,
// Back and Edit keep the values); onTab(tab) every tab change; onDone() follows Continue on the review.
export function createBrief(el, side, { onChange = () => {}, onTab = () => {}, onDone = () => {} } = {}) {
  let b = null, tab = 0;
  const open = { outputs: true, more: false, next: true }; // disclosures keep their state across re-renders
  el.setAttribute('aria-labelledby', 'brief-title');
  side.setAttribute('aria-live', 'polite');
  side.setAttribute('aria-label', 'Project brief');

  const commit = () => { onChange(structuredClone(b)); paintSummary(); };

  function paintSummary() {
    const dl = h('dl', '');
    for (const [k, v] of summaryRows(b)) {
      const row = h('div', ''), dd = h('dd', '', v);
      dd.dataset.summary = k;
      row.append(h('dt', '', k), dd);
      dl.append(row);
    }
    side.replaceChildren(h('h3', '', 'Project brief'), dl, h('p', 'help', 'This brief will inform compute, power, cooling and space requirements.'));
    const t = el.querySelector('[data-total]');
    if (t) t.textContent = String(fleetTotal(b));
  }

  // A field: its label, then the control (and a help line if any). Every control has a label or an aria-label.
  function field(label, control, help) {
    const f = h('label', 'field');
    f.append(h('span', 'field-label', label), control);
    if (help) f.append(h('span', 'help', help));
    return f;
  }
  function textInput(key, id) {
    const i = document.createElement('input');
    Object.assign(i, { type: 'text', value: b[key] || '', required: true, maxLength: 120 });
    if (id) i.id = id;
    i.dataset.focus = 'key:' + key;
    i.addEventListener('input', () => { b[key] = i.value; commit(); });
    return i;
  }
  function select(key, list) {
    const s = document.createElement('select');
    options(s, list, b[key]);
    s.dataset.key = key;
    s.dataset.focus = 'key:' + key;
    s.addEventListener('change', () => { b[key] = s.value; commit(); });
    return s;
  }
  function numberInput(q, key, bound, label) {
    const i = document.createElement('input');
    Object.assign(i, { type: 'number', min: '0.01', step: 'any', required: true });
    if (QUANTITIES[key].max) i.max = String(QUANTITIES[key].max);
    i.inputMode = 'decimal';
    i.value = Number.isFinite(q[bound]) ? String(q[bound]) : '';
    if (label) i.setAttribute('aria-label', label);
    i.dataset.q = key;
    i.dataset.bound = bound;
    i.dataset.focus = 'q:' + key + ':' + bound;
    i.addEventListener('input', () => { b.q[key] = { ...b.q[key], [bound]: i.value === '' ? null : Number(i.value) }; commit(); });
    return i;
  }
  // Known / Range / Unknown, as a native select beside the label.
  function quantity(key) {
    const q = b.q[key], { label } = QUANTITIES[key], id = 'brief-q-' + key;
    const f = h('div', 'field quantity');
    const head = h('div', 'quantity-head');
    const lab = h('label', 'field-label', label);
    lab.htmlFor = id;
    const mode = document.createElement('select');
    for (const [v, t] of MODES) { const o = h('option', '', t); o.value = v; o.selected = q.mode === v; mode.append(o); }
    mode.setAttribute('aria-label', label + ' certainty');
    mode.dataset.mode = key;
    mode.dataset.focus = 'mode:' + key;
    mode.addEventListener('change', () => { b.q[key] = { ...b.q[key], mode: mode.value }; commit(); render(); });
    head.append(lab, mode);
    const vals = h('div', 'quantity-values');
    if (q.mode === 'unknown') vals.append(h('span', 'unknown-value', 'To be confirmed'));
    else if (q.mode === 'range') {
      const lo = numberInput(q, key, 'min', label + ' minimum');
      lo.id = id;
      vals.append(lo, h('span', 'unit', 'to'), numberInput(q, key, 'max', label + ' maximum'), h('span', 'unit', q.unit));
    } else {
      const v = numberInput(q, key, 'value');
      v.id = id;
      vals.append(v, h('span', 'unit', q.unit));
    }
    f.append(head, vals);
    return f;
  }
  function disclosure(key, cls, summary) {
    const d = h('details', cls);
    d.open = open[key];
    d.append(h('summary', '', summary));
    d.addEventListener('toggle', () => { open[key] = d.open; });
    return d;
  }

  function project() {
    const fields = h('div', 'fields');
    fields.append(field('Project name', textInput('name', 'brief-name')));
    const build = h('div', 'field');
    const bl = h('span', 'field-label', 'What are you building?');
    bl.id = 'brief-build-label';
    const list = h('div', 'choice-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-labelledby', 'brief-build-label');
    for (const t of BUILD_TYPES) {
      const c = h('label', 'choice');
      const cb = document.createElement('input');
      Object.assign(cb, { type: 'checkbox', checked: b.types.includes(t) });
      cb.dataset.type = t;
      cb.dataset.focus = 'type:' + t;
      cb.addEventListener('change', () => {
        b.types = BUILD_TYPES.filter((x) => (x === t ? cb.checked : b.types.includes(x)));
        commit();
        render();
      });
      c.append(cb, h('span', '', t));
      list.append(c);
    }
    build.append(bl, list);
    fields.append(build);
    if (b.types.includes('Other')) fields.append(field('Other construction type', textInput('other')));
    fields.append(quantity('area'));
    if (b.types.includes('Road')) fields.append(quantity('road'));
    fields.append(field('Construction location', select('location', LOCATIONS), 'Detailed map selection comes after the project brief.'));
    return [fields];
  }

  function robots() {
    const head = h('div', 'fleet-head');
    head.setAttribute('aria-hidden', 'true');
    for (const t of ['Main task', 'Total', 'Active', '']) head.append(h('span', '', t));
    const rows = h('div', 'robot-rows');
    for (const f of b.fleet) {
      const row = h('div', 'robot-row');
      const role = document.createElement('select');
      options(role, ROLES, f.role);
      role.setAttribute('aria-label', 'Robot ' + f.id + ' main task');
      Object.assign(role.dataset, { robot: f.id, prop: 'role', focus: 'robot:' + f.id + ':role' });
      role.addEventListener('change', () => { f.role = role.value; commit(); render(); }); // the row's labels name the task
      const count = (prop, label) => {
        const i = document.createElement('input');
        Object.assign(i, { type: 'number', min: '0', step: '1', required: true, value: Number.isFinite(f[prop]) ? String(f[prop]) : '' });
        i.inputMode = 'numeric';
        if (prop === 'active' && Number.isFinite(f.count)) i.max = String(f.count);
        i.setAttribute('aria-label', f.role + ' ' + label);
        Object.assign(i.dataset, { robot: f.id, prop, focus: 'robot:' + f.id + ':' + prop });
        i.addEventListener('input', () => {
          f[prop] = i.value === '' ? null : Number(i.value);
          if (prop === 'count') { const a = row.querySelector('[data-prop="active"]'); if (a && Number.isFinite(f.count)) a.max = String(f.count); }
          commit();
        });
        return i;
      };
      const remove = button('text-action remove', '×', { 'aria-label': 'Remove ' + f.role + ' group', 'data-remove': String(f.id) });
      remove.addEventListener('click', () => { b.fleet = b.fleet.filter((x) => x !== f); commit(); render('add'); });
      row.append(role, count('count', 'total robots'), count('active', 'active robots'), remove);
      rows.append(row);
    }
    const add = button('secondary add', '+ Add robot group', { 'data-add': '' });
    add.dataset.focus = 'add';
    add.addEventListener('click', () => {
      const id = b.fleet.reduce((m, f) => Math.max(m, f.id), 0) + 1;
      b.fleet = [...b.fleet, { id, role: 'Inspection', count: 1, active: 1 }];
      commit();
      render('robot:' + id + ':role'); // the new group, ready to set
    });
    const total = h('div', 'fleet-total');
    const n = h('span', '');
    const strong = h('strong', '', String(fleetTotal(b)));
    strong.dataset.total = '';
    n.append(strong, ' robots');
    total.append(h('span', '', 'Total fleet'), n);
    return [h('p', 'help', 'Group robots by their main task. Active units work at the same time.'), head, rows, add, total,
      h('p', 'help', 'Onboard driving and safety remain with each robot.')];
  }

  function operations() {
    const fields = h('div', 'fields');
    fields.append(field('Construction phase', textInput('phase')), quantity('hours'), quantity('duration'),
      field('Construction precision', select('quality', PRECISION)), quantity('deadline'));
    const outputs = disclosure('outputs', 'outputs', 'Required processing outputs');
    for (const [key, label] of JOBS) {
      const row = h('div', 'job');
      const lab = h('label', '');
      const cb = document.createElement('input');
      Object.assign(cb, { type: 'checkbox', checked: !!b.jobs[key] });
      cb.dataset.job = key;
      cb.dataset.focus = 'job:' + key;
      const cad = document.createElement('select');
      options(cad, CADENCES, b.cadence[key]);
      cad.setAttribute('aria-label', label + ' frequency');
      cad.dataset.cadence = key;
      cad.dataset.focus = 'cadence:' + key;
      cad.disabled = !b.jobs[key];
      cb.addEventListener('change', () => { b.jobs = { ...b.jobs, [key]: cb.checked }; cad.disabled = !cb.checked; commit(); });
      cad.addEventListener('change', () => { b.cadence = { ...b.cadence, [key]: cad.value }; commit(); });
      lab.append(cb, label);
      row.append(lab, cad);
      outputs.append(row);
    }
    outputs.append(h('p', 'help', 'Flexible processing jobs can run when power is available.'));
    const more = disclosure('more', 'more', 'Retention, infrastructure & continuity');
    const mf = h('div', 'fields');
    mf.append(quantity('retention'), field('Available power', select('power', POWER)),
      field('Allowed service interruption', select('continuity', CONTINUITY)), field('Computing installation', select('deployment', DEPLOYMENT)));
    more.append(mf, h('p', 'help', 'Equipment and processing profiles are selected during sizing. Unknowns stay visible.'));
    return [h('h3', '', 'How will the work run?'), fields,
      h('p', 'help', 'Turnaround starts when survey collection finishes. A sol is a Mars day.'),
      outputs, field('If a result is late', select('late', LATE)), more];
  }

  function review() {
    const dl = h('dl', 'review-dl');
    for (const [k, v] of reviewRows(b)) { const row = h('div', ''); row.append(h('dt', '', k), h('dd', '', v)); dl.append(row); }
    const next = disclosure('next', 'next', 'What happens next');
    const list = h('ul', 'factor-list');
    for (const f of REVIEW_FACTORS) { const li = h('li', '', f); li.append(h('span', '', 'Awaiting sizing')); list.append(li); }
    next.append(h('p', 'help', 'The sizing model will translate this brief into a facility option and the requirements below.'), list);
    return [h('h3', '', 'Review before sizing'), h('p', 'help', briefLine(b)), dl, next];
  }

  let alert = null;
  function go(t, focusKey) {
    if (t > tab) { // moving on checks the tab being left
      const p = firstProblem(b, tab);
      if (p) { alert.textContent = p.message; return; } // the correction, where the problem is
    }
    tab = t;
    onTab(tab);
    render(focusKey);
  }

  // Re-render the panel. Focus goes to the control named by prefer (its data-focus key), else stays on the same control,
  // else goes to the current tab; it is only moved when it was in the panel or prefer is given.
  function render(prefer) {
    const a = document.activeElement, was = a && el.contains(a) ? a.dataset.focus : null;
    el.replaceChildren();
    const intro = h('div', 'intro-line');
    intro.append(h('span', 'sample-label', 'Editable example'), h('span', 'count', (tab + 1) + ' of 4'));
    const title = h('h2', '');
    title.id = 'brief-title';
    title.append(h('span', '', 'Plan the work.'), ' ', h('span', '', 'Find its foundation.'));
    const tabs = h('nav', 'tabs');
    tabs.setAttribute('aria-label', 'Brief sections');
    TABS.forEach((name, i) => {
      const t = button('tab', name, { 'data-tab': String(i), 'data-focus': 'tab:' + i });
      if (i === tab) t.setAttribute('aria-current', 'step');
      t.addEventListener('click', () => go(i, 'tab:' + i));
      tabs.append(t);
    });
    const content = h('div', 'step-content');
    content.append(...[project, robots, operations, review][tab]());
    alert = h('p', 'alert');
    alert.setAttribute('role', 'alert');
    const actions = h('div', 'actions');
    if (tab) {
      const back = button('text-action', 'Back', { id: 'brief-back', 'data-focus': 'back' });
      back.addEventListener('click', () => go(tab - 1, 'back'));
      actions.append(back);
    } else actions.append(h('small', '', 'Start with what you know.'));
    const next = button('primary', 'Continue', { id: 'brief-next', 'data-focus': 'next' });
    next.addEventListener('click', () => {
      if (tab < 3) { go(tab + 1, 'next'); return; }
      const p = firstProblem(b, 3);
      if (p) { go(p.tab, 'tab:' + p.tab); alert.textContent = p.message; return; }
      onDone();
    });
    actions.append(next);
    el.append(intro, title, h('p', 'subhead', 'Start with the construction your robots will do.'), tabs, content, alert, actions);
    paintSummary();
    const target = [prefer, was, 'tab:' + tab].map((k) => k && el.querySelector('[data-focus="' + k + '"]')).find(Boolean);
    if (was || prefer) target.focus({ preventScroll: true });
  }

  return {
    // Show the brief at a tab, with its values; focus goes to the tab's first control.
    open(brief, t = 0) {
      b = structuredClone(brief);
      tab = t;
      render();
      const first = el.querySelector('.step-content input, .step-content select, .step-content button');
      (first || el.querySelector('[aria-current="step"]')).focus({ preventScroll: true });
    },
  };
}
