// Deployment gate. Requires real Three.js/Rapier and the complete, staged repository.
// These tests are not mocked and are intentionally sequential to limit build-server peak memory.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { Arena, initPhysics } from '../src/simulation.js';
import { createWorld, roofPlan } from '../src/world.js';
import { groundHeight } from '../src/terrain.js';
import { validateTiledMap } from '../src/world-tiles.js';
import { BossSystem } from '../src/bosses.js';
import { NetFeed, Mirror } from '../src/netcode.js';
import { StreamScenery } from '../src/stream-scenery.js';
import { StreamWorld } from '../src/stream-world.js';
import { damageCells } from '../src/cells.js';
afterEach(() => globalThis.gc?.());
const close = (a,b,e=.001) => assert.ok(Math.abs(a-b)<e, `${a} != ${b}`);

test('actual generator: four complete copies, unique IDs, seam elevations and preserved roof plans', {timeout:120000}, () => {
  const map=createWorld(91726,'city');
  assert.ok(validateTiledMap(map));
  assert.equal(map.tiles.length,4);assert.equal(map.expansions.length,4);
  assert.equal(map.expansions.flatMap(e=>e.villas).length,8);
  assert.equal(map.vehicleSpawns.filter(v=>v.kind==='tank').length,12);
  assert.equal(map.vehicleSpawns.filter(v=>v.kind==='plane').length,8);
  assert.equal(map.vehicleSpawns.filter(v=>v.variant==='sam').length,4);
  assert.equal(map.vehicleSpawns.filter(v=>v.variant==='twin').length,4);
  const first=map.tiles[0];
  close(map.limit.x*2,first.w*2);close(map.limit.z*2,first.d*2);
  for(const t of map.tiles){assert.equal(t.buildings,first.buildings);assert.equal(t.panels,first.panels);}
  for(let i=0;i<4;i++)close(map.cores[i].z0-(map.expansions[i].base.z+map.expansions[i].base.d/2),18);
  const baseBuilding=map.buildings[0],basePlan=roofPlan(baseBuilding);
  for(const t of map.tiles.slice(1)){
    const b=map.buildings[t.firstBuilding],plan=roofPlan(b),dx=t.x-first.x,dz=t.z-first.z;
    assert.equal(plan.style,basePlan.style);assert.equal(plan.items.length,basePlan.items.length);
    for(let i=0;i<plan.items.length;i++){close(plan.items[i].x,basePlan.items[i].x+dx);close(plan.items[i].z,basePlan.items[i].z+dz);}
  }
  const bosses=new BossSystem({map,mode:'debug',size:'city',players:[],zone:null});
  assert.equal(new Set(bosses.list.map(b=>b.id)).size,bosses.list.length);
  for(let z=-map.limit.z+20;z<map.limit.z-20;z+=37)close(groundHeight(-.001,z,map),groundHeight(.001,z,map),.01);
  for(let x=-map.limit.x+20;x<map.limit.x-20;x+=37)close(groundHeight(x,-.001,map),groundHeight(x,.001,map),.01);
  const enabled=new Set(map.vehicleSpawns.filter(v=>v.decor!==undefined).map(v=>v.decor));
  for(const o of map.obstacles)if(o.part==='car')assert.ok(enabled.has(o.decor));
  assert.ok(map.siteObjects.filter(o=>o.detailCell).length>100);
  console.log('WORLD031',JSON.stringify({width:map.limit.x*2,depth:map.limit.z*2,buildings:map.buildings.length,obstacles:map.obstacles.length,vehicles:map.vehicleSpawns.length,seamRoads:map.seamRoads.length}));
});

