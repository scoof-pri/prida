import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {wedgeData} from '../src/vehicle-geometry.js';
import {VEHICLES,freshVehicle,controls,integrateVehicle,consumeShot,angleDelta} from '../src/vehicle-specs.js';
import {expansionPlan,addExpansionPlots} from '../src/expansion-plan.js';
import {addExpansionProps,prepareVehicleSpawns} from '../src/expansion-world.js';
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`);
for(const kind of ['car','tank','plane'])test(`${kind}: bounded acceleration, fuel and stale-input braking`,()=>{
 const v=freshVehicle({id:'v',kind,x:0,y:.07,z:0});v.driver='p';
 for(let i=0;i<300;i++)integrateVehicle(v,controls({drive:1,steer:0}),1/60);
 assert.ok(v.speed>0&&v.speed<=VEHICLES[kind].max);assert.ok(v.fuel<VEHICLES[kind].fuel);
 const old=v.speed;for(let i=0;i<60;i++)integrateVehicle(v,controls({drive:1,fire:true},1),1/60);
 assert.ok(v.speed<old);assert.ok(v.fuel>=0);assert.equal(controls({fire:true,vehicleAlt:true},1).fire,false);
});
test('invalid controls never introduce NaN or an out-of-range throttle',()=>{
 const c=controls({drive:Infinity,steer:'right',ascend:NaN,fire:'yes'});assert.equal(c.throttle,0);assert.equal(c.fire,false);
 const d=controls({drive:1000,steer:-500});assert.equal(d.throttle,1);assert.equal(d.steer,-1);
});
test('cannon and machine gun have independent ammunition, cooldowns and overheat',()=>{
 const v=freshVehicle({id:'t',kind:'tank'});v.driver='a';assert.equal(consumeShot(v),true);assert.equal(v.ammo,23);assert.equal(consumeShot(v),false);
 assert.equal(consumeShot(v,true),true);assert.equal(v.mgAmmo,1199);assert.equal(consumeShot(v,true),false);
 for(let i=0;i<70;i++){v.secondaryCd=0;consumeShot(v,true);}assert.equal(v.overheated,true);
 const left=v.mgAmmo;assert.equal(consumeShot(v,true),false);assert.equal(v.mgAmmo,left);
 for(let i=0;i<400;i++)integrateVehicle(v,controls({}),1/60);assert.equal(v.overheated,false);
 v.ammo=0;v.primaryCd=0;assert.equal(consumeShot(v),false);assert.equal(v.ammo,0);
});
test('a civilian car cannot fire or create negative ammunition',()=>{const v=freshVehicle({id:'c',kind:'car'});v.driver='a';assert.equal(consumeShot(v),false);assert.equal(consumeShot(v,true),false);assert.equal(v.ammo,0);});
test('a fighter needs takeoff speed, then climbs and stalls with no lift',()=>{
 const v=freshVehicle({id:'f',kind:'plane'});v.driver='a';integrateVehicle(v,controls({ascend:1}),1/60);assert.equal(v.airborne,false);
 for(let i=0;i<200;i++)integrateVehicle(v,controls({drive:1,ascend:1}),1/60);
 assert.equal(v.airborne,true);assert.ok(v.vy>0);
 v.speed=7;v.fuel=0;for(let i=0;i<100;i++)integrateVehicle(v,controls({}),1/60);assert.ok(v.vy<0);
});
test('steering wraps continuously across the angle seam',()=>{near(angleDelta(Math.PI-.01,-Math.PI+.01),.02);});
for(const size of [{x:128,z:101},{x:392,z:348}])test(`expansion ${size.x}: exactly two villas and bounded runway/base outside old city`,()=>{
 const e=expansionPlan(size);assert.equal(e.villas.length,2);assert.ok(e.base.z+e.base.d/2 < -size.z);
 for(const p of [e.base,...e.villas,e.runway]){assert.ok(Math.abs(p.x)+p.w/2<e.limit.x);assert.ok(Math.abs(p.z)+p.d/2<e.limit.z);}
 const map={limit:{...size},plots:[],paths:[],buildings:[],obstacles:[],chests:[],decor:[]};addExpansionPlots(map);
 const saved=JSON.stringify(map);addExpansionPlots(map);assert.equal(JSON.stringify(map),saved);
 assert.equal(map.plots.filter(p=>p.kind.type==='villa').length,2);assert.ok(map.plots.every(p=>p.kind.poi));
 addExpansionProps(map);prepareVehicleSpawns(map);
 assert.equal(map.vehicleSpawns.filter(v=>v.kind==='tank').length,3);assert.equal(map.vehicleSpawns.filter(v=>v.variant==='twin').length,1);assert.equal(map.vehicleSpawns.filter(v=>v.variant==='sam').length,1);assert.equal(map.vehicleSpawns.filter(v=>v.kind==='plane').length,2);
 assert.equal(new Set(map.vehicleSpawns.map(v=>v.id)).size,map.vehicleSpawns.length);
 assert.ok(map.siteObjects.length>100);assert.ok(map.chests.length>=5);
 for(const o of map.obstacles)for(const k of ['x','y','z','w','h','d'])assert.ok(Number.isFinite(o[k])&&(!['w','h','d'].includes(k)||o[k]>0));
});
// This harness tests vehicle rules with explicit simple physics/query doubles, not the complete Rapier game.
const geometryURL=pathToFileURL(new URL('../src/architecture-geometry.js',import.meta.url).pathname).href;
const specURL=pathToFileURL(new URL('../src/vehicle-specs.js',import.meta.url).pathname).href;
const raw=fs.readFileSync(new URL('../src/vehicle-system.js',import.meta.url),'utf8');
const stubs=`
function groundHeight(){return 0;}
function addObstacle(map,o){map.obstacles.push(o);}
function removeObstacle(map,o){const i=map.obstacles.indexOf(o);if(i>=0)map.obstacles.splice(i,1);}
function castMap(origin,dir,range,map,ignore){
 if(dir.y<-.99)return {distance:Math.min(range,Math.max(0,origin.y)),impact:null};
 return {distance:range,impact:null};
}
function rayBox(){return Infinity;}
`;
const spatialURL=new URL('../src/vehicle-spatial.js',import.meta.url).href;
const code=stubs+raw.replace("'./developer-mode.js'",JSON.stringify(new URL('../src/developer-mode.js',import.meta.url).href)).replace("'./tank-armour.js'",JSON.stringify(new URL('../src/tank-armour.js',import.meta.url).href)).replace("'./vehicle-rockets.js'",JSON.stringify(new URL('../src/vehicle-rockets.js',import.meta.url).href)).replace("'./vehicle-ram.js'",JSON.stringify(new URL('../src/vehicle-ram.js',import.meta.url).href)).replace("'./vehicle-spatial.js'",JSON.stringify(spatialURL)).replace("import { stepSiteStructures } from './expansion-world.js';",'function stepSiteStructures(){}').replace("import { castMap } from './raycast.js';",'').replace("import { rayBox } from './combat.js';",'').replace("import { groundHeight } from './terrain.js';",'').replace("import { addObstacle, removeObstacle } from './destruction.js';",'').replace("'./vehicle-specs.js'",JSON.stringify(specURL)).replace("'./architecture-geometry.js'",JSON.stringify(geometryURL));
const {VehicleSystem,syncVehicles}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function actor(id='p'){return {id,x:2,y:0,z:0,hp:100,team:1,angle:-Math.PI/2,stamina:100,input:{},inputAge:0};}
function fake(kind='car') {
 const p=actor(),map={limit:{x:200,z:300},vehicleSpawns:[{id:'v',kind,x:0,y:.07,z:0}],obstacles:[],expansion:{services:[{x:0,z:0,r:8}]}};
 map.obstacles.grid={add(){},remove(){},query(x0,z0,x1,z1,f){for(const o of map.obstacles)if(o.x+o.w/2>=x0&&o.x-o.w/2<=x1&&o.z+o.d/2>=z0&&o.z-o.d/2<=z1)f(o);}};
 const body=()=>({collider:{enabled:true,setEnabled(v){this.enabled=v;}},body:{setTranslation(p){this.p=p;},setNextKinematicTranslation(){}}});
 const a={map,players:[p],tick:1,bodies:new Map([[p.id,body()]]),colliders:new Map(),events:[],random:()=>.5,blasts:[],
 world:{createCharacterController(){return {setSlideEnabled(){},enableAutostep(){},enableSnapToGround(){},computeColliderMovement(c,m){this.m={x:m.x,y:m.y,z:m.z};},computedMovement(){return this.m;},computedGrounded(){return false;}};},removeCharacterController(){}},
 addCollider(o){this.colliders.set(o,{setTranslation(p){this.p=p;},setRotation(q){this.q=q;}});},
 addObs(o){map.obstacles.push(o);this.addCollider(o);},removeObs(o){this.colliders.delete(o);const i=map.obstacles.indexOf(o);if(i>=0)map.obstacles.splice(i,1);},
 damage(by,v,n){v.hp=Math.max(0,v.hp-n);},damageObstacle(o,n){if(o.vehicleId)this.vehicles.damage(o.vehicleId,n,null);},blast(...args){this.blasts.push(args);},bosses:{ray(){return null;}}};
 a.vehicles=new VehicleSystem(a);return {a,p,v:a.vehicles.list[0],body};
}
test('only one driver can occupy a vehicle; collider restores on exit',()=>{
 const {a,p,v,body}=fake();assert.ok(a.vehicles.enter(p));assert.equal(v.driver,'p');assert.equal(a.bodies.get('p').collider.enabled,false);
 const q=actor('q');a.players.push(q);a.bodies.set(q.id,body());assert.equal(a.vehicles.enter(q),false);
 a.tick=50;assert.ok(a.vehicles.exit(p));assert.equal(p.vehicle,null);assert.equal(v.driver,null);assert.equal(a.bodies.get('p').collider.enabled,true);
});
test('leaving a fast car is refused until it slows down',()=>{const {a,p,v}=fake();a.vehicles.enter(p);a.tick=50;v.speed=15;assert.ok(a.vehicles.exit(p));assert.equal(p.vehicle,'v');assert.equal(a.events.at(-1).type,'vehicle-blocked');});
test('disconnect and forced exit release both occupancy and player collision',()=>{const {a,p,v}=fake();a.vehicles.enter(p);a.vehicles.detach(p.id);assert.equal(v.driver,null);assert.equal(p.vehicle,null);assert.equal(a.bodies.get(p.id).collider.enabled,true);});
test('aircraft bailout starts a high-altitude falling/glider state rather than teleporting to ground',()=>{const {a,p,v}=fake('plane');p.x=5;a.vehicles.enter(p);v.y=85;v.airborne=true;a.vehicles.mount(p);a.vehicles.exit(p,{force:true});assert.ok(p.y>85);assert.equal(p.dropping,true);assert.equal(p.vehicle,null);});
test('servicing is latched from one R press and requires a stopped vehicle at a marked pad',()=>{
 const {a,p,v}=fake();a.vehicles.enter(p);v.hp=80;v.fuel=10;p.input={reload:true};a.vehicles.step(1/60);p.input={};
 for(let i=0;i<185;i++){a.tick++;a.vehicles.step(1/60);}assert.equal(v.hp,VEHICLES.car.hp);near(v.fuel,VEHICLES.car.fuel,.1);
 assert.ok(a.events.some(e=>e.type==='vehicle-serviced'));
});
test('destroyed vehicle cannot keep firing; a wreck preserves solid cover and ejects the driver',()=>{
 const {a,p,v}=fake('tank');p.x=2.2;a.vehicles.enter(p);a.vehicles.damage(v.id,10000,null);
 assert.equal(v.hp,0);assert.equal(v.driver,null);assert.equal(p.vehicle,null);assert.ok(a.colliders.has(v.obstacle));assert.equal(consumeShot(v),false);
});
test('absolute vehicle snapshots are safe for late join and remove stale decorative-car colliders',()=>{
 const {a}=fake();const old={part:'car',decor:3},map={obstacles:[old]},states=a.vehicles.snapshot();states[0].decor=3;
 syncVehicles(map,states);assert.equal(old.part,'vehicle','parked obstacle identity is reused in place');assert.equal(map.obstacles.length,1);
 states[0].x=12;syncVehicles(map,structuredClone(states));assert.equal(map.obstacles.length,1);assert.equal(map.obstacles[0].x,12);
 syncVehicles(map,[]);assert.equal(map.obstacles.length,0);
});
test('friendly driver protection is enforced on the server',()=>{const {a,p,v}=fake();a.vehicles.enter(p);a.vehicles.damage('v',80,{id:'teammate',team:p.team});assert.equal(v.hp,VEHICLES.car.hp);});
test('rotations are rejected when an obstacle intersects the swept footprint',()=>{const {a,p,v}=fake();a.vehicles.enter(p);a.map.obstacles.push({x:1.35,y:1,z:1.3,w:.5,h:2,d:.5});assert.equal(a.vehicles.rotationFree(v,Math.PI/4),false);});
test('no client coordinates or speed fields can teleport a vehicle',()=>{
 const {a,p,v}=fake();a.vehicles.enter(p);p.input={drive:1,x:1e9,z:-1e9,speed:1e9};a.vehicles.step(1/60);assert.ok(Math.abs(v.x)<1);assert.ok(Math.abs(v.z)<1);assert.ok(v.speed<1);
});

test('native explosions damage the vehicle hull once, not the invisible seated driver as well',()=>{
 const {a,p,v}=fake('tank');p.x=2.2;a.vehicles.enter(p);a._vehicleBlastDepth=1;
 assert.equal(a.vehicles.damageMounted(p,80,{id:'enemy',team:2}),true);assert.equal(v.hp,VEHICLES.tank.hp);
 a._vehicleBlastDepth=0;assert.equal(a.vehicles.damageMounted(p,80,{id:'enemy',team:2}),true);assert.equal(v.hp,VEHICLES.tank.hp-64);
});

test('fallback vehicle hulls have outward triangle winding rather than invisible reversed faces',()=>{
 const {positions:v,indices:i}=wedgeData(3,1,5);const p=k=>v.slice(k*3,k*3+3);
 const centre=[0,0,0];for(let k=0;k<v.length;k++)centre[k%3]+=v[k]/(v.length/3);
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],sub=(a,b)=>a.map((x,k)=>x-b[k]);
 for(let k=0;k<i.length;k+=3){const a=p(i[k]),b=p(i[k+1]),c=p(i[k+2]),n=cross(sub(b,a),sub(c,a));assert.ok(n.reduce((s,x,j)=>s+x*(centre[j]-a[j]),0)<0);}
});
