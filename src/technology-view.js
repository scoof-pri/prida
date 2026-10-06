// PRIDA 0.40 client presentation for server-authoritative construction, NOVA technology and FPV drones.
import * as T from 'three';
import { constructionObstacle, constructionTarget, validateConstruction, BUILD_KINDS, BUILD_MATERIALS } from './construction.js';
import { moduleModel, droneModel, bombModel, suitRocketModel, vehicleModuleModel, disposeTech } from './technology-models.js';
import { poseSuitFirstPerson } from './suit-view.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
function hullGeometry(shape, origin={x:0,y:0,z:0}){
  const a=new Float32Array(shape.vertices.length);
  for(let i=0;i<shape.vertices.length;i+=3){a[i]=shape.vertices[i]-origin.x;a[i+1]=shape.vertices[i+1]-origin.y;a[i+2]=shape.vertices[i+2]-origin.z;}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(a,3));g.setIndex(shape.indices);g.computeVertexNormals();return g;
}
function pieceGeometry(kind,rotation){
  const p={id:'preview',owner:'preview',kind,rotation,material:0,x:0,y:0,z:0,hp:100,maxHp:100,built:1},o=constructionObstacle(p);
  if(o.roofShape?.length){const gs=o.roofShape.map(s=>hullGeometry(s,p));if(gs.length===1)return gs[0];
    // These construction shapes currently contain one convex hull. Keep a safe fallback if that changes.
    const root=new T.Group();for(const g of gs)root.add(new T.Mesh(g));return root;
  }
  const g=new T.BoxGeometry(o.w,o.h,o.d);g.translate(o.x-p.x,o.y-p.y,o.z-p.z);return g;
}
function makeMaterial(spec,preview=false){
  return new T.MeshStandardMaterial({color:spec.color,roughness:spec.id==='metal'?.48:.82,metalness:spec.id==='metal'?.55:.05,
    transparent:preview,opacity:preview?.44:1,depthWrite:!preview,side:T.DoubleSide});
}
function constructionMesh(piece,preview=false){
  const spec=BUILD_MATERIALS[piece.material]||BUILD_MATERIALS[0],g=pieceGeometry(piece.kind,piece.rotation||0),root=new T.Group();
  if(g?.isBufferGeometry){const m=new T.Mesh(g,makeMaterial(spec,preview));m.castShadow=!preview;m.receiveShadow=true;root.add(m);}
  else if(g?.isGroup){for(const child of [...g.children]){child.material=makeMaterial(spec,preview);child.castShadow=!preview;child.receiveShadow=true;root.add(child);}}
  root.position.set(piece.x,piece.y,piece.z);root.userData.material=spec;return root;
}
function setPreviewColor(root,ok){root.traverse(o=>{if(!o.isMesh)return;o.material.color.setHex(ok?0x70e6a8:0xf06b64);o.material.emissive?.setHex(ok?0x123b2e:0x4b1717);o.material.emissiveIntensity=.45;});}
function pointCylinder(mesh,a,b){const start=new T.Vector3(a.x,a.y,a.z),end=new T.Vector3(b.x,b.y,b.z),d=end.clone().sub(start),len=d.length();
  mesh.position.copy(start).add(end).multiplyScalar(.5);mesh.scale.set(1,Math.max(.001,len),1);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());}
