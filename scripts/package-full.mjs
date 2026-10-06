// Full ACTIVE source export. Explicit allowlist: never reads .env, account databases, node_modules,
// git metadata or update backups. Public redistribution is intentional for this open-source project.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {zipEntries} from './package-crazygames.mjs';
const ROOT_FILES=['package.json','package-lock.json','index.html','server.mjs','accounts.mjs',
  'vite.config.js','Dockerfile','render.yaml','README.md','HANDOFF.md','prida-update.mjs','lobby-stage.js','lobby-ui.js'];
const DIRECTORIES=['src','public','scripts','tests'];
const forbidden=/\.(env|pem|key|p12|pfx|sqlite|db|ttf|otf|woff2?|zip|mp4|webm)$/i;
function allowed(name){return !name.startsWith('.')&&!forbidden.test(name)&&!/^accounts\.(json|bak)$/i.test(name);}
export function fullEntries(root){
  root=path.resolve(root);const entries=[];
  function add(relative){
    const p=path.join(root,relative),stat=fs.lstatSync(p);
    if(stat.isSymbolicLink())throw Error('Full export refuses symlink: '+relative);
    if(stat.isDirectory()){
      for(const name of fs.readdirSync(p).sort())if(allowed(name)&&!['node_modules','data','exports','release'].includes(name))add(relative+'/'+name);
    }else if(stat.isFile())entries.push({name:relative,bytes:fs.readFileSync(p)});
  }
  for(const name of ROOT_FILES)if(fs.existsSync(path.join(root,name)))add(name);
  for(const name of DIRECTORIES)if(fs.existsSync(path.join(root,name)))add(name);
  for(const name of ['package.json','src/simulation.js','server.mjs','public/models'])if(!fs.existsSync(path.join(root,name)))throw Error('Required game path is missing: '+name);
  const p=entries.find(e=>e.name==='package.json'),pkg=JSON.parse(p.bytes.toString());
  // Exported source has ALREADY been patched. Do not apply the root overlay to it a second time.
  for(const name of Object.keys(pkg.scripts||{}))if(/^pre/.test(name)&&pkg.scripts[name].includes('prida-update.mjs'))delete pkg.scripts[name];
  pkg.scripts['build']='vite build';pkg.scripts['export:full']='node scripts/package-full.mjs';
  pkg.pridaExpandedSource=true;p.bytes=Buffer.from(JSON.stringify(pkg,null,2)+'\n');
  const note=`PRIDA ${pkg.version} — FULL ACTIVE SOURCE\n\nThis is the expanded, already patched game.\nInstall Node.js 22, run npm ci, then npm run build and npm start.\nOpen http://localhost:8080. npm run dev starts the Vite development server.\n\nIncluded: source, server, model/texture/icon assets, scripts and tests.\nNot included: dependencies (npm ci installs exact lockfile versions), account data, passwords,\nprivate environment files, old release archives and git history.\nThe root prida-update.mjs is retained for provenance, NOT automatically run on expanded sources.\nDo not upload this full folder over the patch-based GitHub repository to install a two-file update.\nFor CrazyGames use the client ZIP, not this source ZIP.\n\nExternal optional assets have the status recorded in public/prida030-assets.json.\n`;
  entries.push({name:'FULL-SOURCE-READ-ME.txt',bytes:Buffer.from(note)});
  const manifest={version:pkg.version,files:entries.map(e=>({name:e.name,bytes:e.bytes.length,sha256:createHash('sha256').update(e.bytes).digest('hex')}))};
  entries.push({name:'FULL-SOURCE-MANIFEST.json',bytes:Buffer.from(JSON.stringify(manifest,null,2))});
  return entries;
}
export function exportFull(root=process.cwd(),{serve=false}={}){
  const entries=fullEntries(root),name='PRIDA-0.41-FULL-GAME.zip',out=path.join(root,'release');
  fs.mkdirSync(out,{recursive:true});const bytes=zipEntries(entries);fs.writeFileSync(path.join(out,name),bytes);
  if(serve){const dir=path.join(root,'dist');if(!fs.existsSync(path.join(dir,'index.html')))throw Error('Build client before --serve');fs.writeFileSync(path.join(dir,name),bytes);}
  console.log('[PRIDA] Full source export: '+entries.length+' files, '+bytes.length+' bytes, release/'+name);
  return {name,count:entries.length,bytes:bytes.length};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{exportFull(process.cwd(),{serve:process.argv.includes('--serve')});}catch(e){console.error(e.message);process.exitCode=1;}}
