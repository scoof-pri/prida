// NOTE (0.27.1): the game draws the toon soldiers again (assets.js character, render.js person). This module still
// provides stanceOf, KITS and operatorStyle (first-person glove colours); the operator bodies below need the op-*.glb
// files, which scripts/prepare-operators.mjs rebuilds from the Quaternius packs if the operators ever come back.
// Combat operators (0.22): Quaternius' Universal Base Characters bodies (CC0) dressed as soldiers in code. The body
// keeps its skin only on the face; everything else is a combat uniform drawn by the shader (camouflage from 3D noise
// in bind-pose space, so it never swims or breaks at UV seams), gloves and boots; helmet, plate carrier, pouches,
// belt, holster, knee pads and boots are built from primitives around the measured body and skinned rigidly to
// their bones, merged into the same mesh — one draw call per character.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { restPose, retargetClip } from './retarget.js';

export const OPERATOR_FILES = ['op-male', 'op-female', 'op-anims'];

// The game's animation names (render.js) and the library clips that play them.
export const CLIP_NAMES = {
  Idle: 'Idle_Loop',
  Idle_Shoot: 'Idle_Loop',
  Walk: 'Walk_Loop',
  Walk_Shoot: 'Walk_Loop',
  Run_Gun: 'Jog_Fwd_Loop',
  Run_Shoot: 'Jog_Fwd_Loop',
  Sprint: 'Sprint_Loop',
  Jump_Idle: 'Jump_Loop',
  Jump_Land: 'Jump_Land',
  Death: 'Death01',
  HitReact: 'Hit_Chest',
  Punch: 'Punch_Cross',
  Slash: 'Sword_Attack',
  Heal: 'Fixing_Kneeling',
  Duck: 'Crouch_Idle_Loop',
  Crouch_Walk: 'Crouch_Fwd_Loop',
  Dance: 'Dance_Loop',
  Robot: 'Walk_Formal_Loop',
  Yes: 'Yes',
  No: 'Idle_No_Loop',
  FoldArms: 'Idle_FoldArms_Loop',
  Throw: 'OverhandThrow',
  Loot: 'Chest_Open',
  Knockback: 'Hit_Knockback',
  Sit: 'Sitting_Idle_Loop',
  Talk: 'Idle_Talking_Loop',
  Roll: 'Roll',
  PistolAim: 'Pistol_Aim_Neutral',
  Jab: 'Punch_Jab',
  // 0.27: drinking and using items, the take-off of a jump, a hit to the head.
  Drink: 'Consume',
  Use: 'Interact',
  Jump_Start: 'Jump_Start',
  HitHead: 'Hit_Head',
};

// Looks: camouflage colours (four layers, darkest last), plain suits, and the colours of the kit.
export const KITS = {
  ranger: {
    body: 'op-male',
    camo: [0x5b5e3a, 0x6f5b3e, 0x3b4230, 0x24261e],
    kit: 0x4f5436,
    kit2: 0x3e412c,
    glove: 0x2a2b27,
    boot: 0x3b3026,
    helmet: 'helmet',
  },
  hazmat: {
    body: 'op-male',
    plain: 0xb39a45,
    kit: 0x2f3330,
    kit2: 0x262826,
    glove: 0x1f2320,
    boot: 0x1f2320,
    helmet: 'gasmask',
    hood: true,
  },
  outrider: {
    body: 'op-female',
    camo: [0x6d7078, 0x8a8c90, 0x4a4d53, 0x2c2e33],
    kit: 0x3b3f45,
    kit2: 0x2d3035,
    glove: 0x26272a,
    boot: 0x2a2724,
    helmet: 'cap',
  },
};
export const KIT_ORDER = ['ranger', 'hazmat', 'outrider'];

// Bot uniform tints (simulation.js hands each bot one) and operator skin colours become camouflage schemes: the
// colour, a browner darker shade, a deeper shade and a near-black.
// Desert, urban grey, navy, woodland, olive drab, winter, black, coyote brown.
export const TINT_BASES = [0xb8a276, 0x7b8790, 0x40506a, 0x6f8246, 0x5f5d3c, 0xb9bdb5, 0x3a3a3e, 0x7a6446];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export function camoFrom(hex) {
  const hsl = {};
  new T.Color(hex).getHSL(hsl, T.SRGBColorSpace);
  const at = (dl, ds = 0, dh = 0) =>
    new T.Color().setHSL((hsl.h + dh + 1) % 1, clamp01(hsl.s + ds), clamp01(hsl.l + dl), T.SRGBColorSpace).getHex(T.SRGBColorSpace);
  return [at(0), at(-0.09, -0.04, 0.035), at(-0.17, 0, -0.02), at(-0.3, -0.12)];
}
// The kit and colours for a character: operator model index (cosmetics.js), the skin colour of the operator item,
// and the bot tint.
export function operatorStyle(model = 0, skin = null, tint) {
  const kit = KIT_ORDER[((model % 3) + 3) % 3],
    look = {},
    base = Number.isInteger(tint) ? TINT_BASES[((tint % TINT_BASES.length) + TINT_BASES.length) % TINT_BASES.length] : skin ? new T.Color(skin).getHex() : null;
  if (base !== null) {
    // A rubber suit takes the colour a little muted; everyone else wears it as camouflage.
    if (kit === 'hazmat') look.plain = new T.Color(base).lerp(new T.Color(0x6b6b5e), 0.25).getHex();
    else look.camo = camoFrom(base);
  }
  return { kit, look, scale: kit === 'outrider' ? 0.98 : 0.95 };
}

const bodies = new Map(); // name → { gltf, rest, clips, geometry cache }
let animSource = null;

