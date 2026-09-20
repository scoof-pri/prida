import test from 'node:test';
import assert from 'node:assert/strict';
import { direction, relativeMove, rayBox } from '../src/combat.js';
test('forward and strafe follow view, perpendicular and normalized', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    let f = relativeMove(0, 1, angle),
      r = relativeMove(1, 0, angle),
      d = direction(angle);
    assert.ok(Math.abs(f.x - d.x) + Math.abs(f.z - d.z) < 1e-9);
    assert.ok(Math.abs(f.x * r.x + f.z * r.z) < 1e-9);
    assert.ok(Math.abs(Math.hypot(r.x, r.z) - 1) < 1e-9);
  }
});
test('vertical rays and behind-camera boxes do not produce false hits', () => {
  const min = { x: -1, y: 0, z: 2 },
    max = { x: 1, y: 2, z: 4 },
    o = { x: 0, y: 1.6, z: 0 };
  assert.equal(rayBox(o, { x: 0, y: 0, z: 1 }, min, max, 20), 2);
  assert.equal(rayBox(o, { x: 0, y: 1, z: 0 }, min, max, 20), Infinity);
  assert.equal(rayBox(o, { x: 0, y: 0, z: -1 }, min, max, 20), Infinity);
});
