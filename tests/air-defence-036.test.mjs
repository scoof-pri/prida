import test from 'node:test';
import assert from 'node:assert/strict';
import {freshVehicle,vehicleSpec,consumeShot} from '../src/vehicle-specs.js';
import {ROCKETS,rocketSpec,rocketSlot,rocketMuzzle,tickRocketRack,fireVehicleRocket,stepVehicleRockets,stepAirDefenseLock,turnToward,MAX_VEHICLE_PROJECTILES} from '../src/vehicle-rockets.js';
import {rayLeaf} from '../src/architecture-geometry.js';
const p={id:'pilot',hp:100,team:1,inputAge:0};
function fixture(variant='sam'){
 const v=freshVehicle({id:'launcher',kind:'tank',variant,x:0,y:0,z:0});
 const user={...p,vehicle:v.id};v.driver=user.id;v.turret=0;v.barrel=.2;
 const target=freshVehicle({id:'air',kind:'plane',x:0,y:22,z:100});Object.assign(target,{driver:'enemy',airborne:true,speed:0});
 const enemy={id:'enemy',hp:100,team:2,vehicle:target.id};
 const a={map:{limit:{x:2000,z:2000}},players:[user,enemy],events:[],blasts:[],mode:'royale',blast(...args){this.blasts.push(args);}};
 const s={a,list:[v,target],aircraft:[target],rounds:[],nextShot:0,get(id){return this.list.find(v=>v.id===id)||null;},ray(origin,dir,range){
   const hit=rayLeaf({x:target.x,y:target.y+1.43,z:target.z,w:9.4,h:2.86,t:8.8,yaw:target.angle},origin,dir,range);
   return hit?{distance:hit.distance,obstacle:{vehicleId:target.id}}:{distance:range};}};
 return {s,v,user,target,enemy};
}
function lock(f,seconds=1.25){for(let k=0;k<Math.ceil(seconds*60);k++)stepAirDefenseLock(f.s,f.v,f.user,1/60);}
test('standard vehicles keep their old ammunition and stats',()=>{
 for(const kind of ['car','tank','plane']){const v=freshVehicle({id:kind,kind});assert.equal(v.variant,null);if(ROCKETS[kind])assert.equal(rocketSpec(v),ROCKETS[kind]);}
 const v=freshVehicle({id:'t',kind:'tank',variant:'from-client'});assert.equal(v.variant,null);
});
test('HYDRA has two racks with six finite launch positions and thirty rockets total',()=>{
 const f=fixture('twin');assert.equal(rocketSpec(f.v).magazine,6);assert.equal(vehicleSpec(f.v).infiniteAmmo,false);
 const slots=Array.from({length:6},(_,i)=>rocketSlot(f.v,i));assert.equal(slots.filter(p=>p.x<0).length,3);assert.equal(slots.filter(p=>p.x>0).length,3);
 assert.equal(f.v.rocketAmmo+f.v.rocketReserve,30);
 for(let k=0;k<5;k++){
   for(let i=0;i<6;i++){f.v.rocketCd=0;f.s.rounds=[];assert.ok(fireVehicleRocket(f.s,f.v,f.user));}
   if(k<4){assert.equal(f.v.rocketReload,3.2);tickRocketRack(f.v,3.2);}
 }
 assert.equal(f.v.rocketShot,30);assert.equal(f.v.rocketAmmo+f.v.rocketReserve,0);f.v.rocketCd=0;
 assert.equal(fireVehicleRocket(f.s,f.v,f.user),false);
});
test('HYDRA expends cannon and MG ammunition and does not refill automatically',()=>{
 const f=fixture('twin');const [a,b]=[f.v.ammo,f.v.mgAmmo];
 assert.ok(consumeShot(f.v));assert.ok(consumeShot(f.v,true));assert.equal(f.v.ammo,a-1);assert.equal(f.v.mgAmmo,b-1);
 f.v.primaryCd=f.v.secondaryCd=0;f.v.ammo=f.v.mgAmmo=0;assert.equal(consumeShot(f.v),false);assert.equal(consumeShot(f.v,true),false);
});
test('HYDRA is bounded at twelve in-flight rockets and the global cap never evicts rounds',()=>{
 const f=fixture('twin');for(let mag=0;mag<2;mag++){for(let i=0;i<6;i++){f.v.rocketCd=0;assert.ok(fireVehicleRocket(f.s,f.v,f.user));}tickRocketRack(f.v,3.2);}
 f.v.rocketCd=0;assert.equal(fireVehicleRocket(f.s,f.v,f.user),false);assert.equal(f.s.rounds.length,12);
 f.s.rounds=Array.from({length:MAX_VEHICLE_PROJECTILES},(_,id)=>({id,weapon:'shell'}));assert.equal(fireVehicleRocket(f.s,f.v,f.user),false);assert.equal(f.s.rounds.length,MAX_VEHICLE_PROJECTILES);
});
test('WARDEN has finite ammunition, reloads and no invisible gun/machine-gun',()=>{
 const f=fixture();assert.equal(consumeShot(f.v),false);assert.equal(consumeShot(f.v,true),false);
 assert.equal(f.v.rocketAmmo,6);assert.equal(f.v.rocketReserve,18);f.v.rocketAmmo=0;tickRocketRack(f.v,.016);assert.equal(f.v.rocketReload,5.5);tickRocketRack(f.v,5.5);assert.equal(f.v.rocketAmmo,6);assert.equal(f.v.rocketReserve,12);
});
test('server requires held aim and a hostile airborne aircraft before SAM launch',()=>{
 const f=fixture();assert.equal(fireVehicleRocket(f.s,f.v,f.user),false);lock(f,.6);assert.ok(f.v.lockProgress>0&&f.v.lockProgress<1);assert.equal(fireVehicleRocket(f.s,f.v,f.user),false);
 lock(f,.8);assert.equal(f.v.lockTarget,'air');assert.equal(f.v.lockProgress,1);assert.ok(fireVehicleRocket(f.s,f.v,f.user));assert.equal(f.s.rounds[0].target,'air');assert.equal(f.s.rounds[0].variant,'sam');assert.equal(f.v.rocketAmmo,5);
});
for(const scenario of ['friend','grounded','wreck','outside-cone','out-of-range','occluded','stale','frozen','not-seated'])test('no acquisition: '+scenario,()=>{
 const f=fixture();
 if(scenario==='friend')f.enemy.team=1;
 if(scenario==='grounded')f.target.airborne=false;
 if(scenario==='wreck')f.target.hp=0;
 if(scenario==='outside-cone')f.target.x=120;
 if(scenario==='out-of-range')f.target.z=700;
 if(scenario==='occluded')f.s.ray=()=>({distance:10,obstacle:{part:'wall'}});
 if(scenario==='stale')f.user.inputAge=.5;
 if(scenario==='frozen')f.user.frozen=1;
 if(scenario==='not-seated')f.user.vehicle=null;
 lock(f);assert.ok(!f.v.lockTarget);assert.equal(fireVehicleRocket(f.s,f.v,f.user),false);
});
test('target leaving cone, dying or switching teams clears acquisition',()=>{
 for(const mode of ['angle','hp','team']){const f=fixture();lock(f);assert.equal(f.v.lockProgress,1);if(mode==='angle')f.v.turret=Math.PI;if(mode==='hp')f.target.hp=0;if(mode==='team')f.enemy.team=1;lock(f,.4);assert.ok(!f.v.lockTarget);}
});
test('SAM acquisition ray budget is bounded to 5 Hz for a single candidate',()=>{
 const f=fixture();let rays=0;const cast=f.s.ray;f.s.ray=(...a)=>{rays++;return cast(...a);};lock(f,10);assert.ok(rays<=50);assert.ok(rays>=40);
});
test('SAM guidance turns toward the moving aircraft and detonates through the native blast once',()=>{
 const f=fixture();lock(f);assert.ok(fireVehicleRocket(f.s,f.v,f.user));
 f.target.speed=14;f.target.angle=Math.PI/2;
 const initialX=f.s.rounds[0].dx;let turned=false;
 for(let i=0;i<420&&f.s.rounds.length;i++){f.target.x+=14/60;stepVehicleRockets(f.s,1/60);turned ||= (f.s.rounds[0]?.dx||0)>initialX+1;}
 assert.ok(turned);assert.equal(f.s.rounds.length,0);assert.equal(f.s.a.blasts.length,1);assert.equal(f.s.a.events.filter(e=>e.type==='vehicle-rocket-impact').length,1);
});
test('SAM missile hits an intervening wall, never traverses it to reach the target',()=>{
 const f=fixture();lock(f);fireVehicleRocket(f.s,f.v,f.user);
 const cast=f.s.ray;f.s.ray=(o,d,r,...args)=>o.z<35&&o.z+d.z*r>=35?{distance:(35-o.z)/d.z,obstacle:{part:'wall'}}:cast(o,d,r,...args);
 for(let i=0;i<240&&f.s.rounds.length;i++)stepVehicleRockets(f.s,1/60);
 assert.equal(f.s.a.blasts.length,1);assert.ok(Math.abs(f.s.a.blasts[0][2]-35)<.2);
});
test('target death drops tracking without retargeting a different aircraft',()=>{
 const f=fixture();lock(f);fireVehicleRocket(f.s,f.v,f.user);f.target.hp=0;stepVehicleRockets(f.s,.016);assert.equal(f.s.rounds[0].target,null);
});
test('finite turn limiter works for parallel and opposite directions',()=>{
 for(const d of [{x:1,y:0,z:0},{x:0,y:0,z:-1},{x:0,y:0,z:1}]){const out=turnToward({x:0,y:0,z:1},d,.03);assert.ok(Math.abs(Math.hypot(out.x,out.y,out.z)-1)<1e-8);assert.ok(Math.acos(Math.max(-1,Math.min(1,out.z)))<=.030001);}
});
test('variant muzzle follows turret and elevation; all positions stay finite',()=>{
 for(const variant of ['twin','sam'])for(const yaw of [0,1.4,Math.PI])for(const pitch of [0,.9,1.3]){
  const f=fixture(variant);f.v.angle=yaw;f.v.turret=yaw+.7;f.v.barrel=pitch;
  for(let i=0;i<rocketSpec(f.v).magazine;i++){const m=rocketMuzzle(f.v,i);for(const n of Object.values(m.origin))assert.ok(Number.isFinite(n));assert.ok(Math.abs(Math.hypot(...Object.values(m.dir))-1)<1e-7);}
 }
});

test('prototype property names never become vehicle or rocket variants',()=>{
 for(const variant of ['constructor','toString','__proto__']){
  const v=freshVehicle({id:'v',kind:'tank',variant});assert.equal(v.variant,null);assert.equal(rocketSpec(v),ROCKETS.tank);
  assert.equal(rocketSpec({kind:'tank',variant}),ROCKETS.tank);assert.deepEqual(rocketSlot({kind:'tank',variant},0),rocketSlot('tank',0));
 }
 assert.throws(()=>freshVehicle({id:'v',kind:'constructor'}),/Unknown/);
});
test('a finite variant still refuses a missing player',()=>{const f=fixture('twin');assert.equal(fireVehicleRocket(f.s,f.v,null),false);});
