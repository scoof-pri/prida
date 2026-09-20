// A private group hosted inside a player's browser (direct / peer-to-peer play). It mirrors the server's party
// rooms: the same messages (welcome, state, pong, error) go to every member, whether they are the host itself
// (a loopback connection) or friends connected over WebRTC. The simulation runs on the host's computer, so
// there is no free-tier server CPU in the way and friends talk to the host directly.
import { Arena } from './simulation.js';
import { appearance } from './cosmetics.js';
import { decodeLoadout } from './items.js';

export const ROOM_MODES = {
  'royale-city': { mode: 'royale', size: 'city', humans: 10, label: 'Big City Royale' },
  royale: { mode: 'royale', size: 'district', humans: 10, label: 'Mini Royale' },
  duel: { mode: 'duel', size: 'district', humans: 2, label: 'Duel · 1 v 1' },
  classic: { mode: 'classic', size: 'district', humans: 10, label: 'Arena' },
};
const PRECISE = new Set(['angle', 'pitch']);
function compact(key, v) {
  if (typeof v !== 'number' || Number.isInteger(v)) return v;
  return PRECISE.has(key) ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100;
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export class Room {
  constructor(code, kind = 'royale') {
    this.code = code;
    this.kind = ROOM_MODES[kind] ? kind : 'royale';
    this.seed = [...code].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 91726);
    this.phase = 'lobby';
    this.host = null;
    this.match = 0;
    this.clients = new Map(); // id -> { send(text) }
    this.sim = this.lobbySim();
    this.tick = 0;
    this.acc = 0;
    this.last = performance.now();
    this.timer = setInterval(() => this.update(), 8);
  }
  get spec() {
    return ROOM_MODES[this.kind];
  }
  lobbySim() {
    return new Arena({ seed: this.seed, mode: this.spec.mode === 'duel' ? 'duel' : 'classic', size: 'district' });
  }
  group() {
    const spec = this.spec,
      contenders = spec.mode === 'royale' ? (spec.size === 'city' ? 24 : 10) : spec.mode === 'duel' ? 2 : 10;
    return {
      code: this.code,
      host: this.host,
      public: false,
      direct: true,
      phase: this.phase,
      match: this.match,
      mode: this.kind,
      label: spec.label,
      size: spec.size,
      max: spec.humans,
      contenders,
      countdown: null,
      members: [...this.clients.keys()].map((id) => ({ id, name: this.sim.players.find((p) => p.id === id)?.name || 'PLAYER' })),
      bots: spec.mode === 'duel' ? 0 : Math.max(0, contenders - this.clients.size),
    };
  }
  send(conn, message) {
    conn.send(typeof message === 'string' ? message : JSON.stringify(message, compact));
  }
  // Returns an error text, or the new member's id.
  join(conn, params = {}) {
    if (this.clients.size >= this.spec.humans) return { error: `Group full (${this.spec.humans}/${this.spec.humans})` };
    if (this.phase === 'playing') return { error: 'Match in progress. Ask the host to return to the group.' };
    const id = newId(),
      name = String(params.name || 'PLAYER').replace(/[<>\x00-\x1f]/g, '').slice(0, 16) || 'PLAYER';
    this.clients.set(id, conn);
    this.host ||= id;
    const p = this.sim.addPlayer(id, name);
    p.cosmetics = appearance({ operator: params.operator, finish: params.finish });
    this.sim.setLoadout(p, decodeLoadout(params.loadout));
    this.send(conn, { type: 'welcome', id, state: this.sim.snapshot(), group: this.group() });
    this.broadcast();
    return { id };
  }
  leave(id) {
    if (!this.clients.delete(id)) return;
    if (this.host === id) this.host = this.clients.keys().next().value || null;
    const p = this.sim.players.find((p) => p.id === id);
    if (this.phase === 'playing' && p) {
      p.bot = true;
      p.name = 'BOT · ' + p.name.slice(0, 10);
      p.input = {};
    } else this.sim.removePlayer(id);
    this.broadcast();
  }
  message(id, m) {
    const conn = this.clients.get(id);
    if (!conn || !m || typeof m !== 'object') return;
    const p = this.sim.players.find((p) => p.id === id);
    if (m.type === 'input' && this.phase === 'playing') this.sim.input(id, m.input);
    else if (m.type === 'ping') this.send(conn, { type: 'pong', sent: m.sent });
    else if (m.type === 'appearance' && this.phase === 'lobby' && p) {
      p.cosmetics = appearance(m.value);
      this.broadcast();
    } else if (m.type === 'loadout' && this.phase === 'lobby' && p) {
      this.sim.setLoadout(p, decodeLoadout(m.value));
      this.broadcast();
    } else if (m.type === 'start') {
      if (id !== this.host) return this.send(conn, { type: 'error', message: 'Only the host can start a match.' });
      if (this.spec.mode === 'duel' && this.clients.size < 2)
        return this.send(conn, { type: 'error', message: 'A duel needs two players. Send your friend the group code.' });
      if (this.phase === 'lobby' || this.sim.winner !== null) this.reset(true);
    } else if (m.type === 'lobby' && id === this.host && this.sim.winner !== null) this.reset(false);
  }
  reset(start) {
    const humans = [...this.clients.keys()].map((id) => this.sim.players.find((p) => p.id === id)).filter(Boolean),
      spec = this.spec;
    this.sim.dispose();
    this.sim = start ? new Arena({ seed: this.seed, mode: spec.mode, size: spec.size, bus: spec.mode === 'royale' }) : this.lobbySim();
    for (const old of humans) {
      const p = this.sim.addPlayer(old.id, old.name);
      p.cosmetics = old.cosmetics;
      this.sim.setLoadout(p, old.loadout);
    }
    if (start) {
      this.match++;
      const total = spec.mode === 'duel' ? humans.length : this.sim.maxPlayers === 24 ? 24 : 10;
      for (let n = humans.length; n < total; n++) this.sim.addPlayer('bot' + n, 'BOT ' + (n + 1), true);
      this.phase = 'playing';
    } else this.phase = 'lobby';
    this.lastJson = {};
    this.broadcast();
  }
  // Same packet format as the server: shared state, own inventory in `self`, chests / destruction only on change.
  broadcast() {
    const state = this.sim.snapshot(),
      tick = (this.netTick = (this.netTick || 0) + 1),
      slots = new Map();
    this.lastJson ||= {};
    for (const key of ['chests', 'destruction']) {
      const json = JSON.stringify(state[key], compact);
      if (json === this.lastJson[key] && tick % 30) delete state[key];
      else this.lastJson[key] = json;
    }
    for (const p of state.players) {
      slots.set(p.id, p.slots);
      delete p.slots;
      if (this.phase === 'playing') delete p.loadout;
    }
    const base = JSON.stringify({ type: 'state', state, events: this.sim.drainEvents(), group: this.group() }, compact).slice(0, -1);
    for (const [id, conn] of this.clients) this.send(conn, base + ',"self":' + JSON.stringify({ slots: slots.get(id) || null }, compact) + '}');
  }
  // 60 simulation steps and 30 states a second, on the host's computer.
  update() {
    const now = performance.now();
    this.acc += Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60;
      this.tick++;
      if (this.phase === 'playing') this.sim.step(1 / 60);
      if (this.tick % 2 === 0) this.broadcast();
    }
  }
  close() {
    clearInterval(this.timer);
    this.sim.dispose();
    this.clients.clear();
  }
}
