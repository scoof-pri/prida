// PRIDA 0.34 / Stage 2. Original playable designs inspired by public retail/banking halls.
// Structural panels, panes, slabs and prop records use the SAME destruction and physics map as the old city.
import { rect, floorY, ceilingY, boundaryOf, floorPieces, slopePrism, barrelPanel, validateLandmark } from './landmark-geometry.js';
const A=a=>rect(...a),mid=(a,c)=>(a+c)/2;
export function configureLandmarkLots(map) {
  if(map.landmarkLots034)return;map.landmarkLots034=true;map.landmarks=[];map.escalators=[];
  if(map.size!=='city')return;
  const used=new Set();
  for(const lot of map.plots.filter(p=>p.type==='building'&&!p.poi)) {
    const k=lot.kind;if(!k||k.poi)continue;
    let role=k.type==='mall'&&!used.has('mall')?'mall':k.type==='bank'&&!used.has('bank')?'bank':
      k.type==='residence'&&!used.has('courtyard')?'courtyard':null;
    // Retain ordinary offices for their existing interior/lift behaviour; give a second office a stepped silhouette.
    if(k.type==='office'){if(!used.has('ordinary-office'))used.add('ordinary-office');else if(!used.has('terraces'))role='terraces';}
    if(!role)continue;
    const w=Math.min(lot.w-6,role==='mall'?40:role==='courtyard'?20:18),d=Math.min(lot.d-6,role==='mall'?19:20);
    if(w<(role==='mall'?34:17)||d<17)continue;
    used.add(role);lot.kind={...k,w,d,type:role==='courtyard'?'courtyard-residence':role==='terraces'?'terraced-office':k.type,
      landmark034:role,sign:role==='mall'?'GLASS ARCADE':role==='bank'?'CIVIC BANK':role==='courtyard'?'COURT GARDENS':'TERRACE HOUSE',
      storeys:role==='bank'?1:2,color:role==='bank'?0xc8c4b5:role==='mall'?0xc5c7c0:role==='terraces'?0xb5b3a4:0xc8b79d,accent:0x57746f};
  }
}
function room(level,name,purpose,bounds,entrance,unit='') {
  const r={name,purpose,bounds,entrance,unit};level.rooms.push(r);return r;
}
function sealRooms(level,hw,hd) {
  const raw=[...level.walls];
  for(const r of level.rooms) {
    const [x0,z0,x1,z1]=r.bounds;
    for(const [side,axis,at,lo,hi] of [['w','z',x0,z0,z1],['e','z',x1,z0,z1],['n','x',z0,x0,x1],['s','x',z1,x0,x1]]) {
      if((axis==='x'&&Math.abs(Math.abs(at)-hd)<.12)||(axis==='z'&&Math.abs(Math.abs(at)-hw)<.12))continue;
      const gap=side===r.entrance.side?{c:r.entrance.at,w:r.purpose==='shop'?2.3:1.08}:null;
      raw.push({axis,at,lo,hi,gaps:gap?[gap]:[]});
      if(gap&&r.purpose!=='shop')level.doors.push({at:axis==='x'?[gap.c,at]:[at,gap.c],axis,w:gap.w,name:unitLabel(r)+r.name});
    }
  }
  const lines=[];
  for(const edge of raw){let line=lines.find(l=>l.axis===edge.axis&&Math.abs(l.at-edge.at)<.171);if(!line){line={axis:edge.axis,at:edge.at,segments:[]};lines.push(line);}line.segments.push(edge);}
  level.walls=[];
  for(const line of lines){const ranges=[];
    for(const edge of line.segments.sort((a,b)=>a.lo-b.lo)){let last=ranges.at(-1);if(!last||edge.lo>last.hi+.171){last={axis:line.axis,at:line.at,lo:edge.lo,hi:edge.hi,gaps:[]};ranges.push(last);}else last.hi=Math.max(last.hi,edge.hi);for(const gap of edge.gaps)if(!last.gaps.some(g=>Math.abs(g.c-gap.c)<.05))last.gaps.push({...gap});}
    level.walls.push(...ranges);
    for(const door of level.doors)if(door.axis===line.axis&&Math.abs(door.at[line.axis==='x'?1:0]-line.at)<.18)door.at[line.axis==='x'?1:0]=line.at;
  }
}

