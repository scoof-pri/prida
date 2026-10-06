// Small deterministic test ports, not a substitute for the complete game or its native integration gate.
import fs from 'node:fs';
import {FLOOR_Y,planInterior} from '../src/interior-plan.js';
export const SIZES={sofa:[2.1,.986,.879],armchair:[.905,.85,.758],'coffee-table':[1.2,.418,.726],table:[1.7,.66,.904],chair:[.404,.95,.404],tv:[1.25,.83,.234],'tv-cabinet':[1.7,.659,.531],bookcase:[.886,1.95,.554],desk:[1.5,.785,.801],'office-chair':[.606,1.1,.569],monitor:[.6,.45,.159],fridge:[.865,1.85,.587],stove:[.879,.92,.92],bed:[1.785,.7,2.1],plant:[.324,1,.369],'floor-lamp':[.292,1.65,.337],rug:[2.4,.015,1.406],toilet:[.554,.8,.846],sink:[.546,.9,.466],shower:[1.078,2.1,1.117],'kitchen-cabinet':[.879,.92,.92],'kitchen-sink':[.807,.92,.845],microwave:[.5,.31,.397],washer:[.73,.88,.73],'table-round':[1.436,.76,1.658],'bookcase-low':[1,1,.625],'side-table':[.765,.55,.318],'lamp-table':[.207,.5,.207]};
export const BUILDINGS=[
{id:0,type:'villa',category:'home',w:14,d:12,storeys:0},
{id:1,type:'duplex',category:'home',w:13,d:12,storeys:1},
{id:2,type:'townhouse',category:'home',w:12,d:12,storeys:1},
{id:3,type:'lodge',category:'home',w:12,d:14,storeys:1},
{id:4,type:'office',category:'office',w:13,d:12,storeys:5},
{id:5,type:'market',category:'shop',w:14,d:12,storeys:3},
{id:6,type:'pavilion',category:'shop',w:16,d:14,storeys:2},
{id:7,type:'residence',category:'home',w:16,d:26,storeys:3},
];
export const withPlan=original=>{const b={x:0,z:0,door:3.2,color:0xc2c1b3,...original};b.interiorPlan=planInterior(b);return b;};
export const overlap=(a,b,e=1e-5)=>Math.abs(a.x-b.x)<(a.w+b.w)/2-e&&Math.abs(a.z-b.z)<(a.d+b.d)/2-e;
export const dataImport=text=>import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
export async function loadFurniture(){let s=fs.readFileSync(new URL('../src/interior-furniture.js',import.meta.url),'utf8');s=s.replace("import { DECOR_SIZES } from './decor-sizes.js';",'const DECOR_SIZES='+JSON.stringify(SIZES)+';').replace("'./interior-plan.js'",JSON.stringify(new URL('../src/interior-plan.js',import.meta.url).href));return dataImport(s);}
// Grid formulas below match the unchanged native slab grid. Production integration imports the real cells.js.
export function cellGrid(o){return o.cellGrid??={slab:true,cols:Math.max(1,Math.round(o.w/.8)),rows:Math.max(1,Math.round(o.d/.8)),cw:o.w/Math.max(1,Math.round(o.w/.8)),ch:o.d/Math.max(1,Math.round(o.d/.8))};}
export function cellBox(o,c0,c1,r0,r1){const g=cellGrid(o);return{x:o.x-o.w/2+(c0+c1+1)/2*g.cw,y:o.y,z:o.z-o.d/2+(r0+r1+1)/2*g.ch,w:(c1-c0+1)*g.cw,h:o.h,d:(r1-r0+1)*g.ch};}
export function cellCenter(o,i){return cellBox(o,i%cellGrid(o).cols,i%cellGrid(o).cols,Math.floor(i/cellGrid(o).cols),Math.floor(i/cellGrid(o).cols));}
export async function loadWorld(){let s=fs.readFileSync(new URL('../src/interior-world.js',import.meta.url),'utf8').replace("import { cellGrid, cellCenter, cellBox } from './cells.js';",cellGrid.toString()+'\n'+cellCenter.toString()+'\n'+cellBox.toString());for(const name of ['interior-plan','architecture-geometry'])s=s.replace("'./"+name+".js'",JSON.stringify(new URL('../src/'+name+'.js',import.meta.url).href));return dataImport(s);}
export async function loadLift(){let s=fs.readFileSync(new URL('../src/lift-system.js',import.meta.url),'utf8').replace("import { addObstacle, removeObstacle } from './destruction.js';",`function addObstacle(map,o){map.obstacles.push(o);map.obstacles.grid?.add(o);}function removeObstacle(map,o){const i=map.obstacles.indexOf(o);if(i>=0){map.obstacles.splice(i,1);map.obstacles.grid?.remove(o);}}`);return dataImport(s);}
export function mapFor(b){return{buildings:[b],lifts:[],interiorDetails:[],obstacles:Array.from({length:b.storeys+1},(_,k)=>({part:'roof',building:b.id,storey:k,panel:k,x:b.x,z:b.z,y:(k===0?3.84:3.84+k*3.6)-.12,w:b.w,h:.24,d:b.d})),panels:b.storeys+1,doors:[],decor:[],roads:[],paths:[],spawns:[],chests:[],waters:[],limit:{x:150,z:150}};}
export function furniturePort(map,b,k){return {decor:map.decor,put(name,x,z,rot,opts){const s=SIZES[name],q=Math.abs(Math.round(rot/(Math.PI/2)))%2,w=q?s[2]:s[0],d=q?s[0]:s[2];const box={x,y:opts.y,z,w,h:s[1],d};
 const relevant=map.obstacles.filter(o=>o.building===b.id&&o.storey===k&&o.part!=='roof'&&o.part!=='upper'&&!o.nocollide);
 if(opts.on===undefined&&relevant.some(o=>(opts.collide!==false||o.decor===undefined)&&overlap(box,o,-.02)))return -1;
 const id=map.decor.length;map.decor.push({id,model:name,x,y:opts.y,z,w,d,h:s[1],rot,building:b.id,storey:k,soft:opts.collide===false});if(opts.collide!==false&&opts.on===undefined)map.obstacles.push({...box,building:b.id,storey:k,part:'furniture',decor:id});return id;
 }};}
