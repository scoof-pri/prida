// The tutorial (0.27): a solo walk-through of the basics on the district map, one step at a time. It drives a local
// Arena in 'tutorial' mode (no storm, no timer, no rewards): it sets out target dummies, a legendary chest and a
// launch pad, and watches the simulation's events and the player to tick each step off. No DOM here (main.js draws
// the panel), so the whole walk-through runs in the tests.
import { groundHeight } from './terrain.js';
import { castMap } from './raycast.js';
import { WEAPONS } from './catalog.js';
import { makeItem, addItem } from './items.js';

const idx = (model) => WEAPONS.findIndex((w) => w.model === model);
// Every step: a title, the text (touch controls differ), what it sets out when it starts, and when it is done.
export const TUTORIAL_STEPS = [
  {
    id: 'move',
    title: 'MOVE AND LOOK',
    text: (touch) => (touch ? 'Drag the left stick to walk; drag on the right half of the screen to look around.' : 'W A S D to walk, the mouse to look around.'),
    done: (t) => t.moved > 7,
  },
  {
    id: 'sprint',
    title: 'SPRINT AND JUMP',
    text: (touch) => (touch ? 'Push the stick all the way to sprint, and tap ↑ to jump.' : 'Hold Shift to sprint, press Space to jump. Sprinting uses stamina.'),
    done: (t) => t.sprinted > 0.7 && t.jumped,
  },
  {
    id: 'punch',
    title: 'BARE HANDS',
    text: (touch) => `Everyone drops in with nothing but their fists. Walk up to the target and punch it (${touch ? 'the fire button' : 'left mouse button'}).`,
    setup: 'dummyNear',
    done: (t) => t.punched,
  },
  {
    id: 'chest',
    title: 'OPEN A CHEST',
    text: (touch) => `Follow the golden beam to the legendary chest and open it (${touch ? 'the hand button' : 'E'}). Chests hold a weapon and an item; the rarer the chest, the better.`,
    setup: 'chest',
    done: (t) => t.looted,
  },
  {
    id: 'shoot',
    title: 'TAKE AIM',
    text: (touch) =>
      touch
        ? 'Tap the rifle in your belt and knock down the target. The ↻ button reloads.'
        : 'Take the rifle (2, or the mouse wheel) and knock down the target. Right mouse button aims, R reloads.',
    setup: 'dummyFar',
    done: (t) => t.killed,
  },
  {
    id: 'shield',
    title: 'SHIELDS AND HEALS',
    text: (touch) => `Your armour bar is empty. Take the shield cell from your belt and ${touch ? 'press fire' : 'press the left mouse button'} to drink it. Switching away cancels.`,
    done: (t) => t.armor > 0,
  },
  {
    id: 'pad',
    title: 'LAUNCH PAD',
    text: (touch) => `A launch pad is in your belt. Take it, ${touch ? 'press fire' : 'click'} to set it down, then step on it: the glider opens on the way down.`,
    setup: 'pad',
    done: (t) => t.launched,
  },
  {
    id: 'inventory',
    title: 'INVENTORY AND MAP',
    text: (touch) => `Open the inventory (${touch ? 'the bag button' : 'I'}): your belt, your supplies, the map.`,
    done: (t) => t.inventory,
  },
  {
    id: 'done',
    title: 'READY TO DROP',
    text: () =>
      'In a royale you jump out of the battle bus, loot fast and stay inside the safe zone as it shrinks. Four bosses guard the wilds: beat one for its relic (F and G use it). Last one standing wins.',
  },
];

