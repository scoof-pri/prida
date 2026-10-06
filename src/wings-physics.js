// KITE wings: unpowered arcade gliding, not a flight/hover cheat.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
export function stopWings(p){p.wingsOpen=false;p.wingSpeed=0;p.wingPitch=0;p.wingYaw=Number.isFinite(p.angle)?p.angle:0;}
export function stepWings(p,input,dt,heightAboveGround) {
  const held=(input.ascend||0)>0;
  if(p.gear?.id!=='wings'||!held||p.hp<=0||p.vehicle||p.inBus||p.grounded||p.cheats?.flight||p.frozen>0||(!p.wingsOpen&&heightAboveGround<2)){
    stopWings(p);return null;
  }
  dt=clamp(dt,0,1/15);
  if(!p.wingsOpen){p.wingSpeed=clamp(Math.hypot(p.moving||12,p.vy||0),10,34);p.wingYaw=p.angle||0;p.wingPitch=-.10;}
  const oldYaw=p.wingYaw||0,desiredYaw=Number.isFinite(input.angle)?input.angle:oldYaw;
  const yaw=Math.atan2(Math.sin(desiredYaw-oldYaw),Math.cos(desiredYaw-oldYaw));
  p.wingYaw=oldYaw+clamp(yaw,-1.5*dt,1.5*dt);
  const requested=clamp(input.pitch,-.85,.46),pitch=p.wingPitch||0;
  p.wingPitch=pitch+clamp(requested-pitch,-.85*dt,.85*dt);
  // Raising the nose spends airspeed; descent replenishes it. Drag never provides energy.
  p.wingSpeed=clamp(p.wingSpeed+(-13*Math.sin(p.wingPitch)-.012*p.wingSpeed**2-.5)*dt,3,36);
  const stall=clamp((13-p.wingSpeed)/8,0,1),wantVy=Math.sin(p.wingPitch)*p.wingSpeed-2.2-stall*8;
  const prior=(p.vy||0)+22*dt; // Arena has already applied this tick's ordinary falling gravity.
  p.vy=clamp(wantVy+(prior-wantVy)*Math.exp(-4*dt),-28,12);
  p.wingsOpen=true;p.gliding=true;p.dropping=false;p.launched=false;p.thrusting=false;
  const speed=Math.cos(p.wingPitch)*p.wingSpeed;
  return {x:Math.sin(p.wingYaw)*speed,z:Math.cos(p.wingYaw)*speed};
}
