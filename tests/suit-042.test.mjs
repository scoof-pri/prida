import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Arena, initPhysics } from '../src/simulation.js';
import { TechnologySystem, suitMovement } from '../src/technology-system.js';
import { SUIT_RULES, suitMuzzle, suitRocketPort, suitFireSolution } from '../src/suit-weapons.js';
import { castMap } from '../src/raycast.js';
import { NetFeed, Mirror } from '../src/netcode.js';
import { makeGear } from '../src/items.js';
import { prepareCustomAvatar, instantiateCustomAvatar, disposeAvatarSkeleton, CUSTOM_POSED_BONES } from '../src/custom-characters.js';
import { attachAegis } from '../src/technology-models.js';
import { poseSuitWeapons } from '../src/suit-view.js';

function fixture(obstacles=[]) {
  const p={id:'pilot',team:0,hp:100,x:0,y:10,z:0,angle:0,pitch:0,vy:0,grounded:false,gear:makeGear('aegis')};
  const a={map:{limit:{x:400,z:400},maxTerrainHeight:0,hills:[],obstacles},players:[p],events:[],destruction:{storeys:[]},blasts:[],hits:[],
    blast(...args){this.blasts.push(args);},damageObstacle(...args){this.hits.push(args);}};
  a.vehicles={ray(from,dir,range){const hit=castMap(from,dir,range,a.map);return {...hit,obstacle:hit.impact?.obstacle};}};
  return {p,a,sys:new TechnologySystem(a)};
}
function mirror(a,p){const feed=new NetFeed(),packet=feed.packet(p.id,feed.frame(a.snapshot()));packet.commit();return new Mirror().apply(JSON.parse(packet.text).state);}

test('AEGIS palm and chest converge on the eye-selected target; cover between body and hardpoint blocks fire',()=>{
  const wall={x:0,y:11.6,z:20,w:20,h:20,d:.10,hp:500},f=fixture([wall]);
  for(const kind of ['palm','beam','rocket']){
    const shot=suitFireSolution(f.p,kind,100,f.a.vehicles.ray);
    assert.equal(shot.blocked,false);assert.ok(Math.abs(shot.to.x)<1e-7);assert.ok(Math.abs(shot.to.y-11.6)<1e-7);
    assert.ok(Math.abs(shot.to.z-19.95)<1e-7);assert.ok(Math.hypot(shot.from.x,shot.from.y-11.6,shot.from.z)>.1);
  }
  const nearby=fixture([{x:0,y:11.5,z:.16,w:4,h:3,d:.08,hp:500}]);
  const solution=suitFireSolution(nearby.p,'palm',100,nearby.a.vehicles.ray);assert.equal(solution.blocked,true);assert.ok(solution.from.z<.12);
  const fuel=nearby.p.gear.fuel;assert.equal(nearby.sys.launchRocket(nearby.p),false);assert.equal(nearby.p.gear.fuel,fuel);assert.equal(nearby.sys.rockets.length,0);
});

test('six shoulder rockets are finite, one press launches once, and cooldown and energy cannot be bypassed',()=>{
  const {p,sys}=fixture();sys.playerStep(p,{suitRocket:true},1/60);
  assert.equal(p.suitRockets,5);assert.equal(sys.rockets.length,1);assert.equal(p.gear.fuel,94);
  for(let i=0;i<100;i++)sys.playerStep(p,{suitRocket:true,suitRockets:999,rocketAmmo:999},1/60);
  assert.equal(sys.rockets.length,1,'holding input may not empty the rack');
  for(let n=0;n<5;n++){
    sys.playerStep(p,{suitRocket:false},SUIT_RULES.rocketCd+.01);sys.playerStep(p,{suitRocket:true},1/60);
  }
  assert.equal(p.suitRockets,0);assert.equal(p.gear.rocketAmmo,0);assert.equal(sys.rockets.length,6);
  assert.deepEqual(sys.rockets.map(r=>r.port),[0,1,2,3,4,5]);assert.equal(new Set(sys.rockets.map(r=>r.id)).size,6);
  sys.playerStep(p,{},2);assert.equal(sys.launchRocket(p),false);
  const empty=fixture();empty.p.gear.fuel=0;assert.equal(empty.sys.launchRocket(empty.p),false);assert.equal(empty.sys.rockets.length,0);
});

test('suit rocket sweeps through a full tick, hitting a thin wall once on its near side',()=>{
  const {p,a,sys}=fixture([{x:0,y:11.5,z:4,w:8,h:8,d:.03,hp:500}]);
  assert.equal(sys.launchRocket(p),true);sys.step(.15);
  assert.equal(sys.rockets.length,0);assert.equal(a.blasts.length,1);assert.ok(a.blasts[0][2]<3.985);
  assert.equal(a.blasts[0][6],'suit-rocket');sys.step(.2);assert.equal(a.blasts.length,1);
});