// Called once the three GLBs are loaded (assets.js): retargets every clip onto both bodies.
export function prepareOperators(get) {
  const anims = get('op-anims');
  animSource = restPose(anims.scene);
  for (const name of ['op-male', 'op-female']) {
    const gltf = get(name);
    if (!gltf) continue;
    const rest = restPose(gltf.scene),
      clips = [];
    const seen = new Map();
    for (const [game, lib] of Object.entries(CLIP_NAMES)) {
      const clip = anims.animations.find((c) => c.name === lib);
      if (!clip) continue;
      if (!seen.has(lib)) seen.set(lib, retargetClip(clip, animSource, rest, lib));
      const done = seen.get(lib).clone();
      done.name = game;
      clips.push(done);
    }
    bodies.set(name, { gltf, rest, clips, built: new Map(), hold: calibrate(gltf, clips) });
  }
}
export const operatorsReady = () => bodies.size > 0;

// ——— Measuring the body ———
function measure(mesh) {
  const g = mesh.geometry,
    pos = g.attributes.position,
    si = g.attributes.skinIndex,
    sw = g.attributes.skinWeight,
    bones = mesh.skeleton.bones,
    names = bones.map((b) => b.name),
    at = (n) => new T.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[names.indexOf(n)].clone().invert()),
    dom = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let best = 0,
      w = -1;
    for (let k = 0; k < 4; k++)
      if (sw.getComponent(i, k) > w) {
        w = sw.getComponent(i, k);
        best = si.getComponent(i, k);
      }
    dom[i] = names[best];
  }
  const torso = new Set(['spine_01', 'spine_02', 'spine_03', 'pelvis', 'clavicle_l', 'clavicle_r', 'neck_01']);
  const band = (lo, hi) => {
    const b = { x0: 0, x1: 0, z0: 0, z1: 0 };
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < lo || y > hi || !torso.has(dom[i]) || Math.abs(pos.getX(i)) > 0.3) continue;
      b.x0 = Math.min(b.x0, pos.getX(i));
      b.x1 = Math.max(b.x1, pos.getX(i));
      b.z0 = Math.min(b.z0, pos.getZ(i));
      b.z1 = Math.max(b.z1, pos.getZ(i));
    }
    return b;
  };
  const head = { y1: 0, z0: 0, z1: 0, x1: 0 };
  for (let i = 0; i < pos.count; i++)
    if (dom[i] === 'Head') {
      head.y1 = Math.max(head.y1, pos.getY(i));
      head.z0 = Math.min(head.z0, pos.getZ(i));
      head.z1 = Math.max(head.z1, pos.getZ(i));
      head.x1 = Math.max(head.x1, Math.abs(pos.getX(i)));
    }
  return { names, dom, at, band, head, height: head.y1 };
}

// ——— Regions of the body, per vertex: 0 skin, 1 uniform, 2 gloves, 3 boots (4 = gear, added below) ———
const GLOVE_BONES = /^(hand|index|middle|ring|pinky|thumb)_/;
function regions(mesh, m, kit) {
  const pos = mesh.geometry.attributes.position,
    region = new Float32Array(pos.count),
    collar = m.at('neck_01').y + 0.035,
    bootTop = m.at('calf_r').y * 0.42;
  for (let i = 0; i < pos.count; i++) {
    const d = m.dom[i],
      y = pos.getY(i);
    if (GLOVE_BONES.test(d)) region[i] = 2;
    else if (y < bootTop) region[i] = 3;
    else if ((d === 'Head' || d === 'neck_01') && y > collar && !kit.hood) region[i] = 0;
    else region[i] = 1;
  }
  return region;
}

