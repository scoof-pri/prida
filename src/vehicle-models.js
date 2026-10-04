import { tankPivots, poseTankRig } from './vehicle-rig.js';
import { vehicleDimensions } from './vehicle-specs.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// Original CC0 downloads are stored locally by the release installer; never fetched from third parties during a match.
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { objectSurface } from './materials.js';
import { wedgeData } from './vehicle-geometry.js';
const assets=new Map();
export const VEHICLE_ASSET_STATUS={tank:'not loaded',plane:'not loaded'};
export async function loadVehicleModels() {
  const loader=new GLTFLoader();
  let report={};try{const response=await fetch('./prida030-assets.json');if(response.ok)report=await response.json();}catch{}
  await Promise.all(['tank','plane'].map(async kind=>{
    if(report.models?.[kind]?.status==='fallback'){VEHICLE_ASSET_STATUS[kind]='built-in fallback';return;}
    try {const gltf=await loader.loadAsync(`./models/prida030/${kind}.glb`);assets.set(kind,gltf);VEHICLE_ASSET_STATUS[kind]='CC0 model loaded';}
    catch(error){VEHICLE_ASSET_STATUS[kind]='built-in fallback';console.warn('[PRIDA] '+kind+' CC0 model unavailable; using bundled procedural fallback.',error?.message);}
  }));
}
const UP=new T.Vector3(0,1,0);
const box=(w,h,d)=>new T.BoxGeometry(w,h,d);
function mat(color,roughness=.63,metalness=.15) {return objectSurface(new T.MeshStandardMaterial({color,roughness,metalness}),{surface:metalness>.5?'steel':'worn',size:.5,strength:.22,normal:.35});}
function mesh(g,geo,m,x=0,y=0,z=0){const o=new T.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;g.add(o);return o;}
function wedge(w,h,d,top=.78) {
  const {positions,indices}=wedgeData(w,h,d,top),indexed=new T.BufferGeometry();
  indexed.setAttribute('position',new T.Float32BufferAttribute(positions,3));indexed.setIndex(indices);
  const geometry=indexed.toNonIndexed();indexed.dispose();geometry.computeVertexNormals();return geometry;
}
// Merge only rigid children of generated models; animation pivots/wheels/tracks remain independent.
function mergeRigid(root,rig) {
  const moving=new Set([rig.turret,rig.barrelPivot,rig.barrel,rig.prop,rig.rudder,rig.canopy,...(rig.wheels||[]),...(rig.flaps||[]).map(f=>f.o)]);
  const groups=[];root.traverse(o=>{if(o.children?.length)groups.push(o);});
  for(const group of groups) {
    const batches=new Map();
    for(const child of group.children)if(child.isMesh&&!child.isInstancedMesh&&!child.isSkinnedMesh&&!moving.has(child)&&!Array.isArray(child.material)) {
      if(!batches.has(child.material))batches.set(child.material,[]);batches.get(child.material).push(child);
    }
    for(const [material,children] of batches)if(children.length>1) {
      const parts=children.map(child=>{child.updateMatrix();const geo=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();geo.deleteAttribute('uv');return geo.applyMatrix4(child.matrix);});
      const geo=mergeGeometries(parts,false);for(const p of parts)p.dispose();if(!geo)continue;
      const merged=new T.Mesh(geo,material);merged.castShadow=merged.receiveShadow=true;group.add(merged);
      for(const child of children){child.removeFromParent();child.geometry.dispose();}
    }
  }
  return root;
}
function tankModel() {
  const root=new T.Group(),metal=mat(0x5d7154),dark=mat(0x222a29,.89,.25),steel=mat(0x66716a,.42,.75),rubber=mat(0x151d1d,.93,0),rig={wheels:[],tracks:[],owned:true};
  mesh(root,wedge(2.66,.6,4.9,.85),metal,0,.65,0);
  mesh(root,wedge(2.5,.34,3.1,.80),metal,0,1.20,-.48);
  for(const side of [-1,1]) {
    mesh(root,box(.52,.16,5.02),metal,side*1.36,1.25,0);
    for(let j=0;j<7;j++){
      const wheel=mesh(root,new T.CylinderGeometry(.38,.38,.36,12),rubber,side*1.32,.43,-2.01+j*.67);wheel.rotation.z=Math.PI/2;rig.wheels.push(wheel);
      mesh(wheel,new T.CylinderGeometry(.20,.20,.37,10),steel);
    }
    for(let j=0;j<36;j++){
      const a=j/36*Math.PI*2,z=Math.cos(a)*2.16,y=.57+Math.sin(a)*.43;
      const link=mesh(root,box(.48,.11,.26),dark,side*1.34,y,z);link.rotation.x=Math.atan2(.43*Math.cos(a),-2.16*Math.sin(a));
      rig.tracks.push({o:link,a,side});
    }
  }
  // Rigid details join the existing material batches; no extra animation controllers.
  for(let k=0;k<7;k++)mesh(root,box(1.4,.045,.055),dark,0,1.56,-1.48+k*.13);
  for(const side of [-1,1]){
    mesh(root,box(.55,.32,.95),metal,side*1.08,1.35,-1.8);
    mesh(root,new T.TorusGeometry(.12,.027,5,10),steel,side*.82,.86,2.47);
    for(let k=0;k<5;k++)mesh(root,box(.13,.055,.10),steel,side*1.57,1.36,-1.8+k*.85);
  }
  const turret=new T.Group();turret.position.y=1.45;root.add(turret);rig.turret=turret;
  mesh(turret,wedge(2.13,.60,2.65,.78),metal,0,0,-.14);
  mesh(turret,new T.CylinderGeometry(.83,.87,.16,20),steel,0,-.04,0);
  mesh(turret,new T.CylinderGeometry(.33,.35,.12,16),steel,.55,.64,-.42);
  for(const side of [-1,1]){
    mesh(turret,box(.28,.12,.14),dark,side*.42,.65,.31);
    mesh(turret,box(.23,.12,.9),metal,side*1.02,.38,-.64);
    for(let k=0;k<3;k++)mesh(turret,box(.12,.10,.035),steel,side*.76,.36,-1.48+k*.04);
  }
  const barrelPivot=new T.Group();barrelPivot.position.set(0,.42,1.07);turret.add(barrelPivot);rig.barrelPivot=barrelPivot;
  const barrel=new T.Group();barrelPivot.add(barrel);rig.barrel=barrel;
  mesh(barrel,wedge(.64,.47,.48,.83),metal,0,-.24,0);
  const tube=mesh(barrel,new T.CylinderGeometry(.087,.14,2.50,12),steel,0,0,1.23);tube.rotation.x=Math.PI/2;
  const muzzle=mesh(barrel,new T.CylinderGeometry(.145,.145,.35,12,1,true),dark,0,0,2.52);muzzle.rotation.x=Math.PI/2;
  const mg=new T.Group();mg.position.set(.64,.87,.1);turret.add(mg);
  mesh(mg,box(.16,.14,.64),steel,0,0,.23);mesh(mg,box(.25,.28,.25),dark,.15,-.15,.1);
  const mgt=mesh(mg,new T.CylinderGeometry(.032,.042,.76,8),dark,0,.01,.89);mgt.rotation.x=Math.PI/2;
  for(const side of [-1,1])for(let k=0;k<3;k++){
    const smoke=mesh(turret,new T.CylinderGeometry(.075,.075,.32,8),steel,side*.95,.49,-.65+k*.20);smoke.rotation.z=side*.55;
  }
  const antenna=mesh(turret,new T.CylinderGeometry(.01,.016,.9,5),dark,-.64,1.08,-.84);antenna.rotation.z=-.10;
  const links=new T.InstancedMesh(rig.tracks[0].o.geometry,dark,rig.tracks.length);links.castShadow=links.receiveShadow=true;root.add(links);rig.trackMesh=links;
  rig.tracks.forEach(({o},i)=>{o.updateMatrix();links.setMatrixAt(i,o.matrix);root.remove(o);if(i)o.geometry.dispose();});
  root.userData.rig=rig;return mergeRigid(root,rig);
}
function planeModel() {
  const root=new T.Group(),paint=mat(0x798d80,.48,.5),steel=mat(0x768486,.3,.82),dark=mat(0x16282d,.54,.3),glass=new T.MeshStandardMaterial({color:0x365b66,roughness:.12,metalness:.28}),rig={wheels:[],flaps:[],owned:true};
  const body=mesh(root,new T.SphereGeometry(1,20,12),paint,0,1.12,0);body.scale.set(.53,.53,3.6);
  for(const side of [-1,1]) {
    const wing=mesh(root,wedge(4.4,.20,1.6,.91),paint,side*2.05,1.12,.10);wing.rotation.z=-side*.025;
    const flap=new T.Group();flap.position.set(side*2.55,1.15,-.57);root.add(flap);
    mesh(flap,box(2.85,.09,.48),paint,0,0,-.20);rig.flaps.push({o:flap,side});
    const tail=mesh(root,wedge(1.6,.14,.80,.9),paint,side*.92,1.35,-2.77);
    const wheel=mesh(root,new T.CylinderGeometry(.31,.31,.19,12),dark,side*.9,.33,.82);wheel.rotation.z=Math.PI/2;rig.wheels.push(wheel);
    mesh(root,box(.075,.72,.075),steel,side*.9,.72,.82);
    const cannon=mesh(root,new T.CylinderGeometry(.034,.046,.73,8),dark,side*1.4,1.24,1.05);cannon.rotation.x=Math.PI/2;
  }
  for(const side of [-1,1]){
    for(let k=0;k<5;k++){const port=mesh(root,new T.CylinderGeometry(.07,.08,.17,6),steel,side*.48,1.23,1.1+k*.24);port.rotation.z=Math.PI/2;}
    mesh(root,box(.34,.021,1.25),dark,side*.72,1.235,.02);
    const nav=mesh(root,new T.SphereGeometry(.045,6,4),steel,side*4.12,1.32,.05);
  }
  const canopy=mesh(root,new T.SphereGeometry(1,12,8),glass,0,1.61,-.10);canopy.scale.set(.46,.47,.91);rig.canopy=canopy;
  const fin=mesh(root,wedge(.14,1.35,1.03,.9),paint,0,1.35,-2.87);
  const rudder=new T.Group();rudder.position.set(0,1.97,-3.39);root.add(rudder);mesh(rudder,box(.085,1.15,.34),paint,0,0,-.12);rig.rudder=rudder;
  const prop=new T.Group();prop.position.set(0,1.13,3.37);root.add(prop);rig.prop=prop;
  const spinner=mesh(prop,new T.ConeGeometry(.29,.52,16),steel,0,0,.17);spinner.rotation.x=Math.PI/2;
  for(const a of [0,Math.PI/2]){const blade=mesh(prop,box(2.5,.095,.09),dark);blade.rotation.z=a;}
  const tailWheel=mesh(root,new T.CylinderGeometry(.15,.15,.10,10),dark,0,.18,-2.78);tailWheel.rotation.z=Math.PI/2;rig.wheels.push(tailWheel);
  root.userData.rig=rig;return mergeRigid(root,rig);
}
export function fallbackCar() {
  const root=new T.Group(),paint=mat(0x758a97,.32,.42),dark=mat(0x202e34,.18,.4),rubber=mat(0x172020,.85,0),rig={wheels:[],owned:true};
  mesh(root,wedge(1.84,.62,4.08,.94),paint,0,.3,0);mesh(root,wedge(1.52,.64,2.08,.76),dark,0,.85,-.28);
  mesh(root,box(1.19,.05,1.65),paint,0,1.51,-.29);
  for(const side of [-1,1])for(const z of [-1.34,1.29]){const w=mesh(root,new T.CylinderGeometry(.34,.34,.23,14),rubber,side*.91,.36,z);w.rotation.z=Math.PI/2;rig.wheels.push(w);}
  for(const side of [-1,1])mesh(root,box(.40,.13,.07),new T.MeshStandardMaterial({color:0xe5e3ca,emissive:0xd8d3a1,emissiveIntensity:.4}),side*.58,.70,2.07);
  root.userData.rig=rig;return mergeRigid(root,rig);
}
function findPart(root,rx){let best=null;root.traverse(o=>{if(!best&&rx.test(o.name))best=o;});return best;}
export function vehicleModel(kind,nativeCar=null,state={kind}) {
  if(kind==='car'){
    const root=nativeCar?.clone(true)||fallbackCar();root.userData.rig??={wheels:[],owned:false};
    root.traverse(o=>{if(o.isMesh&&/wheel/i.test(o.name)&&!root.userData.rig.wheels.includes(o))root.userData.rig.wheels.push(o);});
    if(nativeCar){const bounds=new T.Box3().setFromObject(root),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),dims=vehicleDimensions({...state,kind}),k=Math.min(dims.w/Math.max(size.x,.1),dims.d/Math.max(size.z,.1),dims.h/Math.max(size.y,.1));const group=new T.Group();root.scale.multiplyScalar(k);root.position.add(new T.Vector3(-center.x*k,-bounds.min.y*k,-center.z*k));group.add(root);group.userData.rig=root.userData.rig;return group;}return root;
  }
  if(kind==='tank'&&state.variant)return variantTankModel(state.variant);
  const loaded=assets.get(kind);
  if(loaded){
    const root=loaded.scene.clone(true);root.userData.rig={owned:false,wheels:[]};
    if(kind==='tank') {
      const pivots=tankPivots(root);
      if(!pivots){VEHICLE_ASSET_STATUS.tank='built-in fallback';console.warn('[PRIDA] external tank lacks linked yaw/elevation pivots; using the fully rigged tank.');return tankModel();}
      const {turret,barrelPivot}=pivots;
      Object.assign(root.userData.rig,{turret,barrelPivot,external:true,turretBase:turret.rotation.y,barrelBase:barrelPivot.rotation.x});
    }else{
      root.userData.rig.prop=findPart(root,/^prop$|propeller|prop-pivot/i);
      root.userData.rig.rudder=findPart(root,/^rudder$/i);root.userData.rig.external=true;
      root.userData.rig.canopy=findPart(root,/^canopy$/i);
      root.userData.rig.flaps=[];root.traverse(o=>{if(/^aileron-(left|right)$/.test(o.name))root.userData.rig.flaps.push({o,side:/right/.test(o.name)?1:-1});});
      root.userData.rig.mixer=new T.AnimationMixer(root);root.userData.rig.animationRoot=root;root.userData.rig.actions={};
      for(const clip of loaded.animations||[])if(['prop-spin','canopy-open','canopy-close'].includes(clip.name)){const a=root.userData.rig.mixer.clipAction(clip);root.userData.rig.actions[clip.name]=a;if(clip.name==='prop-spin')a.play();else {a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;}}
    }
    root.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}if(/wheel/i.test(o.name)&&!o.isMesh)root.userData.rig.wheels.push(o);});
    // Fit into the authoritative envelope without changing the mesh hierarchy/pivots.
    const bounds=new T.Box3().setFromObject(root),size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3());
    const target=kind==='plane'?{w:9.4,d:8.8}:{w:3.2,d:7.5},scale=Math.min(target.w/Math.max(.01,size.x),target.d/Math.max(.01,size.z));
    const wrapper=new T.Group();root.scale.multiplyScalar(scale);root.position.add(new T.Vector3(-centre.x*scale,-bounds.min.y*scale,-centre.z*scale));wrapper.add(root);wrapper.userData.rig=root.userData.rig;return wrapper;
  }
  return kind==='tank'?tankModel():planeModel();
}
export function animateVehicle(root,v,dt) {
  const r=root.userData.rig||{};
  poseTankRig(r,v.turret,v.angle,v.barrel);
  if(r.radar&&v.hp>0)r.radar.rotation.y+=dt*1.8;
  r.recoil=Math.max(0,(r.recoil||0)-dt*3);
  if(r.shot!==v.shot){if(r.shot!==undefined)r.recoil=1;r.shot=v.shot;}
  if(r.barrel)r.barrel.position.z=-r.recoil*.26;
  if(r.mixer){const actions=r.actions||{},prop=actions['prop-spin'];if(prop)prop.timeScale=(v.engine||0)*2.5;
    if(r.occupied!==!!v.driver){r.occupied=!!v.driver;const key=v.driver?'canopy-close':'canopy-open',other=v.driver?'canopy-open':'canopy-close';actions[other]?.stop();actions[key]?.reset().play();}r.mixer.update(dt);}
  if(r.prop&&!r.actions?.['prop-spin'])r.prop.rotation.z+=dt*(v.engine||0)*85;
  for(const w of r.wheels||[]){w.userData.pridaWheelRestX??=w.rotation.x;w.rotation.x=w.userData.pridaWheelRestX+(v.wheelPhase||0);}
  if(r.trackPhase!==v.wheelPhase) {r.trackPhase=v.wheelPhase;
  for(const [i,{o,a}] of (r.tracks||[]).entries()){const q=a+(v.wheelPhase||0)*.20;o.position.y=.57+Math.sin(q)*.43;o.position.z=Math.cos(q)*2.16;o.rotation.x=Math.atan2(.43*Math.cos(q),-2.16*Math.sin(q));if(r.trackMesh){o.updateMatrix();r.trackMesh.setMatrixAt(i,o.matrix);}}if(r.trackMesh)r.trackMesh.instanceMatrix.needsUpdate=true; }
  for(const f of r.flaps||[])f.o.rotation.x=(v.roll||0)*f.side*.50+(v.pitch||0)*.25;
  if(r.rudder)r.rudder.rotation.y=(v.steer||0)*.35;
}
export function disposeVehicleModel(root) {
  const rig=root?.userData.rig;rig?.mixer?.stopAllAction();if(rig?.mixer&&rig.animationRoot)rig.mixer.uncacheRoot(rig.animationRoot);
  if(!root?.userData.rig?.owned)return;const geos=new Set(),mats=new Set();
  root.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.isMesh){geos.add(o.geometry);for(const m of [o.material].flat())mats.add(m);}});for(const g of geos)g.dispose();for(const m of mats)m.dispose();
}

