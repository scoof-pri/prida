// Structural destruction shared by the simulation (authoritative) and the client (mirrors state lists).
// Buildings stand on exterior wall panels. Explosions damage panels and props; a lintel falls when a supporting
// panel goes; when too little of the ground floor remains the storeys above collapse into rubble.
import { seededRandom } from './world.js';
import { isLowSolid } from './spatial.js';
import { decodeCells, cellGrid } from './cells.js';

export const COLLAPSE_RATIO = 0.5; // collapse when fewer than half the structural panels remain…
export const FACE_COLLAPSE_RATIO = 0.7; // …or a whole face is gone and less than 70 % remain

export function removeObstacle(map, o) {
  const i = map.obstacles.indexOf(o);
  if (i < 0) return false;
  map.obstacles.splice(i, 1);
  map.obstacles.grid?.remove(o);
  map.obstacles.lowGrid?.remove(o);
  return true;
}
export function addObstacle(map, o) {
  map.obstacles.push(o);
  map.obstacles.grid?.add(o);
  if (isLowSolid(o)) map.obstacles.lowGrid?.add(o);
}
// Distance from a point to the surface of an obstacle box (0 inside).
export function boxDistance(o, x, y, z) {
  const dx = Math.max(0, Math.abs(x - o.x) - o.w / 2),
    dy = Math.max(0, Math.abs(y - o.y) - o.h / 2),
    dz = Math.max(0, Math.abs(z - o.z) - o.d / 2);
  return Math.hypot(dx, dy, dz);
}
// Structural state of one building after its panels have been damaged.
export function structure(map, b, destroyedPanels) {
  const alive = b.panels.filter((id) => !destroyedPanels.has(id)).length,
    total = b.panels.length,
    faces = new Map();
  for (const o of map.panelIndex?.get(b.id) || []) {
    const f = faces.get(o.face) || { total: 0, alive: 0 };
    f.total++;
    if (!destroyedPanels.has(o.panel)) f.alive++;
    faces.set(o.face, f);
  }
  const ratio = alive / Math.max(1, total),
    faceGone = [...faces.values()].some((f) => f.alive === 0);
  return { ratio, faceGone, collapse: ratio < COLLAPSE_RATIO || (faceGone && ratio < FACE_COLLAPSE_RATIO) };
}
// An upper storey gives way (taking everything above it) once half its walls are gone, or a whole side and 30 %.
export function storeyStructure(map, b, storey, destroyedPanels) {
  const panels = map.storeyIndex?.get(b.id + ':' + storey) || [],
    faces = new Map();
  let alive = 0;
  for (const o of panels) {
    const f = faces.get(o.face) || { total: 0, alive: 0 };
    f.total++;
    if (!destroyedPanels.has(o.panel)) (f.alive++, alive++);
    faces.set(o.face, f);
  }
  const ratio = alive / Math.max(1, panels.length),
    faceGone = [...faces.values()].some((f) => f.alive === 0);
  return { ratio, collapse: panels.length > 0 && (ratio < COLLAPSE_RATIO || (faceGone && ratio < FACE_COLLAPSE_RATIO)) };
}
// Everything from an upper storey upwards: its walls, the slabs above it and the roof.
export function storeyParts(map, b, storey) {
  return map.obstacles.filter((o) => o.building === b.id && o.storey >= storey);
}
// Rubble heaps are derived from the building id, so every client builds the same shapes without network data.
export function rubbleFor(b, chests = []) {
  const rand = seededRandom(0x9e37 + b.id * 7919),
    heaps = [],
    n = 5 + Math.floor((b.w * b.d) / 70);
  for (let i = 0; i < n * 3 && heaps.length < Math.min(14, n); i++) {
    const w = 2 + rand() * Math.min(4, b.w * 0.3),
      d = 2 + rand() * Math.min(4, b.d * 0.3),
      h = 0.7 + rand() * (0.6 + Math.min(1.4, b.height / 12)),
      x = b.x + (rand() - 0.5) * (b.w - w),
      z = b.z + (rand() - 0.5) * (b.d - d);
    // Leave doorways passable and chests reachable.
    if (Math.abs(x - b.x) < b.door / 2 + w / 2 && rand() < 0.7) continue;
    if (chests.some((c) => Math.abs(c.x - x) < w / 2 + 1 && Math.abs(c.z - z) < d / 2 + 1)) continue;
    heaps.push({
      x,
      y: h / 2,
      z,
      w,
      h,
      d,
      part: 'rubble',
      building: b.id,
      color: i % 3 === 0 ? b.accent : b.color,
      rot: rand() * 0.6 - 0.3,
    });
  }
  return heaps;
}
// Everything of a building that disappears when it collapses: panels, lintels, roof, upper storeys, furniture.
export function collapseParts(map, b) {
  return map.obstacles.filter(
    (o) =>
      o.building === b.id &&
      (o.panel !== undefined || ['lintel', 'roof', 'upper', 'furniture', 'partition', 'stair'].includes(o.part)),
  );
}
export function indexPanels(map) {
  map.panelIndex = new Map();
  map.storeyIndex = new Map(); // "building:storey" -> panels of an upper storey
  for (const o of map.obstacles)
    if (o.panel !== undefined && o.structural && o.storey > 0) {
      const key = o.building + ':' + o.storey;
      if (!map.storeyIndex.has(key)) map.storeyIndex.set(key, []);
      map.storeyIndex.get(key).push(o);
    } else if (o.panel !== undefined && o.structural) {
      if (!map.panelIndex.has(o.building)) map.panelIndex.set(o.building, []);
      map.panelIndex.get(o.building).push(o);
    }
}
// Client mirror: apply the authoritative destruction lists to a locally generated map. Returns what changed.
export function syncDestruction(map, state) {
  if (!state) return null;
  map.applied ??= { panels: new Set(), decor: new Set(), buildings: new Set(), wrecks: new Set() };
  map.appliedStoreys ??= new Map();
  map.appliedProps ??= new Set();
  map.appliedRoofs ??= new Set();
  map.appliedCells ??= new Map();
  const changed = { panels: [], decor: [], buildings: [], wrecks: [], cells: [], storeys: [], props: [], roofs: [] };
  for (const id of state.props || [])
    if (!map.appliedProps.has(id)) {
      map.appliedProps.add(id);
      for (const o of map.obstacles.filter((o) => o.prop === id)) removeObstacle(map, o);
      changed.props.push(id);
    }
  for (const id of state.roofs || [])
    if (!map.appliedRoofs.has(id)) {
      map.appliedRoofs.add(id);
      for (const o of map.obstacles.filter((o) => o.building === id && o.part === 'upper')) removeObstacle(map, o);
      changed.roofs.push(id);
    }
  const byPanel = (id) => map.obstacles.find((o) => o.panel === id),
    byDecor = (id) => map.obstacles.find((o) => o.decor === id);
  for (const id of state.buildings || [])
    if (!map.applied.buildings.has(id)) {
      map.applied.buildings.add(id);
      const b = map.buildings[id];
      for (const o of collapseParts(map, b)) removeObstacle(map, o);
      for (const r of rubbleFor(b, map.chests)) addObstacle(map, r);
      changed.buildings.push(id);
    }
  for (const [key, storey] of Object.entries(state.storeys || {})) {
    const id = Number(key),
      b = map.buildings[id];
    if (!b || map.applied.buildings.has(id) || (map.appliedStoreys.get(id) ?? Infinity) <= storey) continue;
    map.appliedStoreys.set(id, storey);
    for (const o of storeyParts(map, b, storey)) removeObstacle(map, o);
    changed.storeys.push([id, storey]);
  }
  for (const id of state.panels || [])
    if (!map.applied.panels.has(id)) {
      map.applied.panels.add(id);
      const o = byPanel(id);
      if (o) removeObstacle(map, o);
      changed.panels.push(id);
    }
  // Damaged walls: alive masks per panel. `changed.cells` lists [obstacle, previous mask] so views can react.
  for (const [key, mask] of Object.entries(state.cells || {})) {
    const id = Number(key);
    if (map.appliedCells.get(id) === mask || map.applied.panels.has(id)) continue;
    map.appliedCells.set(id, mask);
    const o = byPanel(id);
    if (!o) continue;
    const previous = o.cells ? o.cells.slice() : null;
    o.cells = decodeCells(o, mask);
    o.cellsAlive = o.cells.reduce((n, v) => n + (v > 0), 0);
    cellGrid(o);
    changed.cells.push([o, previous]);
  }
  for (const id of state.decor || [])
    if (!map.applied.decor.has(id)) {
      map.applied.decor.add(id);
      const o = byDecor(id);
      if (o) removeObstacle(map, o);
      changed.decor.push(id);
    }
  for (const id of state.wrecks || [])
    if (!map.applied.wrecks.has(id)) {
      map.applied.wrecks.add(id);
      const o = byDecor(id);
      if (o) {
        o.part = 'wreck';
        o.hp = undefined;
      }
      changed.wrecks.push(id);
    }
  return changed;
}
