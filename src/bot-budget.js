// AI decision frequency, NOT a switch that freezes other people/physics when the local camera turns.
// All authoritative movement, zone damage, projectiles, respawns and timers still advance in Arena.
const GRACE = 5, NEAR = 110, VIEW = 560;
export class BotDecisionBudget {
  constructor() { this.clock=0; this.records=new Map(); this.humans=[]; this.stats={near:0,far:0,decisions:0,reused:0}; }
  update(arena,dt) {
    if (dt>0 && Number.isFinite(dt)) this.clock += dt;
    this.humans=arena.players.filter(p=>!p.bot && p.hp>0);
    const ids=new Set(arena.players.map(p=>p.id)); for(const id of this.records.keys())if(!ids.has(id))this.records.delete(id);
    this.stats.near=this.stats.far=0;
  }
  observed(p,arena) {
    if (arena.mode==='duel'||p.inBus||p.vehicle||p.lift||p.escalator||p.dropping||!p.grounded||p.using||p.healing||p.frozen>0||p.push||p.brain?.memory>0) return true;
    for (const human of this.humans) {
      const dx=p.x-human.x,dz=p.z-human.z,d=Math.hypot(dx,dz);
      if (d<NEAR) return true; // collision/audio/reaction ring behind the observer too
      const yaw=human.input?.angle??human.angle??0;
      if (d<VIEW && (dx*Math.sin(yaw)+dz*Math.cos(yaw))/Math.max(d,.01)>.2) return true;
    }
    // Preserve fights between bots and all nearby in-flight damage, even when no human watches.
    if (arena.players.some(q=>q!==p && q.hp>0 && q.team!==p.team && Math.hypot(q.x-p.x,q.z-p.z)<45)) return true;
    const danger=[arena.projectiles,arena.vehicles?.rounds,arena.bosses?.shots,arena.bosses?.hazards];
    for(const list of danger)for(const q of list||[])if(Math.hypot(q.x-p.x,q.z-p.z)<Math.max(65,q.r||0))return true;
    return false;
  }
  input(arena,p,dt) {
    let r=this.records.get(p.id);
    if(!r){r={lastSeen:this.clock,next:0,elapsed:0,input:null};this.records.set(p.id,r);}
    r.elapsed+=Math.max(0,dt||0);
    if(this.observed(p,arena))r.lastSeen=this.clock;
    const hot=this.clock-r.lastSeen<=GRACE;
    this.stats[hot?'near':'far']++;
    if(hot&&!r.hot)r.next=this.clock;
    r.hot=hot;
    const interval=hot?Math.max(dt||1/60,(arena.botEvery||1)/60):.5;
    if(r.input&&this.clock+1e-9<r.next){this.stats.reused++;return r.input;}
    // The original decision receives elapsed simulation time so cooldown/memory do not slow down.
    r.input=arena.botInput(p,Math.min(.55,Math.max(dt||1/60,r.elapsed)));r.elapsed=0;r.next=this.clock+interval;
    this.stats.decisions++;return r.input;
  }
  dispose(){this.records.clear();this.humans=[];}
}
// Boss attacks already in progress must finish even if the observer turns away.
export function bossShouldThink(arena,b) {
  if(!arena.map?.tiled||b.hp<=0)return true;
  const now=arena.botBudget037?.clock??arena.tick/60;
  let watched=!!b.aggro||!!b.act||b.frozen>0||b.confused>0;
  for(const p of arena.players)if(p.hp>0){
    const dx=b.x-p.x,dz=b.z-p.z,d=Math.hypot(dx,dz);
    if(d<120||(!p.bot&&d<560&&(dx*Math.sin(p.input?.angle??p.angle??0)+dz*Math.cos(p.input?.angle??p.angle??0))/Math.max(.01,d)>.2)){watched=true;break;}
  }
  if(!watched)for(const list of [arena.projectiles,arena.vehicles?.rounds])for(const q of list||[])if(Math.hypot(q.x-b.x,q.z-b.z)<65){watched=true;break;}
  if(b._lastAwake037===undefined||watched)b._lastAwake037=now;
  return now-b._lastAwake037<=GRACE;
}
