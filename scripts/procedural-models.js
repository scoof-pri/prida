// Game-authored low-poly models in the flat-coloured style of the Quaternius Toon Shooter kit.
// Built with three.js primitives and exported to GLB by scripts/build-weapon-assets.mjs.
// Convention: barrels / blades point toward -X, grips hang toward -Y (same as the toon guns).
import * as T from 'three';

const mats = new Map();
function mat(color, metal = 0.2) {
  const key = color + ':' + metal;
  if (!mats.has(key))
    mats.set(key, new T.MeshStandardMaterial({ color, roughness: 0.7, metalness: metal, flatShading: true }));
  return mats.get(key);
}
const STEEL = 0x9aa1ad,
  DARK = 0x3f434c,
  GUN = 0x5d626d,
  WOOD = 0xa0662e,
  CLOTH = 0x7a2530,
  GOLD = 0xd9a441,
  ORANGE = 0xe0823d,
  FABRIC = 0x3f8f86;

function box(g, w, h, d, color, x = 0, y = 0, z = 0, metal) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(color, metal));
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
function cyl(g, r1, r2, len, color, x = 0, y = 0, z = 0, axis = 'x', seg = 8, metal) {
  const m = new T.Mesh(new T.CylinderGeometry(r1, r2, len, seg), mat(color, metal));
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  g.add(m);
  return m;
}

export function katana() {
  const g = new T.Group();
  g.name = 'Katana';
  // One gently curved blade: spine and edge follow the same arc, tapering to a point.
  const len = 0.82,
    curve = (t) => 0.05 * t * t,
    shape = new T.Shape(),
    n = 8;
  shape.moveTo(-0.06, 0.024);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    shape.lineTo(-0.06 - len * t, curve(t) + 0.024 - t * 0.008);
  }
  shape.lineTo(-0.06 - len - 0.06, curve(1) - 0.02);
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    shape.lineTo(-0.06 - len * t, curve(t) - 0.024 + t * 0.004);
  }
  const blade = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }), mat(STEEL, 0.6));
  blade.position.z = -0.006;
  g.add(blade);
  // Darker spine line for readability.
  const spine = new T.Mesh(
    new T.ExtrudeGeometry(
      (() => {
        const s = new T.Shape();
        s.moveTo(-0.06, 0.024);
        for (let i = 1; i <= n; i++) s.lineTo(-0.06 - len * (i / n), curve(i / n) + 0.024 - (i / n) * 0.008);
        for (let i = n; i >= 0; i--) s.lineTo(-0.06 - len * (i / n), curve(i / n) + 0.012 - (i / n) * 0.006);
        return s;
      })(),
      { depth: 0.014, bevelEnabled: false },
    ),
    mat(0x7d8591, 0.5),
  );
  spine.position.z = -0.007;
  g.add(spine);
  // Guard (tsuba), handle wrap, pommel
  cyl(g, 0.06, 0.06, 0.018, GOLD, -0.05, 0, 0, 'x', 10, 0.5);
  box(g, 0.24, 0.042, 0.034, CLOTH, 0.08, 0, 0);
  for (let i = 0; i < 4; i++) box(g, 0.012, 0.046, 0.038, 0x1c1c22, 0.0 + i * 0.055, 0, 0);
  box(g, 0.025, 0.05, 0.04, GOLD, 0.21, 0, 0, 0.5);
  return g;
}

export function crossbow() {
  const g = new T.Group();
  g.name = 'Crossbow';
  box(g, 0.62, 0.06, 0.07, WOOD, 0, 0, 0); // stock / rail
  box(g, 0.2, 0.1, 0.06, WOOD, 0.26, -0.03, 0); // butt
  box(g, 0.05, 0.13, 0.05, WOOD, 0.08, -0.09, 0); // grip
  box(g, 0.02, 0.05, 0.02, DARK, 0.03, -0.055, 0); // trigger
  // Limbs: angled boxes forming a bow
  for (const s of [-1, 1]) {
    const limb = box(g, 0.045, 0.035, 0.34, DARK, -0.25, 0.01, s * 0.17);
    limb.rotation.y = s * 0.35;
    const cap = box(g, 0.04, 0.04, 0.04, STEEL, -0.2, 0.01, s * 0.33, 0.5);
    cap.rotation.y = s * 0.35;
  }
  // String and loaded bolt
  const string = cyl(g, 0.004, 0.004, 0.64, 0xe7e2cf, -0.12, 0.03, 0, 'z', 4);
  string.scale.y = 1;
  cyl(g, 0.01, 0.01, 0.52, 0x6b4a2a, -0.2, 0.05, 0, 'x', 6);
  const head = new T.Mesh(new T.ConeGeometry(0.02, 0.06, 4), mat(STEEL, 0.6));
  head.rotation.z = Math.PI / 2;
  head.position.set(-0.49, 0.05, 0);
  g.add(head);
  box(g, 0.06, 0.03, 0.002, ORANGE, 0.04, 0.05, 0.012);
  box(g, 0.06, 0.03, 0.002, ORANGE, 0.04, 0.05, -0.012);
  box(g, 0.1, 0.04, 0.04, DARK, 0.1, 0.06, 0); // sight
  return g;
}

