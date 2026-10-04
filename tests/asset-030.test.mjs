import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGLB,selectTankURL,isolateTank} from '../scripts/prida-assets.mjs';
function glb(json){const s=Buffer.from(JSON.stringify(json)),padding=(4-s.length%4)%4,data=Buffer.concat([s,Buffer.alloc(padding,32)]),h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(20+data.length,8);h.writeUInt32LE(data.length,12);h.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([h,data]);}
const sample={asset:{version:'2.0'},nodes:[{name:'Main Battle Tank',children:[1]},{name:'turret',mesh:0},{name:'tree',mesh:0}],meshes:[{primitives:[]}],scenes:[{nodes:[0,2]}],scene:0};
test('asset installer recognizes a binary GLB and rejects HTML/error pages',()=>{assert.ok(parseGLB(glb(sample)).json.nodes.length===3);assert.throws(()=>parseGLB(Buffer.from('<html>gateway error</html>')));});
test('asset validation rejects truncation and unconfigured decoders',()=>{const b=glb(sample);assert.throws(()=>parseGLB(b.subarray(0,b.length-4)));assert.throws(()=>parseGLB(glb({...sample,extensionsRequired:['KHR_draco_mesh_compression']})));});
test('models cannot load arbitrary third-party dependencies after build',()=>{assert.throws(()=>parseGLB(glb({...sample,buffers:[{uri:'https://unexpected.example/a.bin'}]})));});
test('a pack manifest selects the named tank, not the whole starter scene',()=>{
 const m={name:'Tanks and Field Camp',description:'A main battle tank and props',starter:'https://cdn.3dassets.dev/assets/23739/v1/model.glb',assets:[{name:'Fence',url:'https://cdn.3dassets.dev/assets/1/v1/model.glb'},{name:'Main Battle Tank',files:{glb:'https://cdn.3dassets.dev/assets/42/v1/model.glb'}}]};
 assert.equal(selectTankURL(m),'https://cdn.3dassets.dev/assets/42/v1/model.glb');assert.equal(selectTankURL({assets:[{name:'Main Battle Tank',url:'https://other.invalid/model.glb'}]}),null);
});
test('starter-scene fallback extracts only the tank root while preserving the GLB data layout',()=>{const b=isolateTank(glb(sample)),j=parseGLB(b).json;assert.deepEqual(j.scenes[0].nodes,[0]);assert.equal(j.nodes[1].name,'turret');assert.throws(()=>isolateTank(glb({...sample,nodes:[{name:'tree',children:[1]},{name:'branch',mesh:0}]})));});
