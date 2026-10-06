// Runs in the staged full repository on its real pinned dependencies, before any files are committed.
import test from 'node:test';import assert from 'node:assert/strict';
import * as T from 'three';
import {Arena,initPhysics} from '../src/simulation.js';
import {NetFeed,Mirror} from '../src/netcode.js';
import {syncLifts} from '../src/lift-system.js';
import {LiftViews} from '../src/lift-view.js';
import {InteriorViews} from '../src/interior-view.js';
import {Culler} from '../src/culling.js';
import {validateInteriorPlan} from '../src/interior-plan.js';
import {ramAhead} from '../src/vehicle-ram.js';
import {ROCKETS} from '../src/vehicle-rockets.js';
const advance=(a,p,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++){a.input(p.id,{angle:0,pitch:0,...input});a.step();}};

test('0.33 full Arena: rooms furnished, shaft collision, E and floor input, lift travel and network state', {timeout:120000},async()=>{
 await initPhysics();const a=new Arena({mode:'debug',bots:0,allowCheats:true});
 try{
  a.addPlayer('qa','QA');const p=a.players.find(p=>p.id==='qa');p.cheats.god=true;
  const b=a.map.buildings.find(b=>b.type==='office'&&b.interiorPlan?.lift);assert.ok(b,'office plan with a lift');validateInteriorPlan(b,b.interiorPlan);
  for(const level of b.interiorPlan.levels)if(level){assert.ok(level.rooms.length>=3);assert.ok(b.interiorPlaced[level.floor]>4,'floor furniture is actually placed by the native placer');}
  const home=a.map.buildings.find(b=>b.category==='home'&&b.interiorPlan&&b.storeys>0);assert.ok(home);
  assert.ok(home.interiorPlan.levels[1].rooms.some(r=>r.purpose==='bathroom'));
  const l=a.map.lifts.find(l=>l.building===b.id);assert.ok(l.parts.length>8);assert.ok(l.parts.every(o=>a.colliders.has(o)));
  a.place(p,l.x,l.z,l.y+.06);advance(a,p,.3);
  assert.equal(p.lift,l.id,'the native simulation identifies a standing rider');
  a.input(p.id,{liftFloor:1,angle:0,pitch:0});a.step();assert.equal(l.phase,'closing');
  advance(a,p,6);assert.equal(l.floor,1);assert.ok(Math.abs(p.y-l.y)<.14,`lift=${l.y}, feet=${p.y}`);assert.ok(p.grounded);assert.equal(l.open,1);
  // Open landing must be crossed, not left behind as an invisible floor/gate collider.
  const x=p.x;advance(a,p,.36,{x:-1});assert.ok(p.x<x-1.6,'exit from the cabin');assert.ok(Math.abs(p.y-l.y)<.2,'the shaft collar must support exit');
  a.place(p,l.x,l.z,l.y+.06);advance(a,p,.15);
  a.input(p.id,{liftFloor:0,angle:0});a.step();advance(a,p,6);assert.equal(l.floor,0);assert.ok(Math.abs(p.y-l.y)<.14);
  const feed=new NetFeed(),frame=feed.frame(a.snapshot()),packet=feed.packet(p.id,frame);packet.commit();const state=new Mirror().apply(JSON.parse(packet.text).state);
  assert.ok(state.lifts&&state.lifts.states.some(row=>row[0]===l.id));
  const client={lifts:[structuredClone({...l,parts:undefined})],obstacles:[]};syncLifts(client,state.lifts);assert.ok(client.obstacles.length>0);
  a.damageObstacle(l.parts[0],1000,p);assert.ok(l.broken);assert.equal(l.parts.length,0);assert.ok(!a.map.obstacles.some(o=>o.liftId===l.id));
  syncLifts(client,a.lifts.snapshot());assert.equal(client.obstacles.length,0);
 }finally{a.dispose();}
});

test('0.33 actual Three.js: fitted rooms and moving lift buffers are finite and dispose without orphaned objects', {timeout:120000},async()=>{
 await initPhysics();const a=new Arena({mode:'debug',bots:0}),scene=new T.Scene();let lifts,rooms;
 try{
  const b=a.map.buildings.find(b=>b.type==='office'&&b.interiorPlan?.lift),l=a.map.lifts.find(l=>l.building===b.id);
  const map={...a.map,renderBuildings:[b],renderDecor:a.map.decor.filter(d=>d.building===b.id),obstacles:a.map.obstacles.filter(o=>o.building===b.id),doors:a.map.doors.filter(d=>d.building===b.id),lifts:[l],interiorDetails:a.map.interiorDetails.filter(r=>r.building===b.id)};
  const c=new Culler({...map,doors:map.doors.filter(d=>d.kind!=='inner')});lifts=new LiftViews(scene,map,c);rooms=new InteriorViews(scene,map,c);
  assert.ok(lifts.entries.length===1&&rooms.entries.length>8);
  const camera=new T.PerspectiveCamera(70,16/9,.1,150);camera.position.set(b.x,b.y||8,b.z+12);camera.lookAt(b.x,4,b.z);camera.updateMatrixWorld();c.update(camera,120,true);
  l.y=l.stops[1];l.floor=1;l.open=1;lifts.update();rooms.update();
  for(const bt of [...lifts.batches,...rooms.batches.values()])if(bt.mat)assert.ok(bt.mat.every(Number.isFinite));
  scene.traverse(o=>{if(o.isMesh&&o.geometry.attributes.position)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));});
  l.broken=true;lifts.update();assert.ok(lifts.entries[0].dead);
 }finally{lifts?.dispose();rooms?.dispose();a.dispose();}
 assert.equal(scene.children.length,0);
});

test('0.33 native vehicle system: aircraft collision damages structures and itself; Debug rockets are unlimited only by authorized cheat', {timeout:120000},async()=>{
 await initPhysics();const a=new Arena({mode:'debug',bots:0,allowCheats:true});
 try{
  a.addPlayer('pilot','PILOT');const p=a.players.find(p=>p.id==='pilot');p.cheats.god=true;
  const v=a.vehicles.list.find(v=>v.kind==='plane');p.vehicle=v.id;v.driver=p.id;
  const max=v.hp;v.y=30;v.speed=24;v.airborne=true;const obstacle={x:v.x,y:31,z:v.z+5,w:8,h:3,d:.3,hp:100,part:'test-ram-target'};a.addObs(obstacle);
  assert.ok(ramAhead(a.vehicles,v,{x:0,y:0,z:2,oldAngle:v.angle}));assert.ok(obstacle.hp<=0);assert.ok(v.hp<max);
  a.setCheat(p.id,'infinite',true);v.rocketAmmo=0;v.rocketCd=0;v.rocketReload=0;
  a.input(p.id,{vehicleRocket:true,drive:0,angle:v.angle,pitch:.1});a.step();assert.equal(v.rocketAmmo,ROCKETS.plane.magazine);assert.ok(v.rocketShot>0);
  // The mode check is independent of client preferences and of the ordinary infinite-ammo flag.
  a.mode='royale';v.rocketAmmo=0;v.rocketCd=0;v.rocketReload=0;
  const n=v.rocketShot;a.input(p.id,{vehicleRocket:true,angle:v.angle});a.step();assert.equal(v.rocketShot,n);
 }finally{a.dispose();}
});
