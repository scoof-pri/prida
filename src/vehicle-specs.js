export { finishCarContact, helicopterGunPose } from './mobility-physics.js';
export { aircraftShape, aircraftBounds, aircraftColliderParts, aircraftQuaternion, aircraftTouchesBox, aircraftClosestPoint, aircraftGunPose, sweepAircraft } from './aircraft-geometry.js';
export { aircraftImpactDamage } from './aircraft-physics.js';
import { integrateAircraft } from './aircraft-physics.js';
import { integrateCar, integrateHelicopter } from './mobility-physics.js';
import { refillArmour } from './tank-armour.js';
import { initRocketState } from './vehicle-rockets.js';
// Arcade vehicle tuning. These are game values, not specifications of real vehicles.
export const VEHICLES = Object.freeze({
  helicopter: Object.freeze({name:'OSPREY',w:3.1,h:3.4,d:8.8,hp:920,accel:7,brake:8,drag:2,max:28,reverse:15,turn:1.15,seat:1.5,fuel:210,wheel:.3,climb:8,descend:6,verticalAccel:7,
    cannon:null,mg:{ammo:900,damage:12,range:210,interval:.085,heat:.04,cool:.20}}),
  car: Object.freeze({name:'ROADSTER',w:1.92,h:1.48,d:4.25,hp:420,accel:7.8,brake:18,drag:0.9,max:24,reverse:8,turn:1.25,seat:1.0,fuel:160,wheel:0.34}),
  tank: Object.freeze({name:'BASTION',w:3.20,h:2.55,d:5.50,hp:1600,accel:3.8,brake:12,drag:1.8,max:12,reverse:5,turn:0.80,seat:1.7,fuel:220,wheel:0.40,
    cannon:{ammo:24,damage:175,radius:5.5,interval:2.7,speed:115,gravity:7.5,life:4.5},mg:{ammo:1200,damage:13,range:175,interval:0.095,heat:0.048,cool:0.19}}),
  plane: Object.freeze({name:'KESTREL',w:9.4,h:2.86,d:8.80,hp:780,accel:9.5,brake:12,drag:0.9,max:54,reverse:0,turn:0.72,seat:1.6,fuel:200,wheel:0.32,takeoff:20,stall:14,
    cannon:{ammo:120,damage:47,radius:2.5,interval:0.30,speed:205,gravity:0.6,life:3.4},mg:{ammo:1800,damage:9,range:230,interval:0.075,heat:0.036,cool:0.20}}),
});
// Fictional arcade variants; normal vehicles keep their existing balance.
export const VEHICLE_VARIANTS = Object.freeze({
  twin: Object.freeze({...VEHICLES.tank,name:'HYDRA / BURST RACK',h:3.4,hp:1750,infiniteAmmo:false,
    cannon:{...VEHICLES.tank.cannon,interval:.25},mg:{...VEHICLES.tank.mg,interval:.055}}),
  sam: Object.freeze({...VEHICLES.tank,name:'WARDEN / AIR DEFENCE',h:3.5,hp:1100,max:8,reverse:4,
    turn:.62,seat:1.7,cannon:null,mg:null}),
});
export const vehicleSpec = v => (v?.kind==='tank' && Object.hasOwn(VEHICLE_VARIANTS,v.variant) && VEHICLE_VARIANTS[v.variant]) || (Object.hasOwn(VEHICLES,v?.kind)?VEHICLES[v.kind]:undefined);
// Compatibility export only: creation is driven by the actual map, never this old cap.
export const VEHICLE_LIMIT = Infinity;
export function vehicleDimensions(v) {
  const s=vehicleSpec(v);
  return {w:Number.isFinite(v.bodyW)?Math.max(.3,v.bodyW):s.w,
    h:Number.isFinite(v.bodyH)?Math.max(.3,v.bodyH):s.h,
    d:Number.isFinite(v.bodyD)?Math.max(.3,v.bodyD):s.d};
}
export const MAX_ALTITUDE = 135;
export const USE_RANGE = 3.0;
export const clamp = (v,a,b) => Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
export const angleDelta = (a,b) => Math.atan2(Math.sin(b-a),Math.cos(b-a));
export const approach = (a,b,rate,dt) => a + Math.sign(b-a)*Math.min(Math.abs(b-a),rate*dt);
export const direction = (a,p=0) => ({x:Math.sin(a)*Math.cos(p),y:Math.sin(p),z:Math.cos(a)*Math.cos(p)});
export function freshVehicle(spawn) {
  const s=vehicleSpec(spawn); if(!s)throw Error('Unknown vehicle: '+spawn.kind);
  const v=initRocketState({...spawn,variant:spawn.kind==='tank'&&Object.hasOwn(VEHICLE_VARIANTS,spawn.variant)?spawn.variant:null,angle:spawn.angle||0,y:spawn.y||0,speed:0,vy:0,pitch:0,roll:0,turret:spawn.angle||0,barrel:0,
    hp:s.hp,crushed:false,driver:null,active:spawn.decor===undefined,fuel:s.fuel,ammo:s.cannon?.ammo||0,mgAmmo:s.mg?.ammo||0,primaryCd:0,secondaryCd:0,heat:0,overheated:false,
    wheelPhase:0,steer:0,engine:0,airborne:false,shot:0,mgShot:0,repair:0});
  refillArmour(v); return v;
}
export function controls(input={},age=0) {
  if(age>0.3)return {throttle:0,steer:0,climb:0,fire:false,alt:false,rocket:false,brake:true,rearm:false};
  return {throttle:clamp(input.drive,-1,1),steer:clamp(input.steer,-1,1),climb:clamp(input.ascend,-1,1),
    fire:input.fire===true,alt:input.vehicleAlt===true,rocket:input.vehicleRocket===true,brake:input.vehicleBrake===true,rearm:input.reload===true,
    ...(Number.isFinite(input.angle)?{lookYaw:input.angle}:{}),
    ...(Number.isFinite(input.pitch)?{lookPitch:input.pitch}:{})};
}
// Deterministic acceleration and flight envelope; collision correction is applied by VehicleSystem/Rapier.
export function integrateVehicle(v,c,dt) {
  const s=vehicleSpec(v); dt=clamp(dt,0,1/15);
  if(v.kind==='car')return integrateCar(v,c,dt,s);
  if(v.kind==='helicopter')return integrateHelicopter(v,c,dt,s);
  if(v.kind==='plane')return integrateAircraft(v,c,dt,s);
  const working=!!v.driver && v.hp>0 && v.fuel>0;
  const throttle=working?c.throttle:0,steer=working?c.steer:0;
  const wanted=(throttle>=0?s.max:s.reverse)*throttle;
  const braking=c.brake||!working;
  v.speed=approach(v.speed,braking?0:wanted,braking?s.brake:Math.abs(throttle)>.01?s.accel:s.drag,dt);
  v.steer=approach(v.steer,steer,4,dt);
  const old=v.angle;
  const yawStep=-steer*s.turn*dt;
  v.angle=Math.atan2(Math.sin(old+yawStep),Math.cos(old+yawStep));
  v.engine=approach(v.engine,working?Math.max(.18,Math.abs(throttle)):0,2,dt);
  if(working)v.fuel=Math.max(0,v.fuel-dt*(.04+.065*v.engine));
  v.roll=approach(v.roll,-v.steer*v.speed*.004,1,dt);v.vy=Math.max(-20,(v.vy||0)-20*dt);
  v.wheelPhase=(v.wheelPhase+v.speed*dt/s.wheel)%(Math.PI*200);
  v.primaryCd=Math.max(0,v.primaryCd-dt);v.secondaryCd=Math.max(0,v.secondaryCd-dt);
  v.heat=Math.max(0,v.heat-(s.mg?.cool||.2)*dt);
  if(v.overheated&&v.heat<.30)v.overheated=false;
  const f=direction(v.angle);
  return {x:f.x*v.speed*dt,y:v.vy*dt,z:f.z*v.speed*dt,oldAngle:old};
}
export function weaponReady(v,secondary=false) {
  const s=vehicleSpec(v);return v.hp>0&&!!v.driver&&(secondary?!!s.mg&&v.mgAmmo>0&&v.secondaryCd<=0&&!v.overheated:!!s.cannon&&v.ammo>0&&v.primaryCd<=0);
}
export function consumeShot(v,secondary=false) {
  if(!weaponReady(v,secondary))return false;
  const s=vehicleSpec(v);
  if(secondary){if(!s.infiniteAmmo)v.mgAmmo--;v.secondaryCd=s.mg.interval;v.heat=clamp(v.heat+s.mg.heat,0,1);if(v.heat>=.99)v.overheated=true;v.mgShot++;}
  else{if(!s.infiniteAmmo)v.ammo--;v.primaryCd=s.cannon.interval;v.shot++;}
  return true;
}
