// Actual runtime gate: requires the project's real Rapier, Three.js and current source tree.
// Runs during installation, before committing the cumulative update. No network and no WebGL required.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import fs from 'node:fs';
import {Arena,initPhysics} from '../src/simulation.js';
import {NetFeed,Mirror} from '../src/netcode.js';
import {vehicleModel,animateVehicle,disposeVehicleModel} from '../src/vehicle-models.js';
import {VehicleViews} from '../src/vehicle-view.js';
import {vehicleBody,syncVehicles} from '../src/vehicle-system.js';
import {freshVehicle} from '../src/vehicle-specs.js';
import {ObstacleGrid} from '../src/spatial.js';
import {createWorld} from '../src/world.js';
const near=(a,b,e=.001)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
test('actual Three.js tank rig rotates its yaw and elevation, without moving the hull',()=>{
 const root=vehicleModel('tank');
 try {
  const v=freshVehicle({kind:'tank',id:'test',x:0,y:0,z:0});v.turret=.8;v.angle=.2;v.barrel=.4;
  animateVehicle(root,v,1/60);root.updateMatrixWorld(true);
  const r=root.userData.rig;assert.ok(r.turret&&r.barrelPivot);near(r.turret.rotation.y,.6);near(r.barrelPivot.rotation.x,-.4);near(root.rotation.y,0);
  assert.ok(r.barrelPivot.parent,'barrel must remain attached after rigid-mesh merging');
  let bad=false;root.traverse(o=>{if(o.isMesh){const g=o.geometry.attributes.position;for(let i=0;i<g.array.length;i++)if(!Number.isFinite(g.array[i]))bad=true;}});assert.equal(bad,false);
 }finally{disposeVehicleModel(root);}
});
test('actual vehicle camera ignores its own hull and remains stable after on-foot camera mutations',()=>{
 const v=freshVehicle({id:'t',kind:'tank',x:0,y:.07,z:0}),o=vehicleBody(v);
 const obstacles=[o],map={limit:{x:30,z:30},hills:[],parks:[],maxTerrainHeight:0,obstacles,_vehicleObs:new Map([['t',o]])};
 obstacles.grid=new ObstacleGrid(obstacles,map.limit);
 const view={scene:new T.Scene(),camera:new T.PerspectiveCamera(72,16/9,.15,450),people:new Map()};
 const vv=new VehicleViews(view,map),entry={x:0,y:.07,z:0,angle:0,pitch:0,turret:0,barrel:0};
 try {
   vv.camera(v,entry,{angle:0,pitch:0},1/60);const position=view.camera.position.clone();
   assert.ok(position.z< -7,'own hull must not collapse the follow distance');
   for(let i=0;i<120;i++){view.camera.position.set(100*Math.sin(i),100,100);vv.camera(v,entry,{angle:0,pitch:0},1/60);near(view.camera.position.distanceTo(position),0);}
   assert.ok(Number.isFinite(view.vehicleGunAim.angle));
 }finally{vv.dispose();}
});
test('actual city world places the base beside the core and enables every parked car',()=>{
 const map=createWorld(91726,'city');
 assert.ok(map.core);near(map.core.z0-(map.expansion.base.z+map.expansion.base.d/2),18);
 const cars=map.obstacles.filter(o=>o.part==='car');assert.ok(cars.length>28,'large city must exercise the removed cap');
 const enabled=new Set(map.vehicleSpawns.filter(v=>v.decor!==undefined).map(v=>v.decor));
 for(const car of cars)assert.ok(enabled.has(car.decor),'undriveable car '+car.decor);
 assert.equal(enabled.size,cars.length);
 // No wilderness props/trees may block the centre of the runway.
 const runway=map.expansion.runway;
 for(const o of map.obstacles)if(['tree','rock','cactus','log','hay'].includes(o.part))assert.ok(Math.abs(o.x-runway.x)>(o.w+runway.w)/2 || Math.abs(o.z-runway.z)>(o.d+runway.d)/2);
});
test('real Arena: tank inputs aim independently, dormant cars stay out of repeated packets',async()=>{
 await initPhysics();const a=new Arena({bots:0,mode:'debug',allowCheats:true});
 try{
  a.addPlayer('gunner','GUNNER');const p=a.players.find(p=>p.id==='gunner'),v=a.vehicles.get('tank-1');
  Object.assign(p,{x:v.x+2.45,y:v.y,z:v.z,angle:-Math.PI/2,pitch:0});
  const body=a.bodies.get(p.id);body.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);body.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});
  assert.ok(a.vehicles.enter(p));
  const hull=v.angle;
  for(let i=0;i<100;i++){a.input(p.id,{angle:0,pitch:0,turretAngle:1,turretPitch:.4,drive:0,steer:0});a.step();}
  near(v.angle,hull);near(v.turret,1,.02);near(v.barrel,.4,.02);
  const sample=a.snapshot();assert.ok(sample.vehicles.length<a.vehicles.list.length);
  const feed=new NetFeed(),frame=feed.frame(sample),packet=feed.packet(p.id,frame);packet.commit();
  const mirrored=new Mirror().apply(JSON.parse(packet.text).state),clientMap=createWorld(a.map.seed,a.map.size);
  syncVehicles(clientMap,mirrored.vehicles);
  assert.equal(clientMap.vehicles.length,a.vehicles.list.length);
  near(clientMap.vehicles.find(q=>q.id===v.id).turret,v.turret,.01);
  const source=fs.readFileSync(new URL('../src/render.js',import.meta.url),'utf8');
  assert.ok(source.includes('} else if (!me.vehicle) {'),'on-foot camera must not execute while mounted');
 }finally{a.dispose();}
});

