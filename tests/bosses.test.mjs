import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { BOSSES, RELICS } from '../src/bosses.js';
await initPhysics();

test('the bosses guard lairs in the wild biomes on every map and mode', () => {
  for (const [mode, size] of [['classic', 'district'], ['duel', 'district'], ['royale', 'city']]) {
    const a = new Arena({ mode, size });
    assert.deepEqual(a.bosses.list.map((b) => b.kind).sort(), ['chaos', 'fire', 'might', 'mind', 'void']);
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
  assert.equal(drop.relic, 'ember');
  p.cheats.god = false;
  a.place(p, drop.x, drop.z);
  for (let i = 0; i < 70; i++) a.step();
  assert.equal(p.relic?.id, 'ember');
  a.dispose();
});
test('relics: ring of fire burns, helpers fight, gloves one-shot, the shard tears the map open, flashback blinds', () => {
  const a = new Arena({ mode: 'classic' }),
    p = a.addPlayer('p', 'P'),
    q = a.addPlayer('q', 'Q');
  for (const b of a.bosses.list) b.hp = 0;
  a.place(p, 0, 0);
  a.place(q, 3, 0);
  p.shield = q.shield = 0;
  a.bosses.give(p, 'ember');
  assert.ok(a.bosses.use(p, 0));
  for (let i = 0; i < 60; i++) a.step();
  assert.ok(q.hp < 100, 'ring burns enemies inside');
  assert.ok(!a.bosses.use(p, 0), 'cooldown');
  assert.ok(a.bosses.use(p, 1));
  const helpers = a.players.filter((o) => o.helperOf === 'p');
  assert.equal(helpers.length, 2);
  assert.ok(helpers.every((h) => h.bot && h.team === p.team));
  // TITAN GLOVES: one melee hit is a kill, whatever the blade would have done.
  q.hp = 100;
  q.shield = 0;
  a.place(q, p.x + 1.2, p.z);
  a.bosses.give(p, 'gloves');
  p.angle = Math.atan2(q.x - p.x, q.z - p.z);
  p.pitch = 0;
  p.slot = 0;
  a.syncHeld(p);
  a.melee(p);
  assert.equal(q.hp, 0, 'one-shot melee');
  // CHAOS SHARD: the cataclysm queues a wave of blasts, the line of ruin one corridor of them.
  a.bosses.give(p, 'shard');
  assert.ok(a.bosses.use(p, 0));
  assert.ok(a.bosses.pending.length > 20, 'a cataclysm rolls across the map');
  assert.ok(!a.bosses.use(p, 0), 'only once a match');
  const queued = a.bosses.pending.length;
  assert.ok(a.bosses.use(p, 1));
  assert.ok(a.bosses.pending.length > queued, 'line of ruin queued');
  for (let i = 0; i < 60 * 6; i++) a.step();
  assert.equal(a.bosses.pending.length, 0, 'every queued blast goes off');
  a.bosses.give(p, 'crown');
  q.hp = 100;
  a.place(q, p.x + 6, p.z);
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
test('bots: badly hurt ones break contact and heal, and everyone runs out of a ring of fire', () => {
  const a = new Arena({ mode: 'classic', random: () => 0.5 }),
    bot = a.addPlayer('b1', 'BOT', true),
    foe = a.addPlayer('p', 'P');
  for (const b of a.bosses.list) b.hp = 0;
  a.place(bot, 0, 0);
  a.place(foe, 0, 7);
  bot.shield = foe.shield = 0;
  bot.hp = 25;
  bot.medkits = 1;
  bot.brain.hurtAt = a.tick / 60;
  let retreated = false;
  for (let i = 0; i < 60 * 3 && !retreated; i++) {
    a.step();
    if (bot.brain.mode === 'retreat') retreated = true;
  }
  assert.ok(retreated, 'the bot pulled back');
  // With the enemy gone it patches itself up.
  foe.hp = 0;
  let healed = false;
  for (let i = 0; i < 60 * 12 && !healed; i++) {
    a.step();
    if (bot.hp > 25) healed = true;
  }
  assert.ok(healed, 'and used its medkit');
  // A ring of fire under a bot sends it running out of the flames.
  const runner = a.addPlayer('b2', 'BOT2', true);
  a.place(runner, 20, 20);
  runner.hp = 100;
  a.bosses.hazards.push({ id: 1, kind: 'ring', x: 20, z: 20, y: runner.y, r: 6, time: 5, max: 5, owner: 'p', team: 'p:p', dps: 20 });
  for (let i = 0; i < 90; i++) a.step();
  assert.ok(Math.hypot(runner.x - 20, runner.z - 20) > 4, 'it left the fire');
  a.dispose();
});
