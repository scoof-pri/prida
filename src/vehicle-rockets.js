import { unlimitedDebugRockets } from './developer-mode.js';
// PRIDA 0.32: game-only rockets and arcade air-defence guidance. No real-world weapon data.
// Shared launcher layout drives the server muzzle and the visible rack; no Three.js dependency.
export const MAX_VEHICLE_PROJECTILES = 64;
export const ROCKETS = Object.freeze({
  helicopter: Object.freeze({name:'FALCON',magazine:6,reserve:6,interval:.32,reload:4.8,speed:78,accel:52,maxSpeed:150,gravity:.7,life:5,radius:5.5,damage:190,length:.92,calibre:.07}),
  tank: Object.freeze({name:'SIEGE',magazine:4,reserve:8,interval:.65,reload:5,speed:68,accel:44,maxSpeed:124,gravity:1.2,life:5,radius:6.5,damage:230,length:1.05,calibre:.085}),
  plane: Object.freeze({name:'STRIKE',magazine:8,reserve:0,interval:.28,reload:0,speed:90,accel:60,maxSpeed:175,gravity:.5,life:4.5,radius:6.0,damage:260,length:.92,calibre:.07}),
});
export const ROCKET_VARIANTS = Object.freeze({
  twin: Object.freeze({...ROCKETS.tank,name:'HYDRA',magazine:6,reserve:24,interval:.09,reload:3.2,
    damage:150,radius:5.2,infinite:false,burst:true,maxActive:12}),
  sam: Object.freeze({...ROCKETS.tank,name:'WARDEN',magazine:6,reserve:18,interval:.8,reload:5.5,
    speed:80,maxSpeed:210,accel:90,gravity:0,life:7,damage:250,radius:4.5,maxActive:4,
    guided:true,range:550,lockTime:1.0,cone:.20,turnRate:1.75,proximity:1.8}),
});
export function rocketSpec(v){const kind=typeof v==='string'?v:v?.kind;
  return (kind==='tank'&&Object.hasOwn(ROCKET_VARIANTS,v?.variant)&&ROCKET_VARIANTS[v.variant])||(Object.hasOwn(ROCKETS,kind)?ROCKETS[kind]:undefined);}
