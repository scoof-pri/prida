// Cosmetic aircraft fragments use the actual rendered geometry. Game damage and
// collider removal remain authoritative in VehicleSystem; debris cannot hurt players.
import * as T from 'three';
import {aircraftPoint,aircraftQuaternion,aircraftTurn} from './aircraft-geometry.js';
import {castMap} from './raycast.js';
import {groundHeight} from './terrain.js';
export const AIRCRAFT_FRAGMENT_LIMIT=64;
export function aircraftFragment(p,name=''){
  const n=name.toLowerCase();
  if(n.includes('canopy'))return 'canopy';
  if(n.includes('prop'))return 'propeller';
  if(n.includes('wheel')||p.y<.70){if(p.z< -1.7)return 'tail';return p.x<0?'gear-left':'gear-right';}
  if(p.z< -1.7)return 'tail';
  if(Math.abs(p.x)>.65)return p.x<0?'wing-left':'wing-right';
  return 'fuselage';
}
export function splitAircraftModel(root){
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),groups=new Map(),point=new T.Vector3(),normal=new T.Vector3();
  root.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||!o.geometry?.attributes.position)return;
    const g=o.geometry,pos=g.attributes.position,index=g.index,local=new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld),normalMatrix=new T.Matrix3().getNormalMatrix(local);
    let name=o.name||'';for(let p=o.parent;p&&p!==root;p=p.parent)name+=' '+p.name;
    const count=index?index.count:pos.count;
    for(let i=0;i+2<count;i+=3){
      const indices=[0,1,2].map(k=>index?index.getX(i+k):i+k),vertices=indices.map(j=>point.fromBufferAttribute(pos,j).applyMatrix4(local).clone()),center=vertices.reduce((p,q)=>p.add(q),new T.Vector3()).multiplyScalar(1/3);
      const key=aircraftFragment(center,name);if(!groups.has(key))groups.set(key,new Map());const group=groups.get(key);
      let material=o.material;if(Array.isArray(material)){const section=g.groups.find(s=>i>=s.start&&i<s.start+s.count);material=material[section?.materialIndex||0];}
      if(!group.has(material))group.set(material,{position:[],normal:[],uv:[],color:[]});const out=group.get(material);
      for(let k=0;k<3;k++){
        out.position.push(...vertices[k].toArray());
        if(g.attributes.normal){normal.fromBufferAttribute(g.attributes.normal,indices[k]).applyNormalMatrix(normalMatrix);out.normal.push(...normal.toArray());}
        for(const key of ['uv','color']){const attr=g.attributes[key];if(attr)for(let j=0;j<Math.min(attr.itemSize,key==='uv'?2:3);j++)out[key].push(attr.getComponent(indices[k],j));}
      }
    }
  });
  const pieces=[];
  for(const [name,batches] of groups){
    const bounds=new T.Box3();for(const a of batches.values())for(let i=0;i<a.position.length;i+=3)bounds.expandByPoint(point.fromArray(a.position,i));
    const center=bounds.getCenter(new T.Vector3()),half=bounds.getSize(new T.Vector3()).multiplyScalar(.5),group=new T.Group();group.name='wreck-'+name;
    for(const [source,a] of batches){
      for(let i=0;i<a.position.length;i+=3){a.position[i]-=center.x;a.position[i+1]-=center.y;a.position[i+2]-=center.z;}
      const geometry=new T.BufferGeometry();for(const key of ['position','normal','uv','color'])if(a[key].length)geometry.setAttribute(key,new T.Float32BufferAttribute(a[key],key==='uv'?2:3));
      if(!geometry.attributes.normal)geometry.computeVertexNormals();geometry.computeBoundingSphere();
      const material=source.clone();material.color?.multiplyScalar(name==='canopy'?.7:.48);if(material.emissive)material.emissive.setHex(0);
      const mesh=new T.Mesh(geometry,material);mesh.castShadow=false;mesh.receiveShadow=true;group.add(mesh);
    }
    pieces.push({name,model:group,center:{x:center.x,y:center.y,z:center.z},half});
  }
  return pieces;
}
function disposeFragment(p){p.model.removeFromParent();p.model.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of [o.material].flat())m.dispose();}});}
export class AircraftWreckage{
  constructor(root,map,fx){this.root=root;this.map=map;this.fx=fx;this.pieces=[];this.seen=new Set();this.smoke=0;}
  spawn(id,model,pose,age=0){
    if(this.seen.has(id)||age>18)return false;this.seen.add(id);
    const fragments=splitAircraftModel(model),rotation=aircraftQuaternion(pose);
    for(let i=0;i<fragments.length;i++){
      const p=fragments[i],c=p.center,side=p.name.endsWith('left')?-1:p.name.endsWith('right')?1:0;
      const impulse=aircraftTurn({x:side*7+(i%2?.4:-.4),y:p.name==='canopy'?7.5:3.2+(i%3),z:p.name==='tail'?-7:p.name==='propeller'?9:0},pose);
      p.model.position.copy(aircraftPoint(pose,c));p.model.quaternion.set(rotation.x,rotation.y,rotation.z,rotation.w);
      p.velocity=new T.Vector3((pose.vx||0)+impulse.x,(pose.vy||0)+impulse.y,(pose.vz||0)+impulse.z);
      p.spin=new T.Vector3(.55+(i%3)*.7,(i%2?-1:1)*.7,side?side*2.1:.8);p.life=18;p.age=0;p.vehicleId=id;
      this.root.add(p.model);this.pieces.push(p);
    }
    while(this.pieces.length>AIRCRAFT_FRAGMENT_LIMIT)disposeFragment(this.pieces.shift());
    // A sparse snapshot may arrive just after the event was lost. Catch up only that
    // aircraft, with bounded steps; do not advance fragments already on screen.
    for(let t=0;t<Math.min(age,3);t+=1/30)for(const p of fragments)this.stepPiece(p,Math.min(1/30,age-t));
    return true;
  }
  stepPiece(p,dt){
    p.life-=dt;p.age+=dt;const pos=p.model.position,old=pos.clone(),drag=Math.exp(-.12*dt);
    p.velocity.y-=9.81*dt;p.velocity.multiplyScalar(drag);const move=p.velocity.clone().multiplyScalar(dt),distance=move.length();
    if(distance>1e-5){const direction=move.clone().multiplyScalar(1/distance),hit=castMap(old,direction,distance,this.map,null,true);
      if(hit.distance<distance-1e-5){pos.copy(old).addScaledVector(direction,Math.max(0,hit.distance-.06));const n=new T.Vector3(hit.impact?.x||0,hit.impact?.y||0,hit.impact?.z||0);
        if(n.lengthSq()>.01){n.normalize();const into=p.velocity.dot(n);if(into<0)p.velocity.addScaledVector(n,-1.25*into);p.velocity.multiplyScalar(.67);p.spin.multiplyScalar(.7);}
      }else pos.add(move);
    }
    const turn=new T.Quaternion().setFromEuler(new T.Euler(p.spin.x*dt,p.spin.y*dt,p.spin.z*dt));p.model.quaternion.multiply(turn);p.spin.multiplyScalar(Math.exp(-.18*dt));
    p.model.updateMatrix();const e=p.model.matrix.elements,half=p.half,extent=Math.abs(e[1])*half.x+Math.abs(e[5])*half.y+Math.abs(e[9])*half.z;
    const floor=groundHeight(pos.x,pos.z,this.map)+extent+.025;
    if(pos.y<floor){pos.y=floor;if(p.velocity.y<0)p.velocity.y=-p.velocity.y*.20;p.velocity.x*=Math.exp(-3.5*dt);p.velocity.z*=Math.exp(-3.5*dt);p.spin.multiplyScalar(Math.exp(-4*dt));if(Math.abs(p.velocity.y)<.65)p.velocity.y=0;}
    p.model.scale.setScalar(Math.min(1,Math.max(0,p.life/1.2)));
  }
  update(dt,hidden=false){
    dt=Math.max(0,Math.min(.08,dt||0));this.smoke+=dt;
    for(let i=this.pieces.length-1;i>=0;i--){const p=this.pieces[i];p.model.visible=!hidden;for(let left=dt;left>0;left-=1/30)this.stepPiece(p,Math.min(1/30,left));
      if(p.life<=0){disposeFragment(p);this.pieces.splice(i,1);continue;}
      if(!hidden&&this.smoke>.16&&p.age<4&&['fuselage','wing-left','wing-right'].includes(p.name))this.fx?.burst(p.model.position,1,0x454742,.45,1.2,true,1.1);
    }
    if(this.smoke>.16)this.smoke=0;
  }
  forget(id){for(let i=this.pieces.length-1;i>=0;i--)if(this.pieces[i].vehicleId===id){disposeFragment(this.pieces[i]);this.pieces.splice(i,1);}this.seen.delete(id);}
  dispose(){for(const p of this.pieces)disposeFragment(p);this.pieces.length=0;this.seen.clear();}
}
