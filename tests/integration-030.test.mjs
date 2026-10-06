// This suite uses the actual installed Rapier and the complete patched Arena. The release installer runs it
// before committing its source overlay. It is deliberately one arena to bound build-server memory use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, initPhysics } from '../src/simulation.js';
import { nearestDoor } from '../src/door-system.js';
import { NetFeed, Mirror } from '../src/netcode.js';
import { VEHICLES } from '../src/vehicle-specs.js';
const close=(a,b)=>Math.abs(a-b)<.02;
test('0.30 actual Arena integration: doors, vehicle controls, collisions, damage, disconnect and POIs',async()=>{
 await initPhysics();const arena=new Arena({bots:0,seed:91726,mode:'debug',allowCheats:true});
 try{
  assert.equal(arena.map.expansion.villas.length,2);assert.ok(arena.map.siteObjects.length>100);
  assert.equal(arena.vehicles.list.filter(v=>v.kind==='tank').length,3);assert.equal(arena.vehicles.list.filter(v=>v.kind==='plane').length,2);
  assert.equal(arena.vehicles.list.filter(v=>v.variant==='twin').length,1);assert.equal(arena.vehicles.list.filter(v=>v.variant==='sam').length,1);
  arena.addPlayer('tester','TESTER');const p=arena.players.find(p=>p.id==='tester');assert.ok(p);
  assert.equal(arena.debugTravel(p.id,'fort'),true);
  const v=arena.vehicles.get('base-car'),s=VEHICLES.car;
  // Stand next to the car. This test does not depend on random normal player spawns.
  Object.assign(p,{x:v.x+s.w/2+.75,y:v.y,z:v.z,angle:-Math.PI/2,pitch:0});
  const body=arena.bodies.get(p.id);body.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);body.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});
  arena.input(p.id,{interact:true,angle:p.angle,pitch:0});arena.step();assert.equal(p.vehicle,v.id,'E must reach the vehicle system');
  const z=v.z;for(let i=0;i<45;i++){arena.input(p.id,{drive:1,steer:0,angle:0});arena.step();}
  assert.ok(v.z>z+.2,'Actual Rapier vehicle must move on the base apron');assert.ok(close(p.x,v.x)&&close(p.z,v.z));
  assert.ok(arena.snapshot().vehicles.some(q=>q.id===v.id&&q.driver===p.id));
  arena.removePlayer(p.id);assert.equal(v.driver,null,'Disconnect must release the seat');
  const tank=arena.vehicles.list.find(v=>v.kind==='tank');arena.damageObstacle(tank.obstacle,20,null);assert.equal(tank.hp,VEHICLES.tank.hp-20);
  // The complete 0.29 door initialization must still run after a fresh 0.30 installation.
  const door=arena.map.doors.find(d=>d.kind==='outer'&&d.leaves?.length);assert.ok(door);
  assert.ok(door.leaves.every(o=>arena.colliders.has(o)));
  arena.addPlayer('door-tester','DOOR TEST');const q=arena.players.find(p=>p.id==='door-tester');
  Object.assign(q,{x:door.x,z:door.z+(door.face||1)*2,y:0,hp:100,angle:door.face>0?Math.PI:0,pitch:0});
  const found=nearestDoor(arena.map,q);assert.ok(found,'Actual castMap should find an exterior door');
  const qb=arena.bodies.get(q.id);qb.body.setTranslation({x:q.x,y:q.y+.84,z:q.z},false);qb.body.setNextKinematicTranslation({x:q.x,y:q.y+.84,z:q.z});
  arena.input(q.id,{interact:true,angle:q.angle});arena.step();assert.ok(door.open,'E must activate the real door, not the old decorative leaf');
  for(let i=0;i<32;i++){arena.input(q.id,{angle:q.angle});arena.step();}assert.ok(door.t>.98,'The full collision map must allow the door to swing');
  arena.input(q.id,{interact:true,angle:q.angle});arena.step();assert.equal(door.open,false);
  for(let i=0;i<32;i++){arena.input(q.id,{angle:q.angle});arena.step();}assert.ok(door.t<.02);
  arena.damageObstacle(door.leaves[0],1000,q);assert.equal(door.hp,0);assert.equal(door.leaves.length,0);
  Object.assign(q,{x:tank.x+VEHICLES.tank.w/2+.7,y:tank.y,z:tank.z,angle:-Math.PI/2,pitch:0});
  assert.ok(arena.vehicles.enter(q));const target={x:tank.x,y:1.5,z:tank.z+13,w:2,h:3,d:.6,hp:400,part:'test-target'};arena.addObs(target);
  arena.input(q.id,{fire:true,vehicleAlt:true,angle:0});arena.step();assert.equal(tank.ammo,23);assert.ok(tank.mgAmmo<1200);
  for(let i=0;i<16;i++){arena.input(q.id,{angle:0});arena.step();}assert.ok(target.hp<400,'Cannon/MG must interact with native obstacles');
  const feed=new NetFeed(),frame=feed.frame(arena.snapshot()),packet=feed.packet(q.id,frame);packet.commit();
  const mirrored=new Mirror().apply(JSON.parse(packet.text).state);
  assert.ok(mirrored.vehicles.some(v=>v.id===tank.id&&v.driver===q.id),'Vehicle occupancy must survive the actual online packet');
  assert.ok(mirrored.doors.some(row=>row[0]===door.id&&row[4]===0),'Door destruction must survive a late-join snapshot');
 }finally{arena.dispose();}
});
