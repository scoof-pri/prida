import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, wallDistance, seededRandom } from '../src/world.js';
import { castMap } from '../src/raycast.js';
test('grid-accelerated rays and wall checks match brute force on random queries', () => {
  const map = createWorld(4242),
    plain = { ...map, obstacles: [...map.obstacles] },
    rand = seededRandom(7);
  assert.ok(map.obstacles.grid && !plain.obstacles.grid);
  for (let i = 0; i < 3000; i++) {
    const origin = { x: (rand() - 0.5) * 200, y: 0.3 + rand() * 12, z: (rand() - 0.5) * 170 },
      a = rand() * Math.PI * 2,
      pitch = (rand() - 0.5) * 1.2,
      dir = { x: Math.sin(a) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(a) * Math.cos(pitch) },
      range = 5 + rand() * 170;
    assert.ok(Math.abs(castMap(origin, dir, range, map).distance - castMap(origin, dir, range, plain).distance) < 1e-9);
    const pad = rand() < 0.5 ? 0 : 0.45,
      max = 2 + rand() * 40;
    assert.equal(
      wallDistance(origin.x, origin.z, Math.sin(a), Math.cos(a), max, pad, map.obstacles),
      wallDistance(origin.x, origin.z, Math.sin(a), Math.cos(a), max, pad, plain.obstacles),
    );
  }
});
test('grid add/remove keeps queries consistent', () => {
  const map = createWorld(5),
    o = map.obstacles.find((o) => o.part === 'wall' && !o.hole && (o.face === 'east' || o.face === 'west')),
    // From outside, looking at the wall.
    dir = { x: o.face === 'west' ? 1 : -1, y: 0, z: 0 };
  const origin = { x: o.x - dir.x * 3, y: o.y, z: o.z },
    before = castMap(origin, dir, 10, map).distance;
  assert.ok(before < 3.1);
  map.obstacles.grid.remove(o);
  map.obstacles.splice(map.obstacles.indexOf(o), 1);
  assert.ok(castMap(origin, dir, 10, map).distance > before);
});
