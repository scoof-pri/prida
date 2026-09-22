// 3D grass around the camera: instanced patches of curved blades on every lawn, park, glade and meadow (not on
// roads, pavements, paths, water, sand or under buildings). Blades sway in the wind, bend away from players and
// shrink away at the edge of the ring so there is no hard border. A 1 m density mask is built once per map;
// the patches near the camera are re-placed when it moves or turns (deterministic per cell: no flicker).
import * as T from 'three';
import { groundHeight } from './terrain.js';
import { WORLD, BIOME_COLORS } from './materials.js';

// Per biome: density (0..1), blade height scale.
const BIOMES = {
  city: [0.75, 0.8],
  park: [0.95, 1],
  grove: [0.8, 0.95],
  hill: [0.9, 1.05],
  forest: [0.4, 0.85],
  lake: [0.85, 1.1],
  glade: [1, 1.15],
  meadow: [1, 1.5],
  quarry: [0, 1],
  desert: [0, 1],
};
const BIOME_LIST = Object.keys(BIOMES);
function bladePatch(blades, width, seed, segments = 3) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pos = [],
    nrm = [],
    uv = [],
    root = [],
    index = [];
  for (let b = 0; b < blades; b++) {
    const x = rnd() - 0.5,
      z = rnd() - 0.5,
      h = 0.28 + rnd() * 0.32,
      w = width * (0.7 + rnd() * 0.6),
      yaw = rnd() * Math.PI * 2,
      lean = 0.15 + rnd() * 0.35,
      cx = Math.cos(yaw),
      sz = Math.sin(yaw),
      base = pos.length / 3;
    // Rows from the root to the tip: the blade narrows and curves over in its lean direction.
    for (let k = 0; k <= segments; k++) {
      const t = k / segments,
        half = (w / 2) * (1 - t * 0.85),
        bend = lean * t * t * h,
        y = h * t * (1 - lean * 0.25 * t),
        px = x + cx * bend,
        pz = z + sz * bend;
      if (k === segments) {
        pos.push(px, y, pz);
        nrm.push(0, 1, 0);
        uv.push(0.5, 1);
        root.push(x, z);
      } else {
        for (const side of [-1, 1]) {
          pos.push(px - sz * half * side, y, pz + cx * half * side);
          // Normals lean toward "up" so blades light like the ground they grow from.
          nrm.push(cx * 0.35, 0.94, sz * 0.35);
          uv.push(side < 0 ? 0 : 1, t);
          root.push(x, z);
        }
      }
    }
    for (let k = 0; k < segments - 1; k++) {
      const a = base + k * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const a = base + (segments - 1) * 2;
    index.push(a, a + 1, a + 2);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('root', new T.Float32BufferAttribute(root, 2));
  g.setIndex(index);
  g.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);
  return g;
}
let MATERIAL = null;
const PUSHERS = 4;
export const GRASS = { pushers: { value: Array.from({ length: PUSHERS }, () => new T.Vector3(0, 0, -1)) }, ring: { value: new T.Vector2(28, 34) } };
function grassMaterial() {
  if (MATERIAL) return MATERIAL;
  const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: T.DoubleSide, envMapIntensity: 0.6 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { grassTime: WORLD.time, wind: WORLD.wind, pushers: GRASS.pushers, ring: GRASS.ring, sunDir: WORLD.sunDir });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float grassTime; uniform vec2 wind; uniform vec3 pushers[${PUSHERS}]; uniform vec2 ring;
        attribute vec2 root; varying float vGrassT;`,
      )
      .replace(
        '#include <project_vertex>',
        `vGrassT = uv.y;
        vec4 gw = instanceMatrix * vec4(transformed, 1.0);
        vec3 rootW = (instanceMatrix * vec4(root.x, 0.0, root.y, 1.0)).xyz;
        float bend = uv.y * uv.y;
        float phase = dot(rootW.xz, vec2(0.37, 0.29));
        float gust = 0.5 + 0.5 * sin(grassTime * 0.9 - dot(rootW.xz, normalize(wind)) * 0.08);
        gw.xz += wind * (sin(grassTime * 2.3 + phase) * 0.3 + gust * 0.7) * 0.2 * bend;
        for (int i = 0; i < ${PUSHERS}; i++) {
          vec2 d = rootW.xz - pushers[i].xy;
          float k = clamp(1.0 - length(d) / max(pushers[i].z, 0.001), 0.0, 1.0);
          gw.xz += normalize(d + vec2(0.0001)) * k * 0.4 * bend;
          gw.y -= k * 0.5 * (gw.y - rootW.y);
        }
        // Blades shrink toward their roots at the edge of the ring.
        float fade = 1.0 - smoothstep(ring.x, ring.y, distance(rootW.xz, cameraPosition.xz));
        gw.y = rootW.y + (gw.y - rootW.y) * fade;
        vec4 mvPosition = viewMatrix * gw;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGrassT;\nuniform vec3 sunDir;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Dark, shaded roots to a light tip (the tint is per patch).
        diffuseColor.rgb *= mix(0.28, 1.05, smoothstep(0.0, 1.0, vGrassT));`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        normal = normalize(vNormal);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 viewSun = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
          float through = pow(clamp(dot(-normalize(vViewPosition), viewSun), 0.0, 1.0), 4.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.9, 1.0, 0.5) * through * 0.6 * vGrassT;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'prida-grass';
  MATERIAL = m;
  return m;
}
const hash = (x, z, k = 0) => {
  const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
export class GrassField {
  constructor(map, scene, lite = false) {
    this.map = map;
    this.W = Math.ceil(map.limit.x * 2);
    this.H = Math.ceil(map.limit.z * 2);
    this.density = new Uint8Array(this.W * this.H);
    this.biome = new Uint8Array(this.W * this.H);
    this.heights = new Float32Array(this.W * this.H).fill(NaN);
    this.buildMask();
    this.patches = [bladePatch(18, 0.05, 11), bladePatch(10, 0.08, 23, 2)];
    this.meshes = this.patches.map((g, i) => {
      const mesh = new T.InstancedMesh(g, grassMaterial(), i ? 5000 : 2600);
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.setColorAt(0, new T.Color());
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      return mesh;
    });
    this.colors = BIOME_LIST.map((b) => {
      const c = new T.Color(BIOME_COLORS[b] ?? 0x88a060);
      // Blades are a little greener and brighter than the ground they grow on.
      return c.lerp(new T.Color(0x7da04a), 0.45).multiplyScalar(1.05);
    });
    this.setQuality(lite);
  }
  setQuality(lite) {
    this.lite = !!lite;
    this.near = lite ? 9 : 15;
    this.far = lite ? 18 : 34;
    GRASS.ring.value.set(this.far - 6, this.far);
    this.last = null;
  }
  cell(x, z) {
    const i = Math.floor(x + this.map.limit.x),
      k = Math.floor(z + this.map.limit.z);
    return i < 0 || k < 0 || i >= this.W || k >= this.H ? -1 : k * this.W + i;
  }
  fill(x0, z0, x1, z1, fn) {
    const L = this.map.limit;
    for (let k = Math.max(0, Math.floor(z0 + L.z)); k < Math.min(this.H, Math.ceil(z1 + L.z)); k++)
      for (let i = Math.max(0, Math.floor(x0 + L.x)); i < Math.min(this.W, Math.ceil(x1 + L.x)); i++) fn(k * this.W + i, i - L.x + 0.5, k - L.z + 0.5);
  }
  rect(r, margin, value = 0) {
    this.fill(r.x - r.w / 2 - margin, r.z - r.d / 2 - margin, r.x + r.w / 2 + margin, r.z + r.d / 2 + margin, (i) => (this.density[i] = value));
  }
  buildMask() {
    const map = this.map,
      city = BIOME_LIST.indexOf('city');
    this.density.fill(Math.round(BIOMES.city[0] * 255));
    this.biome.fill(city);
    for (const p of map.parks) {
      const b = BIOME_LIST.indexOf(p.type),
        d = Math.round((BIOMES[p.type]?.[0] ?? 0.8) * 255);
      this.fill(p.x - p.w / 2 + 2, p.z - p.d / 2 + 2, p.x + p.w / 2 - 2, p.z + p.d / 2 - 2, (i, x, z) => {
        this.biome[i] = b;
        this.density[i] = d;
        // The lake bed and shallows are under water.
        if (p.type === 'lake' && this.ground(i, x, z) < -0.08) this.density[i] = 0;
      });
    }
    for (const r of map.roads) this.rect(r, 0.2);
    for (const r of map.paths) this.rect(r, 0.25);
    for (const b of map.buildings) this.rect(b, 1.35);
    for (const w of map.waters) this.rect(w, 0.6);
    for (const o of map.obstacles)
      if (['rock', 'log', 'hay', 'crate', 'pond', 'bench', 'cactus'].includes(o.part)) this.rect(o, o.part === 'rock' ? -0.1 : 0.1);
    // Chests stay visible.
    for (const c of map.chests) this.rect({ x: c.x, z: c.z, w: 1.6, d: 1.2 }, 0.3);
  }
  ground(i, x, z) {
    let h = this.heights[i];
    if (Number.isNaN(h)) h = this.heights[i] = groundHeight(x, z, this.map);
    return h;
  }
  // Re-places the patches around the camera when it has moved or turned enough.
  update(camera, players = []) {
    const p = camera.position,
      fx = -camera.matrixWorld.elements[8],
      fz = -camera.matrixWorld.elements[10],
      fl = Math.hypot(fx, fz) || 1,
      yaw = Math.atan2(fx, fz);
    // Up to four characters near the camera bend the grass around them.
    const push = GRASS.pushers.value;
    let n = 0;
    for (const q of players) {
      if (n >= push.length) break;
      if (q.hp > 0 && Math.hypot(q.x - p.x, q.z - p.z) < this.far) push[n++].set(q.x, q.z, 0.75);
    }
    for (; n < push.length; n++) push[n].set(0, 0, -1);
    const last = this.last;
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1.2 && Math.abs(Math.atan2(Math.sin(yaw - last.yaw), Math.cos(yaw - last.yaw))) < 0.25 && Math.abs(p.y - last.y) < 2)
      return;
    this.last = { x: p.x, z: p.z, y: p.y, yaw };
    // Too high above the ground (bus, glider, rooftops): no grass needed.
    const [nearMesh, farMesh] = this.meshes;
    const counts = [0, 0],
      caps = [nearMesh.count, farMesh.count].map((_, i) => this.meshes[i].instanceMatrix.count),
      arrays = this.meshes.map((m) => m.instanceMatrix.array),
      colorArrays = this.meshes.map((m) => m.instanceColor.array),
      ux = fx / fl,
      uz = fz / fl,
      R = this.far,
      high = p.y - groundHeight(p.x, p.z, this.map) > 40;
    if (!high)
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          const x = Math.floor(p.x) + dx + 0.5,
            z = Math.floor(p.z) + dz + 0.5,
            ox = x - p.x,
            oz = z - p.z,
            d = Math.hypot(ox, oz);
          if (d > R) continue;
          // Behind the camera (with a margin for turning before the next update).
          if (d > 3 && (ox * ux + oz * uz) / d < -0.35) continue;
          const i = this.cell(x, z);
          if (i < 0) continue;
          const dens = this.density[i];
          if (!dens) continue;
          const far = d > this.near ? 1 : 0;
          if (far && (Math.floor(x) + Math.floor(z)) & 1) continue;
          const h1 = hash(x, z);
          if (h1 * 255 >= dens) continue;
          if (counts[far] >= caps[far]) continue;
          const jx = x + (hash(x, z, 1) - 0.5) * 0.7,
            jz = z + (hash(x, z, 2) - 0.5) * 0.7,
            y = this.ground(i, jx, jz) - 0.02,
            b = this.biome[i],
            hs = BIOMES[BIOME_LIST[b]][1] * (0.75 + hash(x, z, 3) * 0.5) * (far ? 1.25 : 1),
            s = far ? 1.45 : 1,
            a = hash(x, z, 4) * Math.PI * 2,
            c = Math.cos(a) * s,
            sn = Math.sin(a) * s,
            m = arrays[far],
            o = counts[far] * 16;
          m[o] = c;
          m[o + 1] = 0;
          m[o + 2] = -sn;
          m[o + 3] = 0;
          m[o + 4] = 0;
          m[o + 5] = hs;
          m[o + 6] = 0;
          m[o + 7] = 0;
          m[o + 8] = sn;
          m[o + 9] = 0;
          m[o + 10] = c;
          m[o + 11] = 0;
          m[o + 12] = jx;
          m[o + 13] = y;
          m[o + 14] = jz;
          m[o + 15] = 1;
          const col = this.colors[b],
            v = 0.82 + hash(x, z, 5) * 0.3,
            ca = colorArrays[far],
            co = counts[far] * 3;
          ca[co] = col.r * v;
          ca[co + 1] = col.g * v;
          ca[co + 2] = col.b * v * 0.95;
          counts[far]++;
        }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, counts[k]) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, Math.max(1, counts[k]) * 3);
      mesh.instanceColor.needsUpdate = true;
    });
  }
  dispose() {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose();
    }
    for (const g of this.patches) g.dispose();
  }
}
