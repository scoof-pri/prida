import { ViewActivity, sectorBounds } from './activity-window.js';
// Resident scenery sectors share one culling horizon. Destruction is replayed from the authoritative map.
import { Scenery } from './scenery.js';
import { Culler } from './culling.js';
import { Nature } from './nature.js';
import { groundHeight } from './terrain.js';
import { sectorsOf,sectorDistance } from './world-sectors.js';
const TABLES=['buildingPanels','uppers','wallOf','windowOf'];
export class StreamScenery {
  constructor(scene,map){
    this.scene=scene;this.map=map;this.index=sectorsOf(map);this.resident=new Map();this.hiddenDecor=new Set();
    this.culler=new Culler({...map,doors:map.doors.filter(d=>d.kind!=='inner')});this.streamed=true;this.tick=0;this.activity=new ViewActivity();
    for(const k of TABLES)this[k]=new Map();
  }
  get rubble(){return [...this.resident.values()].flatMap(e=>e.scenery.rubble);}
  load(s){
    groundHeight(s.x,s.z,this.map); // initialise the shared hill lookup before making a sector view
    const sub=this.index.subset(s),scenery=new Scenery(this.scene,sub,this.culler),nature=new Nature(sub,scenery);
    for(const o of sub.obstacles)if(o.panel!==undefined&&o.cells&&!['roof'].includes(o.part))scenery.applyCells(o,null,true);
    for(const id of this.map.applied?.wrecks||[])if(scenery.byDecor.has(id))scenery.wreck(id);
    for(const id of this.hiddenDecor)scenery.hideDecor(id);
    for(const b of s.buildings){
      if(this.map.appliedRoofs?.has(b.id))scenery.breakRoof(b);
      const fallen=this.map.appliedStoreys?.get(b.id);if(fallen!==undefined)scenery.collapseStorey(b,fallen,false);
      if(b.collapsed||this.map.applied?.buildings?.has(b.id)){scenery.collapse(b,false);if(this.map._ramRubbleSeen?.has(b.id))for(const mesh of scenery.rubble)if(mesh.userData.rubbleBuilding===b.id){mesh.visible=false;mesh.userData.appear=0;}}
    }
    for(const k of TABLES)for(const [id,value] of scenery[k])this[k].set(id,value);
    this.resident.set(s.key,{s,scenery,nature,last:this.tick});this.culler.dirty=true;
  }
  unload(key){const e=this.resident.get(key);if(!e)return;for(const k of TABLES)for(const [id,value] of e.scenery[k])if(this[k].get(id)===value)this[k].delete(id);e.scenery.dispose();this.resident.delete(key);}
  cull(camera,view=250,force=false){
    this.tick++;this.activity.begin(camera);this.activity.memory.prune();
    const radius=Math.min(600,view)+72;
    const near=this.index.near(camera.position,radius).filter(s=>this.activity.needed(s.key,sectorBounds(s)));
    const missing=near.filter(s=>!this.resident.has(s.key));
    const budget=this.map._streamFrameBudget;if(budget)budget.pending.scenery=missing.length;
    let builds=0;
    for(const s of missing)if(builds<1){const load=()=>{this.load(s);builds++;};if(budget)budget.run('scenery',load);else load();}
    for(const [key,e]of this.resident){
      if(!this.activity.recent(key)){this.unload(key);this.activity.forget(key);continue;}
      e.scenery.root.visible=this.activity.visible(sectorBounds(e.s));
    }
    camera.updateMatrixWorld();this.culler.update(camera,view,force||builds>0);
    for(const e of this.resident.values())if(e.scenery.root.visible)
      for(const b of e.scenery.batches.values())b.refill(this.culler.visible,this.culler.version);
    this.map.renderStats031={residentSectors:this.resident.size,totalSectors:this.index.sectors.size,pending:missing.length-builds,retentionSeconds:5};
  }
  call(name,...args){let result;for(const e of this.resident.values()){const value=e.scenery[name](...args);if(value!==undefined)result=value;}return result;}
  standingCells(id){for(const e of this.resident.values())if(e.scenery.wallOf.has(id))return e.scenery.standingCells(id);return [];}
  applyCells(o,previous,initial){for(const e of this.resident.values())if(e.scenery.wallOf.has(o.panel))return e.scenery.applyCells(o,previous,initial);return {removed:[],glass:null};}
  hidePanel(id){this.call('hidePanel',id);}
  hideDecor(id){this.hiddenDecor.add(id);this.map.hiddenVehicleDecor??=new Set();this.map.hiddenVehicleDecor.add(id);this.call('hideDecor',id);}
  hideProp(id){this.call('hideProp',id);for(const e of this.resident.values())e.nature.hide(id);}
  hideNature(id){for(const e of this.resident.values())e.nature.hide(id);}
  wreck(id,fx){this.call('wreck',id,fx);}
  breakRoof(b){this.call('breakRoof',b);}
  roofBlocks(b){for(const e of this.resident.values())if(e.scenery.uppers.has(b.id))return e.scenery.roofBlocks(b);return [];}
  collapseStorey(b,k,animate){this.culler.markDamaged(b.id);this.call('collapseStorey',b,k,animate);}
  panelsFrom(b,k){return [...this.resident.values()].flatMap(e=>e.scenery.panelsFrom(b,k));}
  collapse(b,animate){this.culler.markDamaged(b.id);const s=this.index.owner.get(b.id),e=s&&this.resident.get(s.key);if(e)e.scenery.collapse(b,animate);}
  update(dt,fx){for(const e of this.resident.values())e.scenery.update(dt,fx);}
  dispose(){for(const key of [...this.resident.keys()])this.unload(key);for(const k of TABLES)this[k].clear();}
}
