// Shared numeric mesh data. Winding is outward; fallback hulls must not disappear with FrontSide materials.
export function wedgeData(w,h,d,top=.78) {
  const positions=[-w/2,0,-d/2,w/2,0,-d/2,w/2,0,d/2,-w/2,0,d/2,-w*top/2,h,-d*.44,w*top/2,h,-d*.44,w*top/2,h,d*.40,-w*top/2,h,d*.40];
  const inside=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],indices=[];
  for(let i=0;i<inside.length;i+=3)indices.push(inside[i],inside[i+2],inside[i+1]);
  return {positions,indices};
}
