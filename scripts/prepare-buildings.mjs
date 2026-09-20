// Rebuilds public/models/<building>.glb from the Kenney city kits (see ASSET-CREDITS.md).
// Each model keeps its proportions: it is rotated and repeated along the long side of its lot so the horizontal
// stretch stays small, then scaled uniformly (height follows from the model, see `fitBuilding`). The ground floor
// (below 3.84 m) is cut away because the game builds that storey from destructible wall panels.
// Since 0.9.1 only the roof of each model is kept: the storeys below it are built by the game from destructible
// wall panels (see world.js). The script finds where the outer walls end (`wallTop`), counts how many 3.6 m
// storeys fit below it, drops the roof onto the last storey and writes src/building-fit.js.
// Usage: node scripts/prepare-buildings.mjs [asset-source dir] [--print]
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { BUILDING_TYPES } from '../src/catalog.js';

const args = process.argv.slice(2),
  source = path.resolve(args.find((a) => !a.startsWith('--')) || '../asset-source'),
  out = path.resolve('public/models'),
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  CUT = 3.84,
  // Neighbouring copies overlap by this share of a copy so cornices, pipes and balconies leave no gap between them.
  OVERLAP = 0.1,
  STOREY = 3.6;

const span = (n) => n - (n - 1) * OVERLAP;
// Best orientation (0 / 90°) and number of copies along the lot's long side: horizontal scales as equal as possible.
export function fitBuilding(size, lot) {
  let best = null;
  for (const rot of [0, 1])
    for (const n of [1, 2, 3]) {
      const mx = rot ? size[2] : size[0],
        mz = rot ? size[0] : size[2],
        nx = lot.w >= lot.d ? n : 1,
        nz = lot.w >= lot.d ? 1 : n,
        sx = lot.w / (span(nx) * mx),
        sz = lot.d / (span(nz) * mz),
        cost = Math.max(sx, sz) / Math.min(sx, sz) + (n - 1) * 0.12 + rot * 0.01;
      if (!best || cost < best.cost) best = { rot, nx, nz, sx, sz, cost };
    }
  best.sy = Math.sqrt(best.sx * best.sz);
  best.height = Math.round(size[1] * best.sy * 2) / 2;
  best.sy = best.height / size[1];
  return best;
}

function file(model) {
  const [family, letter] = model.split('-');
  return path.join(source, 'city-kit-' + family, 'Models/GLB format', family === 'suburban' ? `building-type-${letter}.glb` : `building-${letter}.glb`);
}
function bounds(doc) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity],
    v = [];
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute('POSITION');
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, v);
        for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], v[k])), (max[k] = Math.max(max[k], v[k]));
      }
    }
  return { min, max, size: max.map((x, k) => x - min[k]) };
}

const report = [],
  fits = {};
