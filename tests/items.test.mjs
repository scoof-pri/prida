import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import {
  WEAPONS,
  RARITIES,
  GEAR,
  weaponStats,
  makeItem,
  addItem,
  sanitizeLoadout,
  encodeLoadout,
  decodeLoadout,
  defaultLoadout,
  LOADOUT_CHOICES,
  rollChest,
  bestItem,
} from '../src/items.js';
import { seededRandom } from '../src/world.js';
await initPhysics();

function place(a, p, x, z, y = 0.02) {
  Object.assign(p, { x, z, y, shield: 0, cooldown: 0, vy: 0 });
  const body = a.bodies.get(p.id).body;
  body.setTranslation({ x, y: y + 0.84, z }, true);
  body.setNextKinematicTranslation({ x, y: y + 0.84, z });
  a.world.step();
}

test('catalog: 19 weapons incl. grenade, C4, 3 melee, 5 rarities, jetpack and glider', () => {
  assert.equal(WEAPONS.length, 19);
  assert.deepEqual(WEAPONS.slice(-2).map((w) => w.name), ['GRENADE', 'C4']);
  assert.deepEqual(
    WEAPONS.filter((w) => w.melee).map((w) => w.name),
    ['FANG', 'SPADE', 'RONIN'],
  );
  assert.deepEqual(
    RARITIES.map((r) => r.id),
    ['common', 'uncommon', 'rare', 'epic', 'legendary'],
  );
  assert.deepEqual(
    GEAR.map((g) => g.id),
    ['jetpack', 'glider'],
  );
  for (const w of WEAPONS) {
    assert.ok(w.name && w.ru && w.model && w.fp && w.char, w.name);
    assert.ok(['melee', 'primary', 'secondary', 'power'].includes(w.category), w.name);
  }
});

test('rarity scales damage and reload monotonically and never shrinks a magazine', () => {
  for (let w = 0; w < WEAPONS.length; w++)
    for (let r = 1; r < RARITIES.length; r++) {
      const a = weaponStats(w, r - 1),
        b = weaponStats(w, r);
      assert.ok(b.damage > a.damage);
      assert.ok(b.reload <= a.reload);
      assert.ok(b.mag >= a.mag);
    }
  assert.equal(weaponStats(0, 99).damage, weaponStats(0, 0).damage, 'invalid rarity falls back to common');
});

test('loadouts are validated, encoded for the network and exclude chest-only weapons', () => {
  assert.deepEqual(sanitizeLoadout({ melee: 0, primary: 6, secondary: 5, gear: 'cape' }), defaultLoadout());
  const l = { melee: 9, primary: 3, secondary: 16, gear: 'jetpack' };
  assert.deepEqual(decodeLoadout(encodeLoadout(l)), l);
  assert.deepEqual(decodeLoadout('garbage'), defaultLoadout());
  for (const i of [...LOADOUT_CHOICES.primary, ...LOADOUT_CHOICES.secondary])
    assert.notEqual(WEAPONS[i].category, 'power');
  assert.ok(LOADOUT_CHOICES.gear.includes('none'));
});

test('inventory: free slot, merge with rarity upgrade, full inventory swaps the held weapon', () => {
  const p = { slot: 1, slots: [makeItem(7), makeItem(0), makeItem(2), null, null] };
  assert.equal(addItem(p, makeItem(1, 2)).slot, 3);
  assert.equal(addItem(p, makeItem(3)).slot, 4);
  const merged = addItem(p, makeItem(0, 3));
  assert.ok(merged.merged);
  assert.equal(p.slots[1].r, 3);
  const swap = addItem(p, makeItem(12, 1));
  assert.equal(swap.slot, 1);
  assert.equal(swap.dropped.w, 0);
  assert.equal(p.slots[1].w, 12);
  const melee = addItem(p, makeItem(9, 2));
  assert.equal(melee.slot, 0);
  assert.equal(melee.dropped.w, 7);
  assert.equal(bestItem(p.slots).w, 1);
});

test('chest rolls are deterministic per seed and supply crates roll better on average', () => {
  const roll = (seed, tier) => rollChest(seededRandom(seed), tier);
  assert.deepEqual(roll(5, 'chest'), roll(5, 'chest'));
  const mean = (tier) => {
    const r = seededRandom(9);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += rollChest(r, tier).loot.r;
    return sum / 2000;
  };
  assert.ok(mean('supply') > mean('park') && mean('park') > mean('chest'));
});

