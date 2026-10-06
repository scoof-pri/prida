// Rebuild the cumulative updater from the expanded, reviewed repository sources.
// The updater is the template and seed manifest, never an entry inside its own payload.
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const DEFAULT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MAX_PAYLOAD_BYTES=64*1024*1024;
const ROOT_FILES=['accounts.mjs','index.html','package-lock.json','package.json','server.mjs','vite.config.js','Dockerfile','render.yaml','README.md','HANDOFF.md','lobby-stage.js','lobby-ui.js'];
const SOURCE_DIRS=['src','docs','scripts','tests','public/models','public/icons'];
export const NEW_UNIT_GATES=Object.freeze(['tests/aircraft-042.test.mjs','tests/animations-042.test.mjs','tests/suit-042.test.mjs','tests/fpv-042.test.mjs','tests/client-controls-042.test.mjs']);
const REQUIRED_042=['src/character-animations.js','src/aircraft-physics.js','src/aircraft-hulls.js','src/aircraft-geometry.js','src/aircraft-wreckage.js','src/fpv-inventory.js','src/suit-weapons.js','src/suit-view.js','src/suit-controls.js','public/models/fpv.glb','public/icons/fpv.png','public/models/prida030/plane.glb','public/models/prida030/tank.glb','public/models/animation-manifest.json','scripts/build-update.mjs','scripts/prepare-uploaded-animations.mjs','scripts/strip-uploaded-fbx.py',...NEW_UNIT_GATES];
const BLOCKED_DIRS=new Set(['node_modules','dist','dist-crazygames','release','data','upload','uploads','archive','archives','tmp','temp','__pycache__']);
const BLOCKED_EXT=/\.(?:env|db|sqlite|pem|key|p12|pfx|zip|7z|rar|tar|gz|bz2|xz|fbx|stl|blend|obj|mtl|pyc|tmp|temp|bak|log|ttf|otf|woff2?)$/i;
const TEXT_EXT=new Set(['.js','.mjs','.cjs','.json','.html','.css','.md','.txt','.yaml','.yml','.py','.sh','.svg','.toml']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function eligibleUpdatePath(name){
  if(typeof name!=='string'||name==='prida-update.mjs'||name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.includes(':'))return false;
  const parts=name.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||BLOCKED_DIRS.has(p.toLowerCase())))return false;
  return !parts.at(-1).endsWith('~')&&!BLOCKED_EXT.test(parts.at(-1))&&!/^accounts\.(?:json|bak)$/i.test(parts.at(-1));
}
function assertRegularPath(root,name){
  let p=root;
  for(const part of name.split('/')){
    p=path.join(p,part);
    if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Updater build refuses symlink: '+name);
  }
}
function encodeEntry(bytes,name){
  const ext=path.extname(name).toLowerCase();
  if(TEXT_EXT.has(ext)||path.basename(name)==='Dockerfile'){
    try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(Buffer.from(text,'utf8').equals(bytes))return text;}catch{}
  }
  return {encoding:'base64',data:bytes.toString('base64'),sha256:hash(bytes)};
}
function jsonDeclaration(source,name){
  const match=source.match(new RegExp('^const '+name+'=(\\[[^\\n]*\\]);$','m'));
  if(!match)throw Error('Updater template is missing '+name+' declaration');
  return JSON.parse(match[1]);
}
// gzip output may differ between the Node/zlib versions used by development and Docker.
// Verify the compressed container and raw payload first; normalize only that representation.
function verifiedPayload(source){
  const matches=[...source.matchAll(/^(const STATE='[^']+', PAYLOAD_SHA256="([a-f0-9]{64})", PAYLOAD_B64=")([A-Za-z0-9+/=]+)(";)$/gm)];
  if(matches.length!==1)throw Error('Updater must contain exactly one checked payload declaration');
  const match=matches[0],compressed=Buffer.from(match[3],'base64');
  if(compressed.toString('base64')!==match[3])throw Error('Updater payload base64 is not canonical');
  let raw;try{raw=gunzipSync(compressed,{maxOutputLength:MAX_PAYLOAD_BYTES});}
  catch{throw Error('Invalid or oversized compressed updater payload');}
  if(hash(raw)!==match[2])throw Error('Embedded payload checksum failed');
  const normalized=source.slice(0,match.index)+match[1]+'<verified-gzip-payload>'+match[4]+source.slice(match.index+match[0].length);
  return {raw,sha256:match[2],normalized};
}
export function sameUpdaterContent(actual,expected){
  const a=verifiedPayload(Buffer.isBuffer(actual)?actual.toString('utf8'):actual);
  const b=verifiedPayload(Buffer.isBuffer(expected)?expected.toString('utf8'):expected);
  return a.sha256===b.sha256&&a.raw.equals(b.raw)&&a.normalized===b.normalized;
}

function replaceOne(source,pattern,replacement,label){
  const count=[...source.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))].length;
  if(count!==1)throw Error('Expected exactly one '+label+' in updater template, found '+count);
  return source.replace(pattern,replacement);
}

