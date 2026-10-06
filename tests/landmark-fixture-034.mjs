import {buildLandmark} from '../src/landmark-world.js';
import {loadWorld,loadFurniture,furniturePort} from './interior-fixture-033.mjs';
export async function landmarkFixture(role='mall',furnished=false) {
 const b={id:0,x:0,z:0,w:role==='mall'?40:18,d:role==='mall'?19:20,storeys:role==='bank'?1:2,type:role==='mall'?'mall':role==='bank'?'bank':role==='courtyard'?'courtyard-residence':'terraced-office',category:role==='courtyard'?'home':'office',landmark034:role,color:0xc5c2b8,accent:0x53615c,sign:role,door:2.7};
 const map={seed:91726,size:'city',limit:{x:100,z:100},buildings:[b],obstacles:[],siteObjects:[],siteGroups:[],spawns:[],windows:[],doors:[],panels:0,decor:[],chests:[],roads:[],paths:[],waters:[],trees:[],flora:[],parks:[],hills:[],plots:[],lairs:[],rocks:[],cover:[],trash:[]};
 buildLandmark(map,b);const {buildInterior}=await loadWorld();buildInterior(map,b);
 if(furnished){const {furnishPlannedFloor}=await loadFurniture();for(let k=0;k<=b.storeys;k++)furnishPlannedFloor(b,k,furniturePort(map,b,k));}
 map.doors.forEach((d,id)=>d.id=id);
 let id=0;for(const o of map.obstacles)if(o.part==='site'||o.part==='stair'||o.part==='glass')o.prop=id++;
 return {map,b};
}
export function reachableFloor(map,b,k,{radius=.29,step=.16}={}) {
 const y=k===0?.045:3.84+(k-1)*3.6,W=Math.ceil(b.w/step),D=Math.ceil(b.d/step),ox=-b.w/2,oz=-b.d/2;
 const bounds=new Uint8Array(W*D),seen=new Uint8Array(W*D),queue=[];
 const solid=map.obstacles.filter(o=>!o.nocollide&&o.part!=='stair'&&o.part!=='roof'&&o.part!=='upper'&&o.y+o.h/2>y+.25&&o.y-o.h/2<y+1.55);
 const slabs=map.obstacles.filter(o=>o.part==='roof'&&Math.abs(o.y+o.h/2-y)<.08);
 const ramps=map.escalators.filter(e=>e.storey===k||e.storey+1===k);
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  const px=ox+(x+.5)*step,pz=oz+(z+.5)*step;
  const floor=slabs.some(o=>Math.abs(px-o.x)<o.w/2+.02&&Math.abs(pz-o.z)<o.d/2+.02);
  bounds[z*W+x]=!floor||solid.some(o=>Math.abs(px-o.x)<o.w/2+radius&&Math.abs(pz-o.z)<o.d/2+radius);
 }
 const node=(x,z)=>Math.max(0,Math.min(D-1,Math.floor((z-oz)/step)))*W+Math.max(0,Math.min(W-1,Math.floor((x-ox)/step)));
 // Feed the main entrance or the fixed east stair/lift hall. Stairs themselves connect floors separately.
 let starts=k===0?[[b.entry034[0],b.entry034[1]-1.2]]:[[b.w/2-1.3,4.15],[b.w/2-3.0,-4.4]];
 for(const a of starts){const i=node(...a);if(!bounds[i]){queue.push(i);seen[i]=1;}}
 for(let i=0;i<queue.length;i++){const n=queue[i],x=n%W,z=Math.floor(n/W);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Z=z+dz,j=Z*W+X;if(X<0||X>=W||Z<0||Z>=D||bounds[j]||seen[j])continue;seen[j]=1;queue.push(j);}}
 return {seen,bounds,W,D,ox,oz,step,reachable:(x,z)=>!!seen[node(x,z)],count:queue.length};
}
