import test from 'node:test';
import assert from 'node:assert/strict';
import {roofHulls,rayHulls,shapeBounds,doorPoses,leafBounds,rayLeaf,leafTouchesPlayer,leafTouchesBox,cutRect,rectOverlap,hull} from '../src/architecture-geometry.js';
import {prepareArchitecture} from '../src/architecture-world.js';
const building={id:1,x:12,z:-9,w:12,d:8,roofBase:10,height:13};
const near=(a,b,t=1e-5)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
for(const style of ['gable','hip','shed','saw']){
 test(`${style}: closed convex solids, finite data and outward face winding`,()=>{
  for(const h of roofHulls(building,style)){
   assert.ok(h.vertices.every(Number.isFinite)); assert.ok(h.indices.every(Number.isInteger));
   for(const p of h.planes){near(Math.hypot(...p.n),1); for(let i=0;i<h.vertices.length;i+=3)assert.ok(p.n.reduce((sum,n,k)=>sum+n*h.vertices[i+k],0)<=p.offset+1e-6);}
   const edges=new Map();for(const f of h.faces)for(let j=0;j<f.ids.length;j++){let a=f.ids[j],b=f.ids[(j+1)%f.ids.length];let k=[Math.min(a,b),Math.max(a,b)].join(':');edges.set(k,(edges.get(k)||0)+1);}
   assert.ok([...edges.values()].every(n=>n===2));
  }
 });
 test(`${style}: vertical physics rays land on the rendered slope, not the old bounding box`,()=>{
  const shapes=roofHulls(building,style),bounds=shapeBounds(shapes);
  const yAt=(x,z)=>{const h=rayHulls(shapes,{x,y:30,z},{x:0,y:-1,z:0},50);assert.ok(h);return 30-h.distance;};
  const ridge=yAt(12,-9),edge=yAt(12,-6.1);
  if(style==='gable'||style==='hip')assert.ok(ridge>edge+1);
  if(style==='shed')assert.ok(yAt(12,-12)>edge+1);
  assert.ok(ridge<=bounds.y+bounds.h/2+1e-6);
 });
}
test('low gable rays above the eave pass through its AABB without a false hit',()=>{
 const shapes=roofHulls(building,'gable');
 assert.equal(rayHulls(shapes,{x:0,y:12.7,z:-5.5},{x:1,y:0,z:0},30),null);
 assert.ok(rayHulls(shapes,{x:0,y:12.7,z:-9},{x:1,y:0,z:0},30));
});
test('roof orientation also works when the ridge is along Z',()=>{
 const b={...building,w:8,d:16},shapes=roofHulls(b,'gable');
 const top=(x,z)=>30-rayHulls(shapes,{x,y:30,z},{x:0,y:-1,z:0},50).distance;
 assert.ok(top(b.x,b.z)>top(b.x+3,b.z)+1);
});
test('flat roofs keep their existing rooftop plan',()=>assert.deepEqual(roofHulls(building,'flat'),[]));
test('roof ray parameter is correct for the unnormalised camera corner probes',()=>{
 const h=roofHulls(building,'gable');
 const a=rayHulls(h,{x:12,y:14,z:-9},{x:0,y:-2,z:0},1);
 near(a.distance,.5); near(a.y,1,0.99); // outward slope has positive Y
});
for(const axis of ['x','z']) for(const face of [-1,1])test(`door ${axis}/${face}: closes the opening, opens away, preserves leaf length`,()=>{
 const d={id:0,x:0,z:0,y:1.3,w:3.2,h:2.55,axis,face};
 const closed=doorPoses(d,0,1),open=doorPoses(d,1,1);
 const o=axis==='x'?{x:.7,y:1.3,z:3}:{x:3,y:1.3,z:.7};
 const dir=axis==='x'?{x:0,y:0,z:-1}:{x:-1,y:0,z:0};
 assert.ok(closed.some(p=>rayLeaf(p,o,dir,6))); assert.ok(!open.some(p=>rayLeaf(p,o,dir,6)));
 for(let i=0;i<open.length;i++)near(open[i].w,closed[i].w);
 assert.ok(open.every(p=>(axis==='x'?p.z:p.x)*face>0.3));
 const bounds=leafBounds(open[0]);assert.ok((axis==='x'?bounds.w:bounds.d)<0.1);
});
test('a single flat door has one hinge and a clear open passage',()=>{
 const d={id:0,x:0,z:0,y:1.12,w:1.4,h:2.24,axis:'z',face:-1,kind:'inner'};
 assert.equal(doorPoses(d).length,1);
 assert.ok(rayLeaf(doorPoses(d)[0],{x:2,y:1,z:0},{x:-1,y:0,z:0},4));
 assert.equal(rayLeaf(doorPoses(d,1)[0],{x:2,y:1,z:0},{x:-1,y:0,z:0},4),null);
});
test('sweep tests respect actor height and real oriented leaf volume',()=>{
 const p=doorPoses({x:0,z:0,y:1.3,w:3.2,h:2.55},.5)[0];
 assert.ok(leafTouchesPlayer(p,{x:p.x,z:p.z,y:0,hp:100}));
 assert.equal(leafTouchesPlayer(p,{x:p.x,z:p.z,y:4,hp:100}),false);
 assert.equal(leafTouchesPlayer(p,{x:p.x,z:p.z,y:0,hp:0}),false);
 assert.ok(leafTouchesBox(p,{x:p.x,z:p.z,y:1.3,w:.2,d:.2,h:2}));
 assert.equal(leafTouchesBox(p,{x:20,z:20,y:1.3,w:.2,d:.2,h:2}),false);
});
test('rectangle subtraction removes exactly the overlap, without overlapping residual quads',()=>{
 const a={x:0,z:0,w:10,d:8},cuts=[{x:0,z:0,w:6,d:4},{x:3,z:1,w:5,d:2}];
 const parts=cutRect(a,cuts);assert.ok(parts.length>0);
 for(let i=0;i<parts.length;i++){for(const c of cuts)assert.equal(rectOverlap(parts[i],c),false);for(let j=i+1;j<parts.length;j++)assert.equal(rectOverlap(parts[i],parts[j]),false);}
 near(cutRect(a,[cuts[0]]).reduce((s,r)=>s+r.w*r.d,0),56);
});
test('world cleanup removes duplicate paths and road overlap and assigns stable door ids',()=>{
 const map={buildings:[building],obstacles:[{part:'upper',building:0}],doors:[{x:0,z:0,w:3.2,kind:'outer',building:0}],roads:[{x:0,z:0,w:1,d:20}],
 paths:[{x:0,z:0,w:10,d:4},{x:0,z:0,w:10,d:4}],decor:[{model:'rug',y:0}],panels:1};
 prepareArchitecture(map,()=> 'gable');assert.equal(map.doors[0].id,0);assert.ok(map.obstacles[0].roofShape);near(map.decor[0].y,.018);
 near(map.paths.reduce((s,p)=>s+p.w*p.d,0),36);
});
test('door bottoms clear the threshold and interior lintels stop below the ceiling',()=>{
 const map={buildings:[building],obstacles:[],roads:[],paths:[],decor:[],panels:10,doors:[
  {building:0,kind:'outer',x:0,z:0,y:1.3,h:2.55,w:3.2},
  {building:0,kind:'inner',storey:1,x:5,z:0,y:4.96,h:2.24,w:1.4,axis:'z'}]};
 prepareArchitecture(map,()=> 'flat');
 for(const d of map.doors)assert.ok(d.y-d.h/2>d.floorY+.02);
 const header=map.obstacles[0];assert.ok(header.y+header.h/2<3.84+3.36);
});
