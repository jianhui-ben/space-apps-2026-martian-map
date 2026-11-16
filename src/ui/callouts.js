// In-scene callouts (Task 10): a label on a leader from a point on the ground, and the map-style label collision of
// the diorama prototype (design-reference/map-prototype/web/app.js callout() and declutter()). When two labels overlap
// on screen, or a label runs under a panel, the lower-priority one (and its leader) is hidden.
// The CSS2DObject is the ground point; the leader and the box hang from it at a fixed offset in pixels, so the
// callouts keep their shape at every zoom.
import { CSS2DObject } from '../../vendor/three/CSS2DRenderer.js';

// A callout: {object, element, priority, setAt(point), setContent(html, cls), dispose()}. point is in the parent's space
// (the ground). dx, dy: the box's attach point from the ground point (px, y down); the box hangs to the right of it
// (or to the left when dx < 0), vertically centred. cls one of ok | bad | open | none (shown with an icon as well).
export function createCallout({ html = '', cls = 'none', priority = 5, footprint = '', dx = 90, dy = 0 } = {}) {
  const element = document.createElement('div');
  element.className = 'callout ' + cls;
  if (footprint) element.dataset.footprint = footprint;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const lead = document.createElement('span');
  lead.className = 'lead';
  lead.style.width = Math.hypot(dx, dy) + 'px';
  lead.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
  const box = document.createElement('div');
  box.className = 'box';
  box.style.left = dx + 'px';
  box.style.top = dy + 'px';
  box.style.transform = 'translate(' + (dx < 0 ? '-100%' : '0') + ', -50%)';
  box.innerHTML = html;
  element.append(lead, dot, box);
  const object = new CSS2DObject(element);
  object.center.set(0, 0); // the element is a zero-size anchor on the ground point
  object.raycast = () => {}; // decoration: the globe controls raycast the scene

  return {
    object, element, box, priority,
    setAt(p) { object.position.copy(p); },
    setContent(nextHtml, nextCls) {
      element.className = 'callout ' + nextCls + (element.classList.contains('culled') ? ' culled' : '');
      box.innerHTML = nextHtml;
    },
    dispose() {
      if (object.parent) object.parent.remove(object);
      element.remove(); // CSS2DObject only removes its element when it is the object removed
    },
  };
}

const overlaps = (r, q, mx = 6, my = 4) => r.left < q.right + mx && r.right > q.left - mx && r.top < q.bottom + my && r.bottom > q.top - my;

// Hide the lower-priority callouts whose box collides with a higher-priority one's or with a panel (obstacles:
// elements), or runs off the screen. A label the renderer has hidden (behind the camera) is left alone.
export function declutter(callouts, obstacles = []) {
  const placed = obstacles.filter((el) => el && !el.hidden && el.getClientRects().length).map((el) => el.getBoundingClientRect());
  const vw = innerWidth, vh = innerHeight;
  for (const c of [...callouts].sort((a, b) => a.priority - b.priority)) {
    const el = c.element;
    if (el.style.display === 'none' || !el.isConnected) continue;
    const r = c.box.getBoundingClientRect();
    const hit = r.left < 0 || r.right > vw || r.top < 0 || r.bottom > vh || placed.some((q) => overlaps(r, q));
    el.classList.toggle('culled', hit);
    if (!hit) placed.push(r);
  }
}
