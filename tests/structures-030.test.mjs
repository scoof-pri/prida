import test from 'node:test';
import assert from 'node:assert/strict';
import {stepSiteStructures,addExpansionProps} from '../src/expansion-world.js';
import {addExpansionPlots} from '../src/expansion-plan.js';
function setup(){
 const map={limit:{x:128,z:101},plots:[],paths:[],buildings:[],obstacles:[],chests:[],decor:[]};
 addExpansionPlots(map);addExpansionProps(map);let id=0;for(const o of map.obstacles)o.prop=id++;
 const a={map,colliders:new Map(map.obstacles.map(o=>[o,{}])),destruction:{props:[],buildings:[]},broken:[],breakObstacle(o){this.colliders.delete(o);this.destruction.props.push(o.prop);this.broken.push(o);}};
 return a;
}
test('hangar roof segments lose their physical support together when one required wall is destroyed',()=>{
 const a=setup(),g=a.map.siteGroups[0];assert.ok(g.parts.length===12);
 stepSiteStructures(a);assert.ok(g.parts.every(p=>a.colliders.has(p)));
 a.breakObstacle(g.supports[0]);stepSiteStructures(a);assert.ok(g.parts.every(p=>!a.colliders.has(p)));assert.equal(g.fallen,true);
 const n=a.broken.length;stepSiteStructures(a);assert.equal(a.broken.length,n);
});
test('a guard platform retains two supports, then collapses when only one remains',()=>{
 const a=setup(),g=a.map.siteGroups.find(g=>g.supports.length===4);
 a.breakObstacle(g.supports[0]);a.breakObstacle(g.supports[1]);stepSiteStructures(a);assert.ok(!g.fallen);
 a.breakObstacle(g.supports[2]);stepSiteStructures(a);assert.ok(g.fallen);assert.ok(g.parts.every(o=>a.destruction.props.includes(o.prop)));
});
test('separate decorative site records are not given physical colliders',()=>{
 const a=setup();for(const o of a.map.siteObjects)if(o.visual)assert.equal(a.colliders.has(o),false);
});

test('villa collapse removes owned site colliders as well as their visible meshes',()=>{
 const a=setup(),o=a.map.siteObjects.find(o=>!o.visual);o.building=0;a.map.buildings=[{id:0,collapsed:false}];
 stepSiteStructures(a);assert.ok(a.colliders.has(o));
 a.map.buildings[0].collapsed=true;a.destruction.buildings.push(0);stepSiteStructures(a);
 assert.equal(a.colliders.has(o),false);assert.ok(a.destruction.props.includes(o.prop));
});
