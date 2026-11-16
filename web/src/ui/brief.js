// The construction brief (Task 9): the Twin Trails intake from design-reference/mars-construction-twin-trails.html, its
// copy verbatim. One panel asks for the construction (type of work, robots) and the schedule (working time, duration,
// turnaround); "Planning defaults" holds the editable assumptions (fleet mix, processing, retention, power, backup).
// "Find area" checks the values and hands over (onDone); the facility is sized from toSizingBrief(values) in main.js,
// and the outcome is the facility step (ui/landing.js createFacility). A sized brief becomes the facility the map places
// and checks every site against, so it changes the sites' results and their priority.
import { assumptionChip } from './chips.js';
import { markerLabel } from '../sizing/index.js';

export const SOL_HOURS = 24.65; // a sol, in hours: the working time cannot exceed it
export const REVIEW_FACTORS = ['Buildable terrain', 'Ground & ice evidence', 'Solar conditions', 'Thermal conditions', 'Investigation routes'];
const WORK_TYPES = [['earthworks', 'Site preparation & earthworks'], ['survey', 'Surveying & terrain mapping']];
const CADENCES = ['Once per sol', 'Every 4 hours', 'At phase end'];
const PRECISIONS = ['Coarse survey', 'Earthworks check', 'Precision assembly'];
const POWERS = ['Solar + storage', 'Hybrid', 'Base connection'];
const TEXT_KEYS = new Set(['name', 'workType', 'power', 'precision', 'cadence']);

// The number fields in panel order, with the mockup's labels, units and limits; defaults: inside "Planning defaults".
const NUMBERS = [
  { key: 'robots', label: 'Construction robots', unit: 'robots', min: 1, max: 10000, whole: true },
  { key: 'hours', label: 'Working time', unit: 'h / sol', min: 0.1, max: SOL_HOURS },
  { key: 'duration', label: 'Project duration', unit: 'sols', min: 0.1, max: 10000 },
  { key: 'deadline', label: 'Results needed within', unit: 'hours', min: 0.1, max: 8760 },
  ...[['surveyPercent', 'Survey share'], ['excPercent', 'Excavation share'], ['surveyActive', 'Survey robots active together'],
    ['otherActive', 'Other robots active together']].map(([key, label]) => ({ key, label, unit: '%', min: 0, max: 100, whole: true, defaults: true })),
  { key: 'rawRetention', label: 'Keep raw data', unit: 'sols', min: 0, max: 10000, whole: true, defaults: true },
  { key: 'productRetention', label: 'Keep processed outputs', unit: 'sols', min: 0, max: 10000, whole: true, defaults: true },
  { key: 'basePower', label: 'Available base power', unit: 'kW', min: 0, max: 1000000, whole: true, defaults: true },
  { key: 'backup', label: 'Essential backup duration', unit: 'hours', min: 0, max: 8760, whole: true, defaults: true },
];
const FIELD = Object.fromEntries(NUMBERS.map((f) => [f.key, f]));

export const ERRORS = {
  shares: 'Survey and excavation shares must add up to 100% or less.', // the mockup's
  basePower: 'Enter the available base power for hybrid or base-connected operation.',
};
const num = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '?');
const rangeError = (f) => `${f.label}: enter a ${f.whole ? 'whole ' : ''}number from ${num(f.min)} to ${num(f.max)}${f.unit === '%' ? '%' : ' ' + f.unit}.`;
const usesBase = (power) => power === 'Hybrid' || power === 'Base connection';

// The first problem with the values, as the mockup's validate checks them (the shares first, then each field in panel
// order), then base power for hybrid or base-connected operation: {message, key (the field to fix), defaults (it sits in
// the disclosure)}, or null.
export function intakeError(s) {
  if (s.workType !== 'survey' && s.surveyPercent + s.excPercent > 100) return { message: ERRORS.shares, key: 'surveyPercent', defaults: true };
  for (const f of NUMBERS) {
    const v = s[f.key];
    if (!Number.isFinite(v) || v < f.min || v > f.max || (f.whole && !Number.isInteger(v))) return { message: rangeError(f), key: f.key, defaults: !!f.defaults };
  }
  if (usesBase(s.power) && !(s.basePower > 0)) return { message: ERRORS.basePower, key: 'basePower', defaults: true };
  return null;
}

