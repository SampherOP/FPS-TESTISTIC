// Shared Node helpers for tests that exercise the authored weapon GLBs. The
// browser provides these globals; GLTFLoader only needs a decode stub here
// because the regressions inspect geometry, materials, and transforms.
globalThis.self=globalThis;
globalThis.createImageBitmap=globalThis.createImageBitmap||(async()=>({close(){}}));

import {readFile} from 'node:fs/promises';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {MODEL_DEFS,loadCharacterAssets} from '../client/models.js';
import {loadWeaponAssets,weaponAssetCache} from '../client/weapon-models.js';

const root=new URL('..',import.meta.url),loader=new GLTFLoader(),buffers=new Map();
export async function readWeaponGltf(key){
  let bytes=buffers.get(key);
  if(!bytes){
    const file=await readFile(new URL(`../assets/models/weapons/${key}.glb`,import.meta.url));
    bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength);
    buffers.set(key,bytes);
  }
  return loader.parseAsync(bytes.slice(0),new URL(`../assets/models/weapons/${key}.glb`,import.meta.url).href);
}
export function installWeaponLoader(){weaponAssetCache.loader=readWeaponGltf;return weaponAssetCache;}
export async function preloadWeaponAssets(){installWeaponLoader();return loadWeaponAssets();}
export async function preloadCharacterAssets(){
  const embedded={};
  for(const [id,def] of Object.entries(MODEL_DEFS))embedded[id]=(await readFile(new URL(def.file.replace('./',''),root))).toString('base64');
  globalThis.__HAMU_MODEL_DATA=embedded;
  return loadCharacterAssets();
}
