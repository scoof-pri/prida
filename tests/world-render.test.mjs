import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createWorld } from '../src/world.js';
import { roofStyle, roofTop, chimneyOf, facadeOf, RoofField } from '../src/roofs.js';
import { Culler } from '../src/culling.js';
import { CulledBatch } from '../src/scenery.js';
import { GrassField } from '../src/grass.js';
import { Nature } from '../src/nature.js';

// Builds one building's roof as its own field: triangle count and bounds.
function roofOf(b) {
  const field = new RoofField({ buildings: [b] }, new T.Group()),
    box = new T.Box3();
  let tris = 0;
  for (const { mesh } of field.parts) {
    const p = mesh.geometry.attributes.position;
    assert.ok(p.array.every(Number.isFinite), 'finite roof vertices');
    tris += p.count / 3;
    box.expandByObject(mesh);
  }
  field.dispose();
  return { box, tris };
}
test('procedural roofs sit on their building: finite, inside the footprint and overhang, up to the roof top', () => {
  for (const size of ['district', 'city'])
    for (const b of createWorld(91726, size).buildings) {
      const { box, tris } = roofOf(b),
        stack = chimneyOf(b);
      assert.ok(tris >= 10, b.type + ' has a roof');
      const ov = 0.9;
      assert.ok(box.min.x >= b.x - b.w / 2 - ov && box.max.x <= b.x + b.w / 2 + ov, b.type + ' x');
      assert.ok(box.min.z >= b.z - b.d / 2 - ov && box.max.z <= b.z + b.d / 2 + ov, b.type + ' z');
      assert.ok(box.min.y >= b.roofBase - 0.5, b.type + ' starts at the top storey');
      const top = Math.max(roofTop(b), b.height) + (stack ? stack.top - roofTop(b) : 0) + 5.5;
      assert.ok(box.max.y <= top, `${b.type} ${box.max.y} <= ${top}`);
    }
});
test('roof styles and facades are chosen per building category', () => {
  const m = createWorld(91726, 'city');
  const styles = new Set(m.buildings.map(roofStyle)),
    facades = new Set(m.buildings.map(facadeOf));
  for (const s of ['gable', 'flat', 'shed', 'saw']) assert.ok(styles.has(s), s);
  for (const f of ['bricks', 'plaster', 'panels']) assert.ok(facades.has(f), f);
  for (const b of m.buildings) {
    if (b.category === 'home') assert.ok(['gable', 'hip'].includes(roofStyle(b)));
    const c = chimneyOf(b);
    if (c) assert.ok(c.top > roofTop(b) + 5 && b.category === 'industry');
  }
});
test('a hidden roof collapses to degenerate triangles; a falling copy pivots on the building', () => {
  const m = createWorld(),
    field = new RoofField(m, new T.Group()),
    b = m.buildings[3];
  field.hide(b.id);
  for (const { mesh, ranges } of field.parts) {
    const r = ranges.get(b.id);
    if (!r) continue;
    const a = mesh.geometry.attributes.position.array;
    for (let i = r.start * 3; i < (r.start + r.count) * 3; i++) assert.equal(a[i], 0);
  }
  const copy = field.copy(b);
  assert.equal(copy.position.x, b.x);
  assert.equal(copy.position.z, b.z);
  assert.ok(copy.children.length > 0);
  field.dispose();
});
// Visibility: frustum, range and the occlusion horizon of intact buildings.
function camera(x, y, z, tx, ty, tz) {
  const c = new T.PerspectiveCamera(75, 16 / 9, 0.15, 400);
  c.position.set(x, y, z);
  c.lookAt(tx, ty, tz);
  c.updateMatrixWorld(true);
  return c;
}
test('culling: groups behind an intact building are hidden, damaged buildings stop hiding them', () => {
  const m = createWorld(),
    culler = new Culler(m),
    // A tall building and a spot straight behind it.
    b = m.buildings.find((q) => q.roofBase > 10 && q.w > 12),
    // A line along z between the doorway (centred on b.x) and the corner windows: solid wall on both faces.
    lane = b.x - (b.door / 2 + 1.3),
    front = { x: lane, z: b.z - b.d / 2 - 14 },
    behind = { x: lane, z: b.z + b.d / 2 + 9 };
  const hidden = culler.outdoor(behind.x, behind.z);
  culler.extend(hidden, behind.x - 1, 0, behind.z - 1, behind.x + 1, 1.5, behind.z + 1);
  const visible = culler.outdoor(front.x + 2, front.z + 6);
  culler.extend(visible, front.x + 1, 0, front.z + 5, front.x + 3, 1.5, front.z + 7);
  const back = culler.outdoor(front.x, front.z - 40);
  culler.extend(back, front.x - 1, 0, front.z - 41, front.x + 1, 1.5, front.z - 39);
  const cam = camera(front.x, 1.6, front.z, front.x, 1.6, b.z);
  culler.update(cam, 250, true);
  assert.equal(culler.visible[visible], 1, 'in front of the camera');
  assert.equal(culler.visible[back], 0, 'behind the camera');
  assert.equal(culler.visible[hidden], 0, 'behind the building');
  culler.markDamaged(b.id);
  culler.update(cam, 250, true);
  assert.equal(culler.visible[hidden], 1, 'a holed building no longer hides it');
});
test('culling: a sightline through a door and the door opposite it is not blocked', () => {
  const m = createWorld(),
    culler = new Culler(m),
    b = m.buildings.find((q) => q.roofBase > 10 && q.w > 12);
  // The two doors of a building are on its north and south faces, both centred on x = b.x.
  const target = culler.outdoor(b.x, b.z + b.d / 2 + 12);
  culler.extend(target, b.x - 0.4, 0, b.z + b.d / 2 + 11.6, b.x + 0.4, 1.2, b.z + b.d / 2 + 12.4);
  const cam = camera(b.x, 1.6, b.z - b.d / 2 - 10, b.x, 1.4, b.z);
  culler.update(cam, 250, true);
  assert.equal(culler.visible[target], 1);
});
test('culled batches keep only visible groups, and hidden items stay hidden after refills', () => {
  const batch = new CulledBatch(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), { colors: true }),
    m4 = new T.Matrix4();
  const a = batch.add(m4.makeTranslation(0, 0, 0), 0xff0000, 0),
    b = batch.add(m4.makeTranslation(5, 0, 0), 0x00ff00, 1),
    c = batch.add(m4.makeTranslation(9, 0, 0), 0x0000ff, 0);
  batch.build(new T.Group());
  batch.refill(new Uint8Array([1, 0]), 1);
  assert.equal(batch.mesh.count, 2);
  batch.refill(new Uint8Array([0, 1]), 2);
  assert.equal(batch.mesh.count, 1);
  assert.equal(batch.mesh.instanceMatrix.array[12], 5);
  batch.hide(c);
  batch.refill(new Uint8Array([1, 1]), 3);
  assert.equal(batch.mesh.count, 3);
  const arr = batch.mesh.instanceMatrix.array,
    zeroed = [0, 1, 2].filter((k) => arr.slice(k * 16, k * 16 + 16).every((v) => v === 0));
  assert.equal(zeroed.length, 1, 'one zero-scaled instance');
  batch.tint(a, 0xffffff);
  void b;
});
test('hiding several instances between two uploads uploads every one of them', () => {
  const batch = new CulledBatch(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()),
    m4 = new T.Matrix4(),
    ids = [0, 1, 2, 3, 4].map((i) => batch.add(m4.makeTranslation(i * 3, 0, 0), 0xffffff, 0));
  batch.build(new T.Group());
  batch.refill(new Uint8Array([1]), 1);
  // The renderer uploads the refill and clears the ranges.
  batch.mesh.instanceMatrix.clearUpdateRanges();
  batch.hide(ids[1]);
  batch.hide(ids[3]);
  const ranges = batch.mesh.instanceMatrix.updateRanges,
    covered = (slot) => ranges.some((r) => r.start <= slot * 16 && r.start + r.count >= slot * 16 + 16);
  assert.ok(covered(batch.slot(ids[1])) && covered(batch.slot(ids[3])), 'both hidden slots are uploaded');
});
test('3D grass grows on lawns and in parks, never on roads, under buildings or in water', () => {
  const m = createWorld(),
    g = new GrassField(m, new T.Scene());
  const at = (x, z) => g.density[g.cell(x, z)];
  for (const r of m.roads) assert.equal(at(r.x, r.z), 0, 'road');
  for (const b of m.buildings) assert.equal(at(b.x, b.z), 0, 'building');
  for (const w of m.waters) assert.equal(at(w.x, w.z), 0, 'water');
  const park = m.parks.find((p) => p.type === 'meadow');
  let grassy = 0;
  for (let i = 0; i < 40; i++) if (at(park.x + (i % 8) * 2 - 8, park.z + Math.floor(i / 8) * 2 - 4) > 0) grassy++;
  assert.ok(grassy > 20, 'meadow is grassy');
  const desert = m.parks.find((p) => p.type === 'desert');
  assert.equal(at(desert.x + 3, desert.z + 3), 0, 'no grass in the desert');
  const cam = camera(park.x, 1.6, park.z, park.x + 10, 1.4, park.z);
  g.update(cam, []);
  assert.ok(g.meshes[0].count > 50 && g.meshes[1].count > 50, 'patches placed around the camera');
  assert.ok(g.meshes[0].instanceMatrix.array.slice(0, g.meshes[0].count * 16).every(Number.isFinite));
  g.dispose();
});
test('every destructible tree, rock, cactus, log, bale, crate and bench has instances to hide', () => {
  const m = createWorld(),
    root = new T.Group(),
    culler = new Culler(m),
    batches = new Map(),
    scenery = {
      culler,
      adopt(key, b) {
        b.build(root, culler);
        batches.set(key, b);
      },
    },
    nature = new Nature(m, scenery);
  const props = m.obstacles.filter((o) => ['tree', 'rock', 'cactus', 'log', 'hay', 'crate', 'bench'].includes(o.part) && o.prop !== undefined);
  assert.ok(props.length > 50);
  for (const o of props) assert.ok(nature.slots.get(o.prop)?.length, o.part);
  const tree = props.find((o) => o.part === 'tree');
  nature.hide(tree.prop);
  for (const { batch, index } of nature.slots.get(tree.prop)) {
    const k = batch.pos[index];
    assert.ok(batch.mat.slice(k * 16, k * 16 + 16).every((v) => v === 0));
  }
});
