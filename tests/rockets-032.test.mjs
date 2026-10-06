import test from 'node:test';
import assert from 'node:assert/strict';
import {ROCKETS,MAX_VEHICLE_PROJECTILES,rocketSlot,rocketMuzzle,rocketReady,fireVehicleRocket,stepVehicleRockets,tickRocketRack,refillRocketRack} from '../src/vehicle-rockets.js';
import {rocketMeshData} from '../src/rocket-geometry.js';
import {freshVehicle,consumeShot,controls,VEHICLES} from '../src/vehicle-specs.js';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
// Explicit system ports: tests control ray hits and count the native blast calls rather than replacing physics.
function setup(kind='tank') {
 const v=freshVehicle({id:'v',kind,x:0,y:20,z:0}),p={id:'p',hp:100,team:1,vehicle:'v'};v.driver=p.id;
 const a={players:[p],events:[],map:{limit:{x:1000,z:1000}},blasts:[],blast(...args){this.blasts.push(args);}};
 const system={a,rounds:[],nextShot:0,get:id=>id===v.id?v:null,ray:(o,d,r)=>({distance:r})};
 return {v,p,a,system};
}
for(const kind of ['tank','plane']) {
 test(`${kind}: independent ammunition; conventional weapons retained`,()=>{
  const {v,p,system}=setup(kind);assert.ok(consumeShot(v));assert.ok(consumeShot(v,true));
  const a=v.ammo,mg=v.mgAmmo;assert.ok(fireVehicleRocket(system,v,p));
  assert.equal(v.rocketAmmo,ROCKETS[kind].magazine-1);assert.equal(v.ammo,a);assert.equal(v.mgAmmo,mg);
  assert.equal(system.rounds[0].weapon,'rocket');assert.equal(system.rounds[0].kind,kind);
  assert.equal(fireVehicleRocket(system,v,p),false);assert.equal(v.rocketShot,1);
 });
 test(`${kind}: alternating launcher sides and finite unit flight directions`,()=>{
  const {v}=setup(kind);for(let i=0;i<ROCKETS[kind].magazine;i++){
   const s=rocketSlot(kind,i),m=rocketMuzzle(v,i);assert.equal(s.side,i%2?1:-1);
   assert.equal(Math.sign(m.origin.x),s.side);near(Math.hypot(m.dir.x,m.dir.y,m.dir.z),1);
   assert.ok(Object.values(m.origin).every(Number.isFinite));
  }
 });
 test(`${kind}: safety guards reject dead, frozen, unseated and foreign drivers`,()=>{
  const {v,p,system}=setup(kind);
  for(const q of [{...p,hp:0},{...p,id:'other'},{...p,vehicle:null},{...p,frozen:1}])assert.equal(fireVehicleRocket(system,v,q),false);
  v.hp=0;assert.equal(rocketReady(v,p),false);assert.equal(system.rounds.length,0);
 });
 test(`${kind}: swept projectile detonates once at the near face of a thin obstacle`,()=>{
  const {v,p,system,a}=setup(kind);fireVehicleRocket(system,v,p);
  system.ray=(o,d,r)=>{const t=(12-o.z)/d.z;return t>=0&&t<=r?{distance:t,obstacle:{vehicleId:'target'}}:{distance:r};};
  for(let i=0;i<60;i++)stepVehicleRockets(system,1/60);
  assert.equal(a.blasts.length,1);assert.equal(system.rounds.length,0);
  assert.equal(a.blasts[0][5],p);assert.equal(a.blasts[0][6],'vehicle-rocket');
  assert.ok(a.blasts[0][2]<12&&a.blasts[0][2]>11.8);
 });
 test(`${kind}: bounded lifetime expires without phantom airburst`,()=>{
  const {v,p,system,a}=setup(kind);fireVehicleRocket(system,v,p);
  for(let i=0;i<400;i++)stepVehicleRockets(system,1/60);
  assert.equal(system.rounds.length,0);assert.equal(a.blasts.length,0);
 });
 test(`${kind}: mesh has finite data, unit normals, and correct length`,()=>{
  const data=rocketMeshData(kind);assert.ok(data.position.length>100);assert.equal(data.position.length,data.normal.length);
  assert.equal(data.position.length,data.color.length);assert.equal(data.uv.length,data.position.length*2/3);
  for(const a of Object.values(data))assert.ok(a.every(Number.isFinite));
  let z0=Infinity,z1=-Infinity;for(let i=0;i<data.position.length;i+=3){near(Math.hypot(...data.normal.slice(i,i+3)),1);z0=Math.min(z0,data.position[i+2]);z1=Math.max(z1,data.position[i+2]);}
  near(z1-z0,ROCKETS[kind].length);assert.ok(data.position.length/9<200);
 });
}
test('tank reloads four ready rockets from finite reserve; does not create ammo',()=>{
 const {v,p,system}=setup();let shots=0;
 for(let i=0;i<3000;i++){tickRocketRack(v,1/60);if(fireVehicleRocket(system,v,p))shots++;stepVehicleRockets(system,1/60);}
 assert.equal(shots,12);assert.equal(v.rocketAmmo,0);assert.equal(v.rocketReserve,0);assert.equal(v.rocketReload,0);
});
test('fighter has eight physical rounds and no mid-air reserve refill',()=>{
 const {v,p,system}=setup('plane');let shots=0;
 for(let i=0;i<1200;i++){tickRocketRack(v,1/60);if(fireVehicleRocket(system,v,p))shots++;stepVehicleRockets(system,1/60);}
 assert.equal(shots,8);assert.equal(v.rocketReserve,0);assert.equal(v.rocketAmmo,0);
});
test('service refill preserves launch sequence and resets rack/cooldowns',()=>{
 const {v,p,system}=setup();fireVehicleRocket(system,v,p);const shot=v.rocketShot;refillRocketRack(v);
 assert.equal(v.rocketShot,shot);assert.equal(v.rocketAmmo,4);assert.equal(v.rocketReserve,8);assert.equal(v.rocketCd,0);assert.equal(v.rocketCursor,0);
});
test('launcher muzzle is occlusion-checked before ammo or projectile allocation',()=>{
 const {v,p,system,a}=setup();system.ray=(o,d,r)=>({distance:r/2,obstacle:{}});
 for(let i=0;i<30;i++)fireVehicleRocket(system,v,p);
 assert.equal(system.rounds.length,0);assert.equal(v.rocketAmmo,4);assert.equal(a.events.length,1);assert.match(a.events[0].why,/BLOCKED/);
});
test('projectile pool limits refuse new shots without deleting live rounds or charging ammo',()=>{
 const {v,p,system}=setup();system.rounds=Array.from({length:MAX_VEHICLE_PROJECTILES},(_,id)=>({id,weapon:'cannon'}));
 const first=system.rounds[0];assert.equal(fireVehicleRocket(system,v,p),false);assert.equal(system.rounds[0],first);assert.equal(v.rocketAmmo,4);
});
test('civilian vehicles cannot fire rockets',()=>{const {v,p,system}=setup('car');assert.equal(fireVehicleRocket(system,v,p),false);assert.equal(v.rocketAmmo,0);assert.equal(rocketSlot('car',0),null);});
test('stale and non-boolean rocket input cannot fire',()=>{
 assert.equal(controls({vehicleRocket:true}).rocket,true);assert.equal(controls({vehicleRocket:'true'}).rocket,false);assert.equal(controls({vehicleRocket:true},1).rocket,false);
});
test('tank launcher follows turret rather than chassis heading',()=>{
 const {v}=setup();v.angle=.7;v.turret=2.1;v.barrel=.3;const m=rocketMuzzle(v);
 near(Math.atan2(m.dir.x,m.dir.z),2.1);near(Math.asin(m.dir.y),.3);
});
test('plane launcher pitch and roll transform consistently and inherit forward velocity',()=>{
 const {v,p,system}=setup('plane');v.angle=.8;v.pitch=.45;v.roll=.2;v.speed=35;v.airborne=true;
 const m=rocketMuzzle(v);near(Math.atan2(m.dir.x,m.dir.z),v.angle);near(Math.asin(m.dir.y),v.pitch);
 fireVehicleRocket(system,v,p);assert.ok(Math.hypot(system.rounds[0].dx,system.rounds[0].dy,system.rounds[0].dz)>ROCKETS.plane.speed);
});
test('cannon rounds are not stepped twice by the rocket subsystem',()=>{
 const {system}=setup();const r={id:1,kind:'tank',x:0,y:0,z:0,life:2};system.rounds.push(r);stepVehicleRockets(system,.05);assert.deepEqual(r,{id:1,kind:'tank',x:0,y:0,z:0,life:2});
});
test('rockets retain attribution after their shooter disconnects',()=>{
 const {v,p,system,a}=setup();fireVehicleRocket(system,v,p);a.players=[];system.ray=()=>({distance:.1,obstacle:{}});stepVehicleRockets(system,.05);
 assert.equal(a.blasts.length,1);assert.equal(a.blasts[0][5].id,'p');assert.equal(a.blasts[0][5].team,1);
});
test('very long frames are bounded, and crossing map edge removes the rocket',()=>{
 const {v,p,system,a}=setup();fireVehicleRocket(system,v,p);stepVehicleRockets(system,1);assert.ok(system.rounds[0].age<=.100001);
 a.map.limit={x:2,z:2};for(let i=0;i<20;i++)stepVehicleRockets(system,.05);assert.equal(system.rounds.length,0);
});
test('tank reload continues when driver exits but a destroyed launcher never reloads',()=>{
 const {v}=setup();v.rocketAmmo=0;v.rocketReload=5;v.driver=null;for(let i=0;i<310;i++)tickRocketRack(v,1/60);assert.equal(v.rocketAmmo,4);
 v.rocketAmmo=0;v.rocketReload=5;v.hp=0;tickRocketRack(v,10);assert.equal(v.rocketAmmo,0);
});
