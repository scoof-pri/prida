// Isolated door logic tests. Rapier and full city generation are not claimed by this harness.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {pathToFileURL} from 'node:url';import path from 'node:path';
import * as geometry from '../src/architecture-geometry.js';
const geometryURL=pathToFileURL(path.resolve(import.meta.dirname,'../src/architecture-geometry.js')).href;
const stubs=`import { rayLeaf, rayHulls } from '${geometryURL}';
function castMap(origin,dir,range,map){let distance=range,impact=null;for(const o of map.obstacles){const hit=o.doorLeaf?rayLeaf(o.doorLeaf,origin,dir,distance):o.roofShape?rayHulls(o.roofShape,origin,dir,distance):rayLeaf({x:o.x,y:o.y,z:o.z,w:o.w,h:o.h,t:o.d,yaw:0},origin,dir,distance);if(hit && hit.distance<distance){distance=hit.distance;impact={obstacle:o};}}return {distance,impact};}
function addObstacle(map,o){map.obstacles.push(o);}function removeObstacle(map,o){const i=map.obstacles.indexOf(o);if(i>=0)map.obstacles.splice(i,1);}
`;
const raw=fs.readFileSync(new URL('../src/door-system.js',import.meta.url),'utf8');
const code=stubs+raw.replace("import { castMap } from './raycast.js';",'').replace("import { addObstacle, removeObstacle } from './destruction.js';",'').replace("'./architecture-geometry.js'",JSON.stringify(geometryURL));
const {initDoors,useDoor,stepDoors,doorSnapshot,syncDoors,nearestDoor,damageDoor,applyBlastHits,navigationMap}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function arena(axis='x',face=1){const d={id:0,x:0,z:0,y:1.3,h:2.55,w:3.2,axis,face,building:0,kind:'outer',panels:[]};
 const a={map:{doors:[d],obstacles:[],buildings:[{}]},players:[],colliders:new Map(),destruction:{panels:[]},events:[],addCollider(o){this.colliders.set(o,{setTranslation(v){this.position=v},setRotation(v){this.rotation=v}})},removeObs(o){this.map.obstacles.splice(this.map.obstacles.indexOf(o),1);this.colliders.delete(o);},damageObstacle(o,n){o.hp-=n;}};initDoors(a);return a;}
