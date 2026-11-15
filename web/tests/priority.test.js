import { prioritize, failSide } from '../src/priority.js';

const R = (id, o = {}) => ({
  id, value: o.value === undefined ? null : o.value, unit: '', display: o.display || String(o.value),
  target: { baseline: o.baseline || '', ideal: '', label: 'P' }, status: o.status || 'met', ideal: false,
  evidence: 'derived', note: '', assumption: false, straddles: !!o.straddles, appliesTo: 'layout',
});
const site = (id, list) => ({ id, results: new Map(list.map((r) => [r.id, r])) });
const by = (out, id) => out.find((x) => x.siteId === id);

test('failure goes last', () => {
  const sites = [
    site('A', [R('BT-06', { value: 1 })]),
    site('B', [R('BT-06', { value: 2 })]),
    site('C', [R('BT-05', { value: 14.1, display: '14.1°', baseline: '≤ 10°', status: 'not_met' }), R('BT-06', { value: 0 })]),
  ];
  const out = prioritize(sites, []);
  const c = by(out, 'C');
  assertEq(c.priority, 3);
  assertEq(c.step, 1);
  assertEq(c.failures, ['BT-05']);
  assertEq(c.verdict, 'not recommended under the stated requirements (BT-05: 14.1° > 10°)');
  assertEq(out[out.length - 1].siteId, 'C');
});

test('failed sites share one priority and list all failures', () => {
  const f = (id) => R(id, { value: 20, display: '20°', baseline: '≤ 10°', status: 'not_met' });
  const out = prioritize([site('A', [f('BT-05'), f('BT-04')]), site('B', [f('BT-05')]), site('C', [R('BT-06', { value: 1 })])], []);
  assertEq(by(out, 'A').priority, 2);
  assertEq(by(out, 'B').priority, 2);
  assertEq(by(out, 'A').equalWith, ['B']);
  assertEq(by(out, 'A').verdict, 'not recommended under the stated requirements (BT-04: 20° > 10°, BT-05: 20° > 10°)');
});

test('fewer critical unknowns ranks higher', () => {
  const fw = (id) => R(id, { value: 1, status: 'needs_fieldwork' });
  const out = prioritize([
    site('near_base_west', [fw('BT-04'), fw('BT-05'), fw('BT-07')]),
    site('X', [fw('BT-04'), fw('BT-05')]),
  ], []);
  assertEq(by(out, 'X').priority, 1);
  assertEq(by(out, 'near_base_west').priority, 2);
  assertEq(by(out, 'X').step, 2);
  assertEq(by(out, 'X').criticalUnknowns, ['BT-04', 'BT-05']);
  assertEq(by(out, 'X').whyHere, 'No failures; 2 critical unknowns, fewer than near_base_west (3).');
});

test('critical unknowns: straddles counted once, not_applicable excluded', () => {
  const out = prioritize([site('A', [
    R('BT-04', { value: 1, status: 'needs_fieldwork', straddles: true }),
    R('BT-07', { value: 1, status: 'met', straddles: true }),
    R('SC-01', { value: null, status: 'not_applicable' }),
    R('BT-09', { value: 1, status: 'needs_design_input' }),
  ])], []);
  assertEq(out[0].criticalUnknowns, ['BT-04', 'BT-07']);
  assertEq(out[0].whyHere, 'Only candidate; no failures; 2 critical unknowns.');
});

test('dominance separates equal unknowns', () => {
  const out = prioritize([
    site('B', [R('BT-06', { value: 3 }), R('BT-21', { value: 300 })]),
    site('A', [R('BT-06', { value: 2 }), R('BT-21', { value: 200 })]),
  ], []);
  assertEq(by(out, 'A').priority, 1);
  assertEq(by(out, 'B').priority, 2);
  assertEq(by(out, 'A').step, 3);
  assertEq(by(out, 'B').step, 3);
  assertEq(by(out, 'A').tradeoff, null);
});

