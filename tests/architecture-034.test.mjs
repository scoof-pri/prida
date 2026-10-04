import test from 'node:test';import assert from 'node:assert/strict';
import {landmarkFixture,reachableFloor}from'./landmark-fixture-034.mjs';
import {rect,boundaryOf,floorPieces,floorY,validateLandmark}from'../src/landmark-geometry.js';
import {rayHulls}from'../src/architecture-geometry.js';
import {configureLandmarkLots}from'../src/landmark-world.js';
import {tileCity,validateTiledMap}from'../src/world-tiles.js';
import {SectorIndex}from'../src/world-sectors.js';
import {EscalatorSystem,escalatorCarry,syncEscalators}from'../src/escalator-system.js';
const close=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} / ${b}`);
for(const role of ['mall','bank','courtyard','terraces']) {
 test(`${role}: actual new generator has finite positive geometry, unique structural IDs and shaft`,async()=>{
  const {map,b}=await landmarkFixture(role);assert.ok(validateLandmark(map,b));const panels=map.obstacles.filter(o=>o.panel!==undefined).map(o=>o.panel);assert.equal(new Set(panels).size,panels.length);assert.equal(map.lifts.length,1);
  for(const o of map.obstacles)for(const h of o.roofShape||[])for(const plane of h.planes)for(let i=0;i<h.vertices.length;i+=3)assert.ok(plane.n.reduce((n,v,k)=>n+v*h.vertices[i+k],0)<plane.offset+1e-5);
 });
 test(`${role}: every room is connected to the public landing with player clearance, doors open`,async()=>{
  const {map,b}=await landmarkFixture(role);for(let k=0;k<=b.storeys;k++){const nav=reachableFloor(map,b,k);assert.ok(nav.count>50);for(const r of b.interiorPlan.levels[k].rooms)assert.ok(nav.reachable((r.bounds[0]+r.bounds[2])/2,(r.bounds[1]+r.bounds[3])/2),r.name+' floor '+k);}
 });
 test(`${role}: exterior openings are taller than old windows and have matching breakable panes`,async()=>{
  const {map,b}=await landmarkFixture(role);assert.ok(map.windows.length>8);for(const w of map.windows){assert.ok(w.h>=1.4);const pane=map.obstacles.find(o=>o.windowPanel===w.panel);close(pane.h,w.h);assert.ok(pane.hp===1);}
 });
 test(`${role}: floors never overlap at equal height outside the intentional slab collar`,async()=>{
  const {map}=await landmarkFixture(role);const slabs=map.obstacles.filter(o=>o.part==='roof'&&!o.interiorCollar&&!o.cells);for(let i=0;i<slabs.length;i++)for(let j=i+1;j<slabs.length;j++){const a=slabs[i],b=slabs[j];if(Math.abs(a.y-b.y)>.01)continue;assert.ok(Math.abs(a.x-b.x)>=(a.w+b.w)/2-1e-5||Math.abs(a.z-b.z)>=(a.d+b.d)/2-1e-5,'coplanar floors');}
 });
 test(`${role}: all four copied districts keep independent escalators, lift, room and pane ownership`,async()=>{
  const {map,b}=await landmarkFixture(role);map.expansion={base:{x:0,z:-65,w:20,d:20},limit:{...map.limit},oldLimit:{...map.limit},services:[],pois:[],vehicleSpawns:[]};map.plots=[{id:0,x:0,z:0,w:b.w+6,d:b.d+6}];b.plot=0;
  const original=JSON.stringify(b.footprints034),copy=tileCity(map);assert.ok(validateTiledMap(copy));assert.equal(copy.landmarks.length,4);assert.equal(copy.lifts.length,4);assert.equal(JSON.stringify(copy.buildings[2].footprints034),original);
  const obstacleSet=new Set(copy.obstacles);for(const e of copy.escalators){assert.ok(obstacleSet.has(e.ramp));assert.ok(obstacleSet.has(e.motor));assert.equal(e.ramp.building,e.building);assert.equal(e.id,e.ramp.escalatorId);}
  assert.equal(new Set(copy.escalators.map(e=>e.id)).size,copy.escalators.length);
 });
}
test('mall: atrium genuinely open from ground to segmented glass, center crossing has a real floor',async()=>{
 const {map,b}=await landmarkFixture('mall');const over=(x,z,y)=>map.obstacles.some(o=>o.part==='roof'&&Math.abs(o.y+o.h/2-y)<.02&&Math.abs(x-o.x)<o.w/2&&Math.abs(z-o.z)<o.d/2);
 for(const k of[1,2]){assert.equal(over(-4,0,floorY(k)),false);assert.equal(over(0,0,floorY(k)),true);}assert.equal(over(0,0,b.roofBase),false);assert.ok(map.siteObjects.filter(o=>o.roofGlass034).length>=24);assert.equal(map.escalators.length,4);
});
test('mall: escalator hull ray matches the same inclined deck at 20%, 50%, 80%',async()=>{
 const {map}=await landmarkFixture('mall');for(const e of map.escalators)for(const t of[.2,.5,.8]){const x=e.from.x+(e.to.x-e.from.x)*t,z=e.from.z,expected=e.from.y+(e.to.y-e.from.y)*t;const hit=rayHulls(e.ramp.roofShape,{x,y:20,z},{x:0,y:-1,z:0},30);close(20-hit.distance,expected);assert.ok(hit.y>0);}
});
test('courtyard: all levels retain open sky and no enclosing exterior box',async()=>{
 const {map,b}=await landmarkFixture('courtyard');assert.ok(!map.obstacles.some(o=>o.part==='roof'&&Math.abs(o.x)<o.w/2&&Math.abs(o.z+3)<o.d/2));assert.ok(boundaryOf(b.footprints034[0].map(a=>rect(...a))).length>4);
});
test('terrace: reduced upper storey leaves a usable real lower roof, not a invisible tall collider',async()=>{
 const {map,b}=await landmarkFixture('terraces');assert.ok(map.obstacles.some(o=>o.part==='roof'&&Math.abs(o.y+.12-floorY(2))<.02&&Math.abs(o.x+6)<o.w/2));assert.ok(!map.obstacles.some(o=>o.part==='wall'&&o.storey===2&&Math.abs(o.x+6)<o.w/2));
});
test('landmark assignment preserves an ordinary office, clones catalogue entries and does not expand Mini Royale',()=>{
 const type=t=>({type:t,color:0,storeys:1});const kinds=['mall','bank','residence','office','office'].map(type);const m={size:'city',plots:kinds.map((kind,id)=>({id,type:'building',w:kind.type==='mall'?48:24,d:26,kind}))};configureLandmarkLots(m);assert.deepEqual(m.plots.map(p=>p.kind.landmark034),['mall','bank','courtyard',undefined,'terraces']);assert.equal(kinds[0].landmark034,undefined);
 const mini={size:'district',plots:[{type:'building',kind:type('mall'),w:48,d:26}]};configureLandmarkLots(mini);assert.equal(mini.plots[0].kind.landmark034,undefined);
});
test('escalator motor damage stops transport; ramp destruction marks geometry gone; other conveyor is unaffected',async()=>{
 const {map}=await landmarkFixture();const a={map,colliders:new Map(map.obstacles.map(o=>[o,{}])),destruction:{panels:[],props:[],buildings:[],storeys:{}}};const s=new EscalatorSystem(a);s.step(.1);const e=map.escalators[0];a.colliders.delete(e.motor);a.destruction.props.push(e.motor.prop);s.step(.1);assert.ok(e.disabled);assert.equal(e.gone,false);assert.equal(map.escalators[1].disabled,false);a.colliders.delete(e.ramp);a.destruction.props.push(e.ramp.prop);s.step(.1);assert.ok(e.gone);
});
test('escalator sparse state and clock reach existing streamed aliases without a revision change',async()=>{
 const {map}=await landmarkFixture();const index=new SectorIndex(map),section=index.subset([...index.sectors.values()].find(s=>s.escalators.length));syncEscalators(map,{clock:3,revision:1,states:[]});assert.equal(section.escalators[0].clock034,3);syncEscalators(map,{clock:4,revision:1,states:[]});assert.equal(section.escalators[0].clock034,4);
});
test('conveyor rejects airborne, dead, vehicle riders and jump, respects width and cap on large dt',async()=>{
 const {map}=await landmarkFixture();const e=map.escalators[0],p={x:(e.from.x+e.to.x)/2,z:e.z,y:(e.from.y+e.to.y)/2+.02,hp:100,vy:0};assert.ok(escalatorCarry(e,p,.016));for(const patch of[{hp:0},{vehicle:'car'},{lift:'lift'},{inBus:true},{vy:4},{z:e.z+2}])assert.equal(escalatorCarry(e,{...p,...patch},.016),null);assert.equal(escalatorCarry(e,p,.016,{jump:true}),null);assert.ok(Math.hypot(...Object.values(escalatorCarry(e,p,5)).filter(x=>typeof x==='number'))<=e.speed*.05001);
});
test('glazed roof and entry canopy react to native PANEL support removal, not only site-prop damage',async()=>{
 const {stepSiteStructures}=await import('../src/expansion-world.js');const {map}=await landmarkFixture('mall'),g=map.siteGroups.find(g=>g.parts.some(o=>o.roofGlass034));assert.ok(g);
 const a={map,colliders:new Map(map.obstacles.map(o=>[o,{}])),destruction:{panels:[],props:[],buildings:[],storeys:{}},breakObstacle(o){this.colliders.delete(o);this.destruction.props.push(o.prop);}};
 stepSiteStructures(a);assert.ok(!g.fallen);for(const o of g.supports){a.colliders.delete(o);a.destruction.panels.push(o.panel);}stepSiteStructures(a);assert.ok(g.fallen);assert.ok(g.parts.every(o=>!a.colliders.has(o)));
});
test('upper shop furniture attachments retain their own storey base height',async()=>{
 const {furnishLandmark}=await import('../src/landmark-world.js');const {b}=await landmarkFixture('mall');const rows=[];const ctx={put(name,x,z,rot,opts){rows.push({name,x,z,rot,...opts});return rows.length-1;}};
 furnishLandmark(b,2,ctx);const laptops=rows.filter(r=>r.name==='laptop');assert.ok(laptops.length===8);for(const r of laptops){close(r.y,floorY(2)+.67);assert.equal(r.storey,2);assert.ok(Number.isInteger(r.on));}
});
