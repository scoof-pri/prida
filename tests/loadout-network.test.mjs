import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
function message(ws, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('message timeout')), timeout);
    ws.on('message', function receive(raw) {
      const m = JSON.parse(raw);
      if (predicate(m)) {
        clearTimeout(timer);
        ws.off('message', receive);
        resolve(m);
      }
    });
  });
}
test('server applies a valid loadout, rejects chest-only weapons and keeps loadouts across a party start', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '8103' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      new Promise((_, r) => setTimeout(() => r(Error('start timeout')), 5000)),
    ]);
    const join = async (name, loadout) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:8103?party=1&mode=royale&room=kit${Date.now() % 1e5}&name=${name}&loadout=${loadout}`,
      );
      clients.push(ws);
      const welcome = await message(ws, (m) => m.type === 'welcome');
      return { ws, id: welcome.id, welcome };
    };
    const a = await join('Ace', '9.3.16.jetpack');
    const me = a.welcome.state.players.find((p) => p.id === a.id);
    assert.deepEqual(me.loadout, { melee: 9, primary: 3, secondary: 16, gear: 'jetpack' });
    assert.deepEqual(
      me.slots.slice(0, 3).map((s) => s.w),
      [9, 3, 16],
    );
    // Forged: rocket launcher as primary, sniper as secondary, unknown gear.
    a.ws.send(JSON.stringify({ type: 'loadout', value: '9.6.5.cape' }));
    const forged = await message(
      a.ws,
      (m) => m.type === 'state' && m.state.players.find((p) => p.id === a.id)?.loadout.primary === 0,
    );
    const p = forged.state.players.find((p) => p.id === a.id);
    assert.deepEqual(
      p.loadout,
      { melee: 9, primary: 0, secondary: 2, gear: 'glider' },
      'invalid fields fall back to defaults',
    );
    a.ws.send(JSON.stringify({ type: 'loadout', value: '8.1.10.none' }));
    await message(a.ws, (m) => m.type === 'state' && m.state.players.find((p) => p.id === a.id)?.loadout.melee === 8);
    a.ws.send(JSON.stringify({ type: 'start' }));
    const started = await message(a.ws, (m) => m.type === 'state' && m.group?.phase === 'playing');
    const q = started.state.players.find((p) => p.id === a.id);
    assert.deepEqual(
      q.slots.slice(0, 3).map((s) => s.w),
      [8, 1, 10],
    );
    assert.equal(q.gear, null);
    assert.equal(started.state.players.length, 10);
  } finally {
    for (const c of clients) c.close();
    child.kill();
  }
});
