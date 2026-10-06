import { prepareEntities, entityDeltaPacket, EntityDeltaMirror } from './entity-delta.js';
// Online play at a playable ping (0.28). Shared by the server (server.mjs), the browser host of a direct group
// (room.js) and the client (main.js):
//  - NetFeed: what each connection receives. The shared state goes out slimmed (player fields at their defaults
//    are left out, chest contents stay on the server); chests and destruction go as deltas against what that
//    connection has already been sent, so a packet stays small however much has been looted or blown up. A packet
//    that could not be sent is simply not committed, and the next one carries the difference.
//  - Mirror: the client side of that (rebuilds full chests and destruction from the deltas).
//  - Interpolator: other players, bosses and projectiles are shown a little in the past, between two states, so
//    they move smoothly at 20–30 states a second instead of jumping.
//  - Predictor: your own movement is simulated at once from your inputs and corrected by the server's position,
//    replaying the inputs it has not seen yet (it acknowledges them by sequence number).
import { castMap } from './raycast.js';
import { groundHeight } from './terrain.js';

// Numbers go out rounded (centimetres, milliradians).
const PRECISE = new Set(['angle', 'pitch']);
export function compact(key, v) {
  if (typeof v !== 'number' || Number.isInteger(v)) return v;
  return PRECISE.has(key) ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100;
}
// Player fields a client may receive as "missing" when they are false, null or zero: every use reads them as
// flags or with `> 0`, so undefined behaves the same. (hp, score, stamina, armor… always go out.)
const OPTIONAL = new Set([
  'bot', 'gliding', 'thrusting', 'sprinting', 'inBus', 'dropping', 'launched', 'grounded', 'using', 'regen', 'relic',
  'gear', 'armorTier', 'push', 'rush', 'stim', 'blinded', 'emote', 'healing', 'reload', 'cooldown', 'shield', 'spin',
  'frozen', 'webbed', 'flashback', 'portalCd', 'shot', 'moving', 'helperOf', 'dummy', 'dashCd', 'rarity',
]);
export function slimPlayer(p) {
  const out = {};
  for (const k in p) {
    const v = p[k];
    if (OPTIONAL.has(k) && (v === false || v === null || v === 0 || v === undefined)) continue;
    if (k === 'cheats' && v && !Object.values(v).some(Boolean)) continue;
    if (k === 'loadout' || k === 'squad') continue;
    out[k] = v;
  }
  // `grounded` false is meaningful (in the air): send it as `air`.
  if (!p.grounded) out.air = 1;
  delete out.grounded;
  return out;
}
// What a client needs of a chest: where it is, its tier and whether it is open; a drop also shows what it holds.
function slimChest(c) {
  if (c.kind === 'drop') return { id: c.id, kind: 'drop', x: c.x, y: c.y, z: c.z, loot: c.loot, ammo: c.ammo, gear: c.gear, plate: c.plate, medkits: c.medkits };
  const o = { id: c.id, x: c.x, y: c.y, z: c.z, tier: c.tier, opened: c.opened };
  if (c.high) o.high = true;
  return o;
}
const LISTS = ['panels', 'decor', 'buildings', 'wrecks', 'props', 'roofs'],
  MAPS = ['cells', 'storeys'];

