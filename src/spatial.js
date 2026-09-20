// Uniform XZ grid over map obstacles. Rays walk the grid cell by cell (Amanatides–Woo), so a shot or a
// line-of-sight test only checks boxes near its path. Obstacles can be added and removed (destruction).
export class ObstacleGrid {
  constructor(obstacles, limit, cell = 8, key = '_stamp') {
    this.cell = cell;
    this.ox = -limit.x - cell;
    this.oz = -limit.z - cell;
    this.nx = Math.ceil((limit.x * 2) / cell) + 2;
    this.nz = Math.ceil((limit.z * 2) / cell) + 2;
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    this.stamp = 0;
    // Each grid marks visited obstacles under its own key (an obstacle can sit in several grids).
    this.key = key;
    for (const o of obstacles) this.add(o);
  }
  range(o) {
    const c = this.cell,
      clampX = (v) => Math.max(0, Math.min(this.nx - 1, v)),
      clampZ = (v) => Math.max(0, Math.min(this.nz - 1, v));
    return [
      clampX(Math.floor((o.x - o.w / 2 - this.ox) / c)),
      clampX(Math.floor((o.x + o.w / 2 - this.ox) / c)),
      clampZ(Math.floor((o.z - o.d / 2 - this.oz) / c)),
      clampZ(Math.floor((o.z + o.d / 2 - this.oz) / c)),
    ];
  }
  add(o) {
    const [x0, x1, z0, z1] = this.range(o);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[z * this.nx + x].push(o);
  }
  remove(o) {
    const [x0, x1, z0, z1] = this.range(o);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const list = this.cells[z * this.nx + x],
          i = list.indexOf(o);
        if (i >= 0) list.splice(i, 1);
      }
  }
  // Visits every obstacle overlapping the XZ rectangle once.
  query(minX, minZ, maxX, maxZ, visit) {
    const c = this.cell,
      stamp = ++this.stamp,
      x0 = Math.max(0, Math.floor((minX - this.ox) / c)),
      x1 = Math.min(this.nx - 1, Math.floor((maxX - this.ox) / c)),
      z0 = Math.max(0, Math.floor((minZ - this.oz) / c)),
      z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.oz) / c));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        for (const o of this.cells[z * this.nx + x]) {
          if (o[this.key] === stamp) continue;
          o[this.key] = stamp;
          visit(o);
        }
  }
  // Walks the cells a ray crosses in order. `visit(o)` returns the current best hit distance; the walk stops
  // once the next cell starts beyond it.
  ray(origin, dir, range, visit) {
    const c = this.cell,
      stamp = ++this.stamp;
    let best = range,
      cx = Math.floor((origin.x - this.ox) / c),
      cz = Math.floor((origin.z - this.oz) / c);
    const stepX = dir.x > 0 ? 1 : -1,
      stepZ = dir.z > 0 ? 1 : -1,
      ax = Math.abs(dir.x) < 1e-9 ? Infinity : c / Math.abs(dir.x),
      az = Math.abs(dir.z) < 1e-9 ? Infinity : c / Math.abs(dir.z);
    let tx = ax === Infinity ? Infinity : ((dir.x > 0 ? (cx + 1) * c : cx * c) + this.ox - origin.x) / dir.x,
      tz = az === Infinity ? Infinity : ((dir.z > 0 ? (cz + 1) * c : cz * c) + this.oz - origin.z) / dir.z,
      t = 0;
    for (let guard = 0; guard < 4096; guard++) {
      if (cx >= 0 && cx < this.nx && cz >= 0 && cz < this.nz)
        for (const o of this.cells[cz * this.nx + cx]) {
          if (o[this.key] === stamp) continue;
          o[this.key] = stamp;
          best = Math.min(best, visit(o, best));
        }
      if (tx < tz) {
        t = tx;
        tx += ax;
        cx += stepX;
      } else {
        t = tz;
        tz += az;
        cz += stepZ;
      }
      if (t > best || t === Infinity) break;
      if (
        (cx < 0 && stepX < 0) ||
        (cx >= this.nx && stepX > 0) ||
        (cz < 0 && stepZ < 0) ||
        (cz >= this.nz && stepZ > 0)
      )
        break;
    }
    return best;
  }
}
// Obstacles that block walking and ground-level sight (used by bots' line of sight, cover and navigation).
export const isLowSolid = (o) => !o.nocollide && (o.y ?? o.h / 2) - o.h / 2 - (o.ground || 0) <= 1.8;
