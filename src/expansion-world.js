// Geometry and collision use the same records. Props are removed by the existing destruction prop IDs.
import { hull, shapeBounds, cutRect } from './architecture-geometry.js';
export function addExpansionProps(map) {
  const e=map.expansion;if(!e||e.propsBuilt)return;e.propsBuilt=true;map.siteObjects??=[];map.siteGroups??=[];
  const box=(x,y,z,w,h,d,surface,color,hp=150,extra={})=>{
    const o={x,y,z,w,h,d,part:'site',surface,color,hp,...extra};
    map.obstacles.push(o);map.siteObjects.push(o);return o;
  };
  const paint=(x,z,w,d,color)=>map.siteObjects.push({x,y:.087,z,w,h:.008,d,surface:'paint',color,visual:true});
  const pavement=(rect,surface,color)=>{
    const cuts=map.buildings.map(b=>({x:b.x,z:b.z,w:b.w+.5,d:b.d+.5}));
    for(const r of cutRect(rect,cuts))map.siteObjects.push({...r,y:.034,h:.06,visual:true,surface,color});
  };
  const b=e.base,r=e.runway;
  pavement({x:b.x-14,z:b.z,w:102,d:140},'concrete',0xa0a497);
  pavement(r,'asphalt',0x434947);
  for(let z=r.z-r.d/2+9;z<r.z+r.d/2-7;z+=10)paint(r.x,z,.28,4.7,0xeae8d6);
  for(const side of [-1,1]) {
    paint(r.x+side*(r.w/2-1),r.z,.16,r.d-8,0xdfddc9);
    for(let z=r.z-r.d/2+5;z<r.z+r.d/2;z+=12)
      map.siteObjects.push({x:r.x+side*(r.w/2+.8),y:.18,z,w:.13,h:.18,d:.13,surface:'light',color:0x8edfff,visual:true});
  }
  for(let k=-2;k<=2;k++)for(const z of [r.z-r.d/2+4,r.z+r.d/2-4])paint(r.x+k*1.2,z,.7,4,0xf0efe6);
  // Two roofed open-front hangars with curved roof segments and structural side/rear walls.
  for(const hz of [b.z-43,b.z+1]) {
    const hx=b.x+14,W=24,D=26,H=4.7,rad=W/2;
    const start=map.siteObjects.length;
    const left=box(hx-W/2,H/2,hz,.32,H,D,'panels',0x838f81,340);
    const right=box(hx+W/2,H/2,hz,.32,H,D,'panels',0x838f81,340);
    box(hx,H/2,hz-D/2,W-.3,H,.32,'panels',0x899180,360);
    for(let i=0;i<12;i++) {
      const a=i*Math.PI/12,c=(i+1)*Math.PI/12;
      const x0=hx+Math.cos(a)*rad,x1=hx+Math.cos(c)*rad,y0=H+Math.sin(a)*4.0,y1=H+Math.sin(c)*4.0;
      const sh=hull([[x0,y0-.17,hz-D/2],[x1,y1-.17,hz-D/2],[x1,y1-.17,hz+D/2],[x0,y0-.17,hz+D/2],
        [x0,y0,hz-D/2],[x1,y1,hz-D/2],[x1,y1,hz+D/2],[x0,y0,hz+D/2]],
        [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]);
      const bounds=shapeBounds([sh]);
      box(bounds.x,bounds.y,bounds.z,bounds.w,bounds.h,bounds.d,'corrugated',0x889385,200,{roofShape:[sh]});
    }
    for(const side of [-1,1])box(hx+side*(W/2-.65),H/2,hz+D/2,.20,H,.26,'steel',0x4f5c57,150);
    map.siteGroups.push({supports:[left,right],parts:map.siteObjects.slice(start).filter(o=>o.roofShape),minimum:2});
  }
  // Perimeter with an unobstructed twelve-metre gate toward the town.
  for(const x of [b.x-b.w/2,b.x+b.w/2])for(let z=b.z-b.d/2;z<b.z+b.d/2;z+=6)
    box(x,.78,z+3,.34,1.56,5.8,'concrete',0x91947f,160);
  for(const z of [b.z-b.d/2,b.z+b.d/2])for(let x=b.x-b.w/2;x<b.x+b.w/2;x+=6) {
    if(z>b.z&&Math.abs(x+3)<11)continue;
    box(x+3,.78,z,5.8,1.56,.34,'concrete',0x91947f,160);
  }
  for(const x of [-11,11])box(x,2.0,b.z+b.d/2,.65,4,.65,'concrete',0xa9ad9b,240);
  // Tank cover, ammunition pallets, guard platforms, floodlights, service zone.
  // Keep the full runway clear. The old east row used b.x+53, exactly runway.x,
  // so it intersected fighter-1 at spawn and prevented even the takeoff roll.
  for(const side of [-1,1])for(let n=0;n<5;n++) {
    const x = side < 0 ? b.x-53 : r.x-r.w/2-5;
    box(x,0.42,b.z+40+n*.58,4,.84,.50,'fabric',0xa5a078,100);
  }
  for(const [x,z] of [[b.x-65,b.z-64],[b.x+63,b.z+64]]) {
    const legs=[];for(const dx of [-1.6,1.6])for(const dz of [-1.6,1.6])legs.push(box(x+dx,2.1,z+dz,.16,4.2,.16,'steel',0x4e5c52,160));
    const start=map.siteObjects.length;
    box(x,4.22,z,3.7,.18,3.7,'wood',0x8c866c,180);
    box(x,6.0,z,4.0,.18,4.0,'corrugated',0x5e695d,180);
    for(const dx of [-1.7,1.7])box(x+dx,5.1,z,.12,1.7,3.5,'wood',0x8c866c,100);
    map.siteGroups.push({supports:legs,parts:map.siteObjects.slice(start),minimum:2});
  }
  for(let n=0;n<7;n++)box(b.x-47+(n%3)*1.2,.45,b.z+45+Math.floor(n/3)*1.3,1.05,.90,1.05,'oak',0x677457,95);
  for(const s of e.services){paint(s.x,s.z,s.r*1.7,.2,0xecc36c);paint(s.x,s.z-s.r,.2,2.1,0xecc36c);}
  map.siteObjects.push({x:0,y:3.3,z:b.z+b.d/2+.38,w:13,h:.7,d:.05,visual:true,surface:'sign',label:'FORT NORTH / VEHICLE DEPOT',color:0xb5c3a8});
  for(const v of e.villas) {
    const owner=map.buildings.find(k=>k.poi===v.id);
    const ownership=owner?{building:owner.id,storey:0}:{};
    pavement({x:v.x,z:v.z+16,w:52,d:37},'paving',0xcdbfa3);
    // Raised pool: basin walls and water are above the existing terrain, with no double ground surface.
    const px=v.x-12,pz=v.z+22;
    box(px,.23,pz,14,.46,8,'tiles',0x7cafa9,260,ownership);
    map.siteObjects.push({x:px,y:.476,z:pz,w:13.5,h:.018,d:7.5,visual:true,surface:'water',color:0x498f9b,...ownership});
    for(const s of [-1,1]){
      box(px+s*7.12,.31,pz,.3,.62,8.5,'concrete',0xe8dec8,140,ownership);
      box(px,.31,pz+s*4.1,14,.62,.3,'concrete',0xe8dec8,140,ownership);
    }
    // Terrace pergola and balustrade; each structural piece has a real destruction owner.
    const posts=[];for(const dx of [-10,8])for(const dz of [-3,4])posts.push(box(v.x+dx,1.48,v.z+dz,.20,2.96,.20,'oak',0xbca585,130,ownership));
    const start=map.siteObjects.length;
    for(let dx=-10;dx<=8;dx+=1.15)box(v.x+dx,3.04,v.z+.5,.15,.16,7.3,'oak',0xbca585,100,ownership);
    map.siteGroups.push({supports:posts,parts:map.siteObjects.slice(start),minimum:2});
    for(const dx of [-24,24])for(let dz=-30;dz<36;dz+=8)box(v.x+dx,.7,v.z+dz,.45,1.4,7.6,'plaster',v.color,180,ownership);
    for(let k=0;k<3;k++) {
      const cx=v.x+9+k*3;
      box(cx,.22,v.z+19,1.5,.3,3.6,'wood',0xc1a987,100,ownership);
      box(cx,.43,v.z+18.1,1.38,.16,1.6,'fabric',0xe3e1cd,60,{...ownership,nocollide:true});
    }
    for(const dx of [-23,23])map.siteObjects.push({x:v.x+dx,y:1.5,z:v.z+30,w:.13,h:2.6,d:.13,surface:'light',color:0xf4ddaa,visual:true,...ownership});
    map.siteObjects.push({x:v.x,y:1.7,z:v.z+37,w:6.4,h:.6,d:.04,visual:true,surface:'sign',label:v.name,color:v.accent});
  }
  // Guaranteed loot, still assigned by the world's existing seeded rarity/contents generator.
  for(const [id,x,z,tier] of [['armory',b.x-39,b.z-42,'legendary'],['command',b.x-39,b.z-13,'supply'],
    ['hangar',b.x+7,b.z-50,'supply'],...e.villas.map(v=>[v.id,v.x-7,v.z-10,'legendary'])])
    map.chests.push({id:'poi-'+id,x,z,tier,opened:false});
}
export function prepareVehicleSpawns(map) {
  const list=(map.expansion?.vehicleSpawns||[]).map(v=>({...v,y:0.07}));
  const carObstacles=new Map(map.obstacles.filter(o=>o.part==='car' && o.decor!==undefined).map(o=>[o.decor,o]));
  // Every actual street-car obstacle is driveable, regardless of its model name. No 28-car cap.
  for(const d of map.decor||[]) {
    const o=carObstacles.get(d.id);if(!o)continue;
    const quarter=Math.round((d.rot||0)/(Math.PI/2));
    // The original parked AABB is already rotated by the decor placer. Recover model-local dimensions.
    const swap=Math.abs(quarter)%2===1;
    list.push({id:'street-'+d.id,kind:'car',x:d.x,y:Number.isFinite(d.y)?d.y:0.07,z:d.z,
      angle:d.rot||0,decor:d.id,model:d.model,
      bodyW:swap?o.d:o.w,bodyD:swap?o.w:o.d,bodyH:o.h});
    o.vehicleSpawn=list.at(-1).id;
  }
  map.vehicleSpawns=list;
}

// Lightweight support cleanup. Both collision and rendering are removed through the native prop IDs.
export function stepSiteStructures(arena) {
  const signature=(arena.destruction.panels?.length||0)+':'+arena.destruction.props.length+':'+arena.destruction.buildings.length+':'+JSON.stringify(arena.destruction.storeys||{});
  if(arena._siteDamageSignature===signature)return;arena._siteDamageSignature=signature;
  // Site-owned pool walls/pergolas must vanish physically when their villa/upper storey collapses,
  // just as SiteViews hides them. Native building collapse filters do not include part:'site'.
  for(const o of arena.map.siteObjects||[]) {
    if(o.visual||o.building===undefined||!arena.colliders.has(o))continue;
    const building=arena.map.buildings[o.building];
    if(building?.collapsed||(building?.fallenFrom??Infinity)<=(o.storey||0))arena.breakObstacle(o,null);
  }
  for(const g of arena.map.siteGroups||[]) {
    if(g.fallen)continue;
    if(g.supports.filter(o=>arena.colliders.has(o)).length>=g.minimum)continue;
    g.fallen=true;for(const part of g.parts)if(arena.colliders.has(part))arena.breakObstacle(part,null);
  }
}
