// Node-only setup for the CPU scene-geometry test. Uses the repository's real GLB
// buffers and the pinned Three.js parser, not stand-in furniture meshes.
// Pixel decoding/shaders are deliberately out of scope in this no-WebGL test.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_GLB_BYTES = 32 * 1024 * 1024;

export function sceneryModelNames(map) {
  return [...new Set((map.renderDecor || map.decor || []).filter(d => !d.box).map(d => {
    if (typeof d.model !== 'string' || !/^[A-Za-z0-9_-]+$/.test(d.model))
      throw Error('Invalid scenery model name: ' + String(d.model));
    return 'decor-' + d.model;
  }))].sort();
}

// Keep the BIN bytes, node transforms, geometry, UVs and material factors intact.
// Remove texture references only, so Node does not require browser Image/FileReader.
// Browser loadAssets() still loads the ORIGINAL file with every texture enabled.
export function geometryOnlyGlb(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 20 || bytes.length > MAX_GLB_BYTES || bytes.readUInt32LE(0) !== 0x46546c67 ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
    throw Error('Invalid or truncated GLB 2.0 asset');
  const chunks = [];
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw Error('Truncated GLB chunk header');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (length % 4 !== 0 || offset + 8 + length > bytes.length) throw Error('Invalid GLB chunk length');
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  if (chunks[0]?.type !== JSON_CHUNK || chunks.filter(c => c.type === JSON_CHUNK).length !== 1)
    throw Error('GLB must start with exactly one JSON chunk');
  const document = JSON.parse(chunks[0].data.toString('utf8').trim());
  if (document.asset?.version !== '2.0') throw Error('Unsupported glTF asset version');
  const bins = chunks.filter(c => c.type === BIN_CHUNK);
  if ((document.buffers || []).some(b => b.uri !== undefined) || (document.buffers || []).length > 1)
    throw Error('Scene gate requires self-contained GLB buffers; external requests are not allowed');
  if (document.buffers?.length) {
    const size = document.buffers[0].byteLength;
    if (bins.length !== 1 || !Number.isInteger(size) || size < 0 || size > bins[0].data.length || bins[0].data.length - size > 3)
      throw Error('Invalid GLB binary buffer length');
    for (const view of document.bufferViews || []) {
      const start = view.byteOffset || 0;
      if (view.buffer !== 0 || !Number.isInteger(start) || !Number.isInteger(view.byteLength) ||
          start < 0 || view.byteLength < 0 || start + view.byteLength > size)
        throw Error('GLB bufferView outside its binary buffer');
    }
  }
  const imageCount = document.images?.length || 0;
  const stripTextureReferences = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (/Texture$/.test(key) && typeof value[key] === 'object') delete value[key];
      else stripTextureReferences(value[key]);
    }
  };
  for (const material of document.materials || []) stripTextureReferences(material);
  delete document.textures;
  delete document.images;
  delete document.samplers;
  const textureOnly = new Set(['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif', 'KHR_texture_transform']);
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (document[key]) document[key] = document[key].filter(name => !textureOnly.has(name));
  }
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  chunks[0].data = padded;
  const length = 12 + chunks.reduce((sum, c) => sum + 8 + c.data.length, 0);
  const result = Buffer.alloc(length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(length, 8);
  offset = 12;
  for (const chunk of chunks) {
    result.writeUInt32LE(chunk.data.length, offset); result.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(result, offset + 8); offset += 8 + chunk.data.length;
  }
  return { bytes: result, imageCount };
}

export async function preloadSceneryModels(map, options = {}) {
  const root = options.root || fileURLToPath(new URL('../public/models/', import.meta.url));
  const read = options.read || fs.readFile;
  // Tests may inject a parser to check failure ordering, but the integration gate
  // passes no overrides: GLTFLoader and the game's shared cache are used directly.
  let parse = options.parse;
  let register = options.register;
  if (!parse) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    parse = bytes => loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }
  if (!register) ({ registerModelAsset: register } = await import('../src/assets.js'));
  const names = sceneryModelNames(map), ready = [];
  let imageCount = 0;
  for (const name of names) {
    const filename = path.join(root, name + '.glb');
    let data;
    try { data = await read(filename); }
    catch (cause) { throw new Error('Scene gate is missing its local asset: ' + filename, { cause }); }
    const clean = geometryOnlyGlb(data);
    let asset;
    try { asset = await parse(clean.bytes); }
    catch (cause) { throw new Error('Scene gate could not parse ' + name + '.glb: ' + cause.message, { cause }); }
    if (!asset?.scene?.isObject3D || typeof asset.scene.traverse !== 'function')
      throw Error('GLTFLoader returned no scene for ' + name);
    let meshes = 0;
    asset.scene.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      const positions = object.geometry?.attributes?.position;
      if (!positions?.count) throw Error('Empty mesh in ' + name);
      for (let i = 0; i < positions.count; i++)
        if (![positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite))
          throw Error('Non-finite mesh position in ' + name);
    });
    if (!meshes) throw Error('No mesh parts in ' + name);
    imageCount += clean.imageCount;
    ready.push([name, asset]);
  }
  for (const [name, asset] of ready) register(name, asset);
  return { names, imageCount };
}
