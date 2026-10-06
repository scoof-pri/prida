import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareCustomAvatar,instantiateCustomAvatar,CUSTOM_POSED_BONES} from '../src/custom-characters.js';
import {combineUpperBody,selectCharacterAnimation,applyCharacterAnimationPlayback} from '../src/character-animations.js';
import {restorePose,savePose} from '../src/rig-pose.js';
import {WEAPONS,RARITIES} from '../src/catalog.js';

const manifest=JSON.parse(fs.readFileSync(new URL('../public/models/animation-manifest.json',import.meta.url),'utf8'));
const assets={};
for(const kind of ['soldier','suit']){
 const file=kind==='soldier'?'tactical-player.glb':'aegis-player.glb';
 const b=fs.readFileSync(new URL('../public/models/'+file,import.meta.url));
 const a=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'');
 assets[kind]={raw:a.animations,asset:prepareCustomAvatar(a,kind),bytes:b};
}
function actor(kind='soldier'){
 const a=instantiateCustomAvatar(assets[kind].asset,kind);
 return {body:a.model,mixer:a.mixer,actions:Object.fromEntries(a.clips.map(c=>[c.name,a.mixer.clipAction(c)])),yaw:0,legYaw:0,posedNames:CUSTOM_POSED_BONES};
}
const basePlayer=()=>({hp:100,shot:0,moving:0,angle:0,grounded:true,weapon:WEAPONS.findIndex(w=>w.id==='rifle'),rarity:'common'});
const select=(v,p,ctx={})=>selectCharacterAnimation(v,p,{base:'Idle',stance:'rifle',firearm:true,dt:1/60,...ctx});
const sampleQ=(clip,bone,t)=>new T.Quaternion().fromArray(clip.tracks.find(x=>x.name===bone+'.quaternion').createInterpolant().evaluate(t));

test('both shipped rigs contain all 30 uploaded motions with original file checksums and no FBX texture payload',()=>{
 assert.equal(manifest.clips.length,30);assert.equal(manifest.clips.filter(c=>!c.archive).length,8);
 const required=['Strafing','Walk_Backward','Death','Firing_Rifle','Rifle_Aiming_Idle','DropKick','Dagger_Stab','Reload'];
 for(const kind of ['soldier','suit']){
  const {raw,asset,bytes}=assets[kind],entry=manifest.models.find(m=>m.kind===kind);
  assert.equal(raw.length,30);for(const name of required)assert.ok(raw.some(c=>c.name===name));
  assert.ok(bytes.length<1_600_000);assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.ok(asset.scene.userData.importedAnimations);
  const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  assert.ok(json.buffers.every(b=>!b.uri));assert.equal(json.animations.length,30);
 }
 for(const c of manifest.clips){assert.match(c.sourceSha256,/^[a-f0-9]{64}$/);assert.ok(c.duration>0);}
});

test('retargeted clips keep horizontal root motion in the controller and finite normalized bone rotation',()=>{
 for(const {raw} of Object.values(assets))for(const clip of raw){
  const hips=clip.tracks.find(t=>t.name==='Hips.position');assert.ok(hips);
  for(let i=0;i<hips.values.length;i+=3){assert.ok(Math.abs(hips.values[i])<1e-7);assert.ok(Math.abs(hips.values[i+2])<1e-7);}
  for(const t of clip.tracks.filter(t=>t.name.endsWith('.quaternion')))for(let i=0;i<t.values.length;i+=4){const q=[...t.values.slice(i,i+4)];assert.ok(q.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...q)-1)<1e-5);}
 }
});

