import { ConstructionSystem, freshMaterials } from './construction.js';
import { DroneSystem } from './drone-system.js';
import { TechnologySystem, suitMovement } from './technology-system.js';
import { BotDecisionBudget } from './bot-budget.js';
import { EscalatorSystem } from './escalator-system.js';
import { LiftSystem } from './lift-system.js';
import { sweepVehicleContacts } from './vehicle-contact.js';
import { ColliderBudget } from './collider-budget.js';
import { VehicleSystem } from './vehicle-system.js';
import { initDoors, navigationMap, useDoor, stepDoors, doorSnapshot, damageDoor, destroyDoor, applyBlastHits } from './door-system.js';
import { groundHeight, terrainMesh, terrainRay } from './terrain.js';
import { castMap } from './raycast.js';
import { direction, rayBox, EYE_HEIGHT } from './combat.js';
import { stopWings } from './wings-physics.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, WEAPONS, lineClear, DEFAULT_SEED } from './world.js';
import {
  GEAR,
  weaponStats,
  makeItem,
  sanitizeLoadout,
  loadoutSlots,
  makeGear,
  addItem,
  bestItem,
  restockAmmo,
  LOADOUT_CHOICES,
  MAX_RARITY,
  carryWeight,
  wearArmor,
  startSlots,
  FISTS,
  rollChest,
} from './items.js';
import { Navigation } from './navigation.js';
import { BossSystem } from './bosses.js';
import { COSMETICS, appearance, pack as packCosmetics } from './cosmetics.js';
import { perks as skillPerks, unpackSkills, packSkills } from './skills.js';
// Clothing colour variations for bots (applied to uniform materials only, never to skin).
export const BOT_TINTS = 8;
const FINISHES = COSMETICS.filter((c) => c.kind === 'finish').map((c) => c.id);
import {
  removeObstacle,
  addObstacle,
  boxDistance,
  structure,
  rubbleFor,
  collapseParts,
  indexPanels,
  storeyStructure,
  storeyParts,
} from './destruction.js';
import {
  damageCells,
  cellsSupport,
  cellsBroken,
  cellRects,
  cellIndexAt,
  cellGrid,
  sphereHits,
  cutHits,
  encodeCells,
  isSlab,
  cellCenter,
} from './cells.js';
// Melee cuts in concrete: [length, height] in cells.
const CUTS = { knife: [2, 1], katana: [6, 1], shovel: [3, 2] };
let initialized;
export function initPhysics() {
  return (initialized ??= RAPIER.init());
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : 0));
export class Arena {
  constructor({ bots = 0, random = Math.random, seed = DEFAULT_SEED, mode = 'classic', allowCheats = false, size = 'district', bus = false, botEvery = 1, kit = 'fists' } = {}) {
    // What a life starts with. Since 0.27 everyone starts with bare hands ('fists') and finds everything else;
    // 'loadout' is the old start (the chosen weapons, gear and a medkit), kept for tests and experiments.
    this.kit = kit === 'loadout' ? 'loadout' : 'fists';
    // Servers think for bots every `botEvery` steps (their last decision is reused in between) to save CPU.
    this.botEvery = Math.max(1, Math.round(botEvery));
    this.random = random;
    this.map = createWorld(seed, size);
    this.size = this.map.size;
    this.nav = new Navigation(navigationMap(this.map));
    // `debug` is the solo sandbox: no storm, no timer, every item on tap. The server never creates it (server.mjs
    // builds arenas only from its own MODES table) and it turns rewards off, like any cheat.
    // `tutorial` (0.27) is the solo walk-through: no storm, no timer, no rewards, target dummies (tutorial.js).
    this.mode = ['survival', 'royale', 'duel', 'debug', 'tutorial'].includes(mode) ? mode : 'classic';
    // Respawning modes: Training / Arena (first to 10), Duel (1 v 1, first to 5) and the debug sandbox.
    this.respawns = this.mode === 'classic' || this.mode === 'duel' || this.mode === 'debug' || this.mode === 'tutorial';
    this.scoreLimit = this.mode === 'duel' ? 5 : 10;
    // Contenders: Mini Royale 10, the big city royale 24 (10 humans at most, the rest bots), duels 2.
    this.maxPlayers = this.mode === 'duel' ? 2 : this.mode === 'royale' ? (this.size === 'city' ? 24 : 10) : 64;
    // The safe zone starts around the whole map and closes over 220 s (district) or 400 s (city).
    this.zoneStart = Math.round(Math.hypot(this.map.limit.x, this.map.limit.z) + 12);
    this.royaleTime = this.map.tiled ? 720 : this.size === 'city' ? 480 : 240;
    this.allowCheats = allowCheats;
    this.cheated = this.mode === 'debug';
    this.zone = { x: 0, z: 0, radius: this.zoneStart };
    // A duel on the big city (0.28) is fought in a fixed ring round the city centre: step out and it hurts, and
    // both players spawn inside it within sight range of each other.
    if (this.mode === 'duel' && this.size === 'city') this.zone = { x: this.map.tiles?.[0]?.x || 0, z: this.map.tiles?.[0]?.z || 0, radius: 150, fixed: true };
    this.players = [];
    this.botCount = 0;
    this.bodies = new Map();
    this.time = this.mode === 'royale' ? this.royaleTime : 180;
    this.projectiles = [];
    this.projectileId = 0;
    // C4 charges already stuck to the world, waiting for their owner's detonator.
    this.charges = [];
    this.chargeId = 0;
    // Smoke clouds nobody can see through (smoke grenades).
    this.smokes = [];
    this.smokeId = 0;
    // Things players set down (0.27): launch pads, cover walls, campfires.
    this.deployables = [];
    this.deployId = 0;
    this.chests = this.map.chests.map((c) => ({ ...c, loot: { ...c.loot } }));
    this.dropId = 0;
    this.round = 1;
    this.winner = null;
    this.intermission = 0;
    this.events = [];
    this.tick = 0;
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;
    this.colliders = new Map();
    this.colliderBudget = new ColliderBudget(this, RAPIER, terrainMesh);
    for (const b of this.map.obstacles) this.addCollider(b);
    indexPanels(this.map);
    this.destruction = { panels: [], decor: [], buildings: [], wrecks: [], cells: {}, storeys: {}, props: [], roofs: [] };
    this.destroyedPanels = new Set(); // panels that no longer carry load (broken away or cut through)
    this.navDirty = false;
    const { x, z } = this.map.limit;
    if (!this.map.tiled) {
      const ground = terrainMesh(this.map);
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(ground.vertices, ground.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
    }
    for (const b of [
      { x: -x - 1, z: 0, w: 2, d: z * 2 + 4 },
      { x: x + 1, z: 0, w: 2, d: z * 2 + 4 },
      { x: 0, z: -z - 1, w: x * 2 + 4, d: 2 },
      { x: 0, z: z + 1, w: x * 2 + 4, d: 2 },
    ])
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, 12, b.d / 2).setTranslation(b.x, 12, b.z));
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setSlideEnabled(true);
    this.controller.enableSnapToGround(0.12);
    // Climb stair blocks (and kerbs) without jumping.
    this.controller.enableAutostep(0.42, 0.2, false);
    initDoors(this);
    this.lifts = new LiftSystem(this);
    this.escalators = new EscalatorSystem(this);
    this.vehicles = new VehicleSystem(this);
    this.bosses = new BossSystem(this);
    this.construction = new ConstructionSystem(this);
    this.drones = new DroneSystem(this);
    this.technology = new TechnologySystem(this);
    // Battle bus (royale): everyone starts aboard, flying across the map, and jumps out when they like.
    this.bus = null;
    if (bus && this.mode === 'royale') {
      const L = this.map.limit,
        a = this.random() * Math.PI * 2,
        dir = { x: Math.cos(a), z: Math.sin(a) },
        side = (this.random() - 0.5) * 0.5,
        reach = Math.min(L.x / Math.abs(dir.x || 1e-6), L.z / Math.abs(dir.z || 1e-6)) - 6,
        off = { x: -dir.z * side * L.x, z: dir.x * side * L.z },
        speed = this.size === 'city' ? 26 : 18;
      this.bus = {
        active: true,
        ax: off.x - dir.x * reach,
        az: off.z - dir.z * reach,
        bx: off.x + dir.x * reach,
        bz: off.z + dir.z * reach,
        y: this.size === 'city' ? 52 : 44,
        t: 0,
        duration: (reach * 2) / speed,
      };
      Object.assign(this.bus, this.busPoint(0));
      // The storm waits for the drop.
      this.royaleTime += Math.round(this.bus.duration + 10);
      this.time = this.royaleTime;
      this.zoneDelay = 20 + this.bus.duration + 10;
    }
    for (let i = 0; i < bots; i++)
      this.addPlayer('bot' + i, ['MICA', 'FLINT', 'SAGE', 'EMBER', 'COBALT', 'ONYX', 'JUNO', 'REED'][i % 8], true);
    this.world.step();
  }
  addCollider(o) {
    if (this.colliderBudget?.defer(o)) return;
    this.physicsDirty = true;
    // Small furniture only stops bullets; pre-cut slabs (stairwells) collide cell by cell.
    // Window glass stops people (not bullets' sight lines) until it shatters.
    if (o.nocollide && o.part !== 'glass') return this.colliders.set(o, null);
    if (o.roofShape) {
      const colliders = o.roofShape.map(shape => {
        const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(shape.vertices));
        if (!desc) throw Error('Invalid convex roof geometry for building ' + o.building);
        return this.world.createCollider(desc);
      });
      return this.colliders.set(o, colliders);
    }
    if (o.doorLeaf) {
      const p = o.doorLeaf;
      const desc = RAPIER.ColliderDesc.cuboid(p.w / 2, p.h / 2, p.t / 2)
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) });
      return this.colliders.set(o, this.world.createCollider(desc));
    }
    if (o.cells) return this.colliders.set(o, this.cellColliders(o));
    // A wall with a window: four boxes around the opening, so you can climb through once the glass is gone.
    if (o.hole) {
      const h = o.hole,
        ax = h.alongX,
        lo = ax ? o.x - o.w / 2 : o.z - o.d / 2,
        hi = ax ? o.x + o.w / 2 : o.z + o.d / 2,
        bottom = o.y - o.h / 2,
        top = o.y + o.h / 2,
        list = [];
      for (const [a0, a1, y0, y1] of [
        [lo, hi, bottom, h.y0],
        [lo, hi, h.y1, top],
        [lo, h.a0, h.y0, h.y1],
        [h.a1, hi, h.y0, h.y1],
      ]) {
        if (a1 - a0 < 0.01 || y1 - y0 < 0.01) continue;
        const a = (a0 + a1) / 2,
          y = (y0 + y1) / 2,
          desc = ax
            ? RAPIER.ColliderDesc.cuboid((a1 - a0) / 2, (y1 - y0) / 2, o.d / 2).setTranslation(a, y, o.z)
            : RAPIER.ColliderDesc.cuboid(o.w / 2, (y1 - y0) / 2, (a1 - a0) / 2).setTranslation(o.x, y, a);
        list.push(this.world.createCollider(desc));
      }
      return this.colliders.set(o, list);
    }
    const desc = RAPIER.ColliderDesc.cuboid(o.w / 2, o.h / 2, o.d / 2).setTranslation(o.x, o.y, o.z);
    if (o.rot) desc.setRotation({ x: 0, y: Math.sin(o.rot / 2), z: 0, w: Math.cos(o.rot / 2) });
    this.colliders.set(o, this.world.createCollider(desc));
  }
  noteSupportChange036(o) {
    this._supportRevision036 = (this._supportRevision036 || 0) + 1;
    const changes = (this._supportChanges036 ??= []);
    if (changes.length < 32) changes.push({ x:o.x, z:o.z, w:o.w, d:o.d });
    else this._supportAll036 = true;
  }
  removeObs(o) {
    if (o.vehicleId === undefined && o.doorId === undefined && o.liftId === undefined) this.noteSupportChange036(o);
    this.physicsDirty = true;
    const c = this.colliders.get(o);
    for (const x of Array.isArray(c) ? c : c ? [c] : []) this.world.removeCollider(x, false);
    this.colliders.delete(o);
    removeObstacle(this.map, o);
    this.navDirty = true;
  }
  addObs(o) {
    addObstacle(this.map, o);
    this.addCollider(o);
    this.navDirty = true;
  }
  // ---- Destruction -------------------------------------------------------------------------------
  damageObstacle(o, amount, attacker) {
    if (o.buildId !== undefined) return this.construction.damage(o.buildId,amount,attacker);
    if (o.droneId !== undefined) return this.drones.damage(o.droneId,amount,attacker);
    if (o.liftId !== undefined) return this.lifts.damage(o.liftId,amount);
    if (o.vehicleId !== undefined) return this.vehicles.damage(o.vehicleId, amount, attacker);
    if (o.doorId !== undefined) return damageDoor(this, o.doorId, amount, attacker);
    if (o.hp === undefined || o.hp <= 0 || !(amount > 0)) return;
    o.hp -= amount;
    if (o.hp <= 0) this.breakObstacle(o, attacker);
  }
  // Voxel wall damage: remove cells, rebuild the colliders around the holes, check what still stands.
  hitCells(o, hits, attacker) {
    if (!this.colliders.has(o) || o.panel === undefined || !hits.length) return 0;
    const removed = damageCells(o, hits);
    if (removed.length && isSlab(o)) this.noteSupportChange036(o);
    if (!removed.length) return 0;
    if (cellsBroken(o)) {
      this.breakObstacle(o, attacker);
      return removed.length;
    }
    this.destruction.cells[o.panel] = encodeCells(o);
    const old = this.colliders.get(o);
    for (const x of Array.isArray(old) ? old : [old]) this.world.removeCollider(x, false);
    this.colliders.set(o, this.cellColliders(o));
    if (isSlab(o)) this.slabHoles(o, removed, attacker);
    if (!this.destroyedPanels.has(o.panel) && !cellsSupport(o)) this.unsupported(o, attacker);
    return removed.length;
  }
  cellColliders(o) {
    if (this.colliderBudget?.defer(o)) return [];
    this.physicsDirty = true;
    return cellRects(o).map((r) =>
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(r.w / 2, r.h / 2, r.d / 2).setTranslation(r.x, r.y, r.z)),
    );
  }
  // Furniture and stairs standing over a hole blown in a floor slab fall through and break.
  slabHoles(slab, removed, attacker) {
    const g = cellGrid(slab),
      over = removed.map((i) => cellCenter(slab, i)),
      above = (slab.storey ?? 0) + 1;
    for (const o of this.map.obstacles.filter(
      (o) => o.building === slab.building && o.storey === above && o.hp !== undefined && o.panel === undefined,
    ))
      if (over.some((c) => Math.abs(c.x - o.x) < g.cw / 2 && Math.abs(c.z - o.z) < g.ch / 2)) this.breakObstacle(o, attacker);
  }
  // A panel that stops carrying load: the lintel over a doorway beside it drops, the building may come down.
  unsupported(o, attacker) {
    this.destroyedPanels.add(o.panel);
    for (const l of this.map.obstacles.filter((l) => l.part === 'lintel' && l.supports?.includes(o.panel)))
      this.breakObstacle(l, attacker);
    const b = this.map.buildings[o.building];
    if (!o.structural || !b || b.collapsed) return;
    if (o.storey > 0) {
      if (storeyStructure(this.map, b, o.storey, this.destroyedPanels).collapse) this.collapseStorey(b, o.storey, attacker);
    } else if (structure(this.map, b, this.destroyedPanels).collapse) this.collapse(b, attacker);
  }
  // An upper storey fails: it and everything above it comes down onto the floor below.
  collapseStorey(b, storey, attacker) {
    if (b.collapsed || (b.fallenFrom ?? Infinity) <= storey) return;
    b.fallenFrom = storey;
    this.destruction.storeys[b.id] = storey;
    for (const d of this.map.doors) if (d.building === b.id && (d.storey || 0) >= storey) destroyDoor(this, d, attacker);
    const parts = storeyParts(this.map, b, storey);
    for (const o of parts) {
      if (o.panel !== undefined) delete this.destruction.cells[o.panel];
      this.removeObs(o);
    }
    const base = 3.84 + (storey - 1) * 3.6;
    this.events.push({ type: 'storeyCollapse', building: b.id, storey, x: b.x, z: b.z, w: b.w, d: b.d, y: base, height: b.height });
    for (const p of this.players)
      if (p.hp > 0 && p.y > base - 0.6 && Math.abs(p.x - b.x) < b.w / 2 + 0.3 && Math.abs(p.z - b.z) < b.d / 2 + 0.3) {
        p.shield = 0;
        this.damage(attacker, p, 150);
      }
  }
  // A bullet, bolt or blade hitting a wall at `point` (just inside the surface along `dir`).
  chipWall(o, point, dir, damage, attacker) {
    const p = { x: point.x + dir.x * 0.06, y: point.y + dir.y * 0.06, z: point.z + dir.z * 0.06 },
      i = cellIndexAt(o, p),
      hits = [[i, damage]];
    if (damage >= 55) {
      const g = cellGrid(o);
      for (const j of [i - 1, i + 1, i - g.cols, i + g.cols]) hits.push([j, damage * 0.5]);
    }
    this.hitCells(o, hits, attacker);
  }
  breakObstacle(o, attacker) {
    if (o.buildId !== undefined) return this.construction.damage(o.buildId,1e6,attacker);
    if (o.droneId !== undefined) return this.drones.damage(o.droneId,1e6,attacker);
    if (o.liftId !== undefined) return this.lifts.damage(o.liftId,1e6);
    if (o.vehicleId !== undefined) return this.vehicles.damage(o.vehicleId, 1e6, attacker);
    if (o.doorId !== undefined) return destroyDoor(this, this.map.doors[o.doorId], attacker);
    if (!this.colliders.has(o)) return;
    this.construction?.harvest(attacker,o);
    const info = { type: 'break', kind: o.part, x: o.x, y: o.y, z: o.z, w: o.w, h: o.h, d: o.d, color: o.color };
    if (o.part === 'car') {
      // Cars burn out as wrecks: still cover (until blown apart), with a secondary explosion.
      o.part = 'wreck';
      o.hp = 260;
      this.destruction.wrecks.push(o.decor);
      this.events.push({ ...info, kind: 'car', decor: o.decor });
      this.blast(o.x, o.y + 0.4, o.z, 5, 75, attacker, 'car', o);
      return;
    }
    this.removeObs(o);
    if (o.deploy !== undefined) {
      const d = this.deployables.find((q) => q.id === o.deploy);
      this.events.push({ ...info, kind: 'deploy' });
      if (d) this.undeploy(d, true);
      return;
    }
    if (o.part === 'upper') {
      this.destruction.roofs.push(o.building);
      this.dropRoofPlant(o.building);
      this.events.push({ ...info, kind: 'roof', building: o.building });
      return;
    }
    if (o.prop !== undefined) {
      if (!this.destruction.props.includes(o.prop)) this.destruction.props.push(o.prop);
      this.events.push({ ...info, prop: o.prop });
      // Park benches break with their back rest.
      for (const q of this.map.obstacles.filter((q) => q.prop === o.prop && q !== o)) this.removeObs(q);
      return;
    }
    if (o.panel !== undefined) {
      this.destruction.panels.push(o.panel);
      delete this.destruction.cells[o.panel];
      // Its window pane goes with it.
      if (o.hole) for (const g of this.map.obstacles.filter((q) => q.windowPanel === o.panel)) this.breakObstacle(g, attacker);
      this.events.push({ ...info, panel: o.panel });
      // A lintel falls as soon as a panel it rests on is gone.
      this.unsupported(o, attacker);
      // The roof goes with the top floor slab.
      const b = this.map.buildings[o.building];
      if (isSlab(o) && b && !b.landmark034 && (o.storey ?? 0) === (b.storeys || 0)) {
        const roof = this.map.obstacles.find((q) => q.building === b.id && q.part === 'upper');
        if (roof) this.breakObstacle(roof, attacker);
        else if (!this.destruction.roofs.includes(b.id)) {
          this.destruction.roofs.push(b.id);
          this.dropRoofPlant(b.id);
        }
      }
      if (isSlab(o)) this.slabHoles(o, [...Array(cellGrid(o).cols * cellGrid(o).rows).keys()], attacker);
    } else if (o.decor !== undefined) {
      this.destruction.decor.push(o.decor);
      this.events.push({ ...info, decor: o.decor });
      // Whatever stood on it falls with it.
      for (const q of this.map.obstacles.filter((q) => q.restsOn === o.decor)) this.breakObstacle(q, attacker);
    }
  }
  // Parapets, plant and chimneys on a roof go with it (0.28).
  dropRoofPlant(building) {
    for (const q of this.map.obstacles.filter((q) => q.building === building && q.part === 'roofplant')) this.removeObs(q);
  }
  collapse(b, attacker) {
    if (b.collapsed) return;
    b.collapsed = true;
    this.destruction.buildings.push(b.id);
    for (const d of this.map.doors) if (d.building === b.id) destroyDoor(this, d, attacker);
    for (const o of this.map.obstacles) if (o.building === b.id && o.panel !== undefined) delete this.destruction.cells[o.panel];
    for (const o of collapseParts(this.map, b)) this.removeObs(o);
    for (const r of rubbleFor(b, this.map.chests)) this.addObs(r);
    this.events.push({ type: 'collapse', building: b.id, x: b.x, z: b.z, w: b.w, d: b.d, height: b.height });
    // Anyone inside or on top is crushed.
    for (const p of this.players)
      if (p.hp > 0 && Math.abs(p.x - b.x) < b.w / 2 + 0.3 && Math.abs(p.z - b.z) < b.d / 2 + 0.3) {
        p.shield = 0;
        this.damage(attacker, p, 150);
      }
  }
  addPlayer(id, name, bot = false, { force = false } = {}) {
    if (this.players.some((p) => p.id === id) || (!force && this.players.filter((p) => !p.helperOf).length >= this.maxPlayers)) return;
    const p = {
      cosmetics: appearance(),
      perks: skillPerks({}),
      skills: '',
      dashCd: 0,
      cheats: { flight: false, infinite: false, god: false, bazooka: false },
      id,
      name: String(name).slice(0, 16),
      bot,
      x: 0,
      y: 0,
      z: 0,
      vy: 0,
      grounded: true,
      angle: 0,
      pitch: 0,
      hp: bot ? 80 : 100,
      score: 0,
      deaths: 0,
      weapon: 0,
      rarity: 0,
      slot: 1,
      slots: [],
      loadout: sanitizeLoadout(bot ? this.botLoadout() : null),
      gear: null,
      gliding: false,
      thrusting: false,
      spin: 0,
      medkits: 0,
      armor: 0,
      armorTier: null,
      using: null,
      rush: 0,
      stim: 0,
      regen: null,
      blinded: 0,
      interactHeld: false,
      healHeld: false,
      emoteHeld: false,
      emote: 0,
      healing: 0,
      reload: 0,
      cooldown: 0,
      respawn: 0,
      shield: 2,
      moving: 0,
      shot: 0,
      stamina: 100,
      sprinting: false,
      sprintLocked: false,
      jumpHeld: false,
      relic: null,
      frozen: 0,
      webbed: 0,
      flashback: 0,
      portalCd: 0,
      push: null,
      abilityHeld: [false, false],
      input: {},
      inputAge: 0,
      brain: {
        timer: 0,
        pathTimer: 0,
        path: [],
        memory: 0,
        lastSeen: null,
        targetId: null,
        seenFor: 0,
        patrol: Math.floor(this.random() * this.map.spawns.length),
        error: 0,
        phase: this.random() * 2,
        slot: this.players.length,
      },
    };
    // Teams: every human is on their own; bots form squads that never shoot each other.
    // Survival bots all share one side; squads still move and fight together.
    if (bot) {
      const n = this.botCount++,
        size = this.mode === 'royale' ? 2 : 3;
      p.squad = 'sq' + Math.floor(n / size);
      p.team = this.mode === 'survival' ? 'bots' : p.squad;
      const pick = (a) => a[Math.floor(this.random() * a.length)];
      p.cosmetics = appearance({
        operator: pick(['soldier', 'hazmat', 'scout']),
        finish: pick(FINISHES),
        tint: Math.floor(this.random() * BOT_TINTS),
      });
    } else p.team = p.squad = 'p:' + id;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.48, 0.36), body);
    this.physicsDirty = true;
    this.bodies.set(id, { body, collider });
    this.players.push(p);
    this.spawn(p);
    return p;
  }
  // Moves a player (and their capsule) to a spot; y defaults to the ground there.
  place(p, x, z, y = null) {
    p.x = Math.max(-this.map.limit.x + 0.5, Math.min(this.map.limit.x - 0.5, x));
    p.z = Math.max(-this.map.limit.z + 0.5, Math.min(this.map.limit.z - 0.5, z));
    p.y = y ?? groundHeight(p.x, p.z, this.map) + 0.02;
    const body = this.bodies.get(p.id)?.body;
    body?.setTranslation({ x: p.x, y: p.y + 0.84, z: p.z }, true);
    body?.setNextKinematicTranslation({ x: p.x, y: p.y + 0.84, z: p.z });
  }
  busPoint(t) {
    const b = this.bus,
      k = Math.min(1, t / b.duration);
    return { x: b.ax + (b.bx - b.ax) * k, z: b.az + (b.bz - b.az) * k };
  }
  // Leave the bus: free fall, then an automatic glide close to the ground.
  dropOut(p) {
    p.inBus = false;
    p.dropping = true;
    p.grounded = false;
    p.jumpHeld = true;
    p.vy = 0;
    p.y = this.bus.y - 2.5;
    this.place(p, p.x, p.z, p.y);
    // The character controller reads collider positions: move this capsule there now, not at the next step.
    this.world.propagateModifiedBodyPositionsToColliders();
    this.events.push({ type: 'drop', id: p.id, x: p.x, y: p.y, z: p.z });
  }
  stepBus(dt) {
    const b = this.bus;
    if (!b?.active) return;
    b.t += dt;
    Object.assign(b, this.busPoint(b.t));
    let aboard = 0;
    for (const p of this.players) {
      if (!p.inBus) continue;
      const want = p.bot ? b.t / b.duration >= p.brain.dropAt : p.input.jump && p.inputAge < 0.3;
      if (want || b.t >= b.duration) this.dropOut(p);
      else {
        aboard++;
        this.place(p, b.x, b.z, b.y);
        p.angle = p.bot ? Math.atan2(b.bx - b.ax, b.bz - b.az) : (p.input.angle ?? p.angle);
        p.pitch = p.bot ? 0 : (p.input.pitch ?? p.pitch);
      }
    }
    if (!aboard && b.t >= b.duration) b.active = false;
  }
  removePlayer(id) {
    this.drones?.cancel(this.players.find(p=>p.id===id));
    this.vehicles?.detach(id);
    const b = this.bodies.get(id);
    if (b) this.world.removeRigidBody(b.body);
    this.bodies.delete(id);
    // Long-running server rooms: the lag-compensation trail of someone who left must not stay behind.
    this.trails?.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
  }
  spawn(p) {
    this.drones?.cancel(p);
    p.materials=freshMaterials();p.fpvCharges=0;p.techModules=[];p.droneId=null;
    p.suitFlight=false;p.suitVX=p.suitVZ=p.suitCharge=p.suitBeamCd=0;
    if (p.vehicle) this.vehicles?.exit(p, { force: true, quiet: true });
    let best = this.map.spawns[0],
      distance = -Infinity;
    const start = Math.floor(this.random() * this.map.spawns.length),
      others = this.players.filter((o) => o.id !== p.id && o.hp > 0),
      // Never into a boss's lair while there is anywhere else to go.
      lairs = (this.bosses?.list || []).filter((b) => b.hp > 0);
    const ring = this.zone.fixed ? this.zone : null;
    for (let i = 0; i < this.map.spawns.length; i++) {
      const s = this.map.spawns[(i + start) % this.map.spawns.length];
      let d = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - s[0], o.z - s[1]))) : 50;
      if (lairs.some((b) => Math.hypot(b.home.x - s[0], b.home.z - s[1]) < 30)) d -= 1000;
      // In the ring: inside it, and 40–90 m from the other player (not across the whole city).
      if (ring) {
        if (Math.hypot(s[0] - ring.x, s[1] - ring.z) > ring.radius - 15) d -= 2000;
        else if (others.length) d = 100 - Math.abs(d - 65);
      }
      if (d > distance) {
        distance = d;
        best = s;
      }
    }
    p.x = best[0];
    p.z = best[1];
    p.y = groundHeight(p.x, p.z, this.map) + 0.02;
    p.vy = 0;
    p.grounded = true;
    p.angle = Math.atan2(-p.x, -p.z);
    p.pitch = 0;
    p.hp = p.bot ? 80 : 100;
    p.respawn = 0;
    p.shield = 2;
    const loadout = this.kit === 'loadout';
    p.slots = loadout ? loadoutSlots(p.loadout) : startSlots();
    p.slot = loadout ? 1 : 0;
    this.syncHeld(p);
    if (p.cheats?.bazooka) this.giveBazooka(p);
    p.gear = loadout ? makeGear(p.loadout.gear) : null;
    p.gliding = p.thrusting = false;stopWings(p);
    p.spin = 0;
    p.medkits = loadout ? 1 : 0;
    p.using = null;
    p.rush = p.stim = 0;
    p.regen = null;
    p.armor = 0;
    p.armorTier = null;
    p.blinded = 0;
    p.webbed = 0;
    p.healing = 0;
    p.reload = 0;
    p.cooldown = 0.3;
    p.stamina = 100;
    p.sprinting = false;
    p.sprintLocked = false;
    p.jumpHeld = false;
    p.brain.path = [];
    p.brain.memory = 0;
    p.brain.seenFor = 0;
    p.inBus = false;
    p.dropping = false;
    if (this.bus?.active && !p.helperOf) {
      p.inBus = true;
      p.x = this.bus.x;
      p.z = this.bus.z;
      p.y = this.bus.y;
      p.shield = 0;
      // Bots pick where along the route they jump.
      p.brain.dropAt = 0.12 + this.random() * 0.76;
    }
    const body = this.bodies.get(p.id).body;
    body.setTranslation({ x: p.x, y: p.y + 0.84, z: p.z }, true);
    body.setNextKinematicTranslation({ x: p.x, y: p.y + 0.84, z: p.z });
    this.events.push({ type: 'spawn', id: p.id, x: p.x, y: p.y, z: p.z });
  }
  input(id, i) {
    const p = this.players.find((p) => p.id === id);
    if (!p || !i || typeof i !== 'object') return;
    // An input overtaken by a newer one (the direct-play link is lossy and unordered) is dropped: the newer one
    // repeats its one-shot presses.
    if (Number.isInteger(i.seq) && i.seq <= (p.inputSeq || 0)) return;
    // Several inputs can arrive between two steps online: one-shot presses are kept until a step has seen them.
    const held = p.inputAge === 0 ? p.input : {},
      once = (k) => i[k] === true || held[k] === true;
    p.input = {
      turretAngle: clamp(Number.isFinite(i.turretAngle) ? i.turretAngle : i.angle, -Math.PI * 2, Math.PI * 2),
      turretPitch: clamp(Number.isFinite(i.turretPitch) ? i.turretPitch : i.pitch, -1.35, 1.35),
      drive: clamp(i.drive, -1, 1),
      steer: clamp(i.steer, -1, 1),
      vehicleAlt: i.vehicleAlt === true,
      vehicleRocket: i.vehicleRocket === true,
      buildMode:i.buildMode===true,buildPlace:i.buildPlace===true,
      buildType:Math.floor(clamp(i.buildType,0,3)),buildRotation:Math.floor(clamp(i.buildRotation,0,3)),buildMaterial:Math.floor(clamp(i.buildMaterial,0,2)),
      droneToggle:once('droneToggle'),suitToggle:once('suitToggle'),techUse:once('techUse'),bomb:once('bomb'),
      suitThrust:i.suitThrust===true,suitAlt:i.suitAlt===true,vehicleBoost:i.vehicleBoost===true,
      vehicleBrake: i.vehicleBrake === true,
      x: clamp(i.x, -1, 1),
      z: clamp(i.z, -1, 1),
      angle: clamp(i.angle, -Math.PI * 2, Math.PI * 2),
      pitch: clamp(i.pitch, -1.35, 1.35),
      fire: i.fire === true,
      reload: once('reload'),
      jump: once('jump'),
      ascend: clamp(i.ascend, -1, 1),
      sprint: i.sprint === true,
      slot: Number.isFinite(i.slot) ? Math.round(clamp(i.slot, 0, 4)) : undefined,
      liftFloor: Number.isInteger(i.liftFloor) && i.liftFloor >= 0 && i.liftFloor < 32 ? i.liftFloor : held.liftFloor,
      interact: once('interact'),
      heal: once('heal'),
      ability1: i.ability1 === true,
      ability2: i.ability2 === true,
      emote: once('emote'),
      dash: once('dash'),
      detonate: once('detonate'),
    };
    // Round-trip time the client measured (ms), used to rewind targets for its shots (lag compensation), and how far
    // in the past the client shows other players (its interpolation delay).
    if (Number.isFinite(i.lag)) p.lag = clamp(i.lag, 0, 400);
    if (Number.isFinite(i.interp)) p.interp = clamp(i.interp, 0, 200);
    // The input's sequence number: acknowledged in the state after the step that applies it (netcode.js Predictor).
    if (Number.isInteger(i.seq) && i.seq > (p.inputSeq || 0)) p.inputSeq = i.seq;
    p.inputAge = 0;
  }
  // Debug sandbox only (solo; the server never runs this mode): hand the player any weapon, gear or supply.
  debugTravel(id, name) {
    if (this.mode !== 'debug' || !this.allowCheats) return false;
    const p = this.players.find(p => p.id === id && !p.bot);
    const e = this.map.expansion;
    const sites = this.map.expansions || (e ? [e] : []);
    const landmark = this.map.landmarks?.find(l => l.id === name || l.kind === name);
    const target = landmark || sites.flatMap(s => [s.base, ...s.villas]).find(s => s.id === name);
    if (!p || !target) return false;
    if (p.vehicle) this.vehicles.exit(p, { force: true, quiet: true });
    const x = landmark ? this.map.buildings[landmark.building].x + this.map.buildings[landmark.building].entry034[0] : name.endsWith('fort') ? target.x - 10 : target.x + 20;
    const z = landmark ? this.map.buildings[landmark.building].z + this.map.buildings[landmark.building].entry034[1] + 1.4 : name.endsWith('fort') ? target.z + 60 : target.z + 29;
    Object.assign(p, { x, z, y: groundHeight(x, z, this.map)+0.1, vy: 0, grounded: true, dropping: false, gliding: false, hp: 100 });
    const body = this.bodies.get(p.id);
    body.collider.setEnabled(true);
    body.body.setTranslation({ x:p.x, y:p.y+0.84, z:p.z }, false);
    body.body.setNextKinematicTranslation({ x:p.x, y:p.y+0.84, z:p.z });
    this.physicsDirty = true;return true;
  }
  debugGive(id, what = {}) {
    const p = this.players.find((q) => q.id === id);
    if (this.mode !== 'debug' || !p || p.bot) return false;
    if (Number.isInteger(what.weapon) && WEAPONS[what.weapon]) {
      const item = makeItem(what.weapon, Math.max(0, Math.min(MAX_RARITY, what.rarity ?? 0)));
      if (WEAPONS[what.weapon].melee) p.slots[0] = item;
      else addItem(p, item);
      this.syncHeld(p);
      p.reload = 0;
    }
    if (what.gear !== undefined) p.gear = what.gear ? makeGear(what.gear) : null;
    if (what.medkits) p.medkits = Math.min(5, p.medkits + what.medkits);
    if (what.armor) p.armor = Math.min(100, p.armor + what.armor);
    if (what.heal) p.hp = 100;
    if (what.drones) p.fpvCharges=5;
    if (what.materials) p.materials={wood:500,stone:500,metal:500};
    if (what.modules) p.techModules=['ram','turbo','bomb'];
    if (what.ammo) restockAmmo(p, 1);
    return true;
  }
  // Debug sandbox only: target bots on demand.
  debugBots(count = 0) {
    if (this.mode !== 'debug') return 0;
    if (count > 0)
      for (let i = 0; i < count; i++)
        this.addPlayer('dbg' + ++this.botCount, ['MICA', 'FLINT', 'SAGE', 'EMBER', 'COBALT', 'ONYX', 'JUNO', 'REED'][this.botCount % 8], true, { force: true });
    else for (const p of this.players.filter((q) => q.bot)) this.removePlayer(p.id);
    return this.players.filter((p) => p.bot).length;
  }
  setCheat(id, key, on) {
    const p = this.players.find((p) => p.id === id);
    if (!this.allowCheats || !p || p.bot || !['flight', 'infinite', 'god', 'bazooka'].includes(key)) return false;
    p.cheats[key] = !!on;
    if (on) this.cheated = true;
    if (key === 'flight') p.vy = 0;
    if (key === 'bazooka' && on) this.giveBazooka(p);
    return true;
  }
  // Sandbox code: a legendary COMET rocket launcher in slot 4 with a full reserve, equipped at once.
  giveBazooka(p) {
    const w = WEAPONS.findIndex((x) => x.projectile === 'rocket'),
      item = makeItem(w, 4);
    item.reserve = 99;
    const slot = p.slots.findIndex((it, i) => i >= 3 && it?.w === w);
    p.slots[slot >= 0 ? slot : 3] = item;
    p.slot = slot >= 0 ? slot : 3;
    p.reload = 0;
    this.syncHeld(p);
  }
  enemies(p) {
    return this.players.filter((o) => o.id !== p.id && o.hp > 0 && o.team !== p.team);
  }
  squadmates(p) {
    return this.players.filter((o) => o !== p && o.hp > 0 && o.squad === p.squad);
  }
  // A spot on the far side of a solid, waist-high-or-taller obstacle, hidden from the threat and reachable.
  findCover(p, threat) {
    let best = null,
      bestScore = Infinity;
    (this.map.obstacles.lowGrid || this.map.obstacles.grid).query(p.x - 13, p.z - 13, p.x + 13, p.z + 13, (o) => {
      if (o.h < 1 || o.y - o.h / 2 - (o.ground || 0) > 0.4 || ['upper', 'roof', 'lintel', 'tree'].includes(o.part))
        return;
      const dx = o.x - threat.x,
        dz = o.z - threat.z,
        n = Math.hypot(dx, dz) || 1,
        ux = dx / n,
        uz = dz / n,
        reach = Math.abs(ux) * (o.w / 2) + Math.abs(uz) * (o.d / 2) + 0.75,
        pt = { x: o.x + ux * reach, z: o.z + uz * reach };
      if (
        Math.hypot(pt.x - threat.x, pt.z - threat.z) < 5 ||
        Math.abs(pt.x) > this.map.limit.x - 1 ||
        Math.abs(pt.z) > this.map.limit.z - 1
      )
        return;
      const nx = Math.round(pt.x - this.nav.ox),
        nz = Math.round(pt.z - this.nav.oz);
      if (nx < 0 || nz < 0 || nx >= this.nav.w || nz >= this.nav.h || this.nav.blocked[nz * this.nav.w + nx]) return;
      if (lineClear(threat, pt, 0, this.map.obstacles)) return;
      const score = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (score < bestScore && score < 14) {
        best = pt;
        bestScore = score;
      }
    });
    return best;
  }
  moveAlong(p, goal, speed = 0.6, pathTime = 1.2) {
    const b = p.brain;
    if (lineClear(p, goal, 0.45, this.map.obstacles)) {
      const d = Math.hypot(goal.x - p.x, goal.z - p.z) || 1;
      return { x: ((goal.x - p.x) / d) * speed, z: ((goal.z - p.z) / d) * speed };
    }
    if (b.pathTimer <= 0 || b.pathGoal !== goal) {
      b.path = this.nav.path(p, goal);
      b.pathTimer = pathTime;
      b.pathGoal = goal;
    }
    while (b.path.length && Math.hypot(b.path[0].x - p.x, b.path[0].z - p.z) < 0.45) b.path.shift();
    const next = b.path[0];
    if (!next) return { x: 0, z: 0 };
    const d = Math.hypot(next.x - p.x, next.z - p.z) || 1;
    return { x: ((next.x - p.x) / d) * speed, z: ((next.z - p.z) / d) * speed };
  }
  sight(p, o) {
    const dx = o.x - p.x,
      dz = o.z - p.z,
      d = Math.hypot(dx, dz);
    if (d > 27 || ((dx * Math.sin(p.angle) + dz * Math.cos(p.angle)) / Math.max(d, 0.01) < -0.15 && d > 4))
      return false;
    if (!lineClear(p, o, 0, this.map.obstacles)) return false;
    if (this.smoked(p, o)) return false;
    const origin = { x: p.x, y: p.y + 1.4, z: p.z },
      dy = o.y - p.y,
      n = Math.hypot(dx, dy, dz);
    return terrainRay(origin, { x: dx / n, y: dy / n, z: dz / n }, n, this.map) >= n - 0.05;
  }
  botLoadout() {
    const pick = (a) => a[Math.floor(this.random() * a.length)];
    return {
      melee: pick(LOADOUT_CHOICES.melee),
      primary: pick([0, 1, 3]),
      secondary: pick([2, 10]),
      gear: 'none',
    };
  }
  // Keeps the flat `weapon`/`rarity` fields (used by rendering and the protocol) in sync with the active slot.
  syncHeld(p) {
    if (!p.slots[p.slot]) p.slot = p.slots.findIndex((s) => s);
    const item = p.slots[p.slot];
    p.weapon = item ? item.w : FISTS;
    p.rarity = item ? item.r : 0;
  }
  held(p) {
    return p.slots[p.slot] || null;
  }
  // Bots prefer a loaded gun that suits the distance and switch to their blade up close or when dry.
  botSlot(p, distance) {
    if (distance < 2.4 && p.slots[0]) return 0;
    let best = -1,
      score = -Infinity;
    for (let i = 1; i < p.slots.length; i++) {
      const s = p.slots[i];
      if (!s || s.ammo + s.reserve <= 0) continue;
      // Items are used when calm (botItem), and the impulse grenade does no damage.
      if (WEAPONS[s.w].consumable || WEAPONS[s.w].projectile === 'impulse') continue;
      const w = WEAPONS[s.w],
        fit = distance < Infinity ? -Math.abs(Math.min(w.range, 40) * 0.45 - Math.min(distance, 40)) : 0;
      // Bots have no detonator button, so a demolition charge is their last resort.
      const value = fit + s.r * 3 + (w.projectile === 'rocket' && distance < 7 ? -50 : 0) + (w.sticky || w.fuse ? -40 : 0);
      if (value > score) {
        score = value;
        best = i;
      }
    }
    return best > 0 ? best : 0;
  }
  // A bot out of a fight patches itself up with what it carries: shields when its armour is low, heals when hurt.
  botItem(p) {
    let best = -1,
      score = 0;
    for (let i = 1; i < p.slots.length; i++) {
      const s = p.slots[i],
        w = s && WEAPONS[s.w];
      if (!w?.consumable || w.deploy || s.ammo <= 0 || this.useBlocked(p, w)) continue;
      const e = w.effect || {},
        gain = (e.armor ? Math.min(e.armor, (e.armorCap ?? 100) - p.armor) : 0) + (e.hp ? Math.min(e.hp, (e.hpCap ?? 100) - p.hp) : 0) + (e.regen ? 30 : 0);
      if (gain > score + 4) {
        score = gain;
        best = i;
      }
    }
    return score >= 12 ? best : -1;
  }
  // Is anything in the belt a weapon? (Bots with bare hands go looking for one first.)
  armed(p) {
    return p.slots.some((s, k) => k > 0 && s && !WEAPONS[s.w].consumable && WEAPONS[s.w].projectile !== 'impulse' && s.ammo + s.reserve > 0);
  }
  // Bot AI: squads share what they see, keep formation around a leader, take cover when hurt or reloading,
  // loot nearby chests when calm, and fall back toward the storm centre in Mini Royale.
  botInput(p, dt) {
    // Tutorial targets stand still and never fight back.
    if (p.dummy) return { x: 0, z: 0, angle: p.angle, pitch: 0, fire: false };
    const b = p.brain,
      now = this.tick / 60;
    b.timer -= dt;
    b.pathTimer -= dt;
    b.memory = Math.max(0, b.memory - dt);
    b.phase += dt;
    const mates = this.squadmates(p);
    // Under a flashback a bot sees only the past: it stumbles about and cannot aim.
    if (p.flashback > 0) {
      b.targetId = null;
      b.memory = 0;
      return { x: Math.sin(b.phase * 1.3) * 0.5, z: Math.cos(b.phase * 0.9) * 0.5, angle: p.angle + dt * 1.5, pitch: 0, fire: false };
    }
    let target = this.enemies(p)
      .filter((o) => this.sight(p, o))
      .sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
    // Focus fire: prefer the enemy a squadmate is already engaging if this bot can see it too.
    const focus = mates.map((m) => m.brain.targetId).find((id) => id && id !== target?.id);
    if (focus) {
      const f = this.players.find((o) => o.id === focus && o.hp > 0);
      if (
        f &&
        this.sight(p, f) &&
        (!target || Math.hypot(f.x - p.x, f.z - p.z) < Math.hypot(target.x - p.x, target.z - p.z) + 8)
      )
        target = f;
    }
    if (target) {
      if (b.targetId !== target.id) b.seenFor = 0;
      b.targetId = target.id;
      b.seenFor += dt;
      b.lastSeen = { x: target.x, z: target.z };
      b.memory = 4;
      // Call it out to the squad.
      for (const m of mates)
        if (!m.brain.targetId && Math.hypot(m.x - p.x, m.z - p.z) < 45) {
          m.brain.lastSeen = { x: target.x, z: target.z };
          m.brain.memory = Math.max(m.brain.memory, 3);
        }
    } else {
      b.targetId = null;
      b.seenFor = 0;
    }
    const distance = target ? Math.hypot(target.x - p.x, target.z - p.z) : Infinity,
      slot = this.botSlot(p, distance),
      item = p.slots[slot],
      w = WEAPONS[item?.w ?? 7],
      melee = !!w.melee,
      lowAmmo = !melee && item && item.ammo < Math.max(1, Math.ceil(weaponStats(item.w, item.r).mag * 0.2));
    if (b.timer <= 0) {
      b.timer = 0.7;
      b.error = (this.random() - 0.5) * 0.2;
    }
    const aimAt = (tx, tz) => {
      const aim = Math.atan2(tx - p.x, tz - p.z) + (melee || !target ? 0 : b.error),
        diff = Math.atan2(Math.sin(aim - p.angle), Math.cos(aim - p.angle));
      return { angle: p.angle + clamp(diff, -1.8 * dt, 1.8 * dt), diff };
    };
    b.wantLoot = null;
    // 0) Danger on the ground (a ring of fire, a boss hazard): step out of it before anything else.
    const hazard = this.bosses.hazards.find(
      (h) => h.team !== p.team && Math.hypot(p.x - h.x, p.z - h.z) < h.r + 1.4 && Math.abs(p.y - h.y) < 3,
    );
    if (hazard) {
      const dx = p.x - hazard.x,
        dz = p.z - hazard.z,
        d = Math.hypot(dx, dz) || 1;
      return {
        x: (dx / d) * 1,
        z: (dz / d) * 1,
        angle: Math.atan2(dx, dz),
        pitch: 0,
        slot,
        fire: false,
        sprint: true,
      };
    }
    // 1) Storm: get inside the safe circle first.
    if (this.mode === 'royale' && Math.hypot(p.x, p.z) > Math.max(2, this.zone.radius - 9)) {
      const m = this.moveAlong(p, { x: 0, z: 0 }, 1, 0.8);
      return {
        ...m,
        angle: Math.hypot(m.x, m.z) > 0.01 ? Math.atan2(m.x, m.z) : p.angle,
        pitch: 0,
        slot,
        fire: false,
        reload: lowAmmo,
        sprint: p.stamina > 40,
      };
    }
    const hurt = now - (b.hurtAt ?? -99) < 1.2;
    // 2) Break contact: a badly hurt bot backs off behind something, patches up and comes back, instead of
    // trading shots until it dies.
    if (b.mode !== 'retreat' && target && !melee && p.hp < 38 && now > (b.retreatCooldown || 0)) {
      b.mode = 'retreat';
      b.retreatCooldown = now + 14;
      b.retreatUntil = now + 7;
      b.cover = this.findCover(p, target);
      b.pathTimer = 0;
    }
    if (b.mode === 'retreat') {
      const safe = !target || !this.sight(p, target);
      if (now > b.retreatUntil || p.hp > 75 || (safe && p.hp > 55 && p.medkits === 0)) b.mode = 'fight';
      else {
        const spot = b.cover,
          far = spot && Math.hypot(spot.x - p.x, spot.z - p.z) > 0.8;
        let m = { x: 0, z: 0 };
        if (far) m = this.moveAlong(p, spot, 1, 0.9);
        else if (target && !safe) {
          const dx = p.x - target.x,
            dz = p.z - target.z,
            d = Math.hypot(dx, dz) || 1;
          m = { x: (dx / d) * 0.9, z: (dz / d) * 0.9 };
        }
        const look = target ? aimAt(target.x, target.z) : { angle: p.angle, diff: 0 },
          // Standing still is part of using a medkit: sprinting or firing cancels it.
          wantHeal = safe && p.medkits > 0 && p.hp < 70 && !far;
        return {
          ...(wantHeal ? { x: 0, z: 0 } : m),
          angle: look.angle,
          pitch: 0,
          slot,
          fire: false,
          reload: !melee,
          heal: wantHeal,
          sprint: !wantHeal,
        };
      }
    }
    // 3) Cover: when badly hurt, reloading under fire, or just hit.
    if (
      b.mode !== 'cover' &&
      target &&
      !melee &&
      now > (b.coverCooldown || 0) &&
      (p.hp < 45 || (p.reload > 0 && distance < 22) || (hurt && this.random() < 0.08))
    ) {
      b.coverCooldown = now + 3.5;
      const spot = this.findCover(p, target);
      if (spot) {
        b.mode = 'cover';
        b.cover = spot;
        b.threat = { x: target.x, z: target.z };
        b.coverUntil = now + 2.2 + this.random() * 2;
        b.pathTimer = 0;
      }
    }
    if (b.mode === 'cover') {
      if (now > b.coverUntil || !b.cover) b.mode = 'fight';
      else {
        const there = Math.hypot(b.cover.x - p.x, b.cover.z - p.z) < 0.7,
          look = target || b.threat,
          { angle, diff } = aimAt(look.x, look.z),
          // Lean out of cover to shoot, then slide back behind it.
          peeking = b.phase % 3.2 < 0.9;
        let m = there ? { x: 0, z: 0 } : this.moveAlong(p, b.cover, 1, 0.9);
        if (there && peeking && look) {
          const dx = look.x - b.cover.x,
            dz = look.z - b.cover.z,
            d = Math.hypot(dx, dz) || 1,
            side = (Number(p.id.replace(/\D/g, '')) || 0) % 2 ? 1 : -1;
          m = { x: ((-dz / d) * side) * 0.45, z: ((dx / d) * side) * 0.45 };
        }
        return {
          ...m,
          angle,
          pitch: 0,
          slot,
          // Pop shots only when the enemy is visible from cover; otherwise reload and patch up.
          fire: !!target && there && peeking && !p.reload && Math.abs(diff) < 0.12,
          reload: !melee && !!item && item.ammo < weaponStats(item.w, item.r).mag,
          heal: there && p.hp < 70 && p.medkits > 0 && !target,
          sprint: !there,
        };
      }
    }
    // 3) Engage.
    let move = { x: 0, z: 0 };
    const side = (Number(p.id.replace(/\D/g, '')) || 0) % 2 ? 1 : -1;
    if (target && distance < 17) {
      const dx = target.x - p.x,
        dz = target.z - p.z,
        d = Math.max(distance, 1);
      if (melee) move = { x: (dx / d) * (distance > 1.4 ? 0.85 : 0), z: (dz / d) * (distance > 1.4 ? 0.85 : 0) };
      else if (p.reload > 0 || distance < 6) move = { x: (-dx / d) * 0.6, z: (-dz / d) * 0.6 };
      else {
        // Strafe, and squadmates spread out to flank instead of stacking in a line.
        const flank = mates.length ? 0.28 * side : 0;
        move = {
          x: (-dz / d) * (Math.sin(b.phase * 0.6) * 0.22 + flank),
          z: (dx / d) * (Math.sin(b.phase * 0.6) * 0.22 + flank),
        };
      }
    } else {
      // 4) Calm: help a squadmate in a fight, loot a chest in reach, follow the squad leader, or patrol.
      const leader = [p, ...mates].sort((a, c) => (a.id < c.id ? -1 : 1))[0];
      let goal = null;
      // Reinforce: a mate shooting or being shot at pulls the rest of the squad in.
      const fighting = mates
        .filter((m) => (m.brain.targetId || now - (m.brain.hurtAt ?? -99) < 3) && Math.hypot(m.x - p.x, m.z - p.z) < 55)
        .sort((m, n) => Math.hypot(m.x - p.x, m.z - p.z) - Math.hypot(n.x - p.x, n.z - p.z))[0];
      if (fighting && Math.hypot(fighting.x - p.x, fighting.z - p.z) > 6) goal = { x: fighting.x, z: fighting.z };
      if (b.memory > 0 && b.lastSeen) goal = b.lastSeen;
      const unarmed = !this.armed(p);
      if ((!goal || unarmed) && (!this.respawns || unarmed || this.kit !== 'loadout')) {
        const reach = unarmed ? 90 : this.respawns ? 30 : 18,
          chest = this.chests
          .filter((c) => !c.opened && !c.high && c.by !== p.id && Math.hypot(c.x - p.x, c.z - p.z) < reach)
          .sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
        if (chest) {
          goal = chest;
          b.wantLoot = chest.id;
        }
      }
      const master = p.helperOf && this.players.find((o) => o.id === p.helperOf && o.hp > 0);
      if (!goal && master && Math.hypot(master.x - p.x, master.z - p.z) > 4)
        goal = { x: master.x - Math.sin(master.angle) * 2.5 + side * 1.5, z: master.z - Math.cos(master.angle) * 2.5 };
      if (!goal && !master && leader !== p && Math.hypot(leader.x - p.x, leader.z - p.z) > 5) {
        const back = { x: -Math.sin(leader.angle), z: -Math.cos(leader.angle) };
        goal = { x: leader.x + back.x * 2.5 - back.z * 2.2 * side, z: leader.z + back.z * 2.5 + back.x * 2.2 * side };
      }
      if (!goal) {
        goal = { x: this.map.spawns[b.patrol][0], z: this.map.spawns[b.patrol][1] };
        if (Math.hypot(goal.x - p.x, goal.z - p.z) < 1.8) {
          b.patrol = (b.patrol + 3) % this.map.spawns.length;
          b.pathTimer = 0;
        }
      } else if (goal === b.lastSeen && Math.hypot(goal.x - p.x, goal.z - p.z) < 1.8) b.memory = 0;
      if (Math.hypot(goal.x - p.x, goal.z - p.z) > 0.6) move = this.moveAlong(p, goal, 0.6, 1.3);
    }
    // Suppressing fire: an enemy that just ducked behind a wall still gets shot at for a moment.
    const suppress =
      !target &&
      !melee &&
      b.memory > 2.2 &&
      b.lastSeen &&
      item &&
      item.ammo > 2 &&
      Math.hypot(b.lastSeen.x - p.x, b.lastSeen.z - p.z) < 26 &&
      b.phase % 2.6 < 0.4;
    const look = target
      ? aimAt(target.x, target.z)
      : suppress
        ? aimAt(b.lastSeen.x, b.lastSeen.z)
        : Math.hypot(move.x, move.z) > 0.01
          ? aimAt(p.x + move.x, p.z + move.z)
          : { angle: p.angle, diff: 0 };
    const fire = !target
      ? suppress && Math.abs(look.diff) < 0.12
      : melee
        ? distance < w.range && Math.abs(look.diff) < 0.45
        : b.seenFor > 0.85 &&
          distance < 25 &&
          Math.abs(look.diff) < 0.15 &&
          (w.spinup ? b.phase % 3 < 1.8 : b.phase % 2.2 < 0.6);
    const ability = this.bosses.botChoice(p, target, distance),
      // Out of contact and hurt: stand still and patch up before looking for the next fight.
      wantHeal = !target && b.memory <= 0 && p.hp < 60 && p.medkits > 0;
    // Calm: drink a shield or put a bandage on (keeping that slot in hand until it is done).
    const use = !target && b.memory <= 0 && !wantHeal ? (p.using ? p.using.slot : this.botItem(p)) : -1;
    if (use > 0) {
      b.useToggle = !b.useToggle;
      return { x: 0, z: 0, angle: p.angle, pitch: 0, slot: use, fire: p.slot === use && !p.using && b.useToggle, sprint: false };
    }
    if (wantHeal || p.healing > 0) move = { x: 0, z: 0 };
    return {
      ...move,
      ability1: ability === 0,
      ability2: ability === 1,
      angle: look.angle,
      pitch: target ? Math.atan2(target.y - p.y - 0.4, Math.max(distance, 1)) : 0,
      slot,
      fire,
      heal: wantHeal,
      reload: lowAmmo && !target,
      jump: hurt && this.random() < 0.01,
      sprint:
        !wantHeal &&
        p.healing <= 0 &&
        ((melee && !!target && distance > 3) || (!target && Math.hypot(move.x, move.z) > 0.5 && p.stamina > 60)),
    };
  }
  step(dt = 1 / 60) {
    this.tick++;
    this.botBudget037 ??= new BotDecisionBudget();
    this.botBudget037.update(this, dt);
    if (this.winner !== null) {
      if (!this.respawns) return;
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.winner = null;
        this.time = 180;
        this.round++;
        this.chests = this.map.chests.map((c) => ({ ...c, loot: { ...c.loot } }));
        this.projectiles = [];
        this.vehicles.rounds.length = 0;
        this.construction.reset();this.drones.reset();this.technology.reset();
        this.charges = [];
        this.smokes = [];
        for (const d of [...this.deployables]) this.undeploy(d);
        for (const p of this.players) {
          p.score = 0;
          p.deaths = 0;
          this.spawn(p);
        }
      }
      return;
    }
    if (this.players.length > 1 && this.mode !== 'survival' && this.mode !== 'debug' && this.mode !== 'tutorial') this.time = Math.max(0, this.time - dt);
    if (this.mode === 'royale')
      this.zone.radius =
        this.zoneStart * Math.max(0, 1 - Math.max(0, this.royaleTime - this.time - (this.zoneDelay || 20)) / (this.royaleTime - (this.zoneDelay || 20)));
    this.colliderBudget?.update(dt);
    if (this.map.tiled && this.physicsDirty) { this.physicsDirty = false; this.world.step(); }
    this.lifts.step(dt);
    this.escalators.step(dt);
    stepDoors(this, dt);
    this.vehicles.step(dt);
    // Refresh moved doors and vehicles together before pedestrian collision queries.
    if (this.physicsDirty) { this.physicsDirty = false; this.world.step(); }
    this.construction.step(dt);
    this.drones.step(dt);this.technology.step(dt);
    if (this.physicsDirty) {this.physicsDirty=false;this.world.step();}
    this.stepBus(dt);
    for (const p of this.players) {
      p.inputAge += dt;
      // Everything the client has sent so far is applied by this step (the latest input stands for all of them).
      if (!p.bot) p.ack = p.inputSeq;
      if (p.inBus) continue;
      if (p.hp <= 0) {
        if (this.respawns) {
          p.respawn -= dt;
          if (p.respawn <= 0) this.spawn(p);
        }
        continue;
      }
      let item = this.held(p);
      if (p.cheats.infinite && item && !WEAPONS[item.w].melee) {
        item.ammo = weaponStats(item.w, item.r).mag;
        item.reserve = WEAPONS[item.w].reserve;
        p.reload = 0;
      }
      if (p.bot && (p.brain.wantLoot || (this.mode === 'royale' && (p.slots[1]?.reserve ?? 0) < 40))) this.openChest(p);
      p.shield = Math.max(0, p.shield - dt);
      p.cooldown = Math.max(0, p.cooldown - dt);
      let i = p.bot
        ? (p.botInput = this.botBudget037.input(this, p, dt))
        : p.inputAge > 0.3
          ? {
              ...p.input,
              x: 0,
              z: 0,
              fire: false,
              reload: false,
              jump: false,
              ascend: 0,
              suitThrust: false, suitAlt: false, suitToggle: false,
              sprint: false,
              interact: false,
              heal: false,
            }
          : p.input;
      if (p.gear?.id === 'wings') { p.gear=null; stopWings(p); } // retired equipment cannot be restored by stale snapshots
      if (p.frozen > 0) i = { ...i, suitThrust:false, x: 0, z: 0, fire: false, jump: false, ascend: 0, sprint: false };
      for (let k = 0; k < 2; k++) {
        const pressed = !p.vehicle && !!i['ability' + (k + 1)];
        if (pressed && !p.abilityHeld[k]) this.bosses.use(p, k);
        p.abilityHeld[k] = pressed;
      }
      if (i.slot !== undefined) this.equip(p, i.slot);
      item = this.held(p);
      const w = WEAPONS[p.weapon],
        stats = weaponStats(p.weapon, p.rarity);
      if (p.reload > 0) {
        p.reload = Math.max(0, p.reload - dt);
        if (p.reload === 0 && item) {
          const amount = Math.min(stats.mag - item.ammo, item.reserve);
          item.ammo += amount;
          item.reserve -= amount;
        }
      }
      if (!p.droneId) {p.angle = i.angle ?? p.angle;p.pitch = i.pitch ?? p.pitch;}
      if (p.droneId) i={...i,x:0,z:0,fire:false,jump:false,ascend:0,interact:false,heal:false,buildMode:false,buildPlace:false,suitToggle:false,suitAlt:false};
      this.technology.playerStep(p,i,dt);
      this.construction.useInput(p,i);
      if(i.buildMode||p.gear?.id==='aegis')i={...i,fire:false,reload:false};
      if (Number.isInteger(i.liftFloor) && i.liftFloor !== p.liftChoiceHeld) this.lifts.use(p,i.liftFloor);
      p.liftChoiceHeld = i.liftFloor;
      if (i.interact && !p.interactHeld) {
        if (p.vehicle) this.vehicles.exit(p);
        else if (!this.technology.pickup(p) && !this.lifts.use(p) && !useDoor(this, p) && !this.vehicles.enter(p)) this.openChest(p);
      }
      p.interactHeld = !!i.interact;
      if (p.vehicle && this.vehicles.mount(p)) { this.stepBuffs(p, dt); p.stamina = Math.min(100, p.stamina + 18 * dt); p.dashCd = Math.max(0, (p.dashCd || 0) - dt); p.jumpHeld = !!i.jump; continue; }
      if (i.heal && !p.healHeld && p.medkits > 0 && p.hp < 100 && !p.healing) {
        p.healing = 1.8;
        p.reload = 0;
      }
      p.healHeld = !!i.heal;
      // Emotes: a few seconds of showing off, cancelled the moment you move, shoot or take a hit.
      if (i.emote && !p.emoteHeld && p.hp > 0 && !p.inBus && !p.dropping && p.grounded) p.emote = 4;
      p.emoteHeld = !!i.emote;
      if (p.emote > 0) {
        if (i.fire || i.jump || i.reload || Math.hypot(i.x || 0, i.z || 0) > 0.05 || p.hp <= 0) p.emote = 0;
        else p.emote = Math.max(0, p.emote - dt);
      }
      this.stepBuffs(p, dt);
      // An item being used: switching slots (or losing the item) cancels it; otherwise it finishes on time.
      if (p.using) {
        if (p.using.slot !== p.slot || !item || item.w !== p.using.w || item.ammo <= 0) {
          p.using = null;
          this.events.push({ type: 'use-cancel', id: p.id });
        } else {
          p.using.t = Math.max(0, p.using.t - dt);
          if (p.using.t === 0) this.finishUse(p, item);
        }
      }
      if (p.healing > 0) {
        if (i.fire || i.sprint) {
          p.healing = 0;
        } else {
          p.healing = Math.max(0, p.healing - dt);
          if (!p.healing) {
            p.medkits--;
            p.hp = Math.min(100, p.hp + 50);
            this.events.push({ type: 'heal', id: p.id });
          }
        }
      }

      let x = i.x || 0,
        z = i.z || 0,
        n = Math.max(1, Math.hypot(x, z));
      x /= n;
      z /= n;
      if (p.stamina >= 25) p.sprintLocked = false;
      p.sprinting = !!i.sprint && !i.fire && !p.using && !p.sprintLocked && p.stamina > 0 && Math.hypot(x, z) > 0.1;
      p.stamina = clamp(
        p.stamina + (p.sprinting ? -25 * (p.perks?.drain ?? 1) : 18 * (p.perks?.regen ?? 1)) * dt,
        0,
        100,
      );
      // STIM: stamina never runs out while it lasts.
      if (p.stim > 0) p.stamina = 100;
      if (p.stamina === 0) p.sprintLocked = true;
      if (i.jump && !p.jumpHeld && p.grounded) {
        p.vy = 7.8 * (p.perks?.jump || 1);
        p.grounded = false;
      }
      p.jumpHeld = !!i.jump;
      // DASH (MOBILITY 10): a burst in the direction you are moving, or forward when standing still.
      // Edge-triggered like jump: a stale input that still says "pressed" (a lagging connection) never dashes twice.
      p.dashCd = Math.max(0, (p.dashCd || 0) - dt);
      const dashPress = i.dash && !p.dashHeld;
      p.dashHeld = !!i.dash;
      if (dashPress && p.perks?.dash && p.dashCd <= 0 && p.hp > 0 && !p.inBus && !p.dropping && !p.healing) {
        const has = Math.hypot(x, z) > 0.05,
          ax = has ? x * Math.cos(p.angle) + z * Math.sin(p.angle) : Math.sin(p.angle),
          az = has ? -x * Math.sin(p.angle) + z * Math.cos(p.angle) : Math.cos(p.angle),
          n2 = Math.hypot(ax, az) || 1;
        p.push = { x: (ax / n2) * 15, z: (az / n2) * 15 };
        p.dashCd = 8;
        this.events.push({ type: 'dash', id: p.id, x: p.x, y: p.y, z: p.z, angle: p.angle });
      }
      // Back-worn gear: jetpack thrust or glider while the jump / ascend control is held in the air.
      const hold = (i.ascend || 0) > 0,
        gear = p.gear && GEAR.find((g) => g.id === p.gear.id);
      p.thrusting = false;
      if (p.cheats.flight) {
        p.vy = (i.ascend || 0) * 8;
        p.gliding = false;
      } else {
        p.vy -= 22 * dt;
        if (gear?.id === 'jetpack') {
          if (hold && !p.grounded && p.gear.fuel > 0 && p.y < 31) {
            p.vy = Math.min(6.5, p.vy + 36 * dt);
            p.gear.fuel = Math.max(0, p.gear.fuel - gear.burn * dt);
            p.thrusting = true;
          } else if (p.grounded) p.gear.fuel = Math.min(gear.fuel, p.gear.fuel + gear.refill * dt);
        }
        p.gliding = gear?.id === 'glider' && hold && !p.grounded && p.vy < -1.5;
        if (p.gliding) p.vy = Math.max(p.vy, -2.3);
      }
      // Bus/bailout/launch-pad falling never deploys equipment at a hidden height threshold.
      // A deliberately equipped manual glider still responds to held ascend input above.
      if (p.dropping && !p.suitFlight) {
        if (p.launched && p.vy > 0) p.gliding=false;
        else if (!p.gliding) p.vy=Math.max(p.vy,-26);
      }
      const wingMove038=suitMovement(p,i,dt);
      if (p.gliding && !wingMove038) {
        // Always drift forward along the view, steer with movement input.
        const f = { x: Math.sin(p.angle), z: Math.cos(p.angle) };
        x = f.x * 0.75 + x * 0.5;
        z = f.z * 0.75 + z * 0.5;
        const m = Math.max(1, Math.hypot(x, z));
        x /= m;
        z /= m;
      }
      const body = this.bodies.get(p.id),
        speed = p.dropping
          ? 13
          : (p.gliding ? 10 : p.sprinting ? 9 : 5.8) *
            (p.healing > 0 ? 0.35 : 1) *
            // Walking while drinking or bandaging; RUSH makes you quicker.
            (p.using ? 0.55 : 1) *
            (p.rush > 0 && !p.gliding ? 1.3 : 1) *
            // Caught in the brood mother's web: a crawl until it tears.
            (p.webbed > 0 && !p.dropping ? 0.45 : 1) *
            (p.gliding ? 1 : w.move || 1) *
            (p.gliding ? 1 : p.perks?.speed || 1) *
            (p.gliding || p.dropping ? 1 : carryWeight(p)),
        push = p.push || { x: 0, z: 0 };
      // Knock-back and portal flings fade out over about a second.
      if (p.push) {
        const k = Math.exp(-2.2 * dt);
        p.push = Math.hypot(push.x, push.z) * k < 0.2 ? null : { x: push.x * k, z: push.z * k };
      }
      const conveyor034 = this.escalators.carry(p,i,dt);
      if (conveyor034.id) p.vy = 0;
      this.controller.computeColliderMovement(
        body.collider,
        { x: ((wingMove038?.x ?? x * speed) + push.x) * dt + conveyor034.x, y: p.vy * dt + conveyor034.y, z: ((wingMove038?.z ?? z * speed) + push.z) * dt + conveyor034.z },
        undefined,
        undefined,
        (c) => !c.parent(),
      );
      const m = sweepVehicleContacts(this.map, p, this.controller.computedMovement());
      p.x = clamp(p.x + m.x, -this.map.limit.x + 0.4, this.map.limit.x - 0.4);
      p.z = clamp(p.z + m.z, -this.map.limit.z + 0.4, this.map.limit.z - 0.4);
      p.y = clamp(p.y + m.y, -32, p.cheats.flight && !p.dropping ? 32 : 145);
      p.grounded = this.controller.computedGrounded() || m.supported || (!!conveyor034.id && Math.abs(m.y-conveyor034.y)<.06);
      if (p.grounded || (p.vy > 0 && m.y < p.vy * dt - 0.001)) p.vy = 0;
      if (p.grounded) {p.gliding = p.dropping = p.launched = false;stopWings(p);}
      p.moving = Math.hypot(m.x-conveyor034.x, m.z-conveyor034.z) / dt;
      body.body.setTranslation({ x: p.x, y: p.y + 0.84, z: p.z }, false);
      body.body.setNextKinematicTranslation({ x: p.x, y: p.y + 0.84, z: p.z });
      // C4: the detonator fires every charge this player has placed, whatever they are holding now (once per press).
      if (i.detonate && !p.detonateHeld) this.detonate(p);
      p.detonateHeld = !!i.detonate;
      // Items: a press of the fire button starts using the one in your hands.
      // Holding the button through a weapon switch still counts; after one use, let go before the next.
      if (!i.fire) p.useArmed = true;
      if (w.consumable) {
        if (i.fire && p.useArmed !== false && !p.using && p.cooldown === 0 && !p.healing && item?.ammo > 0) {
          const blocked = this.useBlocked(p, w);
          if (!blocked) {
            p.using = { slot: p.slot, w: p.weapon, t: w.use, time: w.use };
            p.useArmed = false;
            p.emote = 0;
            p.reload = 0;
            this.events.push({ type: 'use-start', id: p.id, item: p.weapon });
          } else if (!p.fireHeld) this.events.push({ type: 'use-blocked', id: p.id, why: blocked });
        }
        p.fireHeld = !!i.fire;
        continue;
      }
      p.fireHeld = !!i.fire;
      if (w.melee) {
        if (i.fire && p.cooldown === 0 && !p.healing) this.melee(p);
        continue;
      }
      if (!item) continue;
      if (w.spinup) p.spin = clamp(p.spin + (i.fire && !p.reload ? dt : -dt * 1.5) / w.spinup, 0, 1);
      // MOMENTUM (STRENGTH 10): one reload in three is over before it starts.
      const reloadTime = () => {
        if (p.perks?.momentum && this.random() < 0.3) {
          this.events.push({ type: 'momentum', id: p.id });
          return 0.001;
        }
        return stats.reload * (p.perks?.reload || 1);
      };
      if (i.reload && item.ammo < stats.mag && item.reserve > 0 && !p.reload) p.reload = reloadTime();
      if (i.fire && p.cooldown === 0 && !p.reload && !p.healing && (!w.spinup || p.spin >= 1)) {
        if (item.ammo > 0) this.shoot(p);
        else if (item.reserve > 0) p.reload = reloadTime();
      }
    }
    // A full physics step is only needed when colliders were added or removed (it rebuilds the broad phase, which
    // costs milliseconds on the big city map). Otherwise just move the player capsules.
    if (this.physicsDirty) {
      this.physicsDirty = false;
      this.world.step();
    } else this.world.propagateModifiedBodyPositionsToColliders();
    // Recent positions (≈ 0.4 s) for lag compensation.
    this.trails ||= new Map();
    this.stepDt = dt;
    for (const p of this.players) {
      let t = this.trails.get(p.id);
      if (!t) this.trails.set(p.id, (t = []));
      t.push({ x: p.x, y: p.y, z: p.z, alive: p.hp > 0 });
      if (t.length > Math.ceil(0.4 / dt)) t.shift();
    }
    this.stepProjectiles(dt);
    this.stepCharges(dt);
    this.stepSmoke(dt);
    this.stepDeployables(dt);
    this.bosses.step(dt);
    // Respawning modes restock: an opened chest closes again, with new contents, 45 s later.
    if (this.respawns && this.tick % 30 === 0)
      for (const c of this.chests)
        if (c.opened && c.kind !== 'drop' && this.tick - (c.openedAt ?? this.tick) > 45 * 60) {
          Object.assign(c, rollChest(this.random, c.tier), { opened: false, openedAt: undefined });
          this.events.push({ type: 'chest-refill', chest: c.id, x: c.x, y: c.y || 0, z: c.z });
        }
    if (this.navDirty && this.tick % 20 === 0) {
      this.navDirty = false;
      this.nav = new Navigation(navigationMap(this.map));
      for (const p of this.players) if (p.bot) p.brain.pathTimer = 0;
    }
    if (this.zone.fixed)
      for (const p of this.players)
        if (p.hp > 0 && Math.hypot(p.x - this.zone.x, p.z - this.zone.z) > this.zone.radius) this.damage(null, p, 10 * dt);
    if (this.mode === 'royale') {
      for (const p of this.players)
        if (p.hp > 0 && Math.hypot(p.x - this.zone.x, p.z - this.zone.z) > this.zone.radius)
          this.damage(null, p, (this.time < 60 ? 18 : 8) * dt);
      const alive = this.players.filter((p) => p.hp > 0),
        teams = new Set(alive.map((p) => p.team));
      // The last squad standing wins; a surviving human is named winner over their bot-free team.
      if (this.players.length > 1 && teams.size <= 1) {
        this.winner = (alive.find((p) => !p.bot) || alive[0])?.id || 'draw';
        this.events.push({ type: 'end' });
      }
    } else if (this.mode === 'survival') {
      const human = this.players.find((p) => !p.bot);
      if (human) {
        if (human.hp <= 0) {
          this.winner = 'bots';
          this.events.push({ type: 'end' });
        } else if (this.players.some((p) => p.bot && !p.helperOf) && !this.players.some((p) => p.bot && !p.helperOf && p.hp > 0)) {
          this.winner = human.id;
          this.events.push({ type: 'end' });
        }
      }
    } else if (this.mode !== 'debug' && this.mode !== 'tutorial') {
      const winner = this.players.find((p) => p.score >= this.scoreLimit);
      if (winner || this.time <= 0) {
        this.winner = winner?.id || [...this.players].sort((a, b) => b.score - a.score)[0]?.id || '';
        this.intermission = 7;
      }
    }
  }
  alert(p, w) {
    if (w.silent) return;
    for (const o of this.players)
      if (o.bot && o.hp > 0 && o.id !== p.id && o.team !== p.team && Math.hypot(o.x - p.x, o.z - p.z) < 28) {
        o.brain.lastSeen = { x: p.x, z: p.z };
        o.brain.memory = 4;
      }
  }
  // Melee: the nearest enemy inside the swing cone and reach, with nothing solid in between.
  melee(p) {
    const w = weaponStats(p.weapon, p.rarity);
    p.cooldown = w.interval;
    p.shot++;
    p.shield = 0;
    const origin = { x: p.x, y: p.y + EYE_HEIGHT - 0.3, z: p.z };
    let victim = null,
      best = Infinity;
    for (const o of this.enemies(p)) {
      if (o.shield > 0) continue;
      const dx = o.x - p.x,
        dz = o.z - p.z,
        d = Math.hypot(dx, dz);
      if (d > w.range + 0.35 || Math.abs(o.y - p.y) > 1.7) continue;
      const facing = d < 0.6 ? 1 : (dx * Math.sin(p.angle) + dz * Math.cos(p.angle)) / d;
      if (facing < Math.cos(w.arc)) continue;
      const to = { x: dx, y: o.y + 1 - origin.y, z: dz },
        len = Math.hypot(to.x, to.y, to.z) || 0.01;
      if (castMap(origin, { x: to.x / len, y: to.y / len, z: to.z / len }, len, this.map, null, true).distance < len - 0.4)
        continue;
      if (d < best) {
        best = d;
        victim = o;
      }
    }
    // Bosses in reach take the blow when no player is closer.
    const eyeRay = this.bosses.ray({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z }, direction(p.angle, p.pitch), w.range + 1.2);
    if (eyeRay && (!victim || eyeRay.distance < best)) {
      victim = null;
      this.bosses.damage(eyeRay.boss, w.damage * 1.2 * (p.perks?.melee || 1), p);
      this.events.push({ type: 'melee', id: p.id, weapon: p.weapon, hit: true, wall: null, x: eyeRay.boss.x, y: eyeRay.boss.y + 1.6, z: eyeRay.boss.z, shot: p.shot });
      return;
    }
    // No one in reach: the blade bites into whatever is in front — walls get cut, furniture breaks.
    let struck = null;
    if (!victim) {
      const eye = { x: p.x, y: p.y + EYE_HEIGHT, z: p.z },
        dir = direction(p.angle, p.pitch),
        cast = castMap(eye, dir, w.range * 0.8, this.map),
        o = cast.impact?.obstacle;
      if (o) {
        struck = { x: eye.x + dir.x * cast.distance, y: eye.y + dir.y * cast.distance, z: eye.z + dir.z * cast.distance };
        if (o.panel !== undefined) {
          const [len, height] = CUTS[w.model] || [2, 1],
            inside = { x: struck.x + dir.x * 0.06, y: struck.y + dir.y * 0.06, z: struck.z + dir.z * 0.06 };
          struck.cells = this.hitCells(o, cutHits(o, inside, len, height), p);
          struck.color = o.color;
        } else if (o.hp !== undefined) this.damageObstacle(o, w.damage * 1.5, p);
      }
    }
    this.events.push({
      type: 'melee',
      id: p.id,
      weapon: p.weapon,
      hit: !!victim,
      wall: struck ? { cells: struck.cells || 0, color: struck.color } : null,
      x: victim ? victim.x : struck ? struck.x : p.x + Math.sin(p.angle) * w.range,
      y: victim ? victim.y + 1.1 : struck ? struck.y : origin.y,
      z: victim ? victim.z : struck ? struck.z : p.z + Math.cos(p.angle) * w.range,
      shot: p.shot,
    });
    if (victim) {
      // CYBER STRIKE (STRENGTH 10): one blow in three lands as a one-hit kill.
      const cyber = p.perks?.cyber && this.random() < 0.3;
      if (cyber) this.events.push({ type: 'crit', id: p.id, victim: victim.id, cyber, x: victim.x, y: victim.y + 1.1, z: victim.z });
      this.damage(p, victim, cyber ? 999 : Math.round(w.damage * (p.bot ? 0.5 : 1) * (p.perks?.melee || 1)));
      this.alert(p, w);
    }
  }
  shoot(p) {
    const item = this.held(p),
      w = weaponStats(p.weapon, p.rarity);
    if (!p.cheats.infinite) item.ammo--;
    p.cooldown = w.interval;
    p.shot++;
    p.shield = 0;
    this.alert(p, w);
    if (w.speed) {
      const dir = direction(p.angle, p.pitch);
      this.projectiles.push({
        id: ++this.projectileId,
        owner: p.id,
        x: p.x,
        y: p.y + EYE_HEIGHT,
        z: p.z,
        vx: dir.x * w.speed,
        vy: dir.y * w.speed,
        vz: dir.z * w.speed,
        dx: dir.x,
        dy: dir.y,
        dz: dir.z,
        life: (w.range / w.speed) * (w.gravity ? 2 : 1),
        weapon: p.weapon,
        rarity: p.rarity,
        kind: w.projectile,
      });
      this.events.push({ type: 'launch', id: p.id, weapon: p.weapon });
      return;
    }
    for (let k = 0; k < w.pellets; k++) {
      const a = p.angle + (this.random() - 0.5) * w.spread,
        pitch = p.pitch + (this.random() - 0.5) * w.spread * 0.65;
      const dir = direction(a, pitch),
        origin = { x: p.x, y: p.y + EYE_HEIGHT, z: p.z };
      const cast = castMap(origin, dir, w.range, this.map);
      let distance = cast.distance,
        impact = cast.impact,
        victim = null;
      for (const o of this.enemies(p)) {
        if (o.shield > 0) continue;
        const at = this.seenAt(p, o),
          near = rayBox(
            origin,
            dir,
            { x: at.x - 0.34, y: at.y, z: at.z - 0.34 },
            { x: at.x + 0.34, y: at.y + 1.9, z: at.z + 0.34 },
            w.range,
          );
        if (near < distance) {
          distance = near;
          victim = o;
          impact = { kind: 'body', x: -dir.x, y: -dir.y, z: -dir.z };
        }
      }
      this.events.push({
        type: 'shot',
        id: p.id,
        x: p.x,
        y: origin.y,
        z: p.z,
        ex: p.x + dir.x * distance,
        ey: origin.y + dir.y * distance,
        ez: p.z + dir.z * distance,
        hit: !!victim,
        weapon: p.weapon,
        impact: impact && { kind: impact.kind, x: impact.x, y: impact.y, z: impact.z },
        pellet: k,
        shot: p.shot,
      });
      const boss = this.bosses.ray(origin, dir, distance);
      if (boss) {
        distance = boss.distance;
        victim = null;
        impact = { kind: 'body', x: -dir.x, y: -dir.y, z: -dir.z };
        const last = this.events[this.events.length - 1];
        Object.assign(last, { ex: p.x + dir.x * distance, ey: origin.y + dir.y * distance, ez: p.z + dir.z * distance, hit: true, impact: { ...impact } });
        this.bosses.damage(boss.boss, w.damage, p);
      } else if (victim) this.damage(p, victim, Math.round(w.damage * (p.bot ? 0.5 : 1)));
      else if (impact?.obstacle && impact.obstacle.panel === undefined && impact.obstacle.hp !== undefined && impact.obstacle.part !== 'upper')
        this.damageObstacle(impact.obstacle, w.damage * 0.6, p);
      else if (impact?.obstacle?.panel !== undefined)
        this.chipWall(impact.obstacle, { x: p.x + dir.x * distance, y: origin.y + dir.y * distance, z: p.z + dir.z * distance }, dir, w.damage, p);
    }
  }
  // Where the shooter saw a target: a state takes half a round trip to reach them, is shown `interp` ms late
  // (netcode.js Interpolator) and the shot takes the other half back, so hitscan shots are checked against
  // positions a round trip plus that delay back (capped at 350 ms; the trails keep 0.4 s).
  seenAt(shooter, o) {
    if (shooter.bot || !shooter.lag) return o;
    const trail = this.trails?.get(o.id);
    if (!trail?.length) return o;
    const back = Math.round(Math.min(350, shooter.lag + (shooter.interp ?? 50)) / 1000 / (this.stepDt || 1 / 60)),
      k = Math.max(0, trail.length - 1 - back),
      at = trail[k];
    return at.alive ? at : o;
  }
  equip(p, slot) {
    if (Number.isInteger(slot) && p.slots[slot] && slot !== p.slot) {
      p.slot = slot;
      this.syncHeld(p);
      p.reload = 0;
      p.spin = 0;
      p.cooldown = Math.max(p.cooldown, 0.25);
    }
  }
  // Pre-match loadout (validated). Also accepts a legacy weapon index for the primary slot.
  setLoadout(p, loadout = null) {
    if (Number.isInteger(loadout)) loadout = { ...p.loadout, primary: loadout };
    p.loadout = sanitizeLoadout(loadout);
    // The chosen loadout only arms a player in the 'loadout' kit; otherwise it is kept for the lobby.
    if (this.kit !== 'loadout') return;
    p.slots = loadoutSlots(p.loadout);
    p.slot = 1;
    this.syncHeld(p);
    p.gear = makeGear(p.loadout.gear);
  }
  // Skill-tree ranks from a client, clamped to the table in skills.js. Bots never carry perks.
  setSkills(p, skills) {
    if (!p || p.bot) return;
    p.skills = packSkills(typeof skills === 'string' ? unpackSkills(skills) : skills || {});
    p.perks = skillPerks(unpackSkills(p.skills));
  }
  dropLoot(x, z, contents, by = null) {
    const drop = {
      id: 'drop' + ++this.dropId,
      kind: 'drop',
      x,
      y: groundHeight(x, z, this.map),
      z,
      loot: contents.loot ? { w: contents.loot.w, r: contents.loot.r } : null,
      ammo: contents.loot?.ammo,
      reserve: contents.loot?.reserve,
      medkits: contents.medkits || 0,
      armor: contents.armor || 0,
      plate: contents.plate || null,
      gear: contents.gear || null,
      opened: false,
      by,
    };
    this.chests.push(drop);
    // Keep the loot list bounded in long Training sessions.
    const drops = this.chests.filter((c) => c.kind === 'drop');
    if (drops.length > 90) this.chests.splice(this.chests.indexOf(drops[0]), 1);
    return drop;
  }
  openChest(p) {
    const c = this.chests
      // Bots never re-take what they just swapped out (that would loop forever).
      .filter(
        (c) =>
          !c.opened &&
          !(p.bot && c.by === p.id) &&
          Math.hypot(c.x - p.x, c.z - p.z) < 2.8 &&
          // Same level: a roof chest is not opened from the storey below.
          Math.abs((c.y || 0) - (p.y || 0)) < 1.8 &&
          lineClear(p, c, 0, this.map.obstacles),
      )
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!c) return false;
    c.opened = true;
    c.openedAt = this.tick;
    let result = { slot: -1, dropped: null };
    if (c.loot) {
      const item = makeItem(c.loot.w, c.loot.r);
      if (c.ammo !== undefined) item.ammo = c.ammo;
      if (c.reserve !== undefined) item.reserve = c.reserve;
      // Bots with a full inventory only swap for something rarer than what they would drop.
      const full = !WEAPONS[item.w].melee && p.slots.slice(1).every(Boolean) && !p.slots.some((x) => x?.w === item.w),
        swapped = p.slots[p.slot > 0 ? p.slot : 1];
      if (!(p.bot && full && swapped && item.r <= swapped.r)) result = addItem(p, item);
      if (result.slot === p.slot || !this.held(p)) p.reload = 0;
      this.syncHeld(p);
    }
    // The item a chest holds on top of its weapon: into a free slot or its stack, else onto the ground by the chest.
    let extraTaken = false;
    if (c.extra && WEAPONS[c.extra.w]) {
      const ex = makeItem(c.extra.w, c.extra.r),
        wx = WEAPONS[ex.w],
        stack = p.slots.some((q, k) => k > 0 && q?.w === ex.w && (!wx.consumable || q.ammo < wx.mag)),
        free = p.slots.some((q, k) => k > 0 && !q);
      if (stack || free) {
        addItem(p, ex);
        this.syncHeld(p);
        extraTaken = true;
      } else this.dropLoot(c.x + Math.sin(p.angle + 2) * 0.9, c.z + Math.cos(p.angle + 2) * 0.9, { loot: ex }, null);
    }
    restockAmmo(p);
    p.medkits = Math.min(5, p.medkits + (c.medkits || 0));
    p.armor = Math.min(100, p.armor + (c.armor || 0));
    if (c.plate) wearArmor(p, c.plate);
    let oldGear = null;
    if (c.gear && p.gear?.id !== c.gear) {
      oldGear = p.gear?.id || null;
      p.gear = makeGear(c.gear);
    }
    if (result.dropped || oldGear)
      this.dropLoot(
        p.x + Math.sin(p.angle) * 0.9,
        p.z + Math.cos(p.angle) * 0.9,
        { loot: result.dropped, gear: oldGear },
        p.id,
      );
    this.events.push({
      type: 'loot',
      id: p.id,
      chest: c.id,
      weapon: c.loot?.w ?? null,
      rarity: c.loot?.r ?? 0,
      gear: c.gear || null,
      extra: c.extra?.w ?? null,
      extraTaken,
      unlocked: !!c.loot && !result.merged,
      x: c.x,
      y: c.y || 0,
      z: c.z,
      tier: c.tier || c.kind,
    });
    return true;
  }
  damage(attacker, victim, amount, byBoss = null) {
    if (victim.vehicle && this.vehicles.damageMounted(victim, amount, attacker)) return;
    if (victim.hp <= 0 || victim.shield > 0 || victim.cheats.god || victim.inBus) return;
    // Helper bots score for the player who summoned them.
    if (attacker?.helperOf) attacker = this.players.find((p) => p.id === attacker.helperOf && p.team === attacker.team) || attacker;
    // No friendly fire between squadmates (self-damage from your own rocket still applies).
    if (attacker && attacker !== victim && attacker.team === victim.team) return;
    if (victim.bot) {
      victim.brain.hurtAt = this.tick / 60;
      if (attacker && attacker !== victim) {
        victim.brain.lastSeen = { x: attacker.x, z: attacker.z };
        victim.brain.memory = 4;
      }
    }
    // Firepower and Hard Target: small, capped multipliers from the skill tree.
    // (Damage-over-time comes in fractions of a point, so this must not round.)
    amount = amount * (attacker && attacker !== victim ? attacker.perks?.damage || 1 : 1) * (victim.perks?.taken || 1);
    if (amount <= 0) return;
    // A ballistic shield stops most of what comes at its face, until it gives way.
    const guard = victim.gear?.id === 'shield' && victim.gear.hp > 0 ? GEAR.find((g) => g.id === 'shield') : null;
    if (guard && attacker && attacker !== victim) {
      const to = { x: attacker.x - victim.x, z: attacker.z - victim.z },
        len = Math.hypot(to.x, to.z) || 1,
        facing = (to.x * Math.sin(victim.angle) + to.z * Math.cos(victim.angle)) / len;
      if (facing > 0.34) {
        const stopped = Math.min(victim.gear.hp, amount * guard.block);
        victim.gear.hp -= stopped;
        amount -= stopped;
        this.events.push({ type: 'guard', id: victim.id, hp: Math.max(0, Math.round(victim.gear.hp)), x: victim.x, y: victim.y + 1.2, z: victim.z });
        if (victim.gear.hp <= 0) {
          victim.gear = null;
          this.events.push({ type: 'guard-break', id: victim.id, x: victim.x, y: victim.y + 1.1, z: victim.z });
        }
        if (amount < 0.5) return;
      }
    }
    const absorbed = Math.min(victim.armor, Math.round(amount * 0.5));
    victim.armor -= absorbed;
    if (absorbed > 0 && victim.armor <= 0) this.events.push({ type: 'armor-break', id: victim.id, x: victim.x, y: victim.y + 1.2, z: victim.z });
    victim.hp = Math.max(0, victim.hp - amount + absorbed);
    // Damage numbers over the target, for the player who dealt them (humans only: bots need none).
    if (attacker && !attacker.bot && attacker !== victim)
      this.events.push({ type: 'dmg', by: attacker.id, id: victim.id, n: Math.round(amount), armor: absorbed > 0, x: victim.x, y: victim.y + 2, z: victim.z });
    victim.healing = 0;
    if (victim.hp === 0) {
      if (victim.vehicle) this.vehicles.detach(victim.id);
      victim.respawn = this.respawns ? 3 : 0;
      victim.deaths++;
      victim.moving = 0;
      victim.gliding = victim.thrusting = victim.dropping = false;
      if (attacker && attacker !== victim) attacker.score++;
      this.events.push({ type: 'kill', by: attacker?.id || byBoss || victim.id, victim: victim.id, weapon: attacker?.weapon });
      this.bosses.onDeath(victim);
      this.technology?.onDeath(victim);
      victim.using = victim.regen = null;
      victim.rush = victim.stim = 0;
      // Everything they carried spills around them (never bare hands). Survival: only bots drop.
      if (this.mode !== 'survival' || victim.bot) {
        const items = [...victim.slots.slice(1), victim.slots[0]].filter((s) => s && !WEAPONS[s.w].fists);
        const first = items.shift() || null;
        // Nothing but bare hands and no supplies: nothing to leave behind.
        if (first || victim.medkits > 0 || victim.armorTier || victim.gear)
          this.dropLoot(victim.x, victim.z, {
            loot: first,
            medkits: victim.medkits > 0 ? 1 : 0,
            armor: 0,
            plate: victim.armorTier,
            gear: victim.gear?.id || null,
          });
        items.forEach((it, k) => {
          const a = victim.angle + ((k + 1) / (items.length + 1)) * Math.PI * 2;
          this.dropLoot(victim.x + Math.sin(a) * 1.1, victim.z + Math.cos(a) * 1.1, { loot: it });
        });
      }
    }
  }
  // Area damage to players (occluded by walls) and to destructible structures and props. A boss's own blasts
  // hurt players themselves (credited to the boss) and pass { players: false, bosses: false }; spikes are `silent`
  // (they draw their own effect instead of an explosion).
  blast(x, y, z, radius, damage, owner, cause = 'explosion', source = null, { players = true, bosses = true, silent = false } = {}) {
    if (!silent) this.events.push({ type: 'explosion', x, y, z, id: owner?.id, radius, cause });
    if (bosses) this.bosses?.blast(x, y, z, radius, damage, owner);
    for (const p of players ? this.players : []) {
      const d = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
      if (p.hp <= 0 || d > radius) continue;
      if (owner && owner !== p && owner.team === p.team) continue;
      const to = { x: p.x - x, y: p.y + 0.9 - y, z: p.z - z },
        length = Math.hypot(to.x, to.y, to.z) || 0.01,
        dd = { x: to.x / length, y: to.y / length, z: to.z / length },
        origin = { x, y: y + 0.08, z };
      const blocked = castMap(origin, dd, length + 0.1, this.map, source, true).distance < length - 0.1;
      if (!blocked) this.damage(owner, p, Math.round(damage * (1 - (d / radius) * 0.75) * (owner?.bot ? 0.5 : 1)));
    }
    const hits = [],
      walls = [],
      shaken = new Map(),
      carve = radius * 0.5;
    this.map.obstacles.grid.query(x - radius, z - radius, x + radius, z + radius, (o) => {
      if (o === source) return;
      const d = boxDistance(o, x, y, z);
      if (d >= radius) return;
      const b = o.building !== undefined ? this.map.buildings[o.building] : null;
      if (b && !b.collapsed && ['upper', 'roof', 'wall', 'lintel'].includes(o.part)) {
        const amount = damage * Math.pow(1 - d / radius, 0.7);
        if (!shaken.has(b) || shaken.get(b).amount < amount) shaken.set(b, { amount, o });
      }
      if (o.panel !== undefined) {
        if (d < carve) walls.push(o);
      } else if (o.hp !== undefined) hits.push([o, damage * 1.6 * Math.pow(1 - d / radius, 0.7)]);
    });
    for (const o of walls) this.hitCells(o, sphereHits(o, x, y, z, carve, damage * 1.6), owner);
    applyBlastHits(this, hits, owner);
    // No hidden building hit points: a building only comes down when its walls really fail. Hits on the
    // roof and facades just throw chunks.
    for (const [b, { amount, o }] of shaken) {
      if (b.collapsed) continue;
      if (o.part === 'upper' || o.part === 'roof')
        this.events.push({
          type: 'chunks',
          building: b.id,
          x: Math.max(o.x - o.w / 2, Math.min(o.x + o.w / 2, x)),
          y: Math.max(o.y - o.h / 2, Math.min(o.y + o.h / 2, y)),
          z: Math.max(o.z - o.d / 2, Math.min(o.z + o.d / 2, z)),
          color: b.color,
          n: Math.round(8 + amount / 8),
        });
    }
  }
  explode(r, w, owner) {
    const len = Math.hypot(r.dx, r.dy, r.dz) || 1;
    // Step back along the flight path so the blast centre sits in open air, not inside the surface it hit.
    this.blast(
      r.x - (r.dx / len) * 0.12,
      r.y - (r.dy / len) * 0.12,
      r.z - (r.dz / len) * 0.12,
      w.radius,
      w.damage,
      owner,
    );
  }
  // Does a cloud of smoke sit between two points? (Bots cannot see through it; bullets still fly through.)
  smoked(a, b) {
    if (!this.smokes.length) return false;
    const ax = a.x,
      az = a.z,
      dx = b.x - ax,
      dz = b.z - az,
      len = Math.hypot(dx, dz) || 1e-6;
    for (const s of this.smokes) {
      // Distance from the smoke centre to the segment.
      const t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / (len * len))),
        px = ax + dx * t,
        pz = az + dz * t;
      if (Math.hypot(s.x - px, s.z - pz) < s.r * s.grow) return true;
    }
    return false;
  }
  // A flashbang: everyone who can see it go off is blinded for a moment, bots included.
  flash(x, y, z, w, owner) {
    this.events.push({ type: 'flashbang', x, y, z, radius: w.radius, id: owner?.id });
    for (const p of this.players) {
      if (p.hp <= 0 || p.cheats.god) continue;
      const d = Math.hypot(p.x - x, p.y + 1.4 - y, p.z - z);
      if (d > w.radius) continue;
      if (!lineClear({ x, z }, p, 0, this.map.obstacles)) continue;
      // Looking at it is worse than having it behind you.
      const to = { x: x - p.x, z: z - p.z },
        len = Math.hypot(to.x, to.z) || 1,
        facing = (to.x * Math.sin(p.angle) + to.z * Math.cos(p.angle)) / len,
        time = (1 - d / w.radius) * (facing > 0 ? 3.2 : 1.4);
      if (time < 0.25) continue;
      p.blinded = Math.max(p.blinded || 0, time);
      if (p.bot) p.brain.memory = 0;
    }
  }
  // A grenade that has run out of fuse: fragments, light or smoke.
  detonateGrenade(r, w, owner) {
    if (w.projectile === 'flash') this.flash(r.x, r.y, r.z, w, owner);
    else if (w.projectile === 'impulse') this.impulse(r.x, r.y + 0.3, r.z, w, owner);
    else if (w.projectile === 'smoke') {
      const s = { id: ++this.smokeId, x: r.x, y: r.y, z: r.z, r: w.radius, t: w.smoke || 12, grow: 0.2 };
      this.smokes.push(s);
      this.events.push({ type: 'smoke', id: s.id, x: s.x, y: s.y, z: s.z, radius: s.r, time: s.t });
    } else this.explode(r, w, owner);
  }
  stepSmoke(dt) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt;
      // The cloud billows out over a second and thins away at the end.
      s.grow = Math.min(1, s.grow + dt * 1.1) * Math.min(1, Math.max(0.15, s.t / 2));
      if (s.t <= 0) this.smokes.splice(i, 1);
    }
    for (const p of this.players) if (p.blinded > 0) p.blinded = Math.max(0, p.blinded - dt);
  }
  // A thrown charge sticks to the surface it hit, its face turned along the surface normal.
  placeCharge(r, impact, w) {
    const max = Math.max(1, WEAPONS[r.weapon].charges || 4),
      mine = this.charges.filter((c) => c.owner === r.owner);
    // Only the newest charges stay armed; placing one more drops the oldest.
    for (let k = 0; k <= mine.length - max; k++) this.charges.splice(this.charges.indexOf(mine[k]), 1);
    const n = impact && Number.isFinite(impact.x) ? impact : { x: 0, y: 1, z: 0 },
      c = {
        id: ++this.chargeId,
        owner: r.owner,
        weapon: r.weapon,
        rarity: r.rarity,
        x: r.x + n.x * 0.06,
        y: r.y + n.y * 0.06,
        z: r.z + n.z * 0.06,
        nx: n.x,
        ny: n.y,
        nz: n.z,
        t: 0,
      };
    this.charges.push(c);
    this.events.push({ type: 'plant', id: r.owner, charge: c.id, x: c.x, y: c.y, z: c.z, radius: w.radius });
    return c;
  }
  // Every charge of one player goes off at once.
  detonate(p) {
    const mine = this.charges.filter((c) => c.owner === p.id);
    if (!mine.length) return false;
    this.charges = this.charges.filter((c) => c.owner !== p.id);
    this.events.push({ type: 'detonate', id: p.id, charges: mine.map((c) => c.id) });
    for (const c of mine) {
      const w = weaponStats(c.weapon, c.rarity);
      this.blast(c.x + c.nx * 0.12, c.y + c.ny * 0.12, c.z + c.nz * 0.12, w.radius, w.damage, p);
    }
    return true;
  }
  stepCharges(dt) {
    // Charges of a player who died or left are defused; bots have no detonator, so theirs run on a fuse.
    this.charges = this.charges.filter((c) => {
      const owner = this.players.find((p) => p.id === c.owner);
      if (!owner || owner.hp <= 0) return false;
      c.t += dt;
      return true;
    });
    for (const p of this.players) if (p.bot && this.charges.some((c) => c.owner === p.id && c.t > 2.2)) this.detonate(p);
  }
  stepProjectiles(dt) {
    for (let n = this.projectiles.length - 1; n >= 0; n--) {
      const r = this.projectiles[n],
        w = weaponStats(r.weapon, r.rarity);
      // A grenade that has come to rest just counts down where it lies.
      if (r.rest !== undefined) {
        r.rest -= dt;
        // A clinger stuck to someone rides along with them.
        if (r.stuck) {
          const host = this.players.find((q) => q.id === r.stuck.id && q.hp > 0);
          if (host) Object.assign(r, { x: host.x + r.stuck.dx, y: host.y + r.stuck.dy, z: host.z + r.stuck.dz });
        }
        if (r.rest > 0) continue;
        this.detonateGrenade(r, w, this.players.find((p) => p.id === r.owner));
        this.projectiles.splice(n, 1);
        continue;
      }
      if (w.fuse) {
        r.flight = (r.flight || 0) + dt;
        // A grenade cooked too long goes off in the air (a clinger only arms when it sticks).
        if (r.flight >= (w.projectile === 'sticky' ? w.fuse + 3 : w.fuse)) {
          this.detonateGrenade(r, w, this.players.find((p) => p.id === r.owner));
          this.projectiles.splice(n, 1);
          continue;
        }
      }
      if (w.gravity) r.vy -= w.gravity * dt;
      const speed = Math.hypot(r.vx, r.vy, r.vz) || 1,
        dir = { x: r.vx / speed, y: r.vy / speed, z: r.vz / speed },
        len = speed * dt;
      r.dx = dir.x;
      r.dy = dir.y;
      r.dz = dir.z;
      const cast = castMap(r, dir, len, this.map);
      let distance = cast.distance,
        impact = !!cast.impact,
        victim = null;
      const owner = this.players.find((p) => p.id === r.owner);
      for (const p of this.players)
        if (p.id !== r.owner && p.hp > 0) {
          const d = rayBox(
            r,
            dir,
            { x: p.x - 0.4, y: p.y, z: p.z - 0.4 },
            { x: p.x + 0.4, y: p.y + 1.9, z: p.z + 0.4 },
            len,
          );
          if (d <= distance) {
            distance = d;
            impact = true;
            victim = p;
          }
        }
      const bossHit = this.bosses.ray(r, dir, distance);
      if (bossHit) {
        distance = bossHit.distance;
        impact = true;
        victim = null;
      }
      r.x += dir.x * distance;
      r.y += dir.y * distance;
      r.z += dir.z * distance;
      r.life -= dt;
      if (bossHit && !w.radius) this.bosses.damage(bossHit.boss, w.damage, owner);
      if (Math.abs(r.x) > this.map.limit.x || Math.abs(r.z) > this.map.limit.z || r.y < -1) impact = true;
      // A grenade lands, rolls to a stop and burns down its fuse; the fuse also runs in the air.
      if (w.fuse) {
        if (!impact) continue;
        r.vx = r.vy = r.vz = 0;
        if (w.projectile === 'sticky') {
          // Stuck fast: to a player it hit, or to the surface, with its own fuse from now on.
          r.rest = w.fuse;
          if (victim) r.stuck = { id: victim.id, dx: r.x - victim.x, dy: Math.max(0.6, Math.min(1.6, r.y - victim.y)), dz: r.z - victim.z };
          else {
            r.x -= dir.x * 0.04;
            r.y -= dir.y * 0.04;
            r.z -= dir.z * 0.04;
          }
          this.events.push({ type: 'stick', x: r.x, y: r.y, z: r.z, weapon: r.weapon, on: victim?.id || null, id: r.owner });
          continue;
        }
        r.rest = Math.max(0.05, w.fuse - r.flight);
        // Step back out of the surface it hit so the blast is not inside a wall.
        r.x -= dir.x * 0.12;
        r.y -= dir.y * 0.12 - 0.05;
        r.z -= dir.z * 0.12;
        this.events.push({ type: 'land', x: r.x, y: r.y, z: r.z, weapon: r.weapon });
        continue;
      }
      if (!impact && r.life > 0) continue;
      // A demolition charge sticks to the surface it lands on and waits for the detonator. One that hits a boss, a
      // player or flies off the map goes off at once (it used to hang in mid-air where the boss had been).
      const surface = !victim && !bossHit && !!cast.impact && distance === cast.distance;
      if (w.sticky && r.life > 0 && surface) this.placeCharge(r, cast.impact, w);
      else if (w.radius) this.explode(r, w, owner);
      else {
        // Bolts and daggers only hurt on a direct hit, and leave an impact mark otherwise.
        if (victim && impact && !(owner && owner !== victim && owner.team === victim.team) && victim.shield <= 0)
          this.damage(owner, victim, Math.round(w.damage * (owner?.bot ? 0.5 : 1)));
        else if (!victim && cast.impact?.obstacle?.panel !== undefined && distance === cast.distance)
          this.chipWall(cast.impact.obstacle, r, dir, w.damage, owner);
        this.events.push({
          type: 'impact',
          x: r.x,
          y: r.y,
          z: r.z,
          weapon: r.weapon,
          hit: !!victim,
          impact: victim
            ? { kind: 'body', x: -dir.x, y: -dir.y, z: -dir.z }
            : cast.impact && { kind: cast.impact.kind, x: cast.impact.x, y: cast.impact.y, z: cast.impact.z },
        });
      }
      this.projectiles.splice(n, 1);
    }
  }
  // ---- Items (0.27) ---------------------------------------------------------------------------------
  // Timed effects: RUSH speed, STIM stamina, the regeneration serum (health first, then armour).
  stepBuffs(p, dt) {
    if (p.rush > 0) p.rush = Math.max(0, p.rush - dt);
    if (p.stim > 0) p.stim = Math.max(0, p.stim - dt);
    const r = p.regen;
    if (!r) return;
    let k = Math.min(r.left, r.rate * dt);
    r.left -= k;
    const toHp = Math.min(k, 100 - p.hp);
    p.hp += toHp;
    k -= toHp;
    p.armor = Math.min(100, p.armor + k);
    if (r.left <= 0 || (p.hp >= 100 && p.armor >= 100)) p.regen = null;
  }
  // Why an item cannot be used right now (null when it can): nothing to restore, or not standing on something.
  useBlocked(p, w) {
    const e = w.effect || {};
    if (w.deploy) return p.grounded ? null : 'ON THE GROUND ONLY';
    const hpFull = !e.hp || p.hp >= (e.hpCap ?? 100),
      armorFull = !e.armor || p.armor >= (e.armorCap ?? 100);
    if (e.regen) return p.hp >= 100 && p.armor >= 100 ? 'ALREADY FULL' : null;
    if (e.armor && e.hp) return hpFull && armorFull ? 'ALREADY FULL' : null;
    if (e.armor) return armorFull ? (p.armor >= 100 ? 'ARMOUR FULL' : `ARMOUR ALREADY ${e.armorCap}+`) : null;
    if (e.hp && !e.stim) return hpFull ? (p.hp >= 100 ? 'HEALTH FULL' : `HEALTH ALREADY ${e.hpCap}+`) : null;
    return null;
  }
  finishUse(p, item) {
    const w = WEAPONS[item.w],
      e = w.effect || {};
    p.using = null;
    p.cooldown = 0.25;
    if (w.deploy) {
      const d = this.deploy(p, w);
      if (!d) {
        this.events.push({ type: 'use-blocked', id: p.id, why: 'NO ROOM HERE' });
        return false;
      }
    }
    if (e.hp) p.hp = Math.max(p.hp, Math.min(e.hpCap ?? 100, p.hp + e.hp));
    if (e.armor) p.armor = Math.max(p.armor, Math.min(e.armorCap ?? 100, p.armor + e.armor));
    if (e.regen) p.regen = { left: e.regen, rate: e.regen / (e.over || 10) };
    if (e.speed) p.rush = e.time || 10;
    if (e.stim) {
      p.stim = e.stim;
      p.stamina = 100;
      p.sprintLocked = false;
    }
    item.ammo--;
    this.events.push({ type: 'use', id: p.id, item: item.w, x: p.x, y: p.y, z: p.z });
    if (item.ammo <= 0) {
      p.slots[p.slot] = null;
      // On to the next thing in the belt, bare hands last.
      const next = [1, 2, 3, 4].map((k) => ((p.slot - 1 + k) % 4) + 1).find((k) => p.slots[k]);
      p.slot = next ?? 0;
      this.syncHeld(p);
    }
    return true;
  }
  // Sets a deployable down in front of a player. Returns it, or null when there is no room.
  deploy(p, w) {
    const f = { x: Math.sin(p.angle), z: Math.cos(p.angle) },
      reach = w.deploy === 'wall' ? 1.8 : w.deploy === 'pad' ? 1.6 : 1.3,
      eye = { x: p.x, y: p.y + 0.5, z: p.z },
      cast = castMap(eye, { x: f.x, y: 0, z: f.z }, reach + 0.6, this.map, null, true),
      dist = Math.min(reach, cast.distance - 0.6);
    if (dist < 0.4 && w.deploy === 'wall') return null;
    const at = dist < 0.4 ? { x: p.x, z: p.z } : { x: p.x + f.x * dist, z: p.z + f.z * dist },
      d = { id: ++this.deployId, kind: w.deploy, owner: p.id, team: p.team, x: at.x, y: p.y, z: at.z, angle: p.angle, t: 0, life: w.deploy === 'fire' ? 25 : w.deploy === 'pad' ? 120 : 150 };
    if (w.deploy === 'wall') {
      // Walls stand square to the street grid, across the way you face.
      const alongX = Math.abs(f.z) >= Math.abs(f.x),
        o = { x: at.x, y: p.y + 1.1, z: at.z, w: alongX ? 3 : 0.3, h: 2.2, d: alongX ? 0.3 : 3, hp: w.hp, part: 'deploy', deploy: d.id, color: 0x8a949c };
      // Never around a player (they would be stuck inside it).
      if (this.players.some((q) => q.hp > 0 && !q.inBus && Math.abs(q.x - o.x) < o.w / 2 + 0.45 && Math.abs(q.z - o.z) < o.d / 2 + 0.45 && q.y < o.y + 1.1 && q.y + 1.8 > o.y - 1.1))
        return null;
      d.alongX = alongX;
      d.hp = d.max = w.hp;
      this.addObs(o);
      (this.deployObs ??= new Map()).set(d.id, o);
    }
    // Only the newest few of each kind stay.
    const cap = { pad: 2, wall: 4, fire: 2 }[w.deploy] || 2,
      mine = this.deployables.filter((q) => q.owner === p.id && q.kind === d.kind);
    for (let k = 0; k <= mine.length - cap; k++) this.undeploy(mine[k]);
    this.deployables.push(d);
    this.events.push({ type: 'deploy', id: p.id, kind: d.kind, deploy: d.id, x: d.x, y: d.y, z: d.z });
    return d;
  }
  undeploy(d, broken = false) {
    const i = this.deployables.indexOf(d);
    if (i < 0) return;
    this.deployables.splice(i, 1);
    const o = this.deployObs?.get(d.id);
    if (o) {
      this.deployObs.delete(d.id);
      if (this.colliders.has(o)) this.removeObs(o);
    }
    this.events.push({ type: 'undeploy', deploy: d.id, kind: d.kind, broken, x: d.x, y: d.y, z: d.z });
  }
  stepDeployables(dt) {
    for (const d of [...this.deployables]) {
      d.t += dt;
      if (d.t >= d.life) {
        this.undeploy(d);
        continue;
      }
      if (d.kind === 'wall') {
        const o = this.deployObs?.get(d.id);
        d.hp = o ? Math.max(0, Math.round(o.hp)) : 0;
      } else if (d.kind === 'fire') {
        // Warms anyone beside it: 2 health a second.
        for (const p of this.players)
          if (p.hp > 0 && p.hp < 100 && !p.inBus && Math.hypot(p.x - d.x, p.z - d.z) < 3.4 && Math.abs(p.y - d.y) < 2) p.hp = Math.min(100, p.hp + 2 * dt);
      } else if (d.kind === 'pad')
        for (const p of this.players) {
          p.padCd = Math.max(0, (p.padCd || 0) - dt / Math.max(1, this.deployables.length));
          if (p.hp <= 0 || p.inBus || p.padCd > 0 || p.vy > 1 || Math.hypot(p.x - d.x, p.z - d.z) > 1.05 || Math.abs(p.y - d.y) > 0.7) continue;
          // Straight up, a little forward, then the glider opens on the way down.
          p.vy = 23;
          p.grounded = false;
          p.dropping = p.launched = true;
          p.padCd = 1.2;
          p.push = { x: Math.sin(p.angle) * 4, z: Math.cos(p.angle) * 4 };
          this.events.push({ type: 'pad', id: p.id, deploy: d.id, x: d.x, y: d.y, z: d.z });
        }
    }
  }
  // IMPULSE: everyone near it (the thrower too) is thrown up and away. Walls in between shelter.
  impulse(x, y, z, w, owner) {
    this.events.push({ type: 'impulse', x, y, z, radius: w.radius, id: owner?.id });
    for (const p of this.players) {
      if (p.hp <= 0 || p.inBus) continue;
      const dx = p.x - x,
        dz = p.z - z,
        d = Math.hypot(dx, p.y + 0.9 - y, dz);
      if (d > w.radius || !lineClear({ x, z }, p, 0, this.map.obstacles)) continue;
      const flat = Math.hypot(dx, dz) || 1,
        k = 1 - (d / w.radius) * 0.5,
        push = (w.knock || 20) * k;
      p.push = { x: (dx / flat) * push, z: (dz / flat) * push };
      p.vy = 8 + 5 * k;
      p.grounded = false;
      p.launched = true;
      p.healing = 0;
      if (p.bot) p.brain.pathTimer = 0;
    }
  }
  snapshot() {
    return {
      ...this.technology.snapshot(),
      constructions:this.construction.snapshot(),drones:this.drones.snapshot(),
      cheated: this.cheated,
      doors: doorSnapshot(this.map),
      lifts: this.lifts.snapshot(),
      escalators: this.escalators.snapshot(),
      vehicles: this.vehicles.snapshot(),
      vehicleShots: this.vehicles.shotSnapshot(),
      ramCleared: [...this.vehicles.clearedRubble],
      destruction: {
        panels: [...this.destruction.panels],
        decor: [...this.destruction.decor],
        buildings: [...this.destruction.buildings],
        wrecks: [...this.destruction.wrecks],
        cells: { ...this.destruction.cells },
        storeys: { ...this.destruction.storeys },
        props: [...this.destruction.props],
        roofs: [...this.destruction.roofs],
      },
      zone: this.mode === 'royale' || this.zone.fixed ? { ...this.zone } : null,
      chests: this.chests.map((c) => ({ ...c, loot: c.loot ? { ...c.loot } : null })),
      projectiles: this.projectiles.map((r) => ({ ...r })),
      charges: this.charges.map((c) => ({ ...c })),
      smokes: this.smokes.map((s) => ({ ...s })),
      deployables: this.deployables.map((d) => ({ ...d })),
      seed: this.map.seed,
      size: this.size,
      scoreLimit: this.scoreLimit,
      mode: this.mode,
      ...this.bosses.snapshot(),
      bus: this.bus ? { ...this.bus } : null,
      // Input bookkeeping (held keys, the bots' brains) stays on the server: only what clients draw goes out.
      players: this.players.map(({ input, brain, inputAge, vy, jumpHeld, sprintLocked, botInput, lag, perks, skills, dashHeld, detonateHeld, interactHeld, healHeld, emoteHeld, abilityHeld, relicSwapHeld, fireHeld, useArmed, padCd, ack, inputSeq, interp, _buildNotice040, ...p }) => ({
        ...p,
        // Only what the client draws: whether DASH is unlocked and how long it has left.
        dashCd: perks?.dash ? Math.round(p.dashCd * 10) / 10 : undefined,
        // Cosmetics ride along in every packet, so they travel packed into one short string.
        cosmetics: packCosmetics(p.cosmetics),
        slots: p.slots.map((s) => (s ? { ...s } : null)),
        materials:{...p.materials},techModules:[...(p.techModules||[])],
        gear: p.gear ? { ...p.gear } : null,
        loadout: { ...p.loadout },
      })),
      time: this.time,
      round: this.round,
      winner: this.winner,
      intermission: this.intermission,
      tick: this.tick,
    };
  }
  drainEvents() {
    return this.events.splice(0);
  }
  dispose() {
    this.construction?.dispose();this.drones?.dispose();this.technology?.dispose();
    this.lifts?.dispose();
    this.vehicles?.dispose();
    this.colliderBudget?.dispose();
    this.botBudget037?.dispose();
    this.world.free();
  }
}
