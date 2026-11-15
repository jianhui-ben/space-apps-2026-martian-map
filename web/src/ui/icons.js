// The factor status icons as shapes (R37): a ticked circle, a circle with a question mark, a crossed circle and a dash,
// so the shape tells them apart, never the colour alone. A real result is a filled disc; a simulated one (R33) is a
// dashed, hollow outline, so a simulated ✓ never looks like a real pass (the "sim" word stays beside it). The colour
// comes from the surrounding element (currentColor). Decorative: the caller names it (aria-label) or says it in words.
const NS = 'http://www.w3.org/2000/svg';
const MARKS = {
  '✓': 'M7.6 12.4l3 3 5.8-6.4',
  '✗': 'M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4',
  '?': 'M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5',
  '—': 'M6.5 12h11',
};

export function statusSvg(icon, { simulated = false } = {}) {
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const svg = el('svg', { viewBox: '0 0 24 24', width: '20', height: '20', 'aria-hidden': 'true', focusable: 'false' });
  svg.setAttribute('class', 'st-svg' + (simulated ? ' sim' : ''));
  svg.dataset.shape = icon in MARKS ? icon : '?';
  if (icon !== '—') svg.append(el('circle', { class: 'ring', cx: '12', cy: '12', r: '9.6' }));
  svg.append(el('path', { class: 'mark', d: MARKS[icon] || MARKS['?'] }));
  if (icon === '?' || !(icon in MARKS)) svg.append(el('circle', { class: 'dot', cx: '12', cy: '16.9', r: '1.15' }));
  return svg;
}
