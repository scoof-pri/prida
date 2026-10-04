// Creates the playable portal ZIP from built client files. Never includes server code, .env or node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=b=>{let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export function zipEntries(entries){
  const local=[],central=[];let offset=0;
  for(const {name,bytes} of entries){
    if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe ZIP path: '+name);
    const n=Buffer.from(name),raw=Buffer.from(bytes),data=deflateRawSync(raw,{level:7}),crc=crc32(raw);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);
    h.writeUInt16LE(0x5c21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);
    c.writeUInt16LE(0x5c21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function collectClient(root){
  const entries=[];
  const walk=(dir,prefix='')=>{for(const name of fs.readdirSync(dir).sort()){
    if(name.startsWith('.')||/\.(map|zip)$/i.test(name)||name==='creator-capture.html')continue;
    const filename=path.join(dir,name),relative=prefix+name,stat=fs.lstatSync(filename);
    if(stat.isSymbolicLink())throw Error('Symlink in client build: '+relative);
    if(stat.isDirectory()){walk(filename,relative+'/');continue;}
    if(/\.(env|mjs|cjs)$/i.test(name)||['package.json','package-lock.json','Dockerfile'].includes(name))continue;
    entries.push({name:relative,bytes:fs.readFileSync(filename)});
  }};walk(root);return entries;
}
export function auditClient(entries){
  const bytes=entries.reduce((n,e)=>n+e.bytes.length,0),html=entries.find(e=>e.name==='index.html')?.bytes.toString();
  if(!html)throw Error('index.html is missing from the build root.');
  if(entries.length>1500||bytes>250000000)throw Error('Build exceeds the published CrazyGames count/size limit.');
  if(/(?:src|href)=["']\/(?!\/)/i.test(html))throw Error('Root-absolute asset paths are not portable to CrazyGames.');
  const forbidden=entries.filter(e=>/(?:^|\/)(?:\.env|server\.mjs|accounts\.mjs|prida-update\.mjs|node_modules|data)(?:\/|$)/i.test(e.name));
  if(forbidden.length)throw Error('Server/private files were included.');
  return {files:entries.length,totalBytes:bytes,initialDownload:'NOT MEASURED: record from navigation until first gameplayStart in CrazyGames Preview.'};
}
export async function buildPortal({full=false,serve=false,root=process.cwd()}={}){
  const vite=path.join(root,'node_modules/vite/bin/vite.js'),out=path.join(root,'dist-crazygames');
  if(!fs.existsSync(vite))throw Error('Run npm ci first.');
  const result=spawnSync(process.execPath,[vite,'build','--base','./','--outDir','dist-crazygames','--emptyOutDir'],{
    cwd:root,stdio:'inherit',env:{...process.env,VITE_CG_PORTAL:'1',VITE_CG_ADS:full?'full':'basic'},
  });
  if(result.status!==0)throw Error('The portal Vite build failed. No upload ZIP was created.');
  fs.writeFileSync(path.join(out,'config.json'),JSON.stringify({multiplayerUrl:'wss://prida.onrender.com',room:'park'}));
  const entries=collectClient(out),report=auditClient(entries),releaseDir=path.join(root,'release');fs.mkdirSync(releaseDir,{recursive:true});
  const filename='PRIDA-CrazyGames-'+(full?'full':'basic')+'.zip';
  fs.writeFileSync(path.join(releaseDir,filename),zipEntries(entries));
  fs.writeFileSync(path.join(releaseDir,'crazygames-build-audit.json'),JSON.stringify({...report,ads:full?'full-only; approval required':'disabled',progressSave:'CrazyGames SDK Data',sourceBuild:'0.37'},null,2));
  if(serve){
    const served=path.join(root,'dist');if(!fs.existsSync(path.join(served,'index.html')))throw Error('Build the standalone client before --serve.');
    fs.copyFileSync(path.join(releaseDir,filename),path.join(served,filename));
    fs.copyFileSync(path.join(releaseDir,'crazygames-build-audit.json'),path.join(served,'crazygames-build-audit.json'));
  }
  console.log('Created release/'+filename+' ('+entries.length+' files). Complete the Preview QA checklist before submitting.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)(async()=>{
  const serve=process.argv.includes('--serve');
  await buildPortal({full:!serve&&process.argv.includes('--full'),serve});
  if(serve&&process.env.PRIDA_CG_FULL_APPROVED==='1')await buildPortal({full:true,serve:true});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
