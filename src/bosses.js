import { bossShouldThink } from './bot-budget.js';
// Bosses and their relics. Four bosses guard lairs in the desert, the lake, the grove and the quarry (see world.js
// LAIRS and PARK_LAIRS); each drops a relic with special abilities when defeated. It goes into the inventory (0.27:
// it has its own slot, shown with the weapons) and drops when its owner falls. VIS, NOEMA, ENTROPIA and GELU and
// their relics were retired in 0.27:
//   IGNIS · FIRE GOLEM (desert)       → EMBER CORE: ring of fire around you, summon two helper bots
//   NULL · VOID WARDEN (lake)         → VOID PORTAL GUN: a blue and an orange portal, like Portal
//   ARACHNE · BROOD MOTHER (grove)    → VENOM FANG: a pool of venom where you aim, and a pounce
//   TERRA · QUARRY WYRM (quarry)      → EARTH SPINE: a line of stone spikes erupting ahead
// Every boss fights with a move set (MOVES): a melee blow, a ranged attack and two signature moves, each with its
// own wind-up, animation (the move id doubles as the animation name) and a telegraph on the ground where it will
// land. The simulation owns all of it (authoritative online); clients only draw the snapshot and the events.
import { groundHeight } from './terrain.js';
import { castMap } from './raycast.js';
import { rayBox, direction, EYE_HEIGHT } from './combat.js';
import { lineClear } from './world.js';

export const BOSSES = {
  fire: { name: 'IGNIS', title: 'FIRE GOLEM', hp: 1800, relic: 'ember', speed: 3.1, color: 0xff6a2a },
  void: { name: 'NULL', title: 'VOID WARDEN', hp: 1600, relic: 'portal', speed: 3.4, color: 0x6a4cff },
  // The brood mother is low and wide, the wyrm tall and thin: their hit boxes follow the bodies.
  brood: { name: 'ARACHNE', title: 'BROOD MOTHER', hp: 1900, relic: 'fang', speed: 3.8, color: 0x9bd84a, height: 2.6, width: 3.2 },
  wyrm: { name: 'TERRA', title: 'QUARRY WYRM', hp: 2200, relic: 'spine', speed: 3.2, color: 0xd08a3a, height: 4.2, width: 2 },
};
export const BOSS_HEIGHT = 3.4;
export const BOSS_WIDTH = 1.6;
export const bossHeight = (kind) => BOSSES[kind]?.height || BOSS_HEIGHT;
export const bossWidth = (kind) => BOSSES[kind]?.width || BOSS_WIDTH;
// Ranged attacks. `gravity` lobs the shot in an arc, `chill` freezes whoever it hits (half the value, in seconds),
// `web` slows them, `homing` bends the shot toward its target.
export const BOSS_SHOTS = {
  fire: { kind: 'fireball', speed: 19, damage: 22, radius: 2.6, every: 2.4, count: 1 },
  void: { kind: 'void', speed: 24, damage: 20, radius: 0, every: 2.1, count: 1 },
  brood: { kind: 'web', speed: 19, damage: 10, radius: 0, every: 2.2, count: 1, web: 2.8 },
  wyrm: { kind: 'rock', speed: 18, damage: 22, radius: 2.4, every: 2.6, count: 1, gravity: 9 },
};
// Shots that belong to a move rather than a boss's plain ranged attack.
const EXTRA_SHOTS = {};
const SHOT_SPECS = Object.fromEntries([...Object.values(BOSS_SHOTS), ...Object.values(EXTRA_SHOTS)].map((s) => [s.kind, s]));
// Move sets. `at`: seconds from the start of the move to the moment it lands; `dur`: the whole move. Specials fire
// when the target is between `min` and `max` metres away and their own cooldown `cd` has run out.
export const MOVES = {
  fire: {
    melee: { id: 'swipe', at: 0.45, dur: 0.95, range: 3.8, arc: 3, damage: 26, push: 8 },
    shot: { id: 'hurl', at: 0.45, dur: 0.9 },
    specials: [
      { id: 'ignite', min: 0, max: 12, cd: 11, at: 0.7, dur: 1.2 },
      { id: 'meteor', min: 6, max: 28, cd: 13, at: 1.5, dur: 1.9 },
    ],
  },
  void: {
    melee: { id: 'claw', at: 0.4, dur: 0.85, range: 3.7, arc: 2.4, damage: 28, push: 7 },
    shot: { id: 'point', at: 0.35, dur: 0.75 },
    specials: [
      { id: 'blink', min: 5, max: 22, cd: 8, at: 0.45, dur: 0.8 },
      { id: 'well', min: 0, max: 18, cd: 13, at: 0.6, dur: 1.2 },
    ],
  },
  brood: {
    melee: { id: 'bite', at: 0.45, dur: 0.9, range: 4.3, arc: 2, damage: 28, push: 6 },
    shot: { id: 'spit', at: 0.4, dur: 0.8 },
    specials: [
      { id: 'leap', min: 6, max: 20, cd: 9, at: 0.6, dur: 1.6 },
      { id: 'venom', min: 0, max: 16, cd: 12, at: 0.6, dur: 1.1 },
    ],
  },
  wyrm: {
    melee: { id: 'bite', at: 0.5, dur: 1.0, range: 4.5, arc: 1.8, damage: 32, push: 8 },
    shot: { id: 'spit', at: 0.45, dur: 0.9 },
    specials: [
      { id: 'burrow', min: 7, max: 26, cd: 12, at: 0.8, dur: 8 },
      { id: 'sweep', min: 0, max: 6.5, cd: 9, at: 0.75, dur: 1.3 },
    ],
  },
};
// Names shown to players close by when a boss starts a signature move.
export const MOVE_LABELS = {
  ignite: 'RING OF FIRE',
  meteor: 'METEOR SHOWER',
  blink: 'BLINK',
  well: 'GRAVITY WELL',
  leap: 'POUNCE',
  venom: 'VENOM POOL',
  burrow: 'BURROW',
  sweep: 'TAIL SWEEP',
};
export const RELICS = {
  ember: {
    name: 'EMBER CORE',
    boss: 'fire',
    color: 0xff6a2a,
    abilities: [
      { id: 'ring', label: 'RING OF FIRE', cd: 16 },
      { id: 'summon', label: 'HELPERS', cd: 40 },
    ],
  },
  portal: {
    name: 'VOID PORTAL GUN',
    boss: 'void',
    color: 0x6a4cff,
    abilities: [
      { id: 'portalA', label: 'BLUE PORTAL', cd: 0.5 },
      { id: 'portalB', label: 'ORANGE PORTAL', cd: 0.5 },
    ],
  },
  fang: {
    name: 'VENOM FANG',
    boss: 'brood',
    color: 0x9bd84a,
    abilities: [
      { id: 'venom', label: 'VENOM POOL', cd: 18 },
      { id: 'pounce', label: 'POUNCE', cd: 8 },
    ],
  },
  spine: { name: 'EARTH SPINE', boss: 'wyrm', color: 0xd08a3a, abilities: [{ id: 'eruption', label: 'ERUPTION', cd: 16 }] },
};
export const FLASHBACK_TIME = 5;
export const HELPER_TIME = 25;
const AGGRO = 26;
const LEASH = 30;
const hyp = Math.hypot;

