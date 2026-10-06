// PRIDA 0.29: authoritative hinged doors. Both Node and the browser-hosted Room use this module.
import { castMap } from './raycast.js';
import { addObstacle, removeObstacle } from './destruction.js';
import { doorPoses, leafBounds, leafTouchesPlayer, leafTouchesBox, DOOR_TIME, DOOR_REACH, DOOR_HP, clamp01 } from './architecture-geometry.js';

export function initDoors(arena) {
  arena.doorClock = 0;arena.movingDoors036=new Set();arena.map._doorSparse036=new Set();
  for (const d of arena.map.doors) {
    d.t=0;d.open=false;d.swing=1;d.hp=DOOR_HP;d.nextUse=0;
    d.leaves=doorPoses(d).map((pose,k)=>{
      const o={...leafBounds(pose),part:'door',doorId:d.id,doorLeaf:pose,leafIndex:k,
        planned033:!!d.planned033,building:d.building,storey:d.storey||0,hp:DOOR_HP,color:d.color||0x9e7855};
      addObstacle(arena.map,o); arena.addCollider(o); return o;
    });
  }
}
export function navigationMap(map) {
  // Doors are traversable connections for path finding; a bot opens them before walking through.
  return {...map,obstacles:map.obstacles.filter(o=>o.doorId===undefined && o.vehicleId===undefined)};
}
// Room count grows with the four-sector world. Use a static local index for interaction,
// rather than scanning every apartment door for every bot and HUD frame.
export function doorCandidates(map,p,reach) {
  const doors=map.doors||[];
  if(doors.length<96||!Number.isFinite(reach)||reach>48)return doors;
  const span=16;let index=map._doorBuckets033;
  if(!index||index.list!==doors||index.count!==doors.length){
    const cells=new Map();for(const d of doors){const key=Math.floor(d.x/span)+':'+Math.floor(d.z/span);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(d);}
    index=map._doorBuckets033={list:doors,count:doors.length,cells};
  }
  const out=[];
  for(let x=Math.floor((p.x-reach)/span);x<=Math.floor((p.x+reach)/span);x++)
    for(let z=Math.floor((p.z-reach)/span);z<=Math.floor((p.z+reach)/span);z++)
      for(const d of index.cells.get(x+':'+z)||[])out.push(d);
  return out;
}
export function nearestDoor(map,p,{facing=true,reach=DOOR_REACH}={}) {
  if(!p || p.hp<=0 || p.inBus)return null;
  let best=null,score=Infinity;
  for(const d of doorCandidates(map,p,reach)) {
    if(d.hp<=0)continue;
    const floor=(d.y??1.3)-(d.h||2.55)/2;
    if(p.y+1.5<floor || p.y>floor+(d.h||2.55)-0.3)continue;
    const dx=d.x-p.x,dz=d.z-p.z,n=Math.hypot(dx,dz);
    if(n>reach)continue;
    const aim=n>0.15?Math.cos(p.pitch||0)*(Math.sin(p.angle||0)*dx+Math.cos(p.angle||0)*dz)/n:1;
    if(facing && n>0.7 && aim<0.65)continue;
    const origin={x:p.x,y:p.y+1.35,z:p.z},target={x:d.x,y:Math.min(d.y+0.3,p.y+1.35),z:d.z};
    const delta={x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z},len=Math.hypot(delta.x,delta.y,delta.z)||1;
    const hit=castMap(origin,{x:delta.x/len,y:delta.y/len,z:delta.z/len},len,map);
    if(hit.distance<len-0.08 && hit.impact?.obstacle?.doorId!==d.id)continue;
    const s=n+(facing?(1-aim)*0.8:0);
    if(s<score){score=s;best=d;}
  }
  return best;
}
function occupied(arena,d,next,swing=d.swing) {
  return doorPoses(d,next,swing).some(pose=>{
    if(arena.players.some(p=>leafTouchesPlayer(pose,p)))return true;
    const bounds=leafBounds(pose);
    const test=o=>o.doorId!==d.id && !o.nocollide &&
      Math.abs(o.x-bounds.x)<(o.w+bounds.w)/2 && Math.abs(o.z-bounds.z)<(o.d+bounds.d)/2 &&
      leafTouchesBox(pose,o);
    let blocked=false;
    const grid=arena.map.obstacles.grid;
    if(grid)grid.query(bounds.x-bounds.w/2,bounds.z-bounds.d/2,bounds.x+bounds.w/2,bounds.z+bounds.d/2,o=>{if(!blocked && test(o))blocked=true;});
    else blocked=arena.map.obstacles.some(test);
    return blocked;
  });
}
function sweepBlocked(arena,d,to,swing) {
  const from=d.t||0,steps=Math.max(2,Math.ceil(Math.abs(to-from)*18));
  for(let i=1;i<=steps;i++)if(occupied(arena,d,from+(to-from)*i/steps,swing))return true;
  return false;
}
export function useDoor(arena,p,auto=false) {
  const d=nearestDoor(arena.map,p,{facing:!auto,reach:auto?1.8:DOOR_REACH});
  if(!d || (auto && d.open))return false;
  if(arena.doorClock<d.nextUse)return true;
  const opening=!d.open;
  if(opening) {
    const side=d.axis==='z'?(p.x-d.x)*(d.face||1):(p.z-d.z)*(d.face||1);
    let swing=side>=0?-1:1;
    if(sweepBlocked(arena,d,1,swing)) {
      swing=-swing;
      if(sweepBlocked(arena,d,1,swing)) {
        arena.events.push({type:'door-blocked',id:p.id,door:d.id});d.nextUse=arena.doorClock+0.35;return true;
      }
    }
    d.swing=swing;
  } else if(sweepBlocked(arena,d,0,d.swing)) {
    arena.events.push({type:'door-blocked',id:p.id,door:d.id});d.nextUse=arena.doorClock+0.35;return true;
  }
  arena.movingDoors036?.add(d);arena.map._doorSparse036?.add(d);
  d.open=opening;d.nextUse=arena.doorClock+DOOR_TIME+0.08;
  arena.events.push({type:'door',id:p.id,door:d.id,open:opening,x:d.x,y:d.y,z:d.z});
  return true;
}
function moveLeaf(map,o,pose,arena=null) {
  removeObstacle(map,o);
  Object.assign(o,leafBounds(pose),{doorLeaf:pose});
  addObstacle(map,o);
  if(arena) {
    const c=arena.colliders.get(o);
    if(c && !Array.isArray(c)) {
      c.setTranslation({x:pose.x,y:pose.y,z:pose.z});
      c.setRotation({x:0,y:Math.sin(pose.yaw/2),z:0,w:Math.cos(pose.yaw/2)});
      arena.physicsDirty=true;
    }
  }
}
export function destroyDoor(arena,d,attacker) {
  if(!d || d.hp<=0)return;
  d.hp=0;d.open=true;d.t=1;arena.movingDoors036?.delete(d);arena.map._doorSparse036?.add(d);
  for(const o of d.leaves||[]) {if(arena.colliders.has(o))arena.removeObs(o);else removeObstacle(arena.map,o);}
  d.leaves=[];
  arena.events.push({type:'door-break',id:attacker?.id,door:d.id,x:d.x,y:d.y,z:d.z});
}
export function damageDoor(arena,id,amount,attacker) {
  const d=arena.map.doors[id];
  if(!d || d.hp<=0 || !Number.isFinite(amount) || amount<=0)return;
  if(amount>=d.hp){destroyDoor(arena,d,attacker);return;}
  arena.map._doorSparse036?.add(d);
  d.hp-=amount;
  for(const o of d.leaves)o.hp=d.hp;
}
export function stepDoors(arena,dt) {
  if(!(dt>0))return;
  arena.doorClock+=dt;
  const damage=arena.destruction;
  const stamp=[damage.panels?.length||0,damage.buildings?.length||0,JSON.stringify(damage.storeys||{})].join(':');
  const audit=stamp!==arena._doorStamp036;
  let candidates=arena.movingDoors036||arena.map.doors;
  if(audit){arena._doorStamp036=stamp;candidates=arena.map.doors;}
  const gone=audit?new Set(damage.panels):null;
  arena.doorStats036={visited:0,total:arena.map.doors.length};
  for(const d of candidates) {
    arena.doorStats036.visited++;
    if(d.hp<=0)continue;
    const b=arena.map.buildings[d.building];
    if(!b || b.collapsed || (b.fallenFrom??Infinity)<=(d.storey||0) || (audit&&(d.panels||[]).some(p=>gone.has(p)))) {
      destroyDoor(arena,d,null);continue;
    }
    const target=d.open?1:0,old=d.t||0;
    if(Math.abs(target-old)<1e-6){arena.movingDoors036?.delete(d);continue;}
    arena.movingDoors036?.add(d);arena.map._doorSparse036?.add(d);
    const step=Math.min(dt,1/30)/DOOR_TIME;
    const next=target>old?Math.min(target,old+step):Math.max(target,old-step);
    if(occupied(arena,d,next)) {
      // A player entered the swing after the key press: do not crush or teleport them.
      if(!d.open)d.open=true;
      continue;
    }
    d.t=next;
    doorPoses(d).forEach((pose,k)=>moveLeaf(arena.map,d.leaves[k],pose,arena));
  }
  for(const p of arena.players)if(p.bot && p.hp>0 && !p.dummy && !p.inBus)useDoor(arena,p,true);
}
export function doorSnapshot(map) {
  // Full *sparse* state, repeated in subsequent packets: packet loss and late joins cannot lose a door toggle.
  return [...(map._doorSparse036||map.doors)].filter(d=>d.hp!==DOOR_HP || d.open || d.t>0).map(d=>[d.id,Math.round(d.t*100)/100,d.open?1:0,d.swing,Math.round(d.hp)]);
}
export function syncDoors(map,state) {
  if(!Array.isArray(state))return; // old snapshots / lobby do not change the world
  if(map._doorPacket036===state)return;
  map._doorPacket036=state;
  const wanted=new Map(state.filter(a=>Array.isArray(a)&&Number.isInteger(a[0])).map(a=>[a[0],a]));
  const ids=new Set([...wanted.keys(),...(map._doorPrior036||[])]);
  const rows=map._doorPrior036? [...ids].map(id=>map.doors[id]).filter(Boolean) : map.doors||[];
  map._doorPrior036=new Set(wanted.keys());
  for(const d of rows) {
    const a=wanted.get(d.id),t=a?clamp01(a[1]):0,open=!!a?.[2],swing=a?.[3]===-1?-1:1,hp=a?Math.max(0,Number(a[4])||0):DOOR_HP;
    const changed=d.t!==t || d.swing!==swing || d.hp!==hp;
    Object.assign(d,{t,open,swing,hp});
    if(hp<=0){for(const o of d.leaves||[])removeObstacle(map,o);d.leaves=[];continue;}
    if(!changed&&d.leaves?.length)continue;
    const poses=doorPoses(d);
    if(!d.leaves?.length) d.leaves=poses.map((pose,k)=>{
      const o={...leafBounds(pose),part:'door',doorId:d.id,doorLeaf:pose,leafIndex:k,planned033:!!d.planned033,building:d.building,storey:d.storey||0,hp,color:d.color};
      addObstacle(map,o);return o;
    });
    else if(changed)poses.forEach((pose,k)=>moveLeaf(map,d.leaves[k],pose));
  }
}

export function applyBlastHits(arena,hits,owner) {
  const doors=new Map(),lifts=new Map();
  for(const [o,amount] of hits) {
    if(o.liftId!==undefined)lifts.set(o.liftId,Math.max(lifts.get(o.liftId)||0,amount));
    else if(o.doorId!==undefined)doors.set(o.doorId,Math.max(doors.get(o.doorId)||0,amount));
    else arena.damageObstacle(o,amount,owner);
  }
  for(const [id,amount] of doors)damageDoor(arena,id,amount,owner);
  for(const [id,amount] of lifts)arena.lifts?.damage(id,amount);
}