export class NetFeed {
  constructor() {
    this.seen = new Map(); // connection id -> what it has been sent
    this.entitySequence037 = 0;
  }
  forget(id) {
    this.seen.delete(id);
  }
  // A new round (a new simulation): everyone gets everything again.
  reset() {
    this.seen.clear();
  }
  // Everything shared by this broadcast, computed once. `snapshot` is a fresh sim.snapshot() (it is changed).
  frame(snapshot, { phase = 'playing', st = Date.now() } = {}) {
    const chests = new Map();
    for (const c of snapshot.chests || []) if (!(c.kind === 'drop' && c.opened)) chests.set(c.id, JSON.stringify(slimChest(c), compact));
    const destruction = snapshot.destruction || {};
    delete snapshot.chests;
    delete snapshot.destruction;
    const slots = new Map();
    snapshot.players = (snapshot.players || []).map((p) => {
      slots.set(p.id, p.slots);
      const s = slimPlayer(p);
      delete s.slots;
      if (phase === 'lobby') s.loadout = p.loadout;
      return s;
    });
    snapshot.st = st;
    const entities = prepareEntities(snapshot, ++this.entitySequence037, compact);
    return { snapshot, chests, destruction, slots, entities, json: JSON.stringify(snapshot, compact).slice(0, -1) };
  }
  // The packet for one connection: {text, commit, reliable}. Call commit() once the text has really been sent.
  // `sticky` fields (the group) only go when they differ from what this connection last got.
  packet(id, f, self = {}, extra = {}, sticky = {}) {
    const had = this.seen.get(id),
      mem = had || { chests: new Map(), lists: {}, maps: {}, sticky: {} },
      next = { chests: mem.chests, lists: { ...mem.lists }, maps: { ...mem.maps }, sticky: { ...mem.sticky } },
      top = { ...extra };
    const entityPacket = entityDeltaPacket(f.entities, mem.entities);
    next.entities = entityPacket.next;
    let stickyChanged = false;
    for (const k in sticky) {
      const json = JSON.stringify(sticky[k] ?? null);
      if (mem.sticky[k] !== json) {
        top[k] = sticky[k] ?? null;
        next.sticky[k] = json;
        stickyChanged = true;
      }
    }
    // Chests: new or changed ones, and the ids that are gone.
    const changed = [],
      gone = [];
    for (const [cid, json] of f.chests)
      if (mem.chests.get(cid) !== json) {
        changed.push(json);
        if (next.chests === mem.chests) next.chests = new Map(mem.chests);
        next.chests.set(cid, json);
      }
    for (const cid of mem.chests.keys())
      if (!f.chests.has(cid)) {
        gone.push(cid);
        if (next.chests === mem.chests) next.chests = new Map(mem.chests);
        next.chests.delete(cid);
      }
    // Destruction: the lists only grow during a round and nothing is ever repaired, so a shorter list or a missing
    // key means a new round: everything goes again.
    const d = f.destruction,
      reset =
        !had ||
        LISTS.some((k) => (d[k]?.length || 0) < (mem.lists[k] || 0)) ||
        MAPS.some((k) => Object.keys(mem.maps[k] || {}).some((key) => !(key in (d[k] || {})))),
      dd = {};
    let any = reset;
    for (const k of LISTS) {
      const list = d[k] || [],
        from = reset ? 0 : mem.lists[k] || 0;
      if (list.length > from) {
        dd[k] = list.slice(from);
        any = true;
      }
      next.lists[k] = list.length;
    }
    for (const k of MAPS) {
      const now = d[k] || {},
        before = reset ? {} : mem.maps[k] || {},
        part = {};
      let moved = false;
      for (const key in now)
        if (before[key] !== now[key]) {
          part[key] = now[key];
          moved = any = true;
        }
      if (moved || reset) {
        dd[k] = part;
        next.maps[k] = { ...now };
      }
    }
    let text = f.json;
    if (entityPacket.changed) text += ',"entityDelta":' + entityPacket.json;
    if (!had) text += ',"chestsFull":1';
    if (changed.length) text += ',"chests":[' + changed.join(',') + ']';
    if (gone.length) text += ',"chestsGone":' + JSON.stringify(gone);
    if (any) text += ',"destruction":' + JSON.stringify(dd, compact) + (reset ? ',"destructionFull":1' : '');
    text += '}';
    const body = JSON.stringify({ type: 'state', ...top, self: { slots: f.slots.get(id) || null, ...self } }, compact);
    return {
      text: body.slice(0, -1) + ',"state":' + text + '}',
      commit: () => this.seen.set(id, next),
      // Carries something the connection must not miss (a transport with a lossy lane keeps it on the sure one).
      reliable: entityPacket.changed || !had || changed.length > 0 || gone.length > 0 || any || stickyChanged,
    };
  }
}

// Client side: turns the delta packets back into full chests and destruction for the rest of the game.
export class Mirror {
  constructor() {
    this.reset();
  }
  reset() {
    this.entityMirror037 = new EntityDeltaMirror();
    this.chests = new Map();
    this.destruction = { panels: [], decor: [], buildings: [], wrecks: [], props: [], roofs: [], cells: {}, storeys: {} };
  }
  apply(state) {
    this.entityMirror037.apply(state);
    if (state.chestsFull) this.chests = new Map();
    for (const c of state.chests || []) this.chests.set(c.id, c);
    for (const cid of state.chestsGone || []) this.chests.delete(cid);
    const d = state.destruction;
    if (d) {
      if (state.destructionFull) this.destruction = { panels: [], decor: [], buildings: [], wrecks: [], props: [], roofs: [], cells: {}, storeys: {} };
      for (const k of LISTS) if (d[k]?.length) this.destruction[k] = this.destruction[k].concat(d[k]);
      for (const k of MAPS) if (d[k]) this.destruction[k] = { ...this.destruction[k], ...d[k] };
    }
    state.chests = [...this.chests.values()];
    state.destruction = this.destruction;
    delete state.chestsFull;
    delete state.chestsGone;
    delete state.destructionFull;
    for (const p of state.players || []) {
      p.grounded = !p.air;
      delete p.air;
    }
    return state;
  }
}

