import test from 'node:test';import assert from 'node:assert/strict';
import {loadLift,withPlan,BUILDINGS} from './interior-fixture-033.mjs';
const {LiftSystem,nearLift,inLift,liftPoses,syncLifts}=await loadLift();
function setup(){const l={id:'lift-0',building:0,x:0,z:0,w:2.32,d:2.04,doorWidth:1.12,stops:[.08,3.875,7.475],panels:[10,11]};
 const a={map:{lifts:[l],buildings:[{}],obstacles:[]},players:[],bodies:new Map(),colliders:new Map(),events:[],destruction:{panels:[]},addCollider(o){this.colliders.set(o,{setTranslation(p){this.position=p;}})},removeObs(o){this.colliders.delete(o);const i=this.map.obstacles.indexOf(o);if(i>=0)this.map.obstacles.splice(i,1);}};
 a.lifts=new LiftSystem(a);return {a,l,p:addPlayer(a,l)};
}
function addPlayer(a,l,id='p',x=0,y=l.y,z=0){const p={id,x,y,z,hp:100,vy:0,grounded:true};a.players.push(p);a.bodies.set(id,{body:{setTranslation(){},setNextKinematicTranslation(){}}});return p;}
function tick(a,t){for(let i=0;i<Math.round(t*60);i++)a.lifts.step(1/60);}
test('closed landing gates exist on every floor without a car; initial cabin is open',()=>{const {l}=setup(),poses=liftPoses(l);for(let k=1;k<3;k++){const a=poses.find(o=>o.key==='gate'+k+':-1'),b=poses.find(o=>o.key==='gate'+k+':1');assert.ok(Math.abs(a.z-b.z)-a.d<1e-6);assert.ok(a.h>2.3);}assert.equal(poses.filter(p=>p.kind==='gate').length,6);});
test('a selected floor closes gates first, carries rider up, aligns and opens',()=>{const {a,l,p}=setup();assert.ok(a.lifts.use(p,2));assert.equal(l.phase,'closing');tick(a,.5);assert.equal(l.y,.08);tick(a,6);assert.equal(l.floor,2);assert.equal(l.y,7.475);assert.ok(Math.abs(p.y-l.y)<1e-6);assert.equal(l.open,1);});
test('descending carries both riders and retains the exact base stop without accumulating offsets',()=>{const {a,l,p}=setup(),q=addPlayer(a,l,'q',.50,.08,.2);for(let i=0;i<4;i++){a.lifts.use(p,2);tick(a,7);a.lifts.use(p,0);tick(a,7);}assert.ok(Math.abs(p.y-.08)<1e-6);assert.ok(Math.abs(q.y-.08)<1e-6);assert.equal(l.floor,0);});
test('jumping occupants are not pinned down to the cabin floor',()=>{const {a,l,p}=setup();a.lifts.use(p,2);tick(a,.9);p.vy=6;p.y=l.y+.4;const y=p.y;tick(a,.2);assert.equal(p.y,y);});
test('threshold obstruction reopens or holds gates and does not crush or move that player',()=>{const {a,l,p}=setup();const q=addPlayer(a,l,'q',-l.w/2-.03,.08,0);a.lifts.use(p,1);tick(a,2);assert.equal(l.y,.08);assert.equal(l.open,1);assert.equal(q.hp,100);q.x=-4;tick(a,4);assert.equal(l.floor,1);});
test('remote calls, vehicle drivers and dead players cannot control lifts',()=>{const {a,l,p}=setup();for(const extra of [{x:20},{vehicle:'v'},{hp:0},{inBus:true}])assert.equal(a.lifts.use({...p,...extra},1),false);for(const dest of [-1,30]){a.lifts.use(p,dest);tick(a,.4);assert.equal(l.phase,'idle');}});
test('floor selection is rejected outside the cabin but a local landing call works',()=>{const {a,l,p}=setup();p.x=-2.1;p.y=l.stops[2];assert.equal(nearLift(a.map,p).inside,false);a.lifts.use(p,1);assert.equal(l.phase,'idle');tick(a,.4);a.lifts.use(p);tick(a,6);assert.equal(l.floor,2);});
test('multiple landing calls queue unique stops within the shaft only',()=>{const {a,l,p}=setup();a.lifts.use(p,2);const q=addPlayer(a,l,'q',-2.1,l.stops[1],0);a.lifts.use(q);tick(a,12);assert.equal(l.floor,1);assert.equal(l.queue.length,0);});
test('replicated sparse snapshots reconstruct motion, ignored stale packets, broken lift removes collision',()=>{const {a,l,p}=setup(),client={lifts:[structuredClone({...l,parts:undefined})],obstacles:[]};assert.ok(syncLifts(client,a.lifts.snapshot()));assert.ok(client.obstacles.length>0);
 a.lifts.use(p,1);tick(a,1);const moving=a.lifts.snapshot();syncLifts(client,moving);const y=client.lifts[0].y;assert.ok(y>.08);assert.equal(syncLifts(client,{revision:0,states:[]}),false);assert.equal(client.lifts[0].y,y);
 a.lifts.damage(l.id,999);syncLifts(client,a.lifts.snapshot());assert.equal(client.obstacles.length,0);assert.equal(a.colliders.size,0);assert.ok(l.broken);});
