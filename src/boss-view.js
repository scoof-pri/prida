// Drawing for bosses, their shots and hazards, the telegraphs of their attacks, relics on the ground, portals and
// the battle bus. Boss bodies are game-authored creatures built in boss-models.js and animated procedurally: every
// move plays its own animation, timed from the same numbers the simulation uses (bosses.js MOVES).
import * as T from 'three';
import { BOSSES, RELICS, bossHeight } from './bosses.js';
import { buildBoss, poseBoss, bossRock, bossCrystal, bossHorn } from './boss-models.js';
import { groundHeight } from './terrain.js';
import { objectSurface } from './materials.js';

const SHOT_COLORS = {
  fireball: 0xff6a1a,
  psy: 0xc08cff,
  psyring: 0xd8a8ff,
  void: 0x7b4dff,
  boulder: 0x9b7f56,
  rock: 0xb08a5a,
  entropy: 0x38e0b0,
  ice: 0xa8ecff,
  web: 0xeef2e2,
};
const PORTAL_COLORS = { a: 0x2f9bff, b: 0xff8a1f };
const TELE_RED = new T.Color(0xff3a20);
const SPIKE_CAP = 160;
// A telegraph: a shape laid on the ground (following its slopes) that fills up until the attack lands.
const TELE_VERT = `attribute float aR;attribute float aS;varying float vR;varying float vS;
void main(){vR=aR;vS=aS;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const TELE_FRAG = `uniform vec3 color;uniform float progress;uniform float fade;uniform float line;uniform float time;
varying float vR;varying float vS;
void main(){
  float rim=line>0.5?max(smoothstep(0.8,0.96,abs(vS)),smoothstep(0.96,1.0,vR)):max(smoothstep(0.9,0.985,vR),smoothstep(0.86,0.98,abs(vS)));
  float fill=1.0-smoothstep(progress-0.02,progress,vR);
  float front=smoothstep(progress-0.06,progress,vR)*(1.0-smoothstep(progress,progress+0.02,vR));
  float pulse=0.75+0.25*sin(time*14.0);
  float a=(0.1+rim*0.75*pulse+fill*0.26+front*0.6)*fade;
  gl_FragColor=vec4(color*(1.0+rim*0.6+front),a);
}`;
// Venom pools and gravity wells: animated discs on the ground.
const POOL_FRAG = `uniform vec3 color;uniform float time;uniform float fade;uniform float swirl;varying float vR;varying float vS;varying vec2 vP;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
  float edge=1.0-smoothstep(0.8,1.0,vR);
  float a;vec3 c=color;
  if(swirl>0.5){float ang=atan(vP.y,vP.x);float arms=0.5+0.5*sin(ang*3.0+vR*14.0-time*7.0);a=edge*(0.25+0.55*arms*(1.0-vR*0.5));c=mix(color,vec3(0.02,0.0,0.06),smoothstep(0.35,0.0,vR));a=max(a,smoothstep(0.3,0.0,vR)*0.95);}
  else{float b=n(vP*1.6+vec2(time*0.3,-time*0.2));float s=smoothstep(0.62,0.7,n(vP*3.0-vec2(time*0.5)));a=edge*(0.45+0.3*b)+s*0.3*edge;c=color*(0.55+0.6*b)+s*0.4;}
  gl_FragColor=vec4(c,a*fade);
}`;
const POOL_VERT = `attribute float aR;attribute float aS;attribute vec2 aP;varying float vR;varying float vS;varying vec2 vP;
void main(){vR=aR;vS=aS;vP=aP;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

// A ground-hugging shape as geometry in world space: circle (rings × segments), line (length × width) or cone.
function groundShape(map, s, lift = 0.07) {
  const pos = [],
    aR = [],
    aS = [],
    aP = [],
    index = [];
  let rows, cols;
  const at = (x, z, r, side) => {
    pos.push(x, groundHeight(x, z, map) + lift, z);
    aR.push(r);
    aS.push(side);
    aP.push(x - s.x, z - s.z);
  };
  if (s.shape === 'line') {
    rows = 18;
    cols = 3;
    const dx = Math.sin(s.angle),
      dz = Math.cos(s.angle);
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const t = i / rows,
          u = (j / cols) * 2 - 1;
        at(s.x + dx * t * s.len + dz * u * s.w * 0.5, s.z + dz * t * s.len - dx * u * s.w * 0.5, t, u);
      }
  } else {
    const cone = s.shape === 'cone',
      arc = cone ? s.arc : Math.PI * 2;
    rows = Math.max(4, Math.min(10, Math.round(s.r * 1.2)));
    cols = cone ? 14 : 44;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const t = i / rows,
          a = (cone ? s.angle : 0) - arc / 2 + (j / cols) * arc,
          r = Math.max(0.001, t) * s.r;
        at(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r, t, cone ? (j / cols) * 2 - 1 : 0);
      }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('aR', new T.Float32BufferAttribute(aR, 1));
  g.setAttribute('aS', new T.Float32BufferAttribute(aS, 1));
  g.setAttribute('aP', new T.Float32BufferAttribute(aP, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

// Bench seats in the bus, in its own frame (x across, z forward, floor at 0): riders are drawn sitting there.
export const BUS_SEATS = [];
for (let row = 0; row < 5; row++) for (const side of [-1, 1]) BUS_SEATS.push({ x: side * 0.82, z: 2.7 - row * 1.35 });
// A soft cloud puff: overlapping radial blobs on a transparent canvas, drawn once.
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) {
    const px = 40 + rnd() * 176,
      py = 50 + rnd() * 40 - Math.abs(px - 128) * 0.12,
      r = 18 + rnd() * 34,
      g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 128);
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
export class BossViews {
  constructor(view) {
    this.view = view;
    this.scene = view.scene;
    this.root = new T.Group();
    this.scene.add(this.root);
    this.bosses = new Map();
    this.shots = new Map();
    this.rings = new Map();
    this.drops = new Map();
    this.ice = new Map();
    this.webs = new Map();
    this.teles = [];
    this.meteors = [];
    this.portalMeshes = new Map();
    this.clock = 0;
    this.v3 = new T.Vector3();
    this.q = new T.Quaternion();
    this.shotGeo = new T.IcosahedronGeometry(0.32, 1);
    this.rockGeo = bossRock(0.42, { seed: 3 });
    this.iceShotGeo = bossCrystal(0.12, 0.8).rotateX(Math.PI / 2);
    this.flameGeo = new T.ConeGeometry(0.35, 1.3, 5);
    this.iceGeo = new T.BoxGeometry(1.1, 2.1, 1.1);
    this.iceMat = new T.MeshStandardMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.45, roughness: 0.1, emissive: 0x3aa6d8, emissiveIntensity: 0.3 });
    this.webGeo = new T.IcosahedronGeometry(0.8, 1);
    this.webMat = new T.MeshBasicMaterial({ color: 0xeef2e2, wireframe: true, transparent: true, opacity: 0.55 });
    this.shotMats = Object.fromEntries(
      Object.entries(SHOT_COLORS).map(([k, c]) => [k, new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, fog: false })]),
    );
    this.rockMat = new T.MeshStandardMaterial({ color: 0x8a7658, roughness: 1, flatShading: true });
    this.flameMat = new T.MeshBasicMaterial({ color: 0xff7a22, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending });
    this.meteorGeo = new T.IcosahedronGeometry(0.7, 1);
    this.meteorMat = new T.MeshBasicMaterial({ color: 0xffa040, fog: false });
    this.moundGeo = bossRock(1.1, { seed: 5, rough: 0.3, squash: [1.2, 0.3, 1.2] });
    this.moundMat = new T.MeshStandardMaterial({ color: 0x7a6650, roughness: 1, flatShading: true });
    this.makeSpikes();
    this.portalTarget = null;
  }
  // Spikes (the earth spine and the wyrm): instanced cones that burst up, stand for a moment and sink back.
  makeSpikes() {
    const geo = new T.ConeGeometry(0.26, 1.7, 5).translate(0, 0.85, 0);
    this.spikes = {};
    for (const [kind, mat] of [
      ['ice', new T.MeshStandardMaterial({ color: 0xcdf1ff, roughness: 0.12, metalness: 0.2, emissive: 0x4ab6e8, emissiveIntensity: 0.45, flatShading: true })],
      ['earth', new T.MeshStandardMaterial({ color: 0x8a7254, roughness: 1, flatShading: true })],
    ]) {
      const mesh = new T.InstancedMesh(geo, mat, SPIKE_CAP);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(mesh);
      this.spikes[kind] = { mesh, list: [] };
    }
    this.dummy = new T.Object3D();
  }
  // One boss body: the creature, its flames, a dirt mound for when it burrows, and the name and health bar.
  makeBoss(b) {
    const v = buildBoss(b.kind),
      root = v.root;
    if (v.flames)
      for (const [x, y, z, s] of v.flames) {
        // In the body's own units: the rig's scale sizes them with the creature.
        const f = new T.Mesh(this.flameGeo, this.flameMat);
        f.position.set(x, y, z);
        f.scale.setScalar(s);
        f.userData.flame = s;
        v.rig.add(f);
      }
    // Name and health bar above the head.
    const bar = new T.Group(),
      label = this.view.text(b.name, 4.2, 0.5, '#fff1d6', '#2b1f2e'),
      back = new T.Mesh(new T.PlaneGeometry(3.2, 0.2), new T.MeshBasicMaterial({ color: 0x1a1414 })),
      fill = new T.Mesh(new T.PlaneGeometry(3.2, 0.2), new T.MeshBasicMaterial({ color: BOSSES[b.kind].color }));
    label.position.y = 0.4;
    fill.position.z = 0.01;
    bar.add(label, back, fill);
    bar.position.y = bossHeight(b.kind) + 0.8;
    root.add(bar);
    let mound = null;
    if (v.wyrm) {
      mound = new T.Mesh(this.moundGeo, this.moundMat);
      mound.visible = false;
      this.root.add(mound);
    }
    this.root.add(root);
    for (const m of v.meshes) if (m.material.emissive) m.material.userData.base ??= m.material.emissiveIntensity;
    return { ...v, bar, fill, mound, state: { name: 'idle', time: 0, seq: -1 }, hitFlash: 0, lastHit: b.hitAt, dust: 0 };
  }
  // Boss events: telegraphs, spikes and the one-off effects of each move.
  event(e) {
    const fx = this.view.fx,
      map = this.view.map;
    if (!fx || !map) return;
    const color = BOSSES[e.kind]?.color ?? 0xff5a3a;
    switch (e.type) {
      case 'boss-tele':
        this.addTele(e, color);
        break;
      case 'spike':
        this.addSpikes(e);
        fx.burst({ x: e.x, y: e.y + 0.3, z: e.z }, 4, e.kind === 'ice' ? 0xdff6ff : 0xa89272, 0.7, 0.8, true, 1.4);
        break;
      case 'boss-cast':
        fx.burst({ x: e.x, y: e.y, z: e.z }, 8, SHOT_COLORS[e.kind] ?? color, 0.16, 0.35, false, 2.5);
        break;
      case 'boss-impact':
        fx.burst({ x: e.x, y: e.y, z: e.z }, e.hit ? 10 : 6, SHOT_COLORS[e.kind] ?? 0xffffff, 0.14, 0.4, false, 3);
        if (e.kind === 'web') fx.burst({ x: e.x, y: e.y, z: e.z }, 5, 0xeef2e2, 0.5, 0.9, true, 1);
        break;
      case 'boss-slam':
      case 'boss-land':
      case 'emerge':
      case 'boss-sweep': {
        const y = groundHeight(e.x, e.z, map),
          big = e.type !== 'boss-slam' || e.move === 'charge' || e.move === 'smash';
        fx.groundRing(e.x, e.z, e.type === 'emerge' ? 0xd8a060 : 0xe8d0a0, 0.55, (e.r || 3.5) * 1.1, 0.5);
        fx.burst({ x: e.x, y: y + 0.3, z: e.z }, big ? 16 : 8, 0xbfae8e, big ? 1.3 : 0.8, 1.4, true, big ? 3.2 : 2);
        for (let i = 0; i < (e.type === 'emerge' ? 26 : big ? 12 : 5); i++) {
          const a = Math.random() * Math.PI * 2,
            s = 2 + Math.random() * 5;
          fx.addDebris({ x: e.x + Math.cos(a) * 0.6, y: y + 0.3, z: e.z + Math.sin(a) * 0.6 }, { x: Math.cos(a) * s, y: 3 + Math.random() * (e.type === 'emerge' ? 9 : 5), z: Math.sin(a) * s }, 1.4 + Math.random(), 0.1 + Math.random() * 0.2, 0x8a7458);
        }
        break;
      }
      case 'burrow':
      case 'boss-leap':
        fx.burst({ x: e.x, y: e.y + 0.3, z: e.z }, 12, 0xbfae8e, 1.1, 1.2, true, 2.5);
        break;
      case 'frost-nova': {
        fx.groundRing(e.x, e.z, 0xa8ecff, 0.8, (e.r || 7) / 1.05, 0.75);
        fx.burst({ x: e.x, y: e.y + 1, z: e.z }, 26, 0xdff6ff, 0.22, 0.9, false, 7);
        fx.burst({ x: e.x, y: e.y + 0.6, z: e.z }, 14, 0xeaf8ff, 1.6, 1.6, true, 3);
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          fx.addDebris({ x: e.x, y: e.y + 1, z: e.z }, { x: Math.cos(a) * 8, y: 2 + Math.random() * 3, z: Math.sin(a) * 8 }, 1 + Math.random(), 0.06 + Math.random() * 0.08, 0xcdf1ff);
        }
        break;
      }
      case 'implode':
        fx.groundRing(e.x, e.z, 0x9a70ff, 0.45, 0.5, 0.9);
        fx.burst({ x: e.x, y: e.y + 1, z: e.z }, 30, 0xb89aff, 0.2, 0.6, false, 7);
        fx.burst({ x: e.x, y: e.y + 0.8, z: e.z }, 10, 0x2a1450, 1.8, 1.4, true, 2);
        break;
      case 'boss-nova':
        fx.burst({ x: e.x, y: e.y, z: e.z }, 24, 0xe0c4ff, 0.2, 0.5, false, 6);
        break;
      case 'venom': {
        // A spray arcing from the fangs (or the relic) to the pool.
        for (let i = 0; i < 14; i++) {
          const t = i / 14,
            x = e.fx + (e.x - e.fx) * t,
            z = e.fz + (e.z - e.fz) * t,
            y = e.fy + (e.y - e.fy) * t + Math.sin(t * Math.PI) * 1.5;
          fx.emit({ x, y, z }, { x: (Math.random() - 0.5) * 0.6, y: -1, z: (Math.random() - 0.5) * 0.6 }, 0x9bd84a, 0.22, 0.4 + t * 0.4, { gravity: 4, drag: 1 });
        }
        fx.burst({ x: e.x, y: e.y + 0.2, z: e.z }, 10, 0x7bc03a, 0.9, 1.2, true, 1.5);
        break;
      }
      case 'pounce':
        fx.puff(e.x, e.y, e.z, true);
        break;
      case 'boss-spawn':
        fx.burst({ x: e.x, y: e.y + 1.5, z: e.z }, 20, 0xffffff, 0.2, 0.8, false, 4);
        break;
    }
  }
  // Telegraph and pool materials are kept and reused: disposing the last one would drop its shader program, and
  // the next telegraph would stall the frame compiling it again.
  teleMaterial() {
    return (
      this.teleMats?.pop() ||
      new T.ShaderMaterial({
        uniforms: { color: { value: new T.Color() }, progress: { value: 0 }, fade: { value: 0 }, line: { value: 0 }, time: { value: 0 } },
        vertexShader: TELE_VERT,
        fragmentShader: TELE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        toneMapped: false,
      })
    );
  }
  poolMaterial() {
    return (
      this.poolMats?.pop() ||
      new T.ShaderMaterial({
        uniforms: { color: { value: new T.Color() }, time: { value: 0 }, fade: { value: 0 }, swirl: { value: 0 } },
        vertexShader: POOL_VERT,
        fragmentShader: POOL_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
  }
  // Everything a boss fight can put on screen, built once so the loading screen compiles its shaders: one body of
  // each boss, a telegraph, a venom pool, spikes. Returns a function that takes it all away again (the materials,
  // and so the compiled programs, stay).
  warmup() {
    const map = this.view.map,
      parts = [];
    for (const kind of Object.keys(BOSSES)) {
      const v = buildBoss(kind);
      v.root.position.set(0, -50, 0);
      this.root.add(v.root);
      parts.push(v.root);
    }
    const tele = new T.Mesh(groundShape(map, { shape: 'circle', x: 0, z: 0, r: 2 }), this.teleMaterial()),
      pool = new T.Mesh(groundShape(map, { shape: 'circle', x: 0, z: 0, r: 2 }), this.poolMaterial());
    this.root.add(tele, pool);
    for (const s of Object.values(this.spikes)) s.mesh.count = 1;
    return () => {
      for (const r of parts) r.removeFromParent();
      for (const m of [tele, pool]) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      (this.teleMats ||= []).push(tele.material);
      (this.poolMats ||= []).push(pool.material);
      for (const s of Object.values(this.spikes)) s.mesh.count = 0;
    };
  }
  addTele(e, color) {
    const map = this.view.map,
      geo = groundShape(map, e),
      mat = this.teleMaterial(),
      mesh = new T.Mesh(geo, mat);
    mat.uniforms.color.value.set(color).lerp(TELE_RED, 0.35);
    mat.uniforms.progress.value = mat.uniforms.fade.value = 0;
    mat.uniforms.line.value = e.shape === 'line' ? 1 : 0;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.teles.push({ mesh, t: 0, time: Math.max(0.2, e.time || 0.6) });
    if (e.meteor) {
      const m = new T.Mesh(this.meteorGeo, this.meteorMat);
      this.root.add(m);
      const y = groundHeight(e.x, e.z, map);
      this.meteors.push({ mesh: m, from: new T.Vector3(e.x + 9, y + 42, e.z - 7), to: new T.Vector3(e.x, y + 0.5, e.z), t: 0, time: e.time, clock: 0 });
    }
  }
  addSpikes(e) {
    const pool = this.spikes[e.kind === 'ice' ? 'ice' : 'earth'];
    for (let i = 0; i < 3; i++) {
      if (pool.list.length >= SPIKE_CAP) pool.list.shift();
      const a = Math.random() * Math.PI * 2,
        r = i ? 0.4 + Math.random() * (e.r || 1.5) * 0.6 : 0;
      pool.list.push({
        x: e.x + Math.cos(a) * r,
        y: e.y - 0.05,
        z: e.z + Math.sin(a) * r,
        s: (i ? 0.6 + Math.random() * 0.4 : 1.1) * (e.kind === 'ice' ? 1 : 1.15),
        tx: (Math.random() - 0.5) * 0.5,
        tz: (Math.random() - 0.5) * 0.5,
        yaw: Math.random() * 6,
        t: 0,
      });
    }
  }
  update(state, dt, camera, localId) {
    this.clock += dt;
    const seen = new Set(),
      fx = this.view.fx;
    for (const b of state.bosses || []) {
      seen.add(b.id);
      let v = this.bosses.get(b.id);
      if (!v) {
        v = this.makeBoss(b);
        if (!v) continue;
        this.bosses.set(b.id, v);
        v.root.position.set(b.x, b.y, b.z);
      }
      const dead = b.hp <= 0;
      v.root.visible = !dead || (v.deadFor || 0) < 6;
      v.deadFor = dead ? (v.deadFor || 0) + dt : 0;
      const bob = 0;
      v.root.position.lerp(this.v3.set(b.x, b.y + bob, b.z), Math.min(1, dt * 12));
      if (Math.hypot(v.root.position.x - b.x, v.root.position.z - b.z) > 4) v.root.position.set(b.x, b.y, b.z);
      v.root.rotation.y = b.angle;
      let anim = dead ? 'death' : b.anim;
      if (anim === 'walk' && !v.walker && !v.wyrm) anim = 'idle';
      // A new move (or the same move again) restarts its animation.
      if (anim !== v.state.name || (b.seq !== undefined && b.seq !== v.state.seq && !dead)) v.state = { name: anim, time: 0, seq: b.seq };
      // Frozen bosses move in slow motion.
      v.state.time += dt * (b.frozen > 0 ? 0.3 : 1);
      poseBoss(v, anim, this.clock * (b.frozen > 0 ? 0.3 : 1), v.state);
      // A burrowed wyrm: only a travelling mound of earth and dust shows where it is.
      if (v.mound) {
        v.mound.visible = !!b.under;
        if (b.under) {
          v.mound.position.set(b.x, groundHeight(b.x, b.z, this.view.map) + 0.05, b.z);
          v.mound.rotation.y += dt * 2;
          v.dust += dt;
          if (v.dust > 0.07 && fx) {
            v.dust = 0;
            fx.emit({ x: b.x + (Math.random() - 0.5) * 1.6, y: v.mound.position.y + 0.3, z: b.z + (Math.random() - 0.5) * 1.6 }, { x: (Math.random() - 0.5) * 2, y: 1.5 + Math.random(), z: (Math.random() - 0.5) * 2 }, 0xa89272, 0.9, 1.1, { smoke: true, grow: 1.4 });
          }
        }
      }
      // Close up the HUD shows the boss bar; the floating one is for bosses in the distance.
      v.bar.visible = !dead && !b.under && camera.position.distanceTo(v.root.position) > 30;
      v.bar.quaternion.copy(camera.quaternion);
      v.bar.quaternion.premultiply(this.q.copy(v.root.quaternion).invert());
      const f = Math.max(0.001, b.hp / b.maxHp);
      v.fill.scale.x = f;
      v.fill.position.x = -1.6 * (1 - f);
      if (b.hitAt !== v.lastHit) {
        v.lastHit = b.hitAt;
        v.hitFlash = 0.12;
      }
      v.hitFlash = Math.max(0, v.hitFlash - dt);
      // Seams glow brighter on a hit, while casting, when frozen and in a rage (below 40 % health, pulsing).
      const rage = b.rage && !dead ? 0.35 + Math.sin(this.clock * 6) * 0.2 : 0,
        boost = (v.hitFlash > 0 ? 0.8 : 0) + (b.frozen > 0 ? 0.4 : 0) + Math.min(0.3, (v.glowBoost || 0) * 0.15) + rage * 0.5;
      for (const o of v.meshes) {
        const m = o.material;
        if (m.emissive && m.userData.base !== undefined) m.emissiveIntensity = m.userData.base + boost;
      }
      for (const f2 of v.rig.children)
        if (f2.userData.flame) f2.scale.y = f2.userData.flame * (0.8 + Math.sin(this.clock * 17 + f2.id) * 0.25) * (1 + (v.flameBoost || 0) * 0.5 + rage);
      // Ambient particles: embers off the golem, spores off the brood mother.
      v.puff = (v.puff || 0) + dt;
      if (fx && !dead && !b.under && v.puff > (fx.lite ? 0.3 : 0.12) && camera.position.distanceTo(v.root.position) < 60) {
        v.puff = 0;
        const h = bossHeight(b.kind),
          at = { x: b.x + (Math.random() - 0.5) * 1.2, y: b.y + h * (0.3 + Math.random() * 0.6), z: b.z + (Math.random() - 0.5) * 1.2 };
        if (b.kind === 'fire') fx.emit(at, { x: 0, y: 1.2, z: 0 }, Math.random() < 0.5 ? 0xff8a2a : 0xffc14a, 0.12, 0.9, { gravity: -1, drag: 1 });
        else if (b.kind === 'void')
          fx.emit(at, { x: 0, y: 0.6, z: 0 }, BOSSES[b.kind].color, 0.08, 0.8, { drag: 1.2 });
      }
    }
    for (const [id, v] of this.bosses)
      if (!seen.has(id)) {
        this.root.remove(v.root);
        if (v.mound) this.root.remove(v.mound);
        this.bosses.delete(id);
      }
    this.updateShots(state, dt);
    this.updateRings(state, dt);
    this.updateTeles(dt);
    this.updateSpikes(dt);
    this.updateDrops(state);
    this.updateIce(state, localId);
    this.updatePortals(state, camera);
    this.updateBus(state, dt);
  }
  updateTeles(dt) {
    for (let i = this.teles.length - 1; i >= 0; i--) {
      const t = this.teles[i],
        u = t.mesh.material.uniforms;
      t.t += dt;
      const k = t.t / t.time;
      u.progress.value = Math.min(1.02, k);
      u.time.value = this.clock;
      // Fade in fast, flash when the attack lands, then fade out.
      u.fade.value = k < 1 ? Math.min(1, t.t / 0.12) : Math.max(0, 1.6 - (k - 1) * (t.time / 0.3) * 1.6);
      if (k > 1 && u.fade.value <= 0) {
        t.mesh.removeFromParent();
        t.mesh.geometry.dispose();
        (this.teleMats ||= []).push(t.mesh.material);
        this.teles.splice(i, 1);
      }
    }
    const fx = this.view.fx;
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      // The meteor appears high up for the last 0.9 s of the warning and lands as it ends.
      const k = (m.t - Math.max(0, m.time - 0.9)) / Math.min(0.9, m.time);
      m.mesh.visible = k > 0;
      if (k > 0) {
        m.mesh.position.lerpVectors(m.from, m.to, Math.min(1, k * k));
        m.mesh.rotation.x += dt * 6;
        m.clock += dt;
        if (fx && m.clock > 0.02) {
          m.clock = 0;
          fx.emit(m.mesh.position, { x: 0, y: 0.5, z: 0 }, 0xffb050, 0.9, 0.35, { grow: 1 });
          fx.emit(m.mesh.position, { x: 0, y: 0.3, z: 0 }, 0x4a403a, 1.2, 1.4, { smoke: true, grow: 2 });
        }
      }
      if (k >= 1) {
        m.mesh.removeFromParent();
        this.meteors.splice(i, 1);
      }
    }
  }
  updateSpikes(dt) {
    const d = this.dummy;
    for (const pool of Object.values(this.spikes)) {
      let n = 0;
      for (let i = pool.list.length - 1; i >= 0; i--) {
        const s = pool.list[i];
        s.t += dt;
        if (s.t > 1.9) pool.list.splice(i, 1);
      }
      for (const s of pool.list) {
        // Burst up in a tenth of a second, stand, then sink back into the ground.
        const up = Math.min(1, s.t / 0.1),
          down = Math.max(0, (s.t - 1.3) / 0.6),
          h = up * (1 - down);
        d.position.set(s.x, s.y - (1 - h) * 1.7 * s.s, s.z);
        d.rotation.set(s.tx, s.yaw, s.tz);
        d.scale.set(s.s, s.s * (0.4 + 0.6 * up), s.s);
        d.updateMatrix();
        pool.mesh.setMatrixAt(n++, d.matrix);
      }
      pool.mesh.count = n;
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  // The battle bus: a blue coach hanging under a striped balloon, open windows so riders can look out. Its rear
  // hatch swings open whenever someone jumps, and the propellers and balloon keep moving.
  makeBus() {
    const g = new T.Group(),
      // Closed boxes: front faces only. Glossy paint, chrome trim and reflective glass under the sky light.
      // Object-space surfaces (materials.js): scratched paint, polished trim, worn dark metal, a ribbed floor.
      paint = objectSurface(new T.MeshStandardMaterial({ color: 0x2a62bd, roughness: 0.36, metalness: 0.1, envMapIntensity: 1.1 }), { surface: 'steel', size: 1.2, strength: 0.35, normal: 0.5, grime: [-0.2, 0.9, 0.35] }),
      trim = objectSurface(new T.MeshStandardMaterial({ color: 0xe4e4dc, roughness: 0.22, metalness: 0.85, envMapIntensity: 1.1 }), { surface: 'steel', size: 0.8, strength: 0.3, normal: 0.4 }),
      dark = objectSurface(new T.MeshStandardMaterial({ color: 0x23282d, roughness: 0.7, metalness: 0.3 }), { surface: 'worn', size: 0.8, strength: 0.6, normal: 0.8 }),
      glass = new T.MeshStandardMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.18, roughness: 0.03, envMapIntensity: 1.6, depthWrite: false }),
      box = (w, h, d, m, x, y, z, parent = g) => {
        const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
      };
    const L = 9,
      W = 2.8;
    box(W, 0.2, L, objectSurface(new T.MeshStandardMaterial({ color: 0x6d757c, roughness: 0.6, metalness: 0.5 }), { surface: 'corrugated', size: 0.9, strength: 0.6, normal: 1 }), 0, -0.1, 0); // floor
    box(W, 0.18, L, trim, 0, 2.6, 0); // roof
    for (const s of [-1, 1]) {
      box(0.1, 1.05, L, paint, (s * W) / 2, 0.52, 0); // below the windows
      box(0.1, 0.35, L, paint, (s * W) / 2, 2.35, 0); // above them
      for (let z = -L / 2; z <= L / 2 + 0.01; z += 1.5) box(0.12, 1.2, 0.18, paint, (s * W) / 2, 1.6, z);
      box(0.04, 1.15, L, glass, (s * W) / 2, 1.6, 0);
    }
    box(W, 1.05, 0.1, paint, 0, 0.52, L / 2); // front
    box(W, 0.35, 0.1, paint, 0, 2.35, L / 2);
    box(W, 1.15, 0.04, glass, 0, 1.6, L / 2);
    // Rear hatch: hinged at the bottom, it drops open like a ramp when someone jumps.
    const hatch = new T.Group();
    hatch.position.set(0, 0, -L / 2);
    g.add(hatch);
    box(W, 2.6, 0.1, paint, 0, 1.3, 0, hatch);
    box(W * 0.7, 0.9, 0.06, glass, 0, 1.75, -0.06, hatch);
    box(0.5, 0.12, 0.08, trim, 0, 0.9, -0.08, hatch);
    for (const s of [-1, 1]) box(0.06, 0.2, L + 0.05, trim, s * (W / 2 + 0.05), 1.0, 0); // stripe
    const wheel = new T.CylinderGeometry(0.5, 0.5, 0.35, 12);
    for (const x of [-1.35, 1.35])
      for (const z of [-3, 3]) {
        const w = new T.Mesh(wheel, dark);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, -0.62, z);
        g.add(w);
      }
    // Balloon with alternating stripes, tied to the roof corners.
    const balloon = new T.Group(),
      colors = [0xd8413a, 0xf3ead6],
      // Canvas stripes with a woven grain.
      stripes = colors.map((color) =>
        objectSurface(new T.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true }), { surface: 'fabric', size: 1.6, strength: 0.6, normal: 0.8 }),
      );
    for (let i = 0; i < 12; i++) {
      const seg = new T.Mesh(
        new T.SphereGeometry(4.8, 6, 12, (i / 12) * Math.PI * 2, Math.PI / 6),
        stripes[i % 2],
      );
      seg.scale.y = 1.15;
      balloon.add(seg);
    }
    balloon.position.y = 11;
    g.add(balloon);
    const rope = new T.MeshBasicMaterial({ color: 0x3b3128 });
    for (const x of [-1.2, 1.2])
      for (const z of [-4, 4]) {
        const from = new T.Vector3(x, 2.7, z),
          to = new T.Vector3(x * 1.4, 6.8, z * 0.45),
          mid = from.clone().add(to).multiplyScalar(0.5),
          r = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, from.distanceTo(to), 4), rope);
        r.position.copy(mid);
        r.lookAt(to);
        r.rotateX(Math.PI / 2);
        g.add(r);
      }
    // Two propellers behind, spinning.
    const props = [];
    for (const s of [-1, 1]) {
      const hub = new T.Group();
      hub.position.set(s * 1.1, 1.3, -L / 2 - 0.35);
      for (let k = 0; k < 3; k++) {
        const blade = box(0.14, 0.9, 0.04, dark, 0, 0.45, 0, new T.Group());
        blade.parent.rotation.z = (k / 3) * Math.PI * 2;
        hub.add(blade.parent);
      }
      box(0.18, 0.18, 0.3, trim, 0, 0, 0.1, hub);
      g.add(hub);
      props.push(hub);
    }
    // Inside (0.27): two rows of padded benches either side of the aisle, grab poles, luggage racks, a strip of
    // warm ceiling lights, the driver's cab with a wheel and a lit dashboard, and a red jump light over the hatch.
    const seatMat = objectSurface(new T.MeshStandardMaterial({ color: 0x3c5a78, roughness: 0.85 }), { surface: 'fabric', size: 0.35, strength: 0.7, normal: 1 }),
      frame = trim,
      lamp = new T.MeshBasicMaterial({ color: new T.Color(1.4, 1.2, 0.85), toneMapped: false }),
      jumpLamp = new T.MeshBasicMaterial({ color: new T.Color(2.2, 0.3, 0.2), toneMapped: false }),
      seats = [];
    for (let row = 0; row < 5; row++) {
      const z = 2.7 - row * 1.35;
      for (const side of [-1, 1]) {
        const x = side * 0.82;
        box(0.95, 0.12, 0.55, seatMat, x, 0.46, z); // cushion
        box(0.95, 0.62, 0.1, seatMat, x, 0.82, z - 0.3); // backrest
        box(0.08, 0.42, 0.08, frame, x - side * 0.3, 0.21, z); // leg
        box(0.95, 0.05, 0.05, frame, x, 1.14, z - 0.32); // grab rail on the back
        seats.push({ x, z, y: 0.46 });
      }
      box(0.05, 2.5, 0.05, frame, 0.42, 1.25, z - 0.62); // pole by the aisle
    }
    for (const side of [-1, 1]) box(0.5, 0.05, L - 1.2, frame, side * 1.05, 2.12, -0.3); // luggage racks
    for (let z = -3.4; z <= 3.4; z += 1.7) box(0.5, 0.03, 0.9, lamp, 0, 2.5, z); // ceiling lights
    box(W - 0.2, 0.9, 0.5, dark, 0, 0.45, L / 2 - 0.35); // dashboard
    box(1.4, 0.08, 0.3, lamp, 0.4, 0.92, L / 2 - 0.42); // its instruments
    const wheelMesh = new T.Mesh(new T.TorusGeometry(0.2, 0.03, 6, 16), dark);
    wheelMesh.position.set(-0.7, 1.05, L / 2 - 0.8);
    wheelMesh.rotation.x = -0.5;
    g.add(wheelMesh);
    const jump = box(0.5, 0.12, 0.06, jumpLamp, 0, 2.3, -L / 2 + 0.12);
    // Headlights and tail lights.
    for (const s of [-1, 1]) {
      box(0.34, 0.2, 0.06, lamp, s * 1.05, 0.55, L / 2 + 0.04);
      box(0.3, 0.16, 0.06, jumpLamp, s * 1.1, 0.5, -L / 2 - 0.08);
    }
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    g.userData = { hatch, balloon, props, open: 0, seats, jump };
    this.root.add(g);
    return g;
  }
  updateBus(state, dt) {
    const b = state.bus;
    if (!b?.active) {
      if (this.bus) this.bus.visible = false;
      if (this.clouds) this.clouds.visible = false;
      return;
    }
    this.bus ||= this.makeBus();
    this.bus.visible = true;
    const target = this.v3.set(b.x, b.y, b.z);
    if (this.bus.position.distanceTo(target) > 20) this.bus.position.copy(target);
    else this.bus.position.lerp(target, Math.min(1, dt * 10));
    this.bus.rotation.y = Math.atan2(b.bx - b.ax, b.bz - b.az);
    this.bus.rotation.z = Math.sin(this.clock * 0.9) * 0.03;
    this.bus.rotation.x = Math.sin(this.clock * 0.6) * 0.015;
    const u = this.bus.userData;
    // The jump light blinks while the doors are open for jumping.
    u.jump.visible = Math.sin(this.clock * 6) > 0;
    this.updateClouds(b, dt);
    u.balloon.rotation.y = Math.sin(this.clock * 0.3) * 0.08;
    for (const p of u.props) p.rotation.z += dt * 22;
    // The hatch drops open for a moment after each jump.
    u.open = Math.max(0, u.open - dt * 0.8);
    u.hatch.rotation.x = -Math.min(1, u.open * 2) * 1.35;
  }
  // Clouds at the bus's height along its route: they sail past the windows and give the flight its speed. Soft
  // sprites, made once per route.
  updateClouds(b, dt) {
    const key = [b.ax, b.az, b.bx, b.bz, b.y].map((v) => Math.round(v)).join(':');
    if (this.cloudKey !== key) {
      this.cloudKey = key;
      this.clouds?.removeFromParent();
      this.cloudTex ??= cloudTexture();
      const group = new T.Group(),
        dx = b.bx - b.ax,
        dz = b.bz - b.az,
        len = Math.hypot(dx, dz) || 1,
        nx = -dz / len,
        nz = dx / len;
      let seed = Math.abs(Math.round(b.ax * 7 + b.az * 13)) + 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 26; i++) {
        const t = rnd(),
          side = (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 55),
          sprite = new T.Sprite(
            new T.SpriteMaterial({ map: this.cloudTex, color: 0xffffff, transparent: true, opacity: 0.55 + rnd() * 0.3, depthWrite: false, fog: true }),
          ),
          size = 16 + rnd() * 26;
        sprite.position.set(b.ax + dx * t + nx * side, b.y - 16 + rnd() * 24, b.az + dz * t + nz * side);
        sprite.scale.set(size, size * (0.45 + rnd() * 0.2), 1);
        sprite.userData.drift = 0.6 + rnd() * 1.2;
        group.add(sprite);
      }
      this.clouds = group;
      this.root.add(group);
    }
    this.clouds.visible = true;
    for (const c of this.clouds.children) c.position.x += c.userData.drift * dt;
  }
  // Someone jumped out of the bus: swing the hatch open.
  busJump() {
    if (this.bus?.userData) this.bus.userData.open = 1;
  }
  updateShots(state, dt) {
    const seen = new Set(),
      fx = this.view.fx;
    this.trailClock = (this.trailClock || 0) + dt;
    const trail = this.trailClock > 0.03;
    if (trail) this.trailClock = 0;
    for (const s of state.bossShots || []) {
      seen.add(s.id);
      let m = this.shots.get(s.id);
      if (!m) {
        if (s.kind === 'boulder' || s.kind === 'rock') {
          m = new T.Mesh(this.rockGeo, this.rockMat);
          m.scale.setScalar(s.kind === 'boulder' ? 1.2 : 0.9);
          m.castShadow = true;
        } else if (s.kind === 'ice') m = new T.Mesh(this.iceShotGeo, this.shotMats.ice);
        else {
          m = new T.Mesh(this.shotGeo, this.shotMats[s.kind] || this.shotMats.void);
          if (s.kind === 'fireball') m.scale.setScalar(1.5);
          if (s.kind === 'psyring') m.scale.setScalar(0.7);
          if (s.kind === 'web') m.scale.setScalar(0.9);
        }
        this.root.add(m);
        this.shots.set(s.id, m);
      }
      m.position.set(s.x, s.y, s.z);
      if (s.kind === 'boulder' || s.kind === 'rock') m.rotation.x += dt * 8;
      else {
        m.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
        m.rotation.z += 0.3;
      }
      if (fx && trail) {
        const c = SHOT_COLORS[s.kind] ?? 0xffffff;
        if (s.kind === 'fireball') {
          fx.emit(s, { x: 0, y: 0.6, z: 0 }, Math.random() < 0.5 ? 0xff8a2a : 0xffc14a, 0.5, 0.3, { grow: 0.6 });
          fx.emit(s, { x: 0, y: 0.8, z: 0 }, 0x3a3634, 0.6, 0.9, { smoke: true, grow: 1.4 });
        } else if (s.kind === 'boulder' || s.kind === 'rock') fx.emit(s, { x: 0, y: 0.2, z: 0 }, 0xa89272, 0.35, 0.6, { smoke: true, grow: 0.8 });
        else fx.emit(s, { x: 0, y: 0, z: 0 }, c, s.kind === 'ice' ? 0.16 : 0.22, 0.3, { drag: 2 });
      }
    }
    for (const [id, m] of this.shots)
      if (!seen.has(id)) {
        this.root.remove(m);
        this.shots.delete(id);
      }
  }
  // Hazards on the ground: rings of fire, burning embers where a meteor fell, venom pools and gravity wells.
  makeHazard(h) {
    const g = new T.Group(),
      map = this.view.map;
    g.userData.kind = h.kind;
    if (h.kind === 'ring' || h.kind === 'embers') {
      const n = h.kind === 'ring' ? 28 : 7;
      for (let i = 0; i < n; i++) {
        const f = new T.Mesh(this.flameGeo, this.flameMat),
          a = (i / n) * Math.PI * 2,
          r = h.kind === 'ring' ? h.r : h.r * (0.3 + ((i * 37) % 10) / 14);
        f.position.set(Math.cos(a) * r, 0.6, Math.sin(a) * r);
        if (h.kind === 'embers') f.scale.setScalar(0.55);
        f.userData.a = a;
        g.add(f);
      }
      const glow = new T.Mesh(
        new T.RingGeometry(h.kind === 'ring' ? h.r - 0.5 : 0.01, h.r + 0.5, 48),
        new T.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: h.kind === 'ring' ? 0.55 : 0.35, side: T.DoubleSide, depthWrite: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.06;
      glow.userData.owned = true;
      g.add(glow);
      g.position.set(h.x, h.y, h.z);
    } else {
      // Venom and gravity wells follow the ground.
      const geo = groundShape(map, { shape: 'circle', x: h.x, z: h.z, r: h.r }, 0.06),
        mat = this.poolMaterial(),
        disc = new T.Mesh(geo, mat);
      mat.uniforms.color.value.set(h.kind === 'well' ? 0x7a4dff : 0x7bc03a);
      mat.uniforms.swirl.value = h.kind === 'well' ? 1 : 0;
      mat.uniforms.fade.value = 0;
      disc.frustumCulled = false;
      disc.userData.pooled = true;
      disc.renderOrder = 2;
      g.add(disc);
      g.userData.pool = mat;
    }
    this.root.add(g);
    return g;
  }
  updateRings(state, dt) {
    const seen = new Set(),
      fx = this.view.fx;
    for (const h of state.hazards || []) {
      seen.add(h.id);
      let g = this.rings.get(h.id);
      if (!g) {
        g = this.makeHazard(h);
        this.rings.set(h.id, g);
      }
      const life = Math.min(1, h.time / 0.6, (h.max - h.time) / 0.3 + 0.2);
      if (g.userData.pool) {
        const u = g.userData.pool.uniforms;
        u.time.value = this.clock;
        u.fade.value = Math.max(0, Math.min(1, life));
        g.userData.clock = (g.userData.clock || 0) + dt;
        if (fx && g.userData.clock > 0.08) {
          g.userData.clock = 0;
          const a = Math.random() * Math.PI * 2,
            r = Math.random() * h.r,
            x = h.x + Math.cos(a) * r,
            z = h.z + Math.sin(a) * r,
            y = groundHeight(x, z, this.view.map);
          if (g.userData.kind === 'well')
            // Motes spiral into the well.
            fx.emit({ x: h.x + Math.cos(a) * h.r, y: y + 0.4 + Math.random(), z: h.z + Math.sin(a) * h.r }, { x: -Math.cos(a) * 4 + Math.sin(a) * 2, y: 0, z: -Math.sin(a) * 4 - Math.cos(a) * 2 }, 0xb89aff, 0.14, 0.9, { drag: 0.5 });
          else fx.emit({ x, y: y + 0.1, z }, { x: 0, y: 0.8, z: 0 }, 0xa8e05a, 0.18, 0.7, { gravity: -0.4, drag: 1.5 });
        }
      } else
        g.children.forEach((f, i) => {
          if (f.userData.a === undefined) return;
          f.scale.set(1, (1.1 + Math.sin(this.clock * 14 + i * 1.7) * 0.35) * life * (g.userData.kind === 'embers' ? 0.55 : 1), 1);
        });
    }
    for (const [id, g] of this.rings)
      if (!seen.has(id)) {
        this.root.remove(g);
        g.traverse((c) => {
          if (c.userData.pooled) {
            c.geometry.dispose();
            (this.poolMats ||= []).push(c.material);
          }
          if (!c.userData.owned) return;
          c.geometry.dispose();
          c.material.dispose();
        });
        this.rings.delete(id);
      }
  }
  relicModel(relic) {
    const g = new T.Group(),
      color = RELICS[relic]?.color || 0xffffff,
      mat = new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.3 }),
      add = (geo, m = mat, x = 0, y = 0, z = 0) => {
        const mesh = new T.Mesh(geo, m);
        mesh.position.set(x, y, z);
        g.add(mesh);
        return mesh;
      };
    if (relic === 'portal') {
      add(new T.BoxGeometry(0.2, 0.22, 0.6), new T.MeshStandardMaterial({ color: 0xe8e8ee, roughness: 0.4 }));
      const tip = add(new T.CylinderGeometry(0.1, 0.13, 0.22, 10), mat, 0, 0, 0.38);
      tip.rotation.x = Math.PI / 2;
    } else if (relic === 'fang') {
      const f = add(bossHorn(0.55, 0.08, 0.7, 6), mat);
      f.rotation.x = Math.PI;
      add(new T.SphereGeometry(0.1, 10, 8), new T.MeshStandardMaterial({ color: 0x1f2616, roughness: 0.4 }), 0, 0.3, 0);
    } else if (relic === 'spine') {
      // The earth spine: a short column of stone vertebrae with amber between them.
      for (let i = 0; i < 4; i++) {
        add(bossRock(0.14 - i * 0.015, { seed: 3 + i, rough: 0.2, squash: [1.3, 0.7, 1] }), new T.MeshStandardMaterial({ color: 0xa08868, roughness: 1, flatShading: true }), 0, -0.25 + i * 0.18, 0);
        add(new T.OctahedronGeometry(0.05, 0), mat, 0.12, -0.16 + i * 0.18, 0);
      }
    } else add(new T.OctahedronGeometry(0.3, 0));
    const beam = add(
      new T.CylinderGeometry(0.25, 0.25, 6, 10, 1, true),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide }),
      0,
      2.6,
    );
    beam.renderOrder = 1;
    return g;
  }
  updateDrops(state) {
    const seen = new Set();
    for (const d of state.relics || []) {
      seen.add(d.id);
      let m = this.drops.get(d.id);
      if (!m) {
        m = this.relicModel(d.relic);
        this.root.add(m);
        this.drops.set(d.id, m);
      }
      m.position.set(d.x, d.y + Math.sin(this.clock * 2) * 0.12, d.z);
      m.rotation.y = this.clock * 1.4;
    }
    for (const [id, m] of this.drops)
      if (!seen.has(id)) {
        this.root.remove(m);
        // Relic models own their geometry and materials (shape helpers make new ones): free them.
        m.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry.dispose();
          o.material.dispose();
        });
        this.drops.delete(id);
      }
  }
  // Frozen players are encased in ice; webbed ones are wrapped in strands.
  updateIce(state, localId) {
    for (const [list, key, geo, mat, y] of [
      [this.ice, 'frozen', this.iceGeo, this.iceMat, 1.02],
      [this.webs, 'webbed', this.webGeo, this.webMat, 0.95],
    ]) {
      const seen = new Set();
      for (const p of state.players) {
        if (!(p[key] > 0) || p.hp <= 0 || p.id === localId) continue;
        seen.add(p.id);
        let m = list.get(p.id);
        if (!m) {
          m = new T.Mesh(geo, mat);
          if (key === 'webbed') m.scale.set(0.7, 1.25, 0.7);
          this.root.add(m);
          list.set(p.id, m);
        }
        m.position.set(p.x, p.y + y, p.z);
        if (key === 'webbed') m.rotation.y += 0.01;
      }
      for (const [id, m] of list)
        if (!seen.has(id)) {
          this.root.remove(m);
          list.delete(id);
        }
    }
  }
  // ——— Portals: each shows the view out of its partner, rendered from a virtual camera. ———
  portalFrame(p) {
    const o = new T.Object3D();
    o.position.set(p.x, p.y, p.z);
    const n = new T.Vector3(p.nx, p.ny, p.nz);
    if (Math.abs(n.y) > 0.5) o.up.set(0, 0, 1);
    o.lookAt(o.position.clone().add(n));
    o.updateMatrixWorld(true);
    return o;
  }
  makePortal(which) {
    const g = new T.Group(),
      surface = new T.Mesh(
        new T.CircleGeometry(1, 40),
        new T.ShaderMaterial({
          uniforms: { map: { value: null }, live: { value: 0 }, color: { value: new T.Color(PORTAL_COLORS[which]) }, res: { value: new T.Vector2(1, 1) }, time: { value: 0 } },
          vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: `uniform sampler2D map;uniform float live;uniform vec3 color;uniform vec2 res;uniform float time;varying vec2 vUv;
          void main(){vec2 s=gl_FragCoord.xy/res;float r=length(vUv-0.5)*2.0;
          vec3 swirl=color*(0.35+0.25*sin(atan(vUv.y-0.5,vUv.x-0.5)*5.0+time*3.0-r*9.0));
          vec3 c=live>0.5?texture2D(map,s).rgb:swirl;
          c=mix(c,color*1.4,smoothstep(0.8,1.0,r));
          gl_FragColor=vec4(c,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
        }),
      ),
      rim = new T.Mesh(new T.TorusGeometry(1, 0.06, 6, 48), new T.MeshBasicMaterial({ color: PORTAL_COLORS[which] }));
    g.add(surface, rim);
    g.userData.surface = surface;
    this.root.add(g);
    return g;
  }
  updatePortals(state, camera) {
    const seen = new Set();
    this.activePortals = [];
    for (const [owner, pair] of Object.entries(state.portals || {}))
      for (const which of ['a', 'b']) {
        const p = pair[which];
        if (!p) continue;
        const key = owner + ':' + which;
        seen.add(key);
        let g = this.portalMeshes.get(key);
        if (!g) {
          g = this.makePortal(which);
          this.portalMeshes.set(key, g);
        }
        const frame = this.portalFrame(p);
        g.position.copy(frame.position);
        g.quaternion.copy(frame.quaternion);
        const floor = Math.abs(p.ny) > 0.5;
        g.scale.set(floor ? 0.95 : 0.7, floor ? 0.95 : 1.15, 1);
        g.userData.surface.material.uniforms.time.value = this.clock;
        const other = pair[which === 'a' ? 'b' : 'a'];
        g.userData.surface.material.uniforms.live.value = 0;
        if (other && camera.position.distanceTo(g.position) < 45) this.activePortals.push({ g, from: p, to: other });
      }
    for (const [key, g] of this.portalMeshes)
      if (!seen.has(key)) {
        this.root.remove(g);
        g.traverse((o) => o.isMesh && (o.geometry.dispose(), o.material.dispose()));
        this.portalMeshes.delete(key);
      }
  }
  // Called just before the main render: draw the view through (at most two) visible portals into render targets.
  renderPortals(renderer, camera) {
    if (!this.activePortals?.length) return;
    const size = renderer.getDrawingBufferSize(new T.Vector2()),
      w = Math.max(64, Math.floor(size.x / 2)),
      h = Math.max(64, Math.floor(size.y / 2));
    this.portalTargets ||= [0, 1].map(() => new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType }));
    for (const t of this.portalTargets) if (t.width !== w || t.height !== h) t.setSize(w, h);
    const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = this.activePortals
      .filter((p) => frustum.intersectsSphere(new T.Sphere(p.g.position, 1.3)))
      .sort((a, b) => a.g.position.distanceTo(camera.position) - b.g.position.distanceTo(camera.position))
      .slice(0, 2);
    if (!visible.length) return;
    const virtual = this.virtualCamera || (this.virtualCamera = new T.PerspectiveCamera());
    virtual.copy(camera);
    const flip = new T.Matrix4().makeRotationY(Math.PI),
      shadows = renderer.shadowMap.autoUpdate,
      oldTarget = renderer.getRenderTarget(),
      oldClip = renderer.clippingPlanes,
      hidden = [...this.portalMeshes.values()];
    renderer.shadowMap.autoUpdate = false;
    for (const g of hidden) g.visible = false;
    visible.forEach((p, i) => {
      const inFrame = this.portalFrame(p.from),
        outFrame = this.portalFrame(p.to),
        m = new T.Matrix4()
          .copy(outFrame.matrixWorld)
          .multiply(flip)
          .multiply(inFrame.matrixWorld.clone().invert())
          .multiply(camera.matrixWorld);
      m.decompose(virtual.position, virtual.quaternion, virtual.scale);
      virtual.updateMatrixWorld(true);
      const n = new T.Vector3(p.to.nx, p.to.ny, p.to.nz),
        at = new T.Vector3(p.to.x, p.to.y, p.to.z);
      renderer.clippingPlanes = [new T.Plane(n, -n.dot(at) - 0.02)];
      renderer.setRenderTarget(this.portalTargets[i]);
      renderer.clear();
      renderer.render(this.scene, virtual);
      const u = p.g.userData.surface.material.uniforms;
      u.map.value = this.portalTargets[i].texture;
      u.live.value = 1;
      u.res.value.set(size.x, size.y);
    });
    renderer.clippingPlanes = oldClip;
    renderer.setRenderTarget(oldTarget);
    renderer.shadowMap.autoUpdate = shadows;
    for (const g of hidden) g.visible = true;
  }
  dispose() {
    this.scene.remove(this.root);
    for (const t of this.portalTargets || []) t.dispose();
  }
}
