// Bounded visual shards. They do not add dozens of physical colliders to every destroyed wall.
import * as T from 'three';
import { groundHeight } from './terrain.js';
import { objectSurface } from './materials.js';
export class DetailDebris {
  constructor(scene,map){this.map=map;this.limit=128;this.live=[];this.geo=new T.IcosahedronGeometry(1,0);this.mat=objectSurface(new T.MeshStandardMaterial({roughness:.92}),{surface:'concrete',size:.8,strength:.55,normal:.5});this.mesh=new T.InstancedMesh(this.geo,this.mat,this.limit);this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);this.mesh.count=0;this.mesh.frustumCulled=false;this.mesh.receiveShadow=true;scene.add(this.mesh);this.temp=new T.Object3D();this.color=new T.Color();}
  event(e){if(e.type!=='break'||!['site','partition','wall','glass'].includes(e.kind))return;
    const count=e.kind==='glass'?6:Math.min(14,5+Math.ceil((e.w||1)*(e.h||1)));
    for(let k=0;k<count;k++){if(this.live.length===this.limit)this.live.shift();const a=k*2.39996;
      this.live.push({x:e.x+(Math.random()-.5)*Math.min(e.w||1,2),y:e.y,z:e.z+(Math.random()-.5)*Math.min(e.d||.2,1),vx:Math.cos(a)*(1+Math.random()*2),vy:1.3+Math.random()*3,vz:Math.sin(a)*(1+Math.random()*2),life:1.1+Math.random(),scale:.06+Math.random()*.10,angle:a,color:e.color??0x9e9b89});}
  }
  update(dt){dt=Math.max(0,Math.min(dt,.05));const live=[];
    for(const p of this.live){p.life-=dt;if(p.life<=0)continue;p.vy-=13*dt;p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=p.vy*dt;p.angle+=dt*4;
      const floor=groundHeight(p.x,p.z,this.map)+p.scale*.5;if(p.y<floor){p.y=floor;p.vy=Math.abs(p.vy)*.20;p.vx*=.55;p.vz*=.55;}
      const i=live.length,fade=Math.min(1,p.life/.25);this.temp.position.set(p.x,p.y,p.z);this.temp.rotation.set(p.angle,p.angle*.6,p.angle*.4);this.temp.scale.set(p.scale*1.5*fade,p.scale*.6*fade,p.scale*fade);this.temp.updateMatrix();this.mesh.setMatrixAt(i,this.temp.matrix);this.mesh.setColorAt(i,this.color.setHex(p.color));live.push(p);
    }
    this.live=live;this.mesh.count=live.length;if(live.length){this.mesh.instanceMatrix.needsUpdate=true;this.mesh.instanceColor.needsUpdate=true;}
  }
  dispose(){this.mesh.removeFromParent();this.mesh.dispose();this.geo.dispose();this.mat.dispose();}
}
