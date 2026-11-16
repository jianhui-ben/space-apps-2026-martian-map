import { sizeBrief, briefSetup, unresolvedMarkers, SIZE_KEYS } from '../src/sizing/index.js';
import { fromBrief } from '../src/sizing/request.js';
import { buildOptions, loadBundle } from '../src/sizing/engine.js';
import { known, unknown } from '../src/sizing/quantity.js';

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const cases = await (await fetch(new URL('./fixtures/sizing.json', import.meta.url))).json();
const bundle = await loadBundle(new URL('../sizing/screening-v1.json', import.meta.url));
const caseBrief = (name) => structuredClone(cases.find((c) => c.name === name).brief);
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

test('fromBrief matches the Python request for every fixture', () => {
  assert(cases.length > 0, 'no fixtures');
  for (const c of cases) {
    const got = sortKeys(fromBrief(c.brief)), want = sortKeys(c.request);
    assertEq(Object.keys(got), Object.keys(want), c.name + ' keys');
    for (const k of Object.keys(want)) assertEq(JSON.stringify(got[k]), JSON.stringify(want[k]), c.name + '.' + k);
  }
});

test('fromBrief: product retention is the asked value when given, else the project duration', () => {
  const b = caseBrief('example_filled');
  assertEq(fromBrief(b).retention.products, fromBrief(b).project.duration);
  b.q.products = { mode: 'known', value: 90, unit: 'sols' };
  assertEq(fromBrief(b).retention.products, { state: 'specified', value: 90, unit: 'sol' });
  assertEq(fromBrief(b).project.duration.value, 180);
});

test('sizeBrief: an unusable product retention is a missing answer under its own name', () => {
  const b = caseBrief('example_filled');
  b.q.products = { mode: 'known', value: -1, unit: 'sols' };
  const s = sizeBrief(b, bundle);
  assertEq(s.status, 'needs_answers');
  assertEq(s.missing.map((m) => m.label), ['Keep processed outputs']);
});

test('engine matches Python for every fixture', () => {
  for (const c of cases) {
    const options = buildOptions(c.request, bundle);
    assertEq(options.map((o) => o.id).sort(), c.options.map((o) => o.id).sort(), c.name + ' option ids');
    for (const want of c.options) {
      const got = options.find((o) => o.id === want.id);
      const tag = c.name + '/' + want.id;
      assertEq(got.scenario_id, want.scenario_id, tag);
      assertEq(got.deployment, want.deployment, tag);
      assertEq(got.layout.status, want.layout_status, tag + ' layout');
      assertEq(Object.keys(got.specifications).sort(), Object.keys(want.specifications).sort(), tag + ' keys');
      for (const [key, w] of Object.entries(want.specifications)) {
        const g = got.specifications[key];
        assertEq(g.status, w.status, tag + '.' + key + ' status');
        assertEq(g.unit, w.unit, tag + '.' + key + ' unit');
        if (w.status === 'resolved') {
          assert(close(g.value, w.value), `${tag}.${key}: ${g.value} vs ${w.value}`);
          assertEq(g.conditional, w.conditional, tag + '.' + key + ' conditional');
        } else assertEq(g.missing_inputs, w.missing_inputs, tag + '.' + key + ' missing');
        assertEq(g.provenance_ids, w.provenance_ids, tag + '.' + key + ' provenance');
      }
    }
  }
});

test('known rejects non-finite', () => {
  let threw = false;
  try { known(Infinity, 'kW', []); } catch { threw = true; }
  assert(threw, 'Infinity accepted');
  threw = false;
  try { known(NaN, 'kW', []); } catch { threw = true; }
  assert(threw, 'NaN accepted');
});

test('unknown sorts and de-duplicates its references', () => {
  assertEq(unknown('kW', ['b', 'a', 'b'], ['y', 'x', 'x']), { status: 'unresolved', unit: 'kW', missing_inputs: ['a', 'b'], provenance_ids: ['x', 'y'] });
});

// sizeBrief: sized, needs answers, cannot size.

test('sizeBrief: the default example needs exactly the four open answers', () => {
  const s = sizeBrief(caseBrief('example_default'), bundle);
  assertEq(s.status, 'needs_answers');
  assertEq(s.missing.map((m) => m.label), ['Project duration', 'Keep raw data', 'Power approach', 'Essential backup duration']);
  assert(s.missing.every((m) => m.tab === 2), 'tab');
  assertEq(s.problems, []);
});

test('sizeBrief: the filled example is sized', () => {
  const s = sizeBrief(caseBrief('example_filled'), bundle);
  assertEq(s.status, 'sized');
  assertEq(s.missing, []);
  assertEq(s.assessed.specifications.workers.value, 11); // with the 100 Gbps site data backbone
  assertEq(s.params.module_length_m, 12);
  assertEq(s.params.solar_land_coverage, 0.5);
});

