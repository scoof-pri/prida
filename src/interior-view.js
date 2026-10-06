// Wayfinding and fittings share one batch per finish, resident only with the building's scenery sector.
import * as T from 'three';
import { furnitureFittings } from './interior-fittings.js';
import { CulledBatch } from './scenery.js';
import { detailMaterial } from './materials.js';
import { WALL_H } from './interior-plan.js';
import { cellIndexAt } from './cells.js';
const box=new T.BoxGeometry(1,1,1),plane=new T.PlaneGeometry(1,1),mouse=new T.SphereGeometry(.5,10,6),cup=new T.LatheGeometry([[.42,0],[.50,.08],[.50,.98],[.43,1],[.42,.12],[0,.12],[0,0]].map(p=>new T.Vector2(...p)),12).translate(0,-.5,0);
const names={workspace:'WORKSPACE',office:'PRIVATE OFFICE',meeting:'MEETING ROOM',bathroom:'WC / WASHROOM',kitchen:'KITCHEN',bedroom:'BEDROOM',living:'LIVING ROOM',lounge:'RESIDENT LOUNGE'};
const signs=new Map();
function signMaterial(key) {
  if(signs.has(key))return signs.get(key);
  if(typeof document==='undefined'){const m=new T.MeshStandardMaterial({color:0x243638,roughness:.75});signs.set(key,m);return m;}
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
  const c=canvas.getContext('2d');c.fillStyle='#243638';c.fillRect(0,0,512,96);c.fillStyle='#dbc89b';c.fillRect(0,0,10,96);
  c.fillStyle='#f4efdf';c.font='bold 27px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(names[key]||key,260,49,470);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  const m=new T.MeshStandardMaterial({map:texture,roughness:.75,side:T.DoubleSide});signs.set(key,m);return m;
}
export class InteriorViews {
  constructor(parent,map,culler){this.map=map;this.culler=culler;this.batches=new Map();this.entries=[];this.root=new T.Group();parent.add(this.root);
    this.m=new T.Matrix4();this.q=new T.Quaternion();this.up=new T.Vector3(0,1,0);
    const lamp=new T.MeshStandardMaterial({color:0xf1eddd,emissive:0xf1eddd,emissiveIntensity:.48,roughness:.8});this.lamp=lamp;
    const trim=detailMaterial('oak',0xae9272,{box:true,key:'interior-trim033',roughness:.62});
    const fittingMats={keyboard:detailMaterial('steel',0x24302f,{box:true,key:'keyboard033',roughness:.8}),keys:detailMaterial('steel',0xa5b1ac,{box:true,key:'keys033',roughness:.9}),paper:detailMaterial('fabric',0xe0d9c8,{box:true,key:'paper033',roughness:.95}),mirror:new T.MeshStandardMaterial({color:0xc6d4d4,metalness:.95,roughness:.12}),ceramic:detailMaterial('tiles',0xf1eadf,{box:true,key:'ceramic033',roughness:.36}),oak:trim};
    this.mirror=fittingMats.mirror;
    const vent=detailMaterial('steel',0x78827e,{box:true,key:'interior-vent033',roughness:.48,metalness:.35});
    const batch=(key,geo,mat)=>{if(!this.batches.has(key))this.batches.set(key,new CulledBatch(geo,mat,{shadow:false}));return this.batches.get(key);};
    const add=(list,key,geo,mat,group,x,y,z,w,h,d,rot=0)=>{
      const b=batch(key,geo,mat),matrix=this.m.compose(new T.Vector3(x,y,z),this.q.setFromAxisAngle(this.up,rot),new T.Vector3(w,h,d));
      list.push({b,index:b.add(matrix,null,group)});
    };
    fittingMats.metal=vent;fittingMats.mouse=fittingMats.keyboard;
    for(const d of map.renderDecor||map.decor||[])if(d.building!==undefined&&map.buildings[d.building]?.interiorPlan){
      const items=[],group=culler.room(d.building,d.storey);for(const p of furnitureFittings(d))add(items,'fit-'+p.kind,p.kind==='ceramic'?cup:p.kind==='mouse'?mouse:box,fittingMats[p.kind],group,p.x,p.y,p.z,p.w,p.h,p.d,p.rot);
      if(items.length)this.entries.push({items,decor:d.id,room:{building:d.building,storey:d.storey||0},label:[],dead:false});
    }
    for(const building of map.renderBuildings||map.buildings)if(building.interiorPlan?.kind==='residential'&&building.storeys>0){
      const items=[],g=culler.room(building.id,0),z=building.z-building.d/2+.49;
      const support=map.obstacles.find(o=>o.building===building.id&&o.part==='wall'&&(o.storey||0)===0&&o.face==='north'&&Math.abs(o.x-(building.x+building.door/2+.70))<o.w/2);
      for(let row=0;row<2;row++)for(let col=0;col<3;col++){
        const x=building.x+building.door/2+.4+col*.31,y=.64+row*.25;
        add(items,'mail-body',box,vent,g,x,y,z,.28,.23,.15);
        add(items,'mail-panel',box,trim,g,x,y,z+.083,.254,.20,.012);
        add(items,'mail-slot',box,fittingMats.keyboard,g,x,y+.042,z+.092,.17,.012,.006);
      }
      this.entries.push({items,panel:support,room:{building:building.id,storey:0},label:[],dead:false});
    }
    for(const r of map.interiorDetails||[]) {
      const b=map.buildings[r.building];if(!b)continue;const group=culler.room(r.building,r.storey),items=[];
      const ceiling=map.obstacles.find(o=>o.part==='roof'&&o.building===b.id&&o.storey===r.storey);
      add(items,'ceiling-lights',box,lamp,group,r.x,r.y+WALL_H(r.storey)-.06,r.z,Math.min(1.1,r.w*.4),.028,.22);
      if(r.purpose==='bathroom'||r.purpose==='kitchen') {
        add(items,'vent',box,vent,group,r.x,r.y+WALL_H(r.storey)-.09,r.z-.75,.36,.08,.36);
      }
      const entry=r.entrance,[x0,z0,x1,z1]=r.roomBounds;
      let x=b.x+(entry.side==='e'?x1:entry.side==='w'?x0:entry.at),z=b.z+(entry.side==='n'?z0:entry.side==='s'?z1:entry.at);
      const rot=entry.side==='e'?Math.PI/2:entry.side==='w'?-Math.PI/2:entry.side==='n'?Math.PI:0;
      x+=Math.sin(rot)*.082;z+=Math.cos(rot)*.082;
      const label=[];add(label,'sign-'+r.purpose,plane,signMaterial(r.purpose),group,x,r.y+2.61,z,1.17,.22,1,rot);
      const door=map.doors.find(d=>d.building===b.id&&d.storey===r.storey&&Math.hypot(d.x-x,d.z-z)<.22);
      this.entries.push({items,room:r,ceiling,door,label,dead:false,labelDead:false});
    }
    for(const o of map.obstacles)if(o.interior033&&!o.interiorHeader&&!o.liftShaft){
      const list=[],g=culler.room(o.building,o.storey);
      add(list,'skirting',box,trim,g,o.x,o.y-o.h/2+.09,o.z,o.w+.024,.17,o.d+.024);
      this.entries.push({items:list,panel:o,room:{building:o.building,storey:o.storey},label:[],dead:false});
    }
    for(const bt of this.batches.values())bt.build(this.root,culler);
  }
  update() {
    const dead=this.map.applied?.panels;
    for(const e of this.entries) {
      const b=this.map.buildings[e.room.building],fallen=b?.collapsed||(b?.fallenFrom??Infinity)<=e.room.storey;
      let gone=fallen||(e.panel&&dead?.has(e.panel.panel))||(e.decor!==undefined&&this.map.applied?.decor.has(e.decor));
      if(e.ceiling)gone ||= dead?.has(e.ceiling.panel)||this.map.appliedRoofs?.has(e.room.building)||
        (e.ceiling.cells&&e.ceiling.cells[cellIndexAt(e.ceiling,{x:e.room.x,y:e.ceiling.y,z:e.room.z})]===0);
      if(gone&&!e.dead){for(const p of e.items)p.b.hide(p.index);e.dead=true;}
      if((fallen||e.door?.hp<=0)&&!e.labelDead){for(const p of e.label)p.b.hide(p.index);e.labelDead=true;}
    }
    for(const b of this.batches.values())b.refill(this.culler.visible,this.culler.version);
  }
  dispose(){this.root.removeFromParent();for(const b of this.batches.values())b.mesh?.dispose();this.lamp.dispose();this.mirror.dispose();}
}
