// Things players set down (0.27): launch pads, cover walls and campfires, drawn from the snapshot's `deployables`.
// Walls also go into the view's own map, so the camera and the third-person aim ray stop at them like the server's
// bullets do.
import * as T from 'three';
import { model } from './assets.js';
import { addObstacle, removeObstacle } from './destruction.js';

const PAD = 0xb36cff,
  FIRE = [0xffb347, 0xff7a2a, 0xffd27a];
function glowMaterial(color, opacity = 0.6) {
  return new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false });
}
export class DeployViews {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.items = new Map();
    this.map = null;
    this.clock = 0;
    this.ringGeo = new T.RingGeometry(0.55, 0.72, 40);
    this.flameGeo = new T.ConeGeometry(0.22, 0.75, 8, 1, true);
  }
  // A new map (new match): whatever stood on the old one is gone.
  setMap(map) {
    if (map === this.map) return;
    for (const v of this.items.values()) this.remove(v, false);
    this.items.clear();
    this.map = map;
  }
  update(list = [], dt) {
    this.clock += dt;
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let v = this.items.get(d.id);
      if (!v) this.items.set(d.id, (v = this.make(d)));
      this.animate(v, d, dt);
    }
    for (const [id, v] of this.items)
      if (!seen.has(id)) {
        this.remove(v, true);
        this.items.delete(id);
      }
  }
  make(d) {
    const g = new T.Group(),
      v = { d, g, age: 0, hp: d.hp };
    g.position.set(d.x, d.y, d.z);
    if (d.kind === 'pad') {
      const m = model('launchpad');
      m.scale.setScalar(4);
      m.rotation.y = d.angle || 0;
      g.add(m);
      // A pulsing ring of light over it, so it reads from a distance.
      v.ring = new T.Mesh(this.ringGeo, glowMaterial(PAD, 0.55));
      v.ring.rotation.x = -Math.PI / 2;
      v.ring.position.y = 0.16;
      g.add(v.ring);
    } else if (d.kind === 'wall') {
      const m = model('coverwall'),
        f = { x: Math.sin(d.angle || 0), z: Math.cos(d.angle || 0) };
      m.scale.setScalar(10);
      // The braces go on the side of the one who set it down.
      m.rotation.y = d.alongX ? (f.z > 0 ? 0 : Math.PI) : f.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(m);
      v.body = m;
      m.scale.y = 0.05;
      if (this.map) {
        v.obstacle = { x: d.x, y: d.y + 1.1, z: d.z, w: d.alongX ? 3 : 0.3, h: 2.2, d: d.alongX ? 0.3 : 3, part: 'deploy', color: 0x8a949c };
        addObstacle(this.map, v.obstacle);
      }
      this.fx?.burst({ x: d.x, y: d.y + 0.2, z: d.z }, 10, 0xb9ad96, 0.5, 0.8, true, 1.6);
    } else if (d.kind === 'fire') {
      const m = model('campfire');
      m.scale.setScalar(3);
      g.add(m);
      // Flames: open cones of additive light that flicker; embers and smoke come from the particle system.
      v.flames = FIRE.map((c, i) => {
        const f = new T.Mesh(this.flameGeo, glowMaterial(c, 0.55 - i * 0.1));
        f.position.y = 0.42;
        f.scale.setScalar(1 - i * 0.22);
        g.add(f);
        return f;
      });
      v.ring = new T.Mesh(this.ringGeo, glowMaterial(0x7dff9a, 0.18));
      v.ring.rotation.x = -Math.PI / 2;
      v.ring.position.y = 0.05;
      v.ring.scale.setScalar(4.8);
      g.add(v.ring);
    }
    g.traverse((o) => {
      if (o.isMesh && !o.material.blending) o.castShadow = o.receiveShadow = true;
    });
    this.scene.add(g);
    return v;
  }
  animate(v, d, dt) {
    v.age += dt;
    const t = this.clock;
    if (d.kind === 'pad') {
      const k = (t * 1.4 + d.id * 0.37) % 1;
      v.ring.scale.setScalar(1 + k * 1.1);
      v.ring.material.opacity = 0.55 * (1 - k);
      v.spark = (v.spark || 0) + dt;
      if (v.spark > 0.12 && this.fx) {
        v.spark = 0;
        const a = Math.random() * Math.PI * 2;
        this.fx.emit({ x: d.x + Math.cos(a) * 0.6, y: d.y + 0.2, z: d.z + Math.sin(a) * 0.6 }, { x: 0, y: 2.4, z: 0 }, PAD, 0.09, 0.6, { drag: 1.2 });
      }
    } else if (d.kind === 'wall') {
      // Springs up over a third of a second with a little overshoot.
      const k = Math.min(1, v.age / 0.32),
        s = k < 1 ? Math.sin(k * Math.PI * 0.5) * (1 + 0.12 * Math.sin(k * Math.PI)) : 1;
      v.body.scale.y = 10 * Math.max(0.05, s);
      // Sparks where rounds hit it.
      if (v.hp !== undefined && d.hp < v.hp && this.fx) {
        this.fx.burst({ x: d.x, y: d.y + 1 + Math.random(), z: d.z }, 5, 0xffd38a, 0.07, 0.25, false, 3);
      }
      v.hp = d.hp;
    } else if (d.kind === 'fire') {
      v.flames.forEach((f, i) => {
        const w = 1 - i * 0.22;
        f.scale.set(w * (1 + Math.sin(t * 13 + i * 2) * 0.12), w * (1 + Math.sin(t * 9.3 + i) * 0.22), w * (1 + Math.cos(t * 11 + i) * 0.12));
        f.rotation.y = t * (1.5 + i);
      });
      v.ring.material.opacity = 0.14 + Math.sin(t * 2.2) * 0.05;
      v.spark = (v.spark || 0) + dt;
      if (v.spark > 0.07 && this.fx) {
        v.spark = 0;
        const r = () => (Math.random() - 0.5) * 0.3;
        this.fx.emit({ x: d.x + r(), y: d.y + 0.5, z: d.z + r() }, { x: r(), y: 1.6, z: r() }, FIRE[Math.floor(Math.random() * 3)], 0.07, 0.9, { gravity: -0.4, drag: 1 });
        if (Math.random() < 0.25) this.fx.emit({ x: d.x, y: d.y + 1, z: d.z }, { x: r(), y: 0.8, z: r() }, 0x5b5750, 0.4, 2.2, { smoke: true, grow: 1.4 });
        // Healing motes drift up round the edge.
        if (Math.random() < 0.3) {
          const a = Math.random() * Math.PI * 2;
          this.fx.emit({ x: d.x + Math.cos(a) * 2.6, y: d.y + 0.1, z: d.z + Math.sin(a) * 2.6 }, { x: 0, y: 0.9, z: 0 }, 0x7dff9a, 0.08, 1.1, { drag: 1.2 });
        }
      }
    }
  }
  remove(v, effects) {
    const d = v.d;
    if (effects && this.fx) {
      if (d.kind === 'wall') this.fx.burst({ x: d.x, y: d.y + 1, z: d.z }, 12, 0x9aa1ad, 0.12, 0.6, false, 4);
      this.fx.burst({ x: d.x, y: d.y + 0.3, z: d.z }, 6, 0x9c948a, 0.5, 0.9, true, 1);
    }
    if (v.obstacle && this.map) removeObstacle(this.map, v.obstacle);
    v.g.removeFromParent();
    v.g.traverse((o) => {
      if (o.isMesh && o.material.blending === T.AdditiveBlending) o.material.dispose();
    });
  }
}