export function minigun() {
  const g = new T.Group();
  g.name = 'Minigun';
  box(g, 0.34, 0.2, 0.2, GUN, 0.12, 0, 0, 0.4); // receiver
  box(g, 0.1, 0.16, 0.16, DARK, 0.33, 0, 0); // motor
  box(g, 0.08, 0.16, 0.06, DARK, 0.18, -0.16, 0); // grip
  box(g, 0.2, 0.05, 0.05, DARK, 0.12, 0.14, 0); // carry handle
  box(g, 0.2, 0.18, 0.16, ORANGE, 0.12, -0.1, 0.17); // ammo box
  const barrels = new T.Group();
  barrels.name = 'Barrels';
  barrels.position.set(-0.05, 0, 0);
  g.add(barrels);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cyl(barrels, 0.017, 0.017, 0.62, STEEL, -0.31, Math.cos(a) * 0.055, Math.sin(a) * 0.055, 'x', 6, 0.6);
  }
  cyl(barrels, 0.085, 0.085, 0.035, DARK, -0.1, 0, 0, 'x', 10);
  cyl(barrels, 0.08, 0.08, 0.03, DARK, -0.58, 0, 0, 'x', 10);
  cyl(barrels, 0.03, 0.03, 0.66, DARK, -0.3, 0, 0, 'x', 6);
  return g;
}

export function jetpack() {
  const g = new T.Group();
  g.name = 'Jetpack';
  box(g, 0.1, 0.34, 0.3, DARK, 0, 0.02, 0); // back plate
  for (const s of [-1, 1]) {
    cyl(g, 0.075, 0.075, 0.36, ORANGE, -0.07, 0.04, s * 0.1, 'y', 10, 0.3);
    cyl(g, 0.075, 0.06, 0.04, STEEL, -0.07, 0.24, s * 0.1, 'y', 10, 0.6);
    const nozzle = cyl(g, 0.045, 0.07, 0.09, DARK, -0.07, -0.19, s * 0.1, 'y', 10, 0.5);
    nozzle.name = 'Nozzle';
  }
  box(g, 0.04, 0.06, 0.2, STEEL, -0.07, 0.12, 0, 0.5);
  box(g, 0.02, 0.05, 0.05, 0x7de0ff, -0.13, 0.05, 0);
  return g;
}

export function glider() {
  const g = new T.Group();
  g.name = 'Glider';
  // Delta canopy made from two triangles (double sided), frame bars.
  const shape = new T.BufferGeometry();
  const v = new Float32Array([0, 0, -0.9, -0.9, -0.12, 0.55, 0.9, -0.12, 0.55]);
  shape.setAttribute('position', new T.BufferAttribute(v, 3));
  shape.computeVertexNormals();
  const cloth = new T.MeshStandardMaterial({ color: FABRIC, roughness: 0.9, side: T.DoubleSide, flatShading: true });
  const canopy = new T.Mesh(shape, cloth);
  g.add(canopy);
  const stripe = new T.BufferGeometry();
  stripe.setAttribute(
    'position',
    new T.BufferAttribute(new Float32Array([0, 0.005, -0.9, -0.3, -0.035, 0.1, 0.3, -0.035, 0.1]), 3),
  );
  stripe.computeVertexNormals();
  g.add(new T.Mesh(stripe, new T.MeshStandardMaterial({ color: 0xf2e3b5, roughness: 0.9, side: T.DoubleSide })));
  const bar = (a, b) => {
    const d = new T.Vector3().subVectors(b, a),
      m = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, d.length(), 5), mat(DARK));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    g.add(m);
  };
  const nose = new T.Vector3(0, 0, -0.9),
    l = new T.Vector3(-0.9, -0.12, 0.55),
    r = new T.Vector3(0.9, -0.12, 0.55),
    keel = new T.Vector3(0, -0.02, 0.4),
    hang = new T.Vector3(0, -0.55, 0.05);
  bar(nose, l);
  bar(nose, r);
  bar(l, r);
  bar(nose, keel);
  bar(new T.Vector3(-0.25, -0.55, 0.05), new T.Vector3(0.25, -0.55, 0.05));
  bar(new T.Vector3(-0.25, -0.55, 0.05), new T.Vector3(0, -0.02, -0.1));
  bar(new T.Vector3(0.25, -0.55, 0.05), new T.Vector3(0, -0.02, -0.1));
  g.userData.hang = hang;
  return g;
}

export const PROCEDURAL = { katana, crossbow, minigun, jetpack, glider };
