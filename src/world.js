import { BUILDING_TYPES, WEAPONS } from './catalog.js';
import { rollChest } from './items.js';
import { ObstacleGrid, isLowSolid } from './spatial.js';
import { streets, DECOR_INFO, rotatedSize } from './decor-layout.js';
import { rawHeight } from './terrain.js';
import { furnishBuilding, STAIR } from './interiors.js';
import { cellGrid, cellCenter } from './cells.js';
export const PANEL_HP = 100;
// Upper storeys: 3.36 m of wall plus a 0.24 m floor slab.
export const STOREY_HEIGHT = 3.6;
export const UPPER_WALL = 3.36;
import { groundHeight } from './terrain.js';
export { BUILDING_TYPES, WEAPONS };
export const DEFAULT_SEED = 91726;
export const LIMIT = { x: 104, z: 88 };
// Stairs of a storey: lane 0 (by the east wall) climbs north→south, lane 1 beside it climbs back, so flights
// alternate. The slab above has a stairwell over the upper two thirds of the flight.
export function stairLane(b, storey) {
  const lane = storey % 2,
    x = b.x + b.w / 2 - 0.4 - STAIR.width / 2 - lane * (STAIR.width + 0.2),
    len = STAIR.steps * STAIR.run,
    dir = lane ? -1 : 1,
    z0 = b.z - (dir * len) / 2,
    za = z0 + dir * STAIR.run * 2,
    zb = z0 + dir * (len + 0.2);
  return { x, z0, dir, holeZ0: Math.min(za, zb), holeZ1: Math.max(za, zb) };
}
export function seededRandom(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(a, rand) {
  for (let n = a.length - 1; n > 0; n--) {
    const j = Math.floor(rand() * (n + 1));
    [a[n], a[j]] = [a[j], a[n]];
  }
  return a;
}
// Map sizes: the district (10 × 7 blocks, 256 × 202 m) and the city for big online royales (24 × 18 blocks,
// ≈ 5.6× the district). Blocks are 24 × 26 m with 6 m roads between them.
export const MAP_SIZES = {
  district: { cols: 10, rows: 7, parks: 1, biomes: 1 },
  city: { cols: 24, rows: 18, parks: 7, biomes: 3 },
};
export const mapSize = (size) => (MAP_SIZES[size] ? size : 'district');
export function createWorld(seed = DEFAULT_SEED, size = 'district') {
  seed = Number(seed) >>> 0 || DEFAULT_SEED;
  size = mapSize(size);
  const { cols: C, rows: R, parks: PARKS, biomes: BIOMES } = MAP_SIZES[size],
    X0 = -C * 12,
    Z0 = -R * 13,
    limit = { x: C * 12 + 8, z: R * 13 + 10 };
  const rand = seededRandom(seed),
    map = {
      seed,
      size,
      grid: { cols: C, rows: R, x0: X0, z0: Z0 },
      limit,
      buildings: [],
      obstacles: [],
      cover: [],
      chests: [],
      spawns: [
        [0, 0],
        [0, limit.z - 12],
        [0, -limit.z + 12],
        [-limit.x + 4, 0],
        [limit.x - 4, 0],
      ],
      trees: [],
      flora: [],
      lairs: [],
      parks: [],
      hills: [],
      roads: [],
      paths: [],
      waters: [],
      rocks: [],
      plots: [],
      maxTerrainHeight: 2,
      panels: 0,
      windows: [],
      doors: [],
      decor: [],
      trash: [],
    };
  const keepOut = [],
    levelKeepOut = [];
  const { buildings, obstacles, chests, spawns, trees, parks, hills, roads, paths, waters, rocks, plots } = map,
    grid = Array(C * R).fill(-1);
  function reserve(cols, rows, type, kind) {
    const candidates = [];
    for (let c = 0; c <= C - cols; c++)
      for (let r = 0; r <= R - rows; r++) {
        if (c < C / 2 && c + cols > C / 2) continue;
        const cells = [];
        for (let x = 0; x < cols; x++) for (let z = 0; z < rows; z++) cells.push((c + x) * R + r + z);
        if (cells.every((n) => grid[n] === -1)) candidates.push({ c, r, cells });
      }
    if (!candidates.length) throw Error('No free connected plot');
    const slot = candidates[Math.floor(rand() * candidates.length)],
      id = plots.length;
    for (const n of slot.cells) grid[n] = id;
    const lot = {
      id,
      x: X0 + (slot.c + cols / 2) * 24,
      z: Z0 + (slot.r + rows / 2) * 26,
      w: cols * 24,
      d: rows * 26,
      cells: slot.cells,
      cols,
      rows,
      type,
      kind,
    };
    plots.push(lot);
    return lot;
  }
  for (let k = 0; k < PARKS; k++)
    for (const [type, cols, rows] of [
      ['park', 2, 2],
      ['grove', 1, 2],
      ['quarry', 2, 1],
      ['hill', 2, 1],
    ]) {
      const lot = reserve(cols, rows, type);
      parks.push(lot);
    }
  // Wild biomes: forest, lake, glade, meadow and desert. The first set holds the four boss lairs.
  for (let k = 0; k < BIOMES; k++)
    for (const [type, cols, rows] of BIOME_LOTS) parks.push(reserve(cols, rows, type));
  for (let k = 0; k < PARKS; k++)
    for (const kind of BUILDING_TYPES.filter((b) => b.plots[0] * b.plots[1] > 1)) reserve(...kind.plots, 'building', kind);
  const singles = BUILDING_TYPES.filter((b) => b.plots[0] * b.plots[1] === 1),
    // Every single-lot type appears once before any repeats, so all 30 types are always present.
    deck = [...shuffle([...singles], rand), ...shuffle(singles.slice(0, 4), rand)];
  while (deck.length < C * R) deck.push(...shuffle([...singles], rand));
  let n = 0;
  for (let c = 0; c < C; c++)
    for (let r = 0; r < R; r++)
      if (grid[c * R + r] === -1) {
        const id = plots.length;
        grid[c * R + r] = id;
        plots.push({
          id,
          x: X0 + 12 + c * 24,
          z: Z0 + 13 + r * 26,
          w: 24,
          d: 26,
          cells: [c * R + r],
          cols: 1,
          rows: 1,
          type: 'building',
          kind: deck[n++],
        });
      }
  const horizontal = new Set(),
    vertical = new Set();
  for (let r = 0; r <= R; r++)
    for (let c = 0; c < C; c++)
      if (r === 0 || r === R || grid[c * R + r - 1] !== grid[c * R + r]) {
        roads.push({ x: X0 + 12 + c * 24, z: Z0 + r * 26, w: 18, d: 6 });
        horizontal.add(c + ',' + r);
      }
  for (let c = 0; c <= C; c++)
    for (let r = 0; r < R; r++)
      if (c === 0 || c === C || grid[(c - 1) * R + r] !== grid[c * R + r]) {
        roads.push({ x: X0 + c * 24, z: Z0 + 13 + r * 26, w: 6, d: 20 });
        vertical.add(c + ',' + r);
      }
  for (let c = 0; c <= C; c++)
    for (let r = 0; r <= R; r++)
      if (
        horizontal.has(c + ',' + r) ||
        horizontal.has(c - 1 + ',' + r) ||
        vertical.has(c + ',' + r) ||
        vertical.has(c + ',' + (r - 1))
      )
        roads.push({ x: X0 + c * 24, z: Z0 + r * 26, w: 6, d: 6 });
  for (const lot of plots.filter((p) => p.type === 'building')) {
    const kind = lot.kind,
      w = kind.w,
      d = kind.d,
      h = 3.6,
      b = {
        ...kind,
        id: buildings.length,
        plot: lot.id,
        x: lot.x,
        z: lot.z,
        w,
        d,
        h,
        door: lot.cells.length > 1 || kind.category === 'industry' ? 4.4 : 3.2,
      };
    buildings.push(b);
    const add = (x, y, z, w, h, d, part, color = b.color, extra = {}) => {
      const o = { x, y, z, w, h, d, part, building: b.id, color, ...extra };
      obstacles.push(o);
      return o;
    };
    // Exterior walls are split into destructible panels (≤ 2.6 m) that carry the storeys above.
    const panel = (x, z, pw, pd, face, structural = true, height = h) =>
      add(x, height / 2, z, pw, height, pd, structural ? 'wall' : 'partition', structural ? b.color : 0xadb7a4, {
        panel: map.panels++,
        face,
        hp: PANEL_HP,
        structural,
      });
    const split = (length) => Math.max(1, Math.ceil(length / 2.6));
    b.panels = [];
    for (const side of [-1, 1]) {
      const n = split(d);
      for (let k = 0; k < n; k++) {
        const o = panel(
          b.x + side * (w / 2 - 0.2),
          b.z - d / 2 + (k + 0.5) * (d / n),
          0.4,
          d / n,
          side < 0 ? 'west' : 'east',
        );
        b.panels.push(o.panel);
        if (k % 2 === (side < 0 ? 0 : 1) || n === 1)
          map.windows.push({
            panel: o.panel,
            x: o.x + side * 0.21,
            z: o.z,
            y: 1.75,
            w: Math.min(1.5, (d / n) * 0.62),
            axis: 'z',
            out: side,
          });
      }
    }
    for (const fz of [-1, 1]) {
      const z = b.z + fz * (d / 2 - 0.2),
        wing = (w - b.door) / 2,
        n = split(wing),
        next = [];
      for (const side of [-1, 1])
        for (let k = 0; k < n; k++) {
          const cx = b.x + side * (b.door / 2 + (k + 0.5) * (wing / n)),
            o = panel(cx, z, wing / n, 0.4, fz < 0 ? 'north' : 'south');
          b.panels.push(o.panel);
          if (k === 0) next.push(o.panel);
          if (k === n - 1 && wing / n > 1.9)
            map.windows.push({
              panel: o.panel,
              x: o.x,
              z: z + fz * 0.21,
              y: 1.75,
              w: Math.min(1.5, (wing / n) * 0.62),
              axis: 'x',
              out: fz,
            });
        }
      // The lintel above a doorway rests on the two panels beside it.
      add(b.x, (h + 2.65) / 2, z, b.door, h - 2.65, 0.4, 'lintel', b.color, {
        supports: next,
        hp: PANEL_HP,
        panel: map.panels++,
        structural: false,
      });
      map.doors.push({ building: b.id, x: b.x, z, w: b.door, face: fz, panels: next });
    }
    // Floor slabs are destructible too (coarse cells); each has a stairwell over the stairs below it.
    const slab = (y, storey) => {
      const o = add(b.x, y, b.z, w, 0.24, d, 'roof', b.accent, { storey, panel: map.panels++, structural: false });
      if (storey < (b.storeys || 0)) {
        const lane = stairLane(b, storey),
          g = cellGrid(o);
        o.cells = new Uint8Array(g.cols * g.rows).fill(60);
        for (let i = 0; i < o.cells.length; i++) {
          const c = cellCenter(o, i);
          if (Math.abs(c.x - lane.x) < STAIR.width / 2 + 0.1 && c.z > lane.holeZ0 - 0.1 && c.z < lane.holeZ1 + 0.1) o.cells[i] = 0;
        }
        o.cellsAlive = o.cells.reduce((n, v) => n + (v > 0), 0);
      }
      return o;
    };
    // Block stairs from each storey to the next, alternating between two lanes along the east wall.
    const stairs = (storey, floorY) => {
      const lane = stairLane(b, storey);
      const rise = ((storey === 0 ? h + 0.24 : STOREY_HEIGHT) - 0) / STAIR.steps;
      for (let i = 0; i < STAIR.steps; i++) {
        const top = (i + 1) * rise,
          z = lane.z0 + lane.dir * (i + 0.5) * STAIR.run;
        add(lane.x, floorY + top / 2, z, STAIR.width, top, STAIR.run, 'stair', 0xb9b2a4, {
          storey,
          hp: 90,
          ground: 0,
          step: i,
        });
      }
      levelKeepOut.push({ building: b.id, storey, x: lane.x, z: b.z, w: STAIR.width + 0.4, d: STAIR.steps * STAIR.run + 1.6 });
      levelKeepOut.push({ building: b.id, storey: storey + 1, x: lane.x, z: b.z, w: STAIR.width + 0.4, d: STAIR.steps * STAIR.run + 1.6 });
      if (storey === 0) keepOut.push({ x: lane.x, z: b.z, w: STAIR.width + 0.4, d: STAIR.steps * STAIR.run + 1.6 });
    };
    slab(h + 0.12, 0);
    if ((b.storeys || 0) > 0) stairs(0, 0);
    // Upper storeys: four walls of destructible panels with windows, and a floor slab on top of each.
    b.upperPanels = [];
    let top = h + 0.24;
    const glazed = b.category === 'office' || b.category === 'shop';
    for (let k = 1; k <= (b.storeys || 0); k++) {
      const base = top,
        upanel = (x, z, pw, pd, face) => {
          const o = add(x, base + UPPER_WALL / 2, z, pw, UPPER_WALL, pd, 'wall', b.color, {
            panel: map.panels++,
            face,
            hp: PANEL_HP,
            structural: true,
            storey: k,
          });
          b.upperPanels.push(o.panel);
          return o;
        },
        window = (o, axis, out, span, i) => {
          if (span < 1.5 || (!glazed && i % 2 === (k % 2))) return;
          map.windows.push({
            panel: o.panel,
            x: o.x + (axis === 'z' ? out * 0.21 : 0),
            z: o.z + (axis === 'x' ? out * 0.21 : 0),
            y: base + 1.75,
            w: Math.min(glazed ? 1.8 : 1.5, span * (glazed ? 0.72 : 0.62)),
            axis,
            out,
          });
        };
      for (const side of [-1, 1]) {
        const n = split(d);
        for (let i = 0; i < n; i++) {
          const o = upanel(b.x + side * (w / 2 - 0.2), b.z - d / 2 + (i + 0.5) * (d / n), 0.4, d / n, side < 0 ? 'west' : 'east');
          window(o, 'z', side, d / n, i);
        }
      }
      for (const fz of [-1, 1]) {
        const inner = w - 0.8,
          n = split(inner);
        for (let i = 0; i < n; i++) {
          const o = upanel(b.x - inner / 2 + (i + 0.5) * (inner / n), b.z + fz * (d / 2 - 0.2), inner / n, 0.4, fz < 0 ? 'north' : 'south');
          window(o, 'x', fz, inner / n, i);
        }
      }
      slab(base + UPPER_WALL + 0.12, k);
      if (k < b.storeys) stairs(k, base);
      top = base + STOREY_HEIGHT;
    }
    b.roofBase = top;
    if (b.height - top > 0.3)
      add(b.x, (b.height + top) / 2, b.z, w, b.height - top, d, 'upper', b.accent, {
        storey: (b.storeys || 0) + 1,
        hp: Math.round(90 + w * d * 0.45),
      });
    if (lot.cells.length > 1) {
      for (const side of [-1, 1])
        for (const t of [-0.28, 0.28]) {
          const pw = w * 0.22,
            o = panel(b.x + side * w * 0.3, b.z + d * t, pw, 0.18, 'inside', false, 2.4);
          o.y = 1.2;
        }
    }
    // Walkway from door to door stays clear of furniture.
    keepOut.push({ x: b.x, z: b.z, w: b.door + 1.6, d: d + 5 });
    spawns.push([b.x, b.z]);
    chests.push({ id: 'chest' + b.id, x: b.x + 1.9, y: 0, z: b.z + d / 2 - 1.3, tier: 'chest', opened: false });
  }
  const addProp = (x, z, w, h, d, part, color) => {
    const ground = groundHeight(x, z, map),
      o = { x, z, y: ground + h / 2, w, h, d, part, color, ground };
    obstacles.push(o);
    return o;
  };
  for (const p of parks) if (BIOME_TYPES.includes(p.type)) wild(map, p, rand, addProp);
  for (const p of parks) {
    if (BIOME_TYPES.includes(p.type)) continue;
    // Hills stay inside their lot, clear of paths, benches and the pond, so flat features never float.
    if (p.type === 'park')
      hills.push(
        { x: p.x - 12, z: p.z + 13, radius: 7, height: 3.2 },
        { x: p.x + 12, z: p.z - 13, radius: 7, height: 2.6 },
        { x: p.x - 12, z: p.z - 13, radius: 6.5, height: 2 },
      );
    // Keep the grove mound's triangle support between the road and central path.
    if (p.type === 'grove') hills.push({ x: p.x - 5, z: p.z + p.d * 0.24, radius: 3, height: 0.65 });
    // The quarry is a dug pit beside a spoil heap.
    if (p.type === 'quarry')
      hills.push({ x: p.x - 11, z: p.z, radius: 8, height: -3.2 }, { x: p.x + 11.5, z: p.z, radius: 7.5, height: 2.4 });
    // A twin-peaked lookout hill; no path, the slopes are walkable.
    if (p.type === 'hill')
      hills.push(
        { x: p.x - 9, z: p.z, radius: 8, height: 3.8 },
        { x: p.x + 9, z: p.z, radius: 8, height: 3.2 },
        { x: p.x, z: p.z, radius: 6, height: 1.4 },
      );
    // A clear, flat north/south path guarantees access across every reserved zone.
    if (p.type !== 'hill')
      paths.push({ x: p.x, z: p.z, w: 3.6, d: p.d - 6, color: p.type === 'quarry' ? 0xaa9576 : 0xd9c99f });
    if (p.type === 'park')
      for (const side of [-1, 1])
        paths.push({ x: p.x + side * (p.w / 4 - 0.6), z: p.z, w: p.w / 2 - 4.8, d: 3.6, color: 0xd9c99f });
    spawns.push([p.x, p.z]);
    chests.push(
      p.type === 'hill'
        ? { id: 'park' + p.id, x: p.x - 9, z: p.z + 1.2, tier: 'park', opened: false }
        : { id: 'park' + p.id, x: p.x + 1.4, z: p.z + p.d / 2 - 6, tier: 'park', opened: false },
    );
    if (p.type === 'park') {
      const pond = { x: p.x + p.w * 0.25, z: p.z + p.d * 0.22, w: 7, d: 8 };
      waters.push(pond);
      addProp(pond.x, pond.z, pond.w + 0.5, 0.38, pond.d + 0.5, 'pond', 0x869b8c);
      for (const side of [-1, 1])
        for (const z of [-6, 6]) {
          const o = addProp(p.x + side * 4.8, p.z + z, 2.1, 0.48, 0.65, 'bench', 0x976f4c);
          map.cover.push(o);
          obstacles.push({
            x: o.x,
            z: o.z + 0.26,
            y: o.ground + 0.77,
            w: o.w,
            h: 0.55,
            d: 0.13,
            part: 'bench-back',
            color: 0x976f4c,
            ground: o.ground,
          });
        }
    }
    for (let i = 0; i < (p.type === 'park' ? 15 : p.type === 'grove' ? 18 : p.type === 'hill' ? 12 : 8); i++) {
      const x = p.x + (rand() - 0.5) * (p.w - 10),
        z = p.z + (rand() - 0.5) * (p.d - 10);
      if (
        Math.abs(x - p.x) < 3.5 ||
        (p.type === 'park' && Math.abs(z - p.z) < 3.5) ||
        (p.type === 'hill' && Math.hypot(x - p.x + 9, z - p.z - 1.2) < 3) ||
        obstacles.some((b) => Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2)
      )
        continue;
      if (p.type === 'quarry' || (p.type === 'hill' && i % 3 === 0)) {
        const w = 1.4 + rand() * 1.5,
          h = 0.7 + rand() * 1.1,
          d = 1.3 + rand();
        const o = addProp(x, z, w, h, d, 'rock', 0x999a8c);
        rocks.push(o);
      } else {
        trees.push([x, z, p.type === 'grove' || (p.type === 'hill' && i % 2) ? 'pine' : 'broad']);
        addProp(x, z, 0.5, 2.4, 0.5, 'tree', 0x7c6b54);
      }
    }
  }
  for (const z of [-52, 0, 52])
    for (const x of [-100, 100]) {
      const c = addProp(x, z + 5, 2.4, 1.2, 1.2, 'crate', 0x9d7760);
      map.cover.push(c);
    }
  // Trees, rocks, crates and park benches can be destroyed too; `prop` ids let clients mirror that.
  const PROP_HP = { tree: 120, rock: 240, crate: 90, bench: 70, stair: 90, cactus: 80, hay: 110, log: 130 };
  let propId = 0;
  for (const o of obstacles)
    if (PROP_HP[o.part]) {
      o.prop = propId++;
      o.hp = PROP_HP[o.part];
    }
  for (const o of obstacles)
    if (o.part === 'bench-back') o.prop = obstacles.find((q) => q.part === 'bench' && Math.abs(q.x - o.x) < 0.01 && Math.abs(q.z - o.z + 0.26) < 0.01)?.prop;
  trees.forEach((t, i) => {
    const o = obstacles.find((q) => q.part === 'tree' && q.x === t[0] && q.z === t[1]);
    if (o) o.tree = i;
  });
  // Supply crates down the central avenue.
  const supplies = Math.max(7, Math.round((R * 26) / 22));
  for (let n = 0; n < supplies; n++)
    chests.push({ id: 'supply' + n, x: 0, z: (n - (supplies - 1) / 2) * 22 + 7, tier: 'supply', opened: false });
  for (const c of chests) c.y = groundHeight(c.x, c.z, map);
  // Loot uses its own stream so contents never shift the district layout. Every weapon type appears at least once.
  const lootRand = seededRandom(seed ^ 0x5bd1e995),
    weaponDeck = shuffle(
      WEAPONS.map((w, i) => i),
      lootRand,
    ),
    order = shuffle(
      chests.map((c, i) => i),
      lootRand,
    );
  order.forEach((ci, k) =>
    Object.assign(chests[ci], rollChest(lootRand, chests[ci].tier, k < weaponDeck.length ? weaponDeck[k] : undefined)),
  );
  // Terrain maximum bounds ray early-outs.
  let top = 0;
  for (let x = -map.limit.x; x <= map.limit.x; x += 2)
    for (let z = -map.limit.z; z <= map.limit.z; z += 2) top = Math.max(top, rawHeight(x, z, map));
  map.maxTerrainHeight = top + 0.1;
  placeDecor(map, keepOut, seededRandom(seed ^ 0x2545f491), levelKeepOut);
  for (const p of plots) delete p.kind;
  map.obstacles.grid = new ObstacleGrid(map.obstacles, map.limit);
  map.obstacles.lowGrid = new ObstacleGrid(map.obstacles.filter(isLowSolid), map.limit, 8, '_lowStamp');
  return map;
}
export const BIOME_LOTS = [
  ['forest', 2, 2],
  ['lake', 2, 2],
  ['desert', 2, 2],
  ['glade', 1, 2],
  ['meadow', 2, 1],
];
export const BIOME_TYPES = BIOME_LOTS.map((b) => b[0]);
// Which boss guards which biome (first biome set only).
export const LAIRS = { desert: 'fire', glade: 'mind', lake: 'void', forest: 'frost' };
function wild(map, p, rand, addProp) {
  const { hills, trees, rocks, spawns, chests, waters, flora } = map,
    first = !map.lairs.some((l) => l.biome === p.type),
    lair = first && LAIRS[p.type] ? { boss: LAIRS[p.type], biome: p.type, x: p.x, z: p.z } : null;
  const inLot = (x, z, m = 5) => Math.abs(x - p.x) < p.w / 2 - m && Math.abs(z - p.z) < p.d / 2 - m;
  const pick = (m = 5) => [p.x + (rand() - 0.5) * (p.w - m * 2), p.z + (rand() - 0.5) * (p.d - m * 2)];
  const taken = [];
  const clear = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > r + tr);
  const tree = (x, z, kind) => {
    trees.push([x, z, kind]);
    addProp(x, z, 0.5, 2.4, 0.5, 'tree', 0x7c6b54);
    taken.push([x, z, 1.6]);
  };
  const rock = (x, z, s = 1, color = 0x999a8c) => {
    const o = addProp(x, z, (1.4 + rand() * 1.5) * s, (0.7 + rand() * 1.1) * s, (1.3 + rand()) * s, 'rock', color);
    rocks.push(o);
    taken.push([x, z, 1.8 * s]);
  };
  // Chest and spawn spots stay clear of trees, rocks and bales.
  taken.push([p.x - p.w * 0.3, p.z - p.d * 0.3, 2], [p.x + p.w * 0.3, p.z + p.d * 0.3, 2]);
  if (lair) {
    map.lairs.push(lair);
    taken.push([p.x, p.z, p.type === 'lake' ? 5 : 8.5]);
  }
  if (p.type === 'forest') {
    hills.push({ x: p.x - 11, z: p.z - 11, radius: 8, height: 1.6 }, { x: p.x + 12, z: p.z + 11, radius: 7.5, height: 1.2 });
    for (let i = 0; i < 90 && trees.length < 1e5; i++) {
      const [x, z] = pick(3);
      if (clear(x, z, 1.8)) tree(x, z, rand() < 0.7 ? 'pine' : 'broad');
    }
    for (let i = 0; i < 6; i++) {
      const [x, z] = pick(4);
      if (clear(x, z, 2)) {
        const o = addProp(x, z, 3.2, 0.6, 0.6, 'log', 0x6d5a45);
        taken.push([x, z, 2]);
        map.cover.push(o);
      }
    }
    for (let i = 0; i < 40; i++) {
      const [x, z] = pick(2);
      flora.push({ x, z, kind: rand() < 0.5 ? 'fern' : 'bush', s: 0.7 + rand() * 0.6 });
    }
  }
  if (p.type === 'lake') {
    // A dug basin with an island; the water sits just below ground level, so the shallows can be waded.
    hills.push({ x: p.x, z: p.z, radius: 19, height: -1.9 }, { x: p.x, z: p.z, radius: 6.5, height: 2.3 });
    waters.push({ x: p.x, z: p.z, w: 40, d: 42, y: -0.55, lake: true });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + rand() * 0.1,
        r = 20.5 + rand() * 2.5,
        x = p.x + Math.cos(a) * r,
        z = p.z + Math.sin(a) * r;
      if (!inLot(x, z, 1.5)) continue;
      if (i % 4 === 0 && clear(x, z, 1.8)) tree(x, z, 'broad');
      else flora.push({ x, z, kind: 'reed', s: 0.8 + rand() * 0.5 });
    }
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const x = p.x + Math.cos(a) * 19,
        z = p.z + Math.sin(a) * 19;
      if (clear(x, z, 1.6)) rock(x, z, 0.8);
    }
  }
  if (p.type === 'desert') {
    for (let i = 0; i < 5; i++) {
      const [x, z] = pick(9);
      // Dunes stay inside the lot (roads are flat): radius is capped by the distance to the lot edge.
      const room = Math.min(p.w / 2 - 4 - Math.abs(x - p.x), p.d / 2 - 4 - Math.abs(z - p.z)),
        radius = Math.min(6 + rand() * 4, room);
      if (Math.hypot(x - p.x, z - p.z) > 12 && radius > 3.5) hills.push({ x, z, radius, height: 1.2 + rand() * 1.8 });
    }
    for (let i = 0; i < 16; i++) {
      const [x, z] = pick(3);
      if (!clear(x, z, 2)) continue;
      if (i % 3 === 0) rock(x, z, 1, 0xc08a5c);
      else {
        addProp(x, z, 0.55, 2.2 + rand() * 1.4, 0.55, 'cactus', 0x5f8a4a);
        taken.push([x, z, 1.4]);
      }
    }
    for (let i = 0; i < 18; i++) {
      const [x, z] = pick(2);
      flora.push({ x, z, kind: 'shrub', s: 0.6 + rand() * 0.5 });
    }
  }
  if (p.type === 'glade') {
    // A sunny clearing ringed by trees.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2,
        r = 10 + rand() * 2.5,
        x = p.x + Math.cos(a) * r * 0.9,
        z = p.z + Math.sin(a) * r * 1.6;
      if (inLot(x, z, 1.5) && clear(x, z, 1.6)) tree(x, z, i % 3 ? 'broad' : 'pine');
    }
    for (let i = 0; i < 70; i++) {
      const [x, z] = pick(2);
      flora.push({ x, z, kind: 'flower', s: 0.7 + rand() * 0.6, c: Math.floor(rand() * 4) });
    }
    for (let i = 0; i < 3; i++) {
      const [x, z] = pick(4);
      if (clear(x, z, 1.5)) {
        addProp(x, z, 0.9, 0.5, 0.9, 'log', 0x7d6650);
        taken.push([x, z, 1.2]);
      }
    }
  }
  if (p.type === 'meadow') {
    hills.push({ x: p.x - 10, z: p.z, radius: 8, height: 1.1 }, { x: p.x + 12, z: p.z + 1.5, radius: 6.5, height: 0.9 });
    for (let i = 0; i < 7; i++) {
      const [x, z] = pick(4);
      if (clear(x, z, 2.2)) {
        const o = addProp(x, z, 1.5, 1.4, 1.5, 'hay', 0xd8b764);
        taken.push([x, z, 2.2]);
        map.cover.push(o);
      }
    }
    for (let i = 0; i < 160; i++) {
      const [x, z] = pick(1.5);
      flora.push({ x, z, kind: rand() < 0.75 ? 'grass' : 'flower', s: 0.7 + rand() * 0.7, c: Math.floor(rand() * 4) });
    }
    tree(p.x + p.w * 0.35, p.z - p.d * 0.25, 'broad');
  }
  spawns.push([p.x + p.w * 0.3, p.z + p.d * 0.3]);
  chests.push({ id: 'wild' + p.id, x: p.x - p.w * 0.3, z: p.z - p.d * 0.3, tier: 'park', opened: false });
}
// Models, furniture and street furniture. Every item with hit points becomes an obstacle linked to its decor entry:
// solid ones block movement, small ones (`nocollide`: chairs, lamps, monitors…) only stop bullets and break.
function placeDecor(map, keepOut, rand, levelKeepOut = []) {
  // Ground-level obstacles live in a grid: the city has ~75k of them and a linear scan per placement took seconds.
  const low = new ObstacleGrid(
      map.obstacles.filter((o) => o.y - o.h / 2 - (o.ground || 0) < 2 && o.part !== 'roof' && !(o.storey > 0)),
      map.limit,
      4,
      '_placeStamp',
    ),
    keepGrid = new ObstacleGrid(keepOut, map.limit, 8, '_keepStamp'),
    near = (grid, x, z, w, d, m, test) => {
      let hit = false;
      grid.query(x - w / 2 - m - 0.01, z - d / 2 - m - 0.01, x + w / 2 + m + 0.01, z + d / 2 + m + 0.01, (o) => {
        if (!hit && test(o)) hit = true;
      });
      return hit;
    };
  // Upper storeys: obstacles standing on each floor (walls, stairs, furniture), keyed "building:storey".
  const levels = new Map(),
    level = (b, k) => {
      const key = b + ':' + k;
      if (!levels.has(key)) levels.set(key, []);
      return levels.get(key);
    };
  for (const o of map.obstacles) if (o.storey > 0 && o.part !== 'roof' && o.part !== 'upper') level(o.building, o.storey).push(o);
  const overlaps = (x, z, w, d, m, o) =>
    Math.abs(x - o.x) < w / 2 + o.w / 2 + m && Math.abs(z - o.z) < d / 2 + o.d / 2 + m;
  const free = (x, z, w, d, m = 0.25, inside = false, where = null, soft = false) => {
    if (Math.abs(x) + w / 2 > map.limit.x - 0.3 || Math.abs(z) + d / 2 > map.limit.z - 0.3) return false;
    const k = where?.storey || 0;
    if (k === 0 && near(keepGrid, x, z, w, d, 0, (q) => overlaps(x, z, w, d, 0, q))) return false;
    if (where && levelKeepOut.some((q) => q.building === where.building && q.storey === k && overlaps(x, z, w, d, 0, q))) return false;
    // Soft items (chairs…) may tuck under tables; they only have to stay clear of walls and stairs.
    const mm = inside ? 0.02 : m,
      blocks = (o) => (!soft || o.decor === undefined) && !o.nocollide && overlaps(x, z, w, d, mm, o);
    if (k > 0 ? level(where.building, k).some(blocks) : near(low, x, z, w, d, mm, blocks)) return false;
    if (k === 0 && map.chests.some((c) => Math.abs(c.x - x) < w / 2 + 0.9 && Math.abs(c.z - z) < d / 2 + 0.9)) return false;
    if (k === 0 && map.spawns.some(([sx, sz]) => Math.abs(sx - x) < w / 2 + 1 && Math.abs(sz - z) < d / 2 + 1)) return false;
    if (!inside && map.waters.some((p) => overlaps(x, z, w, d, 1, p))) return false;
    return true;
  };
  const put = (name, x, z, rot = 0, opts = {}) => {
    const info = DECOR_INFO[name] || {},
      parent = opts.attachTo !== undefined ? map.decor[opts.attachTo] : null;
    if (opts.attachTo !== undefined && (opts.attachTo < 0 || !parent)) return -1;
    if (opts.on !== undefined && opts.on < 0) return -1;
    const [w, h, d] = opts.box
      ? Math.round(rot / (Math.PI / 2)) % 2
        ? [opts.box[2], opts.box[1], opts.box[0]]
        : opts.box
      : rotatedSize(name, rot);
    const hp = opts.hp ?? info.hp ?? (opts.box ? 80 : 0),
      solid = opts.collide !== false && !!hp && !parent && opts.on === undefined,
      breakable = !!hp || opts.collide === false;
    const pole = info.pole !== undefined,
      cx = pole ? x + Math.sin(rot) * info.pole : x,
      cz = pole ? z + Math.cos(rot) * info.pole : z,
      cw = pole ? 0.35 : w,
      cd = pole ? 0.35 : d;
    const inside = opts.building !== undefined,
      where = inside ? { building: opts.building, storey: opts.storey || 0 } : null;
    if (solid && !free(cx, cz, cw, cd, 0.3, inside, where)) return -1;
    if (!solid && !parent && opts.on === undefined && !free(x, z, w * 0.8, d * 0.8, 0, inside, where, true)) return -1;
    const ground = inside ? 0 : groundHeight(x, z, map),
      y = ground + (opts.y || 0),
      id = map.decor.length;
    map.decor.push({
      id,
      model: opts.box ? null : name,
      box: opts.box ? [w, h, d] : null,
      color: opts.color,
      x,
      y,
      z,
      rot,
      tint: opts.tint,
      building: opts.building,
      storey: opts.storey || 0,
      parent: parent ? parent.id : undefined,
    });
    if (breakable && !info.flat && !parent) {
      const ch = opts.colliderHeight || h;
      const o = {
        x: cx,
        y: y + ch / 2,
        z: cz,
        w: cw,
        h: ch,
        d: cd,
        part: info.car ? 'car' : inside ? 'furniture' : 'prop',
        decor: id,
        hp: hp || 25,
        maxHp: hp || 25,
        building: opts.building,
        ground,
        color: opts.color ?? info.color ?? 0x8a7f6d,
      };
      if (!solid) o.nocollide = true;
      if (opts.storey > 0) o.storey = opts.storey;
      if (opts.on !== undefined) o.restsOn = opts.on;
      map.obstacles.push(o);
      if (opts.storey > 0) level(opts.building, opts.storey).push(o);
      else low.add(o);
    }
    return id;
  };
  for (const b of map.buildings) furnishBuilding(b, { rand, put, free, decor: map.decor });
  streets(map, { rand, put, free });
}
export const DEFAULT_WORLD = createWorld();
export const BUILDINGS = DEFAULT_WORLD.buildings,
  COVER = DEFAULT_WORLD.cover,
  OBSTACLES = DEFAULT_WORLD.obstacles,
  SPAWNS = DEFAULT_WORLD.spawns;