const number=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const unit=v=>{const n=Math.hypot(v.x,v.y,v.z)||1;return {x:v.x/n,y:v.y/n,z:v.z/n};};
export function initRocketState(v) {
  const spec=rocketSpec(v);
  return Object.assign(v,{rocketAmmo:spec?.magazine||0,rocketReserve:spec?.reserve||0,rocketCd:0,rocketReload:0,rocketShot:0,rocketCursor:0,rocketBurstLeft:0});
}
export function refillRocketRack(v) {
  const sequence=v.rocketShot||0;initRocketState(v);v.rocketShot=sequence;
}
export function tickRocketRack(v,dt) {
  dt=Math.max(0,number(dt));
  v.rocketCd=Math.max(0,number(v.rocketCd)-dt);
  v.rocketBlockedCd=Math.max(0,number(v.rocketBlockedCd)-dt);
  const spec=rocketSpec(v);if(!spec||v.hp<=0||v.crushed)return;
  if(v.rocketReload>0) {
    v.rocketReload=Math.max(0,v.rocketReload-dt);
    if(v.rocketReload===0) {
      const n=Math.min(spec.magazine-v.rocketAmmo,v.rocketReserve);
      v.rocketAmmo+=n;v.rocketReserve-=n;v.rocketCursor=0;v._changed=true;
    }
  }
  if(v.rocketAmmo===0&&v.rocketReserve>0&&v.rocketReload===0) {
    v.rocketReload=spec.reload;v._changed=true;
  }
}
// Even slots are on the left, odd slots on the right. Tank tubes have two vertical rows.
export function rocketSlot(kind,index) {
  const spec=rocketSpec(kind);if(!spec)return null;
  const variant=typeof kind==='object'&&Object.hasOwn(ROCKET_VARIANTS,kind.variant)?kind.variant:null;kind=typeof kind==='string'?kind:kind.kind;
  const slot=((index%spec.magazine)+spec.magazine)%spec.magazine;
  const side=slot%2===0?-1:1,row=Math.floor(slot/2);
  if(kind==='helicopter')return {slot,side,x:side*(1.60+row*.21),y:1.05,z:.12};
  return kind==='tank'?{slot,side,x:side*(variant?1.40:1.28),y:2.30+row*.26,z:variant?-.28:-.12}:{slot,side,x:side*(2.05+row*.52),y:.88,z:.22};
}
function turn(p,yaw,pitch=0,roll=0) {
  // Same YXZ orientation as VehicleViews: rotate about Z, then X(-pitch), then Y(yaw).
  const cr=Math.cos(roll),sr=Math.sin(roll),cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);
  const x=p.x*cr-p.y*sr,y=p.x*sr+p.y*cr,z=p.z;
  const yy=y*cp+z*sp,zz=-y*sp+z*cp;
  return {x:x*cy+zz*sy,y:yy,z:-x*sy+zz*cy};
}
export function rocketMuzzle(v,index=v.rocketCursor||0) {
  const spec=rocketSpec(v),mount=rocketSlot(v,index);if(!spec||!mount)return null;
  const yaw=number(v.angle),pitch=number(v.pitch),roll=number(v.roll);
  let local,forward;
  if(v.kind==='tank') {
    // Independent launcher pivots sit above the turret; their yaw/elevation match the cannon aim.
    const rel=number(v.turret,yaw)-yaw,barrel=number(v.barrel);
    const offset=turn({x:mount.x,y:0,z:mount.z},rel);
    const reach=turn({x:0,y:0,z:spec.length*.5+.15},rel,barrel);
    local={x:offset.x+reach.x,y:mount.y+reach.y,z:offset.z+reach.z};
    forward=turn(turn({x:0,y:0,z:1},rel,barrel),yaw,pitch,roll);
  } else {
    local={x:mount.x,y:mount.y,z:mount.z+spec.length*.5+.15};
    forward=turn({x:0,y:0,z:1},yaw,pitch,roll);
  }
  const offset=turn(local,yaw,pitch,roll),baseOffset=turn({x:0,y:mount.y,z:0},yaw,pitch,roll);
  return {slot:mount.slot,origin:{x:v.x+offset.x,y:v.y+offset.y,z:v.z+offset.z},
    base:{x:v.x+baseOffset.x,y:v.y+baseOffset.y,z:v.z+baseOffset.z},dir:unit(forward)};
}
export function rocketReady(v,p) {
  return !!rocketSpec(v)&&v.hp>0&&!v.crushed&&!!p&&p.hp>0&&p.vehicle===v.id&&v.driver===p.id&&!(p.frozen>0)&&
    v.rocketAmmo>0&&v.rocketCd<=0&&v.rocketReload<=0;
}
// A press starts one complete magazine. Releasing Q does not cancel its remaining missiles.
// Holding Q starts another magazine only after the finite reserve has reloaded.
export function wantsVehicleRocket(v, pressed, unlimited = false) {
  const spec=rocketSpec(v);
  if(!spec?.burst)return !!pressed;
  if(!v.driver||v.hp<=0||v.crushed){v.rocketBurstLeft=0;return false;}
  if(pressed&&!(v.rocketBurstLeft>0)&&(v.rocketReload<=0||unlimited)&&(v.rocketAmmo>0||unlimited))v.rocketBurstLeft=v.rocketAmmo||spec.magazine;
  return v.rocketBurstLeft>0;
}
export function fireVehicleRocket(system,v,p) {
  if(!v||!p)return false;
  const infinite = !!rocketSpec(v)?.infinite || unlimitedDebugRockets(system.a,p);
  if (infinite && rocketSpec(v) && v.driver===p.id && p.vehicle===v.id) { v.rocketAmmo=rocketSpec(v).magazine; v.rocketReserve=rocketSpec(v).reserve; v.rocketReload=0; }
  if(!rocketReady(v,p)||system.rounds.length>=MAX_VEHICLE_PROJECTILES)return false;
  if(rocketSpec(v).guided && (!v.lockTarget || v.lockProgress<1))return false;
  if(rocketSpec(v).guided && !airTarget(system,system.get(v.lockTarget),v,p))return false;
  // Limit any one launcher's missiles as well as the shared total. Never evict an in-flight projectile.
  if(system.rounds.filter(r=>r.weapon==='rocket'&&r.vehicle===v.id).length>=(rocketSpec(v).maxActive||8))return false;
  const spec=rocketSpec(v),m=rocketMuzzle(v),delta={x:m.origin.x-m.base.x,y:m.origin.y-m.base.y,z:m.origin.z-m.base.z};
  const n=Math.hypot(delta.x,delta.y,delta.z)||1;
  const obstruction=system.ray(m.base,unit(delta),n,p,v.obstacle);
  if(obstruction.distance<n-.015) {
    if(!(v.rocketBlockedCd>0)){system.a.events.push({type:'vehicle-blocked',id:p.id,why:'ROCKET LAUNCHER BLOCKED'});v.rocketBlockedCd=.4;}
    return false;
  }
  if (!infinite) v.rocketAmmo--;v.rocketCd=spec.interval;v.rocketShot++;if(spec.burst)v.rocketBurstLeft=Math.max(0,(v.rocketBurstLeft||0)-1);v.rocketCursor=(m.slot+1)%spec.magazine;v._changed=true;
  const f=v.kind==='plane'&&Number.isFinite(v.vx)&&Number.isFinite(v.vz)?{x:v.vx*.65,y:number(v.vy)*.65,z:v.vz*.65}:turn({x:0,y:0,z:number(v.speed)*.65},number(v.angle),v.airborne?number(v.pitch):0);
  system.rounds.push({id:++system.nextShot,weapon:'rocket',kind:v.kind,variant:v.variant,vehicle:v.id,owner:p.id,team:p.team,
    ...m.origin,dx:m.dir.x*spec.speed+f.x,dy:m.dir.y*spec.speed+f.y,dz:m.dir.z*spec.speed+f.z,
    life:spec.life,age:0,travelled:0,slot:m.slot,target:spec.guided?v.lockTarget:null});
  system.a.events.push({type:'vehicle-shot',kind:'rocket',vehicle:v.id,id:p.id,slot:m.slot,seq:v.rocketShot,
    ...m.origin,dx:m.dir.x,dy:m.dir.y,dz:m.dir.z});
  if(v.rocketAmmo===0&&v.rocketReserve>0)v.rocketReload=spec.reload;
  return true;
}
export function stepVehicleRockets(system,dt) {
  if(!(dt>0)||!Number.isFinite(dt))return;
  // Bounded substeps + swept segments avoid tunnelling through thin walls at low frame rates.
  dt=Math.min(dt,.1);const steps=Math.ceil(dt/.025),sub=dt/steps,a=system.a;
  for(let i=system.rounds.length-1;i>=0;i--) {
    const r=system.rounds[i];if(r.weapon!=='rocket')continue;
    const spec=rocketSpec(r);let removed=false;
    if(!spec){system.rounds.splice(i,1);continue;}
    const owner=a.players.find(p=>p.id===r.owner)||{id:r.owner,team:r.team,bot:false,perks:{},score:0};
    for(let k=0;k<steps;k++) {
      const h=Math.min(sub,r.life);if(h<=0){removed=true;break;}
      const old=guidedDirection(system,r,spec,h),speed=Math.min(spec.maxSpeed,Math.hypot(r.dx,r.dy,r.dz)+spec.accel*h);
      r.dx=old.x*speed;r.dy=old.y*speed-spec.gravity*h;r.dz=old.z*speed;
      const len=Math.hypot(r.dx,r.dy,r.dz),dir=unit({x:r.dx,y:r.dy,z:r.dz}),distance=len*h;
      const ignore=r.travelled<7?system.get(r.vehicle)?.obstacle:null;
      let hit=system.ray(r,dir,distance,owner,ignore);
      // Proximity only when the swept segment is near the locked aircraft, with a short LOS check.
      if(spec.guided && r.target && r.travelled>7){
        const target=system.get(r.target);
        if(target && target.hp>0 && !target.crushed){
          const center={x:target.x,y:target.y+1.4,z:target.z};
          const along=Math.max(0,Math.min(distance,(center.x-r.x)*dir.x+(center.y-r.y)*dir.y+(center.z-r.z)*dir.z));
          const q={x:r.x+dir.x*along,y:r.y+dir.y*along,z:r.z+dir.z*along};
          const to={x:center.x-q.x,y:center.y-q.y,z:center.z-q.z},gap=Math.hypot(to.x,to.y,to.z);
          if(gap<=spec.proximity && along<hit.distance){
            const sight=system.ray(q,unit(to),Math.max(gap,.001),owner,ignore);
            if(sight.distance>=gap-.05||sight.obstacle?.vehicleId===target.id)hit={distance:along,impact:{}};
          }
        }
      }
      if(hit.distance<distance-1e-7||((hit.obstacle||hit.victim||hit.boss||hit.impact)&&hit.distance<=distance)) {
        const d=Math.max(0,Math.min(distance,hit.distance));
        const x=r.x+dir.x*d,y=r.y+dir.y*d,z=r.z+dir.z*d;
        // Use the same native blast once for players, vehicles, doors, voxel walls and site supports.
        // This deliberately does NOT apply a second direct-hit damage charge to the vehicle hull.
        a.blast(x-dir.x*.12,y-dir.y*.12,z-dir.z*.12,spec.radius,spec.damage,owner,'vehicle-rocket');
        a.events.push({type:'vehicle-rocket-impact',vehicle:r.vehicle,kind:r.kind,x,y,z,slot:r.slot});
        removed=true;break;
      }
      r.x+=r.dx*h;r.y+=r.dy*h;r.z+=r.dz*h;r.life-=h;r.age+=h;r.travelled+=distance;
      const L=a.map?.limit;
      if(r.life<=1e-7||(L&&(Math.abs(r.x)>L.x+8||Math.abs(r.z)>L.z+8))||r.y>350||r.y< -60){removed=true;break;}
    }
    if(removed)system.rounds.splice(i,1);
  }
}

