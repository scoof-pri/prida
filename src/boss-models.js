// Boss bodies: game-authored creatures, one shape per boss, built from sculpted primitives (noise-displaced
// boulders, lathed muscles and robes, plates, crystals) with the world's PBR surfaces (rock, metal, fabric,
// concrete) and glowing seams. They are not skinned models: each body is a tree of joints that poseBoss() drives
// procedurally. Every move in bosses.js MOVES has its own animation here (wind-up, strike, recovery), timed from the
// same `at` / `dur` numbers the simulation uses, so the blow lands on screen exactly when it lands in the game.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uvMaterial, surfaceTint } from './materials.js';
import { MOVES, bossHeight } from './bosses.js';

// ——— Shapes ———————————————————————————————————————————————————————————————————————————————————————————————
// Texel density: repeat the surface texture about every `metres` of the part's size.
function tile(geometry, metres = 1.1) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  geometry.computeBoundingBox();
  const s = geometry.boundingBox.getSize(new T.Vector3()),
    k = Math.max(s.x, s.y, s.z) / metres;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  uv.needsUpdate = true;
  return geometry;
}
// Small deterministic value noise for sculpting boulders and hems.
function hash(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise3(x, y, z) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z),
    xf = x - xi,
    yf = y - yi,
    zf = z - zi,
    s = (t) => t * t * (3 - 2 * t),
    u = s(xf),
    v = s(yf),
    w = s(zf);
  let out = 0;
  for (let dx = 0; dx < 2; dx++)
    for (let dy = 0; dy < 2; dy++)
      for (let dz = 0; dz < 2; dz++)
        out += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return out;
}
// A boulder: an icosphere pushed in and out by noise (the same position always moves the same way, so the
// faceted rock stays closed), then squashed into shape.
function rockGeo(r, { detail = 1, seed = 1, rough = 0.28, squash = [1, 1, 1] } = {}) {
  const g = new T.IcosahedronGeometry(r, detail),
    p = g.attributes.position,
    v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize(),
      d = 1 + rough * ((noise3(n.x * 1.7 + seed, n.y * 1.7, n.z * 1.7 - seed) - 0.5) * 2 + (noise3(n.x * 4 - seed, n.y * 4 + seed, n.z * 4) - 0.5) * 0.7);
    p.setXYZ(i, v.x * d * squash[0], v.y * d * squash[1], v.z * d * squash[2]);
  }
  g.computeVertexNormals();
  return g;
}
export { rockGeo as bossRock, crystal as bossCrystal, horn as bossHorn };
// A limb or torso turned on a lathe, hanging down from its joint: radius r0 at the top, r1 at the bottom, with a
// muscle's bulge in between. Points run bottom to top so the faces point outward.
function muscle(len, r0, r1, bulge = 0.15, seg = 10) {
  const pts = [new T.Vector2(0.001, -len)];
  for (let i = 8; i >= 0; i--) {
    const t = i / 8,
      r = (r0 + (r1 - r0) * t) * (1 + bulge * Math.sin(Math.PI * t)) * (i === 0 || i === 8 ? 0.82 : 1);
    pts.push(new T.Vector2(Math.max(0.002, r), -t * len));
  }
  pts.push(new T.Vector2(0.001, 0));
  return new T.LatheGeometry(pts, seg);
}
// A robe or skirt: a flared lathe with an open, ragged hem (wavy around the edge).
function robe(len, top, bottom, { seg = 18, rag = 0.12, seed = 2, open = true } = {}) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new T.Vector2(bottom + (top - bottom) * t * t * (1.2 - 0.2 * t), -len + t * len));
  }
  if (!open) pts.push(new T.Vector2(0.001, 0));
  const g = new T.LatheGeometry(pts, seg),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > -len * 0.75) continue;
    const a = Math.atan2(p.getZ(i), p.getX(i)),
      k = (-len * 0.75 - y) / (len * 0.25);
    p.setY(i, y + (noise3(Math.cos(a) * 3 + seed, Math.sin(a) * 3, seed) - 0.3) * rag * k * len);
  }
  g.computeVertexNormals();
  return g;
}
// A horn or claw: a cone bent along its length.
function horn(len, r, bend = 0.6, seg = 6) {
  const g = new T.ConeGeometry(r, len, seg, 6),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + len / 2) / len;
    p.setZ(i, p.getZ(i) + Math.sin(t * Math.PI * 0.5) * bend * len * t);
  }
  g.computeVertexNormals();
  return g;
}
// A crystal: a stretched octahedron.
function crystal(r, len) {
  const g = new T.OctahedronGeometry(r, 0);
  g.scale(1, len / r / 2, 1);
  return g;
}
const box = (w, h, d) => new T.BoxGeometry(w, h, d);
const sphere = (r, w = 12, h = 10) => new T.SphereGeometry(r, w, h);

