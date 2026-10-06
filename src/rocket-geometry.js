// Small indexed-free meshes; +Z is the nose. Plain arrays allow geometry tests without a GPU.
import { ROCKETS } from './vehicle-rockets.js';
export function rocketMeshData(kind) {
  const s=ROCKETS[kind];if(!s)throw Error('No rockets for '+kind);
  const pos=[],nrm=[],col=[],uv=[];
  const metal=[.34,.42,.34],tip=[.13,.17,.16],band=[.8,.46,.06],fin=[.24,.3,.28];
  const tri=(a,b,c,color)=>{
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
    let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const len=Math.hypot(...n);if(len<1e-10)return;n=n.map(k=>k/len);
    for(const p of [a,b,c]){pos.push(...p);nrm.push(...n);col.push(...color);uv.push(p[0]/s.calibre,p[2]/s.length);}
  };
  const radius=s.calibre,L=s.length,N=10;
  const ring=(z,r)=>Array.from({length:N},(_,i)=>[Math.cos(i/N*Math.PI*2)*r,Math.sin(i/N*Math.PI*2)*r,z]);
  const z0=-L/2,z1=L*.27,z2=L*.5;
  const sections=[[z0,radius,metal],[L*.15,radius,metal],[L*.19,radius,band],[z1,radius,metal],[z2,0,tip]];
  for(let j=0;j<sections.length-1;j++){
    const [z,r,color]=sections[j],A=ring(z,r),B=ring(sections[j+1][0],sections[j+1][1]);
    for(let i=0;i<N;i++){const k=(i+1)%N;tri(A[i],A[k],B[k],color);tri(A[i],B[k],B[i],color);}
  }
  const rear=ring(z0,radius);
  for(let i=0;i<N;i++)tri([0,0,z0],rear[(i+1)%N],rear[i],tip);
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2,c=Math.cos(a),q=Math.sin(a),r=radius;
    const p0=[c*r,q*r,z0+.02],p1=[c*(r+.11),q*(r+.11),z0+.04],p2=[c*r,q*r,z0+L*.29];
    tri(p0,p1,p2,fin);tri(p2,p1,p0,fin);
  }
  return {position:pos,normal:nrm,color:col,uv};
}
