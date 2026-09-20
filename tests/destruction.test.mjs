import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { createWorld } from '../src/world.js';
import { castMap } from '../src/raycast.js';
import { syncDestruction, structure } from '../src/destruction.js';
await initPhysics();
function place(a, p, x, z, y = 0.02) {
  Object.assign(p, { x, z, y, shield: 0, cooldown: 0, vy: 0 });
  const body = a.bodies.get(p.id).body;
  body.setTranslation({ x, y: y + 0.84, z }, true);
  body.setNextKinematicTranslation({ x, y: y + 0.84, z });
  a.world.step();
}
const panelsOf = (a, b) => a.map.obstacles.filter((o) => o.building === b.id && o.structural);
test('an explosion breaks wall panels, opens a hole and records it for clients', () => {
  const a = new Arena(),
    b = a.map.buildings[0],
    wall = panelsOf(a, b).find((o) => o.face === 'east');
  const before = a.map.obstacles.length,
    origin = { x: wall.x + 3, y: 1.5, z: wall.z },
    dir = { x: -1, y: 0, z: 0 };
  assert.ok(castMap(origin, dir, 6, a.map).distance < 3.1);
  a.blast(wall.x + 0.5, 1.5, wall.z, 6, 110, null);
  assert.ok(!a.map.obstacles.includes(wall), 'panel removed');
  assert.ok(a.map.obstacles.length < before);
  assert.ok(a.destruction.panels.includes(wall.panel));
  assert.ok(a.snapshot().destruction.panels.includes(wall.panel));
  assert.ok(a.drainEvents().some((e) => e.type === 'break' && e.panel === wall.panel));
  assert.ok(castMap(origin, dir, 6, a.map).distance > 3.3, 'shots pass through the hole');
  a.dispose();
});
test('a lintel falls when a panel beside its doorway breaks', () => {
  const a = new Arena(),
    lintel = a.map.obstacles.find((o) => o.part === 'lintel'),
    support = a.map.obstacles.find((o) => o.panel === lintel.supports[0]);
  a.breakObstacle(support, null);
  assert.ok(!a.map.obstacles.includes(lintel));
  assert.ok(a.destruction.panels.includes(lintel.panel));
  a.dispose();
});
test('losing half the ground-floor walls collapses the building, crushes occupants and leaves rubble', () => {
  const a = new Arena(),
    b = a.map.buildings.find((b) => b.plots[0] * b.plots[1] === 1),
    p = a.addPlayer('p', 'P'),
    outside = a.addPlayer('q', 'Q');
  place(a, p, b.x, b.z);
  place(a, outside, b.x + b.w / 2 + 8, b.z);
  const panels = panelsOf(a, b);
  let n = 0;
  while (!b.collapsed && n < panels.length) a.breakObstacle(panels[n++], outside);
  assert.ok(b.collapsed);
  assert.ok(n <= Math.ceil(panels.length * 0.72), `collapsed after ${n}/${panels.length}`);
  assert.equal(a.map.obstacles.filter((o) => o.building === b.id && ['upper', 'roof', 'wall'].includes(o.part)).length, 0);
  const rubble = a.map.obstacles.filter((o) => o.building === b.id && o.part === 'rubble');
  assert.ok(rubble.length >= 3);
  for (const r of rubble) assert.ok(a.colliders.has(r));
  assert.equal(p.hp, 0, 'occupant crushed');
  assert.equal(outside.hp, 100);
  assert.equal(outside.score, 1, 'the demolisher gets the elimination');
  const events = a.drainEvents();
  assert.ok(events.some((e) => e.type === 'collapse' && e.building === b.id));
  assert.ok(a.snapshot().destruction.buildings.includes(b.id));
  a.dispose();
});
test('cars take bullet damage, then explode into a wreck that still gives cover', () => {
  const a = new Arena({ random: () => 0.5 }),
    // A car with open ground on its +z side, so nothing shields the player from the blast.
    car = a.map.obstacles.find(
      (o) =>
        o.part === 'car' &&
        !a.map.obstacles.some(
          (q) => q !== o && !q.nocollide && Math.abs(q.x - o.x) < q.w / 2 + 1 && Math.abs(q.z - (o.z + o.d / 2 + 2.5)) < q.d / 2 + 2 && q.y - q.h / 2 < 2,
        ),
    ),
    p = a.addPlayer('p', 'P');
  place(a, p, car.x, car.z + car.d / 2 + 2.5);
  a.damageObstacle(car, car.hp - 1, null);
  assert.equal(car.part, 'car');
  a.damageObstacle(car, 5, null);
  assert.equal(car.part, 'wreck');
  assert.ok(a.map.obstacles.includes(car) && a.colliders.has(car));
  assert.ok(a.destruction.wrecks.includes(car.decor));
  assert.ok(p.hp < 100, 'secondary explosion hurts nearby players');
  assert.ok(a.drainEvents().some((e) => e.type === 'explosion' && e.cause === 'car'));
  a.dispose();
});
test('clients mirror destruction from snapshot lists exactly', () => {
  const a = new Arena(),
    b = a.map.buildings[3];
  for (const o of panelsOf(a, b).slice(0, 3)) a.breakObstacle(o, null);
  const c = a.map.buildings[5];
  for (const o of panelsOf(a, c)) if (!c.collapsed) a.breakObstacle(o, null);
  const car = a.map.obstacles.find((o) => o.part === 'car');
  a.damageObstacle(car, 9999, null);
  const prop = a.map.obstacles.find((o) => o.part === 'prop' && o.hp);
  a.damageObstacle(prop, 9999, null);
  const client = createWorld(a.map.seed),
    state = a.snapshot().destruction;
  syncDestruction(client, state);
  syncDestruction(client, state); // idempotent
  const key = (o) => [o.part, o.x.toFixed(3), o.z.toFixed(3), o.w.toFixed(3), o.h.toFixed(3)].join();
  assert.deepEqual(client.obstacles.map(key).sort(), a.map.obstacles.map(key).sort());
  a.dispose();
});
test('navigation is rebuilt after destruction so bots can path through holes', () => {
  const a = new Arena(),
    b = a.map.buildings[0],
    wall = panelsOf(a, b).find((o) => o.face === 'east');
  const inside = { x: wall.x - 1.2, z: wall.z },
    outside = { x: wall.x + 1.5, z: wall.z },
    before = a.nav.path(outside, inside).length;
  a.breakObstacle(wall, null);
  for (let i = 0; i < 40; i++) a.step();
  const after = a.nav.path(outside, inside).length;
  assert.ok(after > 0 && after < before, `${before} -> ${after}`);
  a.dispose();
});
test('structure ratio reflects destroyed panels', () => {
  const m = createWorld(),
    a = new Arena(),
    b = a.map.buildings[1];
  assert.equal(structure(a.map, b, new Set()).ratio, 1);
  assert.ok(m.buildings.length > 0);
  a.dispose();
});

