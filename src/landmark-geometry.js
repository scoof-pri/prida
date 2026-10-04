// PRIDA 0.34: exact, non-overlapping floor plans shared by rendering and collision.
import { hull, shapeBounds, cutRect } from './architecture-geometry.js';
const EPS=1e-6;
export const floorY=k=>k===0?.045:3.84+(k-1)*3.6;
export const ceilingY=k=>3.60+k*3.6;
export const rect=(x0,z0,x1,z1)=>({x:(x0+x1)/2,z:(z0+z1)/2,w:x1-x0,d:z1-z0});
export function unionRects(rects) {
  const out=[];
  for(const r of rects)if(r.w>EPS&&r.d>EPS)out.push(...cutRect(r,out));
  return out;
}
export function floorPieces(rects,holes=[]) { return unionRects(rects).flatMap(r=>cutRect(r,holes)); }
export function inFootprint(x,z,rects,margin=0) {return rects.some(r=>Math.abs(x-r.x)<=r.w/2-margin+EPS&&Math.abs(z-r.z)<=r.d/2-margin+EPS);}
export function boundaryOf(rects) {
  const rs=unionRects(rects),edges=[];
  // Split at every corner, then keep only pieces with empty space on the outside.
  for(const r of rs)for(const [axis,at,lo,hi,out] of [
    ['x',r.z-r.d/2,r.x-r.w/2,r.x+r.w/2,-1],['x',r.z+r.d/2,r.x-r.w/2,r.x+r.w/2,1],
    ['z',r.x-r.w/2,r.z-r.d/2,r.z+r.d/2,-1],['z',r.x+r.w/2,r.z-r.d/2,r.z+r.d/2,1]]) {
    const points=[lo,hi];for(const b of rs)for(const p of axis==='x'?[b.x-b.w/2,b.x+b.w/2]:[b.z-b.d/2,b.z+b.d/2])if(p>lo+EPS&&p<hi-EPS)points.push(p);
    const xs=[...new Set(points)].sort((a,b)=>a-b);
    for(let i=0;i<xs.length-1;i++) {
      const a=xs[i],b=xs[i+1],m=(a+b)/2;
      if(inFootprint(axis==='x'?m:at+out*.001,axis==='x'?at+out*.001:m,rs))continue;
      edges.push({axis,at,lo:a,hi:b,out});
    }
  }
  const result=[];
  for(const e of edges.sort((a,b)=>a.axis.localeCompare(b.axis)||a.at-b.at||a.out-b.out||a.lo-b.lo)) {
    const last=result.at(-1);
    if(last&&last.axis===e.axis&&Math.abs(last.at-e.at)<EPS&&last.out===e.out&&Math.abs(last.hi-e.lo)<EPS)last.hi=e.hi;
    else result.push({...e});
  }
  return result;
}
export function slopePrism(from,to,width,thickness=.14) {
  const len=Math.hypot(to.x-from.x,to.z-from.z);if(len<EPS)throw Error('An escalator needs a horizontal run');
  const sx=-(to.z-from.z)/len*width/2,sz=(to.x-from.x)/len*width/2;
  const points=[];
  for(const dy of [-thickness,0])for(const [p,s] of [[from,-1],[to,-1],[to,1],[from,1]])points.push([p.x+sx*s,p.y+dy,p.z+sz*s]);
  const shape=hull(points,[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]);
  return {...shapeBounds([shape]),roofShape:[shape]};
}
export function barrelPanel(x0,x1,z0,z1,y,rise,spanCenter,spanHalf,thickness=.07) {
  const yAt=z=>y+rise*Math.sqrt(Math.max(0,1-((z-spanCenter)/spanHalf)**2));
  const a=yAt(z0),b=yAt(z1),points=[];
  for(const dy of [-thickness,0])points.push([x0,a+dy,z0],[x1,a+dy,z0],[x1,b+dy,z1],[x0,b+dy,z1]);
  const shape=hull(points,[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]);
  return {...shapeBounds([shape]),roofShape:[shape]};
}
// A horizontal tread follows a sloped conveyor; no moving collision bodies per step.
export function escalatorPose(e,t,phase=0) {
  const f=((t+phase)%1+1)%1;
  return {x:e.from.x+(e.to.x-e.from.x)*f,y:e.from.y+(e.to.y-e.from.y)*f,z:e.from.z+(e.to.z-e.from.z)*f};
}
export function validateLandmark(map,b) {
  const fail=m=>{throw Error('Landmark '+b.id+': '+m);};
  if(!b.landmark034||!b.footprints034?.length)fail('missing footprint');
  for(const level of b.footprints034){
    for(const r of level.map(a=>Array.isArray(a)?rect(...a):a))if(![r.x,r.z,r.w,r.d].every(Number.isFinite)||r.w<=0||r.d<=0)fail('invalid floor');
    const p=floorPieces(level.map(a=>Array.isArray(a)?rect(...a):a));
    const sum=p.reduce((s,r)=>s+r.w*r.d,0);if(sum<6)fail('empty floor');
  }
  for(const o of map.obstacles.filter(o=>o.building===b.id))if(![o.x,o.y,o.z,o.w,o.h,o.d].every(Number.isFinite)||Math.min(o.w,o.h,o.d)<=0)fail('invalid obstacle');
  for(const e of map.escalators||[])if(e.building===b.id){if(e.to.y<=e.from.y||e.width<.9)fail('invalid escalator');}
  return true;
}
