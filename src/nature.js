// Trees, rocks and plants built from procedural geometry with the world's PBR surfaces: bark-textured trunks and
// branches, crowns of alpha-tested leaf cards (broadleaf) or drooping needle sprays (pines), displaced rocks with
// a rock texture, bushes, ferns, flowers, reeds, desert shrubs, cacti, logs and hay bales.
// Everything is instanced per variant and culled with the scenery (culling.js); destructible props hide by id.
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { detailMaterial, foliageMaterial } from './materials.js';
import { groundHeight } from './terrain.js';
import { seededRandom } from './world.js';
import { CulledBatch } from './scenery.js';

const UP = new T.Vector3(0, 1, 0);
const tmp = new T.Vector3();

// A card (quad) from `base` along `dir` (length h), `side` (width w) centred on the base; uv (0,0)-(1,1).
// Normals point away from `center` (volumetric shading of a crown); sway grows with distance from the trunk.
function card(out, base, dir, side, w, h, center, swayK, uv = [0, 0, 1, 1], offset = 0.5) {
  const a = base.clone().addScaledVector(side, -w * offset),
    b = base.clone().addScaledVector(side, w * (1 - offset)),
    c = b.clone().addScaledVector(dir, h),
    d = a.clone().addScaledVector(dir, h);
  const [u0, v0, u1, v1] = uv;
  for (const [p, u, v] of [
    [a, u0, v0],
    [b, u1, v0],
    [c, u1, v1],
    [a, u0, v0],
    [c, u1, v1],
    [d, u0, v1],
  ]) {
    out.pos.push(p.x, p.y, p.z);
    tmp.subVectors(p, center).normalize().lerp(UP, 0.25).normalize();
    out.nrm.push(tmp.x, tmp.y, tmp.z);
    out.uv.push(u, v);
    out.sway.push(Math.min(1.2, Math.hypot(p.x, p.z) * swayK + Math.max(0, p.y - center.y) * 0.05));
  }
}
function cardGeometry(out) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(out.nrm, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(out.uv, 2));
  g.setAttribute('sway', new T.Float32BufferAttribute(out.sway, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
const cards = () => ({ pos: [], nrm: [], uv: [], sway: [] });
// A tapered tube from a to b (open), as a trunk or branch piece.
function limb(a, b, r0, r1, seg = 7) {
  const len = a.distanceTo(b),
    g = new T.CylinderGeometry(r1, r0, len, seg, 2, true);
  g.deleteAttribute('uv');
  const dir = new T.Vector3().subVectors(b, a).normalize(),
    q = new T.Quaternion().setFromUnitVectors(UP, dir);
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
// Broadleaf tree: a leaning trunk that forks into branches, each ending in a cluster of leaf cards.
function broadleaf(seed) {
  const rnd = seededRandom(seed),
    height = 7.5 + rnd() * 3,
    trunkTop = height * (0.42 + rnd() * 0.08),
    lean = new T.Vector3((rnd() - 0.5) * 0.5, 0, (rnd() - 0.5) * 0.5),
    top = new T.Vector3(lean.x, trunkTop, lean.z),
    parts = [limb(new T.Vector3(0, -0.3, 0), top, 0.3, 0.2, 8)],
    crown = new T.Vector3(lean.x, height * 0.68, lean.z),
    clusters = [],
    leaves = cards();
  // Root flare.
  parts.push(limb(new T.Vector3(0, -0.2, 0), new T.Vector3(0, 0.5, 0), 0.42, 0.28, 8));
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.8,
      out = 1.6 + rnd() * 1.6,
      up = height * (0.62 + rnd() * 0.3) - trunkTop,
      from = top.clone().add(new T.Vector3(0, -rnd() * 0.8, 0)),
      end = new T.Vector3(top.x + Math.cos(a) * out, trunkTop + up, top.z + Math.sin(a) * out);
    parts.push(limb(from, end, 0.14, 0.05, 5));
    clusters.push(end);
  }
  clusters.push(new T.Vector3(lean.x, height * 0.86, lean.z));
  // Leaf cards: around every branch end, facing outward from the crown.
  for (const c of clusters) {
    const count = 9 + Math.floor(rnd() * 4);
    for (let k = 0; k < count; k++) {
      const off = new T.Vector3(rnd() - 0.5, rnd() - 0.4, rnd() - 0.5).normalize().multiplyScalar(0.4 + rnd() * 0.9),
        base = c.clone().add(off),
        dir = off.clone().normalize().addScaledVector(UP, 0.6).add(new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.6)).normalize(),
        side = new T.Vector3().crossVectors(dir, new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize(),
        size = 1.5 + rnd() * 0.9;
      card(leaves, base.addScaledVector(dir, -size * 0.35), dir, side, size, size, crown, 0.22);
    }
  }
  const wood = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  wood.computeBoundingBox();
  return { wood, leaves: cardGeometry(leaves), height };
}
// Pine: a straight trunk with whorls of drooping branch cards (two crossed cards per branch), narrowing upward.
function pine(seed) {
  const rnd = seededRandom(seed),
    height = 9 + rnd() * 3.5,
    maxR = 2.1 + rnd() * 0.6,
    wood = limb(new T.Vector3(0, -0.3, 0), new T.Vector3(0, height, 0), 0.26, 0.05, 7),
    needles = cards(),
    axis = new T.Vector3(0, height * 0.5, 0),
    whorls = 8 + Math.floor(rnd() * 3);
  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1),
      y = height * (0.2 + 0.74 * t),
      r = maxR * Math.pow(1 - t, 0.85) + 0.35,
      count = 6 - Math.floor(t * 2),
      droop = 0.35 - t * 0.2;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + i * 0.9 + rnd() * 0.4,
        out = new T.Vector3(Math.cos(a), 0, Math.sin(a)),
        dir = out.clone().multiplyScalar(Math.cos(droop)).addScaledVector(UP, -Math.sin(droop)).normalize(),
        base = new T.Vector3(0, y, 0),
        flat = new T.Vector3().crossVectors(dir, UP).normalize(),
        tilt = new T.Vector3().crossVectors(flat, dir).normalize(),
        center = new T.Vector3(0, y + 0.4, 0);
      // The needle texture's branch runs along u from the trunk (u = 0) to the tip, centred across (v = 0.5):
      // two crossed cards per branch, one flat and one upright.
      for (const [across, width] of [
        [flat, r * 0.95],
        [tilt, r * 0.8],
      ])
        card(needles, base.clone().addScaledVector(across, -width / 2), across, dir, r, width, center, 0.3, [0, 0, 1, 1], 0);
    }
  }
  // Leader at the top: sprays pointing up.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI,
      side = new T.Vector3(Math.cos(a), 0, Math.sin(a));
    card(needles, new T.Vector3(0, height - 1.4, 0).addScaledVector(side, -0.45), side, UP, 1.6, 0.9, axis, 0.3, [0, 0, 1, 1], 0);
  }
  wood.computeBoundingBox();
  return { wood: wood.toNonIndexed(), leaves: cardGeometry(needles), height };
}
// Rock: an icosphere pushed out by smooth noise, flattened where it meets the ground.
function rockGeometry(seed) {
  const rnd = seededRandom(seed),
    g = mergeVertices(new T.IcosahedronGeometry(1, 3).deleteAttribute('uv').deleteAttribute('normal')),
    p = g.attributes.position,
    bumps = Array.from({ length: 6 }, () => [new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), 0.12 + rnd() * 0.22]);
  for (let i = 0; i < p.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(p, i),
      n = v.clone().normalize();
    let k = 1;
    for (const [d, s] of bumps) k += s * Math.max(0, n.dot(d)) ** 3 - s * 0.3;
    k += (Math.sin(n.x * 9 + seed) * Math.sin(n.y * 7) * Math.sin(n.z * 8 + seed * 0.3)) * 0.05;
    v.multiplyScalar(k);
    if (v.y < -0.35) v.y = -0.35 - (v.y + 0.35) * 0.15;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}