// Shows other players, bosses and projectiles `delay` ms in the past, between the two states around that moment.
// Server time comes with every state (`st`); the offset to this clock is the smallest seen lately (the least-delayed
// packet), so jitter does not shake the picture. The delay follows how often states come and how unevenly: about
// one and a half gaps plus twice the jitter (30 states a second on a steady line: ≈ 60 ms), eased so the picture
// never jumps.
export class Interpolator {
  constructor(delay = 90, { min = 45, max = 200 } = {}) {
    this.delay = delay;
    this.min = min;
    this.max = max;
    this.reset();
  }
  reset() {
    this.buffer = [];
    this.offsets = [];
    this.gap = null;
    this.jitter = 0;
  }
  push(state, now = performance.now()) {
    if (!Number.isFinite(state.st)) return;
    const last = this.buffer[this.buffer.length - 1];
    // A state older than one already buffered (a lossy, unordered link) is of no use here.
    if (last && state.st <= last.st) return;
    this.offsets.push({ t: now, o: now - state.st });
    while (this.offsets.length > 1 && now - this.offsets[0].t > 3000) this.offsets.shift();
    if (last) {
      const gap = Math.min(250, state.st - last.st);
      this.gap = this.gap === null ? gap : this.gap + (gap - this.gap) * 0.1;
      this.jitter += (Math.max(0, now - state.st - this.offset) - this.jitter) * 0.1;
      const want = Math.max(this.min, Math.min(this.max, this.gap * 1.5 + this.jitter * 2 + 5));
      this.delay += (want - this.delay) * 0.05;
    }
    const pick = (list, key) => new Map((list || []).map((e) => [e.id, { x: e.x, y: e.y, z: e.z, angle: e.angle, pitch: e[key] }]));
    this.buffer.push({ st: state.st, players: pick(state.players, 'pitch'), bosses: pick(state.bosses, 'pitch'), projectiles: pick(state.projectiles, 'pitch') });
    while (this.buffer.length > 2 && state.st - this.buffer[0].st > 1000) this.buffer.shift();
  }
  get offset() {
    let o = Infinity;
    for (const e of this.offsets) o = Math.min(o, e.o);
    return o;
  }
  // A copy of `state` with every entity (but `selfId`) moved to where it was `delay` ms ago.
  apply(state, selfId, now = performance.now()) {
    if (this.buffer.length < 2) return state;
    const t = now - this.offset - this.delay;
    let a = this.buffer[0],
      b = this.buffer[this.buffer.length - 1];
    if (t <= a.st) b = a;
    else if (t >= b.st) a = b;
    else
      for (let i = 0; i < this.buffer.length - 1; i++)
        if (this.buffer[i].st <= t && this.buffer[i + 1].st >= t) {
          a = this.buffer[i];
          b = this.buffer[i + 1];
          break;
        }
    const k = b.st > a.st ? Math.max(0, Math.min(1, (t - a.st) / (b.st - a.st))) : 1,
      lerp = (p, q) => p + (q - p) * k,
      turn = (p, q) => p + Math.atan2(Math.sin(q - p), Math.cos(q - p)) * k,
      move = (list, key, skip) =>
        (list || []).map((e) => {
          if (e.id === skip) return e;
          const pa = a[key].get(e.id),
            pb = b[key].get(e.id);
          // Something that jumped (a respawn, a teleport) is not dragged across the map.
          if (!pa || !pb || Math.hypot(pb.x - pa.x, pb.z - pa.z) > 12) return e;
          return { ...e, x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y), z: lerp(pa.z, pb.z), angle: pa.angle === undefined ? e.angle : turn(pa.angle, pb.angle), pitch: pa.pitch === undefined ? e.pitch : lerp(pa.pitch, pb.pitch) };
        });
    return { ...state, players: move(state.players, 'players', selfId), bosses: move(state.bosses, 'bosses'), projectiles: move(state.projectiles, 'projectiles') };
  }
}

