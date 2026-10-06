// User supplied STL silhouettes, normalized and skinned at build time. No remote requests.
// Animation clips and additional poses are game-authored; the STL files contain no animation.
import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
const H=1.84;
export const CUSTOM_CHARACTER_FILES=['tactical-player','aegis-player','aegis-gauntlets'];
export const CUSTOM_POSED_BONES=['Hips','Abdomen','Torso','Neck','Head','UpperArmL','LowerArmL','HandL','UpperArmR','LowerArmR','HandR','UpperLegL','LowerLegL','FootL','UpperLegR','LowerLegR','FootR'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const qx=n=>new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),n);
const qy=n=>new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),n);
const qz=n=>new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),n);
function restAngles(kind){return kind==='soldier'?[1.505,1.542,1.331]:[.385,.264,.043];}
function pose(kind,clip,time,duration){
  const out=Object.fromEntries(CUSTOM_POSED_BONES.map(n=>[n,new T.Quaternion()]));
  const running=/^Run/.test(clip),walking=/^Walk/.test(clip),gait=running||walking;
  const phase=time/duration*Math.PI*2,move=gait?Math.sin(phase):0;
  const ready=/_Shoot$|_Gun$/.test(clip),amplitude=running?.65:.39;
  const arms=restAngles(kind);
  for(const[s,side]of [[1,'L'],[-1,'R']]){
    let swing=gait?-move*s*(running?.45:.30):.025*Math.sin(phase+s),curl=ready?1.05:.10;
    let spread=0;
    if(ready)swing=-.93;
    if(clip==='Wave'&&s===1){spread=2.55;curl=.45+.22*Math.sin(phase*2);swing=.15;}
    if(clip==='Punch'){
      swing=s===-1?-(.7+.85*Math.sin(Math.PI*time/duration)):-.45;
      curl=s===-1?1.1-.97*Math.sin(Math.PI*time/duration):1.1;
    }
    if(clip==='Jump'||clip==='Jump_Idle'){swing=-.35;spread=.19;curl=.18;}
    if(clip==='Duck'){swing=-.75;curl=.65;}
    out['UpperArm'+side].copy(qx(swing)).multiply(qz(s*(-arms[0]+spread)));
    out['LowerArm'+side].copy(qy(-s*curl)).multiply(qz(-s*(arms[1]-arms[0])));
    out['Hand'+side].copy(qz(-s*(arms[2]-arms[1])));
    let thigh=gait?move*s*amplitude:0,knee=gait?Math.max(0,-move*s)*(running?.92:.6):.03;
    if(clip==='Jump'||clip==='Jump_Idle'){thigh=-.2;knee=.4;}
    if(clip==='Duck'){thigh=-.72;knee=1.22;}
    out['UpperLeg'+side].copy(qx(thigh));out['LowerLeg'+side].copy(qx(knee));out['Foot'+side].copy(qx(-knee*.22));
  }
  out.Torso.copy(qx(running?.08:clip==='Duck'?.20:0));
  if(clip==='Yes')out.Head.copy(qx(Math.sin(phase)*.18));
  if(clip==='No')out.Head.copy(qy(Math.sin(phase)*.30));
  if(clip==='HitReact')out.Torso.copy(qx(-.25*Math.sin(Math.PI*time/duration)));
  if(clip==='Death')out.Hips.copy(qx(-Math.min(1,time/.85)*Math.PI/2));
  return {rot:out,bob:clip==='Duck'?-.30:clip==='Death'?-.74*Math.min(1,time/.85):gait?Math.abs(Math.sin(phase))*(running?.028:.016):Math.sin(phase)*.003};
}
export function prepareCustomAvatar(asset,kind){
  if(!asset?.scene)throw Error('Missing custom '+kind+' GLB');
  asset.scene.userData.customAvatar041=true;asset.scene.userData.avatarKind=kind;
  let skinCount=0;
  asset.scene.traverse(o=>{if(o.isSkinnedMesh){skinCount++;o.normalizeSkinWeights();o.frustumCulled=false;}if(o.isMesh){o.castShadow=o.receiveShadow=true;o.userData.sharedAvatar041=true;}});
  if(!skinCount)throw Error('Custom avatar has no skinned mesh: '+kind);
  const clips=[];
  for(const name of ['Idle','Idle_Shoot','Walk','Walk_Shoot','Run','Run_Gun','Run_Shoot','Jump','Jump_Idle','Jump_Land','Death','HitReact','Punch','Duck','Wave','Yes','No']){
    const duration=/^Run/.test(name)?.65:/^Walk/.test(name)?1.05:name==='Punch'?.52:name==='Death'?1.15:name==='HitReact'?.45:2;
    const times=Float32Array.from({length:25},(_,i)=>i*duration/24),tracks=[];
    const poses=Array.from(times,t=>pose(kind,name,t,duration));
    for(const bone of CUSTOM_POSED_BONES){if(!asset.scene.getObjectByName(bone))continue;
      tracks.push(new T.QuaternionKeyframeTrack(bone+'.quaternion',times,poses.flatMap(p=>p.rot[bone].toArray())));}
    const hips=asset.scene.getObjectByName('Hips');
    tracks.push(new T.VectorKeyframeTrack('Hips.position',times,poses.flatMap(p=>[hips.position.x,hips.position.y+p.bob,hips.position.z])));
    clips.push(new T.AnimationClip(name,duration,tracks));
  }
  asset.animations=clips;return asset;
}
let reactorResources;
function resources(){return reactorResources??={
  core:new T.CylinderGeometry(.055,.055,.020,16),palm:new T.CylinderGeometry(.026,.026,.013,12),sole:new T.CylinderGeometry(.038,.038,.015,12),eye:new T.BoxGeometry(.046,.009,.011),
  flame:new T.ConeGeometry(.06,.32,8),
  glow:new T.MeshStandardMaterial({color:0xafeaff,emissive:0x80dcff,emissiveIntensity:2.6,metalness:.15,roughness:.23}),
  exhaust:new T.MeshBasicMaterial({color:0x8eefff,transparent:true,opacity:.72,depthWrite:false,toneMapped:false})};}
