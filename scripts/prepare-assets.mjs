// Run from this checkout. Source archives are downloaded from the URLs in ASSET-CREDITS.md.
import fs from 'node:fs/promises';import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {dedup,prune,resample} from '@gltf-transform/functions';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const source=path.resolve(process.argv[2]||'../asset-source'),out=path.resolve('public/models'),io=new NodeIO().registerExtensions(ALL_EXTENSIONS);await fs.mkdir(out,{recursive:true});
async function save(doc,name){await doc.transform(resample(),dedup(),prune());await io.write(path.join(out,name+'.glb'),doc);}
// Buildings: see scripts/prepare-buildings.mjs (proportional fit, tiling, ground-floor cut).
for(const [from,to] of [['AK','rifle'],['Shotgun','shotgun'],['Pistol','pistol'],['SMG','smg'],['Sniper','sniper'],['RocketLauncher','rocket'],['Character_Soldier','soldier'],['Character_Hazmat','hazmat'],['Character_Enemy','scout']])await save(await io.read(path.join(source,'toon',from+'.gltf')),to);
for(const [from,to]of [['blaster-p','lmg'],['crate-wide','chest']])await save(await io.read(path.join(source,'blaster-kit','Models/GLB format',from+'.glb')),to);
const sizes=await Promise.all((await fs.readdir(out)).map(async n=>[n,(await fs.stat(path.join(out,n))).size]));console.log(sizes);console.log('Total',sizes.reduce((n,a)=>n+a[1],0));
