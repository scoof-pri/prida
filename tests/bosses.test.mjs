import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { BOSSES, RELICS } from '../src/bosses.js';
await initPhysics();

test('four bosses guard lairs in the wild biomes on every map and mode', () => {
  for (const [mode, size] of [['classic', 'district'], ['duel', 'district'], ['royale', 'city']]) {
    const a = new Arena({ mode, size });
    assert.deepEqual(a.bosses.list.map((b) => b.kind).sort(), ['fire', 'frost', 'mind', 'void']);
    for (const b of a.bosses.list) assert.ok(b.hp > 0 && b.name.includes(BOSSES[b.kind].title));
    a.dispose();
  }
});
test('a boss fights back, dies to gunfire and drops its relic, which can be picked up', () => {
  const a = new Arena({ mode: 'classic' }),
    p = a.addPlayer('p', 'P'),
    b = a.bosses.list.find((b) => b.kind === 'fire');
  a.place(p, b.x, b.z + 10);
  p.cheats.god = true;
  let hits = 0;
  for (let i = 0; i < 1200 && b.hp > 0; i++) {
    const item = a.held(p);
    if (item) item.ammo = 30;
    a.input('p', { angle: Math.atan2(b.x - p.x, b.z - p.z), pitch: Math.atan2(b.y + 1.5 - p.y - 1.6, Math.hypot(b.x - p.x, b.z - p.z)), fire: true });
    a.step();
    hits += a.drainEvents().filter((e) => e.type === 'boss-hit').length;
  }
  assert.ok(hits > 10, 'bullets hit the boss');
  assert.equal(b.hp, 0, 'boss defeated');
  const drop = a.bosses.drops[0];
  assert.equal(drop.relic, 'gloves');
  p.cheats.god = false;
  a.place(p, drop.x, drop.z);
  for (let i = 0; i < 70; i++) a.step();
  assert.equal(p.relic?.id, 'gloves');
  a.dispose();
});
test('relics: ring of fire burns, helpers fight for their owner, nova freezes, flashback blinds', () => {
  const a = new Arena({ mode: 'classic' }),
    p = a.addPlayer('p', 'P'),
    q = a.addPlayer('q', 'Q');
  for (const b of a.bosses.list) b.hp = 0;
  a.place(p, 0, 0);
  a.place(q, 3, 0);
  p.shield = q.shield = 0;
  a.bosses.give(p, 'gloves');
  assert.ok(a.bosses.use(p, 0));
  for (let i = 0; i < 60; i++) a.step();
  assert.ok(q.hp < 100, 'ring burns enemies inside');
  assert.ok(!a.bosses.use(p, 0), 'cooldown');
  assert.ok(a.bosses.use(p, 1));
  const helpers = a.players.filter((o) => o.helperOf === 'p');
  assert.equal(helpers.length, 2);
  assert.ok(helpers.every((h) => h.bot && h.team === p.team));
  q.hp = 100;
  a.bosses.give(p, 'heart');
  assert.ok(a.bosses.use(p, 0));
  assert.ok(q.frozen > 0);
  const x = q.x;
  for (let i = 0; i < 30; i++) {
    a.input('q', { x: 1, z: 0 });
    a.step();
  }
  assert.ok(Math.abs(q.x - x) < 0.05, 'frozen players cannot move');
  a.bosses.give(p, 'crown');
  p.angle = Math.atan2(q.x - p.x, q.z - p.z);
  p.pitch = 0;
  assert.ok(a.bosses.use(p, 0));
  assert.equal(q.flashback, 5);
  assert.ok(a.snapshot().players.find((o) => o.id === 'q').flashback > 0);
  for (let i = 0; i < 60 * 26; i++) a.step();
  assert.equal(a.players.filter((o) => o.helperOf).length, 0, 'helpers leave after their time');
  a.dispose();
});
test('portals connect two walls and carry a player through', () => {
  const a = new Arena({ mode: 'classic' }),
    p = a.addPlayer('p', 'P'),
    b1 = a.map.buildings[0],
    b2 = a.map.buildings[5];
  for (const b of a.bosses.list) b.hp = 0;
  a.bosses.give(p, 'portal');
  assert.equal(RELICS.portal.abilities.length, 2);
  a.place(p, b1.x + 3, b1.z + b1.d / 2 + 6);
  p.angle = Math.PI;
  p.pitch = -0.1;
  assert.ok(a.bosses.use(p, 0));
  a.place(p, b2.x + 3, b2.z + b2.d / 2 + 6);
  a.step();
  p.relic.cd = [0, 0];
  assert.ok(a.bosses.use(p, 1));
  let teleported = false;
  for (let i = 0; i < 150 && !teleported; i++) {
    a.input('p', { x: 0, z: -1, angle: Math.PI });
    a.step();
    teleported = a.drainEvents().some((e) => e.type === 'teleport');
  }
  assert.ok(teleported);
  assert.ok(Math.hypot(p.x - (b1.x + 3), p.z - (b1.z + b1.d / 2)) < 2, 'came out of the blue portal');
  a.dispose();
});
test('battle bus: everyone starts aboard, jumps or is dropped, and lands', () => {
  const a = new Arena({ mode: 'royale', bots: 9, bus: true }),
    p = a.addPlayer('p', 'P');
  assert.ok(a.players.every((o) => o.inBus));
  p.cheats.god = true;
  a.input('p', { jump: true });
  a.step();
  assert.ok(!p.inBus && p.dropping);
  for (let i = 0; i < 60 * 40; i++) {
    a.input('p', {});
    a.step();
  }
  assert.ok(!a.bus.active, 'bus left');
  assert.ok(a.players.every((o) => !o.inBus));
  assert.ok(!p.dropping && p.y < 12, 'landed');
  a.dispose();
});
test('lag compensation: an online shooter hits where the target was on their screen', () => {
  const a = new Arena({ mode: 'classic', random: () => 0.5 }),
    p = a.addPlayer('p', 'P'),
    q = a.addPlayer('q', 'Q');
  for (const b of a.bosses.list) b.hp = 0;
  a.place(p, 0, -10);
  a.place(q, 0, 0);
  p.shield = q.shield = 0;
  // q runs sideways; p aims at where q was 150 ms ago.
  for (let i = 0; i < 40; i++) {
    a.input('q', { x: 1, z: 0 });
    a.input('p', { lag: 200, angle: 0 });
    a.step();
  }
  const trail = a.trails.get('q'),
    then = trail[trail.length - 1 - Math.round(0.15 * 60)];
  p.angle = Math.atan2(then.x - p.x, then.z - p.z);
  p.pitch = 0;
  p.lag = 200;
  const before = q.hp;
  a.shoot(p);
  assert.ok(q.hp < before, 'rewound hit lands');
  a.dispose();
});