// ——— Materials ——————————————————————————————————————————————————————————————————————————————————————————
// A material of one of the world's surfaces, tinted and lit from within. UV-mapped surfaces carry their tint in
// vertex colours (like the roofs), so the tint is stamped onto each part's geometry by piece().
function skin(name, color, { emissive = 0x000000, ei = 0, roughness = 0.85, metalness = 0, flat = false, side = null } = {}) {
  const m = uvMaterial(name, { roughness, metalness }).clone();
  m.emissive = new T.Color(emissive);
  m.emissiveIntensity = ei;
  m.flatShading = flat;
  if (side !== null) m.side = side;
  m.userData = { ...m.userData, tint: surfaceTint(name, color) };
  m.needsUpdate = true;
  return m;
}
// Paints one geometry with a flat vertex colour (the material's tint).
function paint(geometry, material) {
  const tint = material.userData?.tint;
  if (!tint || !geometry.attributes.position) return geometry;
  const n = geometry.attributes.position.count,
    a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) tint.toArray(a, i * 3);
  geometry.setAttribute('color', new T.BufferAttribute(a, 3));
  return geometry;
}
function glow(color, opacity = 1) {
  const m = new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, fog: false, depthWrite: opacity >= 1 });
  m.userData.glow = true;
  return m;
}
function joint(parent, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function piece(parent, geometry, material, x = 0, y = 0, z = 0, rot = null, scale = null) {
  const m = new T.Mesh(paint(tile(geometry), material), material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  if (scale) Array.isArray(scale) ? m.scale.set(...scale) : m.scale.setScalar(scale);
  m.castShadow = !material.userData?.glow;
  parent.add(m);
  return m;
}
// A part that animates on its own (orbs, shards, a boulder in the fist): never merged away.
function loose(mesh) {
  mesh.userData.keep = true;
  return mesh;
}

// ——— Limbs —————————————————————————————————————————————————————————————————————————————————————————————
// Arms hang from the shoulders: upper arm, forearm and a hand. `side` -1 is the creature's right (−X).
function arms(chest, mat, { spread = 0.9, y = 0, upper = 0.85, fore = 0.8, r = 0.2, fr = null, bulge = 0.18, hand = null, elbowMat = null }) {
  const out = [];
  for (const side of [-1, 1]) {
    const shoulder = joint(chest, side * spread, y, 0);
    piece(shoulder, muscle(upper, r, r * 0.82, bulge), mat, 0, 0, 0);
    const elbow = joint(shoulder, 0, -upper, 0);
    if (elbowMat) piece(elbow, sphere(r * 0.85, 10, 8), elbowMat, 0, 0, 0);
    piece(elbow, muscle(fore, (fr ?? r) * 0.85, fr ?? r * 0.8, bulge * 0.8), mat, 0, 0, 0);
    const wrist = joint(elbow, 0, -fore, 0);
    if (hand) hand(wrist, side, shoulder);
    out.push({ shoulder, elbow, wrist, side });
  }
  return out;
}
// Legs hang from the hips: thigh, shin and a foot.
function legs(hips, mat, { spread = 0.42, thigh = 0.8, shin = 0.75, r = 0.24, foot = null, knee = null }) {
  const out = [];
  for (const side of [-1, 1]) {
    const hip = joint(hips, side * spread, 0, 0);
    piece(hip, muscle(thigh, r, r * 0.8, 0.2), mat, 0, 0, 0);
    const kn = joint(hip, 0, -thigh, 0);
    if (knee) knee(kn, side);
    piece(kn, muscle(shin, r * 0.8, r * 0.7, 0.16), mat, 0, 0, 0);
    const ankle = joint(kn, 0, -shin, 0);
    if (foot) foot(ankle, side);
    out.push({ hip, knee: kn, ankle, side });
  }
  return out;
}

// ——— IGNIS — the fire golem ——————————————————————————————————————————————————————————————————————————————
// Coal-black basalt around a molten core that shows through the cracks, horns, a club of cooled rock for a right
// arm, magma dripping from its joints and flames on its back.
function golem() {
  const root = new T.Group(),
    // Dim red emissive: the cracks and the core carry the fire, the rock only warms up when it casts.
    basalt = skin('concrete', 0x221b18, { emissive: 0x6a1c06, ei: 0.05, roughness: 0.95, flat: true }),
    crust = skin('rock', 0x3a2c24, { emissive: 0x6a2a0a, ei: 0.04, roughness: 1, flat: true }),
    lava = glow(0xff7a22),
    core = glow(0xffc050),
    ember = glow(0xffe07a);
  const body = joint(root, 0, 1.35, 0),
    hips = joint(body, 0, 0, 0);
  piece(hips, rockGeo(0.55, { seed: 2, squash: [1.05, 0.6, 0.8] }), crust, 0, 0.06, 0);
  piece(hips, new T.TorusGeometry(0.46, 0.04, 5, 18), lava, 0, 0.16, 0, [Math.PI / 2, 0, 0]);
  const chest = joint(body, 0, 0.3, 0);
  chest.rotation.x = 0.22; // stooped, dragging its knuckles
  // The molten core, then a cage of basalt slabs around it with glowing gaps.
  piece(chest, sphere(0.52, 16, 12), lava, 0, 0.62, 0);
  piece(chest, sphere(0.3, 12, 10), core, 0, 0.64, 0.24);
  // Slabs with wide gaps: the core shows through the front as glowing cracks.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    piece(chest, rockGeo(0.27, { seed: 60 + i, squash: [1, 1.6, 0.55] }), basalt, Math.sin(a) * 0.58, 0.6 + (i % 2) * 0.12, Math.cos(a) * 0.5, [0.1, a, 0.15]);
  }
  piece(chest, rockGeo(0.46, { seed: 71, squash: [1.2, 0.7, 0.9] }), basalt, 0, 1.08, -0.05);
  for (const s of [-1, 1]) piece(chest, rockGeo(0.42, { seed: 72 + s, squash: [1.1, 0.9, 1] }), crust, s * 0.78, 0.98, -0.06);
  for (let i = 0; i < 5; i++) piece(chest, horn(0.42, 0.1, -0.5, 5), crust, (i - 2) * 0.2, 1.18 + (i % 2) * 0.1, -0.34, [-0.8, 0, 0]);
  // Magma drips under the chest.
  for (let i = 0; i < 4; i++) piece(chest, new T.ConeGeometry(0.05, 0.28, 5), lava, (i - 1.5) * 0.24, 0.06, 0.36, [Math.PI, 0, 0]);
  const head = joint(chest, 0, 1.12, 0.12);
  piece(head, rockGeo(0.34, { seed: 81, squash: [1.05, 0.9, 1] }), crust, 0, 0.12, 0);
  for (const s of [-1, 1]) {
    piece(head, horn(0.55, 0.09, 0.9, 6), crust, s * 0.26, 0.34, -0.05, [-0.3, 0, s * -0.7]);
    piece(head, box(0.1, 0.06, 0.06), ember, s * 0.12, 0.14, 0.3);
  }
  piece(head, box(0.3, 0.05, 0.06), lava, 0, 0.0, 0.3);
  const limbs = arms(chest, basalt, {
    spread: 0.82,
    y: 0.95,
    upper: 1.0,
    fore: 0.95,
    r: 0.26,
    fr: 0.24,
    bulge: 0.2,
    elbowMat: lava,
    hand: (wrist, side) => {
      if (side < 0) {
        // The club: a boulder of cooled rock veined with lava.
        piece(wrist, rockGeo(0.46, { seed: 91, squash: [1, 1.2, 1] }), crust, 0, -0.34, 0);
        piece(wrist, new T.TorusGeometry(0.4, 0.03, 4, 16), lava, 0, -0.34, 0, [0.4, 0.3, 0]);
        for (let i = 0; i < 3; i++) piece(wrist, horn(0.3, 0.07, 0.2, 4), crust, (i - 1) * 0.2, -0.6, 0.1, [Math.PI * 0.8, 0, 0]);
      } else {
        piece(wrist, sphere(0.2, 10, 8), lava, 0, -0.16, 0);
        for (let i = 0; i < 4; i++) piece(wrist, horn(0.24, 0.05, 0.4, 4), crust, (i - 1.5) * 0.08, -0.34, 0.06, [Math.PI, 0, 0]);
      }
    },
  });
  // The club arm is the heavier one.
  limbs[0].shoulder.scale.setScalar(1.15);
  for (const a of limbs) piece(a.elbow, new T.ConeGeometry(0.05, 0.3, 5), lava, 0, -0.25, 0.2, [Math.PI, 0, 0]);
  const walk = legs(hips, basalt, {
    spread: 0.38,
    thigh: 0.66,
    shin: 0.6,
    r: 0.27,
    knee: (k) => piece(k, sphere(0.15, 8, 6), lava, 0, 0, 0.1),
    foot: (a) => piece(a, rockGeo(0.3, { seed: 99, squash: [1, 0.5, 1.4] }), crust, 0, -0.08, 0.14),
  });
  // A fireball in the left hand for the throw.
  const prop = loose(piece(limbs[1].wrist, sphere(0.3, 12, 10), core, 0, -0.4, 0.05));
  prop.visible = false;
  return {
    root,
    body,
    chest,
    head,
    arms: limbs,
    legs: walk,
    walker: true,
    prop,
    throwArm: 1,
    flames: [
      [0, 2.62, -0.45, 1.5],
      [-0.75, 2.35, -0.35, 1],
      [0.75, 2.35, -0.35, 1],
    ],
  };
}

// ——— NULL — the void warden —————————————————————————————————————————————————————————————————————————————
// Layered black armour with violet seams and runes, a horned helm, a torn cloak, clawed gauntlets and a ring of
// nothing turning at its back.
function warden() {
  const root = new T.Group(),
    plate = skin('steel', 0x1c1828, { emissive: 0x8a5cff, ei: 0.05, roughness: 0.38, metalness: 0.8, flat: true }),
    trim = skin('steel', 0x5a5270, { emissive: 0x8a5cff, ei: 0.06, roughness: 0.3, metalness: 0.9 }),
    dark = skin('fabric', 0x0d0b16, { emissive: 0x5a2fd0, ei: 0.12, roughness: 0.95, side: T.DoubleSide }),
    void_ = glow(0x9a70ff),
    black = glow(0x07030f);
  const body = joint(root, 0, 1.6, 0),
    hips = joint(body, 0, 0, 0);
  piece(hips, muscle(0.42, 0.34, 0.4, 0.05, 12), plate, 0, 0.26, 0);
  // Tassets: four plates hanging over the thighs.
  for (let i = 0; i < 4; i++) piece(hips, box(0.3, 0.46, 0.06), plate, (i - 1.5) * 0.24, -0.2, 0.34 - Math.abs(i - 1.5) * 0.08, [0.15, (i - 1.5) * 0.25, 0]);
  const chest = joint(body, 0, 0.3, 0);
  piece(chest, muscle(1.0, 0.56, 0.36, 0.12, 14), plate, 0, 1.0, 0, null, [1.05, 1, 0.72]);
  piece(chest, box(0.14, 0.82, 0.1), void_, 0, 0.52, 0.36);
  for (let i = 0; i < 3; i++) piece(chest, box(0.1, 0.1, 0.04), void_, (i - 1) * 0.22, 0.86 - (i % 2) * 0.12, 0.38, [0, 0, Math.PI / 4]);
  piece(chest, new T.TorusGeometry(0.34, 0.06, 6, 18), trim, 0, 1.02, 0, [Math.PI / 2, 0, 0]); // gorget
  // Cloak: strips hanging down the back from the shoulders.
  for (let i = 0; i < 5; i++) piece(chest, box(0.26, 2.2 - (i % 2) * 0.3, 0.03), dark, (i - 2) * 0.22, -0.05 - (i % 2) * 0.15, -0.34 - Math.abs(i - 2) * 0.03, [-0.1, (i - 2) * 0.12, 0]);
  for (const s of [-1, 1]) {
    // Pauldrons: three layered plates and a spike.
    for (let k = 0; k < 3; k++) piece(chest, sphere(0.34 - k * 0.05, 12, 8), plate, s * (0.72 + k * 0.04), 0.98 - k * 0.1, 0, [0, 0, s * (0.3 + k * 0.1)], [1, 0.45, 1]);
    piece(chest, horn(0.42, 0.07, 0.3, 5), trim, s * 0.82, 1.2, -0.05, [0, 0, s * -0.5]);
  }
  const head = joint(chest, 0, 1.08, 0);
  piece(head, muscle(0.5, 0.2, 0.25, 0.1, 12), plate, 0, 0.5, 0);
  piece(head, box(0.3, 0.05, 0.06), void_, 0, 0.26, 0.24);
  for (const s of [-1, 1]) piece(head, horn(0.6, 0.06, -0.9, 5), trim, s * 0.2, 0.52, -0.02, [-0.9, 0, s * 0.35]);
  piece(head, horn(0.34, 0.04, -0.4, 4), trim, 0, 0.6, 0.05, [-0.35, 0, 0]);
  const limbs = arms(chest, plate, {
    spread: 0.66,
    y: 0.86,
    upper: 0.8,
    fore: 0.78,
    r: 0.15,
    fr: 0.17,
    bulge: 0.12,
    elbowMat: trim,
    hand: (wrist, side) => {
      piece(wrist, box(0.2, 0.24, 0.2), plate, 0, -0.12, 0);
      for (let i = 0; i < 3; i++) piece(wrist, horn(0.34, 0.035, 0.5, 4), void_, (i - 1) * 0.07, -0.36, side * 0.02 + 0.04, [Math.PI, 0, 0]);
    },
  });
  for (const a of limbs) piece(a.elbow, muscle(0.36, 0.2, 0.22, 0.05, 10), trim, 0, -0.3, 0);
  const walk = legs(hips, plate, {
    spread: 0.3,
    thigh: 0.78,
    shin: 0.72,
    r: 0.17,
    knee: (k) => piece(k, horn(0.26, 0.07, 0.3, 5), trim, 0, 0.05, 0.14, [Math.PI / 2, 0, 0]),
    foot: (a) => piece(a, box(0.24, 0.16, 0.5), plate, 0, -0.08, 0.1),
  });
  // The ring of nothing: a black disc with a violet rim and runes turning around it.
  const halo = loose(new T.Group());
  halo.add(new T.Mesh(new T.TorusGeometry(1, 0.05, 6, 40), void_));
  const disc = new T.Mesh(new T.CircleGeometry(0.92, 32), black);
  disc.material.side = T.DoubleSide;
  disc.position.z = -0.02;
  halo.add(disc);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2,
      r = new T.Mesh(box(0.1, 0.1, 0.03), void_);
    r.position.set(Math.cos(a) * 1.16, Math.sin(a) * 1.16, 0);
    r.rotation.z = a + Math.PI / 4;
    halo.add(r);
  }
  halo.position.set(0, 2.5, -0.62);
  root.add(halo);
  return { root, body, chest, head, arms: limbs, legs: walk, walker: true, halo };
}

