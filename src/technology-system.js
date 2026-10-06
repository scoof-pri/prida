// NOVA technology. All inventory, upgrades, suit energy and bomb damage live on the authority.
import { makeGear } from './items.js';
import { direction } from './combat.js';
import { castMap } from './raycast.js';
import { groundHeight } from './terrain.js';
export const SUIT_RULES=Object.freeze({energy:100,flightDrain:13,boostDrain:23,recharge:18,speed:22,boostSpeed:33,climb:12,shotCost:4,shotDamage:24,shotCd:.18,beamCost:38,beamCharge:.8,beamCd:3});
export const BOMB_RULES=Object.freeze({ammo:3,damage:420,radius:8,cooldown:1.3,life:18,cap:12});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const quant=n=>Math.round(n*100)/100;
export function suitMovement(p,i,dt){
  if(!p.suitFlight||p.gear?.id!=='aegis'||p.vehicle||p.droneId||p.hp<=0)return null;
  const speed=i.sprint?SUIT_RULES.boostSpeed:SUIT_RULES.speed,f=direction(p.angle,p.pitch);
  const auto=i.sprint&&Math.hypot(i.x||0,i.z||0)<.05;
  const inputLength=Math.max(1,Math.hypot(i.x||0,i.z||0));
  const wantX=auto?f.x*speed:clamp(i.x,-1,1)/inputLength*speed,wantZ=auto?f.z*speed:clamp(i.z,-1,1)/inputLength*speed;
  const k=1-Math.exp(-5*dt);
  p.suitVX=(p.suitVX||0)+(wantX-(p.suitVX||0))*k;p.suitVZ=(p.suitVZ||0)+(wantZ-(p.suitVZ||0))*k;
  const moving=Math.hypot(i.x||0,i.z||0)>.05;
  const forward=(i.x||0)*Math.sin(p.angle||0)+(i.z||0)*Math.cos(p.angle||0);
  const descending=i.suitThrust===true&&(i.ascend||0)<=0;
  const vertical=descending?-SUIT_RULES.climb:auto?f.y*speed:moving?Math.sin(p.pitch||0)*speed*clamp(forward,-1,1):SUIT_RULES.climb;
  // Arena applied ordinary gravity immediately before this flight adapter.
  const prior=(p.vy||0)+22*dt;p.vy=prior+(vertical-prior)*(1-Math.exp(-7*dt));
  if(p.grounded&&i.ascend>0)p.vy=Math.max(5,p.vy);
  p.thrusting=true;p.gliding=p.dropping=p.launched=false;p.wingsOpen=false;
  return {x:p.suitVX,z:p.suitVZ};
}
export class TechnologySystem {
  constructor(a){this.a=a;this.clock=0;this.items=(a.map.labItems||[]).map(i=>({...i,available:true}));this.mem=new Map();this.bombs=[];this.nextBomb=0;this.vehicleHeld=new Map();this.baseStands=new Map((a.map.obstacles||[]).filter(o=>o.droneStand041).map(o=>[o.droneStand041,o]));}
  state(p){let s=this.mem.get(p.id);if(!s){s={toggle:false,cooldown:0,beam:0,beamCooldown:0,beamHeld:false};this.mem.set(p.id,s);}return s;}
  notice(p,text){this.a.events.push({type:'tech-note',id:p.id,text});}
  pickup(p){
    if(!p||p.hp<=0||p.vehicle||p.droneId||p.inBus||p.frozen>0)return false;
    let best=null,nearest=2.7;
    for(const item of this.items){if(!item.available)continue;
      const len=Math.hypot(item.x-p.x,item.y-(p.y+1),item.z-p.z);if(len>=nearest)continue;
      const dir={x:item.x-p.x,y:item.y-(p.y+1.55),z:item.z-p.z},range=Math.hypot(dir.x,dir.y,dir.z)||1;
      for(const k of ['x','y','z'])dir[k]/=range;
      const facing=(Math.sin(p.angle||0)*dir.x+Math.cos(p.angle||0)*dir.z);
      if(facing<.2&&len>1)continue;
      const hit=castMap({x:p.x,y:p.y+1.55,z:p.z},dir,range,this.a.map,null,true);
      if(hit.distance<range-.25)continue;
      best=item;nearest=len;
    }
    if(!best)return false;
    if(best.kind==='fpv'){
      if((p.fpvCharges||0)>=5){this.notice(p,'DRONE INVENTORY FULL (5)');return true;}p.fpvCharges=(p.fpvCharges||0)+1;
    }else if(best.kind==='aegis'){
      if(p.gear?.id==='aegis'){this.notice(p,'AEGIS ALREADY EQUIPPED');return true;}
      if(p.gear){ // Keep the previous equipment as normal world loot instead of silently deleting it.
        const dropped=this.a.dropLoot(p.x,p.z,{gear:p.gear.id},p.id);dropped.y=p.y;
      }
      p.gear=makeGear('aegis');p.suitFlight=false;p.suitVX=p.suitVZ=0;
    }else{
      p.techModules??=[];if(p.techModules.includes(best.kind)){this.notice(p,'MODULE ALREADY CARRIED');return true;}
      p.techModules.push(best.kind);
    }
    best.available=false;this.notice(p,best.label+' ACQUIRED');this.a.events.push({type:'tech-pickup',id:p.id,item:best.id,x:best.x,y:best.y,z:best.z});return true;
  }
  install(p,v){
    if(!v||p.vehicle!==v.id||v.driver!==p.id||v.hp<=0||Math.abs(v.speed)>.6||v.airborne){this.notice(p,'STOP THE VEHICLE TO INSTALL');return false;}
    const fits=k=>v.kind==='tank'?(k==='ram'||k==='turbo'):v.kind==='plane'&&k==='bomb';
    v.mods??={};const choice=p.techModules?.find(k=>fits(k)&&!v.mods[k]);
    if(!choice){this.notice(p,'NO COMPATIBLE MODULE CARRIED');return false;}
    v.mods[choice]=true;p.techModules.splice(p.techModules.indexOf(choice),1);
    if(choice==='bomb')v.bombs=BOMB_RULES.ammo;if(choice==='turbo')v.boostEnergy=100;
    v._changed=true;this.notice(p,choice.toUpperCase()+' INSTALLED');return true;
  }
  vehicleInput(v,p,ctrl,dt){
    const i=p&&p.inputAge<=.3&&p.frozen<=0?p.input:{};
    const prev=this.vehicleHeld.get(v.id)||{};
    if(i.techUse&&!prev.install&&p)this.install(p,v);
    if(i.bomb&&!prev.bomb&&p)this.dropBomb(p,v);
    this.vehicleHeld.set(v.id,{install:!!i.techUse,bomb:!!i.bomb});
    v.bombCd=Math.max(0,(v.bombCd||0)-dt);
    v.boosting=false;
    if(v.kind!=='tank'||!v.mods?.turbo)return;
    v.boostEnergy=clamp(v.boostEnergy??100,0,100);
    if(p&&i.vehicleBoost&&!ctrl.brake&&ctrl.throttle>.1&&v.fuel>0&&v.boostEnergy>0){
      v.boostEnergy=Math.max(0,v.boostEnergy-32*dt);v.boosting=true;v.fuel=Math.max(0,v.fuel-1.7*dt);v._changed=true;
    }else v.boostEnergy=Math.min(100,v.boostEnergy+16*dt);
  }
  boostMotion(v,m,dt){
    // Boost affects only commanded motion and still goes through the same swept collider/ram solver.
    if(v.boosting){const f=direction(v.angle);m.x+=f.x*9*dt;m.z+=f.z*9*dt;}
    return m;
  }
  service(v){if(v.mods?.bomb)v.bombs=BOMB_RULES.ammo;if(v.mods?.turbo)v.boostEnergy=100;v.bombCd=0;}
  dropBomb(p,v){
    if(v.kind!=='plane'||!v.mods?.bomb||!v.airborne||v.hp<=0||v.bombCd>0||!(v.bombs>0)||this.bombs.length>=BOMB_RULES.cap)return false;
    if(v.y-groundHeight(v.x,v.z,this.a.map)<7){this.notice(p,'CLIMB ABOVE 7 M TO RELEASE');return false;}
    const from={x:v.x,y:v.y-.35,z:v.z};
    // Never place ordnance on the other side of a floor or inside terrain.
    if(castMap({x:v.x,y:v.y+.3,z:v.z},{x:0,y:-1,z:0},.9,this.a.map,v.obstacle,true).distance<.85)return false;
    const f=direction(v.angle,v.pitch),b={id:'bomb-'+(++this.nextBomb),owner:p.id,vehicle:v.id,...from,vx:f.x*v.speed,vy:(v.vy||0)-1.5,vz:f.z*v.speed,life:BOMB_RULES.life};
    this.bombs.push(b);v.bombs--;v.bombCd=BOMB_RULES.cooldown;v._changed=true;
    this.a.events.push({type:'bomb-release',id:p.id,x:b.x,y:b.y,z:b.z});return true;
  }
  beam(p,s){
    if(p.gear.fuel<SUIT_RULES.beamCost||s.beamCooldown>0)return false;
    p.gear.fuel-=SUIT_RULES.beamCost;s.beamCooldown=SUIT_RULES.beamCd;
    this.shoot(p,true);return true;
  }
  shoot(p,beam=false){
    const f=direction(p.angle,p.pitch),from={x:p.x,y:p.y+1.38,z:p.z},range=beam?160:100;
    const ray=this.a.vehicles.ray(from,f,range,p,null),distance=ray.distance,to={x:from.x+f.x*distance,y:from.y+f.y*distance,z:from.z+f.z*distance};
    if(beam){if(distance<range)this.a.blast(to.x-f.x*.1,to.y-f.y*.1,to.z-f.z*.1,2.8,130,p);}
    else if(ray.victim)this.a.damage(p,ray.victim,SUIT_RULES.shotDamage);
    else if(ray.boss)this.a.bosses.damage(ray.boss,SUIT_RULES.shotDamage,p);
    else if(ray.obstacle)this.a.damageObstacle(ray.obstacle,32,p);
    this.a.events.push({type:'tech-shot',id:p.id,beam,from,to,x:from.x,y:from.y,z:from.z});
  }
  playerStep(p,i,dt){
    const s=this.state(p);s.cooldown=Math.max(0,s.cooldown-dt);s.beamCooldown=Math.max(0,s.beamCooldown-dt);
    const has=p.gear?.id==='aegis'&&p.hp>0&&!p.inBus&&!p.vehicle&&!p.droneId;
    if(!has||p.frozen>0){p.suitFlight=false;p.suitCharge=0;s.beam=0;s.toggle=!!i.suitToggle;return;}
    const energy=clamp(p.gear.fuel,0,100);p.gear.fuel=energy;
    const thrust=i.suitThrust===true||(i.ascend||0)>0,wasFlying=!!p.suitFlight;
    p.suitFlight=thrust && (wasFlying?energy>0:energy>10) && p.y<142;
    if(p.suitFlight&&!wasFlying){p.vy=Math.max(4,p.vy||0);p.grounded=false;p.dropping=p.gliding=p.launched=false;p.suitVX=p.suitVZ=0;}
    if(p.suitFlight){
      p.gear.fuel=Math.max(0,energy-(i.sprint?SUIT_RULES.boostDrain:SUIT_RULES.flightDrain)*dt);
      if(p.gear.fuel<=0){p.suitFlight=false;this.notice(p,'ENERGY EMPTY — RELEASE SPACE TO DESCEND');}
    }else {
      if(wasFlying){p.vy=Math.min(p.vy||0,1.5);p.gliding=false;p.dropping=false;p.launched=false;}
      if(p.grounded&&!i.fire&&!i.suitAlt)p.gear.fuel=Math.min(100,energy+SUIT_RULES.recharge*dt);
    }
    s.toggle=false; // Retired K toggle never activates flight, including forged online input.
    if(i.suitAlt&&s.beamCooldown<=0&&p.gear.fuel>=SUIT_RULES.beamCost){
      s.beam=Math.min(SUIT_RULES.beamCharge,s.beam+dt);
      if(s.beam>=SUIT_RULES.beamCharge&&!s.beamHeld){this.beam(p,s);s.beamHeld=true;s.beam=0;}
    }else s.beam=0;
    if(!i.suitAlt)s.beamHeld=false;
    if(i.fire&&!i.suitAlt&&s.cooldown<=0&&p.gear.fuel>=SUIT_RULES.shotCost){
      p.gear.fuel-=SUIT_RULES.shotCost;s.cooldown=SUIT_RULES.shotCd;this.shoot(p,false);
    }
    p.suitCharge=quant(s.beam/SUIT_RULES.beamCharge);p.suitBeamCd=quant(s.beamCooldown);
  }
  step(dt){
    this.clock+=dt;
    // Destruction of a supporting storey removes uncollected equipment; already looted items remain owned.
    for(const item of this.items)if(item.available){
      const stand=item.supportKey?this.baseStands.get(item.supportKey):null;
      const removedStand=item.supportKey&&(!stand||stand.hp<=0||this.a.destroyedProps?.has(stand.prop));
      const removedBuilding=item.building!==undefined&&(this.a.destroyedBuildings?.has(item.building)||(this.a.destruction.storeys[item.building]??Infinity)<=item.storey);
      if(removedStand||removedBuilding)item.available=false;
    }
    for(const b of [...this.bombs]){
      b.life-=dt;b.vy-=18*dt;const delta={x:b.vx*dt,y:b.vy*dt,z:b.vz*dt},len=Math.hypot(delta.x,delta.y,delta.z)||.001;
      const dir={x:delta.x/len,y:delta.y/len,z:delta.z/len},v=this.a.vehicles.get(b.vehicle),owner=this.a.players.find(p=>p.id===b.owner)||{id:b.owner};
      const hit=this.a.vehicles.ray(b,dir,len,owner,v?.obstacle),impact=hit.distance<len-.001;
      const d=impact?Math.max(0,hit.distance-.08):len;for(const k of ['x','y','z'])b[k]+=dir[k]*d;
      const ground=b.y<=groundHeight(b.x,b.z,this.a.map)+.18;
      if(impact||ground||b.life<=0||Math.abs(b.x)>this.a.map.limit.x||Math.abs(b.z)>this.a.map.limit.z){
        this.bombs.splice(this.bombs.indexOf(b),1);
        if(impact||ground)this.a.blast(b.x,Math.max(b.y,groundHeight(b.x,b.z,this.a.map)+.18),b.z,BOMB_RULES.radius,BOMB_RULES.damage,owner);
      }
    }
    for(const id of this.mem.keys())if(!this.a.players.some(p=>p.id===id))this.mem.delete(id);
  }
  onDeath(p){p.suitFlight=false;p.suitVX=p.suitVZ=0;p.suitCharge=0;this.mem.delete(p.id);this.a.drones?.cancel(p);}
  snapshot(){return {labItems:this.items.map(i=>({...i})),bombs:this.bombs.map(b=>({...b}))};}
  reset(){this.items=(this.a.map.labItems||[]).map(i=>({...i,available:true}));this.mem.clear();this.bombs=[];this.vehicleHeld.clear();}
  dispose(){this.mem.clear();this.bombs=[];this.vehicleHeld.clear();}
}
