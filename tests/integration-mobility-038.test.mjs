import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {Arena,initPhysics} from '../src/simulation.js';
import {NetFeed,Mirror} from '../src/netcode.js';
import {vehicleDimensions} from '../src/vehicle-specs.js';
import {createWorld} from '../src/world.js';
import {groundHeight} from '../src/terrain.js';
import {helicopterModel,animateHelicopter,wingsModel,poseWings} from '../src/mobility-models.js';
import {leafTouchesBox} from '../src/architecture-geometry.js';
import {vehiclePose} from '../src/vehicle-system.js';

function place(a,p,pos){Object.assign(p,pos);const b=a.bodies.get(p.id);b.body.setTranslation({x:p.x,y:p.y+.84,z:p.z},false);b.body.setNextKinematicTranslation({x:p.x,y:p.y+.84,z:p.z});a.physicsDirty=true;}
function tick(a,p,input={},n=1){for(let i=0;i<n;i++){a.input(p.id,{angle:p.angle||0,pitch:0,...input});a.step();}}
function snap(a,p){const feed=new NetFeed(),packet=feed.packet(p.id,feed.frame(a.snapshot()));packet.commit();return new Mirror().apply(JSON.parse(packet.text).state);}

test('0.38 actual Arena: helicopter E entry, rotor spin-up, rise, hover, finite weapons and network',async()=>{
 await initPhysics();const a=new Arena({seed:91726,mode:'debug',bots:0,allowCheats:true});
 try{
  const p=a.addPlayer('pilot','PILOT'),v=a.vehicles.list.find(v=>v.kind==='helicopter');assert.ok(v);
  const d=vehicleDimensions(v);place(a,p,{x:v.x+d.w/2+.7,y:v.y,z:v.z,angle:-Math.PI/2,pitch:0});
  tick(a,p,{interact:true});assert.equal(p.vehicle,v.id,'native E input enters the helicopter');
  const initialY=v.y;tick(a,p,{ascend:1,angle:0},180);
  assert.ok(v.airborne&&v.y>initialY+10,`helicopter failed takeoff at y=${v.y}`);assert.ok(v.hp>0);
  tick(a,p,{ascend:0,angle:0},150);const y=v.y;tick(a,p,{ascend:0,angle:0},90);assert.ok(Math.abs(v.y-y)<.10,'hover holds height with released keys');
  const z=v.z;tick(a,p,{drive:1,angle:0},70);assert.ok(v.z>z+1);tick(a,p,{drive:0,angle:0},180);assert.ok(v.speed<.1,'release controls decelerates');
  const ammo=v.mgAmmo;tick(a,p,{fire:true,angle:0},1);assert.equal(v.mgAmmo,ammo-1,'left click uses helicopter gun');assert.equal(v.ammo,0);
  tick(a,p,{vehicleRocket:true,angle:0},1);assert.equal(v.rocketAmmo,5);
  const online=snap(a,p).vehicles.find(x=>x.id===v.id);assert.equal(online.kind,'helicopter');assert.equal(online.rocketAmmo,5);assert.ok(online.airborne);
  p.frozen=10;const oldY=v.y;tick(a,p,{ascend:1,drive:1,angle:Math.PI},90);assert.ok(Math.abs(v.y-oldY)<.3,'frozen pilot cannot climb');p.frozen=0;
  assert.equal(a.vehicles.exit(p,{force:true}),true);assert.equal(p.vehicle,null);assert.ok(p.dropping);const fallenFrom=v.y;
  tick(a,p,{},60);assert.ok(v.y<fallenFrom-2,'unmanned helicopter must fall, not hover forever');
 }finally{a.dispose();}
});

test('0.41 retired KITE cannot reactivate via stale equipment state or held Space',async()=>{
 await initPhysics();const a=new Arena({mode:'debug',bots:0,allowCheats:true});
 try{const p=a.addPlayer('retired-kite','KITE');p.gear={id:'wings'};place(a,p,{x:0,y:70,z:0,angle:0,pitch:0,vy:-4,grounded:false,dropping:false});
 tick(a,p,{ascend:1},30);assert.equal(p.wingsOpen,false);assert.notEqual(p.gear?.id,'wings');assert.ok(p.y<70);
 }finally{a.dispose();}
});

