// Drawing for bosses, their shots, fire rings, frost, relics on the ground and portals.
// Boss bodies: the CC0 "RobotExpressive" rig by Quaternius (see ASSET-CREDITS.md), recoloured per boss, with
// its own animations (idle, walk, punch, cast, head-shake when confused, death) and extra parts per element.
import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { modelAsset } from './assets.js';
import { BOSSES, BOSS_HEIGHT, RELICS } from './bosses.js';

const LOOKS = {
  fire: {
    Main: { color: 0x2e1c16, emissive: 0xff4a10, ei: 0.16 },
    Grey: { color: 0x3a302b, emissive: 0x000000, ei: 0 },
    Black: { color: 0x1b0d08, emissive: 0xff7a1a, ei: 1.6 },
  },
  mind: {
    Main: { color: 0x7a4fd6, emissive: 0x5a2fb0, ei: 0.5 },
    Grey: { color: 0xe4dcf6, emissive: 0x000000, ei: 0 },
    Black: { color: 0x2a1a44, emissive: 0xd9a8ff, ei: 0.9 },
  },
  void: {
    Main: { color: 0x0d0b14, emissive: 0x000000, ei: 0 },
    Grey: { color: 0x2a2440, emissive: 0x1a0f40, ei: 0.4 },
    Black: { color: 0x120a24, emissive: 0x8a5cff, ei: 1.3 },
  },
  might: {
    Main: { color: 0x7d6a4e, emissive: 0x3a2a12, ei: 0.2 },
    Grey: { color: 0xb9a884, emissive: 0x000000, ei: 0 },
    Black: { color: 0x4a3a24, emissive: 0xffb43c, ei: 1.1 },
  },
  chaos: {
    Main: { color: 0x14322c, emissive: 0x0d5a48, ei: 0.5 },
    Grey: { color: 0x9ff0d8, emissive: 0x000000, ei: 0 },
    Black: { color: 0x07201c, emissive: 0x38e0b0, ei: 1.5 },
  },
};
const CLIPS = { idle: 'Idle', walk: 'Walking', attack: 'Punch', cast: 'Jump', confused: 'No', death: 'Death' };
const CAST = { might: 'Jump', fire: 'Jump', mind: 'Wave', void: 'Wave', chaos: 'Wave' };
const SHOT_COLORS = { fireball: 0xff6a1a, psy: 0xc08cff, void: 0x7b4dff, boulder: 0x9b7f56, entropy: 0x38e0b0 };
const PORTAL_COLORS = { a: 0x2f9bff, b: 0xff8a1f };

