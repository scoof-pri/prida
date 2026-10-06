import { RocketRack, RocketFlights } from './rocket-view.js';
import { VehicleCameraState } from './vehicle-camera.js';
import { VehicleMotionTrack, VehiclePresentationClock } from './vehicle-motion.js';
// Vehicle meshes, recoil, propellers, tracks, capped tracers and a collision-aware follow camera.
import * as T from 'three';
import { vehicleModel,animateVehicle,disposeVehicleModel } from './vehicle-models.js';
import { VEHICLES,vehicleSpec,vehicleDimensions,helicopterGunPose,angleDelta,clamp,direction } from './vehicle-specs.js';
import { modelAsset } from './assets.js';
import { castMap } from './raycast.js';
import { groundHeight } from './terrain.js';
export class VehicleViews {
  constructor(view,map) {
    this.view=view;this.map=map;this.entries=new Map();this.tracers=[];this.rounds=new Map();this.fxClock=0;
    this.root=new T.Group();this.root.name='vehicles';view.scene.add(this.root);
    this.rocketFlights=new RocketFlights(this.root,view.fx);
    this.tracerGeometry=new T.CylinderGeometry(.02,.02,1,5);this.shellGeometry=new T.SphereGeometry(.09,6,4);
    this.tracerMaterial=new T.MeshBasicMaterial({color:0xffe49e,toneMapped:false});this.shellMaterial=new T.MeshBasicMaterial({color:0xffce77,toneMapped:false});
    this.followCamera=new VehicleCameraState();this.aimClock=0;this.presentation=new VehiclePresentationClock();
    this.up=new T.Vector3(0,1,0);this.dir=new T.Vector3();this.cam=new T.Vector3();
  }
  update(state,id,dt,menu,look) {
    const live=new Set(),me=state.players.find(p=>p.id===id);this.fxClock+=dt;
    const sampleTime=this.presentation.update(state,dt);
    const vehicles=this.map.vehicles||state.vehicles||[];
    const far=(this.view.viewDistance||250)+35;
    const eye=me?.vehicle?vehicles.find(v=>v.id===me.vehicle):this.view.camera.position;
    for(const v of vehicles) {
      if(v.crushed) {
        if(v.decor!==undefined&&!this.hiddenDecor?.has(v.decor)){this.hiddenDecor??=new Set();this.view.scenery?.hideDecor(v.decor);this.hiddenDecor.add(v.decor);}
        continue;
      }
      const parked=v.decor!==undefined && v.active===false && v.hp>0;
      if(parked&&!this.hiddenDecor?.has(v.decor))continue; // parked street cars remain in the existing instanced scenery batches
      const range=Math.hypot(v.x-(eye?.x||0),v.z-(eye?.z||0));
      if(range>far+70 && v.driver!==id) {
        // Once activated, a vehicle never exposes its original parked copy again.
        if(v.decor!==undefined&&!this.hiddenDecor?.has(v.decor)) {this.hiddenDecor??=new Set();this.view.scenery?.hideDecor(v.decor);this.hiddenDecor.add(v.decor);}
        continue;
      }
      live.add(v.id);let e=this.entries.get(v.id);
      if(!e) {
        const asset=v.model?modelAsset('decor-'+v.model)?.scene:null,model=vehicleModel(v.kind,asset,v);
        this.root.add(model);e={model,x:v.x,y:v.y,z:v.z,angle:v.angle,turret:v.turret,barrel:v.barrel,pitch:v.pitch||0,roll:v.roll||0,dead:false};this.entries.set(v.id,e);
        e.rack=new RocketRack(model,v);
        if(v.decor!==undefined){this.view.scenery?.hideDecor(v.decor);this.hiddenDecor??=new Set();this.hiddenDecor.add(v.decor);}
      }
      if(!e.track||e.generation!==sampleTime.generation){e.track=new VehicleMotionTrack();e.generation=sampleTime.generation;}
      e.track.push(v,sampleTime.source);
      if(e.track.discontinuity&&v.driver===id)this.followCamera.reset();
      Object.assign(e,e.track.at(sampleTime.time));
      e.model.position.set(e.x,e.y,e.z);e.model.rotation.set(-e.pitch,e.angle,e.roll,'YXZ');
      e.model.visible=!menu&&range<far;
      if(v.hp<=0&&!e.dead){e.dead=true;e.tinted=[];e.model.traverse(o=>{if(!o.isMesh)return;const src=Array.isArray(o.material)?o.material:[o.material];const dst=src.map(m=>{const c=m.clone();c.color?.multiplyScalar(.24);if(c.emissive)c.emissive.setHex(0);e.tinted.push(c);return c;});o.material=Array.isArray(o.material)?dst:dst[0];});}
      e.rack?.update({...v,angle:e.angle,turret:e.turret,barrel:e.barrel});
      if(e.model.visible)animateVehicle(e.model,{...v,angle:e.angle,turret:e.turret,barrel:e.barrel,pitch:e.pitch,roll:e.roll},dt);
      const shadows=e.model.visible&&(v.driver===id||range<45);
      if(e.shadows!==shadows){e.shadows=shadows;e.model.traverse(o=>{if(o.isMesh)o.castShadow=shadows;});}
      if(this.fxClock>.10 && e.model.visible) {
        if(v.hp>0&&v.hp<vehicleSpec(v).hp*.3)this.view.fx?.burst({x:v.x,y:v.y+1.5,z:v.z},1,0x444b48,.65,1.5,true,.45);
        if(v.kind==='car'&&v.drifting)this.view.fx?.burst({x:v.x,y:v.y+.2,z:v.z},2,0xa6aaa2,.2,.5,true,.6);
        if(v.kind!=='plane'&&v.kind!=='helicopter'&&!v.airborne&&Math.abs(v.speed)>3)this.view.fx?.event({type:'step',x:v.x-Math.sin(v.angle)*1.6,y:v.y,z:v.z-Math.cos(v.angle)*1.6,color:0xb0a58c});
      }
    }
    if(this.fxClock>.10)this.fxClock=0;
    for(const [key,e] of this.entries)if(!live.has(key)){e.rack?.dispose();e.model.removeFromParent();disposeVehicleModel(e.model);for(const m of e.tinted||[])m.dispose();this.entries.delete(key);}
    this.updateRounds((state.vehicleShots||[]).filter(r=>r.weapon!=='rocket'));
    this.rocketFlights.update(state.vehicleShots||[],dt,this.view.camera.position,menu);
    for(let i=this.tracers.length-1;i>=0;i--){const t=this.tracers[i];t.life-=dt;if(t.life<=0){t.mesh.removeFromParent();this.tracers.splice(i,1);}}
    if(me?.vehicle&&!menu) {
      for(const p of state.players)if(p.vehicle){const person=this.view.people.get(p.id);if(person)person.root.visible=false;}
      const v=vehicles.find(v=>v.id===me.vehicle),e=v&&this.entries.get(v.id);if(v&&e)this.camera(v,e,look,dt);
    } else {
      this.follow=null;this.followCamera.reset();this.view.vehicleGunAim=null;this.view.vehicleAim=null;
      for(const p of state.players)if(p.vehicle){const person=this.view.people.get(p.id);if(person)person.root.visible=false;}
    }
  }
  camera(v,e,look,dt) {
    const view=this.view,s=vehicleSpec(v),plane=v.kind==='plane'||v.kind==='helicopter';view.aimFix=null;
    const dims=vehicleDimensions(v),target={x:e.x,y:e.y+Math.max(1.35,dims.h*.7),z:e.z};
    const body=this.map._vehicleObs?.get(v.id)||{vehicleId:v.id};
    const pose=this.followCamera.step({...v,angle:e.angle,pitch:e.pitch},target,look,dt,
      (o,d,r)=>castMap(o,d,r,this.map,body,true).distance,(x,z)=>groundHeight(x,z,this.map));
    // Independent follow state. Never lerp from a position reset by the on-foot controller.
    view.camera.position.set(pose.position.x,pose.position.y,pose.position.z);
    view.camera.lookAt(pose.at.x,pose.at.y,pose.at.z);
    const nextFov=dt>0?T.MathUtils.damp(view.camera.fov,plane?82:72,8,dt):(plane?82:72);
    if(Math.abs(nextFov-view.camera.fov)>.001){view.camera.fov=nextFov;view.camera.updateProjectionMatrix();}
    view.camera.updateMatrixWorld();this.follow=v.id;
    // Unarmed cars do not need an expensive 180 m terrain/weapon aiming ray.
    if(!s.cannon&&!s.mg&&v.variant!=='sam'){view.vehicleGunAim=null;view.vehicleAim=null;this.aimPoint=null;this.aimClock=0;return;}
    this.aimClock+=dt;
    if(this.aimVehicle!==v.id||this.aimClock>=1/30||dt<=0) {
      this.aimVehicle=v.id;this.aimClock=0;
      if(v.kind==='tank') {
        const fwd=view.camera.getWorldDirection(this.dir),h=castMap(view.camera.position,fwd,v.variant==='sam'?550:250,this.map,body);
        const pt=this.cam.copy(view.camera.position).addScaledVector(fwd,Math.max(8,h.distance));
        const tx=pt.x-e.x,tz=pt.z-e.z,ty=pt.y-(e.y+1.95);
        view.vehicleGunAim={id:v.id,angle:Math.atan2(tx,tz),pitch:Math.atan2(ty,Math.hypot(tx,tz))};
      } else view.vehicleGunAim=null;
      const gun=v.kind==='helicopter'?helicopterGunPose({...v,x:e.x,y:e.y,z:e.z,angle:e.angle,pitch:e.pitch,roll:e.roll,barrel:e.barrel}):null;
      const fire=gun?.dir||direction(e.turret,e.barrel),origin=gun?.origin||{x:e.x+fire.x*3.85,y:e.y+(plane?1.35:1.95)+fire.y*2,z:e.z+fire.z*3.85};
      const h=castMap(origin,fire,180,this.map,body);
      this.aimPoint??=new T.Vector3();this.aimPoint.set(origin.x+fire.x*h.distance,origin.y+fire.y*h.distance,origin.z+fire.z*h.distance);
    }
    if(this.aimPoint){const reticle=this.cam.copy(this.aimPoint).project(view.camera);view.vehicleAim={x:clamp((reticle.x+1)*.5,.03,.97),y:clamp((1-reticle.y)*.5,.03,.97)};}
  }
  updateRounds(rounds) {
    const live=new Set();for(const r of rounds){live.add(r.id);let mesh=this.rounds.get(r.id);
      if(!mesh){mesh=new T.Mesh(this.shellGeometry,this.shellMaterial);mesh.scale.setScalar(r.kind==='tank'?1.6:1);this.root.add(mesh);this.rounds.set(r.id,mesh);}mesh.position.set(r.x,r.y,r.z);}
    for(const [id,m] of this.rounds)if(!live.has(id)){m.removeFromParent();this.rounds.delete(id);}
  }
  event(e) {
    const fx=this.view.fx;if(e.type==='vehicle-shot') {
      fx?.emit({x:e.x,y:e.y,z:e.z},{x:0,y:0,z:0},0xffedb5,e.kind==='cannon'?1.25:.55,.07);
      if(e.kind==='rocket')fx?.burst(e,3,0xa3a69d,.2,.45,true,1.2);
      if(e.kind==='cannon'){fx?.burst(e,5,0x9d998a,.5,.8,true,1.6);/* Barrel recoil is animated separately; no walking-camera shake on a vehicle. */}
      if(e.kind==='mg'&&Number.isFinite(e.tx)) {
        if(this.tracers.length>=50){this.tracers.shift().mesh.removeFromParent();}
        const start=new T.Vector3(e.x,e.y,e.z),end=new T.Vector3(e.tx,e.ty,e.tz),length=start.distanceTo(end);
        if(length>.01){const mesh=new T.Mesh(this.tracerGeometry,this.tracerMaterial);mesh.position.copy(start).lerp(end,.5);mesh.scale.y=length;mesh.quaternion.setFromUnitVectors(this.up,this.dir.subVectors(end,start).normalize());this.root.add(mesh);this.tracers.push({mesh,life:.07});}
        fx?.burst({x:e.tx,y:e.ty,z:e.tz},3,0xe3bf81,.08,.25,false,1.5);
      }
    }
    if(e.type==='vehicle-ram') {fx?.burst(e,5,0x9c998b,.18,.55,true,2.0);}
    if(e.type==='vehicle-crushed')fx?.burst(e,12,0x66736a,.25,.9,false,3);
    if(e.type==='door-break')fx?.burst(e,12,0x9f7956,.12,.8,false,3.1);
  }
  dispose(){this.rocketFlights.dispose();this.root.removeFromParent();for(const e of this.entries.values()){e.rack?.dispose();disposeVehicleModel(e.model);for(const m of e.tinted||[])m.dispose();}this.tracerGeometry.dispose();this.shellGeometry.dispose();this.tracerMaterial.dispose();this.shellMaterial.dispose();}
}
