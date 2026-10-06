import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Arena,initPhysics} from '../src/simulation.js';
import {aircraftBounds,aircraftPoint,aircraftLocal,aircraftTurn,aircraftQuaternion,aircraftColliderParts,aircraftClosestPoint,rayAircraft,aircraftGunPose,AIRCRAFT_PARTS,AIRCRAFT_GUNS} from '../src/aircraft-geometry.js';
import {freshVehicle,controls,integrateVehicle} from '../src/vehicle-specs.js';
import {vehicleBody,syncVehicles} from '../src/vehicle-system.js';
import {updateVehicleObstacle} from '../src/vehicle-spatial.js';
import {sweepVehicleContacts} from '../src/vehicle-contact.js';
import {AircraftWreckage,splitAircraftModel,AIRCRAFT_FRAGMENT_LIMIT} from '../src/aircraft-wreckage.js';
import {vehicleModel,disposeVehicleModel} from '../src/vehicle-models.js';
import {castMap} from '../src/raycast.js';
import {ObstacleGrid} from '../src/spatial.js';
import {NetFeed,Mirror} from '../src/netcode.js';
import {VehicleViews} from '../src/vehicle-view.js';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
function mapWith(v){const obstacles=[vehicleBody(v)],map={limit:{x:100,z:100},hills:[],parks:[],obstacles,maxTerrainHeight:0};obstacles.grid=new ObstacleGrid(obstacles,map.limit);return map;}
function placeAircraft(a,v,pose){Object.assign(v,pose);updateVehicleObstacle(a.map,v.obstacle,vehicleBody(v));const colliders=a.colliders.get(v.obstacle),parts=aircraftColliderParts(v);assert.equal(colliders.length,parts.length);for(let i=0;i<parts.length;i++){const p=parts[i];colliders[i].setTranslation({x:p.x,y:p.y,z:p.z});colliders[i].setRotation(p.rotation);}a.world.step();a.physicsDirty=false;return colliders;}