test('actual Rapier: paging preserves damage and network state, and supports a player after a distant teleport', {timeout:120000}, async () => {
  await initPhysics();const a=new Arena({seed:91726,size:'city',mode:'debug',allowCheats:true,bots:0});
  try{
    a.addPlayer('qa','QA');const p=a.players.find(p=>p.id==='qa');
    assert.ok(a.debugTravel(p.id,'q3:fort'));
    for(let i=0;i<90;i++){a.input(p.id,{angle:0,pitch:0});a.step();}
    const ground=groundHeight(p.x,p.z,a.map);
    assert.ok(p.y>=ground-.12&&p.y<ground+.7,'ground chunks must catch the capsule after teleport');
    const stats=a.map.physicsStats031;
    assert.ok(stats&&stats.terrainChunks>0&&stats.terrainChunks<80);
    assert.ok(stats.active<stats.registered*.7,'distant static geometry must not all remain in Rapier');
    const wall=a.map.obstacles.find(o=>o.part==='wall'&&o.panel!==undefined&&o.building<a.map.tiles[0].buildings);
    assert.ok(wall&&a.colliders.has(wall));assert.deepEqual(a.colliders.get(wall),[]);
    const twinPanel=wall.panel+a.map.tiles[0].panels*3;
    const twin=a.map.obstacles.find(o=>o.panel===twinPanel);assert.ok(twin);
    a.damageObstacle(wall,1000000,p);
    assert.ok(!a.colliders.has(wall));assert.ok(a.destruction.panels.includes(wall.panel));
    assert.ok(a.colliders.has(twin),'destroying NW must not destroy the corresponding SE panel');
    const part=a.map.siteObjects.find(o=>o.detailCell&&!o.visual&&!o.roofShape&&o.prop!==undefined&&Math.hypot(o.x-p.x,o.z-p.z)>500);
    assert.ok(part);a.damageObstacle(part,1000000,p);
    assert.ok(!a.colliders.has(part));assert.ok(a.destruction.props.includes(part.prop));
    const feed=new NetFeed(),frame=feed.frame(a.snapshot()),packet=feed.packet(p.id,frame);packet.commit();
    const state=new Mirror().apply(JSON.parse(packet.text).state);
    assert.ok(state.destruction.panels.includes(wall.panel));assert.ok(state.destruction.props.includes(part.prop));
    assert.ok(a.debugTravel(p.id,'fort'));
    for(let i=0;i<8;i++){a.input(p.id,{angle:0,pitch:0});a.step();}
    assert.ok(a.map.physicsStats031.terrainChunks<80);
    assert.equal(a.nav.cost,undefined,'tiled navigation must not allocate a map-sized A* working array');
    console.log('PHYSICS031',JSON.stringify(a.map.physicsStats031));
  }finally{a.dispose();}
});

function smallMap(){
  const buildings=[{id:0,sourceId:0,x:0,z:0,w:10,d:8,h:3.6,storeys:0,roofBase:3.84,height:6,door:3.2,category:'home',type:'cottage',sign:'STREAM QA',color:0xb7c2b4,accent:0x7f8c73,panels:[0],upperPanels:[]}];
  const o={part:'wall',x:0,y:1.8,z:3.8,w:2.5,h:3.6,d:.4,panel:0,structural:true,building:0,face:'south',color:0xb7c2b4,hp:100};
  return {tiled:true,seed:91726,size:'city',limit:{x:1024,z:1024},maxTerrainHeight:.1,buildings,obstacles:[o],decor:[],doors:[],windows:[],trees:[],flora:[],parks:[],hills:[],rocks:[],cover:[],trash:[],waters:[],roads:[],paths:[],chests:[],siteObjects:[]};
}
test('actual Three: unloaded scenery reconstructs a damaged wall without a duplicate intact mesh',()=>{
  const map=smallMap(),scene=new T.Scene(),s=new StreamScenery(scene,map),sector=s.index.owner.get(0),wall=map.obstacles[0];
  try{
    s.load(sector);assert.ok(s.wallOf.has(0));
    damageCells(wall,[[0,1000]]);s.applyCells(wall,null);
    const first=s.resident.get(sector.key).scenery;assert.ok(first.cellSlots.has(0));
    s.unload(sector.key);assert.equal(s.wallOf.size,0);
    s.load(sector);const second=s.resident.get(sector.key).scenery;
    assert.ok(second.cellSlots.has(0));assert.equal(second.cellSlots.get(0).alive[0],0);
    const slot=second.wallOf.get(0),k=slot.batch.pos[slot.index];
    assert.ok(slot.batch.mat.subarray(k*16,k*16+16).every(v=>v===0),'intact wall must stay hidden after sector reload');
    scene.traverse(o=>{if(o.isMesh&&o.geometry.attributes.position)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));});
  }finally{s.dispose();}
  assert.equal(scene.children.length,0);
});

test('actual Three: streamed terrain allocates only local lattice chunks and releases their geometry',()=>{
  const map=smallMap(),view={scene:new T.Scene(),text:(label,w,h)=>new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:new T.Texture()}))};
  const stream=new StreamWorld(view,map),camera=new T.PerspectiveCamera(75,16/9,.15,500);camera.position.set(0,4,20);camera.lookAt(0,1,0);
  try{
    stream.update(camera,100);assert.ok(stream.ground.size>0&&stream.ground.size<=3);
    for(const m of stream.ground.values())assert.ok(m.geometry.attributes.position.count<=49*49);
    camera.position.set(800,4,800);stream.update(camera,100);
    assert.ok(stream.ground.size<=6);assert.ok(stream.entries.size<=2);
  }finally{stream.dispose();}
  assert.equal(view.scene.children.length,0);
});
