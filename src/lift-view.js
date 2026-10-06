import * as T from 'three';
import { CulledBatch } from './scenery.js';
import { detailMaterial } from './materials.js';
import { liftPoses } from './lift-system.js';
const geometry=new T.BoxGeometry(1,1,1);
// No per-lift lights or duplicated model textures. Frames share the scenery's instancing/culling.
export class LiftViews {
  constructor(parent,map,culler) {
    this.map=map;this.culler=culler;this.entries=[];this.root=new T.Group();this.root.name='lifts-033';parent.add(this.root);
    const metal=detailMaterial('steel',0x9aa5a4,{box:true,key:'lift-033',roughness:.32,metalness:.68});
    const floor=detailMaterial('tiles',0xe2ded0,{box:true,key:'lift-floor-033',roughness:.58});
    const light=new T.MeshStandardMaterial({color:0xf4f2de,emissive:0xf4f2de,emissiveIntensity:.65,roughness:.7});
    this.light=light;this.batches=[metal,floor,light].map(m=>new CulledBatch(geometry,m,{colors:false,shadow:false}));
    this.m=new T.Matrix4();
    for(const l of map.lifts||[]) {
      const group=culler.detail(l.building),items=[];
      for(const p of liftPoses(l)) {
        const batch=p.key==='floor'||p.kind==='sill'?1:0;
        const index=this.batches[batch].add(this.matrix(p),null,group);items.push({key:p.key,batch,index});
      }
      const lamp={x:l.x,y:l.y+2.35,z:l.z,w:l.w*.63,h:.025,d:.27};
      const lightIndex=this.batches[2].add(this.matrix(lamp),null,group);
      this.entries.push({lift:l,items,group,lightIndex,dead:false,y:NaN,open:NaN,floor:-1});
    }
    for(const b of this.batches)b.build(this.root,culler);
  }
  matrix(p){return this.m.makeScale(p.w,p.h,p.d).setPosition(p.x,p.y,p.z);}
  update() {
    for(const e of this.entries){const l=e.lift;
      const b=this.map.buildings[l.building],dead=l.broken||b?.collapsed||b?.fallenFrom!==undefined;
      if(dead){if(!e.dead){for(const p of e.items)this.batches[p.batch].hide(p.index);this.batches[2].hide(e.lightIndex);e.dead=true;}continue;}
      if(!e.dead&&e.y===l.y&&e.open===l.open&&e.floor===l.floor)continue;
      const poses=liftPoses(l);poses.forEach((p,i)=>{const q=e.items[i];this.batches[q.batch].setMatrix(q.index,this.matrix(p));});
      this.batches[2].setMatrix(e.lightIndex,this.matrix({x:l.x,y:l.y+2.35,z:l.z,w:l.w*.63,h:.025,d:.27}));
      e.y=l.y;e.open=l.open;e.floor=l.floor;e.dead=false;
    }
    for(const b of this.batches)b.refill(this.culler.visible,this.culler.version);
  }
  dispose(){this.root.removeFromParent();for(const b of this.batches)b.mesh?.dispose();this.light.dispose();}
}
