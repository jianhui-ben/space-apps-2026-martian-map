// The landing, the stepper and the facility step: landing -> 1 Construction brief (ui/brief.js) -> 2 Facility specifications
// -> 3 Location assessment. The facility the map places is the facility calculated from the brief (sizing/index.js
// briefSetup), labelled as a screening calculation; the legacy reference facility (a test hook's setup) keeps its
// illustrative-reference label.
import { footprintSpecs } from '../layout.js';
import { assumptionChip } from './chips.js';
import { requirements } from './brief.js';

export const FACILITY_LABEL = 'Illustrative reference — not calculated from your project.';
export const SIZED_LABEL = 'Calculated from your brief with screening assumptions — not a validated design.';
export const ASSUMPTIONS = 'Base services included. Firm power plus supplemental solar assumed; capacity unverified. '
  + 'Facility sizing requires workload validation.';
const SIZED_ASSUMPTIONS = 'Every value uses screening coefficients, not measured or validated ones. The solar and radiator plots are resized at each site. '
  + 'Facility sizing requires workload validation.';
export const STEPS = [['brief', 'Construction brief'], ['facility', 'Facility specifications'], ['explore', 'Location assessment']];

export const facilityLabel = (setup) => (setup && setup.source === 'brief' ? SIZED_LABEL : FACILITY_LABEL);

// Rounding as in the brief's Review rows: m² whole; kW, kWh and kPa one decimal; TB whole from 10.
const whole = (n) => Math.round(n).toLocaleString('en-US');
const one = (n) => n.toFixed(1);
const terabytes = (n) => (n >= 10 ? whole(n) : one(n));
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const value = (option, key) => { const q = option.specifications[key]; return q && q.status === 'resolved' ? q.value : null; };

// The facility the map places: from the reference facility (docs/reference-facility.md), or calculated from the brief.
const TOTAL_KW = { 60: 100, 150: 225, 250: 350 }; // IT load plus cooling and support
export function facilityLine(setup) {
  const plots = footprintSpecs(setup).map((s) => s.id + ' ' + Math.round(s.w) + ' × ' + Math.round(s.h) + ' m').join(', ');
  if (setup.source === 'brief') {
    const o = setup.sizing.assessed, workers = value(o, 'workers'), peak = value(o, 'facility_peak_kw');
    return [workers === null ? null : plural(workers, 'computer'), peak === null ? null : one(peak) + ' kW peak'].filter(Boolean).join(', ') + '; ' + plots;
  }
  return setup.loadKw + ' kW IT, ' + TOTAL_KW[setup.loadKw] + ' kW total; ' + plots;
}

// The facility line with its label and assumption chip, wherever the facility appears (the facility step, Terrain's Details).
export function facilityEl(setup, { lead = null, label = true } = {}) {
  const p = document.createElement('p');
  p.className = 'facility';
  if (lead) { const b = document.createElement('b'); b.textContent = lead; p.append(b, ' '); }
  const brief = setup.source === 'brief';
  p.append(facilityLine(setup) + ' ', assumptionChip(brief ? 'calculated with screening assumptions, not engineering values' : 'the reference facility: proposals, not engineering values'));
  if (label) p.append(h('span', 'illustrative', facilityLabel(setup)));
  return p;
}

// The calculated facility, from an option's specifications: [name, text or null when not resolved].
function facilityRows(option, power) {
  const v = (k) => value(option, k);
  const both = (keys, text) => (keys.every((k) => v(k) !== null) ? text(keys.map(v)) : null);
  const solar = power === 'base_only' ? 'None: the base supplies the power'
    : both(['solar_panel_area_m2', 'solar_plot_m2'], ([panel, plot]) => `${whole(panel)} m² of panels, ${whole(plot)} m² plot`);
  return [
    ['Computers', both(['workers', 'active_workers'], ([n, active]) => `${plural(n, 'computer')} (${active} active, ${n - active} spare)`)],
    ['Storage', both(['required_storage_tb', 'storage_units'], ([tb, n]) => `${terabytes(tb)} TB in ${plural(n, 'unit')}`)],
    ['IT peak', both(['it_peak_kw'], ([x]) => one(x) + ' kW')],
    ['Facility peak', both(['facility_peak_kw'], ([x]) => one(x) + ' kW')],
    ['Facility average', both(['facility_average_kw'], ([x]) => one(x) + ' kW')],
    ['Energy per sol', both(['energy_kwh_per_sol'], ([x]) => one(x) + ' kWh')],
    ['Heat to reject', both(['heat_rejection_kw'], ([x]) => one(x) + ' kW')],
    ['Solar', solar],
    ['Radiator', both(['radiator_emitting_area_m2', 'radiator_plot_m2'], ([area, plot]) => `${whole(area)} m² emitting, ${whole(plot)} m² plot`)],
    ['Battery', both(['battery_nameplate_kwh', 'battery_units'], ([kwh, n]) => `${one(kwh)} kWh in ${plural(n, 'unit')}`)],
    ['Modules', both(['modules'], ([n]) => String(n))],
    ['Core area', both(['core_area_m2'], ([x]) => whole(x) + ' m²')],
    ['Total plot', both(['full_reference_plot_m2'], ([x]) => whole(x) + ' m²')],
    ['Ground bearing', both(['required_allowable_bearing_kpa'], ([x]) => 'at least ' + one(x) + ' kPa')],
  ].filter(([, text]) => text !== null);
}

