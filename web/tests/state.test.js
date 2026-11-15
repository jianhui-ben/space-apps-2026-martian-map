import { createStore } from '../src/state.js';

test('store get returns the initial values', () => {
  const s = createStore({ setup: { loadKw: 150, power: 'topup' }, openSiteId: null });
  assertEq(s.get('setup'), { loadKw: 150, power: 'topup' });
  assertEq(s.get('openSiteId'), null);
  assertEq(s.get('records'), undefined);
});

test('store set notifies that key only, with the value and the previous one', () => {
  const s = createStore({ setup: 1, openSiteId: null });
  const heard = [], other = [];
  s.subscribe('setup', (v, prev) => heard.push([v, prev]));
  s.subscribe('openSiteId', (v) => other.push(v));
  s.set('setup', 2);
  s.set('setup', 3);
  assertEq(heard, [[2, 1], [3, 2]]);
  assertEq(other, []);
  assertEq(s.get('setup'), 3);
});

test('store unsubscribe stops notifications', () => {
  const s = createStore({ priority: null });
  let n = 0;
  const off = s.subscribe('priority', () => { n += 1; });
  s.set('priority', new Map());
  off();
  s.set('priority', new Map());
  assertEq(n, 1);
});

test('store notifies every set, even of an equal value (callers replace maps rather than mutate)', () => {
  const s = createStore({ results: new Map() });
  let n = 0;
  s.subscribe('results', () => { n += 1; });
  const m = s.get('results');
  s.set('results', m);
  s.set('results', new Map(m));
  assertEq(n, 2);
});

test('store a listener removed during a notification is not called; one added is not called until the next set', () => {
  const s = createStore({ layouts: 0 });
  const calls = [];
  let offB = null;
  s.subscribe('layouts', () => { calls.push('a'); if (offB) { offB(); offB = null; } s.subscribe('layouts', () => calls.push('late')); });
  offB = s.subscribe('layouts', () => calls.push('b'));
  s.set('layouts', 1);
  assertEq(calls, ['a']);
});

test('store keys not given at creation can be set and subscribed', () => {
  const s = createStore();
  let seen = null;
  s.subscribe('region', (v) => { seen = v; });
  s.set('region', 'gale');
  assertEq(seen, 'gale');
  assertEq(s.get('region'), 'gale');
});