test('0.38 actual city generation: all four helipads are clear and ramps/relief remain owned by their tile',()=>{
 const map=createWorld(91726,'city'),helicopters=map.vehicleSpawns.filter(v=>v.kind==='helicopter');assert.equal(helicopters.length,4);
 assert.equal(new Set(helicopters.map(v=>v.id)).size,4);assert.ok(map.ramps038.length>=4);assert.equal(new Set(map.ramps038.map(r=>r.id)).size,map.ramps038.length);
 const relief=map.terrainFeatures.filter(f=>f.kind==='upland'||f.kind==='basin');assert.ok(relief.length>=4);assert.ok(relief.some(f=>f.kind==='basin'));
 for(const h of helicopters){const pose=vehiclePose({...h,angle:h.angle||0});const hits=map.obstacles.filter(o=>!o.nocollide&&o.part!=='ground'&&o.y+o.h/2>h.y+.08&&leafTouchesBox(pose,o,.015));assert.equal(hits.length,0,`spawn obstructed ${h.id}: ${hits.map(o=>o.part).join(',')}`);}
 const ramps=map.obstacles.filter(o=>o.mobilityRamp);assert.equal(ramps.length,map.ramps038.length);
 for(const r of map.ramps038){assert.ok(r.end.y>r.start.y+1);assert.ok(Number.isFinite(groundHeight(r.x,r.z,map)));}
 assert.equal(map.chests.filter(c=>c.kite038||c.gear==='wings').length,0);
 const mini=createWorld(91726,'district');assert.equal(mini.terrainFeatures?.some(f=>f.kind==='upland'||f.kind==='basin')||false,false);assert.equal(mini.ramps038.length,0);
});

test('0.38 actual Three: main and tail rotors animate independently; rigid fuselage and geometry remain finite',()=>{
 const model=helicopterModel();const r=model.userData.rig,before=new T.Box3().setFromObject(model);assert.ok(before.max.y>3);
 const fixed=model.children.find(o=>o.isMesh),matrix=fixed.matrix.clone();animateHelicopter(model,{engine:1},.017);assert.ok(r.mainRotor.rotation.y>.1);assert.ok(r.tailRotor.rotation.x<-.1);assert.ok(fixed.matrix.equals(matrix));
 model.updateMatrixWorld(true);let meshes=0;model.traverse(o=>{if(!o.isMesh)return;meshes++;assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});assert.ok(meshes<25,`too many unbatched meshes: ${meshes}`);
 const geometries=new Set(),materials=new Set();model.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
});

test('0.38 actual Three: two KITE wings fold, reuse geometry and do not allocate geometry every animation tick',()=>{
 const a=wingsModel(),b=wingsModel(),r=a.userData.wingPivots;assert.equal(r.length,2);assert.equal(r[0].children[0].geometry,b.userData.wingPivots[0].children[0].geometry);
 const geo=r[0].children[0].geometry;poseWings(a,false,0);const folded=r[0].rotation.y;for(let i=0;i<180;i++)poseWings(a,true,1/60);
 assert.ok(Math.abs(r[0].rotation.y)<.001);assert.ok(Math.abs(folded)>1);assert.equal(r[0].children[0].geometry,geo);
});

test('0.38 actual Three: chin gun world muzzle and direction match server while banking and elevating',async()=>{
 const {helicopterGunPose}=await import('../src/mobility-physics.js');const model=helicopterModel();
 try{for(const angle of[-3.13,0,1.2])for(const barrel of[-.6,.5]){
  const v={x:12,y:9,z:24,angle,barrel,pitch:-.18,roll:.20,engine:1};model.position.set(v.x,v.y,v.z);model.rotation.set(-v.pitch,v.angle,v.roll,'YXZ');animateHelicopter(model,v,1/60);model.updateMatrixWorld(true);
  const node=model.getObjectByName('gun-muzzle'),origin=node.getWorldPosition(new T.Vector3()),dir=node.getWorldDirection(new T.Vector3()),want=helicopterGunPose(v);
  for(const k of['x','y','z']){assert.ok(Math.abs(origin[k]-want.origin[k])<1e-6);assert.ok(Math.abs(dir[k]-want.dir[k])<1e-6);}
 }}finally{const {disposeVehicleModel}=await import('../src/vehicle-models.js');disposeVehicleModel(model);}
});