const advance=(a,n=60)=>{for(let i=0;i<n;i++)stepDoors(a,1/60);};
const actor=(axis='x',side=1)=>({id:'p',hp:100,x:axis==='z'?side*2:0,z:axis==='x'?side*2:0,y:0,angle:axis==='x'?(side>0?Math.PI:0):(side>0?-Math.PI/2:Math.PI/2)});
for(const axis of ['x','z'])for(const side of [-1,1])test(`authoritative ${axis}/${side} opens away, animates, closes with collision`,()=>{
 const a=arena(axis),p=actor(axis,side);a.players.push(p);const d=a.map.doors[0];assert.equal(a.colliders.size,2);assert.equal(navigationMap(a.map).obstacles.length,0);
 assert.ok(useDoor(a,p));advance(a);assert.equal(d.t,1);assert.ok(d.open);
 for(const o of d.leaves)assert.ok((axis==='x'?o.z:o.x)*side<-.4);
 assert.ok(useDoor(a,p));advance(a);assert.equal(d.t,0);assert.equal(d.open,false);assert.equal(a.colliders.size,2);
});
test('interaction is rejected at a distance, through walls, and on another storey',()=>{
 const a=arena();assert.equal(useDoor(a,{...actor(),z:5}),false);assert.equal(useDoor(a,{...actor(),y:4}),false);
 a.map.obstacles.push({x:0,y:1.5,z:1,w:4,h:3,d:.2});assert.equal(useDoor(a,actor()),false);
});
test('door closing is blocked by a player in its sweep, without crushing or teleporting',()=>{
 const a=arena(),p=actor();a.players.push(p);useDoor(a,p);advance(a);
 const by={id:'other',hp:100,x:.75,z:0,y:0};a.players.push(by);
 assert.ok(useDoor(a,p));assert.equal(a.map.doors[0].open,true);assert.equal(a.events.at(-1).type,'door-blocked');advance(a);assert.equal(by.x,.75);assert.equal(by.z,0);
});
test('static objects also prevent a door from sweeping through them',()=>{
 const a=arena(),p=actor();a.players.push(p);
 a.map.obstacles.push({x:0,y:1.3,z:-.6,w:4,h:2.5,d:.35},{x:0,y:1.3,z:.6,w:4,h:2.5,d:.35});
 // Actor stands between door and obstruction, so visibility is not the rejection reason.
 p.z=.18;useDoor(a,p);assert.equal(a.map.doors[0].open,false);
});
test('a moving door reverses when somebody enters its closing path after the key press',()=>{
 const a=arena(),p=actor();a.players.push(p);useDoor(a,p);advance(a);useDoor(a,p);stepDoors(a,1/60);
 const d=a.map.doors[0],next=geometry.doorPoses(d,d.t-.06)[0];a.players.push({id:'b',hp:100,x:next.x,z:next.z,y:0});
 stepDoors(a,1/60);assert.ok(d.open);
});
test('bots open doors without requiring a forged player interaction',()=>{
 const a=arena();a.players.push({...actor(),z:1.5,bot:true});advance(a);assert.ok(a.map.doors[0].open);assert.equal(a.map.doors[0].t,1);
});
test('damage is shared by both leaves and destruction removes both colliders',()=>{
 const a=arena();damageDoor(a,0,50,{id:'p'});assert.equal(a.map.doors[0].hp,90);assert.ok(a.map.doors[0].leaves.every(o=>o.hp===90));
 damageDoor(a,0,100,{id:'p'});assert.equal(a.colliders.size,0);assert.equal(a.map.obstacles.length,0);assert.equal(a.map.doors[0].hp,0);
});
test('one blast does not damage a double door twice',()=>{
 const a=arena();applyBlastHits(a,a.map.doors[0].leaves.map(o=>[o,50]),null);assert.equal(a.map.doors[0].hp,90);
});
test('absolute sparse snapshots recover after lost packets, late join, closing and new match',()=>{
 const a=arena(),p=actor();a.players.push(p);useDoor(a,p);advance(a);
 const client={doors:[{...a.map.doors[0],leaves:undefined,t:0,open:false,hp:140}],obstacles:[]};
 const opened=JSON.parse(JSON.stringify(doorSnapshot(a.map)));syncDoors(client,opened);assert.equal(client.doors[0].t,1);assert.equal(client.obstacles.length,2);
 // Miss an intermediate closing packet; the next full sparse state still restores the closed door.
 useDoor(a,p);advance(a);syncDoors(client,doorSnapshot(a.map));assert.equal(client.doors[0].t,0);
 damageDoor(a,0,1000,null);syncDoors(client,doorSnapshot(a.map));assert.equal(client.obstacles.length,0);
 syncDoors(client,[]);assert.equal(client.doors[0].hp,140);assert.equal(client.obstacles.length,2);
});
test('building collapse removes doors and includes their destruction for a late client',()=>{
 const a=arena();a.map.buildings[0].collapsed=true;stepDoors(a,1/60);assert.equal(a.colliders.size,0);assert.equal(doorSnapshot(a.map)[0][4],0);
});
test('real exterior jambs and lintel do not prevent opening a fitted door',()=>{
 const a=arena(),p=actor();a.players.push(p);
 a.map.obstacles.push({x:-2.5,y:1.8,z:0,w:1.8,d:.4,h:3.6},{x:2.5,y:1.8,z:0,w:1.8,d:.4,h:3.6},
   {x:0,y:3.125,z:0,w:3.2,d:.4,h:.95});
 useDoor(a,p);advance(a);assert.equal(a.map.doors[0].t,1);assert.ok(!a.events.some(e=>e.type==='door-blocked'));
});
test('the use prompt requires looking towards the door rather than at the sky or behind you',()=>{
 const a=arena();assert.equal(nearestDoor(a.map,{...actor(),angle:0}),null);assert.equal(nearestDoor(a.map,{...actor(),pitch:1.4}),null);
 assert.ok(nearestDoor(a.map,actor()));
});
