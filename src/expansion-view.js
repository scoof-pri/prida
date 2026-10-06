// Instanced, destructible base and villa props. Collision records are also the rendering source of truth.
import * as T from 'three';
import { CulledBatch } from './scenery.js';
import { detailMaterial, WORLD } from './materials.js';
export class SiteViews {
  constructor(view,map) {
    this.view=view;this.map=map;this.culler=view.scenery.culler;this.root=new T.Group();this.root.name='FORT NORTH / SOLARA / VISTA';view.scene.add(this.root);
    this.geometry=new T.BoxGeometry(1,1,1);this.batches=new Map();this.entries=[];this.unique=[];this.hullGeometries=[];this.ownedMaterials=[];
    const m=new T.Matrix4(),q=new T.Quaternion(),up=new T.Vector3(0,1,0),scale=new T.Vector3(),pos=new T.Vector3();
    const special=(surface)=>{
      if(surface==='sign')return new T.MeshStandardMaterial({color:0x354a40,roughness:.8});
      if(surface==='paint')return new T.MeshStandardMaterial({color:0xffffff,roughness:.85,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
      if(surface==='glass034')return new T.MeshStandardMaterial({color:0xb2ced0,transparent:true,opacity:.27,roughness:.12,metalness:.15,depthWrite:false,side:T.DoubleSide});
      if(surface==='light')return new T.MeshStandardMaterial({color:0xffffff,emissive:0xd2e6cf,emissiveIntensity:.8,roughness:.35});
      if(surface==='water') {
        const w=new T.MeshStandardMaterial({color:0x74bfcc,transparent:true,opacity:.80,roughness:.17,metalness:.24,depthWrite:false});
        w.onBeforeCompile=s=>{s.uniforms.siteTime=WORLD.time;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float siteTime;').replace('#include <begin_vertex>','#include <begin_vertex>\n transformed.y += sin(position.x*2.4+siteTime)*cos(position.z*1.7-siteTime*.6)*.008;');};
        w.customProgramCacheKey=()=> 'prida-pool-030';return w;
      }
      return detailMaterial(surface,0xffffff,{box:true,strength:.35,roughness:surface==='steel'?.55:.86,key:'site030'});
    };
    for(const o of map.siteObjects||[]) {
      const group=this.culler.outdoor(o.x,o.z),e={o,dead:false};
      if(o.surface==='sign' && typeof document !== 'undefined') {
        const c=document.createElement('canvas');c.width=1024;c.height=128;const x=c.getContext('2d');
        x.fillStyle='#263b36';x.fillRect(0,0,c.width,c.height);x.fillStyle='#e4dfc6';x.font='bold 48px Arial';x.textBaseline='middle';x.textAlign='center';x.fillText(o.label,512,64,980);
        const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;
        const mat=new T.MeshBasicMaterial({map:t,side:T.DoubleSide});this.ownedMaterials.push(mat);
        const mesh=new T.Mesh(new T.PlaneGeometry(o.w,o.h),mat);mesh.position.set(o.x,o.y,o.z);mesh.rotation.y=o.rot||0;this.root.add(mesh);e.mesh=mesh;e.texture=t;this.unique.push(mesh);
      } else if(o.roofShape) {
        const vertices=[],indices=[];
        for(const h of o.roofShape){const start=vertices.length/3;for(let i=0;i<h.vertices.length;i+=3)vertices.push(h.vertices[i]-o.x,h.vertices[i+1]-o.y,h.vertices[i+2]-o.z);indices.push(...h.indices.map(i=>i+start));}
        const key='hull:'+o.surface+':'+vertices.map(n=>n.toFixed(4)).join(',');let batch=this.batches.get(key);
        if(!batch){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();this.hullGeometries.push(g);
          const material=o.surface==='glass034'?special(o.surface):detailMaterial(o.surface,0xffffff,{strength:.45,roughness:.7,key:'site-hull-031'});if(o.surface==='glass034')this.ownedMaterials.push(material);
          batch=new CulledBatch(g,material,{colors:true,shadow:o.surface!=='glass034'});this.batches.set(key,batch);}
        m.makeTranslation(o.x,o.y,o.z);e.batch=batch;e.index=batch.add(m,o.color??0xffffff,group);
      } else {
        const key=o.surface;let batch=this.batches.get(key);
        if(!batch){const material=special(key);if(['paint','light','water','glass034','sign'].includes(key))this.ownedMaterials.push(material);batch=new CulledBatch(this.geometry,material,{colors:true,shadow:!o.visual});this.batches.set(key,batch);}
        m.compose(pos.set(o.x,o.y,o.z),q.setFromAxisAngle(up,o.rot||0),scale.set(o.w,o.h,o.d));
        e.batch=batch;e.index=batch.add(m,o.color??0xffffff,group);
      }
      this.entries.push(e);
    }
    for(const batch of this.batches.values())batch.build(this.root,this.culler);
  }
  update(state) {
    const gone=new Set(state.destruction?.props||[]),buildings=new Set(state.destruction?.buildings||[]),storeys=state.destruction?.storeys||{};
    const eye=this.view.camera.position,far=this.view.viewDistance||250;
    const signature=[...gone].join(',')+'|'+[...buildings].join(',')+'|'+JSON.stringify(storeys);
    const changed=signature!==this._damageSignature;this._damageSignature=signature;
    for(const e of this.entries){if(!changed&&!e.mesh)continue;const o=e.o;const dead=(o.prop!==undefined&&gone.has(o.prop))||(o.building!==undefined&&(buildings.has(o.building)||(storeys[o.building]??Infinity)<=(o.storey||0)));
      if(dead&&!e.dead){e.dead=true;e.batch?.hide(e.index);}
      if(e.mesh)e.mesh.visible=!dead&&Math.hypot(o.x-eye.x,o.z-eye.z)<far;
    }
    for(const b of this.batches.values())b.refill(this.culler.visible,this.culler.version);
  }
  dispose(){this.root.removeFromParent();for(const b of this.batches.values())b.mesh?.dispose();this.geometry.dispose();for(const m of this.unique)m.geometry.dispose();for(const g of this.hullGeometries)g.dispose();for(const e of this.entries)e.texture?.dispose();for(const m of this.ownedMaterials)m.dispose();}
}
