// The first-person weapon: gloved hands, the muzzle flash and its light, and the animations — footstep bob,
// sway when you turn, the sprint carry, recoil, melee swings, weapon switches and reloads where the magazine
// really leaves the weapon: it drops out of view, a fresh one comes up in your other hand, clicks home and the
// weapon is charged. Shotguns are fed shell by shell, revolvers dump their cases and take a speed-loader, launchers
// and the crossbow are loaded from behind, and thrown weapons are drawn fresh from the belt.
import * as T from 'three';
import { WEAPONS } from './world.js';
import { RARITIES } from './catalog.js';
import { objectSurface } from './materials.js';

export const RELOAD_STYLE = {
  shotgun: 'shells',
  revolver: 'cylinder',
  handcannon: 'cylinder',
  rocket: 'tube',
  grenadelauncher: 'shells',
  crossbow: 'tube',
  dagger: 'draw',
  c4: 'draw',
  frag: 'draw',
  flashbang: 'draw',
  smokegrenade: 'draw',
  impulse: 'draw',
  sticky: 'draw',
};
export const reloadStyle = (w) => RELOAD_STYLE[w.model] || (w.melee || w.consumable ? 'none' : 'mag');
const GLOVE = 0x2f332b,
  KNUCKLE = 0x3d4236,
  SLEEVE = 0x4d5a47,
  CUFF = 0x39433a,
  MAG = 0x34383d,
  BRASS = 0xd8a44c,
  SHELL = 0xb8302a;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bell = (a, b, x) => Math.sin(Math.PI * clamp01((x - a) / (b - a)));