function addReactors(root){
  const r=resources(),flames=[];
  const add=(parent,geo,mat,position,rotation=[0,0,0])=>{const o=new T.Mesh(geo,mat);o.position.set(...position);o.rotation.set(...rotation);o.userData.sharedAvatar041=true;parent?.add(o);return o;};
  const torso=root.getObjectByName('Torso'),head=root.getObjectByName('Head');
  add(torso,r.core,r.glow,[0,.042*H,.086*H],[Math.PI/2,0,0]);
  for(const s of [-1,1])add(head,r.eye,r.glow,[s*.031*H,.046*H,.069*H]);
  for(const side of ['L','R']){
    const foot=root.getObjectByName('Foot'+side);add(foot,r.sole,r.glow,[0,-.072*H,.020*H]);
    const flame=add(foot,r.flame,r.exhaust,[0,-.21*H,.015*H]);flame.visible=false;flames.push(flame);
    const hand=root.getObjectByName('Hand'+side);
    add(hand,r.palm,r.glow,[0,-.035*H,.035*H],[Math.PI/2,0,0]);
    const f=add(hand,r.flame,r.exhaust,[0,-.128*H,.012*H]);f.scale.setScalar(.65);f.visible=false;flames.push(f);
  }
  root.userData.thrusters041=flames;
}
export function instantiateCustomAvatar(asset,kind){
  const model=cloneSkeleton(asset.scene);model.scale.setScalar(1);model.userData.customAvatar041=true;model.userData.avatarKind=kind;
  model.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false;});
  if(kind==='suit')addReactors(model);
  return {model,mixer:new T.AnimationMixer(model),clips:asset.animations,customAvatar:true,avatarKind:kind};
}
const targetQuaternion=new T.Quaternion(),axisX=new T.Vector3(1,0,0),axisZ=new T.Vector3(0,0,1),worldQ=new T.Quaternion(),inverseQ=new T.Quaternion(),handPoint=new T.Vector3();
// Invoked after restoring the mixer's pose. Flight blend and camera pitch never accumulate in bones.
export function poseCustomAvatar(v,p,dt,extra={}){
  const flight=p.hp>0&&p.gear?.id==='aegis'&&p.suitFlight&&!p.vehicle&&!p.inBus;
  const suit=p.gear?.id==='aegis',speed=Math.hypot(p.suitVX||0,p.suitVZ||0);
  const desired=flight?clamp(speed/28,0,1)*clamp(1.28-(p.pitch||0)*.38,.65,1.52):p.dropping&&!p.gliding?.95:p.sprinting?.10:0;
  v.lean=T.MathUtils.damp(v.lean||0,desired,7,Math.min(.1,dt));v.flightBlend041=T.MathUtils.damp(v.flightBlend041||0,flight?1:0,9,Math.min(.1,dt));
  v.body.rotation.x=v.lean;v.body.position.x=v.body.position.z=0;
  if(v.lean>.001){const k=.93*Math.sin(v.lean),yaw=v.body.rotation.y;v.body.position.y+=.93*(1-Math.cos(v.lean));v.body.position.x=-Math.sin(yaw)*k;v.body.position.z=-Math.cos(yaw)*k;}
  v.bones041??=Object.fromEntries(CUSTOM_POSED_BONES.map(n=>[n,v.body.getObjectByName(n)]));
  const blend=v.flightBlend041,kind=v.body.userData.avatarKind,angles=restAngles(kind);
  if(blend>.001){
    for(const[s,side]of [[1,'L'],[-1,'R']]){
      const upper=v.bones041['UpperArm'+side],fore=v.bones041['LowerArm'+side],hand=v.bones041['Hand'+side];
      // Arms alongside the torso, palms trailing; legs extended. Head stays raised during fast cruise.
      targetQuaternion.setFromAxisAngle(axisX,.08).multiply(qz(-s*angles[0]+s*.13));upper?.quaternion.slerp(targetQuaternion,blend);
      targetQuaternion.copy(qz(-s*(angles[1]-angles[0])));fore?.quaternion.slerp(targetQuaternion,blend);
      targetQuaternion.copy(qz(-s*(angles[2]-angles[1]))).multiply(qx(-.08));hand?.quaternion.slerp(targetQuaternion,blend);
      targetQuaternion.setFromAxisAngle(axisZ,s*.10);v.bones041['UpperLeg'+side]?.quaternion.slerp(targetQuaternion,blend);
      targetQuaternion.copy(qx(.04));v.bones041['LowerLeg'+side]?.quaternion.slerp(targetQuaternion,blend);
      targetQuaternion.copy(qx(.07));v.bones041['Foot'+side]?.quaternion.slerp(targetQuaternion,blend);
    }
    targetQuaternion.copy(qx(-v.lean*.60));v.bones041.Head?.quaternion.slerp(targetQuaternion,blend);
    targetQuaternion.identity();v.bones041.Torso?.quaternion.slerp(targetQuaternion,blend*.8);
  }else if(extra.fists&&!suit){
    for(const[s,side]of [[1,'L'],[-1,'R']]){
      targetQuaternion.copy(qx(-.58)).multiply(qz(-s*angles[0]-s*.04));v.bones041['UpperArm'+side]?.quaternion.copy(targetQuaternion);
      targetQuaternion.copy(qy(-s*1.35)).multiply(qz(-s*(angles[1]-angles[0])));v.bones041['LowerArm'+side]?.quaternion.copy(targetQuaternion);
    }
  }
  v.suitShotT=Math.max(0,(v.suitShotT||0)-dt);
  if(suit&&p.hp>0&&(v.suitShotT>0||p.suitCharge>0)){
    const side='R';targetQuaternion.copy(qx(-1.28+v.lean)).multiply(qz(-angles[0]*-1));
    v.bones041['UpperArm'+side]?.quaternion.copy(targetQuaternion);
    targetQuaternion.copy(qz(angles[1]-angles[0]));v.bones041['LowerArm'+side]?.quaternion.copy(targetQuaternion);
  }
  for(const f of v.body.userData.thrusters041||[]){f.visible=flight;f.scale.y=(p.sprinting?1.35:1)*(.91+.09*Math.sin((v.emoteClock||0)*33));}
  // Socket translation follows the hand; orientation follows authoritative aim (not the STL's bind pose).
  if(v.guns.length){v.body.updateWorldMatrix(true,true);const hand=v.bones041.HandR;if(hand){hand.getWorldPosition(handPoint);v.body.worldToLocal(handPoint);v.body.getWorldQuaternion(inverseQ).invert();worldQ.setFromEuler(new T.Euler(-(p.pitch||0),p.angle||0,0,'YXZ')).multiply(qy(Math.PI));
    for(const g of v.guns){if(!g.userData.customMount041)continue;g.position.copy(handPoint);g.quaternion.copy(inverseQ).multiply(worldQ);}}}
}
export function disposeAvatarSkeleton(root){const seen=new Set();root.traverse(o=>{if(o.isSkinnedMesh&&!seen.has(o.skeleton)){seen.add(o.skeleton);o.skeleton.dispose();}});}
