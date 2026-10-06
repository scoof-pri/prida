import { ViewActivity, sectorBounds, regionBounds } from './activity-window.js';
// Terrain, roads, floors and signs use bounded near-camera geometry, with separate ownership from scenery.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { detailMaterial,makeGround,makeWater } from './materials.js';
import { groundHeight,terrainNormal } from './terrain.js';
import { sectorsOf,sectorDistance } from './world-sectors.js';
import { cutRect } from './architecture-geometry.js';
export class StreamWorld {
  constructor(view,map){
    this.view=view;this.map=map;this.index=sectorsOf(map);this.entries=new Map();this.ground=new Map();this.root=new T.Group();this.root.name='streamed-world-031';this.activity=new ViewActivity();view.scene.add(this.root);this.material=null;
    this.floor={home:detailMaterial('wood',0xc9ab86,{box:true,roughness:.6}),office:detailMaterial('wood',0xb8a58c,{box:true,roughness:.6}),shop:detailMaterial('tiles',0xd8d2c4,{box:true,roughness:.5}),industry:detailMaterial('concrete',0xb8b6ad,{box:true})};
    this.mats={asphalt:detailMaterial('asphalt',0x7d8a87,{box:true}),sidewalk:detailMaterial('sidewalk',0xb0b5a1,{box:true}),curb:detailMaterial('concrete',0xc9c5ba,{box:true}),dirt:detailMaterial('dirt',0xaa9576,{box:true}),paving:detailMaterial('paving',0xd9d2bd,{box:true}),paint:detailMaterial('asphalt',0xf2eee2,{box:true,albedo:0,key:'031-paint'})};
    this.mats.paint.polygonOffset=true;this.mats.paint.polygonOffsetFactor=-1;this.mats.paint.polygonOffsetUnits=-1;
    view.signs=new Map();view.waters=[];
    const boundaryMaterial=this.mats.curb;
    for(const z of [-map.limit.z,map.limit.z]){const m=new T.Mesh(new T.BoxGeometry(map.limit.x*2,2,.25),boundaryMaterial);m.position.set(0,1,z);this.root.add(m);}
    for(const x of [-map.limit.x,map.limit.x]){const m=new T.Mesh(new T.BoxGeometry(.25,2,map.limit.z*2),boundaryMaterial);m.position.set(x,1,0);this.root.add(m);}
  }
  build(s){
    const group=new T.Group(),batches=new Map(),signs=[],waters=[];
    const add=(x,y,z,w,h,d,mat)=>{const geo=new T.BoxGeometry(w,h,d).translate(x,y,z);if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(geo);};
    for(const r of s.roads){add(r.x,.03,r.z,r.w,.06,r.d,this.mats.asphalt);const along=r.axisX031??(r.w>r.d),length=along?r.w:r.d,center=along?r.x:r.z,lo=center-length/2,hi=center+length/2;
      // The dash phase is anchored in world space; clipping a road must not rotate or duplicate its paint.
      if((r.paint031??(r.w!==r.d))&&Math.min(r.w,r.d)<=8)for(let t=Math.floor(lo/3)*3;t<hi;t+=3){const a=Math.max(lo,t),b=Math.min(hi,t+1.4);if(b-a>.01)add(along?(a+b)/2:r.x,.063,along?r.z:(a+b)/2,along?b-a:.14,.006,along?.14:b-a,this.mats.paint);}
    }
    for(const r of s.paths)add(r.x,.035,r.z,r.w,.04,r.d,r.color===0xaa9576?this.mats.dirt:this.mats.paving);
    for(const b of s.buildings){
      for(const r of cutRect({x:b.x,z:b.z,w:b.w+2,d:b.d+2},[{x:b.x,z:b.z,w:b.w-.4,d:b.d-.4}]))add(r.x,.012,r.z,r.w,.025,r.d,this.mats.sidewalk);
      for(const q of [-1,1]){add(b.x,.04,b.z+q*(b.d/2+1),b.w+2.2,.08,.2,this.mats.curb);add(b.x+q*(b.w/2+1),.04,b.z,.2,.08,b.d+1.8,this.mats.curb);}
      if (!b.landmark034) add(b.x,.025,b.z,b.w-.4,.04,b.d-.4,this.floor[b.category]||this.floor.home);
      const sign=this.view.text(b.sign.toUpperCase(),Math.min(b.w-1,5),.52);sign.position.set(b.x,3.25,b.z+b.d/2+.04);sign.visible=!b.collapsed;group.add(sign);signs.push([b.id,sign]);this.view.signs.set(b.id,sign);
    }
    for(const o of s.obstacles)if(o.part==='pond')add(o.x,o.y,o.z,o.w,o.h,o.d,this.mats.paving);
    for(const w of s.waters){const mesh=makeWater(w);group.add(mesh);waters.push(mesh);this.view.waters.push(mesh);}
    for(const [mat,parts] of batches){const geo=mergeGeometries(parts,false);for(const p of parts)p.dispose();if(geo){geo.computeBoundingSphere();const mesh=new T.Mesh(geo,mat);mesh.receiveShadow=true;group.add(mesh);}}
    this.root.add(group);this.entries.set(s.key,{group,s,signs,waters});
  }
  remove(key){const e=this.entries.get(key);if(!e)return;e.group.removeFromParent();
    for(const [id,sign] of e.signs){if(this.view.signs.get(id)===sign)this.view.signs.delete(id);sign.material.map.dispose();sign.material.dispose();}
    for(const w of e.waters){const i=this.view.waters.indexOf(w);if(i>=0)this.view.waters.splice(i,1);w.material.dispose();}
    e.group.traverse(o=>o.isMesh&&o.geometry.dispose());this.entries.delete(key);
  }
  update(camera,view=250){
    this.activity.begin(camera);this.activity.memory.prune();
    const p=camera.position,r=Math.min(600,view)+72,near=this.index.near(p,r).filter(s=>this.activity.needed('s:'+s.key,sectorBounds(s)));let work=0;
    const budget=this.map._streamFrameBudget;if(budget)budget.pending.world=near.filter(s=>!this.entries.has(s.key)).length;
    for(const s of near)if(!this.entries.has(s.key)&&work<1){const build=()=>{this.build(s);work++;};if(budget)budget.run('world',build);else build();}
    for(const [key,e]of this.entries){
      if(!this.activity.recent('s:'+key)){this.remove(key);this.activity.forget('s:'+key);}
      else e.group.visible=this.activity.visible(sectorBounds(e.s));
    }
    // Ground is sampled a region at a time instead of allocating a map-wide mesh and then splitting it.
    const span=96,L=this.map.limit,want=[];
    const x0=Math.max(-L.x,Math.floor((p.x-r+L.x)/span)*span-L.x),z0=Math.max(-L.z,Math.floor((p.z-r+L.z)/span)*span-L.z);
    for(let z=z0;z<Math.min(L.z,p.z+r);z+=span)for(let x=x0;x<Math.min(L.x,p.x+r);x+=span){const b={key:x+':'+z,x0:x,z0:z,x1:Math.min(L.x,x+span),z1:Math.min(L.z,z+span)};
      if(this.activity.needed('g:'+b.key,regionBounds(b)))want.push(b);
    }
    want.sort((a,b)=>Math.hypot((a.x0+a.x1)/2-p.x,(a.z0+a.z1)/2-p.z)-Math.hypot((b.x0+b.x1)/2-p.x,(b.z0+b.z1)/2-p.z));work=0;
    if(budget)budget.pending.ground=want.filter(b=>!this.ground.has(b.key)).length;
    for(const b of want)if(!this.ground.has(b.key)&&work<1){
      const build=()=>{work++;
      const mesh=makeGround(this.map,b);
      if(this.material){mesh.material.dispose();mesh.material=this.material;}else this.material=mesh.material;
      const attr=mesh.geometry.attributes.position,nrm=mesh.geometry.attributes.normal;
      for(let i=0;i<attr.count;i++){const n=terrainNormal(attr.getX(i),attr.getZ(i),this.map);nrm.setXYZ(i,n.x,n.y,n.z);}nrm.needsUpdate=true;
      mesh.geometry.computeBoundingSphere();mesh.userData.bounds031=b;this.root.add(mesh);this.ground.set(b.key,mesh);
      };if(budget)budget.run('ground',build);else build();
    }
    for(const [key,mesh] of this.ground){const b=mesh.userData.bounds031;if(!this.activity.recent('g:'+key)){mesh.removeFromParent();mesh.geometry.dispose();this.ground.delete(key);this.activity.forget('g:'+key);}else mesh.visible=this.activity.visible(regionBounds(b));}
  }
  dispose(){for(const key of [...this.entries.keys()])this.remove(key);for(const mesh of this.ground.values()){mesh.removeFromParent();mesh.geometry.dispose();}this.ground.clear();this.material?.dispose();this.root.traverse(o=>{if(o.isMesh)o.geometry.dispose();});this.root.removeFromParent();}
}
