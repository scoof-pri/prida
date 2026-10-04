// Required release gate on the exact installed Arena/Rapier/Three tree. Not a local mock test.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as T from 'three';
import {Arena,initPhysics} from '../src/simulation.js';
import {NetFeed,Mirror} from '../src/netcode.js';
import {armourSnapshot} from '../src/tank-armour.js';
import {fireVehicleRocket,tickRocketRack,wantsVehicleRocket} from '../src/vehicle-rockets.js';
import {freshVehicle} from '../src/vehicle-specs.js';
import {applyBusCamera} from '../src/bus-camera.js';
import {cameraClipMatrix,clipBoxVisible} from '../src/activity-window.js';

test('0.37 actual Arena: directional armour, native blast and network delta agree',async()=>{
 await initPhysics();const a=new Arena({seed:91726,bots:0,mode:'debug',allowCheats:true});
 try {
  const p=a.addPlayer('armour-user','ARMOUR');const v=a.vehicles.list.find(v=>v.variant==='twin');assert.ok(v);
  const before=v.hp,plates=armourSnapshot(v);const c=Math.cos(v.angle),s=Math.sin(v.angle);
  a.vehicles.damage(v.id,100,null,{kind:'kinetic',source:{x:v.x+s*20,y:v.y+1.7,z:v.z+c*20}});
  assert.equal(v.hp,before-25);assert.equal(v.armour.front,plates.front-75);assert.equal(v.armour.rear,plates.rear);
  const feed=new NetFeed(),mirror=new Mirror();
  const send=()=>{const packet=feed.packet(p.id,feed.frame(a.snapshot()));packet.commit();return {packet,state:mirror.apply(JSON.parse(packet.text).state)};};
  const first=send();assert.equal(first.state.vehicles.find(q=>q.id===v.id).armour.front,v.armour.front);
  a.vehicles.damage(v.id,100,null,{kind:'blast',source:{x:v.x-s*20,y:v.y+1.7,z:v.z-c*20}});
  const second=send();assert.ok(second.packet.reliable);assert.equal(second.state.vehicles.find(q=>q.id===v.id).armour.rear,v.armour.rear);
  assert.equal(second.state.vehicles.find(q=>q.id===v.id).hp,v.hp);
  assert.equal(v.obstacle.hp,v.hp,'damage and collider record agree');
 }finally{a.dispose();}
});
test('0.37 actual NetFeed: dropped send and a new round cannot lose armour, doors or lift state',()=>{
 const feed=new NetFeed(),mirror=new Mirror();
 const make=(front)=>({players:[{id:'p',hp:100,grounded:true,slots:[]}],vehicles:[{id:'t',x:10,armour:{front}}],doors:[[0,0,0,1,100]],lifts:[{id:0,y:0}],chests:[],destruction:{}});
 let p=feed.packet('p',feed.frame(make(420)));p.commit();mirror.apply(JSON.parse(p.text).state);
 feed.packet('p',feed.frame(make(345))); // simulate backpressure; deliberately do not commit
 p=feed.packet('p',feed.frame(make(270)));p.commit();let s=mirror.apply(JSON.parse(p.text).state);assert.equal(s.vehicles[0].armour.front,270);assert.equal(s.doors.length,1);assert.equal(s.lifts.length,1);
 p=feed.packet('p',feed.frame(make(270)));p.commit();assert.ok(!JSON.parse(p.text).state.entityDelta,'unchanged persistent entities are omitted');
 feed.reset();p=feed.packet('p',feed.frame(make(420)));p.commit();s=mirror.apply(JSON.parse(p.text).state);assert.equal(s.vehicles[0].armour.front,420);
});
test('0.37 actual Three: bus camera is exterior and culling uses the real projection',()=>{
 const view={camera:new T.PerspectiveCamera(70,16/9,.1,600),thirdPerson:false},bus={x:0,y:44,z:0,ax:0,az:-100,bx:0,bz:100};
 applyBusCamera(view,bus,{angle:0,pitch:0},1/60);
 assert.ok(view.camera.position.distanceTo(new T.Vector3(0,44,0))>15);assert.equal(view.camera.fov,72);assert.equal(view.thirdPerson,false);
 const clip=cameraClipMatrix(view.camera);
 assert.ok(clipBoxVisible(clip,{x0:-3,x1:3,y0:43,y1:50,z0:-6,z1:6}));
 assert.equal(clipBoxVisible(clip,{x0:-3,x1:3,y0:43,y1:50,z0:-100,z1:-94}),false);
});
test('0.37 complete source: Debug keeps its own mode, bus controller and 15Hz city transmission are wired',()=>{
 const read=n=>fs.readFileSync(new URL('../'+n,import.meta.url),'utf8');
 assert.ok(read('src/main.js').includes("size: city || mode === 'debug' ? 'city' : 'district'"));
 assert.ok(read('src/main.js').includes("mode = city ? 'royale' : kind"));
 assert.ok(read('src/render.js').includes('applyBusCamera(this, state.bus, look, dt)'));
 assert.ok(read('src/simulation.js').includes('this.botBudget037.input(this, p, dt)'));
 assert.ok(read('server.mjs').includes("'royale-city': { mode: 'royale', size: 'city', humans: 10, label: 'Big City Royale', hz: 30, sendEvery: 2 }"));
});

test('0.37.1 real Arena: native lift envelopes survive NetFeed, Mirror, damage and round reset', async () => {
  await initPhysics();
  const a = new Arena({seed:91726, bots:0, mode:'debug', allowCheats:true});
  try {
    const player = a.addPlayer('lift-network', 'LIFT');
    const lift = a.lifts.list[0]; assert.ok(lift, 'the real map must have a lift');
    const feed = new NetFeed(), mirror = new Mirror();
    const send = (commit = true) => {
      const p = feed.packet(player.id, feed.frame(a.snapshot()));
      if (commit) p.commit();
      return { p, state: commit ? mirror.apply(JSON.parse(p.text).state) : null };
    };
    const idle = send(); assert.deepEqual(idle.state.lifts, a.lifts.snapshot());
    assert.equal(Array.isArray(idle.state.lifts), false);
    a.lifts.damage(lift.id, 5);
    send(false); // Backpressure: this baseline must NOT be committed.
    a.lifts.damage(lift.id, 5);
    const damaged = send(); assert.deepEqual(damaged.state.lifts, a.lifts.snapshot());
    assert.equal(damaged.state.lifts.states.find(r => r[0] === lift.id)[6], 390);
    assert.equal(damaged.p.reliable, true);
    const steady = send(); assert.equal(JSON.parse(steady.p.text).state.entityDelta, undefined);
    assert.deepEqual(steady.state.lifts, a.lifts.snapshot());
    a.lifts.break(lift);
    assert.deepEqual(send().state.lifts, a.lifts.snapshot());
    feed.reset();
    const fresh = a.snapshot(); fresh.lifts = {revision:0, states:[]};
    const p = feed.packet(player.id, feed.frame(fresh)); p.commit();
    assert.deepEqual(mirror.apply(JSON.parse(p.text).state).lifts, {revision:0, states:[]});
  } finally { a.dispose(); }
});
