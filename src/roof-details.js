// PRIDA 0.29.1 hotfix: cleaner pitched roofs without stray edge beams and with safer break behaviour.
import * as T from 'three';
import { roofHulls } from './architecture-geometry.js';
import { surfaceTint } from './materials.js';
const V = (p) => new T.Vector3(p[0], p[1], p[2]);
const point = (h, i) => h.vertices.slice(i * 3, i * 3 + 3);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - a[i]) * t);
function poly(m, key, ps, color) {
  for (let i = 1; i + 1 < ps.length; i++) m.tri(key, V(ps[0]), V(ps[i]), V(ps[i + 1]), color);
}
function edgePair(points) {
  if (!points || points.length < 2) return null;
  let best = null,
    bestLen = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i],
        b = points[j],
        len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len > bestLen) {
        bestLen = len;
        best = [a, b];
      }
    }
  return bestLen > 0.2 ? best : null;
}
function gutter(m, a, b, color) {
  const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]),
    length = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (length < 1.2) return;
  const x = (a[0] + b[0]) / 2,
    z = (a[2] + b[2]) / 2,
    y = (a[1] + b[1]) / 2,
    t = 0.011,
    width = 0.10,
    height = 0.07;
  for (const side of [-1, 1])
    m.box(
      'metal',
      x + (alongX ? 0 : (side * (width - t)) / 2),
      y,
      z + (alongX ? (side * (width - t)) / 2 : 0),
      alongX ? length : t,
      height,
      alongX ? t : length,
      color,
      { bottom: true },
    );
  m.box('metal', x, y, z, alongX ? length : width - 2 * t, t, alongX ? width - 2 * t : length, color, { bottom: true });
}
function ridge(m, a, b, key, color) {
  const dir = new T.Vector3().subVectors(V(b), V(a)),
    length = dir.length();
  if (length < 0.1) return;
  dir.normalize();
  const side = new T.Vector3(-dir.z, 0, dir.x),
    A = V(a),
    B = V(b),
    r = 0.12;
  for (let i = 0; i < 8; i++) {
    const t0 = (i * Math.PI) / 8,
      t1 = ((i + 1) * Math.PI) / 8;
    const off = (t) => side.clone().multiplyScalar(Math.cos(t) * r).add(new T.Vector3(0, Math.sin(t) * r + 0.016, 0));
    const p = A.clone().add(off(t0)),
      q = B.clone().add(off(t0)),
      s = B.clone().add(off(t1)),
      u = A.clone().add(off(t1));
    m.quad(key, p, q, s, u, color);
  }
}
export function detailedRoof(m, b, plan, facade) {
  const shapes = roofHulls(b, plan.style),
    metal = surfaceTint('steel', 0x7c8285),
    trim = surfaceTint('concrete', 0xd5c9b4);
  const key = plan.style === 'saw' || plan.style === 'shed' ? 'sheet' : b.id % 2 === 0 ? 'clay' : 'slate';
  const name = key === 'clay' ? 'claytiles' : key === 'slate' ? 'roof' : 'corrugated';
  const tile = surfaceTint(name, key === 'clay' ? 0xe1c1a1 : key === 'slate' ? 0x8a939f : 0x9ba5a8).multiplyScalar(plan.shade ?? 0.94);
  const wall = surfaceTint(facade, b.color);
  for (const [shapeIndex, h] of shapes.entries()) {
    for (const face of h.faces) {
      let ps = face.ids.map((i) => point(h, i));
      if (face.kind === 'glass' && plan.style === 'saw') {
        const base = Math.min(...ps.map((p) => p[1])),
          cut = base + 0.116;
        if (shapeIndex === 0) poly(m, 'concrete', ps.map((p) => [p[0], Math.min(p[1], cut - 0.006), p[2]]), trim);
        ps = ps.map((p) => [p[0], Math.max(p[1], cut), p[2]]);
      }
      if (face.kind === 'bottom') continue;
      const surface = face.kind === 'slope' ? key : face.kind === 'glass' ? 'glass' : face.kind === 'edge' ? 'concrete' : facade;
      const color = face.kind === 'slope' ? tile : face.kind === 'glass' ? new T.Color(1, 1, 1) : face.kind === 'edge' ? trim : wall;
      poly(m, surface, ps, color);
      if (face.kind === 'slope' && key !== 'sheet') {
        const low = Math.min(...ps.map((p) => p[1])),
          high = Math.max(...ps.map((p) => p[1]));
        const rise = high - low,
          rows = Math.min(24, Math.max(3, Math.round(Math.hypot(Math.max(b.w, b.d) / 3, rise) / 0.52)));
        for (let row = 1; row < rows; row++) {
          const y = low + (rise * row) / rows,
            hit = [];
          for (let i = 0; i < ps.length; i++) {
            const a = ps[i],
              c = ps[(i + 1) % ps.length];
            if ((a[1] < y && c[1] >= y) || (c[1] < y && a[1] >= y)) hit.push(mix(a, c, (y - a[1]) / (c[1] - a[1])));
          }
          const pair = edgePair(hit);
          if (!pair) continue;
          const [a, c] = pair,
            off = face.n.map((v) => v * 0.016),
            front = face.n.map((v) => v * 0.031);
          const p = a.map((v, i) => v + off[i]),
            q = c.map((v, i) => v + off[i]);
          const r = c.map((v, i) => v + front[i] + (i === 1 ? 0.02 : 0)),
            s = a.map((v, i) => v + front[i] + (i === 1 ? 0.02 : 0));
          const n = new T.Vector3().subVectors(V(q), V(p)).cross(new T.Vector3().subVectors(V(r), V(p)));
          poly(m, key, n.dot(V(face.n)) < 0 ? [s, r, q, p] : [p, q, r, s], tile);
        }
      }
      if (face.kind === 'glass') {
        const x0 = Math.min(...ps.map((p) => p[0])),
          x1 = Math.max(...ps.map((p) => p[0])),
          y0 = Math.min(...ps.map((p) => p[1])),
          y1 = Math.max(...ps.map((p) => p[1])),
          z = ps[0][2] - 0.045;
        for (let x = x0 + 0.8; x < x1 - 0.25; x += 1.6) m.box('metal', x, y0, z, 0.05, y1 - y0, 0.075, metal);
        m.box('metal', (x0 + x1) / 2, y1 - 0.05, z, x1 - x0, 0.085, 0.095, metal);
      }
    }
    if (plan.style === 'gable' || plan.style === 'hip') ridge(m, point(h, 8), point(h, 9), key, tile);
    if (plan.style === 'gable' || plan.style === 'hip') {
      for (const f of h.faces.filter((f) => f.kind === 'edge' && Math.abs(b.w >= b.d ? f.n[0] : f.n[2]) < 0.5)) {
        const ps = f.ids.map((i) => point(h, i)),
          maxY = Math.max(...ps.map((p) => p[1])),
          top = ps.filter((p) => Math.abs(p[1] - maxY) < 1e-5),
          pair = edgePair(top);
        if (!pair) continue;
        const [p0, p1] = pair,
          length = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
        if (length < 1.2 || length > Math.max(b.w, b.d) + 1.4) continue;
        const outward = f.n.map((v) => v * 0.075);
        const a = p0.map((v, i) => v + outward[i] - (i === 1 ? 0.085 : 0)),
          c = p1.map((v, i) => v + outward[i] - (i === 1 ? 0.085 : 0));
        gutter(m, a, c, metal);
        const drop = a.map((v, i) => v + f.n[i] * 0.018);
        const pipeHeight = Math.min(2.2, Math.max(0, b.roofBase - 0.2));
        if (pipeHeight > 1.05) m.cylinder('metal', drop[0], drop[1] - pipeHeight, drop[2], 0.04, pipeHeight, 8, metal, { top: false });
      }
    }
  }
  if (plan.chimney) {
    const c = plan.chimney,
      brick = surfaceTint('bricks', 0xcfb9a0);
    m.box('bricks', c.x, b.roofBase + 0.04, c.z, 0.7, c.top - b.roofBase - 0.04, 0.7, brick, { top: 'concrete', topColor: trim });
    m.box('concrete', c.x, c.top, c.z, 0.86, 0.1, 0.86, trim);
    m.cylinder('metal', c.x, c.top + 0.1, c.z, 0.17, 0.16, 10, metal, { top: false });
  }
}
