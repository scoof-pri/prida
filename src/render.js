import { COSMETICS, appearance } from './cosmetics.js';
import { CombatEffects } from './effects.js';
import { makeGround, makeSky, makeWater, detailMaterial } from './materials.js';
import { Scenery } from './scenery.js';
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
    this.scene.fog = new T.Fog(0xc0d6d1, 95, 245);
    this.sky = makeSky();
    this.scene.add(this.sky);
    this.camera = new T.PerspectiveCamera(43, 1, 0.15, 450);
    this.camera.position.set(0, 65, 64);
    this.camera.lookAt(0, 0, 0);
    this.materials = new Map();
    this.cube = new T.BoxGeometry(1, 1, 1);
    this.people = new Map();
    this.waters = [];
    this.chestViews = new Map();
    this.rocketViews = new Map();
    this.scene.add(new T.HemisphereLight(0xc5e5ef, 0x85835d, 1.6));
    this.sun = new T.DirectionalLight(0xffe0b4, 3.0);
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
      this.terrain.traverse((o) => {
        if (o.userData.batched || o.userData.ownedTexture || o.userData.standalone) o.geometry?.dispose();
        if (o.userData.standalone) o.material.dispose();
        if (o.userData.props) o.dispose();
        if (o.userData.ownedTexture) {
          o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    for (const v of this.chestViews.values()) this.disposeLoot(v);
    this.chestViews.clear();
    this.map = createWorld(seed, size);
    this.fx?.reset(this.map);
    this.waters = [];
    this.terrain = new T.Group();
    this.scene.add(this.terrain);
    this.world();
    this.batchStatic();
    this.scenery?.dispose();
    this.scenery = this.useAssets === false ? null : new Scenery(this.scene, this.map);
    this.collapsing = new Set();
    this.burning = new Set();
    this.chimneys = this.map.buildings
      .filter((b) => b.category === 'industry' && b.height >= 9)
      .map((b) => ({ b, x: b.x + b.w * 0.25, y: b.height + 0.6, z: b.z - b.d * 0.2, clock: Math.random() }));
    this.shake = 0;
  }
  world() {
    const map = this.map || createWorld(DEFAULT_SEED),
      parent = this.terrain || this.scene,
      L = map.limit;
    // Skirt under the whole district, deep enough to stay below the quarry pit.
    this.box(0, -5, 0, L.x * 2 + 6, 1.2, L.z * 2 + 6, 0x788574);
    parent.add(makeGround(map));
    const asphalt = detailMaterial('asphalt', palette.road, { scale: 0.22, strength: 0.85 }),
      paving = detailMaterial('paving', 0xd9d2bd, { scale: 0.45, strength: 0.7 }),
      dirtPath = detailMaterial('dirt', 0xaa9576, { scale: 0.35, strength: 0.7 }),
      marking = this.mat(0xf1ead2);
    for (const r of map.roads) {
      this.box(r.x, 0.03, r.z, r.w, 0.06, r.d, asphalt);
      // Dashed centre line along straight segments.
      if (r.w !== r.d)
        for (let t = -Math.max(r.w, r.d) / 2 + 1.5; t < Math.max(r.w, r.d) / 2 - 1; t += 3)
          r.w > r.d
            ? this.box(r.x + t, 0.062, r.z, 1.4, 0.004, 0.14, marking)
            : this.box(r.x, 0.062, r.z + t, 0.14, 0.004, 1.4, marking);
    }
    for (const r of map.paths) this.box(r.x, 0.035, r.z, r.w, 0.04, r.d, r.color === 0xaa9576 ? dirtPath : paving);
    for (const water of map.waters) {
      const mesh = makeWater(water);
      parent.add(mesh);
      this.waters?.push(mesh);
    }
    this.signs = new Map();
    const floors = {
      home: detailMaterial('wood', 0xc9ab86, { scale: 0.7, strength: 0.75 }),
      office: detailMaterial('wood', 0xb8a58c, { scale: 0.7, strength: 0.6 }),
      shop: detailMaterial('tiles', 0xd8d2c4, { scale: 0.5, strength: 0.35 }),
      industry: detailMaterial('concrete', 0xb8b6ad, { scale: 0.3, strength: 0.7 }),
    };
    const sidewalk = detailMaterial('paving', 0xb0b5a1, { scale: 0.5, strength: 0.6 });
    for (const b of map.buildings) {
      this.box(b.x, 0.012, b.z, b.w + 2, 0.025, b.d + 2, sidewalk);
      this.box(b.x, 0.025, b.z, b.w - 0.4, 0.04, b.d - 0.4, floors[b.category] || floors.home);
      const sign = this.text(b.sign.toUpperCase(), Math.min(b.w - 1, 5), 0.52);
      sign.position.set(b.x, 3.25, b.z + b.d / 2 + 0.04);
      parent.add(sign);
      this.signs.set(b.id, sign);
    }
    // Remaining static obstacles (crates, benches, pond rim). Walls, furniture and street props live in Scenery.
    // Destructible props (trees, rocks, crates, benches) are instanced per shape, so one can vanish on its own
    // while they still cost a few draw calls.
    for (const g of Object.values(this.propShapes || {})) g.dispose();
    const props = new Map(),
      shapes = (this.propShapes = {
        rock: new T.DodecahedronGeometry(1, 0),
        pine: new T.ConeGeometry(1.6, 4.5, 7),
        broad: new T.IcosahedronGeometry(2, 0),
      }),
      m4 = new T.Matrix4(),
      q = new T.Quaternion(),
      one = (x, y, z, sx, sy, sz) => m4.clone().compose(new T.Vector3(x, y, z), q, new T.Vector3(sx, sy, sz));
    const keep = (id, geometry, color, matrix) => {
      const material = this.mat(color),
        key = geometry.uuid + ':' + material.uuid;
      if (!props.has(key)) props.set(key, { geometry, material, items: [] });
      props.get(key).items.push({ id, matrix });
    };
    for (const b of map.obstacles.filter(
      (o) => o.building === undefined && o.decor === undefined && !['tree', 'rock', 'bench-back'].includes(o.part),
    ))
      if (b.prop === undefined) this.box(b.x, b.y, b.z, b.w, b.h, b.d, b.color);
      else keep(b.prop, this.cube, b.color, one(b.x, b.y, b.z, b.w, b.h, b.d));
    for (const rock of map.rocks) keep(rock.prop, shapes.rock, rock.color, one(rock.x, rock.y, rock.z, rock.w * 0.55, rock.h * 0.55, rock.d * 0.55));
    const treeProps = new Map(map.obstacles.filter((o) => o.part === 'tree').map((o) => [o.tree, o.prop]));
    for (const [i, [x, z, type]] of map.trees.entries()) {
      const y = groundHeight(x, z, map),
        id = treeProps.get(i);
      keep(id, this.cube, 0x7c6b54, one(x, y + 1.2, z, 0.5, 2.4, 0.5));
      keep(id, shapes[type], type === 'pine' ? 0x487862 : 0x6c9c6b, one(x, y + (type === 'pine' ? 3.7 : 3.4), z, 1, 1, 1));
    }
    // Cacti get two arms; hay bales and logs stay boxes.
    for (const c of map.obstacles.filter((o) => o.part === 'cactus')) {
      keep(c.prop, this.cube, 0x5f8a4a, one(c.x + 0.45, c.ground + c.h * 0.55, c.z, 0.4, 0.3, 0.4));
      keep(c.prop, this.cube, 0x5f8a4a, one(c.x + 0.62, c.ground + c.h * 0.72, c.z, 0.3, 0.6, 0.3));
      keep(c.prop, this.cube, 0x5a8446, one(c.x - 0.42, c.ground + c.h * 0.42, c.z, 0.35, 0.28, 0.35));
      keep(c.prop, this.cube, 0x5a8446, one(c.x - 0.56, c.ground + c.h * 0.58, c.z, 0.28, 0.5, 0.28));
    }
    this.flora(map, parent);
    for (const b of map.cover.filter((c) => c.part === 'bench')) {
      keep(b.prop, this.cube, 0x976f4c, one(b.x, b.ground + 0.77, b.z + 0.26, b.w, 0.55, 0.13));
      for (const side of [-1, 1]) keep(b.prop, this.cube, 0x455c58, one(b.x + side * 0.7, b.ground + 0.22, b.z, 0.09, 0.44, 0.5));
    }
    this.propSlots = new Map();
    for (const { geometry, material, items } of props.values()) {
      const mesh = new T.InstancedMesh(geometry, material, items.length);
      items.forEach((it, i) => {
        mesh.setMatrixAt(i, it.matrix);
        if (!this.propSlots.has(it.id)) this.propSlots.set(it.id, []);
        this.propSlots.get(it.id).push({ mesh, index: i });
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.props = true;
      parent.add(mesh);
    }
    for (const z of [-L.z, L.z]) this.box(0, 1, z, L.x * 2, 2, 0.25, 0x667d75);
    for (const x of [-L.x, L.x]) this.box(x, 1, 0, 0.25, 2, L.z * 2, 0x667d75);
  }
  // Ground cover in the wild biomes: grass, flowers, ferns, bushes, reeds and desert shrubs. Render only.
  flora(map, parent) {
    const kinds = {
      grass: { geo: new T.ConeGeometry(0.09, 0.7, 3), color: 0x6f9a48, y: 0.35, n: 3, spread: 0.25 },
      flower: { geo: new T.IcosahedronGeometry(0.12, 0), color: 0xffffff, y: 0.45, n: 1, stem: true },
      fern: { geo: new T.ConeGeometry(0.55, 0.5, 5), color: 0x4f7a3f, y: 0.25, n: 1 },
      bush: { geo: new T.IcosahedronGeometry(0.7, 0), color: 0x4d7440, y: 0.45, n: 1 },
      reed: { geo: new T.CylinderGeometry(0.04, 0.05, 1.5, 4), color: 0x7f8f4c, y: 0.4, n: 4, spread: 0.35 },
      shrub: { geo: new T.DodecahedronGeometry(0.45, 0), color: 0x8a8a52, y: 0.25, n: 1 },
    };
    const petals = [0xf0d24a, 0xe46f7b, 0xf3f0ea, 0x9c7fe0],
      stemGeo = new T.CylinderGeometry(0.02, 0.02, 0.45, 3),
      byKind = new Map(),
      m4 = new T.Matrix4(),
      q = new T.Quaternion(),
      e = new T.Euler(),
      col = new T.Color();
    let seed = map.seed >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const add = (key, geo, color, x, y, z, s, tint) => {
      if (!byKind.has(key)) byKind.set(key, { geo, color, list: [] });
      q.setFromEuler(e.set((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3));
      byKind.get(key).list.push([m4.compose(new T.Vector3(x, y, z), q, new T.Vector3(s, s, s)).clone(), tint]);
    };
    for (const f of map.flora) {
      const k = kinds[f.kind];
      if (!k) continue;
      for (let i = 0; i < k.n; i++) {
        const x = f.x + (rnd() - 0.5) * (k.spread || 0),
          z = f.z + (rnd() - 0.5) * (k.spread || 0),
          g = groundHeight(x, z, map);
        if (f.kind !== 'reed' && map.waters.some((w) => w.lake && g < w.y + 0.05)) continue;
        add(f.kind, k.geo, k.color, x, g + k.y * f.s, z, f.s, f.kind === 'flower' ? petals[f.c || 0] : undefined);
        if (k.stem) add('stem', stemGeo, 0x5f8a3f, x, g + 0.22 * f.s, z, f.s);
      }
    }
    this.floraGeos = [...Object.values(kinds).map((k) => k.geo), stemGeo];
    for (const { geo, color, list } of byKind.values()) {
      const mesh = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }), list.length);
      list.forEach(([m, tint], i) => {
        mesh.setMatrixAt(i, m);
        if (tint !== undefined) mesh.setColorAt(i, col.setHex(tint));
      });
      mesh.receiveShadow = true;
      mesh.userData.props = true;
      mesh.userData.standalone = true;
      parent.add(mesh);
    }
  }
  batchStatic() {
    this.terrain.updateMatrixWorld(true);
    const batches = new Map(),
      remove = [];
    this.terrain.traverse((o) => {
      if (!o.isMesh || o.userData.ownedTexture || o.userData.standalone || o.userData.props || Array.isArray(o.material)) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const key = o.material.uuid + ':' + Object.keys(geo.attributes).sort().join(',') + ':' + !!geo.index;
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
        m.castShadow = true;
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
      tint: p.cosmetics?.tint,
      ally,
      finish: null,
      air: 0,
      landT: 0,
      dead: 0,
    };
    this.people.set(p.id, v);
    return v;
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
    if (this.finish === look.finish) return;
    this.finish = look.finish;
    const color = new T.Color(COSMETICS.find((c) => c.id === look.finish).color);
    for (const g of this.fpGuns) tintObject(g.children[0], color);
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
      for (const { mesh, index } of this.propSlots?.get(id) || []) {
        mesh.setMatrixAt(index, new T.Matrix4().makeScale(0, 0, 0));
        mesh.instanceMatrix.needsUpdate = true;
      }
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
        r.kind === 'grenade'
          ? new T.IcosahedronGeometry(0.09, 0)
          : r.kind === 'bolt'
            ? new T.CylinderGeometry(0.015, 0.015, 0.55, 5)
            : new T.ConeGeometry(0.09, 0.45, 6);
      m = new T.Mesh(geometry, this.mat(r.kind === 'grenade' ? 0x57704a : r.kind === 'bolt' ? 0x8a6a45 : 0xffc47e));
      m.userData.ownGeometry = true;
    }
    this.scene.add(m);
    return m;
  }
  updateLoot(state, dt) {
    const chestIds = new Set();
    for (const c of state.chests || []) {
      if (c.kind === 'drop' && c.opened) continue;
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
    this.setWorld(state.seed || DEFAULT_SEED, state.size);
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
      if (old && (old.operator !== look.operator || old.tint !== p.cosmetics?.tint || old.ally !== ally)) {
        this.removePerson(old);
        this.people.delete(p.id);
      }
      const v = this.people.get(p.id) || this.person(p, p.id === id),
        weight = v.initialized ? 1 - Math.exp(-dt * 19) : 1;
      v.initialized = true;
      if (v.finish !== look.finish) {
        const color = new T.Color(COSMETICS.find((c) => c.id === look.finish).color);
        for (const g of v.guns) tintObject(g, color);
        v.finish = look.finish;
      }
      v.root.visible =
        (menu || p.id !== id) && !p.inBus && Math.hypot(p.x - this.camera.position.x, p.z - this.camera.position.z) < (this.viewDistance || 250);
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
      const anim =
        p.hp <= 0
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
    this.scenery?.cull(this.camera.position.x, this.camera.position.z, this.viewDistance || 250);
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
    this.scenery?.cull(this.camera.position.x, this.camera.position.z, this.viewDistance, true);
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
