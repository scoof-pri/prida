import { unlimitedDebugRockets } from './developer-mode.js';
import { absorbArmour, armourSnapshot, refillArmour, damageContext } from './tank-armour.js';
import { tickRocketRack, refillRocketRack, fireVehicleRocket, stepVehicleRockets, MAX_VEHICLE_PROJECTILES, rocketSpec, stepAirDefenseLock, clearAirLock, wantsVehicleRocket } from './vehicle-rockets.js';
import { ramAhead } from './vehicle-ram.js';
import { updateVehicleObstacle, destructionStamp } from './vehicle-spatial.js';
// Server-authoritative vehicle state. No Three.js objects or client-supplied positions enter this system.
import { stepSiteStructures } from './expansion-world.js';
import { VEHICLES, vehicleSpec, vehicleDimensions, finishCarContact, helicopterGunPose, aircraftShape, aircraftBounds, aircraftColliderParts, aircraftTouchesBox, aircraftClosestPoint, aircraftGunPose, aircraftImpactDamage, USE_RANGE, MAX_ALTITUDE, controls, integrateVehicle, freshVehicle, clamp, approach, angleDelta, direction, consumeShot } from './vehicle-specs.js';
import { castMap } from './raycast.js';
import { rayBox } from './combat.js';
import { groundHeight } from './terrain.js';
import { addObstacle, removeObstacle } from './destruction.js';
import { leafBounds, leafTouchesBox, leafTouchesPlayer } from './architecture-geometry.js';

