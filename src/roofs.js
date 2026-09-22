// Procedural roofs in the world's PBR style: pitched tile roofs on houses (gable or hipped, with chimneys),
// flat roofs with parapets and rooftop plant on shops and offices, corrugated sheds and sawtooth roofs on industry,
// and brick smokestacks on the big works. Deterministic per building, so every client builds the same roofs.
// All roofs of a map are merged into one mesh per material (a handful of draw calls for the whole city). A roof that
// breaks is removed by collapsing its vertex range; a falling roof is rebuilt as its own group for the animation.
import * as T from 'three';
import { uvMaterial, lookOf, surfaceTint, glassMaterial } from './materials.js';
import { seededRandom } from './world.js';

// Wall finish of a building (the scenery panels use the same choice).
export function facadeOf(b) {
  if (b.category === 'industry') return ['powerstation', 'refinery', 'distribution'].includes(b.type) ? 'panels' : 'bricks';
  if (b.category === 'home') return b.id % 3 === 0 ? 'bricks' : 'plaster';
  if (b.category === 'office') return b.id % 2 ? 'panels' : 'plaster';
  return b.id % 4 === 1 ? 'bricks' : 'plaster';
}
export function roofStyle(b) {
  if (b.category === 'home') return Math.abs(b.w - b.d) < 3.5 && (b.id + b.w) % 3 === 0 ? 'hip' : 'gable';
  if (b.category === 'industry') return ['warehouse', 'hangar'].includes(b.type) ? 'shed' : ['factory', 'workshop'].includes(b.type) ? 'saw' : 'flat';
  return 'flat';
}
// Height you stand on when on the roof (the top of the collision box above the last storey).
export const roofTop = (b) => (b.height - b.roofBase > 0.3 ? b.height : b.roofBase);
// Smokestack of the big industrial buildings (the chimney smoke rises from its top).
export function chimneyOf(b) {
  if (b.category !== 'industry' || b.height < 9) return null;
  return { x: b.x + b.w * 0.25, z: b.z - b.d * 0.2, base: b.roofBase, top: roofTop(b) + 6 + (b.id % 3) * 1.5, r: 0.85 };
}
// Materials of the roof field, created once and shared by every map.
let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    slate: uvMaterial('roof', { roughness: 0.9 }),
    clay: uvMaterial('claytiles', { roughness: 0.85 }),
    sheet: uvMaterial('corrugated', { roughness: 0.6, metalness: 0.6 }),
    gravel: uvMaterial('gravel'),
    plaster: uvMaterial('plaster'),
    bricks: uvMaterial('bricks'),
    panels: uvMaterial('panels'),
    concrete: uvMaterial('concrete'),
    metal: uvMaterial('metal', { roughness: 0.5, metalness: 0.7 }),
    glass: glassMaterial(),
  };
  MATS.textureOf = { slate: 'roof', clay: 'claytiles', sheet: 'corrugated', gravel: 'gravel', plaster: 'plaster', bricks: 'bricks', panels: 'panels', concrete: 'concrete', metal: 'metal', glass: 'concrete' };
  return MATS;
}