test('a firing upper body keeps its world aim while walk hips use a different stance',()=>{
 const raw=assets.soldier.raw,walk=raw.find(c=>c.name==='Adventure_walking'),fire=raw.find(c=>c.name==='Firing_Rifle');
 const clip=combineUpperBody(walk,fire,'test');
 for(const f of [0,.5,1]){
  const lowT=walk.duration*f,highT=fire.duration*f;
  const actual=sampleQ(clip,'Hips',lowT).multiply(sampleQ(clip,'Abdomen',lowT));
  const wanted=sampleQ(fire,'Hips',highT).multiply(sampleQ(fire,'Abdomen',highT));
  assert.ok(actual.angleTo(wanted)<1e-3);assert.ok(sampleQ(clip,'UpperLegL',lowT).angleTo(sampleQ(walk,'UpperLegL',lowT))<1e-3);
 }
});

test('backpedaling plays the supplied backward clip forward, and side steps use the uploaded entry before a loop',()=>{
 const v=actor(),p={...basePlayer(),moving:2};v.moveYaw=Math.PI;
 let motion=select(v,p);assert.equal(motion.name,'Walk_Backward_Gun');assert.ok(motion.speed>0);
 v.body.rotation.y=.8;v.legYaw=.8;applyCharacterAnimationPlayback(v,motion);assert.equal(v.body.rotation.y,0);assert.equal(v.legYaw,0);
 v.moveYaw=Math.PI/2;motion=select(v,p);assert.equal(motion.name,'Strafe_Start_Left_Gun');assert.ok(motion.once);
 for(let i=0;i<40;i++)motion=select(v,p);assert.equal(motion.name,'Strafe_Left_Gun');assert.equal(motion.once,false);
 v.moveYaw=-Math.PI/2;motion=select(v,p);assert.equal(motion.name,'Strafe_Start_Right_Gun');
});

test('rifle aim, recoil, full reload and moving reload are separate actions synchronized to gameplay',()=>{
 const v=actor(),p=basePlayer();if(p.weapon<0)p.weapon=WEAPONS.findIndex(w=>w.reload&&!w.melee&&!w.item);
 assert.equal(select(v,p).name,'Idle_Gun');assert.equal(select(v,p,{shooting:true}).name,'Idle_Shoot');
 const total=WEAPONS[p.weapon].reload*(RARITIES[p.rarity]?.reload||1);p.reload=total/2;
 let motion=select(v,p);assert.equal(motion.name,'Reload');assert.ok(Math.abs(motion.time-v.actions.Reload.getClip().duration/2)<1e-6);
 p.moving=6;motion=select(v,p);assert.equal(motion.name,'Reload_Run');assert.ok(motion.speed>0);applyCharacterAnimationPlayback(v,motion);
 assert.equal(v.actions.Reload_Run.loop,T.LoopOnce);assert.equal(v.actions.Reload_Run.time,motion.time);
});

test('uploaded kicks and dagger strikes survive the short gun recoil timer and restart only for a new shot',()=>{
 const v=actor(),p=basePlayer();select(v,p,{stance:'fists',firearm:false});p.shot=2;
 let motion=select(v,p,{stance:'fists',firearm:false});assert.equal(motion.name,'DropKick');assert.ok(motion.once);
 applyCharacterAnimationPlayback(v,motion);v.actions.DropKick.time=.3;applyCharacterAnimationPlayback(v,motion);assert.equal(v.actions.DropKick.time,.3);
 for(let i=0;i<25;i++)motion=select(v,p,{stance:'fists',firearm:false});assert.equal(motion.name,'DropKick');
 p.shot=4;motion=select(v,p,{stance:'fists',firearm:false});applyCharacterAnimationPlayback(v,motion);assert.equal(v.actions.DropKick.time,0);
 p.shot=5;motion=select(v,p,{stance:'blade',firearm:false});assert.equal(motion.name,'Slash');
 p.hp=0;assert.equal(select(v,p).name,'Death');
});

test('restoring mixer poses also restores the hip translation after a suit flight overlay',()=>{
 const v=actor('suit');restorePose(v);const action=v.actions.Idle;action.play();v.mixer.update(.3);savePose(v);
 const hip=v.body.getObjectByName('Hips'),position=hip.position.clone();hip.position.set(0,.9568,0);
 restorePose(v);v.mixer.update(0);assert.ok(hip.position.distanceTo(position)<1e-8);
});
