import test from 'node:test';
import assert from 'node:assert/strict';
import {tileCity,validateTiledMap} from '../src/world-tiles.js';
import {hull,rayHulls,rectOverlap} from '../src/architecture-geometry.js';
import {SectorIndex} from '../src/world-sectors.js';
import {regionMesh,fastBiome} from '../src/terrain-region.js';
import {sparsePath} from '../src/sparse-navigation.js';
import {detailSites} from '../src/world-detail.js';
import {ColliderBudget} from '../src/collider-budget.js';
function fixture(){
 const wall={x:2,y:1.5,z:0,w:4,h:3,d:.3,panel:0,building:0,part:'wall',hole:{alongX:true,a0:1,a1:2,y0:1,y1:2},cells:new Uint8Array([50,0,30]),hp:100};
 const support={x:2,y:.5,z:4,w:1,h:1,d:1,part:'site',surface:'wood',hp:80,prop:0};
 const h=hull([[0,2,3],[2,2,3],[2,2,5],[0,2,5],[0,3,3],[2,3,3],[2,3,5],[0,3,5]],[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]);
 const roof={x:1,y:2.5,z:4,w:2,h:1,d:2,part:'site',hp:80,prop:1,roofShape:[h]};
 const tree={x:9,y:1.2,z:9,w:.5,h:2.4,d:.5,tree:0,prop:2,part:'tree'};
 const car={x:6,y:.5,z:-5,w:2,h:1,d:4,part:'car',decor:0,vehicleSpawn:'street-0'};
 return {seed:91726,size:'city',limit:{x:16,z:20},panels:1,buildings:[{id:0,x:2,z:0,w:4,d:4,roofBase:3,height:5,panels:[0],upperPanels:[],plot:0,poi:'fort',chestSpot:{x:2,z:1},roofChest:{x:2,z:1}}],
 obstacles:[wall,support,roof,tree,car],cover:[support],siteObjects:[support,roof],siteGroups:[{supports:[support],parts:[roof],minimum:1}],
 plots:[{id:0,x:2,z:0,w:4,d:4}],parks:[{id:1,x:8,z:8,w:8,d:8,type:'grove'}],hills:[{x:7,z:7,radius:2,height:2}],roads:[{x:8,z:0,w:12,d:6},{x:-8,z:0,w:12,d:6}],paths:[],waters:[],rocks:[],trash:[],flora:[],trees:[[9,9,'pine']],lairs:[{boss:'fire',x:8,z:8,lot:{x:8,z:8,w:8,d:8}}],
 windows:[{x:2,y:1.5,z:0,w:1,axis:'x',panel:0,out:1}],doors:[{id:0,x:2,y:1.3,z:2,w:2.4,h:2.5,building:0,panels:[0]}],decor:[{id:0,x:6,y:0,z:-5,model:'sedan',rot:0}],
 chests:[{id:'chest0',x:2,y:0,z:1,loot:{w:3,r:1}}],spawns:[[0,0],[8,-8]],vehicleSpawns:[{id:'street-0',x:6,y:0,z:-5,kind:'car',decor:0},{id:'tank-1',x:0,y:0,z:-10,kind:'tank'}],
 core:{x0:-6,x1:6,z0:-6,z1:6},expansion:{base:{id:'fort',x:0,z:-12,w:6,d:4},limit:{x:16,z:20},oldLimit:{x:16,z:12},villas:[],services:[{x:0,z:-10,r:3}],pois:[{id:'fort',name:'FORT',x:0,z:-12}]}};
}
test('exact fourfold area and four independent copies of all gameplay objects',()=>{const a=fixture(),before=structuredClone(a),b=tileCity(a);assert.equal(4*b.limit.x*b.limit.z,16*a.limit.x*a.limit.z);for(const key of ['buildings','obstacles','doors','decor','trees','lairs','siteGroups','vehicleSpawns','chests'])assert.equal(b[key].length,a[key].length*4,key);assert.deepEqual(a,before);assert.ok(validateTiledMap(b));});
test('Mini/district map remains unchanged and repeated tiling is idempotent',()=>{const a=fixture();a.size='district';assert.equal(tileCity(a),a);a.size='city';const b=tileCity(a);assert.equal(tileCity(b),b);});
test('IDs are remapped, but weapon IDs and local dimensions are not',()=>{const b=tileCity(fixture());for(let i=0;i<4;i++){assert.equal(b.buildings[i].id,i);assert.equal(b.doors[i].building,i);assert.equal(b.doors[i].panels[0],i);assert.equal(b.decor[i].id,i);assert.equal(b.vehicleSpawns[i*2].decor,i);assert.equal(b.chests[i].loot.w,3);assert.equal(b.buildings[i].w,4);}assert.equal(new Set(b.vehicleSpawns.map(v=>v.id)).size,8);assert.equal(new Set(b.chests.map(c=>c.id)).size,4);});
test('support aliases are preserved inside each tile, never between tiles',()=>{const b=tileCity(fixture());for(let i=0;i<4;i++){assert.equal(b.siteGroups[i].supports[0],b.siteObjects[i*2]);assert.equal(b.siteGroups[i].parts[0],b.siteObjects[i*2+1]);assert.equal(b.cover[i],b.siteGroups[i].supports[0]);}b.siteObjects[0].hp=0;assert.equal(b.siteObjects[2].hp,80);});
test('cell masks and inventories are independent mutable allocations',()=>{const b=tileCity(fixture());const walls=b.obstacles.filter(o=>o.panel!==undefined);walls[0].cells[0]=0;b.chests[0].loot.r=4;assert.equal(walls[1].cells[0],50);assert.equal(b.chests[1].loot.r,1);});
for(let i=0;i<4;i++)test(`tile ${i} translates points, windows, lair bounds and planes consistently`,()=>{
 const src=fixture(),b=tileCity(src),t=b.tiles[i],w=b.obstacles.filter(o=>o.panel!==undefined)[i];assert.equal(w.x,2+t.x);assert.equal(w.z,t.z);assert.equal(w.hole.a0,1+t.x);assert.equal(b.windows[i].panel,i);assert.equal(b.lairs[i].lot.x,8+t.x);assert.equal(b.trees[i][0],9+t.x);assert.equal(b.spawns[i*2][1],t.z);
 const shape=b.siteGroups[i].parts[0].roofShape;assert.ok(rayHulls(shape,{x:t.x+1,y:8,z:t.z+4},{x:0,y:-1,z:0},10));
 for(const plane of shape[0].planes)for(let k=0;k<shape[0].vertices.length;k+=3)assert.ok(plane.n.reduce((n,v,j)=>n+v*shape[0].vertices[k+j],0)<=plane.offset+1e-6);
 assert.equal(b.expansions[i].limit.x,16);assert.equal(b.expansions[i].services[0].x,t.x);
});
test('new seam road strips do not overlap existing roads, paths or each other',()=>{const b=tileCity(fixture());assert.ok(b.seamRoads.length>0);for(const r of b.seamRoads)for(const q of [...b.roads,...b.paths])if(r!==q)assert.equal(rectOverlap(r,q),false);});
test('terrain triangle chunks share their exact boundary vertices',()=>{const map={limit:{x:64,z:64}},height=(x,z)=>Math.sin(x*.1)*Math.cos(z*.1);const a=regionMesh(map,height,2,{x0:-64,x1:0,z0:-64,z1:0}),b=regionMesh(map,height,2,{x0:0,x1:64,z0:-64,z1:0});for(let z=0;z<=32;z++)assert.deepEqual(a.vertices.slice((z*33+32)*3,(z*33+33)*3),b.vertices.slice(z*33*3,(z*33+1)*3));});
test('terrain chunks reject off-lattice bounds and use upward winding',()=>{assert.throws(()=>regionMesh({limit:{x:5,z:5}},()=>0,2,{x0:0,x1:3,z0:0,z1:4}));const g=regionMesh({limit:{x:2,z:2}},()=>0);const [a,c,b]=g.indices;assert.ok(g.vertices[c*3+2]>g.vertices[a*3+2]);assert.ok(g.vertices[b*3]>g.vertices[a*3]);});
test('cached biome lookup preserves original ordered overlap rules',()=>{const m={parks:[{x:0,z:0,w:100,d:100,type:'lake'},{x:0,z:0,w:200,d:200,type:'forest'}]};for(let x=-120;x<=120;x+=13)for(let z=-120;z<=120;z+=17){const expected=m.parks.find(p=>Math.abs(x-p.x)<p.w/2-2&&Math.abs(z-p.z)<p.d/2-2)?.type||'city';assert.equal(fastBiome(x,z,m),expected);}m.parks.push({x:200,z:200,w:50,d:50,type:'desert'});assert.equal(fastBiome(200,200,m),'desert');});
test('sector clipping conserves paved surface area and never duplicates road triangles',()=>{const m=fixture();m.roads=[{x:0,z:0,w:1000,d:6}];const index=new SectorIndex(m);const parts=[...index.sectors.values()].flatMap(s=>s.roads);assert.equal(parts.reduce((s,r)=>s+r.w*r.d,0),6000);for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++)assert.equal(rectOverlap(parts[i],parts[j]),false);});
test('sector reload filters a destroyed tree and retains its original global tree index',()=>{const m=tileCity(fixture()),idx=new SectorIndex(m),sector=idx.get(m.trees[2][0],m.trees[2][1]);let sub=idx.subset(sector);assert.ok(sub.treeEntries.some(([i])=>i===2));const t=m.obstacles.find(o=>o.part==='tree'&&o.tree===2);m.obstacles.splice(m.obstacles.indexOf(t),1);sub=idx.subset(sector);assert.ok(!sub.treeEntries.some(([i])=>i===2));});
test('detailed site walls retain native obstacle identity and support graph links',()=>{
 const wall={x:0,y:2,z:0,w:.3,h:4,d:12,part:'site',surface:'panels',hp:300};const roof={x:2,y:4,z:0,w:4,h:.2,d:12,part:'site',hp:160};const map={seed:1,siteObjects:[wall,roof],siteGroups:[{supports:[wall],parts:[roof],minimum:1}],obstacles:[wall,roof]};const original=map.obstacles;detailSites(map,()=>0);assert.equal(map.obstacles,original);assert.ok(!original.includes(wall));assert.ok(map.siteObjects.length>20);assert.ok(map.siteGroups[0].supports.every(o=>o.foundation&&original.includes(o)));assert.ok(map.siteObjects.every(o=>!o.detailCell||o.h<=1.15));});
