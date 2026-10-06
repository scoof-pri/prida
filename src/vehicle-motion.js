// The chassis and camera sample one timeline. No extrapolation through unseen obstacles.
import {angleDelta} from './vehicle-specs.js';
const LINEAR=['x','y','z','pitch','roll','barrel'],ANGLES=['angle','turret'];
const pose=v=>Object.fromEntries([...LINEAR,...ANGLES].map(k=>[k,Number.isFinite(v[k])?v[k]:0]));
export class VehicleMotionTrack {
 constructor(){this.samples=[];this.discontinuity=false;}
 push(v,time){
  if(!Number.isFinite(time))return;
  const q={...pose(v),time},last=this.samples.at(-1);
  this.discontinuity=!!last&&(time<last.time||Math.hypot(q.x-last.x,q.y-last.y,q.z-last.z)>20);
  if(this.discontinuity)this.samples.length=0;
  if(this.samples.at(-1)?.time===time)this.samples[this.samples.length-1]=q;else this.samples.push(q);
  while(this.samples.length>12)this.samples.shift();
 }
 at(time){
  const a=this.samples;if(!a.length)return null;if(time<=a[0].time)return {...a[0]};
  for(let i=1;i<a.length;i++)if(a[i].time>=time){
   const from=a[i-1],to=a[i],t=(time-from.time)/Math.max(1e-9,to.time-from.time),out={time};
   for(const k of LINEAR)out[k]=from[k]+(to[k]-from[k])*t;
   for(const k of ANGLES)out[k]=from[k]+angleDelta(from[k],to[k])*t;return out;
  }
  return {...a.at(-1)};
 }
}
export class VehiclePresentationClock {
 constructor(){this.source=null;this.clock=0;this.generation=0;}
 update(state,dt){
  const online=Number.isFinite(state.st),time=online?state.st/1000:(Number(state.tick)||0)/60;
  if(this.source===null||time<this.source||Math.abs(time-this.clock)>.5){this.clock=time;this.generation++;}
  else if(dt>0)this.clock+=Math.min(dt,.1);
  if(time!==this.source)this.clock=Math.max(time,Math.min(time+.12,this.clock));this.source=time;
  return {source:time,time:dt<=0?time:Math.min(this.clock,time+.1)-(online?.085:1/60),generation:this.generation};
 }
}
