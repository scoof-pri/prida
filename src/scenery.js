// The changeable part of the district: wall panels, windows with curtains, doors, furniture, street furniture,
// cars and the roofs. Everything repeated is instanced, so hundreds of props cost a few draw calls; destroyed
// items are hidden by zero-scaling their instance. Every instance belongs to a visibility group (culling.js):
// the instance buffers only hold what the camera can see (in range, in view, not behind a building).
import * as T from 'three';
import { modelParts } from './assets.js';
import { detailMaterial, glassMaterial, kitMaterial, carMaterial, streetMaterial } from './materials.js';
import { RoofField, facadeOf } from './roofs.js';
import { DECOR_INFO } from './decor-layout.js';
import { rubbleFor } from './destruction.js';
import { rubbleGeometry } from './rubble.js';
import { cellGrid, cellCenter, cellBox, cellRects } from './cells.js';
import { Culler } from './culling.js';

const CURTAINS = [0xb35d4f, 0x5d7fa3, 0xd6b25e, 0x6f9a6b, 0x9c6fa3, 0xe0d7c6, 0x3f5d5a];
// Window frames: white PVC, dark aluminium, warm timber, anthracite.
const FRAMES = [0xeeeae2, 0x3b4046, 0x8a6a4a, 0x2d3033];
const unitBox = new T.BoxGeometry(1, 1, 1);
// Panes and curtains are thin: one double-sided quad each instead of a box.
const paneGeo = new T.PlaneGeometry(1, 1);
const box3 = new T.Box3();
// Broken masonry: the world's surfaces, tinted per vertex (shared by every collapsed building).
function rubbleMaterial(name, strength) {
  const m = detailMaterial(name, 0xffffff, { strength, key: 'rubble', roughness: 0.95 });
  m.vertexColors = true;
  return m;
}
function curtainMaterial() {
  const m = detailMaterial('fabric', 0xffffff, { box: true, strength: 0.8, key: 'curtain' });
  m.side = T.DoubleSide;
  return m;
}

