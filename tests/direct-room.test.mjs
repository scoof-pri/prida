import test from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics } from '../src/simulation.js';
import { Room } from '../src/room.js';
await initPhysics();

test('direct play: the host-side room welcomes members, starts a duel and relays inputs and pings', async () => {
  const room = new Room('ABC123', 'duel'),
    inbox = { a: [], b: [] },
    a = { send: (t) => inbox.a.push(JSON.parse(t)) },
    b = { send: (t) => inbox.b.push(JSON.parse(t)) };
  try {
    const ida = room.join(a, { name: 'Host', loadout: '7.0.2.glider' }).id,
      idb = room.join(b, { name: 'Guest' }).id;
    assert.equal(inbox.a[0].type, 'welcome');
    assert.equal(room.host, ida);
    assert.ok(room.join({ send() {} }, {}).error, 'a duel holds two players');
    room.message(idb, { type: 'start' });
    assert.equal(inbox.b.at(-1).type, 'error', 'only the host starts');
    room.message(ida, { type: 'start' });
    assert.equal(room.phase, 'playing');
    const g = room.sim.players.find((p) => p.id === idb),
      x = g.x;
    for (let i = 0; i < 30; i++) {
      room.message(idb, { type: 'input', input: { x: 1, z: 0, angle: 0 } });
      room.sim.step(1 / 60);
    }
    assert.ok(g.x > x + 1, 'guest input moves the guest');
    room.message(idb, { type: 'ping', sent: 5 });
    assert.deepEqual(inbox.b.at(-1), { type: 'pong', sent: 5 });
    room.broadcast();
    const st = inbox.b.at(-1);
    assert.equal(st.type, 'state');
    assert.ok(Array.isArray(st.self.slots) && st.state.players.every((p) => p.slots === undefined));
    room.leave(idb);
    assert.ok(room.sim.players.find((p) => p.id === idb).bot, 'a leaver becomes a bot mid-match');
  } finally {
    room.close();
  }
});
