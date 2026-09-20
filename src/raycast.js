import { rayBox } from './combat.js';
import { cellRay } from './cells.js';
import { terrainRay, terrainNormal, biomeAt } from './terrain.js';
// `solidOnly`: small furniture (chairs, lamps…) does not block (explosions, line of sight).
export function castMap(origin, dir, range, map, ignore = null, solidOnly = false) {
  let distance = range,
    impact = null;
  const test = (b) => {
    if (b === ignore || (solidOnly && b.nocollide)) return distance;
    const min = { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
      max = { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 },
      d0 = rayBox(origin, dir, min, max, distance);
    // Through a window opening (glass is its own obstacle).
    if (b.hole && !b.cells && d0 < distance) {
      const hy = origin.y + dir.y * d0,
        a = b.hole.alongX ? origin.x + dir.x * d0 : origin.z + dir.z * d0;
      if (a > b.hole.a0 + 0.03 && a < b.hole.a1 - 0.03 && hy > b.hole.y0 + 0.03 && hy < b.hole.y1 - 0.03) return distance;
    }
    // Damaged walls: the ray only stops at a solid cell, so shots and sight pass through holes.
    const d = d0 < distance && b.cells ? cellRay(b, origin, dir, d0, distance) : d0;
    if (d < distance) {
      distance = d;
      const hit = { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
        sides = [];
      for (const k of ['x', 'y', 'z']) {
        sides.push({ k, sign: -1, d: Math.abs(hit[k] - min[k]) }, { k, sign: 1, d: Math.abs(hit[k] - max[k]) });
      }
      sides.sort((a, b) => a.d - b.d);
      const normal = { x: 0, y: 0, z: 0 };
      normal[sides[0].k] = sides[0].sign;
      impact = {
        kind: ['tree', 'crate', 'furniture', 'bench'].includes(b.part) ? 'wood' : b.part === 'car' ? 'metal' : b.part === 'glass' ? 'glass' : 'stone',
        ...normal,
        obstacle: b,
      };
    }
    return distance;
  };
  if (map.obstacles.grid) map.obstacles.grid.ray(origin, dir, distance, test);
  else for (const b of map.obstacles) test(b);
  const ground = terrainRay(origin, dir, distance, map);
  if (ground <= distance) {
    distance = ground;
    const x = origin.x + dir.x * ground,
      z = origin.z + dir.z * ground;
    impact = { kind: biomeAt(x, z, map) === 'quarry' ? 'sand' : 'earth', ...terrainNormal(x, z, map) };
  }
  return { distance, impact };
}
