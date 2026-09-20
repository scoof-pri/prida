import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
test('heartbeat keeps a busy client that still sends messages and drops a silent one', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '8104', PRIDA_HEARTBEAT_MS: '200' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      new Promise((_, r) => setTimeout(() => r(Error('start timeout')), 5000)),
    ]);
    // Neither client answers protocol pings (like a starved browser tab).
    const busy = new WebSocket('ws://127.0.0.1:8104?room=beat&name=Busy', { autoPong: false }),
      silent = new WebSocket('ws://127.0.0.1:8104?room=beat&name=Quiet', { autoPong: false });
    let silentClosed = false;
    silent.on('close', () => (silentClosed = true));
    await Promise.all([once(busy, 'open'), once(silent, 'open')]);
    const timer = setInterval(() => busy.send(JSON.stringify({ type: 'ping', sent: 0 })), 150);
    await new Promise((r) => setTimeout(r, 1200));
    clearInterval(timer);
    assert.equal(silentClosed, true, 'silent client dropped after two missed intervals');
    assert.equal(busy.readyState, WebSocket.OPEN, 'client sending messages stays connected');
    busy.close();
  } finally {
    child.kill();
  }
});