export class TechnologyViews{
  constructor(view,map){this.view=view;this.map=map;this.root=new T.Group();this.root.name='prida-technology';view.scene.add(this.root);
    this.builds=new Map();this.items=new Map();this.drones=new Map();this.bombs=new Map();this.suitRockets=new Map();this.vehicleModules=new Map();this.beams=[];this.preview=null;this.previewKey='';
    this.beamGeo=new T.CylinderGeometry(.018,.035,1,6);this.beamMat=new T.MeshBasicMaterial({color:0x74f1ee,toneMapped:false,transparent:true,opacity:.95});
  }
  syncBuilds(list=[]){const live=new Set();for(const p of list){if(!p||p.hp<=0||!BUILD_KINDS.includes(p.kind))continue;live.add(p.id);let e=this.builds.get(p.id);
      const key=[p.kind,p.rotation,p.material].join(':');if(!e||e.key!==key){if(e){e.root.removeFromParent();e.root.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.();});}
        const root=constructionMesh(p,false);this.root.add(root);e={root,key};this.builds.set(p.id,e);}e.root.position.set(p.x,p.y,p.z);
      const built=clamp(p.built??1,0,1),hp=clamp(p.hp/Math.max(1,p.maxHp||p.hp||1),0,1);e.root.scale.y=.22+.78*built;
      e.root.traverse(o=>{if(o.isMesh){o.material.opacity=.48+.52*Math.min(built,hp+.25);o.material.transparent=o.material.opacity<.995;}});
    }for(const[id,e]of this.builds)if(!live.has(id)){e.root.removeFromParent();e.root.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.();});this.builds.delete(id);}}
  syncItems(list=[],dt=0,menu=false){const live=new Set();for(const item of list){if(!item?.available||typeof item.id!=='string')continue;live.add(item.id);let e=this.items.get(item.id);
      if(!e){const root=moduleModel(item.kind);root.scale.setScalar(item.kind==='aegis'?.82:item.kind==='fpv'?1.15:.72);this.root.add(root);e={root,phase:Math.random()*Math.PI*2};this.items.set(item.id,e);}
      e.root.position.set(item.x,item.y+.12+Math.sin((this.view.clockT||0)*1.7+e.phase)*.06,item.z);e.root.rotation.y=(e.root.rotation.y+dt*.42)%(Math.PI*2);e.root.visible=!menu;
    }for(const[id,e]of this.items)if(!live.has(id)){disposeTech(e.root);this.items.delete(id);}}
  syncDrones(list=[],dt=0,menu=false){const live=new Set();for(const d of list){if(!d||d.hp<=0)continue;live.add(d.id);let e=this.drones.get(d.id);
      if(!e){const root=droneModel();root.scale.setScalar(1.35);this.root.add(root);e={root};this.drones.set(d.id,e);}e.root.visible=!menu;e.root.position.set(d.x,d.y,d.z);e.root.rotation.set(-d.pitch,d.angle,d.roll||0,'YXZ');
      for(const r of e.root.userData.rotors||[])r.rotation.y=(r.rotation.y+dt*52)%(Math.PI*2);
    }for(const[id,e]of this.drones)if(!live.has(id)){disposeTech(e.root);this.drones.delete(id);}}
  syncBombs(list=[],dt=0,menu=false){const live=new Set();for(const b of list){if(!b?.id)continue;live.add(b.id);let e=this.bombs.get(b.id);
      if(!e){const root=bombModel();root.scale.setScalar(.88);this.root.add(root);e={root};this.bombs.set(b.id,e);}e.root.visible=!menu;e.root.position.set(b.x,b.y,b.z);
      const v=new T.Vector3(b.vx||0,b.vy||-1,b.vz||0);if(v.lengthSq()>.001)e.root.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),v.normalize());e.root.rotateZ(dt*2.2);
    }for(const[id,e]of this.bombs)if(!live.has(id)){disposeTech(e.root);this.bombs.delete(id);}}
  syncSuitRockets(list=[],dt=0,menu=false){const live=new Set();for(const r of list){if(!r?.id)continue;live.add(r.id);let e=this.suitRockets.get(r.id);
      if(!e){const root=suitRocketModel();this.root.add(root);e={root,trail:0};this.suitRockets.set(r.id,e);}
      e.root.visible=!menu;e.root.position.set(r.x,r.y,r.z);
      const velocity=new T.Vector3(r.vx||r.dx||0,r.vy||r.dy||0,r.vz||r.dz||1);if(velocity.lengthSq()>.001)e.root.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),velocity.normalize());
      if(e.root.userData.flame)e.root.userData.flame.scale.y=.85+.2*Math.sin((this.view.clockT||0)*43);
      e.trail+=dt;if(!menu&&e.trail>(this.view.fx?.lite?.1:.045)){e.trail=0;this.view.fx?.emit(r,{x:-velocity.x*.8,y:.15-velocity.y*.8,z:-velocity.z*.8},0xa7adb1,.075,.42,{drag:1.2});}
    }for(const[id,e]of this.suitRockets)if(!live.has(id)){disposeTech(e.root);this.suitRockets.delete(id);}}
  syncVehicleModules(state){const live=new Set();for(const v of state.vehicles||[]){const key=['ram','turbo','bomb'].filter(k=>v.mods?.[k]).join('+');if(!key)continue;
      const entry=this.view.vehicleViews?.entries.get(v.id);if(!entry)continue;live.add(v.id);let e=this.vehicleModules.get(v.id);if(!e||e.key!==key){if(e)disposeTech(e.root);const root=vehicleModuleModel(v);entry.model.add(root);e={root,key};this.vehicleModules.set(v.id,e);}e.root.visible=entry.model.visible;
      if(v.boosting&&entry.model.visible&&Math.random()<.6){const f={x:-Math.sin(v.angle),y:0,z:-Math.cos(v.angle)};this.view.fx?.emit({x:v.x+f.x*(v.bodyD||5)*.45,y:v.y+.75,z:v.z+f.z*(v.bodyD||5)*.45},{x:f.x*5,y:.2,z:f.z*5},0x60edf0,.16,.25,{drag:2});}
    }for(const[id,e]of this.vehicleModules)if(!live.has(id)){disposeTech(e.root);this.vehicleModules.delete(id);}}
  updatePreview(state,id,buildUI){if(this.preview){this.preview.visible=false;}if(!buildUI?.mode)return;const p=state.players?.find(q=>q.id===id);if(!p||p.hp<=0||p.vehicle||p.droneId)return;
    const key=[buildUI.type,buildUI.rotation,buildUI.material].join(':');if(!this.preview||key!==this.previewKey){if(this.preview){this.preview.removeFromParent();this.preview.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.();});}
      const dummy={id:'preview',kind:BUILD_KINDS[buildUI.type]||'wall',rotation:buildUI.rotation||0,material:buildUI.material||0,x:0,y:0,z:0,hp:1,maxHp:1,built:1};
      this.preview=constructionMesh(dummy,true);this.root.add(this.preview);this.previewKey=key;}
    const candidate=constructionTarget(this.map,p,BUILD_KINDS[buildUI.type]||'wall',buildUI.rotation||0,buildUI.material||0),reason=validateConstruction(this.map,p,candidate,state.constructions||[],state.players||[]);
    this.preview.visible=true;this.preview.position.set(candidate.x,candidate.y,candidate.z);setPreviewColor(this.preview,!reason);this.preview.userData.reason=reason||'';this.preview.userData.candidate=candidate;
  }
  update(state,id,dt,menu=false,buildUI=null){this.syncBuilds(state.constructions);this.syncItems(state.labItems,dt,menu);this.syncDrones(state.drones,dt,menu);this.syncBombs(state.bombs,dt,menu);this.syncSuitRockets(state.suitRockets,dt,menu);this.syncVehicleModules(state);this.updatePreview(state,id,buildUI);
    if(!menu)poseSuitFirstPerson(this.view,state.players?.find(p=>p.id===id),dt);
    for(let i=this.beams.length-1;i>=0;i--){const b=this.beams[i];b.life-=dt;b.mesh.material.opacity=Math.max(0,b.life/b.max);if(b.life<=0){b.mesh.removeFromParent();b.mesh.material.dispose();this.beams.splice(i,1);}}
  }
  event(e){if(e.type==='tech-shot'){const avatar=this.view.people?.get(e.id);if(avatar){if(e.beam)avatar.suitBeamT=.25;else avatar.suitShotT=.25;}if(!e.beam&&e.id===this.view.localId&&this.view.fpAegisHands)this.view.fpAegisHands.userData.pulse=.12;}if(e.type==='tech-shot'&&e.from&&e.to){const mat=this.beamMat.clone();mat.color.setHex(e.beam?0x82ffff:0xffd27a);const mesh=new T.Mesh(this.beamGeo,mat);pointCylinder(mesh,e.from,e.to);if(e.beam)mesh.scale.x=mesh.scale.z=2.3;this.root.add(mesh);const life=e.beam?0.16:0.07;this.beams.push({mesh,life,max:life});}
    if(e.type==='build-placed')this.view.fx?.burst({x:e.x,y:e.y+.4,z:e.z},5,0xa69b83,.12,.35,true,1.4);
    if(e.type==='build-break')this.view.fx?.burst(e,12,e.color||0x9b8d75,.18,.75,false,2.2);
    if(e.type==='drone-launch')this.view.fx?.burst(e,5,0x7de1df,.08,.22,false,1.1);
    if(e.type==='drone-end')this.view.fx?.burst(e,e.exploded?18:5,e.exploded?0xff9f5a:0x7de1df,.18,e.exploded?.8:.22,true,e.exploded?2.8:1.2);
    if(e.type==='bomb-release')this.view.fx?.burst(e,4,0xe0a45a,.09,.2,false,1.0);
    if(e.type==='suit-rocket-launch')this.view.fx?.burst(e,5,0xffc582,.055,.22,false,1.4);
    if(e.type==='suit-rocket-end'&&!e.impact)this.view.fx?.burst(e,5,0xfed3a3,.08,.3,false,1.3);
    if(e.type==='suit-takeoff'&&e.ground)this.view.fx?.burst(e,9,0xb5b0a6,.13,.5,true,2.1);
  }
  dispose(){for(const m of [this.builds,this.items,this.drones,this.bombs,this.suitRockets])for(const e of m.values()){if(e.root)disposeTech(e.root);}for(const e of this.vehicleModules.values())disposeTech(e.root);if(this.preview){this.preview.removeFromParent();this.preview.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.();});}
    for(const b of this.beams){b.mesh.removeFromParent();b.mesh.material.dispose();}this.beamGeo.dispose();this.beamMat.dispose();this.root.removeFromParent();}
}
