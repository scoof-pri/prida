import test from 'node:test';import assert from 'node:assert/strict';
import {prepareEntities,entityDeltaPacket,EntityDeltaMirror} from '../src/entity-delta.js';
const state=(patch={})=>({players:[{id:'you',hp:100,x:0,z:0}],vehicles:[{id:'v',x:1,z:2,armour:{front:420}}],doors:[[0,0,0,1,100]],lifts:[{id:1,y:0}],...patch});
const packet=(s,seq,previous)=>{const frame=prepareEntities(s,seq);const p=entityDeltaPacket(frame,previous);return {...p,data:p.json?JSON.parse(p.json):null};};
test('first packet sends all persistent vehicles, doors, lifts',()=>{const s=state(),p=packet(s,1),m=new EntityDeltaMirror(),out=m.apply({entityDelta:p.data});assert.deepEqual(out.vehicles,[{id:'v',x:1,z:2,armour:{front:420}}]);assert.equal(out.doors.length,1);assert.equal(out.lifts.length,1);assert.equal(s.players.length,1);assert.equal(s.vehicles,undefined);});
test('unchanged entity state consumes no delta bytes and no spurious removals',()=>{const first=packet(state(),1),second=packet(state(),2,first.next);assert.equal(second.changed,false);assert.equal(second.json,null);const m=new EntityDeltaMirror();m.apply({entityDelta:first.data});const out=m.apply({});assert.equal(out.vehicles.length,1);});
test('changed plates and movement are reconstructed, unchanged entities remain intact',()=>{const first=packet(state(),1),second=packet(state({vehicles:[{id:'v',x:8,z:2,armour:{front:345}}]}),2,first.next),m=new EntityDeltaMirror();m.apply({entityDelta:first.data});const out=m.apply({entityDelta:second.data});assert.equal(out.vehicles[0].x,8);assert.equal(out.vehicles[0].armour.front,345);assert.equal(out.doors.length,1);assert.ok(!second.data.doors);});
test('destruction removes an entity explicitly and older updates cannot resurrect it',()=>{const p1=packet(state(),1),p2=packet(state({vehicles:[]}),2,p1.next),m=new EntityDeltaMirror();m.apply({entityDelta:p1.data});m.apply({entityDelta:p2.data});const out=m.apply({entityDelta:{seq:1,vehicles:[{id:'v',x:99}]}});assert.equal(out.vehicles.length,0);});
test('out-of-order reliable deltas for different entities still apply independently',()=>{const m=new EntityDeltaMirror();m.apply({entityDelta:{seq:1,full:true,vehicles:[{id:'a',x:0},{id:'b',x:0}],doors:[],lifts:[]}});m.apply({entityDelta:{seq:3,vehicles:[{id:'b',x:30}]}});const s=m.apply({entityDelta:{seq:2,vehicles:[{id:'a',x:20}]}});assert.equal(s.vehicles.find(v=>v.id==='a').x,20);assert.equal(s.vehicles.find(v=>v.id==='b').x,30);});
test('late full baseline preserves newer entity updates already received',()=>{const m=new EntityDeltaMirror();m.apply({entityDelta:{seq:5,vehicles:[{id:'b',x:50}]}});const s=m.apply({entityDelta:{seq:2,full:true,vehicles:[{id:'a',x:20},{id:'b',x:20}],doors:[],lifts:[]}});assert.equal(s.vehicles.find(v=>v.id==='b').x,50);assert.equal(s.vehicles.find(v=>v.id==='a').x,20);});
test('failed send does not advance the baseline: next send includes the missing changes',()=>{const first=packet(state(),1),failed=packet(state({vehicles:[{id:'v',x:5}]}),2,first.next),sent=packet(state({vehicles:[{id:'v',x:8}]}),3,first.next),m=new EntityDeltaMirror();assert.equal(failed.changed,true);m.apply({entityDelta:first.data});assert.equal(m.apply({entityDelta:sent.data}).vehicles[0].x,8);});
test('numeric and string IDs cannot alias',()=>{const p=packet(state({vehicles:[{id:'1'},{id:1}]}),1),m=new EntityDeltaMirror();assert.equal(m.apply({entityDelta:p.data}).vehicles.length,2);});
test('new round full baseline clears old entities and old pending snapshots',()=>{const m=new EntityDeltaMirror();m.apply({entityDelta:{seq:4,full:true,vehicles:[{id:'old'}],doors:[],lifts:[]}});m.apply({entityDelta:{seq:8,full:true,vehicles:[{id:'new'}],doors:[],lifts:[]}});const s=m.apply({entityDelta:{seq:6,vehicles:[{id:'old'}]}});assert.deepEqual(s.vehicles,[{id:'new'}]);});
test('100ms simulated round trip with deterministic jitter preserves committed damage',()=>{const m=new EntityDeltaMirror();let baseline;const arrivals=[];for(let seq=1;seq<=30;seq++){const p=packet(state({vehicles:[{id:'v',x:seq,armour:{front:420-seq}}]}),seq,baseline);baseline=p.next;arrivals.push({at:seq*66.667+50+(seq%3)*7,data:p.data});}arrivals.sort((a,b)=>a.at-b.at);for(const a of arrivals)m.apply({entityDelta:a.data});const out=m.apply({});assert.equal(out.vehicles[0].x,30);assert.equal(out.vehicles[0].armour.front,390);});
test('two thousand sleeping cars cost zero entity JSON in unchanged later frames',()=>{const fleet=Array.from({length:2000},(_,id)=>({id:'street-'+id,x:id,z:1,hp:420}));const a=packet(state({vehicles:fleet}),1),b=packet(state({vehicles:fleet}),2,a.next);assert.equal(a.data.vehicles.length,2000);assert.equal(b.json,null);});
test('mutable input snapshots cannot change a previously committed frame map',()=>{const s=state(),p=packet(s,1);const record=p.next.vehicles.get('string:v');const next=state({vehicles:[{id:'v',x:9}]});packet(next,2,p.next);assert.ok(record.json.includes('"x":1'));});

