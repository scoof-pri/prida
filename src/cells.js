// Voxel walls. A wall panel (and lintel / partition) is a grid of ~0.4 m concrete cells, created the first
// time it is damaged. Bullets chip single cells, blasts carve spheres, melee weapons cut lines. Cells that lose
// their connection to the floor (or the ceiling) fall. A panel cut through a whole row no longer carries load.
// Shared by the authoritative simulation and the clients (which mirror the alive-mask from snapshots).
export const CELL = 0.4;
export const CELL_HP = 60;
// A panel with less than this share of its cells left breaks away completely.
export const CELL_BREAK_RATIO = 0.18;
// Floor slabs (ceilings) use a coarser horizontal grid: columns along x, rows along z.
export const SLAB_CELL = 0.8;
export const isSlab = (o) => o.part === 'roof';

export function cellGrid(o) {
  if (o.cellGrid) return o.cellGrid;
  if (isSlab(o)) {
    const cols = Math.max(1, Math.round(o.w / SLAB_CELL)),
      rows = Math.max(1, Math.round(o.d / SLAB_CELL));
    o.cellGrid = { slab: true, cols, rows, cw: o.w / cols, ch: o.d / rows };
    return o.cellGrid;
  }
  const alongX = o.w >= o.d,
    span = alongX ? o.w : o.d,
    cols = Math.max(1, Math.round(span / CELL)),
    rows = Math.max(1, Math.round(o.h / CELL));
  o.cellGrid = { alongX, span, cols, rows, cw: span / cols, ch: o.h / rows };
  return o.cellGrid;
}
export function ensureCells(o) {
  if (!o.cells) {
    const g = cellGrid(o);
    o.cells = new Uint8Array(g.cols * g.rows).fill(CELL_HP);
    // A window opening has no blocks.
    if (o.hole)
      for (let i = 0; i < o.cells.length; i++) {
        const c = cellCenter(o, i),
          a = o.hole.alongX ? c.x : c.z;
        if (a > o.hole.a0 && a < o.hole.a1 && c.y > o.hole.y0 && c.y < o.hole.y1) o.cells[i] = 0;
      }
    o.cellsAlive = o.cells.reduce((n, v) => n + (v > 0), 0);
  }
  return o.cells;
}
// World-space centre of cell i.
export function cellCenter(o, i) {
  const g = cellGrid(o),
    c = i % g.cols,
    r = Math.floor(i / g.cols);
  if (g.slab) return { x: o.x - o.w / 2 + (c + 0.5) * g.cw, y: o.y, z: o.z - o.d / 2 + (r + 0.5) * g.ch };
  const
    along = -g.span / 2 + (c + 0.5) * g.cw;
  return { x: o.x + (g.alongX ? along : 0), y: o.y - o.h / 2 + (r + 0.5) * g.ch, z: o.z + (g.alongX ? 0 : along) };
}
// World-space box of a run of cells (columns c0..c1, rows r0..r1 inclusive).
export function cellBox(o, c0, c1, r0, r1) {
  const g = cellGrid(o);
  if (g.slab)
    return {
      x: o.x - o.w / 2 + ((c0 + c1 + 1) / 2) * g.cw,
      y: o.y,
      z: o.z - o.d / 2 + ((r0 + r1 + 1) / 2) * g.ch,
      w: (c1 - c0 + 1) * g.cw,
      h: o.h,
      d: (r1 - r0 + 1) * g.ch,
    };
  const a0 = -g.span / 2 + c0 * g.cw,
    a1 = -g.span / 2 + (c1 + 1) * g.cw,
    y0 = o.y - o.h / 2 + r0 * g.ch,
    y1 = o.y - o.h / 2 + (r1 + 1) * g.ch,
    along = (a0 + a1) / 2,
    len = a1 - a0;
  return {
    x: o.x + (g.alongX ? along : 0),
    y: (y0 + y1) / 2,
    z: o.z + (g.alongX ? 0 : along),
    w: g.alongX ? len : o.w,
    h: y1 - y0,
    d: g.alongX ? o.d : len,
  };
}
export function cellIndexAt(o, p) {
  const g = cellGrid(o);
  if (g.slab) {
    const c = Math.min(g.cols - 1, Math.max(0, Math.floor((p.x - (o.x - o.w / 2)) / g.cw))),
      r = Math.min(g.rows - 1, Math.max(0, Math.floor((p.z - (o.z - o.d / 2)) / g.ch)));
    return r * g.cols + c;
  }
  const u = (g.alongX ? p.x - o.x : p.z - o.z) + g.span / 2,
    c = Math.min(g.cols - 1, Math.max(0, Math.floor(u / g.cw))),
    r = Math.min(g.rows - 1, Math.max(0, Math.floor((p.y - (o.y - o.h / 2)) / g.ch)));
  return r * g.cols + c;
}
export const cellAlive = (o, i) => !o.cells || o.cells[i] > 0;