// Bush: a ball of leaf cards; fern: a rosette of drooping sprays; shrub: a sparse dry twiggy ball.
function bushGeometry(seed, count = 14, radius = 0.8) {
  const rnd = seededRandom(seed),
    out = cards(),
    center = new T.Vector3(0, radius * 0.7, 0);
  for (let k = 0; k < count; k++) {
    const off = new T.Vector3(rnd() - 0.5, rnd() * 0.7 - 0.1, rnd() - 0.5).normalize().multiplyScalar(radius * (0.3 + rnd() * 0.6)),
      base = center.clone().add(off).setY(Math.max(0.05, center.y + off.y - 0.3)),
      dir = off.clone().normalize().addScaledVector(UP, 0.8).normalize(),
      side = new T.Vector3().crossVectors(dir, new T.Vector3(rnd() - 0.5, 0.2, rnd() - 0.5)).normalize(),
      s = radius * (1.1 + rnd() * 0.5);
    card(out, base, dir, side, s, s, center, 0.5);
  }
  return cardGeometry(out);
}
function fernGeometry(seed) {
  const rnd = seededRandom(seed),
    out = cards(),
    center = new T.Vector3(0, 0.1, 0),
    n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd() * 0.5,
      o = new T.Vector3(Math.cos(a), 0, Math.sin(a)),
      dir = o.clone().multiplyScalar(0.8).addScaledVector(UP, 0.55).normalize(),
      flat = new T.Vector3().crossVectors(dir, UP).normalize();
    card(out, new T.Vector3(0, 0.05, 0).addScaledVector(flat, -0.28), flat, dir, 1.05, 0.55, center, 0.7, [0, 0, 1, 1], 0);
  }
  return cardGeometry(out);
}
// Flowers: thin stems with a crossed pair of small petal cards on top (petal texture drawn at runtime).
function flowerGeometry(seed) {
  const rnd = seededRandom(seed),
    out = cards(),
    center = new T.Vector3(0, 0.3, 0);
  for (let k = 0; k < 5; k++) {
    const x = (rnd() - 0.5) * 0.45,
      z = (rnd() - 0.5) * 0.45,
      h = 0.3 + rnd() * 0.25,
      top = new T.Vector3(x, h, z),
      s = 0.12 + rnd() * 0.06;
    // Stem (uses the green bottom strip of the atlas).
    card(out, new T.Vector3(x, 0, z), UP, new T.Vector3(1, 0, 0).applyAxisAngle(UP, rnd() * 3), 0.025, h, center, 0.8, [0.05, 0, 0.1, 0.1]);
    // Blossom: a horizontal card and a tilted one.
    const tiltA = new T.Vector3(1, 0, 0).applyAxisAngle(UP, rnd() * 3);
    const flatDir = new T.Vector3().crossVectors(tiltA, UP).normalize();
    card(out, top.clone().addScaledVector(flatDir, -s / 2), flatDir, tiltA, s, s, center, 0.9, [0, 0.5, 1, 1], 0.5);
    card(out, top.clone().addScaledVector(UP, -s * 0.5), UP, tiltA, s, s, center, 0.9, [0, 0.5, 1, 1], 0.5);
  }
  return cardGeometry(out);
}
function reedGeometry(seed) {
  const rnd = seededRandom(seed),
    out = cards(),
    center = new T.Vector3(0, 0.6, 0);
  for (let k = 0; k < 9; k++) {
    const x = (rnd() - 0.5) * 0.5,
      z = (rnd() - 0.5) * 0.5,
      h = 1.1 + rnd() * 0.7,
      side = new T.Vector3(1, 0, 0).applyAxisAngle(UP, rnd() * 3),
      dir = new T.Vector3((rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3).normalize();
    card(out, new T.Vector3(x, 0, z), dir, side, 0.05, h, center, 0.9, [0.3, 0, 0.35, 0.1]);
    // Cattail heads on some stems.
    if (k % 3 === 0) card(out, new T.Vector3(x, 0, z).addScaledVector(dir, h * 0.8), dir, side, 0.07, 0.22, center, 0.9, [0.55, 0, 0.6, 0.1]);
  }
  return cardGeometry(out);
}
// Petal atlas: top half a blossom (white petals, tinted per instance), bottom strip stem green and reed colours.
let petalTexture = null;
function petals() {
  if (petalTexture || typeof document === 'undefined') return petalTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#4f7a35';
  g.fillRect(0, 0, 128, 128);
  // Stem green, reed straw and cattail brown in the bottom strip (v 0..0.1).
  g.fillStyle = '#5b8a3a';
  g.fillRect(0, 115, 20, 13);
  g.fillStyle = '#9aa05a';
  g.fillRect(34, 115, 16, 13);
  g.fillStyle = '#5a3a22';
  g.fillRect(66, 115, 16, 13);
  // Blossom (v 0.5..1 is the top half of the canvas).
  g.clearRect(0, 0, 128, 64);
  g.translate(64, 32);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.fillStyle = '#f4f1ea';
    g.beginPath();
    g.ellipse(0, -15, 8, 16, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#e8b830';
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.fill();
  petalTexture = new T.CanvasTexture(c);
  petalTexture.colorSpace = T.SRGBColorSpace;
  return petalTexture;
}
let petalMaterial = null;
function flowerMaterial() {
  if (petalMaterial) return petalMaterial;
  petalMaterial = foliageMaterial('leaves', 0xffffff).clone();
  const tex = petals();
  petalMaterial.map = tex;
  petalMaterial.alphaTest = tex ? 0.5 : 0;
  petalMaterial.onBeforeCompile = foliageMaterial('leaves').onBeforeCompile;
  petalMaterial.customProgramCacheKey = () => 'prida-foliage';
  return petalMaterial;
}
// Geometry variants are shared by every map.
let KIT = null;
function kit() {
  if (KIT) return KIT;
  KIT = {
    broad: [11, 23, 37].map(broadleaf),
    pine: [5, 17].map(pine),
    rock: [3, 8, 13, 21].map(rockGeometry),
    bush: [2, 9].map((s) => bushGeometry(s)),
    shrub: [4].map((s) => bushGeometry(s, 9, 0.55)),
    fern: [6, 12].map(fernGeometry),
    flower: [7, 19].map(flowerGeometry),
    reed: [1, 15].map(reedGeometry),
    trunkBox: new T.BoxGeometry(1, 1, 1),
    log: new T.CylinderGeometry(0.5, 0.5, 1, 12, 1).rotateZ(Math.PI / 2),
    bale: new T.CylinderGeometry(0.5, 0.5, 1, 16, 1).rotateX(Math.PI / 2),
    cactus: cactusGeometry(),
  };
  return KIT;
}
function cactusGeometry() {
  const parts = [limb(new T.Vector3(0, -0.2, 0), new T.Vector3(0, 1, 0), 0.5, 0.45, 10)];
  parts.push(new T.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).deleteAttribute('uv').translate(0, 1, 0));
  for (const [s, y, h] of [
    [1, 0.42, 0.28],
    [-1, 0.3, 0.22],
  ]) {
    parts.push(limb(new T.Vector3(0, y, 0), new T.Vector3(s * 0.62, y + 0.06, 0), 0.19, 0.18, 8));
    parts.push(limb(new T.Vector3(s * 0.6, y, 0), new T.Vector3(s * 0.6, y + h + 0.25, 0), 0.18, 0.16, 8));
    parts.push(new T.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).deleteAttribute('uv').translate(s * 0.6, y + h + 0.25, 0));
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.computeBoundingBox();
  return g;
}
const hash = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
export class Nature {
  constructor(map, scenery) {
    const K = kit(),
      culler = scenery.culler,
      batches = new Map(),
      slots = (this.slots = new Map()),
      m4 = new T.Matrix4(),
      q = new T.Quaternion(),
      e = new T.Euler(),
      bark = detailMaterial('bark', 0xffffff, { roughness: 0.95 }),
      pineBark = detailMaterial('pinebark', 0xffffff, { roughness: 0.95 }),
      rock = detailMaterial('rock', 0xffffff, { roughness: 0.92 }),
      leaves = foliageMaterial('leaves', 0xffffff),
      needles = foliageMaterial('needles', 0xffffff),
      cactusSkin = detailMaterial('plaster', 0x5f8a4a, { roughness: 0.7, key: 'cactus', strength: 0.5 }),
      straw = detailMaterial('fabric', 0xd8b764, { roughness: 0.95, key: 'hay' }),
      crate = detailMaterial('oak', 0x9d7760, { box: true, roughness: 0.8, key: 'supply' }),
      benchWood = detailMaterial('oak', 0x976f4c, { box: true, roughness: 0.7, key: 'bench' }),
      benchIron = detailMaterial('metal', 0x3c4a48, { box: true, roughness: 0.5, key: 'bench-leg' });
    const add = (key, geometry, material, matrix, color, group, prop, shadow = true) => {
      if (!batches.has(key)) batches.set(key, new CulledBatch(geometry, material, { colors: true, shadow }));
      const b = batches.get(key),
        i = b.add(matrix, color, group);
      if (prop !== undefined) {
        if (!slots.has(prop)) slots.set(prop, []);
        slots.get(prop).push({ batch: b, index: i });
      }
    };
    const at = (x, y, z, s, yaw = 0, sx = s, sy = s, sz = s) =>
      m4.compose(new T.Vector3(x, y, z), q.setFromEuler(e.set(0, yaw, 0)), new T.Vector3(sx, sy, sz)).clone();
    // Trees: trunk and crown share a random yaw and scale; greens vary per tree.
    const treeProps = new Map(map.obstacles.filter((o) => o.part === 'tree').map((o) => [o.tree, o.prop]));
    const LEAF = [0xd8ecb0, 0xc6e4a0, 0xe8f0b8, 0xbad89a, 0xdce8a8],
      NEEDLE = [0xd0e6c8, 0xbfd8b8, 0xdcecd0];
    for (const [i, [x, z, type]] of map.trees.entries()) {
      const h = hash(x, z),
        y = groundHeight(x, z, map),
        s = 0.85 + h * 0.35,
        yaw = h * 40,
        id = treeProps.get(i),
        group = culler.outdoor(x, z),
        pine = type === 'pine',
        variants = pine ? K.pine : K.broad,
        v = Math.floor(h * 97) % variants.length,
        m = at(x, y, z, s, yaw);
      add((pine ? 'pine-wood:' : 'tree-wood:') + v, variants[v].wood, pine ? pineBark : bark, m, 0xffffff, group, id);
      add((pine ? 'pine-leaves:' : 'tree-leaves:') + v, variants[v].leaves, pine ? needles : leaves, m, (pine ? NEEDLE : LEAF)[Math.floor(h * 13) % (pine ? 3 : 5)], group, id);
    }
    // Rocks keep their collision size; four shapes.
    for (const r of map.rocks) {
      const v = Math.floor(hash(r.x, r.z) * 31) % K.rock.length;
      const ground = r.ground ?? r.y - r.h / 2;
      add('rock:' + v, K.rock[v], rock, at(r.x, ground + r.h * 0.2, r.z, 1, hash(r.z, r.x) * 6, r.w * 0.55, r.h / 1.4, r.d * 0.55), r.color, culler.outdoor(r.x, r.z), r.prop);
    }
    for (const o of map.obstacles) {
      if (o.part === 'cactus') add('cactus', K.cactus, cactusSkin, at(o.x, o.ground, o.z, 1, hash(o.x, o.z) * 6, 0.6, o.h / 1.45, 0.6), 0xffffff, culler.outdoor(o.x, o.z), o.prop);
      else if (o.part === 'log')
        add('log', K.log, bark, at(o.x, o.ground + o.h / 2, o.z, 1, 0, o.w, o.h, o.d), 0xffffff, culler.outdoor(o.x, o.z), o.prop);
      else if (o.part === 'hay') add('hay', K.bale, straw, at(o.x, o.ground + o.h / 2, o.z, 1, hash(o.x, o.z) * 3, o.w, o.h, o.d * 0.9), 0xffffff, culler.outdoor(o.x, o.z), o.prop);
      else if (o.part === 'crate') add('crate', K.trunkBox, crate, at(o.x, o.y, o.z, 1, 0, o.w, o.h, o.d), 0xffffff, culler.outdoor(o.x, o.z), o.prop);
    }
    // Park benches: a slatted seat and back on iron legs.
    for (const b of map.cover.filter((c) => c.part === 'bench')) {
      const g = culler.outdoor(b.x, b.z);
      add('bench-seat', K.trunkBox, benchWood, at(b.x, b.ground + 0.46, b.z, 1, 0, b.w, 0.06, 0.5), 0xffffff, g, b.prop);
      add('bench-seat', K.trunkBox, benchWood, at(b.x, b.ground + 0.78, b.z + 0.26, 1, 0, b.w, 0.36, 0.05), 0xffffff, g, b.prop);
      for (const side of [-1, 1]) add('bench-leg', K.trunkBox, benchIron, at(b.x + side * 0.8, b.ground + 0.23, b.z, 1, 0, 0.07, 0.46, 0.5), 0xffffff, g, b.prop);
    }
    // Ground cover in the wild biomes (render only).
    const PETALS = [0xf0d24a, 0xe46f7b, 0xf3f0ea, 0x9c7fe0];
    let seed = map.seed >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const f of map.flora) {
      if (f.kind === 'grass') continue; // the 3D grass field covers it
      const y = groundHeight(f.x, f.z, map);
      if (f.kind !== 'reed' && map.waters.some((w) => w.lake && y < w.y + 0.05)) continue;
      const v = Math.floor(rnd() * 2),
        yaw = rnd() * 6.28,
        g = culler.outdoor(f.x, f.z),
        s = f.s;
      if (f.kind === 'bush') add('bush:' + v, K.bush[v], leaves, at(f.x, y - 0.05, f.z, s * 1.1, yaw), 0xb8d49a, g, undefined, false);
      else if (f.kind === 'shrub') add('shrub', K.shrub[0], needles, at(f.x, y - 0.05, f.z, s, yaw), 0xe0c890, g, undefined, false);
      else if (f.kind === 'fern') add('fern:' + v, K.fern[v], needles, at(f.x, y, f.z, s, yaw), 0xd4ecb0, g, undefined, false);
      else if (f.kind === 'reed') add('reed:' + v, K.reed[v], flowerMaterial(), at(f.x, y - 0.1, f.z, s, yaw), 0xffffff, g, undefined, false);
      else if (f.kind === 'flower') add('flower:' + v, K.flower[v], flowerMaterial(), at(f.x, y, f.z, s, yaw), PETALS[f.c || 0], g, undefined, false);
    }
    for (const [key, b] of batches) scenery.adopt('nature:' + key, b);
  }
  hide(prop) {
    for (const { batch, index } of this.slots.get(prop) || []) batch.hide(index);
  }
}
