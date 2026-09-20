// The changeable part of the district: wall panels, windows with curtains, doors, furniture, street furniture,
// cars and the upper storeys. Everything repeated is instanced, so hundreds of props cost a few draw calls;
// destroyed items are hidden by zero-scaling their instance.
import * as T from 'three';
import { model, modelParts } from './assets.js';
import { detailMaterial } from './materials.js';
import { rubbleFor } from './destruction.js';
import { cellGrid, cellCenter, cellBox, cellRects } from './cells.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ZERO = new T.Matrix4().makeScale(0, 0, 0);
const CURTAINS = [0xb35d4f, 0x5d7fa3, 0xd6b25e, 0x6f9a6b, 0x9c6fa3, 0xe0d7c6, 0x3f5d5a];
const unitBox = new T.BoxGeometry(1, 1, 1);

// Indoor furniture is only drawn within 60 m of the camera (seen through windows up close): instances farther
// away are moved outside the clip volume in the vertex shader, so they cost no rasterisation.
const nearCopies = new Map();
function nearOnly(material) {
  if (!nearCopies.has(material.uuid)) {
    const m = material.clone();
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vec3 nearOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          if (distance(nearOrigin, cameraPosition) > 60.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #endif`,
      );
    };
    m.customProgramCacheKey = () => 'prida-near-only';
    nearCopies.set(material.uuid, m);
  }
  return nearCopies.get(material.uuid);
}
// Merges an object's meshes into one mesh per material (upper storeys: a handful of draw calls per building).
// Upper storeys take the building's facade colour so they match the panelled ground floor below. Only the kit's
// light, unsaturated wall texels are recoloured; windows, roofs and trim keep their colours.
const tinted = new Map();
function tintMaterial(material, color) {
  const key = material.uuid + ':' + color;
  if (!tinted.has(key)) {
    const m = material.clone(),
      tint = new T.Color(color);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.wallTint = { value: tint };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 wallTint;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float wallHi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
          float wallLo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
          float wallMask = smoothstep(0.35, 0.6, wallLo) * (1.0 - smoothstep(0.08, 0.2, wallHi - wallLo));
          diffuseColor.rgb = mix(diffuseColor.rgb, wallTint * wallHi * 1.08, wallMask);`,
        );
    };
    m.customProgramCacheKey = () => 'prida-wall-tint';
    tinted.set(key, m);
  }
  return tinted.get(key);
}
function mergeByMaterial(root, color) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    const key = o.material.uuid + ':' + Object.keys(g.attributes).sort().join(',') + (g.index ? ':i' : '');
    if (!groups.has(key)) groups.set(key, { material: o.material, list: [] });
    groups.get(key).list.push(g);
  });
  const out = new T.Group();
  for (const { material, list } of groups.values()) {
    const merged = list.length ? mergeGeometries(list) : null;
    for (const g of list) g.dispose();
    if (!merged) continue;
    const m = new T.Mesh(merged, color === undefined ? material : tintMaterial(material, color));
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

class Batch {
  // Growable list of instances for one geometry/material pair.
  constructor(geometry, material, { shadow = true, colors = false, near = false } = {}) {
    this.near = near;
    this.geometry = geometry;
    this.material = material;
    this.shadow = shadow;
    this.colors = colors;
    this.items = [];
  }
  add(matrix, color) {
    this.items.push({ matrix: matrix.clone(), color });
    return this.items.length - 1;
  }
  build(parent) {
    if (!this.items.length) return;
    const mesh = new T.InstancedMesh(this.geometry, this.material, this.items.length);
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = true;
    const c = new T.Color();
    this.items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      if (this.colors) mesh.setColorAt(i, c.set(it.color ?? 0xffffff));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.mesh = mesh;
    parent.add(mesh);
  }
  hide(i) {
    if (!this.mesh) return;
    this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  tint(i, color) {
    if (!this.mesh?.instanceColor) return;
    this.mesh.setColorAt(i, new T.Color(color));
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// Indoor furniture (most of the city's triangles): the instanced mesh only holds the items within NEAR_RADIUS of
// the camera. The full list stays on the CPU and the visible slots are refilled when the camera has moved a few
// metres, so far-away rooms cost neither vertex work nor upload.
const NEAR_RADIUS = 64,
  NEAR_STEP = 6,
  FAR_STEP = 20;
class NearBatch extends Batch {
  build(parent) {
    const n = this.items.length;
    if (!n) return;
    this.pos = new Float32Array(n * 2);
    this.hidden = new Uint8Array(n);
    this.colorsOf = this.colors ? new Float32Array(n * 3) : null;
    this.slotOf = new Int32Array(n).fill(-1);
    const c = new T.Color();
    this.items.forEach((it, i) => {
      this.pos[i * 2] = it.matrix.elements[12];
      this.pos[i * 2 + 1] = it.matrix.elements[14];
      if (this.colorsOf) c.set(it.color ?? 0xffffff).toArray(this.colorsOf, i * 3);
    });
    const mesh = new T.InstancedMesh(this.geometry, this.material, n);
    mesh.receiveShadow = true;
    mesh.castShadow = this.shadow;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if (this.colorsOf) mesh.setColorAt(0, c.set(0xffffff));
    mesh.count = 0;
    this.mesh = mesh;
    parent.add(mesh);
  }
  cull(x, z, radius = NEAR_RADIUS) {
    if (!this.mesh) return;
    const { pos, hidden, slotOf, items, mesh, colorsOf } = this,
      r2 = radius * radius,
      m = mesh.instanceMatrix.array,
      col = mesh.instanceColor?.array;
    slotOf.fill(-1);
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      if (hidden[i]) continue;
      const dx = pos[i * 2] - x,
        dz = pos[i * 2 + 1] - z;
      if (dx * dx + dz * dz > r2) continue;
      items[i].matrix.toArray(m, n * 16);
      if (col) (col[n * 3] = colorsOf[i * 3]), (col[n * 3 + 1] = colorsOf[i * 3 + 1]), (col[n * 3 + 2] = colorsOf[i * 3 + 2]);
      slotOf[i] = n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  hide(i) {
    if (!this.mesh) return;
    this.hidden[i] = 1;
    if (this.slotOf[i] >= 0) {
      this.mesh.setMatrixAt(this.slotOf[i], ZERO);
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  tint(i, color) {
    if (!this.colorsOf) return;
    new T.Color(color).toArray(this.colorsOf, i * 3);
    if (this.slotOf[i] >= 0) {
      this.mesh.setColorAt(this.slotOf[i], new T.Color(color));
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

// Damaged walls are drawn as individual concrete cells. One growable instanced mesh per wall material; each
// damaged panel owns a contiguous run of slots (dead cells are zero-scaled).
class CellLayer {
  constructor(parent, material) {
    this.parent = parent;
    this.material = material;
    this.used = 0;
    this.grow(512);
  }
  grow(capacity) {
    const old = this.mesh,
      mesh = new T.InstancedMesh(unitBox, this.material, capacity);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.setColorAt(0, new T.Color(1, 1, 1));
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      mesh.instanceColor.array.set(old.instanceColor.array);
      old.removeFromParent();
      old.dispose();
    } else mesh.instanceMatrix.array.fill(0);
    mesh.count = this.used;
    this.parent.add(mesh);
    this.mesh = mesh;
    this.capacity = capacity;
  }
  alloc(n) {
    if (this.used + n > this.capacity) this.grow(Math.max(this.capacity * 2, this.used + n));
    const start = this.used;
    this.used += n;
    this.mesh.count = this.used;
    return start;
  }
}

export class Scenery {
  constructor(scene, map) {
    this.map = map;
    this.root = new T.Group();
    this.root.name = 'scenery';
    scene.add(this.root);
    this.batches = new Map();
    this.byPanel = new Map(); // panel id -> [{batch, index}]
    this.byDecor = new Map(); // decor id -> [{batch, index}]
    this.byRoof = new Map();
    this.buildingPanels = new Map(); // building id -> panel ids (walls, lintels, partitions)
    this.uppers = new Map();
    this.wallOf = new Map(); // panel id -> its solid wall instance (hidden once it turns into cells)
    this.windowOf = new Map(); // panel id -> window parts, hidden when the cells around the glass go
    this.cellSlots = new Map(); // panel id -> { layer, start }
    this.cellLayers = new Map();
    this.slabs = new Map(); // building id -> floor slabs with their storey
    this.byProp = new Map(); // prop id -> stair blocks
    this.stairOf = new Map();
    this.falling = [];
    this.fires = [];
    this.rubble = [];
    this.owned = [];
    const m4 = new T.Matrix4(),
      q = new T.Quaternion(),
      up = new T.Vector3(0, 1, 0);
    const place = (x, y, z, rot, sx, sy, sz) =>
      m4.compose(new T.Vector3(x, y, z), q.setFromAxisAngle(up, rot), new T.Vector3(sx, sy, sz));
    const batch = (key, geometry, material, opts) => {
      if (!this.batches.has(key)) this.batches.set(key, new NearBatch(geometry, material, opts));
      return this.batches.get(key);
    };
    const link = (table, id, b, i) => {
      if (!table.has(id)) table.set(id, []);
      table.get(id).push({ batch: b, index: i });
    };
    // Wall panels, lintels and partitions: plaster or brick, tinted per building.
    const brick = (b) => b.category === 'industry' || (b.category === 'home' && b.id % 3 === 0),
      precut = [];
    for (const o of map.obstacles) {
      const b = map.buildings[o.building];
      if (o.panel !== undefined && o.part !== 'roof') {
        if (!this.buildingPanels.has(o.building)) this.buildingPanels.set(o.building, []);
        this.buildingPanels.get(o.building).push(o.panel);
        const key = o.part === 'partition' ? 'partition' : b && brick(b) ? 'bricks' : 'plaster',
          bt = batch(
            'wall:' + key,
            unitBox,
            key === 'bricks'
              ? detailMaterial('bricks', 0xffffff, { scale: 0.9, strength: 0.75 })
              : detailMaterial('plaster', 0xffffff, { scale: 0.35, strength: 0.5 }),
            { colors: true },
          );
        // A panel with a window is four pieces around the opening.
        const pieces = [];
        if (o.hole) {
          const h = o.hole,
            ax = h.alongX,
            lo = (ax ? o.x - o.w / 2 : o.z - o.d / 2),
            hi = (ax ? o.x + o.w / 2 : o.z + o.d / 2),
            bottom = o.y - o.h / 2,
            top = o.y + o.h / 2,
            piece = (a0, a1, y0, y1) => {
              if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
              const a = (a0 + a1) / 2,
                y = (y0 + y1) / 2;
              pieces.push(
                (ax ? place(a, y, o.z, 0, a1 - a0, y1 - y0, o.d) : place(o.x, y, a, 0, o.w, y1 - y0, a1 - a0)).clone(),
              );
            };
          piece(lo, hi, bottom, h.y0);
          piece(lo, hi, h.y1, top);
          piece(lo, h.a0, h.y0, h.y1);
          piece(h.a1, hi, h.y0, h.y1);
        } else pieces.push(place(o.x, o.y, o.z, 0, o.w, o.h, o.d));
        const indices = pieces.map((m) => bt.add(m, o.color));
        for (const index of indices) link(this.byPanel, o.panel, bt, index);
        this.wallOf.set(o.panel, { batch: bt, index: indices[0], indices, key, matKey: 'wall:' + key, o });
      } else if (o.part === 'stair') {
        const bt = batch('stair', unitBox, detailMaterial('concrete', 0xffffff, { scale: 0.6, strength: 0.6 }), { colors: true });
        this.stairOf.set(o.prop, o);
        link(this.byProp, o.prop, bt, bt.add(place(o.x, o.y, o.z, 0, o.w, o.h, o.d), o.step % 2 ? 0xc4bdaf : 0xb3ac9e));
      } else if (o.part === 'roof') {
        const bt = batch('roof', unitBox, detailMaterial('concrete', 0xffffff, { scale: 0.3, strength: 0.5, ceiling: true }), {
          colors: true,
        });
        const index = bt.add(place(o.x, o.y, o.z, 0, o.w, o.h, o.d), o.color);
        link(this.byRoof, o.building, bt, index);
        // Floor slabs break cell by cell like walls (coarser cells); pre-cut ones (stairwells) start as cells.
        if (o.panel !== undefined) {
          link(this.byPanel, o.panel, bt, index);
          this.wallOf.set(o.panel, { batch: bt, index, key: 'roof', matKey: 'roof', o });
          if (o.cells) precut.push(o);
        }
        if (!this.slabs.has(o.building)) this.slabs.set(o.building, []);
        this.slabs.get(o.building).push({ storey: o.storey || 0, batch: bt, index });
      }
    }
    // Windows: frame and glass reach through the wall so both sides show; curtains hang inside.
    const frameB = batch('window-frame', unitBox, new T.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.6 })),
      // Clear glass: you see into the rooms (and out of them); it shatters on the first hit.
      glassB = batch(
        'window-glass',
        unitBox,
        new T.MeshStandardMaterial({
          color: 0xcfeefa,
          roughness: 0.05,
          metalness: 0.1,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          emissive: 0x1a3140,
          emissiveIntensity: 0.25,
        }),
        { shadow: false },
      ),
      glassOf = new Map(map.obstacles.filter((o) => o.part === 'glass').map((o) => [o.windowPanel, o.prop])),
      curtainB = batch('curtain', unitBox, detailMaterial('plaster', 0xffffff, { scale: 2, strength: 0.4 }), {
        colors: true,
        shadow: false,
      });
    map.windows.forEach((w, i) => {
      const alongZ = w.axis === 'z',
        rot = alongZ ? Math.PI / 2 : 0,
        h = 1.15;
      const parts = [];
      this.windowOf.set(w.panel, { w, parts });
      const linkW = (b, i) => (parts.push({ batch: b, index: i }), link(this.byPanel, w.panel, b, i));
      const cx = w.x - (alongZ ? w.out * 0.21 : 0),
        cz = w.z - (alongZ ? 0 : w.out * 0.21),
        bar = (u, v, bw, bh) => place(cx + (alongZ ? 0 : u), w.y + v, cz + (alongZ ? u : 0), rot, bw, bh, 0.47);
      // Frame: sill, head and two jambs around the opening, plus a mullion.
      for (const m of [
        bar(0, -h / 2 - 0.04, w.w + 0.18, 0.1),
        bar(0, h / 2 + 0.04, w.w + 0.18, 0.1),
        bar(-w.w / 2 - 0.04, 0, 0.1, h),
        bar(w.w / 2 + 0.04, 0, 0.1, h),
        bar(0, 0, 0.05, h),
      ])
        linkW(frameB, frameB.add(m));
      const pane = glassB.add(place(cx, w.y, cz, rot, w.w, h, 0.06));
      linkW(glassB, pane);
      if (glassOf.has(w.panel)) link(this.byProp, glassOf.get(w.panel), glassB, pane);
      const color = CURTAINS[(i * 7 + w.panel) % CURTAINS.length],
        inX = alongZ ? -w.out * 0.52 : 0,
        inZ = alongZ ? 0 : -w.out * 0.52;
      for (const s of [-1, 1]) {
        const off = s * (w.w / 2 - w.w * 0.12),
          x = w.x + inX + (alongZ ? 0 : off),
          z = w.z + inZ + (alongZ ? off : 0);
        linkW(curtainB, curtainB.add(place(x, w.y - 0.05, z, rot, w.w * 0.3, h + 0.35, 0.05), color));
      }
    });
    // Open door leaves swung back against the inside of the wall.
    const doorB = batch('door', unitBox, detailMaterial('wood', 0xffffff, { scale: 0.8, strength: 0.7 }), { colors: true });
    for (const d of map.doors) {
      const b = map.buildings[d.building],
        leaf = d.w / 2 - 0.05;
      [-1, 1].forEach((s, k) => {
        const x = d.x + s * (d.w / 2 + leaf / 2 - 0.05),
          z = d.z - d.face * 0.26,
          i = doorB.add(place(x, 1.3, z, s * d.face * 0.18, leaf, 2.55, 0.06), b.accent);
        link(this.byPanel, d.panels[k], doorB, i);
      });
    }
    // Furniture, street furniture and cars.
    for (const d of map.decor) {
      const at = place(d.x, d.y, d.z, d.rot, 1, 1, 1).clone();
      if (d.box) {
        const bt = batch(d.building === undefined ? 'decor-box' : 'decor-box-in', unitBox, detailMaterial('wood', 0xffffff, { scale: 0.9, strength: 0.6 }), {
          colors: true,
          shadow: d.building === undefined,
          near: d.building !== undefined,
        });
        link(this.byDecor, d.id, bt, bt.add(place(d.x, d.y + d.box[1] / 2, d.z, 0, d.box[0], d.box[1], d.box[2]), d.color ?? 0x8a7f6d));
        continue;
      }
      // Furniture indoors sits in the walls' shadow anyway: it skips the shadow pass (it is most of the triangles).
      const indoor = d.building !== undefined;
      modelParts('decor-' + d.model).forEach((part, k) => {
        const bt = batch((indoor ? 'decor-in:' : 'decor:') + d.model + ':' + k, part.geometry, indoor ? nearOnly(part.material) : part.material, {
          colors: true,
          shadow: !indoor,
          near: indoor,
        });
        link(this.byDecor, d.id, bt, bt.add(at.clone().multiply(part.matrix), 0xffffff));
      });
    }
    // Trash bags beside dumpsters.
    const bagGeo = new T.IcosahedronGeometry(1, 1);
    this.owned.push(bagGeo);
    const bagB = batch('bags', bagGeo, new T.MeshStandardMaterial({ color: 0x23262a, roughness: 0.45, flatShading: true }), {
      colors: true,
    });
    for (const t of map.trash) bagB.add(place(t.x, t.s * 0.75, t.z, t.r, t.s, t.s * 0.9, t.s * 1.1), (t.r * 100) % 3 < 1 ? 0x2f4a33 : 0xffffff);
    for (const b of this.batches.values()) b.build(this.root);
    for (const o of precut) this.applyCells(o, o.cells);
    // Upper storeys: one merged group per building so it can fall as a unit.
    for (const b of map.buildings) {
      const group = mergeByMaterial(model(b.model), b.color);
      group.position.set(b.x, 0, b.z);
      group.userData.building = b.id;
      this.root.add(group);
      this.uppers.set(b.id, group);
    }
  }
  hideList(table, id) {
    for (const { batch, index } of table.get(id) || []) batch.hide(index);
  }
  hidePanel(id) {
    this.hideList(this.byPanel, id);
    this.clearCells(id);
  }
  clearCells(id) {
    const slot = this.cellSlots.get(id);
    if (!slot) return;
    const arr = slot.layer.mesh.instanceMatrix.array;
    arr.fill(0, slot.start * 16, (slot.start + slot.count) * 16);
    slot.layer.mesh.instanceMatrix.needsUpdate = true;
  }
  // Cells still standing in a panel (all of them while it is intact) — used to burst a whole wall into cubes.
  standingCells(id) {
    const wall = this.wallOf.get(id);
    if (!wall) return [];
    const o = wall.o,
      g = cellGrid(o),
      slot = this.cellSlots.get(id),
      out = [];
    for (let i = 0; i < g.cols * g.rows; i++) if (!slot || slot.alive[i]) out.push(cellCenter(o, i));
    return out;
  }
  // Mirror a damaged wall: draw its remaining cells, return the world positions of the ones that just went.
  applyCells(o, previous) {
    const wall = this.wallOf.get(o.panel);
    if (!wall) return { removed: [], glass: null };
    const g = cellGrid(o),
      n = g.cols * g.rows;
    let slot = this.cellSlots.get(o.panel);
    const rects = g.slab ? cellRects(o) : null,
      // Walls draw every cell (they read as blocks); slabs draw merged runs of cells.
      need = g.slab ? rects.length : n;
    if (!slot || need > slot.count) {
      if (slot) this.clearCells(o.panel);
      else for (const i of wall.indices || [wall.index]) wall.batch.hide(i);
      const matKey = wall.matKey;
      if (!this.cellLayers.has(matKey)) this.cellLayers.set(matKey, new CellLayer(this.root, this.batches.get(matKey).material));
      const layer = this.cellLayers.get(matKey),
        count = g.slab ? Math.max(8, need * 2) : n;
      slot = { layer, start: layer.alloc(count), count, alive: slot?.alive || new Uint8Array(n).fill(1) };
      this.cellSlots.set(o.panel, slot);
      const base = new T.Color(o.color),
        c = new T.Color();
      for (let i = 0; i < count; i++) {
        // Slight per-cell shade so the wall reads as stacked blocks.
        const h = ((o.panel * 131 + i * 977) % 23) / 23;
        layer.mesh.setColorAt(slot.start + i, c.copy(base).multiplyScalar(g.slab ? 1 : 0.9 + h * 0.14));
      }
      layer.mesh.instanceColor.needsUpdate = true;
    }
    const m = new T.Matrix4(),
      removed = [];
    // Blocks around a hole are darkened (broken, scorched edges) so holes read as holes, not as a texture patch
    // when the wall behind looks the same.
    if (!g.slab) {
      const base = new T.Color(o.color),
        c = new T.Color();
      for (let i = 0; i < n; i++) {
        if (!(o.cells[i] > 0)) continue;
        const col = i % g.cols,
          row = Math.floor(i / g.cols);
        let open = 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = col + dc,
            rr = row + dr;
          if (cc >= 0 && rr >= 0 && cc < g.cols && rr < g.rows && !(o.cells[rr * g.cols + cc] > 0)) open++;
        }
        const h = ((o.panel * 131 + i * 977) % 23) / 23;
        slot.layer.mesh.setColorAt(slot.start + i, c.copy(base).multiplyScalar((0.9 + h * 0.14) * (open ? 0.55 - Math.min(2, open) * 0.08 : 1)));
      }
      slot.layer.mesh.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < n; i++) {
      const alive = o.cells[i] > 0,
        was = previous ? previous[i] > 0 : slot.alive[i] > 0;
      if (!g.slab) {
        if (alive) {
          const c = i % g.cols,
            r = Math.floor(i / g.cols),
            q = cellBox(o, c, c, r, r);
          m.makeScale(q.w, q.h, q.d).setPosition(q.x, q.y, q.z);
        } else m.makeScale(0, 0, 0);
        slot.layer.mesh.setMatrixAt(slot.start + i, m);
      }
      if (was && !alive) removed.push(cellCenter(o, i));
      slot.alive[i] = alive ? 1 : 0;
    }
    if (g.slab)
      for (let i = 0; i < slot.count; i++) {
        const q = rects[i];
        if (q) m.makeScale(q.w, q.h, q.d).setPosition(q.x, q.y, q.z);
        else m.makeScale(0, 0, 0);
        slot.layer.mesh.setMatrixAt(slot.start + i, m);
      }
    slot.layer.mesh.instanceMatrix.needsUpdate = true;
    // Glass and curtains go once the wall around the window is holed.
    const win = this.windowOf.get(o.panel);
    let shattered = null;
    if (win && !win.broken) {
      const w = win.w;
      for (let i = 0; i < n && !shattered; i++) {
        if (o.cells[i] > 0) continue;
        const p = cellCenter(o, i),
          along = g.alongX ? p.x - w.x : p.z - w.z;
        if (Math.abs(along) < w.w / 2 + g.cw / 2 && Math.abs(p.y - w.y) < 0.6 + g.ch / 2) shattered = w;
      }
      if (shattered) {
        win.broken = true;
        for (const { batch, index } of win.parts) batch.hide(index);
      }
    }
    return { removed, glass: shattered };
  }
  hideDecor(id) {
    this.hideList(this.byDecor, id);
  }
  wreck(id, fx) {
    for (const { batch, index } of this.byDecor.get(id) || []) batch.tint(index, 0x2d2926);
    const d = this.map.decor[id];
    if (d && fx) this.fires.push({ x: d.x, y: d.y + 1.2, z: d.z, t: 22 });
  }
  hideProp(id) {
    this.hideList(this.byProp, id);
  }
  // Positions for a burst of blocks filling the roof volume.
  roofBlocks(b) {
    const out = [],
      y0 = b.roofBase ?? 3.84,
      y1 = Math.max(y0 + 0.6, b.height);
    for (let i = 0; i < 90; i++)
      out.push({ x: b.x + (Math.random() - 0.5) * b.w, y: y0 + Math.random() * (y1 - y0), z: b.z + (Math.random() - 0.5) * b.d });
    return out;
  }
  breakRoof(b) {
    const group = this.uppers.get(b.id);
    if (group) group.visible = false;
  }
  // An upper storey gives way: its walls and everything above disappear, the roof drops onto the floor below.
  collapseStorey(b, storey, animate = true) {
    for (const d of this.map.decor) if (d.building === b.id && d.storey >= storey) this.hideDecor(d.id);
    for (const [id, o] of this.stairOf) if (o.building === b.id && o.storey >= storey) this.hideProp(id);
    for (const [id, wall] of this.wallOf) if (wall.o.building === b.id && wall.o.storey >= storey) this.hidePanel(id);
    for (const s of this.slabs.get(b.id) || []) if (s.storey >= storey) s.batch.hide(s.index);
    const group = this.uppers.get(b.id);
    if (group?.visible) {
      if (animate)
        this.falling.push({ b, group, t: 0, vy: 0, tilt: (b.id % 2 ? 1 : -1) * 0.3, axis: b.id % 3 ? 'x' : 'z', y: 3.84 + (storey - 1) * 3.6 });
      else group.visible = false;
    }
  }
  // Wall panels of the storeys from `storey` up (for bursting them into blocks).
  panelsFrom(b, storey) {
    const out = [];
    for (const [id, wall] of this.wallOf) if (wall.o.building === b.id && wall.o.storey >= storey) out.push(id);
    return out;
  }
  // Upper storeys drop and tilt, then rubble appears. `animate` false applies instantly (late state sync).
  collapse(b, animate = true) {
    const group = this.uppers.get(b.id);
    this.hideList(this.byRoof, b.id);
    for (const [id, wall] of this.wallOf) if (wall.o.building === b.id) this.hidePanel(id);
    for (const d of this.map.decor) if (d.building === b.id) this.hideDecor(d.id);
    for (const [id, o] of this.stairOf) if (o.building === b.id) this.hideProp(id);
    if (group) {
      if (animate) this.falling.push({ b, group, t: 0, vy: 0, tilt: (b.id % 2 ? 1 : -1) * 0.22, axis: b.id % 3 ? 'x' : 'z' });
      else group.visible = false;
    }
    const mat = detailMaterial('concrete', 0xffffff, { scale: 0.6, strength: 0.7, key: 'rubble' });
    for (const r of rubbleFor(b, this.map.chests)) {
      const m = new T.Mesh(new T.DodecahedronGeometry(0.5, 0), mat.clone());
      m.material.color.set(r.color);
      m.scale.set(r.w, r.h * 1.6, r.d);
      m.position.set(r.x, r.h * 0.45, r.z);
      m.rotation.y = r.rot;
      m.castShadow = m.receiveShadow = true;
      m.visible = !animate;
      m.userData.appear = animate ? 0.9 : 0;
      this.root.add(m);
      this.rubble.push(m);
    }
  }
  // Refills the near-only furniture batches when the camera has moved NEAR_STEP metres.
  // Every scenery batch only keeps the instances in range: indoor furniture within NEAR_RADIUS, everything else
  // within the view distance (beyond it the fog is opaque). Refilled after the camera moves a few metres.
  cull(x, z, view = 250, force = false) {
    const far = view + 40,
      whole = Math.hypot(this.map.limit.x, this.map.limit.z) * 2 < far - 20;
    if (force || !this.farAt || Math.hypot(x - this.farAt.x, z - this.farAt.z) >= FAR_STEP || this.farView !== view) {
      if (!(whole && this.farWhole && !force)) for (const b of this.batches.values()) if (!b.near) b.cull(x, z, whole ? 1e6 : far);
      this.farAt = { x, z };
      this.farView = view;
      this.farWhole = whole;
    }
    if (force || !this.nearAt || Math.hypot(x - this.nearAt.x, z - this.nearAt.z) >= NEAR_STEP) {
      this.nearAt = { x, z };
      const r = Math.min(NEAR_RADIUS, view);
      for (const b of this.batches.values()) if (b.near) b.cull(x, z, r);
    }
  }
  update(dt, fx) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      f.vy += 16 * dt;
      f.group.position.y -= f.vy * dt;
      f.group.rotation[f.axis] += f.tilt * dt * 1.6;
      if (f.t > 1.35) {
        f.group.visible = false;
        fx?.landing?.(f.b, f.y || 0);
        this.falling.splice(i, 1);
      }
    }
    for (const r of this.rubble)
      if (r.userData.appear > 0) {
        r.userData.appear -= dt;
        r.visible = r.userData.appear <= 0;
      }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      f.clock = (f.clock || 0) + dt;
      if (f.clock > 0.06) {
        f.clock = 0;
        fx?.fire(f);
      }
      if (f.t <= 0) this.fires.splice(i, 1);
    }
  }
  dispose() {
    this.root.removeFromParent();
    for (const b of this.batches.values()) b.mesh?.dispose();
    for (const l of this.cellLayers.values()) l.mesh.dispose();
    for (const g of this.uppers.values()) g.traverse((o) => o.isMesh && o.geometry.dispose());
    for (const r of this.rubble) {
      r.geometry.dispose();
      r.material.dispose();
    }
    for (const g of this.owned) g.dispose();
  }
}