export function wallDistance(x, z, dx, dz, max = 100, padding = 0, obstacles = OBSTACLES) {
  let best = max;
  const test = (b) => {
    if (b.nocollide || (b.y ?? b.h / 2) - b.h / 2 - (b.ground || 0) > 1.8) return;
    let lo = 0,
      hi = max;
    for (const [p, v, min, mx] of [
      [x, dx, b.x - b.w / 2 - padding, b.x + b.w / 2 + padding],
      [z, dz, b.z - b.d / 2 - padding, b.z + b.d / 2 + padding],
    ]) {
      if (Math.abs(v) < 1e-8) {
        if (p < min || p > mx) {
          hi = -1;
          break;
        }
      } else {
        let a = (min - p) / v,
          c = (mx - p) / v;
        if (a > c) [a, c] = [c, a];
        lo = Math.max(lo, a);
        hi = Math.min(hi, c);
      }
    }
    if (hi >= lo) best = Math.min(best, lo);
  };
  if (obstacles.lowGrid) {
    // Walk only the cells the line crosses; a padded line walks its centre and both edges.
    const walk = (ox, oz) => obstacles.lowGrid.ray({ x: ox, z: oz }, { x: dx, z: dz }, max, (b) => (test(b), best));
    walk(x, z);
    if (padding > 0) {
      // Boxes whose padding already covers the start point (behind or beside it).
      obstacles.lowGrid.query(x - padding, z - padding, x + padding, z + padding, test);
      walk(x - dz * padding, z + dx * padding);
      walk(x + dz * padding, z - dx * padding);
    }
  } else if (obstacles.grid) {
    const ex = x + dx * max,
      ez = z + dz * max;
    (obstacles.lowGrid || obstacles.grid).query(
      Math.min(x, ex) - padding,
      Math.min(z, ez) - padding,
      Math.max(x, ex) + padding,
      Math.max(z, ez) + padding,
      test,
    );
  } else for (const b of obstacles) test(b);
  return best;
}
export function lineClear(a, b, pad = 0, obstacles = OBSTACLES) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    d = Math.hypot(dx, dz);
  return d < 0.001 || wallDistance(a.x, a.z, dx / d, dz / d, d, pad, obstacles) >= d - 0.001;
}
