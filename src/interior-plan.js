// PRIDA 0.33 / Stage 1. Local, metre-based plans; no renderer or physics dependency.
// Coordinates are arrays, so four-sector world copies do not translate them twice.
export const FLOOR_Y = k => k === 0 ? .045 : 3.84 + (k - 1) * 3.6;
export const WALL_H = k => k === 0 ? 3.50 : 3.30;
export const DOOR_WIDTH = 1.08;
const DEPARTMENTS=['OPERATIONS','DESIGN','FINANCE','ENGINEERING','LEGAL','SALES'];
const MIXED = new Set(['cafe','pharmacy','bookshop','market','pavilion']);
export function interiorKind(b) {
  if (b.category === 'home' && b.type !== 'guesthouse') return 'residential';
  if (b.type === 'office') return 'office';
  if (MIXED.has(b.type) && b.storeys > 0) return 'mixed';
  return null;
}
const midpoint = a => (a[0] + a[2]) / 2;
const midz = a => (a[1] + a[3]) / 2;
export function planInterior(b) {
  const kind = interiorKind(b);
  if (!kind || b.w < 9 || b.d < 9) return null;
  const hw = b.w / 2 - .48, hd = b.d / 2 - .48;
  const floors = Math.max(0, b.storeys || 0) + 1;
  // Existing stairs occupy the two eastern lanes, z=-3..3. Keep both landings free.
  const serviceX = floors > 1 ? hw - 4.85 : hw;
  const lift = floors > 1 && b.w >= 12 && b.d >= 12 ? {
    at: [hw - 1.26, -hd + 1.20], size: [2.32, 2.04],
    doorWidth: 1.12, floors: Array.from({length:floors}, (_,k) => FLOOR_Y(k) + .035),
  } : null;
  const levels = [];
  for (let k=0;k<floors;k++) {
    if (kind==='mixed' && k===0) { levels.push(null); continue; }
    const level = {floor:k, base:FLOOR_Y(k), rooms:[], halls:[], walls:[], openings:[], doors:[]};
    const room = (name, purpose, rect, entrance, unit='') => {
      if (rect[2]-rect[0]<1.55 || rect[3]-rect[1]<1.7) return null;
      const r = {name, purpose, bounds:rect, entrance, unit};level.rooms.push(r);return r;
    };
    if (k===0) {
      const hall = Math.min(1.80, Math.max(1.3,(b.door||3.2)/2+.15));
      level.halls.push({name:kind==='office'?'RECEPTION / LOBBY':floors>1?'ENTRANCE / MAIL':'ENTRANCE HALL',bounds:[-hall,-hd,hall,hd]});
      const gap = floors>1 ? 1.05 : .08;
      const left=[-hw,-hd,-hall-.08,-gap], leftSouth=[-hw,gap,-hall-.08,hd];
      room(kind==='office'?'MEETING 01':floors>1?'RESIDENT LOUNGE':'KITCHEN',kind==='office'?'meeting':floors>1?'lounge':'kitchen',left,{side:'e',at:midz(left)});
      room(kind==='office'?'WAITING': 'LIVING ROOM','living',leftSouth,{side:'e',at:midz(leftSouth)});
      if (floors===1) {
        const rn=[hall+.08,-hd,hw,-.08],rs=[hall+.08,.08,hw,hd];
        room('BEDROOM','bedroom',rn,{side:'w',at:midz(rn)});
        room('BATHROOM','bathroom',rs,{side:'w',at:midz(rs)});
      } else {
        // Do not put a bathroom, kitchen or closed room over the stairs or the lift.
        const rs=[hall+.08,3.70,hw,hd];
        room('WC / SERVICE','bathroom',rs,{side:'w',at:midz(rs)});
        level.halls.push({name:'STAIRS / LIFT',bounds:[hall,-hd,hw,hd]});
      }
    } else {
      const x0=-hw,x1=serviceX, width=x1-x0;
      // Apartments occupy a full floor in small buildings. Two units only where dimensions allow real rooms.
      const units = kind!=='office' && b.d>=21 && width>=7 ? 2 : 1;
      level.halls.push({name:'SHARED CORRIDOR / STAIRS',bounds:[x1,-hd,hw,hd]});
      for(let u=0;u<units;u++) {
        const za=-hd+(2*hd/units)*u,zb=-hd+(2*hd/units)*(u+1),cz=(za+zb)/2;
        const cut=x0+width*.5, aisle=.73;
        const unit=kind==='office'?'':String(k*100+u+1);
        level.halls.push({name:kind==='office'?'DEPARTMENT CORRIDOR':'APARTMENT '+unit+' / HALL',bounds:[x0,cz-aisle,x1,cz+aisle],unit});
        const specs=kind==='office' ? [
          [DEPARTMENTS[((b.sourceId??b.id??0)+k)%DEPARTMENTS.length]+' / WORKSPACE','workspace',[x0,za,cut-.08,cz-aisle-.08],'s'],
          ['PRIVATE OFFICE '+k,'office',[cut+.08,za,x1-.08,cz-aisle-.08],'s'],
          ['MEETING '+k,'meeting',[x0,cz+aisle+.08,cut-.08,zb],'n'],
          ['WC / WASHROOM','bathroom',[cut+.08,cz+aisle+.08,x1-.08,zb],'n'],
        ] : [
          ['LIVING ROOM','living',[x0,za,cut-.08,cz-aisle-.08],'s'],
          ['KITCHEN','kitchen',[cut+.08,za,x1-.08,cz-aisle-.08],'s'],
          ['BEDROOM','bedroom',[x0,cz+aisle+.08,cut-.08,zb],'n'],
          ['BATHROOM','bathroom',[cut+.08,cz+aisle+.08,x1-.08,zb],'n'],
        ];
        for(const [name,purpose,rect,side] of specs)room(name,purpose,rect,{side,at:midpoint(rect)},unit);
        if(kind!=='office')level.doors.push({at:[x1,cz],axis:'z',w:1.18,name:'APARTMENT '+unit,unit});
        // Wall dividing the private unit or the office rooms from the public circulation space.
        level.walls.push({axis:'z',at:x1,lo:za,hi:zb,gaps:[{c:cz,w:kind==='office'?1.46:1.18}],private:true});
      }
    }
    // Merge coincident room boundaries. Each material surface is generated once, not once per adjacent room.
    const edges=[];
    for(const r of level.rooms) {
      const [x0,z0,x1,z1]=r.bounds;
      for(const [side,axis,pos,lo,hi] of [['w','z',x0,z0,z1],['e','z',x1,z0,z1],['n','x',z0,x0,x1],['s','x',z1,x0,x1]]) {
        if((axis==='z' && Math.abs(Math.abs(pos)-hw)<.10)||(axis==='x' && Math.abs(Math.abs(pos)-hd)<.10))continue;
        const gap=r.entrance.side===side?{c:r.entrance.at,w:DOOR_WIDTH}:null;
        edges.push({axis,at:pos,lo,hi,gaps:gap?[gap]:[]});
        if(gap)level.doors.push({at:axis==='x'?[gap.c,pos]:[pos,gap.c],axis,w:gap.w,name:(r.unit?r.unit+' / ':'')+r.name,unit:r.unit});
      }
    }
    // Rectangles use a 16 cm separating gap: both boundaries describe opposite sides of ONE 16 cm wall.
    const lines=[];
    for(const e of [...level.walls,...edges]) {
      let line=lines.find(q=>q.axis===e.axis && Math.abs(q.at-e.at)<.171);
      if(!line){line={axis:e.axis,at:e.at,private:e.private,segments:[]};lines.push(line);}
      else if(!line.private&&!e.private)line.at=(line.at+e.at)/2;
      line.segments.push(e);
    }
    const merged=[];
    for(const line of lines) {
      const ranges=[];
      for(const seg of line.segments.sort((a,b)=>a.lo-b.lo)) {
        let last=ranges.at(-1);
        if(!last||seg.lo>last.hi+.171){last={axis:line.axis,at:line.at,lo:seg.lo,hi:seg.hi,gaps:[]};ranges.push(last);}
        else last.hi=Math.max(last.hi,seg.hi);
        for(const g of seg.gaps)if(!last.gaps.some(h=>Math.abs(g.c-h.c)<.05))last.gaps.push({...g});
      }
      merged.push(...ranges);
      // Put each hinge on the canonical wall centre, including boundaries shared by two rooms.
      for(const door of level.doors)if(door.axis===line.axis&&Math.abs(door.at[line.axis==='x'?1:0]-line.at)<.18)
        door.at[line.axis==='x'?1:0]=line.at;
    }
    level.walls=merged;
    level.openings=level.doors.map(d=>({at:[...d.at],w:d.w,axis:d.axis}));
    levels.push(level);
  }
  return {version:1,kind,hw,hd,serviceX,levels,lift};
}
export function validateInteriorPlan(b,plan) {
  if(!plan)return true;
  const fail=m=>{throw Error('Interior '+b.type+' / '+b.id+': '+m);};
  for(const l of plan.levels)if(l) {
    for(const r of l.rooms){const a=r.bounds;if(!a.every(Number.isFinite)||a[2]<=a[0]||a[3]<=a[1])fail('invalid room');
      if(a[0]<-plan.hw-.01||a[2]>plan.hw+.01||a[1]<-plan.hd-.01||a[3]>plan.hd+.01)fail('room outside shell');}
    for(let i=0;i<l.rooms.length;i++)for(let j=i+1;j<l.rooms.length;j++){
      const a=l.rooms[i].bounds,c=l.rooms[j].bounds;
      if(Math.min(a[2],c[2])-Math.max(a[0],c[0])>.01&&Math.min(a[3],c[3])-Math.max(a[1],c[1])>.01)fail('overlapping rooms');}
    for(const d of l.doors)if(d.w<.9)fail('inaccessible door');
  }
  return true;
}
