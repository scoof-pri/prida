import * as T from 'three';
import { CulledBatch } from './scenery.js';
import { detailMaterial } from './materials.js';
import { escalatorPose } from './landmark-geometry.js';
// All tread faces and yellow nosings are instanced. Distant/hidden escalators do not animate.
const geometry=new T.BoxGeometry(1,1,1);
export class EscalatorViews {
  constructor(parent,map,culler){
    this.map=map;this.culler=culler;this.root=new T.Group();this.root.name='escalators-034';parent.add(this.root);this.entries=[];
    this.batches=[new CulledBatch(geometry,detailMaterial('steel',0x86918e,{box:true,key:'escalator034',roughness:.38,metalness:.6})),
      new CulledBatch(geometry,new T.MeshStandardMaterial({color:0xe8bc49,roughness:.65}))];
    this.matrix=new T.Matrix4();
    for(const e of map.escalators||[]){const group=culler.room(e.building,e.storey),length=Math.hypot(e.to.x-e.from.x,e.to.z-e.from.z),count=Math.ceil(length/.36),items=[];
      for(let i=0;i<count;i++){const p=escalatorPose(e,i/count),m=this.matrix.makeScale(length/count-.012,.06,e.width-.08).setPosition(p.x,p.y+.015,p.z);const a=this.batches[0].add(m,null,group);const b=this.batches[1].add(this.matrix.makeScale(.030,.012,e.width-.08).setPosition(p.x+length/count/2-.022,p.y+.052,p.z),null,group);items.push({a,b});}
      this.entries.push({e,group,count,length,items,dead:false});
    }
    for(const b of this.batches)b.build(this.root,culler);
  }
  update(){
    for(const entry of this.entries){const {e,group,count,length,items}=entry,clock=e.clock034||0;
      if(e.gone){if(!entry.dead){for(const p of items){this.batches[0].hide(p.a);this.batches[1].hide(p.b);}entry.dead=true;}continue;}
      if(!this.culler.visible[group]&&!entry.dead)continue;
      const distance=Math.hypot(length,e.to.y-e.from.y),phase=(e.disabled?e.stoppedAt:clock)*e.speed/distance*e.direction;
      for(let i=0;i<count;i++){const p=escalatorPose(e,i/count,phase),part=items[i];
        this.batches[0].setMatrix(part.a,this.matrix.makeScale(length/count-.012,.06,e.width-.08).setPosition(p.x,p.y+.015,p.z));
        this.batches[1].setMatrix(part.b,this.matrix.makeScale(.030,.012,e.width-.08).setPosition(p.x+length/count/2-.022,p.y+.052,p.z));
      }entry.dead=false;
    }
    for(const b of this.batches)b.refill(this.culler.visible,this.culler.version);
  }
  dispose(){this.root.removeFromParent();for(const b of this.batches)b.mesh?.dispose();this.batches[1].material.dispose();}
}
