// Isolated door logic tests. Rapier and full city generation are not claimed by this harness.
import fs from 'node:fs';
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

export {arena,actor,advance,initDoors,useDoor,stepDoors,damageDoor,doorSnapshot,syncDoors};
