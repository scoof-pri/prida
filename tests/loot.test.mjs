import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { WEAPONS, createWorld, LIMIT, lineClear } from '../src/world.js';
import { makeItem } from '../src/items.js';
await initPhysics();
function place(a, p, x, z, y = 0.02) {
  Object.assign(p, { x, z, y, shield: 0, cooldown: 0, vy: 0 });
  const body = a.bodies.get(p.id).body;
  body.setTranslation({ x, y: y + 0.84, z }, true);
  body.setNextKinematicTranslation({ x, y: y + 0.84, z });
  a.world.step();
}
function tick(a, p, input, n) {
  for (let i = 0; i < n; i++) {
    a.input(p.id, { angle: 0, slot: p.slot, ...input });
    a.step();
  }
}
test('district area is four times previous release and every weapon is distributed', () => {
  assert.equal((LIMIT.x * LIMIT.z) / (52 * 44), 4);
  for (const seed of [1, 33, 91726]) {
    const m = createWorld(seed);
    assert.equal(new Set(m.chests.map((c) => c.loot.w)).size, WEAPONS.length);
    for (const c of m.chests) assert.ok(c.loot.r >= 0 && c.loot.r <= 4);
    for (const c of m.chests) {
      assert.ok(
        !m.obstacles.some(
          (b) =>
            b.part !== 'roof' &&
            b.part !== 'upper' &&
            !(b.storey > 0) &&
            !b.nocollide &&
            Math.abs(c.x - b.x) < b.w / 2 + 0.4 &&
            Math.abs(c.z - b.z) < b.d / 2 + 0.35,
        ),
        c.id + ' overlaps solid furniture/wall',
      );
    }
  }
});
test('empty slots cannot be equipped; a chest is looted once and fills a free slot', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  a.setLoadout(p, { melee: 7, primary: 0, secondary: 2, gear: 'none' });
  a.input(p.id, { slot: 4 });
  a.step();
  assert.equal(p.slot, 1);
  assert.equal(p.weapon, 0);
  const c = a.chests.find((c) => c.loot.w === 6);
  place(a, p, c.x - 0.8, c.z);
  assert.equal(a.openChest(p), true);
  assert.equal(p.slots[3].w, 6);
  assert.equal(p.slots[3].r, c.loot.r);
  a.equip(p, 3);
  assert.equal(p.weapon, 6);
  assert.equal(p.rarity, c.loot.r);
  const reserve = p.slots[3].reserve;
  assert.equal(a.openChest(p), false);
  assert.equal(p.slots[3].reserve, reserve);
  a.dispose();
});
test('chests cannot be opened at distance or through walls', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P'),
    b = a.map.buildings.find((b) => b.door === 3.2),
    c = a.chests.find((c) => c.id === 'chest' + b.id);
  place(a, p, 0, 0);
  assert.equal(a.openChest(p), false);
  place(a, p, c.x, b.z + b.d / 2 + 0.3);
  assert.ok(Math.hypot(p.x - c.x, p.z - c.z) < 2.8);
  assert.equal(lineClear(p, c, 0, a.map.obstacles), false);
  assert.equal(a.openChest(p), false);
  a.dispose();
});
test('reload consumes finite reserve and empty reserve does not invent ammunition', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  p.slots[1].ammo = 0;
  p.slots[1].reserve = 7;
  tick(a, p, { reload: true }, 100);
  assert.equal(p.slots[1].ammo, 7);
  assert.equal(p.slots[1].reserve, 0);
  p.slots[1].ammo = 0;
  tick(a, p, { fire: true }, 200);
  assert.equal(p.slots[1].ammo, 0);
  assert.equal(p.reload, 0);
  a.dispose();
});
test('medkit completes over time, is consumed once, and incoming damage cancels healing', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  place(a, p, 0, 0);
  p.hp = 20;
  p.medkits = 2;
  tick(a, p, { heal: true }, 120);
  assert.equal(p.hp, 70);
  assert.equal(p.medkits, 1);
  tick(a, p, { heal: false }, 1);
  tick(a, p, { heal: true }, 10);
  assert.ok(p.healing > 0);
  a.damage(null, p, 10);
  assert.equal(p.healing, 0);
  assert.equal(p.medkits, 1);
  a.dispose();
});
test('armor absorbs part of damage and is depleted', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  p.shield = 0;
  p.armor = 20;
  a.damage(null, p, 30);
  assert.equal(p.hp, 85);
  assert.equal(p.armor, 5);
  a.damage(null, p, 30);
  assert.equal(p.hp, 60);
  assert.equal(p.armor, 0);
  a.dispose();
});
function arm(a, p, w, r = 0) {
  p.slots[1] = makeItem(w, r);
  p.slot = 1;
  a.syncHeld(p);
}
test('all seventeen weapons deal damage; projectiles travel before impact; a rocket can hurt its owner', () => {
  for (let i = 0; i < WEAPONS.length; i++) {
    const a = new Arena({ random: () => 0.5 }),
      p = a.addPlayer('p', 'P'),
      q = a.addPlayer('q', 'Q'),
      w = WEAPONS[i];
    place(a, p, 0, 0);
    place(a, q, 0, w.melee ? 1.8 : 10);
    if (w.melee) {
      p.slot = 0;
      p.slots[0] = makeItem(i);
      a.syncHeld(p);
    } else arm(a, p, i);
    p.angle = 0;
    p.pitch = 0;
    if (w.melee) a.melee(p);
    else {
      const ammo = p.slots[1].ammo;
      a.shoot(p);
      assert.equal(p.slots[1].ammo, ammo - 1, w.name);
    }
    if (w.speed) {
      assert.equal(q.hp, 100, w.name + ' hits instantly');
      assert.equal(a.projectiles.length, 1);
      for (let j = 0; j < 90 && a.projectiles.length; j++) a.stepProjectiles(1 / 60);
      assert.equal(a.projectiles.length, 0);
    }
    assert.ok(q.hp < 100, w.name);
    a.dispose();
  }
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  place(a, p, 0, 0);
  arm(a, p, 6);
  p.pitch = -1.3;
  a.shoot(p);
  for (let i = 0; i < 15; i++) a.stepProjectiles(1 / 60);
  assert.ok(p.hp < 100);
  a.dispose();
});
test('higher rarity deals more damage with the same weapon', () => {
  const hp = [];
  for (const r of [0, 4]) {
    const a = new Arena({ random: () => 0.5 }),
      p = a.addPlayer('p', 'P'),
      q = a.addPlayer('q', 'Q');
    place(a, p, 0, 0);
    place(a, q, 0, 10);
    arm(a, p, 10, r);
    p.angle = 0;
    p.pitch = 0;
    a.shoot(p);
    hp.push(q.hp);
    a.dispose();
  }
  assert.ok(hp[1] < hp[0], hp.join(' vs '));
});
test('rocket splash respects walls and killed survival bots drop a supply case', () => {
  const a = new Arena({ mode: 'survival' }),
    p = a.addPlayer('p', 'P'),
    q = a.addPlayer('bot1', 'B', true),
    b = a.map.buildings[0];
  place(a, p, b.x - b.w / 2 - 2, b.z);
  place(a, q, b.x - b.w / 2 + 1, b.z);
  arm(a, p, 6);
  p.angle = Math.PI / 2;
  p.pitch = 0;
  a.shoot(p);
  for (let i = 0; i < 30; i++) a.stepProjectiles(1 / 60);
  assert.equal(q.hp, 80);
  a.damage(p, q, 200);
  const drop = a.chests.find((c) => c.kind === 'drop');
  assert.ok(drop);
  assert.ok(drop.loot && !WEAPONS[drop.loot.w].melee);
  a.dispose();
});
