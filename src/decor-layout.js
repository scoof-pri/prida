// Deterministic furniture and street furniture layout. Models come from CC0 Kenney kits (see ASSET-CREDITS.md);
// every model's front faces +Z, so a yaw `rot` turns its front toward (sin rot, cos rot), like player angles.
import { DECOR_SIZES } from './decor-sizes.js';

const H = Math.PI / 2;
// Destructible hit points and collision role per model. `pole` models collide only around their post.
export const DECOR_INFO = {
  sofa: { hp: 70 },
  armchair: { hp: 50 },
  'coffee-table': { hp: 40 },
  table: { hp: 60 },
  'tv-cabinet': { hp: 50 },
  bookcase: { hp: 70 },
  desk: { hp: 60 },
  fridge: { hp: 90 },
  stove: { hp: 80 },
  bed: { hp: 70 },
  box: { hp: 25 },
  counter: { hp: 90 },
  sedan: { hp: 260, car: true },
  taxi: { hp: 260, car: true },
  police: { hp: 280, car: true },
  van: { hp: 300, car: true },
  suv: { hp: 300, car: true },
  hatchback: { hp: 240, car: true },
  delivery: { hp: 320, car: true },
  'street-lamp': { hp: 140, pole: 0.9 },
  'street-lamp-curved': { hp: 140, pole: 0.75 },
  'traffic-light': { hp: 140, pole: 0 },
  'power-pole': { hp: 180, pole: 0 },
  'stop-sign': { hp: 80, pole: 0 },
  dumpster: { hp: 160 },
  barrier: { hp: 40 },
  // Small furniture: stops bullets and breaks, but players walk through it.
  chair: { hp: 25, color: 0x9a7b5c },
  'office-chair': { hp: 30, color: 0x3c4448 },
  monitor: { hp: 15, color: 0x2e3438 },
  tv: { hp: 20, color: 0x2e3438 },
  plant: { hp: 15, color: 0x5d8a4e },
  'floor-lamp': { hp: 15, color: 0xd9d2c2 },
  trashcan: { hp: 20, color: 0x7d8588 },
  rug: { flat: true },
  'bed-single': { hp: 60, color: 0xc9c2b4 },
  bunk: { hp: 80, color: 0xa88b69 },
  bathtub: { hp: 90, color: 0xe8ecec },
  toilet: { hp: 40, color: 0xe8ecec },
  sink: { hp: 40, color: 0xe8ecec },
  shower: { hp: 60, color: 0xd6e2e6 },
  'kitchen-cabinet': { hp: 70, color: 0xd9d2c2 },
  'kitchen-sink': { hp: 70, color: 0xd9d2c2 },
  microwave: { hp: 20, color: 0xcfd3d4 },
  'coffee-machine': { hp: 15, color: 0x44484a },
  washer: { hp: 70, color: 0xe8ecec },
  'table-round': { hp: 50, color: 0x9a7b5c },
  'table-cloth': { hp: 50, color: 0xe6e0d4 },
  stool: { hp: 20, color: 0x7a6a58 },
  bar: { hp: 80, color: 0x8a6c4f },
  bench: { hp: 60, color: 0x7d8e8a },
  'bookcase-wide': { hp: 90, color: 0x9a7b5c },
  'bookcase-low': { hp: 60, color: 0x9a7b5c },
  laptop: { hp: 10, color: 0x3a3f42 },
  'side-table': { hp: 35, color: 0x9a7b5c },
  'sofa-long': { hp: 80, color: 0x6f8b8f },
  'lounge-chair': { hp: 50, color: 0x6f8b8f },
  'tv-vintage': { hp: 25, color: 0x6b5a48 },
  'lamp-table': { hp: 10, color: 0xe6dcc4 },
  'box-open': { hp: 20, color: 0xb58d5e },
  'coat-rack': { hp: 25, color: 0x6b5a48 },
  speaker: { hp: 25, color: 0x2e3438 },
  radio: { hp: 10, color: 0x6b5a48 },
  machine: { hp: 160 },
};
export const CARS = Object.keys(DECOR_INFO).filter((k) => DECOR_INFO[k].car);

export function rotatedSize(name, rot) {
  const [w, h, d] = DECOR_SIZES[name],
    quarter = Math.round(rot / H) % 2 !== 0;
  return quarter ? [d, h, w] : [w, h, d];
}

