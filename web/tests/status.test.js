import { STATUS, statusFor, initialStatuses, displayWords, factorIcon, fieldCounts, mergeResults } from '../src/status.js';

const metrics = (await (await fetch('../metrics.json')).json()).metrics;

test('statusFor straddle -> needs_fieldwork', () => {
  const r = statusFor({ value: 4.8, baseline: 5, ideal: 2, compare: '<=', uncertainty: 0.48 });
  assertEq(r.status, 'needs_fieldwork');
  assertEq(r.straddles, true);
});

test('statusFor met, ideal flag and not_met', () => {
  assertEq(statusFor({ value: 3, baseline: 5, ideal: 2, compare: '<=' }).status, 'met');
  assertEq(statusFor({ value: 3, baseline: 5, ideal: 2, compare: '<=' }).ideal, false);
  assertEq(statusFor({ value: 1.5, baseline: 5, ideal: 2, compare: '<=' }).ideal, true);
  assertEq(statusFor({ value: 1.4, baseline: 1, ideal: 1.3, compare: '>=' }).ideal, true);
  assertEq(statusFor({ value: 0.9, baseline: 1, ideal: 1.3, compare: '>=' }).status, 'not_met');
  assertEq(statusFor({ value: NaN, baseline: 1, compare: '>=' }).status, 'needs_confirmation');
});

test('statusFor partial never met', () => {
  assertEq(statusFor({ value: 0.1, baseline: 0.3, compare: '<=', availability: 'partial' }).status, 'needs_fieldwork');
  assertEq(statusFor({ value: 0.05, baseline: 0.3, compare: '<=', availability: 'partial', uncertainty: 0.01 }).status, 'needs_fieldwork');
  assertEq(statusFor({ value: 0.9, baseline: 0.3, compare: '<=', availability: 'partial', uncertainty: 0.25 }).status, 'not_met');
});

test('initialStatuses by availability', () => {
  const m = initialStatuses(metrics, { loadKw: 150, power: 'topup' });
  assertEq(m.size, metrics.length);
  for (const x of metrics) {
    const r = m.get(x.id);
    const want = { estimate_today: 'needs_confirmation', partial: 'needs_fieldwork', field_needed: 'needs_fieldwork', planning: 'needs_design_input' }[x.availability];
    assertEq(r.status, want, x.id);
    assertEq(r.appliesTo, x.appliesTo);
    assertEq(r.value, null);
  }
});

test('base_only marks SC not_applicable', () => {
  const m = initialStatuses(metrics, { loadKw: 60, power: 'base_only' });
  const sc = metrics.filter((x) => x.factor === 'SC');
  assert(sc.length > 5, 'has SC metrics');
  for (const x of sc) {
    assertEq(m.get(x.id).status, 'not_applicable', x.id);
    assertEq(m.get(x.id).note, 'no solar plot in this power option');
  }
  assertEq(m.get('BT-01').status, 'needs_confirmation');
});

test('displayWords', () => {
  assertEq(displayWords({ status: 'met', ideal: true }), 'meets ideal');
  assertEq(displayWords({ status: 'met', ideal: false }), 'meets baseline');
  assertEq(displayWords({ status: 'not_met' }), 'fails current target');
  assertEq(displayWords({ status: 'needs_fieldwork' }), 'unresolved (needs fieldwork)');
  assertEq(displayWords({ status: 'needs_design_input' }), 'unresolved (needs design input)');
  assertEq(displayWords({ status: 'needs_confirmation' }), 'unresolved (needs data)');
  assertEq(displayWords({ status: 'not_applicable', note: 'no solar plot in this power option' }), 'not applicable (no solar plot in this power option)');
});