const unitLabel=r=>r.unit?r.unit+' / ':'';
export function landmarkPlan(b) {
  const hw=b.w/2-.40,hd=b.d/2-.40,levels=[],role=b.landmark034;
  const lift={at:[hw-1.26,-hd+1.20],size:[2.32,2.04],doorWidth:1.12,floors:Array.from({length:b.storeys+1},(_,k)=>floorY(k)+.035)};
  for(let k=0;k<=b.storeys;k++) {
    const l={floor:k,base:floorY(k),rooms:[],halls:[],walls:[],doors:[],openings:[]};
    if(role==='mall') {
      l.halls.push({name:'GALLERY / ATRIUM',bounds:[-hw,-hd,hw,hd]});
      const max=hw-4.9,span=(max+hw)/4;
      for(const side of [-1,1])for(let n=0;n<4;n++) {
        const x0=-hw+n*span+.08,x1=-hw+(n+1)*span-.08,z0=side<0?-hd:6.25,z1=side<0?-6.25:hd;
        if(z1-z0<2.0)continue;
        room(l,((k===2?['COFFEE','FOOD COURT','BOOKS','DESIGN']:['BOOKS','OUTDOOR','HOME','TECH'])[n]),'shop',[x0,z0,x1,z1],{side:side<0?'s':'n',at:mid(x0,x1)});
      }
    } else if(role==='bank') {
      l.halls.push({name:k?'UPPER GALLERY':'PUBLIC BANKING HALL',bounds:[-hw,-hd,hw,hd]});
      if(k===0){
        room(l,'CUSTOMER ADVICE','meeting',[-hw,-hd,-3.5,-1.1],{side:'e',at:-4.8});
        room(l,'PRIVATE OFFICE','office',[3.5,5.0,hw,hd],{side:'w',at:6.2});
        room(l,'PUBLIC WC','bathroom',[-hw,4.0,-3.5,hd],{side:'e',at:6.2});
      } else {
        room(l,'ADMINISTRATION','workspace',[-hw,-hd,-5.25,2.0],{side:'e',at:0});
        room(l,'MEETING ROOM','meeting',[-hw,4.0,1.5,hd],{side:'n',at:-2.0});
        room(l,'WC','bathroom',[3.7,5.0,hw,hd],{side:'w',at:6.5});
      }
    } else if(role==='courtyard') {
      l.halls.push({name:'COURTYARD / SHARED GALLERY',bounds:[-3.8,-hd,-2.0,hd]});
      l.halls.push({name:'ENTRANCE / LIFT / STAIRS',bounds:[-2.0,4.0,hw,hd]});
      if(k>0){
        const x0=-hw,x1=-3.90,cz=-3.0,cut=mid(x0,x1),unit=String(k*100+1);
        room(l,'LIVING ROOM','living',[x0,-hd,cut-.08,cz-.78],{side:'s',at:mid(x0,cut)},unit);
        room(l,'KITCHEN','kitchen',[cut+.08,-hd,x1,cz-.78],{side:'s',at:mid(cut,x1)},unit);
        room(l,'BEDROOM','bedroom',[x0,cz+.78,cut-.08,3.55],{side:'n',at:mid(x0,cut)},unit);
        room(l,'BATHROOM','bathroom',[cut+.08,cz+.78,x1,3.55],{side:'n',at:mid(cut,x1)},unit);
        l.walls.push({axis:'z',at:x1,lo:-hd,hi:3.55,gaps:[{c:cz,w:1.14}]});l.doors.push({axis:'z',at:[x1,cz],w:1.14,name:'APARTMENT '+unit});
      } else {
        room(l,'RESIDENT LOUNGE','lounge',[-hw,-hd,-4.7,-1.4],{side:'e',at:-4.6});
        room(l,'BIKE / PARCEL ROOM','office',[-hw,.7,-4.7,3.5],{side:'e',at:2.0});
      }
      room(l,'SHARED KITCHEN','kitchen',[-hw,5.75,-4.7,hd],{side:'e',at:7.3});
    } else {
      l.halls.push({name:'LIFT / STAIRS / TERRACE',bounds:[3.4,-hd,hw,hd]});
      const west=k===2?-2.55:-hw;
      const cx=mid(west,3.35);
      room(l,k===0?'RECEPTION':'DESIGN WORKSPACE',k===0?'lounge':'workspace',[west,-hd,cx-.08,-1.0],{side:'s',at:mid(west,cx)});
      room(l,'PRIVATE OFFICE','office',[cx+.08,-hd,3.35,-1.0],{side:'s',at:mid(cx,3.35)});
      room(l,'MEETING','meeting',[west,1.0,cx-.08,hd],{side:'n',at:mid(west,cx)});
      room(l,'WC / SERVICE','bathroom',[cx+.08,1.0,3.35,hd],{side:'n',at:mid(cx,3.35)});
    }
    sealRooms(l,hw,hd);l.openings=l.doors.map(d=>({at:[...d.at],w:d.w,axis:d.axis}));levels.push(l);
  }
  return {version:2,kind:role==='courtyard'?'residential':'office',hw,hd,serviceX:hw-4.85,levels,lift};
}
export function buildLandmark(map,b) {
  if(!b.landmark034)return false;
  map.siteObjects??=[];map.siteGroups??=[];map.landmarks??=[];map.escalators??=[];
  const role=b.landmark034,W=b.w/2,D=b.d/2;
  b.panels=[];b.upperPanels=[];b.interiorPlan=landmarkPlan(b);
  const footprints=Array.from({length:b.storeys+1},(_,k)=>role==='courtyard'?
    [[-W,-D,-2,4],[3.5,-D,W,4],[-W,4,W,D]]:
    role==='terraces'&&k===2?[[-3,-D,W,D]]:[[-W,-D,W,D]]);
  b.footprints034=footprints.map(l=>l.map(a=>a.slice()));
  const roof=ceilingY(b.storeys)+.24;b.roofBase=roof;b.height=roof+(role==='mall'?1.65:role==='bank'?1.55:.60);
  const add=o=>{map.obstacles.push(o);return o;};
  const solid=(x,y,z,w,h,d,part='site',extra={})=>add({x:b.x+x,y,z:b.z+z,w,h,d,part,building:b.id,color:b.color,hp:120,...extra});
  const site=(x,y,z,w,h,d,surface,color,extra={})=>{const o=solid(x,y,z,w,h,d,'site',{surface,color,...extra});map.siteObjects.push(o);return o;};
  const panel=(e,lo,hi,base,height,k)=>{
    const center=mid(lo,hi),along=e.axis==='x',th=.36;
    const o=solid(along?center:e.at-e.out*th/2,base+height/2,along?e.at-e.out*th/2:center,along?hi-lo:th,height,along?th:hi-lo,'wall',
      {panel:map.panels++,face:along?(e.out<0?'north':'south'):(e.out<0?'west':'east'),structural:true,storey:k,hp:120});
    (k?b.upperPanels:b.panels).push(o.panel);return o;
  };
  const glazed=(o,e,k,span)=>{
    if(span<1.25)return;
    const along=e.axis==='x',height=role==='mall'?2.20:role==='bank'?2.32:role==='terraces'?2.05:1.45;
    const win={panel:o.panel,x:o.x+(along?0:e.out*.21),z:o.z+(along?e.out*.21:0),y:floorY(k)+1.74,
      w:Math.min(role==='courtyard'?1.40:2.30,span*.69),h:height,axis:e.axis,out:e.out,curtains:role==='courtyard'};
    const c=along?o.x:o.z;o.hole={alongX:along,a0:c-win.w/2,a1:c+win.w/2,y0:win.y-height/2,y1:win.y+height/2};
    map.windows.push(win);solid(o.x-b.x,win.y,o.z-b.z,along?win.w:.045,height,along?.045:win.w,'glass',{windowPanel:o.panel,nocollide:true,storey:k,hp:1});
  };
  const entrance=boundaryOf(footprints[0].map(A)).filter(e=>e.axis==='x'&&e.out===1).sort((a,c)=>c.at-a.at)[0];
  const entryX=entrance.lo<0&&entrance.hi>0?0:mid(entrance.lo,entrance.hi);b.entry034=[entryX,entrance.at];
  const floorRecords=[];
  for(let k=0;k<=b.storeys;k++) {
    const base=floorY(k),h=ceilingY(k)-base,edges=boundaryOf(footprints[k].map(A));
    for(const e of edges) {
      const door=k===0&&e.axis==='x'&&Math.abs(e.at-entrance.at)<.01&&entryX>e.lo&&entryX<e.hi;
      const spans=door?[[e.lo,entryX-1.35],[entryX+1.35,e.hi]]:[[e.lo,e.hi]],supports=[];
      for(const [lo,hi] of spans){const n=Math.max(1,Math.ceil((hi-lo)/2.8));for(let i=0;i<n;i++){
        const a=lo+(hi-lo)*i/n,c=lo+(hi-lo)*(i+1)/n;
        if(c-a<.18)continue;const o=panel(e,a,c,base,h,k);glazed(o,e,k,c-a);supports.push(o);
      }}
      if(door){
        const adjacent=supports.filter(o=>Math.abs(Math.abs(o.x-(b.x+entryX))-(o.w/2+1.35))<.03).map(o=>o.panel);
        solid(entryX,base+2.65+(h-2.65)/2,e.at-e.out*.18,2.7,h-2.65,.36,'lintel',{storey:0,panel:map.panels++,supports:adjacent,structural:false});
        map.doors.push({building:b.id,x:b.x+entryX,z:b.z+e.at-e.out*.18,w:2.7,axis:'x',face:e.out,y:base+1.275,h:2.55,panels:adjacent,kind:'outer'});
      }
    }
    const holes=[];
    if(k>0&&(role==='mall'||role==='bank'))holes.push(role==='mall'?rect(-7.6,-4.2,7.6,4.2):rect(-3.5,-6,3.5,3));
    // Native stairs run along the fixed eastern service spine. Alternating directions keep landings connected.
    const stairX=W-1.25-((k-1)%2===1?1.60:0);
    if(k>0)holes.push({x:stairX,z:0,w:1.56,d:6.6});
    if(k>0&&b.interiorPlan.lift){const l=b.interiorPlan.lift;holes.push({x:l.at[0],z:l.at[1],w:l.size[0]+.18,d:l.size[1]+.18});}
    let pieces=floorPieces((k>0?[...footprints[k],...footprints[k-1]]:footprints[k]).map(A),holes);
    if(k>0&&role==='mall')pieces.push(rect(-1.0,-4.2,1.0,4.2));
    for(const r of pieces){const o=solid(r.x,base-(k?.12:.03),r.z,r.w,k?.24:.06,r.d,'roof',
      {storey:k-1,panel:map.panels++,structural:false,hp:210,color:role==='courtyard'?0xc8b492:0xcac7b7,surface034:role==='courtyard'?'wood':'tiles'});floorRecords.push(o);}
    if(k<b.storeys){
      const x=W-1.25-(k%2?1.60:0),dir=k%2?-1:1,rise=floorY(k+1)-base;
      for(let i=0;i<14;i++){const top=(i+1)*rise/14;solid(x,base+top/2,dir*(-3.1+(i+.5)*6.2/14),1.38,top,6.2/14,'stair',{storey:k,step:i,hp:95,ground:base});}
    }
    if(k>0&&(role==='mall'||role==='bank')) {
      const ax=role==='mall'?7.6:3.5,az0=role==='mall'?-4.2:-6,az1=role==='mall'?4.2:3;
      for(const side of [-1,1]){
        for(const [a,c] of [[-ax,-1.1],[1.1,ax]])site(mid(a,c),base+.93,side<0?az0:az1,c-a,.075,.075,'steel',0x515d5a,{storey:k});
        for(let x=-ax+.4;x<ax;x+=1.8)site(x,base+.45,side<0?az0:az1,.06,.90,.06,'steel',0x56635c,{storey:k,hp:70});
      }
      // End balustrades leave gates aligned with the conveyor landings.
      for(const side of [-1,1])for(const [a,c] of (role==='mall'?[[-4.2,-2.6],[-1.10,1.10],[2.6,4.2]]:[[az0,az1]])){
        site(side*ax,base+.93,mid(a,c),.07,.075,c-a,'steel',0x515d5a,{storey:k});
        site(side*ax,base+.44,mid(a,c),.05,.83,c-a,'glass034',0xc0d8d0,{storey:k,hp:35});
      }
    }
  }
  // Non-rectangular upper terraces: expose the actual slab below, never draw a giant enclosing box.
  const last=footprints.at(-1).map(A),roofHole=(role==='mall')?rect(-7.9,-4.5,7.9,4.5):role==='bank'?rect(-3.65,-6.2,3.65,3.2):null;
  const roofRecords=[];
  for(const r of floorPieces(last,roofHole?[roofHole]:[]))roofRecords.push(solid(r.x,roof-.12,r.z,r.w,.24,r.d,'roof',
    {storey:b.storeys,panel:map.panels++,structural:false,hp:230,surface034:'concrete',color:0xb6b8aa}));
  for(const e of boundaryOf(last)) {
    const along=e.axis==='x';site(along?mid(e.lo,e.hi):e.at,roof+.22,along?e.at:mid(e.lo,e.hi),along?e.hi-e.lo:.22,.44,along?.22:e.hi-e.lo,'concrete',0xaeb5aa,{storey:b.storeys+1});
  }
  if(roofHole) {
    const z0=roofHole.z-roofHole.d/2,z1=roofHole.z+roofHole.d/2,x0=roofHole.x-roofHole.w/2,x1=roofHole.x+roofHole.w/2;
    const panes=[];
    for(let xi=0;xi<Math.ceil((x1-x0)/3.2);xi++)for(let j=0;j<8;j++) {
      const count=Math.ceil((x1-x0)/3.2),xa=x0+(x1-x0)*xi/count,xb=x0+(x1-x0)*(xi+1)/count,za=z0+(z1-z0)*j/8,zb=z0+(z1-z0)*(j+1)/8;
      const sh=barrelPanel(b.x+xa,b.x+xb,b.z+za,b.z+zb,roof+.12,role==='mall'?1.5:1.4,b.z+roofHole.z,roofHole.d/2,.055);
      const o=add({...sh,part:'site',surface:'glass034',color:0xaecdd2,building:b.id,storey:b.storeys+1,hp:38,roofGlass034:true});map.siteObjects.push(o);panes.push(o);
    }
    for(let xi=0;xi<=Math.ceil((x1-x0)/3.2);xi++)for(let j=0;j<8;j++) {
      const count=Math.ceil((x1-x0)/3.2),x=x0+(x1-x0)*xi/count,za=z0+(z1-z0)*j/8,zb=z0+(z1-z0)*(j+1)/8;
      const sh=barrelPanel(b.x+x-.043,b.x+x+.043,b.z+za,b.z+zb,roof+.155,role==='mall'?1.5:1.4,b.z+roofHole.z,roofHole.d/2,.105);
      const o=add({...sh,part:'site',surface:'steel',color:0x61736b,building:b.id,storey:b.storeys+1,hp:105});map.siteObjects.push(o);panes.push(o);
    }
    map.siteGroups.push({supports:roofRecords,parts:panes,minimum:Math.max(1,Math.ceil(roofRecords.length*.35))});
  }
  if(role==='terraces') {
    const y=floorY(2),west=-W+.35,x1=-3.15;
    for(const z of [-D+.3,D-.3]){site(mid(west,x1),y+.95,z,x1-west,.09,.09,'steel',0x546e64,{storey:2});site(mid(west,x1),y+.46,z,x1-west,.88,.04,'glass034',0xb4c9c2,{storey:2,hp:35});}
    for(const z of [-6,0,6])site(-6.2,y+.4,z,1.2,.8,1.2,'concrete',0x999b86,{storey:2,hp:125});
  }
  if(role==='courtyard') {
    for(let k=1;k<=b.storeys;k++)for(const x of [-2,3.5]){site(x,floorY(k)+.93,-3,.08,.08,13.7,'steel',0x5b7362,{storey:k});for(let z=-9;z<4;z+=1.6)site(x,floorY(k)+.45,z,.065,.90,.065,'steel',0x5b7362,{storey:k});}
    for(const z of [-7,0]){const base=site(.8,.32,z,2.0,.64,1.0,'concrete',0xabb296,{hp:120}),soil=site(.8,.67,z,1.7,.06,.70,'dirt',0x6b6042,{hp:60});map.siteGroups.push({supports:[base],parts:[soil],minimum:1});}
  }
  if(role==='mall') {
    for(let k=0;k<b.storeys;k++)for(const [lane,dir] of [[-1.85,1],[1.85,-1]]) {
      const from={x:b.x+(k===0?-8.08:.90),y:floorY(k)+.014,z:b.z+lane},to={x:b.x+(k===0?-.90:8.08),y:floorY(k+1)+.014,z:b.z+lane};
      const id='escalator-'+b.id+'-'+k+'-'+dir,geom=slopePrism(from,to,1.26,.15);
      const ramp=add({...geom,part:'site',surface:'steel',color:0x485658,building:b.id,storey:k,hp:260,escalatorId:id,escalatorRamp:true});map.siteObjects.push(ramp);
      const motor=site(from.x-b.x,from.y-.16,from.z-b.z,1.0,.28,1.13,'steel',0x596867,{storey:k,hp:165,escalatorId:id});
      // Handrail support follows the same slope but stays outside the passenger's 1.0 m clear lane.
      for(const side of [-1,1]){
        const a={...from,y:from.y+.90,z:from.z+side*.70},c={...to,y:to.y+.90,z:to.z+side*.70},sh=slopePrism(a,c,.065,.10);
        const o=add({...sh,part:'site',surface:'steel',color:0x34413f,building:b.id,storey:k,hp:85,escalatorId:id});map.siteObjects.push(o);
      }
      map.escalators.push({id,building:b.id,storey:k,x:mid(from.x,to.x),z:from.z,from,to,width:1.26,speed:.85,direction:dir,ramp,motor,
        floorPanels:floorRecords.filter(o=>o.storey===k||o.storey===k-1).map(o=>o.panel)});
    }
  }
  b.chestSpot={x:b.x+entryX+.65,z:b.z+entrance.at-2.0};map.spawns.push([b.x+entryX,b.z+entrance.at-1.15]);
  map.landmarks.push({id:'landmark-'+b.id,building:b.id,x:b.x,z:b.z,name:b.sign,kind:role,w:b.w,d:b.d});
  // Public-facing entrance canopy and a sheltered sitting area, rather than a pasted-on box facade.
  const canopy=site(entryX,3.18,entrance.at+.65,5.0,.14,1.60,'steel',0x62746a,{storey:0,hp:135});
  const header=map.obstacles.find(o=>o.building===b.id&&o.part==='lintel'&&o.storey===0);
  if(header)map.siteGroups.push({supports:[header],parts:[canopy],minimum:1});
  validateLandmark(map,b);return true;
}
export function furnishLandmark(b,k,ctx) {
  if(!b.landmark034)return false;
  // Reuse shipped furniture. All special placements are bounded to their store unit and the public paths.
  const base=floorY(k),put=(name,x,z,rot=0,opts={})=>ctx.put(name,b.x+x,b.z+z,rot,{...opts,building:b.id,storey:k,y:base+(opts.y||0)});
  for(const r of b.interiorPlan.levels[k].rooms)if(r.purpose==='shop') {
    const [a,c,e,f]=r.bounds,side=r.entrance.side==='n'?1:-1,wall=side>0?f-.37:c+.37;
    for(let x=a+.80;x<e-.7;x+=1.15)put(r.name==='FOOD COURT'||r.name==='COFFEE'?'fridge':'bookcase',x,wall,side>0?Math.PI:0);
    const counter=put('table',a+1.2,mid(c,f),0);if(counter>=0)put('laptop',a+1.2,mid(c,f),Math.PI,{y:.67,collide:false,on:counter});
  }
  if(b.landmark034==='bank'&&k===0) {
    for(const z of [-4.5,-1.6,1.3]){const id=put('desk',2.35,z,Math.PI/2);if(id>=0)put('monitor',2.35,z,Math.PI/2,{on:id,y:.80,collide:false});put('office-chair',3.1,z,-Math.PI/2,{collide:false});}
    for(const z of [-4.8,-1.6,1.6])put('bench',-2.7,z,Math.PI/2);
  }
  if(b.landmark034==='mall')for(const x of [-10.7,10.7])for(const z of [-3.8,3.8])put('bench',x,z,Math.PI/2);
  return true;
}