// New fictional armaments share the existing tracked chassis, not a second body collider.
function variantTankModel(variant){
  const root=tankModel(),r=root.userData.rig;
  const paint=mat(variant==='sam'?0x425869:0x52633d),steel=mat(0xa9b5ae,.45,.65),dark=mat(0x18282d);
  // Two clearly separated four-round rack supports. Tubes and loaded rounds are handled by RocketRack.
  for(const side of [-1,1]){
    mesh(r.turret,box(.28,.82,.80),paint,side*1.34,.70,-.28);
    mesh(r.turret,box(.70,.12,1.35),steel,side*1.35,.76,-.28);
    mesh(r.turret,box(.50,.08,.30),dark,side*1.34,.82,-.71);
  }
  if(variant==='sam'){
    r.barrelPivot.visible=false;
    const radar=new T.Group();radar.position.set(0,1.18,-.85);r.turret.add(radar);r.radar=radar;
    mesh(radar,new T.CylinderGeometry(.08,.12,.7,8),steel,0,.28,0);
    const disc=mesh(radar,new T.CylinderGeometry(.53,.42,.10,16),paint,0,.78,0);disc.rotation.x=Math.PI/2;
    mesh(radar,box(.055,.05,.42),steel,0,.78,.20);
  }else{
    for(const side of [-1,1])mesh(r.turret,box(.06,.08,.30),steel,side*.9,.64,.67);
  }
  root.name=variant==='sam'?'WARDEN player air defence':'HYDRA dual launcher';
  return root;
}
