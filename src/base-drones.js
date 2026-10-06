// Five finite FPV pickups per airfield, placed in a clear service yard, never on a runway.
const overlap=(a,b,pad=0)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+pad&&Math.abs(a.z-b.z)<(a.d+b.d)/2+pad;
export function addBaseDroneStations(map){
  if(!map.expansion||map.baseDrones041)return;map.baseDrones041=true;
  map.labItems??=[];map.siteObjects??=[];map.baseDroneStations??=[];
  const e=map.expansion,b=e.base,w=9.2,d=3.5;
  const candidates=[[-39,-31],[-60,38],[-63,-12],[-39,34],[-65,-57],[-5,4]];
  const blocked=rect=>{
    if(overlap(rect,e.runway,3)||(e.helipad&&overlap(rect,e.helipad,3)))return true;
    if((e.vehicleSpawns||[]).some(v=>overlap(rect,{x:v.x,z:v.z,w:v.kind==='plane'?14:v.kind==='helicopter'?14:5,d:14},1)))return true;
    if((map.buildings||[]).some(o=>overlap(rect,o,1)))return true;
    return map.obstacles.some(o=>!o.visual&&!o.nocollide&&o.y-o.h/2<1.8&&o.y+o.h/2>.22&&overlap(rect,o,.5));
  };
  let area=candidates.map(([x,z])=>({x:b.x+x,z:b.z+z,w,d})).find(rect=>!blocked(rect));
  if(!area){
    // Deterministic fallback scan is performed once, not by the frame loop.
    for(let z=-59;z<60&&!area;z+=7)for(let x=-65;x<29;x+=10){const r={x:b.x+x,z:b.z+z,w,d};if(!blocked(r)){area=r;break;}}
  }
  if(!area)throw Error('No safe FPV stand location at '+b.id);
  const labId='base-drones-'+b.id;map.baseDroneStations.push({id:labId,labId,...area,count:5});
  for(let i=0;i<5;i++){
    const x=area.x+(i-2)*1.7,z=area.z,id=labId+'-'+i;
    const stand={x,y:.46,z,w:1.10,h:.84,d:1.04,part:'site',surface:'steel',color:0x415565,hp:110,droneStand041:id};
    map.obstacles.push(stand);map.siteObjects.push(stand);
    map.labItems.push({id,labId,supportKey:id,x,y:1.00,z,kind:'fpv',label:'BASE FPV '+(i+1),available:true});
  }
}
