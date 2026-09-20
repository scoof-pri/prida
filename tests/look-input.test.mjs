import test from 'node:test';
import assert from 'node:assert/strict';
import { LookInput } from '../src/look-input.js';
test('pointer lock acquisition drops the recenter sample and preserves ordinary input', () => {
  const c = new LookInput();
  assert.equal(c.relative(0, -600), null);
  assert.deepEqual(c.relative(4, -3), { dx: 4, dy: -3 });
  c.lockChanged();
  assert.equal(c.relative(80, -300), null);
  assert.deepEqual(c.relative(2, 1), { dx: 2, dy: 1 });
});
test('cursor warps and invalid values do not change view', () => {
  const c = new LookInput();
  c.relative(0, 0);
  for (const d of [
    [0, -800],
    [Infinity, 2],
    [1, NaN],
    [200, 200],
  ])
    assert.equal(c.relative(...d), null);
  assert.deepEqual(c.relative(0, 8), { dx: 0, dy: 8 });
});
test('drag anchor is reset between mouse lock, pause and touch gestures', () => {
  const c = new LookInput();
  c.startDrag('mouse', 200, 400);
  assert.deepEqual(c.drag('mouse', 205, 390), { dx: 5, dy: -10 });
  c.lockChanged();
  assert.equal(c.drag('mouse', 10, 10), null);
  c.startDrag(12, 50, 100);
  assert.equal(c.drag(13, 20, 900), null);
  assert.deepEqual(c.drag(12, 60, 103), { dx: 10, dy: 3 });
  c.reset();
  assert.equal(c.drag(12, 0, 0), null);
});
