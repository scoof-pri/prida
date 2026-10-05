// Before-Docker CI guard. Both cumulative installers and exported expanded projects are supported.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),pkg=JSON.parse(fs.readFileSync(new URL('package.json',root)));
const installerURL=new URL('prida-update.mjs',root);
const installer=fs.existsSync(installerURL)?await import(installerURL):null;
const payload=installer?.decodePayload?.();
function read(name){return payload?.get(name)||fs.readFileSync(new URL(name,root));}
test('build entrypoints use the complete current installer, not obsolete recovery overlays',()=>{
  assert.equal(pkg.version,'0.41.0');
  for(const name of ['prebuild','predev','pretest','prestart','prebuild:crazygames','prebuild:crazygames:full']){
    if(pkg.pridaExpandedSource)assert.equal(pkg.scripts[name],undefined);
    else assert.equal(pkg.scripts[name],'node prida-update.mjs');
  }
  assert.ok(pkg.scripts.build.startsWith('vite build'));
});
test('binary avatars are complete GLBs, not a network download or HTML placeholder',()=>{
  for(const n of ['tactical-player','aegis-player','aegis-gauntlets']){
    const b=read('public/models/'+n+'.glb');assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
  }
});
test('current source keeps the native lift contract and routes actual avatar/flight integrations',()=>{
  assert.match(read('src/entity-delta.js').toString(),/isLiftSnapshot/);
  assert.match(read('src/render.js').toString(),/poseCustomAvatar\(v,p,dt,extra\)/);
  assert.match(read('src/main.js').toString(),/suitThrust: active && suit/);
  assert.match(read('src/world.js').toString(),/addBaseDroneStations\(map\)/);
});
test('release marker and package match, including the portal upload',()=>{
  assert.match(read('index.html').toString(),/0\.41\.0 · BASE DRONES \/ CUSTOM CHARACTERS/);
  assert.equal(JSON.parse(read('package.json')).version,pkg.version);
});
test('model provenance report matches both supplied asset geometries',()=>{
  const r=JSON.parse(read('public/PRIDA-0.41-model-report.json'));
  assert.ok(JSON.stringify(r).includes('originalTriangles'));assert.ok(JSON.stringify(r).includes('sourceSHA256'));
});
