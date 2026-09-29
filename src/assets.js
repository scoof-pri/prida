import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS, GEAR } from './catalog.js';
import { DECOR_SIZES } from './decor-sizes.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { gunMaterial } from './materials.js';
// Players and bots (0.27.1, back from 0.21): Quaternius' Toon Shooter soldiers with their own clips and the guns
// that ship in their right hands. (0.22–0.27 used combat operators, soldier.js; see PRIDA-BASELINE §7.13.)
export const CHARACTER_FILES = ['soldier', 'hazmat', 'scout'];
const models = new Map(),
  textures = new Map();
// CC0 Poly Haven PBR sets (see ASSET-CREDITS.md): colour map, OpenGL normal map (_n) and AO/roughness/metal map
// (_arm), 512 px. The mean sRGB colour lets "painted" materials keep their palette and use the texture as detail.
export const TEXTURES = {
  bricks: [150, 111, 80],
  plaster: [171, 163, 160],
  concrete: [106, 99, 88],
  asphalt: [90, 90, 85],
  paving: [99, 87, 69],
  grass: [145, 135, 93],
  dirt: [101, 84, 51],
  sand: [130, 114, 91],
  tiles: [121, 111, 107],
  wood: [155, 128, 99],
  roof: [120, 122, 120],
  bark: [95, 86, 64],
  rock: [167, 155, 140],
  claytiles: [145, 79, 42],
  corrugated: [88, 87, 80],
  gravel: [64, 59, 53],
  fabric: [145, 171, 205],
  oak: [161, 126, 87],
  panels: [141, 133, 112],
  sidewalk: [127, 116, 102],
  pinebark: [102, 82, 64],
  steel: [96, 97, 99],
  gunmetal: [30, 34, 33],
  worn: [63, 63, 63],
};
// Foliage cards (RGBA, composed from ambientCG leaf atlases by scripts/make-foliage.py).
export const FOLIAGE = ['leaves', 'needles'];
const TEXTURE_FILES = [...Object.keys(TEXTURES).flatMap((n) => [n, n + '_n', n + '_arm']), ...FOLIAGE];
// Embedded glTF images are normally decoded through blob: URLs, which strict hosts (Content-Security-Policy
// without blob:) refuse, leaving city, car and prop models untextured white. Decode them straight from the
// binary with createImageBitmap instead (data: URL image as a fallback), so no URL is ever fetched.
function decodeImage(bytes, type) {
  const blob = new Blob([bytes], { type });
  if (typeof createImageBitmap === 'function')
    return createImageBitmap(blob, { premultiplyAlpha: 'none' }).catch(() => decodeViaDataUrl(blob));
  return decodeViaDataUrl(blob);
}
function decodeViaDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(blob);
  });
}
class EmbeddedImagePlugin {
  constructor(parser) {
    this.name = 'PRIDA_embedded_images';
    const original = parser.loadImageSource.bind(parser);
    parser.loadImageSource = (index, loader) => {
      const def = parser.json.images[index];
      if (def.bufferView === undefined) return original(index, loader);
      if (parser.sourceCache[index] !== undefined) return parser.sourceCache[index].then((t) => t.clone());
      const promise = parser
        .getDependency('bufferView', def.bufferView)
        .then((bytes) => decodeImage(bytes, def.mimeType || 'image/png'))
        .then((image) => {
          const t = new T.Texture(image);
          t.needsUpdate = true;
          t.userData.mimeType = def.mimeType;
          return t;
        });
      parser.sourceCache[index] = promise;
      return promise;
    };
  }
}
export function makeGltfLoader() {
  return new GLTFLoader().register((parser) => new EmbeddedImagePlugin(parser));
}
export function texture(name) {
  return textures.get(name);
}
// Texture quality: the detail textures are 512 px; lower settings redraw them smaller (less memory and bandwidth).
export const TEXTURE_SIZES = { high: 512, medium: 256, low: 128, lowest: 64 };
const originals = new Map();
export function setTextureQuality(level = 'medium') {
  const size = TEXTURE_SIZES[level] || TEXTURE_SIZES.medium;
  for (const [name, t] of textures) {
    if (!originals.has(name)) originals.set(name, t.image);
    const src = originals.get(name);
    if (!src?.width) continue;
    if (size >= src.width) t.image = src;
    else {
      // Halve step by step with smoothing: a single big downscale skips pixels and turns mortar lines into moiré.
      let img = src,
        w = src.width;
      while (w > size) {
        w = Math.max(size, w >> 1);
        const c = document.createElement('canvas');
        c.width = c.height = w;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, w, w);
        img = c;
      }
      t.image = img;
    }
    t.needsUpdate = true;
  }
}
async function loadTextures(done) {
  const loader = new T.TextureLoader();
  await Promise.all(
    TEXTURE_FILES.map(async (name) => {
      const card = FOLIAGE.includes(name),
        t = await loader.loadAsync(`./textures/${name}.${card ? 'webp' : 'jpg'}`);
      t.wrapS = t.wrapT = card ? T.ClampToEdgeWrapping : T.RepeatWrapping;
      // Normal and AO/roughness maps hold data, not colour.
      t.colorSpace = /_(n|arm)$/.test(name) ? T.NoColorSpace : T.SRGBColorSpace;
      t.anisotropy = 4;
      textures.set(name, t);
      done();
    }),
  );
}
// A mesh is closed when every edge (after welding equal positions) is shared by at least two triangles.
export function closedMesh(geometry) {
  const pos = geometry?.attributes?.position;
  if (!pos) return false;
  const index = geometry.index,
    ids = new Map(),
    vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
    let v = ids.get(k);
    if (v === undefined) ids.set(k, (v = ids.size));
    vid[i] = v;
  }
  const n = ids.size,
    edges = new Map(),
    tris = (index ? index.count : pos.count) / 3,
    at = (t, c) => vid[index ? index.getX(t * 3 + c) : t * 3 + c];
  for (let t = 0; t < tris; t++)
    for (let c = 0; c < 3; c++) {
      const a = at(t, c),
        b = at(t, (c + 1) % 3);
      if (a === b) continue;
      const k = a < b ? a * n + b : b * n + a;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  for (const count of edges.values()) if (count < 2) return false;
  return edges.size > 0;
}
export async function loadAssets(progress = () => {}) {
  // Building roofs are procedural since 0.20 (roofs.js): the city-kit building models are not loaded.
  const names = [
    ...new Set([
      ...WEAPONS.map((w) => w.model),
      ...GEAR.map((g) => g.model),
      ...Object.keys(DECOR_SIZES).map((n) => 'decor-' + n),
      ...CHARACTER_FILES,
      'chest',
    ]),
  ];
  let next = 0,
    done = 0;
  const total = names.length + TEXTURE_FILES.length,
    loader = makeGltfLoader();
  await Promise.all([
    loadTextures(() => progress(++done, total)),
    ...Array.from({ length: 4 }, async () => {
      while (next < names.length) {
        const name = names[next++];
        const gltf = await loader.loadAsync(`./models/${name}.${import.meta.env?.VITE_MODEL_EXT || 'glb'}`);
        // The kits flag every material double-sided. Closed meshes never show their back faces, so those are
        // culled (half the fragments of a prop); open ones — the loot crate without a top, sheets, canopies — keep
        // both sides, or they turn see-through from behind.
        const open = new Set();
        gltf.scene.traverse((o) => {
          if (o.isMesh && !closedMesh(o.geometry)) for (const m of [o.material].flat()) open.add(m);
        });
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            for (const m of [o.material].flat()) {
              m.roughness = 0.85;
              m.side = open.has(m) || name === 'glider' ? T.DoubleSide : T.FrontSide;
            }
          }
        });
        models.set(name, gltf);
        progress(++done, total);
      }
    }),
  ]);
  // Weapons and gear: flat colours become steel, polymer, wood, rubber and paint finishes (materials.js) — the
  // guns in the soldiers' hands too (they are the same models the first-person weapons were cut from).
  const finish = (o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(gunMaterial) : gunMaterial(o.material);
  };
  for (const name of new Set([...WEAPONS.map((w) => w.model), ...GEAR.map((g) => g.model)])) models.get(name)?.scene.traverse(finish);
  for (const name of CHARACTER_FILES)
    models.get(name)?.scene.traverse((o) => {
      if (ALL_CHARACTER_GUNS.includes(o.name)) o.traverse(finish);
    });
}
// A soldier (0 soldier, 1 hazmat, 2 scout) with its own skeleton, and its animation mixer and clips.
export function character(index = 0) {
  const a = models.get(CHARACTER_FILES[((index % 3) + 3) % 3]),
    root = cloneSkeleton(a.scene),
    mixer = new T.AnimationMixer(root);
  root.scale.setScalar(0.88);
  return { model: root, mixer, clips: a.animations };
}
// Weapon nodes that ship attached to the soldiers' right hands. Everything else is mounted there at runtime.
export const ALL_CHARACTER_GUNS = ['AK', 'GrenadeLauncher', 'Knife_1', 'Knife_2', 'Pistol', 'Revolver', 'Revolver_Small', 'RocketLauncher', 'ShortCannon', 'Shotgun', 'Shovel', 'SMG', 'Sniper', 'Sniper_2'];
// The node a weapon shows as in a soldier's hand (null: bare hands).
export function characterGun(w) {
  if (!w || w.fists) return null;
  return ALL_CHARACTER_GUNS.includes(w.char) ? w.char : 'Mount_' + w.model;
}
export function modelAsset(name) {
  return models.get(name) || null;
}
export function model(name) {
  const asset = models.get(name);
  if (!asset) throw Error('Model failed to load: ' + name);
  return asset.scene.clone(true);
}
// Mesh parts of a loaded model with their transforms relative to the model root (for instancing).
const partsCache = new Map();
export function modelParts(name) {
  if (partsCache.has(name)) return partsCache.get(name);
  const asset = models.get(name);
  if (!asset) throw Error('Model failed to load: ' + name);
  const root = asset.scene;
  root.updateMatrixWorld(true);
  const inverse = new T.Matrix4().copy(root.matrixWorld).invert(),
    parts = [];
  root.traverse((o) => {
    if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, matrix: inverse.clone().multiply(o.matrixWorld) });
  });
  partsCache.set(name, parts);
  return parts;
}
// First-person model: scaled to its configured length and centred, muzzle / blade tip toward -Z. The third-person
// characters hold the same models (render.js heldWeapon).
export function gun(index = 0) {
  const w = WEAPONS[index],
    root = new T.Group();
  // Bare hands: nothing in them (the first-person view draws the fists, characters close their hands).
  if (w.fists) {
    root.userData.length = w.fp.len;
    root.userData.empty = true;
    return root;
  }
  const mesh = model(w.model);
  root.add(mesh);
  mesh.rotation.set(...w.fp.rot);
  mesh.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(mesh),
    size = bounds.getSize(new T.Vector3()),
    center = bounds.getCenter(new T.Vector3());
  // Items keep their real size (the model is built in metres); weapons are scaled to their configured length.
  const s = w.consumable ? 1 : w.fp.len / size.z;
  mesh.scale.multiplyScalar(s);
  mesh.position.set(-center.x * s, -center.y * s, -center.z * s);
  if (w.melee || w.projectile === 'dagger') {
    // Blades pivot around the grip (the end nearest the camera): tip forward, raised and angled inward.
    const pivot = new T.Group();
    mesh.removeFromParent();
    pivot.add(mesh);
    mesh.position.z -= w.fp.len / 2 - 0.07;
    pivot.rotation.set(...(w.fp.pivot || [0.85, 0.15, 0.4]));
    root.add(pivot);
    root.userData.pivot = pivot;
  }
  root.userData.length = w.consumable ? size.z : w.fp.len;
  root.userData.barrels = mesh.getObjectByName('Barrels') || null;
  return root;
}
export function gearModel(id) {
  const g = GEAR.find((g) => g.id === id);
  return g ? model(g.model) : null;
}
export function chestModel() {
  const root = model('chest');
  root.scale.setScalar(1.8);
  root.rotation.y = Math.PI / 2;
  return root;
}
