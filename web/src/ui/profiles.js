// The Diorama's profile chart (Task 10): west-east and south-north elevation profiles through the compound, across the
// site box, ported from the diorama prototype's renderProfiles (design-reference/map-prototype/web/app.js). Both
// profiles share one height scale. A gap in the elevation grid is a gap in the line and is said in words: missing
// data never reads as flat ground.
import { elevationAt } from '../frame.js';

const R = 3396190;
const RAD = Math.PI / 180;
const M_PER_DEG = R * RAD;
const SVGNS = 'http://www.w3.org/2000/svg';
const NAMES = { compound: 'compound', solar: 'solar plot', radiator: 'radiator plot' };

// Ray casting on a lon/lat ring.
function inside(poly, lon, lat) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

// One profile line across the site box through centre {lon, lat}. axis 'ew' runs west to east, 'ns' south to north.
// elev: m or NaN (no data); slope: the grade along the line between neighbouring samples (degrees, NaN at a gap);
// bands: the runs of samples inside each footprint. Pure: a Site in, numbers out.
export function profileLine(site, centre, axis, { n = 161, footprints = [] } = {}) {
  const [w, s, e, nb] = site.bounds;
  const ew = axis === 'ew';
  const kx = M_PER_DEG * Math.cos(centre.lat * RAD);
  const lengthM = ew ? (e - w) * kx : (nb - s) * M_PER_DEG;
  const x = [], elev = [], lonLat = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const lon = ew ? w + t * (e - w) : centre.lon, lat = ew ? centre.lat : s + t * (nb - s);
    const h = elevationAt(site, lon, lat);
    x.push(t * lengthM);
    elev.push(Number.isFinite(h) ? h : NaN);
    lonLat.push([lon, lat]);
  }
  const slope = elev.map((h, i) => {
    const a = i > 0 ? i - 1 : i, b = i < n - 1 ? i + 1 : i;
    const d = elev[b] - elev[a], dx = x[b] - x[a];
    return Number.isFinite(d) && dx > 0 ? Math.atan(Math.abs(d) / dx) / RAD : NaN;
  });
  const bands = [];
  for (const f of footprints) {
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && inside(f.polygon, lonLat[i][0], lonLat[i][1]);
      if (on && start < 0) start = i;
      if (!on && start >= 0) { bands.push({ id: f.id, x0: x[start], x1: x[i - 1] }); start = -1; }
    }
  }
  const finite = elev.filter(Number.isFinite);
  const missing = 1 - finite.length / n;
  const lo = finite.length ? Math.min(...finite) : NaN, hi = finite.length ? Math.max(...finite) : NaN;
  return { axis, lengthM, x, elev, slope, lonLat, bands, missing, lo, hi };
}

