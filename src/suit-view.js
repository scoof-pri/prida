import * as T from 'three';
import { SUIT_RULES, suitMuzzle, suitRocketMount, suitFlightLean } from './suit-weapons.js';

const point = new T.Vector3(), origin = new T.Vector3(), aim = new T.Vector3();
const parentQ = new T.Quaternion(), aimQ = new T.Quaternion();
const axis = new T.Vector3(), projected = new T.Vector3(), wrist = new T.Vector3(), elbow = new T.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : 0));

function worldPosition(node, position) {
  if (!node?.parent) return;
  point.set(position.x, position.y, position.z);
  node.parent.worldToLocal(point);node.position.copy(point);
}
function worldRotation(node, desired) {
  if (!node?.parent) return;
  node.parent.getWorldQuaternion(parentQ).invert();node.quaternion.copy(parentQ).multiply(desired);
}
function aimBone(bone, child, direction) {
  if (!bone || !child) return;
  bone.parent.getWorldQuaternion(parentQ).invert();
  axis.copy(child.position).normalize();projected.copy(direction).applyQuaternion(parentQ).normalize();
  bone.quaternion.setFromUnitVectors(axis, projected);bone.updateWorldMatrix(true, true);
}

// A two-bone reach keeps the uploaded elbow and wrist lengths. The palm emitter
// lands on the shared hardpoint even when the flight pose leans the torso.
function posePulseArm(v, p) {
  const bones=v.bones041,upper=bones?.UpperArmR,lower=bones?.LowerArmR,hand=bones?.HandR;
  if(!upper||!lower||!hand)return;
  const muzzle=suitMuzzle(p,'palm'),emitter=v.body.getObjectByName('AEGISPalmR');
  aimQ.setFromEuler(new T.Euler(-(p.pitch||0),p.angle||0,0,'YXZ'));
  const palmOffset=new T.Vector3(0,-.035*1.84,.035*1.84).applyQuaternion(aimQ);
  wrist.set(muzzle.x,muzzle.y,muzzle.z).sub(palmOffset);
  upper.getWorldPosition(origin);aim.copy(wrist).sub(origin);
  const a=lower.position.length(),b=hand.position.length(),length=clamp(aim.length(),Math.abs(a-b)+.001,a+b-.001);
  aim.normalize();wrist.copy(origin).addScaledVector(aim,length);
  const along=(a*a-b*b+length*length)/(2*length),height=Math.sqrt(Math.max(0,a*a-along*along));
  // Elbows flex down beside the body. Near vertical aim uses a sideways pole.
  projected.set(0,-1,0).addScaledVector(aim,aim.y);
  if(projected.lengthSq()<.02)projected.set(-Math.cos(p.angle||0),0,Math.sin(p.angle||0)).addScaledVector(aim,-projected.dot(aim));
  projected.normalize();elbow.copy(origin).addScaledVector(aim,along).addScaledVector(projected,height);
  aimBone(upper,lower,elbow.clone().sub(origin));
  lower.getWorldPosition(origin);aimBone(lower,hand,wrist.clone().sub(origin));
  worldRotation(hand,aimQ);hand.updateWorldMatrix(true,true);
  if(emitter)worldPosition(emitter,muzzle);
}

