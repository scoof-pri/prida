// PRIDA 0.29: instanced doors with panel relief, frames, metal hinges and handles on both sides.
import * as T from 'three';
import { CulledBatch } from './scenery.js';
import { objectSurface } from './materials.js';
import { doorPoses, leafBounds } from './architecture-geometry.js';
export class DoorViews {
  constructor(parent,map,culler) {
    this.map=map;this.culler=culler;this.entries=[];
    this.root=new T.Group();this.root.name='interactive-doors';parent.add(this.root);
    this.geometry=new T.BoxGeometry(1,1,1);
    this.materials=[
      objectSurface(new T.MeshStandardMaterial({roughness:0.62}),{surface:'oak',size:0.8,strength:0.45,normal:0.6,albedo:0.2}),
      objectSurface(new T.MeshStandardMaterial({roughness:0.72}),{surface:'plaster',size:1.1,strength:0.22,normal:0.35}),
      objectSurface(new T.MeshStandardMaterial({roughness:0.28,metalness:0.82}),{surface:'steel',size:0.25,strength:0.25,normal:0.25})];
    this.batches=this.materials.map(m=>new CulledBatch(this.geometry,m,{colors:true,shadow:true}));
    this.m=new T.Matrix4();this.q=new T.Quaternion();this.up=new T.Vector3(0,1,0);
    for(const d of map.doors) {
      const group=d.kind==='inner'?culler.room(d.building,d.storey||0):culler.detail(d.building);
      const e={door:d,group,t:0,swing:1,frames:[],leaves:[],dead:false};
      const base=d.axis==='z'?-Math.PI/2:0,c=Math.cos(base),s=Math.sin(base),height=d.h||2.55,y=d.y??1.3;
      const put=(batch,x,yy,z,w,h,depth,color,list)=>{
        const pose={x:d.x+c*x+s*z,y:yy,z:d.z-s*x+c*z,yaw:base};
        list.push({batch,index:this.add(batch,pose,w,h,depth,color,group),matrix:this.matrix(pose,w,h,depth).clone()});
      };
      const frameColor=0xe4dcca;
      for(const side of [-1,1])put(1,side*(d.w/2+0.035),y,0,0.075,height+0.12,0.19,frameColor,e.frames);
      put(1,0,y+height/2+0.065,0,d.w+0.15,0.1,0.19,frameColor,e.frames);
      // Front and back architraves stand proud of the wall; no coincident paint/brick faces.
      const wallDepth=d.kind==='inner'?0.14:0.4;
      for(const face of [-1,1]) {
        for(const side of [-1,1])put(1,side*(d.w/2+0.035),y,face*(wallDepth/2+0.028),0.11,height+0.12,0.045,frameColor,e.frames);
        put(1,0,y+height/2+0.065,face*(wallDepth/2+0.028),d.w+0.18,0.10,0.045,frameColor,e.frames);
      }
      put(2,0,(d.floorY??y-height/2)+0.011,0,d.w,0.018,wallDepth+0.1,0x9b9e9b,e.frames);
      const poses=doorPoses(d);
      poses.forEach((p,k)=>{
        const items=[],wood=d.color??[0x8c6342,0x61726c,0x80604b,0x69727a][d.building%4];
        const add=(batch,local,w,h,t,color)=>{
          const part={batch,local,w,h,t,color,index:-1};
          part.index=this.add(batch,this.localPose(p,local),w,h,t,color,group);items.push(part);
        };
        add(0,[0,0,0],p.w,p.h,p.t,wood);
        for(const side of [-1,1]) {
          for(const yy of [-0.58,0.53])add(0,[0,yy,side*(p.t/2+0.011)],Math.max(0.25,p.w-0.20),0.74,0.018,wood);
          const hand=-p.side*(p.w/2-0.14);
          add(2,[hand,-0.08,side*(p.t/2+0.025)],0.055,0.15,0.035,0xb9bbb8);
          add(2,[hand+p.side*0.055,-0.045,side*(p.t/2+0.065)],0.17,0.032,0.035,0xb9bbb8);
        }
        for(const yy of [-0.85,0.8])add(2,[p.side*(p.w/2-0.015),yy,0],0.045,0.13,p.t+0.018,0x6f7274);
        e.leaves.push(items);
      });
      // Visibility bounds include both possible swing directions, not only the closed leaf.
      for(const swing of [-1,1])for(const pose of doorPoses(d,1,swing)) {
        const b=leafBounds(pose);
        culler.extendBox(group,new T.Box3().setFromCenterAndSize(new T.Vector3(b.x,b.y,b.z),new T.Vector3(b.w+0.2,b.h+0.2,b.d+0.2)));
      }
      this.entries.push(e);
    }
    for(const batch of this.batches)batch.build(this.root,culler);
  }
  localPose(p,local) {
    const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    return {x:p.x+c*local[0]+s*local[2],y:p.y+local[1],z:p.z-s*local[0]+c*local[2],yaw:p.yaw};
  }
  matrix(p,w,h,t) {return this.m.compose(new T.Vector3(p.x,p.y,p.z),this.q.setFromAxisAngle(this.up,p.yaw),new T.Vector3(w,h,t));}
  add(b,p,w,h,t,color,g) {return this.batches[b].add(this.matrix(p,w,h,t),color,g);}
  update(dt) {
    for(const e of this.entries) {
      const d=e.door;
      if(d.hp<=0) {
        if(!e.dead){for(const f of e.frames)this.batches[f.batch].hide(f.index);for(const leaf of e.leaves)for(const p of leaf)this.batches[p.batch].hide(p.index);e.dead=true;}
        continue;
      }
      if(e.dead) {
        for(const f of e.frames)this.batches[f.batch].setMatrix(f.index,f.matrix);
        e.dead=false;e.t=-1; // a new round on the same seed restores the complete leaf below
      }
      const target=d.t||0;
      if(e.t===target && e.swing===d.swing)continue;
      e.t=dt>0 && e.t>=0?T.MathUtils.damp(e.t,target,30,dt):target;
      if(Math.abs(e.t-target)<0.002)e.t=target;
      e.swing=d.swing;
      doorPoses(d,e.t,e.swing).forEach((pose,k)=>{
        for(const p of e.leaves[k])this.batches[p.batch].setMatrix(p.index,this.matrix(this.localPose(pose,p.local),p.w,p.h,p.t));
      });
    }
    for(const b of this.batches)b.refill(this.culler.visible,this.culler.version);
  }
  dispose() {this.root.removeFromParent();for(const b of this.batches)b.mesh?.dispose();this.geometry.dispose();for(const m of this.materials)m.dispose();}
}