const fmtKm = (m) => (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';

// Draw the profiles into el (a container). lines: [profileLine], onHover([lon, lat] | null) moves a marker on the map.
export function renderProfiles(el, lines, { source = 'the site elevation grid', onHover = () => {} } = {}) {
  const spans = lines.map((l) => l.hi - l.lo).filter(Number.isFinite);
  const span = (spans.length ? Math.max(...spans) : 0) * 1.1 || 1; // one height scale for both
  el.replaceChildren();
  for (const l of lines) {
    const ew = l.axis === 'ew';
    const box = document.createElement('div');
    box.className = 'profile';
    box.dataset.axis = l.axis;
    const h3 = document.createElement('h3');
    h3.textContent = ew ? 'West to east through the compound' : 'South to north through the compound';
    const sub = document.createElement('div');
    sub.className = 'sub';
    const finiteSlopes = l.slope.filter(Number.isFinite);
    if (!Number.isFinite(l.lo)) {
      sub.textContent = 'No elevation data along this line.';
      sub.classList.add('missing');
    } else {
      const mean = finiteSlopes.reduce((a, b) => a + b, 0) / (finiteSlopes.length || 1);
      sub.textContent = (l.hi - l.lo).toFixed(1) + ' m relief, mean grade ' + mean.toFixed(1) + '° along the line. ';
      if (l.missing > 0.005) {
        const gap = document.createElement('span');
        gap.className = 'gap';
        gap.textContent = 'No data for ' + Math.round(l.missing * 100) + '% of the line (gaps left blank).';
        sub.append(gap);
      }
    }
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', h3.textContent + ', elevation in metres');
    const head = document.createElement('div');
    head.className = 'head';
    head.append(h3, sub);
    box.append(head, svg);
    el.append(box);
    const draw = () => {
      const Wpx = svg.clientWidth || 360, Hpx = 74, padL = 52, padR = 8, padB = 16;
      const lo = Number.isFinite(l.lo) ? l.lo : 0;
      const xs = (v) => padL + (v / l.lengthM) * (Wpx - padL - padR);
      const ys = (v) => Hpx - padB - ((v - lo) / span) * (Hpx - padB - 6);
      svg.setAttribute('viewBox', '0 0 ' + Wpx + ' ' + Hpx);
      svg.setAttribute('height', Hpx);
      // the line in runs of finite samples: a gap in the grid stays a gap
      const runs = [];
      let cur = [];
      l.elev.forEach((v, i) => {
        if (Number.isFinite(v)) cur.push([xs(l.x[i]), ys(v)]);
        else if (cur.length) { runs.push(cur); cur = []; }
      });
      if (cur.length) runs.push(cur);
      const pts = (r) => r.map(([a, b]) => a.toFixed(1) + ',' + b.toFixed(1)).join(' ');
      const base = Hpx - padB;
      // the footprints the line crosses, shaded; plots closer than a label's width share one name ("layout")
      const spans = l.bands.map((b) => ({ id: b.id, x0: xs(b.x0), x1: Math.max(xs(b.x1), xs(b.x0) + 2) })).sort((a, b) => a.x0 - b.x0);
      const groups = [];
      for (const b of spans) {
        const g = groups[groups.length - 1];
        if (g && b.x0 - g.x1 < 70) { g.x1 = Math.max(g.x1, b.x1); g.ids.push(b.id); } else groups.push({ x0: b.x0, x1: b.x1, ids: [b.id] });
      }
      const bands = spans.map((b) => '<rect class="band" x="' + b.x0 + '" y="0" width="' + (b.x1 - b.x0) + '" height="' + base + '"/>').join('')
        + groups.map((g) => '<text class="tip band-name" x="' + (g.x0 + g.x1) / 2 + '" y="10" text-anchor="middle">'
          + (g.ids.length > 1 ? 'layout' : NAMES[g.ids[0]] || g.ids[0]) + '</text>').join('');
      const yt = [lo, lo + span / 2, lo + span];
      svg.innerHTML = bands
        + yt.map((v) => '<line class="grid" x1="' + padL + '" x2="' + (Wpx - padR) + '" y1="' + ys(v) + '" y2="' + ys(v) + '"/>'
          + '<text class="tip" x="' + (padL - 6) + '" y="' + (ys(v) + 4) + '" text-anchor="end">' + v.toFixed(0) + ' m</text>').join('')
        + runs.map((r) => '<path class="fill" d="M' + r[0][0].toFixed(1) + ',' + base + ' L' + pts(r).replace(/ /g, ' L') + ' L'
          + r[r.length - 1][0].toFixed(1) + ',' + base + ' Z"/>'
          + '<polyline class="line" points="' + pts(r) + '"/>').join('')
        + '<text class="tip" x="' + padL + '" y="' + (Hpx - 2) + '">' + (ew ? 'W' : 'S') + ' 0 km</text>'
        + '<text class="tip" x="' + (Wpx - padR) + '" y="' + (Hpx - 2) + '" text-anchor="end">' + fmtKm(l.lengthM) + ' ' + (ew ? 'E' : 'N') + '</text>'
        + '<g class="hover" visibility="hidden"><line y1="0" y2="' + base + '"/><circle r="4"/><text class="tip" y="22"></text></g>';
      const hov = svg.querySelector('.hover');
      svg.onpointermove = (ev) => {
        const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * Wpx;
        const t = Math.max(0, Math.min(1, (px - padL) / (Wpx - padL - padR)));
        const i = Math.round(t * (l.x.length - 1));
        const X = xs(l.x[i]), v = l.elev[i];
        hov.setAttribute('visibility', 'visible');
        const ln = hov.querySelector('line');
        ln.setAttribute('x1', X); ln.setAttribute('x2', X);
        const c = hov.querySelector('circle');
        c.setAttribute('cx', X); c.setAttribute('cy', Number.isFinite(v) ? ys(v) : base);
        c.setAttribute('visibility', Number.isFinite(v) ? 'visible' : 'hidden');
        const tx = hov.querySelector('text');
        tx.textContent = (l.x[i] / 1000).toFixed(2) + ' km, ' + (Number.isFinite(v)
          ? v.toFixed(1) + ' m, ' + (Number.isFinite(l.slope[i]) ? l.slope[i].toFixed(1) + '°' : 'grade unknown')
          : 'no elevation data');
        const right = X > Wpx * 0.7;
        tx.setAttribute('x', X + (right ? -6 : 6)); tx.setAttribute('text-anchor', right ? 'end' : 'start');
        onHover(Number.isFinite(v) ? l.lonLat[i] : null);
      };
      svg.onpointerleave = () => { hov.setAttribute('visibility', 'hidden'); onHover(null); };
    };
    requestAnimationFrame(draw);
  }
  const note = document.createElement('p');
  note.className = 'profile-note';
  note.textContent = 'Both profiles share one height scale. From ' + source + '.';
  el.append(note);
}
