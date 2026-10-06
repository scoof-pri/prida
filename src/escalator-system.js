// PRIDA 0.34: conveyor transport is applied through the existing character controller, never a teleport.
// Only one static collision ribbon per escalator; visual steps do not create dozens of moving bodies.
export function escalatorCarry(e,p,dt,input={}) {
  if(e.disabled||e.gone||!(dt>0)||p.hp<=0||p.vehicle||p.inBus||p.lift||input.jump||p.vy>1||p.cheats?.flight)return null;
  const dx=e.to.x-e.from.x,dz=e.to.z-e.from.z,run=Math.hypot(dx,dz),rise=e.to.y-e.from.y;
  if(run<.1)return null;
  const ux=dx/run,uz=dz/run,px=p.x-e.from.x,pz=p.z-e.from.z,t=(px*ux+pz*uz)/run,side=Math.abs(px*uz-pz*ux);
  if(t<-.045||t>1.045||side>e.width/2-.10)return null;
  const at=e.from.y+Math.max(0,Math.min(1,t))*rise;
  if(p.y<at-.10||p.y>at+.24)return null;
  const d=e.direction===-1?-1:1,scale=e.speed*Math.min(.05,dt)/Math.hypot(run,rise);
  return {x:dx*scale*d,y:rise*scale*d,z:dz*scale*d,id:e.id};
}
export class EscalatorSystem {
  constructor(arena){this.a=arena;this.clock=0;this.signature='';this.revision=0;this.rows=arena.map.escalators||[];this.byId=new Map(this.rows.map(e=>[e.id,e]));}
  step(dt){
    if(!(dt>0))return;this.clock+=dt;
    const a=this.a,ds=a.destruction,signature=[ds.panels.length,ds.props.length,ds.buildings.length,JSON.stringify(ds.storeys)].join(':');
    if(signature===this.signature)return;this.signature=signature;
    const gone=new Set(ds.panels);
    for(const e of this.rows){
      const b=a.map.buildings[e.building],rampGone=!a.colliders.has(e.ramp),motorGone=!a.colliders.has(e.motor);
      const removed=!b||b.collapsed||(b.fallenFrom??Infinity)<=e.storey||rampGone;
      const disabled=removed||motorGone||(e.floorPanels.length>0&&e.floorPanels.every(p=>gone.has(p)));
      if(e.disabled!==disabled||e.gone!==removed){e.disabled=disabled;e.gone=removed;e.stoppedAt=this.clock;this.revision++;}
    }
  }
  carry(p,i,dt){
    p.escalator=null;
    for(const e of this.rows){if(Math.abs(e.x-p.x)>12||Math.abs(e.z-p.z)>2)continue;const move=escalatorCarry(e,p,dt,i);if(move){p.escalator=e.id;return move;}}
    return {x:0,y:0,z:0,id:null};
  }
  snapshot(){return {clock:Math.round(this.clock*100)/100,revision:this.revision,states:this.rows.filter(e=>e.disabled||e.gone).map(e=>[e.id,e.disabled?1:0,e.gone?1:0,Math.round(e.stoppedAt*100)/100])};}
}
export function syncEscalators(map,state){
  if(!state||!Array.isArray(state.states))return;
  map.escalatorClock034=Number.isFinite(state.clock)?state.clock:0;
  for(const e of map.escalators||[])e.clock034=map.escalatorClock034;
  if(map._escalatorRevision034===state.revision)return;map._escalatorRevision034=state.revision;
  const rows=new Map(state.states.map(s=>[s[0],s]));
  for(const e of map.escalators||[]){const r=rows.get(e.id);e.disabled=!!r?.[1];e.gone=!!r?.[2];e.stoppedAt=r?.[3]||0;}
}