// The values as the brief the sizing engine reads (sizing/request.js fromBrief): the mockup's computeProfile. Survey work
// is an all-survey fleet; earthworks splits it by the shares, rounding down, and transport takes the remainder. Groups
// with no robots are left out.
export function toSizingBrief(s) {
  const n = s.robots, survey = s.workType === 'survey';
  const sv = survey ? n : Math.floor(n * s.surveyPercent / 100), ex = survey ? 0 : Math.floor(n * s.excPercent / 100);
  const fleet = [['Survey', sv, s.surveyActive], ['Excavation', ex, s.otherActive], ['Transport', n - sv - ex, s.otherActive]]
    .map(([role, count, pct], i) => ({ id: i + 1, role, count, active: Math.floor(count * pct / 100) }))
    .filter((f) => f.count > 0);
  const known = (value, unit) => ({ mode: 'known', value, unit });
  return {
    name: s.name, types: [], fleet,
    jobs: { map: true, progress: !survey, inspection: false, plan: !survey },
    cadence: Object.fromEntries(['map', ...(survey ? [] : ['progress', 'plan'])].map((k) => [k, s.cadence])),
    quality: s.precision, power: s.power, deployment: 'Dedicated installation',
    q: {
      hours: known(s.hours, 'h / sol'), duration: known(s.duration, 'sols'), deadline: known(s.deadline, 'hours'),
      retention: known(s.rawRetention, 'sols'), products: known(s.productRetention, 'sols'), backup: known(s.backup, 'hours'),
      basePower: known(s.basePower, 'kW'), // read only for hybrid or base-connected operation
    },
  };
}

// "Gale landing pad & access road · 20 robots": the brief's name on the location-assessment panels.
export function briefLine(s) {
  const n = Number.isFinite(s.robots) ? s.robots : 0;
  return ((s.name || '').trim() || 'Untitled project') + ' · ' + n + (n === 1 ? ' robot' : ' robots');
}

// ---- what the facility needs from a site (shown on the facility step) ----
const whole = (n) => Math.round(n).toLocaleString('en-US');
const one = (n) => n.toFixed(1);
const kilometres = (m) => String(Number((m / 1000).toFixed(1)));
const REQUIREMENTS = [
  ['Buildable terrain', ['full_reference_plot_m2', 'pad_slope_limit_deg', 'roughness_limit_m'],
    ([plot, slope, bumps]) => `${whole(plot)} m² of flat ground · pad ≤ ${num(slope)}° · bumps ≤ ${num(bumps)} m`],
  [REVIEW_FACTORS[1], ['required_allowable_bearing_kpa'], ([kpa]) => `ground must hold ≥ ${one(kpa)} kPa`],
  [REVIEW_FACTORS[2], ['required_solar_average_kw', 'solar_panel_area_m2'], ([kw, m2]) => `≥ ${one(kw)} kW on average · ${whole(m2)} m² of panels · resized at each site`],
  [REVIEW_FACTORS[3], ['heat_rejection_kw', 'radiator_emitting_area_m2'], ([kw, m2]) => `get rid of ${one(kw)} kW of heat · ${whole(m2)} m² of radiator · resized at each site`],
  [REVIEW_FACTORS[4], ['service_distance_limit_m', 'vehicle_grade_limit_deg', 'corridor_width_m'],
    ([m, grade, width]) => `≤ ${kilometres(m)} km from base · grade ≤ ${num(grade)}° · ${num(width)} m corridor`],
];