const SCENARIO_NAMES = { low_endpoint: 'Lower end of your ranges', high_endpoint: 'Upper end of your ranges' };

// The calculated facility for a brief setup: one list per scenario (two with ranges, the assessed one marked), each value
// with its assumption chip, then what the deployment choice means for the map.
function calculatedEl(setup) {
  const { options, assessed } = setup.sizing;
  const ids = [...new Set(options.map((o) => o.scenario_id))];
  const wrap = h('div', 'calculated');
  for (const id of ids) {
    const option = options.find((o) => o.scenario_id === id && o.deployment === 'dedicated') || (assessed.scenario_id === id ? assessed : null);
    if (!option) continue;
    const section = h('section', 'scenario');
    if (ids.length > 1) {
      const head = h('h3', '', SCENARIO_NAMES[id] || id);
      if (id === assessed.scenario_id) head.append(' · ', h('span', 'assessed', 'Assessed on the map'));
      section.append(head);
    }
    const ul = h('ul', 'facility-list');
    for (const [name, text] of facilityRows(option, setup.power)) {
      const li = h('li', '');
      li.append(h('span', 'facility-name', name + ' '), h('span', 'facility-value', text + ' '), assumptionChip('a screening assumption, not an engineering value'));
      ul.append(li);
    }
    section.append(ul);
    wrap.append(section);
  }
  const deployments = new Set(options.map((o) => o.deployment));
  if (deployments.has('base_integrated') && deployments.has('dedicated')) wrap.append(h('p', 'deployment', "Inside the base: needs the base's space and services."));
  else if (deployments.has('base_integrated')) wrap.append(h('p', 'deployment', 'Inside the base: the map still places the dedicated outline.'));
  return wrap;
}

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};
const button = (cls, text, id) => {
  const b = h('button', cls, text);
  b.type = 'button';
  if (id) b.id = id;
  return b;
};

// The opening, the Twin Trails one: its two-line heading beside the globe, one supporting line, one primary action that
// starts the brief ("Define construction project", then "Continue project brief" once begun; the brief keeps its values).
// The globe is live beside it.
export const LANDING_START = 'Define construction project', LANDING_CONTINUE = 'Continue project brief';
export function createLanding(el, { onStart }) {
  const start = button('primary', LANDING_START, 'landing-start');
  start.addEventListener('click', () => { start.textContent = LANDING_CONTINUE; onStart(); });
  const title = h('h1', '');
  title.append(h('span', '', 'Your project.'), ' ', h('span', '', 'Your next frontier.'));
  el.replaceChildren(title,
    h('p', 'support', 'Start with the construction your robots will do. Find where its supporting facility could be built.'), start);
  return { focus: () => start.focus({ preventScroll: true }) };
}

// "1 Construction brief · 2 Facility specifications · 3 Location assessment" under the header, on every screen (on the
// landing none is current yet). The current step is marked; earlier steps are buttons (onStep(stage)), later ones are
// reached by "Find area" and "Assess locations →". On the brief and the facility step, "Back to globe" returns to the
// landing (onStep('landing')).
export function createStepper(el, { onStep }) {
  el.setAttribute('aria-label', 'Planning stages');
  let shown = null;
  return {
    render(stage) {
      const at = STEPS.findIndex(([s]) => s === stage); // -1 on the landing
      if (shown === stage) return;
      shown = stage;
      const ol = h('ol', '');
      STEPS.forEach(([s, name], i) => {
        const li = h('li', i < at ? 'done' : i === at ? 'current' : 'later');
        li.dataset.step = String(i + 1);
        const body = i < at ? button('step', '') : h('span', 'step');
        body.append(h('b', '', String(i + 1)), ' ' + name);
        if (i < at) body.addEventListener('click', () => onStep(s));
        if (i === at) li.setAttribute('aria-current', 'step');
        li.append(body);
        ol.append(li);
      });
      el.replaceChildren(ol);
      if (stage === 'brief' || stage === 'facility') {
        const home = button('text-action home-link', 'Back to globe', 'home-link');
        home.addEventListener('click', () => onStep('landing'));
        el.append(home);
      }
    },
  };
}

