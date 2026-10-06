// Original NOVA laboratory: secure drone bay, vehicle workshop, control room and suit vault.
// Geometry is part of the ordinary building/support graph; loot never respawns during a round.
import { floorY } from './landmark-geometry.js';
export function configureLaboratory(map){
  map.labItems=[];map.laboratories=[];
  if(map.size!=='city')return;
  const eligible=map.plots.filter(p=>p.type==='building'&&!p.poi&&p.kind&&!p.kind.poi&&!p.kind.landmark034&&p.w>=24&&p.d>=24);
  // Preserve the first ordinary office for existing gameplay/tutorial checks.
  const lot=eligible.find((p,i)=>i>0&&p.kind.type!=='office')||eligible[2];
  if(!lot)return;
  lot.kind={...lot.kind,type:'laboratory',landmark034:'laboratory',category:'civic',w:Math.min(21,lot.w-6),d:Math.min(21,lot.d-6),
    storeys:1,sign:'NOVA RESEARCH',color:0xadbfc0,accent:0x2a737d};
}
export function furnishLaboratories(map){
  map.labItems??=[];map.laboratories??=[];map.siteObjects??=[];
  for(const b of map.buildings.filter(b=>b.landmark034==='laboratory')){
    const labId='nova-'+b.id,hw=b.w/2-.4,hd=b.d/2-.4,right=hw-4.95,west=-hw+.85;
    map.laboratories.push({id:labId,building:b.id,x:b.x,y:0,z:b.z,name:'NOVA RESEARCH',w:b.w,d:b.d});
    const prop=(x,y,z,w,h,d,surface,color,storey=0)=>{
      const o={x:b.x+x,y,z:b.z+z,w,h,d,part:'site',hp:70,building:b.id,storey,surface,color,labId};
      map.obstacles.push(o);map.siteObjects.push(o);return o;
    };
    const item=(kind,x,z,storey,label)=>{
      const y=floorY(storey),id=labId+'-'+map.labItems.length;
      prop(x,y+.40,z,1.05,.80,.95,'steel',0x384d58,storey);
      map.labItems.push({id,labId,building:b.id,storey,x:b.x+x,y:y+.95,z:b.z+z,kind,label,available:true});
    };
    for(let n=0;n<5;n++) item('fpv',west+(right-west-.7)*n/4,-hd+1.35,0,'FPV '+String(n+1).padStart(2,'0'));
    for(let n=0;n<3;n++)item(['ram','turbo','bomb'][n],west+1+(right-west-2)*n/2,hd-1.65,0,['RAM SHIELD','TURBO DRIVE','BOMB RACK'][n]);
    item('aegis',west+1.8,-hd+2.3,1,'AEGIS FLIGHT SUIT');
    // Ground-floor bench and upper control desk: hand-built fixtures remain destructible native props.
    for(const [x,z,k]of [[west+.8,-3.35,0],[right-1.5,3.5,0],[right-1.7,hd-1.7,1]]){
      const y=floorY(k);prop(x,y+.79,z,2.2,.12,1,'steel',0xced3cd,k);
      for(const s of [-1,1])prop(x+s*.8,y+.36,z,.12,.72,.72,'steel',0x556b72,k);
      prop(x,y+1.25,z+.1,1.1,.55,.09,'steel',0x233b49,k);
    }
    for(const [n,[x,z,k]]of [[right-1,-hd+3.3,0],[west+1.4,hd-2,1],[right-1,hd-2,1]].entries()){
      // Use stable string IDs so four-sector tiling can namespace every laboratory chest independently.
      map.chests.push({id:labId+'-chest-'+n,x:b.x+x,y:floorY(k)+.035,z:b.z+z,tier:k?2:1,opened:false,building:b.id,
        gear:kindGear(k),medkits:1,ammo:60,loot:null});
    }
  }
}
const kindGear=k=>null;
