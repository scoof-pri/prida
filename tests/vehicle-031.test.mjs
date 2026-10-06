import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {VehicleCameraState} from '../src/vehicle-camera.js';
import {tankPivots,poseTankRig} from '../src/vehicle-rig.js';
import {updateVehicleObstacle} from '../src/vehicle-spatial.js';
import {prepareVehicleSpawns} from '../src/expansion-world.js';
import {expansionPlan,addExpansionPlots} from '../src/expansion-plan.js';
import {freshVehicle,vehicleDimensions} from '../src/vehicle-specs.js';
const almost=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const open=(o,d,r)=>r,ground=()=>0;
for(const kind of ['car','tank','plane'])test(`${kind}: stable camera does not drift at rest at 30/60/144 Hz`,()=>{
 const v={id:'v',kind,angle:.8,pitch:0},target={x:0,y:2,z:0},look={angle:.4,pitch:.2};
 const ref=new VehicleCameraState().step(v,target,look,0,open,ground);
 for(const hz of [30,60,144]){const cam=new VehicleCameraState();for(let frame=0;frame<hz*5;frame++)assert.deepEqual(cam.step(v,target,look,1/hz,open,ground),ref);}
});
test('vehicle camera moves with the displayed chassis at constant offset, with no pedestrian-bob feedback',()=>{
 const cam=new VehicleCameraState(),v={id:'t',kind:'tank',angle:0,pitch:0},look={angle:0,pitch:0};
 let previous=null;
 for(let frame=0;frame<240;frame++){
   const position=cam.step(v,{x:frame*.1,y:2,z:frame*.2},look,1/60,open,ground).position;
   if(previous){almost(position.x-previous.x,.1);almost(position.z-previous.z,.2);almost(position.y,previous.y);}
   previous=position;
 }
});
test('camera snaps inward before a wall and eases out without crossing the collision distance',()=>{
 const cam=new VehicleCameraState(),v={id:'t',kind:'tank',angle:0,pitch:0},p={x:0,y:2,z:0};
 const full=cam.step(v,p,{},0,open,ground).distance;
 const hit=(o,d,r)=>r<=1?r:2;
 almost(cam.step(v,p,{},1/60,hit,ground).distance,1.7);
 let last=1.7;
 for(let i=0;i<120;i++){const d=cam.step(v,p,{},1/60,open,ground).distance;assert.ok(d>=last&&d<=full);last=d;}
});
test('switching from tank to plane resets the correct follow distance immediately',()=>{
 const cam=new VehicleCameraState(),p={x:0,y:2,z:0};cam.step({id:'t',kind:'tank',angle:0},p,{},0,open,ground);
 const d=cam.step({id:'p',kind:'plane',angle:0,pitch:0},p,{},1/60,open,ground).distance;almost(d,Math.hypot(16,5));
});
test('car dimensions preserve wide vans and long buses, not a universal sedan envelope',()=>{
 assert.deepEqual(vehicleDimensions({kind:'car',bodyW:2.6,bodyH:3.1,bodyD:8.6}),{w:2.6,h:3.1,d:8.6});
});
test('all 600 parked vehicles become driveable, including previously filtered model names',()=>{
 const map={expansion:{vehicleSpawns:[{id:'tank',kind:'tank'}]},obstacles:[],decor:[]};
 for(let i=0;i<600;i++){map.decor.push({id:i,x:i*5,y:0,z:0,rot:i%2?Math.PI/2:0,model:['car-police','bus','pickup','sedan','car-delivery'][i%5]});map.obstacles.push({decor:i,part:'car',w:i%2?8:2.6,h:3,d:i%2?2.6:8});}
 prepareVehicleSpawns(map);
 assert.equal(map.vehicleSpawns.length,601);assert.equal(new Set(map.vehicleSpawns.map(v=>v.id)).size,601);
 assert.ok(map.vehicleSpawns.slice(1).every(v=>v.bodyW===2.6&&v.bodyD===8));
});
for(const limit of [{x:392,z:348},{x:392,z:358}])test(`Big Royale ${limit.z}: base gate is 18 metres from city, NOT from wilderness edge`,()=>{
 const core={x0:-192,x1:192,z0:-156,z1:156},e=expansionPlan(limit,core);
 almost(core.z0-(e.base.z+e.base.d/2),18);assert.ok(Math.abs(e.base.z)<limit.z);
 assert.ok(e.base.z-e.base.d/2> -limit.z);
 for(const item of [e.base,e.runway])assert.ok(item.z+item.d/2<core.z0);
});
test('base reservation removes overlapping wilderness generators without removing city buildings',()=>{
 const core={x0:-192,x1:192,z0:-156,z1:156};
 const park={id:0,x:-34,z:-252,w:80,d:80,type:'forest'},outside={id:1,x:240,z:220,w:60,d:60,type:'forest'};
 const town={id:2,x:-34,z:-110,w:18,d:18,type:'building',kind:{type:'villa'}};
 const map={limit:{x:392,z:348},core,plots:[park,outside,town],parks:[park,outside],paths:[],roads:[{x:-34,z:-252,w:6,d:80}]};
 addExpansionPlots(map);assert.equal(map.parks.includes(park),false);assert.equal(map.parks.includes(outside),true);assert.equal(map.plots[2],town);
 assert.equal(map.roads.length,0);assert.equal(map.plots.filter(p=>p.poi==='fort').length,3);
 const road=map.paths[0];assert.ok(road.z-road.d/2<=map.expansion.base.z+78);assert.ok(road.z+road.d/2>=core.z0);
});
test('small map keeps its former base placement; villas are not displaced',()=>{
 const e=expansionPlan({x:128,z:101});almost(e.base.z,-187);almost(e.villas[0].z,163);assert.ok(e.base.z-78>-e.limit.z);
});
function node(name,children=[],isMesh=false){return {name,children,isMesh,rotation:{x:0,y:0,z:0},traverse(fn){fn(this);for(const c of this.children)c.traverse(fn);}};}
test('external turret-only / static cannon asset is rejected rather than pretending it can aim',()=>{
 assert.equal(tankPivots(node('tank',[node('turret',[node('detail',[],true)]),node('cannon',[],true)])),null);
});
test('tank selection requires linked turret AND elevation pivot with geometry below it',()=>{
 const barrel=node('gun_elevation',[node('gun',[],true)]),turret=node('turret_pivot',[barrel]);
 const rig=tankPivots(node('tank',[turret]));assert.equal(rig.turret,turret);assert.equal(rig.barrelPivot,barrel);
 poseTankRig(rig,Math.PI/2,.2,.3);almost(turret.rotation.y,Math.PI/2-.2);almost(barrel.rotation.x,-.3);
});
test('displayed turret yaw uses the same interpolated hull orientation and wraps correctly',()=>{
 const r={turret:node('yaw'),barrelPivot:node('pitch')};
 for(const hullYaw of [-3.13,-2,0,.5,3.13]){poseTankRig(r,3.13,hullYaw,.45);almost(Math.sin(r.turret.rotation.y+hullYaw),Math.sin(3.13));almost(r.barrelPivot.rotation.x,-.45);}
});
// No Three.js / Rapier implementation is substituted silently. Query/physics doubles below count work only.
const dir=new URL('../src/',import.meta.url),url=name=>new URL(name,dir).href;
let raw=fs.readFileSync(new URL('vehicle-system.js',dir),'utf8');
for(const name of ['developer-mode.js','tank-armour.js','vehicle-rockets.js','vehicle-specs.js','architecture-geometry.js','vehicle-spatial.js','vehicle-ram.js'])raw=raw.replace(`'./${name}'`,JSON.stringify(url(name)));
raw=raw.replace("import { stepSiteStructures } from './expansion-world.js';",'function stepSiteStructures(){}')
 .replace("import { castMap } from './raycast.js';",'function castMap(o,d,r){return {distance:r,impact:null};}')
 .replace("import { rayBox } from './combat.js';",'function rayBox(){return Infinity;}')
 .replace("import { groundHeight } from './terrain.js';",'function groundHeight(){return 0;}')
 .replace("import { addObstacle, removeObstacle } from './destruction.js';",`function addObstacle(map,o){map.obstacles.push(o);map.obstacles.grid?.add(o);}function removeObstacle(map,o){const i=map.obstacles.indexOf(o);if(i>=0)map.obstacles.splice(i,1);map.obstacles.grid?.remove(o);}`);
