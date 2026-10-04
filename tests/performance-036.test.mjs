// Work counters against the game code, with explicit physics/query doubles. NOT an FPS benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fake} from './vehicle-double-036.mjs';
import {arena as doorArena,actor,initDoors,stepDoors,useDoor,damageDoor,doorSnapshot,syncDoors,advance} from './door-double-036.mjs';
function manyDoors(count=1000){
 const a=doorArena(),d=a.map.doors[0];a.map.obstacles=[];a.colliders.clear();
 a.map.doors=Array.from({length:count},(_,id)=>({...d,id,x:id*8,panels:[],leaves:undefined}));initDoors(a);return a;
}
test('2,000 parked cars are removed from the fixed-step work set after one audit',()=>{
 const {a}=fake('car',2000);a.players=[];a.vehicles.step(1/60);
 assert.equal(a.vehicles.scheduled.size,0);
 for(let i=0;i<120;i++){a.vehicles.step(1/60);assert.equal(a.vehicles.performance.visited,0);}
 assert.equal(a.vehicles.performance.sleeping,2000);assert.equal(a.map.vehicles.length,2000);
});
test('a driven car wakes without iterating through all dormant cars',()=>{
 const {a,p,v}=fake('car',600);a.vehicles.step(1/60);assert.equal(a.vehicles.scheduled.size,0);
 assert.ok(a.vehicles.enter(p));p.input={drive:1};a.vehicles.step(1/60);
 assert.equal(a.vehicles.performance.visited,1);assert.ok(v.speed>0);for(let k=0;k<6;k++)a.vehicles.step(1/60);assert.equal(a.vehicles.movingVehicles().length,1);
});
test('a damaged dormant car wakes, remains damaged, and does not resurrect when crushed',()=>{
 const {a,v}=fake('car',200);a.players=[];a.vehicles.step(1/60);
 a.vehicles.damage(v.id,10,null);assert.ok(a.vehicles.scheduled.has(v));a.vehicles.step(1/60);assert.equal(v.hp,410);
 a.vehicles.damage(v.id,1e6,null);assert.equal(v.hp,0);a.vehicles.crush(v.id,null);
 for(let i=0;i<30;i++)a.vehicles.step(1/60);
 assert.equal(a.colliders.has(v.obstacle),false);assert.equal(a.vehicles.scheduled.has(v),false);
});
test('ordinary physicsDirty does not wake all parked cars; structural changes do',()=>{
 const {a}=fake('car',300);a.players=[];a.destruction={panels:[],buildings:[],storeys:{},props:[],roofs:[],decor:[],cells:{}};
 a.vehicles.step(1/60);a.physicsDirty=true;a.vehicles.step(1/60);assert.equal(a.vehicles.performance.visited,0);
 a.destruction.panels.push(71);a.vehicles.step(1/60);assert.equal(a.vehicles.performance.visited,300);
 a.vehicles.step(1/60);a.vehicles.step(1/60);assert.equal(a.vehicles.performance.visited,0);
});
test('nearby collider repair still works for a vehicle not scheduled for movement',()=>{
 const {a,p,v}=fake();a.vehicles.step(1/60);a.colliders.delete(v.obstacle);
 for(let i=0;i<10;i++)a.vehicles.step(1/60);
 assert.ok(a.colliders.has(v.obstacle));assert.equal(a.vehicles.scheduled.size,0);
});
test('1,000 closed doors stop per-step traversal, while one open door animates normally',()=>{
 const a=manyDoors();stepDoors(a,1/60);stepDoors(a,1/60);assert.equal(a.doorStats036.visited,0);
 const p=actor();a.players.push(p);assert.ok(useDoor(a,p));stepDoors(a,1/60);assert.equal(a.doorStats036.visited,1);
 advance(a);assert.equal(a.map.doors[0].t,1);advance(a,3);assert.equal(a.doorStats036.visited,0);
 assert.equal(doorSnapshot(a.map).length,1);assert.equal(a.colliders.size,2000);
});
test('door damage and destroyed support are included in sparse snapshots after sleeping',()=>{
 const a=manyDoors(40);stepDoors(a,1/60);damageDoor(a,33,10,null);assert.equal(doorSnapshot(a.map)[0][0],33);
 a.map.doors[34].panels=[912];a.destruction.panels.push(912);stepDoors(a,1/60);
 assert.equal(a.map.doors[34].hp,0);assert.ok(doorSnapshot(a.map).some(row=>row[0]===34&&row[4]===0));
 assert.equal(a.colliders.size,78);
});
test('a sleeping door mirror resets a closed/destroyed sparse entry and never duplicates leaves',()=>{
 const a=manyDoors(30),m={doors:a.map.doors.map(d=>({...d,leaves:undefined})),obstacles:[]};
 syncDoors(m,[]);assert.equal(m.obstacles.length,60);
 syncDoors(m,[[19,1,1,1,0]]);assert.equal(m.obstacles.length,58);
 syncDoors(m,[]);assert.equal(m.obstacles.length,60);assert.equal(m.doors[19].hp,140);
 for(let i=0;i<30;i++)syncDoors(m,[]);assert.equal(m.obstacles.length,60);
});
test('door collapse audit removes all sleeping leaves, not just moving doors',()=>{
 const a=manyDoors(100);stepDoors(a,1/60);a.map.buildings[0].collapsed=true;a.destruction.buildings=[0];
 stepDoors(a,1/60);assert.equal(a.colliders.size,0);assert.equal(doorSnapshot(a.map).length,100);
});

test('a localized support break wakes nearby cars, not every car in four sectors',()=>{
 const {a}=fake('car',300);a.players=[];a.vehicles.step(1/60);a._supportRevision036=1;a._supportChanges036=[{x:0,z:0,w:1,d:1}];
 a.vehicles.step(1/60);assert.equal(a.vehicles.performance.visited,1);
});
test('overflowed support changes or terrain updates safely fall back to a full audit',()=>{
 for(const mode of ['overflow','ground']){const {a}=fake('car',100);a.players=[];a.vehicles.step(1/60);a._supportRevision036=1;a._supportChanges036=[{x:0,z:0,w:1,d:1}];
 if(mode==='overflow')a._supportAll036=true;else a.map.terrainVersion=1;
 a.vehicles.step(1/60);assert.equal(a.vehicles.performance.visited,100);assert.equal(a._supportChanges036.length,0);}
});
