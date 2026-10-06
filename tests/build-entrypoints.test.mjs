// Before-Docker CI guard. Both cumulative installers and exported expanded projects are supported.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {eligibleUpdatePath,NEW_UNIT_GATES,sameUpdaterContent} from '../scripts/build-update.mjs';
const root=new URL('../',import.meta.url),pkg=JSON.parse(fs.readFileSync(new URL('package.json',root)));
const installerURL=new URL('prida-update.mjs',root);
const installer=fs.existsSync(installerURL)?await import(installerURL):null;
const payload=installer?.decodePayload?.();
// Expanded source exports may adjust build commands. Test their actual source; full payload equality
// is checked independently by scripts/build-update.mjs --check in the maintained repository's CI.
function read(name){return pkg.pridaExpandedSource?fs.readFileSync(new URL(name,root)):payload?.get(name)||fs.readFileSync(new URL(name,root));}

test('build entrypoints use the complete current source or installer, not obsolete recovery overlays',()=>{
  assert.equal(pkg.version,'0.42.0');
  if(installer)assert.equal(installer.RELEASE,pkg.version);
  for(const name of ['prebuild','predev','pretest','prestart','prebuild:crazygames','prebuild:crazygames:full']){
    if(pkg.pridaExpandedSource)assert.equal(pkg.scripts[name],undefined);
    else assert.equal(pkg.scripts[name],'node prida-update.mjs');
  }
  assert.ok(pkg.scripts.build.startsWith('vite build'));
});

test('binary avatars, vehicle bases and the carried FPV item are complete local GLBs',()=>{
  for(const n of ['tactical-player','aegis-player','aegis-gauntlets','fpv','prida030/plane','prida030/tank']){
    const b=read('public/models/'+n+'.glb');assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
  }
});

