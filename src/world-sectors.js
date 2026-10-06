// Shared spatial ownership, independent of renderer/physics libraries.
export const SECTOR_SIZE=96;
export const sectorKey=(x,z)=>Math.floor(x/SECTOR_SIZE)+':'+Math.floor(z/SECTOR_SIZE);
export function sectorDistance(s,p){return Math.hypot(Math.max(0,Math.abs(p.x-s.x)-s.w/2),Math.max(0,Math.abs(p.z-s.z)-s.d/2));}
export class SectorIndex {
  constructor(map){
    this.map=map;this.sectors=new Map();this.owner=new Map();
    const get=(x,z)=>{const key=sectorKey(x,z);if(!this.sectors.has(key)){const [ix,iz]=key.split(':').map(Number);this.sectors.set(key,{key,x:(ix+.5)*SECTOR_SIZE,z:(iz+.5)*SECTOR_SIZE,w:SECTOR_SIZE,d:SECTOR_SIZE,buildings:[],obstacles:[],decor:[],windows:[],doors:[],lifts:[],interiorDetails:[],escalators:[],trees:[],rocks:[],cover:[],flora:[],trash:[],roads:[],paths:[],waters:[]});}return this.sectors.get(key);};
    this.get=get;
    for(const b of map.buildings){const s=get(b.x,b.z);s.buildings.push(b);this.owner.set(b.id,s);}
    const owned=o=>this.owner.get(o.building)||get(o.x,o.z);
    for(const o of map.obstacles)owned(o).obstacles.push(o);
    for(const k of ['decor','doors','lifts','interiorDetails','escalators','rocks','cover','flora','trash','waters'])for(const o of map[k]||[])owned(o)[k].push(o);
    const panelBuilding=new Map(map.obstacles.filter(o=>o.panel!==undefined).map(o=>[o.panel,o.building]));
    for(const w of map.windows||[])(this.owner.get(panelBuilding.get(w.panel))||get(w.x,w.z)).windows.push(w);
    for(const [i,t] of map.trees.entries())get(t[0],t[1]).trees.push([i,t]);
    // Long paved surfaces are clipped at sector boundaries so no duplicated coplanar triangles are drawn.
    for(const k of ['roads','paths'])for(const r of map[k]||[]){
      const x0=r.x-r.w/2,x1=r.x+r.w/2,z0=r.z-r.d/2,z1=r.z+r.d/2;
      for(let ix=Math.floor(x0/SECTOR_SIZE);ix<=Math.floor((x1-1e-6)/SECTOR_SIZE);ix++)for(let iz=Math.floor(z0/SECTOR_SIZE);iz<=Math.floor((z1-1e-6)/SECTOR_SIZE);iz++){
        const a=Math.max(x0,ix*SECTOR_SIZE),b=Math.min(x1,(ix+1)*SECTOR_SIZE),c=Math.max(z0,iz*SECTOR_SIZE),d=Math.min(z1,(iz+1)*SECTOR_SIZE);
        get((a+b)/2,(c+d)/2)[k].push({...r,axisX031:r.w>r.d,paint031:r.w!==r.d,x:(a+b)/2,z:(c+d)/2,w:b-a,d:d-c});
      }
    }
  }
  near(p,r=300){
    const old=this._near;if(old&&old.r===r&&Math.hypot(p.x-old.x,p.z-old.z)<4)return old.items;
    const items=[];
    for(let x=Math.floor((p.x-r)/SECTOR_SIZE);x<=Math.floor((p.x+r)/SECTOR_SIZE);x++)
      for(let z=Math.floor((p.z-r)/SECTOR_SIZE);z<=Math.floor((p.z+r)/SECTOR_SIZE);z++){
        const s=this.sectors.get(x+':'+z);if(s&&sectorDistance(s,p)<=r)items.push(s);
      }
    items.sort((a,b)=>sectorDistance(a,p)-sectorDistance(b,p)||a.key.localeCompare(b.key));
    this._near={x:p.x,z:p.z,r,items};return items;
  }
  subset(s){
    const m=this.map;
    if(this.liveSize!==m.obstacles.length||this.liveVersion!==(m.obstacleVersion||0)){this.liveSize=m.obstacles.length;this.liveVersion=m.obstacleVersion||0;this.live=new Set(m.obstacles);}
    const obstacles=s.obstacles.filter(o=>this.live.has(o));
    const dead=m.applied||{},treeIds=new Set(obstacles.filter(o=>o.part==='tree').map(o=>o.tree));
    const renderDecor=s.decor.filter(d=>!dead.decor?.has(d.id)&&!m.hiddenVehicleDecor?.has(d.id)&&!(d.building!==undefined&&m.buildings[d.building]?.collapsed));
    return {...m,renderBuildings:s.buildings,renderDecor,obstacles,windows:s.windows.filter(w=>!dead.panels?.has(w.panel)),doors:s.doors,lifts:s.lifts,interiorDetails:s.interiorDetails,escalators:s.escalators,
      treeEntries:s.trees.filter(([i])=>treeIds.has(i)),rocks:s.rocks.filter(o=>this.live.has(o)),cover:s.cover.filter(o=>this.live.has(o)),flora:s.flora,trash:s.trash};
  }
}
export function sectorsOf(map){return map._sectors031??=new SectorIndex(map);}
