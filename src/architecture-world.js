// PRIDA 0.29: deterministic geometry cleanup after furnishing and before the obstacle grids are built.
import { roofHulls,shapeBounds,DOOR_HP,cutRect } from './architecture-geometry.js';
export function prepareArchitecture(map,styleOf) {
  // A pitched roof has a convex/compound sloped hull. Never a cuboid up to its ridge.
  for(const o of map.obstacles)if(o.part==='upper') {
    const b=map.buildings[o.building],shapes=roofHulls(b,styleOf(b));
    if(shapes.length){o.roofShape=shapes;Object.assign(o,shapeBounds(shapes));}
  }
  map.doors.forEach((d,id)=>{
    const floor=d.kind==='inner'?d.y-d.h/2:0.045,top=(d.y??1.3)+(d.h||2.55)/2,bottom=floor+0.025;
    Object.assign(d,{id,t:0,open:false,swing:1,hp:DOOR_HP,thickness:0.075,floorY:floor,y:(top+bottom)/2,h:top-bottom});
    if(d.kind==='inner' && !d.planned033) {
      // Link trim and door lifetime to the adjoining partition, not just the building.
      const alongZ=d.axis==='z',u=alongZ?d.z:d.x,normal=alongZ?d.x:d.z;
      d.panels=map.obstacles.filter(o=>o.part==='partition' && o.building===d.building && (o.storey||0)===(d.storey||0)
        && Math.abs((alongZ?o.x:o.z)-normal)<0.12
        && Math.abs(Math.abs((alongZ?o.z:o.x)-u)-((alongZ?o.d:o.w)+d.w)/2)<0.25).map(o=>o.panel);
      // Fill the old full-height opening above the door with the same painted partition, not a floating frame.
      const y0=d.y+d.h/2+0.12,base=d.floorY,y1=base+3.34;
      if(y1>y0+0.05)map.obstacles.push({x:d.x,y:(y0+y1)/2,z:d.z,w:alongZ?0.14:d.w,h:y1-y0,d:alongZ?d.w:0.14,
        part:'partition',face:'inside',building:d.building,storey:d.storey||0,panel:map.panels++,structural:false,hp:60,color:0xd9d2c3});
    }
  });
  // Overlapping park paths form a union of non-overlapping rectangles at one height.
  const clean=[];
  for(const p of map.paths)clean.push(...cutRect(p,[...map.roads,...clean]));
  map.paths=clean;
  // Rugs are decals, not a second floor at exactly the same depth.
  for(const d of map.decor)if(d.model==='rug') d.y+=0.018;
}