test('current source keeps the native lift contract and routes the motion, aircraft and suit integrations',()=>{
  assert.match(read('src/entity-delta.js').toString(),/isLiftSnapshot/);
  assert.match(read('src/render.js').toString(),/poseCustomAvatar\(v,p,dt,extra\)/);
  assert.match(read('src/render.js').toString(),/selectCharacterAnimation\(v, p/);
  assert.match(read('src/main.js').toString(),/suitThrust: active && controls\.thrust/);
  assert.match(read('src/main.js').toString(),/suitControls\(/);
  assert.match(read('src/world.js').toString(),/addBaseDroneStations\(map\)/);
  for(const n of ['src/aircraft-physics.js','src/aircraft-hulls.js','src/aircraft-wreckage.js','src/fpv-inventory.js','src/suit-weapons.js','src/suit-view.js','src/suit-controls.js'])assert.ok(read(n).length>100,n);
});

test('release marker and package match the 0.42 portal upload',()=>{
  assert.match(read('index.html').toString(),/0\.42\.0 · FPV ITEMS \/ AIRCRAFT \/ SUIT COMBAT/);
  assert.equal(JSON.parse(read('package.json')).version,pkg.version);
  if(payload)assert.equal(JSON.parse(payload.get('package.json')).version,pkg.version);
});

test('model provenance and the uploaded motion hashes survive source expansion',()=>{
  const r=JSON.parse(read('public/PRIDA-0.41-model-report.json'));
  assert.ok(JSON.stringify(r).includes('originalTriangles'));assert.ok(JSON.stringify(r).includes('sourceSHA256'));
  const motion=JSON.parse(read('public/models/animation-manifest.json'));assert.equal(motion.clips.length,30);
  for(const model of motion.models)assert.equal(createHash('sha256').update(read('public/models/'+model.file)).digest('hex'),model.sha256);
});

test('the cumulative updater carries every new feature gate and preserves its staged validation API',{skip:!installer},()=>{
  for(const n of NEW_UNIT_GATES)assert.ok(payload.has(n),n);
  const source=fs.readFileSync(installerURL,'utf8'),match=source.match(/^const UNIT=(\[[^\n]*\]);$/m);
  assert.ok(match,'UNIT declaration exists');const units=JSON.parse(match[1]);
  for(const n of NEW_UNIT_GATES)assert.ok(units.includes(n),n);
  assert.equal(typeof installer.safeName,'function');assert.equal(typeof installer.decodeEntry,'function');
  assert.equal(typeof installer.commitFiles,'function');assert.equal(typeof installer.install,'function');
  assert.equal(payload.has('prida-update.mjs'),false);
});

test('updater path filtering excludes itself, raw uploads, secrets, archives and generated output',()=>{
  for(const n of ['prida-update.mjs','../escape.js','/tmp/escape.js','src/../escape.js','src\\escape.js','public/secret.key','public/models/source.fbx','public/models/source.stl','public/models/source.blend','public/archive/old.glb','public/tmp/test.glb','scripts/node_modules/a.js','public/.env','docs/old.zip'])assert.equal(eligibleUpdatePath(n),false,n);
  for(const n of ['src/suit-weapons.js','scripts/build-update.mjs','public/models/fpv.glb','public/models/prida030/plane.glb','public/icons/fpv.png','docs/UPDATE-0.42.md','README-0.42.txt'])assert.equal(eligibleUpdatePath(n),true,n);
});

test('updater rejects unsafe paths and a corrupt binary entry before staging',{skip:!installer},()=>{
  for(const n of ['../escape','/absolute','a\\b','a/../b','a\0b','C:secret'])assert.throws(()=>installer.safeName(n),/Unsafe update path/);
  const bytes=Buffer.from('glTF-test'),entry={encoding:'base64',data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.ok(installer.decodeEntry(entry).equals(bytes));
  assert.throws(()=>installer.decodeEntry({...entry,data:Buffer.from('corrupt').toString('base64')}),/checksum failed/);
});

test('updater atomic commit restores changed files and keeps backups after a later write fails',{skip:!installer},()=>{
  const fixture=fs.mkdtempSync(path.join(fileURLToPath(root),'.updater-rollback-test-'));
  try{
    fs.writeFileSync(path.join(fixture,'a.txt'),'before');fs.writeFileSync(path.join(fixture,'blocked'),'regular file');
    const state=path.join(fixture,'.state'),changes=new Map([['a.txt',Buffer.from('after')],['blocked/b.txt',Buffer.from('new')]]);
    assert.throws(()=>installer.commitFiles(fixture,changes,state));
    assert.equal(fs.readFileSync(path.join(fixture,'a.txt'),'utf8'),'before');
    assert.equal(fs.readFileSync(path.join(fixture,'blocked'),'utf8'),'regular file');
    assert.equal(fs.readFileSync(path.join(state,'backup/a.txt'),'utf8'),'before');
  }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});

test('updater concurrent-edit guard does not overwrite a source changed after preparation',{skip:!installer},()=>{
  const fixture=fs.mkdtempSync(path.join(fileURLToPath(root),'.updater-concurrent-test-'));
  try{
    fs.writeFileSync(path.join(fixture,'a.txt'),'newer local change');
    const original=new Map([['a.txt',Buffer.from('old snapshot')]]),changes=new Map([['a.txt',Buffer.from('prepared update')]]);
    assert.throws(()=>installer.commitFiles(fixture,changes,path.join(fixture,'.state'),original),/Concurrent source edit/);
    assert.equal(fs.readFileSync(path.join(fixture,'a.txt'),'utf8'),'newer local change');
  }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});


test('release verification accepts different gzip encodings only when raw payload, metadata and gates match',()=>{
  const raw=Buffer.from(JSON.stringify({source:'same reviewed source '.repeat(100)}));
  const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
  const source=(bytes,level=9)=>"export const RELEASE='0.42.0';\nconst STATE='.prida-0.42', PAYLOAD_SHA256=\""+checksum(bytes)+"\", PAYLOAD_B64=\""+gzipSync(bytes,{level}).toString('base64')+"\";\nconst UNIT=[\"gate\"];\n";
  const fast=source(raw,0),compact=source(raw,9);assert.notEqual(fast.length,compact.length);
  assert.equal(sameUpdaterContent(fast,compact),true);
  assert.equal(sameUpdaterContent(fast,compact.replace('gate','different gate')),false);
  assert.equal(sameUpdaterContent(fast,compact.replace("STATE='.prida-0.42'","STATE='.prida-other'")),false);
  assert.equal(sameUpdaterContent(fast,source(Buffer.from('{"source":"changed"}'))),false);
  assert.throws(()=>sameUpdaterContent(fast,compact.replace(checksum(raw),'0'.repeat(64))),/checksum failed/);
  const corrupt=compact.replace(/PAYLOAD_B64="[^"]+"/,'PAYLOAD_B64="'+Buffer.from('not a gzip stream').toString('base64')+'"');
  assert.throws(()=>sameUpdaterContent(fast,corrupt),/compressed updater payload/);
});
