// Bosses and their relics. Bosses guard lairs in the wild biomes (see world.js LAIRS); each drops a relic
// with special abilities when defeated:
//   VIS · STRENGTH COLOSSUS (forest) → TITAN GLOVES: every melee hit is a one-shot kill, plus a ground quake
//   IGNIS · FIRE GOLEM (desert)      → EMBER CORE: ring of fire around you, summon two helper bots
//   NOEMA · MIND ORACLE (glade)      → MIND CROWN: replace an enemy's sight with a flashback of their own past
//   ENTROPIA · CHAOS HERALD (meadow) → CHAOS SHARD: once a match, blow up half the map; or a line of ruin ahead
//   NULL · VOID WARDEN (lake)        → VOID PORTAL GUN: a blue and an orange portal, like Portal
// The simulation owns all of it (authoritative online); clients only draw the snapshot.
import { groundHeight } from './terrain.js';
import { castMap } from './raycast.js';
import { rayBox, direction, EYE_HEIGHT } from './combat.js';
import { lineClear } from './world.js';

export const BOSSES = {
  might: { name: 'VIS', title: 'STRENGTH COLOSSUS', hp: 2400, relic: 'gloves', speed: 2.8, color: 0xe0a33c },
  fire: { name: 'IGNIS', title: 'FIRE GOLEM', hp: 1800, relic: 'ember', speed: 3.1, color: 0xff6a2a },
  mind: { name: 'NOEMA', title: 'MIND ORACLE', hp: 1400, relic: 'crown', speed: 2.6, float: 1.1, color: 0xb482ff },
  chaos: { name: 'ENTROPIA', title: 'CHAOS HERALD', hp: 2000, relic: 'shard', speed: 3.2, float: 0.6, color: 0x38e0b0 },
  void: { name: 'NULL', title: 'VOID WARDEN', hp: 1600, relic: 'portal', speed: 3.4, color: 0x6a4cff },
};
export const BOSS_SHOTS = {
  might: { kind: 'boulder', speed: 17, damage: 26, radius: 3, every: 3, count: 1 },
  fire: { kind: 'fireball', speed: 19, damage: 22, radius: 2.6, every: 2.4, count: 1 },
  mind: { kind: 'psy', speed: 15, damage: 16, radius: 0, every: 1.7, count: 1, homing: 1.4 },
  chaos: { kind: 'entropy', speed: 22, damage: 18, radius: 2.2, every: 2, count: 2 },
  void: { kind: 'void', speed: 24, damage: 20, radius: 0, every: 2.1, count: 1 },
};
export const RELICS = {
  gloves: {
    name: 'TITAN GLOVES',
    boss: 'might',
    color: 0xe0a33c,
    // The gloves' real power is passive: any melee hit kills outright (see Arena.melee).
    passive: 'ONE-SHOT MELEE',
    abilities: [{ id: 'quake', label: 'QUAKE', cd: 14 }],
  },
  ember: {
    name: 'EMBER CORE',
    boss: 'fire',
    color: 0xff6a2a,
    abilities: [
      { id: 'ring', label: 'RING OF FIRE', cd: 16 },
      { id: 'summon', label: 'HELPERS', cd: 40 },
    ],
  },
  crown: { name: 'MIND CROWN', boss: 'mind', color: 0xb482ff, abilities: [{ id: 'flashback', label: 'FLASHBACK', cd: 24 }] },
  shard: {
    name: 'CHAOS SHARD',
    boss: 'chaos',
    color: 0x38e0b0,
    abilities: [
      { id: 'cataclysm', label: 'CATACLYSM · ONCE', cd: 1e9, once: true },
      { id: 'rift', label: 'LINE OF RUIN', cd: 30 },
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
};
export const BOSS_HEIGHT = 3.4;
export const BOSS_WIDTH = 1.6;
export const FLASHBACK_TIME = 5;
export const HELPER_TIME = 25;
const MELEE = { range: 3.4, damage: 28, every: 1.5 };
const AGGRO = 26;
const LEASH = 30;
const hyp = Math.hypot;

export class BossSystem {
  constructor(arena) {
    this.a = arena;
    const scale = arena.mode === 'duel' ? 0.7 : arena.size === 'city' ? 1.25 : 1;
    this.list = arena.map.lairs.map((l) => {
      const park = arena.map.parks.find((p) => Math.abs(p.x - l.x) < 1 && Math.abs(p.z - l.z) < 1),
        info = BOSSES[l.boss];
      return {
        id: 'boss:' + l.boss,
        kind: l.boss,
        name: info.name + ' · ' + info.title,
        home: { x: l.x, z: l.z },
        bounds: park ? { x: park.w / 2 - 2.5, z: park.d / 2 - 2.5 } : { x: 20, z: 20 },
        maxHp: Math.round(info.hp * scale),
        hp: Math.round(info.hp * scale),
        x: l.x,
        z: l.z,
        y: groundHeight(l.x, l.z, arena.map) + (info.float || 0),
        angle: 0,
        anim: 'idle',
        animTime: 0,
        target: null,
        aggro: null,
        cd: { melee: 0, shot: 2, special: 6, think: 0 },
        frozen: 0,
        confused: 0,
        respawn: 0,
        windup: 0,
        hitAt: -9,
      };
    });
    this.shots = [];
    this.shotId = 0;
    this.hazards = [];
    this.portals = {};
    this.drops = [];
    this.dropId = 0;
    // Blasts that go off later: a cataclysm and a line of ruin roll across the map instead of firing at once.
    this.pending = [];
  }
  get time() {
    return this.a.tick / 60;
  }
  alive() {
    return this.list.filter((b) => b.hp > 0);
  }
  // Nearest boss a ray hits before `range`.
  ray(origin, dir, range) {
    let best = null,
      distance = range;
    for (const b of this.list) {
      if (b.hp <= 0) continue;
      const h = BOSS_WIDTH / 2,
        d = rayBox(origin, dir, { x: b.x - h, y: b.y, z: b.z - h }, { x: b.x + h, y: b.y + BOSS_HEIGHT, z: b.z + h }, distance);
      if (d < distance) {
        distance = d;
        best = b;
      }
    }
    return best ? { boss: best, distance } : null;
  }
  damage(b, amount, attacker = null) {
    if (!b || b.hp <= 0 || amount <= 0) return;
    // Bots chip bosses at half rate, like they hurt players.
    const dealt = Math.round(amount * (attacker?.bot ? 0.5 : 1) * (b.frozen > 0 ? 1.25 : 1));
    b.hp = Math.max(0, b.hp - dealt);
    b.hitAt = this.time;
    if (attacker && attacker.hp > 0) b.aggro = attacker.id;
    this.a.events.push({ type: 'boss-hit', id: b.id, x: b.x, y: b.y + BOSS_HEIGHT * 0.6, z: b.z, amount: dealt });
    if (b.hp === 0) {
      b.anim = 'death';
      b.animTime = 0;
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
      if (b.hp <= 0) continue;
      const d = hyp(b.x - x, b.y + BOSS_HEIGHT / 2 - y, b.z - z) - BOSS_WIDTH / 2;
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
  hurt(p, amount, b) {
    this.a.damage(null, p, amount, b.id);
  }
  step(dt) {
    const a = this.a;
    for (const b of this.list) this.stepBoss(b, dt);
    this.stepShots(dt);
    this.stepHazards(dt);
    this.stepPending(dt);
    for (const p of a.players) {
      if (p.frozen > 0) p.frozen = Math.max(0, p.frozen - dt);
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
    p.frozen = p.flashback = 0;
  }
  stepBoss(b, dt) {
    const a = this.a,
      info = BOSSES[b.kind];
    b.animTime += dt;
    if (b.hp <= 0) {
      b.respawn -= dt;
      if (b.respawn <= 0) {
        Object.assign(b, { hp: b.maxHp, x: b.home.x, z: b.home.z, anim: 'idle', animTime: 0, aggro: null, target: null });
        b.y = groundHeight(b.x, b.z, a.map) + (info.float || 0);
        a.events.push({ type: 'boss-spawn', id: b.id, x: b.x, y: b.y, z: b.z });
      }
      return;
    }
    for (const k in b.cd) b.cd[k] = Math.max(0, b.cd[k] - dt);
    b.frozen = Math.max(0, b.frozen - dt);
    b.confused = Math.max(0, b.confused - dt);
    const slow = b.frozen > 0 ? 0.3 : 1;
    // Strike landing after the wind-up.
    if (b.windup > 0) {
      b.windup -= dt * slow;
      if (b.windup <= 0) {
        for (const p of a.players)
          if (p.hp > 0 && hyp(p.x - b.x, p.z - b.z) < MELEE.range + 0.4 && Math.abs(p.y - b.y) < 3) {
            const d = hyp(p.x - b.x, p.z - b.z) || 1;
            this.hurt(p, MELEE.damage, b);
            p.push = { x: ((p.x - b.x) / d) * 9, z: ((p.z - b.z) / d) * 9 };
            p.vy = Math.max(p.vy || 0, 4.5);
          }
        a.events.push({ type: 'boss-slam', id: b.id, kind: b.kind, x: b.x + Math.sin(b.angle) * 1.8, y: b.y, z: b.z + Math.cos(b.angle) * 1.8 });
      }
      return;
    }
    if (b.anim !== 'idle' && b.anim !== 'walk' && b.animTime > 0.9) b.anim = 'idle';
    if (b.confused > 0) {
      b.anim = 'confused';
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
      const dist = hyp(t.x - b.x, t.z - b.z);
      b.angle = turn(b.angle, Math.atan2(t.x - b.x, t.z - b.z), 3.5 * dt * slow);
      if (dist > MELEE.range - 0.6) goal = t;
      if (dist < MELEE.range && b.cd.melee <= 0 && Math.abs(t.y - b.y) < 3) {
        b.cd.melee = MELEE.every;
        b.windup = 0.45;
        b.anim = 'attack';
        b.animTime = 0;
        return;
      }
      if (b.cd.special <= 0 && this.special(b, t, dist)) return;
      if (b.cd.shot <= 0 && dist > 4 && this.exposed(b, t)) {
        const s = BOSS_SHOTS[b.kind];
        b.cd.shot = s.every * (b.hp < b.maxHp * 0.4 ? 0.7 : 1);
        this.fire(b, t, s);
        b.anim = 'cast';
        b.animTime = 0;
      }
    }
    if (goal) {
      const dx = goal.x - b.x,
        dz = goal.z - b.z,
        d = hyp(dx, dz) || 1,
        v = info.speed * slow * (t ? 1 : 0.7) * dt;
      b.x = clampTo(b.x + (dx / d) * v, b.home.x, b.bounds.x);
      b.z = clampTo(b.z + (dz / d) * v, b.home.z, b.bounds.z);
      if (!t) b.angle = turn(b.angle, Math.atan2(dx, dz), 3 * dt);
      if (b.anim === 'idle') b.anim = 'walk';
    } else if (b.anim === 'walk') b.anim = 'idle';
    b.y = groundHeight(b.x, b.z, a.map) + (info.float || 0);
  }
  // Blasts queued by a cataclysm or a line of ruin: one goes off at a time, so a whole quarter of the map
  // comes apart in a rolling wave instead of a single frame-killing explosion.
  stepPending(dt) {
    for (let n = this.pending.length - 1; n >= 0; n--) {
      const q = this.pending[n];
      q.at -= dt;
      if (q.at > 0) continue;
      this.pending.splice(n, 1);
      this.a.blast(q.x, q.y, q.z, q.radius, q.damage, q.owner?.hp > 0 ? q.owner : null, q.cause || 'explosion');
    }
  }
  queueBlast(x, z, radius, damage, owner, delay, cause) {
    this.pending.push({ x, y: groundHeight(x, z, this.a.map) + 1, z, radius, damage, owner, at: delay, cause });
  }
  // Signature moves.
  special(b, t, dist) {
    const a = this.a;
    if (b.kind === 'might' && dist < 9) {
      b.cd.special = 12;
      this.quakeAt(b.x, b.z, 9, 26, null, b);
    } else if (b.kind === 'chaos' && dist < 26) {
      b.cd.special = 14;
      // A short line of ruin towards its target.
      const ang = Math.atan2(t.x - b.x, t.z - b.z);
      this.lineOfRuin(b.x, b.z, ang, 18, 5, 26, null, 'chaos');
      a.events.push({ type: 'rift', x: b.x, y: b.y, z: b.z, angle: ang, length: 18, by: b.id });
    } else if (b.kind === 'fire' && dist < 12) {
      b.cd.special = 11;
      this.hazards.push({ id: ++this.shotId, kind: 'ring', x: b.x, z: b.z, y: b.y, r: 6, time: 4.5, max: 4.5, owner: b.id, team: 'boss', dps: 20 });
      a.events.push({ type: 'fire-ring', x: b.x, y: b.y, z: b.z, r: 6 });
    } else if (b.kind === 'mind' && dist < 24 && this.exposed(b, t)) {
      b.cd.special = 15;
      t.flashback = FLASHBACK_TIME;
      a.events.push({ type: 'flashback', id: t.id, by: b.id, x: t.x, y: t.y, z: t.z });
    } else if (b.kind === 'void' && dist > 5 && dist < 22) {
      b.cd.special = 8;
      const back = t.angle + Math.PI,
        x = clampTo(t.x + Math.sin(back) * 3.5, b.home.x, b.bounds.x),
        z = clampTo(t.z + Math.cos(back) * 3.5, b.home.z, b.bounds.z);
      a.events.push({ type: 'blink', id: b.id, x: b.x, y: b.y, z: b.z, tx: x, ty: groundHeight(x, z, a.map), tz: z });
      b.x = x;
      b.z = z;
      b.angle = Math.atan2(t.x - x, t.z - z);
      b.cd.melee = 0.2;
    } else return false;
    b.anim = 'cast';
    b.animTime = 0;
    return true;
  }
  fire(b, t, s) {
    const from = { x: b.x + Math.sin(b.angle) * 1.1, y: b.y + BOSS_HEIGHT * 0.62, z: b.z + Math.cos(b.angle) * 1.1 },
      to = { x: t.x, y: t.y + 1.1, z: t.z };
    for (let i = 0; i < s.count; i++) {
      const spread = (i - (s.count - 1) / 2) * 0.12,
        dx = to.x - from.x,
        dz = to.z - from.z,
        h = hyp(dx, dz) || 1,
        ang = Math.atan2(dx, dz) + spread,
        pitch = Math.atan2(to.y - from.y, h),
        dir = direction(ang, pitch);
      this.shots.push({
        id: ++this.shotId,
        kind: s.kind,
        owner: b.id,
        target: t.id,
        x: from.x,
        y: from.y,
        z: from.z,
        vx: dir.x * s.speed,
        vy: dir.y * s.speed,
        vz: dir.z * s.speed,
        life: 3.2,
      });
    }
    this.a.events.push({ type: 'boss-cast', id: b.id, kind: s.kind, x: from.x, y: from.y, z: from.z });
  }
  stepShots(dt) {
    const a = this.a;
    for (let n = this.shots.length - 1; n >= 0; n--) {
      const r = this.shots[n],
        s = Object.values(BOSS_SHOTS).find((q) => q.kind === r.kind),
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
      const speed = hyp(r.vx, r.vy, r.vz) || 1,
        dir = { x: r.vx / speed, y: r.vy / speed, z: r.vz / speed },
        len = speed * dt,
        cast = castMap(r, dir, len, a.map, null, true);
      let distance = cast.distance,
        victim = null;
      for (const p of a.players) {
        if (p.hp <= 0) continue;
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
      if (s.radius) {
        for (const p of a.players)
          if (p.hp > 0) {
            const d = hyp(p.x - r.x, p.y + 0.9 - r.y, p.z - r.z);
            if (d < s.radius) this.hurt(p, Math.round(s.damage * (1 - (d / s.radius) * 0.6)), b || { id: r.owner });
          }
        a.events.push({ type: 'explosion', x: r.x, y: r.y, z: r.z, radius: s.radius, cause: r.kind });
      } else {
        if (victim) {
          this.hurt(victim, s.damage, b || { id: r.owner });
          if (s.chill) victim.frozen = Math.max(victim.frozen || 0, s.chill * 0.5);
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
        continue;
      }
      const owner = a.players.find((p) => p.id === h.owner) || null;
      // The ring burns everyone inside it except its caster's side.
      for (const p of a.players)
        if (p.hp > 0 && p.team !== h.team && hyp(p.x - h.x, p.z - h.z) < h.r + 0.6 && Math.abs(p.y - h.y) < 3)
          a.damage(owner, p, h.dps * dt, owner ? null : h.owner);
      if (owner)
        for (const b of this.list)
          if (b.hp > 0 && hyp(b.x - h.x, b.z - h.z) < h.r + 1) this.damage(b, h.dps * 2.5 * dt, owner);
    }
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
    for (const b of this.alive()) consider(b, b.y + BOSS_HEIGHT * 0.6, true);
    return best;
  }
  flashback(p) {
    const t = this.aimed(p);
    if (!t) return false;
    if (t.isBoss) t.o.confused = FLASHBACK_TIME;
    else t.o.flashback = FLASHBACK_TIME;
    this.a.events.push({ type: 'flashback', id: t.o.id, by: p.id, x: t.o.x, y: t.o.y, z: t.o.z });
  }
  // TITAN GLOVES · QUAKE: the ground bursts around you, throwing enemies off their feet.
  quake(p) {
    this.quakeAt(p.x, p.z, 10, 34, p, null);
  }
  quakeAt(x, z, radius, damage, owner, boss) {
    const a = this.a,
      y = groundHeight(x, z, a.map);
    for (const o of a.players) {
      if (o.hp <= 0 || o === owner || (owner && o.team === owner.team) || (boss && o.helperOf)) continue;
      const d = hyp(o.x - x, o.z - z);
      if (d > radius || Math.abs(o.y - y) > 4) continue;
      const k = 1 - (d / radius) * 0.7;
      if (owner) a.damage(owner, o, Math.round(damage * k));
      else this.hurt(o, Math.round(damage * k), boss);
      const n = d || 1;
      o.push = { x: ((o.x - x) / n) * 11 * k, z: ((o.z - z) / n) * 11 * k };
      o.vy = Math.max(o.vy || 0, 5.5 * k);
    }
    if (owner) for (const b of this.alive()) if (hyp(b.x - x, b.z - z) < radius + 1) this.damage(b, damage * 1.6, owner);
    // It cracks the ground and whatever stands on it.
    a.blast(x, y + 0.4, z, radius * 0.55, damage * 0.6, owner, 'quake');
    a.events.push({ type: 'quake', x, y, z, r: radius, by: owner?.id || boss?.id || null });
  }
  // CHAOS SHARD · CATACLYSM: once a match, half the location comes apart in a rolling wave of blasts.
  cataclysm(p) {
    const a = this.a,
      reach = Math.min(70, Math.max(a.map.limit.x, a.map.limit.z) * 0.55),
      rings = 5;
    a.events.push({ type: 'cataclysm', id: p.id, x: p.x, y: p.y, z: p.z, r: reach });
    for (let i = 1; i <= rings; i++) {
      const r = (reach * i) / rings,
        count = 4 + i * 3;
      for (let k = 0; k < count; k++) {
        const ang = (k / count) * Math.PI * 2 + i * 0.7,
          x = p.x + Math.sin(ang) * r,
          z = p.z + Math.cos(ang) * r;
        if (Math.abs(x) > a.map.limit.x - 2 || Math.abs(z) > a.map.limit.z - 2) continue;
        this.queueBlast(x, z, 9, 90, p, i * 0.45 + k * 0.02, 'cataclysm');
      }
    }
  }
  // CHAOS SHARD · LINE OF RUIN: everything in a corridor ahead of you is torn open.
  rift(p) {
    const ang = p.angle;
    this.lineOfRuin(p.x, p.z, ang, 46, 7, 70, p, 'rift');
    this.a.events.push({ type: 'rift', id: p.id, x: p.x, y: p.y, z: p.z, angle: ang, length: 46, by: p.id });
  }
  lineOfRuin(x, z, angle, length, radius, damage, owner, cause) {
    const step = radius * 0.8;
    for (let d = radius; d <= length; d += step)
      this.queueBlast(x + Math.sin(angle) * d, z + Math.cos(angle) * d, radius, damage, owner, (d / length) * 0.9, cause);
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
    } else if (toFloor && !fromFloor) p.angle = p.angle;
    else if (!toFloor) p.angle = Math.atan2(to.nx, to.nz);
    p.portalCd = 0.5;
    a.events.push({ type: 'teleport', id: p.id, owner, x: p.x, y: p.y, z: p.z, tx: x, ty: y, tz: z, angle: p.angle });
    a.place(p, x, z, y);
    a.world.propagateModifiedBodyPositionsToColliders();
    p.grounded = false;
  }
  // Bots use relics too: ring and nova up close, helpers and flashback when fighting. Returns an ability index.
  botChoice(p, target, distance) {
    if (!p.relic || !target) return -1;
    const ids = RELICS[p.relic.id].abilities.map((a) => a.id),
      ready = (id) => ids.includes(id) && p.relic.cd[ids.indexOf(id)] <= 0;
    if (ready('ring') && distance < 6) return ids.indexOf('ring');
    if (ready('quake') && distance < 8) return ids.indexOf('quake');
    if (ready('summon') && distance < 25) return ids.indexOf('summon');
    if (ready('flashback') && distance < 40) return ids.indexOf('flashback');
    // Bots only open a line of ruin, never a cataclysm — that one is the player's card to play.
    if (ready('rift') && distance > 8 && distance < 40) return ids.indexOf('rift');
    return -1;
  }
  snapshot() {
    return {
      bosses: this.list.map(({ cd, home, bounds, ...b }) => ({ ...b, respawn: Number.isFinite(b.respawn) ? b.respawn : -1 })),
      bossShots: this.shots.map((s) => ({ id: s.id, kind: s.kind, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz })),
      hazards: this.hazards.map((h) => ({ ...h })),
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
