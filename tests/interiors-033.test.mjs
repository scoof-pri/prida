import test from 'node:test';import assert from 'node:assert/strict';
import {planInterior,validateInteriorPlan,FLOOR_Y} from '../src/interior-plan.js';
import {BUILDINGS,withPlan,loadWorld,loadFurniture,mapFor,furniturePort,overlap,cellGrid,cellCenter} from './interior-fixture-033.mjs';
import {tileCity,validateTiledMap} from '../src/world-tiles.js';
const {buildInterior}=await loadWorld(),{furnishPlannedFloor}=await loadFurniture();
function reachable(map,b,k){const p=b.interiorPlan,step=.24,x0=-p.hw+.34,z0=-p.hd+.34,w=Math.ceil((p.hw*2-.68)/step),h=Math.ceil((p.hd*2-.68)/step),blocked=new Uint8Array(w*h),seen=new Set();
 const obstacles=map.obstacles.filter(o=>o.part!=='roof'&&o.storey===k&&o.y-o.h/2<FLOOR_Y(k)+1.7&&!o.nocollide);
 for(let z=0;z<h;z++)for(let x=0;x<w;x++){const q={x:b.x+x0+x*step,z:b.z+z0+z*step,w:.60,d:.60};if(obstacles.some(o=>overlap(q,o)))blocked[z*w+x]=1;}
 const node=(x,z)=>Math.round((z-z0)/step)*w+Math.round((x-x0)/step),start=node(k?p.serviceX+.8:0,0),queue=[start];seen.add(start);
 for(let i=0;i<queue.length;i++){const n=queue[i],x=n%w,z=Math.floor(n/w);for(const [a,c]of [[x+1,z],[x-1,z],[x,z+1],[x,z-1]]){const j=c*w+a;if(a<0||a>=w||c<0||c>=h||seen.has(j)||blocked[j])continue;seen.add(j);queue.push(j);}}
 return r=>{const [a,c,e,f]=r.bounds;const target=node((a+e)/2,(c+f)/2);return seen.has(target);};
}
for(const original of BUILDINGS){
 test(original.type+': closed purpose rooms, deterministic local plans and all levels reachable',()=>{const b=withPlan(original),map=mapFor(b);buildInterior(map,b);assert.equal(validateInteriorPlan(b,b.interiorPlan),true);assert.deepEqual(planInterior(b),b.interiorPlan);
  for(const level of b.interiorPlan.levels)if(level){assert.ok(level.rooms.length>=3,level.floor);for(const r of level.rooms)assert.ok(reachable(map,b,level.floor)(r),original.type+' floor '+level.floor+' '+r.name);}
 });
 test(original.type+': fittings stay in their room, required fixtures fit real model footprints',()=>{const b=withPlan(original),map=mapFor(b);buildInterior(map,b);
  for(const level of b.interiorPlan.levels)if(level){assert.ok(furnishPlannedFloor(b,level.floor,furniturePort(map,b,level.floor)));
   for(const r of level.rooms){const [x0,z0,x1,z1]=r.bounds,models=map.decor.filter(o=>o.storey===level.floor&&o.x>=b.x+x0&&o.x<=b.x+x1&&o.z>=b.z+z0&&o.z<=b.z+z1).map(o=>o.model);
    const need={kitchen:['fridge','stove','kitchen-sink'],bedroom:['bed'],bathroom:['toilet','sink'],living:['sofa'],lounge:['sofa'],workspace:['desk','monitor'],office:['desk','monitor'],meeting:['table']}[r.purpose]||[];
    for(const name of need)assert.ok(models.includes(name),b.type+' '+level.floor+' '+r.name+' missing '+name+'; placed='+models.join(','));
   }
  }
 });
}
test('small buildings have no impossible lift; unrelated building categories retain their existing plans',()=>{assert.equal(planInterior({type:'hangar',category:'industry',w:28,d:20,storeys:1}),null);assert.equal(planInterior({type:'guesthouse',category:'home',w:12,d:12,storeys:1}),null);const b=withPlan(BUILDINGS[0]);assert.equal(b.interiorPlan.lift,null);});
test('private upper rooms include kitchen, bathroom, living room and bedroom per apartment',()=>{for(const proto of BUILDINGS.filter(b=>b.category==='home'&&b.storeys)){const b=withPlan(proto);for(const l of b.interiorPlan.levels.filter(l=>l?.floor>0)){const units=new Set(l.rooms.map(r=>r.unit));for(const u of units)assert.deepEqual(l.rooms.filter(r=>r.unit===u).map(r=>r.purpose).sort(),['bathroom','bedroom','kitchen','living']);}}});
test('doorways have one canonical wall line, clear openings, supporting lintels and no overlapping parallel surfaces',()=>{const b=withPlan(BUILDINGS[4]),map=mapFor(b);buildInterior(map,b);
 for(const l of b.interiorPlan.levels){for(let i=0;i<l.walls.length;i++)for(let j=i+1;j<l.walls.length;j++){const a=l.walls[i],c=l.walls[j];assert.ok(!(a.axis===c.axis&&Math.abs(a.at-c.at)<.14&&Math.min(a.hi,c.hi)-Math.max(a.lo,c.lo)>.02));}}
 for(const d of map.doors){assert.ok(d.panels.length>0,d.label);assert.equal(map.obstacles.some(o=>o.part==='partition'&&o.storey===d.storey&&overlap({x:d.x,z:d.z,w:.64,d:.64},o)),false,d.label);}
 for(const h of map.obstacles.filter(o=>o.interiorHeader)){assert.equal(h.part,'lintel');assert.ok(h.supports.length>0);}
});
test('lift shaft aperture is physically open, and cell collars restore only the ground outside the shaft',()=>{const b=withPlan({...BUILDINGS[4],id:0}),map=mapFor(b);buildInterior(map,b);const l=map.lifts[0];assert.ok(l);
 for(const slab of map.obstacles.filter(o=>o.part==='roof'&&!o.interiorCollar&&o.storey<b.storeys)){const g=cellGrid(slab);assert.ok(slab.cells.some(v=>v===0));for(let i=0;i<slab.cells.length;i++){const p=cellCenter(slab,i);if(Math.abs(p.x-l.x)<l.w/2&&Math.abs(p.z-l.z)<l.d/2)assert.equal(slab.cells[i],0);}}
 for(const collar of map.obstacles.filter(o=>o.interiorCollar))assert.equal(overlap(collar,{x:l.x,z:l.z,w:l.w+.18,d:l.d+.18}),false);
});
test('four city copies namespace lifts and supports, without shifting local room layouts twice',()=>{const b=withPlan({...BUILDINGS[1],id:0}),m=mapFor(b);buildInterior(m,b);Object.assign(m,{size:'city',limit:{x:100,z:100},plots:[],cover:[],trees:[],flora:[],lairs:[],parks:[],hills:[],rocks:[],windows:[],trash:[],siteObjects:[],siteGroups:[],vehicleSpawns:[]});m.doors.forEach((d,id)=>d.id=id);
 const big=tileCity(m);assert.equal(big.lifts.length,4);assert.equal(new Set(big.lifts.map(l=>l.id)).size,4);assert.equal(validateTiledMap(big),true);
 for(let i=0;i<4;i++){assert.deepEqual(big.buildings[i].interiorPlan,b.interiorPlan);const l=big.lifts[i];assert.ok(big.obstacles.filter(o=>o.liftShaft===l.id).length>0);assert.ok(l.panels.every(id=>big.obstacles.some(o=>o.panel===id)));}
});
