import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Arena, initPhysics } from './src/simulation.js';
import { appearance } from './src/cosmetics.js';
import { roomCode } from './src/party.js';
import { decodeLoadout } from './src/items.js';
await initPhysics();
const MAX_ROOMS = Number(process.env.PRIDA_MAX_ROOMS) || 24;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.md': 'text/plain; charset=utf-8',
};
const rooms = new Map();
// Online modes. `royale-city` is the big city (≈ 8× the district) for up to 10 humans plus bots (24 contenders).
const MODES = {
  'royale-city': { mode: 'royale', size: 'city', humans: 10, label: 'Big City Royale' },
  royale: { mode: 'royale', size: 'district', humans: 10, label: 'Mini Royale' },
  duel: { mode: 'duel', size: 'district', humans: 2, label: 'Duel · 1 v 1' },
  classic: { mode: 'classic', size: 'district', humans: 10, label: 'Arena' },
};
const modeKey = (v) => (MODES[v] ? v : 'royale');
// Public matchmaking: a queue room starts by itself (duel: two players; royale: 20 s after the second player
// arrives, at once when full, or with bots after 45 s alone).
const QUEUE_WAIT = { first: 45, more: 20 };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // A build served by this server plays online against it without any configuration.
    if (pathname === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ multiplayerUrl: 'auto', room: 'park' }));
      return;
    }
    if (pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      const m = process.memoryUsage();
      res.end(
        JSON.stringify({
          ok: true,
          game: 'PRIDA',
          rooms: rooms.size,
          players: [...rooms.values()].reduce((n, r) => n + r.clients.size, 0),
          stepMs: +(stats.stepMs / Math.max(1, stats.steps)).toFixed(2),
          worstStepMs: +stats.worstStep.toFixed(1),
          loopLagAvgMs: +stats.lagAvg.toFixed(1),
          loopLagMaxMs: +stats.lagMax.toFixed(0),
          heapMB: Math.round(m.heapUsed / 1e6),
          rssMB: Math.round(m.rss / 1e6),
          uptimeS: Math.round(process.uptime()),
        }),
      );
      stats.lagMax = stats.worstStep = 0;
      return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found. Run npm run build first.');
  }
});
const wss = new WebSocketServer({ server, maxPayload: 8192, perMessageDeflate: false });
const origins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
function group(r) {
  const spec = MODES[r.kind];
  return r.party || r.queue
    ? {
        code: r.code,
        host: r.queue ? null : r.host,
        public: !!r.queue,
        phase: r.phase,
        match: r.match,
        mode: r.kind,
        label: spec.label,
        size: spec.size,
        max: spec.humans,
        contenders: spec.mode === 'royale' ? (spec.size === 'city' ? 24 : 10) : spec.mode === 'duel' ? 2 : 10,
        countdown: r.startAt ? Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) : null,
        members: [...r.clients].map(([id]) => {
          const p = r.sim.players.find((p) => p.id === id);
          return { id, name: p?.name || 'PLAYER' };
        }),
        bots: spec.mode === 'duel' ? 0 : Math.max(0, (spec.mode === 'royale' && spec.size === 'city' ? 24 : 10) - r.clients.size),
      }
    : null;
}
function newRoom(code, kind, { party = false, queue = false } = {}) {
  const seed = [...code].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 91726),
    spec = MODES[kind];
  return {
    code,
    seed,
    kind,
    party,
    queue,
    phase: party || queue ? 'lobby' : 'playing',
    host: null,
    match: 0,
    startAt: 0,
    waitingSince: Date.now(),
    // The lobby only lists players: a small map is enough (the match builds the real one).
    sim: new Arena({ seed, mode: spec.mode === 'duel' ? 'duel' : 'classic', size: 'district' }),
    clients: new Map(),
  };
}
// Numbers go out rounded (centimetres, milliradians): positions and angles need no more, and long decimals
// were most of every packet.
const PRECISE = new Set(['angle', 'pitch']);
function compact(key, v) {
  if (typeof v !== 'number' || Number.isInteger(v)) return v;
  return PRECISE.has(key) ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100;
}
function send(ws, message) {
  // A slow connection skips states instead of queueing them (a queue is what makes ping explode).
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 48000) ws.send(typeof message === 'string' ? message : JSON.stringify(message, compact));
}
// States are shared by the room except for each player's own inventory. Chests and destruction lists only go out
// when they change (and every 2 s as a refresh); clients keep the last copy.
function broadcast(r) {
  const state = r.sim.snapshot(),
    tick = (r.netTick = (r.netTick || 0) + 1),
    refresh = tick % 40 === 0,
    slots = new Map();
  for (const key of ['chests', 'destruction']) {
    const json = JSON.stringify(state[key], compact);
    if (json === r['last_' + key] && !refresh) delete state[key];
    else r['last_' + key] = json;
  }
  for (const p of state.players) {
    slots.set(p.id, p.slots);
    delete p.slots;
    if (r.phase === 'playing') delete p.loadout; // the lobby shows loadouts
  }
  const base = JSON.stringify({ type: 'state', state, events: r.sim.drainEvents(), group: group(r) }, compact).slice(0, -1);
  for (const [id, ws] of r.clients) send(ws, base + ',"self":' + JSON.stringify({ slots: slots.get(id) || null }, compact) + '}');
}
function resetParty(r, start = false) {
  const humans = [...r.clients.keys()].map((id) => r.sim.players.find((p) => p.id === id)).filter(Boolean),
    spec = MODES[r.kind];
  r.sim.dispose();
  r.startAt = 0;
  r.endedAt = 0;
  r.waitingSince = Date.now();
  r.sim = start
    ? new Arena({ seed: r.seed, mode: spec.mode, size: spec.size, bus: spec.mode === 'royale', botEvery: 3 })
    : new Arena({ seed: r.seed, mode: spec.mode === 'duel' ? 'duel' : 'classic', size: 'district' });
  for (const old of humans) {
    const p = r.sim.addPlayer(old.id, old.name);
    p.cosmetics = old.cosmetics;
    // Loadouts are re-validated by the simulation; chest-only weapons can never be chosen.
    r.sim.setLoadout(p, old.loadout);
  }
  if (start) {
    r.match++;
    const total = spec.mode === 'duel' ? humans.length : r.sim.maxPlayers === 24 ? 24 : 10;
    for (let n = humans.length; n < total; n++) {
      // Bots get random operators, finishes and uniform tints from the simulation.
      r.sim.addPlayer('bot' + n, 'BOT ' + (n + 1), true);
    }
    r.phase = 'playing';
  } else r.phase = 'lobby';
  broadcast(r);
}
wss.on('connection', (ws, req) => {
  if (origins.length && !origins.includes(req.headers.origin)) {
    ws.close(1008, 'Origin not allowed');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('signal')) return signalling(ws, url);
  const queueKind = url.searchParams.get('queue'),
    party = url.searchParams.get('party') === '1';
  let key, room;
  if (queueKind) {
    // Quick match: join a waiting public room of that kind, or open a new one.
    const kind = modeKey(queueKind);
    for (const [k, r] of rooms)
      if (r.queue && r.kind === kind && r.phase === 'lobby' && r.clients.size < MODES[kind].humans) {
        key = k;
        break;
      }
    if (!key) {
      if (rooms.size >= MAX_ROOMS) {
        ws.close(1013, 'Server full. Try again in a minute.');
        return;
      }
      const code = kind.toUpperCase().replace('-', '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
      key = 'queue:' + code;
      rooms.set(key, newRoom(code, kind, { queue: true }));
    }
  } else {
    const code = roomCode(url.searchParams.get('room')) || 'PARK';
    key = (party ? 'party:' : 'arena:') + code;
    if (!rooms.has(key)) {
      if (rooms.size >= MAX_ROOMS) {
        ws.close(1013, 'Server full');
        return;
      }
      rooms.set(key, newRoom(code, party ? modeKey(url.searchParams.get('mode')) : 'classic', { party }));
    }
  }
  room = rooms.get(key);
  ws.room = room;
  const cap = room.party || room.queue ? MODES[room.kind].humans : 10;
  if (room.clients.size >= cap) {
    ws.close(1013, `Group full (${cap}/${cap})`);
    return;
  }
  if ((room.party || room.queue) && room.phase === 'playing') {
    ws.close(1008, 'Match in progress. Ask the host to return to the group.');
    return;
  }
  const id = randomUUID(),
    name = (url.searchParams.get('name') || 'PLAYER').replace(/[<>\x00-\x1f]/g, '').slice(0, 16) || 'PLAYER';
  room.clients.set(id, ws);
  if (!room.host) room.host = id;
  const player = room.sim.addPlayer(id, name);
  player.cosmetics = appearance({ operator: url.searchParams.get('operator'), finish: url.searchParams.get('finish') });
  room.sim.setLoadout(player, decodeLoadout(url.searchParams.get('loadout')));
  send(ws, { type: 'welcome', id, state: room.sim.snapshot(), group: group(room) });
  broadcast(room);
  if (room.queue) scheduleQueue(room);
  let rate = 240,
    epoch = Date.now();
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (raw) => {
    ws.alive = true;
    // Token bucket (≈ 90 messages a second, bursts of 240): after a server hiccup a client's queued inputs
    // arrive together, and that must not count as flooding.
    const now = Date.now();
    rate = Math.min(240, rate + ((now - epoch) / 1000) * 90);
    epoch = now;
    if (--rate < 0) {
      ws.close(1008, 'Rate limit');
      return;
    }
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === 'input' && room.phase === 'playing') room.sim.input(id, m.input);
      if (m.type === 'appearance' && room.phase === 'lobby') {
        const p = room.sim.players.find((p) => p.id === id);
        if (p) p.cosmetics = appearance(m.value);
        broadcast(room);
      }
      if (m.type === 'loadout' && room.phase === 'lobby') {
        const p = room.sim.players.find((p) => p.id === id);
        if (p) room.sim.setLoadout(p, decodeLoadout(m.value));
        broadcast(room);
      }
      if (m.type === 'ping') send(ws, { type: 'pong', sent: m.sent });
      if (m.type === 'start' && room.party) {
        if (id !== room.host) {
          send(ws, { type: 'error', message: 'Only the host can start a match.' });
          return;
        }
        if (MODES[room.kind].mode === 'duel' && room.clients.size < 2) {
          send(ws, { type: 'error', message: 'A duel needs two players. Send your friend the invite link.' });
          return;
        }
        if (room.phase === 'lobby' || room.sim.winner !== null) resetParty(room, true);
      }
      if (m.type === 'lobby' && room.party && id === room.host && room.sim.winner !== null) resetParty(room, false);
    } catch {
      ws.close(1008, 'Invalid message');
    }
  });
  ws.on('error', () => {});
  ws.on('close', (code, why) => {
    if (process.env.PRIDA_DEBUG) console.log('close', id, code, String(why));
    room.clients.delete(id);
    if (!room.clients.size) {
      room.sim.dispose();
      rooms.delete(key);
      return;
    }
    if (room.host === id) room.host = room.clients.keys().next().value;
    if (room.queue && room.phase === 'lobby') scheduleQueue(room);
    if ((room.party || room.queue) && room.phase === 'playing') {
      const p = room.sim.players.find((p) => p.id === id);
      if (p) {
        p.bot = true;
        p.name = 'BOT · ' + p.name.slice(0, 10);
        p.input = {};
      }
    } else room.sim.removePlayer(id);
    broadcast(room);
  });
});
// Direct play: the server only introduces browsers. A host registers its group code; guests with that code are
// relayed to it until their WebRTC connection is up (offer / answer / network candidates, a few kilobytes).
const hosts = new Map(); // code -> { ws, guests: Map<gid, ws> }
function signalling(ws, url) {
  const code = roomCode(url.searchParams.get('signal')),
    role = url.searchParams.get('role');
  if (!code) return ws.close(4004, 'No code');
  let budget = 200;
  const allowed = () => --budget >= 0 || (ws.close(1008, 'Too many messages'), false);
  if (role === 'host') {
    if (hosts.has(code)) return ws.close(4001, 'Code in use');
    const entry = { ws, guests: new Map() };
    hosts.set(code, entry);
    const refill = setInterval(() => (budget = Math.min(400, budget + 100)), 10000);
    ws.on('message', (raw) => {
      if (!allowed()) return;
      try {
        const m = JSON.parse(raw.toString()),
          guest = entry.guests.get(m.to);
        if (guest?.readyState === WebSocket.OPEN) guest.send(JSON.stringify({ data: m.data }));
      } catch {}
    });
    ws.on('close', () => {
      clearInterval(refill);
      if (hosts.get(code) === entry) hosts.delete(code);
      for (const g of entry.guests.values()) g.close(4004, 'Host left');
    });
    return;
  }
  const entry = hosts.get(code);
  if (!entry) return ws.close(4004, 'No such group');
  if (entry.guests.size >= 12) return ws.close(1013, 'Too many guests joining');
  const gid = randomUUID();
  entry.guests.set(gid, ws);
  ws.send(JSON.stringify({ type: 'joined', gid }));
  ws.on('message', (raw) => {
    if (!allowed()) return;
    try {
      const m = JSON.parse(raw.toString());
      if (entry.ws.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify({ from: gid, data: m.data }));
    } catch {}
  });
  ws.on('close', () => {
    entry.guests.delete(gid);
    if (entry.ws.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify({ type: 'guest-leave', gid }));
  });
}
function scheduleQueue(r) {
  const spec = MODES[r.kind],
    n = r.clients.size;
  if (spec.mode === 'duel') r.startAt = n >= 2 ? Date.now() + 3000 : 0;
  else if (n >= spec.humans) r.startAt = Date.now() + 3000;
  else if (n >= 2) r.startAt = Math.min(r.startAt || Infinity, Date.now() + QUEUE_WAIT.more * 1000);
  else r.startAt = r.waitingSince + QUEUE_WAIT.first * 1000;
}
// Rooms simulate at 30 Hz: free hosting gives a tenth of a CPU, and going over it stalls the whole server
// (that is what turned into second-long pings). States go out at 20 Hz (15 on the big city).
const stats = { steps: 0, stepMs: 0, worstStep: 0, lagMax: 0, lagAvg: 0, since: Date.now() };
let last = performance.now(),
  acc = 0,
  ticks = 0;