// Retain every original seed path and add current source, model, icon and release-document paths.
// Dependencies, input archives, raw DCC files, credentials and generated output are not considered.
export function collectUpdateFiles(root,seedNames,release){
  root=path.resolve(root);const names=new Set();
  const addFile=name=>{
    if(!eligibleUpdatePath(name))throw Error('Disallowed updater input: '+name);
    assertRegularPath(root,name);const p=path.join(root,name);
    if(!fs.existsSync(p)||!fs.lstatSync(p).isFile())throw Error('Updater source is missing or not a regular file: '+name);
    names.add(name);
  };
  for(const name of seedNames)addFile(name);
  for(const name of ROOT_FILES)if(fs.existsSync(path.join(root,name)))addFile(name);
  const walk=relative=>{
    assertRegularPath(root,relative);const p=path.join(root,relative);
    if(!fs.existsSync(p))return;
    for(const entry of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const name=relative+'/'+entry.name;if(!eligibleUpdatePath(name))continue;
      if(entry.isSymbolicLink())throw Error('Updater build refuses symlink: '+name);
      if(entry.isDirectory())walk(name);else if(entry.isFile())addFile(name);
    }
  };
  for(const dir of SOURCE_DIRS)walk(dir);
  const publicRoot=path.join(root,'public');
  if(fs.existsSync(publicRoot))for(const entry of fs.readdirSync(publicRoot,{withFileTypes:true})){
    const name='public/'+entry.name;
    if(eligibleUpdatePath(name)&&TEXT_EXT.has(path.extname(entry.name).toLowerCase())){
      if(entry.isSymbolicLink())throw Error('Updater build refuses symlink: '+name);
      if(entry.isFile())addFile(name);
    }
  }
  const version=release.split('.').slice(0,2).join('.');
  for(const name of ['README-'+version+'.txt','docs/UPDATE-'+version+'.md'])addFile(name);
  for(const name of REQUIRED_042)if(!names.has(name))throw Error('Required 0.42 runtime or gate missing: '+name);
  const files=new Map();
  for(const name of [...names].sort())files.set(name,fs.readFileSync(path.join(root,name)));
  return files;
}

