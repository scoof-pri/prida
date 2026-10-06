// Turns a logical floor plan into the same destructible records the existing world uses.
import { FLOOR_Y, WALL_H, planInterior, validateInteriorPlan } from './interior-plan.js';
import { cellGrid, cellCenter, cellBox } from './cells.js';
import { cutRect } from './architecture-geometry.js';
export function assignInteriorPlan(b) { b.interiorPlan = planInterior(b); return b.interiorPlan; }
export function buildInterior(map,b) {
  const plan=b.interiorPlan;if(!plan)return;
  validateInteriorPlan(b,plan);map.lifts??=[];map.interiorDetails??=[];
  const obs=(o)=>{map.obstacles.push(o);return o;};
  const wall=(axis,pos,a,c,base,height,k,extra={})=> {
    if(c-a<.025||height<.025)return [];
    const out=[],n=Math.ceil((c-a)/2.4);
    for(let i=0;i<n;i++) {
      const lo=a+(c-a)*i/n,hi=a+(c-a)*(i+1)/n,mid=(lo+hi)/2;
      out.push(obs({x:b.x+(axis==='x'?mid:pos),y:base+height/2,z:b.z+(axis==='x'?pos:mid),
        w:axis==='x'?hi-lo:.14,h:height,d:axis==='x'?.14:hi-lo,
        building:b.id,storey:k,part:'partition',face:'inside',structural:false,panel:map.panels++,hp:80,color:0xd9d4c9,interior033:true,...extra}));
    }return out;
  };
  for(const l of plan.levels)if(l) {
    for(const w of l.walls) {
      let lo=w.lo;const spans=[],headers=[];
      for(const gap of [...w.gaps].sort((a,c)=>a.c-c.c)){
        const start=Math.max(w.lo,gap.c-gap.w/2),end=Math.min(w.hi,gap.c+gap.w/2);
        spans.push(...wall(w.axis,w.at,lo,start,l.base,WALL_H(l.floor),l.floor));lo=Math.max(lo,end);
        headers.push(...wall(w.axis,w.at,start,end,l.base+2.45,WALL_H(l.floor)-2.45,l.floor,{interiorHeader:true,part:'lintel'}));
      }
      spans.push(...wall(w.axis,w.at,lo,w.hi,l.base,WALL_H(l.floor),l.floor));
      for(const header of headers){
        const center=w.axis==='x'?header.x:header.z, width=w.axis==='x'?header.w:header.d;
        header.supports=spans.filter(o=>Math.abs(Math.abs((w.axis==='x'?o.x:o.z)-center)-((w.axis==='x'?o.w:o.d)+width)/2)<.025).map(o=>o.panel);
      }
    }
    for(const d of l.doors) {
      const world={x:b.x+d.at[0],z:b.z+d.at[1]},alongZ=d.axis==='z';
      const nearby=map.obstacles.filter(o=>o.interior033&&o.building===b.id&&o.storey===l.floor&&!o.interiorHeader&&
        Math.abs((alongZ?o.x:o.z)-(alongZ?world.x:world.z))<.18&&
        Math.abs(Math.abs((alongZ?o.z:o.x)-(alongZ?world.z:world.x))-((alongZ?o.d:o.w)+d.w)/2)<.24).map(o=>o.panel);
      map.doors.push({...world,building:b.id,storey:l.floor,axis:d.axis,face:1,w:d.w,y:l.base+1.20,h:2.38,
        kind:'inner',color:plan.kind==='office'?0x72817b:0xb49a79,panels:nearby,planned033:true,label:d.name});
    }
    // Finish/wayfinding data is resident with its building. Not a second collision world.
    for(const r of l.rooms)map.interiorDetails.push({building:b.id,storey:l.floor,x:b.x+(r.bounds[0]+r.bounds[2])/2,
      y:l.base,z:b.z+(r.bounds[1]+r.bounds[3])/2,w:r.bounds[2]-r.bounds[0],d:r.bounds[3]-r.bounds[1],
      purpose:r.purpose,label:r.unit?r.unit+' / '+r.name:r.name,roomBounds:r.bounds.slice(),entrance:r.entrance});
  }
  if(!plan.lift)return;
  const def=plan.lift,id='lift-'+b.id,x=b.x+def.at[0],z=b.z+def.at[1],w=def.size[0],d=def.size[1];
  const lift={id,building:b.id,x,z,w,d,doorWidth:def.doorWidth,stops:[...def.floors],panels:[],hp:400,broken:false,
    floor:0,target:0,y:def.floors[0],open:1,phase:'idle',queue:[]};
  // Native slab masks drive both the visible aperture and Rapier's floor cells.
  for(const slab of map.obstacles.filter(o=>o.building===b.id&&o.part==='roof'&&(o.storey||0)<def.floors.length-1)) {
    const g=cellGrid(slab);if(!slab.cells)slab.cells=new Uint8Array(g.cols*g.rows).fill(60);
    for(let i=0;i<slab.cells.length;i++){
      const p=cellCenter(slab,i);
      if(Math.abs(p.x-x)<w/2+g.cw*.45&&Math.abs(p.z-z)<d/2+g.ch*.45) {
        if(slab.cells[i]>0){
          const c=i%g.cols,r=Math.floor(i/g.cols),cell=cellBox(slab,c,c,r,r);
          // Exact collar fills the coarse mask outside the shaft. Do not recreate a pre-existing stair hole.
          for(const piece of cutRect(cell,[{x,z,w:w+.18,d:d+.18}]))
            obs({...piece,part:'roof',building:b.id,storey:slab.storey,panel:map.panels++,hp:120,structural:false,
              color:slab.color,surface034:slab.surface034,interiorCollar:true});
        }
        slab.cells[i]=0;
      }
    }
    slab.cellsAlive=slab.cells.reduce((n,v)=>n+(v>0),0);
  }
  for(let k=0;k<def.floors.length;k++) {
    const base=FLOOR_Y(k),h=WALL_H(k),lx=def.at[0],lz=def.at[1];
    const shaft=[];
    shaft.push(...wall('z',lx+w/2,lz-d/2,lz+d/2,base,h,k,{liftShaft:id}));
    for(const s of [-1,1])shaft.push(...wall('x',lz+s*d/2,lx-w/2,lx+w/2,base,h,k,{liftShaft:id}));
    for(const s of [-1,1]) {
      const a=s<0?lz-d/2:lz+def.doorWidth/2,c=s<0?lz-def.doorWidth/2:lz+d/2;
      shaft.push(...wall('z',lx-w/2,a,c,base,h,k,{liftShaft:id}));
    }
    shaft.push(...wall('z',lx-w/2,lz-def.doorWidth/2,lz+def.doorWidth/2,base+2.50,h-2.50,k,{liftShaft:id}));
    lift.panels.push(...shaft.map(o=>o.panel));
  }
  map.lifts.push(lift);
}