const {VehicleSystem,syncVehicles,vehicleBody}=await import('data:text/javascript;base64,'+Buffer.from(raw).toString('base64'));
function countedMap(n=500) {
 const map={limit:{x:10000,z:1000},obstacles:[],vehicleSpawns:[],metrics:{adds:0,removes:0}};
 for(let i=0;i<n;i++){const v={id:'street-'+i,kind:'car',decor:i,model:'sedan',x:i*6,y:0,z:0,angle:0};map.vehicleSpawns.push(v);map.obstacles.push({...vehicleBody(freshVehicle(v)),part:'car',decor:i});}
 map.obstacles.grid={add(){map.metrics.adds++;},remove(){map.metrics.removes++;},query(a,b,c,d,fn){for(const o of map.obstacles)if(o.x-o.w/2<=c&&o.x+o.w/2>=a&&o.z-o.d/2<=d&&o.z+o.d/2>=b)fn(o);}};
 return map;
}
test('initial sparse empty packet still exposes every driveable car',()=>{
 const map=countedMap();syncVehicles(map,[]);assert.equal(map.vehicles.length,500);assert.equal(map._vehicleObs.size,500);assert.equal(map.obstacles.length,500);assert.ok(map.vehicles.every(v=>!v.active));
});
test('500 stationary cars across 120 frames cause zero repeated spatial-grid rewrites',()=>{
 const map=countedMap();syncVehicles(map,[]);map.metrics.adds=map.metrics.removes=0;const order=map.obstacles.slice();
 const t=performance.now();for(let i=0;i<120;i++)syncVehicles(map,[]);
 assert.ok(map.obstacles.every((o,i)=>o===order[i]));assert.equal(map.metrics.adds,0);assert.equal(map.metrics.removes,0);
 console.log('500 sleeping cars / 120 fresh empty packets:',(performance.now()-t).toFixed(2),'ms (JS counter harness only)');
});
test('one moving car updates one grid entry; identities and order of all obstacles remain unchanged',()=>{
 const map=countedMap();syncVehicles(map,[]);map.metrics.adds=map.metrics.removes=0;
 const order=map.obstacles.slice();
 const state={...freshVehicle(map.vehicleSpawns[117]),x:712,active:true,driver:'p'};
 syncVehicles(map,[state]);assert.equal(map.metrics.adds,1);assert.equal(map.metrics.removes,1);assert.ok(map.obstacles.every((o,i)=>o===order[i]));
 almost(map.vehicles.find(v=>v.id===state.id).x,712);
 map.metrics.adds=map.metrics.removes=0;for(let i=0;i<120;i++)syncVehicles(map,[{...state}]);assert.equal(map.metrics.adds,0);assert.equal(map.metrics.removes,0);
});
test('full sparse packets recover late join, lost intermediate motion, destruction and fresh round',()=>{
 const map=countedMap(3),moved={...freshVehicle(map.vehicleSpawns[1]),x:32,active:true};
 syncVehicles(map,[moved]);syncVehicles(map,[{...moved,x:41,hp:0,driver:null}]);almost(map.vehicles[1].x,41);assert.equal(map.vehicles[1].hp,0);
 syncVehicles(map,[]);almost(map.vehicles[1].x,6);assert.equal(map.vehicles[1].active,false);assert.equal(map.obstacles.length,3);
});
test('authoritative system keeps all 500 cars, but never sends 500 untouched cars each tick',()=>{
 const map=countedMap();let colliderMoves=0,queries=0;
 const arena={map,events:[],players:[],tick:0,destruction:{panels:[],props:[],buildings:[],roofs:[],storeys:{}},colliders:new Map(),blast(){},
  addObs(o){map.obstacles.push(o);this.colliders.set(o,{setTranslation(){colliderMoves++;},setRotation(){colliderMoves++;}});},removeObs(o){this.colliders.delete(o);const i=map.obstacles.indexOf(o);if(i>=0)map.obstacles.splice(i,1);},
  world:{createCharacterController(){return {setSlideEnabled(){},enableAutostep(){},enableSnapToGround(){},computeColliderMovement(){queries++;},computedMovement(){return {x:0,y:0,z:0};},computedGrounded(){return true;}}},removeCharacterController(){}}};
 const sys=arena.vehicles=new VehicleSystem(arena);arena.physicsDirty=false;
 assert.equal(sys.list.length,500);assert.equal(sys.snapshot().length,0);
 for(let i=0;i<120;i++){arena.tick++;sys.step(1/60);}
 assert.equal(queries,0);assert.equal(colliderMoves,0);
 sys.damage('street-450',50,null);assert.equal(sys.snapshot().length,1);assert.equal(sys.snapshot()[0].id,'street-450');
 sys.dispose();
});
test('turret look remains independent of car steering and is rate-limited by server math',()=>{
 // Full input-path and live Rapier tests live in integration-031.test.mjs, executed by the installer.
 const text=fs.readFileSync(new URL('vehicle-system.js',dir),'utf8');
 assert.ok(text.includes('input.turretAngle'));assert.ok(text.includes('input.turretPitch'));assert.ok(text.includes('angleDelta(v.turret,yaw)'));
});
test('crushed car packets remove collision, survive packet loss, and reset on a fresh map state',()=>{
 const map=countedMap(3),crushed={...freshVehicle(map.vehicleSpawns[1]),active:true,hp:0,crushed:true};
 syncVehicles(map,[crushed]);assert.equal(map.obstacles.length,2);assert.equal(map._vehicleObs.has(crushed.id),false);
 syncVehicles(map,[{...crushed}]);assert.equal(map.obstacles.length,2);
 syncVehicles(map,[]);assert.equal(map.obstacles.length,3);assert.equal(map.vehicles[1].crushed,false);
});