// ctx: { rand, put(name, x, z, rot, opts) -> bool, free(x, z, w, d, margin) -> bool }
export function furnish(b, ctx) {
  const { rand, put } = ctx,
    s = b.id % 2 ? 1 : -1,
    hw = b.w / 2 - 0.45,
    hd = b.d / 2 - 0.45,
    X = (lx) => b.x + lx,
    Z = (lz) => b.z + lz,
    at = (name, lx, lz, rot = 0, opts = {}) => put(name, X(lx), Z(lz), rot, { building: b.id, ...opts });
  const inward = (side) => -side * H; // front faces the building centre line
  const rows = Math.max(1, Math.floor((b.d - 2) / 5.5));
  if (b.category === 'home') {
    for (let r = 0; r < rows; r++) {
      const zc = -hd + (r + 0.5) * ((2 * hd) / rows);
      at('sofa', s * (hw - 0.45), zc - 0.6, inward(s));
      at('coffee-table', s * (hw - 1.75), zc - 0.6, inward(s));
      at('rug', s * (hw - 1.6), zc - 0.6, H, { collide: false });
      at('armchair', s * (hw - 0.45), zc + 1.1, inward(s) + 0.3, { collide: false });
      at('table', -s * (hw - 0.9), zc + 0.9, H);
      for (const dz of [-0.45, 0.45]) at('chair', -s * (hw - 1.65), zc + 0.9 + dz, s * H, { collide: false });
      at('plant', -s * (hw - 0.3), zc - 1.6, 0, { collide: false });
    }
    at('tv-cabinet', s * (hw - 1.4), -hd + 0.3, 0);
    at('tv', s * (hw - 1.4), -hd + 0.3, 0, { collide: false, y: 0.66 });
    at('bed', -s * (hw - 0.95), hd - 1.1, Math.PI);
    at('floor-lamp', s * (hw - 0.2), hd - 0.3, 0, { collide: false });
  } else if (b.category === 'shop') {
    const n = Math.min(5, Math.floor((2 * hd - 2.6) / 0.95));
    for (let k = 0; k < n; k++) at('bookcase', s * (hw - 0.3), -hd + 1.4 + k * 0.95, inward(s));
    at('counter', -s * (hw - 0.9), -0.4, H, { box: [1.0, 1.05, Math.min(3.6, b.d * 0.35)], color: b.accent });
    at('monitor', -s * (hw - 0.9), -0.4, -s * H, { collide: false, y: 1.05 });
    for (let k = 0; k < 2; k++) at('fridge', -s * (hw - 0.45 - k * 0.9), -hd + 0.35, 0);
    at('plant', -s * (hw - 0.25), hd - 0.3, 0, { collide: false });
    at('trashcan', -s * (hw - 0.3), 1.9, 0, { collide: false });
  } else if (b.category === 'office') {
    for (const side of [s, -s]) {
      const n = Math.max(1, Math.min(4, Math.floor((2 * hd - 1.6) / 2.4)));
      for (let k = 0; k < n; k++) {
        const lz = -hd + 1.3 + k * 2.4;
        at('desk', side * (hw - 0.45), lz, inward(side));
        at('monitor', side * (hw - 0.3), lz, inward(side), { collide: false, y: 0.785 });
        at('office-chair', side * (hw - 1.35), lz, side * H, { collide: false });
      }
      at('plant', side * (hw - 0.25), hd - 0.3, 0, { collide: false });
    }
    at('bookcase', -s * (hw - 1.6), -hd + 0.3, 0);
  } else {
    // Industry: stacked cartons, shelving and a work table.
    const stacks = Math.max(2, Math.floor(b.d / 5));
    for (let k = 0; k < stacks; k++) {
      const lz = -hd + 1.2 + k * ((2 * hd - 2.4) / Math.max(1, stacks - 1));
      for (const [dx, dz] of [
        [0, 0],
        [0.5, 0],
        [0, 0.5],
        [0.5, 0.5],
      ]) {
        const height = 1 + Math.floor(rand() * 3);
        for (let level = 0; level < height; level++)
          at('box', s * (hw - 0.35 - dx), lz + dz, rand() * 0.3, {
            y: level * 0.6,
            collide: level === 0,
            stackTop: level === height - 1 ? height * 0.6 : 0,
          });
      }
    }
    const n = Math.min(4, Math.floor((2 * hd - 3) / 0.95));
    for (let k = 0; k < n; k++) at('bookcase', -s * (hw - 0.3), -hd + 1.4 + k * 0.95, -inward(s));
    at('table', -s * (hw - 1.9), hd - 1.4, 0);
    at('chair', -s * (hw - 1.9), hd - 0.6, Math.PI, { collide: false });
    at('trashcan', s * (hw - 0.25), hd - 0.3, 0, { collide: false });
  }
}