// 2 Facility specifications, the outcome of "Find area". open() (or open(sizing) with a sized one): "Ready for location
// matching." with the facility calculated from the brief (or the reference facility, for the test hook's setup), labelled,
// with its assumptions and what it needs from a site; "Edit brief" (onEdit) and "Assess locations →" (onAssess) on to the
// globe. open(sizing) with one that is not sized: "Review your brief." with what the Sizing says to change, and "Edit
// brief" only. brief() -> the sizing brief the setup was sized from (ui/brief.js toSizingBrief), or null.
export function createFacility(el, { setup, brief = () => null, onAssess, onEdit = () => {} }) {
  const heading = (text) => {
    const title = h('h2', '', text);
    title.id = 'facility-title';
    title.tabIndex = -1;
    el.setAttribute('aria-labelledby', 'facility-title');
    return title;
  };
  const edit = (cls) => {
    const b = button(cls, 'Edit brief', 'facility-edit');
    b.addEventListener('click', onEdit);
    return b;
  };
  function ready() {
    const st = setup(), sized = st.source === 'brief', b = brief();
    const title = heading('Ready for location matching.');
    const card = h('div', 'facility-card');
    card.append(h('p', 'illustrative', facilityLabel(st)));
    if (sized) card.append(h('p', 'kept', keptLine(b)), calculatedEl(st));
    else card.append(facilityEl(st, { label: false })); // the label above the line
    const as = h('details', 'assumptions');
    as.append(h('summary', '', 'Assumptions'), h('p', '', sized ? SIZED_ASSUMPTIONS : ASSUMPTIONS));
    card.append(as);
    const parts = [title, ...(sized ? [h('p', 'panel-intro', 'Your construction requirements have been calculated.')] : []), card];
    if (sized && b) parts.push(siteNeedsEl(b, st.sizing));
    const actions = h('div', 'form-actions');
    const go = button('primary', 'Assess locations →', 'facility-assess');
    go.addEventListener('click', onAssess);
    actions.append(edit('secondary'), go);
    el.replaceChildren(...parts, actions);
    title.focus({ preventScroll: true });
  }
  function review(sizing) {
    const title = heading('Review your brief.');
    const issues = sizing.status === 'needs_answers' ? ['Answer these to size the facility: ' + sizing.missing.map((m) => m.label).join(', ') + '.']
      : sizing.problems.map((p) => p.message);
    const actions = h('div', 'form-actions');
    actions.append(edit('primary'));
    el.replaceChildren(title, h('p', 'panel-intro', 'This workload needs a revised schedule or equipment assumptions. Try allowing more time for processed results.'),
      ...issues.map((t) => h('p', 'sizing-problem', t)), actions);
    title.focus({ preventScroll: true });
  }
  return { open: (sizing = null) => (sizing && sizing.status !== 'sized' ? review(sizing) : ready()) };
}

// How long the results are kept: the whole project unless the brief keeps processed outputs for less (or more).
function keptLine(b) {
  const p = b && b.q && b.q.products, d = b && b.q && b.q.duration;
  return p && d && p.mode === 'known' && d.mode === 'known' && p.value !== d.value
    ? 'Processed outputs are kept for ' + plural(p.value, 'sol') + '.' : 'Results are kept for the whole project.';
}

// "What the facility needs from a site": the five requirement rows, each sized value with its assumption chip.
function siteNeedsEl(b, sizing) {
  const wrap = h('section', 'site-needs');
  const list = h('ul', 'factor-list');
  for (const r of requirements(b, sizing)) {
    const li = h('li', '');
    li.append(h('span', 'factor-name', r.name), h('span', 'factor-value' + (r.sized ? ' sized' : ''), r.text));
    if (r.sized) li.append(assumptionChip('a screening assumption, not an engineering value'));
    list.append(li);
  }
  wrap.append(h('h3', '', 'What the facility needs from a site'), list);
  return wrap;
}
