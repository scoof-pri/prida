// Visibility for the instanced scenery: the renderer only draws what the player can actually see.
// Every instance belongs to a group with a bounding box: a building's shell (walls, windows, doors, slabs), the
// contents of one storey of one building, or a 16 m cell of outdoor props. A group is drawn when it is
//  - within range (the view distance; 60 m for furniture),
//  - inside the view frustum (widened by its sun shadow, so shadows cast from off-screen stay), and
//  - not hidden behind a solid building: an occlusion horizon is rebuilt around the camera from the footprints of
//    intact buildings, with see-through gaps where a door or window lines up with one on the opposite wall.
// Rooms are also skipped from below: from the street you only see the ceilings of the flats high above you.
// The result is a Uint8Array per group; batches refill their instance buffers only when it changes.
import * as T from 'three';

const BINS = 720; // occlusion horizon resolution: half a degree
const TAU = Math.PI * 2;
const OUTDOOR_CELL = 16;
const INTERIOR_RANGE = 55;
const DETAIL_RANGE = 110; // window frames, sills, curtains and doors: too small to see beyond this
const STOREY0_TOP = 3.84;
const STOREY_H = 3.6;
// Horizontal shadow offset per metre of height (sun from the north-west, high): see WORLD.sunDir.
const SHADOW_X = 0.55,
  SHADOW_Z = -0.54;

