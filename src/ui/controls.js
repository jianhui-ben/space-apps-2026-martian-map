// Keyboard alternatives to the globe gestures, as in the mockup: ← → ↑ ↓ move the view by a tenth of its ground
// width, + and − zoom by 0.6. The same keys work from the keyboard while the map has focus; the arrows are the
// layout's instead while a layout is selected (site.js).

// True when keys should go to the map: nothing else focused, or the canvas, a map label or these buttons are.
export function mapHasFocus() {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return true;
  return !!(a.closest && a.closest('#app, #labels, #controls'));
}

const BUTTONS = [
  { id: 'globe-west', text: '←', label: 'Rotate globe west', act: (g) => g.nudge(-1, 0) },
  { id: 'globe-east', text: '→', label: 'Rotate globe east', act: (g) => g.nudge(1, 0) },
  { id: 'globe-north', text: '↑', label: 'Tilt globe north', act: (g) => g.nudge(0, 1) },
  { id: 'globe-south', text: '↓', label: 'Tilt globe south', act: (g) => g.nudge(0, -1) },
  { id: 'globe-in', text: '+', label: 'Zoom globe in', act: (g) => g.zoomBy(0.6) },
  { id: 'globe-out', text: '−', label: 'Zoom globe out', act: (g) => g.zoomBy(1 / 0.6) },
];
const KEYS = {
  ArrowLeft: 'globe-west', ArrowRight: 'globe-east', ArrowUp: 'globe-north', ArrowDown: 'globe-south',
  '+': 'globe-in', '=': 'globe-in', '-': 'globe-out', '_': 'globe-out', '−': 'globe-out',
};

// el: the controls container. layoutSelected() tells whether the arrows belong to a selected layout.
export function createControls(el, { globe, layoutSelected = () => false }) {
  const byId = new Map(BUTTONS.map((b) => [b.id, b]));
  const mk = (b) => {
    const e = document.createElement('button');
    e.type = 'button';
    e.id = b.id;
    e.textContent = b.text;
    e.setAttribute('aria-label', b.label);
    e.title = b.label;
    e.addEventListener('click', () => b.act(globe));
    return e;
  };
  const row = (...ids) => {
    const r = document.createElement('div');
    r.className = 'pad-row';
    for (const id of ids) r.append(mk(byId.get(id)));
    return r;
  };
  const pad = document.createElement('div');
  pad.className = 'pad';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Globe view');
  pad.append(row('globe-west', 'globe-east'), row('globe-north', 'globe-south'), row('globe-in'), row('globe-out'));
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Drag to explore';
  el.replaceChildren(pad, hint);

  // The canvas takes focus, so "the map has focus" means something after a click or a Tab.
  const canvas = globe.renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Mars map. Drag to explore; arrow keys move the view, + and − zoom.');
  canvas.addEventListener('pointerdown', () => { if (document.activeElement !== canvas) canvas.focus({ preventScroll: true }); });

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !mapHasFocus()) return;
    const id = KEYS[e.key];
    if (!id) return;
    if (e.key.startsWith('Arrow') && layoutSelected()) return; // the layout's keys (site.js)
    e.preventDefault();
    byId.get(id).act(globe);
  });
}
