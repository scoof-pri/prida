import { hull, shapeBounds } from './architecture-geometry.js';
// Native independently destructible modules, safe landscaping and no new remote assets.
export function detailSites(map, groundHeight) {
  if(typeof groundHeight!=='function')throw Error('detailSites requires the authoritative height sampler');
  if(map.siteDetailVersion)return;map.siteDetailVersion=1;
  const source=map.siteObjects||[],replacement=new Map(),out=[];
  for(const o of source){
    if(!o.visual && o.escalatorId===undefined && !o.roofGlass034 && o.roofShape?.length===1 && o.d>8) {
      const sh=o.roofShape[0],n=Math.ceil(o.d/5),parts=[];
      const lo=o.z-o.d/2,hi=o.z+o.d/2;
      for(let k=0;k<n;k++){
        const a=lo+k*o.d/n,b=lo+(k+1)*o.d/n,points=[];
        for(let i=0;i<sh.vertices.length;i+=3)points.push([sh.vertices[i],sh.vertices[i+1],a+(sh.vertices[i+2]-lo)/(hi-lo)*(b-a)]);
        const shape=hull(points,sh.faces.map(f=>f.ids),sh.faces.map(f=>f.kind));
        parts.push({...o,...shapeBounds([shape]),roofShape:[shape],hp:Math.max(55,o.hp/Math.sqrt(n)),detailCell:true});
      }
      replacement.set(o,parts);out.push(...parts);continue;
    }
    const vertical=!o.visual&&!o.roofShape&&o.h>=1.3&&Math.min(o.w,o.d)<.75&&Math.max(o.w,o.d)>2.4;
    if(!vertical){out.push(o);continue;}
    const alongX=o.w>=o.d,L=alongX?o.w:o.d,n=Math.ceil(L/1.8),rows=Math.ceil(o.h/1.15),parts=[];
    for(let y=0;y<rows;y++)for(let i=0;i<n;i++)parts.push({...o,
      x:o.x+(alongX?(i+.5)*L/n-L/2:0),z:o.z+(alongX?0:(i+.5)*L/n-L/2),y:o.y-o.h/2+(y+.5)*o.h/rows,
      w:alongX?L/n:o.w,d:alongX?o.d:L/n,h:o.h/rows,hp:Math.max(38,Math.min(90,o.hp/Math.sqrt(n*rows))),detailCell:true,foundation:y===0});
    replacement.set(o,parts);out.push(...parts);
  }
  if(replacement.size){map.siteObjects=out;const updated=map.obstacles.flatMap(o=>replacement.get(o)||[o]);map.obstacles.length=0;for(const o of updated)map.obstacles.push(o);
    for(const g of map.siteGroups||[]){const changed=g.supports.some(o=>replacement.has(o));g.supports=g.supports.flatMap(o=>replacement.has(o)?replacement.get(o).filter(p=>p.foundation):[o]);g.parts=g.parts.flatMap(o=>replacement.get(o)||[o]);if(changed)g.minimum=Math.max(2,Math.ceil(g.supports.length*.55));}
  }
  const e=map.expansion;if(!e)return;
  let s=(map.seed^0x31415)>>>0;const rnd=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
  const rects=[...(e.vehicleSpawns||[]).map(v=>({...v,w:v.kind==='plane'?13:7,d:v.kind==='plane'?13:9})),...map.roads,...map.paths,...map.buildings,...(e.services||[]).map(p=>({...p,w:p.r*2+8,d:p.r*2+8})),e.runway];
  const safe=(x,z,r)=>Math.abs(x)<map.limit.x-r-5&&Math.abs(z)<map.limit.z-r-5&&!rects.some(q=>Math.abs(x-q.x)<q.w/2+r+3&&Math.abs(z-q.z)<q.d/2+r+3)&&!map.obstacles.some(o=>Math.abs(x-o.x)<o.w/2+r+1&&Math.abs(z-o.z)<o.d/2+r+1);
  const addTree=(x,z,pine)=>{
    if(!safe(x,z,1.8))return;
    const y=groundHeight(x,z,map),index=map.trees.length;map.trees.push([x,z,pine?'pine':'broad']);
    map.obstacles.push({x,y:y+1.2,z,w:.5,h:2.4,d:.5,part:'tree',tree:index,ground:y,color:0x6d6150});
    for(let j=0;j<2;j++)map.flora.push({x:x+(rnd()-.5)*3,z:z+(rnd()-.5)*3,kind:'fern',s:.65+rnd()*.4});
  };
  // Keep approaches and the flight path unobstructed. Existing terrain/road heights are not moved.
  for(const poi of [e.base,...e.villas]){
    for(let i=0;i<38;i++){
      const a=2*Math.PI*i/38,x=poi.x+Math.cos(a)*(poi.w/2+8+rnd()*5),z=poi.z+Math.sin(a)*(poi.d/2+8+rnd()*5);
      if(poi===e.base&&Math.abs(x-e.runway.x)<16)continue;
      addTree(x,z,poi===e.base);
    }
    // Rounded banks outside structures. The triangle terrain, collider and greenery share the heights.
    for(let i=0;i<7;i++){
      const a=rnd()*Math.PI*2,r=4+rnd()*3,x=poi.x+Math.cos(a)*(poi.w/2+20),z=poi.z+Math.sin(a)*(poi.d/2+20);
      if(poi===e.base&&Math.abs(x-e.runway.x)<20)continue;
      if(safe(x,z,r)){map.hills.push({x,z,radius:r,height:.45+rnd()*.8});delete map._hillGrid;}
    }
  }
  // Pallet stacks and sandbag cover are independent prop records, so impact removes only hit sections.
  const b=e.base;
  for(const side of [-1,1])for(let level=0;level<3;level++)for(let k=0;k<5;k++){
    const o={x:(side<0?b.x-49:e.runway.x-e.runway.w/2-5)+(k-2)*.83+(level%2?.2:0),y:.16+level*.30,z:b.z+51,w:.80,h:.28,d:.53,part:'site',surface:'fabric',color:0x999574,hp:45,detailCell:true};
    map.obstacles.push(o);map.siteObjects.push(o);
  }
}
