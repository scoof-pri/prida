// Export the game's own FPV model for inventory, held items and dropped loot.
import fs from 'node:fs';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { droneModel } from '../src/technology-models.js';

globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
  async readAsDataURL(blob) {
    this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64');
    this.onloadend?.();
  }
};
const root = droneModel();
root.traverse(object => { object.userData = {}; });
const data = await new GLTFExporter().parseAsync(root, { binary: true });
const target = new URL('../public/models/fpv.glb', import.meta.url);
fs.mkdirSync(new URL('../public/models/', import.meta.url), { recursive: true });
fs.writeFileSync(target, Buffer.from(data));
console.log('FPV inventory model:', data.byteLength, 'bytes');