// Instances of one geometry/material pair, sorted by visibility group. The full list stays on the CPU; the
// instance buffer holds only the visible groups and is refilled when the visible set changes.
export class CulledBatch {
  constructor(geometry, material, { shadow = true, colors = false, outward = false } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.shadow = shadow;
    this.colors = colors;
    this.outward = outward;
    this.items = [];
    this.version = -1;
  }
  // `out`: the outward direction of a wall panel (its inside face is painted plaster), for `outward` batches.
  add(matrix, color, group = 0, out = null) {
    this.items.push({ matrix: matrix.clone(), color, group, out });
    return this.items.length - 1;
  }
  build(parent, culler) {
    const items = this.items,
      n = items.length;
    if (!n) return;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => items[a].group - items[b].group || a - b);
    this.pos = new Int32Array(n);
    this.mat = new Float32Array(n * 16);
    this.col = this.colors ? new Float32Array(n * 3) : null;
    this.out = this.outward ? new Float32Array(n * 3) : null;
    const c = new T.Color();
    if (!this.geometry.boundingBox) this.geometry.computeBoundingBox();
    order.forEach((it, k) => {
      this.pos[it] = k;
      items[it].matrix.toArray(this.mat, k * 16);
      if (this.col) c.set(items[it].color ?? 0xffffff).toArray(this.col, k * 3);
      if (this.out && items[it].out) this.out.set(items[it].out, k * 3);
      if (culler) culler.extendBox(items[it].group, box3.copy(this.geometry.boundingBox).applyMatrix4(items[it].matrix));
    });
    this.runs = [];
    for (let k = 0; k < n; ) {
      const g = items[order[k]].group;
      let e = k + 1;
      while (e < n && items[order[e]].group === g) e++;
      this.runs.push({ group: g, start: k, end: e, slot: -1 });
      k = e;
    }
    this.runOf = new Int32Array(n);
    this.runs.forEach((r, i) => this.runOf.fill(i, r.start, r.end));
    if (this.out) {
      // Own copy of the geometry for the per-instance attribute.
      this.geometry = this.geometry.clone();
      this.geometry.setAttribute('aOut', new T.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
      this.owned = true;
    }
    const mesh = new T.InstancedMesh(this.geometry, this.material, n);
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if (this.col) mesh.setColorAt(0, c.set(0xffffff));
    mesh.count = 0;
    this.mesh = mesh;
    this.items = null;
    parent.add(mesh);
  }
  refill(visible, version) {
    if (!this.mesh || this.version === version) return;
    this.version = version;
    const mesh = this.mesh,
      arr = mesh.instanceMatrix.array,
      carr = mesh.instanceColor?.array;
    let n = 0;
    for (const r of this.runs) {
      if (!visible[r.group]) {
        r.slot = -1;
        continue;
      }
      r.slot = n;
      arr.set(this.mat.subarray(r.start * 16, r.end * 16), n * 16);
      if (carr) carr.set(this.col.subarray(r.start * 3, r.end * 3), n * 3);
      if (this.out) this.geometry.attributes.aOut.array.set(this.out.subarray(r.start * 3, r.end * 3), n * 3);
      n += r.end - r.start;
    }
    mesh.count = n;
    if (this.out) {
      const a = this.geometry.attributes.aOut;
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, n) * 3);
      a.needsUpdate = true;
    }
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, Math.max(1, n) * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }
  slot(i) {
    const k = this.pos[i],
      r = this.runs[this.runOf[k]];
    return r.slot < 0 ? -1 : r.slot + k - r.start;
  }
  hide(i) {
    if (!this.mesh) return;
    const k = this.pos[i];
    this.mat.fill(0, k * 16, k * 16 + 16);
    const s = this.slot(i);
    if (s >= 0) {
      // Ranges add up until the next upload: several items can be hidden in one frame (a collapse hides dozens).
      this.mesh.instanceMatrix.array.fill(0, s * 16, s * 16 + 16);
      this.mesh.instanceMatrix.addUpdateRange(s * 16, 16);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  tint(i, color) {
    if (!this.col) return;
    const c = new T.Color(color),
      k = this.pos[i];
    c.toArray(this.col, k * 3);
    const s = this.slot(i);
    if (s >= 0 && this.mesh.instanceColor) {
      c.toArray(this.mesh.instanceColor.array, s * 3);
      this.mesh.instanceColor.addUpdateRange(s * 3, 3);
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
      geometry = unitBox.clone(),
      mesh = new T.InstancedMesh(geometry, this.material, capacity);
    // Outward direction per cell (the inside of an outer wall shows painted plaster, like the intact panel).
    geometry.setAttribute('aOut', new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.setColorAt(0, new T.Color(1, 1, 1));
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      mesh.instanceColor.array.set(old.instanceColor.array);
      geometry.attributes.aOut.array.set(old.geometry.attributes.aOut.array);
      old.removeFromParent();
      old.geometry.dispose();
      old.dispose();
    } else mesh.instanceMatrix.array.fill(0);
    mesh.count = this.used;
    this.parent.add(mesh);
    this.mesh = mesh;
    this.capacity = capacity;
  }
  alloc(n, out = null) {
    if (this.used + n > this.capacity) this.grow(Math.max(this.capacity * 2, this.used + n));
    const start = this.used;
    this.used += n;
    this.mesh.count = this.used;
    if (out) {
      const a = this.mesh.geometry.attributes.aOut;
      for (let i = start; i < start + n; i++) a.array.set(out, i * 3);
      a.needsUpdate = true;
    }
    return start;
  }
}
// Outward direction of an exterior wall (partitions and slabs have none).
const OUTWARD = { west: [-1, 0, 0], east: [1, 0, 0], north: [0, 0, -1], south: [0, 0, 1] };
function outwardOf(o, b) {
  if (OUTWARD[o.face]) return OUTWARD[o.face];
  if (o.part === 'lintel' && b) return o.z < b.z ? OUTWARD.north : OUTWARD.south;
  return null;
}

export class Scenery {
  constructor(scene, map) {
    this.map = map;
    this.root = new T.Group();
    this.root.name = 'scenery';
    scene.add(this.root);
    this.culler = new Culler(map);
    this.batches = new Map();
    this.byPanel = new Map(); // panel id -> [{batch, index}]
    this.byDecor = new Map(); // decor id -> [{batch, index}]
    this.byRoof = new Map();
    this.buildingPanels = new Map(); // building id -> panel ids (walls, lintels, partitions)
    this.uppers = new Map(); // building id -> { visible } (its roof)
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
    const culler = this.culler,
      m4 = new T.Matrix4(),
      q = new T.Quaternion(),
      up = new T.Vector3(0, 1, 0);
    const place = (x, y, z, rot, sx, sy, sz) =>
      m4.compose(new T.Vector3(x, y, z), q.setFromAxisAngle(up, rot), new T.Vector3(sx, sy, sz));
    const batch = (key, geometry, material, opts) => {
      if (!this.batches.has(key)) this.batches.set(key, new CulledBatch(geometry, material, opts));
      return this.batches.get(key);
    };
    const link = (table, id, b, i) => {
      if (!table.has(id)) table.set(id, []);
      table.get(id).push({ batch: b, index: i });
    };
    // Visibility group of a building part: storey contents are rooms, everything structural is the shell.
    const shell = (b) => culler.shell(b),
      room = (b, storey) => culler.room(b, storey || 0);
    // Wall panels, lintels and partitions: bricks, painted plaster or concrete panels, tinted per building.
    const bandB = batch('facade-band', unitBox, detailMaterial('concrete', 0xd9d3c6, { box: true, key: 'band' })),
      plinthB = batch('facade-plinth', unitBox, detailMaterial('concrete', 0x77736b, { box: true, key: 'plinth' }));
    for (const o of map.obstacles) {
      const b = map.buildings[o.building];
      if (o.panel !== undefined && o.part !== 'roof') {
        if (!this.buildingPanels.has(o.building)) this.buildingPanels.set(o.building, []);
        this.buildingPanels.get(o.building).push(o.panel);
        const key = o.part === 'partition' ? 'partition' : b ? facadeOf(b) : 'plaster',
          out = key === 'partition' ? null : outwardOf(o, b),
          bt = batch(
            'wall:' + key,
            unitBox,
            detailMaterial(key === 'partition' ? 'plaster' : key, 0xffffff, { box: true, strength: 0.75, interior: key !== 'partition' }),
            { colors: true, outward: key !== 'partition' },
          ),
          group = o.part === 'partition' ? room(o.building, o.storey) : shell(o.building);
        // A panel with a window is four pieces around the opening.
        const pieces = [];
        if (o.hole) {
          const h = o.hole,
            ax = h.alongX,
            lo = ax ? o.x - o.w / 2 : o.z - o.d / 2,
            hi = ax ? o.x + o.w / 2 : o.z + o.d / 2,
            bottom = o.y - o.h / 2,
            top = o.y + o.h / 2,
            piece = (a0, a1, y0, y1) => {
              if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
              const a = (a0 + a1) / 2,
                y = (y0 + y1) / 2;
              pieces.push((ax ? place(a, y, o.z, 0, a1 - a0, y1 - y0, o.d) : place(o.x, y, a, 0, o.w, y1 - y0, a1 - a0)).clone());
            };
          piece(lo, hi, bottom, h.y0);
          piece(lo, hi, h.y1, top);
          piece(lo, h.a0, h.y0, h.y1);
          piece(h.a1, hi, h.y0, h.y1);
        } else pieces.push(place(o.x, o.y, o.z, 0, o.w, o.h, o.d));
        const indices = pieces.map((m) => bt.add(m, o.color, group, out));
        for (const index of indices) link(this.byPanel, o.panel, bt, index);
        this.wallOf.set(o.panel, { batch: bt, index: indices[0], indices, key, matKey: 'wall:' + key, o, out });
        // Facade relief on outer walls: a stone band along every floor line and a dark plinth at the foot.
        if (out && o.structural && o.part === 'wall') {
          // From just inside the wall (no coplanar inner face) to `depth` beyond its outer face.
          const top = o.y + o.h / 2,
            along = o.w > o.d,
            len = along ? o.w : o.d,
            band = (y, h, depth, bt2) => {
              const thick = 0.35 + depth,
                c = (0.05 + depth) / 2;
              link(this.byPanel, o.panel, bt2, bt2.add(place(o.x + out[0] * c, y, o.z + out[2] * c, 0, along ? len : thick, h, along ? thick : len), undefined, group));
            };
          band(top - 0.1, 0.24, 0.14, bandB);
          if (!(o.storey > 0)) band(0.25, 0.5, 0.1, plinthB);
        }
      } else if (o.part === 'stair') {
        const bt = batch('stair', unitBox, detailMaterial('concrete', 0xffffff, { box: true, strength: 0.6 }), { colors: true });
        this.stairOf.set(o.prop, o);
        link(this.byProp, o.prop, bt, bt.add(place(o.x, o.y, o.z, 0, o.w, o.h, o.d), o.step % 2 ? 0xc4bdaf : 0xb3ac9e, room(o.building, o.storey)));
      } else if (o.part === 'roof') {
        const bt = batch('roof', unitBox, detailMaterial('concrete', 0xffffff, { box: true, strength: 0.5, ceiling: true }), {
            colors: true,
          }),
          // Floor slabs break cell by cell like walls (coarser cells). Pre-cut ones (stairwells) are drawn as the
          // merged runs of their cells, in the same culled batch until they are damaged.
          boxes = o.cells ? cellRects(o).filter(Boolean) : [o],
          indices = boxes.map((q) => bt.add(place(q.x, q.y, q.z, 0, q.w, q.h, q.d), o.color, shell(o.building)));
        if (!this.slabs.has(o.building)) this.slabs.set(o.building, []);
        for (const index of indices) {
          link(this.byRoof, o.building, bt, index);
          if (o.panel !== undefined) link(this.byPanel, o.panel, bt, index);
          this.slabs.get(o.building).push({ storey: o.storey || 0, batch: bt, index });
        }
        if (o.panel !== undefined) this.wallOf.set(o.panel, { batch: bt, index: indices[0], indices, key: 'roof', matKey: 'roof', o, precut: !!o.cells });
      }
    }
    // Windows: frame and glass reach through the wall so both sides show; a stone sill outside, curtains inside.
    const frameB = batch('window-frame', unitBox, detailMaterial('metal', 0xffffff, { box: true, roughness: 0.45, metalness: 0.1, key: 'frame' }), {
        colors: true,
      }),
      sillB = batch('window-sill', unitBox, detailMaterial('concrete', 0xd6d0c4, { box: true, key: 'sill' })),
      // Clear, reflective glass: you see into the rooms (and out of them); it shatters on the first hit.
      glassB = batch('window-glass', paneGeo, glassMaterial(), { shadow: false }),
      glassOf = new Map(map.obstacles.filter((o) => o.part === 'glass').map((o) => [o.windowPanel, o.prop])),
      panelOf = new Map(map.obstacles.filter((o) => o.panel !== undefined).map((o) => [o.panel, o])),
      curtainB = batch('curtain', paneGeo, curtainMaterial(), {
        colors: true,
        shadow: false,
      });
    map.windows.forEach((w, i) => {
      const alongZ = w.axis === 'z',
        rot = alongZ ? Math.PI / 2 : 0,
        h = 1.15,
        wall = panelOf.get(w.panel),
        b = wall ? map.buildings[wall.building] : null,
        group = wall ? shell(wall.building) : culler.outdoor(w.x, w.z),
        detail = wall ? culler.detail(wall.building) : group,
        frame = FRAMES[b ? (b.id * 3 + (b.category === 'office' ? 1 : 0)) % FRAMES.length : 0];
      const parts = [];
      this.windowOf.set(w.panel, { w, parts });
      const linkW = (bt, i) => (parts.push({ batch: bt, index: i }), link(this.byPanel, w.panel, bt, i));
      const cx = w.x - (alongZ ? w.out * 0.21 : 0),
        cz = w.z - (alongZ ? 0 : w.out * 0.21),
        bar = (u, v, bw, bh, depth = 0.47) => place(cx + (alongZ ? 0 : u), w.y + v, cz + (alongZ ? u : 0), rot, bw, bh, depth);
      // Frame: bottom rail, head and two jambs around the opening, plus a mullion.
      for (const m of [
        bar(0, -h / 2 - 0.035, w.w + 0.14, 0.08),
        bar(0, h / 2 + 0.035, w.w + 0.14, 0.08),
        bar(-w.w / 2 - 0.035, 0, 0.08, h),
        bar(w.w / 2 + 0.035, 0, 0.08, h),
        bar(0, 0, 0.05, h, 0.12),
      ])
        linkW(frameB, frameB.add(m, frame, detail));
      // Stone sill sticking out of the facade below the window.
      const sx = cx + (alongZ ? w.out * 0.3 : 0),
        sz = cz + (alongZ ? 0 : w.out * 0.3);
      linkW(sillB, sillB.add(place(sx, w.y - h / 2 - 0.1, sz, rot, w.w + 0.3, 0.07, 0.24), undefined, detail));
      // Stone lintel over the opening.
      linkW(sillB, sillB.add(place(cx + (alongZ ? w.out * 0.23 : 0), w.y + h / 2 + 0.08, cz + (alongZ ? 0 : w.out * 0.23), rot, w.w + 0.26, 0.16, 0.1), undefined, detail));
      const pane = glassB.add(place(cx, w.y, cz, rot, w.w, h, 0.03), undefined, group);
      linkW(glassB, pane);
      if (glassOf.has(w.panel)) link(this.byProp, glassOf.get(w.panel), glassB, pane);
      const color = CURTAINS[(i * 7 + w.panel) % CURTAINS.length],
        inX = alongZ ? -w.out * 0.52 : 0,
        inZ = alongZ ? 0 : -w.out * 0.52;
      for (const s of [-1, 1]) {
        const off = s * (w.w / 2 - w.w * 0.12),
          x = w.x + inX + (alongZ ? 0 : off),
          z = w.z + inZ + (alongZ ? off : 0);
        linkW(curtainB, curtainB.add(place(x, w.y - 0.05, z, rot, w.w * 0.3, h + 0.35, 0.05), color, detail));
      }
    });
    // Open door leaves swung back against the inside of the wall, in a painted timber frame.
    const doorB = batch('door', unitBox, detailMaterial('oak', 0xffffff, { box: true, roughness: 0.6, key: 'door' }), { colors: true });
    for (const d of map.doors) {
      const b = map.buildings[d.building],
        leaf = d.w / 2 - 0.05,
        group = culler.detail(d.building);
      [-1, 1].forEach((s, k) => {
        const x = d.x + s * (d.w / 2 + leaf / 2 - 0.05),
          z = d.z - d.face * 0.26,
          i = doorB.add(place(x, 1.3, z, s * d.face * 0.18, leaf, 2.55, 0.06), b.accent, group);
        link(this.byPanel, d.panels[k], doorB, i);
      });
    }
    // Furniture, street furniture and cars.
    const wood = detailMaterial('oak', 0xffffff, { box: true, roughness: 0.7, key: 'crate' });
    for (const d of map.decor) {
      const at = place(d.x, d.y, d.z, d.rot, 1, 1, 1).clone(),
        indoor = d.building !== undefined,
        group = indoor ? room(d.building, d.storey) : culler.outdoor(d.x, d.z);
      if (d.box) {
        const bt = batch(indoor ? 'decor-box-in' : 'decor-box', unitBox, wood, { colors: true, shadow: !indoor });
        link(this.byDecor, d.id, bt, bt.add(place(d.x, d.y + d.box[1] / 2, d.z, 0, d.box[0], d.box[1], d.box[2]), d.color ?? 0x8a7f6d, group));
        continue;
      }
      // Furniture indoors sits in the walls' shadow anyway: it skips the shadow pass (it is most of the triangles).
      const car = !!DECOR_INFO[d.model]?.car;
      modelParts('decor-' + d.model).forEach((part, k) => {
        const material = part.material.map ? (car ? carMaterial(part.material) : streetMaterial(part.material)) : kitMaterial(part.material),
          bt = batch((indoor ? 'decor-in:' : 'decor:') + d.model + ':' + k, part.geometry, material, { colors: true, shadow: !indoor });
        link(this.byDecor, d.id, bt, bt.add(at.clone().multiply(part.matrix), 0xffffff, group));
      });
    }
    // Trash bags beside dumpsters: glossy black plastic.
    const bagGeo = new T.IcosahedronGeometry(1, 2);
    this.owned.push(bagGeo);
    const bagB = batch('bags', bagGeo, new T.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.28, metalness: 0.05, envMapIntensity: 1.2 }), {
      colors: true,
    });
    for (const t of map.trash)
      bagB.add(place(t.x, t.s * 0.75, t.z, t.r, t.s, t.s * 0.9, t.s * 1.1), (t.r * 100) % 3 < 1 ? 0x2f4a33 : 0xffffff, culler.outdoor(t.x, t.z));
    for (const b of this.batches.values()) b.build(this.root, culler);
    // Roofs: one merged mesh per material for the whole map.
    this.roofs = new RoofField(map, this.root);
    for (const b of map.buildings) this.uppers.set(b.id, { visible: true });
  }
  // Takes over a batch built elsewhere (nature): it joins the visibility groups and is refilled with the rest.
  adopt(key, batch) {
    batch.build(this.root, this.culler);
    this.batches.set(key, batch);
  }
  hideList(table, id) {
    for (const { batch, index } of table.get(id) || []) batch.hide(index);
  }
  hidePanel(id) {
    const wall = this.wallOf.get(id);
    if (wall) this.culler.markDamaged(wall.o.building);
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
  applyCells(o, previous, initial = false) {
    const wall = this.wallOf.get(o.panel);
    if (!wall) return { removed: [], glass: null };
    // Holes let the eye through: the building stops hiding what is behind it (stairwells are cut from the start).
    if (!initial) this.culler.markDamaged(o.building);
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
      slot = { layer, start: layer.alloc(count, wall.out), count, alive: slot?.alive || (previous ? Uint8Array.from(previous, (v) => (v > 0 ? 1 : 0)) : new Uint8Array(n).fill(1)) };
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
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
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
    const u = this.uppers.get(b.id);
    if (!u?.visible) return;
    u.visible = false;
    this.roofs.hide(b.id);
    this.culler.markDamaged(b.id);
  }
  // The roof leaves the merged mesh; animated, a copy of it falls and tilts.
  dropRoof(b, extra, animate) {
    const u = this.uppers.get(b.id);
    if (!u?.visible) return;
    u.visible = false;
    this.roofs.hide(b.id);
    if (!animate) return;
    const group = this.roofs.copy(b);
    this.root.add(group);
    this.falling.push({ b, group, t: 0, vy: 0, ...extra });
  }
  // An upper storey gives way: its walls and everything above disappear, the roof drops onto the floor below.
  collapseStorey(b, storey, animate = true) {
    this.culler.markDamaged(b.id);
    for (const d of this.map.decor) if (d.building === b.id && d.storey >= storey) this.hideDecor(d.id);
    for (const [id, o] of this.stairOf) if (o.building === b.id && o.storey >= storey) this.hideProp(id);
    for (const [id, wall] of this.wallOf) if (wall.o.building === b.id && wall.o.storey >= storey) this.hidePanel(id);
    for (const s of this.slabs.get(b.id) || []) if (s.storey >= storey) s.batch.hide(s.index);
    this.dropRoof(b, { tilt: (b.id % 2 ? 1 : -1) * 0.3, axis: b.id % 3 ? 'x' : 'z', y: 3.84 + (storey - 1) * 3.6 }, animate);
  }
  // Wall panels of the storeys from `storey` up (for bursting them into blocks).
  panelsFrom(b, storey) {
    const out = [];
    for (const [id, wall] of this.wallOf) if (wall.o.building === b.id && wall.o.storey >= storey) out.push(id);
    return out;
  }
  // Upper storeys drop and tilt, then rubble appears. `animate` false applies instantly (late state sync).
  collapse(b, animate = true) {
    this.culler.markDamaged(b.id);
    this.culler.dirty = true;
    this.hideList(this.byRoof, b.id);
    for (const [id, wall] of this.wallOf) if (wall.o.building === b.id) this.hidePanel(id);
    for (const d of this.map.decor) if (d.building === b.id) this.hideDecor(d.id);
    for (const [id, o] of this.stairOf) if (o.building === b.id) this.hideProp(id);
    this.dropRoof(b, { tilt: (b.id % 2 ? 1 : -1) * 0.22, axis: b.id % 3 ? 'x' : 'z' }, animate);
    const { mounds, pieces } = rubbleGeometry(b, rubbleFor(b, this.map.chests));
    for (const [geometry, material] of [
      [mounds, rubbleMaterial('rock', 1)],
      [pieces, rubbleMaterial('concrete', 0.8)],
    ]) {
      if (!geometry) continue;
      const m = new T.Mesh(geometry, material);
      m.castShadow = m.receiveShadow = true;
      m.visible = !animate;
      m.userData.appear = animate ? 0.9 : 0;
      this.root.add(m);
      this.rubble.push(m);
    }
  }
  // Refreshes what the camera can see and refills the instance buffers that changed.
  cull(camera, view = 250, force = false) {
    camera.updateMatrixWorld();
    this.culler.update(camera, view, force);
    for (const b of this.batches.values()) b.refill(this.culler.visible, this.culler.version);
  }
  update(dt, fx) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      f.vy += 16 * dt;
      f.group.position.y -= f.vy * dt;
      f.group.rotation[f.axis] += f.tilt * dt * 1.6;
      if (f.t > 1.35) {
        f.group.removeFromParent();
        f.group.traverse((o) => o.isMesh && o.geometry.dispose());
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
    this.roofs.dispose();
    for (const f of this.falling) f.group.traverse((o) => o.isMesh && o.geometry.dispose());
    for (const r of this.rubble) r.geometry.dispose();
    for (const g of this.owned) g.dispose();
  }
}