// ——— Gear, in bind-pose model space (metres, facing +Z, the character's right is −X) ———
// Slots: 1 kit colour, 2 kit secondary, 3 black polymer, 4 metal, 5 lens, 6 rubber/boot.
function gearParts(m, kit, female) {
  const parts = [],
    add = (geo, bone, slot, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      geo.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz)));
      parts.push({ geo, bone, slot });
    },
    // Big plates get a bevel; pouches and straps are plain boxes (a character is drawn two dozen times a frame).
    box = (w, h, d, r = 0.012) =>
      w * h > 0.03 || h * d > 0.03 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)) : new T.BoxGeometry(w, h, d);
  const chest = m.band(m.at('spine_03').y - 0.1, m.at('spine_03').y + 0.1),
    belly = m.band(m.at('spine_01').y - 0.02, m.at('spine_02').y),
    waist = m.band(m.at('pelvis').y + 0.02, m.at('pelvis').y + 0.1),
    s3 = m.at('spine_03'),
    head = m.at('Head'),
    top = m.head.y1,
    headZ = (m.head.z0 + m.head.z1) / 2;
  // Plate carrier: front and back plates, cummerbund round the sides, shoulder straps.
  const vw = (chest.x1 - chest.x0) * (female ? 0.86 : 0.8),
    vy = s3.y - 0.04,
    vh = female ? 0.3 : 0.34,
    front = chest.z1 + 0.025,
    back = chest.z0 - 0.02;
  add(box(vw, vh, 0.055, 0.02), 'spine_03', 1, 0, vy, front - 0.012);
  add(box(vw * 0.98, vh * 1.02, 0.05, 0.02), 'spine_03', 1, 0, vy + 0.01, back + 0.01);
  for (const sx of [-1, 1]) {
    add(box(0.05, vh * 0.55, (front - back) * 0.9, 0.012), 'spine_02', 2, sx * (vw / 2 + 0.005), vy - vh * 0.18, (front + back) / 2);
    add(box(0.07, 0.03, front - back + 0.02, 0.01), 'spine_03', 1, sx * vw * 0.3, vy + vh / 2 + 0.018, (front + back) / 2);
  }
  // Three magazine pouches, an admin pouch above them, a radio with its antenna on the left, a tourniquet.
  for (let i = -1; i <= 1; i++) {
    add(box(0.07, 0.12, 0.045, 0.01), 'spine_03', 2, i * 0.078, vy - vh * 0.22, front + 0.03);
    add(box(0.072, 0.03, 0.05, 0.008), 'spine_03', 1, i * 0.078, vy - vh * 0.22 + 0.065, front + 0.032);
  }
  add(box(0.16, 0.07, 0.03, 0.01), 'spine_03', 2, 0, vy + vh * 0.2, front + 0.02);
  add(box(0.06, 0.12, 0.05, 0.01), 'spine_03', 3, vw / 2 - 0.01, vy + 0.02, back + 0.02);
  add(new T.CylinderGeometry(0.004, 0.004, 0.32, 5), 'spine_03', 3, vw / 2 - 0.01, vy + 0.24, back + 0.02);
  add(box(0.035, 0.09, 0.035, 0.01), 'spine_03', 3, -vw / 2 + 0.03, vy + vh * 0.3, front + 0.01);
  // Assault pack on the back.
  add(box(vw * 0.72, 0.3, 0.1, 0.03), 'spine_03', 2, 0, vy - 0.02, back - 0.055);
  // Belt with pouches; a thigh holster on the right.
  const bw = waist.x1 - waist.x0 + 0.02,
    bz0 = Math.min(waist.z0, belly.z0) - 0.012,
    bz1 = Math.max(waist.z1, belly.z1) * 0.95 + 0.012,
    by = m.at('pelvis').y + 0.06;
  add(box(bw, 0.05, bz1 - bz0, 0.02), 'pelvis', 2, 0, by, (bz0 + bz1) / 2);
  add(box(0.05, 0.035, 0.012, 0.004), 'pelvis', 4, 0, by, bz1 + 0.004);
  for (const [x, z] of [[-bw * 0.42, bz1 - 0.03], [bw * 0.42, bz1 - 0.03], [bw * 0.3, bz0 + 0.02]])
    add(box(0.06, 0.08, 0.045, 0.01), 'pelvis', 1, x, by - 0.03, z + Math.sign(z) * 0.02);
  const th = m.at('thigh_r');
  add(box(0.05, 0.16, 0.1, 0.012), 'thigh_r', 3, th.x - 0.075, th.y - 0.2, th.z + 0.02);
  add(box(0.045, 0.02, 0.1, 0.006), 'thigh_r', 2, th.x - 0.06, th.y - 0.3, th.z + 0.02);
  // Knee pads over each knee.
  for (const side of ['l', 'r']) {
    const k = m.at('calf_' + side);
    add(box(0.1, 0.11, 0.04, 0.02), 'calf_' + side, 3, k.x, k.y - 0.01, k.z + 0.075);
  }
  // Boots: a shoe round the foot on a thick sole, and a laced upper round the ankle.
  for (const side of ['l', 'r']) {
    const f = m.at('foot_' + side),
      b = m.at('ball_' + side),
      mid = (f.z + b.z) / 2 + 0.012;
    add(box(0.108, 0.075, 0.27, 0.03), 'foot_' + side, 6, f.x, 0.045, mid);
    add(box(0.114, 0.022, 0.28, 0.008), 'foot_' + side, 3, f.x, 0.011, mid + 0.002);
    add(new T.CylinderGeometry(0.056, 0.06, 0.15, 12), 'calf_' + side, 6, f.x, 0.135, f.z - 0.012);
    add(box(0.04, 0.1, 0.012, 0.004), 'calf_' + side, 3, f.x, 0.13, f.z + 0.046);
  }
  // Collar, cargo pockets and elbow pads.
  const neck = m.at('neck_01');
  add(new T.TorusGeometry(female ? 0.058 : 0.07, 0.02, 6, 16), 'neck_01', 'cloth', 0, neck.y - 0.015, neck.z + 0.01, Math.PI / 2 - 0.25);
  for (const sx of [-1, 1]) {
    const t = m.at(sx < 0 ? 'thigh_r' : 'thigh_l');
    add(box(0.035, 0.14, 0.13, 0.015), sx < 0 ? 'thigh_r' : 'thigh_l', 'cloth', t.x + sx * (female ? 0.07 : 0.075), t.y - 0.3, t.z - 0.005);
    const e = m.at(sx < 0 ? 'lowerarm_r' : 'lowerarm_l');
    add(box(0.075, 0.07, 0.03, 0.012), sx < 0 ? 'lowerarm_r' : 'lowerarm_l', 3, e.x, e.y + 0.005, e.z - 0.045);
  }
  // Headgear.
  const hr = Math.max(m.head.x1, (m.head.z1 - m.head.z0) / 2);
  if (kit.helmet === 'helmet') {
    const shell = new T.SphereGeometry(hr + 0.03, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    add(shell, 'Head', 1, 0, top - hr - 0.005, headZ - 0.005, 0, 0, 0, 1, 0.92, 1.08);
    add(box(0.07, 0.035, 0.03, 0.008), 'Head', 3, 0, top - 0.04, headZ + hr + 0.02, -0.5);
    for (const sx of [-1, 1]) add(box(0.015, 0.03, 0.12, 0.005), 'Head', 3, sx * (hr + 0.03), top - hr * 0.72, headZ);
    add(new T.TorusGeometry(hr + 0.025, 0.012, 5, 20, Math.PI), 'Head', 1, 0, top - hr * 0.98, headZ - 0.005, Math.PI / 2, 0, 0, 1, 1.12, 1);
    // Goggles pushed up on the front of the helmet.
    add(box(0.15, 0.04, 0.03, 0.012), 'Head', 5, 0, top - hr * 0.28, headZ + hr * 0.85 + 0.025, -0.75);
  } else if (kit.helmet === 'gasmask') {
    // A hood of the suit, a full rubber face-piece with two round lenses and a filter canister at the mouth.
    const eyeY = top - hr * 1.02,
      faceZ = headZ + hr * 0.25;
    add(new T.SphereGeometry(hr + 0.03, 18, 12), 'Head', 'cloth', 0, top - hr - 0.015, headZ - 0.015, 0, 0, 0, 1.04, 1.12, 1.07);
    add(new T.SphereGeometry(hr * 0.95, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), 'Head', 3, 0, eyeY - 0.035, faceZ, Math.PI / 2, 0, 0, 1.02, 1.28, 0.95);
    for (const sx of [-1, 1]) {
      add(new T.CylinderGeometry(0.031, 0.031, 0.024, 16), 'Head', 3, sx * 0.037, eyeY + 0.004, faceZ + hr * 0.84, Math.PI / 2 - 0.1);
      add(new T.CylinderGeometry(0.025, 0.025, 0.026, 16), 'Head', 5, sx * 0.037, eyeY + 0.004, faceZ + hr * 0.845, Math.PI / 2 - 0.1);
    }
    add(new T.CylinderGeometry(0.036, 0.04, 0.055, 14), 'Head', 6, 0, eyeY - 0.085, faceZ + hr * 1.02, Math.PI / 2 - 0.35);
    add(new T.CylinderGeometry(0.041, 0.041, 0.012, 14), 'Head', 3, 0, eyeY - 0.092, faceZ + hr * 1.26, Math.PI / 2 - 0.35);
  } else if (kit.helmet === 'cap') {
    // Field cap with a headset.
    add(new T.SphereGeometry(hr + 0.02, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), 'Head', 1, 0, top - hr * 0.9, headZ - 0.008, 0, 0, 0, 1.02, 0.95, 1.08);
    add(box(hr * 1.5, 0.012, 0.085, 0.005), 'Head', 1, 0, top - hr * 0.88, headZ + hr + 0.03, 0.12);
    for (const sx of [-1, 1]) add(new T.CylinderGeometry(0.036, 0.036, 0.035, 14), 'Head', 3, sx * (hr + 0.012), top - hr * 1.12, headZ - 0.01, 0, 0, Math.PI / 2);
    add(new T.TorusGeometry(hr + 0.03, 0.008, 4, 16, Math.PI), 'Head', 3, 0, top - hr * 1.12, headZ - 0.01, 0, Math.PI / 2, 0);
    // Wrap-around shooting glasses, and a ponytail out of the back of the cap.
    add(box(0.13, 0.028, 0.02, 0.01), 'Head', 5, 0, top - hr * 1.05, headZ + hr + 0.008, -0.05);
    if (female) {
      add(new T.SphereGeometry(0.042, 10, 8), 'Head', 7, 0, top - hr * 1.05, headZ - hr - 0.005);
      add(new T.CylinderGeometry(0.03, 0.012, 0.16, 8), 'Head', 7, 0, top - hr * 1.05 - 0.09, headZ - hr - 0.03, -0.25);
    }
  }
  return parts;
}
const SLOT_ROUGH = [0.9, 0.85, 0.8, 0.55, 0.3, 0.12, 0.7, 0.8];
const SLOT_METAL = [0, 0, 0, 0.1, 0.8, 0.3, 0, 0];

