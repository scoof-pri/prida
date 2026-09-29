// Loot chests on the map, drawn as two instanced meshes (bodies and lids) instead of one model per chest: the whole
// map's chests cost two draw calls. Lids swing open per chest; chests hidden behind buildings are skipped.
// 0.27: the chest's trim is painted and lit in its tier's colour (instance colour, accent shader in materials.js),
// and roof and legendary chests send a beam of light into the sky so they can be spotted from the bus.
import * as T from 'three';
import { modelAsset } from './assets.js';
import { objectSurface } from './materials.js';

const SCALE = 1.8;
// Trim colour per chest tier (common, uncommon, rare, epic, legendary looks).
export const TIER_COLORS = { chest: 0x80878c, park: 0x4fbf5a, supply: 0x3d8fe0, roof: 0x9b5ce6, legendary: 0xffb23f };
const BEAM_TIERS = new Set(['roof', 'legendary']);
export class ChestField {
  constructor(scene) {
    this.scene = scene;
    this.slots = new Map(); // chest id -> { slot, open }
    this.capacity = 0;
    const asset = modelAsset('chest');
    if (!asset) return;
    const root = asset.scene;
    root.updateMatrixWorld(true);
    // The crate and its lid, found by shape rather than by node name (the loader renames nodes that share a
    // name with their mesh, which left the field empty: no chests were drawn at all).
    let body = null,
      lid = null;
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (/lid/i.test(o.name)) lid ??= o;
      else body ??= o;
    });
    this.bodyGeo = body?.geometry;
    this.lidGeo = lid?.geometry;
    // Brushed steel with brass fittings and a little dirt at the foot (object space: each chest keeps its grain).
    const surface = (m) =>
      m &&
      objectSurface(Object.assign(m.clone(), { roughness: 0.45, metalness: 0.5, envMapIntensity: 1.2 }), {
        surface: 'steel',
        size: 0.45,
        strength: 0.6,
        normal: 0.9,
        classify: 2,
        grime: [0, 0.35, 0.45],
        accent: true,
        glow: 0.9,
      });
    this.bodyMat = surface(body?.material);
    this.lidMat = lid?.material === body?.material ? this.bodyMat : surface(lid?.material);
    this.lidOffset = lid ? lid.position.clone() : new T.Vector3();
    // Beams: a tall open tube, brightest at the foot, fading upward, added to what is behind it.
    const beamGeo = new T.CylinderGeometry(0.2, 0.42, 22, 10, 10, true).translate(0, 11, 0),
      colors = [];
    for (let i = 0; i < beamGeo.attributes.position.count; i++) {
      const y = beamGeo.attributes.position.getY(i) / 22,
        k = Math.min(1, y / 0.06) * Math.pow(1 - y, 1.6);
      colors.push(1, 1, 1, k * 0.6);
    }
    // RGBA vertex colours: a translucent tinted column (additive light washes out to white against the sky).
    beamGeo.setAttribute('color', new T.Float32BufferAttribute(colors, 4));
    this.beams = new T.InstancedMesh(
      beamGeo,
      new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide }),
      64,
    );
    this.beams.frustumCulled = false;
    for (let i = 0; i < 64; i++) this.beams.setColorAt(i, new T.Color(TIER_COLORS.legendary));
    this.beams.count = 0;
    this.beams.renderOrder = 5;
    scene.add(this.beams);
    this.tint = new T.Color();
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
      // Instance colours exist from the start, so the shader is compiled with them.
      for (let i = 0; i < capacity; i++) m.setColorAt(i, new T.Color(TIER_COLORS.chest));
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
    let n = 0,
      beams = 0;
    this.clock = (this.clock || 0) + dt;
    for (const c of chests) {
      seen.add(c.id);
      let st = this.slots.get(c.id);
      if (!st) this.slots.set(c.id, (st = { open: c.opened ? 1 : 0 }));
      st.open = T.MathUtils.damp(st.open, c.opened ? 1 : 0, 9, dt);
      // The beam shows from afar (even past a building), until the chest is opened.
      if (BEAM_TIERS.has(c.tier) && !c.opened && beams < this.beams.instanceMatrix.count) {
        const pulse = 1 + Math.sin(this.clock * 2.4 + (c.x + c.z) * 0.1) * 0.08;
        this.beams.setMatrixAt(beams, m.compose(new T.Vector3(c.x, (c.y || 0) + 0.2, c.z), q.clone().identity(), new T.Vector3(pulse, 1, pulse)));
        this.beams.setColorAt(beams, this.tint.setHex(TIER_COLORS[c.tier]).multiplyScalar(c.tier === 'legendary' ? 1.3 : 0.9));
        beams++;
      }
      if (hidden(c)) continue;
      root.compose(new T.Vector3(c.x, (c.y || 0) + 0.05, c.z), q, s);
      this.body.setMatrixAt(n, root);
      lidM.makeRotationZ(st.open * -1.6).setPosition(this.lidOffset);
      this.lid.setMatrixAt(n, m.multiplyMatrices(root, lidM));
      // Trim in the tier's colour, dimmed once the chest is open.
      this.tint.setHex(TIER_COLORS[c.tier] ?? TIER_COLORS.chest).multiplyScalar(c.opened ? 0.3 : 1);
      this.body.setColorAt(n, this.tint);
      this.lid.setColorAt(n, this.tint);
      n++;
    }
    for (const id of this.slots.keys()) if (!seen.has(id)) this.slots.delete(id);
    for (const mesh of [this.body, this.lid]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.beams.count = beams;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }
  dispose() {
    for (const m of [this.body, this.lid]) if (m) (m.removeFromParent(), m.dispose());
    if (this.beams) {
      this.beams.removeFromParent();
      this.beams.geometry.dispose();
      this.beams.material.dispose();
      this.beams.dispose();
    }
  }
}
