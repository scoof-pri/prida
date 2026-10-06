// Planted shelter courtyards and service annexes. Keep the airfield, doors and service pads clear.
import { slopePrism } from './landmark-geometry.js';
export function dressLandmarks(map,heightAt) {
  const e=map.expansion;if(!e||map.dressing034)return;map.dressing034=true;
  const protectedRects=[...(e.vehicleSpawns||[]).map(v=>({...v,w:['plane','helicopter'].includes(v.kind)?13:7,d:['plane','helicopter'].includes(v.kind)?13:9})),e.runway,...map.roads,...map.paths,...map.buildings,...e.services.map(p=>({...p,w:p.r*2+5,d:p.r*2+5}))];
  const clear=(x,z,r)=>!protectedRects.some(o=>Math.abs(x-o.x)<o.w/2+r+2&&Math.abs(z-o.z)<o.d/2+r+2)&&
    !map.obstacles.some(o=>Math.abs(x-o.x)<o.w/2+r+.35&&Math.abs(z-o.z)<o.d/2+r+.35);
  const b=e.base;
  const spot=[];for(let x=b.x-b.w/2+8;x<b.x+b.w/2-8;x+=9)for(let z=b.z-b.d/2+9;z<b.z+b.d/2-10;z+=11)if(clear(x,z,2.0))spot.push([x,z]);
  // Trees only on genuine clear grass: never grow them through the concrete apron or in a take-off lane.
  const paved=map.siteObjects.filter(o=>o.visual&&['concrete','asphalt','paving','water'].includes(o.surface));
  let n=0;
  for(const [x,z] of spot){if(n>=16)break;if(paved.some(o=>Math.abs(x-o.x)<o.w/2+2&&Math.abs(z-o.z)<o.d/2+2))continue;
    const h=heightAt(x,z,map),tree=map.trees.length;map.trees.push([x,z,n%3?'broad':'pine']);
    map.obstacles.push({x,y:h+1.2,z,w:.48,h:2.4,d:.48,part:'tree',tree,ground:h,color:0x70624a});
    for(const [dx,dz]of[[-1.2,1.3],[1.25,1.1]])map.flora.push({x:x+dx,z:z+dz,kind:'bush',s:.55});n++;
  }
  // Courtyard planting is kept off the circulation routes and out of the building walls.
  for(const building of map.buildings)if(building.landmark034==='courtyard')for(const dz of [-7,0]){
    const soil=map.siteObjects.find(o=>o.building===building.id&&o.surface==='dirt'&&Math.abs(o.z-building.z-dz)<.01);
    map.flora.push({x:building.x+.8,z:building.z+dz,kind:'bush',s:.68,height034:.69,support034:soil,building:building.id});
  }
  // Two modest open-sided shelters close to base buildings, not extra opaque boxes over existing rooms.
  let shelters=0;
  for(const [x,z]of spot){if(shelters>=2)break;if(!clear(x,z,2.5))continue;
    const y=heightAt(x,z,map),parts=[],supports=[];
    const put=(dx,dy,dz,w,h,d,surface,hp=100)=>{const o={x:x+dx,y:y+dy,z:z+dz,w,h,d,part:'site',surface,color:surface==='wood'?0xa28f71:0x64796c,hp};map.obstacles.push(o);map.siteObjects.push(o);parts.push(o);return o;};
    for(const dxof of [-2,2])for(const dzof of [-1.3,1.3])supports.push(put(dxof,1.6,dzof,.13,3.2,.13,'steel',130));
    const roof={...slopePrism({x:x-2.25,y:y+3.4,z},{x:x+2.25,y:y+3.1,z},3.2,.12),part:'site',surface:'corrugated',color:0x7a9184,hp:180};
    map.obstacles.push(roof);map.siteObjects.push(roof);parts.push(roof);
    put(0,.46,-.9,3.3,.15,.65,'wood',80);put(0,.76,-1.15,3.3,.55,.09,'wood',80);
    map.siteGroups.push({supports,parts:parts.filter(o=>!supports.includes(o)),minimum:2});shelters++;
  }
  map.baseDressing034={trees:n,shelters};
}