// ——— ARACHNE — the brood mother (new in 0.21) ————————————————————————————————————————————————————————————
// A spider the size of a car: chitin plates, a swollen abdomen marked in venom green, eight jointed legs, a
// cluster of eyes, pedipalps (its "arms") and two fangs dripping venom.
function broodMother() {
  const root = new T.Group(),
    chitin = skin('steel', 0x1f2616, { emissive: 0x2b4a10, ei: 0.08, roughness: 0.42, metalness: 0.35, flat: true }),
    shell = skin('bark', 0x3a3a24, { roughness: 0.8 }),
    hair = skin('fabric', 0x2d2a1c, { roughness: 1 }),
    venom = glow(0x9bd84a),
    eyes = glow(0xd8ff7a);
  const body = joint(root, 0, 1.3, 0),
    hips = joint(body, 0, 0, 0);
  // Cephalothorax and head.
  piece(hips, sphere(0.62, 16, 12), chitin, 0, 0, 0.1, null, [1.05, 0.62, 1.15]);
  piece(hips, rockGeo(0.5, { seed: 4, rough: 0.12, squash: [1.1, 0.45, 1.2] }), shell, 0, 0.2, 0.05);
  const chest = joint(body, 0, 0.05, 0.62);
  piece(chest, sphere(0.36, 14, 10), chitin, 0, 0, 0.12, null, [1, 0.8, 1]);
  const head = joint(chest, 0, 0.12, 0.34);
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1,
      k = (i % 4) - 1.5;
    piece(head, sphere(row ? 0.035 : 0.055, 8, 6), eyes, k * (row ? 0.1 : 0.075), row ? 0.1 : 0.02, 0.02 - Math.abs(k) * 0.03);
  }
  // Fangs (chelicerae) under the eyes: they open and snap shut on a bite.
  const fangs = [];
  for (const s of [-1, 1]) {
    const f = joint(head, s * 0.1, -0.12, 0);
    piece(f, muscle(0.2, 0.07, 0.06, 0.2, 8), chitin, 0, 0, 0);
    piece(f, horn(0.26, 0.035, -0.6, 5), venom, 0, -0.3, 0.02, [Math.PI, 0, 0]);
    f.rotation.x = 0.3;
    fangs.push(f);
  }
  // Pedipalps: the spider's "arms", short and jointed, feeling ahead.
  const limbs = arms(chest, chitin, {
    spread: 0.22,
    y: -0.06,
    upper: 0.42,
    fore: 0.38,
    r: 0.06,
    bulge: 0.2,
    hand: (wrist) => piece(wrist, sphere(0.07, 8, 6), shell, 0, -0.02, 0),
  });
  // Abdomen: a swollen bulb raised behind, marked with glowing bands, bristling with hair.
  const abdomen = joint(body, 0, 0.25, -0.62);
  abdomen.rotation.x = -0.35;
  const bulb = new T.Group();
  bulb.rotation.x = -Math.PI / 2;
  abdomen.add(bulb);
  piece(bulb, muscle(1.9, 0.5, 0.3, 0.75, 16), chitin, 0, 0, 0);
  for (let i = 0; i < 3; i++) piece(bulb, new T.TorusGeometry(0.62 + (i === 1 ? 0.14 : 0), 0.035, 5, 24), venom, 0, -0.55 - i * 0.38, 0, [Math.PI / 2, 0, 0]);
  piece(bulb, crystal(0.12, 0.5), venom, 0, -0.95, -0.72, [Math.PI / 2, 0, 0]); // the hourglass
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    piece(bulb, new T.ConeGeometry(0.03, 0.26, 4), hair, Math.cos(a) * 0.7, -0.7 - (i % 3) * 0.3, Math.sin(a) * 0.7, [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2]);
  }
  piece(bulb, new T.ConeGeometry(0.12, 0.3, 6), shell, 0, -1.95, 0, [Math.PI, 0, 0]); // spinnerets
  // Eight legs: coxa at the body, femur up and out, tibia down to the ground.
  const spider = [];
  for (const side of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const a = [0.62, 1.2, 1.9, 2.45][i],
        ux = side * Math.sin(a),
        uz = Math.cos(a),
        hip = joint(hips, ux * 0.52, -0.02, 0.1 + uz * 0.52);
      hip.rotation.y = Math.atan2(-uz, ux);
      const femur = joint(hip, 0, 0, 0);
      femur.rotation.z = 2.2;
      piece(femur, muscle(1.25, 0.13, 0.1, 0.25, 8), chitin, 0, 0, 0);
      piece(femur, sphere(0.1, 8, 6), shell, 0, 0, 0);
      for (let k = 0; k < 3; k++) piece(femur, new T.ConeGeometry(0.02, 0.16, 4), hair, 0.07, -0.3 - k * 0.3, 0, [0, 0, -1.2]);
      const knee = joint(femur, 0, -1.25, 0);
      knee.rotation.z = -1.95;
      piece(knee, sphere(0.09, 8, 6), shell, 0, 0, 0);
      piece(knee, muscle(1.9, 0.1, 0.045, 0.1, 8), chitin, 0, 0, 0);
      piece(knee, new T.ConeGeometry(0.04, 0.2, 5), shell, 0, -1.98, 0, [Math.PI, 0, 0]);
      spider.push({ hip, knee: femur, ankle: knee, side, index: i, phase: (i % 2) ^ (side > 0 ? 1 : 0) });
    }
  return { root, body, chest, head, arms: limbs, legs: spider, spider: true, walker: true, abdomen, fangs };
}