// Level where the roof starts: going down from the top, upward-facing faces (roof planes, flat roofs) are summed by
// their plan area; the level at which they cover most of the lot is the eaves / roof slab. Ledges, awnings and
// balconies are too small to count.
function findWallTop(doc, copies, scale, centre, fit, b) {
  const ups = [];
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'),
        index = prim.getIndices(),
        count = index ? index.getCount() : pos.getCount();
      for (const [ox, oz] of copies)
        for (let i = 0; i < count; i += 3) {
          const v = [0, 1, 2].map((k) => {
            let e = pos.getElement(index ? index.getScalar(i + k) : i + k, []).map((n, j) => n - centre[j]);
            if (fit.rot) e = [e[2], e[1], -e[0]];
            return [e[0] * scale[0] + ox, e[1] * scale[1], e[2] * scale[2] + oz];
          });
          const e1 = v[1].map((n, j) => n - v[0][j]),
            e2 = v[2].map((n, j) => n - v[0][j]),
            ny = e1[2] * e2[0] - e1[0] * e2[2],
            nx = e1[1] * e2[2] - e1[2] * e2[1],
            nz = e1[0] * e2[1] - e1[1] * e2[0],
            len = Math.hypot(nx, ny, nz);
          // Plan area of faces that face up (either winding).
          if (!len || Math.abs(ny) / len < 0.3) continue;
          ups.push({ y: Math.min(v[0][1], v[1][1], v[2][1]), area: Math.abs(ny) / 2 });
        }
    }
  ups.sort((p, q) => q.y - p.y);
  const need = b.w * b.d * 0.35;
  let sum = 0;
  for (const u of ups) {
    sum += u.area;
    // Faces are counted from both sides of thin slabs, so compare half of the sum.
    if (sum / 2 >= need) return Math.max(CUT, u.y - 0.02);
  }
  return CUT;
}
for (const b of BUILDING_TYPES) {
  const doc = await io.read(file(b.model)),
    { min, max, size } = bounds(doc),
    fit = fitBuilding(size, b),
    centre = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  report.push([b.type, b.model, fit.rot, fit.nx, fit.nz, fit.sx.toFixed(2), fit.sy.toFixed(2), fit.sz.toFixed(2), 'height', fit.height]);
  if (args.includes('--print')) continue;
  const copies = [];
  const step = (length, n) => (length / span(n)) * (1 - OVERLAP),
    first = (length, n) => -length / 2 + length / span(n) / 2;
  for (let i = 0; i < fit.nx; i++)
    for (let j = 0; j < fit.nz; j++) copies.push([first(b.w, fit.nx) + i * step(b.w, fit.nx), first(b.d, fit.nz) + j * step(b.d, fit.nz)]);
  const scale = [fit.sx, fit.sy, fit.sz];
  const wallTop = findWallTop(doc, copies, scale, centre, fit, b),
    storeys = Math.max(0, Math.round((wallTop - CUT) / STOREY)),
    roofBase = CUT + storeys * STOREY,
    shift = roofBase - wallTop,
    height = Math.round((fit.height + shift) * 100) / 100;
  fits[b.model] = { storeys, height };
  report[report.length - 1].push('wallTop', wallTop.toFixed(2), 'storeys', storeys, 'height', height);
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const attrs = prim.listSemantics(),
        arrays = Object.fromEntries(attrs.map((k) => [k, []])),
        index = prim.getIndices(),
        count = index ? index.getCount() : prim.getAttribute('POSITION').getCount();
      const vertex = (i, [ox, oz]) => {
        const v = {};
        for (const key of attrs) {
          let e = prim.getAttribute(key).getElement(i, []);
          if (key === 'POSITION' || key === 'NORMAL') {
            if (key === 'POSITION') e = e.map((n, k) => n - centre[k]);
            if (fit.rot) e = [e[2], e[1], -e[0]];
          }
          if (key === 'POSITION') e = [e[0] * scale[0] + ox, e[1] * scale[1] + shift, e[2] * scale[2] + oz];
          if (key === 'NORMAL') {
            e = e.map((n, k) => n / scale[k]);
            const len = Math.hypot(...e) || 1;
            e = e.map((n) => n / len);
          }
          v[key] = e;
        }
        return v;
      };
      for (const offset of copies)
        for (let i = 0; i < count; i += 3) {
          const poly = [0, 1, 2].map((k) => vertex(index ? index.getScalar(i + k) : i + k, offset)),
            kept = [];
          // Clip the triangle against the plane y = roofBase, keeping only the roof above it.
          for (let j = 0; j < 3; j++) {
            const a = poly[j],
              c = poly[(j + 1) % 3],
              inA = a.POSITION[1] >= roofBase,
              inC = c.POSITION[1] >= roofBase;
            if (inA) kept.push(a);
            if (inA !== inC) {
              const t = (roofBase - a.POSITION[1]) / (c.POSITION[1] - a.POSITION[1]),
                v = {};
              for (const key of attrs) v[key] = a[key].map((n, k) => n + (c[key][k] - n) * t);
              kept.push(v);
            }
          }
          for (let j = 1; j < kept.length - 1; j++)
            for (const v of [kept[0], kept[j], kept[j + 1]]) for (const key of attrs) arrays[key].push(...v[key]);
        }
      prim.setIndices(null);
      for (const key of attrs) {
        const old = prim.getAttribute(key),
          a = doc.createAccessor().setType(old.getType()).setBuffer(doc.getRoot().listBuffers()[0]).setArray(new Float32Array(arrays[key]));
        prim.setAttribute(key, a);
      }
    }
  await doc.transform(weld(), dedup(), prune());
  await io.write(path.join(out, b.model + '.glb'), doc);
}
console.table(report);
if (!args.includes('--print')) {
  const lines = Object.entries(fits).map(([m, f]) => `  '${m}': { storeys: ${f.storeys}, height: ${f.height} },`);
  await fs.writeFile(
    'src/building-fit.js',
    `// Generated by scripts/prepare-buildings.mjs: storeys built from wall panels below each model's roof, and the\n// building's total height (top of the roof).\nexport const BUILDING_FIT = {\n${lines.join('\n')}\n};\n`,
  );
}
