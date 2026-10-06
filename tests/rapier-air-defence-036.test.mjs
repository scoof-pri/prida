// Real Rapier queries against isolated moving aircraft/obstacles, not the full city or game renderer.
import test from 'node:test';import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import {freshVehicle,vehicleDimensions} from '../src/vehicle-specs.js';
import {fireVehicleRocket,stepVehicleRockets,stepAirDefenseLock} from '../src/vehicle-rockets.js';
await R.init();
function fixture(){
 const world=new R.World({x:0,y:0,z:0});world.timestep=1/60;
 const launch=freshVehicle({id:'warden',kind:'tank',variant:'sam',x:0,y:0,z:0}),
  plane=freshVehicle({id:'plane',kind:'plane',x:0,y:22,z:100}),p={id:'p',hp:100,team:1,vehicle:'warden',inputAge:0},e={id:'e',hp:100,team:2,vehicle:'plane'};
 Object.assign(launch,{driver:'p',turret:0,barrel:.2});Object.assign(plane,{driver:'e',airborne:true});
 const ls=vehicleDimensions(launch),ps=vehicleDimensions(plane);
 const lc=world.createCollider(R.ColliderDesc.cuboid(ls.w/2,ls.h/2,ls.d/2).setTranslation(0,ls.h/2,0));lc.userData={vehicleId:launch.id};launch.obstacle=lc;
 const pc=world.createCollider(R.ColliderDesc.cuboid(ps.w/2,ps.h/2,ps.d/2).setTranslation(plane.x,plane.y+ps.h/2,plane.z));pc.userData={vehicleId:plane.id};
 const a={map:{limit:{x:2000,z:2000}},players:[p,e],events:[],blasts:[],mode:'royale',blast(...args){this.blasts.push(args);}};
 const s={a,list:[launch,plane],aircraft:[plane],rounds:[],nextShot:0,get(id){return this.list.find(v=>v.id===id)||null;},ray(o,d,range,owner,ignore){
   const hit=world.castRay(new R.Ray(o,d),range,true,undefined,undefined,ignore?.handle!==undefined?ignore:undefined);
   return hit?{distance:hit.timeOfImpact,obstacle:hit.collider.userData||{part:'wall'}}:{distance:range};}};
 world.step();return {s,v:launch,plane,p,e,world,pc};
}
function acquire(f){for(let i=0;i<90;i++)stepAirDefenseLock(f.s,f.v,f.p,1/60);}
test('real Rapier: unobstructed aircraft is acquired and the missile hits its moving collider',()=>{
 const f=fixture();try{acquire(f);assert.equal(f.v.lockProgress,1);assert.ok(fireVehicleRocket(f.s,f.v,f.p));
 f.plane.speed=12;f.plane.angle=Math.PI/2;
 for(let i=0;i<420&&f.s.rounds.length;i++){
   f.plane.x+=12/60;f.pc.setTranslation({x:f.plane.x,y:f.plane.y+1.43,z:f.plane.z});f.world.step();stepVehicleRockets(f.s,1/60);
 }
 assert.equal(f.s.rounds.length,0);assert.equal(f.s.a.blasts.length,1);assert.ok(f.s.a.blasts[0][2]>90);
 }finally{f.world.free();}
});
test('real Rapier: concrete wall prevents initial target acquisition',()=>{
 const f=fixture();try{f.world.createCollider(R.ColliderDesc.cuboid(20,15,.2).setTranslation(0,15,40));f.world.step();acquire(f);assert.equal(f.v.lockTarget,null);assert.equal(fireVehicleRocket(f.s,f.v,f.p),false);}finally{f.world.free();}
});
test('real Rapier: a wall appearing after launch intercepts the missile on the near face',()=>{
 const f=fixture();try{acquire(f);fireVehicleRocket(f.s,f.v,f.p);f.world.createCollider(R.ColliderDesc.cuboid(20,20,.2).setTranslation(0,20,40));f.world.step();
 for(let i=0;i<420&&f.s.rounds.length;i++)stepVehicleRockets(f.s,1/60);
 assert.equal(f.s.a.blasts.length,1);assert.ok(Math.abs(f.s.a.blasts[0][2]-39.8)<.25);
 }finally{f.world.free();}
});
test('real Rapier: own launcher collider is ignored by acquisition rays, not other vehicles',()=>{
 const f=fixture();try{acquire(f);assert.equal(f.v.lockProgress,1);const obstacle=f.world.createCollider(R.ColliderDesc.cuboid(10,15,4).setTranslation(0,15,20));obstacle.userData={vehicleId:'other'};f.world.step();acquire(f);assert.equal(f.v.lockTarget,null);}finally{f.world.free();}
});
test('real Rapier: same-team airborne vehicle remains ineligible even with a clear ray',()=>{
 const f=fixture();try{f.e.team=1;acquire(f);assert.equal(f.v.lockTarget,null);assert.equal(fireVehicleRocket(f.s,f.v,f.p),false);}finally{f.world.free();}
});
