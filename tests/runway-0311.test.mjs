// Layout regression, without physics substitutes: catches solid props before a runway is shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {addExpansionPlots} from '../src/expansion-plan.js';
import {addExpansionProps,prepareVehicleSpawns} from '../src/expansion-world.js';
import {detailSites} from '../src/world-detail.js';
import {tileCity} from '../src/world-tiles.js';
import {leafTouchesBox,rectOverlap} from '../src/architecture-geometry.js';
import {VEHICLES} from '../src/vehicle-specs.js';

function fixture(city=false,seed=91726,detailed=true) {
  const map={seed,size:city?'city':'district',limit:city?{x:392,z:348}:{x:104,z:88},
    core:city?{x0:-192,x1:192,z0:-156,z1:156}:undefined,panels:0,
    plots:[],paths:[],roads:[],buildings:[],obstacles:[],chests:[],decor:[],parks:[],
    hills:[],trees:[],flora:[],lairs:[],waters:[],cover:[],rocks:[],windows:[],doors:[],trash:[],spawns:[]};
  addExpansionPlots(map);addExpansionProps(map);
  if(detailed)detailSites(map,()=>0);
  prepareVehicleSpawns(map);
  let id=0;for(const o of map.obstacles)o.prop=id++;
  return map;
}
function blockers(map,runway) {
  return map.obstacles.filter(o=>!o.nocollide&&!o.visual&&o.y+o.h/2>.12&&rectOverlap(o,runway));
}
function clear(map,e) {
  const bad=blockers(map,e.runway);
  assert.equal(bad.length,0,'Solid runway blockers: '+JSON.stringify(bad.slice(0,8).map(o=>({part:o.part,prop:o.prop,x:o.x,y:o.y,z:o.z,w:o.w,h:o.h,d:o.d}))));
  const plane=map.vehicleSpawns.find(v=>v.kind==='plane'&&Math.abs(v.x-e.runway.x)<.01);
  assert.ok(plane,'runway aircraft spawn is missing');
  const spec=VEHICLES.plane;
  const pose={x:plane.x,y:plane.y+spec.h/2,z:plane.z,w:spec.w,h:spec.h,t:spec.d,yaw:plane.angle};
  const hit=map.obstacles.filter(o=>!o.nocollide&&leafTouchesBox(pose,o));
  assert.equal(hit.length,0,'Aircraft starts inside an obstacle: '+JSON.stringify(hit.slice(0,3)));
}
for(const city of [false,true])for(const seed of [1,91726,20261001])for(const detailed of [false,true])
  test(`runway and parked fighter have no solid intersections: ${city?'city':'district'}, seed ${seed}, detail ${detailed}`,()=>{
    const map=fixture(city,seed,detailed);clear(map,map.expansion);
    // Relocation must preserve the cover, its hit points, its surface and its native obstacle records.
    const originalBags=map.siteObjects.filter(o=>o.surface==='fabric'&&o.w===4&&o.h===.84);
    assert.equal(originalBags.length,10);for(const o of originalBags){assert.ok(map.obstacles.includes(o));assert.equal(o.hp,100);}
  });

test('the former east sandbags would be caught at the runway AND at the aircraft spawn',()=>{
  const map=fixture(),e=map.expansion;
  const legacy={x:e.runway.x,y:.42,z:e.base.z+40+4*.58,w:4,h:.84,d:.50,part:'site',surface:'fabric',hp:100};
  map.obstacles.push(legacy);assert.ok(blockers(map,e.runway).includes(legacy));
  assert.throws(()=>clear(map,e),/Solid runway blockers/);
  const v=map.vehicleSpawns.find(v=>v.id==='fighter-1'),s=VEHICLES.plane;
  assert.ok(leafTouchesBox({x:v.x,y:v.y+s.h/2,z:v.z,w:s.w,h:s.h,t:s.d,yaw:v.angle},legacy));
});

test('all four replicated city airfields retain an unobstructed runway and valid spawn',()=>{
  const map=tileCity(fixture(true));assert.equal(map.expansions.length,4);
  for(const e of map.expansions)clear(map,e);
});