test('trade-off means equal priority', () => {
  const out = prioritize([
    site('A', [R('BT-06', { value: 2 }), R('BT-21', { value: 300 })]),
    site('B', [R('BT-06', { value: 3 }), R('BT-21', { value: 200 })]),
  ], []);
  assertEq(by(out, 'A').priority, 1);
  assertEq(by(out, 'B').priority, 1);
  assertEq(by(out, 'A').step, 4);
  assertEq(by(out, 'A').equalWith, ['B']);
  assertEq(by(out, 'A').tradeoff, 'less grading, longer cable');
  assertEq(by(out, 'B').tradeoff, 'more grading, shorter cable');
});

test('missing BT-21 makes sites incomparable -> equal', () => {
  const out = prioritize([
    site('A', [R('BT-06', { value: 1 }), R('BT-21', { value: 100 })]),
    site('B', [R('BT-06', { value: 5 }), R('BT-21', { value: null })]),
  ], []);
  assertEq(by(out, 'A').priority, 1);
  assertEq(by(out, 'B').priority, 1);
  const nan = prioritize([
    site('A', [R('BT-06', { value: 1 }), R('BT-21', { value: 100 })]),
    site('B', [R('BT-06', { value: 5 }), R('BT-21', { value: NaN })]),
  ], []);
  assertEq(by(nan, 'B').priority, 1);
});

test('indicator absent for every site is dropped', () => {
  const out = prioritize([
    site('A', [R('BT-06', { value: 1 })]),
    site('B', [R('BT-06', { value: 2 })]),
  ], []);
  assertEq(by(out, 'A').priority, 1);
  assertEq(by(out, 'B').priority, 2);
});

test('indicator with no usable value at any site is dropped, as mergeResults gives them before they are computed (R4)', () => {
  // initialStatuses puts SC-01 (needs data) and BT-15 (needs fieldwork) in every site's results with value null
  const blank = (id, status) => R(id, { value: null, status });
  const out = prioritize([
    site('A', [R('BT-06', { value: 0.54 }), R('BT-21', { value: 634 }), blank('SC-01', 'needs_confirmation'), blank('BT-15', 'needs_fieldwork')]),
    site('B', [R('BT-06', { value: 0.62 }), R('BT-21', { value: 837 }), blank('SC-01', 'needs_confirmation'), blank('BT-15', 'needs_fieldwork')]),
  ], []);
  assertEq([by(out, 'A').priority, by(out, 'A').step], [1, 3]);
  assertEq([by(out, 'B').priority, by(out, 'B').step], [2, 3]);
  // a value at only some sites still makes the pair incomparable
  const some = prioritize([
    site('A', [R('BT-06', { value: 0.54 }), R('SC-01', { value: 3 })]),
    site('B', [R('BT-06', { value: 0.62 }), blank('SC-01', 'needs_confirmation')]),
  ], []);
  assertEq([by(some, 'A').priority, by(some, 'B').priority], [1, 1]);
});

test('SC-01 not_applicable counts as 0; BT-15 larger is better', () => {
  const out = prioritize([
    site('A', [R('BT-06', { value: 1 }), R('SC-01', { value: 5, status: 'met' })]),
    site('B', [R('BT-06', { value: 1 }), R('SC-01', { value: null, status: 'not_applicable' })]),
  ], []);
  assertEq(by(out, 'B').priority, 1);
  assertEq(by(out, 'A').priority, 2);
  const o2 = prioritize([
    site('A', [R('BT-15', { value: 2 })]),
    site('B', [R('BT-15', { value: 1 })]),
  ], []);
  assertEq(by(o2, 'A').priority, 1);
  assertEq(by(o2, 'B').priority, 2);
  const o3 = prioritize([
    site('A', [R('BT-06', { value: 1 }), R('BT-15', { value: 2 })]),
    site('B', [R('BT-06', { value: 2 }), R('BT-15', { value: 1 })]),
  ], []);
  assertEq(by(o3, 'A').priority, 1);
});