// Street furniture: lamps and traffic lights at crossings, parked cars along roads, power poles on the outer edge,
// dumpsters with trash bags beside shops and industry, a few construction barriers.
export function streets(map, ctx) {
  const { rand, put, free } = ctx,
    L = map.limit;
  const crossings = [];
  const G = map.grid || { cols: 8, rows: 6, x0: -96, z0: -78 },
    squares = new Set(map.roads.filter((q) => q.w === 6 && q.d === 6).map((q) => Math.round(q.x) + ',' + Math.round(q.z)));
  for (let c = 0; c <= G.cols; c++)
    for (let r = 0; r <= G.rows; r++) {
      const x = G.x0 + c * 24,
        z = G.z0 + r * 26;
      if (squares.has(Math.round(x) + ',' + Math.round(z)))
        crossings.push({ x, z, inner: c > 0 && c < G.cols && r > 0 && r < G.rows });
    }
  for (const q of crossings) {
    const corners = [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ].sort(() => rand() - 0.5);
    let lamps = 0;
    for (const [sx, sz] of corners) {
      const x = q.x + sx * 3.7,
        z = q.z + sz * 3.7;
      if (Math.abs(x) > L.x - 1 || Math.abs(z) > L.z - 1) continue;
      if (lamps < 1) {
        // Lamp post on the corner, arm reaching over the road.
        const rot = Math.atan2(sx, sz); // arm (local -Z) reaches back over the crossing
        if (
          put(
            rand() < 0.5 ? 'street-lamp' : 'street-lamp-curved',
            x - Math.sin(rot) * 0.9,
            z - Math.cos(rot) * 0.9,
            rot,
            { street: true },
          )
        )
          lamps++;
      } else if (q.inner && rand() < 0.55) {
        put('traffic-light', x, z, Math.atan2(-sx, -sz), { street: true });
        break;
      }
    }
    if (!q.inner && rand() < 0.3) put('stop-sign', q.x + 3.6, q.z - 3.6, 0, { street: true });
  }
  // Parked cars along both carriageways of straight road segments.
  for (const road of map.roads) {
    if (road.w === 6 && road.d === 6) continue;
    const along = road.w > road.d;
    for (const side of [-1, 1]) {
      if (rand() > 0.3) continue;
      const name = CARS[Math.floor(rand() * CARS.length)],
        t = (rand() - 0.5) * (Math.max(road.w, road.d) - 7),
        x = along ? road.x + t : road.x + side * 1.55,
        z = along ? road.z + side * 1.55 : road.z + t,
        rot = (along ? H : 0) + (rand() < 0.5 ? Math.PI : 0) + (rand() - 0.5) * 0.08;
      put(name, x, z, rot, { street: true, tint: rand() });
    }
  }
  // Power poles on the strip outside the outer ring road.
  for (let x = -L.x + 14; x <= L.x - 14; x += 30)
    for (const sz of [-1, 1]) put('power-pole', x + (rand() - 0.5) * 6, sz * (L.z - 3.2), H, { street: true });
  for (let z = -L.z + 28; z <= L.z - 28; z += 30)
    for (const sx of [-1, 1]) put('power-pole', sx * (L.x - 2.2), z + (rand() - 0.5) * 6, 0, { street: true });
  // Dumpsters and trash bags beside shops and industry.
  for (const b of map.buildings) {
    if (b.category !== 'shop' && b.category !== 'industry') continue;
    for (const side of [1, -1]) {
      const x = b.x + side * (b.w / 2 + 1.25),
        z = b.z + (rand() - 0.5) * (b.d - 4);
      if (put('dumpster', x, z, 0, { street: true })) {
        const bags = 2 + Math.floor(rand() * 3);
        for (let i = 0; i < bags; i++)
          map.trash.push({
            x: x + (rand() - 0.5) * 1.2,
            z: z + (rand() < 0.5 ? -1.45 : 1.45) + (rand() - 0.5) * 0.5,
            s: 0.35 + rand() * 0.2,
            r: rand() * 6.28,
          });
        break;
      }
    }
  }
  // A couple of roadwork spots.
  for (let i = 0; i < 4; i++) {
    const road = map.roads[Math.floor(rand() * map.roads.length)];
    if (road.w === 6 && road.d === 6) continue;
    const along = road.w > road.d;
    for (let k = -1; k <= 1; k++)
      put(k ? 'cone' : 'barrier', road.x + (along ? k * 1.2 : 0), road.z + (along ? 0 : k * 1.2), along ? H : 0, {
        street: true,
        collide: !k,
      });
  }
  void free;
}
