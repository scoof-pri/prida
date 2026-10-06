import test from 'node:test';
import assert from 'node:assert/strict';
import {Arena,initPhysics} from '../src/simulation.js';
import {createWorld} from '../src/world.js';
import {GEAR} from '../src/catalog.js';
import {TechnologySystem,suitMovement} from '../src/technology-system.js';
import {NetFeed,Mirror} from '../src/netcode.js';
import {groundHeight} from '../src/terrain.js';
import {fpvCount} from '../src/fpv-inventory.js';
await initPhysics();
function place(a,p,x,z,y=0){Object.assign(p,{x,z,y,angle:0,pitch:0,vy:0,grounded:true,dropping:false,gliding:false,inBus:false});const b=a.bodies.get(p.id).body;b.setTranslation({x,y:y+.84,z},true);b.setNextKinematicTranslation({x,y:y+.84,z});a.physicsDirty=true;}
function step(a,p,i,n=1){for(let k=0;k<n;k++){a.input(p.id,{angle:0,pitch:0,...i});a.step();}}
function snapshot(a,p){const f=new NetFeed(),q=f.packet(p.id,f.frame(a.snapshot()));q.commit();return new Mirror().apply(JSON.parse(q.text).state);}
const overlaps=(a,b,pad=0)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+pad&&Math.abs(a.z-b.z)<(a.d+b.d)/2+pad;
test('all four military bases carry five independently identified FPV pickups outside runways and helipads',()=>{
 const m=createWorld(91726,'city');assert.equal(m.baseDroneStations.length,4);const items=m.labItems.filter(i=>i.supportKey);assert.equal(items.length,20);assert.equal(new Set(items.map(i=>i.id)).size,20);
 for(const station of m.baseDroneStations){assert.equal(items.filter(i=>i.labId===station.labId).length,5);for(const e of m.expansions){assert.equal(overlaps(station,e.runway,1),false);assert.equal(overlaps(station,e.helipad,1),false);}}
 const stands=new Map(m.obstacles.filter(o=>o.droneStand041).map(o=>[o.droneStand041,o]));for(const i of items)assert.ok(stands.has(i.supportKey));
 assert.ok(!GEAR.some(g=>g.id==='wings'));assert.ok(!m.chests.some(c=>c.gear==='wings'||c.kite038));
});
test('base FPV pickup is finite, launches a real drone, replicates, and destroyed stand loses uncollected loot',()=>{
 const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true});try{
  const p=a.addPlayer('base-pilot','BASE'),items=a.technology.items.filter(i=>i.supportKey);assert.equal(items.length,5);const it=items[0];
  place(a,p,it.x,it.z-1.6,groundHeight(it.x,it.z-1.6,a.map)+.05);assert.equal(a.technology.pickup(p),true);assert.equal(fpvCount(p),1);assert.equal(it.available,false);
  const net=snapshot(a,p);assert.equal(net.labItems.find(i=>i.id===it.id).available,false);
  place(a,p,it.x,it.z-4,groundHeight(it.x,it.z-4,a.map)+.05);assert.equal(a.drones.launch(p),true);assert.equal(fpvCount(p),0);assert.equal(a.drones.list.length,1);assert.equal(snapshot(a,p).drones.length,1);
  const stand=a.technology.baseStands.get(items[1].supportKey);a.damageObstacle(stand,999,p);a.technology.step(1/60);assert.equal(items[1].available,false);
 }finally{a.dispose();}
});
test('Space/ascend starts suit flight without K, release stops thrust, stale input and empty fuel cannot sustain it',()=>{
 const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true});try{
  const p=a.addPlayer('suited','SUIT'),e=a.map.expansion;place(a,p,e.runway.x,e.runway.z,0.1);p.gear={id:'aegis',fuel:100};
  step(a,p,{suitToggle:true},2);assert.equal(p.suitFlight,false);
  step(a,p,{suitThrust:true,ascend:1},100);assert.equal(p.suitFlight,true);assert.ok(p.y>5);assert.ok(p.gear.fuel<100);
  const y=p.y;step(a,p,{suitThrust:true,ascend:1,z:1},60);assert.ok(Math.abs(p.y-y)<3,'level forward flight is not a forced vertical climb');
  step(a,p,{suitThrust:false,ascend:0},40);assert.equal(p.suitFlight,false);assert.equal(p.gliding,false);
  p.gear.fuel=0;step(a,p,{suitThrust:true,ascend:1},4);assert.equal(p.suitFlight,false);
  p.gear.fuel=50;step(a,p,{suitThrust:true,ascend:1},1);p.inputAge=1;a.step();assert.equal(p.suitFlight,false);
 }finally{a.dispose();}
});
test('automatic altitude-based glider deployment is removed for bus and launch-pad descent',()=>{
 const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true});try{const p=a.addPlayer('drop','DROP'),e=a.map.expansion;
  for(const height of [30,22,12,6]){place(a,p,e.runway.x,e.runway.z,height);Object.assign(p,{gear:null,dropping:true,grounded:false,vy:-18});step(a,p,{},3);assert.equal(p.gliding,false,'height '+height);assert.ok(p.vy<-18);}
 }finally{a.dispose();}
});
test('equipped manual glider remains deliberate rather than automatic',()=>{
 const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true});try{const p=a.addPlayer('manual','MANUAL'),e=a.map.expansion;place(a,p,e.runway.x,e.runway.z,16);Object.assign(p,{gear:{id:'glider'},grounded:false,vy:-8,dropping:true});step(a,p,{},1);assert.equal(p.gliding,false);step(a,p,{ascend:1},1);assert.equal(p.gliding,true);
 }finally{a.dispose();}
});
test('suit movement normalizes diagonal commands and C plus Space descends with bounded speed',()=>{
 const p={hp:100,gear:{id:'aegis'},suitFlight:true,angle:0,pitch:0,vy:0};let move;
 for(let k=0;k<180;k++){p.vy-=22/60;move=suitMovement(p,{suitThrust:true,ascend:1,x:1,z:1},1/60);}
 assert.ok(Math.hypot(move.x,move.z)<=22.01);
 for(let k=0;k<100;k++){p.vy-=22/60;suitMovement(p,{suitThrust:true,ascend:0},1/60);}assert.ok(p.vy<-11&&p.vy>=-12.01);
});
