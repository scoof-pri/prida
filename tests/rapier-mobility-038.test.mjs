// Isolated driving course with real Rapier colliders and the production vehicle controller.
import test from 'node:test';import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import {VehicleSystem,vehicleBody} from '../src/vehicle-system.js';
import {integrateVehicle,controls} from '../src/vehicle-specs.js';
import {ObstacleGrid} from '../src/spatial.js';
import {addObstacle,removeObstacle} from '../src/destruction.js';
import {slopePrism} from '../src/landmark-geometry.js';
await R.init();
function fixture(kind='car'){
 const map={limit:{x:160,z:200},maxTerrainHeight:0,obstacles:[],hills:[],siteGroups:[],vehicleSpawns:[{id:'v',kind,x:0,y:.07,z:-26,angle:0}]};
 map.obstacles.grid=new ObstacleGrid([],map.limit);
 const a={map,world:new R.World({x:0,y:0,z:0}),colliders:new Map(),players:[],events:[],bodies:new Map(),tick:0,blast(){},damage(){},random:()=>.5};
 a.addCollider=o=>{let out;if(o.roofShape)out=o.roofShape.map(s=>{const d=R.ColliderDesc.convexHull(new Float32Array(s.vertices));assert.ok(d);return a.world.createCollider(d);});else{const p=o.doorLeaf;const d=R.ColliderDesc.cuboid((p?.w||o.w)/2,(p?.h||o.h)/2,(p?.t||o.d)/2).setTranslation(p?.x??o.x,p?.y??o.y,p?.z??o.z);if(p)d.setRotation({x:0,y:Math.sin(p.yaw/2),z:0,w:Math.cos(p.yaw/2)});out=a.world.createCollider(d);}a.colliders.set(o,out);a.physicsDirty=true;};
 a.addObs=o=>{addObstacle(map,o);a.addCollider(o);};a.removeObs=o=>{const old=a.colliders.get(o);for(const c of Array.isArray(old)?old:old?[old]:[])a.world.removeCollider(c,false);a.colliders.delete(o);removeObstacle(map,o);a.physicsDirty=true;};
 a.addObs({x:0,y:-.15,z:0,w:320,h:.3,d:400,part:'ground'});
 const s=new VehicleSystem(a),v=s.list[0];v.driver='pilot';s.damage=(id,amount)=>{v.hp=Math.max(0,v.hp-amount);return true;};
 const step=(input={},n=1)=>{for(let i=0;i<n;i++){a.tick++;a.world.step();a.physicsDirty=false;s.move(v,integrateVehicle(v,controls(input),1/60),1/60);}};
 return {a,s,v,step,dispose:()=>a.world.free()};
}
test('native Rapier car accelerates up a real inclined ramp and leaves it with vertical momentum',()=>{
 const f=fixture();try{
  f.a.addObs({...slopePrism({x:0,y:.015,z:-3},{x:0,y:3.5,z:11},5.6,.2),part:'site'});
  let max=0,takeoff=null,landed=false;for(let i=0;i<450;i++){f.step({drive:1});max=Math.max(max,f.v.y);if(f.v.z>13&&f.v.airborne&&f.v.vy>0&&!takeoff)takeoff={...f.v};if(takeoff&&!f.v.airborne){landed=true;break;}}
  assert.ok(takeoff,`no upward takeoff; z=${f.v.z}, maxY=${max}`);assert.ok(max>3.9,`jump did not rise above the ramp: ${max}`);assert.ok(landed);assert.ok(f.v.hp>0);
 }finally{f.dispose();}
});
test('native Rapier car cannot tunnel through a wall and releases collision momentum',()=>{
 const f=fixture();try{f.a.addObs({x:0,y:3,z:13,w:20,h:6,d:.2,part:'wall'});f.step({drive:1},280);assert.ok(f.v.z<11);assert.ok(Math.abs(f.v.vz)<1);assert.ok(f.v.hp>=0);}finally{f.dispose();}
});
test('native Rapier airborne car remains ballistic while steering and lands back on terrain',()=>{
 const f=fixture();try{Object.assign(f.v,{y:12,_grounded:false,airborne:true,vx:0,vz:18,speed:18,vy:4});const o=f.v.obstacle;Object.assign(o,vehicleBody(f.v));f.a.colliders.get(o).setTranslation({x:o.doorLeaf.x,y:o.doorLeaf.y,z:o.doorLeaf.z});
 f.step({drive:1,steer:1},45);assert.ok(Math.abs(f.v.x)<.01);assert.ok(f.v.z>-15);assert.ok(f.v.vy<0);f.step({},150);assert.equal(f.v.airborne,false);assert.ok(Math.abs(f.v.y-.07)<.1);
 }finally{f.dispose();}
});
test('native Rapier helicopter rotor climb respects a solid overhead roof',()=>{
 const f=fixture('helicopter');try{f.a.addObs({x:0,y:9,z:-26,w:18,h:.4,d:18,part:'roof'});f.step({ascend:1},240);assert.ok(f.v.y<5.6);assert.ok(f.v.y>1);assert.ok(Number.isFinite(f.v.y));}finally{f.dispose();}
});