test('takeoff ramps acceleration, release preserves inertia, and the powered ceiling never switches off flight',()=>{
  const {p,sys}=fixture();Object.assign(p,{grounded:true,y:0,vy:0});
  const step=(input,dt=1/60)=>{sys.playerStep(p,input,dt);p.vy-=22*dt;const m=suitMovement(p,input,dt);if(m){p.x+=m.x*dt;p.z+=m.z*dt;}p.y+=p.vy*dt;return m;};
  step({suitThrust:true,ascend:1,z:1});assert.ok(p.vy>=0&&p.vy<1,'takeoff is not the ordinary 7.8 m/s jump');assert.ok(p.suitTakeoff>0);
  for(let i=0;i<100;i++)step({suitThrust:true,ascend:1,z:1});
  const before={vx:p.suitVX,vz:p.suitVZ,vy:p.vy};step({});
  assert.equal(p.suitFlight,false);assert.ok(Math.hypot(p.suitVX,p.suitVZ)>Math.hypot(before.vx,before.vz)*.98);
  assert.ok(Math.abs(p.vy-(before.vy-22/60))<1e-8);
  step({suitThrust:true,ascend:1,z:1});assert.ok(p.suitVZ>15,'midair re-ignition keeps forward velocity');
  Object.assign(p,{y:SUIT_RULES.ceiling-.15,vy:9,suitTakeoff:0});p.gear.fuel=100;
  for(let i=0;i<60;i++)step({suitThrust:true,ascend:1});
  assert.equal(p.suitFlight,true);assert.ok(p.y<=SUIT_RULES.ceiling+.001);assert.ok(p.y>SUIT_RULES.ceiling-.4);
});

test('uploaded Three.js suit: palm reactor, chest reactor and all six rocket tube muzzles match authority',async()=>{
  const bytes=fs.readFileSync(new URL('../public/models/aegis-player.glb',import.meta.url));
  const asset=prepareCustomAvatar(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),''),'suit');
  const avatar=instantiateCustomAvatar(asset,'suit'),root=new T.Group();root.add(avatar.model);
  const v={root,body:avatar.model,guns:[],suitShotT:1,aegis:attachAegis(avatar.model),bones041:Object.fromEntries(CUSTOM_POSED_BONES.map(n=>[n,avatar.model.getObjectByName(n)]))};
  try{
    for(const [angle,pitch,tilt] of [[0,0,0],[1.2,.65,.75],[-2,-.9,1.25]]){
      const p={id:'model-pilot',hp:100,x:17,y:30,z:-13,angle,pitch,gear:makeGear('aegis'),suitFlight:tilt>0,suitTilt:tilt,suitSpool:1,suitRockets:5};
      root.position.set(p.x,p.y,p.z);v.body.position.set(0,0,0);v.body.rotation.set(0,angle,0,'YXZ');poseSuitWeapons(v,p,0);root.updateMatrixWorld(true);
      for(const [kind,name] of [['palm','AEGISPalmR'],['beam','AEGISChestEmitter']]){
        const node=v.body.getObjectByName(name),expected=suitMuzzle(p,kind);assert.ok(node,name);
        assert.ok(node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(expected.x,expected.y,expected.z))<1e-6,kind+' hardpoint');
      }
      const hand=v.body.getObjectByName('AEGISPalmR');assert.ok(hand.position.distanceTo(new T.Vector3(0,-.035*1.84,.035*1.84))<.05,'reactor remains physically inside the palm');
      for(let port=0;port<6;port++){
        const tube=suitRocketPort(port),launcher=v.aegis.items.find(n=>n.userData.suitSide===tube.side),expected=suitMuzzle(p,'rocket',port);
        const rendered=new T.Vector3(-tube.right,tube.up,.32).applyMatrix4(launcher.matrixWorld);
        assert.ok(rendered.distanceTo(new T.Vector3(expected.x,expected.y,expected.z))<1e-6,'rocket tube '+port);
      }
      assert.equal(v.aegis.items.flatMap(n=>n.userData.chambers).find(c=>c.port===0).mesh.visible,false);
    }
  }finally{v.aegis.dispose();disposeAvatarSkeleton(v.body);}
});

test('native Arena accepts only boolean rocket presses, replicates ammo/projectiles, and applies one native explosion',async()=>{
  await initPhysics();const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true});
  try{
    const p=a.addPlayer('aegis-042','AEGIS');a.place(p,0,0,65);Object.assign(p,{gear:makeGear('aegis'),grounded:false,vy:0,angle:0,pitch:0,dropping:false});p.cheats.god=true;
    a.input(p.id,{suitRocket:'true',angle:0,pitch:0});a.step();assert.equal(a.technology.rockets.length,0);
    a.input(p.id,{suitRocket:true,suitRockets:999,angle:0,pitch:0});a.step();assert.equal(p.suitRockets,5);assert.equal(a.technology.rockets.length,1);
    const remote=mirror(a,p);assert.equal(remote.players.find(q=>q.id===p.id).suitRockets,5);assert.equal(remote.suitRockets.length,1);
    const r=a.technology.rockets[0],prop=Math.max(0,...a.map.obstacles.filter(o=>Number.isInteger(o.prop)).map(o=>o.prop))+1;
    const target={x:r.x,y:r.y,z:r.z+12,w:5,h:5,d:.05,hp:120,part:'site',surface:'concrete',prop,color:0x888888};a.addObs(target);a.physicsDirty=true;
    for(let i=0;i<45;i++){a.input(p.id,{angle:0,pitch:0});a.step();}
    assert.ok(a.destruction.props.includes(prop));assert.equal(a.technology.rockets.length,0);
    assert.equal(a.drainEvents().filter(e=>e.type==='explosion'&&e.cause==='suit-rocket').length,1);
  }finally{a.dispose();}
});
