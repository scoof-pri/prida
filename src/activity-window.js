// Shared rule for a five-second retention window, measured in seconds, not rendered frames.
export const ACTIVITY_RETENTION = 5;
export class ActivityWindow {
  constructor(retention = ACTIVITY_RETENTION) {
    if (!Number.isFinite(retention) || retention < 0) throw new RangeError('Invalid activity retention.');
    this.retention = retention; this.last = new Map(); this.time = 0;
  }
  advance(now) {
    if (!Number.isFinite(now)) return this.time;
    if (now < this.time) this.last.clear(); // new round / deterministic clock reset
    this.time = now; return now;
  }
  touch(key, now = this.time) { this.last.set(key, now); }
  recent(key, now = this.time) { const t = this.last.get(key); return t !== undefined && now - t <= this.retention; }
  forget(key) { this.last.delete(key); }
  prune(now = this.time) { for (const [key, t] of this.last) if (now - t > this.retention) this.last.delete(key); }
  clear() { this.last.clear(); this.time = 0; }
}
// WebGL clip-space box rejection, using the same projection*view matrix as the renderer.
// Eight corner tests are conservative: a containing/intersecting box is never rejected.
export function clipBoxVisible(matrix, bounds) {
  if (!matrix || matrix.length !== 16 || !matrix.every(Number.isFinite)) return true;
  if (!bounds || !['x0','x1','y0','y1','z0','z1'].every(k => Number.isFinite(bounds[k]))) return true;
  let common = 63;
  for (const x of [bounds.x0, bounds.x1]) for (const y of [bounds.y0, bounds.y1]) for (const z of [bounds.z0, bounds.z1]) {
    const a = matrix[0]*x + matrix[4]*y + matrix[8]*z + matrix[12];
    const b = matrix[1]*x + matrix[5]*y + matrix[9]*z + matrix[13];
    const c = matrix[2]*x + matrix[6]*y + matrix[10]*z + matrix[14];
    const w = matrix[3]*x + matrix[7]*y + matrix[11]*z + matrix[15];
    common &= (a < -w ? 1 : 0) | (a > w ? 2 : 0) | (b < -w ? 4 : 0) | (b > w ? 8 : 0) | (c < -w ? 16 : 0) | (c > w ? 32 : 0);
    if (!common) return true;
  }
  return common === 0;
}
export function cameraClipMatrix(camera, out = new Float64Array(16)) {
  camera?.updateMatrixWorld?.();
  const a = camera?.projectionMatrix?.elements, b = camera?.matrixWorldInverse?.elements;
  if (!a || !b) return null;
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let n = 0; for (let k = 0; k < 4; k++) n += a[k*4+row]*b[col*4+k];
    out[col*4+row] = n;
  }
  return out;
}
export function sectorBounds(s) {
  if (s._renderBounds037) return s._renderBounds037;
  const b = { x0:s.x-s.w/2-4, x1:s.x+s.w/2+4, z0:s.z-s.d/2-4, z1:s.z+s.d/2+4, y0:-64, y1:160 };
  for (const o of [...(s.buildings || []), ...(s.obstacles || []), ...(s.waters || [])]) {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    b.x0=Math.min(b.x0,o.x-(o.w||0)/2-4);b.x1=Math.max(b.x1,o.x+(o.w||0)/2+4);
    b.z0=Math.min(b.z0,o.z-(o.d||0)/2-4);b.z1=Math.max(b.z1,o.z+(o.d||0)/2+4);
    b.y1=Math.max(b.y1,(o.y||0)+(o.height||o.h||0)+4);
  }
  return s._renderBounds037=b;
}
export function regionBounds(b) { return { x0:b.x0, x1:b.x1, z0:b.z0, z1:b.z1, y0:-64, y1:160 }; }
export function boxDistanceXZ(bounds, p) {
  return Math.hypot(Math.max(0,bounds.x0-p.x,p.x-bounds.x1),Math.max(0,bounds.z0-p.z,p.z-bounds.z1));
}
export class ViewActivity {
  constructor(now = () => performance.now()/1000) {
    this.now = now; this.memory = new ActivityWindow(); this.matrix = new Float64Array(16); this.clip=null;
  }
  begin(camera) { this.memory.advance(this.now()); this.position=camera.position; this.clip=cameraClipMatrix(camera,this.matrix); }
  visible(bounds) { return clipBoxVisible(this.clip,bounds); }
  needed(key,bounds,halo=24) {
    const seen=this.visible(bounds), close=boxDistanceXZ(bounds,this.position)<=halo;
    if (seen || close) this.memory.touch(key);
    return seen || close;
  }
  recent(key) { return this.memory.recent(key); }
  forget(key) { this.memory.forget(key); }
}
