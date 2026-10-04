// Deployment regression using the project's real Arena, Rapier and Three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {Arena,initPhysics} from '../src/simulation.js';
import {vehicleDimensions,freshVehicle} from '../src/vehicle-specs.js';
import {vehicleBody} from '../src/vehicle-system.js';
import {VehicleViews} from '../src/vehicle-view.js';
import {ObstacleGrid} from '../src/spatial.js';
test('actual Arena: pedestrian input cannot cross a car after hull recovery',async()=>{
 await initPhysics();const a=new Arena({mode:'debug',bots:0,allowCheats:true});
 try{
  a.addPlayer('contact-qa','CONTACT QA');const p=a.players.find(p=>p.id==='contact-qa');p.cheats.god=true;
  const v=a.vehicles.list.filter(v=>v.kind==='car'&&v.decor!==undefined).sort((x,y)=>Math.hypot(x.x,x.z)-Math.hypot(y.x,y.z))[0];assert.ok(v);
  const s=vehicleDimensions(v),f={x:Math.sin(v.angle),z:Math.cos(v.angle)};
  a.place(p,v.x-f.x*(s.d/2+1.4),v.z-f.z*(s.d/2+1.4),v.y+.05);
  const c=a.colliders.get(v.obstacle);assert.ok(c?.isEnabled());c.setEnabled(false);a.world.step();a.physicsDirty=false;
  for(let i=0;i<120;i++){a.input(p.id,{x:f.x,z:f.z,angle:v.angle,pitch:0});a.step();}
  assert.ok(c.isEnabled());assert.ok((p.x-v.x)*f.x+(p.z-v.z)*f.z<0,'pedestrian crossed the car');assert.ok(a.colliders.get(v.obstacle).isValid());
 }finally{a.dispose();}
});
function fixture(){
 const v=freshVehicle({id:'camera-car',kind:'car',x:0,y:.07,z:0,bodyH:2.1}),o=vehicleBody(v),alias={...o,doorLeaf:{...o.doorLeaf},vehicleId:undefined,vehicleSpawn:v.id};
 const obstacles=[o,alias],map={limit:{x:60,z:60},hills:[],parks:[],maxTerrainHeight:.1,obstacles,_vehicleObs:new Map([[v.id,o]]),vehicles:[v]};obstacles.grid=new ObstacleGrid(obstacles,map.limit);
 const view={scene:new T.Scene(),camera:new T.PerspectiveCamera(72,16/9,.15,450),people:new Map()};return {v,map,view};
}
test('actual Three camera ignores all aliases of its own hull',()=>{
 const {v,map,view}=fixture(),vv=new VehicleViews(view,map),e={x:0,y:.07,z:0,angle:0,pitch:0,turret:0,barrel:0};
 try{for(let i=0;i<90;i++){view.camera.position.set(i,99,99);vv.camera(v,e,{angle:0,pitch:0},1/60);assert.ok(view.camera.position.z< -6);assert.ok(Number.isFinite(view.camera.position.y));}}finally{vv.dispose();}
});
test('actual Three chassis and camera share the same sampled pose',()=>{
 const {v,map,view}=fixture();v.driver='driver';const p={id:'driver',vehicle:v.id,hp:100},vv=new VehicleViews(view,map);let offset=null;
 try{for(let frame=0;frame<120;frame++){const tick=Math.floor(frame/6);v.x=tick*.4;vv.update({st:100000+tick*50,tick,players:[p],vehicleShots:[]},p.id,1/120,false,{angle:0,pitch:0});const e=vv.entries.get(v.id);assert.ok(e);const d=view.camera.position.z-e.z;if(offset===null)offset=d;assert.ok(Math.abs(d-offset)<1e-6);assert.equal(e.model.position.x,e.x);assert.ok(Math.abs(view.camera.position.x-e.x)<1e-6);}}finally{vv.dispose();}
});
test('actual Three car camera skips long-range weapon rays but keeps collision probes',()=>{
 const {v,map,view}=fixture(),vv=new VehicleViews(view,map),e={x:0,y:.07,z:0,angle:0,pitch:0,turret:0,barrel:0};
 const ranges=[],original=map.obstacles.grid.ray.bind(map.obstacles.grid);map.obstacles.grid.ray=(o,d,r,fn)=>{ranges.push(r);return original(o,d,r,fn);};
 try{for(let i=0;i<60;i++)vv.camera(v,e,{angle:0,pitch:0},1/60);assert.ok(ranges.length>0&&ranges.every(r=>r<12));assert.equal(view.vehicleGunAim,null);assert.equal(view.vehicleAim,null);}finally{vv.dispose();}
});
