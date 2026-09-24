import { COSMETICS, appearance } from './cosmetics.js';
import { CombatEffects } from './effects.js';
import { groundChunks, makeSky, makeWater, detailMaterial, makeEnvironment, setSurfaceQuality, WORLD } from './materials.js';
import { Scenery } from './scenery.js';
import { chimneyOf } from './roofs.js';
import { Nature } from './nature.js';
import { GrassField } from './grass.js';
import { ChestField } from './chests.js';
import { BossViews } from './boss-view.js';
import { syncDestruction } from './destruction.js';
import { groundHeight } from './terrain.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradePass, WeaponPass, sanitizeGrade, isNeutral } from './grading.js';
import { direction, EYE_HEIGHT } from './combat.js';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWorld, DEFAULT_SEED, WEAPONS, mapSize } from './world.js';
import { RARITIES, GEAR } from './catalog.js';
import { model, character, gun, gearModel, chestModel, CHARACTER_GUNS, ALL_CHARACTER_GUNS } from './assets.js';
// Length (m) of mounted third-person models relative to the rig's rifle.
const MOUNT_SCALE = { katana: 1.25, crossbow: 0.85, minigun: 1.05 };
function localSize(object) {
  const c = object.clone(true);
  c.position.set(0, 0, 0);
  c.quaternion.identity();
  c.scale.set(1, 1, 1);
  c.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(c);
  return { size: box.getSize(new T.Vector3()), center: box.getCenter(new T.Vector3()) };
}
function tintObject(root, color) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.tintMaterials) {
      const original = Array.isArray(o.material) ? o.material : [o.material];
      o.userData.tintMaterials = original.map((m) => {
        const c = m.clone();
        c.userData.baseColor = m.color?.clone();
        return c;
      });
      o.material = Array.isArray(o.material) ? o.userData.tintMaterials : o.userData.tintMaterials[0];
    }
    for (const m of o.userData.tintMaterials) if (m.color) m.color.copy(m.userData.baseColor).multiply(color);
  });
}
// Weapon patterns: they repaint the cloned tint materials, so a pattern always sits on top of the colour.
const PATTERNS = {
  stripes: { emissive: 0xffd27a, ei: 0.3, alt: 0.35 },
  carbon: { multiply: 0x6d7a80, metalness: 0.85, roughness: 0.18 },
  camo: { alt: 0.5, altColor: 0x6f8248 },
  neon: { emissive: 'finish', ei: 0.6, metalness: 0.4 },
  tiger: { emissive: 0xffa32e, ei: 0.45, alt: 0.3, altColor: 0x3a2a14 },
};
function applyPattern(root, id, finishColor) {
  const spec = PATTERNS[id];
  root.traverse((o) => {
    const list = o.userData?.tintMaterials;
    if (!list) return;
    list.forEach((m, i) => {
      if (m.emissive) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
      if (!spec) return;
      // Alternate materials carry the pattern: two-tone bodies, stripes, camo blotches.
      const alt = (i + (o.id % 2)) % 2 === 1;
      if (spec.multiply) m.color.multiply(new T.Color(spec.multiply));
      if (alt && spec.alt) m.color.multiplyScalar(spec.alt);
      if (alt && spec.altColor) m.color.lerp(new T.Color(spec.altColor), 0.6);
      if (spec.emissive && m.emissive) {
        m.emissive.copy(spec.emissive === 'finish' ? finishColor : new T.Color(spec.emissive));
        m.emissiveIntensity = spec.ei;
      }
      if (spec.metalness !== undefined) m.metalness = spec.metalness;
      if (spec.roughness !== undefined) m.roughness = spec.roughness;
    });
  });
}
// Weapon charms: a tiny trinket hanging under the grip.
function charmMesh(id, scale = 1) {
  const spec = COSMETICS.find((c) => c.id === id);
  if (!spec || id === 'nocharm') return null;
  const color = new T.Color(spec.color),
    mat = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4, flatShading: true }),
    geo =
      id === 'cube'
        ? new T.BoxGeometry(1, 1, 1)
        : id === 'skull'
          ? new T.DodecahedronGeometry(0.62, 0)
          : id === 'star'
            ? new T.OctahedronGeometry(0.7, 0)
            : id === 'bell'
              ? new T.ConeGeometry(0.6, 1, 6)
              : new T.TetrahedronGeometry(0.75, 0),
    group = new T.Group(),
    mesh = new T.Mesh(geo, mat),
    cordMat = new T.MeshBasicMaterial({ color: 0x3a3a3a }),
    cord = new T.Mesh(new T.BoxGeometry(0.12, 1.1, 0.12), cordMat);
  cord.position.y = 0.55;
  group.add(cord, mesh);
  group.scale.setScalar(scale);
  group.userData.charm = true;
  return group;
}
// Accessories worn on the head.
function accessoryMesh(id) {
  const spec = COSMETICS.find((c) => c.id === id);
  if (!spec || id === 'noaccessory') return null;
  const color = new T.Color(spec.color),
    mat = new T.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true }),
    g = new T.Group();
  const add = (geo, x, y, z, m = mat) => {
    const mesh = new T.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  if (id === 'cap') {
    add(new T.CylinderGeometry(0.19, 0.2, 0.09, 8), 0, 0.12, 0);
    add(new T.BoxGeometry(0.26, 0.03, 0.2), 0, 0.09, 0.19);
  } else if (id === 'visor') {
    const glass = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.2 });
    add(new T.BoxGeometry(0.34, 0.09, 0.05), 0, 0.03, 0.17, glass);
  } else if (id === 'antenna') {
    add(new T.CylinderGeometry(0.012, 0.012, 0.42, 5), 0.08, 0.3, -0.02);
    const tip = new T.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff5a4a, emissiveIntensity: 0.8 });
    add(new T.SphereGeometry(0.035, 6, 6), 0.08, 0.5, -0.02, tip);
  } else if (id === 'horns') {
    for (const s of [-1, 1]) {
      const horn = add(new T.ConeGeometry(0.06, 0.24, 6), s * 0.13, 0.17, 0);
      horn.rotation.z = s * -0.5;
    }
  } else if (id === 'halo') {
    const glow = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    add(new T.TorusGeometry(0.17, 0.02, 6, 20), 0, 0.33, 0, glow).rotation.x = Math.PI / 2;
  }
  return g;
}
function disposeTint(root) {
  root.traverse((o) => {
    for (const m of o.userData.tintMaterials || []) m.dispose();
  });
}
const palette = { grass: 0x90a485, road: 0x7d8a87 };
// Uniform colours for randomised bot skins (applied to clothing materials only).
const UNIFORM_MATERIALS = ['Character_Main', 'Pants', 'Hazmat_Main', 'Enemy_Red'];
const UNIFORM_TINTS = [0xb8a276, 0x7b8790, 0x3d5a8a, 0x6f8246, 0xa0413b, 0xe6e8e2, 0x3a3a3e, 0x7d5aa0];
// Recolours only the uniform materials of a character (skin, gear and weapons keep their colours).
export function applyUniformTint(body, tint) {
  if (!Number.isInteger(tint)) return;
  const color = new T.Color(UNIFORM_TINTS[tint % UNIFORM_TINTS.length]);
  body.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map((m) => {
      if (!UNIFORM_MATERIALS.includes(m.name)) return m;
      const c = m.clone();
      c.color.copy(color).multiplyScalar(0.55);
      c.userData.ownedTint = true;
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
}
// First-person reload motions per weapon family.
const RELOAD_STYLE = {
  shotgun: 'shells',
  revolver: 'cylinder',
  handcannon: 'cylinder',
  rocket: 'tube',
  grenadelauncher: 'shells',
  crossbow: 'tube',
  dagger: 'draw',
};
function reloadPose(style, t) {
  const p = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  if (t < 0 || style === 'none') return p;
  const inOut = Math.sin(Math.PI * t); // 0 → 1 → 0
  if (style === 'mag') {
    p.y = -inOut * 0.1;
    p.rx = inOut * 0.25;
    p.rz = -inOut * 0.55;
  } else if (style === 'shells') {
    // Tilt, then a pump for each shell pushed in.
    p.rz = inOut * 0.4;
    p.rx = inOut * 0.15;
    p.z = Math.max(0, Math.sin(t * Math.PI * 8)) * 0.035 * inOut;
    p.y = -inOut * 0.06;
  } else if (style === 'cylinder') {
    p.rz = -inOut * 1.05;
    p.x = -inOut * 0.08;
    p.y = -inOut * 0.04;
    p.ry = inOut * 0.2;
  } else if (style === 'tube') {
    p.rx = -inOut * 0.7;
    p.y = -inOut * 0.2;
  } else if (style === 'draw') {
    // A new dagger comes up from the belt.
    p.y = -inOut * 0.45;
    p.rx = inOut * 0.6;
  }
  return p;
}
// Destruction only grows during a match (damaged-cell masks can vanish when their wall falls, so they don't count).
const destructionCount = (d) =>
  (d.panels?.length || 0) +
  (d.decor?.length || 0) +
  (d.buildings?.length || 0) +
  (d.wrecks?.length || 0) +
  (d.props?.length || 0) +
  (d.roofs?.length || 0) +
  Object.keys(d.storeys || {}).length;
export class View {
  constructor(canvas) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0xc5d9cc);
    // Aerial haze in the horizon colour of the sky.
    this.scene.fog = new T.Fog(new T.Color().setRGB(0.5, 0.62, 0.77, T.LinearSRGBColorSpace), 95, 245);
    this.sky = makeSky();
    this.scene.add(this.sky);
    // Image-based light and reflections from the sky (glass, cars, wet-looking asphalt, metal).
    this.envTarget = makeEnvironment(this.renderer);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.85;
    this.camera = new T.PerspectiveCamera(43, 1, 0.15, 450);
    this.camera.position.set(0, 65, 64);
    this.camera.lookAt(0, 0, 0);
    this.materials = new Map();
    this.cube = new T.BoxGeometry(1, 1, 1);
    this.people = new Map();
    this.waters = [];
    this.chestViews = new Map();
    this.rocketViews = new Map();
    this.hemi = new T.HemisphereLight(0xc5e5ef, 0x85835d, 0.55);
    this.scene.add(this.hemi);
    this.sun = new T.DirectionalLight(0xffe4be, 3.2);
    this.sun.position.set(-70, 130, 70);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(
      matchMedia('(pointer:coarse)').matches ? 1024 : 2048,
      matchMedia('(pointer:coarse)').matches ? 1024 : 2048,
    );
    Object.assign(this.sun.shadow.camera, { left: -145, right: 145, top: 140, bottom: -140, near: 1, far: 360 });
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.bias = -0.0001;
    this.scene.add(this.sun, this.sun.target);
    this.zoneWall = new T.Mesh(
      new T.CylinderGeometry(1, 1, 1, 96, 1, true),
      new T.MeshBasicMaterial({
        color: 0x66caff,
        transparent: true,
        opacity: 0.16,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.zoneWall.visible = false;
    this.scene.add(this.zoneWall);
    this.zoneLine = new T.Mesh(
      new T.RingGeometry(0.996, 1, 128),
      new T.MeshBasicMaterial({
        color: 0x87dfff,
        transparent: true,
        opacity: 0.9,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.zoneLine.rotation.x = -Math.PI / 2;
    this.zoneLine.visible = false;
    this.scene.add(this.zoneLine);
    this.setWorld(DEFAULT_SEED);
    this.fx = new CombatEffects(this.scene, this.map);
    this.makeViewWeapon();
    this.setQuality('auto');
    this.resize();
  }
  mat(color) {
    if (!this.materials.has(color))
      this.materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }));
    return this.materials.get(color);
  }
  box(x, y, z, w, h, d, color, parent = this.terrain || this.scene) {
    const m = new T.Mesh(this.cube, color?.isMaterial ? color : this.mat(color));
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  // A horizontal quad (road paint): two triangles instead of a box.
  flat(x, y, z, w, d, material, parent = this.terrain || this.scene) {
    this.flatGeo ??= new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new T.Mesh(this.flatGeo, material);
    m.position.set(x, y, z);
    m.scale.set(w, 1, d);
    parent.add(m);
    return m;
  }
  text(label, w = 3, h = 0.55, color = '#f7e5be', bg = '#29464a') {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = color;
    g.font = 'bold 44px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 256, 50, 490);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex }));
    m.userData.ownedTexture = true;
    return m;
  }
  setWorld(seed, size = 'district') {
    if (this.map?.seed === seed && this.map?.size === mapSize(size)) return;
    if (this.terrain) {
      this.scene.remove(this.terrain);
      const shared = new Set();
      this.terrain.traverse((o) => {
        if (o.userData.batched || o.userData.ownedTexture || o.userData.standalone) o.geometry?.dispose();
        if (o.userData.sharedMaterial) shared.add(o.material);
        else if (o.userData.standalone) o.material.dispose();
        if (o.userData.props) o.dispose();
        if (o.userData.ownedTexture) {
          o.material.map.dispose();
          o.material.dispose();
        }
      });
      for (const m of shared) m.dispose();
    }
    for (const v of this.chestViews.values()) this.disposeLoot(v);
    this.chestViews.clear();
    this.map = createWorld(seed, size);
    this.fx?.reset(this.map);
    this.waters = [];
    this.terrain = new T.Group();
    this.scene.add(this.terrain);
    this.scenery?.dispose();
    this.scenery = this.useAssets === false ? null : new Scenery(this.scene, this.map);
    if (this.scenery) this.scenery.culler.lite = !!this.lite;
    this.world();
    this.batchStatic();
    this.grass?.dispose();
    this.grass = new GrassField(this.map, this.scene, this.lite);
    this.collapsing = new Set();
    this.burning = new Set();
    this.chimneys = this.map.buildings
      .map((b) => [b, chimneyOf(b)])
      .filter(([, c]) => c)
      .map(([b, c]) => ({ b, x: c.x, y: c.top + 0.3, z: c.z, clock: Math.random() }));
    this.shake = 0;
  }
  world() {
    const map = this.map || createWorld(DEFAULT_SEED),
      parent = this.terrain || this.scene,
      L = map.limit;
    // Skirt under the whole district, deep enough to stay below the quarry pit.
    this.box(0, -5, 0, L.x * 2 + 6, 1.2, L.z * 2 + 6, 0x788574);
    parent.add(groundChunks(map));
    const asphalt = detailMaterial('asphalt', palette.road, { box: true, strength: 0.85, roughness: 0.85 }),
      paving = detailMaterial('paving', 0xd9d2bd, { box: true, strength: 0.7 }),
      dirtPath = detailMaterial('dirt', 0xaa9576, { box: true, strength: 0.7 }),
      // Road paint keeps the asphalt's grain and cracks.
      marking = detailMaterial('asphalt', 0xf2eee2, { box: true, albedo: 0, strength: 0.9, key: 'paint', roughness: 0.7 });
    for (const r of map.roads) {
      this.box(r.x, 0.03, r.z, r.w, 0.06, r.d, asphalt);
      // Dashed centre line along straight segments.
      if (r.w !== r.d)
        for (let t = -Math.max(r.w, r.d) / 2 + 1.5; t < Math.max(r.w, r.d) / 2 - 1; t += 3)
          r.w > r.d ? this.flat(r.x + t, 0.062, r.z, 1.4, 0.14, marking) : this.flat(r.x, 0.062, r.z + t, 0.14, 1.4, marking);
    }
    for (const r of map.paths) this.box(r.x, 0.035, r.z, r.w, 0.04, r.d, r.color === 0xaa9576 ? dirtPath : paving);
    for (const water of map.waters) {
      const mesh = makeWater(water);
      parent.add(mesh);
      this.waters?.push(mesh);
    }
    this.signs = new Map();
    const floors = {
      home: detailMaterial('wood', 0xc9ab86, { box: true, strength: 0.75, roughness: 0.6 }),
      office: detailMaterial('wood', 0xb8a58c, { box: true, strength: 0.6, roughness: 0.6 }),
      shop: detailMaterial('tiles', 0xd8d2c4, { box: true, strength: 0.35, roughness: 0.5 }),
      industry: detailMaterial('concrete', 0xb8b6ad, { box: true, strength: 0.7 }),
    };
    const sidewalk = detailMaterial('sidewalk', 0xb0b5a1, { box: true, strength: 0.6 }),
      curb = detailMaterial('concrete', 0xc9c5ba, { box: true, key: 'curb' });
    for (const b of map.buildings) {
      this.box(b.x, 0.012, b.z, b.w + 2, 0.025, b.d + 2, sidewalk);
      // Kerb stones along the edge of the pavement.
      for (const s of [-1, 1]) {
        this.box(b.x, 0.04, b.z + s * (b.d / 2 + 1), b.w + 2.2, 0.08, 0.2, curb);
        this.box(b.x + s * (b.w / 2 + 1), 0.04, b.z, 0.2, 0.08, b.d + 2, curb);
      }
      this.box(b.x, 0.025, b.z, b.w - 0.4, 0.04, b.d - 0.4, floors[b.category] || floors.home);
      const sign = this.text(b.sign.toUpperCase(), Math.min(b.w - 1, 5), 0.52);
      sign.position.set(b.x, 3.25, b.z + b.d / 2 + 0.04);
      parent.add(sign);
      this.signs.set(b.id, sign);
    }
    // Walls, furniture and street props live in Scenery. The pond rims are stone; trees, rocks, cacti, logs, hay, crates, benches and plants are the Nature field.
    const rim = detailMaterial('paving', 0xbfb8a8, { box: true, key: 'rim' });
    for (const o of map.obstacles) if (o.part === 'pond') this.box(o.x, o.y, o.z, o.w, o.h, o.d, rim);
    this.nature = this.scenery ? new Nature(map, this.scenery) : null;
    const boundary = detailMaterial('concrete', 0x8f9a92, { box: true, key: 'boundary' });
    for (const z of [-L.z, L.z]) this.box(0, 1, z, L.x * 2, 2, 0.25, boundary);
    for (const x of [-L.x, L.x]) this.box(x, 1, 0, 0.25, 2, L.z * 2, boundary);
  }
  batchStatic() {
    this.terrain.updateMatrixWorld(true);
    const batches = new Map(),
      remove = [];
    // Merged per material and per 128 m chunk: few draw calls, and chunks out of view are frustum-culled.
    this.terrain.traverse((o) => {
      if (!o.isMesh || o.userData.ownedTexture || o.userData.standalone || o.userData.props || Array.isArray(o.material)) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld),
        chunk = Math.floor(o.position.x / 128) + ':' + Math.floor(o.position.z / 128);
      const key = o.material.uuid + ':' + Object.keys(geo.attributes).sort().join(',') + ':' + !!geo.index + ':' + chunk;
      if (!batches.has(key)) batches.set(key, { material: o.material, geometries: [] });
      batches.get(key).geometries.push(geo);
      remove.push(o);
    });
    for (const o of remove) {
      o.removeFromParent();
      if (o.userData.generated) o.geometry.dispose();
    }
    for (const b of batches.values()) {
      const geometry = mergeGeometries(b.geometries);
      if (geometry) {
        const m = new T.Mesh(geometry, b.material);
        geometry.computeBoundingBox();
        // Flat things (roads, pavements, paint, kerbs, floors) cast no shadow worth a draw call.
        m.castShadow = geometry.boundingBox.max.y - geometry.boundingBox.min.y > 0.5;
        m.receiveShadow = true;
        m.userData.batched = true;
        this.terrain.add(m);
      }
      for (const g of b.geometries) g.dispose();
    }
  }
  person(p, local) {
    const root = new T.Group();
    this.scene.add(root);
    const look = appearance(p.cosmetics),
      index = COSMETICS.find((c) => c.id === look.operator).model,
      a = character(index),
      body = a.model;
    root.add(body);
    applyUniformTint(body, p.cosmetics?.tint);
    const mount = body.getObjectByName('AK'),
      old = body.getObjectByName('ShortCannon');
    if (mount && old) {
      const heavy = new T.Group();
      heavy.name = 'ShortCannon';
      heavy.position.copy(mount.position);
      heavy.quaternion.copy(mount.quaternion);
      heavy.scale.copy(mount.scale);
      const mesh = model('lmg');
      mesh.rotation.y = -Math.PI / 2;
      mesh.scale.setScalar(1.3);
      mesh.position.set(-0.25, 0.05, 0);
      heavy.add(mesh);
      mount.parent.add(heavy);
      old.removeFromParent();
    }
    const guns = [];
    body.traverse((o) => {
      if (ALL_CHARACTER_GUNS.includes(o.name)) {
        guns.push(o);
        o.visible = false;
      }
    });
    // Weapons that are not part of the rig are mounted where the rifle sits, scaled to a matching size.
    const ak = body.getObjectByName('AK');
    if (ak) {
      const ref = localSize(ak);
      for (const w of WEAPONS)
        if (w.char.startsWith('mount:')) {
          const mount = new T.Group(),
            mesh = model(w.model),
            own = localSize(mesh),
            s = (ref.size.x * (MOUNT_SCALE[w.model] || 1)) / Math.max(own.size.x, 0.001);
          mount.name = 'Mount_' + w.model;
          mount.position.copy(ak.position);
          mount.quaternion.copy(ak.quaternion);
          mount.scale.copy(ak.scale);
          mesh.scale.setScalar(s);
          mesh.position.set(ref.center.x - own.center.x * s, ref.center.y - own.center.y * s, -own.center.z * s);
          if (w.melee) mesh.position.x = ref.center.x - (own.center.x + own.size.x * 0.38) * s;
          mount.add(mesh);
          mount.visible = false;
          ak.parent.add(mount);
          guns.push(mount);
        }
    }
    // Back-worn gear. Children of the scaled body, so dimensions are divided by its scale.
    const gear = {};
    for (const g of GEAR) {
      const m = gearModel(g.id);
      m.visible = false;
      m.scale.setScalar(1 / body.scale.x);
      if (g.id === 'jetpack') {
        m.position.set(0, 1.28 / body.scale.x, -0.2 / body.scale.x);
        m.rotation.y = -Math.PI / 2;
      } else {
        m.position.set(0, 2.25 / body.scale.x, 0.05 / body.scale.x);
        m.rotation.y = Math.PI;
      }
      body.add(m);
      gear[g.id] = m;
    }
    // The imported pack includes gun attachments and the matching animated poses.
    const actions = Object.fromEntries(a.clips.map((c) => [c.name, a.mixer.clipAction(c)]));
    const hp = new T.Group();
    hp.position.y = 2.12;
    root.add(hp);
    this.box(0, 0, 0, 0.72, 0.06, 0.025, 0x29474c, hp);
    const bar = this.box(0, 0, 0.02, 0.7, 0.04, 0.03, 0xeea384, hp);
    const ally = !local && !!this.viewTeam && p.team === this.viewTeam,
      label = this.text(local ? 'YOU' : p.name, 0.8, 0.16, ally ? '#b6f5d6' : '#f7e5be', ally ? '#2f6b55' : '#29464a');
    label.position.y = 2.37;
    root.add(label);
    // Accessory on the head bone, charm under the grip of every weapon.
    const head = body.getObjectByName('Head'),
      accessory = accessoryMesh(look.accessory);
    if (head && accessory) {
      accessory.scale.setScalar(1 / body.scale.x);
      accessory.position.y = 0.06 / body.scale.x;
      head.add(accessory);
    }
    for (const g of guns) {
      const box = localSize(g),
        charm = charmMesh(look.charm, Math.max(0.02, box.size.y * 0.35));
      if (charm) {
        charm.position.set(box.center.x, box.center.y - box.size.y * 0.55, box.center.z);
        g.add(charm);
      }
    }
    const v = {
      root,
      body,
      mixer: a.mixer,
      actions,
      guns,
      gear,
      hp,
      bar,
      label,
      lastShot: p.shot,
      recoil: 0,
      initialized: false,
      animation: null,
      previousHP: p.hp,
      hitTime: 0,
      operator: look.operator,
      tint: look.tint,
      accessory: look.accessory,
      charm: look.charm,
      pattern: look.pattern,
      effect: look.effect,
      emoteClock: 0,
      ally,
      finish: null,
      air: 0,
      landT: 0,
      dead: 0,
    };
    this.people.set(p.id, v);
    return v;
  }
  // Cosmetic effects that follow a player: a dust trail, sparks, a jade aura, embers.
  cosmeticEffect(v, p, id, dt) {
    const spec = COSMETICS.find((c) => c.id === id);
    if (!spec || !this.fx) return;
    v.fxClock = (v.fxClock || 0) + dt;
    const moving = p.moving > 1.5,
      every = id === 'dust' ? 0.12 : id === 'aura' ? 0.09 : 0.06;
    if (v.fxClock < every) return;
    v.fxClock = 0;
    const color = Number(spec.color.replace('#', '0x')),
      base = { x: p.x, y: (p.y || 0) + 0.06, z: p.z };
    if (id === 'dust') {
      if (moving) this.fx.emit(base, { x: 0, y: 0.5, z: 0 }, color, 0.32, 0.5, { smoke: true, grow: 1.2 });
    } else if (id === 'sparks') {
      if (moving) this.fx.emit({ ...base, y: base.y + 0.3 }, { x: 0, y: 1.6, z: 0 }, color, 0.07, 0.5, { gravity: 2, drag: 1.4 });
    } else if (id === 'embers') {
      this.fx.emit({ x: p.x + (Math.random() - 0.5) * 0.6, y: base.y + 0.4, z: p.z + (Math.random() - 0.5) * 0.6 }, { x: 0, y: 0.9, z: 0 }, color, 0.09, 0.9, { gravity: -0.6, drag: 1.2 });
    } else if (id === 'aura') {
      const a = Math.random() * Math.PI * 2;
      this.fx.emit({ x: p.x + Math.cos(a) * 0.5, y: base.y, z: p.z + Math.sin(a) * 0.5 }, { x: 0, y: 0.7, z: 0 }, color, 0.1, 0.7, { drag: 1.3 });
    }
  }
  animate(v, name) {
    if (v.animation === name) return;
    const action = v.actions[name] || v.actions.Idle;
    if (!action) return;
    v.actions[v.animation]?.fadeOut(0.15);
    action.reset().fadeIn(0.15);
    action.setLoop(name === 'Death' ? T.LoopOnce : T.LoopRepeat, Infinity);
    action.clampWhenFinished = name === 'Death';
    action.play();
    v.animation = name;
  }
  makeViewWeapon() {
    this.weaponScene = new T.Scene();
    this.weaponCamera = new T.PerspectiveCamera(65, 1, 0.01, 10);
    this.weaponScene.add(new T.HemisphereLight(0xfff0dd, 0x426466, 3));
    const light = new T.DirectionalLight(0xffffff, 2);
    light.position.set(-2, 4, 3);
    this.weaponScene.add(light);
    this.fp = new T.Group();
    this.weaponScene.add(this.fp);
    this.fpGuns = [];
    for (let i = 0; i < WEAPONS.length; i++) {
      const g = gun(i),
        w = WEAPONS[i];
      this.fp.add(g);
      if (g.userData.pivot) {
        // One gloved fist around the grip and a sleeve behind it.
        this.box(0.0, -0.01, 0.02, 0.075, 0.085, 0.1, 0xe4bc97, g);
        this.box(0.02, -0.05, 0.14, 0.1, 0.1, 0.2, 0x506e70, g);
      } else {
        this.box(0.04, -0.16, 0.1, 0.105, 0.12, 0.25, 0xe4bc97, g);
        this.box(0.06, -0.17, 0.27, 0.13, 0.14, 0.22, 0x506e70, g);
        if (w.category !== 'secondary') this.box(-0.05, -0.12, -0.13, 0.1, 0.1, 0.18, 0xe4bc97, g);
      }
      const flash = new T.Mesh(new T.OctahedronGeometry(0.09), new T.MeshBasicMaterial({ color: 0xffce75 }));
      flash.position.z = -g.userData.length / 2;
      flash.visible = false;
      if (!w.melee && !w.silent) g.add(flash);
      g.userData.flash = flash;
      if (!w.melee && !RELOAD_STYLE[w.model]) {
        const mag = this.box(0.0, -0.12, -g.userData.length * 0.1, 0.05, 0.16, 0.08, 0x3b3f45, g);
        mag.userData.y = -0.12;
        mag.visible = false;
        g.userData.mag = mag;
      }
      this.fpGuns.push(g);
    }
    this.fpGlider = gearModel('glider');
    this.fpGlider.position.set(0, 0.75, -0.25);
    this.fpGlider.rotation.set(0.25, Math.PI, 0);
    this.fpGlider.scale.setScalar(0.75);
    this.fpGlider.visible = false;
    this.weaponScene.add(this.fpGlider);
    this.swing = 0;
    this.swingSide = 1;
    this.fpPhase = 0;
    this.fpRecoil = 0;
    this.fpShot = -1;
    this.previousWeapon = -1;
    this.swap = 0;
  }
  setCosmetics(value) {
    const look = appearance(value);
    if (this.finish === look.finish && this.pattern === look.pattern && this.charm === look.charm) return;
    const color = new T.Color(COSMETICS.find((c) => c.id === look.finish).color);
    for (const g of this.fpGuns) {
      tintObject(g.children[0], color);
      applyPattern(g.children[0], look.pattern, color);
      if (this.charm !== look.charm) {
        for (const c of [...g.children]) if (c.userData.charm) g.remove(c);
        const box = localSize(g.children[0]),
          charm = charmMesh(look.charm, Math.max(0.02, box.size.y * 0.3));
        if (charm) {
          charm.position.set(box.center.x, box.center.y - box.size.y * 0.45, box.center.z - box.size.z * 0.3);
          g.add(charm);
        }
      }
    }
    this.finish = look.finish;
    this.pattern = look.pattern;
    this.charm = look.charm;
  }
  removePerson(v) {
    this.scene.remove(v.root);
    v.mixer.stopAllAction();
    v.mixer.uncacheRoot(v.body);
    disposeTint(v.body);
    v.body.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.ownedTint) m.dispose();
    });
    v.label.geometry.dispose();
    v.label.material.map.dispose();
    v.label.material.dispose();
  }
  event(e) {
    this.fx.event(e);
    // Remember where recent blasts, bullets and blades struck: knocked-out wall cells fly away from them.
    this.hitSources ??= [];
    const now = performance.now();
    if (e.type === 'explosion') this.hitSources.push({ x: e.x, y: e.y, z: e.z, t: now, strength: 1.6 });
    else if (e.type === 'shot' && e.impact && e.impact.kind !== 'body')
      this.hitSources.push({ x: e.ex + e.impact.x * 0.8, y: e.ey + e.impact.y * 0.8, z: e.ez + e.impact.z * 0.8, t: now, strength: 0.55 });
    else if (e.type === 'impact') this.hitSources.push({ x: e.x, y: e.y, z: e.z, t: now, strength: 0.6 });
    else if (e.type === 'melee' && e.wall) {
      const p = this.lastState?.players?.find((q) => q.id === e.id);
      this.hitSources.push({ x: p ? p.x : e.x, y: e.y, z: p ? p.z : e.z, t: now, strength: 0.8 });
    }
    if (this.hitSources.length > 24) this.hitSources.splice(0, this.hitSources.length - 24);
    if (e.type === 'chunks') this.fx.chunks(e);
    if (e.type === 'break') this.fx.shatter(e);
    if (e.type === 'spawn') {
      this.fx.spawn(e);
      if (e.id === this.localId) this.spawnRaise = true;
    }
    if (e.type === 'break' && e.kind === 'car') this.burning.add(e.decor);
    if (e.type === 'storeyCollapse') {
      this.fx.dust({ ...e, base: e.y });
      (this.collapsingStoreys ??= new Set()).add(e.building + ':' + e.storey);
      const d = Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z);
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / 60) * 0.7);
    }
    if (e.type === 'collapse') {
      this.fx.dust(e);
      this.collapsing.add(e.building);
      const d = Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z);
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / 70) * 0.9);
    }
    if (e.type === 'explosion') {
      const d = Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z);
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / 30) * 0.45);
    }
    if (e.type === 'quake') {
      const d = Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z);
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / 40) * 0.8);
    }
    // A cataclysm rolls over the whole map: everyone feels it.
    if (e.type === 'cataclysm') this.shake = Math.max(this.shake, 1.4);
    if (e.type === 'rift') {
      const d = Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z);
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / 60) * 0.6);
    }
  }
  // Apply authoritative destruction lists: panels, props and cars that broke, buildings that fell.
  syncWorld(state, dt) {
    const changed = syncDestruction(this.map, state.destruction);
    if (!changed || !this.scenery) return;
    const now = performance.now(),
      sourceFor = (p) => {
        let best = null,
          bd = 6;
        for (const s of this.hitSources || []) {
          if (now - s.t > 700) continue;
          const d = Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z);
          if (d < bd) (bd = d), (best = s);
        }
        return best;
      };
    for (const [o, previous] of changed.cells) {
      const { removed, glass } = this.scenery.applyCells(o, previous);
      if (glass) this.fx.glass(glass);
      if (!removed.length) continue;
      this.fx.clearMarks(removed);
      const src = sourceFor(removed[0]);
      this.fx.cells(removed, o.color, src, src?.strength ?? 1);
    }
    for (const id of changed.panels) {
      // A wall that breaks away completely bursts into its blocks (unless its building is coming down anyway).
      const wall = this.scenery.wallOf.get(id);
      if (wall && !changed.buildings.includes(wall.o.building)) {
        const list = this.scenery.standingCells(id),
          src = list.length ? sourceFor(list[Math.floor(list.length / 2)]) : null;
        this.fx.cells(list, wall.o.color, src, src?.strength ?? 1);
        this.fx.clearMarks(list);
        const win = this.scenery.windowOf.get(id);
        if (win && !win.broken) this.fx.glass(win.w);
      }
      this.scenery.hidePanel(id);
    }
    for (const id of changed.decor) this.scenery.hideDecor(id);
    for (const id of changed.wrecks) this.scenery.wreck(id, this.burning.has(id) ? this.fx : null);
    for (const id of changed.props || []) {
      this.nature?.hide(id);
      this.scenery.hideProp(id);
    }
    for (const id of changed.roofs || []) {
      const b = this.map.buildings[id];
      if (this.scenery.uppers.get(id)?.visible) this.fx.cells(this.scenery.roofBlocks(b), b.accent, { x: b.x, y: b.roofBase ?? 4, z: b.z }, 1.1);
      this.scenery.breakRoof(b);
    }
    for (const [id, storey] of changed.storeys || []) {
      const b = this.map.buildings[id],
        animate = !!this.collapsingStoreys?.has(id + ':' + storey);
      if (animate) {
        const list = [];
        for (const pid of this.scenery.panelsFrom(b, storey)) list.push(...this.scenery.standingCells(pid));
        this.fx.cells(list, b.color, { x: b.x, y: 3.84 + (storey - 1) * 3.6 + 1.5, z: b.z }, 0.9);
      }
      this.scenery.collapseStorey(b, storey, animate);
    }
    for (const id of changed.buildings) {
      const b = this.map.buildings[id];
      if (this.collapsing.has(id)) {
        // The ground floor gives way: its walls burst into blocks before the storeys above come down.
        const list = [];
        for (const pid of this.scenery.buildingPanels.get(id) || []) list.push(...this.scenery.standingCells(pid));
        this.fx.cells(list, b.color, { x: b.x, y: 1.2, z: b.z }, 0.9);
      }
      this.scenery.collapse(b, this.collapsing.has(id));
      const sign = this.signs.get(id);
      if (sign) sign.visible = false;
      b.collapsed = true;
    }
    void dt;
  }
  // Loot on the map: closed chests, and dropped weapons floating in a beam of their rarity colour.
  lootView(c) {
    const root = new T.Group();
    root.position.set(c.x, (c.y || 0) + 0.05, c.z);
    this.scene.add(root);
    if (c.kind !== 'drop') {
      const mesh = chestModel();
      root.add(mesh);
      return { root, lid: mesh.getObjectByName('lid'), open: 0 };
    }
    const color = new T.Color(RARITIES[c.loot?.r ?? 0].color),
      spin = new T.Group();
    spin.position.y = 0.75;
    root.add(spin);
    const item = c.loot ? model(WEAPONS[c.loot.w].model) : c.gear ? gearModel(c.gear) : null;
    if (item) {
      const box = new T.Box3().setFromObject(item),
        size = box.getSize(new T.Vector3()),
        center = box.getCenter(new T.Vector3()),
        k = 0.8 / Math.max(size.x, size.y, size.z, 0.01);
      item.scale.multiplyScalar(k);
      item.position.set(-center.x * k, -center.y * k, -center.z * k);
      spin.add(item);
    }
    const beam = new T.Mesh(
      new T.CylinderGeometry(0.16, 0.3, 3.2, 10, 1, true),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false, side: T.DoubleSide }),
    );
    beam.position.y = 1.6;
    root.add(beam);
    const ring = new T.Mesh(
      new T.RingGeometry(0.35, 0.5, 24),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);
    return { root, spin, owned: [beam, ring], drop: true, open: 0 };
  }
  disposeLoot(v) {
    this.scene.remove(v.root);
    for (const m of v.owned || []) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
  projectileView(r) {
    let m;
    if (r.kind === 'dagger') {
      m = new T.Group();
      const d = model('dagger'),
        box = new T.Box3().setFromObject(d),
        size = box.getSize(new T.Vector3()),
        k = 0.34 / Math.max(size.x, size.y, size.z);
      d.scale.multiplyScalar(k);
      m.add(d);
      m.userData.spin = d;
    } else {
      const geometry =
        r.kind === 'grenade' || r.kind === 'handgrenade'
          ? new T.IcosahedronGeometry(r.kind === 'handgrenade' ? 0.13 : 0.09, 0)
          : r.kind === 'c4'
            ? new T.BoxGeometry(0.24, 0.08, 0.18)
            : r.kind === 'bolt'
              ? new T.CylinderGeometry(0.015, 0.015, 0.55, 5)
              : new T.ConeGeometry(0.09, 0.45, 6);
      m = new T.Mesh(
        geometry,
        this.mat(r.kind === 'c4' ? 0x4c5148 : r.kind === 'grenade' || r.kind === 'handgrenade' ? 0x57704a : r.kind === 'bolt' ? 0x8a6a45 : 0xffc47e),
      );
      m.userData.ownGeometry = true;
    }
    this.scene.add(m);
    return m;
  }
  updateLoot(state, dt) {
    // Chests are instanced (two draw calls for the map); dropped loot keeps its own spinning model and beam.
    this.chestField ??= new ChestField(this.scene);
    const culler = this.scenery?.culler,
      cam = this.camera.position,
      far = (this.viewDistance || 250) + 20;
    this.chestField.update(
      (state.chests || []).filter((c) => c.kind !== 'drop'),
      dt,
      (c) => Math.hypot(c.x - cam.x, c.z - cam.z) > far || !!culler?.hides(c.x, c.y || 0, (c.y || 0) + 1.3, c.z),
    );
    const chestIds = new Set();
    for (const c of state.chests || []) {
      if (c.kind !== 'drop' || c.opened) continue;
      chestIds.add(c.id);
      let v = this.chestViews.get(c.id);
      if (!v) {
        v = this.lootView(c);
        this.chestViews.set(c.id, v);
      }
      if (v.drop) v.spin.rotation.y += dt * 1.6;
      else {
        v.open = T.MathUtils.damp(v.open, c.opened ? 1 : 0, 9, dt);
        if (v.lid) v.lid.rotation.z = v.open * -1.6;
      }
    }
    for (const [id, v] of this.chestViews)
      if (!chestIds.has(id)) {
        this.disposeLoot(v);
        this.chestViews.delete(id);
      }
    const ids = new Set();
    for (const r of state.projectiles || []) {
      ids.add(r.id);
      let m = this.rocketViews.get(r.id);
      if (!m) {
        m = this.projectileView(r);
        this.rocketViews.set(r.id, m);
      }
      m.position.set(r.x, r.y, r.z);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(r.dx, r.dy, r.dz));
      if (m.userData.spin) m.userData.spin.rotation.z += dt * 25;
    }
    for (const [id, m] of this.rocketViews)
      if (!ids.has(id)) {
        m.removeFromParent();
        if (m.userData.ownGeometry) m.geometry.dispose();
        this.rocketViews.delete(id);
      }
  }
  // Auto quality: when frames stay slow the render resolution drops in steps (to 60 %), and climbs back when
  // there is headroom. Uses real frame time, measured here.
  adapt(menu) {
    const now = performance.now(),
      ft = this.lastFrameAt ? now - this.lastFrameAt : 16;
    this.lastFrameAt = now;
    if (this.quality !== 'auto' || menu || ft > 250) return;
    this.frameAvg = (this.frameAvg ?? 16) * 0.95 + ft * 0.05;
    this.adaptClock = (this.adaptClock || 0) + ft;
    if (this.adaptClock < 2000) return;
    this.adaptClock = 0;
    const cur = this.dynamicScale ?? 1;
    let next = cur;
    if (this.frameAvg > 24) next = Math.max(0.6, cur - 0.1);
    else if (this.frameAvg < 14) next = Math.min(1, cur + 0.1);
    if (next !== cur) {
      this.dynamicScale = next;
      this.renderer.setPixelRatio(this.basePixelRatio * (this.resolution || 1) * next);
      this.resize();
    }
  }
  update(state, id, dt, menu = false, look = { angle: 0, pitch: 0 }) {
    this.adapt(menu);
    this.lastState = state;
    WORLD.time.value = (WORLD.time.value + dt) % 3600;
    // A new match on the same map starts with fewer destroyed things than this view shows: rebuild the world.
    if (state.destruction && this.map?.applied && destructionCount(state.destruction) < this.appliedCount) this.map = null;
    this.setWorld(state.seed || DEFAULT_SEED, state.size);
    if (state.destruction) this.appliedCount = destructionCount(state.destruction);
    if (this.lastRound !== state.round) {
      this.fx.reset(this.map);
      this.lastRound = state.round;
    }
    this.viewTeam = state.players.find((p) => p.id === id)?.team;
    this.localId = id;
    const me = state.players.find((p) => p.id === id),
      fov = menu ? 50 : look.aim ? WEAPONS[me?.weapon]?.zoom || 55 : 75;
    if (this.camera.fov !== fov) {
      this.camera.fov = T.MathUtils.damp(this.camera.fov, fov, 14, dt);
      this.camera.updateProjectionMatrix();
    }
    if (menu || !me) {
      this.camera.position.set(52, 115, 104);
      this.camera.lookAt(0, 0, 0);
    } else {
      const d = direction(look.angle, look.pitch),
        ground = groundHeight(me.x, me.z, this.map);
      // Landing dip and a falling death camera for the player being viewed.
      if (!me.grounded && me.y - ground > 0.12) this.camAir = (this.camAir || 0) + dt;
      else {
        if ((this.camAir || 0) > 0.45) this.land = Math.min(1, this.camAir * 0.8);
        this.camAir = 0;
      }
      this.deathT = me.hp <= 0 ? (this.deathT || 0) + dt : 0;
      const fall = Math.min(1, this.deathT / 0.7),
        ease = fall * fall * (3 - 2 * fall);
      this.camera.position.set(me.x, (me.y || 0) + EYE_HEIGHT - ease * 1.25 - (this.land || 0) * 0.18, me.z);
      this.camera.lookAt(me.x + d.x, this.camera.position.y + d.y - ease * 0.3, me.z + d.z);
      if (ease > 0) this.camera.rotation.z += ease * 0.7;
      if (this.shake > 0.01) {
        const k = this.shake * 0.06;
        this.camera.position.x += (Math.random() - 0.5) * k;
        this.camera.position.y += (Math.random() - 0.5) * k;
        this.camera.rotation.z += (Math.random() - 0.5) * k * 0.4;
      }
    }
    // Flashback: the camera replays this player's own view from about 20 s earlier.
    this.clockT = (this.clockT || 0) + dt;
    this.history ||= [];
    if (me && !menu && me.hp > 0 && !(me.flashback > 0)) {
      this.fbStart = null;
      if (!this.history.length || this.clockT - this.history[this.history.length - 1].t > 0.1)
        this.history.push({ t: this.clockT, p: this.camera.position.clone(), q: this.camera.quaternion.clone() });
      while (this.history.length && this.clockT - this.history[0].t > 40) this.history.shift();
    } else if (me?.flashback > 0 && this.history.length) {
      this.fbStart ??= this.clockT;
      const want = this.fbStart - 20 + (this.clockT - this.fbStart),
        k = Math.max(0, this.history.findIndex((h) => h.t >= want)),
        h = this.history[k];
      this.camera.position.copy(h.p);
      this.camera.quaternion.copy(h.q);
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    // A fixed sun projection keeps shadows stable while looking and walking.
    if (me) this.setCosmetics(me.cosmetics);
    this.zoneWall.visible = this.zoneLine.visible = !!state.zone;
    if (state.zone) {
      const z = state.zone;
      this.zoneWall.position.set(z.x, 10, z.z);
      this.zoneWall.scale.set(z.radius, 20, z.radius);
      this.zoneLine.position.set(z.x, 0.085, z.z);
      this.zoneLine.scale.setScalar(z.radius);
    }
    for (const p of state.players) {
      const look = appearance(p.cosmetics),
        old = this.people.get(p.id);
      const ally = p.id !== id && !!this.viewTeam && p.team === this.viewTeam;
      if (
        old &&
        (old.operator !== look.operator ||
          old.tint !== look.tint ||
          old.accessory !== look.accessory ||
          old.charm !== look.charm ||
          old.ally !== ally)
      ) {
        this.removePerson(old);
        this.people.delete(p.id);
      }
      const v = this.people.get(p.id) || this.person(p, p.id === id),
        weight = v.initialized ? 1 - Math.exp(-dt * 19) : 1;
      v.initialized = true;
      if (v.finish !== look.finish || v.pattern !== look.pattern) {
        const color = new T.Color(COSMETICS.find((c) => c.id === look.finish).color);
        for (const g of v.guns) {
          tintObject(g, color);
          applyPattern(g, look.pattern, color);
        }
        v.finish = look.finish;
        v.pattern = look.pattern;
      }
      // Characters behind a solid building are not drawn (the occlusion horizon of the scenery).
      v.root.visible =
        (menu || p.id !== id) &&
        !p.inBus &&
        Math.hypot(p.x - this.camera.position.x, p.z - this.camera.position.z) < (this.viewDistance || 250) &&
        !(this.scenery?.culler.hides(p.x, p.y || 0, (p.y || 0) + 2.4, p.z) ?? false);
      v.root.position.lerp(
        new T.Vector3(p.x, p.y || 0, p.z),
        Math.hypot(v.root.position.x - p.x, v.root.position.z - p.z) > 8 ? 1 : weight,
      );
      const diff = Math.atan2(Math.sin(p.angle - v.body.rotation.y), Math.cos(p.angle - v.body.rotation.y));
      v.body.rotation.y += diff * weight;
      if (p.shot !== v.lastShot) {
        v.recoil = WEAPONS[p.weapon]?.melee ? 0.4 : 0.22;
        v.lastShot = p.shot;
      }
      v.recoil = Math.max(0, v.recoil - dt);
      if (p.hp < v.previousHP && p.hp > 0) v.hitTime = 0.25;
      v.previousHP = p.hp;
      v.hitTime = Math.max(0, v.hitTime - dt);
      const ground = groundHeight(p.x, p.z, this.map),
        airborne = !p.grounded && p.y - ground > 0.12;
      if (airborne) v.air += dt;
      else {
        if (v.air > 0.45 && dt > 0) {
          this.fx.puff(p.x, p.y, p.z, v.air > 1.1);
          v.landT = 0.3;
        }
        v.air = 0;
      }
      v.landT = Math.max(0, v.landT - dt);
      // Fallen characters sink away after a few seconds; respawning resets them.
      v.dead = p.hp <= 0 ? v.dead + dt : 0;
      v.body.position.y = v.dead > 3 ? -Math.min(1.8, (v.dead - 3) * 0.6) : 0;
      const walking = p.moving > 0.5 && p.moving < 4.2;
      // Emotes: the equipped one plays for a few seconds, with its own bob, spin or robot steps on top.
      const emote = p.emote > 0 && p.hp > 0 ? COSMETICS.find((c) => c.id === look.emote) : null;
      v.emoteClock = emote ? v.emoteClock + dt : 0;
      const dance = emote?.dance;
      v.body.position.y = v.dead > 3 ? v.body.position.y : dance?.bob ? Math.abs(Math.sin(v.emoteClock * (dance.speed || 5))) * dance.bob : 0;
      v.body.rotation.y = dance?.spin
        ? v.emoteClock * dance.spin
        : dance?.step
          ? Math.sin(Math.round(v.emoteClock * dance.step) * 1.1) * 0.5
          : 0;
      const anim =
        emote
          ? emote.clip
          : p.hp <= 0
          ? 'Death'
          : airborne
            ? 'Jump_Idle'
            : v.landT > 0 && p.moving < 0.5
              ? 'Jump_Land'
              : v.hitTime > 0
              ? 'HitReact'
              : p.reload > 0
                ? 'Idle'
                : v.recoil > 0 && WEAPONS[p.weapon]?.melee
                  ? 'Punch'
                  : p.moving > 0.5
                    ? walking
                      ? v.recoil > 0
                        ? 'Walk_Shoot'
                        : 'Walk'
                      : v.recoil > 0
                        ? 'Run_Shoot'
                        : 'Run_Gun'
                    : v.recoil > 0
                      ? 'Idle_Shoot'
                      : 'Idle';
      this.animate(v, anim);
      if (look.effect !== 'noeffect' && p.hp > 0 && !p.inBus && dt > 0) this.cosmeticEffect(v, p, look.effect, dt);
      v.mixer.update(dt);
      for (const g of v.guns) g.visible = g.name === CHARACTER_GUNS[p.weapon];
      if (v.gear.jetpack) v.gear.jetpack.visible = p.gear?.id === 'jetpack' && p.hp > 0;
      if (v.gear.glider) v.gear.glider.visible = !!p.gliding && p.hp > 0;
      if (p.thrusting && p.hp > 0 && dt > 0) this.fx.jet(p, dt);
      v.hp.visible = v.label.visible = p.hp > 0;
      if (v.dead > 6) v.root.visible = false;
      v.bar.scale.x = (0.7 * p.hp) / 100;
      v.bar.position.x = -(0.7 - v.bar.scale.x) / 2;
      v.hp.quaternion.copy(this.camera.quaternion);
      v.label.quaternion.copy(this.camera.quaternion);
    }
    for (const [pid, v] of this.people)
      if (!state.players.some((p) => p.id === pid)) {
        this.removePerson(v);
        this.people.delete(pid);
      }
    this.syncWorld(state, dt);
    this.scenery?.cull(this.camera, this.viewDistance || 250);
    this.grass?.update(this.camera, state.players);
    this.scenery?.update(dt, this.fx);
    for (const c of this.chimneys) {
      if (c.b.collapsed) continue;
      c.clock += dt;
      if (c.clock > (this.fx.lite ? 0.45 : 0.18)) {
        c.clock = 0;
        this.fx.chimney(c.x, c.y, c.z);
      }
    }
    this.updateLoot(state, dt);
    this.fx.rocketTrail(
      (state.projectiles || []).filter((r) => r.kind === 'rocket' || r.kind === 'grenade'),
      dt,
    );
    this.fx.update(dt);
    this.sky.position.copy(this.camera.position);
    // The sun's shadow box (±145 m) follows the camera, snapped to 8 m so shadows do not shimmer; on the district
    // it simply stays centred.
    if (this.map.size === 'city' || (this.viewDistance || 250) < 200) {
      const sx = Math.round(this.camera.position.x / 8) * 8,
        sz = Math.round(this.camera.position.z / 8) * 8;
      this.sun.target.position.set(sx, 0, sz);
      this.sun.position.set(sx - 70, 130, sz + 70);
    } else if (this.sun.target.position.lengthSq()) {
      this.sun.target.position.set(0, 0, 0);
      this.sun.position.set(-70, 130, 70);
    }
    for (const water of this.waters) water.material.uniforms.time.value += dt;
    this.renderer.autoClear = true;
    const drawWeapon = !menu && me && me.hp > 0 && state.winner === null && !(me.flashback > 0) && !me.inBus;
    if (drawWeapon) {
      const held = WEAPONS[me.weapon];
      if (this.fpShot !== me.shot) {
        if (this.fpShot >= 0) {
          if (held.melee) {
            this.swing = 1;
            this.swingSide = -this.swingSide;
          } else this.fpRecoil = 0.11;
        }
        this.fpShot = me.shot;
      }
      this.swing = Math.max(0, this.swing - dt / Math.min(0.42, held.interval || 0.4));
      // Weapon switch: lower the old weapon, then raise the new one (also used when spawning).
      if (this.previousWeapon !== me.weapon) {
        this.switchFrom = this.previousWeapon >= 0 ? this.previousWeapon : me.weapon;
        this.switchT = this.previousWeapon >= 0 ? 1 : 0.5;
        this.previousWeapon = me.weapon;
      }
      if (this.spawnRaise) {
        this.switchFrom = me.weapon;
        this.switchT = 0.5;
        this.spawnRaise = false;
      }
      this.switchT = Math.max(0, (this.switchT || 0) - dt / 0.42);
      const lowering = this.switchT > 0.5,
        drop = lowering ? 1 - (this.switchT - 0.5) * 2 : this.switchT * 2,
        shown = lowering ? this.switchFrom : me.weapon,
        swapEase = drop * drop * (3 - 2 * drop);
      this.fpRecoil = Math.max(0, this.fpRecoil - dt);
      this.fpPhase += dt * me.moving * 2;
      this.land = Math.max(0, (this.land || 0) - dt * 2.2);
      const bob = Math.min(me.moving / 5, 1),
        reloadTime = (held.reload || 1) * (RARITIES[me.rarity]?.reload || 1),
        rt = me.reload > 0 ? Math.min(1, Math.max(0, 1 - me.reload / reloadTime)) : -1,
        style = RELOAD_STYLE[held.model] || (held.melee ? 'none' : 'mag'),
        pose = reloadPose(style, rt),
        // Melee swing: wind-up then a fast diagonal slash, alternating sides.
        t = 1 - this.swing,
        slash = this.swing > 0 ? Math.sin(Math.min(1, t * 1.25) * Math.PI) : 0,
        side = this.swingSide;
      this.fp.position.set(
        (look.aim && !held.melee ? 0.08 : 0.24) + Math.sin(this.fpPhase) * 0.009 * bob - slash * 0.22 * side + pose.x,
        -0.23 +
          Math.abs(Math.cos(this.fpPhase)) * 0.009 * bob +
          pose.y -
          swapEase * 0.38 -
          this.land * 0.12 -
          (me.healing > 0 ? 0.3 : 0) +
          slash * 0.05,
        -0.58 + this.fpRecoil * 0.65 - slash * 0.18 + pose.z,
      );
      this.fp.rotation.set(
        this.fpRecoil * 1.2 + pose.rx - slash * 0.9 - swapEase * 0.7,
        slash * 0.5 * side + pose.ry,
        pose.rz - (me.sprinting ? 0.35 : 0) + slash * 1.1 * side,
      );
      this.fpGuns.forEach((g, i) => {
        g.visible = i === shown;
        g.userData.flash.visible = this.fpRecoil > 0.055 && i === me.weapon;
        if (i === me.weapon && g.userData.barrels) g.userData.barrels.rotation.x += dt * (me.spin || 0) * 32;
        const mag = g.userData.mag;
        if (mag) {
          // A fresh magazine rises into the weapon mid-reload.
          mag.visible = i === me.weapon && rt > 0.3 && rt < 0.75;
          mag.position.y = mag.userData.y - (1 - Math.min(1, (rt - 0.3) / 0.35)) * 0.34;
        }
      });
      this.fpGlider.visible = !!me.gliding;
    }
    this.bossViews ||= new BossViews(this);
    this.bossViews.update(state, dt, this.camera, id);
    this.camera.updateMatrixWorld();
    this.bossViews.renderPortals(this.renderer, this.camera);
    // World, then the first-person weapon on top; with post-processing both go through bloom and grading.
    if (this.composer) {
      this.weaponPass.enabled = !!drawWeapon;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
      if (drawWeapon) {
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.weaponScene, this.weaponCamera);
        this.renderer.autoClear = true;
      }
    }
  }
  // Compiles every material's shaders for the target the frame really renders into (the composer's buffer when
  // post-processing is on), so the first match frame does not stall.
  async precompile() {
    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer ? this.composer.readBuffer : null);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
      await this.renderer.compileAsync(this.weaponScene, this.weaponCamera);
    } finally {
      this.renderer.setRenderTarget(target);
    }
  }
  // View distance: fog, the camera's far plane, the shadow box and scenery culling all follow it.
  setViewDistance(d = 250) {
    this.viewDistance = Math.max(80, Math.min(600, Number(d) || 250));
    this.scene.fog.near = this.viewDistance * 0.38;
    this.scene.fog.far = this.viewDistance;
    this.camera.far = this.viewDistance + 60;
    this.sky.scale.setScalar(Math.min(1, (this.camera.far - 15) / 270));
    this.camera.updateProjectionMatrix();
    const box = Math.min(145, Math.max(70, this.viewDistance * 0.6));
    Object.assign(this.sun.shadow.camera, { left: -box, right: box, top: box, bottom: -box });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scenery?.cull(this.camera, this.viewDistance, true);
  }
  // Render resolution as a share of the display's (capped) pixel ratio: lower is faster, softer.
  setResolution(scale = 1) {
    this.resolution = Math.min(1, Math.max(0.35, Number(scale) || 1));
    if (!this.basePixelRatio) return;
    this.renderer.setPixelRatio(this.basePixelRatio * this.resolution * (this.dynamicScale ?? 1));
    this.resize();
  }
  // Picture settings (exposure, brightness, contrast, saturation…); see grading.js.
  setGrade(grade) {
    this.grade = sanitizeGrade(grade);
    this.renderer.toneMappingExposure = this.grade.exposure;
    const needComposer = !this.lite || !isNeutral(this.grade);
    if (needComposer !== !!this.composer || (this.bloomPass && this.grade.bloom <= 0) || (!this.bloomPass && !this.lite && this.grade.bloom > 0))
      this.setQuality(this.quality);
    if (this.bloomPass) this.bloomPass.strength = this.grade.bloom;
    this.gradePass?.set(this.grade);
  }
  setQuality(quality) {
    this.quality = quality;
    const lite = quality === 'fast' || (quality === 'auto' && matchMedia('(pointer:coarse)').matches);
    this.fx?.setQuality(lite);
    setSurfaceQuality(lite);
    this.grass?.setQuality(lite);
    if (this.scenery) this.scenery.culler.lite = lite;
    this.basePixelRatio = Math.min(devicePixelRatio, lite ? 1 : 1.5);
    this.renderer.setPixelRatio(this.basePixelRatio * (this.resolution || 1) * (this.dynamicScale ?? 1));
    const shadowSize = lite ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.composer) {
      for (const p of this.composer.passes) p.dispose?.();
      this.composer.dispose();
      this.composer = null;
    }
    this.lite = lite;
    this.grade ??= sanitizeGrade();
    this.bloomPass = this.gradePass = this.weaponPass = null;
    // Fast mode renders straight to the screen unless the picture settings need the grading pass.
    if (!lite || !isNeutral(this.grade)) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (!lite && this.grade.bloom > 0) {
        this.bloomPass = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), this.grade.bloom, 0.35, 1.15);
        this.composer.addPass(this.bloomPass);
      }
      this.weaponPass = new WeaponPass(this);
      this.composer.addPass(this.weaponPass);
      this.composer.addPass(new OutputPass());
      this.gradePass = new GradePass();
      this.gradePass.set(this.grade);
      this.composer.addPass(this.gradePass);
    }
    this.renderer.toneMappingExposure = this.grade.exposure;
    this.resize();
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = innerWidth / innerHeight;
    this.weaponCamera.updateProjectionMatrix();
    this.composer?.setSize(innerWidth, innerHeight);
    this.fx?.resize(innerHeight, this.renderer.getPixelRatio());
  }
}
