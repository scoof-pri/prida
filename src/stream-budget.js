// A fair, shared one-geometry-job budget per rendered frame, not per subsystem.
const ORDER=['world','ground','scenery','water'];
export class StreamFrameBudget {
 constructor(now=()=>performance.now()){this.now=now;this.next=0;this.pending={world:0,ground:0,scenery:0,water:0};this.totalJobs=0;this.begin();}
 begin(){this.used=false;this.started=this.now();this.lastCost=0;}
 run(kind,fn){
  if(this.used||!this.pending[kind])return false;
  let selected=null;for(let i=0;i<ORDER.length;i++){const k=ORDER[(this.next+i)%ORDER.length];if(this.pending[k]>0){selected=k;break;}}
  if(selected!==kind)return false;
  this.used=true;const start=this.now();fn();this.lastCost=this.now()-start;this.totalJobs++;
  this.pending[kind]=Math.max(0,this.pending[kind]-1);this.next=(ORDER.indexOf(kind)+1)%ORDER.length;return true;
 }
}
export function beginStreamFrame(map){if(!map?.tiled)return;const b=map._streamFrameBudget??=new StreamFrameBudget();b.begin();}
