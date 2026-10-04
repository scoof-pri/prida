// Local mesh coordinates stay on the global two-metre lattice: visual and physical seams coincide.
export function regionMesh(map,rawHeight,step=2,bounds=null){
  const x0=bounds?bounds.x0:-map.limit.x,z0=bounds?bounds.z0:-map.limit.z;
  const x1=bounds?bounds.x1:map.limit.x,z1=bounds?bounds.z1:map.limit.z;
  const nx=Math.round((x1-x0)/step),nz=Math.round((z1-z0)/step);
  if(nx<1||nz<1||Math.abs(nx*step-(x1-x0))>1e-5||Math.abs(nz*step-(z1-z0))>1e-5)throw Error('Terrain region must align to the shared lattice');
  const vertices=new Float32Array((nx+1)*(nz+1)*3),indices=new Uint32Array(nx*nz*6);let n=0,k=0;
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const xx=x0+x*step,zz=z0+z*step;vertices[n++]=xx;vertices[n++]=rawHeight(xx,zz,map);vertices[n++]=zz;}
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=z*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;for(const i of [a,c,b,b,c,d])indices[k++]=i;}
  return {vertices,indices};
}
export function fastBiome(x,z,map){
  const parks=map.parks||[];let index=map._biomeGrid031;
  if(!index||index.count!==parks.length){index={count:parks.length,cells:new Map()};map._biomeGrid031=index;
    for(const p of parks)for(let ix=Math.floor((p.x-p.w/2)/64);ix<=Math.floor((p.x+p.w/2)/64);ix++)for(let iz=Math.floor((p.z-p.d/2)/64);iz<=Math.floor((p.z+p.d/2)/64);iz++){const k=ix+':'+iz;if(!index.cells.has(k))index.cells.set(k,[]);index.cells.get(k).push(p);}
  }
  return index.cells.get(Math.floor(x/64)+':'+Math.floor(z/64))?.find(p=>Math.abs(x-p.x)<p.w/2-2&&Math.abs(z-p.z)<p.d/2-2)?.type||'city';
}
