import { makeGrid } from './fixtures.js';

test('harness: assertClose tolerates', () => assertClose(1.0, 1.04, 0.05));
test('fixtures: makeGrid samples fn', () => {
  const g = makeGrid({ width: 3, height: 2, bounds: [0, 0, 3, 2], fn: (c, r) => c + 10 * r });
  assertEq(g.data[4], 11);
});
