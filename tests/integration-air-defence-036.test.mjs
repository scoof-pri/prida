// Required installation gate: actual installed Three.js and complete Arena, not the local rule doubles.
import test from 'node:test';import assert from 'node:assert/strict';
import * as T from 'three';
import {Arena,initPhysics} from '../src/simulation.js';
import {freshVehicle,vehicleDimensions} from '../src/vehicle-specs.js';
import {vehicleModel,animateVehicle,disposeVehicleModel} from '../src/vehicle-models.js';
import {RocketRack} from '../src/rocket-view.js';
import {rocketSpec,rocketMuzzle} from '../src/vehicle-rockets.js';
import {vehicleBody,syncVehicles} from '../src/vehicle-system.js';
import {updateVehicleObstacle} from '../src/vehicle-spatial.js';
import {NetFeed,Mirror} from '../src/netcode.js';
for(const variant of ['twin','sam'])test(`actual Three: ${variant} finite animated rig, instanced rack and server muzzle alignment`,()=>{
 const v=freshVehicle({id:'rig',kind:'tank',variant,x:3,y:4,z:5}),root=vehicleModel('tank',null,v),rack=new RocketRack(root,v);
 try{
  assert.equal(rack.batches.length,5);assert.equal(rack.slots.length,rocketSpec(v).magazine);
  for(const [yaw,barrel] of [[0,0],[.8,.55],[-2,.9]]){
   Object.assign(v,{angle:.2,turret:yaw,barrel});root.position.set(v.x,v.y,v.z);root.rotation.set(0,v.angle,0,'YXZ');animateVehicle(root,v,1/60);rack.update(v);root.updateMatrixWorld(true);
   for(let slot=0;slot<rack.slots.length;slot++){
    const node=root.getObjectByName('rocket-station-'+slot),m=rocketMuzzle(v,slot);
    const tip=new T.Vector3(0,0,rocketSpec(v).length/2+.15).applyMatrix4(node.matrixWorld);
    assert.ok(tip.distanceTo(new T.Vector3(m.origin.x,m.origin.y,m.origin.z))<1e-5);
   }
   root.traverse(o=>{if(o.isMesh)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));});
   assert.ok(Math.abs(root.userData.rig.turret.rotation.y-(yaw-.2))<1e-5);
  }
  if(variant==='sam'){assert.equal(root.userData.rig.barrelPivot.visible,false);assert.ok(root.userData.rig.radar);}
  else {v.rocketAmmo=rocketSpec(v).magazine;for(let k=0;k<16;k++){v.rocketShot++;rack.update(v);}assert.ok(rack.slots.every(s=>s.missile.visible));}
 }finally{rack.dispose();disposeVehicleModel(root);}
});
function positionVehicle(a,v,patch){
 Object.assign(v,patch,{active:true,_changed:true});updateVehicleObstacle(a.map,v.obstacle,vehicleBody(v));
 const p=v.obstacle.doorLeaf,c=a.colliders.get(v.obstacle);assert.ok(c&&!Array.isArray(c));
 c.setTranslation({x:p.x,y:p.y,z:p.z});c.setRotation({x:0,y:Math.sin(v.angle/2),z:0,w:Math.cos(v.angle/2)});a.vehicles.wake(v);a.physicsDirty=true;
}
test('actual Arena: guided target is server-selected, firing is manual, and packets retain lock/projectile state',async()=>{
 await initPhysics();const a=new Arena({seed:91726,bots:0,mode:'debug',allowCheats:true});
 try{
  a.addPlayer('aa','AA');a.addPlayer('air','AIR');const p=a.players.find(p=>p.id==='aa'),e=a.players.find(p=>p.id==='air');p.team=1;e.team=2;
  const sam=a.vehicles.list.find(v=>v.variant==='sam'),plane=a.vehicles.list.find(v=>v.kind==='plane');assert.ok(sam&&plane);
  // Isolate targeting above the city while keeping the actual Arena input/physics/network path intact.
  positionVehicle(a,sam,{x:0,y:80,z:0,angle:0,turret:0,barrel:.28,driver:p.id,vy:0});
  positionVehicle(a,plane,{x:0,y:110,z:100,angle:0,pitch:0,driver:e.id,airborne:true,speed:30,vy:0});
  p.vehicle=sam.id;e.vehicle=plane.id;a.vehicles.mount(p);a.vehicles.mount(e);a.world.step();
  for(let i=0;i<110;i++){
   const pitch=Math.atan2(plane.y+1.4-(sam.y+2.5),plane.z-sam.z);
   a.input(p.id,{angle:0,pitch,turretAngle:0,turretPitch:pitch,drive:0,vehicleRocket:false,targetId:'forged',lockTarget:'forged'});
   a.input(e.id,{angle:0,pitch:0,drive:1});a.step();
  }
  assert.equal(p.input.targetId,undefined);assert.equal(p.input.lockTarget,undefined);assert.equal(sam.lockTarget,plane.id);assert.equal(sam.lockProgress,1);
  assert.equal(a.vehicles.rounds.filter(r=>r.vehicle===sam.id).length,0,'tracking alone must never fire');
  a.input(p.id,{...p.input,vehicleRocket:true});a.input(e.id,{angle:0,pitch:0,drive:1});a.step();
  const shot=a.vehicles.rounds.find(r=>r.vehicle===sam.id&&r.weapon==='rocket');assert.ok(shot);assert.equal(shot.target,plane.id);assert.equal(sam.rocketAmmo,5);
  const feed=new NetFeed(),packet=feed.packet(p.id,feed.frame(a.snapshot()));packet.commit();const state=new Mirror().apply(JSON.parse(packet.text).state);
  assert.equal(state.vehicles.find(v=>v.id===sam.id).variant,'sam');assert.equal(state.vehicles.find(v=>v.id===sam.id).lockTarget,plane.id);
  assert.equal(state.vehicleShots.find(r=>r.id===shot.id).target,plane.id);
  const mirror={obstacles:[],vehicleSpawns:[]};syncVehicles(mirror,state.vehicles);assert.equal(mirror.vehicles.find(v=>v.id===sam.id).variant,'sam');
  e.team=p.team;a.input(p.id,{...p.input,vehicleRocket:true});a.step();assert.equal(sam.lockTarget,null);
 }finally{a.dispose();}
});
test('actual Arena: HYDRA has finite ammunition without bypassing global projectile budget',async()=>{
 await initPhysics();const a=new Arena({seed:91726,bots:0,mode:'debug',allowCheats:true});
 try{
  a.addPlayer('hydra','HYDRA');const p=a.players.find(p=>p.id==='hydra'),v=a.vehicles.list.find(v=>v.variant==='twin');assert.ok(v);
  positionVehicle(a,v,{x:0,y:95,z:0,angle:0,turret:0,barrel:.15,driver:p.id});p.vehicle=v.id;a.vehicles.mount(p);a.world.step();
  const ammo=v.ammo;
  for(let i=0;i<60;i++){a.input(p.id,{angle:0,pitch:.15,turretAngle:0,turretPitch:.15,vehicleRocket:true,fire:true});a.step();}
  assert.ok(v.rocketShot>=5);assert.equal(v.rocketAmmo+v.rocketReserve+v.rocketShot,30);assert.ok(v.ammo<ammo);
  assert.ok(a.vehicles.rounds.length<=64);assert.ok(a.vehicles.rounds.filter(r=>r.weapon==='rocket'&&r.vehicle===v.id).length<=12);
  assert.ok(a.snapshot().vehicles.some(s=>s.id===v.id&&s.variant==='twin'));
 }finally{a.dispose();}
});