export class BossViews {
  constructor(view) {
    this.view = view;
    this.scene = view.scene;
    this.root = new T.Group();
    this.scene.add(this.root);
    this.bosses = new Map();
    this.shots = new Map();
    this.rings = new Map();
    this.drops = new Map();
    this.ice = new Map();
    this.portalMeshes = new Map();
    this.clock = 0;
    this.shotGeo = new T.IcosahedronGeometry(0.32, 1);
    this.flameGeo = new T.ConeGeometry(0.35, 1.3, 5);
    this.iceGeo = new T.BoxGeometry(1.1, 2.1, 1.1);
    this.iceMat = new T.MeshStandardMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.45, roughness: 0.1, emissive: 0x3aa6d8, emissiveIntensity: 0.3 });
    this.shotMats = Object.fromEntries(
      Object.entries(SHOT_COLORS).map(([k, c]) => [k, new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, fog: false })]),
    );
    this.flameMat = new T.MeshBasicMaterial({ color: 0xff7a22, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending });
    this.portalTarget = null;
  }
  // One boss body: rig clone, recolour, attachments, animation actions, health bar.
  makeBoss(b) {
    const asset = modelAsset('boss');
    if (!asset) return null;
    const root = new T.Group(),
      body = cloneSkeleton(asset.scene),
      look = LOOKS[b.kind];
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
      const l = look[o.material.name] || look.Main;
      o.material.color.setHex(l.color);
      o.material.emissive = new T.Color(l.emissive);
      o.material.emissiveIntensity = l.ei;
      o.material.metalness = b.kind === 'might' ? 0.25 : 0.1;
      o.material.roughness = b.kind === 'chaos' ? 0.35 : 0.75;
      o.frustumCulled = false;
    });
    root.add(body);
    // Scale the rig to the boss height.
    body.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(body),
      h = box.max.y - box.min.y || 1;
    body.scale.setScalar(BOSS_HEIGHT / h);
    body.position.y = -box.min.y * (BOSS_HEIGHT / h);
    const bone = (name) => {
      let found = null;
      body.traverse((o) => {
        if (!found && o.isBone && o.name === name) found = o;
      });
      return found;
    };
    const extras = [];
    // Parts follow bones in world space every frame (bone axes and scales vary in the rig), offset in metres.
    const attach = (name, mesh, offset = new T.Vector3()) => {
      const b0 = bone(name);
      if (!b0) return mesh;
      mesh.userData.bone = b0;
      mesh.userData.offset = offset;
      root.add(mesh);
      extras.push(mesh);
      return mesh;
    };
    const k = 1;
    if (b.kind === 'fire') {
      for (const [name, s] of [
        ['Head', 1.7],
        ['Shoulder.L', 1.1],
        ['Shoulder.R', 1.1],
      ]) {
        const f = new T.Mesh(this.flameGeo, this.flameMat);
        f.scale.setScalar(s);
        attach(name, f, new T.Vector3(0, name === 'Head' ? 1.45 : 0.6, 0)).userData.flame = s;
      }
    }
    // VIS wears the gloves it drops: huge stone fists, with boulders on its shoulders.
    if (b.kind === 'might') {
      const stone = new T.MeshStandardMaterial({ color: 0x8a7351, emissive: 0xff9a2e, emissiveIntensity: 0.18, roughness: 0.9, flatShading: true }),
        glove = new T.MeshStandardMaterial({ color: 0xe0a33c, emissive: 0xffb43c, emissiveIntensity: 0.55, roughness: 0.5, flatShading: true });
      for (const name of ['Hand.L', 'Hand.R']) {
        const fist = new T.Mesh(new T.DodecahedronGeometry(0.42, 0), glove);
        attach(name, fist, new T.Vector3(0, 0, 0));
      }
      for (const [name, side] of [
        ['Shoulder.L', 1],
        ['Shoulder.R', -1],
      ]) {
        const rock = new T.Mesh(new T.DodecahedronGeometry(0.5, 0), stone);
        rock.rotation.set(0.4 * side, 0.3, 0.2 * side);
        attach(name, rock, new T.Vector3(side * 0.12, 0.6, 0));
      }
    }
    // ENTROPIA is held together by broken shards that turn around it.
    if (b.kind === 'chaos') {
      const shards = new T.Group(),
        mat = new T.MeshStandardMaterial({ color: 0x0f3a32, emissive: 0x38e0b0, emissiveIntensity: 1.1, roughness: 0.3, flatShading: true });
      for (let i = 0; i < 7; i++) {
        const s = new T.Mesh(new T.TetrahedronGeometry(0.3 + (i % 3) * 0.12, 0), mat);
        s.userData.phase = (i / 7) * Math.PI * 2;
        s.userData.level = 0.7 + (i % 4) * 0.55;
        s.userData.radius = 1.1 + (i % 3) * 0.35;
        shards.add(s);
      }
      root.add(shards);
      root.userData.shards = shards;
    }
    if (b.kind === 'mind') {
      const head = bone('Head');
      if (head) head.scale.setScalar(1.35);
      const orbs = new T.Group();
      for (let i = 0; i < 3; i++) {
        const o = new T.Mesh(new T.IcosahedronGeometry(0.22, 1), new T.MeshBasicMaterial({ color: 0xe0c4ff }));
        o.userData.phase = (i / 3) * Math.PI * 2;
        orbs.add(o);
      }
      orbs.position.y = BOSS_HEIGHT * 0.95;
      root.add(orbs);
      root.userData.orbs = orbs;
    }
    if (b.kind === 'void') {
      const halo = new T.Mesh(
        new T.TorusGeometry(1.1, 0.07, 6, 40),
        new T.MeshBasicMaterial({ color: 0x9a70ff, transparent: true, opacity: 0.85 }),
      );
      halo.position.set(0, BOSS_HEIGHT * 0.78, -0.55);
      root.add(halo);
      root.userData.halo = halo;
    }
    const mixer = new T.AnimationMixer(body),
      actions = {};
    for (const [state, clipName] of Object.entries({ ...CLIPS, cast: CAST[b.kind] })) {
      const clip = asset.animations.find((c) => c.name === clipName);
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      if (state === 'death' || state === 'attack' || state === 'cast') {
        a.setLoop(T.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions[state] = a;
    }
    // Name and health bar above the head.
    const bar = new T.Group(),
      label = this.view.text(b.name, 4.2, 0.5, '#fff1d6', '#2b1f2e'),
      back = new T.Mesh(new T.PlaneGeometry(3.2, 0.2), new T.MeshBasicMaterial({ color: 0x1a1414 })),
      fill = new T.Mesh(new T.PlaneGeometry(3.2, 0.2), new T.MeshBasicMaterial({ color: BOSSES[b.kind].color }));
    label.position.y = 0.4;
    fill.position.z = 0.01;
    bar.add(label, back, fill);
    bar.position.y = BOSS_HEIGHT + 0.8;
    root.add(bar);
    this.root.add(root);
    return { root, body, mixer, actions, state: null, bar, fill, extras, hitFlash: 0, lastHit: b.hitAt };
  }
  update(state, dt, camera, localId) {
    this.clock += dt;
    const seen = new Set();
    for (const b of state.bosses || []) {
      seen.add(b.id);
      let v = this.bosses.get(b.id);
      if (!v) {
        v = this.makeBoss(b);
        if (!v) continue;
        this.bosses.set(b.id, v);
        v.root.position.set(b.x, b.y, b.z);
      }
      const dead = b.hp <= 0;
      v.root.visible = !dead || (v.deadFor || 0) < 6;
      v.deadFor = dead ? (v.deadFor || 0) + dt : 0;
      v.root.position.lerp(new T.Vector3(b.x, b.y + (b.kind === 'mind' ? Math.sin(this.clock * 1.6) * 0.18 : 0), b.z), Math.min(1, dt * 12));
      if (Math.hypot(v.root.position.x - b.x, v.root.position.z - b.z) > 4) v.root.position.set(b.x, b.y, b.z);
      v.root.rotation.y = b.angle;
      let anim = dead ? 'death' : b.anim;
      if (anim === 'walk' && b.kind === 'mind') anim = 'idle';
      if (anim !== v.state && v.actions[anim]) {
        const next = v.actions[anim];
        next.reset().fadeIn(0.2).play();
        if (v.state && v.actions[v.state]) v.actions[v.state].fadeOut(0.2);
        v.state = anim;
      }
      v.mixer.timeScale = b.frozen > 0 ? 0.3 : 1;
      v.mixer.update(dt);
      // Health bar faces the camera.
      // Close up the HUD shows the boss bar; the floating one is for bosses in the distance.
      v.bar.visible = !dead && camera.position.distanceTo(v.root.position) > 30;
      v.bar.quaternion.copy(camera.quaternion);
      v.bar.quaternion.premultiply(v.root.quaternion.clone().invert());
      const f = Math.max(0.001, b.hp / b.maxHp);
      v.fill.scale.x = f;
      v.fill.position.x = -1.6 * (1 - f);
      if (b.hitAt !== v.lastHit) {
        v.lastHit = b.hitAt;
        v.hitFlash = 0.12;
      }
      v.hitFlash = Math.max(0, v.hitFlash - dt);
      v.body.traverse((o) => {
        if (o.isMesh && o.material.userData.base === undefined) o.material.userData.base = o.material.emissiveIntensity;
        if (o.isMesh) o.material.emissiveIntensity = o.material.userData.base + (v.hitFlash > 0 ? 0.8 : 0) + (b.frozen > 0 ? 0.4 : 0);
      });
      const wp = new T.Vector3();
      v.root.updateMatrixWorld(true);
      for (const e of v.extras) {
        e.userData.bone.getWorldPosition(wp);
        v.root.worldToLocal(wp);
        e.position.copy(wp).add(e.userData.offset);
      }
      for (const e of v.extras)
        if (e.userData.flame) {
          e.scale.y = e.userData.flame * (0.8 + Math.sin(this.clock * 17 + e.id) * 0.25);
        }
      if (v.root.userData.orbs) {
        v.root.userData.orbs.children.forEach((o, i) => {
          const a = this.clock * 1.8 + o.userData.phase;
          o.position.set(Math.cos(a) * 1.3, Math.sin(this.clock * 2 + i) * 0.25, Math.sin(a) * 1.3);
        });
      }
      if (v.root.userData.halo) v.root.userData.halo.rotation.z = this.clock * 0.8;
      if (v.root.userData.shards) {
        v.root.userData.shards.children.forEach((s) => {
          const a = this.clock * (1.1 + s.userData.level * 0.2) + s.userData.phase;
          s.position.set(Math.cos(a) * s.userData.radius, s.userData.level + Math.sin(a * 1.7) * 0.2, Math.sin(a) * s.userData.radius);
          s.rotation.set(a * 1.4, a, a * 0.7);
        });
      }
    }
    for (const [id, v] of this.bosses)
      if (!seen.has(id)) {
        this.root.remove(v.root);
        this.bosses.delete(id);
      }
    this.updateShots(state);
    this.updateRings(state);
    this.updateDrops(state);
    this.updateIce(state, localId);
    this.updatePortals(state, camera);
    this.updateBus(state, dt);
  }
  // The battle bus: a blue coach hanging under a striped balloon, open windows so riders can look out.
  makeBus() {
    const g = new T.Group(),
      // Closed boxes: front faces only. Glossy paint, chrome trim and reflective glass under the sky light.
      paint = new T.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.32, metalness: 0.3, envMapIntensity: 1.3 }),
      trim = new T.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.25, metalness: 0.6, envMapIntensity: 1.2 }),
      dark = new T.MeshStandardMaterial({ color: 0x1d2328, roughness: 0.8 }),
      glass = new T.MeshStandardMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.18, roughness: 0.03, envMapIntensity: 1.6, depthWrite: false }),
      box = (w, h, d, m, x, y, z) => {
        const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        g.add(mesh);
        return mesh;
      };
    const L = 9,
      W = 2.8;
    box(W, 0.2, L, new T.MeshStandardMaterial({ color: 0x5d6b78, roughness: 0.8 }), 0, -0.1, 0); // floor
    box(W, 0.18, L, trim, 0, 2.6, 0); // roof
    for (const s of [-1, 1]) {
      box(0.1, 1.05, L, paint, (s * W) / 2, 0.52, 0); // below the windows
      box(0.1, 0.35, L, paint, (s * W) / 2, 2.35, 0); // above them
      for (let z = -L / 2; z <= L / 2 + 0.01; z += 1.5) box(0.12, 1.2, 0.18, paint, (s * W) / 2, 1.6, z);
      box(0.04, 1.15, L, glass, (s * W) / 2, 1.6, 0);
    }
    box(W, 1.05, 0.1, paint, 0, 0.52, L / 2); // front
    box(W, 0.35, 0.1, paint, 0, 2.35, L / 2);
    box(W, 1.15, 0.04, glass, 0, 1.6, L / 2);
    box(W, 2.6, 0.1, paint, 0, 1.2, -L / 2); // back
    for (const s of [-1, 1]) box(0.06, 0.2, L + 0.05, trim, s * (W / 2 + 0.05), 1.0, 0); // stripe
    const wheel = new T.CylinderGeometry(0.5, 0.5, 0.35, 12);
    for (const x of [-1.35, 1.35])
      for (const z of [-3, 3]) {
        const w = new T.Mesh(wheel, dark);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, -0.62, z);
        g.add(w);
      }
    // Balloon with alternating stripes, tied to the roof corners.
    const colors = [0xe8473c, 0xfff4e0];
    for (let i = 0; i < 12; i++) {
      const seg = new T.Mesh(
        new T.SphereGeometry(4.8, 6, 12, (i / 12) * Math.PI * 2, Math.PI / 6),
        new T.MeshStandardMaterial({ color: colors[i % 2], roughness: 0.7, flatShading: true }),
      );
      seg.position.y = 11;
      seg.scale.y = 1.15;
      g.add(seg);
    }
    const rope = new T.MeshBasicMaterial({ color: 0x3b3128 });
    for (const x of [-1.2, 1.2])
      for (const z of [-4, 4]) {
        const from = new T.Vector3(x, 2.7, z),
          to = new T.Vector3(x * 1.4, 6.8, z * 0.45),
          mid = from.clone().add(to).multiplyScalar(0.5),
          r = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, from.distanceTo(to), 4), rope);
        r.position.copy(mid);
        r.lookAt(to);
        r.rotateX(Math.PI / 2);
        g.add(r);
      }
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    this.root.add(g);
    return g;
  }
  updateBus(state, dt) {
    const b = state.bus;
    if (!b?.active) {
      if (this.bus) this.bus.visible = false;
      return;
    }
    this.bus ||= this.makeBus();
    this.bus.visible = true;
    const target = new T.Vector3(b.x, b.y, b.z);
    if (this.bus.position.distanceTo(target) > 20) this.bus.position.copy(target);
    else this.bus.position.lerp(target, Math.min(1, dt * 10));
    this.bus.rotation.y = Math.atan2(b.bx - b.ax, b.bz - b.az);
    this.bus.rotation.z = Math.sin(this.clock * 0.9) * 0.03;
  }
  updateShots(state) {
    const seen = new Set();
    for (const s of state.bossShots || []) {
      seen.add(s.id);
      let m = this.shots.get(s.id);
      if (!m) {
        m = new T.Mesh(this.shotGeo, this.shotMats[s.kind] || this.shotMats.void);
        if (s.kind === 'ice') m.scale.set(0.6, 0.6, 1.8);
        if (s.kind === 'fireball') m.scale.setScalar(1.5);
        this.root.add(m);
        this.shots.set(s.id, m);
      }
      m.position.set(s.x, s.y, s.z);
      m.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
      m.rotation.z += 0.3;
    }
    for (const [id, m] of this.shots)
      if (!seen.has(id)) {
        this.root.remove(m);
        this.shots.delete(id);
      }
  }
  updateRings(state) {
    const seen = new Set();
    for (const h of state.hazards || []) {
      seen.add(h.id);
      let g = this.rings.get(h.id);
      if (!g) {
        g = new T.Group();
        const n = 28;
        for (let i = 0; i < n; i++) {
          const f = new T.Mesh(this.flameGeo, this.flameMat);
          const a = (i / n) * Math.PI * 2;
          f.position.set(Math.cos(a) * h.r, 0.6, Math.sin(a) * h.r);
          f.userData.a = a;
          g.add(f);
        }
        const glow = new T.Mesh(
          new T.RingGeometry(h.r - 0.5, h.r + 0.5, 48),
          new T.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.55, side: T.DoubleSide, depthWrite: false }),
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.06;
        g.add(glow);
        g.position.set(h.x, h.y, h.z);
        this.root.add(g);
        this.rings.set(h.id, g);
      }
      const life = Math.min(1, h.time / 0.6, (h.max - h.time) / 0.3 + 0.2);
      g.children.forEach((f, i) => {
        if (f.userData.a === undefined) return;
        f.scale.set(1, (1.1 + Math.sin(this.clock * 14 + i * 1.7) * 0.35) * life, 1);
      });
    }
    for (const [id, g] of this.rings)
      if (!seen.has(id)) {
        this.root.remove(g);
        g.children.forEach((c) => c.geometry !== this.flameGeo && c.geometry.dispose());
        this.rings.delete(id);
      }
  }
  relicModel(relic) {
    const g = new T.Group(),
      color = RELICS[relic]?.color || 0xffffff,
      mat = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.3 });
    if (relic === 'gloves')
      for (const s of [-1, 1]) {
        const hand = new T.Mesh(new T.BoxGeometry(0.28, 0.34, 0.18), mat);
        hand.position.x = s * 0.2;
        const cuff = new T.Mesh(new T.BoxGeometry(0.3, 0.12, 0.2), new T.MeshStandardMaterial({ color: 0x2b1a12 }));
        cuff.position.set(s * 0.2, -0.22, 0);
        g.add(hand, cuff);
      }
    else if (relic === 'crown') {
      g.add(new T.Mesh(new T.TorusGeometry(0.3, 0.06, 6, 16), mat));
      g.children[0].rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const sp = new T.Mesh(new T.ConeGeometry(0.06, 0.22, 4), mat);
        const a = (i / 5) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3);
        g.add(sp);
      }
    } else if (relic === 'portal') {
      const body = new T.Mesh(new T.BoxGeometry(0.2, 0.22, 0.6), new T.MeshStandardMaterial({ color: 0xe8e8ee, roughness: 0.4 }));
      const tip = new T.Mesh(new T.CylinderGeometry(0.1, 0.13, 0.22, 10), mat);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.38;
      g.add(body, tip);
    } else g.add(new T.Mesh(new T.OctahedronGeometry(0.3, 0), mat));
    const beam = new T.Mesh(
      new T.CylinderGeometry(0.25, 0.25, 6, 10, 1, true),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide }),
    );
    beam.position.y = 2.6;
    g.add(beam);
    return g;
  }
  updateDrops(state) {
    const seen = new Set();
    for (const d of state.relics || []) {
      seen.add(d.id);
      let m = this.drops.get(d.id);
      if (!m) {
        m = this.relicModel(d.relic);
        this.root.add(m);
        this.drops.set(d.id, m);
      }
      m.position.set(d.x, d.y + Math.sin(this.clock * 2) * 0.12, d.z);
      m.rotation.y = this.clock * 1.4;
    }
    for (const [id, m] of this.drops)
      if (!seen.has(id)) {
        this.root.remove(m);
        this.drops.delete(id);
      }
  }
  // Frozen players are encased in ice.
  updateIce(state, localId) {
    const seen = new Set();
    for (const p of state.players) {
      if (!(p.frozen > 0) || p.hp <= 0 || p.id === localId) continue;
      seen.add(p.id);
      let m = this.ice.get(p.id);
      if (!m) {
        m = new T.Mesh(this.iceGeo, this.iceMat);
        this.root.add(m);
        this.ice.set(p.id, m);
      }
      m.position.set(p.x, p.y + 1.02, p.z);
    }
    for (const [id, m] of this.ice)
      if (!seen.has(id)) {
        this.root.remove(m);
        this.ice.delete(id);
      }
  }
  // ——— Portals: each shows the view out of its partner, rendered from a virtual camera. ———
  portalFrame(p) {
    const o = new T.Object3D();
    o.position.set(p.x, p.y, p.z);
    const n = new T.Vector3(p.nx, p.ny, p.nz);
    if (Math.abs(n.y) > 0.5) o.up.set(0, 0, 1);
    o.lookAt(o.position.clone().add(n));
    o.updateMatrixWorld(true);
    return o;
  }
  makePortal(which) {
    const g = new T.Group(),
      surface = new T.Mesh(
        new T.CircleGeometry(1, 40),
        new T.ShaderMaterial({
          uniforms: { map: { value: null }, live: { value: 0 }, color: { value: new T.Color(PORTAL_COLORS[which]) }, res: { value: new T.Vector2(1, 1) }, time: { value: 0 } },
          vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: `uniform sampler2D map;uniform float live;uniform vec3 color;uniform vec2 res;uniform float time;varying vec2 vUv;
          void main(){vec2 s=gl_FragCoord.xy/res;float r=length(vUv-0.5)*2.0;
          vec3 swirl=color*(0.35+0.25*sin(atan(vUv.y-0.5,vUv.x-0.5)*5.0+time*3.0-r*9.0));
          vec3 c=live>0.5?texture2D(map,s).rgb:swirl;
          c=mix(c,color*1.4,smoothstep(0.8,1.0,r));
          gl_FragColor=vec4(c,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
        }),
      ),
      rim = new T.Mesh(new T.TorusGeometry(1, 0.06, 6, 48), new T.MeshBasicMaterial({ color: PORTAL_COLORS[which] }));
    g.add(surface, rim);
    g.userData.surface = surface;
    this.root.add(g);
    return g;
  }
  updatePortals(state, camera) {
    const seen = new Set();
    this.activePortals = [];
    for (const [owner, pair] of Object.entries(state.portals || {}))
      for (const which of ['a', 'b']) {
        const p = pair[which];
        if (!p) continue;
        const key = owner + ':' + which;
        seen.add(key);
        let g = this.portalMeshes.get(key);
        if (!g) {
          g = this.makePortal(which);
          this.portalMeshes.set(key, g);
        }
        const frame = this.portalFrame(p);
        g.position.copy(frame.position);
        g.quaternion.copy(frame.quaternion);
        const floor = Math.abs(p.ny) > 0.5;
        g.scale.set(floor ? 0.95 : 0.7, floor ? 0.95 : 1.15, 1);
        g.userData.surface.material.uniforms.time.value = this.clock;
        const other = pair[which === 'a' ? 'b' : 'a'];
        g.userData.surface.material.uniforms.live.value = 0;
        if (other && camera.position.distanceTo(g.position) < 45) this.activePortals.push({ g, from: p, to: other });
      }
    for (const [key, g] of this.portalMeshes)
      if (!seen.has(key)) {
        this.root.remove(g);
        g.traverse((o) => o.isMesh && (o.geometry.dispose(), o.material.dispose()));
        this.portalMeshes.delete(key);
      }
  }
  // Called just before the main render: draw the view through (at most two) visible portals into render targets.
  renderPortals(renderer, camera) {
    if (!this.activePortals?.length) return;
    const size = renderer.getDrawingBufferSize(new T.Vector2()),
      w = Math.max(64, Math.floor(size.x / 2)),
      h = Math.max(64, Math.floor(size.y / 2));
    this.portalTargets ||= [0, 1].map(() => new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType }));
    for (const t of this.portalTargets) if (t.width !== w || t.height !== h) t.setSize(w, h);
    const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = this.activePortals
      .filter((p) => frustum.intersectsSphere(new T.Sphere(p.g.position, 1.3)))
      .sort((a, b) => a.g.position.distanceTo(camera.position) - b.g.position.distanceTo(camera.position))
      .slice(0, 2);
    if (!visible.length) return;
    const virtual = this.virtualCamera || (this.virtualCamera = new T.PerspectiveCamera());
    virtual.copy(camera);
    const flip = new T.Matrix4().makeRotationY(Math.PI),
      shadows = renderer.shadowMap.autoUpdate,
      oldTarget = renderer.getRenderTarget(),
      oldClip = renderer.clippingPlanes,
      hidden = [...this.portalMeshes.values()];
    renderer.shadowMap.autoUpdate = false;
    for (const g of hidden) g.visible = false;
    visible.forEach((p, i) => {
      const inFrame = this.portalFrame(p.from),
        outFrame = this.portalFrame(p.to),
        m = new T.Matrix4()
          .copy(outFrame.matrixWorld)
          .multiply(flip)
          .multiply(inFrame.matrixWorld.clone().invert())
          .multiply(camera.matrixWorld);
      m.decompose(virtual.position, virtual.quaternion, virtual.scale);
      virtual.updateMatrixWorld(true);
      const n = new T.Vector3(p.to.nx, p.to.ny, p.to.nz),
        at = new T.Vector3(p.to.x, p.to.y, p.to.z);
      renderer.clippingPlanes = [new T.Plane(n, -n.dot(at) - 0.02)];
      renderer.setRenderTarget(this.portalTargets[i]);
      renderer.clear();
      renderer.render(this.scene, virtual);
      const u = p.g.userData.surface.material.uniforms;
      u.map.value = this.portalTargets[i].texture;
      u.live.value = 1;
      u.res.value.set(size.x, size.y);
    });
    renderer.clippingPlanes = oldClip;
    renderer.setRenderTarget(oldTarget);
    renderer.shadowMap.autoUpdate = shadows;
    for (const g of hidden) g.visible = true;
  }
  dispose() {
    this.scene.remove(this.root);
    for (const t of this.portalTargets || []) t.dispose();
  }
}
