import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sceneryModelNames, geometryOnlyGlb, preloadSceneryModels } from './scenery-assets-0351.mjs';
function glb(json = {}, data = Buffer.from([1,2,3,4])) {
 const doc = { asset: {version:'2.0'}, buffers:[{byteLength:data.length}], ...json };
 const js = Buffer.from(JSON.stringify(doc)), padded = Buffer.alloc(Math.ceil(js.length/4)*4,0x20);js.copy(padded);
 const bin = Buffer.alloc(Math.ceil(data.length/4)*4);data.copy(bin);
 const out = Buffer.alloc(28+padded.length+bin.length);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
 out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);padded.copy(out,20);
 const k=20+padded.length;out.writeUInt32LE(bin.length,k);out.writeUInt32LE(0x004e4942,k+4);bin.copy(out,k+8);return out;
}
const documentOf=bytes=>JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const fakeAsset=()=>({scene:{isObject3D:true,traverse(fn){fn({isMesh:true,geometry:{attributes:{position:{count:1,getX:()=>0,getY:()=>1,getZ:()=>2}}}});}}});
test('scene preload deduplicates models and excludes procedural boxes',()=>{
 assert.deepEqual(sceneryModelNames({decor:[{model:'bookcase'},{model:'chair'},{model:'bookcase'},{box:[1,1,1]}]}),['decor-bookcase','decor-chair']);
});
test('render subset wins over the full-world decor list',()=>{
 assert.deepEqual(sceneryModelNames({renderDecor:[{model:'chair'}],decor:[{model:'bookcase'}]}),['decor-chair']);
});
test('empty scenery does not request or synthesize any models',async()=>{
 const r=await preloadSceneryModels({decor:[]},{read:()=>assert.fail(),parse:()=>assert.fail(),register:()=>assert.fail()});assert.deepEqual(r.names,[]);
});
for(const model of ['../../secret','https://host/model','','bad/name',null])test('unsafe model name rejected: '+model,()=>{
 assert.throws(()=>sceneryModelNames({decor:[{model}]}),/Invalid scenery/);
});
test('GLB without textures preserves all document properties and BIN bytes',()=>{
 const src=glb({nodes:[{translation:[3,4,5]}],bufferViews:[{buffer:0,byteLength:4}]});const r=geometryOnlyGlb(src);
 assert.deepEqual(documentOf(r.bytes),documentOf(src));assert.deepEqual(r.bytes.subarray(-4),src.subarray(-4));assert.equal(r.imageCount,0);
});
test('geometry-only material keeps factors and transforms but makes no image requests',()=>{
 const src=glb({images:[{bufferView:0,mimeType:'image/png'}],textures:[{source:0}],samplers:[{}],bufferViews:[{buffer:0,byteLength:4}],nodes:[{translation:[1,2,3]}],
 materials:[{pbrMetallicRoughness:{baseColorFactor:[1,.2,.3,1],baseColorTexture:{index:0}},normalTexture:{index:0},extensions:{KHR_materials_clearcoat:{clearcoatNormalTexture:{index:0},clearcoatFactor:.5}}}]});
 const {bytes,imageCount}=geometryOnlyGlb(src);const j=documentOf(bytes);assert.equal(imageCount,1);assert.equal(j.images,undefined);assert.equal(j.materials[0].normalTexture,undefined);
 assert.deepEqual(j.materials[0].pbrMetallicRoughness.baseColorFactor,[1,.2,.3,1]);assert.equal(j.materials[0].extensions.KHR_materials_clearcoat.clearcoatFactor,.5);
 assert.deepEqual(bytes.subarray(-4),src.subarray(-4));assert.deepEqual(j.nodes,[{translation:[1,2,3]}]);
});
test('original file bytes are never modified',()=>{const b=glb();const copy=Buffer.from(b);geometryOnlyGlb(b);assert.deepEqual(b,copy);});
test('HTML error pages do not silently become a missing-mesh substitute',()=>{assert.throws(()=>geometryOnlyGlb(Buffer.from('<html>not found</html>')),/Invalid/);});
test('truncated GLB is rejected',()=>{assert.throws(()=>geometryOnlyGlb(glb().subarray(0,-1)),/truncated/);});
test('declared chunk length must fit the file',()=>{const b=glb();b.writeUInt32LE(999999,12);assert.throws(()=>geometryOnlyGlb(b),/chunk length/);});
test('external buffers are rejected instead of silently using network access',()=>{assert.throws(()=>geometryOnlyGlb(glb({buffers:[{uri:'https://example.invalid/data',byteLength:4}]})),/external/);});
test('bufferView cannot extend outside actual GLB binary data',()=>{assert.throws(()=>geometryOnlyGlb(glb({bufferViews:[{buffer:0,byteOffset:2,byteLength:9}]})),/bufferView/);});
test('every real filename is read, parsed and registered before scene construction',async()=>{
 const calls=[],map={decor:[{model:'bookcase'},{model:'chair'},{model:'bookcase'}]};
 const r=await preloadSceneryModels(map,{root:'/fixture/models',read:async n=>{calls.push(['read',path.basename(n)]);return glb();},parse:async b=>{calls.push(['parse']);assert.ok(Buffer.isBuffer(b));return fakeAsset();},register:n=>calls.push(['register',n])});
 assert.deepEqual(r.names,['decor-bookcase','decor-chair']);assert.deepEqual(calls.map(c=>c[0]),['read','parse','read','parse','register','register']);
 assert.equal(calls[0][1],'decor-bookcase.glb');
});
test('missing file aborts preload without registering a partial or fallback scene',async()=>{
 let n=0,registered=0;await assert.rejects(preloadSceneryModels({decor:[{model:'bookcase'},{model:'chair'}]},
 {read:async()=>{if(n++)throw Error('ENOENT');return glb();},parse:async()=>fakeAsset(),register:()=>registered++}),/missing its local asset/);assert.equal(registered,0);
});
test('parser failures keep the original cause',async()=>{
 const cause=Error('broken accessor');await assert.rejects(preloadSceneryModels({decor:[{model:'bookcase'}]},
 {read:async()=>glb(),parse:async()=>{throw cause;},register:()=>assert.fail()}),e=>e.cause===cause&&/decor-bookcase/.test(e.message));
});
test('empty parsed scenes fail rather than satisfy mesh-count assertions',async()=>{
 await assert.rejects(preloadSceneryModels({decor:[{model:'bookcase'}]},
 {read:async()=>glb(),parse:async()=>({scene:{isObject3D:true,traverse(){}}}),register:()=>assert.fail()}),/No mesh parts/);
});
test('non-finite vertex fails before registration',async()=>{
 const a=fakeAsset();a.scene.traverse=fn=>fn({isMesh:true,geometry:{attributes:{position:{count:1,getX:()=>NaN,getY:()=>0,getZ:()=>0}}}});
 await assert.rejects(preloadSceneryModels({decor:[{model:'bookcase'}]},
 {read:async()=>glb(),parse:async()=>a,register:()=>assert.fail()}),/Non-finite/);
});
