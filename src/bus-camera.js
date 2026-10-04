// Third-person battle bus: a separate orbit controller, never the foot/vehicle camera.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:0));
export function busCameraPose(bus,look={}) {
  const heading=Math.atan2((bus.bx||0)-(bus.ax||0),(bus.bz||0)-(bus.az||0));
  const yaw=Number.isFinite(look.angle)?look.angle:heading;
  const pitch=clamp(look.pitch,-.65,.7),distance=21;
  const target={x:bus.x,y:bus.y+2.2,z:bus.z};
  const position={x:target.x-Math.sin(yaw)*Math.cos(pitch)*distance,
    y:Math.max(bus.y+1.2,target.y-Math.sin(pitch)*distance+5.2),
    z:target.z-Math.cos(yaw)*Math.cos(pitch)*distance};
  return {position,target,fov:72};
}
export function applyBusCamera(view,bus,look,dt) {
  const p=busCameraPose(bus,look),c=view.camera;
  c.position.set(p.position.x,p.position.y,p.position.z);c.lookAt(p.target.x,p.target.y,p.target.z);
  if(c.fov!==p.fov){c.fov=p.fov;c.updateProjectionMatrix();}
  c.updateMatrixWorld();view.aimFix=null;view.vehicleAim=null;view.vehicleGunAim=null;
  view.land=0;view.bobAmp=0;view.camAir=0;view.shake=0;
}
