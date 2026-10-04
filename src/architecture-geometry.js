// PRIDA 0.29: shared geometry, not a second decorative collision world.
// Plain numbers only: this module runs identically in Node, WebRTC hosts and browsers.
const EPS = 1e-7;
export const DOOR_TIME = 0.32;
export const DOOR_REACH = 2.7;
export const DOOR_HP = 140;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => { const n = Math.hypot(...a) || 1; return a.map(v => v/n); };
export const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

// Convex polyhedron. Faces are automatically wound outward, including the underside.
export function hull(vertices, faces, kinds = []) {
  const center = vertices.reduce((a, p) => a.map((v, i) => v + p[i]/vertices.length), [0,0,0]);
  const planes = [], polys = [], indices = [];
  faces.forEach((face, f) => {
    let ids = face.slice(), n = unit(cross(sub(vertices[ids[1]], vertices[ids[0]]), sub(vertices[ids[2]], vertices[ids[0]])));
    if (dot(n, sub(center, vertices[ids[0]])) > 0) { ids.reverse(); n = n.map(v => -v); }
    const offset = dot(n, vertices[ids[0]]);
    planes.push({ n, offset }); polys.push({ ids, n, kind: kinds[f] || 'wall' });
    for (let i=1;i+1<ids.length;i++) indices.push(ids[0],ids[i],ids[i+1]);
  });
  return { vertices: vertices.flat(), indices, planes, faces: polys };
}
export function roofHulls(b, style) {
  if (style === 'flat') return [];
  const base = b.roofBase + 0.006, eave = base + 0.11;
  const along = b.w >= b.d, L = along ? b.w : b.d, S = along ? b.d : b.w;
  const ov = style === 'shed' ? 0.3 : 0.45;
  const A = L/2 + ov, B = S/2 + ov;
  const peak = Math.max(b.height, eave + (style === 'shed' ? 1.4 : 1.6));
  const P = (u,y,v) => along ? [b.x+u,y,b.z+v] : [b.x+v,y,b.z+u];
  if (style === 'saw') {
    const count = Math.max(2, Math.round(b.d / 5)), span = b.d/count;
    const high = Math.max(eave+1.1, Math.min(peak, eave+2.4)), result = [];
    for (let i=0;i<count;i++) {
      const x0=b.x-b.w/2, x1=b.x+b.w/2, z0=b.z-b.d/2+i*span, z1=z0+span;
      result.push(hull([[x0,base,z0],[x1,base,z0],[x1,base,z1],[x0,base,z1],
        [x0,high,z0],[x1,high,z0],[x1,eave,z1],[x0,eave,z1]],
        [[0,1,2,3],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0],[4,7,6,5]],
        ['bottom','glass','wall','edge','wall','slope']));
    }
    return result;
  }
  const v = [P(-A,base,-B),P(A,base,-B),P(A,base,B),P(-A,base,B),
    P(-A,eave,-B),P(A,eave,-B),P(A,eave,B),P(-A,eave,B)];
  if (style === 'shed') {
    // A real single-pitch shed, not an invisible box extending above its low edge.
    v[4][1]=peak; v[5][1]=peak;
    return [hull(v, [[0,1,2,3],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0],[4,7,6,5]],
      ['bottom','wall','wall','edge','wall','slope'])];
  }
  const ridge = style === 'hip' ? Math.max(0.02,(L-S)/2) : A;
  v.push(P(-ridge,peak,0),P(ridge,peak,0));
  const faces = [[0,1,2,3],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0],
    [4,8,9,5],[7,6,9,8],[4,7,8],[5,9,6]];
  return [hull(v,faces,['bottom','edge','edge','edge','edge','slope','slope',
    style==='hip'?'slope':'wall',style==='hip'?'slope':'wall'])];
}
export function shapeBounds(shapes) {
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for (const h of shapes) for(let i=0;i<h.vertices.length;i++) {
    const k=i%3; min[k]=Math.min(min[k],h.vertices[i]); max[k]=Math.max(max[k],h.vertices[i]);
  }
  return {x:(min[0]+max[0])/2,y:(min[1]+max[1])/2,z:(min[2]+max[2])/2,
    w:max[0]-min[0],h:max[1]-min[1],d:max[2]-min[2]};
}
export function rayHulls(shapes, origin, dir, range) {
  const o=[origin.x,origin.y,origin.z], v=[dir.x,dir.y,dir.z];
  let best=null;
  for (const h of shapes) {
    let lo=0,hi=best?.distance ?? range,normal=unit(v.map(x=>-x)),valid=true;
    for(const p of h.planes) {
      const a=p.offset-dot(p.n,o), d=dot(p.n,v);
      if(Math.abs(d)<EPS) { if(a < -EPS) {valid=false;break;} continue; }
      const t=a/d;
      if(d<0) { if(t>lo){lo=t;normal=p.n;} } else hi=Math.min(hi,t);
      if(lo>hi+EPS) {valid=false;break;}
    }
    if(valid && hi>=0 && lo<=range && (!best || lo<best.distance)) best={distance:Math.max(0,lo),x:normal[0],y:normal[1],z:normal[2]};
  }
  return best;
}