test('hangar hull subdivision is convex and replaces each graph reference with the real new pieces',()=>{const h=hull([[0,0,0],[2,0,0],[2,0,12],[0,0,12],[0,1,0],[2,2,0],[2,2,12],[0,1,12]],[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]);const o={x:1,y:1,z:6,w:2,h:2,d:12,part:'site',surface:'corrugated',hp:200,roofShape:[h]};const support={x:-1,y:1,z:6,w:.3,h:2,d:12,part:'site',hp:200};const m={siteObjects:[support,o],obstacles:[support,o],siteGroups:[{supports:[support],parts:[o],minimum:1}]};detailSites(m,()=>0);assert.equal(m.siteGroups[0].parts.length,3);for(const p of m.siteGroups[0].parts){assert.ok(m.obstacles.includes(p));assert.ok(p.d<=5);for(const q of p.roofShape[0].planes)assert.ok(Math.abs(Math.hypot(...q.n)-1)<1e-6);}});
test('sparse navigation does not allocate map-wide cost buffers',()=>{const w=200,h=200,nav={w,h,ox:0,oz:0,blocked:new Uint8Array(w*h),node:p=>p.z*w+p.x,point:k=>({x:k%w,z:Math.floor(k/w)})};for(let z=0;z<80;z++)nav.blocked[z*w+15]=1;const path=sparsePath(nav,{x:3,z:5},{x:23,z:5},1200);assert.ok(path.length);for(const p of path)assert.equal(nav.blocked[p.z*w+p.x],0);assert.ok(nav.lastSearch.expanded<=1200);assert.equal(nav.cost,undefined);});
test('collider paging preserves damage registry membership and frees distant native shapes',()=>{
 const far={x:500,y:1,z:500,w:2,h:2,d:2},near={x:5,y:1,z:5,w:2,h:2,d:2},removed=[];
 const map={tiled:true,limit:{x:768,z:1024},obstacles:[near,far]};map.obstacles.grid={query:(x0,z0,x1,z1,fn)=>map.obstacles.filter(o=>o.x>=x0&&o.x<=x1&&o.z>=z0&&o.z<=z1).forEach(fn)};
 const a={map,players:[],colliders:new Map(),world:{removeCollider:c=>removed.push(c),createCollider:()=>({handle:Math.random()})}};
 const R={ColliderDesc:{trimesh:()=>({})},TriMeshFlags:{FIX_INTERNAL_EDGES:0}},budget=new ColliderBudget(a,R,()=>({vertices:[],indices:[]}));a.addCollider=o=>{if(budget.defer(o))return;a.colliders.set(o,{handle:o.x});};
 a.addCollider(near);a.addCollider(far);assert.ok(a.colliders.has(far));assert.deepEqual(a.colliders.get(far),[]);
 a.players=[{hp:100,x:0,y:0,z:0}];budget.update(.2);assert.ok(!Array.isArray(a.colliders.get(near)));assert.deepEqual(a.colliders.get(far),[]);assert.ok(budget.terrain.size<20);
 a.players[0].x=500;a.players[0].z=500;budget.update(.2);assert.ok(!Array.isArray(a.colliders.get(near)),'retain recent sector for five seconds');budget.update(5.01);assert.deepEqual(a.colliders.get(near),[]);assert.ok(a.colliders.has(near));assert.ok(!Array.isArray(a.colliders.get(far)));assert.ok(removed.length);
});

