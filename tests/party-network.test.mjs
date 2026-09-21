import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appearance, pack } from '../src/cosmetics.js';
import { once } from 'node:events';
import WebSocket from 'ws';
function message(ws, predicate, timeout = 3000) {
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
test('party host starts two humans plus eight bots; late joins rejected, disconnect becomes a bot, cheats ignored', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '8101' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      new Promise((_, r) => setTimeout(() => r(Error('start timeout')), 5000)),
    ]);
    async function join(name, room = 'royale') {
      const ws = new WebSocket(
        `ws://127.0.0.1:8101?party=1&mode=royale&room=${room}&name=${name}&cos=${encodeURIComponent(pack({ operator: 'hazmat', finish: 'jade' }))}`,
      );
      clients.push(ws);
      ws.on('error', () => {});
      const welcome = await message(ws, (m) => m.type === 'welcome');
      return { ws, ...welcome };
    }
    const a = await join('Host'),
      b = await join('Guest');
    assert.equal(a.group.phase, 'lobby');
    const waiting = await message(a.ws, (m) => m.type === 'state' && m.group.members.length === 2);
    assert.equal(waiting.state.tick, 0);
    assert.equal(waiting.state.players.length, 2);
    const denied = message(b.ws, (m) => m.type === 'error');
    b.ws.send(JSON.stringify({ type: 'start' }));
    assert.match((await denied).message, /host/);
    const started = message(a.ws, (m) => m.type === 'state' && m.group.phase === 'playing');
    a.ws.send(JSON.stringify({ type: 'start' }));
    const match = await started;
    assert.equal(match.state.players.length, 10);
    assert.equal(match.state.players.filter((p) => p.bot).length, 8);
    assert.equal(match.state.mode, 'royale');
    assert.equal(match.group.match, 1);
    const look = appearance(match.state.players.find((p) => p.id === a.id).cosmetics);
    assert.equal(look.finish, 'jade');
    assert.equal(look.operator, 'hazmat');
    a.ws.send(
      JSON.stringify({
        type: 'input',
        input: { x: 0, z: 0, ascend: 1, slot: 2, god: true, cheats: { god: true, infinite: true, flight: true } },
      }),
    );
    const check = await message(a.ws, (m) => m.type === 'state' && m.state.tick > 3);
    assert.deepEqual(check.state.players.find((p) => p.id === a.id).cheats, {
      flight: false,
      infinite: false,
      god: false,
      bazooka: false,
    });
    const late = new WebSocket('ws://127.0.0.1:8101?party=1&room=royale');
    clients.push(late);
    late.on('error', () => {});
    const [code, reason] = await once(late, 'close');
    assert.equal(code, 1008);
    assert.match(reason.toString(), /progress/);
    const after = message(a.ws, (m) => m.type === 'state' && m.group.members.length === 1);
    b.ws.close();
    const disconnected = await after;
    assert.equal(disconnected.state.players.length, 10);
    assert.equal(disconnected.state.players.filter((p) => p.bot).length, 9);
    assert.equal(disconnected.group.host, a.id);
    const c = await join('Original', 'transfer'),
      d = await join('Successor', 'transfer');
    const transfer = message(d.ws, (m) => m.type === 'state' && m.group.host === d.id);
    c.ws.close();
    assert.equal((await transfer).group.host, d.id);
  } finally {
    for (const c of clients) c.terminate();
    child.kill();
  }
});
test('party caps human membership at ten and starts with zero bots when full', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '8102' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      new Promise((_, r) => setTimeout(() => r(Error('start timeout')), 5000)),
    ]);
    for (let i = 0; i < 10; i++) {
      const c = new WebSocket('ws://127.0.0.1:8102?party=1&room=full&name=P' + i);
      clients.push(c);
      c.on('error', () => {});
      await message(c, (m) => m.type === 'welcome');
    }
    const overflow = new WebSocket('ws://127.0.0.1:8102?party=1&room=full');
    clients.push(overflow);
    overflow.on('error', () => {});
    const [code] = await once(overflow, 'close');
    assert.equal(code, 1013);
    const started = message(clients[0], (m) => m.type === 'state' && m.group.phase === 'playing');
    clients[0].send(JSON.stringify({ type: 'start' }));
    const m = await started;
    assert.equal(m.state.players.length, 10);
    assert.equal(m.state.players.filter((p) => p.bot).length, 0);
  } finally {
    for (const c of clients) c.terminate();
    child.kill();
  }
});