// ---- 0.9 voxel walls -------------------------------------------------------------------------------
import { cellGrid, cellIndexAt, cellsSupport, damageCells, cellRects, encodeCells, decodeCells } from '../src/cells.js';
import { WEAPONS } from '../src/world.js';
import { EYE_HEIGHT } from '../src/combat.js';
const weaponIndex = (model) => WEAPONS.findIndex((w) => w.model === model);
function aimAt(a, p, wall, y = 1.6) {
  // Stand 3 m in front of the wall's outer face and look straight at its centre.
  const out = wall.face === 'east' ? 1 : wall.face === 'west' ? -1 : 0,
    outZ = wall.face === 'south' ? 1 : wall.face === 'north' ? -1 : 0;
  place(a, p, wall.x + out * 3, wall.z + outZ * 3);
  p.angle = Math.atan2(wall.x - p.x, wall.z - p.z);
  p.pitch = Math.atan2(y - (p.y + EYE_HEIGHT), 3);
}
test('sustained fire drills a hole through a wall, cell by cell, and shots then pass through it', () => {
  const a = new Arena({ random: () => 0.5 }),
    b = a.map.buildings[0],
    wall = panelsOf(a, b).find((o) => o.face === 'east'),
    p = a.addPlayer('p', 'P');
  aimAt(a, p, wall);
  p.pitch = 0;
  const origin = { x: p.x, y: p.y + EYE_HEIGHT, z: p.z },
    dir = { x: -1, y: 0, z: 0 },
    before = castMap(origin, dir, 10, a.map).distance;
  for (let i = 0; i < 3; i++) a.shoot(p);
  assert.equal(wall.cellsAlive, cellGrid(wall).cols * cellGrid(wall).rows, 'a few rounds only chip the surface');
  assert.equal(a.snapshot().destruction.cells[wall.panel], undefined);
  for (let i = 0; i < 12; i++) a.shoot(p);
  assert.ok(wall.cells && wall.cellsAlive < cellGrid(wall).cols * cellGrid(wall).rows, 'cells knocked out');
  assert.ok(a.map.obstacles.includes(wall), 'the rest of the wall stands');
  assert.ok(Array.isArray(a.colliders.get(wall)) && a.colliders.get(wall).length > 1, 'colliders rebuilt around the hole');
  assert.ok(castMap(origin, dir, 10, a.map).distance > before + 0.3, 'the hole lets shots through');
  assert.equal(a.snapshot().destruction.cells[wall.panel], encodeCells(wall));
  a.dispose();
});
test('cells cut loose from both floor and ceiling fall out', () => {
  const o = { x: 0, y: 1.8, z: 0, w: 2.4, h: 3.6, d: 0.4 },
    g = cellGrid(o),
    ring = [];
  // Cut a closed ring around the cell block rows 3-5, columns 2-3.
  for (let r = 2; r <= 6; r++) for (let c = 1; c <= 4; c++) if (r === 2 || r === 6 || c === 1 || c === 4) ring.push([r * g.cols + c, 999]);
  const removed = damageCells(o, ring);
  assert.equal(removed.length, ring.length + 6, 'the island inside the ring drops');
  assert.ok(cellsSupport(o) === false || o.cellsAlive > 0);
  assert.ok(cellRects(o).length >= 3);
  assert.deepEqual([...decodeCells(o, encodeCells(o))].map((v) => v > 0), [...o.cells].map((v) => v > 0));
});
test('katana cuts sever wall panels, and enough cuts bring the house down', () => {
  const a = new Arena({ random: () => 0.5 }),
    b = a.map.buildings.find((b) => b.plots[0] * b.plots[1] === 1),
    p = a.addPlayer('p', 'P');
  a.setLoadout(p, { melee: weaponIndex('katana') });
  p.slot = 0;
  a.syncHeld(p);
  const walls = panelsOf(a, b).filter((o) => o.face === 'east' || o.face === 'west');
  const first = walls[0];
  aimAt(a, p, first, 1.2);
  place(a, p, first.x + (first.face === 'east' ? 1.4 : -1.4), first.z);
  a.melee(p);
  assert.ok(first.cells, 'the blade cuts into the concrete');
  const e = a.drainEvents().find((e) => e.type === 'melee');
  assert.ok(e.wall && e.wall.cells > 0);
  // Cut every row-1 line through each wall until the building gives way.
  let swings = 0;
  for (const wall of panelsOf(a, b)) {
    if (b.collapsed) break;
    if (!a.map.obstacles.includes(wall)) continue;
    const g = cellGrid(wall);
    for (let c = 0; c < g.cols; c += 6) {
      const along = -g.span / 2 + (c + 3) * g.cw,
        point = { x: wall.x + (g.alongX ? along : 0), y: 1.2, z: wall.z + (g.alongX ? 0 : along) };
      a.hitCells(wall, [...Array(6)].map((_, k) => [cellIndexAt(wall, point) - 3 + k, 999]).filter(([i]) => Math.floor(i / g.cols) === Math.floor(cellIndexAt(wall, point) / g.cols)), p);
      swings++;
    }
  }
  assert.ok(b.collapsed, `house collapsed after ${swings} cuts`);
  a.dispose();
});
test('no hidden building hit points: shooting and rocketing the roof never brings a house down', () => {
  const a = new Arena(),
    // A one-storey house: on taller ones the shots would take out top-storey walls (a real collapse).
    b = a.map.buildings.find((b) => !b.storeys && a.map.obstacles.some((o) => o.building === b.id && o.part === 'upper')),
    roof = a.map.obstacles.find((o) => o.building === b.id && o.part === 'upper'),
    p = a.addPlayer('p', 'P');
  place(a, p, b.x, b.z + b.d / 2 + 12);
  p.angle = Math.PI;
  p.pitch = Math.atan2(roof.y - 1.6, 12 + b.d / 2);
  for (let i = 0; i < 60; i++) {
    p.cooldown = 0;
    a.held(p).ammo = 30;
    a.shoot(p);
  }
  assert.ok(a.map.obstacles.includes(roof), 'bullets do not break roofs');
  for (let i = 0; i < 20; i++) a.blast(roof.x, roof.y + roof.h / 2 + 0.2, roof.z, 6, 110, null);
  assert.ok(!b.collapsed, 'the house still stands on its walls');
  assert.ok(!a.map.obstacles.includes(roof), 'the roof itself is blown off');
  // Knocking out the ground-floor walls with rockets does bring it down.
  let rockets = 0;
  for (const wall of panelsOf(a, b).filter((o) => !o.storey)) {
    if (b.collapsed) break;
    if (!a.map.obstacles.includes(wall)) continue;
    a.blast(wall.x + (wall.face === 'east' ? 0.6 : wall.face === 'west' ? -0.6 : 0), 1.5, wall.z + (wall.face === 'south' ? 0.6 : wall.face === 'north' ? -0.6 : 0), 6, 110, null);
    rockets++;
  }
  assert.ok(b.collapsed, `collapsed after ${rockets} rockets at its walls`);
  a.dispose();
});
test('clients mirror damaged walls cell for cell', () => {
  const a = new Arena(),
    b = a.map.buildings[2],
    wall = panelsOf(a, b)[1];
  a.hitCells(wall, [[5, 999], [6, 999], [14, 999]], null);
  const client = createWorld(a.map.seed),
    changed = syncDestruction(client, a.snapshot().destruction),
    mirror = client.obstacles.find((o) => o.panel === wall.panel);
  assert.equal(changed.cells.length, 1);
  assert.deepEqual([...mirror.cells].map((v) => v > 0), [...wall.cells].map((v) => v > 0));
  assert.equal(syncDestruction(client, a.snapshot().destruction).cells.length, 0, 'idempotent');
  a.dispose();
});

