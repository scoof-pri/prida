// Existing locally shipped GLB furniture, laid out inside named rooms instead of an undivided floor.
import { DECOR_SIZES } from './decor-sizes.js';
import { FLOOR_Y } from './interior-plan.js';
const PI=Math.PI;
function inside(rect,x,z,w,d,m=.085) {return x-w/2>=rect[0]+m&&x+w/2<=rect[2]-m&&z-d/2>=rect[1]+m&&z+d/2<=rect[3]-m;}
export function furnishPlannedFloor(b,k,ctx) {
  const level=b.interiorPlan?.levels[k];if(!level)return false;
  const base=FLOOR_Y(k),requests=[];
  for(const r of level.rooms) {
    if (r.purpose === 'shop') continue;
    const [x0,z0,x1,z1]=r.bounds,cx=(x0+x1)/2,cz=(z0+z1)/2;
    const entry=r.entrance;
    const clearance=(x,z,w,d)=> {
      const e=entry.side==='n'?[entry.at,z0]:entry.side==='s'?[entry.at,z1]:entry.side==='e'?[x1,entry.at]:[x0,entry.at];
      // Keep the door's swept leaf and a standing person clear; never put a toilet in the doorway.
      return Math.abs(x-e[0])<(entry.side==='n'||entry.side==='s'?w/2+.65:w/2+1.25)&&
        Math.abs(z-e[1])<(entry.side==='n'||entry.side==='s'?d/2+1.25:d/2+.65);
    };
    const at=(name,x,z,rot=0,opts={})=> {
      const size=opts.box||DECOR_SIZES[name];if(!size)return -1;
      const quarter=Math.round(rot/(PI/2))%2!==0,w=quarter?size[2]:size[0],d=quarter?size[0]:size[2];
      if(!inside(r.bounds,x,z,w,d)||(opts.on===undefined&&clearance(x,z,w,d)))return -1;
      const id=ctx.put(name,b.x+x,b.z+z,rot,{building:b.id,storey:k,...opts,y:base+(opts.y||0)});
      requests.push({name,x,z,w,d,room:r.name,id});return id;
    };
    const fit=(name,x,z,rot=0,opts={})=> {
      let id=at(name,x,z,rot,opts);if(id>=0)return id;
      const size=DECOR_SIZES[name];if(!size)return -1;
      const candidates=[];
      for(const a of [rot,rot+PI,rot+PI/2,rot-PI/2]) {
        const quarter=Math.abs(Math.round(a/(PI/2)))%2,ww=quarter?size[2]:size[0],dd=quarter?size[0]:size[2];
        const xa=x0+ww/2+.16,xb=x1-ww/2-.16,za=z0+dd/2+.16,zb=z1-dd/2-.16;
        if(xa>xb||za>zb)continue;
        for(const xx of [xa,(xa+xb)/2,xb])for(const zz of [za,(za+zb)/2,zb])candidates.push({x:xx,z:zz,a,score:Math.hypot(xx-x,zz-z)+Math.abs(a-rot)*.2});
      }
      for(const p of candidates.sort((a,b)=>a.score-b.score)){id=at(name,p.x,p.z,p.a,opts);if(id>=0)return id;}
      return -1;
    };
    const on=(id,name,dy)=>{if(id<0)return;const p=ctx.decor[id];if(p)at(name,p.x-b.x,p.z-b.z,p.rot||0,{on:id,y:dy,collide:false});};
    const floorPlant=()=>at('plant',x0+.37,z0+.37,0,{collide:false});
    if(r.purpose==='kitchen') {
      let x=x0+.14;
      for(const name of ['fridge','stove','kitchen-sink','kitchen-cabinet']){
        const s=DECOR_SIZES[name];const id=fit(name,x+s[0]/2,z0+s[2]/2+.14);x+=s[0]+.025;
        if(name==='kitchen-cabinet')on(id,'microwave',.92);
      }
      const t=at('table-round',cx,cz+.65);if(t>=0)at('chair',cx+.95,cz+.65,-PI/2,{collide:false});
    } else if(r.purpose==='bathroom') {
      fit('toilet',x0+.62,z1-.67,PI);
      fit('sink',x1-.52,z1-.58,PI);
      at('shower',x0+.68,z0+.74);
      if(x1-x0>3.25)at('washer',x1-.48,z0+.65);
    } else if(r.purpose==='bedroom') {
      const bed=fit('bed',cx,z1-1.22,PI);
      const side=at('side-table',x0+.49,z1-.55,PI);on(side,'lamp-table',.55);
      at('bookcase',x1-.53,z0+.44);floorPlant();
    } else if(r.purpose==='workspace'||r.purpose==='office') {
      for(let x=x0+.99;x<x1-.90;x+=2.25)for(let z=z0+.70;z<z1-1.0;z+=2.25){
        const desk=at('desk',x,z,PI);on(desk,'monitor',.80);at('office-chair',x,z+.81,PI,{collide:false});
      }
      if(r.purpose==='office')at('bookcase-low',x0+.70,z1-.50);
      floorPlant();
    } else if(r.purpose==='meeting') {
      const table=at('table',cx,cz,PI/2);
      if(table>=0)for(const s of [-1,1])for(const zz of [-.55,.55])at('office-chair',cx+s*.85,cz+zz,s>0?-PI/2:PI/2,{collide:false});
      fit('tv-cabinet',cx,z0+.46);at('tv',cx,z0+.46,0,{y:.68,collide:false});floorPlant();
    } else {
      const sofa=fit('sofa',cx,z1-.64,PI);
      at('coffee-table',cx,cz);
      const tv=fit('tv-cabinet',cx,z0+.42);on(tv,'tv',.67);
      at('rug',cx,cz,0,{collide:false});at('floor-lamp',x0+.3,z1-.4,0,{collide:false});
      if(r.purpose==='lounge')at('armchair',x1-.65,cz,-PI/2,{collide:false});
    }
  }
  b.interiorPlaced??=[];b.interiorPlaced[k]=requests.reduce((n,p)=>n+(p.id>=0),0);
  return true;
}
