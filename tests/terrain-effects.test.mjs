import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createWorld, lineClear } from '../src/world.js';
import { groundHeight, terrainMesh, terrainRay } from '../src/terrain.js';
import { castMap } from '../src/raycast.js';
import { Arena, initPhysics } from '../src/simulation.js';
import { CombatEffects } from '../src/effects.js';
import { makeGround, makeWater, makeSky } from '../src/materials.js';
await initPhysics();
test('multi-plot buildings, four parks and five wild biomes form an exact non-overlapping partition', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const m = createWorld(seed),
      cells = m.plots.flatMap((p) => p.cells);
    assert.equal(cells.length, 70);
    assert.equal(new Set(cells).size, 70);
    assert.equal(m.parks.length, 9);
    assert.deepEqual(m.parks.slice(4).map((p) => p.type).sort(), ['desert', 'forest', 'glade', 'lake', 'meadow']);
    assert.deepEqual(m.lairs.map((l) => l.boss).sort(), ['chaos', 'fire', 'might', 'mind', 'void']);
    assert.equal(m.plots.filter((p) => p.type === 'building' && p.cells.length === 2).length, 6);
    assert.equal(new Set(m.buildings.map((b) => b.type)).size, 30);
    for (const p of m.plots) {
      for (const c of p.cells) assert.ok(c >= 0 && c < 70);
      for (const b of m.buildings.filter((b) => b.plot === p.id)) {
        assert.ok(b.w < p.w - 6);
        assert.ok(b.d < p.d - 6);
      }
    }
  }
});
test('rendered terrain and height queries agree on every vertex and ray hit', () => {
  const m = createWorld(),
    mesh = terrainMesh(m);
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    assert.ok(Math.abs(groundHeight(mesh.vertices[i], mesh.vertices[i + 2], m) - mesh.vertices[i + 1]) < 1e-6);
  }
  const h = m.hills[0],
    height = groundHeight(h.x, h.z, m);
  assert.ok(height > 1.3);
  const d = terrainRay({ x: h.x, y: 5, z: h.z }, { x: 0, y: -1, z: 0 }, 10, m);
  assert.ok(Math.abs(5 - d - height) < 0.001);
  const hit = castMap({ x: h.x, y: 4, z: h.z }, { x: 0, y: -1, z: 0 }, 10, m);
  assert.ok(hit.impact && hit.distance < 4);
});
test('Rapier character climbs and descends a real hill without falling through', () => {
  const a = new Arena(),
    p = a.addPlayer('p', 'P'),
    h = a.map.hills.reduce((best, h) => (h.height > best.height ? h : best));
  // Climb along a line with no tree or rock in the way (props are random).
  const dx = [0, 1.5, -1.5, 3, -3, 4.5, -4.5].find(
    (dx) => !a.map.obstacles.some((o) => Math.abs(o.x - (h.x + dx)) < o.w / 2 + 0.9 && Math.abs(o.z - h.z) < h.radius + 6),
  );
  const x = h.x + dx,
    z = h.z - h.radius - 2;
  Object.assign(p, { x, z, y: groundHeight(x, z, a.map) + 0.02, vy: 0, grounded: true });
  const body = a.bodies.get(p.id).body;
  body.setTranslation({ x, y: p.y + 0.84, z }, true);
  body.setNextKinematicTranslation({ x, y: p.y + 0.84, z });
  a.world.step();
  let peak = 0;
  for (let i = 0; i < 240; i++) {
    a.input(p.id, { x: 0, z: 1, angle: 0, weapon: 0 });
    a.step();
    peak = Math.max(peak, p.y);
    assert.ok(p.y >= groundHeight(p.x, p.z, a.map) - 0.1, 'below hill');
  }
  assert.ok(peak > 1.3, `peak ${peak}`);
  assert.ok(p.z > h.z + 3, 'blocked');
  a.dispose();
});
test('effect pools are bounded under sustained fire and release all transient objects', () => {
  const scene = new T.Scene(),
    m = createWorld(),
    fx = new CombatEffects(scene, m);
  const baseline = scene.children.length;
  for (let i = 0; i < 300; i++) {
    fx.event({
      type: 'shot',
      x: 0,
      y: 1.6,
      z: 0,
      ex: 10,
      ey: 1.3,
      ez: 4,
      weapon: 0,
      impact: { kind: 'stone', x: -1, y: 0, z: 0 },
    });
    if (i % 5 === 0) fx.event({ type: 'explosion', x: 0, y: 1, z: 0 });
    fx.update(1 / 60);
  }
  assert.equal(fx.tracers.length, 128);
  assert.ok(scene.children.length <= baseline + 6);
  for (let i = 0; i < 600; i++) fx.update(1 / 60);
  assert.ok(fx.pools.every((p) => p.items.every((i) => i === null)));
  assert.ok(fx.tracers.every((i) => i === null));
  assert.ok(fx.marks.every((i) => i === null));
  assert.equal(scene.children.length, baseline);
  fx.reset(m);
  fx.dispose();
  assert.equal(scene.children.length, 0);
});
test('lightweight effects still include explosions and finite moving tracers', () => {
  const s = new T.Scene(),
    fx = new CombatEffects(s, createWorld(), { lite: true });
  fx.event({ type: 'shot', x: 0, y: 1.6, z: 0, ex: 60, ey: 1.6, ez: 0, weapon: 0 });
  fx.update(0.05);
  assert.ok(fx.tracers[0].age > 0);
  fx.event({ type: 'explosion', x: 0, y: 1, z: 0 });
  fx.update(0.016);
  assert.ok(fx.pools.some((p) => p.items.some(Boolean)));
  assert.equal(fx.light.intensity, 0);
  for (const mesh of [fx.tracerMesh, fx.debrisMesh, fx.markMesh])
    assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  fx.dispose();
});
test('terrain shader hook preserves standard lighting and material resources can be disposed', () => {
  const ground = makeGround(createWorld()),
    shader = { vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
  ground.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('vTerrainWorld=(modelMatrix'));
  assert.ok(shader.fragmentShader.includes('surfaceHash'));
  assert.ok(shader.fragmentShader.includes('#include <lights_fragment_begin>'));
  for (const m of [ground, makeWater({ x: 0, z: 0, w: 5, d: 5 }), makeSky()]) {
    m.geometry.dispose();
    m.material.dispose();
  }
});