// Applies damage to cells; returns the indices that were destroyed (including cells left hanging in the air).
export function damageCells(o, hits) {
  const cells = ensureCells(o),
    removed = [];
  for (const [i, amount] of hits) {
    if (i < 0 || i >= cells.length || cells[i] === 0 || !(amount > 0)) continue;
    cells[i] = Math.max(0, cells[i] - Math.ceil(amount));
    if (cells[i] === 0) removed.push(i);
  }
  if (removed.length) {
    removed.push(...dropUnsupported(o));
    o.cellsAlive = cells.reduce((n, v) => n + (v > 0), 0);
  }
  return removed;
}
// Cells connected neither to the bottom row nor to the top row (which hangs from the storey above) fall.
// Slab cells hold while they connect to the edge, where the walls carry them.
export function dropUnsupported(o) {
  const g = cellGrid(o),
    cells = o.cells,
    seen = new Uint8Array(cells.length),
    stack = [];
  const seed = (i) => {
    if (cells[i] > 0 && !seen[i]) (seen[i] = 1), stack.push(i);
  };
  for (let c = 0; c < g.cols; c++) for (const r of [0, g.rows - 1]) seed(r * g.cols + c);
  if (g.slab) for (let r = 0; r < g.rows; r++) for (const c of [0, g.cols - 1]) seed(r * g.cols + c);
  while (stack.length) {
    const i = stack.pop(),
      c = i % g.cols,
      r = Math.floor(i / g.cols);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc,
        nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      if (cells[j] > 0 && !seen[j]) (seen[j] = 1), stack.push(j);
    }
  }
  const fallen = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] > 0 && !seen[i]) (cells[i] = 0), fallen.push(i);
  return fallen;
}
// A wall still carries the storeys above while every row keeps enough material and it is not mostly gone.
export function cellsSupport(o) {
  if (!o.cells) return true;
  const g = cellGrid(o);
  if (g.slab) return true;
  if (o.cellsAlive < g.cols * g.rows * 0.4) return false;
  for (let r = 0; r < g.rows; r++) {
    let n = 0;
    for (let c = 0; c < g.cols; c++) n += o.cells[r * g.cols + c] > 0;
    if (n === 0) return false;
  }
  return true;
}
export const cellsBroken = (o) => !!o.cells && o.cellsAlive < cellGrid(o).cols * cellGrid(o).rows * CELL_BREAK_RATIO;

// Cells whose centre lies inside a sphere, with damage falling off towards the edge.
export function sphereHits(o, x, y, z, radius, damage) {
  const g = cellGrid(o),
    hits = [];
  for (let i = 0; i < g.cols * g.rows; i++) {
    const p = cellCenter(o, i),
      d = Math.hypot(p.x - x, p.y - y, p.z - z);
    if (d < radius) hits.push([i, damage * (1 - (d / radius) * 0.6)]);
  }
  return hits;
}
// A melee cut: a horizontal line of cells (or a block for heavy chopping tools) centred on the hit point.
export function cutHits(o, p, length, height = 1) {
  const g = cellGrid(o),
    centre = cellIndexAt(o, p),
    c0 = centre % g.cols,
    r0 = Math.floor(centre / g.cols),
    hits = [];
  for (let dr = 0; dr < height; dr++)
    for (let k = 0; k < length; k++) {
      const c = c0 - Math.floor((length - 1) / 2) + k,
        r = r0 - Math.floor((height - 1) / 2) + dr;
      if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) hits.push([r * g.cols + c, 999]);
    }
  return hits;
}

// Solid cells merged into as few boxes as possible (rows of runs, stacked when identical) for colliders.
export function cellRects(o) {
  const g = cellGrid(o),
    open = new Map(),
    out = [];
  for (let r = 0; r <= g.rows; r++) {
    const runs = new Map();
    if (r < g.rows)
      for (let c = 0; c < g.cols; ) {
        if (!(o.cells[r * g.cols + c] > 0)) {
          c++;
          continue;
        }
        const c0 = c;
        while (c < g.cols && o.cells[r * g.cols + c] > 0) c++;
        runs.set(c0 + ':' + (c - 1), [c0, c - 1]);
      }
    for (const [key, rect] of open)
      if (runs.has(key)) {
        rect.r1 = r;
        runs.delete(key);
      } else {
        out.push(rect);
        open.delete(key);
      }
    for (const [key, [c0, c1]] of runs) open.set(key, { c0, c1, r0: r, r1: r });
  }
  return out.map((q) => cellBox(o, q.c0, q.c1, q.r0, q.r1));
}

// Ray against a damaged panel: distance to the first solid cell after entering its box, or Infinity.
export function cellRay(o, origin, dir, near, far) {
  const step = 0.05;
  for (let t = near + 0.001; t <= far; t += step) {
    const p = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
    if (Math.abs(p.x - o.x) > o.w / 2 + 1e-4 || Math.abs(p.y - o.y) > o.h / 2 + 1e-4 || Math.abs(p.z - o.z) > o.d / 2 + 1e-4)
      break;
    if (o.cells[cellIndexAt(o, p)] > 0) return Math.max(near, t - step * 0.5);
  }
  return Infinity;
}

// Network form: one hex digit per four cells (alive bits).
export function encodeCells(o) {
  let s = '';
  for (let i = 0; i < o.cells.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) if (o.cells[i + k] > 0) n |= 1 << k;
    s += n.toString(16);
  }
  return s;
}
export function decodeCells(o, s) {
  const g = cellGrid(o),
    cells = new Uint8Array(g.cols * g.rows);
  for (let i = 0; i < cells.length; i++) cells[i] = (parseInt(s[i >> 2] || '0', 16) >> (i & 3)) & 1 ? CELL_HP : 0;
  return cells;
}