test('melee reaches only enemies in front within range and uses no ammunition', () => {
  const a = new Arena({ random: () => 0.5 }),
    p = a.addPlayer('p', 'P'),
    front = a.addPlayer('f', 'F'),
    behind = a.addPlayer('b', 'B');
  place(a, p, 0, 0);
  place(a, front, 0, 1.8);
  place(a, behind, 0, -1.5);
  a.setLoadout(p, { melee: 9, primary: 0, secondary: 2, gear: 'none' });
  a.equip(p, 0);
  p.cooldown = 0;
  p.angle = 0;
  const events = [];
  a.melee(p);
  events.push(...a.drainEvents());
  assert.ok(front.hp < 100);
  assert.equal(behind.hp, 100);
  assert.ok(events.some((e) => e.type === 'melee' && e.hit));
  place(a, front, 0, 6);
  const hp = front.hp;
  a.melee(p);
  assert.equal(front.hp, hp, 'out of reach');
  a.dispose();
});

test('jetpack lifts while fuel lasts, refuels on the ground; glider slows the fall', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  a.setLoadout(p, { ...defaultLoadout(), gear: 'jetpack' });
  place(a, p, 0, 0);
  a.input('p', { jump: true, ascend: 1 });
  a.step();
  for (let i = 0; i < 90; i++) {
    a.input('p', { ascend: 1 });
    a.step();
  }
  assert.ok(p.y > 4, 'rose to ' + p.y);
  assert.ok(p.gear.fuel < 100);
  for (let i = 0; i < 600 && !p.grounded; i++) {
    a.input('p', {});
    a.step();
  }
  const fuel = p.gear.fuel;
  for (let i = 0; i < 120; i++) {
    a.input('p', {});
    a.step();
  }
  assert.ok(p.gear.fuel > fuel);

  const fall = (gear) => {
    const b = new Arena(),
      q = b.addPlayer('q', 'Q');
    b.setLoadout(q, { ...defaultLoadout(), gear });
    place(b, q, 0, 0, 25);
    let t = 0;
    for (; t < 60 * 20 && q.y > 0.3; t++) {
      b.input('q', { ascend: 1, angle: 0 });
      b.step();
    }
    b.dispose();
    return t;
  };
  assert.ok(fall('glider') > fall('none') * 2.5);
  a.dispose();
});

test('the minigun spins up before firing; crossbow bolts are silent and drop with gravity', () => {
  const a = new Arena({ random: () => 0.5 }),
    p = a.addPlayer('p', 'P'),
    bot = a.addPlayer('bot1', 'B', true);
  place(a, p, 0, 0);
  place(a, bot, 20, 0);
  p.slots[1] = makeItem(15);
  p.slot = 1;
  a.syncHeld(p);
  const ammo = p.slots[1].ammo;
  for (let i = 0; i < 20; i++) {
    a.input('p', { slot: 1, fire: true, angle: 0 });
    a.step();
  }
  assert.equal(p.slots[1].ammo, ammo, 'still spinning up');
  for (let i = 0; i < 40; i++) {
    a.input('p', { slot: 1, fire: true, angle: 0 });
    a.step();
  }
  assert.ok(p.slots[1].ammo < ammo);

  bot.brain.memory = 0;
  p.slots[1] = makeItem(14);
  a.syncHeld(p);
  p.cooldown = 0;
  p.angle = 0;
  p.pitch = 0;
  a.shoot(p);
  assert.equal(bot.brain.memory, 0, 'silent weapon does not alert bots');
  const y0 = a.projectiles[0].y;
  a.stepProjectiles(1 / 60);
  a.stepProjectiles(1 / 60);
  assert.ok(a.projectiles[0].vy < 0 && a.projectiles[0].y < y0);
  a.dispose();
});

test('network snapshots expose slots and gear but never input or AI state', () => {
  const a = new Arena({ bots: 2 }),
    s = a.snapshot();
  for (const p of s.players) {
    assert.equal(p.slots.length, 5);
    assert.ok(!('brain' in p) && !('input' in p));
    assert.ok(p.loadout);
  }
  assert.ok(s.chests.every((c) => c.loot && Number.isInteger(c.loot.w)));
  a.dispose();
});
