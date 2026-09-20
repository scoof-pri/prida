import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world.js';
import { groundHeight } from '../src/terrain.js';
function overlap(a, b) {
  return (
    Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2) > 1e-5 &&
    Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2) > 1e-5
  );
}
test('roads and paths have no coplanar overlaps and roads stay clear of buildings', () => {
  for (const seed of [91726, ...Array.from({ length: 20 }, (_, i) => i + 1)]) {
    const map = createWorld(seed);
    for (const list of [map.roads, map.paths])
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) assert.equal(overlap(list[i], list[j]), false);
    for (const road of map.roads) {
      for (const b of map.buildings) assert.equal(overlap(road, b), false);
      for (let x = road.x - road.w / 2; x <= road.x + road.w / 2; x += 2)
        for (let z = road.z - road.d / 2; z <= road.z + road.d / 2; z += 2) assert.equal(groundHeight(x, z, map), 0);
    }
    for (const path of map.paths)
      for (let x = path.x - path.w / 2; x <= path.x + path.w / 2; x += 1)
        for (let z = path.z - path.d / 2; z <= path.z + path.d / 2; z += 1)
          assert.ok(groundHeight(x, z, map) < 0.045, 'grass intersects raised path');
  }
});
