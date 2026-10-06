import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {zipEntries,collectClient,auditClient} from '../scripts/package-crazygames.mjs';
const E=(name,data='test')=>({name,bytes:Buffer.from(data)});
test('portal ZIP has root entry, deflate payload and correct central directory',()=>{
 const out=zipEntries([E('index.html','<!doctype html>'),E('assets/client.js','console.log(1)')]);
 assert.equal(out.readUInt32LE(0),0x04034b50);assert.equal(out.readUInt16LE(6),0x800);assert.equal(out.readUInt16LE(8),8);
 const size=out.readUInt32LE(18),len=out.readUInt16LE(26);assert.equal(out.subarray(30,30+len).toString(),'index.html');
 assert.equal(inflateRawSync(out.subarray(30+len,30+len+size)).toString(),'<!doctype html>');
 assert.equal(out.readUInt32LE(out.length-22),0x06054b50);assert.equal(out.readUInt16LE(out.length-12),2);
 assert.equal(out.readUInt32LE(out.readUInt32LE(out.length-6)),0x02014b50);
});
for(const name of ['../.env','/index.html','a\\b','a/../b','a//b'])test('unsafe ZIP path rejected '+name,()=>assert.throws(()=>zipEntries([E(name)]),/Unsafe/));
test('audit requires root index',()=>assert.throws(()=>auditClient([E('folder/index.html')]),/missing/));
test('audit rejects root absolute asset URLs',()=>assert.throws(()=>auditClient([E('index.html','<script src="/assets/game.js"></script>')]),/absolute/));
test('relative assets valid; initial download is not silently claimed measured',()=>{
 const a=auditClient([E('index.html','<script src="./assets/game.js"></script>'),E('assets/game.js')]);assert.equal(a.files,2);assert.match(a.initialDownload,/NOT MEASURED/);
});
test('source/server/private content cannot enter playable ZIP',()=>assert.throws(()=>auditClient([E('index.html'),E('server.mjs')]),/private/));
test('too many files fail audit',()=>assert.throws(()=>auditClient([E('index.html'),...Array.from({length:1500},(_,i)=>E('a'+i))]),/limit/));
test('client collector excludes build/private inputs and preserves asset licenses',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prida-cg-'));
 try{for(const [name,data]of [['index.html','x'],['.env','secret'],['x.map','x'],['a.zip','x'],['accounts.mjs','x'],['ASSET-CREDITS.md','credits'],['LICENSE.txt','license']])fs.writeFileSync(path.join(dir,name),data);
 assert.deepEqual(collectClient(dir).map(e=>e.name),['ASSET-CREDITS.md','LICENSE.txt','index.html']);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('collector rejects symbolic links rather than following private paths',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prida-cg-'));
 try{fs.symlinkSync('/tmp',path.join(dir,'unsafe'));assert.throws(()=>collectClient(dir),/Symlink/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('public portal build cannot re-enable developer mode from stored preference',async()=>{
 let source=fs.readFileSync(new URL('../src/developer-mode.js',import.meta.url),'utf8');source=source.replace("import.meta.env?.VITE_CG_PORTAL === '1'",'true');
 const {developerMode,setDeveloperMode}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 assert.equal(setDeveloperMode(true),false);assert.equal(developerMode(),false);
});
