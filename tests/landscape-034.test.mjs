import test from'node:test';import assert from'node:assert/strict';
import{landscapeHeight,configureLandscape,featuresNear,waterLevelAt,waterMeshRegion,settleLandscape}from'../src/landscape.js';
import{dressLandmarks}from'../src/landscape-dressing.js';
import{tileCity}from'../src/world-tiles.js';
import{regionMesh}from'../src/terrain-region.js';
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const fixture=()=>({seed:91726,size:'city',limit:{x:600,z:600},parks:Array.from({length:10},(_,i)=>({x:100+i%3*120,z:-250+Math.floor(i/3)*120,w:96,d:104,type:i%3?'forest':'meadow'})),hills:[],plots:[],buildings:[],roads:[],paths:[],waters:[],obstacles:[],trees:[],flora:[],spawns:[],siteObjects:[],siteGroups:[]});
const height=(x,z,m)=>landscapeHeight(x,z,0,m);
test('landscape: deterministic four mountains, two rivers and two lakes without altering Mini Royale',()=>{
 const a=fixture(),b=fixture();configureLandscape(a);configureLandscape(b);assert.deepEqual(a.terrainFeatures,b.terrainFeatures);assert.equal(a.terrainFeatures.filter(f=>f.kind==='mountain').length,4);assert.equal(a.terrainFeatures.filter(f=>f.kind==='river').length,2);const m={...fixture(),size:'district'};configureLandscape(m);assert.deepEqual(m.terrainFeatures,[]);
});
test('mountains have finite height and smooth zero influence outside their own footprint',()=>{
 const m=fixture();configureLandscape(m);for(const f of m.terrainFeatures.filter(f=>f.kind==='mountain')){assert.ok(height(f.x,f.z,m)>18);near(height(f.x+f.rx+.01,f.z,m),0);near(height(f.x+f.rx-.01,f.z,m),0,.0001);for(let x=-f.rx;x<=f.rx;x+=2)for(let z=-f.rz;z<=f.rz;z+=2)assert.ok(Number.isFinite(height(f.x+x,f.z+z,m)));}
});
test('river and lake beds are below a real water surface, not a fake water decal over ground zero',()=>{
 const m=fixture();configureLandscape(m);for(const f of m.terrainFeatures.filter(f=>f.kind!=='mountain')){const p=f.kind==='river'?f.points[2]:f;assert.ok(height(p.x,p.z,m)<f.level-.8);near(waterLevelAt(p.x,p.z,m),f.level);}
});
test('water mesh emits finite, upward, non-degenerate triangles and no second overlap layer',()=>{
 const m=fixture();configureLandscape(m);const f=m.terrainFeatures.find(f=>f.kind==='lake'),data=waterMeshRegion(m,{x0:f.x-20,z0:f.z-20,x1:f.x+20,z1:f.z+20},height);
 assert.ok(data.indices.length>200);assert.ok(data.vertices.every(Number.isFinite));const seen=new Set();for(let i=0;i<data.indices.length;i+=3){const ps=Array.from(data.indices.slice(i,i+3),n=>Array.from(data.vertices.slice(n*3,n*3+3)));const cross=(ps[1][2]-ps[0][2])*(ps[2][0]-ps[0][0])-(ps[1][0]-ps[0][0])*(ps[2][2]-ps[0][2]);assert.ok(cross>0);const key=ps.map(p=>p.map(v=>v.toFixed(4)).join(',')).sort().join('|');assert.ok(!seen.has(key));seen.add(key);}
});
test('terrain regional seams use exactly identical final mountain heights',()=>{
 const m=fixture();configureLandscape(m);const f=m.terrainFeatures.find(f=>f.kind==='mountain'),x=Math.floor(f.x/2)*2,z=Math.floor(f.z/2)*2;
 const a=regionMesh(m,height,2,{x0:x-20,z0:z-20,x1:x,z1:z+20}),b=regionMesh(m,height,2,{x0:x,z0:z-20,x1:x+20,z1:z+20});for(let i=0;i<21;i++)near(a.vertices[(i*11+10)*3+1],b.vertices[i*11*3+1]);
});
test('water chunk seams meet at same positions and the same height',()=>{
 const m=fixture();configureLandscape(m);const f=m.terrainFeatures.find(f=>f.kind==='lake'),x=Math.floor(f.x/2)*2,z=Math.floor(f.z/2)*2;
 const a=waterMeshRegion(m,{x0:x-20,z0:z-20,x1:x,z1:z+20},height),b=waterMeshRegion(m,{x0:x,z0:z-20,x1:x+20,z1:z+20},height);const edge=d=>{const s=new Set();for(let i=0;i<d.vertices.length;i+=3)if(Math.abs(d.vertices[i]-x)<.001)s.add(d.vertices[i+1].toFixed(4)+':'+d.vertices[i+2].toFixed(4));return [...s].sort();};assert.deepEqual(edge(a),edge(b));
});
test('landscape settlement preserves native array aliases and removes submerged trees and bridge obstructions',()=>{
 const m=fixture();configureLandscape(m);const f=m.terrainFeatures.find(f=>f.kind==='river'),p=f.points[1];m.trees.push([p.x,p.z,'pine'],[p.x+80,p.z,'broad']);m.obstacles.push({x:p.x,y:1.2,z:p.z,w:.5,h:2.4,d:.5,part:'tree',tree:0,ground:0},{x:p.x+80,y:1.2,z:p.z,w:.5,h:2.4,d:.5,part:'tree',tree:1,ground:0});m.spawns.push([p.x,p.z],[p.x+80,p.z]);m.flora.push({x:p.x,z:p.z,kind:'fern',s:1});const trees=m.trees,spawns=m.spawns,obs=m.obstacles;settleLandscape(m,height);assert.equal(m.trees,trees);assert.equal(m.spawns,spawns);assert.equal(m.obstacles,obs);assert.equal(m.trees.length,1);assert.ok(!m.obstacles.some(o=>o.part==='tree'&&o.x===p.x));assert.ok(f.bridge);assert.ok(m.siteObjects.some(o=>o.roofShape));
});
test('four-sector landscape translates only global coordinates and keeps per-copy feature geometry intact',()=>{
 const m=fixture();configureLandscape(m);Object.assign(m,{panels:0,doors:[],windows:[],cover:[],rocks:[],decor:[],lairs:[],chests:[],trash:[],vehicleSpawns:[],core:{x0:-10,x1:10,z0:-10,z1:10}});const copied=tileCity(m);assert.equal(copied.terrainFeatures.length,m.terrainFeatures.length*4);const f=m.terrainFeatures[0];for(const t of copied.tiles)near(height(f.x+t.x,f.z+t.z,copied),height(f.x,f.z,m),1e-8);
});
test('base dressing adds vegetation only outside protected runway, service and road rectangles',()=>{
 const m=fixture();m.expansion={base:{x:0,z:0,w:160,d:156},runway:{x:53,z:0,w:16,d:144},services:[{x:-10,z:57,r:5}]};dressLandmarks(m,height);assert.ok(m.baseDressing034.trees>0);assert.ok(m.baseDressing034.shelters<=2);for(const o of m.obstacles){const r=m.expansion.runway;assert.ok(Math.abs(o.x-r.x)>=(o.w+r.w)/2||Math.abs(o.z-r.z)>=(o.d+r.d)/2);}
});
