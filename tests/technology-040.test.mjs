import test from 'node:test';
import assert from 'node:assert/strict';
import {Arena,initPhysics} from '../src/simulation.js';
import {groundHeight} from '../src/terrain.js';
import {validateConstruction,BUILD_MATERIALS} from '../src/construction.js';
import {DRONE_RULES} from '../src/drone-system.js';
import {fpvCount,receiveFPV} from '../src/fpv-inventory.js';
import {SUIT_RULES,BOMB_RULES} from '../src/technology-system.js';
import {NetFeed,Mirror} from '../src/netcode.js';

await initPhysics();
function place(a,p,{x,y,z,angle=0,pitch=0}){
  Object.assign(p,{x,y:y??groundHeight(x,z,a.map)+.05,z,angle,pitch,grounded:true,vy:0,dropping:false,gliding:false});
  const body=a.bodies.get(p.id);body.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);body.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});a.physicsDirty=true;
}
function input(a,p,i={},n=1){for(let k=0;k<n;k++){a.input(p.id,{angle:p.angle||0,pitch:p.pitch||0,...i});a.step();}}
function findBuildSite(a,p){
  for(let x=-700;x<=700;x+=20)for(let z=-900;z<=900;z+=20){const bx=Math.round(x/4)*4,bz=Math.round(z/4)*4,y=Math.ceil(groundHeight(bx,bz,a.map)*20)/20;place(a,p,{x:bx,z:bz-6});const c={kind:'floor',rotation:0,material:0,x:bx,y,z:bz};if(!validateConstruction(a.map,p,c,a.construction.list,a.players))return c;}
  throw Error('no build site');
}
function nearItem(a,p,item){
  for(let r=.4;r<=2.3;r+=.25)for(let k=0;k<24;k++){const th=k*Math.PI/12,x=item.x-Math.sin(th)*r,z=item.z-Math.cos(th)*r,y=item.y-.95;place(a,p,{x,y,z,angle:th});if(a.technology.pickup(p))return true;}
  return false;
}
function snap(a,p,feed=new NetFeed(),mirror=new Mirror()){
  const packet=feed.packet(p.id,feed.frame(a.snapshot()));packet.commit();return {packet,state:mirror.apply(JSON.parse(packet.text).state),feed,mirror};
}

test('0.40 city contains complete NOVA labs with five FPV stands and all four technology rewards',()=>{
  const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true,size:'city'});
  try{
    assert.ok(a.map.laboratories.length>=1);
    for(const lab of a.map.laboratories){const rows=a.map.labItems.filter(i=>i.labId===lab.id);assert.equal(rows.filter(i=>i.kind==='fpv').length,5);for(const k of ['ram','turbo','bomb','aegis'])assert.equal(rows.filter(i=>i.kind===k).length,1,`${lab.id} missing ${k}`);}
    assert.equal(a.technology.items.length,a.map.labItems.length);
  }finally{a.dispose();}
});

test('0.40 construction spends material, grows hit points, replicates as a persistent delta and breaks cleanly',()=>{
  const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true,size:'city'});
  try{
    const p=a.addPlayer('builder','BUILDER'),candidate=findBuildSite(a,p),before=p.materials.wood;
    const result=a.construction.tryPlace(p,candidate);assert.equal(result.ok,true);assert.equal(p.materials.wood,before-BUILD_MATERIALS[0].cost);
    const piece=result.piece,obstacle=a.construction.obstacles.get(piece.id);assert.ok(a.colliders.has(obstacle));assert.ok(piece.hp<piece.maxHp);
    a.construction.step(2);assert.equal(piece.built,1);assert.ok(piece.hp>=piece.maxHp-.01);
    const feed=new NetFeed(),mirror=new Mirror(),first=snap(a,p,feed,mirror);assert.equal(first.state.constructions.length,1);const base=first.packet;
    const packet2=feed.packet(p.id,feed.frame(a.snapshot()));packet2.commit();const payload2=JSON.parse(packet2.text).state;assert.equal(payload2.entityDelta?.constructions,undefined);
    a.construction.damage(piece.id,999,p);const packet3=feed.packet(p.id,feed.frame(a.snapshot()));packet3.commit();const state3=mirror.apply(JSON.parse(packet3.text).state);assert.equal(state3.constructions.length,0);assert.equal(a.colliders.has(obstacle),false);assert.ok(base.reliable);
  }finally{a.dispose();}
});

