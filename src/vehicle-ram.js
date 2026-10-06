// Tank ramming uses the native destruction API, outside Rapier's query callbacks.
// Contact tests are local to the tank's swept footprint; terrain/boundary colliders are never deleted.
import { vehicleDimensions, clamp, angleDelta } from './vehicle-specs.js';
import { leafBounds, leafTouchesBox } from './architecture-geometry.js';

export function ramContacts(map, vehicle, movement) {
  const speed=Math.abs(vehicle.speed||0),plane=vehicle.kind==='plane',travel=plane?Math.hypot(movement.x,movement.y,movement.z):Math.hypot(movement.x,movement.z);
  if((vehicle.kind!=='tank'&&!plane)||vehicle.hp<=0||vehicle.crushed||speed<(plane?12:1.8)||travel<1e-6)return [];
  const size=vehicleDimensions(vehicle),dx=movement.x/travel,dz=movement.z/travel;
  const count=Math.max(1,Math.min(32,Math.ceil(travel/.18))),poses=[];
  const old=movement.oldAngle??vehicle.angle,turn=angleDelta(old,vehicle.angle);
  for(let i=0;i<=count;i++) {
    const t=i/count;
    poses.push({x:vehicle.x+movement.x*t+dx*.16,y:vehicle.y+size.h/2+movement.y*t,z:vehicle.z+movement.z*t+dz*.16,
      w:size.w+.06,h:size.h-.08,t:size.d+.06,yaw:old+turn*t});
  }
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(const pose of poses){const b=leafBounds(pose);x0=Math.min(x0,b.x-b.w/2);x1=Math.max(x1,b.x+b.w/2);z0=Math.min(z0,b.z-b.d/2);z1=Math.max(z1,b.z+b.d/2);}
  const found=[],seen=new Set();
  const visit=o=>{
    if(seen.has(o)||o===vehicle.obstacle||o.vehicleId===vehicle.id||o.nocollide)return;
    seen.add(o);
    // Do not chew through the road/floor on which the tank is standing. A wall in front still counts.
    if((!plane||!vehicle.airborne)&&o.y+o.h/2<=vehicle.y+.18)return;
    const destructible=o.vehicleId!==undefined||o.doorId!==undefined||Number.isFinite(o.hp)||o.part==='rubble'||o.part==='roofplant';
    if(!destructible)return;
    if(poses.some(p=>leafTouchesBox(p,o,.005)))found.push(o);
  };
  if(map.obstacles.grid)map.obstacles.grid.query(x0,z0,x1,z1,visit);else for(const o of map.obstacles)visit(o);
  return found.sort((a,b)=>Math.hypot(a.x-vehicle.x,a.z-vehicle.z)-Math.hypot(b.x-vehicle.x,b.z-vehicle.z)).slice(0,16);
}
export function ramAhead(system,vehicle,movement) {
  const a=system.a,contacts=ramContacts(a.map,vehicle,movement);
  if(!contacts.length)return false;
  system.ramCooldown??=new WeakMap();system.clearedRubble??=new Set();
  const time=system.clock||0,owner=a.players.find(p=>p.id===vehicle.driver)||null;
  const damage=clamp(100+(vehicle.speed||0)**2*(vehicle.kind==='plane'?.85:9),120,1500),groups=new Set();
  let changed=false,hit=null;
  for(const o of contacts) {
    if(!a.colliders.has(o)||time<(system.ramCooldown.get(o)||0))continue;
    const key=o.vehicleId!==undefined?'v:'+o.vehicleId:o.doorId!==undefined?'d:'+o.doorId:null;
    if(key&&groups.has(key))continue;if(key)groups.add(key);
    system.ramCooldown.set(o,time+.18);
    if(o.vehicleId!==undefined) {
      const other=system.get(o.vehicleId);if(!other||other.crushed)continue;
      const driver=other.driver?a.players.find(p=>p.id===other.driver):null;
      if(owner&&driver&&owner.team===driver.team&&owner.id!==driver.id)continue;
      system.damage(other.id,damage,owner,{kind:'collision'});
      if(other.hp<=0)system.crush(other.id,owner);
    } else if(o.part==='rubble') {
      const id=o.building;
      for(const q of a.map.obstacles.filter(q=>q.part==='rubble'&&q.building===id))a.removeObs(q);
      if(Number.isInteger(id))system.clearedRubble.add(id);
    } else if(o.part==='roofplant') {
      const roof=a.map.obstacles.find(q=>q.building===o.building&&q.part==='upper');
      if(roof)a.breakObstacle(roof,owner);
      else {
        for(const q of a.map.obstacles.filter(q=>q.building===o.building&&q.part==='roofplant'))a.removeObs(q);
        if(!a.destruction.roofs.includes(o.building))a.destruction.roofs.push(o.building);
      }
    } else {
      // Panels, trees, rocks, gates and doors retain their own damage, support and replication semantics.
      a.damageObstacle(o,damage,owner);
    }
    changed=true;hit??=o;
  }
  if(changed) {
    if(vehicle.kind==='tank'&&vehicle.hp>0&&!vehicle.mods?.ram)system.damage(vehicle.id,Math.min(22,5+Math.abs(vehicle.speed)*.6),null,{kind:'collision'});
    if (vehicle.kind==='plane' && vehicle.hp>0) system.damage(vehicle.id, Math.max(100,Math.abs(vehicle.speed)**2*.30), null);
    a.physicsDirty=true;
    a.events.push({type:'vehicle-ram',vehicle:vehicle.id,id:owner?.id,x:hit.x,y:Math.max(vehicle.y+.3,Math.min(hit.y,vehicle.y+1.4)),z:hit.z,speed:Math.abs(vehicle.speed)});
  }
  return changed;
}
function removeMap(map,o){const i=map.obstacles.indexOf(o);if(i<0)return;map.obstacles.splice(i,1);map.obstacles.grid?.remove(o);map.obstacles.lowGrid?.remove(o);}
export function syncRamRubble(map,ids,scenery) {
  if(!Array.isArray(ids)||!ids.length)return;
  map._ramRubbleSeen??=new Set();
  for(const id of ids) {
    if(!Number.isInteger(id)||map._ramRubbleSeen.has(id))continue;
    for(const o of map.obstacles.filter(o=>o.part==='rubble'&&o.building===id))removeMap(map,o);
    for(const mesh of scenery?.rubble||[])if(mesh.userData.rubbleBuilding===id){mesh.visible=false;mesh.userData.appear=0;}
    map._ramRubbleSeen.add(id);
  }
}