const V = (x, y, z) => new T.Vector3(x, y, z);
// Collects triangles per material in world space, with flat normals, UVs in texture repeats and vertex colours.
class Mesher {
  constructor() {
    this.parts = new Map();
    this.owner = -1;
  }
  begin(id) {
    this.owner = id;
  }
  part(key) {
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { pos: [], nrm: [], uv: [], col: [], ranges: new Map() }));
    if (!p.ranges.has(this.owner)) p.ranges.set(this.owner, { start: p.pos.length / 3, count: 0 });
    return p;
  }
  size(key) {
    return lookOf(mats().textureOf[key]).size;
  }
  // Planar UVs like the triplanar walls: vertical faces use (along, height), horizontal ones (x, z).
  planar(p, n, s) {
    const ax = Math.abs(n.x),
      ay = Math.abs(n.y),
      az = Math.abs(n.z);
    if (ay >= ax && ay >= az) return [p.x / s, p.z / s];
    if (ax >= az) return [p.z / s, p.y / s];
    return [p.x / s, p.y / s];
  }
  tri(key, a, b, c, color, uvs = null) {
    const p = this.part(key),
      n = new T.Vector3().subVectors(b, a).cross(new T.Vector3().subVectors(c, a)).normalize(),
      s = this.size(key);
    [a, b, c].forEach((v, i) => {
      p.pos.push(v.x, v.y, v.z);
      p.nrm.push(n.x, n.y, n.z);
      const uv = uvs ? uvs[i] : this.planar(v, n, s);
      p.uv.push(uv[0], uv[1]);
      p.col.push(color.r, color.g, color.b);
    });
    p.ranges.get(this.owner).count += 3;
  }
  // Quad p0..p3 counter-clockwise seen from outside.
  quad(key, p0, p1, p2, p3, color, uvs = null) {
    this.tri(key, p0, p1, p2, color, uvs && [uvs[0], uvs[1], uvs[2]]);
    this.tri(key, p0, p2, p3, color, uvs && [uvs[0], uvs[2], uvs[3]]);
  }
  // Axis-aligned box from y0 to y0 + h; `top` may use another material; the bottom is left out.
  box(key, cx, y0, cz, w, h, d, color, { top = key, topColor = color, bottom = false } = {}) {
    const x0 = cx - w / 2,
      x1 = cx + w / 2,
      z0 = cz - d / 2,
      z1 = cz + d / 2,
      y1 = y0 + h;
    this.quad(key, V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), color); // +z
    this.quad(key, V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), color); // -z
    this.quad(key, V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), color); // +x
    this.quad(key, V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), color); // -x
    if (top) this.quad(top, V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), topColor);
    if (bottom) this.quad(key, V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), color);
  }
  cylinder(key, cx, y0, cz, r, h, seg, color, { top = true, topKey = key, topColor = color } = {}) {
    const s = this.size(key),
      y1 = y0 + h;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2,
        a1 = ((i + 1) / seg) * Math.PI * 2,
        p0 = V(cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r),
        p1 = V(cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r),
        u0 = (a0 * r) / s,
        u1 = (a1 * r) / s;
      this.quad(key, p1, p0, V(p0.x, y1, p0.z), V(p1.x, y1, p1.z), color, [
        [u1, y0 / s],
        [u0, y0 / s],
        [u0, y1 / s],
        [u1, y1 / s],
      ]);
      if (top) this.tri(topKey, V(cx, y1, cz), V(p1.x, y1, p1.z), V(p0.x, y1, p0.z), topColor);
    }
  }
}