test('factorIcon ignores fieldwork-only metrics', () => {
  const ms = [
    { id: 'A', factor: 'F', availability: 'estimate_today' },
    { id: 'B', factor: 'F', availability: 'estimate_today' },
    { id: 'C', factor: 'F', availability: 'field_needed' },
    { id: 'D', factor: 'G', availability: 'planning' },
    { id: 'E', factor: 'H', availability: 'estimate_today' },
  ];
  const res = (a, b, c) => new Map([['A', { status: a }], ['B', { status: b }], ['C', { status: c }], ['E', { status: 'not_applicable' }]]);
  assertEq(factorIcon(res('met', 'met', 'needs_fieldwork'), ms, 'F'), '✓');
  assertEq(factorIcon(res('met', 'needs_confirmation', 'not_met'), ms, 'F'), '?');
  assertEq(factorIcon(res('met', 'not_met', 'met'), ms, 'F'), '✗');
  assertEq(factorIcon(res('met', 'met', 'met'), ms, 'G'), '—');
  assertEq(factorIcon(res('met', 'met', 'met'), ms, 'H'), '—');
});

test('mergeResults precedence: field, computed, initial', () => {
  const initial = initialStatuses(metrics, { loadKw: 150, power: 'topup' });
  const computed = new Map([['BT-02', { ...initial.get('BT-02'), status: 'not_met', value: 75, evidence: 'derived' }]]);
  const out = mergeResults(initial, computed, []);
  assertEq(out.get('BT-02').status, 'not_met');
  assertEq(out.get('BT-04').status, 'needs_confirmation');
  assertEq(initial.get('BT-02').status, 'needs_confirmation', 'initial untouched');
  const f = mergeResults(initial, computed, [
    { metricId: 'BT-02', value: 100, pass: true, note: 'x' },
    { metricId: 'BT-05', value: 12, pass: false, note: 'y' },
  ]);
  assertEq(f.get('BT-02').status, 'met');
  assertEq(f.get('BT-02').evidence, 'observation');
  assertEq(f.get('BT-02').note, 'field result');
  assertEq(f.get('BT-02').value, 100);
  assertEq(f.get('BT-05').status, 'not_met');
  assertEq(f.get('BT-05').evidence, 'observation');
});

test('factorIcon ignores design-input metrics (BT-06, BT-21)', () => {
  const ms = [
    { id: 'BT-04', factor: 'BT', availability: 'estimate_today' },
    { id: 'BT-06', factor: 'BT', availability: 'estimate_today' },
    { id: 'BT-21', factor: 'BT', availability: 'estimate_today' },
  ];
  const res = new Map([['BT-04', { status: 'met' }], ['BT-06', { status: 'needs_design_input' }], ['BT-21', { status: 'needs_design_input' }]]);
  assertEq(factorIcon(res, ms, 'BT'), '✓');
  res.set('BT-04', { status: 'needs_confirmation' });
  assertEq(factorIcon(res, ms, 'BT'), '?');
});

test('factorIcon is a dash when only design items are estimate_today', () => {
  const ms = [{ id: 'X1', factor: 'X', availability: 'estimate_today' }, { id: 'X2', factor: 'X', availability: 'estimate_today' }];
  const res = new Map([['X1', { status: 'needs_design_input' }], ['X2', { status: 'needs_design_input' }]]);
  assertEq(factorIcon(res, ms, 'X'), '—');
});

test('fieldCounts counts fieldwork and design items', () => {
  const ms = [
    { id: 'A', factor: 'F', availability: 'estimate_today' },
    { id: 'B', factor: 'F', availability: 'estimate_today' },
    { id: 'C', factor: 'F', availability: 'field_needed' },
    { id: 'D', factor: 'F', availability: 'partial' },
    { id: 'E', factor: 'F', availability: 'planning' },
    { id: 'G', factor: 'G', availability: 'planning' },
  ];
  const res = new Map([['A', { status: 'met' }], ['B', { status: 'needs_design_input' }], ['C', { status: 'needs_fieldwork' }],
    ['D', { status: 'needs_fieldwork' }], ['E', { status: 'not_applicable' }], ['G', { status: 'needs_design_input' }]]);
  assertEq(fieldCounts(res, ms, 'F'), { fieldwork: 2, design: 1 });
  assertEq(fieldCounts(res, ms, 'G'), { fieldwork: 0, design: 1 });
});
