// Converts CC0 Kenney decor (Furniture Kit, Car Kit, City Kit Roads) into scaled, self-contained GLBs and writes
// their exact footprints to src/decor-sizes.js so collision matches the rendered models.
// Usage: node scripts/prepare-decor.mjs /path/to/kenney-downloads
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { dedup, prune, weld, flatten } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const source = path.resolve(process.argv[2] || '../kenney-decor');
const out = path.resolve('public/models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const F = 'furniture-kit/Models/GLTF format',
  C = 'car-kit/Models/GLB format',
  R = 'city-kit-roads/Models/GLB format';
// [output name, source file, dimension to fit ('h' height or 'l' longest horizontal side), metres]
const LIST = [
  ['sofa', F + '/loungeSofa.glb', 'l', 2.1],
  ['armchair', F + '/loungeChair.glb', 'h', 0.85],
  ['coffee-table', F + '/tableCoffee.glb', 'l', 1.2],
  ['table', F + '/table.glb', 'l', 1.7],
  ['chair', F + '/chair.glb', 'h', 0.95],
  ['tv', F + '/televisionModern.glb', 'l', 1.25],
  ['tv-cabinet', F + '/cabinetTelevision.glb', 'l', 1.7],
  ['bookcase', F + '/bookcaseOpen.glb', 'h', 1.95],
  ['desk', F + '/desk.glb', 'l', 1.5],
  ['office-chair', F + '/chairDesk.glb', 'h', 1.1],
  ['monitor', F + '/computerScreen.glb', 'l', 0.6],
  ['fridge', F + '/kitchenFridge.glb', 'h', 1.85],
  ['stove', F + '/kitchenStove.glb', 'h', 0.92],
  ['bed', F + '/bedDouble.glb', 'l', 2.1],
  ['plant', F + '/pottedPlant.glb', 'h', 1.0],
  ['floor-lamp', F + '/lampRoundFloor.glb', 'h', 1.65],
  ['trashcan', F + '/trashcan.glb', 'h', 0.8],
  ['rug', F + '/rugRectangle.glb', 'l', 2.4],
  ['box', F + '/cardboardBoxClosed.glb', 'h', 0.6],
  // 0.10 interiors
  ['bed-single', F + '/bedSingle.glb', 'l', 2.0],
  ['bunk', F + '/bedBunk.glb', 'h', 1.75],
  ['bathtub', F + '/bathtub.glb', 'l', 1.7],
  ['toilet', F + '/toilet.glb', 'h', 0.8],
  ['sink', F + '/bathroomSink.glb', 'h', 0.9],
  ['shower', F + '/shower.glb', 'h', 2.1],
  ['kitchen-cabinet', F + '/kitchenCabinet.glb', 'h', 0.92],
  ['kitchen-sink', F + '/kitchenSink.glb', 'h', 0.92],
  ['microwave', F + '/kitchenMicrowave.glb', 'l', 0.5],
  ['coffee-machine', F + '/kitchenCoffeeMachine.glb', 'h', 0.38],
  ['washer', F + '/washer.glb', 'h', 0.88],
  ['table-round', F + '/tableRound.glb', 'h', 0.76],
  ['table-cloth', F + '/tableCrossCloth.glb', 'l', 1.7],
  ['stool', F + '/stoolBar.glb', 'h', 0.78],
  ['bar', F + '/kitchenBar.glb', 'l', 1.2],
  ['bench', F + '/benchCushionLow.glb', 'l', 1.6],
  ['bookcase-wide', F + '/bookcaseClosedWide.glb', 'h', 1.95],
  ['bookcase-low', F + '/bookcaseOpenLow.glb', 'h', 1.0],
  ['laptop', F + '/laptop.glb', 'l', 0.4],
  ['side-table', F + '/sideTableDrawers.glb', 'h', 0.55],
  ['sofa-long', F + '/loungeDesignSofa.glb', 'l', 2.2],
  ['lounge-chair', F + '/loungeDesignChair.glb', 'h', 0.85],
  ['tv-vintage', F + '/televisionVintage.glb', 'h', 0.62],
  ['lamp-table', F + '/lampSquareTable.glb', 'h', 0.5],
  ['box-open', F + '/cardboardBoxOpen.glb', 'h', 0.5],
  ['coat-rack', F + '/coatRackStanding.glb', 'h', 1.8],
  ['speaker', F + '/speaker.glb', 'h', 1.0],
  ['radio', F + '/radio.glb', 'l', 0.4],
  ['sedan', C + '/sedan.glb', 'l', 3.9],
  ['taxi', C + '/taxi.glb', 'l', 3.9],
  ['police', C + '/police.glb', 'l', 4.1],
  ['van', C + '/van.glb', 'l', 4.3],
  ['suv', C + '/suv.glb', 'l', 4.2],
  ['hatchback', C + '/hatchback-sports.glb', 'l', 3.8],
  ['delivery', C + '/delivery.glb', 'l', 5.0],
  ['street-lamp', R + '/light-square.glb', 'h', 5.6],
  ['street-lamp-curved', R + '/light-curved.glb', 'h', 5.8],
  ['traffic-light', R + '/traffic-light.glb', 'h', 3.8],
  ['power-pole', R + '/electricity-pole-single.glb', 'h', 7],
  ['dumpster', R + '/dumpster.glb', 'l', 2.0],
  ['cone', R + '/construction-cone.glb', 'h', 0.7],
  ['barrier', R + '/construction-barrier.glb', 'l', 1.6],
  ['stop-sign', R + '/road-sign-stop.glb', 'h', 2.6],
];
const sizes = {};
let total = 0;
for (const [name, file, mode, metres] of LIST) {
  const doc = await io.read(path.join(source, file)),
    scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  await doc.transform(flatten());
  const b = getBounds(scene),
    size = [0, 1, 2].map((k) => b.max[k] - b.min[k]),
    s = metres / (mode === 'h' ? size[1] : Math.max(size[0], size[2]));
  // Wrap every root under one node that scales to metres and puts the footprint centre at the origin, base on y = 0.
  const wrap = doc.createNode(name).setScale([s, s, s]);
  wrap.setTranslation([(-(b.min[0] + b.max[0]) / 2) * s, -b.min[1] * s, (-(b.min[2] + b.max[2]) / 2) * s]);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    wrap.addChild(n);
  }
  scene.addChild(wrap);
  await doc.transform(weld(), dedup(), prune());
  const file_ = path.join(out, 'decor-' + name + '.glb');
  await io.write(file_, doc);
  const bytes = (await fs.stat(file_)).size;
  total += bytes;
  sizes[name] = size.map((v) => +(v * s).toFixed(3));
  console.log(name.padEnd(20), sizes[name].join(' × '), (bytes / 1024).toFixed(0) + ' KB');
}
await fs.writeFile(
  'src/decor-sizes.js',
  '// Generated by scripts/prepare-decor.mjs: [width (x), height (y), depth (z)] in metres, footprint centred.\n' +
    'export const DECOR_SIZES = ' +
    JSON.stringify(sizes, null, 1) +
    ';\n',
);
console.log('total', (total / 1024 / 1024).toFixed(2), 'MB');
