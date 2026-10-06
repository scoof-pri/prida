// Fictional FPV gameplay only. Server owns the drone, battery, collision, range and detonation.
import RAPIER from '@dimforge/rapier3d-compat';
import { direction } from './combat.js';
import { groundHeight } from './terrain.js';
import { castMap } from './raycast.js';
import { addObstacle, removeObstacle } from './destruction.js';
import { fpvSlot, consumeFPV } from './fpv-inventory.js';
export const DRONE_RULES=Object.freeze({battery:45,range:260,hp:30,speed:27,climb:10,radius:.24,damage:240,blast:5.6,cap:10});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const yawTurn=(a,b,dt)=>a+clamp(Math.atan2(Math.sin(b-a),Math.cos(b-a)),-4*dt,4*dt);
export function droneObstacle(d){return {x:d.x,y:d.y,z:d.z,w:.64,h:.36,d:.64,droneId:d.id,part:'drone',hp:d.hp,color:0x617988};}
export class DroneSystem {
  constructor(a){this.a=a;this.list=[];this.byId=new Map();this.next=0;this.clock=0;this.held=new Map();this.cooldowns=new Map();this.shape=new RAPIER.Ball(DRONE_RULES.radius);}
  get(id){return this.byId.get(id)||null;}
  notice(p,text){this.a.events.push({type:'tech-note',id:p.id,text});}
  launch(p,{selectedOnly=false}={}){
    if(!p||p.bot||p.hp<=0||p.vehicle||p.inBus||p.frozen>0||p.suitFlight||p.droneId||!p.grounded||p.dropping)return false;
    const slot=fpvSlot(p,selectedOnly);
    if(slot<0){this.notice(p,'EQUIP AN FPV ITEM FROM A MILITARY BASE OR NOVA');return false;}
    if(this.list.length>=DRONE_RULES.cap||this.clock<(this.cooldowns.get(p.id)||0))return false;
    const f=direction(p.angle),origin={x:p.x,y:p.y+1.3,z:p.z};
    if(castMap(origin,f,1.25,this.a.map,null,true).distance<1.20){this.notice(p,'LAUNCH SPACE BLOCKED');return false;}
    if(!consumeFPV(p,slot))return false;
    const d={id:'fpv-'+(++this.next),owner:p.id,x:origin.x+f.x*1.15,y:origin.y,z:origin.z+f.z*1.15,
      angle:p.angle,pitch:0,roll:0,vx:0,vy:0,vz:0,battery:DRONE_RULES.battery,signal:1,hp:DRONE_RULES.hp,age:0,fireSafe:true};
    d.obstacle=droneObstacle(d);this.a.addObs(d.obstacle);this.a.colliderBudget?.ensure(d.obstacle);
    this.list.push(d);this.byId.set(d.id,d);this.a.syncHeld(p);p.droneId=d.id;p.healing=0;p.using=null;p.emote=0;p.fireHeld=true;p.useArmed=false;
    this.a.events.push({type:'drone-launch',id:p.id,drone:d.id,x:d.x,y:d.y,z:d.z});this.cooldowns.set(p.id,this.clock+1);return true;
  }
  release(d,explode=false,owner=null){
    if(!d||!this.byId.has(d.id))return false;
    this.byId.delete(d.id);this.list.splice(this.list.indexOf(d),1);this.a.removeObs(d.obstacle);
    const p=this.a.players.find(p=>p.id===d.owner);if(p?.droneId===d.id){p.droneId=null;p.fireHeld=true;p.useArmed=false;}
    // Remove the drone before a blast can recurse into the hit that destroyed it.
    if(explode)this.a.blast(d.x,d.y,d.z,DRONE_RULES.blast,DRONE_RULES.damage,owner||p||{id:d.owner});
    this.a.events.push({type:'drone-end',id:d.owner,drone:d.id,x:d.x,y:d.y,z:d.z,exploded:explode});return true;
  }
  cancel(p){return this.release(this.get(p?.droneId),false);}
  damage(id,amount,owner){const d=this.get(id);if(!d||!Number.isFinite(amount)||amount<=0)return;
    d.hp-=amount;d.obstacle.hp=d.hp;if(d.hp<=0)this.release(d,true,owner);}
  step(dt){
    dt=clamp(dt,0,.05);this.clock+=dt;
    for(const p of this.a.players){const down=p.inputAge<=.3&&p.input?.droneToggle===true;
      if(down&&!this.held.get(p.id)){if(p.droneId){this.cancel(p);this.notice(p,'FPV LINK ENDED');}else this.launch(p);}
      this.held.set(p.id,down);
    }
    for(const d of [...this.list]){
      const p=this.a.players.find(p=>p.id===d.owner);
      if(!p||p.hp<=0||p.vehicle||p.inBus||p.droneId!==d.id){this.release(d,false);continue;}
      const age=Number.isFinite(p.inputAge)?p.inputAge:Infinity;
      if(age>1.2){this.release(d,false);continue;}
      const i=age<=.3&&!(p.frozen>0)?p.input:{};
      d.age+=dt;d.battery=Math.max(0,d.battery-dt);
      const dist=Math.hypot(d.x-p.x,d.y-(p.y+1),d.z-p.z);d.signal=clamp(1-dist/DRONE_RULES.range,0,1);
      if(d.battery<=0||dist>DRONE_RULES.range||Math.abs(d.x)>this.a.map.limit.x-1||Math.abs(d.z)>this.a.map.limit.z-1){this.release(d,false);continue;}
      if(!i.fire)d.fireSafe=false;
      if(i.fire&&!d.fireSafe&&d.age>.6){this.release(d,true);continue;}
      d.angle=yawTurn(d.angle,Number.isFinite(i.angle)?i.angle:d.angle,dt);d.pitch=clamp(i.pitch,-1.2,1.2);
      const k=1-Math.exp(-5.5*dt),boost=i.sprint?1.2:1;
      // Horizontal input is already camera-relative and normalized by Arena.input.
      d.vx+=(clamp(i.x,-1,1)*DRONE_RULES.speed*boost-d.vx)*k;
      d.vz+=(clamp(i.z,-1,1)*DRONE_RULES.speed*boost-d.vz)*k;
      d.vy+=(clamp(i.ascend,-1,1)*DRONE_RULES.climb-d.vy)*k;
      d.roll=clamp((d.vx*Math.cos(d.angle)-d.vz*Math.sin(d.angle))*.015,-.35,.35);
      const delta={x:d.vx*dt,y:d.vy*dt,z:d.vz*dt},len=Math.hypot(delta.x,delta.y,delta.z);
      if(len>1e-7){
        const own=this.a.colliders.get(d.obstacle),body=this.a.bodies.get(p.id)?.body;
        const hit=this.a.world.castShape(d,{x:0,y:0,z:0,w:1},delta,this.shape,0,1,true,undefined,undefined,
          own&&!Array.isArray(own)?own:undefined,body);
        const dir={x:delta.x/len,y:delta.y/len,z:delta.z/len},mapHit=castMap(d,dir,len+DRONE_RULES.radius,this.a.map,d.obstacle,true);
        let t=hit?clamp(hit.time_of_impact,0,1):1;
        if(mapHit.distance<len+DRONE_RULES.radius)t=Math.min(t,Math.max(0,(mapHit.distance-DRONE_RULES.radius)/len));
        if(d.y+delta.y<=groundHeight(d.x+delta.x,d.z+delta.z,this.a.map)+DRONE_RULES.radius)t=0;
        if(t<1){for(const axis of ['x','y','z'])d[axis]+=delta[axis]*Math.max(0,t-.01);this.release(d,d.age>.6);continue;}
        this.a.map.obstacles.grid?.remove(d.obstacle);this.a.map.obstacles.lowGrid?.remove(d.obstacle);
        for(const axis of ['x','y','z']){d[axis]+=delta[axis];d.obstacle[axis]=d[axis];}
        this.a.map.obstacles.grid?.add(d.obstacle);this.a.map.obstacles.lowGrid?.add(d.obstacle);
        if(own&&!Array.isArray(own)){own.setTranslation(d);this.a.physicsDirty=true;}
      }
    }
    for(const id of this.held.keys())if(!this.a.players.some(p=>p.id===id)){this.held.delete(id);this.cooldowns.delete(id);}
  }
  snapshot(){return this.list.map(({obstacle,fireSafe,...d})=>({...d}));}
  reset(){for(const d of [...this.list])this.release(d,false);this.held.clear();this.cooldowns.clear();}
  dispose(){this.reset();}
}
export function syncDrones(map,list=[]){
  const cache=map._droneObjects040??=new Map(),seen=new Set();
  for(const d of list){if(!d||typeof d.id!=='string'||d.hp<=0)continue;seen.add(d.id);const old=cache.get(d.id);
    if(old){map.obstacles.grid?.remove(old);Object.assign(old,droneObstacle(d));map.obstacles.grid?.add(old);}
    else{const o=droneObstacle(d);addObstacle(map,o);cache.set(d.id,o);}}
  for(const [id,o]of cache)if(!seen.has(id)){removeObstacle(map,o);cache.delete(id);}
}