// Server-side arcade targeting. The client sends only look/fire, never a target ID or missile position.
function crew(system,id){return system.playersById?.get(id)||system.a.players.find(p=>p.id===id);}
export function airTarget(system,target,launcher,p){
  if(!p||!target||target.id===launcher.id||!['plane','helicopter'].includes(target.kind)||!target.airborne||target.hp<=0||target.crushed)return false;
  const pilot=crew(system,target.driver);
  return target.driver!==p.id && !(pilot&&pilot.team!==undefined&&p.team!==undefined&&pilot.team===p.team);
}
export function clearAirLock(v){v.lockTarget=null;v.lockProgress=0;v.lockRange=0;v._lockClock=0;}
export function stepAirDefenseLock(system,v,p,dt){
  const spec=rocketSpec(v);if(!spec?.guided)return;
  if(!p||p.vehicle!==v.id||v.driver!==p.id||p.hp<=0||p.frozen>0||p.inputAge>.3||v.hp<=0){clearAirLock(v);return;}
  const current=system.get(v.lockTarget);
  if(v.lockTarget&&!airTarget(system,current,v,p))clearAirLock(v);
  v._lockClock=(v._lockClock||0)+Math.max(0,Math.min(dt,.1));
  if(v._lockClock<.2)return;
  const elapsed=Math.min(.25,v._lockClock);v._lockClock=0;
  const origin={x:v.x,y:v.y+2.5,z:v.z},forward=turn({x:0,y:0,z:1},v.turret,v.barrel);
  let chosen=null,score=-Infinity,range=0;
  for(const target of system.aircraft||system.list){
    if(!airTarget(system,target,v,p))continue;
    const delta={x:target.x-origin.x,y:target.y+1.4-origin.y,z:target.z-origin.z},distance=Math.hypot(delta.x,delta.y,delta.z);
    if(distance<12||distance>spec.range)continue;
    const dir=unit(delta),dot=dir.x*forward.x+dir.y*forward.y+dir.z*forward.z;
    if(dot<Math.cos(spec.cone))continue;
    const sight=system.ray(origin,dir,distance,p,v.obstacle);
    if(sight.distance<distance-.2&&sight.obstacle?.vehicleId!==target.id)continue;
    const priority=dot-distance*.00002+(target.id===v.lockTarget? .01:0);
    if(priority>score){chosen=target;score=priority;range=distance;}
  }
  if(!chosen){clearAirLock(v);v._changed=true;return;}
  if(v.lockTarget!==chosen.id){v.lockTarget=chosen.id;v.lockProgress=0;}
  v.lockProgress=Math.min(1,(v.lockProgress||0)+elapsed/spec.lockTime);
  v.lockRange=Math.round(range);v._changed=true;
}
// Bounded spherical turn. Handles near-opposite directions without zero/NaN vectors.
export function turnToward(from,to,maxAngle){
  const a=unit(from),b=unit(to),dot=Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y+a.z*b.z));
  const angle=Math.acos(dot);if(angle<=maxAngle||angle<1e-7)return b;
  let tangent={x:b.x-a.x*dot,y:b.y-a.y*dot,z:b.z-a.z*dot};
  if(Math.hypot(tangent.x,tangent.y,tangent.z)<1e-6){
    const ref=Math.abs(a.y)<.8?{x:0,y:1,z:0}:{x:1,y:0,z:0};
    const d=ref.x*a.x+ref.y*a.y+ref.z*a.z;
    tangent={x:ref.x-a.x*d,y:ref.y-a.y*d,z:ref.z-a.z*d};
  }
  const t=unit(tangent),c=Math.cos(maxAngle),s=Math.sin(maxAngle);
  return unit({x:a.x*c+t.x*s,y:a.y*c+t.y*s,z:a.z*c+t.z*s});
}
function guidedDirection(system,r,spec,dt){
  const old=unit({x:r.dx,y:r.dy,z:r.dz});if(!spec.guided||!r.target)return old;
  const target=system.get(r.target),owner=crew(system,r.owner)||{id:r.owner,team:r.team};
  if(!airTarget(system,target,{id:r.vehicle},owner)){r.target=null;return old;}
  const distance=Math.hypot(target.x-r.x,target.y+1.4-r.y,target.z-r.z),lead=Math.min(.8,distance/Math.max(80,Math.hypot(r.dx,r.dy,r.dz))*.6);
  const f=target.kind==='helicopter'||(target.kind==='plane'&&Number.isFinite(target.vx)&&Number.isFinite(target.vz))?{x:target.vx||0,y:target.vy||0,z:target.vz||0}:turn({x:0,y:0,z:target.speed||0},target.angle||0,target.pitch||0);
  return turnToward(old,{x:target.x+f.x*lead-r.x,y:target.y+1.4+(target.vy??f.y)*lead-r.y,z:target.z+f.z*lead-r.z},spec.turnRate*dt);
}