const grey = (k) => new T.Color().setRGB(k, k, k, T.LinearSRGBColorSpace);
// Pitched roof: two slopes meeting at a ridge along the long side (gable) or four slopes (hip).
function pitched(m, b, rnd, hip) {
  const clay = b.id % 2 === 0,
    key = clay ? 'clay' : 'slate',
    shade = 0.82 + rnd() * 0.22,
    tile = surfaceTint(clay ? 'claytiles' : 'roof', clay ? 0xffffff : [0x8d949c, 0x7a7065, 0x6d7a82][b.id % 3]).multiplyScalar(shade),
    wall = surfaceTint(facadeOf(b), b.color),
    trim = surfaceTint('concrete', 0xf0ece4),
    along = b.w >= b.d, // ridge along x
    L = along ? b.w : b.d,
    S = along ? b.d : b.w,
    ov = 0.45,
    ye = b.roofBase - 0.02,
    yr = Math.max(b.height, ye + 1.2),
    th = 0.14,
    run = S / 2 + ov,
    rise = yr - ye,
    slope = Math.hypot(run, rise),
    half = hip ? Math.max(0, (L - S) / 2) : L / 2 + 0.3,
    endOv = hip ? ov : 0.3,
    // Map (u along the ridge, v across from the ridge) to world coordinates.
    P = (u, y, v) => (along ? V(b.x + u, y, b.z + v) : V(b.x + v, y, b.z + u)),
    ts = m.size(key);
  // Slopes: each is a quad (gable) or trapezoid (hip) from the eave up to the ridge; winding keeps them outward.
  for (const side of [-1, 1]) {
    const e0 = P(-(L / 2 + endOv), ye, side * run),
      e1 = P(L / 2 + endOv, ye, side * run),
      r1 = P(half, yr, 0),
      r0 = P(-half, yr, 0);
    const uv = [
      [(-(L / 2 + endOv)) / ts, 0],
      [(L / 2 + endOv) / ts, 0],
      [half / ts, slope / ts],
      [-half / ts, slope / ts],
    ];
    const flip = (side > 0) === along;
    if (flip) m.quad(key, e0, e1, r1, r0, tile, uv);
    else m.quad(key, e1, e0, r0, r1, tile, [uv[1], uv[0], uv[3], uv[2]]);
    // Underside (soffit) a little lower, facing down.
    const d0 = P(-(L / 2 + endOv), ye - th, side * run),
      d1 = P(L / 2 + endOv, ye - th, side * run),
      q1 = P(half, yr - th, 0),
      q0 = P(-half, yr - th, 0);
    if (flip) m.quad('concrete', d1, d0, q0, q1, trim);
    else m.quad('concrete', d0, d1, q1, q0, trim);
    // Fascia board along the eave.
    const f0 = P(-(L / 2 + endOv), ye - th, side * run),
      f1 = P(L / 2 + endOv, ye - th, side * run);
    if (flip) m.quad('concrete', f0, f1, e1, e0, trim);
    else m.quad('concrete', f1, f0, e0, e1, trim);
  }
  for (const end of [-1, 1]) {
    if (hip) {
      // Hip end: a triangle from both eave corners up to the ridge end.
      const a = P(end * (L / 2 + endOv), ye, -run),
        c = P(end * (L / 2 + endOv), ye, run),
        r = P(end * half, yr, 0),
        rr = Math.hypot(L / 2 + endOv - half, rise);
      const uv = [
        [-run / ts, 0],
        [run / ts, 0],
        [0, rr / ts],
      ];
      if ((end > 0) === along) m.tri(key, a, r, c, tile, [uv[0], uv[2], uv[1]]);
      else m.tri(key, c, r, a, tile, [uv[1], uv[2], uv[0]]);
      // Soffit ring under the hip end.
      const a2 = P(end * (L / 2 + endOv), ye - th, -run),
        c2 = P(end * (L / 2 + endOv), ye - th, run),
        r2 = P(end * half, yr - th, 0);
      if ((end > 0) === along) m.tri('concrete', a2, c2, r2, trim);
      else m.tri('concrete', c2, a2, r2, trim);
    } else {
      // Gable end wall: a pentagon in the facade finish under the slopes, plus barge boards along the verges.
      const u = end * (L / 2),
        wallTop = ye + (rise * ov) / run - th,
        pts = [P(u, b.roofBase - 0.3, -S / 2), P(u, b.roofBase - 0.3, S / 2), P(u, wallTop, S / 2), P(u, yr - th, 0), P(u, wallTop, -S / 2)];
      const outward = (end > 0) === along;
      for (let i = 1; i < 4; i++) {
        if (outward) m.tri(facadeKey(b), pts[0], pts[i + 1], pts[i], wall);
        else m.tri(facadeKey(b), pts[0], pts[i], pts[i + 1], wall);
      }
      // Verge: the roof edge seen from the gable end (a thin face closing the tile layer).
      const ue = end * (L / 2 + endOv);
      for (const side of [-1, 1]) {
        const a = P(ue, ye, side * run),
          b2 = P(ue, yr, 0),
          c = P(ue, yr - th, 0),
          d = P(ue, ye - th, side * run);
        if (outward === side > 0) m.quad('concrete', a, d, c, b2, trim);
        else m.quad('concrete', d, a, b2, c, trim);
      }
    }
  }
  // Brick chimney through one slope, with a concrete cap.
  if (rnd() < 0.85) {
    const u = (rnd() - 0.5) * L * 0.5,
      v = (rnd() < 0.5 ? -1 : 1) * run * 0.35,
      c = P(u, 0, v),
      top = yr + 0.7,
      brick = surfaceTint('bricks', 0xd9c8b8);
    m.box('bricks', c.x, ye, c.z, 0.7, top - ye, 0.7, brick, { top: 'concrete', topColor: trim });
    m.box('concrete', c.x, top, c.z, 0.86, 0.1, 0.86, trim);
  }
}
const facadeKey = (b) => facadeOf(b);
// Flat roof: the attic band up to the roof deck, a parapet with coping and an assortment of rooftop plant.
function flat(m, b, rnd, deck = roofTop(b)) {
  const wall = surfaceTint(facadeOf(b), b.color),
    trim = surfaceTint('concrete', 0xd8d4ca),
    gravel = surfaceTint('gravel', 0xffffff).multiplyScalar(0.9 + rnd() * 0.2),
    key = facadeKey(b),
    w = b.w,
    d = b.d;
  if (deck - b.roofBase > 0.05) m.box(key, b.x, b.roofBase - 0.02, b.z, w, deck - b.roofBase + 0.02, d, wall, { top: 'gravel', topColor: gravel });
  else m.quad('gravel', V(b.x - w / 2, deck + 0.01, b.z + d / 2), V(b.x + w / 2, deck + 0.01, b.z + d / 2), V(b.x + w / 2, deck + 0.01, b.z - d / 2), V(b.x - w / 2, deck + 0.01, b.z - d / 2), gravel);
  // Parapet: four walls along the edge (outer faces flush with the facade) and a coping on top.
  const ph = 0.85,
    t = 0.25;
  m.box(key, b.x, deck, b.z + d / 2 - t / 2, w, ph, t, wall, { top: null });
  m.box(key, b.x, deck, b.z - d / 2 + t / 2, w, ph, t, wall, { top: null });
  m.box(key, b.x + w / 2 - t / 2, deck, b.z, t, ph, d - 2 * t, wall, { top: null });
  m.box(key, b.x - w / 2 + t / 2, deck, b.z, t, ph, d - 2 * t, wall, { top: null });
  const cy = deck + ph;
  m.box('concrete', b.x, cy, b.z + d / 2 - t / 2, w + 0.12, 0.08, t + 0.12, trim);
  m.box('concrete', b.x, cy, b.z - d / 2 + t / 2, w + 0.12, 0.08, t + 0.12, trim);
  m.box('concrete', b.x + w / 2 - t / 2, cy, b.z, t + 0.12, 0.08, d - 2 * t, trim);
  m.box('concrete', b.x - w / 2 + t / 2, cy, b.z, t + 0.12, 0.08, d - 2 * t, trim);
  // Rooftop plant on a grid of free spots.
  const free = [],
    step = 3.2;
  for (let x = -w / 2 + 2.2; x <= w / 2 - 2.2; x += step)
    for (let z = -d / 2 + 2.2; z <= d / 2 - 2.2; z += step) free.push([b.x + x, b.z + z]);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const chimney = chimneyOf(b);
  const take = () => {
    while (free.length) {
      const s = free.pop();
      if (!chimney || Math.hypot(s[0] - chimney.x, s[1] - chimney.z) > 3) return s;
    }
    return null;
  };
  const metal = surfaceTint('metal', 0xc9ccce),
    dark = grey(0.03);
  // Stair and lift housing on taller buildings.
  if ((b.storeys || 0) >= 3) {
    const s = take();
    if (s) {
      m.box(key, s[0], deck, s[1], 2.8, 2.9, 3.2, wall, { top: 'concrete', topColor: trim });
      m.box('metal', s[0], deck, s[1] + 1.61, 1.0, 2.1, 0.04, surfaceTint('metal', 0x59636b));
    }
  }
  const units = 1 + Math.floor(rnd() * 3 + Math.min(3, (w * d) / 160));
  for (let i = 0; i < units; i++) {
    const s = take();
    if (!s) break;
    const kind = rnd();
    if (kind < 0.55) {
      // Air-conditioning unit: a metal cabinet with a dark fan on top.
      const rot = rnd() < 0.5;
      m.box('concrete', s[0], deck, s[1], rot ? 1.4 : 2.0, 0.12, rot ? 2.0 : 1.4, trim);
      m.box('metal', s[0], deck + 0.12, s[1], rot ? 1.2 : 1.8, 1.0, rot ? 1.8 : 1.2, metal);
      m.cylinder('metal', s[0], deck + 1.12, s[1], 0.45, 0.04, 12, dark);
    } else if (kind < 0.75) {
      // Water tank on legs.
      for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) m.box('metal', s[0] + lx, deck, s[1] + lz, 0.12, 1.2, 0.12, metal);
      m.cylinder('metal', s[0], deck + 1.2, s[1], 1.15, 1.9, 14, surfaceTint('metal', 0x9aa0a4), { topKey: 'metal' });
    } else if (kind < 0.9) {
      // Skylight: a glass hood on a concrete kerb.
      m.box('concrete', s[0], deck, s[1], 1.8, 0.3, 2.4, trim, { top: null });
      m.box('glass', s[0], deck + 0.3, s[1], 1.6, 0.35, 2.2, grey(1));
    } else {
      // Antenna mast with a small dish.
      m.cylinder('metal', s[0], deck, s[1], 0.06, 4.2, 6, metal);
      m.cylinder('metal', s[0] + 0.25, deck + 2.6, s[1], 0.32, 0.08, 10, metal);
    }
  }
  // A few vent pipes.
  for (let i = 0; i < 3; i++) {
    const s = take();
    if (!s) break;
    m.cylinder('metal', s[0] + (rnd() - 0.5), deck, s[1] + (rnd() - 0.5), 0.12, 0.7 + rnd() * 0.6, 8, metal);
  }
}
// Industrial roofs: a low corrugated gable (shed) or a sawtooth with glazed north lights.
function industrial(m, b, rnd, saw) {
  const sheet = surfaceTint('corrugated', [0xb7bcb8, 0x9a7a62, 0x7d8c94][b.id % 3]),
    wall = surfaceTint(facadeOf(b), b.color),
    trim = surfaceTint('concrete', 0xcfcac0),
    key = facadeKey(b),
    ye = b.roofBase - 0.02,
    top = Math.max(b.height, ye + 1.4),
    ts = m.size('sheet');
  if (!saw) {
    pitchedSheet(m, b, ye, top, sheet, wall, trim, key, ts);
    return;
  }
  // Sawtooth: teeth across the depth; each has a sloped sheet and a vertical glazed face.
  const n = Math.max(2, Math.round(b.d / 5)),
    tooth = b.d / n,
    h = Math.min(2.4, top - ye);
  for (let i = 0; i < n; i++) {
    const z0 = b.z - b.d / 2 + i * tooth,
      z1 = z0 + tooth,
      x0 = b.x - b.w / 2,
      x1 = b.x + b.w / 2,
      slope = Math.hypot(tooth, h);
    // Sheet from the low edge (z1) up to the high edge (z0).
    m.quad('sheet', V(x0, ye, z1), V(x1, ye, z1), V(x1, ye + h, z0), V(x0, ye + h, z0), sheet, [
      [x0 / ts, 0],
      [x1 / ts, 0],
      [x1 / ts, slope / ts],
      [x0 / ts, slope / ts],
    ]);
    // Glazing facing -z under the high edge, with a frame.
    m.quad('glass', V(x1, ye, z0), V(x0, ye, z0), V(x0, ye + h, z0), V(x1, ye + h, z0), grey(1));
    m.box('metal', b.x, ye + h - 0.08, z0, b.w, 0.1, 0.08, surfaceTint('metal', 0x6b7479), { top: 'metal' });
    // Side triangles in the facade finish.
    m.tri(key, V(x0, ye, z0), V(x0, ye, z1), V(x0, ye + h, z0), wall);
    m.tri(key, V(x1, ye, z1), V(x1, ye, z0), V(x1, ye + h, z0), wall);
  }
  void rnd;
}
function pitchedSheet(m, b, ye, top, sheet, wall, trim, key, ts) {
  const along = b.w >= b.d,
    L = along ? b.w : b.d,
    S = along ? b.d : b.w,
    ov = 0.3,
    run = S / 2 + ov,
    rise = Math.min(top - ye, S * 0.22),
    slope = Math.hypot(run, rise),
    P = (u, y, v) => (along ? V(b.x + u, y, b.z + v) : V(b.x + v, y, b.z + u));
  for (const side of [-1, 1]) {
    const e0 = P(-(L / 2 + 0.2), ye, side * run),
      e1 = P(L / 2 + 0.2, ye, side * run),
      r1 = P(L / 2 + 0.2, ye + rise, 0),
      r0 = P(-(L / 2 + 0.2), ye + rise, 0),
      uv = [
        [0, (-(L / 2 + 0.2)) / ts],
        [0, (L / 2 + 0.2) / ts],
        [slope / ts, (L / 2 + 0.2) / ts],
        [slope / ts, (-(L / 2 + 0.2)) / ts],
      ];
    // Corrugations run down the slope: u across the ridges, v along the sheet.
    const flip = (side > 0) === along;
    if (flip) m.quad('sheet', e0, e1, r1, r0, sheet, uv);
    else m.quad('sheet', e1, e0, r0, r1, sheet, [uv[1], uv[0], uv[3], uv[2]]);
    const d0 = P(-(L / 2 + 0.2), ye - 0.1, side * run),
      d1 = P(L / 2 + 0.2, ye - 0.1, side * run),
      q1 = P(L / 2 + 0.2, ye + rise - 0.1, 0),
      q0 = P(-(L / 2 + 0.2), ye + rise - 0.1, 0);
    if (flip) m.quad('metal', d1, d0, q0, q1, trim);
    else m.quad('metal', d0, d1, q1, q0, trim);
  }
  for (const end of [-1, 1]) {
    const u = end * (L / 2),
      outward = (end > 0) === along,
      pts = [P(u, b.roofBase - 0.3, -S / 2), P(u, b.roofBase - 0.3, S / 2), P(u, ye + (rise * ov) / run - 0.1, S / 2), P(u, ye + rise - 0.1, 0), P(u, ye + (rise * ov) / run - 0.1, -S / 2)];
    for (let i = 1; i < 4; i++) {
      if (outward) m.tri(key, pts[0], pts[i + 1], pts[i], wall);
      else m.tri(key, pts[0], pts[i], pts[i + 1], wall);
    }
  }
  // Ridge vent along the top.
  const c = P(0, 0, 0);
  m.box('metal', c.x, ye + rise - 0.05, c.z, along ? L * 0.7 : 0.6, 0.35, along ? 0.6 : L * 0.7, surfaceTint('metal', 0x8a9296));
}
function smokestack(m, b) {
  const c = chimneyOf(b);
  if (!c) return;
  const brick = surfaceTint('bricks', 0xc8a080);
  m.cylinder('bricks', c.x, c.base, c.z, c.r, c.top - c.base, 14, brick, { top: false });
  m.cylinder('concrete', c.x, c.top - 0.5, c.z, c.r + 0.12, 0.5, 14, surfaceTint('concrete', 0x8a857c), { top: false });
  // Soot-dark inside of the rim.
  m.cylinder('concrete', c.x, c.top - 0.02, c.z, c.r - 0.05, 0.02, 14, grey(0.02));
}
export function buildRoof(m, b) {
  const rnd = seededRandom(0x51f15e + b.id * 977),
    style = roofStyle(b);
  if (style === 'gable' || style === 'hip') pitched(m, b, rnd, style === 'hip');
  else if (style === 'shed' || style === 'saw') industrial(m, b, rnd, style === 'saw');
  else flat(m, b, rnd);
  smokestack(m, b);
}
function toMeshes(mesher, offset = null) {
  const M = mats(),
    out = [];
  for (const [key, p] of mesher.parts) {
    if (!p.pos.length) continue;
    const g = new T.BufferGeometry(),
      pos = new Float32Array(p.pos);
    if (offset) for (let i = 0; i < pos.length; i += 3) (pos[i] -= offset.x), (pos[i + 2] -= offset.z);
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(p.nrm, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(p.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(p.col, 3));
    g.computeBoundingSphere();
    const mesh = new T.Mesh(g, M[key]);
    mesh.castShadow = key !== 'glass';
    mesh.receiveShadow = true;
    mesh.userData.roofPart = key;
    out.push({ mesh, ranges: p.ranges });
  }
  return out;
}
export class RoofField {
  constructor(map, parent) {
    // One set of meshes per 128 m region: regions out of view are frustum-culled.
    const regions = new Map();
    for (const b of map.buildings) {
      const key = Math.floor(b.x / 128) + ':' + Math.floor(b.z / 128);
      if (!regions.has(key)) regions.set(key, new Mesher());
      const m = regions.get(key);
      m.begin(b.id);
      buildRoof(m, b);
    }
    this.parts = [...regions.values()].flatMap((m) => toMeshes(m));
    this.group = new T.Group();
    this.group.name = 'roofs';
    for (const { mesh } of this.parts) this.group.add(mesh);
    parent.add(this.group);
  }
  // Removes a building's roof from the merged meshes (degenerate triangles).
  hide(id) {
    for (const { mesh, ranges } of this.parts) {
      const r = ranges.get(id);
      if (!r || !r.count) continue;
      const attr = mesh.geometry.attributes.position;
      attr.array.fill(0, r.start * 3, (r.start + r.count) * 3);
      attr.addUpdateRange(r.start * 3, r.count * 3);
      attr.needsUpdate = true;
    }
  }
  // A standalone copy of one building's roof, pivoting on the building's centre (for the falling animation).
  copy(b) {
    const m = new Mesher();
    m.begin(b.id);
    buildRoof(m, b);
    const group = new T.Group();
    group.position.set(b.x, 0, b.z);
    for (const { mesh } of toMeshes(m, { x: b.x, z: b.z })) group.add(mesh);
    return group;
  }
  dispose() {
    this.group.removeFromParent();
    for (const { mesh } of this.parts) mesh.geometry.dispose();
  }
}
