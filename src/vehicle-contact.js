// Shared swept pedestrian/vehicle contact; Rapier remains the primary collision solver.
const SKIN=.025;
function hitBox(origin,delta,half,ymin,ymax){
 let enter=-Infinity,exit=Infinity,axis=-1,sign=0;
 const lo=[-half[0],ymin,-half[1]],hi=[half[0],ymax,half[1]];
 for(let k=0;k<3;k++){
  if(Math.abs(delta[k])<1e-10){if(origin[k]<=lo[k]+1e-8||origin[k]>=hi[k]-1e-8)return null;continue;}
  let a=(lo[k]-origin[k])/delta[k],b=(hi[k]-origin[k])/delta[k],n=-1;
  if(a>b){[a,b]=[b,a];n=1;}
  if(a>enter){enter=a;axis=k;sign=n;}exit=Math.min(exit,b);if(enter>exit)return null;
 }
 if(enter< -1e-7&&exit>=0){
  // An overlapping character may retreat toward the closest side, not walk through the far side.
  let depth=Infinity,faceAxis=-1,faceSign=0;
  for(const k of [0,2])for(const sign of [-1,1]){const d=sign<0?origin[k]-lo[k]:hi[k]-origin[k];if(d<depth){depth=d;faceAxis=k;faceSign=sign;}}
  return faceAxis>=0&&delta[faceAxis]*faceSign< -1e-9?{t:0,axis:faceAxis,sign:faceSign}:null;
 }
 if(enter< -1e-7||enter>1||exit<0||axis<0)return null;
 return {t:Math.max(0,enter),axis,sign};
}
export function sweepVehicleContacts(map,feet,requested,{radius=.34,height=1.68}={}){
 if(!map||feet?.vehicle)return {...requested};
 const pos={x:feet.x,y:feet.y||0,z:feet.z},base={...pos};
 let left={x:requested.x||0,y:requested.y||0,z:requested.z||0},supported=false,contacts=0;
 for(let pass=0;pass<3;pass++){
  if(Math.hypot(left.x,left.y,left.z)<1e-9)break;
  let best=null;
  const visit=o=>{
   if(o.vehicleId===undefined||o.nocollide||!o.doorLeaf)return;
   const p=o.doorLeaf,c=Math.cos(p.yaw),s=Math.sin(p.yaw),dx=pos.x-p.x,dz=pos.z-p.z;
   const hit=hitBox([c*dx-s*dz,pos.y,s*dx+c*dz],[c*left.x-s*left.z,left.y,s*left.x+c*left.z],[p.w/2+radius,p.t/2+radius],p.y-p.h/2-height,p.y+p.h/2+SKIN);
   if(!hit||(best&&hit.t>=best.t))return;
   const local=[0,0,0];local[hit.axis]=hit.sign;
   const n={x:c*local[0]+s*local[2],y:local[1],z:-s*local[0]+c*local[2]};
   if(n.x*left.x+n.y*left.y+n.z*left.z>=-1e-9)return;best={t:hit.t,n};
  };
  const x1=pos.x+left.x,z1=pos.z+left.z;
  if(map.obstacles?.grid)map.obstacles.grid.query(Math.min(pos.x,x1)-radius,Math.min(pos.z,z1)-radius,Math.max(pos.x,x1)+radius,Math.max(pos.z,z1)+radius,visit);
  else for(const o of map._vehicleObs?.values()||map.obstacles||[])visit(o);
  if(!best){pos.x+=left.x;pos.y+=left.y;pos.z+=left.z;break;}
  const t=Math.max(0,Math.min(1,best.t-SKIN/Math.max(Math.hypot(left.x,left.y,left.z),1e-8)));
  pos.x+=left.x*t;pos.y+=left.y*t;pos.z+=left.z*t;
  left={x:left.x*(1-t),y:left.y*(1-t),z:left.z*(1-t)};
  const into=Math.min(0,left.x*best.n.x+left.y*best.n.y+left.z*best.n.z);
  left.x-=into*best.n.x;left.y-=into*best.n.y;left.z-=into*best.n.z;
  if(best.n.y>.5)supported=true;contacts++;
 }
 return {x:pos.x-base.x,y:pos.y-base.y,z:pos.z-base.z,supported,contacts};
}
