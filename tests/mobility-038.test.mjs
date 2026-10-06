import test from 'node:test';import assert from 'node:assert/strict';
import {freshVehicle,vehicleSpec,integrateVehicle,controls,consumeShot} from '../src/vehicle-specs.js';
import {finishCarContact} from '../src/mobility-physics.js';
import {stepWings,stopWings} from '../src/wings-physics.js';
import {airTarget,rocketSpec,rocketMuzzle} from '../src/vehicle-rockets.js';
import {addMobilityRelief,reliefHeight} from '../src/mobility-world.js';
const spawn=kind=>Object.assign(freshVehicle({id:kind,kind,x:0,y:.07,z:0}),{driver:'p',_grounded:true});
const step=(v,c={},n=1,dt=1/60)=>{for(let i=0;i<n;i++){const m=integrateVehicle(v,{throttle:0,steer:0,climb:0,brake:false,...c},dt);v.x+=m.x;v.y+=m.y;v.z+=m.z;if(!v.airborne){v.y=.07;v.vy=0;}}};
for(const hz of[30,60,120])test('car drift retains lateral momentum and releases progressively at '+hz+'Hz',()=>{
 const v=spawn('car');step(v,{throttle:1},hz*3,1/hz);assert.ok(v.speed>20);
 step(v,{throttle:1,steer:1,brake:true},Math.round(hz*.7),1/hz);assert.equal(v.drifting,true);assert.ok(Math.abs(v.slip)>.12);
 const old=v.slip;step(v,{throttle:1},1,1/hz);assert.ok(Math.abs(v.slip)>0);assert.ok(Math.abs(v.slip)<Math.abs(old));
 step(v,{throttle:1},hz,1/hz);assert.ok(Math.abs(v.slip)<.02);
});
test('airborne car cannot change its trajectory into a ground-steering turn',()=>{
 const v=spawn('car');Object.assign(v,{airborne:true,_grounded:false,vx:0,vz:20,speed:20,vy:6});
 step(v,{throttle:1,steer:1,climb:1},30);assert.ok(Math.abs(v.x)<1e-6);assert.ok(v.z>9);assert.ok(v.vy<0);assert.ok(v.angle<0);
});
test('ramp contact preserves upward velocity at takeoff without a jump button',()=>{
 const v=spawn('car');v.angle=0;finishCarContact(v,{x:0,y:.08,z:.33},1/60,true,true,0);
 assert.ok(v.rampVelocity>.6);finishCarContact(v,{x:0,y:-.004,z:.33},1/60,true,false,-.3);
 assert.equal(v.airborne,true);assert.ok(v.vy>0);assert.ok(v.vy<14);
});
test('curb autostep and a stationary contact do not launch a car',()=>{
 const v=spawn('car');finishCarContact(v,{x:0,y:.22,z:.08},1/60,true,true,0);
 assert.equal(v.rampVelocity,0);finishCarContact(v,{x:0,y:-.1,z:.08},1/60,true,false,-2);assert.equal(v.vy,0);
});
test('hard landing damage is bounded and soft landing has none',()=>{
 const v=spawn('car');assert.equal(finishCarContact(v,{x:0,y:-.05,z:0},1/60,false,true,-3),0);
 assert.ok(finishCarContact(v,{x:0,y:-.2,z:0},1/60,false,true,-15)>0);
 assert.ok(finishCarContact(v,{x:0,y:-.2,z:0},1/60,false,true,-100)<=250);
});
for(const hz of[30,60,120])test('helicopter spools, climbs, then hovers at '+hz+'Hz',()=>{
 const v=spawn('helicopter');step(v,{climb:1},Math.round(.4*hz),1/hz);assert.equal(v.airborne,false);
 step(v,{climb:1},hz*3,1/hz);assert.equal(v.airborne,true);assert.ok(v.y>10);
 step(v,{climb:0},hz*2,1/hz);const y=v.y;step(v,{},hz*2,1/hz);assert.ok(Math.abs(v.y-y)<.01);
});
test('helicopter does not slide around the airfield merely by holding W',()=>{const v=spawn('helicopter');step(v,{throttle:1},180);assert.equal(v.airborne,false);assert.equal(v.z,0);});
test('helicopter diagonal speed is normalized and stale controls stop translation',()=>{
 const v=spawn('helicopter');v.airborne=true;v._grounded=false;v.engine=1;
 step(v,{throttle:1,steer:1},400);assert.ok(v.speed<=vehicleSpec(v).max+.01);
 step(v,controls({drive:1,steer:1,ascend:1},1),240);assert.ok(v.speed<.02);assert.ok(Math.abs(v.vy)<.02);
});
test('empty helicopter and fuel exhaustion descend rather than hovering forever',()=>{for(const field of['driver','fuel']){const v=spawn('helicopter');v.airborne=true;v._grounded=false;v.y=40;v.engine=1;v[field]=field==='driver'?null:0;step(v,{climb:1},60);assert.ok(v.vy<-10);assert.ok(v.y<35);}});
test('helicopter has finite independent gun and rocket stores',()=>{const v=spawn('helicopter');assert.equal(consumeShot(v,false),false);assert.equal(consumeShot(v,true),true);assert.equal(v.mgAmmo,899);assert.equal(v.rocketAmmo+v.rocketReserve,12);assert.equal(rocketSpec(v).magazine,6);});
test('air defence recognizes an airborne hostile helicopter but not a friendly or grounded one',()=>{const v=spawn('helicopter'),p={id:'gunner',team:1},a={id:'sam'},s={a:{players:[{id:'p',team:2}]}};v.airborne=true;assert.equal(airTarget(s,v,a,p),true);s.a.players[0].team=1;assert.equal(airTarget(s,v,a,p),false);s.a.players[0].team=2;v.airborne=false;assert.equal(airTarget(s,v,a,p),false);});
test('helicopter launcher positions and forward directions remain finite at yaw seams',()=>{const v=spawn('helicopter');for(const yaw of[-Math.PI,0,Math.PI])for(let i=0;i<6;i++){Object.assign(v,{angle:yaw,pitch:.2,roll:-.2});const m=rocketMuzzle(v,i);assert.ok(Object.values(m.origin).every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...Object.values(m.dir))-1)<1e-8);}});
const pilot=()=>({id:'p',hp:100,gear:{id:'wings'},x:0,y:70,z:0,angle:0,vy:-4,moving:12,grounded:false});
test('KITE requires actual gear, altitude and deliberate activation',()=>{for(const change of[{gear:null},{grounded:true},{hp:0},{vehicle:'car'},{inBus:true},{frozen:2}]){const p={...pilot(),...change};assert.equal(stepWings(p,{ascend:1},1/60,60),null);}assert.equal(stepWings(pilot(),{ascend:0},1/60,60),null);assert.equal(stepWings(pilot(),{ascend:1},1/60,1),null);});
test('KITE dives for speed, and sustained nose-up stalls instead of creating powered flight',()=>{
 const p=pilot();for(let i=0;i<120;i++){p.vy-=22/60;stepWings(p,{ascend:1,pitch:-.65},1/60,80);}const fast=p.wingSpeed;assert.ok(fast>16);
 for(let i=0;i<600;i++){p.vy-=22/60;stepWings(p,{ascend:1,pitch:.46},1/60,80);}assert.ok(p.wingSpeed<fast);assert.ok(p.vy<0);
});
test('releasing KITE cancels its momentum state and reset cannot leak into another life',()=>{const p=pilot();stepWings(p,{ascend:1,pitch:0},1/60,80);assert.equal(p.wingsOpen,true);assert.equal(stepWings(p,{ascend:0},1/60,80),null);assert.equal(p.wingsOpen,false);assert.equal(p.wingSpeed,0);stopWings(p);assert.equal(p.wingSpeed,0);});
test('localized relief is deterministic, dry hills and basins taper smoothly to flat roads',()=>{
 const m={size:'city',seed:91726,terrainFeatures:[],parks:Array.from({length:8},(_,i)=>({x:100+i*60,z:100,w:50,d:54,type:'forest'}))};addMobilityRelief(m);assert.equal(m.terrainFeatures.length,8);assert.ok(m.terrainFeatures.some(f=>f.kind==='basin'));
 for(const f of m.terrainFeatures){assert.ok(Number.isFinite(reliefHeight(f,f.x,f.z)));assert.equal(reliefHeight(f,f.x+f.rx,f.z),0);assert.ok(Math.abs(reliefHeight(f,f.x+f.rx-.001,f.z))<.000001);}
 const a=JSON.stringify(m.terrainFeatures);addMobilityRelief(m);assert.equal(JSON.stringify(m.terrainFeatures),a);
});
test('new relief preserves city buildings and base reservation',()=>{const m={size:'city',seed:1,terrainFeatures:[],parks:[{x:0,z:0,w:80,d:80,type:'forest'},{x:200,z:200,w:80,d:80,type:'forest'}],core:{x0:-50,x1:50,z0:-50,z1:50},expansion:{base:{x:200,z:200,w:160,d:160}}};addMobilityRelief(m);assert.equal(m.terrainFeatures.length,0);});
