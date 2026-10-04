// Actual installed Arena/Rapier and Three.js, not doubles. Required release-install gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {Arena,initPhysics} from '../src/simulation.js';
import {RocketRack,RocketFlights} from '../src/rocket-view.js';
import {ROCKETS,rocketMuzzle,refillRocketRack} from '../src/vehicle-rockets.js';
import {freshVehicle} from '../src/vehicle-specs.js';
import {NetFeed,Mirror} from '../src/netcode.js';
import {vehicleBody,syncVehicles} from '../src/vehicle-system.js';
import {updateVehicleObstacle} from '../src/vehicle-spatial.js';
for(const kind of ['tank','plane'])test(`actual Three: ${kind} rack nose/direction matches server muzzle under yaw, pitch and bank`,()=>{
 const v=freshVehicle({id:'test',kind,x:17,y:19,z:-8}),root=new T.Group(),rack=new RocketRack(root,kind);
 try{
  for(const [yaw,pitch,roll,turret,elevation] of [[0,0,0,0,0],[.9,.13,-.1,1.8,.3],[-2.3,-.15,.2,-.8,-.1]]){
   Object.assign(v,{angle:yaw,pitch,roll,turret,barrel:elevation});root.position.set(v.x,v.y,v.z);root.rotation.set(-pitch,yaw,roll,'YXZ');rack.update(v);root.updateMatrixWorld(true);
   for(let i=0;i<ROCKETS[kind].magazine;i++){
    const node=root.getObjectByName('rocket-station-'+i),expected=rocketMuzzle(v,i),point=new T.Vector3(0,0,ROCKETS[kind].length*.5+.15).applyMatrix4(node.matrixWorld);
    assert.ok(point.distanceTo(new T.Vector3(expected.origin.x,expected.origin.y,expected.origin.z))<1e-6,'server/render muzzle mismatch');
    const dir=new T.Vector3(0,0,1).transformDirection(node.matrixWorld);
    assert.ok(dir.distanceTo(new T.Vector3(expected.dir.x,expected.dir.y,expected.dir.z))<1e-6,'server/render heading mismatch');
   }
  }
  v.rocketAmmo=ROCKETS[kind].magazine-1;rack.update(v);assert.equal(root.getObjectByName('loaded-rocket-0').visible,false);assert.equal(root.getObjectByName('loaded-rocket-1').visible,true);
  refillRocketRack(v);rack.update(v);assert.ok(rack.slots.every(s=>s.missile.visible));
 }finally{rack.dispose();}
});
test('actual Three: rocket flight view reuses geometry and removes completed projectiles',()=>{
 const scene=new T.Group(),view=new RocketFlights(scene,null),r={id:1,weapon:'rocket',kind:'plane',x:0,y:20,z:0,dx:0,dy:0,dz:100,age:0};
 try{view.update([r],1/60,new T.Vector3(0,20,5));const body=view.entries.get(1).root.children[0],geo=body.geometry;
 for(let i=0;i<12;i++)view.update([{...r,z:i,age:i/60}],1/60,new T.Vector3(0,20,5));assert.equal(view.entries.get(1).root.children[0].geometry,geo);
 view.update([],1/60,new T.Vector3());assert.equal(view.entries.size,0);assert.equal(view.root.children.length,0);
 }finally{view.dispose();}
});
test('actual Arena: sanitized Q input, missile flight, native destruction and online rocket state',async()=>{
 await initPhysics();const a=new Arena({bots:0,seed:91726,mode:'debug',allowCheats:true});
 try{
  a.addPlayer('missile-test','ROCKET TEST');const p=a.players.find(p=>p.id==='missile-test');
  const tank=a.vehicles.list.find(v=>v.kind==='tank');assert.ok(tank);
  // Isolate weapon verification above the existing district, without removing any map/collision systems.
  Object.assign(tank,{x:0,y:65,z:0,angle:0,turret:0,barrel:0,driver:p.id,active:true,vy:0});
  updateVehicleObstacle(a.map,tank.obstacle,vehicleBody(tank));
  const col=a.colliders.get(tank.obstacle);col.setTranslation({x:0,y:65+2.55/2,z:0});col.setRotation({x:0,y:0,z:0,w:1});
  p.vehicle=tank.id;p.shield=0;a.vehicles.mount(p);a.physicsDirty=true;
  a.input(p.id,{vehicleRocket:'true',angle:0,turretAngle:0,turretPitch:0});assert.equal(p.input.vehicleRocket,false);
  a.input(p.id,{vehicleRocket:true,angle:0,pitch:0,turretAngle:0,turretPitch:0});
  const ammo=tank.ammo,mg=tank.mgAmmo;a.step();
  assert.equal(tank.rocketAmmo,3,'Q must reach VehicleSystem through Arena.input');assert.equal(tank.ammo,ammo);assert.equal(tank.mgAmmo,mg);
  assert.equal(a.vehicles.rounds.filter(r=>r.weapon==='rocket').length,1);
  const feed=new NetFeed(),packet=feed.packet(p.id,feed.frame(a.snapshot()));packet.commit();const state=new Mirror().apply(JSON.parse(packet.text).state);
  const remote=state.vehicles.find(v=>v.id===tank.id);assert.equal(remote.rocketAmmo,3);assert.equal(remote.rocketShot,1);assert.ok(state.vehicleShots.some(r=>r.weapon==='rocket'));
  const map={obstacles:[],vehicleSpawns:[]};syncVehicles(map,state.vehicles);assert.equal(map.vehicles.find(v=>v.id===tank.id).rocketAmmo,3);
  const shot=a.vehicles.rounds.find(r=>r.weapon==='rocket');
  const prop=Math.max(0,...a.map.obstacles.filter(o=>Number.isInteger(o.prop)).map(o=>o.prop))+1;
  const target={x:shot.x,y:shot.y,z:shot.z+15,w:5,h:5,d:.20,hp:180,part:'site',surface:'concrete',prop,color:0x888888};a.addObs(target);a.physicsDirty=true;
  for(let i=0;i<40;i++){a.input(p.id,{angle:0,pitch:0,turretAngle:0,turretPitch:0});a.step();}
  assert.ok(a.destruction.props.includes(prop),'rocket must break the actual native obstacle');assert.equal(a.colliders.has(target),false);
  assert.equal(a.vehicles.rounds.filter(r=>r.weapon==='rocket').length,0);
  const blast=a.drainEvents().filter(e=>e.type==='explosion'&&e.cause==='vehicle-rocket');assert.equal(blast.length,1,'one projectile, one native explosion');
 }finally{a.dispose();}
});
