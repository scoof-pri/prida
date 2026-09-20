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
      res.end(JSON.stringify({ ok: true, game: 'PRIDA', rooms: rooms.size }));
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
const wss = new WebSocketServer({ server, maxPayload: 2048, perMessageDeflate: false });
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
    sim: new Arena({ seed, mode: spec.mode, size: spec.size }),
    clients: new Map(),
  };
}
function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 128000) ws.send(JSON.stringify(message));
}
function broadcast(r) {
  const message = { type: 'state', state: r.sim.snapshot(), events: r.sim.drainEvents(), group: group(r) };
  for (const ws of r.clients.values()) send(ws, message);
}
function resetParty(r, start = false) {
  const humans = [...r.clients.keys()].map((id) => r.sim.players.find((p) => p.id === id)).filter(Boolean),
    spec = MODES[r.kind];
  r.sim.dispose();
  r.startAt = 0;
  r.endedAt = 0;
  r.waitingSince = Date.now();
  r.sim = new Arena({ seed: r.seed, mode: spec.mode, size: spec.size, bus: start && spec.mode === 'royale' });
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
  const url = new URL(req.url, 'http://localhost'),
    queueKind = url.searchParams.get('queue'),
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
  let rate = 0,
    epoch = Date.now();
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (raw) => {
    ws.alive = true;
    if (Date.now() - epoch > 1000) {
      rate = 0;
      epoch = Date.now();
    }
    if (++rate > 90) {
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
function scheduleQueue(r) {
  const spec = MODES[r.kind],
    n = r.clients.size;
  if (spec.mode === 'duel') r.startAt = n >= 2 ? Date.now() + 3000 : 0;
  else if (n >= spec.humans) r.startAt = Date.now() + 3000;
  else if (n >= 2) r.startAt = Math.min(r.startAt || Infinity, Date.now() + QUEUE_WAIT.more * 1000);
  else r.startAt = r.waitingSince + QUEUE_WAIT.first * 1000;
}
// Big-city rooms simulate at 30 Hz (half the work on small servers); everything else at 60 Hz.
const rateOf = (r) => (MODES[r.kind]?.size === 'city' ? 30 : 60);
let last = performance.now(),
  acc = 0,
  ticks = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min((now - last) / 1000, 0.1);
  last = now;
  while (acc >= 1 / 60) {
    for (const r of rooms.values()) if (r.phase === 'playing' && (rateOf(r) === 60 || ticks % 2 === 0)) r.sim.step(rateOf(r) === 60 ? 1 / 60 : 1 / 30);
    acc -= 1 / 60;
    ticks++;
    if (ticks % 3 === 0) for (const r of rooms.values()) broadcast(r);
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
