import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareCustomAvatar,instantiateCustomAvatar,poseCustomAvatar,CUSTOM_POSED_BONES,disposeAvatarSkeleton} from '../src/custom-characters.js';
import {restorePose,savePose} from '../src/rig-pose.js';
import {character,registerModelAsset} from '../src/assets.js';
import {aegisDisplay,suitHands,disposeTech} from '../src/technology-models.js';
const assets={};
for(const kind of ['soldier','suit','hands']){
 const name={soldier:'tactical-player',suit:'aegis-player',hands:'aegis-gauntlets'}[kind];
 const bytes=fs.readFileSync(new URL('../public/models/'+name+'.glb',import.meta.url));
 const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
 if(kind!=='hands')prepareCustomAvatar(asset,kind);assets[kind]=asset;registerModelAsset(name,asset);
}
function mesh(a){let r;a.model.traverse(o=>{if(o.isSkinnedMesh)r=o;});return r;}
function instance(kind){const a=instantiateCustomAvatar(assets[kind],kind);a.v={body:a.model,posedNames:CUSTOM_POSED_BONES,mixer:a.mixer,guns:[]};return a;}
function step(a,p,dt=1/60){a.model.position.set(0,0,0);a.model.rotation.set(0,0,0,'YXZ');restorePose(a.v);a.mixer.update(dt);savePose(a.v);poseCustomAvatar(a.v,p,dt);a.model.updateMatrixWorld(true);mesh(a).skeleton.update();}
for(const kind of ['soldier','suit']){
 test(kind+': actual uploaded GLB has bounded geometry and normalized skeleton weights',()=>{
  const a=instance(kind),m=mesh(a),g=m.geometry;assert.ok(g.index.count/3<21000);assert.ok(g.attributes.position.count<15000);assert.ok(m.skeleton.bones.length>=18);
  const w=g.attributes.skinWeight,id=g.attributes.skinIndex;
  for(let i=0;i<w.count;i++){let sum=0;for(let k=0;k<4;k++){const x=w.getComponent(i,k);assert.ok(Number.isFinite(x)&&x>=0);sum+=x;assert.ok(id.getComponent(i,k)<m.skeleton.bones.length);}assert.ok(Math.abs(sum-1)<1e-5);}
  assert.equal(a.model.userData.avatarKind,kind);disposeAvatarSkeleton(a.model);
 });
 test(kind+': cloned actors share mesh buffers but never pose bones',()=>{
  const a=instance(kind),b=instance(kind);assert.equal(mesh(a).geometry,mesh(b).geometry);assert.notEqual(mesh(a).skeleton,mesh(b).skeleton);
  const bone=a.model.getObjectByName('UpperArmL'),other=b.model.getObjectByName('UpperArmL');
  const untouched=other.quaternion.toArray();assert.notEqual(bone,other);bone.rotation.x=1;assert.deepEqual(other.quaternion.toArray(),untouched);
  disposeAvatarSkeleton(a.model);assert.ok(mesh(b).geometry.attributes.position.count>0);disposeAvatarSkeleton(b.model);
 });
 test(kind+': every authored animation produces finite deformed vertices',()=>{
  const a=instance(kind),x=new T.Vector3();for(const clip of a.clips){a.mixer.stopAllAction();a.mixer.clipAction(clip).play();
   for(const t of [0,.25,.63,1]){a.mixer.setTime(clip.duration*t);a.model.updateMatrixWorld(true);const m=mesh(a);m.skeleton.update();
    for(let i=0;i<m.geometry.attributes.position.count;i+=7){m.getVertexPosition(i,x);assert.ok(x.toArray().every(Number.isFinite));assert.ok(x.length()<3.5,kind+' '+clip.name+' distorted vertex');}}
  }disposeAvatarSkeleton(a.model);
 });
 test(kind+': restored pose does not accumulate over repeated frames',()=>{
  const a=instance(kind);a.mixer.clipAction(a.clips.find(c=>c.name==='Idle')).play();const p={hp:100,angle:0,pitch:0,suitFlight:false};
  for(let i=0;i<300;i++)step(a,p);const q=a.model.getObjectByName('UpperArmL').quaternion.clone();
  for(let i=0;i<1800;i++)step(a,p);assert.ok(q.angleTo(a.model.getObjectByName('UpperArmL').quaternion)<.055);disposeAvatarSkeleton(a.model);
 });
}
test('game character factory selects the supplied soldier for every cosmetic preset and full supplied suit only when equipped',()=>{
 for(const id of [0,1,2,99]){const a=character(id);assert.equal(a.avatarKind,'soldier');disposeAvatarSkeleton(a.model);}
 const a=character(0,true);assert.equal(a.avatarKind,'suit');disposeAvatarSkeleton(a.model);
});
test('suit flight becomes prone at speed, raises head and enables only its own exhausts',()=>{
 const a=instance('suit');a.mixer.clipAction(a.clips.find(c=>c.name==='Idle')).play();const p={hp:100,angle:0,pitch:0,gear:{id:'aegis'},suitFlight:true,suitVX:0,suitVZ:30};
 for(let i=0;i<120;i++)step(a,p);assert.ok(a.model.rotation.x>1.15);assert.ok(a.model.getObjectByName('Head').rotation.x<-.45);assert.equal(a.model.userData.thrusters041.filter(o=>o.visible).length,4);
 p.suitFlight=false;for(let i=0;i<120;i++)step(a,p);assert.ok(a.model.rotation.x<.01);assert.ok(a.model.userData.thrusters041.every(o=>!o.visible));disposeAvatarSkeleton(a.model);
});
test('first-person suit gauntlets use the uploaded geometry and display disposal does not invalidate the avatar cache',()=>{
 const hands=suitHands();let vertices=0;hands.traverse(o=>{vertices+=o.geometry?.attributes?.position.count||0;});assert.ok(vertices>1000);
 const display=aegisDisplay();disposeTech(display);const a=character(0,true);assert.ok(mesh(a).geometry.attributes.position.count>0);disposeAvatarSkeleton(a.model);
});
test('normal and suit source assets are self-contained and carry source provenance',()=>{
 for(const [kind,name] of [['soldier','tactical-player'],['suit','aegis-player']]){
  const b=fs.readFileSync(new URL('../public/models/'+name+'.glb',import.meta.url)),j=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  assert.equal(b.readUInt32LE(8),b.length);assert.ok(j.buffers.every(x=>!x.uri));assert.ok(j.nodes[0].extras.sourceSHA256.length===64);assert.equal(j.nodes[0].extras.avatarKind,kind);
 }
});