setInterval(() => {
  const now = performance.now(),
    lag = Math.max(0, now - last - 8);
  stats.lagMax = Math.max(stats.lagMax, lag);
  stats.lagAvg = stats.lagAvg * 0.99 + lag * 0.01;
  acc += Math.min((now - last) / 1000, 0.1);
  last = now;
  while (acc >= 1 / 60) {
    if (ticks % 2 === 0)
      for (const r of rooms.values())
        if (r.phase === 'playing') {
          const t0 = performance.now();
          r.sim.step(1 / 30);
          const ms = performance.now() - t0;
          stats.steps++;
          stats.stepMs += ms;
          stats.worstStep = Math.max(stats.worstStep, ms);
        }
    acc -= 1 / 60;
    ticks++;
    for (const r of rooms.values()) if (ticks % (MODES[r.kind]?.size === 'city' ? 4 : 3) === 0) broadcast(r);
  }
  // Matchmaking: start queue rooms on time; after a match, return everyone to the lobby for the next one.
  for (const r of rooms.values()) {
    if (!r.queue) continue;
    if (r.phase === 'lobby' && r.startAt && Date.now() >= r.startAt && r.clients.size >= (MODES[r.kind].mode === 'duel' ? 2 : 1))
      resetParty(r, true);
    else if (r.phase === 'playing' && r.sim.winner !== null) {
      r.endedAt ||= Date.now();
      if (Date.now() - r.endedAt > 12000 && MODES[r.kind].mode !== 'classic') {
        resetParty(r, false);
        scheduleQueue(r);
      }
    }
  }
}, 8);
setInterval(() => {
  for (const ws of wss.clients) {
    // Any message or pong counts as life, so a phone busy compiling shaders at match start is not dropped.
    // Lobbies wait longer (75 s) than matches (30 s), where a silent player is replaced by a bot.
    ws.missed = ws.alive ? 0 : (ws.missed || 0) + 1;
    if (ws.missed >= (ws.room?.phase === 'lobby' ? 5 : 2)) {
      if (process.env.PRIDA_DEBUG) console.log('heartbeat timeout');
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, Number(process.env.PRIDA_HEARTBEAT_MS) || 15000).unref();
const port = Number(process.env.PORT) || 8080;
server.listen(port, '0.0.0.0', () => console.log(`PRIDA ready at http://localhost:${port}`));