export function vehiclePose(v) {
  const s=vehicleDimensions(v);return {x:v.x,y:v.y+s.h/2,z:v.z,w:s.w,h:s.h,t:s.d,yaw:v.angle};
}
export function vehicleBody(v) {
  if(v.kind==='plane'){const shape=aircraftShape(v);return {...aircraftBounds(shape),aircraftShape:shape,part:'vehicle',nocollide:false,ground:0,vehicleId:v.id,hp:v.hp,color:0x607565};}
  const pose=vehiclePose(v);return {...leafBounds(pose),part:'vehicle',nocollide:false,ground:0,vehicleId:v.id,doorLeaf:pose,hp:v.hp,color:0x607565};
}
export function nearestVehicle(map,p,vehicles=map.vehicles||[]) {
  if(!p||p.hp<=0||p.inBus||p.vehicle)return null;
  let best=null,score=Infinity;
  for(const v of vehicles) {
    if(v.crushed||v.hp<=0||v.driver||Math.abs(v.speed||0)>4)continue;
    if(!VEHICLES[v.kind])continue;const s=vehicleDimensions(v);
    const dx=p.x-v.x,dz=p.z-v.z,c=Math.cos(v.angle),q=Math.sin(v.angle);
    const dist=Math.hypot(Math.max(0,Math.abs(c*dx-q*dz)-s.w/2),Math.max(0,Math.abs(q*dx+c*dz)-s.d/2));
    if(dist>USE_RANGE||p.y+1.6<v.y||p.y>v.y+s.h+1)continue;
    const towards={x:v.x-p.x,y:v.y+s.h*.5-(p.y+1.2),z:v.z-p.z},len=Math.hypot(towards.x,towards.y,towards.z)||1;
    const aim=(Math.sin(p.angle||0)*towards.x+Math.cos(p.angle||0)*towards.z)/Math.max(.1,Math.hypot(towards.x,towards.z));
    if(dist>.8&&aim<.25)continue;
    const hit=castMap({x:p.x,y:p.y+1.2,z:p.z},{x:towards.x/len,y:towards.y/len,z:towards.z/len},len,map);
    if(hit.distance<len-.15&&hit.impact?.obstacle?.vehicleId!==v.id)continue;
    if(dist<score){score=dist;best=v;}
  }
  return best;
}
export class VehicleSystem {
  constructor(arena) {
    this.a=arena;
    // A seated character is protected by the hull. Native blast processing also hits the hull obstacle,
    // so do not charge the same explosion to both the invisible occupant and the vehicle.
    const nativeBlast=arena.blast;this.nativeBlast=nativeBlast;
    arena.blast=function(...args){
      this._vehicleBlastDepth=(this._vehicleBlastDepth||0)+1;
      const previous=this._vehicleImpact037;this._vehicleImpact037={kind:'blast',source:{x:args[0],y:args[1],z:args[2]}};
      try{return nativeBlast.apply(this,args);}finally{this._vehicleBlastDepth--;this._vehicleImpact037=previous;}
    };
    this.list=(arena.map.vehicleSpawns||[]).map(freshVehicle);
    this.clock=0;this.clearedRubble=new Set();this.byId=new Map(this.list.map(v=>[v.id,v]));this.rounds=[];this.nextShot=0;this.rammed=new Map();
    this.controller=arena.world.createCharacterController(.04);this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(.24,.4,false);this.controller.enableSnapToGround(.18);
    this.drivenDecor=new Set();this.scheduled=new Set();this.aircraft=this.list.filter(v=>v.kind==='plane'||v.kind==='helicopter');this.performance={visited:0,sleeping:0,steps:0};
    const parkedByDecor=new Map(arena.map.obstacles.filter(o=>o.part==='car').map(o=>[o.decor,o]));
    for(const v of this.list) {
      v._grounded=true; v._changed=false;
      if(v.decor!==undefined){const old=parkedByDecor.get(v.decor);if(old)arena.removeObs(old);this.drivenDecor.add(v.decor);}
      v.obstacle=vehicleBody(v);arena.addObs(v.obstacle);
    }
    arena.map.vehicles=this.list;
    for(const v of this.list)this.wake(v);
  }
  wake(v){if(v)this.scheduled?.add(v);}
  busy(v){return !!v.driver||Math.abs(v.speed||0)>.01||v.airborne||!v._grounded||v.heat>0||v.engine>0||v.primaryCd>0||v.secondaryCd>0||v.rocketCd>0||v.rocketReload>0;}
  movingVehicles(){return [...this.scheduled].filter(v=>!v.crushed&&v.hp>0&&(v.airborne||Math.abs(v.speed)>.2));}
  get(id){return this.byId.get(id)||null;}
  ensureNearbyColliders(dt){
    this._solidClock=(this._solidClock||0)+dt;if(this._solidClock<.1)return;this._solidClock=0;
    const seen=new Set(),a=this.a;
    const ensure=o=>{
      if(o.vehicleId===undefined||seen.has(o))return;seen.add(o);
      const v=this.get(o.vehicleId);if(!v||v.crushed)return;
      let c=a.colliders.get(o);
      if(!c||(Array.isArray(c)?!c.length||c.some(part=>!part||part.isValid?.()===false):c.isValid?.()===false)){
        if(Array.isArray(c))for(const part of c)if(part&&part.isValid?.()!==false)a.world.removeCollider(part,false);
        a.addCollider(o);c=a.colliders.get(o);
      }
      for(const part of Array.isArray(c)?c:c?[c]:[])if(part.isEnabled?.()===false){part.setEnabled(true);a.physicsDirty=true;}
    };
    for(const p of a.players)if(p.hp>0&&!p.inBus){
      if(a.map.obstacles.grid)a.map.obstacles.grid.query(p.x-14,p.z-14,p.x+14,p.z+14,ensure);
      else for(const v of this.list)if(Math.abs(v.x-p.x)<14&&Math.abs(v.z-p.z)<14)ensure(v.obstacle);
    }
  }
  enter(p) {
    if(p.vehicle)return true;
    const v=nearestVehicle(this.a.map,p,this.list);if(!v)return false;
    if(v.driver||v.hp<=0)return false; // two simultaneous interactions are serialized by Arena.step
    this.wake(v);v.driver=p.id;v.active=true;v._changed=true;v.servicing=false;p.vehicle=v.id;p.healing=0;p.using=null;p.emote=0;p.fireHeld=true;
    p.interactHeld=true;p._vehicleExitAt=(this.a.tick||0)+20;
    this.a.bodies.get(p.id)?.collider?.setEnabled(false);
    this.mount(p);
    this.a.events.push({type:'vehicle-enter',id:p.id,vehicle:v.id,kind:v.kind,x:v.x,y:v.y,z:v.z});return true;
  }
  exitSpot(v,p,force=false) {
    const s=vehicleDimensions(v),a=this.a,c=Math.cos(v.angle),sn=Math.sin(v.angle);
    const flying=(v.kind==='plane'||v.kind==='helicopter')&&v.y-groundHeight(v.x,v.z,a.map)>3.5;
    const options=flying?[[s.w/2+1.5,0],[-s.w/2-1.5,0]]:[[s.w/2+.82,0],[-s.w/2-.82,0],[0,-s.d/2-1],[0,s.d/2+1]];
    for(const [xx,zz] of options){
      const x=v.x+c*xx+sn*zz,z=v.z-sn*xx+c*zz;
      if(Math.abs(x)>a.map.limit.x-.65||Math.abs(z)>a.map.limit.z-.65)continue;
      const floor=groundHeight(x,z,a.map),origin={x,y:Math.max(v.y+3,floor+3),z};
      const down=castMap(origin,{x:0,y:-1,z:0},Math.max(5,origin.y-floor+2),a.map,v.obstacle);
      const y=flying?v.y+2.2:Math.max(floor,origin.y-down.distance)+.07;
      const capsule={x,y:y+.84,z,w:.74,h:1.68,t:.74,yaw:0};
      const free=!a.map.obstacles.some(o=>o!==v.obstacle&&!o.nocollide&&leafTouchesBox(capsule,o,.005));
      if(free&&!a.players.some(q=>q!==p&&q.hp>0&&!q.vehicle&&Math.hypot(q.x-x,q.z-z)<.65&&Math.abs(q.y-y)<1.7))return {x,y,z,flying};
    }
    if(force)return {x:v.x,y:Math.max(v.y+s.h+1,groundHeight(v.x,v.z,a.map)+2),z:v.z,flying:true};
    return null;
  }
  exit(p,{force=false,quiet=false}={}) {
    const v=this.get(p?.vehicle);if(!v){if(p)p.vehicle=null;return false;}
    if(!force&&(this.a.tick||0)<(p._vehicleExitAt||0))return true;
    if(!force&&v.kind!=='plane'&&v.kind!=='helicopter'&&Math.abs(v.speed)>7){this.a.events.push({type:'vehicle-blocked',id:p.id,why:'BRAKE BEFORE EXITING'});return true;}
    const spot=this.exitSpot(v,p,force);
    if(!spot){this.a.events.push({type:'vehicle-blocked',id:p.id,why:'EXIT BLOCKED'});return true;}
    this.wake(v);clearAirLock(v);v.rocketBurstLeft=0;v.driver=null;v._changed=true;p.vehicle=null;p.vy=0;p.grounded=!spot.flying;p.dropping=!!spot.flying;p.gliding=!!spot.flying;p.launched=!!spot.flying;
    Object.assign(p,{x:spot.x,y:spot.y,z:spot.z,moving:0});p.input={...p.input,fire:false,vehicleRocket:false,interact:false};
    const body=this.a.bodies.get(p.id);if(body){body.collider.setEnabled(true);body.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);body.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});}
    this.a.physicsDirty=true;
    if(!quiet)this.a.events.push({type:'vehicle-exit',id:p.id,vehicle:v.id,x:v.x,y:v.y,z:v.z});return true;
  }
  detach(id) {const p=this.a.players.find(p=>p.id===id);if(p?.vehicle)this.exit(p,{force:true,quiet:true});}
  mount(p) {
    const v=this.get(p.vehicle);if(!v||v.hp<=0||v.driver!==p.id){p.vehicle=null;this.a.bodies.get(p.id)?.collider?.setEnabled(true);return false;}
    p.x=v.x;p.y=v.y+vehicleSpec(v).seat-.7;p.z=v.z;p.vy=0;p.moving=Math.abs(v.speed);p.grounded=!v.airborne;p.gliding=false;p.dropping=false;p.thrusting=false;p.sprinting=false;p.wingsOpen=false;p.wingSpeed=0;
    const b=this.a.bodies.get(p.id);if(b){b.collider.setEnabled(false);b.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);b.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});}
    return true;
  }
  rotationFree(v,next,pitch=v.pitch,roll=v.roll) {
    if(v.kind==='plane'){
      const shape=aircraftShape({...v,angle:next,pitch,roll}),b=aircraftBounds(shape);let blocked=false;
      const visit=o=>{if(o!==v.obstacle&&!o.nocollide&&aircraftTouchesBox(shape,o,.045))blocked=true;};
      if(this.a.map.obstacles.grid)this.a.map.obstacles.grid.query(b.x-b.w/2,b.z-b.d/2,b.x+b.w/2,b.z+b.d/2,visit);else for(const o of this.a.map.obstacles)visit(o);
      return !blocked;
    }
    const pose=vehiclePose({...v,angle:next}),bounds=leafBounds(pose);let blocked=false;
    this.a.map.obstacles.grid.query(bounds.x-bounds.w/2,bounds.z-bounds.d/2,bounds.x+bounds.w/2,bounds.z+bounds.d/2,o=>{
      if(o!==v.obstacle&&!o.nocollide&&leafTouchesBox(pose,o,.055))blocked=true;
    });
    return !blocked;
  }
  move(v,m,dt) {
    const a=this.a,s=vehicleDimensions(v),o=v.obstacle,c=a.colliders.get(o);if(!c)return;
    if(v.kind==='plane'&&Array.isArray(c))return this.moveAircraft(v,m,dt,c);
    const wasGrounded=v._grounded!==false,impactVelocity=v.vy;
    // A settled, stationary vehicle is a sleeping collider. Engine/weapon clocks may still advance.
    if(v._grounded && !v.airborne && m.y<=0 && Math.hypot(m.x,m.z)<1e-6 && Math.abs(angleDelta(m.oldAngle,v.angle))<1e-7 && !this.supportChanged) {
      v.vy=0; return;
    }
    // Remove impacted breakable geometry BEFORE asking Rapier for the corrected movement.
    // Never change colliders from inside a physics-query predicate.
    if(ramAhead(this,v,m) && a.physicsDirty) { a.world.step(); a.physicsDirty=false; }
    const rotation=angleDelta(m.oldAngle,v.angle),steps=Math.max(1,Math.ceil(Math.abs(rotation)/.015));
    for(let k=1;Math.abs(rotation)>1e-7&&k<=steps;k++)if(!this.rotationFree(v,m.oldAngle+rotation*k/steps)){v.angle=m.oldAngle;break;}
    if(Math.abs(angleDelta(m.oldAngle,v.angle))>1e-7)c.setRotation({x:0,y:Math.sin(v.angle/2),z:0,w:Math.cos(v.angle/2)});
    if(v.airborne || (v.kind==='car'&&v.rampVelocity>.6))this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(.18);
    this.controller.computeColliderMovement(c,m,undefined,undefined,q=>q.handle!==c.handle && !q.parent());
    const moved=this.controller.computedMovement();
    const desired=Math.hypot(m.x,m.z),actual=Math.hypot(moved.x,moved.z);
    if(desired>.015&&actual<desired*.50){
      if(v.kind!=='tank'&&Math.abs(v.speed)>10)this.damage(v.id,(Math.abs(v.speed)-7)*8,null);
      v.speed*=v.kind==='tank'?.72:.20;
    }
    v.x=clamp(v.x+moved.x,-a.map.limit.x+s.w/2+.5,a.map.limit.x-s.w/2-.5);
    v.z=clamp(v.z+moved.z,-a.map.limit.z+s.d/2+.5,a.map.limit.z-s.d/2-.5);
    const floor=groundHeight(v.x,v.z,a.map)+.07;
    let y=v.y+moved.y;
    // A rising aircraft must not be re-landed just because its wheels are still near the runway.
    const rising=v.airborne&&v.vy>0&&moved.y>0;
    const grounded=!rising&&(this.controller.computedGrounded()||y<=floor+.06);
    if(v.kind==='plane'&&v.airborne&&grounded){
      if(v.vy<-4.5||Math.abs(v.roll)>.32||Math.abs(v.pitch)>.24||v.speed>39)this.damage(v.id,Math.max(100,-v.vy*70)+Math.max(0,v.speed-32)*15,null);
      v.airborne=false;v.pitch=0;v.roll=0;
    }
    if(v.kind==='helicopter'&&grounded){
      if(!wasGrounded&&impactVelocity<-5)this.damage(v.id,Math.min(500,(-impactVelocity-5)**2*10),null);
      v.airborne=false;v.pitch=0;v.roll=0;
    }
    if(v.kind==='car'){
      let support=null;
      for(let k=0;k<(this.controller.numComputedCollisions?.()||0);k++){
        const n=this.controller.computedCollision(k)?.normal1;
        if(n&&n.y>.72&&(!support||n.y>support.y))support=n;
      }
      if(support){v.supportSlopeX=-support.x/support.y;v.supportSlopeZ=-support.z/support.y;}
      else if(!grounded){v.supportSlopeX=v.supportSlopeZ=0;}
      const impact=finishCarContact(v,moved,dt,wasGrounded,grounded,impactVelocity);
      if(impact>0)this.damage(v.id,impact,null);
      // Two short support rays per moving car, not per parked car or wheel.
      if(grounded&&Math.abs(v.speed)>.2){
        const length=Math.min(2.7,s.d*.62),f=direction(v.angle);
        const support=sign=>{const origin={x:v.x+f.x*length*.5*sign,y:y+1.9,z:v.z+f.z*length*.5*sign};
          const hit=castMap(origin,{x:0,y:-1,z:0},4,a.map,o,true);return origin.y-hit.distance;};
        v.roadPitch=clamp(Math.atan2(support(1)-support(-1),length),-.46,.46);
      }
    }
    v.y=clamp(Math.max(floor,y),-20,MAX_ALTITUDE);
    if(v.y>=MAX_ALTITUDE){v.vy=Math.min(v.vy,0);v.pitch=Math.min(v.pitch,0);}
    v._grounded=grounded;
    if(grounded)v.vy=0;
    if(updateVehicleObstacle(a.map,o,vehicleBody(v))) {
      c.setTranslation({x:o.doorLeaf.x,y:o.doorLeaf.y,z:o.doorLeaf.z});a.physicsDirty=true;v._changed=true;
    }
    if(Math.abs(v.speed)>3&&v.hp>0){const driver=a.players.find(p=>p.id===v.driver);
      for(const target of a.players)if(!target.vehicle&&target.hp>0&&leafTouchesPlayer(o.doorLeaf,target)){
        const key=v.id+':'+target.id,last=this.rammed.get(key)||-100;
        if(a.tick-last>45){this.rammed.set(key,a.tick);a.damage(driver,target,Math.min(110,(v.kind==='tank'?35:15)+Math.abs(v.speed)*3));target.push={x:Math.sin(v.angle)*v.speed*.7,z:Math.cos(v.angle)*v.speed*.7};}
      }
      if(this.rammed.size>256)for(const [key,tick] of this.rammed)if(a.tick-tick>180)this.rammed.delete(key);
    }
  }
  moveAircraft(v,m,dt,colliders) {
    const a=this.a,o=v.obstacle,own=new Set(colliders.map(c=>c.handle));
    const wasGrounded=v._grounded!==false,velocity={x:v.vx||0,y:v.vy||0,z:v.vz||0};
    if(v._grounded&&!v.airborne&&Math.hypot(m.x,m.z)<1e-7&&m.y<=0&&!this.supportChanged){v.vy=0;return;}
    if(ramAhead(this,v,m)&&a.physicsDirty){a.world.step();a.physicsDirty=false;}
    if(v.crushed||v.hp<=0)return;
    const old={angle:m.oldAngle??o.aircraftShape.angle,pitch:m.oldPitch??o.aircraftShape.pitch,roll:m.oldRoll??o.aircraftShape.roll};
    const change={angle:angleDelta(old.angle,v.angle),pitch:v.pitch-old.pitch,roll:v.roll-old.roll},steps=Math.max(1,Math.ceil(Math.max(...Object.values(change).map(Math.abs))/.018));
    for(let k=1;k<=steps;k++)if(!this.rotationFree(v,old.angle+change.angle*k/steps,old.pitch+change.pitch*k/steps,old.roll+change.roll*k/steps)){
      Object.assign(v,old);v.yawRate=v.pitchRate=0;break;
    }
    const parts=aircraftColliderParts(v);
    for(let i=0;i<colliders.length;i++){const p=parts[i];colliders[i].setTranslation({x:p.x,y:p.y,z:p.z});colliders[i].setRotation(p.rotation);}
    let moved={x:m.x,y:m.y,z:m.z},wheelGround=false,bodyGround=false,impact=0;
    this.controller.disableSnapToGround();this.controller.disableAutostep();this.controller.setSlideEnabled(!v.airborne);
    try{
      // Each component constrains the same rigid-body displacement. All sibling hulls
      // are excluded, so a wing cannot collide with its own fuselage or landing gear.
      for(let i=0;i<colliders.length;i++){
        this.controller.computeColliderMovement(colliders[i],moved,undefined,undefined,q=>!own.has(q.handle)&&!q.parent());
        moved={...this.controller.computedMovement()};
        for(let j=0;j<(this.controller.numComputedCollisions?.()||0);j++){
          const n=this.controller.computedCollision(j)?.normal1;if(!n)continue;
          const closing=Math.max(0,-velocity.x*n.x-velocity.y*n.y-velocity.z*n.z);
          if(n.y>.6){if(parts[i].id.startsWith('wheel'))wheelGround=true;else bodyGround=true;}
          else impact=Math.max(impact,closing);
        }
      }
    }finally{this.controller.setSlideEnabled(true);this.controller.enableAutostep(.24,.4,false);}
    const desired=Math.hypot(m.x,m.z),actual=Math.hypot(moved.x,moved.z),floor=groundHeight(v.x+moved.x,v.z+moved.z,a.map)+.07;
    const rising=v.airborne&&v.vy>0&&moved.y>0,grounded=!rising&&(wheelGround||bodyGround||v.y+moved.y<=floor+.025);
    if(desired>.02&&actual<desired*.85)impact=Math.max(impact,(desired-actual)/Math.max(dt,.001));
    if(impact>3)this.damage(v.id,aircraftImpactDamage(v.speed,impact),null,{kind:'collision'});
    if(v.crushed)return;
    if(v.airborne&&grounded){
      const landing=aircraftImpactDamage(v.speed,Math.max(0,-velocity.y),{landing:true,pitch:v.pitch,roll:v.roll});
      const strike=bodyGround&&v.speed>7?Math.max(100,v.speed*v.speed*.5):0;
      if(landing+strike>0)this.damage(v.id,landing+strike,null,{kind:'collision'});
      if(v.crushed)return;
      v.airborne=false;v.pitch=v.roll=v.pitchRate=v.yawRate=0;v.stalled=false;
    }
    if(desired>.02&&actual<desired*.90){const k=actual/desired;v.speed*=k;v.vx*=k;v.vz*=k;}
    // Clamp the whole oriented envelope at world limits, rather than losing a wing
    // outside the map while the aircraft's centre is still inside it.
    v.x+=moved.x;v.z+=moved.z;v.y=clamp(Math.max(floor,v.y+moved.y),-20,MAX_ALTITUDE);
    const b=aircraftBounds(v),hx=b.w/2+.10,hz=b.d/2+.10;
    v.x+=clamp(b.x,-a.map.limit.x+hx,a.map.limit.x-hx)-b.x;v.z+=clamp(b.z,-a.map.limit.z+hz,a.map.limit.z-hz)-b.z;
    if(v.y>=MAX_ALTITUDE){v.vy=Math.min(v.vy,0);v.pitch=Math.min(v.pitch,0);}
    v._grounded=grounded;if(grounded)v.vy=0;
    if(updateVehicleObstacle(a.map,o,vehicleBody(v)))v._changed=true;
    const next=aircraftColliderParts(v);for(let i=0;i<colliders.length;i++){const p=next[i];colliders[i].setTranslation({x:p.x,y:p.y,z:p.z});colliders[i].setRotation(p.rotation);}
    a.physicsDirty=true;
    if(v.speed>3){const driver=a.players.find(p=>p.id===v.driver);
      for(const p of a.players)if(!p.vehicle&&p.hp>0&&aircraftClosestPoint(o,{x:p.x,y:p.y+.84,z:p.z}).distance<.48){const key=v.id+':'+p.id;
        if(a.tick-(this.rammed.get(key)||-100)>45){this.rammed.set(key,a.tick);a.damage(driver,p,Math.min(110,15+v.speed*3));p.push={x:(v.vx||0)*.7,z:(v.vz||0)*.7};}}
    }
  }
  step(dt) {
    const a=this.a,stamp=destructionStamp(a);this.clock+=dt;
    this.ensureNearbyColliders(dt);
    this.supportChanged=this.supportStamp!==undefined && this.supportStamp!==stamp;
    const areas=a._supportChanges036||[],groundVersion=a.map.terrainVersion||a.map.groundVersion||0;
    const groundChanged=this._groundStamp036!==undefined&&this._groundStamp036!==groundVersion;
    if(this.supportChanged){
      if(areas.length&&!a._supportAll036&&!groundChanged&&a.map.obstacles.grid){
        for(const area of areas)a.map.obstacles.grid.query(area.x-area.w/2-6,area.z-area.d/2-6,area.x+area.w/2+6,area.z+area.d/2+6,o=>{
          if(o.vehicleId!==undefined){const v=this.get(o.vehicleId);if(v&&!v.crushed)this.wake(v);}
        });
      }else for(const v of this.list)if(!v.crushed)this.wake(v);
    }
    this._groundStamp036=groundVersion;a._supportChanges036=[];a._supportAll036=false;
    // Player input and unusual teleports must also wake a vehicle without a global scan.
    for(const p of a.players)if(p.vehicle)this.wake(this.get(p.vehicle));
    this.supportStamp=stamp;
    const playersById=this.playersById=new Map(a.players.map(p=>[p.id,p]));
    this.performance.visited=0;this.performance.steps++;
    for(const v of this.scheduled){
      this.performance.visited++;
      if(v.crushed){this.scheduled.delete(v);continue;}
      if(!this.busy(v)&&!this.supportChanged){this.scheduled.delete(v);continue;}
      if(v.crushed)continue;
      tickRocketRack(v,dt);
      const restless=Math.abs(v.speed)>.01||v.airborne||!v._grounded;
      if(!v.driver&&!restless&&!this.supportChanged && v.heat<=0&&v.engine<=0&&v.primaryCd<=0&&v.secondaryCd<=0&&v.rocketCd<=0&&v.rocketReload<=0)continue;
      if(v.hp<=0){if(!v._grounded || (this.supportChanged&&v.y>groundHeight(v.x,v.z,a.map)+.15)){v.vy=Math.max(-32,(v.vy||0)-18*dt);this.move(v,{x:0,y:v.vy*dt,z:0,oldAngle:v.angle},dt);}continue;}
      const p=v.driver?playersById.get(v.driver):null;
      if(v.driver&&(!p||p.hp<=0)){if(p)this.exit(p,{force:true,quiet:true});else v.driver=null;}
      const ctrl=controls(p?.input||{},p?.inputAge??1);
      if(p?.frozen>0){ctrl.throttle=0;ctrl.steer=0;ctrl.fire=false;ctrl.alt=false;ctrl.rocket=false;ctrl.brake=true;ctrl.climb=0;delete ctrl.lookYaw;delete ctrl.lookPitch;}
      if(!p){ctrl.throttle=0;ctrl.brake=v.kind!=='plane'&&v.kind!=='helicopter';ctrl.fire=ctrl.alt=ctrl.rocket=false;}
      a.technology?.vehicleInput(v,p,ctrl,dt);
      const moving=!!v.driver||Math.abs(v.speed)>.01||v.airborne||!v._grounded||(this.supportChanged&&v.y>groundHeight(v.x,v.z,a.map)+.20);
      if(moving){const motion=integrateVehicle(v,ctrl,dt);this.move(v,a.technology?.boostMotion(v,motion,dt)||motion,dt);}
      else {v.primaryCd=Math.max(0,v.primaryCd-dt);v.secondaryCd=Math.max(0,v.secondaryCd-dt);v.heat=Math.max(0,v.heat-.2*dt);v.engine=approach(v.engine,0,2,dt);}
      if(v.kind==='tank'&&p){
        // Gun target and camera look are separate inputs. Stale packets must not keep moving the gun.
        const input=p.inputAge<=.3?p.input:{};
        const yaw=Number.isFinite(input.turretAngle)?input.turretAngle:(input.angle??v.turret);
        const pitch=Number.isFinite(input.turretPitch)?input.turretPitch:(input.pitch??v.barrel);
        v.turret+=clamp(angleDelta(v.turret,yaw),-1.6*dt,1.6*dt);
        v.turret=Math.atan2(Math.sin(v.turret),Math.cos(v.turret));
        v.barrel=approach(v.barrel,clamp(pitch,v.variant==='sam'?-.05:-.18,v.variant==='sam'?1.30:.65),v.variant==='sam'?1.35:.9,dt);
      }
      else {v.turret=v.angle;v.barrel=v.kind==='helicopter'&&p&&p.inputAge<=.3&&!(p.frozen>0)?clamp(p.input.pitch,-.70,.70):v.pitch;}
      if(p&&v.hp>0){
        v._changed=true;
        this.mount(p);
        stepAirDefenseLock(this,v,p,dt);
        if(ctrl.fire&&v.variant!=='sam')this.fire(v,p,v.kind==='helicopter');
        if(ctrl.alt&&!(v.kind==='helicopter'&&ctrl.fire))this.fire(v,p,true);
        if(wantsVehicleRocket(v,ctrl.rocket||(ctrl.fire&&v.variant==='sam'),unlimitedDebugRockets(a,p)))fireVehicleRocket(this,v,p);
        if(ctrl.rearm)v.servicing=true;
        if(v.servicing&&Math.abs(v.speed)<.3&&!v.airborne&&a.map.expansion?.services?.some(s=>Math.hypot(s.x-v.x,s.z-v.z)<s.r)){
          v.repair+=dt;
          if(v.repair>=3){const s=vehicleSpec(v);v.hp=s.hp;v.ammo=s.cannon?.ammo||0;v.mgAmmo=s.mg?.ammo||0;v.fuel=s.fuel;v.heat=0;v.overheated=false;v.repair=0;v.servicing=false;refillRocketRack(v);refillArmour(v);a.technology?.service(v);v.obstacle.hp=v.hp;a.events.push({type:'vehicle-serviced',id:p.id,vehicle:v.id});}
        } else {v.repair=0;v.servicing=false;}
      }
    }
    this.performance.sleeping=this.list.length-this.scheduled.size;
    this.stepRounds(dt);
    stepSiteStructures(this.a);
  }
  aim(v,p,secondary) {
    if(v.kind==='plane'){
      const pose=aircraftGunPose(v,secondary),len=Math.hypot(pose.origin.x-pose.base.x,pose.origin.y-pose.base.y,pose.origin.z-pose.base.z),reach=castMap(pose.base,pose.dir,len,this.a.map,v.obstacle).distance;
      if(reach<len-.015)for(const k of ['x','y','z'])pose.origin[k]=pose.base[k]+pose.dir[k]*Math.max(0,reach-.025);
      return pose;
    }
    if(v.kind==='helicopter'){
      const pose=helicopterGunPose(v),range=.78,hit=castMap(pose.base,pose.dir,range,this.a.map,v.obstacle);
      if(hit.distance<range-.03){const reach=Math.max(0,hit.distance-.03);for(const k of ['x','y','z'])pose.origin[k]=pose.base[k]+pose.dir[k]*reach;}
      return pose;
    }
    const s=vehicleSpec(v),dir=direction(v.turret,v.barrel),f=direction(v.angle),right={x:Math.cos(v.angle),z:-Math.sin(v.angle)};
    const offset=v.kind==='tank'?(secondary ? .7 : 0):(secondary?(v.mgShot%2?1.4:-1.4):.7);
    const origin={x:v.x+dir.x*(v.kind==='tank'?(secondary?1.6:3.85):s.d*.47)+right.x*offset,y:v.y+(v.kind==='tank'?1.95:1.35)+dir.y*2,z:v.z+dir.z*(v.kind==='tank'?(secondary?1.6:3.85):s.d*.47)+right.z*offset};
    // A long gun must hit the wall between the breech and its muzzle, not shoot from beyond that wall.
    const breech={x:v.x,y:v.y+(v.kind==='tank'?1.95:1.35),z:v.z},dx=origin.x-breech.x,dy=origin.y-breech.y,dz=origin.z-breech.z,len=Math.hypot(dx,dy,dz)||1;
    const reach=castMap(breech,{x:dx/len,y:dy/len,z:dz/len},len,this.a.map,v.obstacle).distance;
    if(reach<len-.03){const n=Math.max(0,reach-.06)/len;origin.x=breech.x+dx*n;origin.y=breech.y+dy*n;origin.z=breech.z+dz*n;}
    return {origin,dir};
  }
  ray(origin,dir,range,owner,ignore) {
    const a=this.a,hit=castMap(origin,dir,range,a.map,ignore);let distance=hit.distance,victim=null,boss=null;
    for(const p of a.players){if(p===owner||p.hp<=0||p.inBus||p.vehicle)continue;
      const n=rayBox(origin,dir,{x:p.x-.34,y:p.y,z:p.z-.34},{x:p.x+.34,y:p.y+1.7,z:p.z+.34},distance);
      if(n<distance){distance=n;victim=p;}}
    const bh=a.bosses?.ray(origin,dir,distance);if(bh&&bh.distance<distance){distance=bh.distance;boss=bh.boss;victim=null;}
    return {distance,victim,boss,obstacle:!victim&&!boss?hit.impact?.obstacle:null,impact:hit.impact};
  }
  fire(v,p,secondary) {
    if(!secondary&&this.rounds.length>=MAX_VEHICLE_PROJECTILES)return;
    if(!consumeShot(v,secondary))return;
    const a=this.a,s=vehicleSpec(v),{origin,dir}=this.aim(v,p,secondary);
    if(secondary){
      const jitter=(a.random()-.5)*.012,dx=v.kind==='helicopter'||v.kind==='plane'?{...dir}:direction(v.turret+jitter,v.barrel+(a.random()-.5)*.009);
      if(v.kind==='helicopter'||v.kind==='plane'){dx.x+=jitter;dx.y+=(a.random()-.5)*.009;const len=Math.hypot(dx.x,dx.y,dx.z);for(const key of ['x','y','z'])dx[key]/=len;}
      const h=this.ray(origin,dx,s.mg.range,p,v.obstacle),to={x:origin.x+dx.x*h.distance,y:origin.y+dx.y*h.distance,z:origin.z+dx.z*h.distance};
      if(h.victim)a.damage(p,h.victim,s.mg.damage);
      else if(h.boss)a.bosses.damage(h.boss,s.mg.damage,p);
      else if(h.obstacle?.panel!==undefined)a.chipWall(h.obstacle,to,dx,s.mg.damage*.6,p);
      else if(h.obstacle)a.damageObstacle(h.obstacle,s.mg.damage,p);
      a.events.push({type:'vehicle-shot',kind:'mg',vehicle:v.id,id:p.id,...origin,tx:to.x,ty:to.y,tz:to.z});
    }else{
      const w=s.cannon;this.rounds.push({id:++this.nextShot,vehicle:v.id,owner:p.id,team:p.team,kind:v.kind,...origin,
        dx:dir.x*w.speed,dy:dir.y*w.speed,dz:dir.z*w.speed,life:w.life});
      a.events.push({type:'vehicle-shot',kind:'cannon',vehicle:v.id,id:p.id,...origin,dx:dir.x,dy:dir.y,dz:dir.z});
    }
  }
  stepRounds(dt) {
    stepVehicleRockets(this,dt);
    const a=this.a;
    for(let i=this.rounds.length-1;i>=0;i--){
      const r=this.rounds[i];if(r.weapon==='rocket')continue;
      const spec=VEHICLES[r.kind].cannon,owner=a.players.find(p=>p.id===r.owner)||{id:r.owner,team:r.team,bot:false,perks:{},score:0};
      r.dy-=spec.gravity*dt;r.life-=dt;
      const n=Math.hypot(r.dx,r.dy,r.dz)||1,dir={x:r.dx/n,y:r.dy/n,z:r.dz/n},travel=n*dt;
      const h=this.ray(r,dir,travel,owner,this.get(r.vehicle)?.obstacle);
      if(h.distance<travel||r.life<=0){
        const step=Math.min(h.distance,travel),x=r.x+dir.x*step,y=r.y+dir.y*step,z=r.z+dir.z*step;
        // Detonate on the near side of a wall, not from inside it. Direct vehicle hits always count.
        // One native blast damages the hull/armour once; no second direct-hit charge.
        a.blast(x-dir.x*.12,y-dir.y*.12,z-dir.z*.12,spec.radius,spec.damage,owner,'vehicle-cannon');
        this.rounds.splice(i,1);
      }else {r.x+=r.dx*dt;r.y+=r.dy*dt;r.z+=r.dz*dt;}
    }
  }
  damage(id,amount,attacker,hit=null) {
    const v=this.get(id);if(!v||v.hp<=0||!Number.isFinite(amount)||amount<=0)return;
    // Team protection uses the driver, not a client-supplied ownership flag.
    const driver=this.a.players.find(p=>p.id===v.driver);
    if(attacker&&driver&&attacker!==driver&&attacker.team===driver.team)return;
    const absorbed=absorbArmour(v,amount,damageContext(this.a,attacker,hit));
    this.wake(v);v.hp=Math.max(0,v.hp-absorbed.hull);v.obstacle.hp=v.hp;v._changed=true;
    if(absorbed.broken)this.a.events.push({type:'vehicle-armour-break',vehicle:v.id,face:absorbed.face,id:attacker?.id,x:v.x,y:v.y+1.5,z:v.z});
    if(v.hp>0)return;
    v.active=true;
    const wreck=v.kind==='plane'?{...aircraftShape(v),vx:Number.isFinite(v.vx)?v.vx:Math.sin(v.angle)*v.speed,vy:v.vy||0,vz:Number.isFinite(v.vz)?v.vz:Math.cos(v.angle)*v.speed,time:(this.a.tick||0)/60}:null;
    if(driver){this.exit(driver,{force:true,quiet:true});driver.shield=0;this.a.damage(attacker,driver,110);}
    v.speed=0;v.vx=0;v.vz=0;v.airborne=false;v.driver=null;v.engine=0;v.heat=0;v.primaryCd=v.secondaryCd=v.rocketCd=v.rocketReload=0;clearAirLock(v);
    if(wreck){v.wreck=wreck;v.crushed=true;v._grounded=true;v.vy=0;this.scheduled.delete(v);if(this.a.colliders.has(v.obstacle))this.a.removeObs(v.obstacle);}
    // A wreck remains solid cover but never turns back into the old decorative car.
    this.a.events.push({type:'vehicle-destroyed',vehicle:v.id,kind:v.kind,x:v.x,y:v.y+1,z:v.z,id:attacker?.id,...(wreck?{wreck}: {})});
    this.a.blast(v.x,v.y+1,v.z,v.kind==='tank'?5:3.5,65,attacker,'vehicle-wreck',v.obstacle);
  }
  crush(id,attacker) {
    const v=this.get(id);if(!v||v.hp>0||v.crushed)return false;
    this.scheduled.delete(v);v.crushed=true;v.active=true;v._changed=true;v.driver=null;v.speed=0;v.engine=0;v.airborne=false;
    this.a.noteSupportChange036?.(v.obstacle);
    if(this.a.colliders.has(v.obstacle))this.a.removeObs(v.obstacle);
    this.a.events.push({type:'vehicle-crushed',vehicle:id,id:attacker?.id,x:v.x,y:v.y+.6,z:v.z});
    return true;
  }
  damageMounted(p,amount,attacker){if(!p.vehicle)return false;if(this.a._vehicleBlastDepth>0)return true;if(!attacker)return false;this.damage(p.vehicle,amount*.8,attacker);return true;}
  snapshot(){return this.list.filter(v=>v.decor===undefined||v._changed||v.active).map(v=>({id:v.id,kind:v.kind,variant:v.variant,mods:{...v.mods},bombs:v.bombs||0,bombCd:v.bombCd||0,boostEnergy:v.boostEnergy??0,boosting:!!v.boosting,lockTarget:v.lockTarget||null,lockProgress:v.lockProgress||0,lockRange:v.lockRange||0,crushed:!!v.crushed,active:v.active,bodyW:v.bodyW,bodyH:v.bodyH,bodyD:v.bodyD,x:v.x,y:v.y,z:v.z,angle:v.angle,speed:v.speed,vx:v.vx||0,vy:v.vy||0,vz:v.vz||0,slip:v.slip||0,drifting:!!v.drifting,pitch:v.pitch,roll:v.roll,stalled:!!v.stalled,wreck:v.wreck?{...v.wreck}:null,turret:v.turret,barrel:v.barrel,hp:v.hp,armour:armourSnapshot(v),driver:v.driver,fuel:v.fuel,ammo:v.ammo,mgAmmo:v.mgAmmo,rocketAmmo:v.rocketAmmo,rocketReserve:v.rocketReserve,rocketCd:v.rocketCd,rocketReload:v.rocketReload,rocketShot:v.rocketShot,rocketCursor:v.rocketCursor,rocketBurstLeft:v.rocketBurstLeft||0,heat:v.heat,overheated:v.overheated,primaryCd:v.primaryCd,wheelPhase:v.wheelPhase,steer:v.steer,engine:v.engine,airborne:v.airborne,shot:v.shot,mgShot:v.mgShot,repair:v.repair,decor:v.decor,model:v.model}));}
  shotSnapshot(){return this.rounds.map(({owner,team,...r})=>({...r}));}
  dispose(){this.a.world.removeCharacterController(this.controller);this.a.blast=this.nativeBlast;}
}
// Absolute SPARSE states. Untouched street cars are reconstructed from the deterministic map.
// A changed car keeps appearing in each later packet, so a lost packet / late join cannot lose its state.
function initVehicleMirror(map) {
  if(map._vehicleObs)return;
  map._vehicleObs=new Map();map._vehicleStates=new Map();map._vehicleDefaults=new Map();map._vehiclePrevious=new Set();
  const decor=new Map(map.obstacles.filter(o=>o.part==='car'&&o.decor!==undefined).map(o=>[o.decor,o]));
  for(const spawn of map.vehicleSpawns||[]) {
    const v=freshVehicle(spawn);map._vehicleDefaults.set(v.id,{...v});map._vehicleStates.set(v.id,v);
    const old=decor.get(v.decor);let o;
    if(old){o=old;updateVehicleObstacle(map,o,vehicleBody(v));}
    else {o=vehicleBody(v);addObstacle(map,o);}
    map._vehicleObs.set(v.id,o);
  }
  map.vehicles=[...map._vehicleStates.values()];
}
export function syncVehicles(map,states) {
  if(!Array.isArray(states)||map._vehiclePacket===states)return;
  initVehicleMirror(map);map._vehiclePacket=states;
  const live=new Set();let listChanged=false;
  for(const incoming of states) {
    if(!VEHICLES[incoming.kind]||typeof incoming.id!=='string')continue;
    const v={...incoming,active:incoming.active!==false};live.add(v.id);
    if(v.decor!==undefined&&(v.active||v.hp<=0||v.crushed)){map.hiddenVehicleDecor??=new Set();map.hiddenVehicleDecor.add(v.decor);}
    let o=map._vehicleObs.get(v.id),current=map._vehicleStates.get(v.id);
    if(v.crushed) {
      if(o){removeObstacle(map,o);map._vehicleObs.delete(v.id);}
      if(current)Object.assign(current,v);else{map._vehicleStates.set(v.id,v);listChanged=true;}
      continue;
    }
    if(!o) {
      // Compatibility with full snapshots/maps without a vehicle spawn catalogue.
      o=v.decor!==undefined?map.obstacles.find(o=>o.part==='car'&&o.decor===v.decor):null;
      if(o)updateVehicleObstacle(map,o,vehicleBody(v));else{o=vehicleBody(v);addObstacle(map,o);}
      map._vehicleObs.set(v.id,o);listChanged=true;
    } else updateVehicleObstacle(map,o,vehicleBody(v));
    if(current)Object.assign(current,v);else{map._vehicleStates.set(v.id,v);listChanged=true;}
  }
  for(const id of map._vehiclePrevious)if(!live.has(id)) {
    const base=map._vehicleDefaults.get(id),o=map._vehicleObs.get(id);
    if(base){Object.assign(map._vehicleStates.get(id),base);if(o)updateVehicleObstacle(map,o,vehicleBody(base));else {const restored=vehicleBody(base);addObstacle(map,restored);map._vehicleObs.set(id,restored);}}
    else {if(o)removeObstacle(map,o);map._vehicleObs.delete(id);map._vehicleStates.delete(id);listChanged=true;}
  }
  map._vehiclePrevious=live;
  if(listChanged)map.vehicles=[...map._vehicleStates.values()];
}