export class BossSystem {
  constructor(arena) {
    this.a = arena;
    const scale = arena.mode === 'duel' ? 0.7 : arena.size === 'city' ? 1.25 : 1;
    // A big-city duel (0.28) keeps only the bosses whose lair is inside its ring.
    const ring = arena.zone?.fixed ? arena.zone : null;
    this.list = arena.map.lairs.filter((l) => !ring || Math.hypot(l.x - ring.x, l.z - ring.z) < ring.radius + 10).map((l) => {
      const lot = l.lot || arena.map.parks.find((p) => Math.abs(p.x - l.x) < 1 && Math.abs(p.z - l.z) < 1),
        info = BOSSES[l.boss],
        // The boss roams a box around its lair that stays inside the lot (2.5 m from the edges).
        bounds = lot
          ? {
              x: Math.max(3, Math.min(lot.x + lot.w / 2 - 2.5 - l.x, l.x - (lot.x - lot.w / 2) - 2.5)),
              z: Math.max(3, Math.min(lot.z + lot.d / 2 - 2.5 - l.z, l.z - (lot.z - lot.d / 2) - 2.5)),
            }
          : { x: 20, z: 20 };
      return {
        id: 'boss:' + l.boss + (l.tile ? ':q' + l.tile : ''),
        kind: l.boss,
        name: info.name + ' · ' + info.title,
        home: { x: l.x, z: l.z },
        bounds,
        maxHp: Math.round(info.hp * scale),
        hp: Math.round(info.hp * scale),
        x: l.x,
        z: l.z,
        y: groundHeight(l.x, l.z, arena.map) + (info.float || 0),
        angle: 0,
        anim: 'idle',
        animTime: 0,
        // Counts moves, so a client restarts an animation even when the same move follows itself.
        seq: 0,
        act: null,
        target: null,
        aggro: null,
        cd: { melee: 0, shot: 2, special: 5, think: 0 },
        frozen: 0,
        confused: 0,
        // Set when it dies (90 s with respawns, never in a royale). A boss knocked to 0 by other means stays down.
        respawn: Infinity,
        hitAt: -9,
        under: false,
        rage: false,
      };
    });
    this.shots = [];
    this.shotId = 0;
    this.hazards = [];
    this.portals = {};
    this.drops = [];
    this.dropId = 0;
    // Blasts and spikes that go off later: a cataclysm or a line of ruin rolls across the map instead of firing
    // at once, and a boss's telegraphed attacks land when their warning runs out.
    this.pending = [];
  }
  get time() {
    return this.a.tick / 60;
  }
  alive() {
    return this.list.filter((b) => b.hp > 0 && !b.under);
  }
  // Nearest boss a ray hits before `range`. A burrowed wyrm is underground and cannot be hit.
  ray(origin, dir, range) {
    let best = null,
      distance = range;
    for (const b of this.list) {
      if (b.hp <= 0 || b.under) continue;
      const h = bossWidth(b.kind) / 2,
        d = rayBox(origin, dir, { x: b.x - h, y: b.y, z: b.z - h }, { x: b.x + h, y: b.y + bossHeight(b.kind), z: b.z + h }, distance);
      if (d < distance) {
        distance = d;
        best = b;
      }
    }
    return best ? { boss: best, distance } : null;
  }
  damage(b, amount, attacker = null) {
    if (!b || b.hp <= 0 || b.under || amount <= 0) return;
    // Bots chip bosses at half rate, like they hurt players.
    const dealt = Math.round(amount * (attacker?.bot ? 0.5 : 1) * (b.frozen > 0 ? 1.25 : 1));
    b.hp = Math.max(0, b.hp - dealt);
    b.hitAt = this.time;
    if (attacker && attacker.hp > 0) b.aggro = attacker.id;
    this.a.events.push({ type: 'boss-hit', id: b.id, by: attacker?.id, x: b.x, y: b.y + bossHeight(b.kind) * 0.6, z: b.z, amount: dealt });
    if (b.hp === 0) {
      b.act = null;
      b.anim = 'death';
      b.animTime = 0;
      b.seq++;
      b.respawn = this.a.respawns ? 90 : Infinity;
      b.target = b.aggro = null;
      const credit = attacker?.helperOf ? this.a.players.find((p) => p.id === attacker.helperOf) || attacker : attacker;
      this.a.events.push({ type: 'boss-down', id: b.id, kind: b.kind, by: credit?.id || null, x: b.x, y: b.y, z: b.z });
      this.drop(BOSSES[b.kind].relic, b.x, b.z);
    }
  }
  drop(relic, x, z) {
    const y = groundHeight(x, z, this.a.map);
    this.drops.push({ id: 'relic' + ++this.dropId, relic, x, y: y + 0.9, z, age: 0 });
  }
  blast(x, y, z, radius, damage, owner) {
    for (const b of this.list) {
      if (b.hp <= 0 || b.under) continue;
      const d = hyp(b.x - x, b.y + bossHeight(b.kind) / 2 - y, b.z - z) - bossWidth(b.kind) / 2;
      if (d < radius) this.damage(b, damage * (1 - (Math.max(0, d) / radius) * 0.7), owner);
    }
  }
  // Players in reach of a boss attack (not behind walls).
  exposed(b, p, height = 1.6) {
    const from = { x: b.x, y: b.y + height, z: b.z },
      to = { x: p.x - from.x, y: p.y + 1 - from.y, z: p.z - from.z },
      len = hyp(to.x, to.y, to.z) || 0.01;
    return castMap(from, { x: to.x / len, y: to.y / len, z: to.z / len }, len, this.a.map, null, true).distance >= len - 0.3;
  }
  // Is a point open to a player (no wall in between)? Used by boss blasts, like Arena.blast.
  open(x, y, z, p) {
    const to = { x: p.x - x, y: p.y + 0.9 - y, z: p.z - z },
      len = hyp(to.x, to.y, to.z) || 0.01;
    return castMap({ x, y: y + 0.08, z }, { x: to.x / len, y: to.y / len, z: to.z / len }, len + 0.1, this.a.map, null, true).distance >= len - 0.1;
  }
  hurt(p, amount, b) {
    this.a.damage(null, p, amount, b.id);
  }
  // A boss's own explosion: hurts players (credited to the boss), breaks props and walls, never hurts bosses.
  bossBlast(b, x, y, z, radius, damage, cause = 'explosion', push = 0) {
    const a = this.a;
    for (const p of a.players) {
      if (p.hp <= 0 || p.inBus) continue;
      const d = hyp(p.x - x, p.y + 0.9 - y, p.z - z);
      if (d > radius || !this.open(x, y, z, p)) continue;
      this.hurt(p, Math.round(damage * (1 - (d / radius) * 0.6)), b);
      if (push) this.knock(p, x, z, push * (1 - (d / radius) * 0.5), 4.5);
    }
    a.blast(x, y, z, radius, damage, null, cause, null, { players: false, bosses: false });
  }
  // Knock-back away from a point, with a hop.
  knock(p, x, z, strength, up = 4.5) {
    const dx = p.x - x,
      dz = p.z - z,
      d = hyp(dx, dz) || 1;
    p.push = { x: (dx / d) * strength, z: (dz / d) * strength };
    p.vy = Math.max(p.vy || 0, up);
  }
  step(dt) {
    const a = this.a;
    for (const b of this.list) this.stepBoss(b, dt);
    this.stepShots(dt);
    this.stepHazards(dt);
    this.stepPending(dt);
    for (const p of a.players) {
      if (p.frozen > 0) p.frozen = Math.max(0, p.frozen - dt);
      if (p.webbed > 0) p.webbed = Math.max(0, p.webbed - dt);
      if (p.flashback > 0) p.flashback = Math.max(0, p.flashback - dt);
      if (p.portalCd > 0) p.portalCd = Math.max(0, p.portalCd - dt);
      if (p.relic) for (let i = 0; i < p.relic.cd.length; i++) p.relic.cd[i] = Math.max(0, p.relic.cd[i] - dt);
      if (p.hp > 0) this.portalTravel(p);
    }
    // Relics on the ground: walk over one to take it (with a relic already, press E to swap).
    for (const d of this.drops) d.age += dt;
    for (const p of a.players) {
      if (p.hp <= 0 || p.helperOf) continue;
      const d = this.drops.find((d) => d.age > 0.8 && hyp(d.x - p.x, d.z - p.z) < 1.6 && Math.abs(d.y - 0.9 - p.y) < 2);
      if (!d) continue;
      if (p.relic && !(p.input?.interact && !p.relicSwapHeld)) continue;
      if (p.relic) this.drop(p.relic.id, p.x + Math.sin(p.angle + 2) * 1.8, p.z + Math.cos(p.angle + 2) * 1.8);
      this.drops.splice(this.drops.indexOf(d), 1);
      this.give(p, d.relic);
    }
    for (const p of a.players) p.relicSwapHeld = !!p.input?.interact;
    // Helper bots leave when their time is up or when they fall.
    for (const p of [...a.players])
      if (p.helperOf) {
        p.expires -= dt;
        if (p.expires <= 0 || p.hp <= 0) {
          a.events.push({ type: 'helper-gone', id: p.id, x: p.x, y: p.y, z: p.z });
          a.removePlayer(p.id);
        }
      }
  }
  give(p, relic) {
    if (!RELICS[relic]) return;
    p.relic = { id: relic, cd: RELICS[relic].abilities.map(() => 0) };
    this.a.events.push({ type: 'relic', id: p.id, relic });
  }
  // A dying player drops their relic; their portals close.
  onDeath(p) {
    if (p.relic) this.drop(p.relic.id, p.x, p.z);
    p.relic = null;
    delete this.portals[p.id];
    p.frozen = p.flashback = p.webbed = 0;
  }
  ground(b) {
    return groundHeight(b.x, b.z, this.a.map) + (BOSSES[b.kind].float || 0);
  }
  stepBoss(b, dt) {
    if (!bossShouldThink(this.a, b)) return;
    const a = this.a,
      info = BOSSES[b.kind];
    b.animTime += dt;
    if (b.hp <= 0) {
      b.respawn -= dt;
      if (b.respawn <= 0) {
        Object.assign(b, { hp: b.maxHp, x: b.home.x, z: b.home.z, anim: 'idle', animTime: 0, aggro: null, target: null, act: null, under: false, rage: false, respawn: Infinity });
        b.seq++;
        b.y = this.ground(b);
        a.events.push({ type: 'boss-spawn', id: b.id, x: b.x, y: b.y, z: b.z });
      }
      return;
    }
    for (const k in b.cd) b.cd[k] = Math.max(0, b.cd[k] - dt);
    b.frozen = Math.max(0, b.frozen - dt);
    b.confused = Math.max(0, b.confused - dt);
    b.rage = b.hp < b.maxHp * 0.4;
    const slow = b.frozen > 0 ? 0.3 : 1;
    // Stunned by a flashback: whatever it was doing is lost (a burrowed wyrm surfaces where it is).
    if (b.confused > 0 && !b.under) {
      if (b.act) this.endAct(b);
      if (b.anim !== 'confused') this.setAnim(b, 'confused');
      b.y = this.ground(b);
      return;
    }
    if (b.act) {
      this.stepAct(b, dt * slow);
      return;
    }
    // Pick a target: whoever hurt it recently, else the nearest visible player near the lair.
    if (b.cd.think <= 0) {
      b.cd.think = 0.4;
      const within = (p) => p && p.hp > 0 && !p.inBus && !p.dropping && hyp(p.x - b.home.x, p.z - b.home.z) < LEASH + 8;
      let t = a.players.find((p) => p.id === b.aggro);
      if (!within(t)) {
        b.aggro = null;
        t = a.players
          .filter((p) => within(p) && hyp(p.x - b.x, p.z - b.z) < AGGRO && lineClear(b, p, 0, a.map.obstacles))
          .sort((p, q) => hyp(p.x - b.x, p.z - b.z) - hyp(q.x - b.x, q.z - b.z))[0];
      }
      b.target = t?.id || null;
    }
    const t = a.players.find((p) => p.id === b.target && p.hp > 0);
    let goal = null;
    if (!t) {
      if (hyp(b.home.x - b.x, b.home.z - b.z) > 1.5) goal = b.home;
      b.hp = Math.min(b.maxHp, b.hp + 30 * dt);
    } else {
      const moves = MOVES[b.kind],
        dist = hyp(t.x - b.x, t.z - b.z);
      b.angle = turn(b.angle, Math.atan2(t.x - b.x, t.z - b.z), 3.5 * dt * slow);
      if (dist > moves.melee.range - 0.6) goal = t;
      if (dist < moves.melee.range && b.cd.melee <= 0 && Math.abs(t.y - b.y) < 3) {
        b.cd.melee = 1.5;
        this.start(b, moves.melee, { target: t.id, tx: t.x, tz: t.z, ty: t.y });
        // A quick cone on the ground: where the blow will land.
        this.tele(b, { shape: 'cone', x: b.x, z: b.z, r: moves.melee.range, arc: moves.melee.arc, angle: b.angle, time: moves.melee.at });
        return;
      }
      if (this.trySpecial(b, t, dist)) return;
      if (b.cd.shot <= 0 && dist > 4 && this.exposed(b, t)) {
        const s = BOSS_SHOTS[b.kind];
        b.cd.shot = s.every * (b.rage ? 0.7 : 1);
        this.start(b, moves.shot, { target: t.id, tx: t.x, tz: t.z, ty: t.y });
        return;
      }
    }
    if (goal) {
      const dx = goal.x - b.x,
        dz = goal.z - b.z,
        d = hyp(dx, dz) || 1,
        v = info.speed * slow * (t ? (b.rage ? 1.15 : 1) : 0.7) * dt;
      b.x = clampTo(b.x + (dx / d) * v, b.home.x, b.bounds.x);
      b.z = clampTo(b.z + (dz / d) * v, b.home.z, b.bounds.z);
      if (!t) b.angle = turn(b.angle, Math.atan2(dx, dz), 3 * dt);
      if (b.anim === 'idle') this.setAnim(b, 'walk');
    } else if (b.anim === 'walk') this.setAnim(b, 'idle');
    b.y = this.ground(b);
  }
  setAnim(b, name) {
    b.anim = name;
    b.animTime = 0;
    b.seq++;
  }
  // Starts a move: its animation plays from now, and `perform` runs when it lands (`at`).
  start(b, move, extra = {}) {
    b.act = { id: move.id, t: 0, at: move.at, dur: move.dur, fired: false, move, ...extra };
    this.setAnim(b, move.id);
  }
  endAct(b) {
    if (b.under) this.surface(b, false);
    b.act = null;
    this.setAnim(b, 'idle');
  }
  // A telegraph: a glowing shape on the ground that fills up until the attack lands.
  tele(b, shape) {
    this.a.events.push({ type: 'boss-tele', id: b.id, kind: b.kind, ...shape });
  }
  trySpecial(b, t, dist) {
    if (b.cd.special > 0) return false;
    const ready = MOVES[b.kind].specials.filter(
      (m) => (b.cd[m.id] || 0) <= 0 && dist >= m.min && dist <= m.max && (!m.sight || this.exposed(b, t)),
    );
    if (!ready.length) return false;
    const m = ready[Math.floor(this.a.random() * ready.length) % ready.length];
    b.cd[m.id] = m.cd * (b.rage ? 0.75 : 1);
    b.cd.special = 3.2;
    const act = { target: t.id, tx: t.x, tz: t.z, ty: t.y };
    this.a.events.push({ type: 'boss-move', id: b.id, kind: b.kind, move: m.id, x: b.x, y: b.y, z: b.z });
    const lair = (x, z) => ({ x: clampTo(x, b.home.x, b.bounds.x + 6), z: clampTo(z, b.home.z, b.bounds.z + 6) });
    if (m.id === 'ignite') this.tele(b, { shape: 'ring', x: b.x, z: b.z, r: 6, time: m.at });
    else if (m.id === 'meteor') {
      const rand = this.a.random;
      act.spots = [{ x: t.x, z: t.z }];
      for (let i = 0; i < 2; i++) {
        const ang = rand() * Math.PI * 2,
          r = 3.5 + rand() * 3;
        act.spots.push({ x: t.x + Math.sin(ang) * r, z: t.z + Math.cos(ang) * r });
      }
      for (const s of act.spots) this.tele(b, { shape: 'circle', x: s.x, z: s.z, r: 3.2, time: m.at, meteor: true });
    } else if (m.id === 'well') {
      const s = lair(t.x, t.z);
      act.spot = s;
      this.tele(b, { shape: 'circle', x: s.x, z: s.z, r: 5.5, time: m.at });
    } else if (m.id === 'leap') {
      // It lands inside its own ground (a spot outside would snap it back on the next step).
      const s = { x: clampTo(t.x, b.home.x, b.bounds.x), z: clampTo(t.z, b.home.z, b.bounds.z) };
      act.spot = s;
      this.tele(b, { shape: 'circle', x: s.x, z: s.z, r: 3.6, time: m.at + 0.6 });
    } else if (m.id === 'venom') {
      act.spot = { x: t.x, z: t.z };
      this.tele(b, { shape: 'circle', x: t.x, z: t.z, r: 4, time: m.at });
    } else if (m.id === 'burrow') {
      const s = { x: clampTo(t.x, b.home.x, b.bounds.x), z: clampTo(t.z, b.home.z, b.bounds.z) };
      act.spot = s;
      act.phase = 'dig';
      const travel = Math.max(0.5, Math.min(2.4, hyp(s.x - b.x, s.z - b.z) / 10));
      this.tele(b, { shape: 'circle', x: s.x, z: s.z, r: 3.6, time: m.at + travel + 0.55 });
    } else if (m.id === 'sweep') this.tele(b, { shape: 'circle', x: b.x, z: b.z, r: 6.5, time: m.at });
    this.start(b, m, act);
    return true;
  }
  stepAct(b, dt) {
    const act = b.act,
      m = act.move;
    act.t += dt;
    const t = this.a.players.find((p) => p.id === act.target && p.hp > 0);
    // Until the blow lands, keep tracking the target a little (the telegraph already shows where it goes).
    if (!act.fired && t) {
      act.tx = t.x;
      act.tz = t.z;
      act.ty = t.y;
      b.angle = turn(b.angle, Math.atan2(t.x - b.x, t.z - b.z), 1.6 * dt);
    }
    if (!act.fired && act.t >= act.at) {
      act.fired = true;
      this.perform(b, act, t);
    }
    // Moves that travel: the brood mother in the air, the wyrm under the ground.
    if (act.leap) this.stepLeap(b, act, dt);
    if (act.phase && act.phase !== 'dig') this.stepBurrow(b, act, dt);
    if (!act.leap) b.y = this.ground(b);
    if (act.t >= act.dur && !act.leap && (!act.phase || act.phase === 'done')) {
      b.act = null;
      this.setAnim(b, 'idle');
    }
  }
  perform(b, act, t) {
    const a = this.a,
      moves = MOVES[b.kind],
      m = act.move;
    if (m === moves.melee) {
      // The blow: everyone in the arc in front of the boss, in reach, not behind a wall.
      for (const p of a.players) {
        if (p.hp <= 0 || p.inBus) continue;
        const dx = p.x - b.x,
          dz = p.z - b.z,
          d = hyp(dx, dz);
        if (d > m.range + 0.4 || Math.abs(p.y - b.y) > 3) continue;
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - b.angle), Math.cos(Math.atan2(dx, dz) - b.angle)));
        if (d > 1.3 && off > m.arc / 2) continue;
        if (!this.exposed(b, p, 1.2)) continue;
        this.hurt(p, m.damage, b);
        this.knock(p, b.x, b.z, m.push, 4.5);
        if (m.chill) p.frozen = Math.max(p.frozen || 0, m.chill);
      }
      a.events.push({ type: 'boss-slam', id: b.id, kind: b.kind, move: m.id, x: b.x + Math.sin(b.angle) * 1.8, y: b.y, z: b.z + Math.cos(b.angle) * 1.8 });
      return;
    }
    if (m === moves.shot) {
      this.fire(b, { x: act.tx, y: act.ty, z: act.tz }, BOSS_SHOTS[b.kind], t?.id);
      return;
    }
    switch (m.id) {
      case 'ignite':
        this.hazards.push({ id: ++this.shotId, kind: 'ring', x: b.x, z: b.z, y: b.y, r: 6, time: 4.5, max: 4.5, owner: b.id, team: 'boss', dps: 20 });
        a.events.push({ type: 'fire-ring', x: b.x, y: b.y, z: b.z, r: 6 });
        break;
      case 'meteor':
        for (const s of act.spots) {
          const y = groundHeight(s.x, s.z, a.map);
          this.bossBlast(b, s.x, y + 0.6, s.z, 3.2, 30, 'meteor', 7);
          this.hazards.push({ id: ++this.shotId, kind: 'embers', x: s.x, z: s.z, y, r: 1.8, time: 3.5, max: 3.5, owner: b.id, team: 'boss', dps: 12 });
        }
        break;
      case 'blink': {
        if (!t) break;
        const back = t.angle + Math.PI,
          x = clampTo(t.x + Math.sin(back) * 3.5, b.home.x, b.bounds.x),
          z = clampTo(t.z + Math.cos(back) * 3.5, b.home.z, b.bounds.z);
        a.events.push({ type: 'blink', id: b.id, x: b.x, y: b.y, z: b.z, tx: x, ty: groundHeight(x, z, a.map), tz: z });
        b.x = x;
        b.z = z;
        b.angle = Math.atan2(t.x - x, t.z - z);
        b.cd.melee = 0.2;
        break;
      }
      case 'well': {
        const s = act.spot,
          y = groundHeight(s.x, s.z, a.map);
        this.hazards.push({ id: ++this.shotId, kind: 'well', x: s.x, z: s.z, y, r: 5.5, time: 2.4, max: 2.4, owner: b.id, team: 'boss', dps: 0, pull: 6.5, implode: { r: 3.4, damage: 34 } });
        break;
      }
      case 'leap':
        act.leap = { x0: b.x, z0: b.z, x1: act.spot.x, z1: act.spot.z, y0: b.y, t: 0, T: 0.6 };
        a.events.push({ type: 'boss-leap', id: b.id, x: b.x, y: b.y, z: b.z, tx: act.spot.x, tz: act.spot.z });
        break;
      case 'venom': {
        const s = act.spot,
          y = groundHeight(s.x, s.z, a.map);
        this.hazards.push({ id: ++this.shotId, kind: 'poison', x: s.x, z: s.z, y, r: 4, time: 6, max: 6, owner: b.id, team: 'boss', dps: 10 });
        a.events.push({ type: 'venom', id: b.id, x: s.x, y, z: s.z, fx: b.x, fy: b.y + 1.6, fz: b.z });
        break;
      }
      case 'burrow':
        // Down it goes: nothing can hit it until it surfaces under its target.
        b.under = true;
        act.phase = 'travel';
        a.events.push({ type: 'burrow', id: b.id, x: b.x, y: b.y, z: b.z });
        break;
      case 'sweep':
        for (const p of a.players) {
          if (p.hp <= 0 || p.inBus || hyp(p.x - b.x, p.z - b.z) > 6.5 || Math.abs(p.y - b.y) > 3) continue;
          this.hurt(p, 24, b);
          this.knock(p, b.x, b.z, 12, 5);
        }
        a.events.push({ type: 'boss-sweep', id: b.id, x: b.x, y: b.y, z: b.z, r: 6.5 });
        break;
    }
  }
  // ARACHNE · POUNCE: an arc through the air onto the marked spot.
  stepLeap(b, act, dt) {
    const l = act.leap;
    l.t += dt;
    const k = Math.min(1, l.t / l.T);
    b.x = l.x0 + (l.x1 - l.x0) * k;
    b.z = l.z0 + (l.z1 - l.z0) * k;
    b.y = this.ground(b) + Math.sin(k * Math.PI) * 4.5;
    if (k < 1) return;
    act.leap = null;
    b.y = this.ground(b);
    const a = this.a;
    for (const p of a.players) {
      if (p.hp <= 0 || p.inBus || hyp(p.x - b.x, p.z - b.z) > 3.6 || Math.abs(p.y - b.y) > 3) continue;
      this.hurt(p, 30, b);
      this.knock(p, b.x, b.z, 9, 5);
    }
    a.events.push({ type: 'boss-land', id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, r: 3.6 });
    a.blast(b.x, b.y + 0.3, b.z, 2.2, 60, null, 'quake', null, { players: false, bosses: false });
    act.dur = Math.max(act.dur, act.t + 0.6);
  }
  // TERRA · BURROW: under the ground to the marked spot, then up through whoever stands on it.
  stepBurrow(b, act, dt) {
    const s = act.spot;
    if (act.phase === 'travel') {
      const dx = s.x - b.x,
        dz = s.z - b.z,
        d = hyp(dx, dz);
      if (d < 0.3) {
        act.phase = 'rise';
        act.rise = 0.55;
        return;
      }
      const v = Math.min(d, 10 * dt);
      b.x += (dx / d) * v;
      b.z += (dz / d) * v;
      b.angle = Math.atan2(dx, dz);
    } else if (act.phase === 'rise') {
      act.rise -= dt;
      if (act.rise <= 0) this.surface(b, true);
    } else if (act.phase === 'emerge') {
      act.emerge -= dt;
      if (act.emerge <= 0) {
        act.phase = 'done';
        act.dur = act.t;
      }
    }
    // Never stuck underground, whatever happens to its target.
    if (b.under && act.t > 6) this.surface(b, true);
  }
  surface(b, strike) {
    const a = this.a,
      act = b.act;
    b.under = false;
    if (!strike || !act) return;
    for (const p of a.players) {
      if (p.hp <= 0 || p.inBus || hyp(p.x - b.x, p.z - b.z) > 3.6 || Math.abs(p.y - b.y) > 3) continue;
      this.hurt(p, 32, b);
      this.knock(p, b.x, b.z, 8, 8);
    }
    a.events.push({ type: 'emerge', id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, r: 3.6 });
    a.blast(b.x, b.y + 0.3, b.z, 2.4, 80, null, 'quake', null, { players: false, bosses: false });
    act.phase = 'emerge';
    act.emerge = 1.1;
    this.setAnim(b, 'emerge');
  }
  // A line of spikes bursting out of the ground one after another (frost wraith, earth spine).
  spikeLine(x, z, angle, length, spec) {
    for (let d = 2; d <= length; d += 1.8)
      this.queue({ type: 'spike', x: x + Math.sin(angle) * d, z: z + Math.cos(angle) * d, at: (d / length) * 0.6, ...spec });
  }
  queue(q) {
    this.pending.push({ ...q, y: groundHeight(q.x, q.z, this.a.map) + (q.type === 'spike' ? 0 : 1) });
  }
  // Blasts queued by a cataclysm or a line of ruin: one goes off at a time, so a whole quarter of the map
  // comes apart in a rolling wave instead of a single frame-killing explosion. Spikes hit whoever stands on them.
  stepPending(dt) {
    for (let n = this.pending.length - 1; n >= 0; n--) {
      const q = this.pending[n];
      q.at -= dt;
      if (q.at > 0) continue;
      this.pending.splice(n, 1);
      if (q.type === 'spike') this.spike(q);
      else if (q.boss) this.bossBlast(q.boss, q.x, q.y, q.z, q.radius, q.damage, q.cause || 'explosion');
      else this.a.blast(q.x, q.y, q.z, q.radius, q.damage, q.owner?.hp > 0 ? q.owner : null, q.cause || 'explosion');
    }
  }
  spike(q) {
    const a = this.a,
      owner = q.owner?.hp > 0 ? q.owner : null;
    for (const p of a.players) {
      if (p.hp <= 0 || p.inBus || hyp(p.x - q.x, p.z - q.z) > q.radius || p.y - q.y > 2.5 || q.y - p.y > 1.5) continue;
      if (owner && (p === owner || p.team === owner.team)) continue;
      if (q.boss) this.hurt(p, q.damage, q.boss);
      else a.damage(owner, p, q.damage);
      p.vy = Math.max(p.vy || 0, 7);
      if (q.chill) p.frozen = Math.max(p.frozen || 0, q.chill);
    }
    if (owner) for (const b of this.alive()) if (hyp(b.x - q.x, b.z - q.z) < q.radius + bossWidth(b.kind) / 2) this.damage(b, q.damage * 2, owner);
    // The spikes split trees, rocks and whatever else stands in the line.
    a.blast(q.x, q.y + 0.6, q.z, q.radius, q.boss ? 60 : 120, owner, 'spike', null, { players: false, bosses: false, silent: true });
    a.events.push({ type: 'spike', kind: q.kind, x: q.x, y: q.y, z: q.z, r: q.radius });
  }
  fire(b, to, s, target = null) {
    const from = { x: b.x + Math.sin(b.angle) * 1.1, y: b.y + bossHeight(b.kind) * 0.62, z: b.z + Math.cos(b.angle) * 1.1 };
    to = { x: to.x, y: (to.y ?? 0) + 1.1, z: to.z };
    for (let i = 0; i < s.count; i++) {
      const spread = (i - (s.count - 1) / 2) * (s.spread || 0.12),
        dx = to.x - from.x,
        dz = to.z - from.z,
        h = hyp(dx, dz) || 1,
        ang = Math.atan2(dx, dz) + spread;
      let vx, vy, vz;
      if (s.gravity) {
        // A lobbed shot: flat speed toward the target, and just enough lift to come down on it.
        const T = h / s.speed;
        vx = Math.sin(ang) * s.speed;
        vz = Math.cos(ang) * s.speed;
        vy = (to.y - from.y + 0.5 * s.gravity * T * T) / T;
      } else {
        const dir = direction(ang, Math.atan2(to.y - from.y, h));
        vx = dir.x * s.speed;
        vy = dir.y * s.speed;
        vz = dir.z * s.speed;
      }
      this.shots.push({ id: ++this.shotId, kind: s.kind, owner: b.id, target, x: from.x, y: from.y, z: from.z, vx, vy, vz, life: 3.2 });
    }
    this.a.events.push({ type: 'boss-cast', id: b.id, kind: s.kind, x: from.x, y: from.y, z: from.z });
  }
  stepShots(dt) {
    const a = this.a;
    for (let n = this.shots.length - 1; n >= 0; n--) {
      const r = this.shots[n],
        s = SHOT_SPECS[r.kind],
        b = this.list.find((q) => q.id === r.owner);
      if (s.homing) {
        const t = a.players.find((p) => p.id === r.target && p.hp > 0);
        if (t) {
          const want = { x: t.x - r.x, y: t.y + 1 - r.y, z: t.z - r.z },
            l = hyp(want.x, want.y, want.z) || 1,
            k = Math.min(1, s.homing * dt);
          r.vx += (want.x / l) * s.speed * k - r.vx * k;
          r.vy += (want.y / l) * s.speed * k - r.vy * k;
          r.vz += (want.z / l) * s.speed * k - r.vz * k;
        }
      }
      if (s.gravity) r.vy -= s.gravity * dt;
      const speed = hyp(r.vx, r.vy, r.vz) || 1,
        dir = { x: r.vx / speed, y: r.vy / speed, z: r.vz / speed },
        len = speed * dt,
        cast = castMap(r, dir, len, a.map, null, true);
      let distance = cast.distance,
        victim = null;
      for (const p of a.players) {
        if (p.hp <= 0 || p.inBus) continue;
        const d = rayBox(r, dir, { x: p.x - 0.45, y: p.y, z: p.z - 0.45 }, { x: p.x + 0.45, y: p.y + 1.9, z: p.z + 0.45 }, len);
        if (d <= distance) {
          distance = d;
          victim = p;
        }
      }
      r.x += dir.x * distance;
      r.y += dir.y * distance;
      r.z += dir.z * distance;
      r.life -= dt;
      const hit = victim || distance < len || r.life <= 0 || Math.abs(r.x) > a.map.limit.x || Math.abs(r.z) > a.map.limit.z;
      if (!hit) continue;
      this.shots.splice(n, 1);
      const owner = b || { id: r.owner, kind: 'fire' };
      if (s.radius) this.bossBlast(owner, r.x - dir.x * 0.1, r.y - dir.y * 0.1, r.z - dir.z * 0.1, s.radius, s.damage, r.kind);
      else {
        if (victim) {
          this.hurt(victim, s.damage, owner);
          if (s.chill) victim.frozen = Math.max(victim.frozen || 0, s.chill * 0.5);
          if (s.web) victim.webbed = Math.max(victim.webbed || 0, s.web);
        }
        a.events.push({ type: 'boss-impact', kind: r.kind, x: r.x, y: r.y, z: r.z, hit: !!victim });
      }
    }
  }
  stepHazards(dt) {
    const a = this.a;
    for (let n = this.hazards.length - 1; n >= 0; n--) {
      const h = this.hazards[n];
      h.time -= dt;
      if (h.time <= 0) {
        this.hazards.splice(n, 1);
        if (h.implode) this.implode(h);
        continue;
      }
      const owner = a.players.find((p) => p.id === h.owner) || null;
      for (const p of a.players) {
        if (p.hp <= 0 || p.team === h.team || p.inBus || Math.abs(p.y - h.y) > 3) continue;
        const d = hyp(p.x - h.x, p.z - h.z);
        if (d > h.r + 0.6) continue;
        // A gravity well drags everyone toward its middle before it collapses.
        if (h.pull && d > 0.4) {
          const k = h.pull * (0.6 + 0.4 * (1 - d / h.r));
          p.push = { x: ((h.x - p.x) / d) * k, z: ((h.z - p.z) / d) * k };
        }
        if (h.dps) a.damage(owner, p, h.dps * dt, owner ? null : h.owner);
      }
      if (owner && h.dps)
        for (const b of this.list) if (b.hp > 0 && hyp(b.x - h.x, b.z - h.z) < h.r + 1) this.damage(b, h.dps * 2.5 * dt, owner);
    }
  }
  // NULL · GRAVITY WELL: the well collapses on whoever it has pulled in.
  implode(h) {
    const a = this.a,
      b = this.list.find((q) => q.id === h.owner) || { id: h.owner, kind: 'void' };
    for (const p of a.players) {
      if (p.hp <= 0 || p.inBus || hyp(p.x - h.x, p.z - h.z) > h.implode.r || Math.abs(p.y - h.y) > 3) continue;
      this.hurt(p, h.implode.damage, b);
      this.knock(p, h.x, h.z, 7, 6);
    }
    a.events.push({ type: 'implode', id: h.owner, x: h.x, y: h.y, z: h.z, r: h.implode.r });
  }
  // ——— Relic abilities ———
  use(p, index) {
    const relic = p.relic && RELICS[p.relic.id],
      ability = relic?.abilities[index];
    if (!ability || p.hp <= 0 || p.relic.cd[index] > 0 || p.frozen > 0) return false;
    const ok = this[ability.id]?.(p);
    if (ok === false) return false;
    p.relic.cd[index] = ability.cd;
    this.a.events.push({ type: 'ability', id: p.id, ability: ability.id, x: p.x, y: p.y, z: p.z });
    return true;
  }
  ring(p) {
    this.hazards.push({ id: ++this.shotId, kind: 'ring', x: p.x, z: p.z, y: p.y, r: 6.5, time: 6, max: 6, owner: p.id, team: p.team, dps: 24 });
  }
  summon(p) {
    const a = this.a;
    for (let k = 0; k < 2; k++) {
      const id = 'helper-' + p.id + '-' + ++this.shotId,
        h = a.addPlayer(id, 'HELPER', true, { force: true });
      if (!h) continue;
      const side = k ? 1 : -1,
        x = p.x + Math.sin(p.angle + side * 1.2) * 2,
        z = p.z + Math.cos(p.angle + side * 1.2) * 2;
      Object.assign(h, { helperOf: p.id, expires: HELPER_TIME, team: p.team, squad: 'helpers:' + p.id, hp: 70 });
      a.place(h, x, z);
    }
  }
  // The enemy (or boss) closest to the crosshair within 70 m and in view.
  aimed(p, cone = 0.35, range = 70) {
    const eye = { x: p.x, y: p.y + EYE_HEIGHT, z: p.z },
      dir = direction(p.angle, p.pitch);
    let best = null,
      score = cone;
    const consider = (o, y, isBoss) => {
      const to = { x: o.x - eye.x, y: y - eye.y, z: o.z - eye.z },
        l = hyp(to.x, to.y, to.z);
      if (l > range || l < 0.5) return;
      const off = Math.acos(Math.min(1, (to.x * dir.x + to.y * dir.y + to.z * dir.z) / l));
      if (off >= score) return;
      if (castMap(eye, { x: to.x / l, y: to.y / l, z: to.z / l }, l, this.a.map, null, true).distance < l - 0.6) return;
      score = off;
      best = { o, isBoss };
    };
    for (const o of this.a.enemies(p)) consider(o, o.y + 1.2, false);
    for (const b of this.alive()) consider(b, b.y + bossHeight(b.kind) * 0.6, true);
    return best;
  }
  // VENOM FANG · VENOM POOL: a pool of venom where you aim (up to 26 m), burning enemies who stand in it.
  venom(p) {
    const a = this.a,
      eye = { x: p.x, y: p.y + EYE_HEIGHT, z: p.z },
      dir = direction(p.angle, Math.min(p.pitch, -0.05)),
      cast = castMap(eye, dir, 26, a.map, null, true),
      reach = Math.min(cast.distance, 26),
      x = clampTo(eye.x + dir.x * reach, 0, a.map.limit.x - 1),
      z = clampTo(eye.z + dir.z * reach, 0, a.map.limit.z - 1),
      y = groundHeight(x, z, a.map);
    this.hazards.push({ id: ++this.shotId, kind: 'poison', x, z, y, r: 4.5, time: 6, max: 6, owner: p.id, team: p.team, dps: 14 });
    a.events.push({ type: 'venom', id: p.id, x, y, z, fx: eye.x, fy: eye.y - 0.3, fz: eye.z });
  }
  // VENOM FANG · POUNCE: a long spider's leap in the direction you look.
  pounce(p) {
    if (p.inBus || p.dropping) return false;
    const f = { x: Math.sin(p.angle), z: Math.cos(p.angle) };
    p.push = { x: f.x * 17, z: f.z * 17 };
    p.vy = Math.max(p.vy || 0, 7.5);
    p.grounded = false;
    this.a.events.push({ type: 'pounce', id: p.id, x: p.x, y: p.y, z: p.z, angle: p.angle });
  }
  // EARTH SPINE · ERUPTION: a line of stone spikes bursts out of the ground ahead of you.
  eruption(p) {
    this.spikeLine(p.x, p.z, p.angle, 22, { kind: 'earth', damage: 45, radius: 1.7, owner: p });
  }
  portalA(p) {
    return this.placePortal(p, 'a');
  }
  portalB(p) {
    return this.placePortal(p, 'b');
  }
  // Portals go on walls or floors (not ceilings) within 60 m; one blue (a) and one orange (b) per owner.
  placePortal(p, which) {
    const eye = { x: p.x, y: p.y + EYE_HEIGHT, z: p.z },
      dir = direction(p.angle, p.pitch),
      cast = castMap(eye, dir, 60, this.a.map, null, true);
    if (!cast.impact || cast.distance >= 60) return false;
    const n = { x: cast.impact.x, y: cast.impact.y, z: cast.impact.z };
    if (n.y < -0.5) return false;
    const floor = n.y > 0.6,
      hit = { x: eye.x + dir.x * cast.distance, y: eye.y + dir.y * cast.distance, z: eye.z + dir.z * cast.distance };
    const portal = floor
      ? { x: hit.x, y: hit.y + 0.03, z: hit.z, nx: 0, ny: 1, nz: 0 }
      : (() => {
          const nl = hyp(n.x, n.z) || 1,
            nx = n.x / nl,
            nz = n.z / nl,
            ground = groundHeight(hit.x + nx * 0.8, hit.z + nz * 0.8, this.a.map);
          return { x: hit.x + nx * 0.04, y: Math.max(hit.y, ground + 1.15), z: hit.z + nz * 0.04, nx, ny: 0, nz };
        })();
    const pair = (this.portals[p.id] ||= {});
    pair[which] = portal;
    this.a.events.push({ type: 'portal', id: p.id, which, ...portal });
  }
  portalTravel(p) {
    if (p.portalCd > 0) return;
    for (const [owner, pair] of Object.entries(this.portals)) {
      if (!pair.a || !pair.b) continue;
      for (const [from, to] of [
        [pair.a, pair.b],
        [pair.b, pair.a],
      ]) {
        const floor = from.ny > 0.5;
        let inside;
        if (floor) inside = Math.abs(p.y - from.y) < 0.45 && hyp(p.x - from.x, p.z - from.z) < 0.85;
        else {
          const qx = p.x - from.x,
            qy = p.y + 0.9 - from.y,
            qz = p.z - from.z,
            along = qx * from.nx + qz * from.nz,
            lat = hyp(qx - from.nx * along, qz - from.nz * along);
          inside = along > -0.3 && along < 0.55 && lat < 0.7 && Math.abs(qy) < 1.2;
        }
        if (!inside) continue;
        this.teleport(p, from, to, owner);
        return;
      }
    }
  }
  teleport(p, from, to, owner) {
    const a = this.a,
      fall = Math.max(Math.abs(Math.min(0, p.vy || 0)), 4),
      toFloor = to.ny > 0.5,
      fromFloor = from.ny > 0.5;
    let x, y, z;
    if (toFloor) {
      x = to.x;
      z = to.z;
      y = to.y + 0.25;
      p.vy = Math.min(20, fromFloor ? fall : 6);
    } else {
      x = to.x + to.nx * 0.8;
      z = to.z + to.nz * 0.8;
      y = Math.max(groundHeight(x, z, a.map), to.y - 1.1);
      if (fromFloor) p.push = { x: to.nx * Math.min(16, fall), z: to.nz * Math.min(16, fall) };
      else p.vy = 0;
    }
    // Keep the view relative to the portals: walking into one wall portal, you walk out of the other.
    if (!fromFloor && !toFloor) {
      const inYaw = Math.atan2(-from.nx, -from.nz),
        outYaw = Math.atan2(to.nx, to.nz);
      p.angle += outYaw - inYaw;
      if (p.push) {
        const c = Math.cos(outYaw - inYaw),
          s = Math.sin(outYaw - inYaw);
        p.push = { x: p.push.x * c + p.push.z * s, z: -p.push.x * s + p.push.z * c };
      }
    } else if (!toFloor) p.angle = Math.atan2(to.nx, to.nz);
    p.portalCd = 0.5;
    a.events.push({ type: 'teleport', id: p.id, owner, x: p.x, y: p.y, z: p.z, tx: x, ty: y, tz: z, angle: p.angle });
    a.place(p, x, z, y);
    a.world.propagateModifiedBodyPositionsToColliders();
    p.grounded = false;
  }
  // Bots use relics too: the ring of fire up close, helpers, venom, the pounce and the eruption when fighting.
  // Returns an ability index.
  botChoice(p, target, distance) {
    if (!p.relic || !target) return -1;
    const ids = RELICS[p.relic.id].abilities.map((a) => a.id),
      ready = (id) => ids.includes(id) && p.relic.cd[ids.indexOf(id)] <= 0;
    if (ready('ring') && distance < 6) return ids.indexOf('ring');
    if (ready('summon') && distance < 25) return ids.indexOf('summon');
    if (ready('venom') && distance > 4 && distance < 22) return ids.indexOf('venom');
    if (ready('eruption') && distance < 18) return ids.indexOf('eruption');
    if (ready('pounce') && distance > 9 && distance < 20) return ids.indexOf('pounce');
    return -1;
  }
  snapshot() {
    return {
      // Only what clients draw: the AI's cooldowns, home and move bookkeeping stay here.
      bosses: this.list.map((b) => ({
        id: b.id,
        kind: b.kind,
        name: b.name,
        x: b.x,
        y: b.y,
        z: b.z,
        angle: b.angle,
        anim: b.anim,
        seq: b.seq,
        hp: b.hp,
        maxHp: b.maxHp,
        target: b.target,
        frozen: b.frozen,
        confused: b.confused,
        under: b.under,
        rage: b.rage,
        hitAt: b.hitAt,
        respawn: Number.isFinite(b.respawn) ? b.respawn : -1,
      })),
      bossShots: this.shots.map((s) => ({ id: s.id, kind: s.kind, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz })),
      hazards: this.hazards.map(({ implode, ...h }) => ({ ...h, implode: !!implode })),
      portals: Object.fromEntries(Object.entries(this.portals).map(([k, v]) => [k, { a: v.a ? { ...v.a } : null, b: v.b ? { ...v.b } : null }])),
      relics: this.drops.map((d) => ({ ...d })),
    };
  }
}
function turn(from, to, max) {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-max, Math.min(max, diff));
}
function clampTo(v, centre, half) {
  return Math.max(centre - half, Math.min(centre + half, v));
}
function boxNear(o, x, z, r) {
  return Math.abs(o.x - x) < o.w / 2 + r && Math.abs(o.z - z) < o.d / 2 + r;
}