// ——— TERRA — the quarry wyrm (new in 0.21) —————————————————————————————————————————————————————————————
// A segmented worm of stone plates rising out of a ring of rubble: amber crystals glow between the plates, the
// head is a round maw ringed with teeth, and two tusks flank it (its "arms"). It burrows and bursts out again.
function wyrm() {
  const root = new T.Group(),
    stone = skin('rock', 0xb09274, { emissive: 0xff8a2e, ei: 0.03, roughness: 0.95, flat: true }),
    plateM = skin('rock', 0x7a6048, { roughness: 1, flat: true }),
    bone = skin('plaster', 0xe8dcc0, { roughness: 0.7 }),
    amber = glow(0xffb040),
    throat = glow(0xff6a1a),
    dirt = skin('dirt', 0x8a7458, { roughness: 1, flat: true });
  // Rubble ring and a mound of earth where it breaks the surface.
  const base = new T.Group();
  root.add(base);
  piece(base, rockGeo(1.05, { seed: 2, rough: 0.2, squash: [1.3, 0.28, 1.3] }), dirt, 0, 0.1, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    piece(base, rockGeo(0.3 + (i % 3) * 0.08, { seed: 10 + i }), stone, Math.cos(a) * 1.25, 0.2, Math.sin(a) * 1.25);
  }
  const body = joint(root, 0, 0.3, 0),
    hips = joint(body, 0, 0, 0);
  // Segments: each a stone barrel with plates, narrowing toward the head.
  const segments = [];
  let parent = hips;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const s = joint(parent, 0, i ? 0.5 : 0, 0),
      r = 0.72 - i * 0.045;
    // Each segment leans a little further forward than the one below: the body arcs over like a serpent's.
    s.rotation.x = 0.03 + i * 0.035;
    piece(s, muscle(0.56, r, r * 0.95, 0.12, 12), stone, 0, 0.56, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + i * 0.4;
      piece(s, box(r * 0.9, 0.34, 0.12), plateM, Math.sin(a) * r * 0.95, 0.3, Math.cos(a) * r * 0.95, [0.1, a, 0]);
      if ((k + i) % 2) piece(s, crystal(0.07, 0.22), amber, Math.sin(a + 0.8) * r * 1.02, 0.06, Math.cos(a + 0.8) * r * 1.02, [0, a, 0.3]);
    }
    segments.push(s);
    parent = s;
  }
  const chest = segments[n - 1];
  const head = joint(chest, 0, 0.62, 0.1);
  head.rotation.x = 1.0; // with the arc of the body, the maw faces forward and down
  piece(head, muscle(0.9, 0.52, 0.66, 0.1, 14), stone, 0, 0.9, 0);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    piece(head, box(0.34, 0.6, 0.12), plateM, Math.sin(a) * 0.56, 0.5, Math.cos(a) * 0.56, [0.15, a, 0]);
  }
  // The maw at the front end (+Y of the head joint): a throat of fire ringed by teeth pointing inward.
  piece(head, new T.CircleGeometry(0.44, 20), throat, 0, 0.93, 0, [-Math.PI / 2, 0, 0]);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    piece(head, new T.ConeGeometry(0.05, 0.3, 4), bone, Math.sin(a) * 0.46, 0.92, Math.cos(a) * 0.46, [Math.cos(a) * -1.1, 0, Math.sin(a) * 1.1]);
  }
  for (let k = 0; k < 3; k++) piece(head, crystal(0.09, 0.3), amber, (k - 1) * 0.3, 0.3, -0.6, [0.4, 0, 0]);
  // Tusks either side of the maw, on joints so they can close like mandibles.
  const limbs = [];
  for (const side of [-1, 1]) {
    const shoulder = joint(head, side * 0.55, 0.8, 0.1);
    shoulder.rotation.z = side * 0.3;
    const elbow = joint(shoulder, 0, 0, 0),
      wrist = joint(elbow, 0, 0.5, 0);
    piece(elbow, horn(0.7, 0.1, -0.5, 6), bone, 0, 0.3, 0, [0, 0, side * 0.2]);
    limbs.push({ shoulder, elbow, wrist, side });
  }
  return { root, body, chest, head, arms: limbs, legs: [], walker: false, wyrm: true, segments, base };
}

