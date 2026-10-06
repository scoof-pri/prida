// Localized smooth relief keeps the existing streets, entrances, airfields and tile seams at grade.
import { slopePrism } from './landmark-geometry.js';
const overlap=(a,b,pad=0)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+pad&&Math.abs(a.z-b.z)<(a.d+b.d)/2+pad;
export function addMobilityRelief(map){
  if(map.size!=='city'||map.mobilityRelief038)return;map.mobilityRelief038=true;
  map.terrainFeatures??=[];
  const existing=map.terrainFeatures.map(f=>f.bounds),core=map.core;
  let n=0;
  for(const lot of map.parks||[]){
    if(lot.w<30||lot.d<30||lot.militaryBuffer||['lake','quarry'].includes(lot.type))continue;
    if(core&&lot.x>core.x0-8&&lot.x<core.x1+8&&lot.z>core.z0-8&&lot.z<core.z1+8)continue;
    const bounds={x:lot.x,z:lot.z,w:lot.w-16,d:lot.d-16};
    if(map.expansion&&overlap(bounds,map.expansion.base,8))continue;
    if(existing.some(r=>overlap(bounds,r,3)))continue;
    const kind=n%4===3?'basin':'upland';
    map.terrainFeatures.push({id:'relief-'+n,kind,x:lot.x,z:lot.z,rx:bounds.w/2,rz:bounds.d/2,
      height:kind==='basin'?-(3+n%3):5+n%5*1.6,seed:(map.seed%97)*.17+n*.73,bounds});
    n++;
  }
  // Feature lookup is cached; changing the list invalidates that cache once, not every frame.
  delete map._landscape034;map.mobilityReliefCount038=n;
}
export function reliefHeight(feature,x,z){
  const nx=(x-feature.x)/feature.rx,nz=(z-feature.z)/feature.rz,r2=nx*nx+nz*nz;
  if(r2>=1)return 0;
  const envelope=(1-r2)**2;
  if(feature.kind==='basin')return feature.height*envelope;
  const ridge=.65+.21*Math.cos(nx*5+feature.seed)*Math.cos(nz*3-feature.seed)+.14*Math.sin(nx*9+nz*6+feature.seed);
  return feature.height*envelope*ridge;
}
export function addMobilitySites(map,heightAt){
  if(map.mobilitySites038)return;map.mobilitySites038=true;map.ramps038=[];
  const e=map.expansion;
  if(e){
    const h=e.helipad||{x:e.base.x-15,z:e.base.z-60,w:13,d:13};
    // Markings sit above the single existing apron surface; they are not a second slab.
    const paint=(x,z,w,d)=>map.siteObjects.push({x,y:.093,z,w,h:.008,d,part:'site',surface:'paint',visual:true,color:0xe4e6ca});
    for(const side of[-1,1]){paint(h.x+side*5.8,h.z,.15,11.6);paint(h.x,h.z+side*5.8,11.6,.15);paint(h.x+side*1.6,h.z,.35,4.3);}
    paint(h.x,h.z,3.2,.35);
  }
  if(map.size!=='city')return;
  // Dedicated jump ramps on naturally clear meadow strips, never on the runway or across a doorway.
  const used=[];
  const candidates=(map.parks||[]).filter(p=>['meadow','grove','forest','orchard'].includes(p.type)&&p.w>=42&&p.d>=48);
  for(const lot of candidates){
    if(map.ramps038.length>=3)break;
    const x=lot.x+lot.w*.26,z=lot.z-lot.d*.1,foot={x,z,w:6.4,d:30};
    if(e&&overlap(foot,e.base,10)||used.some(r=>overlap(foot,r,10)))continue;
    if(map.obstacles.some(o=>!o.nocollide&&!o.visual&&overlap(foot,o,1)))continue;
    if([...map.roads,...map.paths,...map.buildings].some(o=>overlap(foot,o,1)))continue;
    const start={x,y:heightAt(x,z-7,map)+.015,z:z-7},end={x,y:heightAt(x,z+7,map)+3.5,z:z+7};
    if(end.y-start.y<1.8||end.y-start.y>5.5)continue;
    let clear=true;for(let k=1;k<14;k++){const t=k/14;if(heightAt(x,z-7+k,map)>start.y+(end.y-start.y)*t-.12){clear=false;break;}}
    if(!clear)continue;
    const deck={...slopePrism(start,end,5.6,.20),part:'site',surface:'wood',color:0xa99670,hp:320,mobilityRamp:true};
    const supports=[];
    for(const side of[-1,1]){const ground=heightAt(x+side*2.3,end.z-.7,map),top=end.y-.24,h=top-ground;
      if(h<=.1)continue;const o={x:x+side*2.3,y:ground+h/2,z:end.z-.7,w:.22,h,d:.22,part:'site',surface:'steel',color:0x697570,hp:180};
      map.siteObjects.push(o);map.obstacles.push(o);supports.push(o);}
    map.obstacles.push(deck);map.siteObjects.push(deck);map.siteGroups.push({supports,parts:[deck],minimum:1});
    map.ramps038.push({id:'jump-'+map.ramps038.length,x,z,w:5.6,d:14,start,end});used.push(foot);
  }
}