function part(view, parent, x, y, z, w, h, d, color) {
  const m = view.box(x, y, z, w, h, d, color, parent);
  m.castShadow = m.receiveShadow = false;
  return m;
}
// The hands' materials are shared by every first-person weapon and recoloured to the operator's kit (render.js
// setCosmetics): gloves, knuckle guards, and sleeves in the uniform's colours.
export function viewHandMaterials(view) {
  // Woven cloth for the gloves, cuffs and sleeves, moulded hard plastic for the knuckle guards (object space).
  const cloth = (color, roughness) => objectSurface(new T.MeshStandardMaterial({ color, roughness }), { surface: 'fabric', size: 0.09, strength: 0.7, normal: 1 });
  return (view.fpHandMats ??= {
    glove: cloth(GLOVE, 0.75),
    knuckle: objectSurface(new T.MeshStandardMaterial({ color: KNUCKLE, roughness: 0.55 }), { surface: 'gunmetal', size: 0.06, strength: 0.4, normal: 0.8 }),
    cuff: cloth(CUFF, 0.9),
    sleeve: cloth(SLEEVE, 0.92),
  });
}
// A gloved hand: palm, fingers wrapped round, knuckle guard; and the sleeve cuff behind it.
function hand(view, parent, x, y, z, s = 1) {
  const g = new T.Group(),
    M = viewHandMaterials(view);
  g.position.set(x, y, z);
  parent.add(g);
  part(view, g, 0, 0, 0, 0.095 * s, 0.11 * s, 0.2 * s, M.glove);
  part(view, g, 0.012 * s, 0.035 * s, -0.035 * s, 0.07 * s, 0.05 * s, 0.1 * s, M.knuckle);
  part(view, g, 0.01 * s, -0.01 * s, 0.13 * s, 0.12 * s, 0.13 * s, 0.1 * s, M.cuff);
  part(view, g, 0.02 * s, -0.02 * s, 0.25 * s, 0.13 * s, 0.14 * s, 0.2 * s, M.sleeve);
  return g;
}
// Hands, the flash and the magazine well for one weapon in the first-person scene.
export function dressViewWeapon(view, g, w) {
  const len = g.userData.length;
  // Bare hands: two fists up in a guard, knuckles forward.
  if (w.fists) {
    const r = hand(view, g, -0.04, 0.0, 0.02, 1.05),
      l = hand(view, g, -0.4, 0.03, 0.06, 1.05);
    r.rotation.set(0.25, 0.1, 0.35);
    l.rotation.set(0.25, -0.1, -0.35);
    g.userData.fists = { r, l, rBase: r.position.clone(), lBase: l.position.clone() };
    g.userData.flash = null;
    g.userData.magSlot = new T.Vector3();
    return;
  }
  // Items sit in the right hand, which holds them from below.
  if (w.consumable) {
    const box = new T.Box3().setFromObject(g),
      low = box.min.y;
    g.userData.grip = hand(view, g, 0.03, low - 0.02, 0.07, 0.85);
    g.userData.grip.rotation.x = -0.25;
    g.userData.flash = null;
    g.userData.magSlot = new T.Vector3();
    return;
  }
  if (g.userData.pivot) {
    // A fist round the grip of the blade.
    hand(view, g, 0.0, -0.01, 0.06, 0.8);
  } else {
    g.userData.grip = hand(view, g, 0.04, -0.15, 0.08);
    if (w.category !== 'secondary') {
      const support = hand(view, g, -0.05, -0.11, -Math.min(0.2, len * 0.28), 0.95);
      support.rotation.set(0, 0, 0.35);
      g.userData.support = support;
      g.userData.supportBase = support.position.clone();
    }
  }
  const flash = new T.Group();
  flash.position.z = -len / 2 - 0.02;
  flash.visible = false;
  if (!w.melee && !w.silent) g.add(flash);
  g.userData.flash = flash;
  // Where the magazine sits: the new one is pushed up into here.
  g.userData.magSlot = new T.Vector3(0, -0.11, -len * 0.1);
}
// Shared props, parented to whichever weapon is reloading: magazines, a shotgun shell, cases and a speed-loader, a
// rocket; and the flash sprite with its light.
export function makeViewProps(view) {
  const scene = view.weaponScene,
    P = {};
  // Steel magazines with brass rounds on top, finished like the weapons.
  const magSteel = objectSurface(new T.MeshStandardMaterial({ color: MAG, roughness: 0.42, metalness: 0.75 }), { surface: 'gunmetal', size: 0.1, strength: 0.5, normal: 0.7 }),
    magBrass = objectSurface(new T.MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 0.9 }), { surface: 'steel', size: 0.1, strength: 0.3, normal: 0.3 });
  const mag = () => {
    const g = new T.Group();
    part(view, g, 0, 0, 0, 0.05, 0.17, 0.085, magSteel);
    part(view, g, 0, 0.09, 0.005, 0.03, 0.02, 0.06, magBrass);
    g.visible = false;
    return g;
  };
  P.newMag = mag();
  P.dropMag = mag();
  scene.add(P.dropMag);
  P.shell = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, 0.07, 8), new T.MeshStandardMaterial({ color: SHELL, roughness: 0.5 }));
  P.shell.add(new T.Mesh(new T.CylinderGeometry(0.0135, 0.0135, 0.018, 8), new T.MeshStandardMaterial({ color: BRASS, metalness: 0.8, roughness: 0.3 })));
  P.shell.children[0].position.y = -0.03;
  P.shell.visible = false;
  // A speed-loader: six rounds in a ring, and the six spent cases that fall out first.
  const brass = new T.MeshStandardMaterial({ color: BRASS, metalness: 0.85, roughness: 0.3 }),
    round = new T.CylinderGeometry(0.0075, 0.0075, 0.04, 6);
  P.loader = new T.Group();
  P.cases = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2,
      r = new T.Mesh(round, brass);
    r.position.set(Math.cos(a) * 0.018, 0, Math.sin(a) * 0.018);
    P.loader.add(r);
    const c = new T.Mesh(round, brass);
    c.visible = false;
    scene.add(c);
    P.cases.push(c);
  }
  P.loader.add(new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.012, 12), new T.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6 })));
  P.loader.children.at(-1).position.y = -0.026;
  P.loader.rotation.x = Math.PI / 2;
  P.loader.visible = false;
  P.rocket = new T.Group();
  const warhead = new T.Mesh(new T.ConeGeometry(0.04, 0.14, 10), new T.MeshStandardMaterial({ color: 0x6d7a48, roughness: 0.6 })),
    body = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.26, 10), new T.MeshStandardMaterial({ color: 0x3f4a2e, roughness: 0.7 }));
  warhead.rotation.x = -Math.PI / 2;
  warhead.position.z = -0.2;
  body.rotation.x = Math.PI / 2;
  P.rocket.add(warhead, body);
  P.rocket.visible = false;
  // The muzzle flash: two crossed star-shaped sprites (additive), a new roll and size every shot.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d'),
    grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,230,1)');
  grad.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  x.fillStyle = grad;
  x.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2,
      r = i % 2 ? 11 : 31;
    x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  x.fill();
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const flashMat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false });
  P.flash = new T.Group();
  const front = new T.Mesh(new T.PlaneGeometry(0.2, 0.2), flashMat),
    side = new T.Mesh(new T.PlaneGeometry(0.3, 0.14), flashMat);
  side.rotation.y = Math.PI / 2;
  side.position.z = -0.08;
  P.flash.add(front, side);
  P.light = new T.PointLight(0xffc27a, 0, 1.6, 2);
  scene.add(P.light);
  view.fpProps = P;
  view.fpSway = { x: 0, y: 0, angle: null, pitch: null };
  view.fpSprint = 0;
  view.fpFlashT = 0;
}
// Moves a shared prop onto the weapon that is reloading now.
function carry(prop, g) {
  if (prop.parent !== g) g.add(prop);
}
// Reload animation: a pose offset for the whole weapon, and the props placed for this moment. rt: 0 → 1.
function reloadMotion(view, g, style, rt, dt) {
  const P = view.fpProps,
    pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    support = g.userData.support,
    base = g.userData.supportBase,
    slot = g.userData.magSlot;
  for (const k of ['newMag', 'shell', 'loader', 'rocket']) P[k].visible = false;
  if (support) support.position.copy(base);
  if (rt < 0 || style === 'none') {
    view.fpReload = null;
    P.dropMag.visible = false;
    for (const c of P.cases) c.visible = false;
    return pose;
  }
  const st = (view.fpReload ||= { dropped: false, cases: false, t: 0 });
  if (style === 'mag') {
    const tilt = smooth(0, 0.15, rt) * (1 - smooth(0.85, 1, rt));
    pose.rz = -0.5 * tilt;
    pose.rx = 0.18 * tilt;
    pose.y = -0.05 * tilt;
    // The empty magazine drops out of the well...
    if (!st.dropped && rt > 0.12) {
      st.dropped = true;
      g.updateMatrixWorld(true);
      st.dropAt = g.localToWorld(slot.clone());
      st.dropT = 0;
    }
    // ...the other hand goes down for a fresh one, brings it up and slaps it home...
    const down = smooth(0.18, 0.42, rt) * (1 - smooth(0.45, 0.72, rt)),
      up = smooth(0.45, 0.72, rt);
    if (rt > 0.38 && rt < 0.76) {
      carry(P.newMag, g);
      P.newMag.visible = true;
      P.newMag.position.set(slot.x, slot.y - 0.34 * (1 - up), slot.z + 0.06 * (1 - up));
      P.newMag.rotation.set(0.3 * (1 - up), 0, 0.2 * (1 - up));
    }
    if (support) {
      support.position.y = base.y - 0.32 * down - (rt > 0.38 && rt < 0.72 ? 0.3 * (1 - up) : 0);
      support.position.z = base.z + (slot.z - base.z) * Math.max(down, rt > 0.45 && rt < 0.78 ? 1 - smooth(0.72, 0.8, rt) : 0);
    }
    pose.y += 0.018 * bell(0.72, 0.8, rt);
    // ...and works the charging handle.
    const charge = bell(0.8, 0.96, rt);
    pose.z += 0.035 * charge;
    pose.rz += 0.16 * charge;
    if (support && charge > 0) {
      support.position.x = base.x + 0.09 * charge;
      support.position.y = base.y + 0.06 * charge;
    }
  } else if (style === 'shells') {
    const tilt = smooth(0, 0.12, rt) * (1 - smooth(0.82, 0.92, rt));
    pose.rz = 0.45 * tilt;
    pose.rx = 0.15 * tilt;
    pose.y = -0.06 * tilt;
    // Four shells pushed into the loading port one after another.
    if (rt > 0.14 && rt < 0.8) {
      const k = ((rt - 0.14) / 0.66) * 4,
        f = k % 1,
        rise = smooth(0, 0.55, f),
        push = smooth(0.55, 0.85, f);
      carry(P.shell, g);
      P.shell.visible = f < 0.85;
      P.shell.rotation.set(Math.PI / 2 - push * 0.4, 0, 0);
      P.shell.position.set(0, -0.1 - 0.25 * (1 - rise) + push * 0.03, -0.02 - push * 0.08);
      if (support) support.position.set(base.x * 0.4, P.shell.position.y - 0.05, P.shell.position.z + 0.08);
    }
    // Rack the pump.
    const pump = bell(0.84, 0.98, rt);
    pose.z += 0.03 * pump;
    if (support) support.position.z += 0.09 * pump;
  } else if (style === 'cylinder') {
    const open = smooth(0, 0.14, rt) * (1 - smooth(0.7, 0.8, rt));
    pose.rz = 0.95 * open;
    pose.x = -0.05 * open;
    pose.y = -0.03 * open;
    pose.ry = 0.2 * open;
    // Spent cases tumble out of the cylinder.
    if (!st.cases && rt > 0.16) {
      st.cases = true;
      g.updateMatrixWorld(true);
      const at = g.localToWorld(new T.Vector3(0, 0.01, -0.02));
      st.caseT = 0;
      st.caseFrom = P.cases.map((c, i) => at.clone().add(new T.Vector3(Math.cos(i) * 0.012, 0, Math.sin(i) * 0.012)));
    }
    if (rt > 0.36 && rt < 0.72) {
      const up = smooth(0.36, 0.66, rt);
      carry(P.loader, g);
      P.loader.visible = true;
      P.loader.position.set(0, 0.0 - 0.28 * (1 - up), 0.02 + 0.04 * (1 - up));
    }
    pose.rz -= 0.25 * bell(0.72, 0.84, rt);
  } else if (style === 'tube') {
    const lower = smooth(0, 0.2, rt) * (1 - smooth(0.75, 1, rt));
    pose.rx = -0.55 * lower;
    pose.y = -0.14 * lower;
    pose.x = 0.03 * lower;
    if (rt > 0.22 && rt < 0.74) {
      const k = smooth(0.25, 0.7, rt);
      carry(P.rocket, g);
      P.rocket.visible = true;
      P.rocket.position.set(0, 0.01, 0.5 - 0.42 * k);
      P.rocket.scale.setScalar(g.userData.length > 0.8 ? 1.2 : 0.7);
      if (support) support.position.set(base.x * 0.3, base.y + 0.02, P.rocket.position.z + 0.12);
    }
  } else if (style === 'draw') {
    // A fresh one from the belt.
    const k = bell(0, 1, rt);
    pose.y = -0.45 * k;
    pose.rx = 0.6 * k;
  }
  // Dropped props fall in view space, whatever the weapon does.
  if (st.dropAt) {
    st.dropT += dt;
    P.dropMag.visible = st.dropT < 0.6;
    P.dropMag.position.set(st.dropAt.x - 0.05 * st.dropT, st.dropAt.y - 4.9 * st.dropT * st.dropT - 0.2 * st.dropT, st.dropAt.z + 0.08 * st.dropT);
    P.dropMag.rotation.set(st.dropT * 4, 0, st.dropT * 3);
  }
  if (st.caseFrom) {
    st.caseT += dt;
    P.cases.forEach((c, i) => {
      c.visible = st.caseT < 0.7;
      const f = st.caseFrom[i];
      c.position.set(f.x + (i - 2.5) * 0.02 * st.caseT, f.y - 4.9 * st.caseT * st.caseT, f.z + 0.1 * st.caseT);
      c.rotation.set(st.caseT * (6 + i), i, st.caseT * 4);
    });
  }
  return pose;
}
// The whole first-person weapon for one frame. `me` is the viewed player, `look` the camera's own look.
export function poseViewWeapon(view, me, look, dt) {
  const held = WEAPONS[me.weapon],
    P = view.fpProps;
  if (view.fpShot !== me.shot) {
    if (view.fpShot >= 0) {
      if (held.melee) {
        view.swing = 1;
        view.swingSide = -view.swingSide;
      } else {
        view.fpRecoil = 0.11;
        view.fpFlashT = 0.05;
        view.fpKick = (Math.random() - 0.5) * 0.02;
        P.flash.rotation.z = Math.random() * Math.PI;
        P.flash.scale.setScalar(0.8 + Math.random() * 0.5);
      }
    }
    view.fpShot = me.shot;
  }
  view.swing = Math.max(0, view.swing - dt / Math.min(0.42, held.interval || 0.4));
  // Weapon switch: lower the old weapon, then raise the new one (also used when spawning).
  if (view.previousWeapon !== me.weapon) {
    view.switchFrom = view.previousWeapon >= 0 ? view.previousWeapon : me.weapon;
    view.switchT = view.previousWeapon >= 0 ? 1 : 0.5;
    view.previousWeapon = me.weapon;
    view.fpReload = null;
  }
  if (view.spawnRaise) {
    view.switchFrom = me.weapon;
    view.switchT = 0.5;
    view.spawnRaise = false;
  }
  view.switchT = Math.max(0, (view.switchT || 0) - dt / 0.42);
  const lowering = view.switchT > 0.5,
    drop = lowering ? 1 - (view.switchT - 0.5) * 2 : view.switchT * 2,
    shown = lowering ? view.switchFrom : me.weapon,
    swapEase = drop * drop * (3 - 2 * drop),
    g = view.fpGuns[shown];
  view.fpRecoil = Math.max(0, view.fpRecoil - dt);
  view.fpFlashT = Math.max(0, view.fpFlashT - dt);
  view.land = Math.max(0, (view.land || 0) - dt * 2.2);
  // Footsteps (the camera bobs on the same phase), sprint carry and sway when turning.
  const phase = view.stepPhase || 0,
    amp = view.bobAmp || 0,
    sway = view.fpSway;
  view.fpSprint += ((me.sprinting && !look.aim ? 1 : 0) - view.fpSprint) * Math.min(1, dt * 9);
  if (sway.angle !== null) {
    const da = Math.atan2(Math.sin(look.angle - sway.angle), Math.cos(look.angle - sway.angle)),
      dp = look.pitch - sway.pitch;
    sway.x = Math.max(-0.06, Math.min(0.06, sway.x + da * 0.45));
    sway.y = Math.max(-0.05, Math.min(0.05, sway.y - dp * 0.4));
  }
  sway.angle = look.angle;
  sway.pitch = look.pitch;
  sway.x *= Math.exp(-dt * 9);
  sway.y *= Math.exp(-dt * 9);
  const reloadTime = (held.reload || 1) * (RARITIES[me.rarity]?.reload || 1),
    rt = me.reload > 0 && !lowering ? Math.min(1, Math.max(0, 1 - me.reload / reloadTime)) : -1,
    pose = reloadMotion(view, g, reloadStyle(WEAPONS[shown]), rt, dt),
    // Melee swing: wind-up then a fast diagonal slash, alternating sides.
    t = 1 - view.swing,
    slash = view.swing > 0 && !held.fists ? Math.sin(Math.min(1, t * 1.25) * Math.PI) : 0,
    side = view.swingSide,
    aim = look.aim && !held.melee ? 1 : 0,
    sprint = view.fpSprint,
    bobX = Math.sin(phase) * 0.014 * amp * (1 - aim * 0.8),
    bobY = -Math.abs(Math.cos(phase)) * 0.016 * amp * (1 - aim * 0.8);
  view.fp.position.set(
    0.24 - aim * 0.24 + bobX + sway.x - slash * 0.22 * side + pose.x + sprint * 0.04,
    -0.23 + aim * 0.15 + bobY + sway.y + pose.y - swapEase * 0.38 - view.land * 0.12 - (me.healing > 0 ? 0.3 : 0) + slash * 0.05 - sprint * 0.06,
    -0.58 + aim * 0.14 + view.fpRecoil * 0.65 - slash * 0.18 + pose.z,
  );
  view.fp.rotation.set(
    view.fpRecoil * 1.2 + pose.rx - slash * 0.9 - swapEase * 0.7 - sprint * 0.22 + sway.y * 1.5,
    slash * 0.5 * side + pose.ry + sprint * 0.55 + sway.x * 2 + (view.fpKick || 0) * (view.fpRecoil / 0.11),
    pose.rz + slash * 1.1 * side - sprint * 0.12 + bobX * 2,
  );
  // Bare hands: a jab with one fist, then the other; the guard bobs with your steps.
  const F = g.userData.fists;
  if (F) {
    const jab = view.swing > 0 ? Math.sin(Math.min(1, (1 - view.swing) * 1.4) * Math.PI) : 0,
      right = view.swingSide > 0,
      bob = Math.sin(phase * 2) * 0.008 * amp;
    F.r.position.copy(F.rBase);
    F.l.position.copy(F.lBase);
    F.r.position.y += bob;
    F.l.position.y -= bob;
    const fist = right ? F.r : F.l;
    fist.position.z -= 0.34 * jab;
    fist.position.x += (right ? -0.1 : 0.12) * jab;
    fist.position.y += 0.05 * jab;
    view.fp.position.x -= 0.06;
  }
  // Using an item: bottles and cans come up to the mouth and tip back, a bandage is wound round the other arm,
  // a deployable is pushed out and set down.
  const u = me.using && shown === me.weapon && held.consumable ? 1 - me.using.t / (me.using.time || 1) : -1;
  if (u >= 0) {
    const up = smooth(0, 0.25, u) * (1 - smooth(0.9, 1, u));
    if (held.deploy) {
      const push = smooth(0.2, 1, u);
      view.fp.position.x -= 0.12 * up;
      view.fp.position.y -= 0.1 * push;
      view.fp.position.z -= 0.25 * push;
      view.fp.rotation.x += 0.6 * push;
    } else if (held.model === 'bandage') {
      view.fp.position.x -= 0.2 * up;
      view.fp.position.y += 0.04 * up + Math.sin(u * 28) * 0.025 * up;
      view.fp.rotation.z += Math.sin(u * 28) * 0.5 * up;
      view.fp.rotation.y += 0.3 * up;
    } else {
      view.fp.position.x -= 0.2 * up;
      view.fp.position.y += 0.13 * up;
      view.fp.position.z += 0.22 * up;
      view.fp.rotation.x -= (1.05 + Math.sin(u * 18) * 0.06) * up;
    }
  }
  view.fpGuns.forEach((gun, i) => {
    gun.visible = i === shown;
    if (i === me.weapon && gun.userData.barrels) gun.userData.barrels.rotation.x += dt * (me.spin || 0) * 32;
  });
  // The flash: the sprite on the muzzle of the weapon in hand, and a light that shows the gun and your hands.
  const flash = g.userData.flash,
    lit = !!flash && view.fpFlashT > 0 && shown === me.weapon && !held.melee && !held.silent && !held.consumable;
  if (flash && P.flash.parent !== flash) flash.add(P.flash);
  if (flash) flash.visible = lit;
  P.flash.visible = lit;
  if (lit) {
    flash.getWorldPosition(P.light.position);
    P.light.intensity = 3 * (view.fpFlashT / 0.05);
  } else P.light.intensity = 0;
  view.fpGlider.visible = !!me.gliding && !me.wingsOpen;
  // Raised into view while you aim, lowered a little while you run.
  view.fpShield.visible = me.gear?.id === 'shield' && me.gear.hp > 0 && !me.gliding;
  if (view.fpShield.visible) {
    const up = look.aim ? 0.1 : 0,
      bob = Math.sin(phase) * 0.01 * amp;
    view.fpShield.position.set(-0.34 + up * 0.16, -0.22 + up * 0.1 + bob, -0.62 + up * 0.06);
    view.fpShield.rotation.y = 0.34 - up * 0.3;
  }
}