// The same value noise as the shader's, in JavaScript: the camouflage is worked out per vertex once, when a kit is
// built, so the fragment shader only blends four colours (cheap on phones).
const fract = (x) => x - Math.floor(x);
function hash3(x, y, z) {
  x = fract(x * 0.3183099 + 0.1) * 17;
  y = fract(y * 0.3183099 + 0.1) * 17;
  z = fract(z * 0.3183099 + 0.1) * 17;
  return fract(x * y * z * (x + y + z));
}
function noise3(x, y, z) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c),
    mix = (a, b, t) => a + (b - a) * t;
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}
const fbm3 = (x, y, z) => noise3(x, y, z) * 0.6 + noise3(x * 2.1 + 7.3, y * 2.1 + 7.3, z * 2.1 + 7.3) * 0.28 + noise3(x * 4.3 + 1.7, y * 4.3 + 1.7, z * 4.3 + 1.7) * 0.12;
// Camouflage layer weights (one-hot) and two shading factors (folds for a pattern, blotches for a plain suit).
export function camoAt(x, y, z) {
  const a = fbm3(x * 5.5, y * 3.2, z * 5.5),
    b = fbm3(x * 6.5 + 11, y * 4 + 11, z * 6.5 + 11),
    d = fbm3(x * 11 + 3, y * 11 + 3, z * 11 + 3),
    layer = d > 0.66 ? 3 : b > 0.58 ? 2 : a > 0.53 ? 1 : 0;
  return { layer, fold: 0.9 + 0.1 * (fbm3(x * 14, y * 30, z * 14) - 0.5) * 2, plain: 0.82 + 0.3 * fbm3(x * 9, y * 9, z * 9) };
}
function camoAttributes(g) {
  const pos = g.attributes.position,
    n = pos.count,
    camo = new Float32Array(n * 4),
    fold = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const c = camoAt(pos.getX(i), pos.getY(i), pos.getZ(i));
    camo[i * 4 + c.layer] = 1;
    fold[i * 2] = c.fold;
    fold[i * 2 + 1] = c.plain;
  }
  g.setAttribute('aCamo', new T.BufferAttribute(camo, 4));
  g.setAttribute('aFold', new T.BufferAttribute(fold, 2));
}

