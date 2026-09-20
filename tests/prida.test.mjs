import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Arena, initPhysics } from '../src/simulation.js';
import { WEAPONS } from '../src/catalog.js';
import { freshProfile, readProfile, buyOrEquip, rewardMatch, appearance } from '../src/cosmetics.js';
import { roomCode, inviteURL, validEndpoint } from '../src/party.js';
await initPhysics();
function place(a, p, x, y, z) {
  Object.assign(p, { x, y, z, vy: 0 });
  const b = a.bodies.get(p.id).body;
  b.setTranslation({ x, y: y + 0.84, z }, true);
  b.setNextKinematicTranslation({ x, y: y + 0.84, z });
  a.world.step();
}
test('royale has ten contenders, one life, no score victory and a final survivor', () => {
  const a = new Arena({ mode: 'royale', bots: 9 });
  try {
    const p = a.addPlayer('p', 'P');
    assert.equal(a.players.length, 10);
    assert.equal(a.addPlayer('overflow', 'No'), undefined);
    p.score = 10;
    a.step();
    assert.equal(a.winner, null);
    const b = a.players[0];
    b.shield = 0;
    a.damage(p, b, 100);
    for (let i = 0; i < 240; i++) a.step();
    assert.equal(b.hp, 0);
    assert.equal(a.players.length, 10);
    assert.ok(a.chests.some((c) => c.kind === 'drop' && Math.hypot(c.x - b.x, c.z - b.z) < 0.01));
    for (const bot of a.players.filter((p) => p.bot)) {
      bot.shield = 0;
      a.damage(p, bot, 1000);
    }
    a.step();
    assert.equal(a.winner, p.id);
    const round = a.round;
    for (let i = 0; i < 500; i++) a.step();
    assert.equal(a.round, round);
  } finally {
    a.dispose();
  }
});
test('storm closes over time and damages a player outside the safe area', () => {
  const a = new Arena({ mode: 'royale' });
  try {
    const p = a.addPlayer('p', 'P'),
      q = a.addPlayer('q', 'Q');
    place(a, p, 100, 0.02, 0);
    place(a, q, 0, 0.02, 0);
    p.shield = q.shield = 0;
    a.time = 60;
    for (let i = 0; i < 60; i++) a.step();
    assert.ok(a.zone.radius < a.zoneStart * 0.3);
    assert.ok(p.hp < 95);
    assert.equal(q.hp, 100);
    assert.ok(a.snapshot().zone.radius > 0);
  } finally {
    a.dispose();
  }
});
test('solo cheats fly with collisions, keep ammunition and prevent damage; disabling flight lands', () => {
  const a = new Arena({ allowCheats: true });
  try {
    const p = a.addPlayer('p', 'P');
    place(a, p, 0, 0.02, 0);
    assert.ok(a.setCheat('p', 'flight', true));
    for (let i = 0; i < 60; i++) {
      a.input('p', { x: 0, z: 0, ascend: 1, weapon: 0 });
      a.step();
    }
    assert.ok(p.y > 7 && p.y < 9);
    const y = p.y;
    for (let i = 0; i < 20; i++) {
      a.input('p', { x: 0, z: 0, ascend: 0, weapon: 0 });
      a.step();
    }
    assert.ok(Math.abs(p.y - y) < 0.03);
    a.setCheat('p', 'flight', false);
    for (let i = 0; i < 180; i++) {
      a.input('p', { x: 0, z: 0, weapon: 0 });
      a.step();
    }
    assert.ok(p.y < 0.1);
    a.setCheat('p', 'infinite', true);
    p.slots[1].ammo = 0;
    p.slots[1].reserve = 0;
    for (let i = 0; i < 180; i++) {
      a.input('p', { slot: 1, fire: true });
      a.step();
    }
    assert.equal(p.slots[1].ammo, WEAPONS[0].mag);
    assert.ok(p.shot > 10);
    a.setCheat('p', 'god', true);
    p.shield = 0;
    a.damage(null, p, 1000);
    assert.equal(p.hp, 100);
    a.setCheat('p', 'god', false);
    a.damage(null, p, 20);
    assert.equal(p.hp, 80);
    assert.equal(a.cheated, true);
  } finally {
    a.dispose();
  }
});
test('authoritative arenas reject cheats and ignore forged cheat fields in input', () => {
  const a = new Arena();
  try {
    const p = a.addPlayer('p', 'P');
    assert.equal(a.setCheat('p', 'god', true), false);
    a.input('p', { ascend: 1, cheats: { flight: true, god: true, infinite: true }, god: true });
    a.step();
    assert.deepEqual(p.cheats, { flight: false, god: false, infinite: false, bazooka: false });
    assert.equal(a.cheated, false);
  } finally {
    a.dispose();
  }
});
test('cosmetics purchase once, persist, equip and never grant rewards for sandbox play', () => {
  const p = freshProfile();
  assert.ok(buyOrEquip(p, 'gold'));
  assert.equal(p.coins, 50);
  assert.ok(buyOrEquip(p, 'gold'));
  assert.equal(p.coins, 50);
  assert.equal(buyOrEquip(p, 'hazmat'), false);
  assert.equal(rewardMatch(p, { kills: 5, win: true, seconds: 30, cheated: true }), 0);
  assert.equal(rewardMatch(p, { kills: 5, win: true, seconds: 30 }), 180);
  assert.ok(buyOrEquip(p, 'hazmat'));
  const restored = readProfile(JSON.stringify(p));
  assert.deepEqual(restored, p);
  assert.deepEqual(readProfile('{broken'), freshProfile());
  assert.deepEqual(appearance({ operator: 'evil', finish: 'evil' }), { operator: 'soldier', finish: 'standard' });
});
test('invites encode room and server, sanitize codes, and reject unsafe protocols', () => {
  const url = inviteURL('https://game.example/play?old=1#x', 'abc123', 'wss://match.example/ws');
  const u = new URL(url);
  assert.equal(u.searchParams.get('party'), 'ABC123');
  assert.equal(u.searchParams.get('server'), 'wss://match.example/ws');
  assert.equal(roomCode('<script>?!'), 'SCRIPT');
  assert.throws(() => validEndpoint('javascript:alert(1)'));
  assert.throws(() => validEndpoint('ws://host', true));
  assert.throws(() => validEndpoint('wss://user:pass@host'));
  assert.equal(validEndpoint('wss://host', true).hostname, 'host');
});
test('all shipped interface and building signs are English and author credit matches', async () => {
  for (const file of ['index.html', 'src/main.js', 'src/catalog.js', 'src/assets.js']) {
    const s = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.equal(/[А-Яа-яЁё]/.test(s), false, file);
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('made by mark pridachin'));
  assert.ok(html.includes('<title>PRIDA'));
});
