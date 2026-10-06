// Re-bucket a moving vehicle only when its occupied grid cells change; keep object identity stable.
const low=o=>!o.nocollide&&o.y-o.h/2-(o.ground||0)<=1.8;
const sameRange=(g,a,b)=>{if(!g?.range)return false;const ar=g.range(a),br=g.range(b);return ar.every((n,i)=>n===br[i]);};
export function updateVehicleObstacle(map,o,next){
 const moved=['x','y','z','w','h','d'].some(k=>Math.abs((o[k]??Infinity)-next[k])>1e-7)||(next.aircraftShape?['angle','pitch','roll'].some(k=>Math.abs((o.aircraftShape?.[k]??Infinity)-next.aircraftShape[k])>1e-7):Math.abs((o.doorLeaf?.yaw??Infinity)-(next.doorLeaf?.yaw??0))>1e-7);
 const regrid=moved&&!sameRange(map.obstacles.grid,o,next),wasLow=low(o),isLow=low(next),relow=moved&&(wasLow!==isLow||!sameRange(map.obstacles.lowGrid,o,next));
 if(regrid)map.obstacles.grid?.remove(o);if(relow&&wasLow)map.obstacles.lowGrid?.remove(o);
 Object.assign(o,next);
 if(regrid)map.obstacles.grid?.add(o);if(relow&&isLow)map.obstacles.lowGrid?.add(o);return moved;
}
export function destructionStamp(arena){const d=arena.destruction||{};return `${d.panels?.length||0}:${d.props?.length||0}:${d.buildings?.length||0}:${d.roofs?.length||0}:${JSON.stringify(d.storeys||{})}:${arena._supportRevision036||0}:${arena.map.terrainVersion||arena.map.groundVersion||0}`;}