// The merged geometry for one body in one kit: the body with a region per vertex, and the gear skinned to bones.
function buildGeometry(mesh, kit, female) {
  const m = measure(mesh),
    body = mesh.geometry.clone(),
    n = body.attributes.position.count;
  body.setAttribute('aRegion', new T.BufferAttribute(regions(mesh, m, kit), 1));
  body.setAttribute('aSlot', new T.BufferAttribute(new Float32Array(n), 1));
  for (const k of Object.keys(body.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'aRegion', 'aSlot'].includes(k)) body.deleteAttribute(k);
  const pieces = [body];
  for (const p of gearParts(m, kit, female)) {
    const g = p.geo.index ? p.geo : p.geo;
    const c = g.attributes.position.count,
      bone = m.names.indexOf(p.bone),
      si = new Uint16Array(c * 4),
      sw = new Float32Array(c * 4);
    for (let i = 0; i < c; i++) {
      si[i * 4] = Math.max(0, bone);
      sw[i * 4] = 1;
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(c * 2), 2));
    g.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    // Cloth parts (collar, pockets, the hazmat hood) take the uniform's pattern: region 5.
    g.setAttribute('aRegion', new T.BufferAttribute(new Float32Array(c).fill(p.slot === 'cloth' ? 5 : 4), 1));
    g.setAttribute('aSlot', new T.BufferAttribute(new Float32Array(c).fill(p.slot === 'cloth' ? 0 : p.slot), 1));
    pieces.push(g.index ? g : g);
  }
  // Loaded attributes can be interleaved or normalised integers: bring every piece to one plain layout first.
  for (const g of pieces) {
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k],
        size = a.itemSize,
        arr = k === 'skinIndex' ? new Uint16Array(a.count * size) : new Float32Array(a.count * size);
      for (let i = 0; i < a.count; i++) for (let j = 0; j < size; j++) arr[i * size + j] = a.getComponent(i, j);
      g.setAttribute(k, new T.BufferAttribute(arr, size));
    }
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    else g.setIndex(new T.BufferAttribute(Uint32Array.from(g.index.array), 1));
  }
  // Cloth parts are small: their vertices sit in bind space too, so the pattern runs on from the body round them.
  const merged = mergeGeometries(pieces, false);
  camoAttributes(merged);
  merged.computeBoundingSphere();
  return merged;
}

