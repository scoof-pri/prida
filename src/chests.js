// Loot chests on the map, drawn as two instanced meshes (bodies and lids) instead of one model per chest: the whole
// map's chests cost two draw calls. Lids swing open per chest; chests hidden behind buildings are skipped.
import * as T from 'three';
import { modelAsset } from './assets.js';

const SCALE = 1.8;
export class ChestField {
  constructor(scene) {
    this.scene = scene;
    this.slots = new Map(); // chest id -> { slot, open }
    this.capacity = 0;
    const asset = modelAsset('chest');
    if (!asset) return;
    const root = asset.scene;
    root.updateMatrixWorld(true);
    const body = root.getObjectByName('crate-wide'),
      lid = root.getObjectByName('lid');
    this.bodyGeo = body?.geometry;
    this.lidGeo = lid?.geometry;
    this.bodyMat = body?.material;
    this.lidMat = lid?.material;
    this.lidOffset = lid ? lid.position.clone() : new T.Vector3();
    this.grow(256);
  }
  grow(capacity) {
    if (!this.bodyGeo) return;
    for (const m of [this.body, this.lid]) if (m) (m.removeFromParent(), m.dispose());
    const make = (geo, mat) => {
      const m = new T.InstancedMesh(geo, mat, capacity);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.count = 0;
      this.scene.add(m);
      return m;
    };
    this.body = make(this.bodyGeo, this.bodyMat);
    this.lid = make(this.lidGeo, this.lidMat);
    this.capacity = capacity;
  }
  update(chests, dt, hidden = () => false) {
    if (!this.body) return;
    if (chests.length > this.capacity) this.grow(Math.max(chests.length, this.capacity * 2));
    const m = new T.Matrix4(),
      root = new T.Matrix4(),
      lidM = new T.Matrix4(),
      q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2),
      s = new T.Vector3(SCALE, SCALE, SCALE),
      seen = new Set();
    let n = 0;
    for (const c of chests) {
      seen.add(c.id);
      let st = this.slots.get(c.id);
      if (!st) this.slots.set(c.id, (st = { open: c.opened ? 1 : 0 }));
      st.open = T.MathUtils.damp(st.open, c.opened ? 1 : 0, 9, dt);
      if (hidden(c)) continue;
      root.compose(new T.Vector3(c.x, (c.y || 0) + 0.05, c.z), q, s);
      this.body.setMatrixAt(n, root);
      lidM.makeRotationZ(st.open * -1.6).setPosition(this.lidOffset);
      this.lid.setMatrixAt(n, m.multiplyMatrices(root, lidM));
      n++;
    }
    for (const id of this.slots.keys()) if (!seen.has(id)) this.slots.delete(id);
    for (const mesh of [this.body, this.lid]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  dispose() {
    for (const m of [this.body, this.lid]) if (m) (m.removeFromParent(), m.dispose());
  }
}
