import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { createWorld, stairLane } from '../src/world.js';
import { syncDestruction } from '../src/destruction.js';
import { cellGrid } from '../src/cells.js';
await initPhysics();
function place(a, p, x, z, y = 0.02) {
  Object.assign(p, { x, z, y, shield: 0, cooldown: 0, vy: 0 });
  const body = a.bodies.get(p.id).body;
  body.setTranslation({ x, y: y + 0.84, z }, true);
  body.setNextKinematicTranslation({ x, y: y + 0.84, z });
  a.world.step();
}
const models = (m, b, storey) => m.decor.filter((d) => d.building === b.id && (storey === undefined || d.storey === storey)).map((d) => d.model || 'box');

test('every building has a purpose and every storey is furnished for it', () => {
  const m = createWorld();
  for (const b of m.buildings) {
    assert.ok(b.purpose, b.type);
    for (let k = 0; k <= b.storeys; k++) assert.ok(models(m, b, k).length >= 3, `${b.type} storey ${k}: ${models(m, b, k).length}`);
  }
  const has = (purpose, list) =>
    m.buildings.filter((b) => b.purpose === purpose).every((b) => list.every((name) => models(m, b).includes(name)));
  assert.ok(has('home', ['fridge', 'table', 'chair', 'toilet']), 'homes: kitchen, dining, bathroom');
  assert.ok(m.buildings.some((b) => b.purpose === 'home' && models(m, b).some((n) => n.startsWith('bed'))), 'bedrooms');
  assert.ok(has('office', ['desk', 'office-chair']), 'offices: desks');
  assert.ok(has('cafe', ['table-round', 'bar']), 'cafes: tables and a bar');
  assert.ok(has('clinic', ['bed-single']), 'clinics: ward beds');
});

test('block stairs lead from the ground floor up through the stairwells', () => {
  const a = new Arena(),
    b = a.map.buildings.find((b) => b.storeys >= 2),
    p = a.addPlayer('p', 'P');
  const climb = (storey, floor) => {
    const lane = stairLane(b, storey);
    place(a, p, lane.x, lane.z0 - lane.dir * 0.6, floor + 0.02);
    p.angle = lane.dir > 0 ? 0 : Math.PI;
    for (let i = 0; i < 150; i++) {
      a.input('p', { x: 0, z: lane.dir, angle: p.angle, pitch: 0 });
      a.step();
    }
    return p.y;
  };
  assert.ok(Math.abs(climb(0, 0) - 3.84) < 0.15, `storey 1: ${p.y}`);
  assert.ok(Math.abs(climb(1, 3.84) - 7.44) < 0.15, `storey 2: ${p.y}`);
  a.dispose();
});

test('ceilings break cell by cell; furniture over the hole falls, the roof goes with the top slab', () => {
  const a = new Arena(),
    b = a.map.buildings.find((b) => b.storeys >= 1),
    slab = a.map.obstacles.find((o) => o.building === b.id && o.part === 'roof' && o.storey === 0),
    above = a.map.obstacles.filter((o) => o.building === b.id && o.storey === 1 && o.decor !== undefined && !o.nocollide);
  const target = above[0],
    before = slab.cellsAlive;
  a.blast(target.x, slab.y - 0.5, target.z, 6, 110, null);
  assert.ok(slab.cellsAlive < before, 'blocks blown out of the ceiling');
  assert.ok(!a.map.obstacles.includes(target), 'the furniture above fell through');
  assert.ok(a.snapshot().destruction.cells[slab.panel]);
  const top = a.map.obstacles.find((o) => o.building === b.id && o.part === 'roof' && o.storey === b.storeys);
  a.breakObstacle(top, null);
  assert.ok(a.snapshot().destruction.roofs.includes(b.id), 'roof gone');
  const client = createWorld(a.map.seed),
    changed = syncDestruction(client, a.snapshot().destruction);
  assert.ok(changed.roofs.includes(b.id));
  const mirror = client.obstacles.find((o) => o.panel === slab.panel);
  assert.deepEqual([...mirror.cells].map((v) => v > 0), [...slab.cells].map((v) => v > 0));
  a.dispose();
});

test('trees, rocks, crates, roofs and burnt-out cars can all be destroyed, and clients mirror it', () => {
  const a = new Arena(),
    tree = a.map.obstacles.find((o) => o.part === 'tree'),
    rock = a.map.obstacles.find((o) => o.part === 'rock'),
    crate = a.map.obstacles.find((o) => o.part === 'crate'),
    car = a.map.obstacles.find((o) => o.part === 'car'),
    b = a.map.buildings.find((b) => a.map.obstacles.some((o) => o.building === b.id && o.part === 'upper'));
  for (const o of [tree, rock, crate]) a.damageObstacle(o, 999, null);
  for (const o of [tree, rock, crate]) assert.ok(!a.map.obstacles.includes(o), o.part);
  a.damageObstacle(car, 999, null);
  assert.equal(car.part, 'wreck');
  a.damageObstacle(car, 999, null);
  assert.ok(!a.map.obstacles.includes(car), 'wreck blown apart');
  const roof = a.map.obstacles.find((o) => o.building === b.id && o.part === 'upper');
  let rockets = 0;
  while (a.map.obstacles.includes(roof) && rockets < 10) {
    a.blast(roof.x + roof.w / 2 + 0.3, roof.y, roof.z, 6, 110, null);
    rockets++;
  }
  assert.ok(!a.map.obstacles.includes(roof) || b.collapsed, `roof destroyed after ${rockets} rockets`);
  const state = a.snapshot().destruction,
    client = createWorld(a.map.seed),
    changed = syncDestruction(client, state);
  assert.ok([tree.prop, rock.prop, crate.prop].every((id) => changed.props.includes(id)));
  assert.equal(client.obstacles.filter((o) => o.part === 'tree').length, a.map.obstacles.filter((o) => o.part === 'tree').length);
  a.dispose();
});

test('small furniture stops bullets and breaks, but does not block movement', () => {
  const a = new Arena(),
    chair = a.map.obstacles.find((o) => o.nocollide && o.decor !== undefined && !(o.storey > 0));
  assert.equal(a.colliders.get(chair), null, 'no physics collider');
  a.damageObstacle(chair, 999, null);
  assert.ok(!a.map.obstacles.includes(chair));
  assert.ok(a.snapshot().destruction.decor.includes(chair.decor));
  a.dispose();
});

test('bazooka code: a legendary rocket launcher in solo sandbox only, never online', () => {
  const solo = new Arena({ allowCheats: true }),
    p = solo.addPlayer('p', 'P');
  assert.ok(solo.setCheat('p', 'bazooka', true));
  assert.equal(p.slot, 3);
  assert.equal(solo.held(p).r, 4);
  assert.equal(p.weapon, solo.held(p).w);
  assert.ok(solo.cheated, 'rewards off');
  solo.dispose();
  const online = new Arena({ allowCheats: false }),
    q = online.addPlayer('q', 'Q');
  assert.equal(online.setCheat('q', 'bazooka', true), false);
  assert.notEqual(q.slot, 3);
  online.dispose();
});