// 0.37.1: match LiftSystem.snapshot(), not the synthetic array used by the original delta fixtures.
const nativeLifts = (revision = 0, states = []) => ({ revision, states });
test('native idle lift envelope survives first packet and remains an object', () => {
  const expected = nativeLifts(), p = packet(state({ lifts: expected }), 1);
  assert.deepEqual(new EntityDeltaMirror().apply({ entityDelta: p.data }).lifts, expected);
});
test('moving and broken lift rows retain their revision and all seven fields', () => {
  const expected = nativeLifts(19, [['lift-a', 3.84, 1, 1, 0.75, 'opening', 380], ['lift-b', 0, 0, 2, 0, 'broken', 0]]);
  const p = packet(state({ lifts: expected }), 1);
  assert.deepEqual(new EntityDeltaMirror().apply({ entityDelta: p.data }).lifts, expected);
});
test('unchanged native lifts add zero delta bytes and stay available on the mirror', () => {
  const lifts = nativeLifts(2, [['lift-a', 0, 0, 1, 0.5, 'closing', 400]]);
  const a = packet(state({ lifts }), 1), b = packet(state({ lifts }), 2, a.next), m = new EntityDeltaMirror();
  m.apply({ entityDelta: a.data }); assert.equal(b.json, null); assert.deepEqual(m.apply({}).lifts, lifts);
});
test('lift revision-only changes are transmitted even when rows have equal coordinates', () => {
  const a = packet(state({ lifts: nativeLifts(1) }), 1), b = packet(state({ lifts: nativeLifts(2) }), 2, a.next);
  assert.equal(b.changed, true); const m = new EntityDeltaMirror(); m.apply({ entityDelta: a.data });
  assert.deepEqual(m.apply({ entityDelta: b.data }).lifts, nativeLifts(2));
});
test('a stale lift envelope cannot pair old rows with a newer revision', () => {
  const first = packet(state({ lifts: nativeLifts(0) }), 1);
  const old = nativeLifts(1, [['a', 1, 0, 1, 0, 'moving', 400]]);
  const newest = nativeLifts(2, [['a', 2, 0, 1, 0, 'moving', 400], ['b', 0, 0, 0, 0, 'broken', 0]]);
  const a = packet(state({ lifts: old }), 2, first.next), b = packet(state({ lifts: newest }), 3, a.next);
  const m = new EntityDeltaMirror(); m.apply({ entityDelta: first.data }); m.apply({ entityDelta: b.data });
  assert.deepEqual(m.apply({ entityDelta: a.data }).lifts, newest);
});
test('a failed lift send is retried from the committed baseline, not the failed frame', () => {
  const a = packet(state({ lifts: nativeLifts(0) }), 1);
  packet(state({ lifts: nativeLifts(1) }), 2, a.next);
  const wanted = nativeLifts(2, [['a', 0, 0, 1, 0, 'closing', 400]]);
  const retry = packet(state({ lifts: wanted }), 3, a.next), m = new EntityDeltaMirror();
  m.apply({ entityDelta: a.data }); assert.deepEqual(m.apply({ entityDelta: retry.data }).lifts, wanted);
});
test('round reset accepts revision zero and rejects old lift damage packets', () => {
  const a = packet(state({ lifts: nativeLifts(55, [['a', 0, 0, 0, 0, 'broken', 0]]) }), 3);
  const b = packet(state({ lifts: nativeLifts(0) }), 5), m = new EntityDeltaMirror();
  m.apply({ entityDelta: a.data }); m.apply({ entityDelta: b.data });
  assert.deepEqual(m.apply({ entityDelta: a.data }).lifts, nativeLifts(0));
});
test('unwrapped full snapshots retain native lift shape for developer captures', () => {
  const expected = nativeLifts(4, [['a', 0, 0, 0, 1, 'idle', 400]]), m = new EntityDeltaMirror();
  assert.deepEqual(m.apply(state({ lifts: expected })).lifts, expected);
  assert.deepEqual(m.apply({}).lifts, expected);
});
test('malformed native lift envelopes fail clearly without consuming the snapshot', () => {
  for (const lifts of [{revision: 1}, {revision: '1', states: []}, {revision: -1, states: []}, {states: []}]) {
    const s = state({ lifts }); assert.throws(() => prepareEntities(s, 1), /Invalid lifts snapshot/);
    assert.equal(s.vehicles.length, 1); assert.equal(s.doors.length, 1); assert.equal(s.lifts, lifts);
  }
});
test('serializing a native envelope does not retain a mutable reference to its rows', () => {
  const lifts = nativeLifts(1, [['a', 0, 0, 1, 0, 'moving', 400]]), a = packet(state({ lifts }), 1);
  lifts.states[0][1] = 12; lifts.revision = 2;
  assert.equal(new EntityDeltaMirror().apply({ entityDelta: a.data }).lifts.states[0][1], 0);
});
