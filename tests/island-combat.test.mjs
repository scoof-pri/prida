import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { createWorld } from '../src/world.js';

await initPhysics();

test('Big City is a larger island with an ocean and a dry legacy core', () => {
  const map = createWorld(91726, 'city');
  assert.ok(map.island);
  assert.ok(map.limit.x > map.landLimit.x && map.limit.z > map.landLimit.z);
  assert.ok(map.waters.some((w) => w.ocean));
  assert.ok(map.buildings.every((b) => Math.abs(b.x) < map.landLimit.x && Math.abs(b.z) < map.landLimit.z));
});

test('shield HP absorbs damage before health', () => {
  const a = new Arena();
  const p = a.addPlayer('a', 'A');
  const q = a.addPlayer('b', 'B');
  p.shield = q.shield = 0;
  q.shieldHP = 40;
  a.damage(p, q, 30);
  assert.equal(q.hp, 100);
  assert.equal(q.shieldHP, 10);
  a.damage(p, q, 25);
  assert.equal(q.shieldHP, 0);
  assert.ok(q.hp < 100);
  a.dispose();
});

test('C4 charges stay in the world and detonate remotely', () => {
  const a = new Arena({ random: () => 0.5 });
  const p = a.addPlayer('a', 'A');
  p.shield = 0;
  p.slots[1] = { w: 18, r: 0, ammo: 1, reserve: 0 };
  p.slot = 1;
  a.syncHeld(p);
  a.shoot(p);
  assert.equal(a.projectiles[0].kind, 'c4');
  const before = a.projectiles.length;
  assert.equal(a.detonateCharges(p), 1);
  assert.equal(before, 1);
  assert.equal(a.projectiles.length, 0);
  assert.ok(a.drainEvents().some((e) => e.type === 'explosion' && e.cause === 'c4'));
  a.dispose();
});