test('real Arena: tank rams a wall through native support/destruction with no residual collider',async()=>{
 await initPhysics();const a=new Arena({bots:0,mode:'debug',allowCheats:true});
 try {
  a.addPlayer('rammer','RAMMER');const p=a.players.find(p=>p.id==='rammer'),v=a.vehicles.get('tank-1');
  Object.assign(p,{x:v.x+2.45,y:v.y,z:v.z,angle:-Math.PI/2,pitch:0});
  const pb=a.bodies.get(p.id);pb.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);pb.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});
  assert.ok(a.vehicles.enter(p));
  const start=v.z,panel=a.map.panels++;
  const wall={part:'partition',panel,structural:false,x:v.x,y:1.5,z:start+4.3,w:5,h:3,d:.25,hp:100,color:0xa0a0a0};
  a.addObs(wall);a.world.step();a.physicsDirty=false;
  for(let i=0;i<150;i++){a.input(p.id,{drive:1,steer:0,angle:0,pitch:0});a.step();}
  assert.ok(!a.colliders.has(wall),'broken wall collider must be gone');
  assert.ok(!a.map.obstacles.includes(wall),'broken wall ray obstacle must be gone');
  assert.ok(a.destruction.panels.includes(panel),'native destruction must replicate the removed panel');
  assert.ok(v.z>start+6,'tank should be able to pass the demolished wall');
  const feed=new NetFeed(),f=feed.frame(a.snapshot()),packet=feed.packet(p.id,f);packet.commit();
  const state=new Mirror().apply(JSON.parse(packet.text).state);
  assert.ok(state.destruction.panels.includes(panel));assert.ok(Array.isArray(state.ramCleared));
 } finally {a.dispose();}
});

test('real Arena: W and looking up take the fighter off the runway without Space',async()=>{
 await initPhysics();const a=new Arena({bots:0,mode:'debug',allowCheats:true});
 try {
  a.addPlayer('pilot','PILOT');const p=a.players.find(p=>p.id==='pilot'),v=a.vehicles.get('fighter-1');
  Object.assign(p,{x:v.x+5.45,y:v.y,z:v.z,angle:-Math.PI/2,pitch:0});
  const pb=a.bodies.get(p.id);pb.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);pb.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});
  assert.ok(a.vehicles.enter(p));const start={y:v.y,z:v.z};
  for(let i=0;i<240;i++){a.input(p.id,{drive:1,steer:0,angle:Math.PI,pitch:.40,ascend:0});a.step();}
  assert.ok(v.hp>0,'takeoff must not collide with its own hull or runway');assert.ok(v.airborne,'fighter must take off: '+JSON.stringify({x:v.x,y:v.y,z:v.z,speed:v.speed,vy:v.vy,pitch:v.pitch,hp:v.hp,driver:v.driver}));
  assert.ok(v.y>start.y+5,'holding W and raising the view must produce actual vertical movement');
  assert.ok(v.z<start.z-40,'fighter must move along the runway direction');assert.equal(p.vehicle,v.id);
 } finally {a.dispose();}
});
