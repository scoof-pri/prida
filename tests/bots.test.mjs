import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { lineClear } from '../src/world.js';
await initPhysics();
function place(a, p, x, z, y = 0.02) {
  Object.assign(p, { x, z, y, shield: 0, cooldown: 0, vy: 0 });
  const body = a.bodies.get(p.id).body;
  body.setTranslation({ x, y: y + 0.84, z }, true);
  body.setNextKinematicTranslation({ x, y: y + 0.84, z });
  a.world.step();
}
test('bots form squads with no friendly fire; humans are always on their own', () => {
  const a = new Arena({ bots: 9, mode: 'royale' }),
    p = a.addPlayer('p', 'P'),
    bots = a.players.filter((o) => o.bot);
  assert.equal(new Set(bots.map((b) => b.team)).size, 5, 'Mini Royale bot duos');
  const [x, y] = bots.filter((b) => b.team === bots[0].team);
  x.shield = y.shield = 0;
  a.damage(x, y, 50);
  assert.equal(y.hp, 80, 'squadmates cannot hurt each other');
  assert.ok(!a.enemies(x).includes(y) && a.enemies(x).includes(p));
  const c = new Arena({ bots: 16 });
  assert.equal(new Set(c.players.map((b) => b.team)).size, 6, 'Training squads of three');
  const s = new Arena({ bots: 16, mode: 'survival' });
  assert.equal(new Set(s.players.map((b) => b.team)).size, 1);
  assert.ok(new Set(s.players.map((b) => b.squad)).size > 1);
  a.dispose();
  c.dispose();
  s.dispose();
});
test('bots wear randomised operators, finishes and uniform tints', () => {
  const a = new Arena({ bots: 16 }),
    looks = new Set(a.players.map((b) => JSON.stringify(b.cosmetics)));
  assert.ok(looks.size >= 10, `${looks.size} distinct looks`);
  for (const b of a.players) assert.ok(Number.isInteger(b.cosmetics.tint));
  a.dispose();
});
test('a hurt bot under fire picks a reachable cover spot hidden from its attacker', () => {
  const a = new Arena({ random: () => 0.3 }),
    bot = a.addPlayer('bot1', 'B', true),
    enemy = a.addPlayer('e', 'E'),
    car = a.map.obstacles.find((o) => o.part === 'car' && Math.abs(o.x) < 80 && Math.abs(o.z) < 70);
  const along = car.w > car.d ? 'x' : 'z';
  // Bot beside the car, enemy out in the open on the other side of the road.
  const off = along === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 },
    reach = (along === 'x' ? car.d : car.w) / 2;
  place(a, bot, car.x + off.x * (reach + 2.5), car.z + off.z * (reach + 2.5));
  place(a, enemy, car.x + off.x * (reach + 12), car.z + off.z * (reach + 12));
  const spot = a.findCover(bot, enemy);
  assert.ok(spot, 'found cover');
  assert.equal(lineClear(enemy, spot, 0, a.map.obstacles), false, 'hidden from the enemy');
  assert.ok(Math.hypot(spot.x - bot.x, spot.z - bot.z) < 14);
  a.dispose();
});
test('a squad shares a sighting with mates who cannot see the enemy', () => {
  const a = new Arena({ bots: 3 }),
    [x, y] = a.players,
    e = a.addPlayer('e', 'E');
  assert.equal(x.squad, y.squad);
  place(a, x, 0, 0);
  place(a, y, 0, -30);
  place(a, e, 0, 10);
  x.angle = 0;
  y.brain.memory = 0;
  a.botInput(x, 1 / 60);
  assert.ok(x.brain.targetId === 'e');
  assert.ok(y.brain.memory > 0 && Math.hypot(y.brain.lastSeen.x - e.x, y.brain.lastSeen.z - e.z) < 0.01);
  a.dispose();
});
test('Mini Royale ends when one squad is left and bots actually take cover and loot', () => {
  const a = new Arena({ bots: 9, mode: 'royale', seed: 91726 });
  let covered = 0,
    looted = 0,
    t = 0;
  while (a.winner === null && t < 60 * 300) {
    a.step();
    t++;
    for (const e of a.drainEvents()) if (e.type === 'loot') looted++;
    if (t % 30 === 0) covered += a.players.filter((p) => p.hp > 0 && p.brain.mode === 'cover').length;
  }
  assert.notEqual(a.winner, null, 'match finished');
  const survivors = a.players.filter((p) => p.hp > 0);
  assert.ok(new Set(survivors.map((p) => p.team)).size <= 1);
  assert.ok(looted > 0, 'bots opened chests');
  assert.ok(covered > 0, 'bots used cover');
  a.dispose();
});
test('a bot with a full inventory does not loop swapping a dropped weapon back and forth', () => {
  const a = new Arena({ mode: 'royale', random: () => 0.4 }),
    bot = a.addPlayer('bot1', 'B', true);
  bot.slots = [bot.slots[0], { w: 0, r: 0, ammo: 1, reserve: 1 }, { w: 2, r: 0, ammo: 1, reserve: 1 }, { w: 3, r: 0, ammo: 1, reserve: 1 }, { w: 1, r: 0, ammo: 1, reserve: 1 }];
  a.dropLoot(bot.x + 0.5, bot.z, { loot: { w: 12, r: 2, ammo: 5, reserve: 5 } });
  for (let i = 0; i < 240; i++) a.step();
  assert.ok(a.chests.filter((c) => c.kind === 'drop').length <= 4, 'no drop spam');
  a.dispose();
});
