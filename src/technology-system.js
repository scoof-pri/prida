// NOVA technology. All inventory, upgrades, suit energy and bomb damage live on the authority.
import { makeGear, WEAPONS } from './items.js';
import { direction } from './combat.js';
import { castMap } from './raycast.js';
import { groundHeight } from './terrain.js';
import { SUIT_RULES, suitFireSolution, suitDesiredLean } from './suit-weapons.js';
import { receiveFPV } from './fpv-inventory.js';
export { SUIT_RULES } from './suit-weapons.js';
export const BOMB_RULES=Object.freeze({ammo:3,damage:420,radius:8,cooldown:1.3,life:18,cap:12});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const quant=n=>Math.round(n*100)/100;
export function suitMovement(p,i,dt){
  if(p.gear?.id!=='aegis'||p.vehicle||p.droneId||p.hp<=0)return null;
  if(!p.suitFlight){
    // Releasing thrust returns vertical motion to gravity while retaining momentum.
    // A short release/repress never resets forward speed or creates an air brake.
    if(p.grounded){p.suitVX=p.suitVZ=0;return null;}
    const speed=Math.hypot(p.suitVX||0,p.suitVZ||0);
    if(speed<.05){p.suitVX=p.suitVZ=0;return null;}
    const damping=Math.exp(-SUIT_RULES.coastDrag*dt);
    p.suitVX*=damping;p.suitVZ*=damping;
    return {x:p.suitVX,z:p.suitVZ};
  }
  const launch=clamp((p.suitTakeoff||0)/SUIT_RULES.takeoff,0,1),spool=clamp(p.suitSpool??1,0,1);
  const speed=(i.sprint?SUIT_RULES.boostSpeed:SUIT_RULES.speed)*(1-.85*launch),f=direction(p.angle,p.pitch);
  const auto=i.sprint&&Math.hypot(i.x||0,i.z||0)<.05;
  const inputLength=Math.max(1,Math.hypot(i.x||0,i.z||0));
  const wantX=auto?f.x*speed:clamp(i.x,-1,1)/inputLength*speed,wantZ=auto?f.z*speed:clamp(i.z,-1,1)/inputLength*speed;
  const dx=wantX-(p.suitVX||0),dz=wantZ-(p.suitVZ||0),delta=Math.hypot(dx,dz);
  const accelerating=wantX*(p.suitVX||0)+wantZ*(p.suitVZ||0)>0&&Math.hypot(wantX,wantZ)>Math.hypot(p.suitVX||0,p.suitVZ||0);
  const step=(accelerating?SUIT_RULES.acceleration:SUIT_RULES.braking)*spool*dt,k=Math.min(1,step/(delta||1));
  p.suitVX=(p.suitVX||0)+dx*k;p.suitVZ=(p.suitVZ||0)+dz*k;
  const moving=Math.hypot(i.x||0,i.z||0)>.05;
  const forward=(i.x||0)*Math.sin(p.angle||0)+(i.z||0)*Math.cos(p.angle||0);
  const descending=i.suitThrust===true&&(i.ascend||0)<=0;
  let vertical=descending?-SUIT_RULES.climb:launch>0?SUIT_RULES.takeoffClimb:auto?f.y*speed:moving?Math.sin(p.pitch||0)*speed*clamp(forward,-1,1):SUIT_RULES.climb;
  // Ease into an altitude ceiling rather than switching off the suit or teleporting.
  if(vertical>0)vertical=Math.min(vertical,Math.sqrt(Math.max(0,2*SUIT_RULES.verticalAcceleration*(SUIT_RULES.ceiling-(p.y||0)))));
  if((p.y||0)>SUIT_RULES.ceiling)vertical=Math.min(vertical,-Math.min(4,(p.y-SUIT_RULES.ceiling)*2));
  // Arena applied ordinary gravity immediately before this flight adapter.
  const prior=(p.vy||0)+22*dt,maxDelta=SUIT_RULES.verticalAcceleration*spool*dt;
  p.vy=prior+clamp(vertical-prior,-maxDelta,maxDelta);
  if(!descending&&(p.y||0)<SUIT_RULES.ceiling)p.vy=Math.min(p.vy,Math.max(0,(SUIT_RULES.ceiling-(p.y||0))/Math.max(.001,dt)));
  p.thrusting=true;p.gliding=p.dropping=p.launched=false;p.wingsOpen=false;
  return {x:p.suitVX,z:p.suitVZ};
}
export class TechnologySystem {
  constructor(a){this.a=a;this.clock=0;this.items=(a.map.labItems||[]).map(i=>({...i,available:true}));this.mem=new Map();this.bombs=[];this.rockets=[];this.nextBomb=0;this.nextRocket=0;this.vehicleHeld=new Map();this.baseStands=new Map((a.map.obstacles||[]).filter(o=>o.droneStand041).map(o=>[o.droneStand041,o]));}
  state(p){let s=this.mem.get(p.id);if(!s){s={toggle:false,cooldown:0,beam:0,beamCooldown:0,beamHeld:false,rocketHeld:false,rocketCooldown:0};this.mem.set(p.id,s);}return s;}
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
      const result=receiveFPV(p);if(result.full){this.notice(p,'DRONE INVENTORY FULL (5)');return true;}
      if(result.slot<0)return false;
      if(result.dropped)this.a.dropLoot(p.x,p.z,{loot:result.dropped},p.id);
      this.a.syncHeld(p);
    }else if(best.kind==='aegis'){
      if(p.gear?.id==='aegis'){this.notice(p,'AEGIS ALREADY EQUIPPED');return true;}
      if(p.gear){ // Keep the previous equipment as normal world loot instead of silently deleting it.
        const dropped=this.a.dropLoot(p.x,p.z,{gear:{...p.gear}},p.id);dropped.y=p.y;
      }
      p.gear=makeGear('aegis');p.gear.rocketAmmo=SUIT_RULES.rockets;p.suitRockets=SUIT_RULES.rockets;
      p.suitFlight=false;p.suitVX=p.suitVZ=p.suitTakeoff=p.suitSpool=0;
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
    const range=beam?160:100,solution=suitFireSolution(p,beam?'beam':'palm',range,(from,dir,len)=>this.a.vehicles.ray(from,dir,len,p,null));
    const {from,to,dir:f,hit:ray,distance}=solution;
    if(beam){if(distance<range)this.a.blast(to.x-f.x*.1,to.y-f.y*.1,to.z-f.z*.1,2.8,130,p);}
    else if(ray.victim)this.a.damage(p,ray.victim,SUIT_RULES.shotDamage);
    else if(ray.boss)this.a.bosses.damage(ray.boss,SUIT_RULES.shotDamage,p);
    else if(ray.obstacle)this.a.damageObstacle(ray.obstacle,32,p);
    this.a.events.push({type:'tech-shot',id:p.id,beam,blocked:solution.blocked,from,to,x:from.x,y:from.y,z:from.z});
  }
  launchRocket(p,s=this.state(p)){
    if(p.gear?.id!=='aegis'||p.hp<=0||p.inBus||p.vehicle||p.droneId||p.frozen>0||s.rocketCooldown>0)return false;
    if(WEAPONS[p.slots?.[p.slot]?.w]?.drone)return false;
    const ammo=Math.floor(clamp(p.gear.rocketAmmo??SUIT_RULES.rockets,0,SUIT_RULES.rockets));
    if(!ammo){this.notice(p,'AEGIS ROCKETS EMPTY');return false;}
    if(p.gear.fuel<SUIT_RULES.rocketCost||this.rockets.length>=SUIT_RULES.rocketCap)return false;
    const port=SUIT_RULES.rockets-ammo,solution=suitFireSolution(p,'rocket',230,(from,dir,len)=>this.a.vehicles.ray(from,dir,len,p,null),port);
    if(solution.blocked){this.notice(p,'ROCKET LAUNCHER BLOCKED');return false;}
    const f=solution.dir,r={id:'suit-rocket-'+(++this.nextRocket),owner:p.id,team:p.team,port,...solution.from,
      dx:f.x,dy:f.y,dz:f.z,speed:SUIT_RULES.rocketStartSpeed,life:SUIT_RULES.rocketLife,
      carryX:clamp(p.suitVX,-SUIT_RULES.boostSpeed,SUIT_RULES.boostSpeed)*.25,
      carryY:clamp(p.vy,-SUIT_RULES.boostSpeed,SUIT_RULES.boostSpeed)*.25,
      carryZ:clamp(p.suitVZ,-SUIT_RULES.boostSpeed,SUIT_RULES.boostSpeed)*.25};
    r.vx=f.x*r.speed+r.carryX;r.vy=f.y*r.speed+r.carryY;r.vz=f.z*r.speed+r.carryZ;
    this.rockets.push(r);p.gear.rocketAmmo=ammo-1;p.suitRockets=ammo-1;
    p.gear.fuel-=SUIT_RULES.rocketCost;s.rocketCooldown=SUIT_RULES.rocketCd;p.suitRocketCd=quant(s.rocketCooldown);
    this.a.events.push({type:'suit-rocket-launch',id:p.id,rocket:r.id,port,from:{...solution.from},x:r.x,y:r.y,z:r.z});return true;
  }
  playerStep(p,i,dt){
    const s=this.state(p);s.cooldown=Math.max(0,s.cooldown-dt);s.beamCooldown=Math.max(0,s.beamCooldown-dt);s.rocketCooldown=Math.max(0,s.rocketCooldown-dt);
    const has=p.gear?.id==='aegis'&&p.hp>0&&!p.inBus&&!p.vehicle&&!p.droneId;
    if(!has||p.frozen>0){p.suitFlight=false;p.suitVX=p.suitVZ=p.suitCharge=p.suitSpool=p.suitTakeoff=p.suitTilt=0;p.suitBoost=false;s.beam=0;s.toggle=!!i.suitToggle;s.rocketHeld=!!i.suitRocket;return;}
    // The gear item owns its finite magazine across drops and re-equips; the
    // mirrored scalar is HUD state, never accepted as client inventory input.
    p.gear.rocketAmmo=Math.floor(clamp(p.gear.rocketAmmo??SUIT_RULES.rockets,0,SUIT_RULES.rockets));p.suitRockets=p.gear.rocketAmmo;
    p.suitRocketCd=quant(s.rocketCooldown);
    const energy=clamp(p.gear.fuel,0,100);p.gear.fuel=energy;
    const thrust=i.suitThrust===true||(i.ascend||0)>0,wasFlying=!!p.suitFlight;
    p.suitFlight=thrust && (wasFlying?energy>0:energy>10);
    p.suitTakeoff=Math.max(0,(p.suitTakeoff||0)-dt);
    if(p.suitFlight&&!wasFlying){
      if(p.grounded){p.suitTakeoff=SUIT_RULES.takeoff;p.suitVX=p.suitVZ=0;}
      p.grounded=false;p.dropping=p.gliding=p.launched=false;
      this.a.events.push({type:'suit-takeoff',id:p.id,x:p.x,y:p.y,z:p.z,ground:p.suitTakeoff>0});
    }
    p.suitSpool=clamp((p.suitSpool||0)+(p.suitFlight?5:-8)*dt,0,1);p.suitBoost=!!p.suitFlight&&!!i.sprint;
    p.suitTilt=(p.suitTilt||0)+(suitDesiredLean(p)-(p.suitTilt||0))*(1-Math.exp(-8*dt));
    if(p.suitFlight){
      p.gear.fuel=Math.max(0,energy-(i.sprint?SUIT_RULES.boostDrain:SUIT_RULES.flightDrain)*dt);
      if(p.gear.fuel<=0){p.suitFlight=false;p.suitBoost=false;this.notice(p,'AEGIS ENERGY EMPTY');}
    }else {
      if(wasFlying){p.gliding=false;p.dropping=false;p.launched=false;}
      if(p.grounded&&!thrust&&!i.fire&&!i.suitAlt&&!i.suitRocket)p.gear.fuel=Math.min(100,energy+SUIT_RULES.recharge*dt);
    }
    s.toggle=false; // Retired K toggle never activates flight, including forged online input.
    if(WEAPONS[p.slots?.[p.slot]?.w]?.drone){s.beam=0;s.beamHeld=!!i.suitAlt;s.rocketHeld=!!i.suitRocket;p.suitCharge=0;p.suitBeamCd=quant(s.beamCooldown);return;}
    if(i.suitAlt&&s.beamCooldown<=0&&p.gear.fuel>=SUIT_RULES.beamCost){
      s.beam=Math.min(SUIT_RULES.beamCharge,s.beam+dt);
      if(s.beam>=SUIT_RULES.beamCharge&&!s.beamHeld){this.beam(p,s);s.beamHeld=true;s.beam=0;}
    }else s.beam=0;
    if(!i.suitAlt)s.beamHeld=false;
    if(i.fire&&!i.suitAlt&&s.cooldown<=0&&p.gear.fuel>=SUIT_RULES.shotCost){
      p.gear.fuel-=SUIT_RULES.shotCost;s.cooldown=SUIT_RULES.shotCd;this.shoot(p,false);
    }
    if(i.suitRocket&&!s.rocketHeld)this.launchRocket(p,s);s.rocketHeld=!!i.suitRocket;
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
    for(let index=this.rockets.length-1;index>=0;index--){
      const r=this.rockets[index],owner=this.a.players.find(p=>p.id===r.owner)||{id:r.owner,team:r.team,bot:false,perks:{},score:0};
      r.life-=dt;r.speed=Math.min(SUIT_RULES.rocketSpeed,r.speed+SUIT_RULES.rocketAcceleration*dt);
      const carry=Math.exp(-3*dt);r.carryX*=carry;r.carryY*=carry;r.carryZ*=carry;
      r.vx=r.dx*r.speed+r.carryX;r.vy=r.dy*r.speed+r.carryY;r.vz=r.dz*r.speed+r.carryZ;
      const speed=Math.hypot(r.vx,r.vy,r.vz)||1,travel=speed*dt,dir={x:r.vx/speed,y:r.vy/speed,z:r.vz/speed};
      // Test the entire segment, including thin walls and moving vehicle hulls.
      const hit=this.a.vehicles.ray(r,dir,travel,owner,null),impact=hit.distance<travel-.00001;
      const advance=impact?Math.max(0,hit.distance-.065):travel;
      for(const key of ['x','y','z'])r[key]+=dir[key]*advance;
      const ground=groundHeight(r.x,r.z,this.a.map),landed=r.y<=ground+.045;
      const outside=Math.abs(r.x)>this.a.map.limit.x||Math.abs(r.z)>this.a.map.limit.z;
      if(impact||landed||r.life<=0||outside){
        this.rockets.splice(index,1);
        if(impact||landed)this.a.blast(r.x,Math.max(r.y,ground+.06),r.z,SUIT_RULES.rocketRadius,SUIT_RULES.rocketDamage,owner,'suit-rocket');
        this.a.events.push({type:'suit-rocket-end',id:r.owner,rocket:r.id,x:r.x,y:r.y,z:r.z,impact:impact||landed});
      }
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
  onDeath(p){p.suitFlight=p.suitBoost=false;p.suitVX=p.suitVZ=p.suitCharge=p.suitTakeoff=p.suitSpool=p.suitTilt=p.suitRocketCd=0;this.mem.delete(p.id);this.a.drones?.cancel(p);}
  snapshot(){return {labItems:this.items.map(i=>({...i})),bombs:this.bombs.map(b=>({...b})),suitRockets:this.rockets.map(r=>({...r}))};}
  reset(){this.items=(this.a.map.labItems||[]).map(i=>({...i,available:true}));this.mem.clear();this.bombs=[];this.rockets=[];this.vehicleHeld.clear();}
  dispose(){this.mem.clear();this.bombs=[];this.rockets=[];this.vehicleHeld.clear();}
}
