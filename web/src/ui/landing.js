// The landing, the stepper and the facility step (Task 9d, the teammate's construction-driven reframe): landing ->
// 1 Construction brief (ui/brief.js) -> 2 Facility specifications -> 3 Location assessment. The facility the map places is
// the legacy reference facility, shown as an illustrative reference and never as an estimate from the brief: the sizing
// model is planned, not implemented.
import { footprintSpecs } from '../layout.js';
import { assumptionChip } from './chips.js';

export const FACILITY_LABEL = 'Illustrative reference — not calculated from your project.';
export const ASSUMPTIONS = 'Base services included. Firm power plus supplemental solar assumed; capacity unverified. '
  + 'Facility sizing requires workload validation.';
const SIZING_PLANNED = 'Sizing model: planned. It will estimate compute, storage, power, heat rejection and footprint from your brief.';
export const STEPS = [['brief', 'Construction brief'], ['facility', 'Facility specifications'], ['explore', 'Location assessment']];

// The facility the map places, from the reference facility (docs/reference-facility.md): every number an assumption.
const TOTAL_KW = { 60: 100, 150: 225, 250: 350 }; // IT load plus cooling and support
export function facilityLine(setup) {
  const plots = footprintSpecs(setup).map((s) => s.id + ' ' + Math.round(s.w) + ' × ' + Math.round(s.h) + ' m').join(', ');
  return setup.loadKw + ' kW IT, ' + TOTAL_KW[setup.loadKw] + ' kW total; ' + plots;
}

// The facility line with its label and assumption chip, wherever the facility appears (the facility step, Terrain's Details).
export function facilityEl(setup, { lead = null, label = true } = {}) {
  const p = document.createElement('p');
  p.className = 'facility';
  if (lead) { const b = document.createElement('b'); b.textContent = lead; p.append(b, ' '); }
  p.append(facilityLine(setup) + ' ', assumptionChip('the reference facility: proposals, not engineering values'));
  if (label) p.append(h('span', 'illustrative', FACILITY_LABEL));
  return p;
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

// The opening: the Guided brief's outlined line beside its globe, one supporting line, one primary action that starts
// the brief. The globe is live beside it.
export function createLanding(el, { onStart }) {
  const start = button('primary', 'Start the brief →', 'landing-start');
  start.addEventListener('click', onStart);
  el.replaceChildren(h('h1', '', 'Built for your mission.'),
    h('p', 'support', 'Describe your construction project to explore locations for its supporting data center.'), start);
  return { focus: () => start.focus({ preventScroll: true }) };
}

// "1 Construction brief · 2 Facility specifications · 3 Location assessment" under the header, on every screen (on the
// landing none is current yet). The current step is marked; earlier steps are buttons (onStep(stage)), later ones are
// reached by Continue.
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
    },
  };
}

// 2 Facility specifications: the sizing stage as planned, and the reference facility the map will place, labelled as
// an illustrative reference, with its assumptions. "Assess locations →" goes on to the globe and the explore panel.
export function createFacility(el, { setup, onAssess }) {
  return {
    open() {
      const title = h('h2', '', 'Facility specifications');
      title.id = 'facility-title';
      title.tabIndex = -1;
      el.setAttribute('aria-labelledby', 'facility-title');
      const card = h('div', 'facility-card');
      card.append(h('p', 'illustrative', FACILITY_LABEL), facilityEl(setup(), { label: false })); // the label above the line
      const as = h('details', 'assumptions');
      as.append(h('summary', '', 'Assumptions'), h('p', '', ASSUMPTIONS));
      card.append(as);
      const actions = h('div', 'form-actions');
      const go = button('primary', 'Assess locations →', 'facility-assess');
      go.addEventListener('click', onAssess);
      actions.append(go);
      el.replaceChildren(title, h('p', 'sizing', SIZING_PLANNED), card, actions);
      title.focus({ preventScroll: true });
    },
  };
}
