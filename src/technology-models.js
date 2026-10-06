import { modelAsset } from './assets.js';
import { instantiateCustomAvatar, disposeAvatarSkeleton } from './custom-characters.js';
// Original NOVA hardware: compact game assets, baked by material; only rotors/rig joints animate.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { objectSurface } from './materials.js';
import { rigBone } from './rig-pose.js';
import { SUIT_RULES, suitRocketPort } from './suit-weapons.js';
export function techPalette(){
  const shell=new T.MeshStandardMaterial({color:0x365967,metalness:.68,roughness:.36});
  const dark=new T.MeshStandardMaterial({color:0x182b35,metalness:.7,roughness:.48});
  const silver=new T.MeshStandardMaterial({color:0xb3c5c9,metalness:.82,roughness:.3});
  const glow=new T.MeshStandardMaterial({color:0x79eeef,emissive:0x2edbdc,emissiveIntensity:2,roughness:.28,metalness:.3});
  const orange=new T.MeshStandardMaterial({color:0xdf9948,metalness:.38,roughness:.54});
  objectSurface(shell,{surface:'steel',size:.30,strength:.14,normal:.18});
  objectSurface(dark,{surface:'worn',size:.20,strength:.15,normal:.18});
  return {shell,dark,silver,glow,orange};
}
const box=(w,h,d)=>new T.BoxGeometry(w,h,d);
export function techMesh(group,geo,mat,x=0,y=0,z=0){const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;group.add(m);return m;}
export function bakeTech(group){
  const by=new Map();for(const m of [...group.children])if(m.isMesh){if(!by.has(m.material))by.set(m.material,[]);by.get(m.material).push(m);}
  for(const [mat,parts]of by){if(parts.length<2)continue;
    const gs=parts.map(m=>{m.updateMatrix();const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();g.applyMatrix4(m.matrix);if(!g.attributes.uv)g.setAttribute('uv',new T.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});
    const merged=mergeGeometries(gs);gs.forEach(g=>g.dispose());if(!merged)throw Error('Technology geometry attributes mismatch');
    techMesh(group,merged,mat);for(const m of parts){m.geometry.dispose();m.removeFromParent();}
  }return group;
}
export function disposeTech(root){if(root.userData.customSuitDisplay041)disposeAvatarSkeleton(root);const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.userData.sharedAvatar041)return;if(o.geometry)gs.add(o.geometry);if(o.material)for(const m of [o.material].flat())ms.add(m);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());root.removeFromParent();}
export function droneModel(){
  const p=techPalette(),root=new T.Group();root.name='NOVA FPV';
  techMesh(root,box(.21,.085,.29),p.dark,0,.035,0);techMesh(root,box(.15,.07,.19),p.shell,0,.11,-.018);
  techMesh(root,box(.045,.012,.13),p.orange,0,.151,-.02);
  const lens=techMesh(root,new T.CylinderGeometry(.045,.05,.065,10),p.glow,0,.054,.18);lens.rotation.x=Math.PI/2;
  const charge=techMesh(root,new T.CylinderGeometry(.07,.075,.24,10),p.orange,0,-.08,-.01);charge.rotation.x=Math.PI/2;
  for(const z of [-.07,.075])techMesh(root,box(.19,.023,.028),p.dark,0,-.08,z);
  const rotors=[];
  for(const x of [-1,1])for(const z of [-1,1]){
    const arm=techMesh(root,box(.32,.035,.045),p.shell,x*.15,.014,z*.15);arm.rotation.y=-x*z*Math.PI/4;
    techMesh(root,new T.CylinderGeometry(.038,.038,.075,10),p.dark,x*.27,.032,z*.27);
    const rotor=new T.Group();rotor.position.set(x*.27,.08,z*.27);root.add(rotor);rotors.push(rotor);
    techMesh(rotor,box(.25,.009,.032),p.dark);techMesh(rotor,new T.CylinderGeometry(.025,.028,.017,8),p.silver);bakeTech(rotor);
    const lamp=techMesh(root,new T.SphereGeometry(.018,6,4),z>0?p.glow:p.orange,x*.27,.027,z*.29);
  }
  const antenna=techMesh(root,new T.CylinderGeometry(.006,.006,.23,5),p.silver,0,.17,-.13);antenna.rotation.x=-.25;
  root.userData.rotors=rotors;return bakeTech(root);
}
export function bombModel(){
  const p=techPalette(),root=new T.Group();root.name='NOVA gravity bomb';
  const body=techMesh(root,new T.CylinderGeometry(.16,.12,.74,12),p.shell);body.rotation.x=Math.PI/2;
  const nose=techMesh(root,new T.SphereGeometry(.16,12,8),p.dark,0,0,.38);nose.scale.z=1.7;
  for(const z of [-.23,.21]){const ring=techMesh(root,new T.TorusGeometry(.161,.018,5,12),p.orange,0,0,z);}
  for(let k=0;k<4;k++){const fin=techMesh(root,box(.028,.40,.27),p.silver,0,0,-.38);fin.rotation.z=k*Math.PI/2;}
  return bakeTech(root);
}
export function suitRocketModel(){
  const p=techPalette(),root=new T.Group();root.name='AEGIS micro rocket';
  const hull=techMesh(root,new T.CylinderGeometry(.028,.028,.25,8),p.silver);hull.rotation.x=Math.PI/2;
  const nose=techMesh(root,new T.ConeGeometry(.029,.085,8),p.orange,0,0,.168);nose.rotation.x=Math.PI/2;
  for(let k=0;k<4;k++){const fin=techMesh(root,box(.006,.10,.075),p.dark,0,0,-.096);fin.rotation.z=k*Math.PI/2;}
  const flame=techMesh(root,new T.ConeGeometry(.034,.24,8),p.glow,0,0,-.245);flame.rotation.x=-Math.PI/2;
  root.userData.flame=flame;return bakeTech(root);
}
export function suitLauncherModel(side=1){
  const p=techPalette(),root=new T.Group();root.name=side>0?'AEGISRocketRackR':'AEGISRocketRackL';
  techMesh(root,box(.23,.23,.39),p.dark,0,0,.045);
  techMesh(root,box(.245,.055,.24),p.shell,0,.13,.03);
  const chambers=[];
  for(let port=0;port<SUIT_RULES.rockets;port++){
    const tube=suitRocketPort(port);if(tube.side!==side)continue;
    const barrel=techMesh(root,new T.CylinderGeometry(.048,.048,.49,10),p.shell,-tube.right,tube.up,.075);barrel.rotation.x=Math.PI/2;
    const bore=techMesh(root,new T.CylinderGeometry(.032,.032,.018,10),p.dark,-tube.right,tube.up,.326);bore.rotation.x=Math.PI/2;
    const loaded=techMesh(root,new T.SphereGeometry(.023,8,6),p.orange,-tube.right,tube.up,.334);loaded.scale.z=.4;
    root.remove(loaded);chambers.push({port,mesh:loaded});
  }
  bakeTech(root);for(const {mesh}of chambers)root.add(mesh);
  root.userData.chambers=chambers;root.userData.suitSide=side;return root;
}
export function moduleModel(kind){
  if(kind==='fpv')return droneModel();
  if(kind==='aegis')return aegisDisplay();
  if(kind==='bomb'){const b=bombModel();b.scale.setScalar(.7);b.rotation.z=.35;return b;}
  const p=techPalette(),r=new T.Group();r.name=kind==='ram'?'IMPACT MATRIX':'TURBO CARTRIDGE';
  if(kind==='ram'){
    const core=techMesh(r,box(.60,.39,.24),p.shell);core.rotation.y=.08;
    for(const side of[-1,1]){const wing=techMesh(r,box(.24,.34,.12),p.silver,side*.30,0,.07);wing.rotation.y=-side*.28;}
    techMesh(r,box(.25,.13,.03),p.glow,0,.025,.145);
    for(let k=-2;k<=2;k++)techMesh(r,box(.05,.06,.03),p.orange,k*.105,-.12,.15);
  }else{
    for(const side of[-1,1]){
      const tank=techMesh(r,new T.CylinderGeometry(.11,.11,.54,10),p.shell,side*.15,0,0);
      for(const h of[-.2,.2])techMesh(r,new T.CylinderGeometry(.13,.13,.055,10),p.silver,side*.15,h,0);
      techMesh(r,new T.SphereGeometry(.08,8,6),p.glow,side*.15,.29,0);
    }
    techMesh(r,box(.38,.08,.12),p.dark,0,0,0);
  }return bakeTech(r);
}
function armorPart(kind,p){
  const r=new T.Group();r.name='AEGIS '+kind;
  if(kind==='torso'){
    techMesh(r,box(.50,.48,.35),p.shell,0,.16,0);techMesh(r,box(.34,.34,.055),p.silver,0,.18,.20);
    const core=techMesh(r,new T.CylinderGeometry(.095,.095,.034,6),p.glow,0,.20,.25);core.rotation.x=Math.PI/2;
    for(const side of[-1,1])techMesh(r,box(.12,.27,.18),p.dark,side*.27,.13,-.11);
  }else if(kind==='head'){
    const helmet=techMesh(r,new T.SphereGeometry(.235,12,8),p.shell,0,.12,0);helmet.scale.set(1,1.1,.92);
    techMesh(r,box(.35,.072,.10),p.glow,0,.19,.18);techMesh(r,box(.20,.14,.06),p.silver,0,.02,.20);
    for(const side of[-1,1])techMesh(r,box(.10,.16,.10),p.dark,side*.21,.13,0);
  }else if(kind==='boot'){
    techMesh(r,box(.22,.23,.36),p.shell,0,.04,.07);techMesh(r,box(.235,.055,.38),p.dark,0,-.095,.075);
    techMesh(r,new T.CylinderGeometry(.085,.06,.025,10),p.glow,0,-.13,0);
    techMesh(r,box(.15,.12,.10),p.silver,0,.10,.20);
  }else{
    techMesh(r,box(.20,.32,.21),p.shell,0,-.06,0);techMesh(r,box(.155,.11,.06),p.silver,0,.04,.125);
    const palm=techMesh(r,new T.CylinderGeometry(.061,.061,.035,10),p.glow,0,-.185,.12);palm.rotation.x=Math.PI/2;
    for(let k=0;k<4;k++)techMesh(r,box(.032,.13,.085),p.dark,-.062+k*.042,-.24,.04);
    techMesh(r,box(.03,.20,.045),p.orange,.108,-.025,0);
  }return bakeTech(r);
}
export function aegisDisplay(){
  const asset=modelAsset('aegis-player');
  if(!asset)throw Error('The uploaded suit GLB must be loaded before creating its display.');
  const a=instantiateCustomAvatar(asset,'suit'),r=new T.Group();a.model.scale.setScalar(.50);r.add(a.model);
  const idle=a.clips.find(c=>c.name==='Idle');if(idle){a.mixer.clipAction(idle).play();a.mixer.update(0);}
  r.userData.customSuitDisplay041=true;return r;
}
export function attachAegis(body){
  if(body.userData.avatarKind!=='suit')return {items:[],dispose(){}};
  const items=[suitLauncherModel(1),suitLauncherModel(-1)];
  for(const part of items){part.visible=false;body.add(part);}
  return {items,dispose(){for(const part of items)disposeTech(part);}};
}
export function suitHands(){
  const asset=modelAsset('aegis-gauntlets');if(!asset)throw Error('Uploaded suit gauntlets not loaded');
  const r=asset.scene.clone(true);r.traverse(o=>{if(o.isMesh)o.userData.sharedAvatar041=true;});
  const mat=new T.MeshBasicMaterial({color:0x97eeff,toneMapped:false}),geo=new T.CylinderGeometry(.032,.032,.008,12);
  for(const side of ['R','L']){
    const hand=r.getObjectByName('Gauntlet'+side);if(!hand)continue;hand.position.x=(side==='R'?1:-1)*Math.abs(hand.position.x);
    const emitter=techMesh(hand,geo,mat,0,.035,-.165);emitter.name='FP_AEGISPalm'+side;emitter.rotation.x=Math.PI/2;
  }
  return r;
}
export function vehicleModuleModel(v){
  const p=techPalette(),r=new T.Group();r.name='NOVA installed vehicle modules';
  if(v.mods?.ram){
    const d=v.bodyD||5.6,w=v.bodyW||3.5;
    for(const side of[-1,1]){const plate=techMesh(r,box(w*.52,.55,.18),p.silver,side*w*.22,.5,d*.51);plate.rotation.y=-side*.22;}
    for(let k=-2;k<=2;k++)techMesh(r,box(.13,.12,.23),p.orange,k*.40,.33,d*.53);
  }
  if(v.mods?.turbo){for(const side of[-1,1]){
    const z=-(v.bodyD||5.6)*.4,x=side*(v.bodyW||3.5)*.32;
    const tube=techMesh(r,new T.CylinderGeometry(.22,.25,.85,10),p.dark,x,.87,z);tube.rotation.x=Math.PI/2;
    const exhaust=techMesh(r,new T.CylinderGeometry(.18,.18,.08,10),p.glow,x,.87,z-.45);exhaust.rotation.x=Math.PI/2;
  }}
  if(v.mods?.bomb){for(const side of[-1,1])techMesh(r,box(.13,.17,1.1),p.silver,side*.42,.09,0);}
  return bakeTech(r);
}
