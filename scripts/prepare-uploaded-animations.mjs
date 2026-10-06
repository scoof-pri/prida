// Offline import of the user's Mixamo FBX motions onto PRIDA's existing STL rigs.
// The source meshes/textures stay outside the shipped game; glTF carries only normalized motion channels.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {dedup,prune,resample} from '@gltf-transform/functions';

if(!process.argv[2])throw Error('Usage: node scripts/prepare-uploaded-animations.mjs <folder-with-uploaded-FBX-and-ZIP> [output-folder]');
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const MODELS=path.resolve(scriptDir,'../public/models');
const OUTPUT=path.resolve(process.argv[3]||MODELS);
const INPUT=await fs.mkdtemp(path.join(process.env.TMPDIR||process.cwd(),'.prida-motions-'));
try {
const strip=spawnSync(process.env.PYTHON||'python3',[path.join(scriptDir,'strip-uploaded-fbx.py'),path.resolve(process.argv[2]),INPUT],{stdio:'inherit'});
if(strip.status!==0)throw strip.error||Error('FBX extraction failed with status '+strip.status);
const sourceEvidence=JSON.parse(await fs.readFile(path.join(INPUT,'manifest.json'),'utf8'));
const specs=[
 ['Rifle_Aiming_Idle','Rifle Aiming Idle (1).fbx'],['Firing_Rifle','Firing Rifle (1).fbx'],
 ['Reload','Reloading (1).fbx'],['Strafing','Strafing (1).fbx'],['Walk_Backward','Stepping Backward (1).fbx'],
 ['Death','Dying (1).fbx'],['DropKick','Drop Kick (1).fbx'],['Dagger_Stab','Double Dagger Stab (1).fbx'],
 ...['idle','falling idle','idle (2)','idle (3)','running','stand to cover','walking','stand to cover (2)','run to stop','left turn','right turn','jumping up','falling to roll','hard landing','cover to stand','idle (4)','crouched sneaking left','crouched sneaking right','left cover sneak','right cover sneak','idle (5)','cover to stand (2)'].map(s=>['Adventure_'+s.replaceAll(' ','_').replace(/[()]/g,''),'pack/'+s+'.fbx'])
];
const MAPPING={Hips:'Hips',Abdomen:'Spine1',Torso:'Spine2',Neck:'Neck',Head:'Head',
 UpperArmL:'LeftArm',LowerArmL:'LeftForeArm',HandL:'LeftHand',UpperArmR:'RightArm',LowerArmR:'RightForeArm',HandR:'RightHand',
 UpperLegL:'LeftUpLeg',LowerLegL:'LeftLeg',FootL:'LeftFoot',UpperLegR:'RightUpLeg',LowerLegR:'RightLeg',FootR:'RightFoot'};
const NEXT={Abdomen:['Torso','Spine2'],Torso:['Neck','Neck'],Neck:['Head','Head'],
 UpperArmL:['LowerArmL','LeftForeArm'],LowerArmL:['HandL','LeftHand'],UpperArmR:['LowerArmR','RightForeArm'],LowerArmR:['HandR','RightHand'],
 UpperLegL:['LowerLegL','LeftLeg'],LowerLegL:['FootL','LeftFoot'],UpperLegR:['LowerLegR','RightLeg'],LowerLegR:['FootR','RightFoot']};
const sourceLoader=new FBXLoader(),targetLoader=new GLTFLoader(),io=new NodeIO();
const bufferOf=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length);
const sha=b=>createHash('sha256').update(b).digest('hex');
const restPose=root=>{root.updateMatrixWorld(true);const map=new Map();root.traverse(b=>map.set(b.name,{bone:b,q:b.quaternion.clone(),p:b.position.clone(),worldQ:b.getWorldQuaternion(new T.Quaternion()),worldP:b.getWorldPosition(new T.Vector3())}));return map;};
function importedClip(src,clip,dst,kind,name){
 const sr=restPose(src),dr=restPose(dst),names=Object.keys(MAPPING),restCorrections=new Map();
 for(const n of names){
  const s=sr.get('mixamorig'+MAPPING[n]),d=dr.get(n);if(!s||!d)throw Error('Missing retarget bone '+n);
  let correction=new T.Quaternion();
  if(NEXT[n]){const[next,sourceNext]=NEXT[n],sv=sr.get('mixamorig'+sourceNext).worldP.clone().sub(s.worldP).normalize(),dv=dr.get(next).worldP.clone().sub(d.worldP).normalize();correction.setFromUnitVectors(dv,sv);}
  else if(/^Hand/.test(n)){
    const side=n.endsWith('L')?'Left':'Right',sign=n.endsWith('L')?1:-1,handAngle=kind==='soldier'?1.331:.043;
    const sv=sr.get('mixamorig'+side+'HandMiddle1').worldP.clone().sub(s.worldP).normalize();
    const dv=new T.Vector3(sign*Math.sin(handAngle),-Math.cos(handAngle),0);correction.setFromUnitVectors(dv,sv);
  }
  // World-space delta from the animated source rest orientation, followed by anatomical alignment
  // from this STL's bind direction. AEGIS is A-pose, the tactical model has outstretched arms.
  restCorrections.set(n,s.worldQ.clone().invert().multiply(correction).multiply(d.worldQ));
 }
 const mixer=new T.AnimationMixer(src),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
 const frames=Math.max(2,Math.ceil(clip.duration*30)+1),times=Float32Array.from({length:frames},(_,i)=>i*clip.duration/(frames-1));
 const rotations=new Map(names.map(n=>[n,new Float32Array(frames*4)])),positions=new Float32Array(frames*3);
 const srcHips=sr.get('mixamorigHips'),dstHips=dr.get('Hips'),unitScale=dstHips.worldP.y/srcHips.worldP.y;
 const sourceQ=new T.Quaternion(),desired=new Map(),localQ=new T.Quaternion(),invParent=new T.Quaternion();
 const skins=[];dst.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});const vertex=new T.Vector3();
 for(let i=0;i<frames;i++){
  mixer.setTime(times[i]);src.updateMatrixWorld(true);
  for(const n of names){
    const sb=sr.get('mixamorig'+MAPPING[n]).bone,d=dr.get(n),world=sb.getWorldQuaternion(sourceQ).clone().multiply(restCorrections.get(n)).normalize();
    desired.set(n,world);
    const parent=desired.get(d.bone.parent?.name)||d.bone.parent?.getWorldQuaternion(new T.Quaternion())||new T.Quaternion();
    localQ.copy(invParent.copy(parent).invert()).multiply(world).normalize();
    if(i){const v=rotations.get(n),j=(i-1)*4;if(localQ.x*v[j]+localQ.y*v[j+1]+localQ.z*v[j+2]+localQ.w*v[j+3]<0)localQ.set(-localQ.x,-localQ.y,-localQ.z,-localQ.w);}
    localQ.toArray(rotations.get(n),i*4);
    d.bone.quaternion.copy(localQ);
  }
  // Only vertical motion remains in the skeleton. The authoritative controller supplies all X/Z
  // movement, so a run, strafe, death or roll never detaches its visible body from its hit capsule.
  const sy=srcHips.bone.getWorldPosition(new T.Vector3()).y;
  dstHips.bone.position.set(dstHips.p.x,dstHips.p.y+(sy-srcHips.worldP.y)*unitScale,dstHips.p.z);
  dst.updateMatrixWorld(true);let floor=Infinity;
  for(const skin of skins){skin.skeleton.update();for(let vi=0;vi<skin.geometry.attributes.position.count;vi++){skin.getVertexPosition(vi,vertex).applyMatrix4(skin.matrixWorld);floor=Math.min(floor,vertex.y);}}
  // The two target bodies have different boots and torso lengths. Correct only penetration;
  // airborne source poses retain their actual clearance above the floor.
  if(floor<0)dstHips.bone.position.y-=floor;
  positions.set(dstHips.bone.position.toArray(),i*3);
 }
 mixer.stopAllAction();mixer.uncacheRoot(src);
 for(const r of sr.values()){r.bone.position.copy(r.p);r.bone.quaternion.copy(r.q);}src.updateMatrixWorld(true);
 const tracks=names.map(n=>new T.QuaternionKeyframeTrack(n+'.quaternion',times,rotations.get(n)));
 tracks.push(new T.VectorKeyframeTrack('Hips.position',times,positions));
 for(const r of dr.values()){r.bone.position.copy(r.p);r.bone.quaternion.copy(r.q);}dst.updateMatrixWorld(true);
 return new T.AnimationClip(name,clip.duration,tracks).optimize();
}
function appendClip(doc,clip,source){
 const buffer=doc.getRoot().listBuffers()[0]||doc.createBuffer();const nodes=new Map(doc.getRoot().listNodes().map(n=>[n.getName(),n]));
 const anim=doc.createAnimation(clip.name).setExtras({sourceFile:source,retarget:'mixamo-world-rest-v1',rootMotion:'in-place-xz'});
 for(const track of clip.tracks){const dot=track.name.lastIndexOf('.'),bone=track.name.slice(0,dot),prop=track.name.slice(dot+1),type=prop==='quaternion'?'VEC4':'VEC3';
  const input=doc.createAccessor().setType('SCALAR').setArray(new Float32Array(track.times)).setBuffer(buffer);
  const output=doc.createAccessor().setType(type).setArray(new Float32Array(track.values)).setBuffer(buffer);
  const sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel=doc.createAnimationChannel().setTargetNode(nodes.get(bone)).setTargetPath(prop==='quaternion'?'rotation':'translation').setSampler(sampler);anim.addSampler(sampler).addChannel(channel);
 }
}
const sources=[];
for(const[name,file]of specs){const bytes=await fs.readFile(path.join(INPUT,file)),root=sourceLoader.parse(bufferOf(bytes),'');const clip=root.animations.find(c=>c.duration>0&&c.tracks.length);if(!clip)throw Error('Source contains no motion: '+file);sources.push({name,file,root,clip,bytes:bytes.length,sha256:sha(bytes)});}
await fs.mkdir(OUTPUT,{recursive:true});const manifest={format:1,pipeline:'Mixamo FBX -> anatomical bind-direction retarget -> glTF 2.0',fps:30,rootMotion:'horizontal removed; vertical preserved',clips:[],models:[]};
for(const src of sources){
 const evidence=sourceEvidence.find(e=>e.source===path.basename(src.file)&&!!e.archive===src.file.startsWith('pack/'));
 if(!evidence)throw Error('Missing original source provenance: '+src.file);
 manifest.clips.push({name:src.name,source:src.file,archive:evidence.archive||null,duration:src.clip.duration,sourceSha256:evidence.sourceSha256,sourceBytes:evidence.bytes,sourceMotionSha256:src.sha256});
}
manifest.referenceSkeleton=sourceEvidence.find(e=>e.source==='Ch15_nonPBR.fbx')?.sourceSha256||null;
for(const[kind,file]of [['soldier','tactical-player.glb'],['suit','aegis-player.glb']]){
 const bytes=await fs.readFile(path.join(MODELS,file)),asset=await targetLoader.parseAsync(bufferOf(bytes),'');const doc=await io.readBinary(new Uint8Array(bytes));
 const priorMotionAccessors=new Set();
 for(const a of doc.getRoot().listAnimations()){
  for(const channel of a.listChannels())channel.dispose();
  for(const sampler of a.listSamplers()){priorMotionAccessors.add(sampler.getInput());priorMotionAccessors.add(sampler.getOutput());sampler.dispose();}
  a.dispose();
 }
 // A glTF animation does not own its channels/samplers on dispose. Explicitly release their
 // orphan accessors so running this importer again cannot keep a second invisible motion bank.
 for(const accessor of priorMotionAccessors)if(accessor&&accessor.listParents().every(p=>p.propertyType==='Root'))accessor.dispose();
 for(const s of sources){const clip=importedClip(s.root,s.clip,asset.scene,kind,s.name);appendClip(doc,clip,s.file);}
 const top=doc.getRoot().listScenes()[0].listChildren()[0];top.setExtras({...top.getExtras(),motionSourceFiles:manifest.clips.map(c=>c.source),motionRetargetVersion:1});
 await doc.transform(resample({tolerance:0.00005}),dedup(),prune());
 const output=await io.writeBinary(doc);await fs.writeFile(path.join(OUTPUT,file),output);
 manifest.models.push({file,kind,bytes:output.length,sha256:sha(output),animationCount:doc.getRoot().listAnimations().length});console.log(file,output.length,'bytes',doc.getRoot().listAnimations().length,'imported animations');
}
await fs.writeFile(path.join(OUTPUT,'animation-manifest.json'),JSON.stringify(manifest,null,2)+'\n');

} finally { await fs.rm(INPUT,{recursive:true,force:true}); }
