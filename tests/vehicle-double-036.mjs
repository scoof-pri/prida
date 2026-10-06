import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
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
function fake(kind='car',count=1) {
 const p=actor(),map={limit:{x:200,z:300},vehicleSpawns:Array.from({length:count},(_,i)=>({id:i?'v'+i:'v',kind,x:i*10,y:.07,z:0})),obstacles:[],expansion:{services:[{x:0,z:0,r:8}]}};
 map.obstacles.grid={add(){},remove(){},query(x0,z0,x1,z1,f){for(const o of map.obstacles)if(o.x+o.w/2>=x0&&o.x-o.w/2<=x1&&o.z+o.d/2>=z0&&o.z-o.d/2<=z1)f(o);}};
 const body=()=>({collider:{enabled:true,setEnabled(v){this.enabled=v;}},body:{setTranslation(p){this.p=p;},setNextKinematicTranslation(){}}});
 const a={map,players:[p],tick:1,bodies:new Map([[p.id,body()]]),colliders:new Map(),events:[],random:()=>.5,blasts:[],
 world:{createCharacterController(){return {setSlideEnabled(){},enableAutostep(){},enableSnapToGround(){},computeColliderMovement(c,m){this.m={x:m.x,y:m.y,z:m.z};},computedMovement(){return this.m;},computedGrounded(){return false;}};},removeCharacterController(){}},
 addCollider(o){this.colliders.set(o,{setTranslation(p){this.p=p;},setRotation(q){this.q=q;}});},
 addObs(o){map.obstacles.push(o);this.addCollider(o);},removeObs(o){this.colliders.delete(o);const i=map.obstacles.indexOf(o);if(i>=0)map.obstacles.splice(i,1);},
 damage(by,v,n){v.hp=Math.max(0,v.hp-n);},damageObstacle(o,n){if(o.vehicleId)this.vehicles.damage(o.vehicleId,n,null);},blast(...args){this.blasts.push(args);},bosses:{ray(){return null;}}};
 a.vehicles=new VehicleSystem(a);return {a,p,v:a.vehicles.list[0],body};
}

export {fake,actor,VehicleSystem,syncVehicles};