test('airframe transform and inverse exactly match Three YXZ at pitch, yaw and bank',()=>{
  for(const angle of [-3.1,-.7,0,2.5])for(const pitch of [-.6,.3])for(const roll of [-.55,.45]){
    const v={x:4,y:21,z:-8,angle,pitch,roll},p={x:3.2,y:1.25,z:-2.4},q=aircraftPoint(v,p),back=aircraftLocal(v,q),rotation=new T.Quaternion().setFromEuler(new T.Euler(-pitch,angle,roll,'YXZ'));
    const expected=new T.Vector3(p.x,p.y,p.z).applyQuaternion(rotation).add(new T.Vector3(v.x,v.y,v.z));for(const k of ['x','y','z']){near(back[k],p[k]);near(q[k],expected[k]);near(aircraftQuaternion(v)[k],rotation[k]);}
  }
});
test('real map rays hit the fuselage, wings and tail but cross the empty corners at every orientation',()=>{
  for(const pose of [{angle:0,pitch:0,roll:0},{angle:1.1,pitch:.35,roll:-.5}]){
    const v={...freshVehicle({kind:'plane',id:'hitbox',x:0,y:30,z:0}),...pose},map=mapWith(v),dir=aircraftTurn({x:0,y:-1,z:0},v);
    for(const [p,part] of [[{x:0,y:6,z:2.5},'engine'],[{x:3,y:6,z:0},'wing-right'],[{x:1,y:6,z:-3.3},'stabilizer-right']]){const origin=aircraftPoint(v,p),hit=castMap(origin,dir,8,map);assert.equal(hit.impact?.obstacle?.vehicleId,v.id);assert.equal(rayAircraft(v,origin,dir,8)?.part,part);}
    const origin=aircraftPoint(v,{x:3,y:6,z:-3});near(castMap(origin,dir,8,map).distance,8);assert.equal(rayAircraft(v,origin,dir,8),null);
  }
});
test('blast distance uses the occupied surface, not the broad-phase envelope',()=>{
  const v=freshVehicle({kind:'plane',id:'blast',x:0,y:30,z:0}),empty=aircraftPoint(v,{x:3,y:1.2,z:-3});
  const closest=aircraftClosestPoint(v,empty);assert.ok(closest.distance>1.2);const onWing=aircraftClosestPoint(v,aircraftPoint(v,{x:3,y:1.1,z:0}));assert.ok(onWing.distance<.1);
});
test('pedestrian sweep keeps wing-to-tail space open and still blocks a real wing',()=>{
  const v=freshVehicle({kind:'plane',id:'walk',x:0,y:.07,z:0}),map=mapWith(v);
  const free=sweepVehicleContacts(map,{x:3,y:0,z:-4},{x:0,y:0,z:1.6});near(free.z,1.6);assert.equal(free.contacts,0);
  const blocked=sweepVehicleContacts(map,{x:3,y:0,z:-2},{x:0,y:0,z:4});assert.ok(blocked.contacts>0);assert.ok(blocked.z<2);
});
test('Rapier and hitscan share the same rotated convex aircraft proxies',async()=>{
  await initPhysics();const a=new Arena({bots:0,mode:'debug',allowCheats:true});
  try{const v=a.vehicles.get('fighter-1'),colliders=placeAircraft(a,v,{x:0,y:45,z:0,angle:.8,pitch:.30,roll:-.48}),handles=new Set(colliders.map(c=>c.handle));
    assert.equal(colliders.length,AIRCRAFT_PARTS.length);assert.ok(colliders.length>10);
    for(const local of [{x:3,y:6,z:0},{x:0,y:6,z:2.5},{x:3,y:6,z:-3}]){const origin=aircraftPoint(v,local),dir=aircraftTurn({x:0,y:-1,z:0},v),ray=rayAircraft(v,origin,dir,8);
      const physical=a.world.castRay(new RAPIER.Ray(origin,dir),8,true,undefined,undefined,undefined,undefined,c=>handles.has(c.handle));
      if(!ray)assert.equal(physical,null);else{assert.ok(physical);near(physical.timeOfImpact,ray.distance,.015);}}
  }finally{a.dispose();}
});
test('actual compound motion clears an obstacle in the empty tail corner and stops at a wing strike',async()=>{
  await initPhysics();const a=new Arena({bots:0,mode:'debug',allowCheats:true});
  try{const v=a.vehicles.get('fighter-1');placeAircraft(a,v,{x:0,y:45,z:0,angle:0,pitch:0,roll:0,airborne:true,_grounded:false,speed:20,vx:0,vy:0,vz:20});
    const corner={part:'test-barrier',x:3.5,y:46.2,z:-2.5,w:.20,h:.45,d:.08};a.addObs(corner);a.world.step();a.physicsDirty=false;
    const hp=v.hp;a.vehicles.move(v,{x:0,y:0,z:.8,oldAngle:0,oldPitch:0,oldRoll:0},1/15);near(v.hp,hp);assert.ok(v.z>.75);a.removeObs(corner);
    placeAircraft(a,v,{x:0,y:45,z:0,angle:0,pitch:0,roll:0,airborne:true,_grounded:false,speed:24,vx:0,vy:0,vz:24});
    const wall={part:'test-barrier',x:3.5,y:46.20,z:1.12,w:.25,h:.6,d:.08};a.addObs(wall);a.world.step();a.physicsDirty=false;
    a.vehicles.move(v,{x:0,y:0,z:1.5,oldAngle:0,oldPitch:0,oldRoll:0},1/15);assert.ok(v.hp<hp,'wing collision must damage the aircraft');assert.ok(v.crushed||v.z<1.1,'the wing must not pass through the barrier');
  }finally{a.dispose();}
});
test('destruction removes every airframe collider, persists breakup state and emits one destruction event',async()=>{
  await initPhysics();const a=new Arena({bots:0,mode:'debug',allowCheats:true});
  try{const v=a.vehicles.get('fighter-1'),colliders=placeAircraft(a,v,{x:0,y:45,z:0,angle:.4,pitch:.2,roll:-.3,airborne:true,speed:32,vx:10,vy:5,vz:28});
    a.vehicles.damage(v.id,1e5,null);assert.equal(v.crushed,true);assert.equal(a.colliders.has(v.obstacle),false);assert.ok(colliders.every(c=>!c.isValid()));assert.ok(!a.map.obstacles.includes(v.obstacle));
    const snapshot=a.vehicles.snapshot().find(q=>q.id===v.id);assert.equal(snapshot.wreck.vx,10);assert.equal(snapshot.wreck.vy,5);assert.equal(snapshot.wreck.vz,28);near(snapshot.wreck.pitch,.2);
    a.vehicles.damage(v.id,1e5,null);assert.equal(a.events.filter(e=>e.type==='vehicle-destroyed'&&e.vehicle===v.id).length,1);
    const mirror={limit:{x:100,z:100},obstacles:[],vehicleSpawns:[]};syncVehicles(mirror,[snapshot]);assert.equal(mirror.obstacles.length,0);assert.equal(mirror.vehicles[0].crushed,true);assert.ok(mirror.vehicles[0].wreck);
  }finally{a.dispose();}
});
test('flight retains lateral momentum through a turn and loses lift below stall speed',()=>{
  const v={...freshVehicle({kind:'plane',id:'flight',x:0,y:40,z:0}),driver:'pilot',speed:32,vx:0,vz:32,vy:0,airborne:true};
  for(let i=0;i<25;i++)integrateVehicle(v,controls({drive:1,angle:1,pitch:0}),1/60);
  const velocityAngle=Math.atan2(v.vx,v.vz);assert.ok(v.angle>.1);assert.ok(velocityAngle<v.angle-.02,'momentum must lag the nose direction');assert.ok(v.roll<0);
  Object.assign(v,{speed:4,vx:0,vz:4,vy:0,roll:0,pitch:0});for(let i=0;i<60;i++)integrateVehicle(v,controls({drive:0,angle:v.angle,pitch:.72}),1/60);
  assert.ok(v.vy< -7);assert.equal(v.stalled,true);assert.ok(v.pitch<.6,'low-speed controls cannot instantly pitch the stalled aircraft');
});
test('gun emitters coincide with the visible barrel tips after pitch and bank',()=>{
  const root=vehicleModel('plane'),v={...freshVehicle({kind:'plane',id:'guns',x:8,y:30,z:-3}),angle:.7,pitch:.3,roll:-.5,shot:0};
  try{root.position.set(v.x,v.y,v.z);root.rotation.set(-v.pitch,v.angle,v.roll,'YXZ');root.updateMatrixWorld(true);assert.ok(root.userData.aircraftGuns.children.length>=8);
    const muzzle=new T.Vector3(AIRCRAFT_GUNS.cannon.x,AIRCRAFT_GUNS.cannon.y,AIRCRAFT_GUNS.cannon.z).applyMatrix4(root.matrixWorld),actual=aircraftGunPose(v).origin;for(const k of ['x','y','z'])near(actual[k],muzzle[k]);
  }finally{disposeVehicleModel(root);}
});
test('bundled plane breaks into recognizable actual-mesh fragments without losing triangles',async()=>{
  const bytes=fs.readFileSync(new URL('../public/models/prida030/plane.glb',import.meta.url));
  const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''),model=loaded.scene;
  const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),scale=Math.min(9.4/size.x,8.8/size.z);
  model.scale.multiplyScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);const wrapper=new T.Group();wrapper.add(model);
  let sourceTriangles=0;model.traverse(o=>{if(o.isMesh)sourceTriangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});
  const pieces=splitAircraftModel(wrapper),names=new Set(pieces.map(p=>p.name));for(const name of ['fuselage','wing-left','wing-right','tail','canopy','propeller'])assert.ok(names.has(name),name);
  let triangles=0;for(const p of pieces)p.model.traverse(o=>{if(o.isMesh){triangles+=o.geometry.attributes.position.count/3;o.geometry.dispose();o.material.dispose();}});assert.equal(triangles,sourceTriangles);
  const map={limit:{x:100,z:100},hills:[],parks:[],obstacles:[],maxTerrainHeight:0},scene=new T.Group(),wreckage=new AircraftWreckage(scene,map,null);
  try{assert.equal(wreckage.spawn('plane',wrapper,{x:0,y:20,z:0,angle:.3,pitch:.1,roll:.3,vx:8,vy:3,vz:20}),true);assert.equal(wreckage.spawn('plane',wrapper,{x:0,y:20,z:0}),false);
    for(let i=0;i<120;i++)wreckage.update(1/60);assert.ok(wreckage.pieces.length<=AIRCRAFT_FRAGMENT_LIMIT);const left=wreckage.pieces.find(p=>p.name==='wing-left'),right=wreckage.pieces.find(p=>p.name==='wing-right');assert.ok(left.model.position.distanceTo(right.model.position)>8);
    for(const p of wreckage.pieces){assert.ok([...p.model.position.toArray(),...p.model.quaternion.toArray()].every(Number.isFinite));assert.ok(p.model.position.y>=0);}
  }finally{wreckage.dispose();assert.equal(scene.children.length,0);}
});
test('network keyframes and retained entity deltas preserve the full wreck pose and velocity',()=>{
  const vehicle={...freshVehicle({kind:'plane',id:'fighter-repeat',x:3,y:20,z:-4}),hp:0,crushed:true,wreck:{x:3,y:20,z:-4,angle:.713,pitch:.284,roll:-.37,vx:9.26,vy:3.4,vz:27.55,time:3.2}};
  const feed=new NetFeed(),mirror=new Mirror(),snapshot=tick=>({tick,round:1,players:[],vehicles:[structuredClone(vehicle)],chests:[],destruction:{},doors:[],lifts:[],constructions:[],labItems:[]});
  const first=feed.packet('viewer',feed.frame(snapshot(200)));first.commit();const state=mirror.apply(JSON.parse(first.text).state);assert.deepEqual(state.vehicles[0].wreck,vehicle.wreck);
  const later=feed.packet('viewer',feed.frame(snapshot(215)));later.commit();const packet=JSON.parse(later.text).state;assert.ok(!packet.entityDelta?.vehicles?.length,'unchanged wreck data is retained, not resent every frame');
  assert.deepEqual(mirror.apply(packet).vehicles[0].wreck,vehicle.wreck);
});
test('a repeated aircraft ID can break up again after a same-map round reset',()=>{
  const v=freshVehicle({kind:'plane',id:'repeat',x:0,y:20,z:0}),map=mapWith(v);map.vehicles=[v];
  const view={scene:new T.Scene(),camera:new T.PerspectiveCamera(72,1,.1,400),people:new Map()},vehicles=new VehicleViews(view,map),pose={x:0,y:20,z:0,angle:.4,pitch:.2,roll:.1,vx:2,vy:0,vz:20,time:1};
  try{Object.assign(v,{hp:0,crushed:true,wreck:pose});vehicles.update({tick:60,round:1,players:[],vehicleShots:[]},'none',0,false,{});assert.ok(vehicles.wreckage.pieces.length>0);assert.ok(vehicles.wreckage.seen.has(v.id));
    Object.assign(v,{hp:780,crushed:false,wreck:null});vehicles.update({tick:1,round:1,players:[],vehicleShots:[]},'none',0,false,{});assert.equal(vehicles.wreckage.pieces.length,0);assert.equal(vehicles.wreckage.seen.has(v.id),false);
    Object.assign(v,{hp:0,crushed:true,wreck:{...pose,time:2}});vehicles.update({tick:120,round:1,players:[],vehicleShots:[]},'none',0,false,{});assert.ok(vehicles.wreckage.pieces.length>0);assert.ok(vehicles.wreckage.seen.has(v.id));
  }finally{vehicles.dispose();}
});
