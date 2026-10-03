// PRIDA 0.37.1: repair the native LiftSystem snapshot contract before the cumulative installer runs.
// No tests are disabled, no libraries are changed, and no network or credentials are used here.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const BEFORE = 'ad77884ba5afa5c6a709e7bb2b9465e43b1fbd4f';
const AFTER = 'be096ebb0dfb5fb5e8cf340e46bf8e34d95f2c9b';
const ENTRIES = [
  {
    "name": "src/entity-delta.js",
    "mode": "replace",
    "text": "// Persistent entity deltas. LiftSystem snapshots are atomic {revision, states} envelopes:\n// splitting their rows without their revision would stop syncLifts or resurrect stale cabins.\nconst FIELDS = Object.freeze(['vehicles', 'doors', 'lifts']);\nconst LIFT_ENVELOPE_ID = '@prida/lift-snapshot';\nconst isLiftSnapshot = value => value !== null && typeof value === 'object' &&\n  !Array.isArray(value) && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.states);\nconst idOf = (value, name) => name === 'lifts' && isLiftSnapshot(value)\n  ? LIFT_ENVELOPE_ID : Array.isArray(value) ? value[0] : value?.id;\nconst validID = id => typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id));\nconst keyOf = id => typeof id + ':' + id;\nfunction records(name, value) {\n  if (value === null || value === undefined) return [];\n  if (Array.isArray(value)) return value;\n  if (name === 'lifts' && isLiftSnapshot(value)) return [value];\n  throw new TypeError('Invalid ' + name + ' snapshot: expected ' +\n    (name === 'lifts' ? '{revision, states} or a legacy array' : 'an array'));\n}\nexport function prepareEntities(snapshot, seq, replacer) {\n  const fields = Object.create(null);\n  // Validate before consuming the snapshot; never silently discard malformed live state.\n  for (const name of FIELDS) records(name, snapshot[name]);\n  for (const name of FIELDS) {\n    const m = new Map();\n    for (const value of records(name, snapshot[name])) {\n      const id = idOf(value, name); if (!validID(id)) continue;\n      m.set(keyOf(id), { id, json: JSON.stringify(value, replacer) });\n    }\n    fields[name] = m; delete snapshot[name];\n  }\n  return { seq, fields };\n}\nexport function entityDeltaPacket(frame, previous) {\n  const full = !previous, next = Object.create(null), fragments = [];\n  let changed = full;\n  for (const name of FIELDS) {\n    const now = frame.fields[name], before = previous?.[name] || new Map(), values = [], gone = [];\n    next[name] = now;\n    for (const [key, value] of now) if (before.get(key)?.json !== value.json) values.push(value.json);\n    for (const [key, value] of before) if (!now.has(key)) gone.push(value.id);\n    if (full || values.length) fragments.push(JSON.stringify(name) + ':[' + values.join(',') + ']');\n    if (gone.length) fragments.push(JSON.stringify(name + 'Gone') + ':' + JSON.stringify(gone));\n    if (values.length || gone.length) changed = true;\n  }\n  const json = changed ? '{\"seq\":' + frame.seq + (full ? ',\"full\":true' : '') +\n    (fragments.length ? ',' + fragments.join(',') : '') + '}' : null;\n  return { json, next, changed };\n}\nexport class EntityDeltaMirror {\n  constructor() { this.reset(); }\n  reset() {\n    this.fields = Object.fromEntries(FIELDS.map(k => [k, new Map()]));\n    this.versions = Object.fromEntries(FIELDS.map(k => [k, new Map()])); this.floor = 0;\n  }\n  apply(state) {\n    const d = state.entityDelta;\n    if (d && Number.isSafeInteger(d.seq) && d.seq > 0 && d.seq >= this.floor) {\n      for (const name of FIELDS) {\n        const map = this.fields[name], versions = this.versions[name], incoming = Array.isArray(d[name]) ? d[name] : [];\n        const present = new Set();\n        for (const value of incoming) {\n          const id = idOf(value, name); if (!validID(id)) continue;\n          const key = keyOf(id); present.add(key);\n          if ((versions.get(key) || 0) > d.seq) continue;\n          map.set(key, value); versions.set(key, d.seq);\n        }\n        for (const id of Array.isArray(d[name + 'Gone']) ? d[name + 'Gone'] : []) {\n          if (!validID(id)) continue; const key = keyOf(id);\n          if ((versions.get(key) || 0) > d.seq) continue;\n          map.delete(key); versions.set(key, d.seq);\n        }\n        if (d.full) {\n          for (const [key, version] of versions) if (version <= d.seq && !present.has(key)) {\n            map.delete(key); versions.delete(key);\n          }\n        }\n      }\n      if (d.full) this.floor = d.seq;\n    } else if (!d) {\n      // Direct/local captures retain the same native shape as the authoritative simulation.\n      for (const name of FIELDS) if (state[name] !== undefined && state[name] !== null) {\n        const values = records(name, state[name]);\n        this.fields[name] = new Map(values.filter(v => validID(idOf(v, name))).map(v => [keyOf(idOf(v, name)), v]));\n      }\n    }\n    for (const name of FIELDS) {\n      const values = [...this.fields[name].values()];\n      const lift = name === 'lifts' && values.find(isLiftSnapshot);\n      state[name] = lift || values;\n    }\n    delete state.entityDelta; return state;\n  }\n}\n"
  },
  {
    "name": "tests/entity-delta-037.test.mjs",
    "mode": "append",
    "text": "\n// 0.37.1: match LiftSystem.snapshot(), not the synthetic array used by the original delta fixtures.\nconst nativeLifts = (revision = 0, states = []) => ({ revision, states });\ntest('native idle lift envelope survives first packet and remains an object', () => {\n  const expected = nativeLifts(), p = packet(state({ lifts: expected }), 1);\n  assert.deepEqual(new EntityDeltaMirror().apply({ entityDelta: p.data }).lifts, expected);\n});\ntest('moving and broken lift rows retain their revision and all seven fields', () => {\n  const expected = nativeLifts(19, [['lift-a', 3.84, 1, 1, 0.75, 'opening', 380], ['lift-b', 0, 0, 2, 0, 'broken', 0]]);\n  const p = packet(state({ lifts: expected }), 1);\n  assert.deepEqual(new EntityDeltaMirror().apply({ entityDelta: p.data }).lifts, expected);\n});\ntest('unchanged native lifts add zero delta bytes and stay available on the mirror', () => {\n  const lifts = nativeLifts(2, [['lift-a', 0, 0, 1, 0.5, 'closing', 400]]);\n  const a = packet(state({ lifts }), 1), b = packet(state({ lifts }), 2, a.next), m = new EntityDeltaMirror();\n  m.apply({ entityDelta: a.data }); assert.equal(b.json, null); assert.deepEqual(m.apply({}).lifts, lifts);\n});\ntest('lift revision-only changes are transmitted even when rows have equal coordinates', () => {\n  const a = packet(state({ lifts: nativeLifts(1) }), 1), b = packet(state({ lifts: nativeLifts(2) }), 2, a.next);\n  assert.equal(b.changed, true); const m = new EntityDeltaMirror(); m.apply({ entityDelta: a.data });\n  assert.deepEqual(m.apply({ entityDelta: b.data }).lifts, nativeLifts(2));\n});\ntest('a stale lift envelope cannot pair old rows with a newer revision', () => {\n  const first = packet(state({ lifts: nativeLifts(0) }), 1);\n  const old = nativeLifts(1, [['a', 1, 0, 1, 0, 'moving', 400]]);\n  const newest = nativeLifts(2, [['a', 2, 0, 1, 0, 'moving', 400], ['b', 0, 0, 0, 0, 'broken', 0]]);\n  const a = packet(state({ lifts: old }), 2, first.next), b = packet(state({ lifts: newest }), 3, a.next);\n  const m = new EntityDeltaMirror(); m.apply({ entityDelta: first.data }); m.apply({ entityDelta: b.data });\n  assert.deepEqual(m.apply({ entityDelta: a.data }).lifts, newest);\n});\ntest('a failed lift send is retried from the committed baseline, not the failed frame', () => {\n  const a = packet(state({ lifts: nativeLifts(0) }), 1);\n  packet(state({ lifts: nativeLifts(1) }), 2, a.next);\n  const wanted = nativeLifts(2, [['a', 0, 0, 1, 0, 'closing', 400]]);\n  const retry = packet(state({ lifts: wanted }), 3, a.next), m = new EntityDeltaMirror();\n  m.apply({ entityDelta: a.data }); assert.deepEqual(m.apply({ entityDelta: retry.data }).lifts, wanted);\n});\ntest('round reset accepts revision zero and rejects old lift damage packets', () => {\n  const a = packet(state({ lifts: nativeLifts(55, [['a', 0, 0, 0, 0, 'broken', 0]]) }), 3);\n  const b = packet(state({ lifts: nativeLifts(0) }), 5), m = new EntityDeltaMirror();\n  m.apply({ entityDelta: a.data }); m.apply({ entityDelta: b.data });\n  assert.deepEqual(m.apply({ entityDelta: a.data }).lifts, nativeLifts(0));\n});\ntest('unwrapped full snapshots retain native lift shape for developer captures', () => {\n  const expected = nativeLifts(4, [['a', 0, 0, 0, 1, 'idle', 400]]), m = new EntityDeltaMirror();\n  assert.deepEqual(m.apply(state({ lifts: expected })).lifts, expected);\n  assert.deepEqual(m.apply({}).lifts, expected);\n});\ntest('malformed native lift envelopes fail clearly without consuming the snapshot', () => {\n  for (const lifts of [{revision: 1}, {revision: '1', states: []}, {revision: -1, states: []}, {states: []}]) {\n    const s = state({ lifts }); assert.throws(() => prepareEntities(s, 1), /Invalid lifts snapshot/);\n    assert.equal(s.vehicles.length, 1); assert.equal(s.doors.length, 1); assert.equal(s.lifts, lifts);\n  }\n});\ntest('serializing a native envelope does not retain a mutable reference to its rows', () => {\n  const lifts = nativeLifts(1, [['a', 0, 0, 1, 0, 'moving', 400]]), a = packet(state({ lifts }), 1);\n  lifts.states[0][1] = 12; lifts.revision = 2;\n  assert.equal(new EntityDeltaMirror().apply({ entityDelta: a.data }).lifts.states[0][1], 0);\n});\n"
  },
  {
    "name": "tests/integration-frontier-037.test.mjs",
    "mode": "append",
    "text": "\ntest('0.37.1 real Arena: native lift envelopes survive NetFeed, Mirror, damage and round reset', async () => {\n  await initPhysics();\n  const a = new Arena({seed:91726, bots:0, mode:'debug', allowCheats:true});\n  try {\n    const player = a.addPlayer('lift-network', 'LIFT');\n    const lift = a.lifts.list[0]; assert.ok(lift, 'the real map must have a lift');\n    const feed = new NetFeed(), mirror = new Mirror();\n    const send = (commit = true) => {\n      const p = feed.packet(player.id, feed.frame(a.snapshot()));\n      if (commit) p.commit();\n      return { p, state: commit ? mirror.apply(JSON.parse(p.text).state) : null };\n    };\n    const idle = send(); assert.deepEqual(idle.state.lifts, a.lifts.snapshot());\n    assert.equal(Array.isArray(idle.state.lifts), false);\n    a.lifts.damage(lift.id, 5);\n    send(false); // Backpressure: this baseline must NOT be committed.\n    a.lifts.damage(lift.id, 5);\n    const damaged = send(); assert.deepEqual(damaged.state.lifts, a.lifts.snapshot());\n    assert.equal(damaged.state.lifts.states.find(r => r[0] === lift.id)[6], 390);\n    assert.equal(damaged.p.reliable, true);\n    const steady = send(); assert.equal(JSON.parse(steady.p.text).state.entityDelta, undefined);\n    assert.deepEqual(steady.state.lifts, a.lifts.snapshot());\n    a.lifts.break(lift);\n    assert.deepEqual(send().state.lifts, a.lifts.snapshot());\n    feed.reset();\n    const fresh = a.snapshot(); fresh.lifts = {revision:0, states:[]};\n    const p = feed.packet(player.id, feed.frame(fresh)); p.commit();\n    assert.deepEqual(mirror.apply(JSON.parse(p.text).state).lifts, {revision:0, states:[]});\n  } finally { a.dispose(); }\n});\n"
  }
];
const PATCH = [
  {
    "from": "const RELEASE='0.37';",
    "to": "const RELEASE='0.37.1';"
  },
  {
    "from": "const STATE='.prida-0.37';",
    "to": "const STATE='.prida-0.37.1';"
  },
  {
    "from": "0.37 · ACTIVITY / ARMOUR",
    "to": "0.37.1 · LIFT NETWORK FIX"
  }
];
const hash = bytes => createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
export function repairInstaller(filename, { checkOnly = false } = {}) {
  const original = fs.readFileSync(filename), current = hash(original);
  if (current === AFTER) return {status:'already-fixed'};
  if (current !== BEFORE) throw new Error('Unexpected prida-update.mjs version. Refusing to replace a later edit: '+current);
  let text = original.toString('utf8');
  for (const {name,mode,text:content} of ENTRIES) {
    const prefix = '  '+JSON.stringify(name)+': ';
    const start = text.indexOf(prefix), end = text.indexOf('\n',start);
    if (start < 0 || end < 0 || text.indexOf(prefix,start+prefix.length) >= 0) throw new Error('Missing or ambiguous payload: '+name);
    const raw = text.slice(start+prefix.length,end), comma = raw.endsWith(',') ? ',' : '';
    const prior = JSON.parse(comma ? raw.slice(0,-1) : raw);
    const updated = mode === 'append' ? prior+content : content;
    text = text.slice(0,start)+prefix+JSON.stringify(updated)+comma+text.slice(end);
  }
  for (const {from,to} of PATCH) {
    if (text.split(from).length !== 2) throw new Error('Missing or ambiguous lift hotfix anchor. No file written.');
    text = text.replace(from,to);
  }
  const bytes = Buffer.from(text);
  if (hash(bytes) !== AFTER) throw new Error('Lift hotfix checksum mismatch. No file written.');
  if (!checkOnly) {
    const temp = filename+'.0371-'+process.pid+'.tmp';
    try { fs.writeFileSync(temp,bytes,{flag:'wx'}); fs.renameSync(temp,filename); }
    finally { fs.rmSync(temp,{force:true}); }
  }
  return {status:checkOnly?'verified':'fixed'};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.dirname(fileURLToPath(import.meta.url));
    console.log('[PRIDA 0.37.1] Lift snapshot repair: '+repairInstaller(path.join(root,'prida-update.mjs'),{checkOnly:process.argv.includes('--check')}).status);
  } catch (e) { console.error('[PRIDA 0.37.1] '+e.message); process.exitCode=1; }
}
