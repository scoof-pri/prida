import test from 'node:test';
import assert from 'node:assert/strict';
import {freshVehicle, controls, integrateVehicle, VEHICLES, angleDelta} from '../src/vehicle-specs.js';
import {VehicleCameraState} from '../src/vehicle-camera.js';
import {ramContacts, ramAhead, syncRamRubble} from '../src/vehicle-ram.js';
const near=(a,b,eps=.001)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
function fly(hz,input,seconds=5) {
  const v=freshVehicle({id:'plane',kind:'plane',x:0,y:.07,z:0,angle:0});v.driver='pilot';
  for(let i=0;i<hz*seconds;i++){const m=integrateVehicle(v,controls(input),1/hz);v.x+=m.x;v.y+=v.airborne?m.y:0;v.z+=m.z;}
  return v;
}
for(const hz of [30,60,144])test(`W plus camera-up alone takes off and climbs at ${hz}Hz; no Space is required`,()=>{
 const v=fly(hz,{drive:1,angle:0,pitch:.4});assert.ok(v.airborne);assert.ok(v.y>10);assert.ok(v.z>60);assert.ok(v.vy>10);assert.ok(v.fuel>0);
});
test('raising the camera alone without the takeoff run never levitates an aircraft',()=>{
 const v=fly(60,{drive:0,angle:0,pitch:.72});assert.equal(v.airborne,false);near(v.y,.07);near(v.speed,0);
});
test('looking level with throttle does not force an unwanted takeoff',()=>{
 const v=fly(60,{drive:1,angle:0,pitch:0});assert.equal(v.airborne,false);near(v.y,.07);assert.ok(v.speed>VEHICLES.plane.takeoff);
});
test('an airborne aircraft pitches down, turns towards camera and banks, with bounded rates',()=>{
 const v=fly(60,{drive:1,angle:0,pitch:.4});const initial=v.y;
 for(let i=0;i<150;i++){
   const before=v.angle,m=integrateVehicle(v,controls({drive:1,angle:1.2,pitch:-.30}),1/60);
   assert.ok(Math.abs(angleDelta(before,v.angle))<=VEHICLES.plane.turn*1.16/60);
   v.y+=m.y;
 }
 assert.ok(v.vy<0);assert.ok(v.y<initial+3);near(v.angle,1.2,.02);near(v.pitch,-.30);
});
test('flight steering takes the shortest turn across the +/-pi seam',()=>{
 const v=freshVehicle({id:'p',kind:'plane',angle:Math.PI-.01});v.driver='pilot';v.speed=30;v.airborne=true;
 integrateVehicle(v,controls({drive:1,angle:-Math.PI+.02,pitch:0}),1/60);
 assert.ok(angleDelta(Math.PI-.01,v.angle)>0);assert.ok(Math.abs(angleDelta(v.angle,-Math.PI+.02))<.03);
});
test('stale flight packets stop controlling the pitch/yaw and cannot continue firing',()=>{
 const c=controls({drive:1,angle:1,pitch:.72,fire:true,vehicleAlt:true},.5);
 assert.equal(c.fire,false);assert.equal(c.alt,false);assert.equal(c.lookYaw,undefined);assert.equal(c.throttle,0);
});
test('flight camera actually looks up with the mouse but stays above its aircraft',()=>{
 const v={id:'p',kind:'plane',angle:0,pitch:.2},target={x:0,y:30,z:0};
 const shot=new VehicleCameraState().step(v,target,{angle:.4,pitch:.5},1/60,(o,d,r)=>r,()=>0);
 assert.ok(shot.at.y>shot.position.y);assert.ok(shot.position.y>target.y);near(Math.atan2(shot.at.x-shot.position.x,shot.at.z-shot.position.z),.4);
});
function fixture(objects) {
 const v={...freshVehicle({id:'tank',kind:'tank',x:0,y:.07,z:0}),speed:6,driver:'p'};
 v.obstacle={vehicleId:'tank'};
 const map={obstacles:[...objects],buildings:[],limit:{x:100,z:100}};
 let queries=0;
 map.obstacles.grid={query(x0,z0,x1,z1,fn){queries++;for(const o of map.obstacles)if(o.x+o.w/2>=x0&&o.x-o.w/2<=x1&&o.z+o.d/2>=z0&&o.z-o.d/2<=z1)fn(o);},remove(){},add(){}};
 const a={map,colliders:new Map(objects.map(o=>[o,{}])),players:[{id:'p',team:1}],events:[],destruction:{roofs:[],panels:[],props:[]},damageCalls:[],
  removeObs(o){const i=map.obstacles.indexOf(o);if(i>=0)map.obstacles.splice(i,1);this.colliders.delete(o);},
  damageObstacle(o,n){this.damageCalls.push([o,n]);o.hp-=n;if(o.hp<=0)this.breakObstacle(o);},
  breakObstacle(o){this.removeObs(o);if(o.panel!==undefined)this.destruction.panels.push(o.panel);if(o.prop!==undefined)this.destruction.props.push(o.prop);}};
 const system={a,clock:1,clearedRubble:new Set(),get(){return null;},damage(){},crush(){}};
 return {v,map,a,system,get queries(){return queries;}};
}
const forward={x:0,y:0,z:.1,oldAngle:0};
const wall=(extra={})=>({x:0,y:1.5,z:3,w:4,h:3,d:.28,hp:100,part:'wall',panel:1,...extra});
test('tank contacts are collected ahead of the collider gap, not after passing through a wall',()=>{
 const f=fixture([wall()]);assert.equal(ramContacts(f.map,f.v,forward).length,1);assert.equal(f.queries,1);
});
test('ramming delegates wall damage to native destruction and removes its collision obstacle',()=>{
 const f=fixture([wall()]);assert.equal(ramAhead(f.system,f.v,forward),true);assert.equal(f.map.obstacles.length,0);assert.equal(f.a.colliders.size,0);assert.deepEqual(f.a.destruction.panels,[1]);
});
for(const part of ['tree','rock','site','crate'])test(`tank ramming can destroy ${part} props through the native prop path`,()=>{
 const f=fixture([wall({part,prop:12,panel:undefined,hp:200})]);ramAhead(f.system,f.v,forward);assert.deepEqual(f.a.destruction.props,[12]);
});
test('ramming never deletes the supporting floor, terrain boundaries or far/overhead objects',()=>{
 const objects=[wall({y:-.15,h:.3,part:'roof'}),wall({hp:undefined,part:'boundary'}),wall({x:10}),wall({y:7})];
 const f=fixture(objects);assert.deepEqual(ramContacts(f.map,f.v,forward),[]);
});
test('stationary tank contact and ordinary cars cannot run the demolition path',()=>{
 const f=fixture([wall()]);assert.equal(ramAhead(f.system,{...f.v,speed:0},forward),false);assert.equal(ramAhead(f.system,{...f.v,kind:'car'},forward),false);assert.equal(f.a.damageCalls.length,0);
});
test('reversing a tank can ram objects behind it but not across the other side of the road',()=>{
 const f=fixture([wall({z:-3}),wall({x:12,z:-3})]);f.v.speed=-4;const found=ramContacts(f.map,f.v,{...forward,z:-.1});assert.equal(found.length,1);assert.equal(found[0].x,0);
});
test('tank sweep catches a thin fence between old and new positions at low tick rates',()=>{
 const f=fixture([wall({z:3.5,d:.04,w:2})]);const hits=ramContacts(f.map,f.v,{...forward,z:.8});assert.equal(hits.length,1);
});
test('surviving armor is damaged once per contact interval, not once per frame',()=>{
 const o=wall({hp:1e6}),f=fixture([o]);ramAhead(f.system,f.v,forward);const hp=o.hp;
 for(let i=0;i<8;i++){f.system.clock+=1/60;ramAhead(f.system,f.v,forward);}assert.equal(o.hp,hp);
 f.system.clock+=.1;ramAhead(f.system,f.v,forward);assert.ok(o.hp<hp);
});
test('both leaves of one door do not receive duplicate ram damage on the same step',()=>{
 const f=fixture([wall({x:-.7,w:1.4,doorId:0,hp:1e6}),wall({x:.7,w:1.4,doorId:0,hp:1e6})]);ramAhead(f.system,f.v,forward);assert.equal(f.a.damageCalls.length,1);
});
test('tank removes destroyed vehicle hulls rather than hitting an invisible immortal wreck',()=>{
 const o=wall({vehicleId:'car',panel:undefined}),f=fixture([o]),other={id:'car',hp:200};
 f.system.get=()=>other;f.system.damage=(id,n)=>other.hp=Math.max(0,other.hp-n);f.system.crush=()=>{other.crushed=true;f.a.removeObs(o);};
 ramAhead(f.system,f.v,forward);assert.equal(other.crushed,true);assert.equal(f.a.colliders.size,0);
});
test('ramming preserves friendly-occupied vehicle protection',()=>{
 const o=wall({vehicleId:'friend',panel:undefined}),f=fixture([o]),other={id:'friend',hp:420,driver:'q'};
 f.a.players.push({id:'q',team:1});f.system.get=()=>other;f.system.damage=()=>assert.fail('friendly damage');ramAhead(f.system,f.v,forward);assert.equal(other.hp,420);
});
test('a bulldozed rubble pile replicates collider removal AND disappearance of the rubble mesh',()=>{
 const f=fixture([wall({part:'rubble',building:3,panel:undefined,hp:undefined})]);ramAhead(f.system,f.v,forward);assert.deepEqual([...f.system.clearedRubble],[3]);
 const rubble=wall({part:'rubble',building:3,panel:undefined,hp:undefined}),map={obstacles:[rubble]},mesh={userData:{rubbleBuilding:3,appear:.9},visible:true};
 syncRamRubble(map,[3],{rubble:[mesh]});assert.equal(map.obstacles.length,0);assert.equal(mesh.visible,false);assert.equal(mesh.userData.appear,0);
 syncRamRubble(map,[3],{rubble:[mesh]});assert.equal(map.obstacles.length,0);
});
test('ram contact budget is bounded even in a dense pile of props',()=>{
 const f=fixture(Array.from({length:80},(_,i)=>wall({part:'site',prop:i})));ramAhead(f.system,f.v,forward);assert.equal(f.a.damageCalls.length,16);
});