export async function buildUpdate({root=DEFAULT_ROOT,output=null,check=false}={}){
  root=path.resolve(root);const updater=path.join(root,'prida-update.mjs'),out=path.resolve(output||updater);
  if(!fs.existsSync(updater)||fs.lstatSync(updater).isSymbolicLink())throw Error('A regular prida-update.mjs template is required');
  const templateBytes=fs.readFileSync(updater),template=templateBytes.toString('utf8');
  // Importing the existing updater exposes its checked decoder. Its CLI-only installer is never called.
  const seed=await import(pathToFileURL(updater).href+'?buildSeed='+hash(templateBytes));
  if(typeof seed.decodePayload!=='function'||typeof seed.safeName!=='function')throw Error('Updater template lacks its checked decoder API');
  const previous=seed.decodePayload();
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),release=pkg.version;
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release))throw Error('Invalid package release version');
  const files=collectUpdateFiles(root,previous.keys(),release);
  for(const name of files.keys())seed.safeName(name);
  const lock=JSON.parse(files.get('package-lock.json'));
  if(lock.version!==release||lock.packages?.['']?.version!==release)throw Error('package-lock.json version must match package.json before rebuilding');
  const marker=release+' · FPV ITEMS / AIRCRAFT / SUIT COMBAT';
  if(!files.get('index.html').toString('utf8').includes(marker))throw Error('index.html release marker must match '+marker);
  const entries=Object.create(null);for(const[name,bytes]of files)entries[name]=encodeEntry(bytes,name);
  const raw=Buffer.from(JSON.stringify(entries),'utf8');if(raw.length>MAX_PAYLOAD_BYTES)throw Error('Updater payload exceeds the existing 64 MiB decoder limit');
  const compressed=gzipSync(raw,{level:9,mtime:0});compressed.writeUInt32LE(0,4);compressed[9]=255;
  const payloadHash=hash(raw),version=release.split('.').slice(0,2).join('.');
  let source=replaceOne(template,/^\/\/ PRIDA [^\n]* cumulative source \+ model update\.[^\n]*$/m,'// PRIDA '+version+' cumulative source + model update. No network writes or credential reads.','release banner');
  source=replaceOne(source,/^export const RELEASE='[^']+';$/m,"export const RELEASE='"+release+"';",'release declaration');
  source=replaceOne(source,/^const STATE='[^']+', PAYLOAD_SHA256="[a-f0-9]{64}", PAYLOAD_B64="[A-Za-z0-9+/=]+";$/m,
    "const STATE='.prida-"+version+"', PAYLOAD_SHA256="+JSON.stringify(payloadHash)+", PAYLOAD_B64="+JSON.stringify(compressed.toString('base64'))+';','payload declaration');
  const unit=[...new Set([...jsonDeclaration(template,'UNIT').filter(n=>n!=='tests/build-entrypoints.test.mjs'),...NEW_UNIT_GATES,'tests/build-entrypoints.test.mjs'])];
  for(const name of [...unit,...jsonDeclaration(template,'INTEGRATION')])if(!files.has(name))throw Error('Updater validation gate missing from payload: '+name);
  source=replaceOne(source,/^const UNIT=\[[^\n]*\];$/m,'const UNIT='+JSON.stringify(unit)+';','unit gate list');
  const requiredMatch=template.match(/for\(const n of (\[[^\n]*\])\)if\(!result\.has\(n\)\)throw Error\('Incomplete update: '\+n\);/);
  if(!requiredMatch)throw Error('Updater template lacks the required-entry gate');
  const required=[...new Set([...JSON.parse(requiredMatch[1].replaceAll("'",'"')),...REQUIRED_042,'README-'+version+'.txt','docs/UPDATE-'+version+'.md'])];
  source=source.replace(requiredMatch[0],"for(const n of "+JSON.stringify(required)+")if(!result.has(n))throw Error('Incomplete update: '+n);");
  source=replaceOne(source,/^const DIRECTORIES=\[[^\n]*\];$/m,"const DIRECTORIES=['src','public','scripts','tests','docs'];",'staged source directories');
  source=replaceOne(source,/^const omitted=n=>[^\n]*;$/m,
    "const omitted=n=>n.startsWith('.')||['node_modules','dist','dist-crazygames','release','data','upload','uploads','archive','archives','tmp','temp','__pycache__'].includes(n.toLowerCase())||/\\.(env|db|sqlite|pem|key|p12|pfx|zip|7z|rar|tar|gz|bz2|xz|fbx|stl|blend|obj|mtl|pyc|tmp|temp|bak|log|ttf|otf|woff2?)$/i.test(n);",'staging exclusions');
  source=replaceOne(source,/\+\(checkOnly\?'VERIFIED':'INSTALLED'\)\+' — [^'\n]*'\);/,
    "+(checkOnly?'VERIFIED':'INSTALLED')+' — FPV ITEMS / AIRCRAFT / SUIT COMBAT');",'installation summary');
  // Only metadata, entry requirements and source exclusions change; all validation and commit functions
  // retain their source from the inspected template, including backup/rollback and concurrent-edit checks.
  for(const name of ['safeName','decodeEntry','commitFiles','install'])if(!source.includes('export function '+name+'('))throw Error('Preserved installer API missing: '+name);
  const currentFiles=collectUpdateFiles(root,previous.keys(),release);
  if(currentFiles.size!==files.size)throw Error('Updater source file list changed while building; retry');
  for(const[name,bytes]of files)if(!currentFiles.get(name)?.equals(bytes))throw Error('Sources changed while building updater; retry: '+name);
  if(!fs.readFileSync(updater).equals(templateBytes))throw Error('Updater template changed while generating; retry');
  const result=Buffer.from(source,'utf8');
  if(check){
    if(!fs.existsSync(out)||!sameUpdaterContent(fs.readFileSync(out),result))throw Error('Cumulative updater is stale. Run node scripts/build-update.mjs after reviewing current source changes.');
  }else{
    if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())throw Error('Refusing to replace an updater symlink');
    fs.mkdirSync(path.dirname(out),{recursive:true});
    const tempDir=fs.mkdtempSync(path.join(path.dirname(out),'.prida-update-build-')),tmp=path.join(tempDir,'updater.mjs');
    try{fs.writeFileSync(tmp,result,{flag:'wx'});fs.renameSync(tmp,out);}finally{fs.rmSync(tempDir,{recursive:true,force:true});}
  }
  return {release,files:files.size,payloadBytes:raw.length,compressedBytes:compressed.length,updaterBytes:result.length,payloadSHA256:payloadHash,output:out,checked:check};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};
  try{
    for(let i=2;i<process.argv.length;i++){
      const a=process.argv[i];if(a==='--check')options.check=true;
      else if(a==='--root'||a==='--output'){if(!process.argv[i+1])throw Error('Missing value for '+a);options[a.slice(2)]=process.argv[++i];}
      else throw Error('Unknown argument: '+a);
    }
    const r=await buildUpdate(options);
    console.log('[PRIDA '+r.release+'] '+(r.checked?'Updater matches':'Updater generated')+': '+r.files+' entries, '+r.payloadBytes+' payload bytes, '+r.updaterBytes+' updater bytes.');
    console.log('Payload SHA-256: '+r.payloadSHA256);
  }catch(error){console.error('[PRIDA updater build] '+error.message);process.exitCode=1;}
}
