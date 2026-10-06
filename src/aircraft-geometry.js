// One local-space airframe drives hits, Rapier collision, gun mounts and breakup.
// Units are metres; +Z is the nose. YXZ matches the vehicle render transform.
import {AIRCRAFT_HULLS} from './aircraft-hulls.js';
const finite=(n,f=0)=>Number.isFinite(n)?n:f;
export const AIRCRAFT_PARTS=AIRCRAFT_HULLS;
export const AIRCRAFT_GUNS=Object.freeze({
  cannon:Object.freeze({x:1.70,y:1.16,z:1.46}),
  left:Object.freeze({x:-1.4,y:1.16,z:1.46}),
  right:Object.freeze({x:1.4,y:1.16,z:1.46}),
});
export const aircraftShape=v=>({x:finite(v.x),y:finite(v.y),z:finite(v.z),angle:finite(v.angle),pitch:finite(v.pitch),roll:finite(v.roll)});
const shapeOf=v=>v?.aircraftShape||v;
export function aircraftTurn(p,v,inverse=false){
  v=shapeOf(v);const cy=Math.cos(finite(v.angle)),sy=Math.sin(finite(v.angle)),cp=Math.cos(finite(v.pitch)),sp=Math.sin(finite(v.pitch)),cr=Math.cos(finite(v.roll)),sr=Math.sin(finite(v.roll));
  if(inverse){
    const x=cy*p.x-sy*p.z,z=sy*p.x+cy*p.z,y=cp*p.y-sp*z,zz=sp*p.y+cp*z;
    return {x:cr*x+sr*y,y:-sr*x+cr*y,z:zz};
  }
  const x=cr*p.x-sr*p.y,y=sr*p.x+cr*p.y,yy=cp*y+sp*p.z,z=-sp*y+cp*p.z;
  return {x:cy*x+sy*z,y:yy,z:-sy*x+cy*z};
}
export function aircraftPoint(v,p){const s=shapeOf(v),r=aircraftTurn(p,s);return {x:finite(s.x)+r.x,y:finite(s.y)+r.y,z:finite(s.z)+r.z};}
export function aircraftLocal(v,p){const s=shapeOf(v);return aircraftTurn({x:p.x-finite(s.x),y:p.y-finite(s.y),z:p.z-finite(s.z)},s,true);}
export function aircraftQuaternion(v){
  v=shapeOf(v);const x=-finite(v.pitch)/2,y=finite(v.angle)/2,z=finite(v.roll)/2;
  const c1=Math.cos(x),c2=Math.cos(y),c3=Math.cos(z),s1=Math.sin(x),s2=Math.sin(y),s3=Math.sin(z);
  return {x:s1*c2*c3+c1*s2*s3,y:c1*s2*c3-s1*c2*s3,z:c1*c2*s3-s1*s2*c3,w:c1*c2*c3+s1*s2*s3};
}
export function aircraftColliderParts(v){
  const rotation=aircraftQuaternion(v);
  return AIRCRAFT_PARTS.map(p=>({...p,...aircraftPoint(v,p),half:{x:p.w/2,y:p.h/2,z:p.d/2},rotation}));
}
export function aircraftBounds(v){
  const axes=[aircraftTurn({x:1,y:0,z:0},v),aircraftTurn({x:0,y:1,z:0},v),aircraftTurn({x:0,y:0,z:1},v)];
  const lo={x:Infinity,y:Infinity,z:Infinity},hi={x:-Infinity,y:-Infinity,z:-Infinity};
  for(const p of AIRCRAFT_PARTS){const c=aircraftPoint(v,p);for(const k of ['x','y','z']){const e=Math.abs(axes[0][k])*p.w/2+Math.abs(axes[1][k])*p.h/2+Math.abs(axes[2][k])*p.d/2;lo[k]=Math.min(lo[k],c[k]-e);hi[k]=Math.max(hi[k],c[k]+e);}}
  return {x:(lo.x+hi.x)/2,y:(lo.y+hi.y)/2,z:(lo.z+hi.z)/2,w:hi.x-lo.x,h:hi.y-lo.y,d:hi.z-lo.z};
}
export function aircraftClosestPoint(v,point){
  const p=aircraftLocal(v,point);let best=null;
  for(const b of AIRCRAFT_PARTS){
    const local={x:p.x-b.x,y:p.y-b.y,z:p.z-b.z};
    if(b.planes.every(([x,y,z,w])=>x*local.x+y*local.y+z*local.z<=w+1e-7))return {...point,distance:0,part:b.id};
    const vertex=i=>({x:b.vertices[i*3],y:b.vertices[i*3+1],z:b.vertices[i*3+2]});
    for(let i=0;i<b.triangles.length;i+=3){const q=closestTriangle(local,vertex(b.triangles[i]),vertex(b.triangles[i+1]),vertex(b.triangles[i+2])),distance=Math.hypot(local.x-q.x,local.y-q.y,local.z-q.z);
      if(!best||distance<best.distance)best={...aircraftPoint(v,{x:b.x+q.x,y:b.y+q.y,z:b.z+q.z}),distance,part:b.id};}
  }
  return best;
}
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
function closestTriangle(p,a,b,c){
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return mix(a,b,d1/(d1-d3));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return mix(a,c,d2/(d2-d6));
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return mix(b,c,(d4-d3)/(d4-d3+d5-d6));
  const inv=1/(va+vb+vc),u=vb*inv,w=vc*inv;return {x:a.x+ab.x*u+ac.x*w,y:a.y+ab.y*u+ac.y*w,z:a.z+ab.z*u+ac.z*w};
}
function slabRay(o,d,min,max,range){
  let enter=0,exit=range,normal={x:0,y:0,z:0};
  for(const k of ['x','y','z']){
    if(Math.abs(d[k])<1e-10){if(o[k]<min[k]||o[k]>max[k])return null;continue;}
    let a=(min[k]-o[k])/d[k],b=(max[k]-o[k])/d[k],sign=-1;if(a>b){[a,b]=[b,a];sign=1;}
    if(a>enter){enter=a;normal={x:0,y:0,z:0};normal[k]=sign;}exit=Math.min(exit,b);if(enter>exit)return null;
  }
  return exit>=0&&enter<=range?{distance:Math.max(0,enter),normal}:null;
}
export function rayAircraft(v,origin,dir,range){
  const o=aircraftLocal(v,origin),d=aircraftTurn(dir,v,true);let best=null;
  for(const b of AIRCRAFT_PARTS){
    if(!slabRay(o,d,{x:b.x-b.w/2,y:b.y-b.h/2,z:b.z-b.d/2},{x:b.x+b.w/2,y:b.y+b.h/2,z:b.z+b.d/2},best?.distance??range))continue;
    const hit=hullRay(b,{x:o.x-b.x,y:o.y-b.y,z:o.z-b.z},d,best?.distance??range);
    if(hit&&(!best||hit.distance<best.distance))best={distance:hit.distance,...aircraftTurn(hit.normal,v),part:b.id};
  }
  return best;
}
function hullRay(b,o,d,range,inflate=()=>0){
  let enter=0,exit=range,normal={x:0,y:0,z:0},closest=-Infinity,insideNormal=normal;
  for(const [x,y,z,w] of b.planes){const side=x*o.x+y*o.y+z*o.z-w-inflate(x,y,z),slope=x*d.x+y*d.y+z*d.z;
    if(side>closest){closest=side;insideNormal={x,y,z};}
    if(Math.abs(slope)<1e-10){if(side>0)return null;continue;}
    const t=-side/slope;
    if(slope<0){if(t>enter){enter=t;normal={x,y,z};}}else exit=Math.min(exit,t);
    if(enter>exit)return null;
  }
  if(exit<0||enter>range)return null;
  return {distance:Math.max(0,enter),normal:enter<=0?insideNormal:normal};
}
// Capsule support is projected onto each local axis. This fallback is conservative only
// by the capsule radius, never by the old empty wing-to-tail envelope.
export function sweepAircraft(v,feet,delta,radius=.34,height=1.68){
  const center={x:feet.x,y:feet.y+height/2,z:feet.z},o=aircraftLocal(v,center),d=aircraftTurn(delta,v,true),up=aircraftTurn({x:0,y:1,z:0},v,true);
  const segment=Math.max(0,height/2-radius);let best=null;
  for(const b of AIRCRAFT_PARTS){
    const hit=hullRay(b,{x:o.x-b.x,y:o.y-b.y,z:o.z-b.z},d,best?.t??1,(x,y,z)=>radius+segment*Math.abs(x*up.x+y*up.y+z*up.z));if(!hit)continue;
    const n=aircraftTurn(hit.normal,v);if(n.x*delta.x+n.y*delta.y+n.z*delta.z>=-1e-9)continue;
    if(!best||hit.distance<best.t)best={t:hit.distance,n,part:b.id};
  }
  return best;
}
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
function obbOverlap(a,b,margin){
  const axes=[...a.axes,...b.axes];for(const x of a.axes)for(const y of b.axes)axes.push(cross(x,y));
  const delta={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z};
  for(const axis of axes){const n=Math.hypot(axis.x,axis.y,axis.z);if(n<1e-7)continue;
    const extent=(p)=>p.axes.reduce((s,q,i)=>s+Math.abs(dot(q,axis))*p.half[i],0);
    if(Math.abs(dot(delta,axis))>=extent(a)+extent(b)-margin*n)return false;
  }return true;
}
function partsOBB(v){const axes=[aircraftTurn({x:1,y:0,z:0},v),aircraftTurn({x:0,y:1,z:0},v),aircraftTurn({x:0,y:0,z:1},v)];return AIRCRAFT_PARTS.map(p=>({...aircraftPoint(v,p),axes,half:[p.w/2,p.h/2,p.d/2]}));}
export function aircraftTouchesBox(v,o,margin=.005){
  const others=o.aircraftShape?partsOBB(o):(()=>{const p=o.doorLeaf||{x:o.x,y:o.y,z:o.z,w:o.w,h:o.h,t:o.d,yaw:o.rot||0},c=Math.cos(p.yaw),s=Math.sin(p.yaw);return [{x:p.x,y:p.y,z:p.z,half:[p.w/2,p.h/2,p.t/2],axes:[{x:c,y:0,z:-s},{x:0,y:1,z:0},{x:s,y:0,z:c}]}];})();
  return partsOBB(v).some(a=>others.some(b=>obbOverlap(a,b,margin)));
}
export function aircraftGunPose(v,secondary=false){
  const p=secondary?(v.mgShot%2?AIRCRAFT_GUNS.left:AIRCRAFT_GUNS.right):{...AIRCRAFT_GUNS.cannon,x:AIRCRAFT_GUNS.cannon.x*(v.shot%2?-1:1)};
  return {origin:aircraftPoint(v,p),base:aircraftPoint(v,{x:p.x,y:p.y,z:p.z-.65}),dir:aircraftTurn({x:0,y:0,z:1},v)};
}
