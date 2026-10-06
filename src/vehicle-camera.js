// Camera state belongs to the vehicle camera, never to the on-foot camera that renders earlier/later.
// No Three.js dependency: projection adapter stays in vehicle-view.js; this math has regression tests.
import { clamp } from './vehicle-specs.js';
export class VehicleCameraState {
  constructor(){this.reset();}
  reset(){this.id=null;this.distance=0;this.releaseClock=0;}
  step(v,target,look,dt,cast,ground) {
    const plane=v.kind==='plane'||v.kind==='helicopter',yaw=Number.isFinite(look.angle)?look.angle:v.angle;
    const pitch=plane?clamp(Number.isFinite(look.pitch)?look.pitch:v.pitch,-.65,.72):clamp(look.pitch,-.5,.5);
    const reach=plane?16:v.kind==='tank'?8.8:6.4;
    const offset={x:-Math.sin(yaw)*reach,y:plane?5-Math.sin(clamp(v.pitch,-.18,.18))*reach:3.2-pitch*reach*.65,z:-Math.cos(yaw)*reach};
    const length=Math.hypot(offset.x,offset.y,offset.z);
    const dir={x:offset.x/length,y:offset.y/length,z:offset.z/length};
    // Centre and four near-plane corners. The query adapter ignores the vehicle's OWN hull.
    const right={x:Math.cos(yaw)*.22,y:0,z:-Math.sin(yaw)*.22};
    let travel=length;
    for(const [side,up] of [[0,0],[-1,-.15],[1,-.15],[-1,.15],[1,.15]]) {
      const o={x:target.x+right.x*side,y:target.y+up,z:target.z+right.z*side};
      // Do not launch a corner ray from behind an obstacle next to the pivot.
      if(side){const d={x:o.x-target.x,y:o.y-target.y,z:o.z-target.z};if(cast(target,d,1)<.99)continue;}
      const hit=cast(o,dir,length);
      if(hit<length-1e-6)travel=Math.min(travel,Math.max(.15,hit-.3));
    }
    // Retract immediately; extend only after a continuously clear interval, avoiding seam flicker.
    if(this.id!==v.id||dt<=0){this.distance=travel;this.releaseClock=0;}
    else if(travel<=this.distance+.025){this.distance=Math.min(this.distance,travel);this.releaseClock=0;}
    else {this.releaseClock+=Math.min(dt,.1);if(this.releaseClock>=.12)this.distance+=(travel-this.distance)*(1-Math.exp(-10*dt));}
    this.id=v.id;
    const position={x:target.x+dir.x*this.distance,y:target.y+dir.y*this.distance,z:target.z+dir.z*this.distance};
    position.y=Math.max(position.y,ground(position.x,position.z)+.4);
    const at=plane?{x:position.x+Math.sin(yaw)*Math.cos(pitch)*80,y:position.y+Math.sin(pitch)*80,z:position.z+Math.cos(yaw)*Math.cos(pitch)*80}
      :{x:target.x+Math.sin(yaw)*4,y:target.y+pitch*5,z:target.z+Math.cos(yaw)*4};
    return {position,at,yaw,pitch,distance:this.distance};
  }
}
