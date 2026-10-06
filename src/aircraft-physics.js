// Playable flight assistance around explicit velocity and bounded angular inertia.
// These are game tuning values, not specifications of a real aircraft.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:0));
const approach=(a,b,rate,dt)=>a+Math.sign(b-a)*Math.min(Math.abs(b-a),rate*dt);
const angle=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
export function integrateAircraft(v,c,dt,s){
  dt=clamp(dt,0,1/15);const old=v.angle,oldPitch=v.pitch||0,oldRoll=v.roll||0;
  const working=!!v.driver&&v.hp>0&&v.fuel>0,throttle=working?clamp(c.throttle,-1,1):0,steer=working?clamp(c.steer,-1,1):0;
  const requested=Number.isFinite(c.lookPitch)?c.lookPitch+(c.climb||0)*.36:(c.climb||0)*.42;
  const pitchTarget=clamp(requested,-.65,.72),braking=!!c.brake||throttle<-.01;
  if(!v.airborne){
    v.speed=approach(v.speed,braking?0:s.max*Math.max(0,throttle),braking?s.brake:throttle>.01?s.accel:s.drag,dt);
    // Unload the wheels once airspeed and elevator demand are sufficient. Position is
    // always integrated by Rapier; takeoff never assigns an arbitrary sky coordinate.
    if(working&&v.speed>=s.takeoff&&pitchTarget>.07){v.airborne=true;v.vy=Math.max(v.vy||0,2.4);}
  }else{
    const dive=9.81*Math.sin(v.pitch||0)*.45;
    if(throttle>.01&&!braking)v.speed=approach(v.speed,s.max*throttle,s.accel,dt);
    else v.speed=Math.max(0,v.speed-(braking?5.8:s.drag+.0015*v.speed*v.speed)*dt);
    v.speed=clamp(v.speed-(dive+Math.abs(v.roll||0)*v.speed*.035)*dt,0,s.max*1.18);
  }
  const authority=v.airborne?clamp((v.speed-s.stall*.35)/(s.takeoff-s.stall*.35),.12,1):Math.min(1,v.speed/6);
  const turn=s.turn*(v.airborne?clamp(v.speed/25,.45,1.15):authority);
  let yawError=null,wantedRate=-steer*turn;
  if(working&&Number.isFinite(c.lookYaw)){yawError=angle(v.angle,c.lookYaw-steer*.55);wantedRate=clamp(yawError*5,-turn,turn);}
  v.yawRate=approach(v.yawRate||0,wantedRate,v.airborne?2.9:4.0,dt);
  let yawStep=v.yawRate*dt;if(yawError!==null&&Math.sign(yawStep)===Math.sign(yawError)&&Math.abs(yawStep)>Math.abs(yawError)){yawStep=yawError;v.yawRate=0;}
  v.angle=Math.atan2(Math.sin(old+yawStep),Math.cos(old+yawStep));
  v.steer=approach(v.steer||0,steer,4,dt);
  const target=v.airborne?(working?pitchTarget:-.20):0;
  v.pitchRate=approach(v.pitchRate||0,clamp((target-(v.pitch||0))*6,-.70*authority,.70*authority),2.4*authority,dt);
  let pitchStep=v.pitchRate*dt;if(Math.sign(pitchStep)===Math.sign(target-v.pitch)&&Math.abs(pitchStep)>Math.abs(target-v.pitch)){pitchStep=target-v.pitch;v.pitchRate=0;}
  v.pitch=clamp((v.pitch||0)+pitchStep,-.72,.76);
  const bank=v.airborne?clamp(-v.yawRate*.68,-.58,.58):0;
  v.roll=approach(v.roll||0,bank,1.25,dt);
  const horizontal=Math.max(0,v.speed*Math.cos(v.pitch)),wantedX=Math.sin(v.angle)*horizontal,wantedZ=Math.cos(v.angle)*horizontal;
  if(!v.airborne){v.vx=wantedX;v.vz=wantedZ;v.vy=-1;v.stalled=false;}
  else{
    if(!Number.isFinite(v.vx)||!Number.isFinite(v.vz)){v.vx=Math.sin(old)*v.speed;v.vz=Math.cos(old)*v.speed;}
    const align=1-Math.exp(-dt*2.9*authority);v.vx+=(wantedX-v.vx)*align;v.vz+=(wantedZ-v.vz)*align;
    const flightPath=Math.atan2(v.vy||0,Math.max(1,Math.hypot(v.vx,v.vz))),aoa=Math.abs(v.pitch-flightPath);
    const stall=clamp((s.stall-v.speed)/s.stall,0,1),separation=clamp((aoa-.40)/.55,0,.6);
    const support=clamp((v.speed/s.stall)**2,0,1)*(1-separation),targetVy=Math.sin(v.pitch)*v.speed;
    // Lift cannot support the craft below stall speed, and a steep bank spends lift
    // on turning. Elevation changes have inertia; idle flight keeps gliding momentum.
    const liftControl=clamp((targetVy-(v.vy||0))*3.4,-20,20)*support;
    const acceleration=liftControl-9.81*(1-support*Math.cos(v.roll))-stall*4.5;
    v.vy=clamp((v.vy||0)+acceleration*dt,-55,42);v.stalled=stall>.05||separation>.30;
  }
  v.engine=approach(v.engine||0,working?Math.max(.16,Math.max(0,throttle)):0,1.4,dt);
  if(working)v.fuel=Math.max(0,v.fuel-dt*(.09+.065*v.engine));
  v.wheelPhase=((v.wheelPhase||0)+v.speed*dt/s.wheel)%(Math.PI*200);
  v.primaryCd=Math.max(0,v.primaryCd-dt);v.secondaryCd=Math.max(0,v.secondaryCd-dt);
  v.heat=Math.max(0,v.heat-(s.mg?.cool||.2)*dt);if(v.overheated&&v.heat<.30)v.overheated=false;
  return {x:v.vx*dt,y:v.vy*dt,z:v.vz*dt,oldAngle:old,oldPitch,oldRoll};
}
export function aircraftImpactDamage(speed,normalSpeed,{landing=false,pitch=0,roll=0}={}){
  if(landing){const excess=Math.max(0,normalSpeed-4.5),badAttitude=Math.max(0,Math.abs(roll)-.26)*380+Math.max(0,Math.abs(pitch)-.22)*280;
    return Math.max(0,excess*excess*19+badAttitude+Math.max(0,speed-39)*18);}
  return Math.max(0,(normalSpeed-3)**2*2.6);
}