// ——— The uniform material ———
const NOISE = /* glsl */ `
float opHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float opNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(opHash(i), opHash(i + vec3(1,0,0)), f.x), mix(opHash(i + vec3(0,1,0)), opHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(opHash(i + vec3(0,0,1)), opHash(i + vec3(1,0,1)), f.x), mix(opHash(i + vec3(0,1,1)), opHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

const materials = new Map();
export function operatorMaterial(base, kit, look = {}) {
  const key = [base.uuid, kit.id, look.camo?.join(','), look.plain, look.kit, look.skinMap?.uuid].join('|');
  if (materials.has(key)) return materials.get(key);
  const m = base.clone();
  if (look.skinMap) m.map = look.skinMap;
  m.side = T.FrontSide;
  const plain = look.plain ?? (kit.camo ? null : kit.plain),
    camo = (plain !== null ? [plain, plain, plain, plain] : look.camo || kit.camo).map((c) => new T.Color(c));
  const u = {
    opCamo: { value: camo },
    opPlain: { value: plain !== null ? 1 : 0 },
    opGlove: { value: new T.Color(kit.glove) },
    opBoot: { value: new T.Color(kit.boot) },
    opSlots: {
      value: [0x000000, look.kit ?? kit.kit, look.kit2 ?? kit.kit2, 0x1d1f1d, 0x6d6e6a, 0x1c2a30, kit.boot, 0x2b1d14].map((c) => new T.Color(c)),
    },
    opRough: { value: SLOT_ROUGH },
    opMetal: { value: SLOT_METAL },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aRegion; attribute float aSlot; attribute vec4 aCamo; attribute vec2 aFold;
varying float vRegion; varying float vSlot; varying vec3 vBind; varying vec4 vCamo; varying vec2 vFold;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRegion = aRegion; vSlot = aSlot; vBind = position; vCamo = aCamo; vFold = aFold;
// Clothes stand a little off the skin, boots more; the face keeps its shape.
transformed += normal * (aRegion > 3.5 ? 0.0 : aRegion > 2.5 ? 0.012 : aRegion > 1.5 ? 0.004 : aRegion > 0.5 ? 0.011 : 0.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 opCamo[4]; uniform float opPlain; uniform vec3 opGlove; uniform vec3 opBoot; uniform vec3 opSlots[8];
uniform float opRough[8]; uniform float opMetal[8];
varying float vRegion; varying float vSlot; varying vec3 vBind; varying vec4 vCamo; varying vec2 vFold;
${NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float opR = floor(vRegion + 0.5), opS = floor(vSlot + 0.5);
// Gear has no normal map; cloth gear (region 5) is drawn like the uniform.
float opGear = step(3.5, vRegion);
if (opR > 4.5) opR = 1.0;
if (opR > 3.5) {
  diffuseColor.rgb = opSlots[int(opS)];
  // Worn edges and a little grime.
  diffuseColor.rgb *= 0.88 + 0.24 * opNoise(vBind * 60.0);
} else if (opR > 2.5) {
  diffuseColor.rgb = opBoot * (0.85 + 0.3 * opNoise(vBind * 40.0));
} else if (opR > 1.5) {
  diffuseColor.rgb = opGlove * (0.85 + 0.3 * opNoise(vBind * 50.0));
} else if (opR > 0.5) {
  // Camouflage worked out per vertex (camoAt): blend its layers, then the folds and the weave.
  // Sharpened weights: crisp blotch edges between vertices instead of a smear.
  vec4 w = vCamo * vCamo; w *= w; w *= vCamo * vCamo;
  vec3 c = opPlain > 0.5
    ? opCamo[0] * vFold.y
    : (opCamo[0] * w.x + opCamo[1] * w.y + opCamo[2] * w.z + opCamo[3] * w.w) / max(1e-4, dot(w, vec4(1.0))) * vFold.x;
  diffuseColor.rgb = c * (0.93 + 0.12 * opNoise(vBind * 180.0));
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (opR > 3.5) roughnessFactor = opRough[int(opS)];
else if (opR > 2.5) roughnessFactor = 0.6;
else if (opR > 1.5) roughnessFactor = 0.7;
else if (opR > 0.5) roughnessFactor = 0.92;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = opR > 3.5 ? opMetal[int(opS)] : 0.0;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  // Muscles do not show through a uniform, and the gear has no normal map at all.
  mapN.xy *= normalScale * (opGear > 0.5 ? 0.0 : opR > 0.5 ? 0.18 : 1.0);
  normal = normalize( tbn * mapN );
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'operator';
  materials.set(key, m);
  return m;
}

// ——— One character ———
// kitId: 'ranger' | 'hazmat' | 'outrider'; look: { camo, plain, kit, kit2, skin: 'dark'|'light' }.
export function operator(kitId = 'ranger', look = {}) {
  const kit = { id: kitId, ...(KITS[kitId] || KITS.ranger) },
    b = bodies.get(kit.body);
  if (!b) throw Error('Operator bodies not loaded');
  const root = cloneSkeleton(b.gltf.scene);
  let body = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh && /^(Sphere|Superhero|SuperHero)/.test(o.name)) body = o;
  });
  b.measured ??= measure(body);
  if (!b.built.has(kitId)) b.built.set(kitId, buildGeometry(body, kit, kit.body === 'op-female'));
  body.geometry = b.built.get(kitId);
  body.material = operatorMaterial(body.material, kit, look);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      // The hood and the gas mask cover the eyes and brows.
      if (o !== body && kit.hood) o.visible = false;
    }
  });
  const mixer = new T.AnimationMixer(root),
    m = b.measured,
    headZ = (m.head.z0 + m.head.z1) / 2;
  return {
    model: root,
    body,
    mixer,
    clips: b.clips,
    kit,
    hold: b.hold,
    // Every bone is restored before each mixer update (rig-pose.js): arms, spine and fingers are all posed on top.
    posedNames: body.skeleton.bones.map((bone) => bone.name),
    // Bind-pose landmarks for things worn on the body (render.js): top of the headgear, the back, the chest front.
    anchors: {
      head: new T.Vector3(0, m.head.y1 + (kit.helmet === 'helmet' ? 0.035 : 0.025), headZ),
      back: new T.Vector3(0, m.at('spine_03').y + 0.02, m.band(m.at('spine_03').y - 0.1, m.at('spine_03').y + 0.1).z0 - 0.17),
      chest: new T.Vector3(0, m.at('spine_03').y - 0.05, m.band(m.at('spine_03').y - 0.1, m.at('spine_03').y + 0.1).z1 + 0.08),
    },
    female: kit.body === 'op-female',
  };
}

// Body armour on top of the kit (render.js shows the tier the player wears): a light vest adds side plates and a
// collar, a heavy one shoulder pauldrons, a throat guard and a groin flap. Meshes in bind-pose body space, with the
// bone each follows.
export function armorPieces(o, tier, color) {
  const b = bodies.get(o.kit.body),
    m = b.measured,
    mat = new T.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25 }),
    out = [],
    piece = (geo, bone, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      out.push({ mesh, bone });
    },
    chest = m.band(m.at('spine_03').y - 0.1, m.at('spine_03').y + 0.1),
    s3 = m.at('spine_03');
  const box = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(0.012, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  for (const sx of [-1, 1]) piece(box(0.03, 0.2, 0.16), 'spine_02', sx * (chest.x1 + 0.03), s3.y - 0.12, (chest.z0 + chest.z1) / 2);
  const neck = m.at('neck_01');
  piece(new T.TorusGeometry(0.085, 0.022, 6, 16, Math.PI * 1.3), 'neck_01', 0, neck.y - 0.02, neck.z + 0.005, Math.PI / 2 - 0.2, 0, Math.PI * 0.85);
  if (tier === 'heavy') {
    for (const side of ['l', 'r']) {
      const a = m.at('upperarm_' + side);
      piece(new T.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 'upperarm_' + side, a.x + Math.sign(a.x) * 0.03, a.y + 0.02, a.z, 0, 0, -Math.sign(a.x) * 0.4);
    }
    piece(box(0.16, 0.08, 0.04), 'neck_01', 0, neck.y - 0.05, chest.z1 + 0.06);
    const pv = m.at('pelvis'),
      waist = m.band(pv.y - 0.05, pv.y + 0.05);
    piece(box(0.16, 0.16, 0.03), 'pelvis', 0, pv.y - 0.1, waist.z1 + 0.04);
  }
  return out;
}

// ——— Holding weapons ———
// Every firearm is held by two-bone IK: the gun is placed where the stance puts it (stock in the shoulder, pistol at
// arm's length, launcher on the shoulder, minigun at the hip), aimed along the view, and both hands are solved onto
// its grips. How a hand closes round a grip comes from the library's own pistol pose, measured once per body.
const FINGERS = /^(index|middle|ring|pinky|thumb)_0[1-3]_[lr]$/;
const Y = new T.Vector3(0, 1, 0);
function calibrate(gltf, clips) {
  const root = cloneSkeleton(gltf.scene),
    mixer = new T.AnimationMixer(root),
    clip = clips.find((c) => c.name === 'PistolAim');
  if (clip) {
    mixer.clipAction(clip).play();
    mixer.update(0);
  }
  root.updateMatrixWorld(true);
  const bone = (n) => root.getObjectByName(n),
    // The pistol this pose holds points forward (+Z), upright: gun axes X = character's right (−X), Y up, Z back.
    gun = new T.Quaternion().setFromAxisAngle(Y, Math.PI),
    inv = gun.clone().invert(),
    out = { fingers: {}, handInGun: {}, palm: {} };
  for (const side of ['l', 'r']) {
    const hand = bone('hand_' + side),
      q = hand.getWorldQuaternion(new T.Quaternion()),
      p = hand.getWorldPosition(new T.Vector3()),
      mid = bone('middle_01_' + side).getWorldPosition(new T.Vector3()),
      palm = p.clone().lerp(mid, 0.6);
    out.handInGun[side] = inv.clone().multiply(q);
    out.palm[side] = palm.clone().sub(p).applyQuaternion(q.clone().invert());
    out['palmWorld_' + side] = palm;
  }
  // Where the support hand sits relative to the gripping hand on a pistol, in gun space.
  out.pistolSupport = out.palmWorld_l.clone().sub(out.palmWorld_r).applyQuaternion(inv);
  // Closed fists from the boxing guard: the fingers round a grip.
  const fist = clips.find((c) => c.name === 'Jab');
  if (fist) {
    mixer.stopAllAction();
    mixer.clipAction(fist).play();
    mixer.update(0);
  }
  root.traverse((o) => {
    if (FINGERS.test(o.name)) out.fingers[o.name] = o.quaternion.clone();
  });
  mixer.uncacheRoot(root);
  return out;
}

export function stanceOf(w) {
  if (!w) return 'none';
  if (w.fists) return 'fists';
  if (w.consumable) return 'item';
  if (w.melee || w.projectile === 'dagger') return 'blade';
  if (['c4', 'frag', 'flashbang', 'smokegrenade', 'impulse', 'sticky'].includes(w.model)) return 'throw';
  if (w.model === 'rocket') return 'launcher';
  if (w.model === 'minigun') return 'hip';
  if (w.category === 'secondary') return 'pistol';
  return 'rifle';
}

const tmp = {
  a: new T.Vector3(),
  b: new T.Vector3(),
  c: new T.Vector3(),
  e: new T.Vector3(),
  t: new T.Vector3(),
  d: new T.Vector3(),
  q: new T.Quaternion(),
  q2: new T.Quaternion(),
  pq: new T.Quaternion(),
};
// Turns a bone (in world space) so its +Y axis points along dir, keeping as much of its twist as it can.
function aimBone(bone, dir) {
  const world = bone.getWorldQuaternion(tmp.q),
    y = tmp.d.copy(Y).applyQuaternion(world);
  tmp.q2.setFromUnitVectors(y, tmp.e.copy(dir).normalize());
  world.premultiply(tmp.q2);
  setWorldQuaternion(bone, world);
}
function setWorldQuaternion(bone, world) {
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(tmp.pq).invert();
  bone.quaternion.copy(tmp.pq).multiply(world);
  bone.updateMatrixWorld(true);
}
// Two-bone IK: upper arm, forearm, hand. The wrist reaches `target` (as far as the arm allows), the elbow bends
// toward `pole`, the hand takes the world rotation `rot`.
export function solveArm(upper, lower, hand, target, pole, rot) {
  upper.updateWorldMatrix(true, true);
  const A = upper.getWorldPosition(new T.Vector3()),
    B = lower.getWorldPosition(new T.Vector3()),
    C = hand.getWorldPosition(new T.Vector3()),
    la = A.distanceTo(B),
    lb = B.distanceTo(C),
    toT = target.clone().sub(A),
    d = Math.max(Math.abs(la - lb) + 1e-4, Math.min(la + lb - 1e-4, toT.length())),
    dir = toT.normalize(),
    cosA = Math.max(-1, Math.min(1, (la * la + d * d - lb * lb) / (2 * la * d))),
    sinA = Math.sqrt(1 - cosA * cosA),
    side = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (side.lengthSq() < 1e-8) side.set(0, -1, 0);
  side.normalize();
  const E = A.clone().addScaledVector(dir, la * cosA).addScaledVector(side, la * sinA),
    W = A.clone().addScaledVector(dir, d);
  aimBone(upper, E.clone().sub(A));
  aimBone(lower, W.clone().sub(E));
  if (rot) setWorldQuaternion(hand, rot);
}

// Where each stance holds its weapon, relative to the chest (metres at the body's own scale): the gun's rear or
// centre, and the grip points in gun space (x right, y up, z back; the gun is centred, muzzle toward −z).
function gripPoints(stance, len, h) {
  switch (stance) {
    case 'pistol':
      return { grip: [0, -h * 0.35, len * 0.2], support: null };
    case 'launcher':
      return { grip: [0, -h * 0.3, len * 0.1], support: [0, -h * 0.3, -len * 0.2] };
    case 'hip':
      return { grip: [0.02, h * 0.12, len * 0.4], support: [0, h * 0.32, -len * 0.05] };
    default:
      return { grip: [0, -h * 0.3, Math.max(0.05, len * 0.5 - 0.2)], support: [0, -h * 0.16, -len * 0.18] };
  }
}
const up = new T.Vector3(0, 1, 0);
// Poses both arms for the held weapon and places the weapon. `o` is the operator (model, hold), `held` the weapon
// object (a child of the model's parent) with userData.len and userData.h; aim: { pitch, recoil, reload (0–1 or
// −1), sprint, stance }.
export function holdWeapon(o, held, aim) {
  const hold = o.hold,
    root = o.model,
    B = bonesOf(o);
  root.updateMatrixWorld(true);
  const s = root.scale.x,
    wq = root.getWorldQuaternion(new T.Quaternion()),
    // The aim's yaw when the legs point elsewhere (render.js locomotion); else the body's own facing.
    f = aim.yaw !== undefined ? new T.Vector3(Math.sin(aim.yaw), 0, Math.cos(aim.yaw)) : new T.Vector3(0, 0, 1).applyQuaternion(wq).setY(0).normalize(),
    r = f.clone().cross(up).normalize(),
    stance = aim.stance,
    len = held?.userData.len || 0.5,
    h = held?.userData.h || 0.12;
  let pitch = aim.pitch || 0;
  // Sprinting carries the gun low across the chest; a reload tips it down and rolls it over.
  const carry = aim.sprint ? 1 : 0,
    k = aim.reload >= 0 ? Math.sin(Math.PI * Math.min(1, aim.reload)) : 0;
  if (carry) pitch = -0.75;
  pitch -= 0.35 * k;
  let fwd = f.clone();
  if (carry && stance !== 'pistol') fwd.applyAxisAngle(up, 0.65);
  const rr = fwd.clone().cross(up).normalize(),
    d = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)),
    u = rr.clone().cross(d).normalize(),
    basis = new T.Matrix4().makeBasis(rr, u, d.clone().negate()),
    gq = new T.Quaternion().setFromRotationMatrix(basis);
  if (k > 0) gq.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.55 * k));
  const chest = B.spine_03.getWorldPosition(new T.Vector3()),
    recoil = (aim.recoil || 0) * 0.05;
  let center;
  if (stance === 'pistol') center = chest.clone().addScaledVector(up, 0.12 * s).addScaledVector(d, (0.44 - recoil) * s).addScaledVector(r, -0.02 * s);
  else if (stance === 'launcher') center = chest.clone().addScaledVector(r, 0.16 * s).addScaledVector(up, (0.12 + h * 0.2) * s).addScaledVector(d, 0.05 * s);
  else if (stance === 'hip') center = chest.clone().addScaledVector(r, 0.12 * s).addScaledVector(up, -0.2 * s).addScaledVector(d, (0.26 - recoil) * s);
  else {
    // Stock in the right shoulder pocket, sights at eye level.
    const rear = chest.clone().addScaledVector(r, (0.15 - carry * 0.1) * s).addScaledVector(up, (0.16 - carry * 0.08) * s).addScaledVector(f, (0.05 + carry * 0.1) * s);
    center = rear.addScaledVector(d, (len / 2 - 0.03 - recoil) * s);
  }
  const g = gripPoints(stance, len, h),
    at = (p) => center.clone().add(new T.Vector3(...p).multiplyScalar(s).applyQuaternion(gq));
  const handR = gq.clone().multiply(hold.handInGun.r),
    handL = gq.clone().multiply(hold.handInGun.l);
  if (stance === 'rifle' || stance === 'launcher' || stance === 'hip')
    // The support hand under the handguard, palm up.
    handL.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.5));
  const palmR = at(g.grip),
    palmL = g.support ? at(g.support) : palmR.clone().add(hold.pistolSupport.clone().multiplyScalar(s).applyQuaternion(gq));
  if (k > 0.3 && stance !== 'pistol') palmL.lerp(at([0, -h * 0.9, 0]), Math.min(1, (k - 0.3) * 2));
  const wrist = (palm, rot, side) => palm.clone().sub(hold.palm[side].clone().multiplyScalar(s).applyQuaternion(rot));
  solveArm(B.upperarm_r, B.lowerarm_r, B.hand_r, wrist(palmR, handR, 'r'), up.clone().negate().addScaledVector(r, 0.8).addScaledVector(d, -0.3), handR);
  solveArm(B.upperarm_l, B.lowerarm_l, B.hand_l, wrist(palmL, handL, 'l'), up.clone().negate().addScaledVector(r, -0.7).addScaledVector(d, -0.1), handL);
  closeHands(o);
  if (held) placeWorld(held, center, gq);
}
// The bones the hold code moves, looked up once per character.
export function bonesOf(o) {
  return (o.bones ??= Object.fromEntries(
    ['spine_03', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'].map((n) => [n, o.model.getObjectByName(n)]),
  ));
}
// Fingers closed round the grips (from the pistol pose).
export function closeHands(o, sides = /_[lr]$/) {
  o.fingerBones ??= [];
  if (!o.fingerBones.length) o.model.traverse((b) => FINGERS.test(b.name) && o.hold.fingers[b.name] && o.fingerBones.push(b));
  for (const b of o.fingerBones) if (sides.test(b.name)) b.quaternion.copy(o.hold.fingers[b.name]);
}
// A weapon in the right hand, following the animation (blades, grenades, anything in an emote or a death).
export function holdInHand(o, held) {
  const hand = bonesOf(o).hand_r;
  hand.updateWorldMatrix(true, false);
  const s = o.model.scale.x,
    hq = hand.getWorldQuaternion(new T.Quaternion()),
    gq = hq.multiply(o.hold.handInGun.r.clone().invert()),
    palm = o.hold.palm.r.clone().multiplyScalar(s).applyQuaternion(hand.getWorldQuaternion(new T.Quaternion())).add(hand.getWorldPosition(new T.Vector3())),
    grip = new T.Vector3(0, -(held.userData.h || 0.1) * 0.3, held.userData.gripZ ?? (held.userData.len || 0.3) * 0.3).multiplyScalar(s).applyQuaternion(gq);
  closeHands(o, /_r$/);
  placeWorld(held, palm.sub(grip), gq);
}
function placeWorld(obj, pos, quat) {
  const parent = obj.parent;
  parent.updateWorldMatrix(true, false);
  const m = new T.Matrix4().compose(pos, quat, new T.Vector3(1, 1, 1)).premultiply(parent.matrixWorld.clone().invert());
  m.decompose(obj.position, obj.quaternion, obj.scale);
}