// The five requirement rows from the assessed option, for a sizing brief b: [{name, text, sized}]. An unsized row says
// what it still needs, or why the brief cannot be sized.
export function requirements(b, sizing) {
  const specs = (sizing.assessed && sizing.assessed.specifications) || {};
  const value = (k) => (specs[k] && specs[k].status === 'resolved' ? specs[k].value : null);
  const resolved = (keys) => keys.every((k) => value(k) !== null);
  const needs = (keys) => {
    const labels = [...new Set(keys.flatMap((k) => ((specs[k] && specs[k].missing_inputs) || []).filter((m) => m.startsWith('input:')).map(markerLabel)))];
    return labels.length ? labels : sizing.missing.map((m) => m.label);
  };
  return REQUIREMENTS.map(([name, keys, text]) => {
    if (name === REVIEW_FACTORS[2] && sizing.status === 'sized' && b.power === 'Base connection') {
      const base = b.q && b.q.basePower ? num(b.q.basePower.value) : '?';
      return { name, sized: true, text: `No solar plot: the base supplies ${base} kW, the facility peaks at ${one(value('facility_peak_kw'))} kW` };
    }
    if (resolved(keys)) return { name, sized: true, text: text(keys.map(value)) };
    if (sizing.status === 'cannot_size') return { name, sized: false, text: sizing.problems[0].message };
    return { name, sized: false, text: 'Needs: ' + (needs(keys).join(', ') || 'more answers') };
  });
}

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

