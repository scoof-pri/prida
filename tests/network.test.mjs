import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
test('two real WebSocket clients share a room and disconnect cleanly', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '8099' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      new Promise((_, r) => setTimeout(() => r(Error('server start timeout')), 5000)),
    ]);
    const join = (name) =>
      new Promise((resolve, reject) => {
        let c = new WebSocket('ws://127.0.0.1:8099?room=test&name=' + name);
        clients.push(c);
        c.on('error', reject);
        c.on('message', (raw) => {
          let m = JSON.parse(raw);
          if (m.type === 'welcome') resolve({ c, id: m.id });
        });
      });
    let a = await join('Alpha'),
      b = await join('Beta');
    assert.notEqual(a.id, b.id);
    const state = await new Promise((resolve, reject) => {
      let t = setTimeout(() => reject(Error('state timeout')), 2000);
      a.c.on('message', (raw) => {
        let m = JSON.parse(raw);
        if (m.type === 'state' && m.state.players.length === 2) {
          clearTimeout(t);
          resolve(m.state);
        }
      });
    });
    assert.deepEqual(
      state.players.map((p) => p.name),
      ['Alpha', 'Beta'],
    );
    a.c.send(JSON.stringify({ type: 'input', input: { x: 1, z: 0, angle: 0, slot: 2 } }));
    const next = await new Promise((resolve) => {
      a.c.on('message', (raw) => {
        let m = JSON.parse(raw);
        if (m.type === 'state' && m.state.players.find((p) => p.id === a.id)?.weapon === 2) resolve(m.state);
      });
    });
    assert.equal(next.players.find((p) => p.id === a.id).weapon, 2);
    b.c.close();
    await once(b.c, 'close');
    const remaining = await new Promise((resolve) =>
      a.c.on('message', (raw) => {
        let m = JSON.parse(raw);
        if (m.type === 'state' && m.state.players.length === 1) resolve(m.state);
      }),
    );
    assert.equal(remaining.players[0].id, a.id);
  } finally {
    for (const c of clients) c.terminate();
    child.kill();
  }
});
