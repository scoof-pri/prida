import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { wallDistance } from '../src/world.js';
await initPhysics();
function place(a, p, x, z) {
  p.x = x;
  p.z = z;
  p.shield = 0;
  p.cooldown = 0;
  a.bodies.get(p.id).body.setTranslation({ x, y: 0.84, z }, true);
  a.world.step();
}
test('Rapier stops movement against a building', () => {
  let a = new Arena();
  let p = a.addPlayer('p', 'P');
  const b = a.map.buildings[0];
  place(a, p, b.x - b.w / 2 - 2, b.z);
  for (let i = 0; i < 180; i++) {
    a.input('p', { x: 1, z: 0, angle: 0, weapon: 0 });
    a.step();
  }
  assert.ok(p.x < b.x - b.w / 2 - 0.3 && p.x > b.x - b.w / 2 - 0.5, `${p.x}`);
  a.dispose();
});
test('server sanitizes input and normalizes diagonal speed', () => {
  let a = new Arena();
  let p = a.addPlayer('p', 'P');
  place(a, p, 0, 0);
  a.input('p', { x: 999, z: 999, angle: NaN, slot: 99 });
  a.step();
  assert.ok(Math.hypot(p.x, p.z) < 0.1);
  // Slot 99 clamps to the empty fifth slot, which cannot be equipped.
  assert.equal(p.slot, 1);
  assert.equal(p.weapon, 0);
  assert.ok(Number.isFinite(p.angle));
  a.dispose();
});
test('shots damage, kill, score and respawn; reload refills', () => {
  let a = new Arena({ random: () => 0.5 });
  let p = a.addPlayer('a', 'A'),
    q = a.addPlayer('b', 'B');
  place(a, p, -4, 0);
  place(a, q, 4, 0);
  for (let i = 0; i < 60; i++) {
    a.input('a', { x: 0, z: 0, angle: Math.PI / 2, weapon: 0, fire: true });
    a.step();
  }
  assert.equal(p.score, 1);
  assert.equal(q.hp, 0);
  assert.equal(q.deaths, 1);
  a.input('a', { weapon: 0, fire: false, reload: true });
  for (let i = 0; i < 220; i++) a.step();
  assert.equal(q.hp, 100);
  assert.equal(p.slots[1].ammo, 24);
  a.dispose();
});
test('walls block shots and spawn shield blocks damage', () => {
  let a = new Arena({ random: () => 0.5 });
  let p = a.addPlayer('a', 'A'),
    q = a.addPlayer('b', 'B');
  const b = a.map.buildings[0];
  place(a, p, b.x - b.w / 2 - 1, b.z);
  place(a, q, b.x + b.w / 2 + 1, b.z);
  p.angle = Math.PI / 2;
  for (let i = 0; i < 2; i++) a.shoot(p); // walls stop the first rounds (sustained fire drills through: see destruction tests)
  assert.equal(q.hp, 100);
  place(a, p, -4, 0);
  place(a, q, 4, 0);
  q.shield = 1;
  p.angle = Math.PI / 2;
  a.shoot(p);
  assert.equal(q.hp, 100);
  assert.ok(wallDistance(b.x - b.w / 2 - 1, b.z, 1, 0, 30, 0, a.map.obstacles) < 2);
  a.dispose();
});
test('stale network input stops moving and firing', () => {
  let a = new Arena();
  let p = a.addPlayer('a', 'A');
  place(a, p, 0, 0);
  a.input('a', { x: 1, z: 0, weapon: 0, fire: true, angle: 0 });
  for (let i = 0; i < 60; i++) a.step();
  let x = p.x,
    ammo = p.slots[1].ammo;
  for (let i = 0; i < 60; i++) a.step();
  assert.ok(Math.abs(p.x - x) < 1e-4);
  assert.equal(p.slots[1].ammo, ammo);
  a.dispose();
});
test('round ends at ten and restarts once', () => {
  let a = new Arena();
  let p = a.addPlayer('a', 'A');
  p.score = 10;
  a.step();
  assert.equal(a.winner, 'a');
  for (let i = 0; i < 425; i++) a.step();
  assert.equal(a.winner, null);
  assert.equal(a.round, 2);
  assert.equal(p.score, 0);
  a.dispose();
});
test('bot training runs for five simulated minutes without invalid state', () => {
  let a = new Arena({ bots: 5 });
  a.addPlayer('you', 'YOU');
  for (let i = 0; i < 18000; i++) {
    a.step();
    a.drainEvents();
  }
  for (let p of a.players) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.ok(p.hp >= 0 && p.hp <= 100);
    assert.ok(Math.abs(p.x) < a.map.limit.x && Math.abs(p.z) < a.map.limit.z);
  }
  assert.ok(a.round > 1);
  a.dispose();
});
test('first-person aim misses over the head and hits with centered aim', () => {
  let a = new Arena({ random: () => 0.5 });
  let p = a.addPlayer('a', 'A'),
    q = a.addPlayer('b', 'B');
  place(a, p, -4, 0);
  place(a, q, 4, 0);
  p.angle = Math.PI / 2;
  p.pitch = 0.6;
  a.shoot(p);
  assert.equal(q.hp, 100);
  p.pitch = 0;
  a.shoot(p);
  assert.equal(q.hp, 82);
  a.dispose();
});
test('3D cover blocks low aim but allows a shot above a low crate', () => {
  let a = new Arena({ random: () => 0.5 });
  let p = a.addPlayer('a', 'A'),
    q = a.addPlayer('b', 'B');
  const c = a.map.cover.find((o) => o.part === 'crate');
  place(a, p, c.x, c.z - 3);
  place(a, q, c.x, c.z + 3);
  p.angle = 0;
  p.pitch = -0.2;
  a.shoot(p);
  assert.equal(q.hp, 100);
  p.pitch = 0;
  a.shoot(p);
  assert.equal(q.hp, 82);
  a.dispose();
});