// el: the brief panel; side: the old "Project brief" summary aside, left empty. onChange(values) gets every edit (so the
// stepper, Close and Edit keep them); onClose() follows Close; onDone() follows a valid "Find area". pending() -> null when
// the sizing can run now, else a promise that settles when it can (the coefficients still loading): until then "Sizing in
// progress" shows, and "Back to brief" cancels.
export function createBrief(el, side, { onChange = () => {}, onDone = () => {}, onClose = () => {}, pending = () => null } = {}) {
  let s = null, defaultsOpen = false, run = 0;
  el.setAttribute('aria-labelledby', 'brief-title');
  side.replaceChildren();

  // A labelled field, the mockup's: "Label <small>Required</small>" then the control (with its unit).
  function field(label, control, { tag = null, unit = null } = {}) {
    const f = h('label', 'construction-field');
    f.append(h('span', 'field-name', label));
    if (tag) f.append(' ', h('small', tag.toLowerCase(), tag));
    if (unit) { const u = h('span', 'input-unit'); u.append(control, h('span', 'unit', unit)); f.append(u); } else f.append(control);
    return f;
  }
  function bind(control, key) {
    control.dataset.input = key;
    const text = TEXT_KEYS.has(key);
    control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => {
      s = { ...s, [key]: text ? control.value : (control.value === '' ? null : Number(control.value)) };
      onChange(s);
    });
    return control;
  }
  function select(key, choices, label, tag) {
    const c = document.createElement('select');
    for (const ch of choices) {
      const [v, t] = Array.isArray(ch) ? ch : [ch, ch];
      const o = h('option', '', t);
      o.value = v;
      o.selected = v === s[key];
      c.append(o);
    }
    if (tag) c.required = true;
    return field(label, bind(c, key), { tag });
  }
  function number(key, tag) {
    const f = FIELD[key], i = document.createElement('input');
    Object.assign(i, { type: 'number', min: String(f.min), max: String(f.max), step: f.whole ? '1' : 'any', required: true });
    i.inputMode = f.whole ? 'numeric' : 'decimal';
    i.value = Number.isFinite(s[key]) ? String(s[key]) : '';
    i.setAttribute('aria-label', f.label);
    return field(f.label, bind(i, key), { tag, unit: f.unit });
  }
  function section(title, ...fields) {
    const d = h('div', 'input-section');
    d.append(h('h3', '', title), ...fields);
    return d;
  }
  function group(title, ...children) {
    const d = h('div', 'default-group');
    d.append(h('h3', '', title), ...children);
    return d;
  }
  function defaults() {
    const d = h('details', 'assumptions');
    d.dataset.defaults = '';
    d.open = defaultsOpen;
    d.addEventListener('toggle', () => { defaultsOpen = d.open; });
    const sum = h('summary', '', 'Planning defaults · optional to customize');
    sum.append(' ', assumptionChip('planning assumptions, not validated design values'));
    const name = document.createElement('input');
    Object.assign(name, { type: 'text', maxLength: 100, value: s.name || '' });
    d.append(sum, h('p', '', 'Change any assumption below. Your edits are used in the calculation.'),
      field('Project name', bind(name, 'name'), { tag: 'Optional' }),
      group('Robot mix', h('p', 'sub', 'Earthworks uses these shares; the remainder is transport. Survey-only work uses an all-survey fleet. Counts round down; transport takes the remainder.'),
        number('surveyPercent'), number('excPercent'), number('surveyActive'), number('otherActive')),
      group('Processing & retention', select('cadence', CADENCES, 'Processing frequency'), select('precision', PRECISIONS, 'Processing precision'),
        number('rawRetention'), number('productRetention')),
      group('Power & backup', select('power', POWERS, 'Power approach'), number('basePower'), number('backup')),
      h('p', 'sub', 'Planning assumptions, not validated design recommendations. Base power applies to hybrid or base-connected operation.'));
    return d;
  }

  function find() {
    const problem = intakeError(s), alert = el.querySelector('.form-error');
    for (const c of el.querySelectorAll('[aria-invalid]')) c.removeAttribute('aria-invalid');
    if (problem) {
      el.querySelector('[data-input="' + problem.key + '"]').setAttribute('aria-invalid', 'true');
      if (problem.defaults) { defaultsOpen = true; el.querySelector('[data-defaults]').open = true; }
      alert.textContent = problem.message; // beside Find area, as in the mockup; it names the field to change
      return;
    }
    alert.textContent = '';
    const wait = pending();
    if (!wait) { onDone(); return; }
    const token = ++run;
    progress();
    const settle = () => { if (token === run) { run++; onDone(); } }; // a failed load still settles: the outcome says so
    wait.then(settle, settle);
  }

  // While the sizing waits for the coefficients: "Sizing in progress", and "Back to brief" to cancel.
  function progress() {
    const box = h('div', 'sizing-progress');
    const status = h('p', 'status', 'Sizing in progress');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const back = button('text-action', 'Back to brief', { id: 'brief-cancel' });
    back.addEventListener('click', () => { run++; render(); el.querySelector('#brief-find').focus({ preventScroll: true }); });
    box.append(status, back);
    el.replaceChildren(box);
    back.focus({ preventScroll: true });
  }

  function render() {
    const form = document.createElement('form');
    form.noValidate = true;
    form.addEventListener('submit', (e) => { e.preventDefault(); find(); });
    const top = h('div', 'panel-top');
    const title = h('h2', '', 'Construction site');
    title.id = 'brief-title';
    const close = button('text-action', 'Close', { id: 'brief-close', 'aria-label': 'Close construction brief' });
    close.addEventListener('click', () => { run++; onClose(); });
    top.append(title, close);
    const schedule = h('div', 'schedule-fields');
    schedule.append(number('hours', 'Required'), number('duration', 'Required'), number('deadline', 'Required'));
    const alert = h('p', 'form-error');
    alert.setAttribute('role', 'alert');
    const actions = h('div', 'form-actions');
    const go = button('primary', 'Find area', { id: 'brief-find' });
    go.type = 'submit'; // Enter in a field finds the area too (the form's submit handler)
    actions.append(go);
    form.append(top, h('p', 'panel-intro', 'A few project details. A place to begin.'),
      section('01 · The construction', select('workType', WORK_TYPES, 'Type of work', 'Required'), number('robots', 'Required')),
      section('02 · The schedule', schedule), defaults(), alert, h('p', 'input-caption', 'Editable defaults · required fields are marked'), actions);
    el.replaceChildren(form);
  }

  return {
    // Show the intake with these values; focus goes to its first control.
    open(values) {
      s = { ...values };
      run++;
      render();
      el.querySelector('[data-input]').focus({ preventScroll: true });
    },
  };
}
