import { ViewActivity, regionBounds } from './activity-window.js';
import * as T from 'three';
import { waterMeshRegion } from './landscape.js';
import { groundHeight } from './terrain.js';
import { WORLD } from './materials.js';
// Water shares the terrain's global lattice. Only nearby feature-bearing chunks allocate geometry.
export class LandscapeWaterViews {
  constructor(view,map){
    this.map=map;this.view=view;this.entries=new Map();this.root=new T.Group();this.root.name='rivers-lakes-034';this.activity=new ViewActivity();view.scene.add(this.root);
    this.material=new T.MeshStandardMaterial({color:0x4f8d91,roughness:.24,metalness:.22,transparent:true,opacity:.82,depthWrite:false,side:T.DoubleSide});
    this.material.onBeforeCompile=s=>{s.uniforms.landscapeTime=WORLD.time;
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWater034;').replace('#include <begin_vertex>','#include <begin_vertex>\nvWater034=position;');
      s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWater034;uniform float landscapeTime;').replace('#include <color_fragment>','#include <color_fragment>\nfloat wave034=sin(vWater034.x*1.1+vWater034.z*.43+landscapeTime*.9)*sin(vWater034.z*1.5-landscapeTime*.6);\ndiffuseColor.rgb*=.94+.08*wave034;');};
    this.material.customProgramCacheKey=()=> 'landscape-water034';
    this.chunks=new Map();const S=64,L=map.limit;
    for(const f of map.terrainFeatures||[])if(f.kind!=='mountain'){const r=f.bounds;
      for(let x=Math.floor((r.x-r.w/2+L.x)/S)*S-L.x;x<r.x+r.w/2;x+=S)for(let z=Math.floor((r.z-r.d/2+L.z)/S)*S-L.z;z<r.z+r.d/2;z+=S)if(x>=-L.x&&z>=-L.z&&x<L.x&&z<L.z)this.chunks.set(x+':'+z,{x0:x,z0:z,x1:Math.min(L.x,x+S),z1:Math.min(L.z,z+S)});
    }
  }
  update(camera,view=250){
    this.activity.begin(camera);this.activity.memory.prune();
    const p=camera.position,R=Math.min(view,600)+75,want=[...this.chunks].filter(([key,b])=>Math.hypot((b.x0+b.x1)/2-p.x,(b.z0+b.z1)/2-p.z)<R&&this.activity.needed(key,regionBounds(b))).sort(([,a],[,b])=>Math.hypot(a.x0-p.x,a.z0-p.z)-Math.hypot(b.x0-p.x,b.z0-p.z));
    if(this.map._streamFrameBudget)this.map._streamFrameBudget.pending.water=want.filter(([key])=>!this.entries.has(key)).length;
    let work=0;for(const [key,b] of want)if(!this.entries.has(key)&&work<1){const build=()=>{work++;const data=waterMeshRegion(this.map,b,groundHeight);const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(data.vertices,3));g.setIndex(new T.BufferAttribute(data.indices,1));g.computeVertexNormals();g.computeBoundingSphere();const m=new T.Mesh(g,this.material);m.renderOrder=2;this.root.add(m);this.entries.set(key,{m,b});};const budget=this.map._streamFrameBudget;if(budget)budget.run('water',build);else build();}
    for(const [key,{m,b}]of this.entries){if(!this.activity.recent(key)){m.removeFromParent();m.geometry.dispose();this.entries.delete(key);this.activity.forget(key);}else m.visible=this.activity.visible(regionBounds(b));}
  }
  dispose(){for(const {m}of this.entries.values())m.geometry.dispose();this.entries.clear();this.material.dispose();this.root.removeFromParent();}
}
