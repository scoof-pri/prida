import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, lineClear } from '../src/world.js';
import { Navigation } from '../src/navigation.js';
import { Arena, initPhysics } from '../src/simulation.js';
await initPhysics();
function place(a, p, x, z) {
  p.x = x;
  p.z = z;
  p.y = 0.02;
  p.vy = 0;
  p.grounded = true;
  p.shield = 0;
  p.cooldown = 0;
  const body = a.bodies.get(p.id).body;
  body.setTranslation({ x, y: 0.86, z }, true);
  body.setNextKinematicTranslation({ x, y: 0.86, z });
  a.world.step();
}
function tick(a, p, input, n) {
  for (let i = 0; i < n; i++) {
    a.input(p.id, { angle: 0, weapon: 0, ...input });
    a.step();
  }
}
test('generation is repeatable and varies by seed, with thirty building types', () => {
  assert.deepEqual(createWorld(23), createWorld(23));
  assert.notDeepEqual(createWorld(23).buildings, createWorld(24).buildings);
  for (let seed = 1; seed <= 20; seed++) {
    const m = createWorld(seed);
    assert.equal(m.buildings.length, 38);
    assert.equal(new Set(m.buildings.map((b) => b.type)).size, 30);
    for (const b of m.buildings) {
      assert.ok(Math.abs(b.x) + b.w / 2 < m.limit.x);
      assert.ok(Math.abs(b.z) + b.d / 2 < m.limit.z);
      assert.ok(lineClear({ x: b.x, z: b.z - b.d / 2 - 1 }, { x: b.x, z: b.z + b.d / 2 + 1 }, 0.4, m.obstacles));
    }
  }
});
test('navigation reaches every building interior across several generated maps', () => {
  for (const seed of [1, 91726, 4444]) {
    const m = createWorld(seed),
      nav = new Navigation(m);
    for (const b of m.buildings)
      assert.ok(nav.path({ x: 0, z: 0 }, { x: b.x, z: b.z }).length > 0, `seed ${seed} building ${b.id}`);
  }
});
test('character physically enters and exits both doorways', () => {
  const a = new Arena({ seed: 1 }),
    p = a.addPlayer('p', 'P'),
    b = a.map.buildings[0];
  place(a, p, b.x, b.z + b.d / 2 + 1.5);
  tick(a, p, { z: -1 }, Math.ceil(((b.d + 3) / 5.8) * 60));
  assert.ok(p.z < b.z - b.d / 2 - 0.8, `stopped at ${p.z}`);
  assert.ok(Math.abs(p.x - b.x) < 0.1);
  a.dispose();
});
test('jump leaves ground and lands; holding jump does not auto-repeat', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  place(a, p, 0, 0);
  tick(a, p, {}, 10);
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    tick(a, p, { jump: true }, 1);
    peak = Math.max(peak, p.y);
  }
  assert.ok(peak > 1 && peak < 1.7, `peak ${peak}`);
  assert.ok(p.y < 0.06 && p.grounded);
  tick(a, p, { jump: false }, 1);
  tick(a, p, { jump: true }, 1);
  assert.ok(p.vy > 0);
  a.dispose();
});
test('sprinting is faster and consumes stamina, resting restores it', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P');
  place(a, p, 0, 0);
  tick(a, p, { z: 1 }, 60);
  const walk = p.z;
  place(a, p, 0, 0);
  tick(a, p, { z: 1, sprint: true }, 60);
  assert.ok(p.z > walk * 1.4);
  assert.ok(p.stamina < 80);
  const spent = p.stamina;
  tick(a, p, {}, 60);
  assert.ok(p.stamina > spent);
  a.dispose();
});
test('survival bots never respawn and victory waits for all bots', () => {
  const a = new Arena({ bots: 2, mode: 'survival', random: () => 0.5 }),
    p = a.addPlayer('you', 'YOU');
  const [b, c] = a.players;
  b.hp = 0;
  b.respawn = 0;
  a.botInput = () => ({ x: 0, z: 0, angle: 0, weapon: 0, fire: false });
  tick(a, p, {}, 240);
  assert.equal(b.hp, 0);
  assert.equal(a.winner, null);
  c.hp = 0;
  a.step();
  assert.equal(a.winner, p.id);
  for (let i = 0; i < 600; i++) a.step();
  assert.equal(b.hp, 0);
  assert.equal(a.winner, p.id);
  a.dispose();
});
test('survival remains active with a living bot and does not respawn a dead player', () => {
  const a = new Arena({ bots: 2, mode: 'survival' }),
    p = a.addPlayer('you', 'YOU');
  a.players[0].hp = 0;
  tick(a, p, {}, 1);
  assert.equal(a.winner, null);
  p.hp = 0;
  tick(a, p, {}, 1);
  assert.equal(a.winner, 'bots');
  for (let i = 0; i < 600; i++) a.step();
  assert.equal(p.hp, 0);
  assert.equal(a.round, 1);
  a.dispose();
});
test('bots take time to react and do not see targets through walls', () => {
  const a = new Arena({ random: () => 0.5 }),
    bot = a.addPlayer('b', 'BOT', true),
    p = a.addPlayer('p', 'P');
  place(a, bot, 0, 0);
  place(a, p, 0, 10);
  bot.angle = 0;
  for (let i = 0; i < 40; i++) assert.equal(a.botInput(bot, 1 / 60).fire, false);
  const b = a.map.buildings[0];
  place(a, bot, b.x - b.w / 2 - 1, b.z);
  place(a, p, b.x + b.w / 2 + 1, b.z);
  bot.angle = Math.PI / 2;
  assert.equal(a.sight(bot, p), false);
  a.dispose();
});
test('jumping player cannot pass through a doorway lintel', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P'),
    b = a.map.buildings.find((b) => b.type !== 'warehouse');
  place(a, p, b.x, b.z + b.d / 2 - 0.2);
  tick(a, p, {}, 10);
  let top = 0;
  for (let i = 0; i < 60; i++) {
    tick(a, p, { jump: true }, 1);
    top = Math.max(top, p.y + 1.68);
  }
  assert.ok(top < 2.66 && top > 2.5, `top ${top}`);
  a.dispose();
});
