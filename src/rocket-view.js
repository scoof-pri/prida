// Rocket rack and flight effects. All models are generated locally; no new downloads or physics bodies.
import * as T from 'three';
import { ROCKETS, rocketSpec, rocketSlot, MAX_VEHICLE_PROJECTILES } from './vehicle-rockets.js';
import { rocketMeshData } from './rocket-geometry.js';
const FORWARD=new T.Vector3(0,0,1);
const geometry=kind=>{const d=rocketMeshData(kind),g=new T.BufferGeometry();for(const [name,data] of Object.entries(d))g.setAttribute(name,new T.Float32BufferAttribute(data,name==='uv'?2:3));g.computeBoundingSphere();return g;};
// Reference-counted shared resources survive rapid streamed vehicle entry/exit without leaking geometry.
let cache=null;
function acquire(){
  if(!cache){cache={users:0,tank:geometry('tank'),plane:geometry('plane'),
    rocket:new T.MeshStandardMaterial({vertexColors:true,metalness:.45,roughness:.55}),
    steel:new T.MeshStandardMaterial({color:0x526457,metalness:.5,roughness:.68}),
    bore:new T.MeshStandardMaterial({color:0x182524,metalness:.4,roughness:.8,side:T.BackSide}),
    flame:new T.MeshBasicMaterial({color:0xffc661,toneMapped:false,transparent:true,opacity:.82,depthWrite:false}),
    flameGeo:new T.ConeGeometry(.1,.48,6).rotateX(-Math.PI/2),
    tube:new T.CylinderGeometry(.16,.16,1.20,10,1,true).rotateX(Math.PI/2),
    inner:new T.CylinderGeometry(.137,.137,1.19,10,1,true).rotateX(Math.PI/2),
    ring:new T.TorusGeometry(.148,.013,5,10),bracket:new T.BoxGeometry(.32,.12,.50)};}
  cache.users++;return cache;
}
function release(c){if(--c.users>0)return;for(const v of Object.values(c))if(v?.dispose)v.dispose();if(cache===c)cache=null;}
export class RocketRack {
  constructor(model,kind){
    this.state=typeof kind==='string'?{kind}:kind;kind=this.state.kind;this.kind=kind;this.spec=rocketSpec(this.state);this.slots=[];this.batches=[];if(!this.spec)return;
    this.resources=acquire();const r=this.resources;
    this.root=new T.Group();this.root.name='rocket-launchers';model.add(this.root);
    this.yaw=new T.Group();this.root.add(this.yaw);
    // Transform-only named markers retain exact muzzle coordinates for simulation/render checks.
    for(let i=0;i<this.spec.magazine;i++){
      const at=rocketSlot(this.state,i),pivot=new T.Group();pivot.position.set(at.x,at.y,at.z);pivot.name='rocket-station-'+i;this.yaw.add(pivot);
      const missile=new T.Object3D();missile.name='loaded-rocket-'+i;pivot.add(missile);this.slots.push({pivot,missile,index:i});
    }
    const batch=(geo,mat,offsets,loaded=false)=>{
      const mesh=new T.InstancedMesh(geo,mat,this.spec.magazine*offsets.length);mesh.castShadow=mesh.receiveShadow=true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;this.root.add(mesh);
      this.batches.push({mesh,offsets,loaded});
    };
    if(kind==='tank'){
      batch(r.tube,r.steel,[[0,0,0]]);batch(r.inner,r.bore,[[0,0,0]]);batch(r.ring,r.steel,[[0,0,.603],[0,0,-.603]]);
    }
    batch(r.bracket,r.steel,[[0,kind==='plane'?.16:-.16,0]]);
    batch(r[kind],r.rocket,[[0,0,0]],true);
    this.matrix=new T.Matrix4();this.offset=new T.Matrix4();this.zero=new T.Vector3(0,0,0);
    this.update({...this.state,hp:1,angle:0,turret:0,barrel:0,rocketAmmo:this.spec.magazine});
  }
  update(v){
    if(!this.spec)return;
    this.root.visible=v.hp>0&&!v.crushed;
    const relative=(v.turret||0)-(v.angle||0),elevation=v.barrel||0;
    this.yaw.rotation.y=this.kind==='tank'?relative:0;this.yaw.updateMatrix();
    for(const s of this.slots){
      s.pivot.rotation.x=this.kind==='tank'?-elevation:0;s.pivot.updateMatrix();
      s.missile.visible=this.spec.infinite||(s.index>=this.spec.magazine-(v.rocketAmmo??this.spec.magazine)&&!(v.rocketReload>0));
    }
    const key=[relative,elevation,v.rocketAmmo,v.rocketReload>0].join(':');if(this.key===key)return;this.key=key;
    for(const b of this.batches){let i=0;
      for(const s of this.slots)for(const [x,y,z] of b.offsets){
        this.matrix.multiplyMatrices(this.yaw.matrix,s.pivot.matrix).multiply(this.offset.makeTranslation(x,y,z));
        if(b.loaded&&!s.missile.visible)this.matrix.scale(this.zero);
        b.mesh.setMatrixAt(i++,this.matrix);
      }
      b.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  dispose(){this.root?.removeFromParent();for(const b of this.batches)b.mesh.dispose();this.batches=[];if(this.resources){release(this.resources);this.resources=null;}}
}
export class RocketFlights {
  constructor(parent,fx){this.fx=fx;this.root=new T.Group();this.root.name='rocket-flight-effects';parent.add(this.root);this.entries=new Map();this.resources=acquire();this.dir=new T.Vector3();this.smokeTime=0;}
  update(rounds,dt,camera,menu=false){
    const live=new Set(),rsc=this.resources;let smokeBudget=dt>0?8:0;
    this.root.visible=!menu;
    for(const r of rounds){
      if(r.weapon!=='rocket'||!ROCKETS[r.kind])continue;
      if(live.size>=MAX_VEHICLE_PROJECTILES)break;
      live.add(r.id);let e=this.entries.get(r.id);
      if(!e){const root=new T.Group(),body=new T.Mesh(rsc[r.kind],rsc.rocket),flame=new T.Mesh(rsc.flameGeo,rsc.flame);
        root.add(body,flame);flame.position.z=-ROCKETS[r.kind].length*.5-.24;this.root.add(root);
        root.position.set(r.x,r.y,r.z);e={root,flame,clock:0,since:0,stamp:-1};this.entries.set(r.id,e);}
      if(e.stamp!==r.age||e.rx!==r.x||e.ry!==r.y||e.rz!==r.z){e.stamp=r.age;e.rx=r.x;e.ry=r.y;e.rz=r.z;e.since=0;}else e.since+=dt;
      const t=Math.min(.065,e.since),x=r.x+r.dx*t,y=r.y+r.dy*t,z=r.z+r.dz*t;
      if(dt<=0||e.root.position.distanceToSquared(this.dir.set(x,y,z))>900)e.root.position.set(x,y,z);
      else e.root.position.lerp(this.dir,1-Math.exp(-45*dt));
      this.dir.set(r.dx,r.dy,r.dz).normalize();e.root.quaternion.setFromUnitVectors(FORWARD,this.dir);
      const near=!camera||e.root.position.distanceToSquared(camera)<240*240;e.root.visible=near;
      e.flame.scale.setScalar(.88+.12*Math.sin((r.age||0)*80+r.id));
      e.clock+=dt;
      if(!menu&&near&&dt>0&&e.clock>=.075&&smokeBudget>0){
        e.clock=0;smokeBudget--;
        const L=ROCKETS[r.kind].length*.65;
        this.fx?.emit?.({x:e.root.position.x-this.dir.x*L,y:e.root.position.y-this.dir.y*L,z:e.root.position.z-this.dir.z*L},
          {x:-this.dir.x*.3,y:.3,z:-this.dir.z*.3},0x989e9b,.19,.65,{smoke:true,grow:1.8,drag:2});
      }
    }
    for(const [id,e] of this.entries)if(!live.has(id)){e.root.removeFromParent();this.entries.delete(id);}
  }
  dispose(){this.root.removeFromParent();this.entries.clear();if(this.resources){release(this.resources);this.resources=null;}}
}
