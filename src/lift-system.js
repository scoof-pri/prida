// Server-owned lifts. Fixed collider poses are moved explicitly and riders are carried in the same tick.
// The client cannot submit a position, speed or an arbitrary remote lift id.
import { addObstacle, removeObstacle } from './destruction.js';
const STEP=.70, SPEED=1.8, DWELL=2.0, MAX_FLOORS=32;
const phases=new Set(['idle','closing','moving','opening','dwell','broken']);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:a));
export function inLift(l,p,margin=.12) {
  return !!p&&p.hp>0&&!p.vehicle&&!p.inBus&&Math.abs(p.x-l.x)<l.w/2-margin&&Math.abs(p.z-l.z)<l.d/2-margin&&
    p.y>=l.y-.16&&p.y<l.y+2.24;
}
export function nearLift(map,p) {
  if(!p||p.hp<=0||p.vehicle||p.inBus)return null;
  for(const l of map.lifts||[]) {
    if(l.broken)continue;
    if(inLift(l,p))return {lift:l,floor:l.floor,inside:true};
    if(Math.abs(p.z-l.z)>l.d/2+.65||p.x<l.x-l.w/2-1.75||p.x>l.x-l.w/2+.15)continue;
    const k=l.stops.findIndex(y=>Math.abs(p.y-y)<.28);
    if(k>=0)return {lift:l,floor:k,inside:false};
  }return null;
}
export function liftPoses(l) {
  const out=[],w=l.w-.16,d=l.d-.16;
  const box=(key,x,y,z,ww,h,dd,kind='cab')=>out.push({key,x,y,z,w:ww,h,d:dd,kind});
  box('floor',l.x,l.y-.075,l.z,w,.15,d);
  box('roof',l.x,l.y+2.43,l.z,w,.12,d);
  box('back',l.x+w/2-.045,l.y+1.18,l.z,.09,2.36,d);
  for(const s of [-1,1])box('side'+s,l.x,l.y+1.18,l.z+s*(d/2-.045),w,2.36,.09);
  for(let k=0;k<l.stops.length;k++) {
    const open=k===l.floor&&Math.abs(l.y-l.stops[k])<.012 ? l.open : 0;
    for(const s of [-1,1])box('gate'+k+':'+s,l.x-l.w/2-.03,l.stops[k]+1.19,
      l.z+s*(l.doorWidth/4+open*l.doorWidth/2),.10,2.36,l.doorWidth/2,'gate');
    box('sill'+k,l.x-l.w/2-.06,l.stops[k]-.055,l.z,.34,.11,l.doorWidth+.10,'sill');
  }
  return out;
}
function register(map,l,a=null) {
  l.parts=[];
  if(l.broken)return;
  for(const pose of liftPoses(l)) {
    const o={...pose,liftId:l.id,building:l.building,part:'lift',storey:0,hp:l.hp,color:0xa3adad};
    addObstacle(map,o);if(a)a.addCollider(o);l.parts.push(o);
  }
}
function update(map,l,a=null) {
  const poses=liftPoses(l);if(!l.parts?.length){register(map,l,a);return;}
  for(let i=0;i<poses.length;i++) {
    const o=l.parts[i],p=poses[i];if(!o)continue;
    if(Math.abs(o.x-p.x)+Math.abs(o.y-p.y)+Math.abs(o.z-p.z)<1e-7)continue;
    map.obstacles.grid?.remove(o);map.obstacles.lowGrid?.remove(o);
    Object.assign(o,p);map.obstacles.grid?.add(o);if(o.y-o.h/2<1.8)map.obstacles.lowGrid?.add(o);
    map.obstacleVersion=(map.obstacleVersion||0)+1;
    const c=a?.colliders.get(o);if(c&&!Array.isArray(c)){c.setTranslation({x:o.x,y:o.y,z:o.z});a.physicsDirty=true;}
  }
}
function clear(map,l,a=null) {
  for(const o of l.parts||[]) {if(a?.colliders.has(o))a.removeObs(o);else removeObstacle(map,o);}
  l.parts=[];
}
function thresholdOccupied(l,players) {
  const front=l.x-l.w/2-.03;
  return players.some(p=>p.hp>0&&!p.vehicle&&!p.inBus&&Math.abs(p.x-front)<.49&&Math.abs(p.z-l.z)<l.doorWidth/2+.30&&
    p.y+1.68>l.y+.04&&p.y<l.y+2.34);
}
export class LiftSystem {
  constructor(a){this.a=a;this.list=a.map.lifts||[];this.clock=0;this.revision=0;this.useTimers=new Map();
    for(const l of this.list){Object.assign(l,{floor:0,target:0,y:l.stops[0],open:1,phase:'idle',broken:false,hp:400,queue:[],wait:0,changed:false});register(a.map,l,a);}}
  use(p,requested=null) {
    const near=nearLift(this.a.map,p);if(!near)return false;
    const l=near.lift;
    if(this.clock<(this.useTimers.get(p.id)||0))return true;
    this.useTimers.set(p.id,this.clock+.35);
    if(requested!==null&&requested!==undefined&&!Number.isInteger(requested))return true;
    const hasRequest=Number.isInteger(requested);
    if(hasRequest&&(!near.inside||requested<0||requested>=l.stops.length))return true;
    const dest=hasRequest?requested:near.inside?(l.floor+1)%l.stops.length:near.floor;
    if(dest===l.floor&&(l.phase==='idle'||l.phase==='dwell')){l.wait=DWELL;return true;}
    if(!l.queue.includes(dest)&&dest!==l.target)l.queue.push(dest);
    if(l.phase==='idle'||l.phase==='dwell'){l.queue=l.queue.filter(n=>n!==dest);l.target=dest;l.phase='closing';l.wait=0;l.changed=true;}
    this.revision++;return true;
  }
  break(l) {
    if(!l||l.broken)return;
    l.broken=true;l.phase='broken';l.queue=[];l.hp=0;l.changed=true;clear(this.a.map,l,this.a);this.revision++;
    for(const p of this.a.players)if(p.lift===l.id){p.lift=null;p.grounded=false;p.vy=Math.min(0,p.vy||0);}
    this.a.events.push({type:'lift-broken',lift:l.id,x:l.x,y:l.y,z:l.z});
  }
  damage(id,n) {const l=this.list.find(l=>l.id===id);if(!l||l.broken||!Number.isFinite(n)||n<=0)return;l.hp-=n;l.changed=true;this.revision++;if(l.hp<=0)this.break(l);}
  step(dt) {
    if(!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.1);this.clock+=dt;
    const a=this.a,gone=new Set(a.destruction.panels||[]);
    for(const p of a.players)p.lift=null;
    for(const l of this.list) {
      if(l.broken)continue;
      const b=a.map.buildings[l.building];
      if(!b||b.collapsed||b.fallenFrom!==undefined||l.panels.some(p=>gone.has(p))){this.break(l);continue;}
      const riders=a.players.filter(p=>inLift(l,p,.25));for(const p of riders)p.lift=l.id;
      const oldY=l.y,oldOpen=l.open,oldPhase=l.phase;
      if(l.phase==='idle')continue;
      if(l.phase==='dwell') {
        l.wait=Math.max(0,l.wait-dt);
        if(l.wait===0&&l.queue.length){l.target=l.queue.shift();l.phase='closing';}
        else if(l.wait===0)l.phase='idle';
      } else if(l.phase==='closing') {
        if(thresholdOccupied(l,a.players)){l.open=Math.min(1,l.open+dt/STEP);l.wait=DWELL;}
        else {l.open=Math.max(0,l.open-dt/STEP);if(l.open===0)l.phase='moving';}
      } else if(l.phase==='moving') {
        const target=l.stops[l.target],delta=clamp(target-l.y,-SPEED*dt,SPEED*dt);l.y+=delta;
        // Carry before the player controller solves its own walk/jump. The body and snapshot remain in sync.
        for(const p of riders)if(p.y-oldY<.22&&(p.vy||0)<=.1) {
          p.y+=delta;p.vy=0;p.grounded=true;
          const r=a.bodies.get(p.id);if(r){r.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);r.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});}
        }
        if(Math.abs(l.y-target)<1e-6){l.y=target;l.floor=l.target;l.phase='opening';a.events.push({type:'lift-arrived',lift:l.id,floor:l.floor,x:l.x,y:l.y,z:l.z});}
      } else if(l.phase==='opening') {l.open=Math.min(1,l.open+dt/STEP);if(l.open===1){l.phase='dwell';l.wait=DWELL;}}
      if(oldY!==l.y||oldOpen!==l.open||oldPhase!==l.phase){l.changed=true;this.revision++;update(a.map,l,a);}
    }
    if(this.useTimers.size>100)for(const [key,until]of this.useTimers)if(until<this.clock-2)this.useTimers.delete(key);
  }
  snapshot(){return {revision:this.revision,states:this.list.filter(l=>l.changed).map(l=>[l.id,+l.y.toFixed(3),l.floor,l.target,+l.open.toFixed(3),l.phase,Math.max(0,l.hp)])};}
  dispose(){for(const l of this.list)clear(this.a.map,l,this.a);this.list=[];this.useTimers.clear();}
}
export function syncLifts(map,state) {
  if(!state||!Number.isInteger(state.revision)||!Array.isArray(state.states)||state.revision<(map.liftRevision??-1))return false;
  if(state.revision===map.liftRevision)return false;
  map.liftRevision=state.revision;
  const rows=new Map(state.states.filter(v=>Array.isArray(v)&&typeof v[0]==='string').map(v=>[v[0],v]));
  for(const l of map.lifts||[]) {
    const row=rows.get(l.id),max=l.stops.length-1;
    if(l.stops.length>MAX_FLOORS)continue;
    const y=row?clamp(row[1],l.stops[0],l.stops[max]):l.stops[0];
    Object.assign(l,{y,floor:row?Math.round(clamp(row[2],0,max)):0,target:row?Math.round(clamp(row[3],0,max)):0,
      open:row?clamp(row[4],0,1):1,phase:row&&phases.has(row[5])?row[5]:'idle',hp:row?clamp(row[6],0,400):400});
    l.broken=l.phase==='broken'||l.hp<=0;
    if(l.broken)clear(map,l);else update(map,l);
  }return true;
}
