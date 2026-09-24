// One shared triangle grid drives rendering, Rapier collision and ray/loot heights.
export const TERRAIN_STEP = 2;
// Hills are bucketed on a 32 m grid once there are many of them (the big map has hundreds of dunes and mounds).
function hillsNear(x, z, map) {
  const hills = map.hills || [];
  if (hills.length < 24) return hills;
  let g = map._hillGrid;
  if (!g || g.count !== hills.length) {
    g = map._hillGrid = { count: hills.length, cells: new Map() };
    for (const h of hills) {
      const c0 = Math.floor((h.x - h.radius) / 32),
        c1 = Math.floor((h.x + h.radius) / 32),
        r0 = Math.floor((h.z - h.radius) / 32),
        r1 = Math.floor((h.z + h.radius) / 32);
      for (let c = c0; c <= c1; c++)
        for (let r = r0; r <= r1; r++) {
          const k = c * 4096 + r;
          if (!g.cells.has(k)) g.cells.set(k, []);
          g.cells.get(k).push(h);
        }
    }
  }
  return g.cells.get(Math.floor(x / 32) * 4096 + Math.floor(z / 32)) || [];
}
export function rawHeight(x, z, map) {
  let y = 0;
  for (const h of hillsNear(x, z, map)) {
    const r2 = ((x - h.x) ** 2 + (z - h.z) ** 2) / (h.radius * h.radius);
    if (r2 < 1) y += h.height * (1 - r2) ** 2;
  }
  // Superellipse shoreline: most of the old Big City stays untouched, then a beach shelf rolls down
  // into deep water near the enlarged map boundary. Rendering and Rapier use this same height.
  if (map.island) {
    const { rx, rz } = map.island,
      n = Math.pow((Math.abs(x) / rx) ** 4 + (Math.abs(z) / rz) ** 4, 0.25);
    if (n > 0.965) {
      const t = Math.min(1, (n - 0.965) / 0.09),
        smooth = t * t * (3 - 2 * t);
      y -= 7 * smooth;
    }
  }
  return y;
}
export function groundHeight(x, z, map) {
  const step = TERRAIN_STEP,
    x0 = Math.floor((x + map.limit.x) / step) * step - map.limit.x,
    z0 = Math.floor((z + map.limit.z) / step) * step - map.limit.z,
    fx = (x - x0) / step,
    fz = (z - z0) / step;
  const a = rawHeight(x0, z0, map),
    b = rawHeight(x0 + step, z0, map),
    c = rawHeight(x0, z0 + step, map),
    d = rawHeight(x0 + step, z0 + step, map);
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
export function terrainMesh(map) {
  const nx = (map.limit.x * 2) / TERRAIN_STEP,
    nz = (map.limit.z * 2) / TERRAIN_STEP,
    vertices = new Float32Array((nx + 1) * (nz + 1) * 3),
    indices = new Uint32Array(nx * nz * 6);
  let n = 0,
    k = 0;
  for (let z = 0; z <= nz; z++)
    for (let x = 0; x <= nx; x++) {
      const xx = x * TERRAIN_STEP - map.limit.x,
        zz = z * TERRAIN_STEP - map.limit.z;
      vertices[n++] = xx;
      vertices[n++] = rawHeight(xx, zz, map);
      vertices[n++] = zz;
    }
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      const a = z * (nx + 1) + x,
        b = a + 1,
        c = a + nx + 1,
        d = c + 1;
      for (const v of [a, c, b, b, c, d]) indices[k++] = v;
    }
  return { vertices, indices };
}
export function terrainNormal(x, z, map) {
  const dx = groundHeight(x - 0.15, z, map) - groundHeight(x + 0.15, z, map),
    dz = groundHeight(x, z - 0.15, map) - groundHeight(x, z + 0.15, map),
    n = Math.hypot(dx, 0.3, dz);
  return { x: dx / n, y: 0.3 / n, z: dz / n };
}
export function terrainRay(origin, dir, range, map) {
  if (origin.y > map.maxTerrainHeight && dir.y >= 0) return Infinity;
  const gap = (t) => origin.y + dir.y * t - groundHeight(origin.x + dir.x * t, origin.z + dir.z * t, map);
  if (gap(0) < -0.005) return 0;
  // Bracket at half-metre intervals, then resolve the shared surface to millimetres.
  for (let t = Math.min(0.5, range); t <= range + 0.00001; t = Math.min(range, t + 0.5)) {
    if (gap(t) <= 0) {
      let lo = Math.max(0, t - 0.5),
        hi = t;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    if (t === range) break;
  }
  return Infinity;
}
export function biomeAt(x, z, map) {
  if (map.island) {
    const n = Math.pow((Math.abs(x) / map.island.rx) ** 4 + (Math.abs(z) / map.island.rz) ** 4, 0.25);
    if (n > 0.98) return 'coast';
  }
  const zone = map.parks?.find((p) => Math.abs(x - p.x) < p.w / 2 - 2 && Math.abs(z - p.z) < p.d / 2 - 2);
  return zone?.type || 'city';
}