// ——— Assembly ——————————————————————————————————————————————————————————————————————————————————————————
// Static pieces that share a joint and a material are merged into one mesh: a boss is dozens of parts but only
// a handful of draw calls.
function mergeStatic(root) {
  const groups = [],
    walk = (o) => {
      // Loose groups (orbs, shards, the crown) animate part by part: leave them as they are.
      if (o.isMesh || o.userData.keep) return;
      groups.push(o);
      for (const c of o.children) walk(c);
    };
  walk(root);
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children)
      if (c.isMesh && !c.userData.keep && !c.children.length) {
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(c);
      }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        return geo.applyMatrix4(m.matrix);
      });
      const names = ['position', 'normal', 'uv', 'color'].filter((n) => geos.every((q) => q.attributes[n]));
      for (const q of geos) for (const n of Object.keys(q.attributes)) if (!names.includes(n)) q.deleteAttribute(n);
      const merged = mergeGeometries(geos);
      for (const q of geos) q.dispose();
      if (!merged) continue;
      for (const m of list) {
        g.remove(m);
        m.geometry.dispose();
      }
      const mesh = new T.Mesh(merged, mat);
      mesh.castShadow = !mat.userData?.glow;
      g.add(mesh);
    }
  }
}
const BUILDERS = { fire: golem, void: warden, brood: broodMother, wyrm };
export function buildBoss(kind) {
  const v = (BUILDERS[kind] || golem)();
  v.kind = kind;
  let parts = 0;
  v.root.traverse((o) => o.isMesh && parts++);
  v.parts = parts;
  mergeStatic(v.root);
  // Everything sits in one rig group: the view moves `root`, the animation tilts, spins and sinks `rig`.
  const rig = new T.Group();
  while (v.root.children.length) rig.add(v.root.children[0]);
  v.root.add(rig);
  v.rig = rig;
  // Every boss is as tall in the view as its hit box in the simulation, whatever its shape, and stands on the
  // ground (floaters hover above it).
  const box3 = new T.Box3().setFromObject(rig),
    low = Math.min(0, box3.min.y),
    scale = bossHeight(kind) / Math.max(0.5, box3.max.y - low);
  rig.scale.setScalar(scale);
  rig.position.y = -low * scale;
  v.scale = scale;
  v.rigY = rig.position.y;
  v.baseY = v.body.position.y;
  v.rest = {
    chest: v.chest.rotation.x,
    head: v.head.rotation.x,
    arms: v.arms.map((a) => ({ x: a.shoulder.rotation.x, z: a.shoulder.rotation.z, e: a.elbow.rotation.x })),
    legs: v.legs.map((l) => ({ hy: l.hip.rotation.y, kz: l.knee.rotation.z, az: l.ankle.rotation.z })),
    fangs: v.fangs?.map((f) => f.rotation.x),
    abdomen: v.abdomen?.rotation.x,
    segs: v.segments?.map((s) => s.rotation.x),
  };
  v.meshes = [];
  v.root.traverse((o) => o.isMesh && v.meshes.push(o));
  return v;
}

