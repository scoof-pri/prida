// Isolated real Rapier test. No replacement for full Arena/Three gameplay integration.
import test from 'node:test';import assert from 'node:assert/strict';import RAPIER from '@dimforge/rapier3d-compat';
import {landmarkFixture}from'./landmark-fixture-034.mjs';import{escalatorCarry}from'../src/escalator-system.js';import{rayHulls}from'../src/architecture-geometry.js';
import{cellGrid,cellBox}from'./interior-fixture-033.mjs';
await RAPIER.init();
function setup(map) {
 const world=new RAPIER.World({x:0,y:0,z:0});world.timestep=1/60;
 const addBox=o=>world.createCollider(RAPIER.ColliderDesc.cuboid(o.w/2,o.h/2,o.d/2).setTranslation(o.x,o.y,o.z));
 for(const o of map.obstacles){if(o.nocollide)continue;if(o.roofShape){for(const h of o.roofShape)world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(h.vertices)));}else if(o.hole){ // leave the whole window wall solid for these escalator-only probes
 addBox(o);
 }else if(o.cells){const g=cellGrid(o);for(let i=0;i<o.cells.length;i++)if(o.cells[i])addBox(cellBox(o,i%g.cols,i%g.cols,Math.floor(i/g.cols),Math.floor(i/g.cols)));}else addBox(o);}
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());const collider=world.createCollider(RAPIER.ColliderDesc.capsule(.5,.32),body);
 const controller=world.createCharacterController(.02);controller.setSlideEnabled(true);controller.enableSnapToGround(.12);controller.enableAutostep(.42,.2,false);
 world.step();return{world,body,collider,controller};
}
for(const floor of[0,1])for(const direction of[1,-1])test(`real Rapier: mall escalator ${floor} direction ${direction} transports through its own floor openings`,async()=>{
 const {map}=await landmarkFixture();const e=map.escalators.find(e=>e.storey===floor&&e.direction===direction),q=setup(map);
 try{
 const t=direction===1?.13:.84,p={x:e.from.x+(e.to.x-e.from.x)*t,z:e.from.z,y:e.from.y+(e.to.y-e.from.y)*t+.075,hp:100,vy:0};q.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},true);q.world.step();const start={...p};let rides=0;
 for(let i=0;i<240;i++){p.vy-=22/60;const carrier=escalatorCarry(e,p,1/60)||{x:0,y:0,z:0};if(carrier.id){p.vy=0;rides++;}
 q.controller.computeColliderMovement(q.collider,{x:carrier.x,y:p.vy/60+carrier.y,z:carrier.z},undefined,undefined,c=>!c.parent());const m=q.controller.computedMovement();p.x+=m.x;p.y+=m.y;p.z+=m.z;if(q.controller.computedGrounded())p.vy=0;q.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);q.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});q.world.step();}
 assert.ok(rides>200,JSON.stringify({rides,p,start}));assert.ok((p.x-start.x)*direction>2.2,JSON.stringify({p,start}));assert.ok((p.y-start.y)*direction>1.1,JSON.stringify({p,start}));
 }finally{q.world.free();}
});
test('real Rapier: escalator ribbon agrees with analytic collision planes at every step',async()=>{
 const {map}=await landmarkFixture();const e=map.escalators[0],world=new RAPIER.World({x:0,y:0,z:0});
 try{for(const h of e.ramp.roofShape)world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(h.vertices)));world.step();for(let i=1;i<20;i++){const x=e.from.x+(e.to.x-e.from.x)*i/20,origin={x,y:20,z:e.from.z},dir={x:0,y:-1,z:0};const real=world.castRay(new RAPIER.Ray(origin,dir),30,true),analytic=rayHulls(e.ramp.roofShape,origin,dir,30);assert.ok(real&&analytic);assert.ok(Math.abs(real.timeOfImpact-analytic.distance)<.008);}}finally{world.free();}
});
for(const direction of[1,-1])test(`real Rapier: full escalator trip exits onto a walkable landing, direction ${direction}`,async()=>{
 const {map}=await landmarkFixture(),e=map.escalators.find(e=>e.storey===0&&e.direction===direction),q=setup(map);
 try{const t=direction===1?-.015:1.015,p={x:e.from.x+(e.to.x-e.from.x)*t,z:e.from.z,y:(direction===1?e.from.y:e.to.y)+.035,hp:100,vy:0};q.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},true);q.world.step();
 for(let i=0;i<780;i++){p.vy-=22/60;const c=escalatorCarry(e,p,1/60)||{x:0,y:0,z:0};if(c.id)p.vy=0;q.controller.computeColliderMovement(q.collider,{x:c.x,y:p.vy/60+c.y,z:0},undefined,undefined,c=>!c.parent());const m=q.controller.computedMovement();p.x+=m.x;p.y+=m.y;if(q.controller.computedGrounded())p.vy=0;q.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);q.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});q.world.step();}
 assert.ok(Math.abs(p.y-(direction===1?e.to.y:e.from.y))<.18,JSON.stringify(p));assert.ok(direction===1?p.x>e.to.x-.1:p.x<e.from.x+.1,JSON.stringify(p));
 }finally{q.world.free();}
});
