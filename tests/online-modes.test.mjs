import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createWorld, LIMIT } from '../src/world.js';
import { Arena, initPhysics } from '../src/simulation.js';
await initPhysics();
function message(ws, predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', receive);
      reject(Error('message timeout'));
    }, timeout);
    function receive(raw) {
      const m = JSON.parse(raw);
      if (predicate(m)) {
        clearTimeout(timer);
        ws.off('message', receive);
        resolve(m);
      }
    }
    ws.on('message', receive);
  });
}

test('the big city is about eight times the original district and holds every building type', () => {
  const d = createWorld(7),
    c = createWorld(7, 'city'),
    ratio = (c.limit.x * c.limit.z) / (LIMIT.x * LIMIT.z);
  assert.ok(ratio > 7.3 && ratio < 8.7, `area ratio ${ratio.toFixed(2)}`);
  assert.equal(c.size, 'city');
  assert.ok(c.buildings.length > d.buildings.length * 5);
  assert.equal(new Set(c.buildings.map((b) => b.type)).size, 30);
  for (const b of c.buildings) {
    assert.ok(Math.abs(b.x) + b.w / 2 < c.limit.x && Math.abs(b.z) + b.d / 2 < c.limit.z);
  }
  for (const [x, z] of c.spawns) assert.ok(Math.abs(x) < c.limit.x && Math.abs(z) < c.limit.z);
});

test('city royale seats 24 with a wider, slower zone; duels are 1 v 1 to five with respawns', () => {
  const r = new Arena({ size: 'city', mode: 'royale' });
  for (let i = 0; i < 30; i++) r.addPlayer('p' + i, 'P', i > 0);
  assert.equal(r.players.length, 24);
  assert.ok(r.zone.radius > 300 && r.time === 420);
  assert.equal(r.snapshot().size, 'city');
  r.dispose();
  const d = new Arena({ mode: 'duel' }),
    a = d.addPlayer('a', 'A'),
    b = d.addPlayer('b', 'B');
  d.addPlayer('c', 'C');
  assert.equal(d.players.length, 2);
  for (let k = 0; k < 5; k++) {
    b.shield = 0;
    d.damage(a, b, 999);
    for (let t = 0; t < 200 && b.hp <= 0; t++) d.step();
  }
  assert.equal(a.score, 5);
  assert.equal(d.winner, 'a');
  assert.equal(d.snapshot().scoreLimit, 5);
  d.dispose();
});

test('quick match: two players queued for a duel are paired and start; the server hands out its own address', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '8103' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  try {
    await new Promise((resolve) => child.stdout.on('data', (d) => String(d).includes('ready') && resolve()));
    const config = await (await fetch('http://127.0.0.1:8103/config.json')).json();
    assert.equal(config.multiplayerUrl, 'auto');
    const join = async (name) => {
      const ws = new WebSocket(`ws://127.0.0.1:8103/?queue=duel&name=${name}`);
      clients.push(ws);
      const welcome = message(ws, (m) => m.type === 'welcome');
      await once(ws, 'open');
      return { ws, welcome: await welcome };
    };
    const a = await join('ANNA');
    assert.equal(a.welcome.group.public, true);
    assert.equal(a.welcome.group.mode, 'duel');
    assert.equal(a.welcome.group.phase, 'lobby');
    const b = await join('BORIS');
    assert.equal(b.welcome.group.code, a.welcome.group.code, 'paired into the same room');
    const playing = await message(a.ws, (m) => m.type === 'state' && m.group?.phase === 'playing');
    assert.equal(playing.state.mode, 'duel');
    assert.equal(playing.state.players.length, 2);
    assert.ok(playing.state.players.every((p) => !p.bot));
    // A third player gets a fresh duel room.
    const c = await join('CLARA');
    assert.notEqual(c.welcome.group.code, a.welcome.group.code);
  } finally {
    for (const ws of clients) ws.close();
    child.kill();
  }
});