test('0.40 unsupported or obstructed construction never spends resources',()=>{
  const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true,size:'city'});
  try{
    const p=a.addPlayer('builder2','BUILDER2'),candidate=findBuildSite(a,p),before={...p.materials};candidate.y+=15;
    const r=a.construction.tryPlace(p,candidate);assert.equal(r.ok,false);assert.deepEqual(p.materials,before);assert.equal(a.construction.list.length,0);
  }finally{a.dispose();}
});

test('0.40 FPV is finite, server-owned, range/battery state replicates, and deliberate fire detonates after arming',()=>{
  const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true,size:'city'});
  try{
    const p=a.addPlayer('fpv','FPV');receiveFPV(p);receiveFPV(p);place(a,p,{x:-700,z:-900,angle:0});
    input(a,p,{droneToggle:true},1);assert.ok(p.droneId);assert.equal(fpvCount(p),1);const id=p.droneId,d=a.drones.get(id);assert.ok(d);assert.equal(d.battery<=DRONE_RULES.battery,true);
    input(a,p,{droneToggle:false,fire:false,drive:0},45);const online=snap(a,p).state.drones.find(q=>q.id===id);assert.ok(online);assert.ok(online.signal>=0&&online.signal<=1);assert.ok(online.battery<DRONE_RULES.battery);
    input(a,p,{fire:true},1);assert.equal(a.drones.get(id),null);assert.equal(p.droneId,null);assert.ok(a.drainEvents().some(e=>e.type==='drone-end'&&e.exploded));
  }finally{a.dispose();}
});

test('0.40 NOVA pickups are finite and AEGIS provides bounded energy flight and weapon energy',()=>{
  const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true,size:'city'});
  try{
    const p=a.addPlayer('tech','TECH'),fpv=a.technology.items.find(i=>i.kind==='fpv'),suit=a.technology.items.find(i=>i.kind==='aegis');assert.ok(fpv&&suit);
    assert.equal(nearItem(a,p,fpv),true);assert.equal(fpvCount(p),1);assert.equal(fpv.available,false);
    assert.equal(nearItem(a,p,suit),true);assert.equal(p.gear.id,'aegis');assert.equal(suit.available,false);assert.equal(p.gear.fuel,SUIT_RULES.energy);
    input(a,p,{suitToggle:true,ascend:1},1);input(a,p,{suitToggle:false,ascend:1},90);assert.equal(p.suitFlight,true);assert.ok(p.y>2);assert.ok(p.gear.fuel<SUIT_RULES.energy&&p.gear.fuel>0);
    const energy=p.gear.fuel;input(a,p,{fire:true},1);assert.ok(p.gear.fuel<=energy-SUIT_RULES.shotCost+.01);
    p.suitFlight=false;place(a,p,{x:p.x,z:p.z,y:groundHeight(p.x,p.z,a.map)+.05,angle:p.angle});const low=p.gear.fuel;input(a,p,{fire:false},90);assert.ok(p.gear.fuel>low);
  }finally{a.dispose();}
});

test('0.40 vehicle modules enforce compatibility, finite plane bombs and service refill',()=>{
  const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true,size:'city'});
  try{
    const p=a.addPlayer('modules','MODULES'),tank=a.vehicles.list.find(v=>v.kind==='tank'),plane=a.vehicles.list.find(v=>v.kind==='plane');assert.ok(tank&&plane);
    p.techModules=['ram','turbo','bomb'];p.vehicle=tank.id;tank.driver=p.id;tank.speed=0;tank.airborne=false;
    assert.equal(a.technology.install(p,tank),true);assert.equal(tank.mods.ram,true);assert.ok(!p.techModules.includes('ram'));
    assert.equal(a.technology.install(p,tank),true);assert.equal(tank.mods.turbo,true);assert.ok(Number.isFinite(tank.boostEnergy));
    p.vehicle=plane.id;tank.driver=null;plane.driver=p.id;plane.speed=0;plane.airborne=false;assert.equal(a.technology.install(p,plane),true);assert.equal(plane.mods.bomb,true);assert.equal(plane.bombs,BOMB_RULES.ammo);
    Object.assign(plane,{airborne:true,y:groundHeight(plane.x,plane.z,a.map)+20,speed:24,bombCd:0});assert.equal(a.technology.dropBomb(p,plane),true);assert.equal(plane.bombs,BOMB_RULES.ammo-1);assert.equal(a.technology.bombs.length,1);
    a.technology.service(plane);assert.equal(plane.bombs,BOMB_RULES.ammo);
  }finally{a.dispose();}
});
