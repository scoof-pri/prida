// PRIDA 0.31: a 2 x 2 world made from the finished city, not a rescaled city.
// All mutable state is independent; graph aliases (site supports, trees, cover) are retained per copy.
import { cutRect } from './architecture-geometry.js';
const ARRAYS=['buildings','obstacles','cover','chests','spawns','trees','flora','lairs','parks','hills','roads','paths','waters','rocks','plots','windows','doors','decor','trash','siteObjects','siteGroups','vehicleSpawns','lifts','interiorDetails','escalators','landmarks','terrainFeatures','ramps038','labItems','laboratories','baseDroneStations'];
const numeric=(n)=>typeof n==='number'&&Number.isFinite(n);
function lastId(items,key='id'){let max=-1;for(const o of items||[])if(Number.isInteger(o[key]))max=Math.max(max,o[key]);return max+1;}
function moveGraph(copy,delta,offsets,tile) {
  const {x:dx,z:dz}=delta,seen=new WeakSet(),prefix=tile?'q'+tile+':':'';
  const ns=s=>typeof s==='string'?prefix+s:s;
  const skip=new Set([copy.limit,copy.expansion?.limit,copy.expansion?.oldLimit]);
  const walk=o=>{
    if(!o||typeof o!=='object'||seen.has(o)||ArrayBuffer.isView(o))return;
    seen.add(o);
    if(!Array.isArray(o)&&!skip.has(o)) {
      if(numeric(o.x)&&numeric(o.z)){o.x+=dx;o.z+=dz;}
      if(numeric(o.x0))o.x0+=dx;if(numeric(o.x1))o.x1+=dx;
      if(numeric(o.z0))o.z0+=dz;if(numeric(o.z1))o.z1+=dz;
      if(o.hole){const d=o.hole.alongX?dx:dz;o.hole.a0+=d;o.hole.a1+=d;}
      // Convex hulls contain absolute vertices and plane equations, not transform nodes.
      if(Array.isArray(o.vertices)&&Array.isArray(o.planes)) {
        for(let i=0;i<o.vertices.length;i+=3){o.vertices[i]+=dx;o.vertices[i+2]+=dz;}
        for(const p of o.planes)p.offset+=p.n[0]*dx+p.n[2]*dz;
      }
      for(const [key,off] of [['building',offsets.building],['plot',offsets.plot],['panel',offsets.panel],['windowPanel',offsets.panel],['prop',offsets.prop],['decor',offsets.decor],['restsOn',offsets.decor],['parent',offsets.decor],['tree',offsets.tree]])
        if(Number.isInteger(o[key])&&o[key]>=0)o[key]+=off;
      for(const key of ['panels','upperPanels','supports','floorPanels'])if(Array.isArray(o[key]))o[key]=o[key].map(n=>Number.isInteger(n)?n+offsets.panel:n);
      for(const key of ['poi','vehicleSpawn','liftShaft','liftId','escalatorId','labId','supportKey','droneStand041','droneStandVisual041'])if(typeof o[key]==='string')o[key]=ns(o[key]);
      if(typeof o.id==='string'&&numeric(o.x)&&numeric(o.z))o.id=ns(o.id);
      delete o._stamp;delete o._lowStamp;
    }
    for(const key of Object.keys(o))if(!['_hillGrid','_biomeGrid','grid','lowGrid'].includes(key))walk(o[key]);
  };
  walk(copy);
  for(const b of copy.buildings||[]){b.sourceId=b.sourceId??b.id;b.id+=offsets.building;b.tile=tile;}
  for(const p of copy.plots||[])p.id+=offsets.plot;
  for(const d of copy.decor||[])d.id+=offsets.decor;
  for(const d of copy.doors||[])d.id+=offsets.door;
  for(const t of copy.trees||[]){t[0]+=dx;t[1]+=dz;}
  for(const p of copy.spawns||[]){p[0]+=dx;p[1]+=dz;}
  for(const l of copy.lairs||[])l.tile=tile;
  if(copy.expansion){copy.expansion.tile=tile;for(const p of copy.expansion.pois||[])p.name=(tile?['','EAST / ','SOUTH / ','SOUTH EAST / '][tile]:'')+p.name;}
  return copy;
}
function cleanTemplate(map) {
  const out={...map,obstacles:map.obstacles.slice()};
  for(const k of Object.keys(out))if(k.startsWith('_')||['applied','panelIndex','storeyIndex'].includes(k))delete out[k];
  return out;
}
export function tileCity(map) {
  if(map.size!=='city'||map.tiled)return map;
  const template=cleanTemplate(map),L={...map.limit};
  const counts={building:map.buildings.length,plot:map.plots.length,panel:map.panels,prop:lastId(map.obstacles,'prop'),decor:map.decor.length,door:map.doors.length,tree:map.trees.length};
  const combined={...map,limit:{x:L.x*2,z:L.z*2},panels:map.panels*4,tiled:true,tileVersion:1,tiles:[],cores:[],expansions:[],seamRoads:[]};
  for(const k of Object.keys(combined))if(k.startsWith('_'))delete combined[k];
  for(const k of ARRAYS)combined[k]=[];
  for(let tile=0;tile<4;tile++){
    const dx=(tile%2?1:-1)*L.x,dz=(tile<2?-1:1)*L.z;
    const offsets=Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v*tile]));
    const copy=moveGraph(structuredClone(template),{x:dx,z:dz},offsets,tile);
    combined.tiles.push({id:tile,name:['NORTH WEST','NORTH EAST','SOUTH WEST','SOUTH EAST'][tile],x:dx,z:dz,w:L.x*2,d:L.z*2,core:copy.core,
      firstBuilding:offsets.building,buildings:counts.building,firstPanel:offsets.panel,panels:counts.panel});
    if(copy.core)combined.cores.push(copy.core);
    if(copy.expansion)combined.expansions.push(copy.expansion);
    for(const k of ARRAYS)for(const o of copy[k]||[])combined[k].push(o);
  }
  combined.core=combined.cores[0]||null;
  if(combined.expansions.length){
    // Legacy travel button still targets NW; services and map labels cover all four sectors.
    combined.expansion={...combined.expansions[0],limit:{...combined.limit},services:combined.expansions.flatMap(e=>e.services||[]),pois:combined.expansions.flatMap(e=>e.pois||[])};
  }
  joinRoads(combined,template,L);
  return combined;
}
function joinRoads(map,template,L) {
  const candidates=[];
  const rows=new Set(template.roads.filter(r=>r.w>r.d&&Math.abs(r.x)+r.w/2>L.x-20).map(r=>r.z));
  // East/west road exits meet through the old edge margin, without an internal boundary wall.
  for(const dz of [-L.z,L.z])for(const z of rows)candidates.push({x:0,z:z+dz,w:40,d:6});
  // North/south corridors follow the outside avenue, avoiding bases, villas and their runway.
  const zEdge=Math.max(1,...template.roads.map(r=>Math.abs(r.z)+r.d/2));
  const halfGap=Math.max(8,L.z-zEdge+4);
  for(const dx of [-L.x,L.x])for(const side of [-1,1])candidates.push({x:dx+side*(L.x-8),z:0,w:6,d:halfGap*2});
  // Cut the added strips against the existing paving. Never draw two asphalt planes at a seam.
  for(const r of candidates){
    const pieces=cutRect(r,[...map.roads,...map.paths]);
    for(const piece of pieces){const s={...piece,seam:true};map.roads.push(s);map.seamRoads.push(s);}
  }
}
export function validateTiledMap(map) {
  if(!map.tiled)return true;
  const fail=m=>{throw Error('Tiled world invariant: '+m);};
  const unique=(rows,key,label)=>{const ids=rows.filter(o=>o[key]!==undefined).map(o=>o[key]);if(new Set(ids).size!==ids.length)fail('duplicate '+label);};
  unique(map.buildings,'id','building');unique(map.doors,'id','door');unique(map.decor,'id','decor');unique(map.chests,'id','chest');unique(map.vehicleSpawns,'id','vehicle');
  const panels=new Set(map.obstacles.filter(o=>o.panel!==undefined).map(o=>o.panel));
  for(let i=0;i<map.buildings.length;i++)if(map.buildings[i].id!==i)fail('building index');
  for(let i=0;i<map.decor.length;i++)if(map.decor[i].id!==i)fail('decor index');
  for(const o of map.obstacles){if(o.building!==undefined&&!map.buildings[o.building])fail('dangling building');if(o.decor!==undefined&&!map.decor[o.decor])fail('dangling decor');}
  for(const d of map.doors)for(const p of d.panels||[])if(!panels.has(p))fail('dangling door support');
  const obstacles=new Set(map.obstacles);
  for(const g of map.siteGroups||[])for(const p of [...g.parts,...g.supports])if(!p.visual&&!obstacles.has(p))fail('lost site alias');
  if(map.tiles.length!==4)fail('tile count');
  return true;
}
