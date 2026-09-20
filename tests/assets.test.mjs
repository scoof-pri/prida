import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { BUILDING_TYPES, WEAPONS, GEAR } from '../src/catalog.js';
import { DECOR_SIZES } from '../src/decor-sizes.js';
const root = new URL('../public/models/', import.meta.url);
function json(b) {
  assert.equal(b.toString('utf8', 0, 4), 'glTF');
  return JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
}
globalThis.ProgressEvent ??= class {
  constructor(type, props) {
    Object.assign(this, props);
  }
};
test('all 87 GLB assets are local, self-contained and contain geometry; first-floor clipping is consistent', async () => {
  let total = 0;
  for (const name of [
    ...BUILDING_TYPES.map((b) => b.model),
    ...WEAPONS.map((w) => w.model),
    'soldier',
    'hazmat',
    'scout',
    'chest',
    ...GEAR.map((g) => g.model),
    ...Object.keys(DECOR_SIZES).map((n) => 'decor-' + n),
  ]) {
    const b = await fs.readFile(new URL(name + '.glb', root)),
      g = json(b);
    total += b.length;
    assert.ok(g.meshes.length);
    assert.ok(g.buffers.every((b) => !b.uri));
    assert.ok((g.images || []).every((i) => i.bufferView !== undefined));
    if (BUILDING_TYPES.some((t) => t.model === name))
      for (const m of g.meshes)
        for (const p of m.primitives) {
          const a = g.accessors[p.attributes.POSITION];
          assert.ok(a.count > 0);
          assert.ok(a.min[1] >= 3.8399, name + ' enters the walkable first floor');
        }
  }
  // Keeps the initial download far below CrazyGames' 20 MB mobile-homepage limit.
  assert.ok(total < 9 * 1024 * 1024, total);
});
test('three character rigs animate independently without broken skinning', async () => {
  for (const name of ['soldier', 'hazmat', 'scout']) {
    const b = await fs.readFile(new URL(name + '.glb', root)),
      g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    for (const clip of ['Idle', 'Run_Gun', 'Run_Shoot', 'Idle_Shoot', 'Jump_Idle', 'HitReact', 'Death'])
      assert.ok(
        g.animations.some((a) => a.name === clip),
        name + ' ' + clip,
      );
    const a = clone(g.scene),
      other = clone(g.scene),
      mixer = new T.AnimationMixer(a);
    let bones1 = [],
      bones2 = [];
    a.traverse((o) => {
      if (o.isSkinnedMesh) bones1.push(...o.skeleton.bones);
    });
    other.traverse((o) => {
      if (o.isSkinnedMesh) bones2.push(...o.skeleton.bones);
    });
    assert.ok(bones1.length > 0);
    assert.notEqual(bones1[0], bones2[0]);
    for (const clip of g.animations) {
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      mixer.update(0.4);
      a.updateMatrixWorld(true);
      a.traverse((o) => {
        if (o.isSkinnedMesh) {
          o.skeleton.update();
          const v = o.getVertexPosition(0, new T.Vector3());
          assert.ok(v.toArray().every(Number.isFinite), clip.name);
        }
      });
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(a);
  }
});
test('weapon icons and every hard-coded UI id exist', async () => {
  for (const w of WEAPONS) {
    const b = await fs.readFile(new URL('../public/icons/' + w.model + '.png', import.meta.url));
    assert.equal(b.toString('ascii', 1, 4), 'PNG');
  }
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
    js = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of js.matchAll(/(?:\$\(|show\()'\#([A-Za-z][\w-]*)'/g)) assert.ok(ids.includes(m[1]), m[1]);
});