export function doorPoses(d, t=d.t || 0, swing=d.swing || 1) {
  const alongZ=d.axis==='z', U=alongZ?[0,1]:[1,0], baseYaw=alongZ?-Math.PI/2:0;
  const count=d.kind==='inner'||d.w<1.45?1:2, width=d.w/count-0.065;
  const height=d.h || 2.55, y=d.y ?? 1.3, thickness=d.thickness || 0.075;
  const out=[];
  for(let k=0;k<count;k++) {
    const side=count===1?-1:(k===0?-1:1), hinge=side*(d.w/2-0.035);
    const yaw=baseYaw+(alongZ?-1:1)*side*(d.face||1)*swing*clamp01(t)*Math.PI/2;
    const x=d.x+U[0]*hinge-Math.cos(yaw)*side*width/2;
    const z=d.z+U[1]*hinge+Math.sin(yaw)*side*width/2;
    out.push({x,y,z,yaw,w:width,h:height,t:thickness,side});
  }
  return out;
}
export function leafBounds(p) {
  return {x:p.x,y:p.y,z:p.z,w:Math.abs(Math.cos(p.yaw))*p.w+Math.abs(Math.sin(p.yaw))*p.t,
    h:p.h,d:Math.abs(Math.sin(p.yaw))*p.w+Math.abs(Math.cos(p.yaw))*p.t};
}
export function rayLeaf(p, origin, dir, range) {
  const c=Math.cos(p.yaw),s=Math.sin(p.yaw),dx=origin.x-p.x,dz=origin.z-p.z;
  const o=[c*dx-s*dz,origin.y-p.y,s*dx+c*dz],v=[c*dir.x-s*dir.z,dir.y,s*dir.x+c*dir.z];
  const hs=[p.w/2,p.h/2,p.t/2]; let lo=0,hi=range,n=[0,0,0];
  for(let i=0;i<3;i++) {
    if(Math.abs(v[i])<EPS){if(Math.abs(o[i])>hs[i])return null;continue;}
    let a=(-hs[i]-o[i])/v[i],b=(hs[i]-o[i])/v[i],sign=-1;
    if(a>b){[a,b]=[b,a];sign=1;}
    if(a>lo){lo=a;n=[0,0,0];n[i]=sign;} hi=Math.min(hi,b);
    if(lo>hi)return null;
  }
  if(hi<0)return null;
  return {distance:Math.max(0,lo),x:c*n[0]+s*n[2],y:n[1],z:-s*n[0]+c*n[2]};
}
export function leafTouchesPlayer(p, actor, radius=0.34) {
  if(actor.hp<=0 || actor.inBus || actor.y+1.65<=p.y-p.h/2 || actor.y>=p.y+p.h/2)return false;
  const dx=actor.x-p.x,dz=actor.z-p.z,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
  const x=Math.max(0,Math.abs(c*dx-s*dz)-p.w/2),z=Math.max(0,Math.abs(s*dx+c*dz)-p.t/2);
  return x*x+z*z<radius*radius;
}
// Rectangle subtraction used for ground, pavements, roof trim and near-coplanar floor decals.
export function subtractRect(rect, cut) {
  const ax=rect.x-rect.w/2,bx=rect.x+rect.w/2,az=rect.z-rect.d/2,bz=rect.z+rect.d/2;
  const x0=Math.max(ax,cut.x-cut.w/2),x1=Math.min(bx,cut.x+cut.w/2),z0=Math.max(az,cut.z-cut.d/2),z1=Math.min(bz,cut.z+cut.d/2);
  if(x1<=x0+EPS || z1<=z0+EPS)return [rect];
  const out=[],put=(a,b,c,d)=>{if(b-a>EPS && d-c>EPS)out.push({...rect,x:(a+b)/2,z:(c+d)/2,w:b-a,d:d-c});};
  put(ax,x0,az,bz);put(x1,bx,az,bz);put(x0,x1,az,z0);put(x0,x1,z1,bz);
  return out;
}
export function cutRect(rect,cuts) {return cuts.reduce((list,c)=>list.flatMap(r=>subtractRect(r,c)),[rect]);}
export function rectOverlap(a,b,eps=1e-6){return Math.abs(a.x-b.x)<(a.w+b.w)/2-eps && Math.abs(a.z-b.z)<(a.d+b.d)/2-eps;}

// Separating-axis test for a swinging door leaf against a static obstacle AABB.
// Contact within 6 mm is tolerated at the hinge; it is not a licence to pass through walls.
export function leafTouchesBox(p, b, tolerance=0.006) {
  if(p.y+p.h/2<=b.y-b.h/2+tolerance || p.y-p.h/2>=b.y+b.h/2-tolerance)return false;
  const c=Math.cos(p.yaw),s=Math.sin(p.yaw),dx=b.x-p.x,dz=b.z-p.z;
  const aw=p.w/2,ad=p.t/2,bw=b.w/2,bd=b.d/2;
  if(Math.abs(dx)>=Math.abs(c)*aw+Math.abs(s)*ad+bw-tolerance)return false;
  if(Math.abs(dz)>=Math.abs(s)*aw+Math.abs(c)*ad+bd-tolerance)return false;
  if(Math.abs(c*dx-s*dz)>=aw+Math.abs(c)*bw+Math.abs(s)*bd-tolerance)return false;
  if(Math.abs(s*dx+c*dz)>=ad+Math.abs(s)*bw+Math.abs(c)*bd-tolerance)return false;
  return true;
}
