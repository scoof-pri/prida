// Server-authoritative construction. Client previews share this geometry, never authority or inventory.
import { hull, shapeBounds, rayHulls } from './architecture-geometry.js';
import { slopePrism } from './landmark-geometry.js';
import { groundHeight } from './terrain.js';
import { direction, rayBox } from './combat.js';
import { castMap } from './raycast.js';
import { addObstacle, removeObstacle } from './destruction.js';
export const BUILD_GRID=4, BUILD_LEVEL=3;
export const BUILD_KINDS=Object.freeze(['wall','floor','ramp','roof']);
export const BUILD_MATERIALS=Object.freeze([
  Object.freeze({id:'wood',name:'WOOD',hp:160,cost:10,color:0xa68a61,surface:'wood'}),
  Object.freeze({id:'stone',name:'BRICK',hp:280,cost:10,color:0xb77e62,surface:'bricks'}),
  Object.freeze({id:'metal',name:'STEEL',hp:440,cost:10,color:0x7c9097,surface:'steel'}),
]);
export const BUILD_LIMIT=160, PLAYER_BUILD_LIMIT=48, BUILD_REACH=11;
export function freshMaterials(){return {wood:80,stone:40,metal:20};}
const safeMaterial=n=>BUILD_MATERIALS[Number.isInteger(n)&&n>=0&&n<3?n:0];
const overlap=(a,b,pad=0)=>['x','y','z'].every((axis,i)=>Math.abs(a[axis]-b[axis])<(a[['w','h','d'][i]]+b[['w','h','d'][i]])/2-pad);
function nearby(map,b,pad=0){const list=[];if(map.obstacles.grid)map.obstacles.grid.query(b.x-b.w/2-pad,b.z-b.d/2-pad,b.x+b.w/2+pad,b.z+b.d/2+pad,o=>list.push(o));else list.push(...map.obstacles);return list;}
export function constructionObstacle(p){
  const {x,y,z,kind}=p,r=((p.rotation||0)%4+4)%4,a=r*Math.PI/2,c=Math.cos(a),s=Math.sin(a);
  let b;
  if(kind==='wall'){
    // Wall is on the edge of its 4 m tile, leaving room for a floor and a ramp inside it.
    b={x:x+s*2,y:y+1.5,z:z+c*2,w:r%2?.18:4,h:3,d:r%2?4:.18};
  }else if(kind==='floor')b={x,y:y+.09,z,w:4,h:.18,d:4};
  else if(kind==='ramp')b=slopePrism({x:x-s*2,y:y+.18,z:z-c*2},{x:x+s*2,y:y+3.18,z:z+c*2},4,.18);
  else if(kind==='roof'){
    const sh=hull([[x-2,y,z-2],[x+2,y,z-2],[x+2,y,z+2],[x-2,y,z+2],[x,y+1.5,z]],[[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]]);
    b={...shapeBounds([sh]),roofShape:[sh]};
  }else throw Error('Unknown construction kind');
  return {...b,buildId:p.id,part:'construction',hp:p.hp,maxHp:p.maxHp,color:safeMaterial(p.material).color};
}
export function constructionTarget(map,p,kind='wall',rotation=0,material=0){
  const origin={x:p.x,y:p.y+1.55,z:p.z},dir=direction(p.angle||0,p.pitch||0);
  const hit=castMap(origin,dir,BUILD_REACH,map),reached=hit.distance<BUILD_REACH-.001;
  const d=reached?Math.max(.2,hit.distance-.10):5.5;
  const x=Math.round((origin.x+dir.x*d)/4)*4,z=Math.round((origin.z+dir.z*d)/4)*4;
  const atY=origin.y+dir.y*d;
  let y=Math.round((reached?atY:p.y)/BUILD_LEVEL)*BUILD_LEVEL;
  const g=groundHeight(x,z,map);
  if(y<g+.35&&Math.abs(atY-g)<4)y=Math.ceil(g*20)/20;
  return {kind,rotation,material,x,y,z};
}
function solidHit(o,origin,dir,range){
  if(o.roofShape)return rayHulls(o.roofShape,origin,dir,range)?.distance??range;
  return rayBox(origin,dir,{x:o.x-o.w/2,y:o.y-o.h/2,z:o.z-o.d/2},{x:o.x+o.w/2,y:o.y+o.h/2,z:o.z+o.d/2},range);
}
// Permanent world surfaces can be foundations. Other players, doors, vehicles and our own builds cannot.
function foundation(map,p){
  const b=constructionObstacle(p),y=p.y;
  const points=p.kind==='wall'? (p.rotation%2?[[b.x,b.z-1.5],[b.x,b.z+1.5]]:[[b.x-1.5,b.z],[b.x+1.5,b.z]]) : [[p.x-1.65,p.z-1.65],[p.x+1.65,p.z-1.65],[p.x-1.65,p.z+1.65],[p.x+1.65,p.z+1.65]];
  const obs=nearby(map,b,.2);let contacts=0;
  for(const [x,z]of points){
    const g=groundHeight(x,z,map);let ok=Math.abs(y-g)<.28;
    if(!ok)for(const o of obs){
      if(o.buildId!==undefined||o.droneId!==undefined||o.nocollide||o.vehicleId!==undefined||o.doorId!==undefined||o.liftId!==undefined||o.hp<=0)continue;
      const ray={x,y:y+.12,z},d=solidHit(o,ray,{x:0,y:-1,z:0},.43);
      if(d<.43){ok=true;break;}
    }
    if(ok)contacts++;
  }
  return contacts>=Math.min(2,points.length);
}
function touch(a,b){
  const aa=constructionObstacle(a),bb=constructionObstacle(b),gaps=['x','y','z'].map((k,i)=>(aa[['w','h','d'][i]]+bb[['w','h','d'][i]])/2-Math.abs(aa[k]-bb[k]));
  // At least an edge, not an isolated corner. Never attach across empty space.
  return gaps.every(v=>v>=-.24)&&gaps.filter(v=>v>.25).length>=2;
}
export function supportedConstruction(map,pieces){
  const live=pieces.filter(p=>p.hp>0),supported=new Set(),depth=new Map(),queue=[];
  for(const p of live)if(foundation(map,p)){supported.add(p.id);depth.set(p.id,0);queue.push(p);}
  for(let i=0;i<queue.length;i++){
    const a=queue[i],n=depth.get(a.id);if(n>=8)continue;
    for(const b of live)if(!supported.has(b.id)&&touch(a,b)){supported.add(b.id);depth.set(b.id,n+1);queue.push(b);}
  }
  return supported;
}
export function validateConstruction(map,p,candidate,pieces=[],players=[]){
  if(!p||p.hp<=0||p.inBus||p.vehicle||p.droneId||p.suitFlight||p.frozen>0)return 'NOT AVAILABLE';
  if(!BUILD_KINDS.includes(candidate?.kind)||!Number.isInteger(candidate.rotation)||candidate.rotation<0||candidate.rotation>3||!Number.isInteger(candidate.material)||candidate.material<0||candidate.material>2)return 'INVALID PIECE';
  if(![candidate.x,candidate.y,candidate.z].every(Number.isFinite)||Math.abs(candidate.x/4-Math.round(candidate.x/4))>.001||Math.abs(candidate.z/4-Math.round(candidate.z/4))>.001)return 'OFF GRID';
  if(candidate.y < -24 || candidate.y>100 || Math.abs(candidate.x)>map.limit.x-3||Math.abs(candidate.z)>map.limit.z-3)return 'MAP EDGE';
  if(Math.hypot(candidate.x-p.x,candidate.z-p.z,candidate.y-p.y)>BUILD_REACH)return 'TOO FAR';
  if(pieces.length>=BUILD_LIMIT||pieces.filter(q=>q.owner===p.id).length>=PLAYER_BUILD_LIMIT)return 'BUILD LIMIT';
  if(pieces.some(q=>q.kind===candidate.kind&&q.x===candidate.x&&q.z===candidate.z&&Math.abs(q.y-candidate.y)<.1&&(q.kind!=='wall'||q.rotation===candidate.rotation)))return 'OCCUPIED';
  const b=constructionObstacle({...candidate,hp:1});
  for(const q of players){if(q.hp<=0||q.inBus)continue;
    if(overlap(b,{x:q.x,y:q.y+.85,z:q.z,w:.72,h:1.7,d:.72},.045))return 'PLAYER IN THE WAY';
  }
  for(const o of nearby(map,b,.1)){
    if(o.nocollide||o.droneId!==undefined||o.hp<=0)continue;
    if(!overlap(b,o,.075))continue;
    // Pieces sharing an edge/landing are allowed, but never duplicate or cross a solid volume.
    if(o.buildId!==undefined){const old=pieces.find(q=>q.id===o.buildId);
      if(old&&((candidate.kind==='ramp'&&old.kind==='floor'&&Math.abs(old.y-candidate.y)<.24)||(candidate.kind==='floor'&&old.kind==='ramp'&&Math.abs(candidate.y-old.y-3)<.24)))continue;
    }
    // Existing floors just below our base are support, not an obstruction.
    if(o.y+o.h/2<=candidate.y+.20)continue;
    return 'OBSTRUCTED';
  }
  // Placement is a nearby manual action, never through an enclosing wall.
  const origin={x:p.x,y:p.y+1.55,z:p.z},to={x:candidate.x,y:Math.max(candidate.y+.4,p.y+.55),z:candidate.z};
  const len=Math.hypot(to.x-origin.x,to.y-origin.y,to.z-origin.z)||1,dir={x:(to.x-origin.x)/len,y:(to.y-origin.y)/len,z:(to.z-origin.z)/len};
  const hit=castMap(origin,dir,len,map,null,true);
  if(hit.distance<len-.35){const o=hit.impact?.obstacle;if(!o?.buildId)return 'NO LINE OF SIGHT';}
  const id='candidate@040',tmp={...candidate,id,hp:1};
  if(!supportedConstruction(map,[...pieces,tmp]).has(id))return 'NEEDS SUPPORT';
  return null;
}
export class ConstructionSystem{
  constructor(a){this.a=a;this.list=[];this.byId=new Map();this.obstacles=new Map();this.next=0;this.clock=0;this.cooldowns=new Map();this.checkedVersion=-1;this.auditClock=0;}
  tryPlace(p,candidate){
    if(this.clock<(this.cooldowns.get(p?.id)||0))return {ok:false,reason:'COOLDOWN'};
    this.cooldowns.set(p?.id,this.clock+.14);
    const reason=validateConstruction(this.a.map,p,candidate,this.list,this.a.players);
    if(reason)return {ok:false,reason};
    const spec=safeMaterial(candidate.material),wallet=p.materials||{};
    if(!(wallet[spec.id]>=spec.cost))return {ok:false,reason:'NOT ENOUGH '+spec.name};
    const q={...candidate,id:'build-'+(++this.next),owner:p.id,maxHp:spec.hp,hp:Math.round(spec.hp*.3),built:0};
    const obs=constructionObstacle(q);
    this.a.addObs(obs);this.a.colliderBudget?.ensure(obs); // collision exists before resources are committed
    wallet[spec.id]-=spec.cost;
    this.list.push(q);this.byId.set(q.id,q);this.obstacles.set(q.id,obs);
    this.a.events.push({type:'build-placed',id:p.id,build:q.id,...candidate});
    return {ok:true,piece:q};
  }
  useInput(p,i){
    if(!i.buildMode||!i.buildPlace)return;
    const kind=BUILD_KINDS[i.buildType]||'wall',candidate=constructionTarget(this.a.map,p,kind,i.buildRotation||0,i.buildMaterial||0);
    const result=this.tryPlace(p,candidate);
    if(!result.ok&&result.reason!=='COOLDOWN'&&this.clock-(p._buildNotice040||-100)>.8){p._buildNotice040=this.clock;this.a.events.push({type:'tech-note',id:p.id,text:result.reason});}
  }
  damage(id,amount,attacker){const p=this.byId.get(id);if(!p||!Number.isFinite(amount)||amount<=0)return false;
    p.hp=Math.max(0,p.hp-amount);const o=this.obstacles.get(id);if(o)o.hp=p.hp;
    if(p.hp===0)this.remove(id,true);return true;
  }
  remove(id,effects=false){const p=this.byId.get(id);if(!p)return;const o=this.obstacles.get(id);
    this.byId.delete(id);this.obstacles.delete(id);this.list.splice(this.list.indexOf(p),1);
    if(o&&this.a.colliders.has(o))this.a.removeObs(o);
    if(effects)this.a.events.push({type:'build-break',...p,y:p.y+1,color:safeMaterial(p.material).color});
    this.checkedVersion=-1;
  }
  step(dt){this.clock+=dt;this.auditClock+=dt;
    for(const p of this.list)if(p.built<1){const n=Math.min(1,p.built+dt/1.5);p.hp=Math.min(p.maxHp,p.hp+(n-p.built)*p.maxHp*.7);p.built=n;this.obstacles.get(p.id).hp=p.hp;}
    if(this.auditClock<.20)return;this.auditClock=0;
    const v=this.a._supportRevision036||this.a.map.obstacleVersion||0;
    if(this.checkedVersion===v)return;this.checkedVersion=v;
    const safe=supportedConstruction(this.a.map,this.list);
    for(const p of [...this.list])if(!safe.has(p.id))this.remove(p.id,true);
    this.checkedVersion=this.a._supportRevision036||this.a.map.obstacleVersion||0;
  }
  harvest(p,o){if(!p||p.bot||o.buildId!==undefined||o.droneId!==undefined||!p.materials)return;
    const key=['tree','crate','bench','furniture','log'].includes(o.part)?'wood':['car','wreck','metal','site'].includes(o.part)?'metal':'stone';
    p.materials[key]=Math.min(500,(p.materials[key]||0)+(key==='wood'?12:8));
  }
  reset(){for(const p of [...this.list])this.remove(p.id);this.cooldowns.clear();}
  snapshot(){return this.list.map(p=>({...p,hp:Math.round(p.hp),built:Math.round(p.built*20)/20}));}
  dispose(){this.reset();}
}
export function syncConstructions(map,list=[]){
  const cache=map._construction040??=new Map();const seen=new Set();
  for(const p of list){if(!p||typeof p.id!=='string'||p.hp<=0||!BUILD_KINDS.includes(p.kind))continue;seen.add(p.id);
    const previous=cache.get(p.id);if(!previous){const o=constructionObstacle(p);addObstacle(map,o);cache.set(p.id,o);}else previous.hp=p.hp;
  }
  for(const [id,o]of cache)if(!seen.has(id)){removeObstacle(map,o);cache.delete(id);}
}