test('trade-off wording for shading and dune setback', () => {
  const out = prioritize([
    site('A', [R('SC-01', { value: 1 }), R('BT-15', { value: 1 })]),
    site('B', [R('SC-01', { value: 2 }), R('BT-15', { value: 2 })]),
  ], []);
  assertEq(by(out, 'A').tradeoff, 'less shading, less dune setback');
  assertEq(by(out, 'B').tradeoff, 'more shading, more dune setback');
});

test('dense priorities across groups', () => {
  const fw = (id) => R(id, { value: 1, status: 'needs_fieldwork' });
  const out = prioritize([
    site('A', [R('BT-06', { value: 1 })]),
    site('B', [R('BT-06', { value: 2 })]),
    site('C', [R('BT-06', { value: 0 }), fw('BT-04')]),
    site('D', [R('BT-05', { value: 20, display: '20°', baseline: '≤ 10°', status: 'not_met' })]),
  ], []);
  assertEq(out.map((x) => x.priority), [1, 2, 3, 4]);
  assertEq(out.map((x) => x.siteId), ['A', 'B', 'C', 'D']);
});

test('no weights: reordering inputs gives the same output', () => {
  const fw = (id) => R(id, { value: 1, status: 'needs_fieldwork' });
  const sites = [
    site('A', [R('BT-06', { value: 2 }), R('BT-21', { value: 300 })]),
    site('B', [R('BT-06', { value: 3 }), R('BT-21', { value: 200 })]),
    site('C', [R('BT-06', { value: 4 }), R('BT-21', { value: 400 })]),
    site('D', [R('BT-06', { value: 1 }), fw('BT-04')]),
    site('E', [R('BT-05', { value: 20, display: '20°', baseline: '≤ 10°', status: 'not_met' })]),
  ];
  const base = JSON.stringify(prioritize(sites, []));
  assertEq(JSON.stringify(prioritize([...sites].reverse(), [])), base);
  assertEq(JSON.stringify(prioritize([sites[2], sites[4], sites[0], sites[3], sites[1]], [])), base);
});

test('lone failed site and empty input', () => {
  const out = prioritize([site('A', [R('BT-05', { value: 20, display: '20°', baseline: '≤ 10°', status: 'not_met' })])], []);
  assertEq(out[0].priority, 1);
  assert(out[0].whyHere.startsWith('Only candidate; '));
  assertEq(prioritize([], []), []);
});

test('verdicts name the comparison the target sets: a reached share (>=) fails below it, a limit (<=) above it', () => {
  const fit = R('BT-02', { value: 66, display: '66%', baseline: '100%', status: 'not_met' }); // no operator: must reach 100%
  const ratio = R('BT-01', { value: 0.8, display: '0.80', baseline: '≥ 1.0', status: 'not_met' });
  const slope = R('BT-05', { value: 24.5, display: '24.5°', baseline: '≤ 10°', status: 'not_met' });
  const out = prioritize([site('A', [fit, ratio, slope])], []);
  assertEq(out[0].verdict, 'not recommended under the stated requirements (BT-01: 0.80 < 1.0, BT-02: 66% < 100%, BT-05: 24.5° > 10°)');
  assertEq([failSide(fit).above, failSide(ratio).above, failSide(slope).above], [false, false, true]);
  const doc = R('GI-01', { value: 0.8, display: '0.8', baseline: 'D: ≥ 1.0 for every support and applicable case', status: 'not_met' });
  assertEq(failSide(doc), { base: '≥ 1.0 for every support and applicable case', limit: '1.0', above: false }); // docs' P:/D: prefix
  const blind = R('XX-01', { value: null, display: '—', baseline: 'allowance', status: 'not_met' });
  assertEq(prioritize([site('B', [blind])], [])[0].verdict, 'not recommended under the stated requirements (XX-01: — fails allowance)');
});