// Your own walking, replayed from the last position the server confirmed through every input it has not processed
// yet. Only the horizontal move is predicted (height, jumps and knock-backs come from the server, eased).
export function moveSpeed(p, i, { weaponMove = 1, perkSpeed = 1, carry = 1 } = {}) {
  if (p.dropping) return 13;
  if (p.gliding) return 10;
  const sprint = !!i.sprint && !i.fire && !p.using && p.stamina > 0 && Math.hypot(i.x || 0, i.z || 0) > 0.1;
  return (sprint ? 9 : 5.8) * (p.healing > 0 ? 0.35 : 1) * (p.using ? 0.55 : 1) * (p.rush > 0 ? 1.3 : 1) * (p.webbed > 0 ? 0.45 : 1) * weaponMove * perkSpeed * carry;
}
// One horizontal step with a slide along walls (knee and chest height, the capsule's radius kept clear).
export function slideMove(pos, dx, dz, map) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || !map) return { x: pos.x + dx, z: pos.z + dz };
  const free = (x, z, ox, oz) => {
    const l = Math.hypot(ox, oz);
    if (l < 1e-6) return true;
    const dir = { x: ox / l, y: 0, z: oz / l };
    for (const h of [0.45, 1.3]) if (castMap({ x, y: pos.y + h, z }, dir, l + 0.36, map, null, true).distance < l + 0.36) return false;
    return true;
  };
  if (free(pos.x, pos.z, dx, dz)) return { x: pos.x + dx, z: pos.z + dz };
  if (free(pos.x, pos.z, dx, 0)) return { x: pos.x + dx, z: pos.z };
  if (free(pos.x, pos.z, 0, dz)) return { x: pos.x, z: pos.z + dz };
  return { x: pos.x, z: pos.z };
}
export class Predictor {
  constructor() {
    this.pending = []; // { seq, x, z, sprint, fire, dt }
    this.seq = 0;
    this.reset();
  }
  reset() {
    this.pending = [];
    this.base = null;
    this.error = { x: 0, z: 0 };
    this.shown = null;
    this.stats = { n: 0, sum: 0, max: 0 };
  }
  // Not predicting for now (in the air from a pad, gliding, knocked back, dead): you are shown where the server
  // says. The next prediction starts from there without a jump.
  idle(me) {
    this.base = null;
    this.error = { x: 0, z: 0 };
    this.shown = me ? { x: me.x, z: me.z } : null;
  }
  // Called for every input sent: returns the sequence number to send with it.
  record(input, dt) {
    const seq = ++this.seq;
    this.pending.push({ seq, x: input.x || 0, z: input.z || 0, sprint: !!input.sprint, fire: !!input.fire, dt: Math.min(0.1, dt) });
    if (this.pending.length > 120) this.pending.shift();
    return seq;
  }
  // The confirmed position walked forward through the unconfirmed inputs.
  raw(me, map, ctx) {
    if (!this.base) return null;
    let pos = { ...this.base };
    for (const i of this.pending) {
      const n = Math.max(1, Math.hypot(i.x, i.z)),
        speed = moveSpeed(me, i, ctx);
      pos = { ...slideMove(pos, (i.x / n) * speed * i.dt, (i.z / n) * speed * i.dt, map), y: pos.y };
    }
    return pos;
  }
  // A state arrived: the server's position of you and the last input it applied. The difference it makes to the
  // prediction becomes a correction that eases out (a small disagreement glides away instead of snapping; a big
  // one — a respawn, a teleport, a launch — is taken at once).
  server(me, ack, map, ctx) {
    if (!me) return;
    const before = this.raw(me, map, ctx);
    // No acknowledgement yet (a new match): nothing sent so far counts.
    this.pending = Number.isInteger(ack) && ack > 0 ? this.pending.filter((i) => i.seq > ack) : [];
    this.base = { x: me.x, y: me.y || 0, z: me.z };
    const after = this.raw(me, map, ctx);
    if (!before) {
      // Picking up again from the server's position: glide over from where you were shown.
      const from = this.shown;
      this.error = from && Math.hypot(from.x - after.x, from.z - after.z) < 3 ? { x: from.x - after.x, z: from.z - after.z } : { x: 0, z: 0 };
      return;
    }
    const miss = Math.hypot(after.x - before.x, after.z - before.z);
    // A jump of more than 3 m is a respawn or a teleport, taken as it is; smaller ones are how far the server
    // disagreed with the prediction (the latency checks read these figures).
    if (miss > 3) this.error = { x: 0, z: 0 };
    else {
      this.stats.n++;
      this.stats.sum += miss;
      this.stats.max = Math.max(this.stats.max, miss);
      this.error.x -= after.x - before.x;
      this.error.z -= after.z - before.z;
    }
  }
  // Where to show you now.
  position(me, map, ctx, dt) {
    const pos = this.raw(me, map, ctx);
    if (!pos || !me) return null;
    const k = Math.exp(-dt * 10);
    this.error.x *= k;
    this.error.z *= k;
    const out = { x: pos.x + this.error.x, z: pos.z + this.error.z };
    this.shown = { x: out.x, z: out.z };
    // On the ground the height follows the terrain under the predicted feet (floors inside are flat).
    out.y = me.grounded && map ? (me.y || 0) + groundHeight(out.x, out.z, map) - groundHeight(me.x, me.z, map) : me.y || 0;
    return out;
  }
}