export function poseSuitWeapons(v,p,dt=0) {
  if(p.gear?.id!=='aegis'||p.hp<=0||!v.body)return;
  // Use the actor's interpolated root as the presentation origin. Hardpoint
  // offsets and articulation remain identical to the authoritative formulas.
  const at=v.root?.getWorldPosition(new T.Vector3());
  const drawn=at?{...p,x:at.x,y:at.y,z:at.z}:p;
  const lean=suitFlightLean(p),launch=clamp((p.suitTakeoff||0)/SUIT_RULES.takeoff,0,1);
  v.lean=lean;v.body.rotation.x=lean;
  if(p.suitFlight||lean>.01){
    v.body.rotation.y=p.angle||0;
    const k=.93*Math.sin(lean);v.body.position.set(-Math.sin(p.angle||0)*k,.93*(1-Math.cos(lean)),-Math.cos(p.angle||0)*k);
    for(const name of ['Hips','Abdomen','Torso'])v.bones041?.[name]?.quaternion.identity();
    const hips=v.bones041?.Hips;if(hips)hips.position.set(0,.9568,0);
    if(launch>0)for(const side of ['L','R']){
      v.bones041?.['UpperLeg'+side]?.quaternion.setFromAxisAngle(new T.Vector3(1,0,0),-.38*launch);
      v.bones041?.['LowerLeg'+side]?.quaternion.setFromAxisAngle(new T.Vector3(1,0,0),.75*launch);
      v.bones041?.['Foot'+side]?.quaternion.setFromAxisAngle(new T.Vector3(1,0,0),-.28*launch);
    }
  }
  v.suitBeamT=Math.max(0,(v.suitBeamT||0)-dt);
  if(p.suitCharge>0||v.suitBeamT>0)for(const [sign,side]of [[1,'L'],[-1,'R']]){
    const upper=v.bones041?.['UpperArm'+side],lower=v.bones041?.['LowerArm'+side];
    upper?.quaternion.setFromAxisAngle(new T.Vector3(1,0,0),.15).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),-sign*.25));
    lower?.quaternion.setFromAxisAngle(new T.Vector3(0,0,1),sign*.121);
  }
  v.body.updateWorldMatrix(true,true);
  const chest=v.body.getObjectByName('AEGISChestEmitter');if(chest){worldPosition(chest,suitMuzzle(drawn,'beam'));chest.scale.setScalar(1+(v.suitBeamT>0?.25:(p.suitCharge||0)*.12));}
  if(v.suitShotT>0&&!v.suitBeamT&&!p.suitCharge)posePulseArm(v,drawn);
  const launcherQ=new T.Quaternion().setFromEuler(new T.Euler(-(p.pitch||0),p.angle||0,0,'YXZ'));
  for(const launcher of v.aegis?.items||[]){
    worldPosition(launcher,suitRocketMount(drawn,launcher.userData.suitSide));worldRotation(launcher,launcherQ);
    for(const chamber of launcher.userData.chambers||[])chamber.mesh.visible=chamber.port>=SUIT_RULES.rockets-(p.suitRockets??p.gear.rocketAmmo??SUIT_RULES.rockets);
  }
  for(const f of v.body.userData.thrusters041||[]){
    f.visible=!!p.suitFlight;f.scale.y=Math.max(.05,p.suitSpool??1)*(p.suitBoost?1.35:1)*(.96+.04*Math.sin((v.emoteClock||0)*33));
  }
}

// The first-person gauntlet uses the same muzzle's projected screen position,
// accounting for the separate weapon camera FOV. Its flash no longer appears
// on the opposite hand or at the centre of the player's torso.
export function poseSuitFirstPerson(view,p,dt=0) {
  const hands=view.fpAegisHands;if(!hands||!p||p.gear?.id!=='aegis'||view.thirdPerson)return;
  const right=hands.getObjectByName('GauntletR'),left=hands.getObjectByName('GauntletL');
  if(!right)return;
  view.camera.updateMatrixWorld();
  const muzzle=suitMuzzle(p,'palm');point.set(muzzle.x,muzzle.y,muzzle.z).applyMatrix4(view.camera.matrixWorldInverse);
  const depth=.50,ratio=Math.tan(T.MathUtils.degToRad(view.weaponCamera.fov*.5))/Math.tan(T.MathUtils.degToRad(view.camera.fov*.5));
  const z=Math.max(.15,-point.z),px=clamp(point.x/z*depth*ratio,-.6,.6),py=clamp(point.y/z*depth*ratio,-.55,.12);
  right.position.set(px,py-.035,-depth+.165);right.rotation.set(0,0,0);
  if(left){left.position.set(-.25,-.28-(p.suitTakeoff>0?.035:0),-.45);left.rotation.set(0,0,0);}
  hands.userData.pulse=Math.max(0,(hands.userData.pulse||0)-dt);
  const emitter=hands.getObjectByName('FP_AEGISPalmR');if(emitter)emitter.scale.setScalar(hands.userData.pulse>0?1.6:1);
}
