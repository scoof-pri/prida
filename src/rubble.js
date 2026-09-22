// What is left of a collapsed building: low craggy mounds of broken masonry (one per rubble heap of the
// simulation, same footprint and height), littered with wall blocks, tilted floor slabs and bent reinforcing bars.
// Built once per collapse as two merged meshes (rock-textured mounds, concrete-textured pieces) with vertex colours.
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from './world.js';

const DUST = new T.Color(0x8e877b);
const CONCRETE = new T.Color(0xa29c92);
const REBAR = new T.Color(0x5b4334);

function paint(g, color, jitter = 0, rnd = Math.random) {
  const n = g.attributes.position.count,
    a = new Float32Array(n * 3),
    c = new T.Color();
  // Flat colour per triangle (pieces are non-indexed): chipped faces vary a little.
  for (let i = 0; i < n; i += 3) {
    c.copy(color).multiplyScalar(1 - jitter / 2 + rnd() * jitter);
    for (let k = 0; k < 3 && i + k < n; k++) c.toArray(a, (i + k) * 3);
  }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}
// Height of a mound (half-ellipsoid of half-sizes a, c and height h) at local (x, z).
function moundHeight(x, z, a, c, h) {
  const q = 1 - (x / a) ** 2 - (z / c) ** 2;
  return q > 0 ? h * Math.sqrt(q) : 0;
}
function mound(r, rnd, tint) {
  const g = mergeVertices(new T.IcosahedronGeometry(1, 2).deleteAttribute('uv').deleteAttribute('normal')),
    p = g.attributes.position,
    seed = rnd() * 100,
    bumps = Array.from({ length: 7 }, () => [new T.Vector3(rnd() - 0.5, rnd() * 0.8, rnd() - 0.5).normalize(), 0.08 + rnd() * 0.18]),
    v = new T.Vector3(),
    n = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    let k = 1;
    for (const [d, s] of bumps) k += s * Math.max(0, n.dot(d)) ** 2 - s * 0.25;
    k += Math.sin(n.x * 11 + seed) * Math.sin(n.y * 9) * Math.sin(n.z * 10 + seed) * 0.09;
    v.multiplyScalar(k);
    // Buried below the ground, spread at the foot.
    if (v.y < 0) v.set(v.x * 1.08, v.y * 0.15, v.z * 1.08);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const out = g.toNonIndexed();
  g.dispose();
  out.scale(r.w / 2, r.h * 1.05, r.d / 2);
  out.rotateY(r.rot);
  out.translate(r.x, 0, r.z);
  out.computeVertexNormals();
  return paint(out, tint, 0.22, rnd);
}
// A broken piece lying on the mound at local (x, z): block, slab or bar.
function piece(geo, r, x, z, lift, rnd, color, jitter) {
  const a = r.w / 2,
    c = r.d / 2,
    y = moundHeight(x, z, a, c, r.h * 1.05);
  geo.rotateX((rnd() - 0.5) * 1.2);
  geo.rotateZ((rnd() - 0.5) * 1.2);
  geo.rotateY(rnd() * Math.PI);
  const cos = Math.cos(r.rot),
    sin = Math.sin(r.rot);
  geo.translate(r.x + x * cos + z * sin, y + lift, r.z - x * sin + z * cos);
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return paint(g, color, jitter, rnd);
}
export function rubbleGeometry(b, heaps) {
  const rnd = seededRandom(0x5eed + b.id * 131),
    wall = new T.Color(b.color),
    accent = new T.Color(b.accent ?? b.color),
    mounds = [],
    pieces = [];
  for (const r of heaps) {
    mounds.push(mound(r, rnd, DUST.clone().lerp(wall, 0.35)));
    const a = r.w / 2,
      c = r.d / 2,
      spot = (edge = 0.8) => {
        const t = rnd() * Math.PI * 2,
          s = Math.sqrt(rnd()) * edge;
        return [Math.cos(t) * a * s, Math.sin(t) * c * s];
      };
    // Chunks of wall: painted outside, bare concrete or brick inside.
    const blocks = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < blocks; i++) {
      const [x, z] = spot(),
        w = 0.3 + rnd() * 0.7,
        h = 0.18 + rnd() * 0.35,
        d = 0.25 + rnd() * 0.55,
        color = rnd() < 0.55 ? (rnd() < 0.5 ? wall : accent) : CONCRETE;
      pieces.push(piece(new T.BoxGeometry(w, h, d), r, x, z, h * 0.2, rnd, color, 0.2));
    }
    // A broken floor slab leaning on the heap.
    if (rnd() < 0.8) {
      const [x, z] = spot(0.6),
        g = new T.BoxGeometry(1.3 + rnd() * 1.4, 0.2, 0.9 + rnd() * 0.9);
      pieces.push(piece(g, r, x, z, 0.15, rnd, CONCRETE, 0.1));
    }
    // Reinforcing bars sticking out.
    const bars = Math.floor(rnd() * 3);
    for (let i = 0; i < bars; i++) {
      const [x, z] = spot(0.5),
        len = 0.8 + rnd() * 0.9,
        g = new T.CylinderGeometry(0.025, 0.025, len, 4);
      g.translate(0, len / 2, 0);
      pieces.push(piece(g, r, x, z, -0.1, rnd, REBAR, 0.3));
    }
  }
  const merged = (list) => {
    if (!list.length) return null;
    const g = mergeGeometries(list);
    for (const q of list) q.dispose();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };
  return { mounds: merged(mounds), pieces: merged(pieces) };
}
