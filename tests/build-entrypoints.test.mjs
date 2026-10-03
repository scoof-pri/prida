import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { recoverBuild, blobHash, RECOVERED_HASH } from '../prida-build-recovery.mjs';

const root = new URL('../', import.meta.url);
const original = fs.readFileSync(new URL('prida-update.mjs', root));
function fixture(t, bytes = original) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prida-build-entry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'prida-update.mjs');
  fs.writeFileSync(file, bytes);
  return { dir, file };
}
function payload(source, name) {
  const prefix = '  ' + JSON.stringify(name) + ': ';
  const start = source.indexOf(prefix);
  assert.ok(start >= 0, 'Missing payload ' + name);
  const raw = source.slice(start + prefix.length, source.indexOf('\n', start));
  return JSON.parse(raw.endsWith(',') ? raw.slice(0, -1) : raw);
}
test('every release entrypoint restores the lift repair before running the installer', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.version, '0.37.2');
  for (const hook of ['prebuild', 'predev', 'pretest', 'prestart', 'prebuild:crazygames', 'prebuild:crazygames:full']) {
    assert.equal(pkg.scripts[hook], 'node prida-build-recovery.mjs && node prida-update.mjs', hook);
  }
});
test('dry recovery verifies all bytes without changing the upload', t => {
  const { dir, file } = fixture(t);
  assert.ok(['verified', 'already-fixed'].includes(recoverBuild(file, { checkOnly: true }).status));
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(fs.readdirSync(dir), ['prida-update.mjs']);
});
test('recovery is complete, idempotent and leaves no temporary files', t => {
  const { dir, file } = fixture(t);
  recoverBuild(file);
  const recovered = fs.readFileSync(file);
  assert.equal(blobHash(recovered), RECOVERED_HASH);
  assert.equal(recoverBuild(file).status, 'already-fixed');
  assert.deepEqual(fs.readFileSync(file), recovered);
  assert.deepEqual(fs.readdirSync(dir), ['prida-update.mjs']);
  assert.match(recovered.toString(), /0\.37\.2 · BUILD RECOVERY/);
});
test('unrecognized or later uploads are rejected without replacing user code', t => {
  const changed = Buffer.concat([original, Buffer.from('\n// later change\n')]);
  const { dir, file } = fixture(t, changed);
  assert.throws(() => recoverBuild(file), /Unsupported or edited installer/);
  assert.deepEqual(fs.readFileSync(file), changed);
  assert.deepEqual(fs.readdirSync(dir), ['prida-update.mjs']);
});
test('recovered real payload round-trips idle, moving and destroyed lift envelopes', async t => {
  const { file } = fixture(t);
  recoverBuild(file);
  const source = fs.readFileSync(file, 'utf8');
  const code = payload(source, 'src/entity-delta.js');
  const { prepareEntities, entityDeltaPacket, EntityDeltaMirror } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  let previous, seq = 0;
  const mirror = new EntityDeltaMirror();
  for (const lifts of [
    { revision: 0, states: [] },
    { revision: 1, states: [['lift-a', 2.5, 0, 1, 0, 'moving', 400]] },
    { revision: 2, states: [['lift-a', 2.5, 0, 1, 0, 'broken', 0]] },
  ]) {
    const packet = entityDeltaPacket(prepareEntities({ vehicles: [], doors: [], lifts }, ++seq), previous);
    previous = packet.next;
    const received = mirror.apply({ entityDelta: JSON.parse(packet.json) });
    assert.deepEqual(received.lifts, lifts);
    assert.equal(Array.isArray(received.lifts), false);
  }
  assert.match(payload(source, 'tests/entity-delta-037.test.mjs'), /native idle lift envelope/);
  assert.match(payload(source, 'tests/integration-frontier-037.test.mjs'), /native lift envelopes survive NetFeed/);
});
