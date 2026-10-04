import { ACTIVITY_RETENTION } from './activity-window.js';
// Dormant obstacles remain in the authoritative registry: bullets/blasts can destroy unloaded objects.
// Only the Rapier shapes near live actors are paged in/out. Never mutate an obstacle-query callback.
export class ColliderBudget {
  constructor(arena,rapier,meshFactory){this.a=arena;this.R=rapier;this.meshFactory=meshFactory;this.enabled=!!arena.map.tiled;this.active=new Set();this.terrain=new Map();this.focus=[];this.forcing=false;this.clock=1;this.time=0;this.lastActive=new Map();this.terrainSeen=new Map();}
  near(o){return this.focus.some(p=>Math.abs(o.x-p.x)<o.w/2+p.r&&Math.abs(o.z-p.z)<o.d/2+p.r&&o.y+o.h/2>p.y-44&&o.y-o.h/2<p.y+28);}
  defer(o){
    if(!this.enabled)return false;
    if(o.nocollide && o.part!=='glass'){this.a.colliders.set(o,null);return true;}
    // Door/vehicle poses are updated by their own systems. Keep their small box colliders resident.
    if(this.forcing||(o.doorId!==undefined&&!o.planned033)||o.vehicleId!==undefined||this.near(o)){this.active.add(o);this.lastActive.set(o,this.time);return false;}
    this.a.colliders.set(o,[]);return true;
  }
  ensure(o){if(!this.enabled)return;const old=this.a.colliders.get(o);if(old===null)return;if(old&&(!Array.isArray(old)||old.length))return;
    this.forcing=true;try{this.a.addCollider(o);}finally{this.forcing=false;}
  }
  update(dt=0){
    if(!this.enabled)return;this.clock+=dt;this.time+=Math.max(0,Number.isFinite(dt)?dt:0);
    const players=this.a.players.filter(p=>p.hp>0&&!p.inBus);
    const unmanned=(this.a.vehicles?.movingVehicles?.()||this.a.vehicles?.list||[]).filter(v=>v.hp>0&&!v.crushed&&!v.driver&&(v.airborne||Math.abs(v.speed)>.2));
    const actors=[...players.map(p=>({x:p.x,y:p.y,z:p.z,r:p.vehicle?82:52})),...unmanned.map(v=>({x:v.x,y:v.y,z:v.z,r:82}))];
    const jumped=actors.some(p=>!this.focus.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<28&&Math.abs(p.y-q.y)<20));
    if(this.clock<.15&&!jumped)return;this.clock=0;
    this.focus=actors;
    const wanted=new Set();const grid=this.a.map.obstacles.grid;
    for(const p of this.focus)grid.query(p.x-p.r,p.z-p.r,p.x+p.r,p.z+p.r,o=>{if(this.near(o))wanted.add(o);});
    for(const o of wanted)if(this.a.colliders.has(o)){this.ensure(o);this.lastActive.set(o,this.time);}
    for(const o of this.active){
      if(!this.a.colliders.has(o)){this.active.delete(o);this.lastActive.delete(o);continue;}
      if((o.doorId!==undefined&&!o.planned033)||o.vehicleId!==undefined||wanted.has(o)||this.time-(this.lastActive.get(o)??-Infinity)<=ACTIVITY_RETENTION)continue;
      const cs=this.a.colliders.get(o);for(const c of Array.isArray(cs)?cs:cs?[cs]:[])this.a.world.removeCollider(c,false);
      this.a.colliders.set(o,[]);this.active.delete(o);this.lastActive.delete(o);this.a.physicsDirty=true;
    }
    this.updateTerrain();
  }
  updateTerrain(){
    const map=this.a.map,span=64,wanted=new Map();
    for(const p of this.focus){const x0=Math.max(-map.limit.x,Math.floor((p.x-p.r+map.limit.x)/span)*span-map.limit.x),z0=Math.max(-map.limit.z,Math.floor((p.z-p.r+map.limit.z)/span)*span-map.limit.z);
      for(let z=z0;z<Math.min(map.limit.z,p.z+p.r);z+=span)for(let x=x0;x<Math.min(map.limit.x,p.x+p.r);x+=span){const key=x+':'+z;wanted.set(key,{x0:x,z0:z,x1:Math.min(map.limit.x,x+span),z1:Math.min(map.limit.z,z+span)});}
    }
    for(const key of wanted.keys())this.terrainSeen.set(key,this.time);
    for(const [key,b] of wanted)if(!this.terrain.has(key)){const data=this.meshFactory(map,b);const c=this.a.world.createCollider(this.R.ColliderDesc.trimesh(data.vertices,data.indices,this.R.TriMeshFlags.FIX_INTERNAL_EDGES));this.terrain.set(key,c);this.a.physicsDirty=true;}
    for(const [key,c] of this.terrain)if(!wanted.has(key)&&this.time-(this.terrainSeen.get(key)??-Infinity)>ACTIVITY_RETENTION){this.a.world.removeCollider(c,false);this.terrain.delete(key);this.terrainSeen.delete(key);this.a.physicsDirty=true;}
    this.a.map.physicsStats031={registered:this.a.colliders.size,active:this.active.size,terrainChunks:this.terrain.size};
  }
  dispose(){this.active.clear();this.terrain.clear();this.lastActive.clear();this.terrainSeen.clear();this.focus=[];}
}
