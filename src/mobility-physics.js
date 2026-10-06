// 0.38: game-only vehicle dynamics. Position corrections remain owned by Rapier.
// All rates use seconds and velocity is world-space: steering does not teleport the momentum vector.
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, a, b) => Math.max(a, Math.min(b, finite(n)));
const approach = (a,b,rate,dt) => a+Math.sign(b-a)*Math.min(Math.abs(b-a),rate*dt);
const damp = (a,b,rate,dt) => b+(a-b)*Math.exp(-rate*dt);
const delta = (a,b) => Math.atan2(Math.sin(b-a),Math.cos(b-a));
function clocks(v,s,dt,working,engineTarget) {
  v.engine=approach(finite(v.engine),working?engineTarget:0,1.1,dt);
  if(working)v.fuel=Math.max(0,v.fuel-dt*(.04+.07*v.engine+(v.kind==='helicopter'?.075:0)));
  v.primaryCd=Math.max(0,finite(v.primaryCd)-dt);
  v.secondaryCd=Math.max(0,finite(v.secondaryCd)-dt);
  v.heat=Math.max(0,finite(v.heat)-(s.mg?.cool||.2)*dt);
  if(v.overheated&&v.heat<.3)v.overheated=false;
}
export function integrateCar(v,c,dt,s) {
  dt=clamp(dt,0,1/15);
  const working=!!v.driver&&v.hp>0&&v.fuel>0,grounded=v._grounded!==false&&!v.airborne;
  const throttle=working?clamp(c.throttle,-1,1):0,steer=working?clamp(c.steer,-1,1):0;
  const brake=!!c.brake||!working,oldAngle=finite(v.angle),fx=Math.sin(oldAngle),fz=Math.cos(oldAngle);
  let vx=finite(v.vx,fx*finite(v.speed)),vz=finite(v.vz,fz*finite(v.speed));
  let forward=vx*fx+vz*fz,lateral=vx*fz-vz*fx;
  v.steer=approach(finite(v.steer),steer,4,dt);
  if(grounded) {
    const wanted=(throttle>=0?s.max:s.reverse)*throttle;
    forward=approach(forward,brake?0:wanted,brake?s.brake*.62:Math.abs(throttle)>.01?s.accel:s.drag,dt);
    // Handbrake lets the back slide; releasing restores grip gradually, not in one frame.
    const grip=brake&&Math.abs(forward)>4?1.0:7.0;
    lateral*=Math.exp(-grip*dt);
    vx=fx*forward+fz*lateral;vz=fz*forward-fx*lateral;
    const yaw=-v.steer*s.turn*Math.min(1,Math.abs(forward)/3.5)*Math.sign(forward||1)*(brake?1.2:1);
    v.angle=oldAngle+yaw*dt;
  } else {
    // No airborne traction and no magical steering thrust. Only a little attitude control.
    vx*=Math.exp(-.025*dt);vz*=Math.exp(-.025*dt);
    v.angle=oldAngle-v.steer*.22*dt;
  }
  v.angle=Math.atan2(Math.sin(v.angle),Math.cos(v.angle));
  const mag=Math.hypot(vx,vz),cap=s.max*1.12;
  if(mag>cap){vx*=cap/mag;vz*=cap/mag;}
  v.vx=vx;v.vz=vz;v.speed=vx*Math.sin(v.angle)+vz*Math.cos(v.angle);
  const side=vx*Math.cos(v.angle)-vz*Math.sin(v.angle);
  v.drifting=grounded&&Math.hypot(vx,vz)>5&&Math.abs(side)>1.2;
  v.slip=grounded?Math.atan2(side,Math.max(1,Math.abs(v.speed))):0;
  v.roll=damp(finite(v.roll),grounded?clamp(-v.steer*v.speed*.007,-.16,.16):0,5,dt);
  v.pitch=damp(finite(v.pitch),grounded?finite(v.roadPitch):Math.max(-.3,finite(v.pitch)-dt*.10),6,dt);
  v.vy=Math.max(-38,finite(v.vy)-20*dt);
  clocks(v,s,dt,working,Math.max(.18,Math.abs(throttle)));
  v.wheelPhase=(finite(v.wheelPhase)+v.speed*dt/s.wheel)%(Math.PI*200);
  // Follow the last native support plane. Re-projecting a horizontal velocity against
  // the same ramp every tick would erroneously remove speed in a frame-rate-dependent way.
  const surfaceVy=grounded?clamp(finite(v.supportSlopeX)*vx+finite(v.supportSlopeZ)*vz,-16,16):0;
  return {x:vx*dt,y:(v.vy+surfaceVy)*dt,z:vz*dt,oldAngle};
}
export function integrateHelicopter(v,c,dt,s) {
  dt=clamp(dt,0,1/15);
  const working=!!v.driver&&v.hp>0&&v.fuel>0,oldAngle=finite(v.angle);
  const throttle=working?clamp(c.throttle,-1,1):0,strafe=working?clamp(c.steer,-1,1):0;
  const climb=working?clamp(c.climb,-1,1):0;
  clocks(v,s,dt,working,1);
  const rotor=finite(v.engine),flying=v.airborne||v._grounded===false;
  if(working&&rotor>.78&&climb>.02){v.airborne=true;v.vy=Math.max(finite(v.vy),.9);}
  const desiredYaw=working&&Number.isFinite(c.lookYaw)?c.lookYaw:oldAngle;
  const turn=clamp(delta(oldAngle,desiredYaw),-s.turn*dt,s.turn*dt);
  v.angle=Math.atan2(Math.sin(oldAngle+turn),Math.cos(oldAngle+turn));
  const f={x:Math.sin(v.angle),z:Math.cos(v.angle)},right={x:-f.z,z:f.x};
  const power=working&&rotor>.78&&v.airborne?1:0,normal=Math.max(1,Math.hypot(throttle,strafe));
  const tx=(f.x*throttle+right.x*strafe)*s.max*power/normal,tz=(f.z*throttle+right.z*strafe)*s.max*power/normal;
  v.vx=approach(finite(v.vx),tx,power?s.accel:4,dt);v.vz=approach(finite(v.vz),tz,power?s.accel:4,dt);
  v.speed=Math.hypot(v.vx,v.vz);v.steer=strafe;
  if(v.airborne||flying) {
    if(working&&rotor>.78)v.vy=approach(finite(v.vy),climb*(climb>0?s.climb:s.descend),s.verticalAccel,dt);
    else v.vy=Math.max(-32,finite(v.vy)-12*dt);
  } else v.vy=-.8;
  // Mild visual pitch/roll. Camera heading remains independent of rotor vibration.
  const forward=v.vx*f.x+v.vz*f.z;
  v.pitch=damp(finite(v.pitch),v.airborne?clamp(-forward*.008,-.23,.15):0,4,dt);
  v.roll=damp(finite(v.roll),v.airborne?clamp(strafe*.14-turn/Math.max(dt,.001)*.12,-.24,.24):0,4,dt);
  v.wheelPhase=finite(v.wheelPhase);
  return {x:v.vx*dt,y:v.vy*dt,z:v.vz*dt,oldAngle};
}
export function finishCarContact(v,moved,dt,wasGrounded,grounded,impactVelocity) {
  if(!(dt>0))return 0;
  const actual=Math.hypot(moved.x,moved.z)/dt;
  // Clamp momentum to collision-corrected displacement: walls cannot accumulate stored speed.
  v.vx=moved.x/dt;v.vz=moved.z/dt;
  v.speed=v.vx*Math.sin(v.angle)+v.vz*Math.cos(v.angle);
  let damage=0;
  if(grounded){
    if(!wasGrounded&&impactVelocity<-7)damage=Math.min(250,(-impactVelocity-7)**2*4);
    // A curb/autostep is not a ramp. Keep only plausible sustained slope velocity.
    const slope=moved.y/dt;
    v.rampVelocity=wasGrounded&&actual>5&&slope>.12&&slope<actual*.65?damp(finite(v.rampVelocity),slope,18,dt):0;
    v.airborne=false;
  } else {
    if(wasGrounded&&actual>5&&finite(v.rampVelocity)>.6)v.vy=Math.min(14,v.rampVelocity);
    v.airborne=true;v.drifting=false;
  }
  return damage;
}

// Shared gun mount follows the same YXZ body/pivot transform as the rendered helicopter.
export function helicopterGunPose(v) {
  const rotate=(p,yaw,pitch,roll=0)=>{
    const x=p.x*Math.cos(roll)-p.y*Math.sin(roll),y=p.x*Math.sin(roll)+p.y*Math.cos(roll);
    const yy=y*Math.cos(pitch)+p.z*Math.sin(pitch),z=-y*Math.sin(pitch)+p.z*Math.cos(pitch);
    return {x:x*Math.cos(yaw)+z*Math.sin(yaw),y:yy,z:-x*Math.sin(yaw)+z*Math.cos(yaw)};
  };
  const yaw=finite(v.angle),pitch=finite(v.pitch),roll=finite(v.roll),relative=finite(v.barrel)-pitch;
  const forward=rotate(rotate({x:0,y:0,z:1},0,relative),yaw,pitch,roll);
  const anchor=rotate({x:0,y:.86,z:2.28},yaw,pitch,roll);
  const base={x:v.x+anchor.x,y:v.y+anchor.y,z:v.z+anchor.z};
  return {base,origin:{x:base.x+forward.x*.78,y:base.y+forward.y*.78,z:base.z+forward.z*.78},dir:forward};
}
