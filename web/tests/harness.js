// Minimal in-page test runner. Test files import nothing; they use these globals.
const tests = [];

export function test(name, fn) { tests.push({ name, fn }); }
export function skip(name, reason) { tests.push({ name, skip: reason || true }); }

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertEq(a, b, msg) {
  const same = Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
  if (!same) {
    throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
  }
}

export function assertClose(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) {
    throw new Error((msg ? msg + ': ' : '') + a + ' is not within ' + tol + ' of ' + b);
  }
}

export async function runAll(grep) {
  const results = { passed: 0, failed: [], skipped: [], done: false };
  window.__results = results;
  for (const t of tests) {
    if (grep && !t.name.includes(grep)) continue;
    if (t.skip) { results.skipped.push(t.name); continue; }
    try {
      await t.fn();
      results.passed += 1;
    } catch (e) {
      results.failed.push({ name: t.name, message: String((e && e.message) || e) });
    }
  }
  results.done = true;
  return results;
}

Object.assign(globalThis, { test, skip, assert, assertEq, assertClose });