// ——— Animation ——————————————————————————————————————————————————————————————————————————————————————
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};
// Poses are sets of channels (all zero at rest). arm entries: x swings the arm forward and up (negative), z opens
// it outward, e bends the elbow. Other channels: lean (forward), twist (chest turn), crouch, hop (the rig rises),
// sink (it goes into the ground), turns (full spins over the move), shrink, glow (seams brighter), orb (orbs and
// shards fly wider), halo (halo size), prop (a boulder or fireball in the fist), fang and abd (spider), run.
const P = (o) => o;
const ARM = (x, z = 0.12, e = -0.25) => ({ x, z, e });
const BOTH = (x, z, e) => ({ armR: ARM(x, z, e), armL: ARM(x, z, e) });
// Wind-up and strike poses per move. The strike pose is reached at the moment the blow lands (`at`).
const POSES = {
  smash: { wind: P({ ...BOTH(-2.7, 0.25, -0.4), lean: -0.25, headX: -0.2 }), strike: P({ ...BOTH(-0.55, 0.1, -0.1), lean: 0.5, crouch: 0.35, headX: 0.2 }) },
  swipe: { wind: P({ armR: ARM(-0.5, 1.4, -0.2), twist: -0.7, lean: 0.05 }), strike: P({ armR: ARM(-1.35, -0.35, -0.1), twist: 0.75, lean: 0.25 }) },
  claw: { wind: P({ armR: ARM(-2.5, 0.9, -0.5), twist: -0.35, lean: -0.1 }), strike: P({ armR: ARM(-0.3, -0.4, -0.2), twist: 0.45, lean: 0.35 }) },
  hurl: { wind: P({ armL: ARM(0.95, 0.35, -1.2), twist: 0.55, lean: -0.2, prop: 1, glow: 0.5 }), strike: P({ armL: ARM(-2.2, 0.1, -0.1), twist: -0.5, lean: 0.35 }) },
  point: { wind: P({ armR: ARM(-1.1, 0.3, -0.7), twist: -0.2 }), strike: P({ armR: ARM(-1.57, 0, 0), twist: 0.1, glow: 1.2 }) },
  ignite: { wind: P({ ...BOTH(-0.4, 1.5, -0.2), lean: -0.2, glow: 0.6, flame: 1 }), strike: P({ ...BOTH(-0.2, 1.75, 0), lean: -0.3, glow: 1.6, flame: 2 }) },
  meteor: { wind: P({ ...BOTH(-3.0, 0.35, -0.1), lean: -0.35, headX: -0.5, glow: 1, shake: 1, flame: 1 }), strike: P({ ...BOTH(-1.0, 0.4, -0.2), lean: 0.3, headX: 0.2 }) },
  blink: { wind: P({ crouch: 0.4, shrink: 0.7, glow: 1.5 }), strike: P({ shrink: 0.1, glow: 1 }) },
  well: { wind: P({ ...BOTH(-1.5, 0.4, -0.2), lean: 0.1, halo: 2, glow: 0.8 }), strike: P({ ...BOTH(-1.6, 0.2, 0), glow: 1.2, halo: 1.5 }) },
  // The brood mother and the wyrm read these through their own bodies (see poseBrood and poseWyrm).
  bite: { wind: P({ lean: -0.45, fang: 1, abd: 0.2, hop: 0.1 }), strike: P({ lean: 0.5, fang: -0.4, crouch: 0.2 }) },
  spit: { wind: P({ lean: -0.35, abd: 0.6, fang: 0.6 }), strike: P({ lean: 0.25, abd: -0.2, glow: 1 }) },
  leap: { wind: P({ crouch: 0.7, lean: 0.2, abd: 0.3 }), strike: P({ crouch: -0.3, lean: -0.1, air: 1 }) },
  venom: { wind: P({ abd: 1.2, lean: -0.3, glow: 0.5 }), strike: P({ abd: 1.5, lean: -0.1, glow: 1.5 }) },
  // `hold`: the strike pose stays until the simulation ends the move (a burrow lasts until the wyrm comes up).
  burrow: { wind: P({ lean: -0.5, glow: 0.5 }), strike: P({ lean: 1.2, sink: 1 }), hold: true },
  sweep: { wind: P({ lean: -0.3, twist: -0.8, crouch: 0.2 }), strike: P({ turns: 1, lean: 0.2, glow: 0.8 }) },
};
const CHANNELS = ['lean', 'twist', 'crouch', 'hop', 'sink', 'turns', 'shrink', 'glow', 'orb', 'halo', 'prop', 'fang', 'abd', 'run', 'flame', 'shake', 'headX', 'air'];
const zeroArm = { x: 0, z: 0, e: 0 };
// Blends rest → wind-up → strike → rest over a move. `h` is when the blow lands, as a share of the move.
function moveChannels(name, k, h) {
  const pose = POSES[name];
  const out = { armR: { ...zeroArm }, armL: { ...zeroArm } };
  for (const c of CHANNELS) out[c] = 0;
  if (!pose) return out;
  // w: into the wind-up; s: from the wind-up into the strike; r: back to rest after the blow.
  const w = smooth(0, h * 0.85, k),
    s = smooth(h * 0.85, h, k),
    r = pose.hold ? 0 : smooth(h + (1 - h) * 0.25, 1, k),
    mix = (a = 0, b = 0) => (a * w * (1 - s) + b * s) * (1 - r),
    // Arm channels are offsets from the rest pose (z 0.12 open, elbow −0.25).
    armMix = (a, b) => ({
      x: mix(a ? a.x : 0, b ? b.x : 0),
      z: mix(a ? a.z - 0.12 : 0, b ? b.z - 0.12 : 0),
      e: mix(a ? a.e + 0.25 : 0, b ? b.e + 0.25 : 0),
    });
  for (const c of CHANNELS) out[c] = mix(pose.wind[c], pose.strike[c]);
  // Spins keep going through the strike and never unwind (whole turns end where they began).
  const s2 = smooth(h * 0.85, 1, k);
  out.turns = (pose.wind.turns || 0) * w * (1 - s2) + (pose.strike.turns || 0) * s2;
  out.armR = armMix(pose.wind.armR, pose.strike.armR);
  out.armL = armMix(pose.wind.armL, pose.strike.armL);
  return out;
}
function moveOf(kind, anim) {
  const m = MOVES[kind];
  if (!m) return null;
  if (m.melee.id === anim) return m.melee;
  if (m.shot.id === anim) return m.shot;
  return m.specials.find((s) => s.id === anim) || null;
}
// Procedural animation. `t` is the view clock, `state.time` how long the current state (animation) has run.
export function poseBoss(v, anim, t, state) {
  const tt = state.time,
    breathe = Math.sin(t * 1.5),
    move = moveOf(v.kind, anim),
    // 'attack' is the generic blow (kept for old snapshots): it plays the boss's own melee move.
    name = anim === 'attack' ? MOVES[v.kind]?.melee.id || 'smash' : anim,
    m = move || (anim === 'attack' ? MOVES[v.kind]?.melee : null),
    k = m ? clamp01(tt / m.dur) : 0,
    c = m ? moveChannels(name, k, m.at / m.dur) : moveChannels('', 0, 1),
    walk = anim === 'walk',
    running = c.run > 0.2,
    cycle = t * (running ? 11 : 6.5),
    swing = Math.sin(cycle);
  if (anim === 'emerge') {
    // The wyrm bursting out: up from under the ground with an overshoot, maw wide.
    const e = clamp01(tt / 0.45);
    c.sink = 1 - e;
    c.lean = -0.6 * (1 - smooth(0.4, 1.1, tt)) + (1 - e) * 0.8;
    c.glow = 1.5 * (1 - smooth(0.3, 1.1, tt));
    c.fang = 1 - smooth(0.4, 1, tt);
  }
  if (anim === 'confused') {
    c.headX = 0.2;
    c.armR.x = c.armL.x = 0.1;
  }
  // Recoil when hit is handled by the view's flash; here: the body.
  if (v.spider) poseBrood(v, anim, t, tt, c, walk);
  else if (v.wyrm) poseWyrm(v, anim, t, tt, c, walk);
  else poseBiped(v, anim, t, c, walk, running, swing, breathe);
  // Shared parts.
  const orbR = 1 + c.orb,
    spinUp = 1 + Math.abs(c.orb) * 1.5 + c.glow * 0.3;
  if (v.orbs)
    v.orbs.children.forEach((o, i) => {
      const a = t * 1.8 * spinUp + o.userData.phase;
      o.position.set(Math.cos(a) * 1.1 * orbR, Math.sin(t * 2 + i) * 0.22 - c.crouch * 0.5, Math.sin(a) * 1.1 * orbR);
      o.children[0].rotation.set(t * 2 + i, t * 1.3, 0);
    });
  if (v.shards)
    v.shards.children.forEach((s) => {
      const a = t * (1.1 + s.userData.level * 0.2) * spinUp + s.userData.phase,
        r = s.userData.radius * orbR;
      s.position.set(Math.cos(a) * r, s.userData.level + Math.sin(a * 1.7) * 0.2, Math.sin(a) * r);
      s.rotation.set(a * 1.4, a, a * 0.7);
    });
  if (v.crown) v.crown.rotation.y = t * (0.8 + c.halo * 2);
  if (v.halo) {
    v.halo.rotation.z = t * (0.8 + c.halo * 2.5);
    v.halo.scale.setScalar(1 + c.halo * 0.18);
  }
  if (v.arcs) v.arcs.rotation.set(t * 1.3, t * 0.9, t * 0.5);
  if (v.core) v.core.scale.setScalar(1 + Math.sin(t * 3) * 0.06 + c.glow * 0.15);
  if (v.prop) v.prop.visible = c.prop > 0.35;
  v.glowBoost = Math.max(0, c.glow);
  v.flameBoost = c.flame;
  // Rig: hop, sink into the ground, spins, shrink (blink), shake (meteor call).
  const h = bossHeight(v.kind),
    sink = c.sink * h * 1.05;
  v.rig.rotation.y = c.turns * Math.PI * 2;
  v.rig.scale.setScalar(v.scale * (1 - c.shrink * 0.6));
  v.rig.position.x = c.shake ? Math.sin(t * 40) * 0.04 * c.shake : 0;
  v.rig.position.y = v.rigY + c.hop * 0.9 - sink - (v.walker ? 0 : 0);
  // Death: every body falls its own way.
  if (anim === 'death') {
    const d = clamp01(tt / 1.6);
    if (v.spider) {
      v.rig.rotation.z = d * 0.35;
      v.rig.position.y = v.rigY - d * 0.9;
    } else if (v.wyrm) {
      v.rig.rotation.z = d * 1.35;
      v.rig.position.y = v.rigY - d * 1.4;
    } else {
      v.rig.rotation.x = d * (v.walker ? 1.45 : 1.1);
      v.rig.position.y = v.rigY - d * (v.walker ? 1.2 : 1.8);
    }
  } else {
    v.rig.rotation.x = 0;
    v.rig.rotation.z = 0;
  }
}
function poseBiped(v, anim, t, c, walk, running, swing, breathe) {
  const rest = v.rest,
    lean = c.lean + (walk ? 0.09 : 0) + (running ? 0.2 : 0);
  if (anim === 'confused') v.head.rotation.y = Math.sin(t * 7) * 0.5;
  else v.head.rotation.y = Math.sin(t * 0.8) * 0.12;
  v.head.rotation.x = rest.head + breathe * 0.05 + lean * 0.3 + c.headX;
  v.body.rotation.x = lean;
  v.body.position.y = v.baseY + (v.walker ? breathe * 0.035 - c.crouch * 0.35 : Math.sin(t * 1.2) * 0.12 - c.crouch * 0.3);
  v.chest.rotation.x = rest.chest;
  v.chest.rotation.y = (walk || running ? swing * 0.12 : 0) + c.twist;
  const armSwing = walk || running ? -swing * (running ? 0.8 : 0.5) : 0;
  v.arms.forEach((a, i) => {
    const ch = i === 0 ? c.armR : c.armL,
      r = rest.arms[i];
    a.shoulder.rotation.x = r.x + armSwing * a.side + ch.x;
    a.shoulder.rotation.z = a.side * (0.12 + ch.z) + (v.walker ? 0 : Math.sin(t * 1.3 + a.side) * 0.06);
    a.elbow.rotation.x = -0.25 + ch.e + (anim === 'idle' ? breathe * 0.05 : 0);
  });
  const legPhase = walk || running ? swing * (running ? 0.9 : 0.62) : 0;
  for (const l of v.legs) {
    const dir = l.side,
      bend = Math.max(0, c.crouch);
    l.hip.rotation.x = legPhase * dir - bend * 0.8 - lean * 0.5;
    l.knee.rotation.x = Math.max(0, -legPhase * dir) * 0.9 + bend * 1.4;
    l.ankle.rotation.x = -l.hip.rotation.x * 0.3 - bend * 0.5;
  }
}
// The brood mother: a tetrapod gait (two sets of four legs alternate), the abdomen pulses, fangs work.
function poseBrood(v, anim, t, tt, c, walk) {
  const rest = v.rest,
    gait = t * (walk ? 9 : 0),
    air = c.air > 0.2,
    tuck = anim === 'death' ? clamp01(tt / 1.2) : 0;
  v.body.position.y = v.baseY + Math.sin(t * 2) * 0.02 - c.crouch * 0.45 + (walk ? Math.abs(Math.sin(gait)) * 0.04 : 0);
  v.body.rotation.x = c.lean * 0.5;
  v.chest.rotation.x = c.lean * 0.3;
  v.head.rotation.y = anim === 'confused' ? Math.sin(t * 7) * 0.4 : Math.sin(t * 0.7) * 0.08;
  v.abdomen.rotation.x = rest.abdomen - c.abd * 0.5 + Math.sin(t * 1.6) * 0.03;
  v.fangs.forEach((f, i) => (f.rotation.x = rest.fangs[i] + c.fang * 0.5 + Math.sin(t * 5 + i) * 0.03));
  v.arms.forEach((a, i) => {
    const r = rest.arms[i];
    a.shoulder.rotation.x = r.x - 0.9 + Math.sin(t * 3 + i * 2) * 0.12 - c.fang * 0.4;
    a.shoulder.rotation.z = a.side * 0.2;
    a.elbow.rotation.x = -0.6;
  });
  v.legs.forEach((l, i) => {
    const r = rest.legs[i],
      ph = l.phase ? Math.PI : 0,
      step = walk ? Math.sin(gait + ph) : 0,
      lift = walk ? Math.max(0, Math.cos(gait + ph)) * 0.35 : 0,
      twitch = !walk ? Math.sin(t * 3 + i) * 0.03 : 0;
    // Yaw swings the leg forward and back; the femur lifts; crouching spreads the legs and lowers the body.
    l.hip.rotation.y = r.hy + step * 0.28 * l.side;
    l.knee.rotation.z = r.kz - lift + c.crouch * 0.35 + twitch + (air ? 0.5 : 0) - tuck * 0.9;
    l.ankle.rotation.z = r.az + lift * 0.5 - c.crouch * 0.4 + (air ? -0.4 : 0) - tuck * 0.8;
  });
}
// The wyrm: an undulating column of segments; the head tracks, the tusks work, it sinks and bursts out.
function poseWyrm(v, anim, t, tt, c, walk) {
  const n = v.segments.length,
    sway = walk ? 1 : 0.35;
  v.segments.forEach((s, i) => {
    const k = i / (n - 1);
    s.rotation.z = Math.sin(t * 2.2 - i * 0.7) * 0.07 * sway + c.twist * 0.25 * k;
    s.rotation.x = v.rest.segs[i] + Math.sin(t * 1.4 - i * 0.6) * 0.04 * sway + c.lean * 0.2 * (0.3 + k) - c.crouch * 0.15;
  });
  v.head.rotation.x = v.rest.head + c.lean * 0.35 + c.headX;
  v.head.rotation.y = anim === 'confused' ? Math.sin(t * 7) * 0.4 : Math.sin(t * 0.6) * 0.15;
  v.arms.forEach((a, i) => {
    // Tusks close on a bite and flare while the maw opens.
    a.elbow.rotation.z = a.side * (0.15 + c.fang * 0.35 + Math.sin(t * 2 + i) * 0.03);
  });
  if (v.base) v.base.visible = c.sink < 0.95;
}
