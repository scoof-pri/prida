import { slopePrism } from './landmark-geometry.js';
// PRIDA 0.34: finite landscape features sampled by terrain vertices, rays and Rapier alike.
// Roads, building plots and airfields remain at their existing grade; water does not hide a flat collider.
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const rectangleDistance=(x,z,r)=>Math.hypot(Math.max(0,Math.abs(x-r.x)-r.w/2),Math.max(0,Math.abs(z-r.z)-r.d/2));
function segmentDistance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,q=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a.x-q*dx,z-a.z-q*dz);}
export function featureDistance(f,x,z) {
  if(f.kind==='lake')return (Math.hypot((x-f.x)/f.rx,(z-f.z)/f.rz)-1)*Math.min(f.rx,f.rz);
  if(f.kind==='river'){let d=Infinity;for(let i=1;i<f.points.length;i++)d=Math.min(d,segmentDistance(x,z,f.points[i-1],f.points[i]));return d-f.width/2;}
  return Infinity;
}
function indexFor(map){
  const rows=map.terrainFeatures||[];let index=map._landscape034;
  if(index&&index.count===rows.length)return index;
  index={count:rows.length,cells:new Map()};
  for(const f of rows){const r=f.bounds||{x:f.x,z:f.z,w:f.rx*2+18,d:f.rz*2+18};
    for(let x=Math.floor((r.x-r.w/2)/64);x<=Math.floor((r.x+r.w/2)/64);x++)for(let z=Math.floor((r.z-r.d/2)/64);z<=Math.floor((r.z+r.d/2)/64);z++){
      const key=x+':'+z;if(!index.cells.has(key))index.cells.set(key,[]);index.cells.get(key).push(f);
    }}
  return map._landscape034=index;
}
export function featuresNear(x,z,map){return indexFor(map).cells.get(Math.floor(x/64)+':'+Math.floor(z/64))||[];}
export function landscapeHeight(x,z,base,map) {
  let y=base;
  for(const f of featuresNear(x,z,map)) {
    if(f.kind==='mountain'){
      const nx=(x-f.x)/f.rx,nz=(z-f.z)/f.rz,r=Math.hypot(nx,nz);if(r>=1)continue;
      // Rounded foothills and a creased ridge, zero value and zero slope at the lot edge.
      const envelope=(1-r*r)**2,crease=.83+.11*Math.sin(nx*7+f.seed)*Math.cos(nz*9-f.seed)+.06*Math.sin(nx*15+nz*12);
      y+=Math.max(0,f.height*envelope*crease);
    } else {
      const d=featureDistance(f,x,z);if(d>f.bank)continue;
      const bed=f.level-f.depth,blend=1-smooth((d+f.width*.20)/(f.bank+f.width*.20));
      y=Math.min(y,y*(1-blend)+bed*blend);
    }
  }
  return y;
}
export function waterLevelAt(x,z,map){
  let level=-Infinity;
  for(const f of featuresNear(x,z,map))if(f.kind!=='mountain'&&featureDistance(f,x,z)<.02)level=Math.max(level,f.level);
  return level;
}
export function configureLandscape(map) {
  if(map.landscape034)return;map.landscape034=true;map.terrainFeatures=[];
  if(map.size!=='city')return; // Mini Royale keeps its compact match layout.
  const candidates=(map.parks||[]).filter(p=>p.w>=55&&p.d>=55&&!['lake','quarry'].includes(p.type));
  const plots=map.plots||[];
  // At this point parks may still be empty: reserve from the already allocated biome lots instead.
  const lots=candidates.length?candidates:plots.filter(p=>!p.militaryBuffer&&p.type!=='building'&&p.type!=='lake'&&p.type!=='quarry'&&p.w>=55&&p.d>=55);
  const safe=p=>!(map.expansion&&rectangleDistance(p.x,p.z,map.expansion.base)<Math.max(p.w,p.d)/2+12);
  // Spread features around the city, not into the first western row visited by plot generation.
  const remaining=lots.filter(safe),ordered=[];
  while(remaining.length&&ordered.length<10){let best=0,score=-1;
    for(let i=0;i<remaining.length;i++){const p=remaining[i],d=ordered.length?Math.min(...ordered.map(q=>Math.hypot(p.x-q.x,p.z-q.z))):p.w*p.d;
      if(d>score){score=d;best=i;}}
    ordered.push(remaining.splice(best,1)[0]);
  }
  let mountains=0,waters=0;
  for(const p of ordered) {
    if(mountains<4&&((mountains<2&&p.type!=='meadow')||waters>=2)) {
      const rx=Math.min(38,p.w*.34),rz=Math.min(43,p.d*.35),height=24+(mountains%3)*9;
      map.terrainFeatures.push({id:'ridge-'+mountains,kind:'mountain',x:p.x,z:p.z,rx,rz,height,seed:mountains*1.7+map.seed%19,bounds:{x:p.x,z:p.z,w:rx*2,d:rz*2}});mountains++;continue;
    }
    if(waters<2) {
      const sx=Math.min(p.w*.26,23),sz=Math.min(p.d*.30,29),cx=p.x,cz=p.z;
      const points=[{x:cx-sx,z:cz-sz},{x:cx-9,z:cz-12},{x:cx+6,z:cz-2},{x:cx-5,z:cz+12},{x:cx+8,z:cz+sz-6}];
      const bounds={x:cx,z:cz,w:sx*2+24,d:sz*2+28};
      map.terrainFeatures.push({id:'river-'+waters,kind:'river',x:cx,z:cz,width:5.4,bank:5,level:-.38,depth:1.8,points,bounds});
      map.terrainFeatures.push({id:'lake-'+waters,kind:'lake',x:cx+8,z:cz+sz-5,rx:12,rz:9,width:5.4,bank:5,level:-.38,depth:2.6,bounds:{x:cx+8,z:cz+sz-5,w:36,d:30}});waters++;
    }
    if(mountains>=4&&waters>=2)break;
  }
}
export function settleLandscape(map,heightAt) {
  if(!map.terrainFeatures?.length)return;
  // Existing procedural props must stand on the NEW final terrain, not their original y=0.
  for(const o of map.obstacles)if(o.building===undefined&&!['site','car','glass'].includes(o.part)&&o.ground!==undefined) {
    const h=heightAt(o.x,o.z,map),delta=h-o.ground;o.y+=delta;o.ground=h;
  }
  const isDry=(x,z)=>heightAt(x,z,map)>waterLevelAt(x,z,map)+.12;
  for(const o of map.obstacles)if(o.part==='tree'&&!isDry(o.x,o.z))o.landscapeRemoved=true;
  // Rebuild tree indices before native tree-prop ids and before 2x2 copying.
  const oldTrees=map.trees,newTrees=[],remap=new Map();
  oldTrees.forEach((t,i)=>{if(isDry(t[0],t[1])){remap.set(i,newTrees.length);newTrees.push(t);}});
  map.trees.splice(0,map.trees.length,...newTrees);
  const original=map.obstacles.slice();map.obstacles.length=0;
  for(const o of original){if(o.landscapeRemoved)continue;if(o.tree!==undefined&&remap.has(o.tree))o.tree=remap.get(o.tree);map.obstacles.push(o);}
  map.flora??=[];map.flora.splice(0,map.flora.length,...map.flora.filter(p=>isDry(p.x,p.z)));
  map.spawns.splice(0,map.spawns.length,...map.spawns.filter(([x,z])=>isDry(x,z)));
  // Cross each first bend with a small structural timber footbridge, banks kept clear of trees.
  map.siteObjects??=[];map.siteGroups??=[];
  for(const f of map.terrainFeatures.filter(f=>f.kind==='river')) {
    const c=f.points[1],bridgeZ=c.z,width=19;
    const deckTop=Math.max(.26,heightAt(c.x-width/2,bridgeZ,map)+.18,heightAt(c.x+width/2,bridgeZ,map)+.18);
    const dy=deckTop-.26;
    const parts=[];const add=(dx,y,w,h,d,surface,hp=110)=>{const o={x:c.x+dx,y:y+dy,z:bridgeZ,w,h,d,part:'site',surface,color:surface==='wood'?0xa08b66:0x5c635c,hp};map.obstacles.push(o);map.siteObjects.push(o);parts.push(o);return o;};
    const posts=[];
    for(const dx of [-width/2+.5,width/2-.5])posts.push(add(dx,-.15,.22,1.1,3.1,'steel',160));
    for(let x=-width/2+.25;x<width/2;x+=.5)add(x,.15,.48,.22,2.8,'wood',90);
    for(const side of [-1,1])for(let x=-width/2+.5;x<width/2;x+=2.0){const o=add(x,.69,.09,1.04,.09,'steel',65);o.z=bridgeZ+side*1.37;}
    for(const side of [-1,1]){const o=add(0,1.16,width,.08,.08,'wood',90);o.z=bridgeZ+side*1.37;}
    map.siteGroups.push({supports:posts,parts:parts.filter(o=>!posts.includes(o)),minimum:2});
    f.bridge={x:c.x,z:bridgeZ,w:width,d:2.8,y:deckTop};
    for(const side of [-1,1]) {
      const a={x:c.x+side*(width/2+3),y:heightAt(c.x+side*(width/2+3),bridgeZ,map)+.045,z:bridgeZ},
        b={x:c.x+side*width/2,y:deckTop,z:bridgeZ};
      const o={...slopePrism(a,b,2.8,.13),part:'site',surface:'wood',color:0x9a8565,hp:120};map.obstacles.push(o);map.siteObjects.push(o);
    }
    const clear=o=>Math.abs(o.x-c.x)<width/2+4&&Math.abs(o.z-bridgeZ)<2.8;
    const remove=new Set(map.obstacles.filter(o=>o.part==='tree'&&clear(o)));
    const kept=map.obstacles.filter(o=>!remove.has(o));map.obstacles.length=0;map.obstacles.push(...kept);
    map.trees.splice(0,map.trees.length,...map.trees.filter(t=>!clear({x:t[0],z:t[1]})));
    map.flora.splice(0,map.flora.length,...map.flora.filter(o=>!clear(o)));
  }
}
// One clipped water union per terrain chunk. River and lake surfaces never double up.
export function waterMeshRegion(map,bounds,heightAt,step=2) {
  const vertices=[],indices=[];
  const sample=(x,z)=>{const level=waterLevelAt(x,z,map);return {x,z,y:Number.isFinite(level)?level:-.38,d:Math.max(Number.isFinite(level)?-1:1,heightAt(x,z,map)- (Number.isFinite(level)?level:-.38))};};
  const putTri=ps=>{let clip=[];for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],ina=a.d<0,inb=b.d<0;if(ina)clip.push(a);if(ina!==inb){const t=a.d/(a.d-b.d);clip.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});}}if(clip.length<3)return;const off=vertices.length/3;for(const p of clip)vertices.push(p.x,p.y+.018,p.z);for(let i=1;i<clip.length-1;i++)indices.push(off,off+i,off+i+1);};
  for(let z=bounds.z0;z<bounds.z1-.001;z+=step)for(let x=bounds.x0;x<bounds.x1-.001;x+=step){const a=sample(x,z),b=sample(Math.min(x+step,bounds.x1),z),c=sample(x,Math.min(z+step,bounds.z1)),d=sample(Math.min(x+step,bounds.x1),Math.min(z+step,bounds.z1));putTri([a,c,b]);putTri([b,c,d]);}
  return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}
