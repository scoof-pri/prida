// Original procedural models; no new remote asset requests or physics bodies.
import * as T from 'three';
import {objectSurface} from './materials.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const box=(w,h,d)=>new T.BoxGeometry(w,h,d);
function mesh(group,geometry,material,x=0,y=0,z=0){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;group.add(m);return m;}
function merge(group){
  const by=new Map();for(const m of [...group.children])if(m.isMesh){if(!by.has(m.material))by.set(m.material,[]);by.get(m.material).push(m);}
  for(const [material,parts]of by){if(parts.length<2)continue;const geometries=parts.map(m=>{m.updateMatrix();const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();g.deleteAttribute('uv');return g.applyMatrix4(m.matrix);});const geo=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());if(!geo)continue;mesh(group,geo,material);parts.forEach(m=>{m.removeFromParent();m.geometry.dispose();});}
}
export function helicopterModel(){
  const root=new T.Group();root.name='OSPREY utility helicopter';
  const paint=new T.MeshStandardMaterial({color:0x5c746d,roughness:.63,metalness:.22});
  const metal=new T.MeshStandardMaterial({color:0x313e43,roughness:.47,metalness:.72});
  const glass=new T.MeshStandardMaterial({color:0x203e4c,roughness:.12,metalness:.48});
  const yellow=new T.MeshStandardMaterial({color:0xe3b955,roughness:.55});
  objectSurface(paint,{surface:'worn',size:.65,strength:.15,normal:.2});
  objectSurface(metal,{surface:'steel',size:.35,strength:.12,normal:.15});
  const rig={owned:true,wheels:[]};
  const hull=mesh(root,new T.SphereGeometry(1,16,10),paint,0,1.48,.18);hull.scale.set(1.05,1.04,2.48);
  const cockpit=mesh(root,new T.SphereGeometry(1,14,8),glass,0,1.80,1.44);cockpit.scale.set(.89,.75,1.18);
  mesh(root,box(.06,1.05,1.12),paint,0,2.08,1.68);
  for(const side of[-1,1]){
    mesh(root,box(.06,.85,1.15),glass,side*1.018,1.76,-.19);
    mesh(root,box(.07,.045,1.7),metal,side*1.08,1.21,-.08);
    mesh(root,box(.12,.10,.34),metal,side*1.08,1.31,.4);
    mesh(root,box(.10,.11,5.15),metal,side*1.12,.15,0);
    for(const z of[-1.25,1.15])mesh(root,box(.11,.72,.11),metal,side*.98,.52,z);
    const nose=mesh(root,new T.CylinderGeometry(.075,.075,.66,7),metal,side*1.12,.25,2.65);nose.rotation.x=.8;
    mesh(root,box(1.13,.13,.68),paint,side*1.35,1.09,-.35);
    for(let i=0;i<5;i++)mesh(root,box(.04,.11,.34),metal,side*.54,2.64,-.55+i*.17);
  }
  const tail=mesh(root,new T.ConeGeometry(.49,4.4,10),paint,0,1.60,-3.90);tail.rotation.x=-Math.PI/2;
  mesh(root,box(2.05,.09,.70),paint,0,1.84,-5.21);
  const fin=mesh(root,box(.11,1.5,.62),paint,0,2.08,-5.64);fin.rotation.x=-.18;
  mesh(root,box(.12,.16,.63),yellow,0,2.77,-5.75);
  mesh(root,new T.CylinderGeometry(.10,.13,.58,10),metal,0,2.87,-.22);
  const main=new T.Group();main.name='main-rotor';main.position.set(0,3.18,-.22);root.add(main);rig.mainRotor=main;
  mesh(main,new T.CylinderGeometry(.30,.30,.13,10),metal);
  for(let i=0;i<4;i++){const arm=new T.Group();arm.rotation.y=i*Math.PI/2;main.add(arm);mesh(arm,box(.23,.045,4.0),metal,0,0,2.08);mesh(arm,box(.24,.05,.30),yellow,0,0,3.92);merge(arm);}
  const tailRotor=new T.Group();tailRotor.name='tail-rotor';tailRotor.position.set(.23,2.2,-5.74);root.add(tailRotor);rig.tailRotor=tailRotor;
  for(let i=0;i<2;i++){const blade=mesh(tailRotor,box(.055,1.28,.105),metal);blade.rotation.x=i*Math.PI/2;}
  const gun=new T.Group();gun.name='chin-gun';gun.position.set(0,.86,2.28);root.add(gun);rig.chinGun=gun;
  mesh(gun,new T.SphereGeometry(.20,10,6),metal);
  const barrel=mesh(gun,new T.CylinderGeometry(.045,.075,.68,8),metal,0,0,.44);barrel.rotation.x=Math.PI/2;
  const muzzle=new T.Object3D();muzzle.name='gun-muzzle';muzzle.position.z=.78;gun.add(muzzle);merge(gun);
  merge(root);root.userData.rig=rig;return root;
}
let wingsResources;
function wingResources(){
  if(wingsResources)return wingsResources;
  const shape=new T.Shape();shape.moveTo(0,0);shape.lineTo(1.68,-.15);shape.lineTo(1.34,-.65);shape.lineTo(.35,-.88);shape.lineTo(0,-.34);shape.closePath();
  const geo=new T.ExtrudeGeometry(shape,{depth:.028,bevelEnabled:false});geo.rotateX(Math.PI/2);
  wingsResources={wing:geo,back:box(.40,.58,.18),fabric:new T.MeshStandardMaterial({color:0x2c697b,roughness:.86,metalness:.05,side:T.DoubleSide}),frame:new T.MeshStandardMaterial({color:0xd4bf84,roughness:.42,metalness:.52})};return wingsResources;
}
export function wingsModel(){
  const r=wingResources(),root=new T.Group();root.name='KITE folding wings';
  mesh(root,r.back,r.frame,0,0,0);
  const pivots=[];for(const side of[-1,1]){const p=new T.Group();p.position.x=side*.16;root.add(p);const wing=mesh(p,r.wing,r.fabric);wing.scale.x=side;p.userData.side=side;pivots.push(p);}
  root.userData.wingPivots=pivots;poseWings(root,false,0);return root;
}
export function poseWings(root,open,dt){
  if(!root?.userData.wingPivots)return;
  const target=open?1:0;root.userData.fold=dt>0?target+(Number(root.userData.fold??target)-target)*Math.exp(-9*dt):target;
  for(const p of root.userData.wingPivots){p.rotation.y=p.userData.side*(1-root.userData.fold)*1.35;p.rotation.z=p.userData.side*.09;}
}
export function animateHelicopter(root,v,dt){
  const rig=root.userData.rig;if(!rig?.mainRotor)return;
  if(rig.chinGun)rig.chinGun.rotation.x=(v.pitch||0)-(v.barrel||0);
  const step=dt*Math.max(0,v.engine||0)*39;
  rig.mainRotor.rotation.y=(rig.mainRotor.rotation.y+step)%(Math.PI*2);
  rig.tailRotor.rotation.x=(rig.tailRotor.rotation.x-step*1.45)%(Math.PI*2);
}
