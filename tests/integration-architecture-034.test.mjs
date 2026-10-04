// Full-project gate: imports the ACTUAL Arena, map and pinned engine libraries. No substitutes here.
import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {Arena,initPhysics}from'../src/simulation.js';import{createWorld}from'../src/world.js';import{groundHeight,terrainRay}from'../src/terrain.js';
import{validateTiledMap}from'../src/world-tiles.js';import{validateLandmark}from'../src/landmark-geometry.js';
import{Scenery}from'../src/scenery.js';import{SiteViews}from'../src/expansion-view.js';import{sectorsOf}from'../src/world-sectors.js';
import{NetFeed,Mirror}from'../src/netcode.js';import{syncEscalators}from'../src/escalator-system.js';import{waterLevelAt}from'../src/landscape.js';
import {preloadSceneryModels,sceneryModelNames} from './scenery-assets-0351.mjs';
import {modelAsset,modelParts} from '../src/assets.js';
const advance=(a,p,n)=>{for(let i=0;i<n;i++){a.input(p.id,{angle:0,pitch:0,x:0,z:0});a.step();}};
test('0.34 full native city: distinct forms, floor openings, terrain, airfield clearance and copy identities',{timeout:180000},()=>{
 const m=createWorld(91726,'city');assert.ok(validateTiledMap(m));assert.equal(m.landmarks.length,16);assert.equal(m.escalators.length,16);assert.equal(m.terrainFeatures.length,32);
 for(const l of m.landmarks){const b=m.buildings[l.building];assert.ok(validateLandmark(m,b));assert.ok(m.lifts.some(e=>e.building===b.id));if(b.landmark034==='mall')assert.ok(m.decor.filter(d=>d.building===b.id).length>=12,'native mall shop furnishings');}
 const panels=new Set(m.obstacles.filter(o=>o.panel!==undefined).map(o=>o.panel));for(const e of m.escalators){assert.ok(m.obstacles.includes(e.ramp));assert.ok(m.obstacles.includes(e.motor));assert.ok(e.floorPanels.every(p=>panels.has(p)));}
 for(const e of m.expansions){const r=e.runway;assert.ok(!m.obstacles.some(o=>!o.nocollide&&o.part==='site'&&o.y+o.h/2>.7&&o.y-o.h/2<3&&Math.abs(o.x-r.x)<(o.w+r.w)/2&&Math.abs(o.z-r.z)<(o.d+r.d)/2),'runway is clear');}
 for(const f of m.terrainFeatures.filter(f=>f.kind==='lake')){assert.ok(groundHeight(f.x,f.z,m)<waterLevelAt(f.x,f.z,m)-.8);const h=terrainRay({x:f.x,y:20,z:f.z},{x:0,y:-1,z:0},50,m);assert.ok(Math.abs((20-h)-groundHeight(f.x,f.z,m))<.005);}
});
test('0.34 full Arena: standing passengers ride in both directions, motor destruction stops only that conveyor, snapshots preserve state',{timeout:180000},async()=>{
 await initPhysics();const a=new Arena({mode:'debug',size:'city',bots:0,allowCheats:true});
 try{a.addPlayer('esc-qa','QA');const p=a.players.find(p=>p.id==='esc-qa');p.cheats.god=true;
 for(const direction of[1,-1]){const e=a.map.escalators.find(e=>e.direction===direction&&e.storey===0),t=direction===1?.14:.82;
   a.place(p,e.from.x+(e.to.x-e.from.x)*t,e.from.z,e.from.y+(e.to.y-e.from.y)*t+.07);p.vy=0;const start={x:p.x,y:p.y};advance(a,p,180);
   assert.equal(p.escalator,e.id);assert.ok((p.x-start.x)*direction>1.3,`no transport ${direction}: ${p.x-start.x}`);assert.ok((p.y-start.y)*direction>.6);}
 const e=a.map.escalators[0];a.breakObstacle(e.motor,p);advance(a,p,1);assert.ok(e.disabled);assert.ok(!e.gone);assert.ok(!a.map.escalators[1].disabled);
 const feed=new NetFeed(),f=feed.frame(a.snapshot()),packet=feed.packet(p.id,f);packet.commit();const state=new Mirror().apply(JSON.parse(packet.text).state);
 const client={escalators:a.map.escalators.map(e=>({id:e.id}))};syncEscalators(client,state.escalators);assert.ok(client.escalators.find(r=>r.id===e.id).disabled);
 a.breakObstacle(e.ramp,p);advance(a,p,1);assert.ok(e.gone);
 }finally{a.dispose();}
});
test('0.34 actual Three.js: mall glass, tread animation and streamed scene disposal use finite geometry',{timeout:180000},async()=>{
 const m=createWorld(91726,'city'),b=m.buildings.find(b=>b.landmark034==='mall'),index=sectorsOf(m),part=index.subset(index.owner.get(b.id));
 // A Node test process starts with an empty model cache. Warm it from real,
 // staged GLBs before constructing any furniture, just as browser boot does.
 const assets = await preloadSceneryModels(part);
 assert.deepEqual(assets.names, sceneryModelNames(part));
 assert.ok(assets.names.length > 0, 'do not drop furniture from this gate');
 for (const name of assets.names) {
   assert.ok(modelAsset(name)?.scene, 'asset registered before scene creation: ' + name);
   assert.ok(modelParts(name).length > 0, 'actual parsed mesh parts: ' + name);
 }
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(65,16/9,.1,300);camera.position.set(b.x-15,12,b.z+23);camera.lookAt(b.x,4,b.z);camera.updateMatrixWorld();let scenery,sites;
 try{scenery=new Scenery(scene,part);const view={scene,scenery,camera,viewDistance:150};sites=new SiteViews(view,{...part,siteObjects:m.siteObjects.filter(o=>o.building===b.id)});scenery.cull(camera,150,true);
 syncEscalators(m,{clock:2.0,revision:0,states:[]});scenery.update(.016);assert.ok(scenery.escalatorViews.entries.length>=4);sites.update({destruction:{props:[],buildings:[],storeys:{}}});
 let count=0;scene.traverse(o=>{if(o.isMesh){count++;const p=o.geometry?.attributes?.position;if(p)assert.ok(p.array.every(Number.isFinite));}});assert.ok(count>5);
 for(const bt of scenery.escalatorViews.batches)if(bt.mat)assert.ok(bt.mat.every(Number.isFinite));
 const e=part.escalators[0];syncEscalators(m,{clock:2.1,revision:1,states:[[e.id,1,1,2.1]]});scenery.update(.016);assert.ok(scenery.escalatorViews.entries.find(r=>r.e===e).dead);
 }finally{sites?.dispose();scenery?.dispose();}
 assert.equal(scene.children.length,0);
});