export class Tutorial {
  constructor(sim, playerId = 'you', touch = false) {
    this.sim = sim;
    this.id = playerId;
    this.touch = touch;
    this.index = -1;
    this.t = { moved: 0, sprinted: 0, jumped: false, punched: false, looted: false, killed: false, armor: 0, launched: false, inventory: false };
    this.last = null;
    this.dummies = [];
    this.stepTime = 0;
    this.next();
  }
  get player() {
    return this.sim.players.find((p) => p.id === this.id);
  }
  get step() {
    return TUTORIAL_STEPS[this.index] || null;
  }
  get finished() {
    return this.step?.id === 'done';
  }
  // What the panel shows.
  view() {
    const s = this.step;
    return s && { index: this.index, count: TUTORIAL_STEPS.length, id: s.id, title: s.title, text: s.text(this.touch), finished: this.finished };
  }
  next() {
    if (this.index >= TUTORIAL_STEPS.length - 1) return;
    this.index++;
    this.stepTime = 0;
    // Walking and jumping count from the step that asks for them.
    Object.assign(this.t, { moved: 0, sprinted: 0, jumped: false });
    const s = this.step;
    if (s.setup) this[s.setup]();
    // Anything the step needs may already be done (the chest opened early, the shield drunk).
    return s;
  }
  skip() {
    const s = this.step;
    if (!s || this.finished) return;
    // Skipping still hands over what later steps need.
    if (s.id === 'chest' && !this.t.looted) {
      const p = this.player;
      addItem(p, makeItem(idx('rifle'), 2));
      addItem(p, makeItem(idx('shieldcell'), 1));
      this.sim.syncHeld(p);
      this.t.looted = true;
    }
    this.next();
  }
  // Called after every simulation step with its events, and by the page when the inventory opens.
  update(dt, events = []) {
    const p = this.player;
    if (!p) return false;
    this.stepTime += dt;
    if (this.last && p.hp > 0) {
      const d = Math.hypot(p.x - this.last.x, p.z - this.last.z);
      if (d < 3) this.t.moved += d;
      if (p.sprinting) this.t.sprinted += dt;
      if (!p.grounded && p.y > this.last.y + 0.05 && !p.launched) this.t.jumped = true;
    }
    this.last = { x: p.x, y: p.y, z: p.z };
    this.t.armor = p.armor;
    for (const e of events) {
      if (e.type === 'melee' && e.id === this.id && e.hit) this.t.punched = true;
      if (e.type === 'loot' && e.id === this.id && e.chest === 'tut-chest') this.t.looted = true;
      if (e.type === 'kill' && e.by === this.id && this.dummies.includes(e.victim)) this.t.killed = true;
      if (e.type === 'pad' && e.id === this.id) this.t.launched = true;
    }
    // Knocked-down dummies go away instead of respawning somewhere on the map.
    for (const d of [...this.dummies]) {
      const q = this.sim.players.find((o) => o.id === d);
      if (!q || q.hp <= 0) {
        this.sim.removePlayer(d);
        this.dummies = this.dummies.filter((x) => x !== d);
      }
    }
    const s = this.step;
    if (s?.done?.(this.t)) {
      this.next();
      return true;
    }
    return false;
  }
  inventoryOpened() {
    this.t.inventory = true;
  }
  // A clear spot about `dist` metres ahead of the player (tries a few directions round the way they face).
  spotAhead(dist) {
    const p = this.player,
      map = this.sim.map;
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI]) {
      const a = p.angle + off,
        dir = { x: Math.sin(a), y: 0, z: Math.cos(a) },
        from = { x: p.x, y: p.y + 1, z: p.z };
      if (castMap(from, dir, dist + 1.5, map, null, true).distance < dist + 1.4) continue;
      const x = p.x + dir.x * dist,
        z = p.z + dir.z * dist,
        y = groundHeight(x, z, map);
      if (Math.abs(x) > map.limit.x - 3 || Math.abs(z) > map.limit.z - 3 || Math.abs(y - p.y) > 1.2) continue;
      return { x, z, y, angle: a };
    }
    return { x: p.x + Math.sin(p.angle) * dist, z: p.z + Math.cos(p.angle) * dist, y: p.y, angle: p.angle };
  }
  dummy(dist) {
    const at = this.spotAhead(dist),
      id = 'dummy' + (this.dummies.length + this.index),
      q = this.sim.addPlayer(id, 'TARGET', true, { force: true });
    if (!q) return null;
    q.dummy = true;
    q.hp = 100;
    this.sim.place(q, at.x, at.z);
    // Facing the player.
    q.angle = at.angle + Math.PI;
    this.dummies.push(id);
    return q;
  }
  dummyNear() {
    this.dummy(3.2);
  }
  dummyFar() {
    this.dummy(13);
  }
  chest() {
    const at = this.spotAhead(9),
      old = this.sim.chests.findIndex((c) => c.id === 'tut-chest');
    if (old >= 0) this.sim.chests.splice(old, 1);
    this.sim.chests.push({ id: 'tut-chest', x: at.x, z: at.z, y: at.y, tier: 'legendary', opened: false, loot: { w: idx('rifle'), r: 2 }, extra: { w: idx('shieldcell'), r: 1 }, medkits: 0, armor: 0, plate: null, gear: null });
  }
  pad() {
    const p = this.player;
    addItem(p, makeItem(idx('launchpad')));
    this.sim.syncHeld(p);
  }
  dispose() {
    for (const d of this.dummies) this.sim.removePlayer(d);
    this.dummies = [];
  }
}
