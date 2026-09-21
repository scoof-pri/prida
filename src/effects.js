import * as T from 'three';
import { groundHeight } from './terrain.js';
const UP = new T.Vector3(0, 1, 0),
  FRONT = new T.Vector3(0, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
// Fixed-capacity pools: sustained fire never grows the scene graph or allocates GPU geometry.
export class CombatEffects {
  constructor(scene, map, { lite = false } = {}) {
    this.scene = scene;
    this.map = map;
    this.lite = lite;
    this.clock = 0;
    this.pools = [];
    this.rocketHistory = new Map();
    this.dummy = new T.Object3D();
    this.color = new T.Color();
    for (const smoke of [false, true]) {
      const cap = smoke ? 320 : 700,
        geometry = new T.BufferGeometry();
      for (const [name, size] of [
        ['position', 3],
        ['color', 3],
        ['size', 1],
        ['opacity', 1],
      ])
        geometry.setAttribute(
          name,
          new T.BufferAttribute(new Float32Array(cap * size), size).setUsage(T.DynamicDrawUsage),
        );
      const material = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: smoke ? T.NormalBlending : T.AdditiveBlending,
        uniforms: { scale: { value: 500 } },
        vertexShader: `attribute vec3 color;attribute float size;attribute float opacity;uniform float scale;varying vec3 vColor;varying float vOpacity;void main(){vColor=color;vOpacity=opacity;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(size*scale/max(.2,-mv.z),0.0,${smoke ? "320.0" : "100.0"});}`,
        fragmentShader: `varying vec3 vColor;varying float vOpacity;void main(){float r=length(gl_PointCoord-.5)*2.0;if(r>1.0||vOpacity<=0.0)discard;float a=pow(1.0-r,${smoke ? '1.2' : '1.7'})*vOpacity;gl_FragColor=vec4(vColor,a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`,
      });
      const mesh = new T.Points(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pools.push({ cap, mesh, items: Array(cap).fill(null), cursor: 0, smoke });
    }
    this.tracers = Array(128).fill(null);
    this.traceCursor = 0;
    this.tracerMesh = new T.InstancedMesh(
      new T.CylinderGeometry(1, 1, 1, 4),
      new T.MeshBasicMaterial({ color: new T.Color(2.4, 1.65, 0.65), toneMapped: false }),
      128,
    );
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(this.tracerMesh);
    this.debrisCap = lite ? 360 : 1400;
    this.debris = Array(this.debrisCap).fill(null);
    this.debrisCursor = 0;
    this.debrisMesh = new T.InstancedMesh(
      new T.BoxGeometry(1, 1, 1),
      new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
      this.debrisCap,
    );
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < this.debrisCap; i++) this.debrisMesh.setColorAt(i, this.color.setHex(0xffffff));
    this.debrisMesh.castShadow = !lite;
    scene.add(this.debrisMesh);
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4,
          r = Math.hypot(x - 15.5, y - 15.5) / 16;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 40;
        pixels[i + 3] = Math.max(0, 1 - r * r) * 210;
      }
    const tex = new T.DataTexture(pixels, 32, 32);
    tex.needsUpdate = true;
    this.marks = Array(64).fill(null);
    this.markCursor = 0;
    this.markMesh = new T.InstancedMesh(
      new T.PlaneGeometry(1, 1),
      new T.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      64,
    );
    this.markMesh.frustumCulled = false;
    scene.add(this.markMesh);
    this.rings = [];
    this.ringGeo = new T.RingGeometry(0.86, 1, 40);
    this.light = new T.PointLight(0xffa048, 0, 12, 2);
    scene.add(this.light);
    this.flashTime = 0;
    this.makeHaze();
    this.reset(map);
  }
  // Low drifting haze: a few dozen very large, faint sprites near the ground.
  makeHaze() {
    const n = 48,
      g = new T.BufferGeometry(),
      pos = new Float32Array(n * 3),
      size = new Float32Array(n),
      seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-100, 100);
      pos[i * 3 + 1] = rand(1.5, 5);
      pos[i * 3 + 2] = rand(-85, 85);
      size[i] = rand(22, 40);
      seed[i] = rand(0, 100);
    }
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('size', new T.BufferAttribute(size, 1));
    g.setAttribute('seed', new T.BufferAttribute(seed, 1));
    this.haze = new T.Points(
      g,
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { scale: { value: 500 }, time: { value: 0 }, opacity: { value: 0.045 } },
        vertexShader: `attribute float size;attribute float seed;uniform float scale;uniform float time;varying float vFade;
        void main(){vec3 p=position;p.x+=sin(time*0.05+seed)*6.0+time*0.35;p.x=mod(p.x+104.0,208.0)-104.0;p.z+=cos(time*0.04+seed*1.7)*5.0;
        vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;float d=-mv.z;
        vFade=smoothstep(4.0,18.0,d)*(1.0-smoothstep(120.0,200.0,d));gl_PointSize=clamp(size*scale/max(1.0,d),0.0,600.0);}`,
        fragmentShader: `uniform float opacity;varying float vFade;void main(){float r=length(gl_PointCoord-.5)*2.0;if(r>1.0)discard;
        gl_FragColor=vec4(vec3(0.86,0.9,0.88),pow(1.0-r,2.2)*opacity*vFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      }),
    );
    this.haze.frustumCulled = false;
    this.haze.renderOrder = 5;
    this.scene.add(this.haze);
  }
  setQuality(lite) {
    this.lite = lite;
    if (this.haze) this.haze.visible = !lite;
  }
  reset(map) {
    this.map = map;
    for (const p of this.pools) p.items.fill(null);
    this.tracers.fill(null);
    this.debris.fill(null);
    this.marks.fill(null);
    for (const r of this.rings) {
      r.mesh.removeFromParent();
      r.mesh.material.dispose();
    }
    this.rings = [];
    this.rocketHistory.clear();
    this.light.intensity = 0;
    this.flashTime = 0;
    this.update(0);
  }
  emit(position, velocity, color, size, life, { smoke = false, gravity = 0, drag = 1, grow = 0 } = {}) {
    const p = this.pools[smoke ? 1 : 0],
      cap = this.lite ? Math.floor(p.cap * 0.4) : p.cap,
      i = p.cursor++ % cap;
    p.items[i] = {
      x: position.x,
      y: position.y,
      z: position.z,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      color: new T.Color(color),
      size,
      life,
      maxLife: life,
      gravity,
      drag,
      grow,
    };
  }
  burst(pos, n, color, size, life, smoke = false, speed = 3) {
    for (let i = 0; i < Math.ceil(n * (this.lite ? 0.45 : 1)); i++)
      this.emit(
        pos,
        { x: rand(-speed, speed), y: rand(0.4, speed + 1), z: rand(-speed, speed) },
        color,
        size * rand(0.7, 1.3),
        life * rand(0.65, 1.2),
        { smoke, gravity: smoke ? -1 : 8, drag: smoke ? 0.8 : 1.1, grow: smoke ? 0.9 : 0 },
      );
  }
  addDebris(pos, velocity, life, size, color) {
    this.debris[this.debrisCursor++ % this.debrisCap] = {
      ...pos,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      life,
      maxLife: life,
      size,
      color,
      rotation: rand(0, 6),
      spin: rand(3, 9),
      shade: rand(0.85, 1.08),
    };
  }
  // Concrete cells knocked out of a wall: each becomes one or two cubes thrown away from `from` (the blast,
  // bullet or blade that did it); cells that simply lost support drop out.
  cells(list, color, from = null, strength = 1) {
    const budget = this.lite ? 40 : 160,
      step = Math.max(1, Math.ceil(list.length / budget));
    for (let k = 0; k < list.length; k += step) {
      const p = list[k],
        pieces = this.lite ? 1 : list.length > 60 ? 1 : 2;
      for (let j = 0; j < pieces; j++) {
        let v;
        if (from) {
          const dx = p.x - from.x,
            dy = p.y - from.y,
            dz = p.z - from.z,
            len = Math.hypot(dx, dy, dz) || 1,
            speed = rand(3, 7) * strength * Math.max(0.35, 1 - len / 8);
          v = { x: (dx / len) * speed + rand(-1, 1), y: (dy / len) * speed + rand(0.5, 3), z: (dz / len) * speed + rand(-1, 1) };
        } else v = { x: rand(-0.6, 0.6), y: rand(-0.5, 0.8), z: rand(-0.6, 0.6) };
        this.addDebris(
          { x: p.x + rand(-0.1, 0.1), y: p.y + rand(-0.1, 0.1), z: p.z + rand(-0.1, 0.1) },
          v,
          rand(2.8, 4.5),
          pieces > 1 ? rand(0.16, 0.26) : rand(0.24, 0.36),
          color,
        );
      }
    }
    if (list.length) {
      const c = list[Math.floor(list.length / 2)];
      this.burst(c, Math.min(10, 2 + list.length), 0xc2b8a6, 0.6 + Math.min(1.4, list.length * 0.04), 1.4, true, 0.8);
    }
  }
  // Bullet marks on cells that are gone would float in mid-air.
  clearMarks(points, radius = 0.32) {
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (m && points.some((p) => Math.abs(p.x - m.x) < radius && Math.abs(p.y - m.y) < radius && Math.abs(p.z - m.z) < radius))
        this.marks[i] = null;
    }
  }
  // Shattered window glass.
  glass(w) {
    for (let i = 0; i < (this.lite ? 5 : 12); i++)
      this.addDebris(
        { x: w.x + rand(-w.w / 2, w.w / 2) * (w.axis === 'x' ? 1 : 0.1), y: w.y + rand(-0.5, 0.5), z: w.z + rand(-w.w / 2, w.w / 2) * (w.axis === 'z' ? 1 : 0.1) },
        { x: rand(-2.5, 2.5), y: rand(0, 2), z: rand(-2.5, 2.5) },
        rand(1, 2),
        rand(0.05, 0.12),
        0x9cc6d8,
      );
  }
  // Chunks blown off an upper storey facade.
  chunks(e) {
    const n = Math.min(this.lite ? 10 : 40, e.n || 16);
    for (let i = 0; i < n; i++)
      this.addDebris(
        { x: e.x + rand(-0.8, 0.8), y: e.y + rand(-0.8, 0.8), z: e.z + rand(-0.8, 0.8) },
        { x: rand(-6, 6), y: rand(0, 6), z: rand(-6, 6) },
        rand(2.5, 4),
        rand(0.15, 0.4),
        i % 4 ? e.color ?? 0xb9b1a2 : 0x8f877a,
      );
    this.burst({ x: e.x, y: e.y, z: e.z }, 10, 0xc2b7a4, 2, 2.2, true, 1.2);
  }
  // Upper storeys hitting the ground: a wave of blocks over the footprint.
  landing(b, base = 0) {
    const n = this.lite ? 60 : 260;
    for (let i = 0; i < n; i++)
      this.addDebris(
        { x: b.x + rand(-b.w / 2, b.w / 2), y: base + rand(0.5, Math.min(8, b.height * 0.5)), z: b.z + rand(-b.d / 2, b.d / 2) },
        { x: rand(-7, 7), y: rand(1, 7), z: rand(-7, 7) },
        rand(3, 5.5),
        rand(0.2, 0.6),
        i % 5 === 0 ? b.accent ?? 0x8f877a : i % 3 === 0 ? 0x8f877a : b.color ?? 0xb9b1a2,
      );
    this.dust({ x: b.x, z: b.z, w: b.w, d: b.d, height: 3, base });
  }
  mark(pos, normal, size = 0.16) {
    this.marks[this.markCursor++ % (this.lite ? 24 : 64)] = { ...pos, normal, size, life: 8 };
  }
  // Burning wreck: flames with dark smoke rising.
  fire(f) {
    const n = this.lite ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const pos = { x: f.x + rand(-0.7, 0.7), y: f.y + rand(-0.2, 0.3), z: f.z + rand(-1, 1) };
      this.emit(pos, { x: rand(-0.3, 0.3), y: rand(1.5, 3), z: rand(-0.3, 0.3) }, rand(0, 1) < 0.5 ? 0xff8a2a : 0xffc14a, rand(0.35, 0.7), rand(0.35, 0.6), { gravity: -2, drag: 1.5 });
    }
    this.emit({ x: f.x + rand(-0.5, 0.5), y: f.y + 0.8, z: f.z + rand(-0.5, 0.5) }, { x: rand(-0.2, 0.4), y: rand(1.2, 2), z: rand(-0.2, 0.3) }, 0x3a3634, 1.1, 2.6, { smoke: true, grow: 2.2, gravity: -0.3, drag: 0.4 });
  }
  // Chunks and dust from a broken wall panel, prop or piece of furniture.
  shatter(e) {
    // Glass: a spray of small bright shards and no dust.
    if (e.kind === 'glass') {
      for (let i = 0; i < (this.lite ? 8 : 22); i++)
        this.addDebris(
          { x: e.x + rand(-e.w / 2, e.w / 2), y: e.y + rand(-e.h / 2, e.h / 2), z: e.z + rand(-e.d / 2, e.d / 2) },
          { x: rand(-3, 3), y: rand(-0.5, 3), z: rand(-3, 3) },
          rand(0.8, 1.6),
          rand(0.04, 0.11),
          i % 2 ? 0xcfeefa : 0x9fd6e8,
        );
      return;
    }
    const size = Math.max(e.w, e.h, e.d),
      pieces = Math.min(this.lite ? 6 : 14, 4 + Math.ceil(size * 3));
    for (let i = 0; i < pieces; i++)
      this.addDebris(
        { x: e.x + rand(-e.w / 2, e.w / 2), y: e.y + rand(-e.h / 3, e.h / 3), z: e.z + rand(-e.d / 2, e.d / 2) },
        { x: rand(-4, 4), y: rand(1, 6), z: rand(-4, 4) },
        rand(1.4, 2.6),
        rand(0.08, 0.26),
        e.color ?? 0x9a8f80,
      );
    this.burst({ x: e.x, y: e.y, z: e.z }, 8, 0xb9ae9c, 1.6, 1.6, true, 1.4);
    // A tree's crown bursts into leafy blocks.
    if (e.kind === 'tree')
      for (let i = 0; i < (this.lite ? 10 : 30); i++)
        this.addDebris(
          { x: e.x + rand(-1.6, 1.6), y: e.y + rand(1.5, 3.8), z: e.z + rand(-1.6, 1.6) },
          { x: rand(-4, 4), y: rand(0, 4), z: rand(-4, 4) },
          rand(2, 3.5),
          rand(0.2, 0.45),
          i % 3 ? 0x6c9c6b : 0x487862,
        );
  }
  // A building coming down: a wide, slow dust cloud over its footprint.
  dust(e) {
    const n = this.lite ? 26 : 60;
    for (let i = 0; i < n; i++)
      this.emit(
        { x: e.x + rand(-e.w / 2, e.w / 2), y: (e.base || 0) + rand(0.3, 3), z: e.z + rand(-e.d / 2, e.d / 2) },
        { x: rand(-3, 3), y: rand(0.5, 2.5), z: rand(-3, 3) },
        i % 3 ? 0xc2b7a4 : 0x9d9383,
        rand(2.5, 4.5),
        rand(3, 5.5),
        { smoke: true, grow: 4, gravity: -0.15, drag: 0.6 },
      );
    for (let i = 0; i < (this.lite ? 10 : 24); i++)
      this.addDebris(
        { x: e.x + rand(-e.w / 2, e.w / 2), y: rand(2, e.height || 6), z: e.z + rand(-e.d / 2, e.d / 2) },
        { x: rand(-5, 5), y: rand(-2, 4), z: rand(-5, 5) },
        rand(1.5, 3),
        rand(0.15, 0.4),
        0x8f877a,
      );
  }
  // Soft chimney smoke drifting with the wind.
  chimney(x, y, z) {
    this.emit({ x: x + rand(-0.2, 0.2), y, z: z + rand(-0.2, 0.2) }, { x: rand(0.4, 0.9), y: rand(1.2, 1.8), z: rand(-0.2, 0.4) }, 0xd9d4ca, 1.2, 5, { smoke: true, grow: 3.5, gravity: -0.1, drag: 0.15 });
  }
  // Arrival: a rising column of light specks and a ring on the ground.
  spawn(e) {
    for (let i = 0; i < (this.lite ? 10 : 24); i++) {
      const a = rand(0, Math.PI * 2),
        r = rand(0.2, 0.7);
      this.emit({ x: e.x + Math.cos(a) * r, y: e.y + rand(0, 0.4), z: e.z + Math.sin(a) * r }, { x: 0, y: rand(2, 4.5), z: 0 }, 0x9ff0d8, rand(0.08, 0.16), rand(0.5, 0.9), { gravity: -1, drag: 1.4 });
    }
    this.burst({ x: e.x, y: e.y + 0.1, z: e.z }, 6, 0xd8f5ea, 0.8, 0.8, true, 1.2);
  }
  // Small puff when landing or sprinting on dirt.
  puff(x, y, z, big = false) {
    this.burst({ x, y: y + 0.08, z }, big ? 8 : 4, 0xcfc4ad, big ? 0.9 : 0.55, big ? 0.9 : 0.6, true, big ? 1.8 : 1);
  }
  // Jetpack exhaust from both nozzles behind the player.
  jet(p, dt) {
    const back = { x: -Math.sin(p.angle) * 0.3, z: -Math.cos(p.angle) * 0.3 },
      side = { x: Math.cos(p.angle) * 0.1, z: -Math.sin(p.angle) * 0.1 };
    this.jetClock = (this.jetClock || 0) + dt;
    if (this.jetClock < (this.lite ? 0.05 : 0.025)) return;
    this.jetClock = 0;
    for (const s of [-1, 1]) {
      const pos = { x: p.x + back.x + side.x * s, y: p.y + 0.95, z: p.z + back.z + side.z * s };
      this.emit(pos, { x: rand(-0.3, 0.3), y: -5, z: rand(-0.3, 0.3) }, 0xffb14a, 0.28, 0.16, { drag: 2 });
      this.emit(pos, { x: rand(-0.4, 0.4), y: -2, z: rand(-0.4, 0.4) }, 0xbfc3bb, 0.35, 0.6, {
        smoke: true,
        grow: 0.9,
      });
    }
  }
  // A flat shockwave ring on the ground, used by explosions, quakes and the cataclysm.
  groundRing(x, z, color = 0xffcc80, life = 0.45, grow = 6, peak = 0.55) {
    while (this.rings.length >= 10) {
      const r = this.rings.shift();
      r.mesh.removeFromParent();
      r.mesh.material.dispose();
    }
    const mesh = new T.Mesh(
      this.ringGeo,
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: peak,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, groundHeight(x, z, this.map) + 0.075, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, grow, peak });
  }
  event(e) {
    // TITAN GLOVES · QUAKE: the ground bursts and throws dirt outwards.
    if (e.type === 'quake') {
      const y = groundHeight(e.x, e.z, this.map);
      this.groundRing(e.x, e.z, 0xffb43c, 0.75, (e.r || 10) / 1.1, 0.7);
      this.burst({ x: e.x, y: y + 0.3, z: e.z }, 18, 0xc9a978, 0.6, 1.1, true, 4);
      for (let i = 0; i < (this.lite ? 6 : 18); i++) {
        const a = rand(0, Math.PI * 2),
          r = rand(1, e.r || 10);
        this.addDebris(
          { x: e.x + Math.cos(a) * r, y: y + 0.2, z: e.z + Math.sin(a) * r },
          { x: Math.cos(a) * rand(1, 4), y: rand(4, 9), z: Math.sin(a) * rand(1, 4) },
          rand(1, 2),
          rand(0.08, 0.2),
          0x8a7351,
        );
      }
      return;
    }
    // CHAOS SHARD: a seam of green light tears open along the ground ahead.
    if (e.type === 'rift') {
      const n = Math.min(16, Math.round((e.length || 20) / 3));
      for (let i = 1; i <= n; i++) {
        const d = (i / n) * (e.length || 20),
          x = e.x + Math.sin(e.angle) * d,
          z = e.z + Math.cos(e.angle) * d,
          y = groundHeight(x, z, this.map);
        this.emit({ x, y: y + 0.2, z }, { x: 0, y: rand(5, 11), z: 0 }, 0x38e0b0, rand(0.3, 0.7), rand(0.5, 1), { drag: 1.5, grow: 1.4 });
        if (i % 2 === 0) this.groundRing(x, z, 0x38e0b0, 0.5, 3.5, 0.5);
      }
      return;
    }
    // CATACLYSM: the sky goes green and the horizon lights up before the blasts arrive.
    if (e.type === 'cataclysm') {
      this.groundRing(e.x, e.z, 0x38e0b0, 1.6, (e.r || 60) / 1.05, 0.8);
      this.burst({ x: e.x, y: e.y + 1, z: e.z }, 26, 0x9ff0d8, 1.2, 1.6, false, 7);
      this.flashTime = 0.4;
      this.light.position.set(e.x, e.y + 3, e.z);
      return;
    }
    // A one-shot melee kill sparks gold.
    if (e.type === 'crit') {
      this.burst({ x: e.x, y: e.y, z: e.z }, 16, 0xffd06a, 0.16, 0.5, false, 5);
      this.burst({ x: e.x, y: e.y, z: e.z }, 6, 0xffffff, 0.3, 0.3, false, 2);
      return;
    }
    if (e.type === 'melee') {
      if (e.hit) this.burst({ x: e.x, y: e.y, z: e.z }, 6, 0xffe4b8, 0.1, 0.25, false, 2.2);
      else if (e.wall) {
        this.burst({ x: e.x, y: e.y, z: e.z }, 7, 0xffd38a, 0.08, 0.22, false, 2.6);
        this.burst({ x: e.x, y: e.y, z: e.z }, 4, 0xbfb5a3, 0.5, 0.9, true, 0.6);
      }
      return;
    }
    if (e.type === 'impact') {
      const pos = { x: e.x, y: e.y, z: e.z };
      this.burst(pos, e.hit ? 5 : 6, e.hit ? 0xf5d9ad : 0xd7b487, 0.09, 0.3, false, 2);
      if (!e.hit && e.impact) this.mark(pos, new T.Vector3(e.impact.x, e.impact.y, e.impact.z), 0.1);
      return;
    }
    if (e.type === 'explosion') {
      const pos = { x: e.x, y: Math.max(e.y, groundHeight(e.x, e.z, this.map) + 0.1), z: e.z };
      const k = Math.min(1.2, (e.radius || 6) / 6);
      this.burst(pos, 20, 0xffb245, 2.5 * k, 0.5, false, 5 * k);
      this.burst(pos, 24, 0xffdf8b, 0.17, 1.15, false, 9 * k);
      this.burst(pos, 20, 0x555b58, 2.7 * k, 2.1, true, 2.6 * k);
      for (let i = 0; i < (this.lite ? 5 : 12); i++)
        this.addDebris(
          pos,
          { x: rand(-8, 8), y: rand(3, 10), z: rand(-8, 8) },
          rand(1.2, 2.3),
          rand(0.05, 0.14),
          0x786957,
        );
      this.groundRing(e.x, e.z, 0xffcc80);
      this.light.position.copy(pos);
      this.flashTime = 0.22;
      return;
    }
    if (e.type !== 'shot') return;
    const start = new T.Vector3(e.x, e.y, e.z),
      end = new T.Vector3(e.ex, e.ey, e.ez),
      dir = end.clone().sub(start),
      distance = dir.length();
    dir.normalize();
    if (distance > 0.05)
      this.tracers[this.traceCursor++ % 128] = { start, end, dir, distance, age: 0, speed: e.weapon === 5 ? 420 : 270 };
    if ((e.pellet || 0) === 0) {
      const muzzle = start.clone().addScaledVector(dir, 0.7);
      this.burst(muzzle, 3, 0xffda8d, 0.35, 0.08, false, 0.3);
      this.addDebris(
        { x: e.x + 0.18, y: e.y - 0.12, z: e.z },
        { x: dir.z * 2.3, y: 2.2, z: -dir.x * 2.3 },
        0.9,
        0.045,
        0xd8a44c,
      );
    }
    if (e.impact) {
      const hit = { x: e.ex + e.impact.x * 0.02, y: e.ey + e.impact.y * 0.02, z: e.ez + e.impact.z * 0.02 },
        body = e.impact.kind === 'body',
        wood = e.impact.kind === 'wood';
      this.burst(hit, body ? 4 : 7, body ? 0xf5d9ad : wood ? 0xd7b487 : 0xffc375, 0.09, 0.3, false, 2.5);
      if (!body) {
        this.burst(hit, 3, wood ? 0x9f896b : 0x9c9f91, 0.4, 0.65, true, 0.5);
        // A couple of tiny cubes knocked off the surface.
        for (let i = 0; i < (this.lite ? 1 : 3); i++)
          this.addDebris(
            hit,
            { x: e.impact.x * rand(1.5, 3.5) + rand(-1.2, 1.2), y: e.impact.y * 2 + rand(0.5, 2.5), z: e.impact.z * rand(1.5, 3.5) + rand(-1.2, 1.2) },
            rand(0.9, 1.6),
            rand(0.04, 0.09),
            wood ? 0x9f7d56 : 0xa7a092,
          );
        this.mark(hit, new T.Vector3(e.impact.x, e.impact.y, e.impact.z), e.weapon === 1 ? 0.12 : 0.17);
      }
    }
  }
  rocketTrail(projectiles, dt) {
    const active = new Set();
    for (const r of projectiles) {
      active.add(r.id);
      let prev = this.rocketHistory.get(r.id);
      if (prev && dt > 0) {
        const distance = Math.hypot(r.x - prev.x, r.y - prev.y, r.z - prev.z),
          n = Math.min(this.lite ? 3 : 8, Math.max(1, Math.ceil(distance / 0.4)));
        for (let i = 0; i < n; i++) {
          const t = i / n,
            pos = { x: prev.x + (r.x - prev.x) * t, y: prev.y + (r.y - prev.y) * t, z: prev.z + (r.z - prev.z) * t };
          this.emit(pos, { x: -r.dx, y: 0.2 - r.dy, z: -r.dz }, 0xfbc17c, 0.34, 0.2, { grow: 0.7 });
          this.emit(pos, { x: 0, y: 0.4, z: 0 }, 0xadb2a6, 0.5, 0.7, { smoke: true, grow: 1.2 });
        }
      }
      this.rocketHistory.set(r.id, { x: r.x, y: r.y, z: r.z });
    }
    for (const id of this.rocketHistory.keys()) if (!active.has(id)) this.rocketHistory.delete(id);
  }
  resize(height, pixelRatio) {
    for (const p of this.pools) p.mesh.material.uniforms.scale.value = height * pixelRatio * 0.8;
    if (this.haze) this.haze.material.uniforms.scale.value = height * pixelRatio * 0.8;
  }
  update(dt) {
    this.clock += dt;
    if (this.haze) this.haze.material.uniforms.time.value = this.clock;
    for (const pool of this.pools) {
      const attrs = pool.mesh.geometry.attributes;
      for (let i = 0; i < pool.cap; i++) {
        const p = pool.items[i];
        if (!p) {
          attrs.size.array[i] = 0;
          attrs.opacity.array[i] = 0;
          continue;
        }
        p.life -= dt;
        if (p.life <= 0) {
          pool.items[i] = null;
          attrs.size.array[i] = 0;
          attrs.opacity.array[i] = 0;
          continue;
        }
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp;
        p.vz *= damp;
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        attrs.position.setXYZ(i, p.x, p.y, p.z);
        const t = p.life / p.maxLife;
        attrs.color.setXYZ(i, p.color.r, p.color.g, p.color.b);
        attrs.size.array[i] = p.size + (1 - t) * p.grow;
        attrs.opacity.array[i] = (pool.smoke ? 0.8 : 1) * Math.min(1, t * 2.5);
      }
      for (const a of Object.values(attrs)) a.needsUpdate = true;
    }
    const d = this.dummy;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      d.scale.setScalar(0);
      if (t) {
        t.age += dt;
        const head = Math.min(t.distance, t.age * t.speed),
          tail = Math.max(0, head - (t.distance < 6 ? 1.5 : 6));
        if (t.age > (t.distance + 6) / t.speed) {
          this.tracers[i] = null;
        } else {
          d.position.copy(t.start).addScaledVector(t.dir, (head + tail) / 2);
          d.quaternion.setFromUnitVectors(UP, t.dir);
          d.scale.set(0.016, Math.max(0.01, head - tail), 0.016);
        }
      }
      d.updateMatrix();
      this.tracerMesh.setMatrixAt(i, d.matrix);
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.debris.length; i++) {
      const p = this.debris[i];
      d.scale.setScalar(0);
      if (p) {
        p.life -= dt;
        if (p.life <= 0) this.debris[i] = null;
        else {
          p.vy -= 14 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          const floor = groundHeight(p.x, p.z, this.map) + p.size;
          if (p.y < floor) {
            p.y = floor;
            p.vy = Math.abs(p.vy) * 0.22;
            p.vx *= 0.6;
            p.vz *= 0.6;
          }
          p.rotation += p.spin * dt;
          d.position.set(p.x, p.y, p.z);
          d.rotation.set(p.rotation, p.rotation * 0.7, p.rotation * 0.3);
          d.scale.setScalar(p.size * Math.min(1, p.life * 4));
          this.debrisMesh.setColorAt(i, this.color.setHex(p.color).multiplyScalar(p.shade || 1));
        }
      }
      d.updateMatrix();
      this.debrisMesh.setMatrixAt(i, d.matrix);
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.marks.length; i++) {
      const p = this.marks[i];
      d.scale.setScalar(0);
      if (p) {
        p.life -= dt;
        if (p.life <= 0) this.marks[i] = null;
        else {
          d.position.set(p.x, p.y, p.z);
          d.quaternion.setFromUnitVectors(FRONT, p.normal);
          d.scale.setScalar(p.size * Math.min(1, p.life));
        }
      }
      d.updateMatrix();
      this.markMesh.setMatrixAt(i, d.matrix);
    }
    this.markMesh.instanceMatrix.needsUpdate = true;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.removeFromParent();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      } else {
        const max = r.max || 0.45;
        r.mesh.scale.setScalar(0.2 + (1 - r.life / max) * (r.grow || 6));
        r.mesh.material.opacity = (r.life / max) * (r.peak || 0.55);
      }
    }
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.light.intensity = this.lite ? 0 : (this.flashTime / 0.22) * 18;
  }
  dispose() {
    for (const p of this.pools) {
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    for (const m of [this.tracerMesh, this.debrisMesh, this.markMesh]) {
      m.removeFromParent();
      m.geometry.dispose();
      m.material.map?.dispose();
      m.material.dispose();
    }
    for (const r of this.rings) {
      r.mesh.removeFromParent();
      r.mesh.material.dispose();
    }
    this.ringGeo.dispose();
    this.light.removeFromParent();
    if (this.haze) {
      this.haze.removeFromParent();
      this.haze.geometry.dispose();
      this.haze.material.dispose();
    }
  }
}