test('shaft or building destruction disables movement immediately and releases occupants to gravity',()=>{for(const cause of ['shaft','collapse','storey']){const {a,l,p}=setup();a.lifts.use(p,2);tick(a,1);if(cause==='shaft')a.destruction.panels.push(10);if(cause==='collapse')a.map.buildings[0].collapsed=true;if(cause==='storey')a.map.buildings[0].fallenFrom=1;tick(a,.1);assert.ok(l.broken);assert.equal(a.colliders.size,0);assert.equal(p.lift,null);assert.ok(a.events.some(e=>e.type==='lift-broken'));}});
test('stationary lifts do not rebuild shapes or bump the state revision every frame',()=>{const {a,l}=setup(),parts=l.parts;tick(a,30);assert.equal(a.lifts.revision,0);assert.equal(l.parts,parts);assert.equal(a.colliders.size,parts.length);});
test('one blast applies one shared lift hit, not one hit per door and floor',async()=>{const fs=await import('node:fs');const raw=fs.readFileSync(new URL('../src/door-system.js',import.meta.url),'utf8');const fragment=raw.slice(raw.indexOf('export function applyBlastHits'));const {applyBlastHits}=await import('data:text/javascript;base64,'+Buffer.from('function damageDoor(){}\n'+fragment).toString('base64'));const {a,l}=setup();applyBlastHits(a,l.parts.map(o=>[o,75]),null);assert.equal(l.hp,325);});

test('large room populations use a local door index without dropping nearby candidates or mutations',async()=>{
 const fs=await import('node:fs');const raw=fs.readFileSync(new URL('../src/door-system.js',import.meta.url),'utf8');const start=raw.indexOf('export function doorCandidates');const end=raw.indexOf('export function nearestDoor',start);
 const {doorCandidates}=await import('data:text/javascript;base64,'+Buffer.from(raw.slice(start,end)).toString('base64'));
 const map={doors:Array.from({length:2500},(_,i)=>({id:i,x:(i%50-25)*12,z:(Math.floor(i/50)-25)*12}))};
 for(const p of [{x:0,z:0},{x:-16,z:-16},{x:31,z:33}]){const nearby=doorCandidates(map,p,2.7);assert.ok(nearby.length<20);for(const d of map.doors)if(Math.hypot(d.x-p.x,d.z-p.z)<=2.7)assert.ok(nearby.includes(d));}
 const before=map._doorBuckets033;doorCandidates(map,{x:0,z:0},2.7);assert.equal(map._doorBuckets033,before);
 const newDoor={id:2500,x:.2,z:.1};map.doors.push(newDoor);assert.ok(doorCandidates(map,{x:0,z:0},2.7).includes(newDoor));
});
