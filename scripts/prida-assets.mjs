// Bounded, allowlisted build-time asset acquisition. No credentials and no match-time third-party requests.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const ASSET_SOURCES = Object.freeze({
  plane: {url:'https://cdn.3dassets.dev/assets/32595/v1/model.glb', page:'https://3dassets.dev/assets/aircraft-fleet-and-airfield-radial-warbird-fighter-95c4cb8f'},
  tank: {manifest:'https://3dassets.dev/api/v1/packs/armoured-column-and-field-camp', starter:'https://cdn.3dassets.dev/assets/23739/v1/model.glb', page:'https://3dassets.dev/packs/armoured-column-and-field-camp'}
});
function allowURL(url) {
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||!['3dassets.dev','cdn.3dassets.dev'].includes(u.hostname))throw Error('Rejected asset URL');return u.href;
}
async function bytes(url,max=8*1024*1024) {
  let target=allowURL(url),response;
  for(let i=0;i<4;i++){
    response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(22000),headers:{'User-Agent':'PRIDA-asset-installer/0.30'}});
    if(response.status>=300&&response.status<400){target=allowURL(new URL(response.headers.get('location'),target).href);await response.body?.cancel();continue;}break;
  }
  if(!response?.ok)throw Error('Asset HTTP '+response?.status);
  if(Number(response.headers.get('content-length'))>max)throw Error('Asset is above size limit');
  const parts=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>max){throw Error('Asset is above size limit');}parts.push(Buffer.from(chunk));}
  return Buffer.concat(parts);
}
export function parseGLB(buffer) {
  if(buffer.length<24||buffer.readUInt32LE(0)!==0x46546c67||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length)throw Error('Invalid GLB header');
  const length=buffer.readUInt32LE(12);if(buffer.readUInt32LE(16)!==0x4e4f534a||20+length>buffer.length)throw Error('Invalid GLB JSON chunk');
  const json=JSON.parse(buffer.subarray(20,20+length).toString('utf8').replace(/\0+$/,''));
  if(!(json.meshes?.length>0)||!(json.nodes?.length>0))throw Error('GLB has no geometry');
  if([...(json.buffers||[]),...(json.images||[])].some(o=>o.uri&&!o.uri.startsWith('data:')))throw Error('External GLB dependencies are not supported');
  const decoderRequired=['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'];
  if((json.extensionsRequired||[]).some(n=>decoderRequired.includes(n)))throw Error('Model requires an unconfigured decoder');
  return {json,tail:buffer.subarray(20+length)};
}
export function selectTankURL(manifest) {
  const matches=[];
  const urls=o=>{if(typeof o==='string')return /^https:\/\/cdn\.3dassets\.dev\/assets\/[^\s]+\.glb(?:\?.*)?$/.test(o)?[o]:[];if(!o||typeof o!=='object')return [];return Object.values(o).flatMap(urls);};
  const visit=o=>{if(!o||typeof o!=='object')return;for(const child of Object.values(o))visit(child);
    if(['name','title','slug','label','display_name'].some(k=>typeof o[k]==='string'&&/main[\s_-]*battle[\s_-]*tank/i.test(o[k])))matches.push(...urls(o));};
  visit(manifest);return matches[0]||null;
}
export function isolateTank(buffer) {
  const {json,tail}=parseGLB(buffer),nodes=json.nodes;let i=nodes.findIndex(n=>/main[\s_-]*battle[\s_-]*tank/i.test(n.name||'') && n.children?.length);
  if(i<0)i=nodes.findIndex(n=>/tank/i.test(n.name||'')&&!/turret|track|wheel|barrel|gun/i.test(n.name||'')&&n.children?.length);
  if(i<0)throw Error('Tank root was not found in the starter scene');
  const names=[];const walk=(k)=>{names.push(nodes[k]?.name||'');for(const c of nodes[k]?.children||[])walk(c);};walk(i);
  if(!names.some(n=>/turret|tower/i.test(n)))throw Error('Extracted tank has no movable turret');
  json.scenes=[{name:'PRIDA tank / extracted CC0 model',nodes:[i]}];json.scene=0;delete json.animations;
  const raw=Buffer.from(JSON.stringify(json)),padding=(4-raw.length%4)%4,data=Buffer.concat([raw,Buffer.alloc(padding,32)]),header=Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+data.length+tail.length,8);header.writeUInt32LE(data.length,12);header.writeUInt32LE(0x4e4f534a,16);
  return Buffer.concat([header,data,tail]);
}
export async function installAssets(root,{offline=false,refresh=false}={}) {
  const dir=path.join(root,'public','models','prida030'),reportPath=path.join(root,'public','prida030-assets.json');fs.mkdirSync(dir,{recursive:true});
  let previous={};try{previous=JSON.parse(fs.readFileSync(reportPath,'utf8'));}catch{}
  const report={version:'0.30',license:'CC0-1.0',provider:'3DAssets.dev',providerUsesAI:true,models:{}};
  for(const kind of ['tank','plane']) {
    const dest=path.join(dir,kind+'.glb');let source=previous.models?.[kind]?.source||ASSET_SOURCES[kind].url;
    try {
      let data;
      if(fs.existsSync(dest)&&!refresh)data=fs.readFileSync(dest);
      else {
        if(offline||(!refresh&&previous.models?.[kind]?.status==='fallback'))throw Error('Using explicitly reported offline fallback');
        if(kind==='plane'){data=await bytes(source);}
        else {
          try {const manifest=JSON.parse((await bytes(ASSET_SOURCES.tank.manifest,2*1024*1024)).toString('utf8'));source=selectTankURL(manifest);if(!source)throw Error('Tank was not found in pack manifest');data=await bytes(source);}
          catch(first){console.warn('[PRIDA assets] Tank manifest:',first.message);source=ASSET_SOURCES.tank.starter;data=isolateTank(await bytes(source));}
        }
      }
      const {json}=parseGLB(data);
      if(kind==='tank'&&!json.nodes.some(n=>/turret|tower/i.test(n.name||'')))throw Error('Tank has no turret pivot');
      if(kind==='plane'&&!json.nodes.some(n=>/^prop$|propeller/i.test(n.name||'')))throw Error('Aircraft has no propeller pivot');
      fs.writeFileSync(dest,data);report.models[kind]={status:'downloaded',source,page:ASSET_SOURCES[kind].page,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),animations:(json.animations||[]).map(a=>a.name)};
      console.log('[PRIDA assets] '+kind+': local CC0 GLB '+data.length+' bytes');
    }catch(error){report.models[kind]={status:'fallback',page:ASSET_SOURCES[kind].page,reason:error.message};console.warn('[PRIDA assets] '+kind+': PROCEDURAL FALLBACK — '+error.message);}
  }
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  if(process.env.PRIDA_REQUIRE_CC0_ASSETS==='1'&&Object.values(report.models).some(m=>m.status!=='downloaded'))throw Error('A required CC0 model could not be acquired. See prida030-assets.json.');
  return report;
}