test('instance ID remapping never changes a nested gear definition ID',()=>{const src=fixture();src.chests[0].gear={id:'jetpack',fuel:80,hp:50};const map=tileCity(src);for(const c of map.chests)assert.equal(c.gear.id,'jetpack');assert.equal(map.chests[1].id,'q1:chest0');});
test('unmanned moving aircraft still load static collision without a nearby pedestrian',()=>{
 const obstacle={x:300,y:7,z:300,w:10,h:14,d:10};const map={tiled:true,limit:{x:512,z:512},obstacles:[obstacle]};map.obstacles.grid={query:(_,__,___,____,fn)=>fn(obstacle)};
 const a={map,players:[],vehicles:{list:[{hp:100,driver:null,airborne:true,speed:30,x:300,y:8,z:300}]},colliders:new Map(),world:{removeCollider(){},createCollider(){return {};}}};
 const R={ColliderDesc:{trimesh(){return {};}},TriMeshFlags:{FIX_INTERNAL_EDGES:0}},b=new ColliderBudget(a,R,()=>({vertices:[],indices:[]}));a.addCollider=o=>{if(!b.defer(o))a.colliders.set(o,{handle:1});};
 a.addCollider(obstacle);assert.deepEqual(a.colliders.get(obstacle),[]);b.update(.2);assert.equal(a.colliders.get(obstacle).handle,1);assert.ok(b.terrain.size>0);
});
test('soft props retain a damage registry entry without requesting unnecessary native collision',()=>{
 const o={part:'furniture',nocollide:true,x:0,y:1,z:0,w:1,h:1,d:1};const a={map:{tiled:true},colliders:new Map()};const b=new ColliderBudget(a,{},()=>{});let allocated=0;a.addCollider=()=>allocated++;
 assert.equal(b.defer(o),true);assert.ok(a.colliders.has(o));assert.equal(a.colliders.get(o),null);b.ensure(o);assert.equal(allocated,0);
});
test('a road clipped shorter than its width retains its original dash direction, and junctions remain unpainted',()=>{
 const m=fixture();m.roads=[{x:191,z:30,w:10,d:6},{x:384,z:384,w:6,d:6}];const index=new SectorIndex(m),parts=[...index.sectors.values()].flatMap(s=>s.roads);
 const line=parts.filter(r=>r.z===30);assert.ok(line.some(r=>r.w<r.d));assert.ok(line.every(r=>r.axisX031&&r.paint031));assert.ok(parts.filter(r=>r.z!==30).every(r=>r.paint031===false));
});
