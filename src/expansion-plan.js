// Deterministic locations: Fort North is adjacent to the city core; villas stay south.
import { subtractRect as subtractReservation } from './architecture-geometry.js';
export function expansionPlan(limit, core = null) {
  const edge=limit.z;
  // Big Royale uses the edge of the CITY CORE, not the outer wilderness/map boundary.
  const townNorth=Number.isFinite(core?.z0)?core.z0:-edge;
  const base={id:'fort',name:'FORT NORTH',x:-34,z:townNorth-(Number.isFinite(core?.z0)?96:86),w:160,d:156};
  const villas=[{id:'solara',name:'VILLA SOLARA',x:-49,z:edge+62,w:66,d:76,color:0xe5d9c2,accent:0x688779},
    {id:'vista',name:'VILLA VISTA',x:49,z:edge+62,w:66,d:76,color:0xd0dce0,accent:0x577783}];
  const runway={x:base.x+53,z:base.z,w:16,d:144};
  return {base,villas,runway,townNorth,oldLimit:{...limit},limit:{x:limit.x,z:limit.z+174},
    services:[{x:base.x-22,z:base.z+48,r:7},{x:villas[0].x+20,z:villas[0].z+25,r:4.5},{x:villas[1].x+20,z:villas[1].z+25,r:4.5}]};
}
export function addExpansionPlots(map) {
  if(map.expansion)return;
  const e=map.expansion=expansionPlan(map.limit,map.core);Object.assign(map.limit,e.limit);
  // Reserve a clear, flat strip BEFORE wilderness generation. Keep plot indices stable.
  const reservation={x:e.base.x,z:e.base.z,w:e.base.w+12,d:e.base.d+12};
  const overlap=(a,b)=>Math.abs(a.x-b.x)<(a.w+b.w)/2 && Math.abs(a.z-b.z)<(a.d+b.d)/2;
  if (map.core && map.parks) {
    const reserved=new Set(map.parks.filter(p=>overlap(p,reservation)).map(p=>p.id));
    for(let i=map.parks.length-1;i>=0;i--)if(reserved.has(map.parks[i].id))map.parks.splice(i,1);
    for(const p of map.plots)if(reserved.has(p.id))p.militaryBuffer=true;
    // Roads beneath the runway/apron must not render through the new base surfaces.
    if(map.roads) {
      const result=map.roads.flatMap(r=>subtractReservation(r,reservation));
      map.roads.splice(0,map.roads.length,...result);
    }
  }
  const make=(x,z,w,d,type,sign,category,color,accent,storeys=0,poi)=>{
    const kind={type,sign,category,w,d,height:storeys?9.4:5.8,storeys,color,accent,plots:[1,1],model:'building-house-a',poi};
    const p={id:map.plots.length,x,z,w:w+4,d:d+4,cells:[-100-map.plots.length],cols:1,rows:1,type:'building',kind,poi};
    map.plots.push(p);
  };
  const b=e.base;
  make(b.x-39,b.z-45,20,16,'warehouse','NORTH / ARMORY','industry',0x909789,0x555f51,0,b.id);
  make(b.x-39,b.z-17,20,16,'office','COMMAND','office',0xc6c4b5,0x647467,1,b.id);
  make(b.x-39,b.z+14,20,18,'hotel','BARRACKS','shop',0xb9bea9,0x52624e,1,b.id);
  for(const v of e.villas){
    make(v.x-7,v.z-10,22,18,'villa',v.name,'home',v.color,v.accent,1,v.id);
    make(v.x+13,v.z-9,14,16,'bungalow',v.name+' / GUEST','home',v.color,v.accent,0,v.id);
  }
  // No overlap between access roads and the runway; each junction is cut by prepareArchitecture.
  map.paths.push({x:0,z:(e.townNorth+e.base.z+e.base.d/2)/2,w:9,d:e.townNorth-(e.base.z+e.base.d/2)+8,color:0xaa9576},
    {x:0,z:e.oldLimit.z+20,w:9,d:40,color:0xaa9576});
  for(const v of e.villas)map.paths.push({x:v.x/2,z:e.oldLimit.z+40,w:Math.abs(v.x)+9,d:7,color:0xd9c99f},
    {x:v.x,z:v.z+4,w:6,d:40,color:0xd9c99f});
  // These placements are not added to the default spawn pool: entering a battle should not trap anyone in a hangar.
  e.vehicleSpawns=[
    {id:'heli-1',kind:'helicopter',x:b.x-15,z:b.z-60,angle:0},
    {id:'tank-1',kind:'tank',x:b.x-6,z:b.z+38,angle:0},
    {id:'tank-2',kind:'tank',variant:'twin',x:b.x+5,z:b.z+38,angle:0},
    {id:'air-defence-1',kind:'tank',variant:'sam',x:b.x-18,z:b.z+38,angle:0},
    {id:'fighter-1',kind:'plane',x:e.runway.x,z:e.runway.z+46,angle:Math.PI},
    {id:'fighter-2',kind:'plane',x:b.x+14,z:b.z-46,angle:0},
    {id:'base-car',kind:'car',x:b.x-10,z:b.z+57,angle:0},
    ...e.villas.map(v=>({id:v.id+'-car',kind:'car',x:v.x+20,z:v.z+25,angle:Math.PI}))];
  e.helipad={x:b.x-15,z:b.z-60,w:13,d:13};
  e.services.push({x:e.helipad.x,z:e.helipad.z,r:5});
  e.pois=[{id:b.id,name:b.name,x:b.x,z:b.z},...e.villas.map(v=>({id:v.id,name:v.name,x:v.x,z:v.z}))];
}
