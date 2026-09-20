// One-metre navigation grid. Doorways, walls and furnishings share the physics map.
export class Navigation {
  constructor(map) {
    this.map = map;
    this.w = map.limit.x * 2 - 1;
    this.h = map.limit.z * 2 - 1;
    this.ox = 1 - map.limit.x;
    this.oz = 1 - map.limit.z;
    this.blocked = new Uint8Array(this.w * this.h);
    const boxes = map.obstacles.filter((b) => !b.nocollide && b.y - b.h / 2 - (b.ground || 0) < 1.8);
    for (const b of boxes) {
      const x0 = Math.max(0, Math.ceil(b.x - b.w / 2 - 0.43 - this.ox)),
        x1 = Math.min(this.w - 1, Math.floor(b.x + b.w / 2 + 0.43 - this.ox)),
        z0 = Math.max(0, Math.ceil(b.z - b.d / 2 - 0.43 - this.oz)),
        z1 = Math.min(this.h - 1, Math.floor(b.z + b.d / 2 + 0.43 - this.oz));
      for (let z = z0; z <= z1; z++) this.blocked.fill(1, z * this.w + x0, z * this.w + x1 + 1);
    }
  }
  node(p) {
    const x = Math.max(0, Math.min(this.w - 1, Math.round(p.x - this.ox))),
      z = Math.max(0, Math.min(this.h - 1, Math.round(p.z - this.oz)));
    let index = z * this.w + x;
    if (!this.blocked[index]) return index;
    for (let r = 1; r < 5; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx,
            zz = z + dz,
            n = zz * this.w + xx;
          if (xx >= 0 && xx < this.w && zz >= 0 && zz < this.h && !this.blocked[n]) return n;
        }
    return -1;
  }
  point(n) {
    return { x: (n % this.w) + this.ox, z: Math.floor(n / this.w) + this.oz };
  }
  // A* over the grid with reused buffers and a node budget (the city map has ~250k cells). When the goal is out
  // of reach within the budget the path leads to the explored node closest to it.
  path(a, b, budget = 30000) {
    const start = this.node(a),
      end = this.node(b);
    if (start < 0 || end < 0) return [];
    const n = this.blocked.length;
    if (!this.prev || this.prev.length !== n || this.heap.length < budget * 4 + 8) {
      this.prev = new Int32Array(n);
      this.cost = new Float32Array(n);
      this.stamp = new Uint32Array(n);
      // Nodes can be queued more than once (4 per expansion at most).
      this.heap = new Int32Array(Math.max(n, budget * 4 + 8));
      this.heapKey = new Float32Array(this.heap.length);
      this.run = 0;
    }
    const run = ++this.run,
      { prev, cost, stamp, heap, heapKey, w } = this,
      ex = end % w,
      ez = Math.floor(end / w),
      h = (k) => Math.abs((k % w) - ex) + Math.abs(Math.floor(k / w) - ez);
    let size = 0;
    const push = (k, f) => {
      let i = size++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heapKey[parent] <= f) break;
        heap[i] = heap[parent];
        heapKey[i] = heapKey[parent];
        i = parent;
      }
      heap[i] = k;
      heapKey[i] = f;
    };
    const pop = () => {
      const top = heap[0],
        lastK = heap[--size],
        lastF = heapKey[size];
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c++;
        if (heapKey[c] >= lastF) break;
        heap[i] = heap[c];
        heapKey[i] = heapKey[c];
        i = c;
      }
      heap[i] = lastK;
      heapKey[i] = lastF;
      return top;
    };
    stamp[start] = run;
    prev[start] = start;
    cost[start] = 0;
    push(start, h(start));
    let best = start,
      bestH = h(start),
      expanded = 0;
    while (size > 0 && expanded < budget) {
      const k = pop();
      if (k === end) {
        best = end;
        break;
      }
      expanded++;
      const x = k % w,
        z = Math.floor(k / w),
        g = cost[k] + 1;
      for (let d = 0; d < 4; d++) {
        const xx = x + (d === 0 ? 1 : d === 1 ? -1 : 0),
          zz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (xx < 0 || xx >= w || zz < 0 || zz >= this.h) continue;
        const q = zz * w + xx;
        if (this.blocked[q] || (stamp[q] === run && cost[q] <= g)) continue;
        stamp[q] = run;
        cost[q] = g;
        prev[q] = k;
        const hq = h(q);
        if (hq < bestH) (bestH = hq), (best = q);
        push(q, g + hq * 1.001);
      }
    }
    if (best === start) return [];
    const path = [];
    for (let k = best; k !== start; k = prev[k]) path.push(this.point(k));
    path.reverse();
    return path;
  }
}