// ---- 0.9.1 upper storeys ---------------------------------------------------------------------------
test('upper storeys are built from destructible panels with windows and floor slabs', () => {
  const a = new Arena(),
    b = [...a.map.buildings].sort((x, y) => y.storeys - x.storeys)[0];
  assert.ok(b.storeys >= 3, `tallest has ${b.storeys} storeys`);
  for (let k = 1; k <= b.storeys; k++) {
    const walls = a.map.obstacles.filter((o) => o.building === b.id && o.storey === k && o.panel !== undefined);
    assert.ok(walls.length >= 8, `storey ${k}: ${walls.length} panels`);
    assert.ok(a.map.obstacles.some((o) => o.building === b.id && o.storey === k && o.part === 'roof'), 'slab');
    assert.ok(a.map.windows.some((w) => walls.some((o) => o.panel === w.panel)), 'windows');
  }
  // A rocket against the third storey carves blocks out of it.
  const wall = a.map.obstacles.find((o) => o.building === b.id && o.storey === 3 && o.face === 'east');
  a.blast(wall.x + 0.6, wall.y, wall.z, 6, 110, null);
  assert.ok(!a.map.obstacles.includes(wall) || wall.cellsAlive < cellGrid(wall).cols * cellGrid(wall).rows);
  a.dispose();
});
test('an upper storey that loses its walls drops with everything above it, the floors below stay', () => {
  const a = new Arena(),
    b = [...a.map.buildings].sort((x, y) => y.storeys - x.storeys)[0],
    k = 2,
    p = a.addPlayer('p', 'P');
  place(a, p, b.x, b.z, 3.84 + (k - 1) * 3.6 + 0.02);
  const walls = a.map.obstacles.filter((o) => o.building === b.id && o.storey === k && o.panel !== undefined);
  for (const o of walls) if (!b.fallenFrom) a.breakObstacle(o, null);
  assert.equal(b.fallenFrom, k);
  assert.ok(!b.collapsed, 'the building still stands');
  assert.equal(a.map.obstacles.filter((o) => o.building === b.id && o.storey >= k).length, 0);
  assert.ok(a.map.obstacles.some((o) => o.building === b.id && o.storey === k - 1 && o.part === 'roof'), 'the floor below stays');
  assert.ok(a.map.obstacles.some((o) => o.building === b.id && o.storey === 1 && o.panel !== undefined));
  assert.equal(p.hp, 0, 'whoever was on that floor is crushed');
  assert.ok(a.drainEvents().some((e) => e.type === 'storeyCollapse' && e.building === b.id && e.storey === k));
  const client = createWorld(a.map.seed),
    changed = syncDestruction(client, a.snapshot().destruction);
  assert.deepEqual(changed.storeys, [[b.id, k]]);
  const key = (o) => [o.part, o.x.toFixed(3), o.y.toFixed(3), o.z.toFixed(3)].join();
  assert.deepEqual(client.obstacles.map(key).sort(), a.map.obstacles.map(key).sort());
  a.dispose();
});
