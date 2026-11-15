// Hover readout: a small panel by the pointer with position, elevation, slope and roughness, each with its
// evidence chip. Missing values read "no data", never a number.

const EVIDENCE = new Set(['observation', 'derived', 'model', 'interpretation', 'assumption', 'reference']);

export function evidenceChip(label) {
  const s = document.createElement('span');
  const kind = EVIDENCE.has(label) ? label : 'reference';
  s.className = 'ev ev-' + kind;
  s.textContent = label || 'reference';
  return s;
}

const ns = (lat) => Math.abs(lat).toFixed(4) + '° ' + (lat < 0 ? 'S' : 'N');
const ew = (lon) => Math.abs(lon).toFixed(4) + '° ' + (lon < 0 ? 'W' : 'E');

// rows: [{label, value (number|NaN), digits, unit, evidence}]
export function createReadout(parent = document.body) {
  const el = document.createElement('div');
  el.id = 'readout';
  el.className = 'panel';
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  parent.append(el);

  function show({ title, lon, lat, positionEvidence, rows }, clientX, clientY) {
    el.replaceChildren();
    if (title) {
      const b = document.createElement('b');
      b.textContent = title;
      el.append(b);
    }
    const dl = document.createElement('dl');
    const row = (label, text, evidence) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      const v = document.createElement('span');
      v.textContent = text;
      dd.append(v);
      if (evidence) dd.append(evidenceChip(evidence));
      dl.append(dt, dd);
    };
    row('Position', ns(lat) + ', ' + ew(lon), positionEvidence);
    for (const r of rows) {
      const ok = Number.isFinite(r.value);
      row(r.label, ok ? r.value.toFixed(r.digits) + (r.unit === '°' ? '°' : ' ' + r.unit) : 'no data', ok ? r.evidence : null);
    }
    el.append(dl);
    el.hidden = false;
    const W = innerWidth, H = innerHeight, rw = el.offsetWidth, rh = el.offsetHeight;
    const x = clientX + 18 + rw > W ? clientX - rw - 18 : clientX + 18;
    const y = Math.min(H - rh - 8, clientY + 18);
    el.style.transform = 'translate(' + Math.max(0, x) + 'px, ' + Math.max(0, y) + 'px)';
  }
  function hide() { el.hidden = true; }
  function dispose() { el.remove(); }
  return { el, show, hide, dispose };
}