const angleOf = (i) => (i / BINS) * TAU - Math.PI;
const OPEN = [-1e9, 1e9];
// Distance along a ray (ox, oz) + t (dx, dz) through an axis-aligned rectangle: [enter, exit, enterFace, exitFace].
function slab(ox, oz, dx, dz, x0, x1, z0, z1) {
  let tmin = -Infinity,
    tmax = Infinity,
    fmin = -1,
    fmax = -1;
  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return null;
  } else {
    let a = (x0 - ox) / dx,
      b = (x1 - ox) / dx,
      fa = 0,
      fb = 1;
    if (a > b) ([a, b] = [b, a]), ([fa, fb] = [fb, fa]);
    if (a > tmin) (tmin = a), (fmin = fa);
    if (b < tmax) (tmax = b), (fmax = fb);
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return null;
  } else {
    let a = (z0 - oz) / dz,
      b = (z1 - oz) / dz,
      fa = 2,
      fb = 3;
    if (a > b) ([a, b] = [b, a]), ([fa, fb] = [fb, fa]);
    if (a > tmin) (tmin = a), (fmin = fa);
    if (b < tmax) (tmax = b), (fmax = fb);
  }
  if (tmax < tmin || tmax <= 0 || tmin <= 0) return null;
  return [tmin, tmax, fmin, fmax];
}
// Can a sightline from eye height `cy` to a target (heights y0..y1, distances r0..r1) cross a wall that it meets
// at distance t0..t1? Only through one of the openings (height ranges in `gaps`) or above the wall top `H`.
function pass(cy, y0, y1, r0, r1, t0, t1, gaps, H) {
  let lo = Infinity,
    hi = -Infinity;
  for (const y of [y0, y1])
    for (const r of [r0, r1])
      for (const t of [t0, t1]) {
        const h = cy + ((y - cy) * t) / r;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
  if (hi > H) return true;
  if (gaps) for (let i = 0; i < gaps.length; i += 2) if (gaps[i + 1] >= lo && gaps[i] <= hi) return true;
  return false;
}
export class Culler {
  constructor(map) {
    this.map = map;
    this.groups = [];
    this.shells = new Map();
    this.rooms = new Map();
    this.cells = new Map();
    this.visible = new Uint8Array(0);
    this.version = 0;
    this.damaged = new Set(); // buildings with holes: not occluders, all storeys visible from inside
    this.frustum = new T.Frustum();
    this.wide = new T.PerspectiveCamera();
    this.box = new T.Box3();
    this.near = [];
    this.horizon = Array.from({ length: BINS }, () => []);
    // Openings per building face (0: -x, 1: +x, 2: -z, 3: +z): [from, to] along the face and [bottom, top].
    this.openings = new Map();
    const open = (b, face, a0, a1, y0, y1) => {
      if (!this.openings.has(b)) this.openings.set(b, [[], [], [], []]);
      this.openings.get(b)[face].push([a0 - 0.15, a1 + 0.15, y0 - 0.15, y1 + 0.15]);
    };
    for (const d of map.doors) open(d.building, d.face < 0 ? 2 : 3, d.x - d.w / 2, d.x + d.w / 2, 0, 2.7);
    const panels = new Map();
    for (const o of map.obstacles) if (o.panel !== undefined) panels.set(o.panel, o);
    for (const w of map.windows) {
      const o = panels.get(w.panel);
      if (!o) continue;
      if (w.axis === 'z') open(o.building, w.out < 0 ? 0 : 1, w.z - w.w / 2, w.z + w.w / 2, w.y - 0.6, w.y + 0.6);
      else open(o.building, w.out < 0 ? 2 : 3, w.x - w.w / 2, w.x + w.w / 2, w.y - 0.6, w.y + 0.6);
    }
  }
  make(kind, extra) {
    const g = { kind, x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity, ...extra };
    this.groups.push(g);
    return this.groups.length - 1;
  }
  shell(b) {
    if (!this.shells.has(b)) this.shells.set(b, this.make('shell', { building: b }));
    return this.shells.get(b);
  }
  detail(b) {
    const key = -1 - b;
    if (!this.rooms.has(key)) this.rooms.set(key, this.make('detail', { building: b }));
    return this.rooms.get(key);
  }
  room(b, storey) {
    const key = b * 64 + (storey || 0);
    if (!this.rooms.has(key)) this.rooms.set(key, this.make('room', { building: b, storey: storey || 0 }));
    return this.rooms.get(key);
  }
  outdoor(x, z) {
    const cx = Math.floor(x / OUTDOOR_CELL),
      cz = Math.floor(z / OUTDOOR_CELL),
      key = cx * 4096 + cz;
    if (!this.cells.has(key)) this.cells.set(key, this.make('outdoor', {}));
    return this.cells.get(key);
  }
  // Grow a group's bounds by a box (world space).
  extend(id, x0, y0, z0, x1, y1, z1) {
    const g = this.groups[id];
    if (x0 < g.x0) g.x0 = x0;
    if (y0 < g.y0) g.y0 = y0;
    if (z0 < g.z0) g.z0 = z0;
    if (x1 > g.x1) g.x1 = x1;
    if (y1 > g.y1) g.y1 = y1;
    if (z1 > g.z1) g.z1 = z1;
  }
  extendBox(id, box) {
    this.extend(id, box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
  }
  markDamaged(building) {
    if (building === undefined || this.damaged.has(building)) return;
    this.damaged.add(building);
    this.dirty = true;
  }
  // Occlusion horizon around (cx, cy, cz): per half-degree bin, the nearest intact buildings the ray crosses.
  buildHorizon(cx, cy, cz, range) {
    for (const list of this.horizon) list.length = 0;
    // Standing inside a building: its own walls hide everything outside except what shows through its doors
    // and windows.
    const home = this.map.buildings.find((b) => Math.abs(cx - b.x) < b.w / 2 - 0.25 && Math.abs(cz - b.z) < b.d / 2 - 0.25);
    if (home && !home.collapsed && !this.damaged.has(home.id)) {
      const x0 = home.x - home.w / 2,
        x1 = home.x + home.w / 2,
        z0 = home.z - home.d / 2,
        z1 = home.z + home.d / 2,
        holes = this.openings.get(home.id),
        exit = (a) => {
          const dx = Math.cos(a),
            dz = Math.sin(a),
            tx = dx > 1e-9 ? (x1 - cx) / dx : dx < -1e-9 ? (x0 - cx) / dx : Infinity,
            tz = dz > 1e-9 ? (z1 - cz) / dz : dz < -1e-9 ? (z0 - cz) / dz : Infinity;
          return tx < tz ? [tx, dx > 0 ? 1 : 0] : [tz, dz > 0 ? 3 : 2];
        };
      for (let k = 0; k < BINS; k++) {
        const a0 = angleOf(k),
          a1 = angleOf(k + 1),
          e0 = exit(a0),
          e1 = exit(a1);
        if (e0[1] !== e1[1]) continue;
        this.horizon[k].push({
          enterMin: 0,
          enterMax: 0,
          exitMin: Math.min(e0[0], e1[0]),
          exitMax: Math.max(e0[0], e1[0]),
          H: (home.roofBase ?? STOREY0_TOP) - 0.3,
          entry: OPEN,
          exit: this.gaps(holes, e0[1], cx, cz, a0, a1, e0[0], e1[0]),
        });
      }
    }
    for (const b of this.map.buildings) {
      if (b.collapsed || this.damaged.has(b.id)) continue;
      const x0 = b.x - b.w / 2,
        x1 = b.x + b.w / 2,
        z0 = b.z - b.d / 2,
        z1 = b.z + b.d / 2;
      if (cx > x0 - 0.3 && cx < x1 + 0.3 && cz > z0 - 0.3 && cz < z1 + 0.3) continue;
      const near = Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(z0 - cz, 0, cz - z1));
      if (near > range) continue;
      const H = (b.roofBase ?? STOREY0_TOP) - 0.3;
      if (H <= 0.5) continue;
      // Angular span of the footprint seen from the camera.
      const mid = Math.atan2(b.z - cz, b.x - cx);
      let lo = Infinity,
        hi = -Infinity;
      for (const [px, pz] of [
        [x0, z0],
        [x1, z0],
        [x0, z1],
        [x1, z1],
      ]) {
        let a = Math.atan2(pz - cz, px - cx) - mid;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      }
      const holes = this.openings.get(b.id);
      // Only bins the building covers completely (both edge rays hit it).
      const first = Math.ceil(((mid + lo + Math.PI) / TAU) * BINS),
        last = Math.floor(((mid + hi + Math.PI) / TAU) * BINS) - 1;
      for (let k = first; k <= last; k++) {
        const i = ((k % BINS) + BINS) % BINS,
          a0 = angleOf(k),
          a1 = angleOf(k + 1),
          r0 = slab(cx, cz, Math.cos(a0), Math.sin(a0), x0, x1, z0, z1),
          r1 = slab(cx, cz, Math.cos(a1), Math.sin(a1), x0, x1, z0, z1);
        // Both edge rays must enter and leave through the same faces (a corner in between: skip the bin).
        if (!r0 || !r1 || r0[2] !== r1[2] || r0[3] !== r1[3]) continue;
        const o = {
          enterMin: Math.min(r0[0], r1[0]),
          enterMax: Math.max(r0[0], r1[0]),
          exitMin: Math.min(r0[1], r1[1]),
          exitMax: Math.max(r0[1], r1[1]),
          H,
          // Heights at which a sightline can pass the entry and exit walls (doors and windows it crosses).
          entry: this.gaps(holes, r0[2], cx, cz, a0, a1, r0[0], r1[0]),
          exit: this.gaps(holes, r0[3], cx, cz, a0, a1, r0[1], r1[1]),
        };
        const list = this.horizon[i];
        list.push(o);
        if (list.length > 3) {
          list.sort((a, b) => a.enterMin - b.enterMin);
          list.length = 3;
        }
      }
    }
  }
  // Openings of one face crossed between the two edge rays of a bin: their height ranges.
  gaps(holes, face, cx, cz, a0, a1, t0, t1) {
    if (!holes) return null;
    const along = (a, t) => (face < 2 ? cz + Math.sin(a) * t : cx + Math.cos(a) * t),
      p0 = along(a0, t0),
      p1 = along(a1, t1),
      lo = Math.min(p0, p1),
      hi = Math.max(p0, p1);
    let out = null;
    for (const [s0, s1, y0, y1] of holes[face]) if (s1 >= lo && s0 <= hi) (out ??= []).push(y0, y1);
    return out;
  }
  occluded(g, cx, cy, cz) {
    const x0 = g.x0 - 0.4,
      x1 = g.x1 + 0.4,
      z0 = g.z0 - 0.4,
      z1 = g.z1 + 0.4,
      y1 = g.y1 + 0.2;
    if (cx > x0 && cx < x1 && cz > z0 && cz < z1) return false;
    const rmin = Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(z0 - cz, 0, cz - z1));
    if (rmin < 6) return false;
    const rmax = Math.hypot(Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), Math.max(Math.abs(z0 - cz), Math.abs(z1 - cz))),
      mid = Math.atan2((z0 + z1) / 2 - cz, (x0 + x1) / 2 - cx);
    let lo = Infinity,
      hi = -Infinity;
    for (const [px, pz] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ]) {
      let a = Math.atan2(pz - cz, px - cx) - mid;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    if (hi - lo > Math.PI * 0.9) return false;
    const first = Math.floor(((mid + lo + Math.PI) / TAU) * BINS),
      last = Math.floor(((mid + hi + Math.PI) / TAU) * BINS);
    const y0 = Math.max(0, g.y0 - 0.2);
    for (let k = first; k <= last; k++) {
      const list = this.horizon[((k % BINS) + BINS) % BINS];
      let blocked = false;
      for (const o of list) {
        if (rmin <= o.exitMax + 0.2) continue;
        // Heights at which sightlines to the target cross the entry and exit walls: a sightline gets through
        // only through an opening (or over the top) on both.
        if (!(pass(cy, y0, y1, rmin, rmax, o.enterMin, o.enterMax, o.entry, o.H) && pass(cy, y0, y1, rmin, rmax, o.exitMin, o.exitMax, o.exit, o.H))) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return false;
    }
    return true;
  }
  // Recomputes visibility; returns true when the visible set changed.
  update(camera, range, force = false) {
    const p = camera.position,
      e = camera.rotation,
      yaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]),
      pitch = Math.asin(Math.max(-1, Math.min(1, -camera.matrixWorld.elements[9])));
    void e;
    const last = this.last,
      moved = !last || Math.hypot(p.x - last.x, p.z - last.z) > 1 || Math.abs(p.y - last.y) > 0.6,
      turned =
        !last ||
        Math.abs(Math.atan2(Math.sin(yaw - last.yaw), Math.cos(yaw - last.yaw))) > 0.1 ||
        Math.abs(pitch - last.pitch) > 0.1 ||
        camera.fov !== last.fov ||
        camera.aspect !== last.aspect;
    if (!force && !moved && !turned && !this.dirty && range === last?.range && this.lite === last?.lite) return false;
    if (moved || this.dirty || !last || range !== last.range) this.buildHorizon(p.x, p.y, p.z, range + 20);
    this.dirty = false;
    this.last = { x: p.x, y: p.y, z: p.z, yaw, pitch, fov: camera.fov, aspect: camera.aspect, range, lite: this.lite };
    // A wider copy of the camera: rotating a little before the next update never reveals missing objects.
    const w = this.wide;
    w.position.copy(p);
    w.quaternion.copy(camera.quaternion);
    w.fov = Math.min(170, camera.fov + 28);
    w.aspect = camera.aspect;
    w.near = 0.1;
    w.far = range + 60;
    w.updateProjectionMatrix();
    w.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(w.projectionMatrix, w.matrixWorldInverse));
    const inside = this.map.buildings.find((b) => Math.abs(p.x - b.x) < b.w / 2 + 0.3 && Math.abs(p.z - b.z) < b.d / 2 + 0.3),
      camStorey = p.y < STOREY0_TOP + 0.2 ? 0 : Math.floor((p.y - STOREY0_TOP - 0.2) / STOREY_H) + 1;
    let changed = false;
    if (this.visible.length !== this.groups.length) {
      this.visible = new Uint8Array(this.groups.length).fill(2);
      changed = true;
    }
    const box = this.box;
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      let vis = 1;
      if (g.x0 === Infinity) vis = 0;
      else {
        const dist = Math.hypot(Math.max(g.x0 - p.x, 0, p.x - g.x1), Math.max(g.z0 - p.z, 0, p.z - g.z1));
        if (g.kind === 'room') {
          if (inside && inside.id === g.building) {
            vis = Math.abs(g.storey - camStorey) <= 1 || this.damaged.has(g.building) ? 1 : 0;
          } else if (dist > (this.lite ? INTERIOR_RANGE * 0.65 : INTERIOR_RANGE)) vis = 0;
          else if (g.storey > 0 && p.y < g.y0) {
            // Looking up at a storey from outside: through its windows you see ceilings, not furniture.
            const floor = STOREY0_TOP + (g.storey - 1) * STOREY_H + 0.24;
            vis = dist > (floor + 1.2 - p.y) / 0.25 ? 1 : 0;
          }
        } else if (g.kind === 'detail') {
          if (dist > Math.min(this.lite ? DETAIL_RANGE * 0.6 : DETAIL_RANGE, range + 20) && !(inside && inside.id === g.building)) vis = 0;
        } else if (dist > range + 40) vis = 0;
        if (vis && dist > 4) {
          // Frustum test on the box swept along its shadow (rooms cast none).
          const shadow = g.kind === 'room' ? 0 : Math.max(0, g.y1);
          box.min.set(g.x0 + Math.min(0, SHADOW_X * shadow), g.y0 - 0.5, g.z0 + Math.min(0, SHADOW_Z * shadow));
          box.max.set(g.x1 + Math.max(0, SHADOW_X * shadow), g.y1 + 0.5, g.z1 + Math.max(0, SHADOW_Z * shadow));
          if (!this.frustum.intersectsBox(box)) vis = 0;
        }
        if (vis && !(inside && g.building === inside.id) && this.occluded(g, p.x, p.y, p.z)) vis = 0;
      }
      if (this.visible[i] !== vis) {
        this.visible[i] = vis;
        changed = true;
      }
    }
    if (changed) this.version++;
    return changed;
  }
  // Point test for characters and loot: hidden behind a building?
  hides(x, y0, y1, z) {
    if (!this.last) return false;
    const g = { x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5, y0, y1 };
    return this.occluded(g, this.last.x, this.last.y, this.last.z);
  }
}