test('sizeBrief: an impossible deadline cannot be sized', () => {
  const s = sizeBrief(caseBrief('deadline_impossible'), bundle);
  assertEq(s.status, 'cannot_size');
  assertEq(s.problems[0].reason, 'equipment:worker_search_limit');
  assertEq(s.problems[0].message, "The results can't be ready within 0.01 hours with up to 20000 computers. Allow more time or process less often.");
  assertEq(s.problems[0].tab, 2);
});

test('sizeBrief: inspection reports without inspection robots', () => {
  const s = sizeBrief(caseBrief('inspection_without_robots'), bundle);
  assertEq(s.status, 'cannot_size');
  assertEq(s.problems[0].message, 'Inspection reports needs Inspection or Assembly robots: raise Construction robots or the robot shares in Planning defaults.');
  assertEq(s.problems[0].tab, 1);
});

test('sizeBrief: base power below the facility peak', () => {
  const s = sizeBrief(caseBrief('base_too_small'), bundle);
  assertEq(s.status, 'cannot_size');
  assertEq(s.problems[0].message, "Available base power (5.0 kW) is below the facility's 8.3 kW peak. Raise it, or choose Hybrid or Solar + storage.");
  assertEq(s.problems[0].tab, 2);
});

test('sizeBrief: base connection without base power needs that answer', () => {
  const b = caseBrief('base_connection');
  b.q.basePower = { mode: 'unknown' };
  const s = sizeBrief(b, bundle);
  assertEq(s.status, 'needs_answers');
  assert(s.missing.some((m) => m.label === 'Available base power' && m.tab === 2), 'base power');
});

test('sizeBrief: ranges are sized, assessed is the scenario with the larger plot', () => {
  const s = sizeBrief(caseBrief('ranges'), bundle);
  assertEq(s.status, 'sized');
  const dedicated = s.options.filter((o) => o.deployment === 'dedicated');
  const plot = (o) => o.specifications.full_reference_plot_m2.value;
  const [lo, hi] = [dedicated.find((o) => o.scenario_id === 'low_endpoint'), dedicated.find((o) => o.scenario_id === 'high_endpoint')];
  assertEq(s.assessed.scenario_id, plot(lo) > plot(hi) ? 'low_endpoint' : 'high_endpoint');
});

test('sizeBrief: inside the base is assessed as a dedicated installation', () => {
  const s = sizeBrief(caseBrief('inside_base'), bundle);
  assertEq(s.status, 'sized');
  assertEq(s.assessed.deployment, 'dedicated');
  assert(s.options.every((o) => o.deployment === 'base_integrated'), 'options keep the engine list');
});

test('sizeBrief: an invalid half-entered answer counts as unanswered and never throws', () => {
  const b = caseBrief('example_filled');
  b.q.duration = { mode: 'range', min: 200, max: 100, unit: 'sols' };
  const s = sizeBrief(b, bundle);
  assertEq(s.status, 'needs_answers');
  assert(s.missing.some((m) => m.label === 'Project duration'), 'duration');
  const f = caseBrief('example_filled');
  f.fleet[0].count = null;
  f.q.hours = { mode: 'known', value: 99, unit: 'hours' };
  const t = sizeBrief(f, bundle);
  assertEq(t.status, 'needs_answers');
  assert(t.missing.some((m) => m.label === 'Construction robots' && m.tab === 1), 'fleet');
  assert(t.missing.some((m) => m.label === 'Working time'), 'hours');
});

test('briefSetup maps the power choice', () => {
  const s = sizeBrief(caseBrief('example_filled'), bundle);
  for (const [power, want] of [['Solar + storage', 'solar_batteries'], ['Hybrid', 'topup'], ['Base connection', 'base_only']]) {
    const r = briefSetup(s, { power });
    assertEq(r.source, 'brief');
    assertEq(r.power, want);
    assert(r.sizing === s, 'sizing');
  }
});

test('an unresolved size with no marker, or an absent one, is never read as met', () => {
  const resolved = Object.fromEntries(SIZE_KEYS.map((k) => [k, { status: 'resolved', value: 1, unit: 'x' }]));
  assertEq(unresolvedMarkers(resolved), []);
  assertEq(unresolvedMarkers({ ...resolved, modules: { status: 'unresolved', missing_inputs: [] } }), ['unresolved:modules']);
  assertEq(unresolvedMarkers({ ...resolved, modules: { status: 'unresolved' } }), ['unresolved:modules']);
  const absent = { ...resolved };
  delete absent.workers;
  assertEq(unresolvedMarkers(absent), ['unresolved:workers']);
  assertEq(unresolvedMarkers(undefined).length, SIZE_KEYS.length);
});
