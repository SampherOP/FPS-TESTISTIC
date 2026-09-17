// Regression for the two source GLBs whose authored front axes were reversed.
// Source-space points are measured barrel-cap centres, not inferred AABB fronts:
// an AABB alone cannot distinguish a stock from a muzzle.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {WEAPON_MODEL_DEFS,prepareWeaponAsset,instantiateWeaponAsset} from '../client/weapon-models.js';
import {readWeaponGltf} from './weapon-test-helpers.js';

const fixtures=[
 {key:'assault',id:'ar4',muzzle:[.004196,.063281,1.938050],stock:[.004196,.063281,-2.084799],axis:[0,0,1]},
 {key:'bullp',id:'hxr8',muzzle:[2.719206,.813952,0],stock:[-2.528853,.813952,0],axis:[1,0,0]}
];
for(const f of fixtures){
 test(`${f.id}: actual source muzzle points forward, not the stock, in the shared prepared model`,async()=>{
  const d=WEAPON_MODEL_DEFS[f.key],q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...d.rotation));
  const axis=new THREE.Vector3(...f.axis).applyQuaternion(q);
  assert.ok(axis.z<-.999999,`${f.id}: authored barrel points toward camera/player`);
  const transform=new THREE.Matrix4().compose(new THREE.Vector3(...d.position),q,new THREE.Vector3().setScalar(d.scale));
  const muzzle=new THREE.Vector3(...f.muzzle).applyMatrix4(transform),stock=new THREE.Vector3(...f.stock).applyMatrix4(transform);
  assert.ok(muzzle.z<stock.z-.8,`${f.id}: stock lies in front of muzzle`);
  assert.ok(muzzle.distanceTo(new THREE.Vector3(...d.muzzle))<.00001,`${f.id}: muzzle metadata misses actual cap`);
  const asset=prepareWeaponAsset(f.key,await readWeaponGltf(f.key));
  // First-person and third-person mounts consume independent clones of this same asset.
  for(const instance of [instantiateWeaponAsset(asset,f.id),instantiateWeaponAsset(asset,f.id)]){
   const box=new THREE.Box3().setFromObject(instance.root);
   assert.ok(Math.abs(box.min.z-muzzle.z)<.001,`${f.id}: actual barrel not at visual front`);
   assert.ok(instance.metadata.grips.support.z<instance.metadata.grips.rear.z,`${f.id}: support hand behind firing hand`);
   assert.ok(instance.metadata.grips.rear.z>muzzle.z&&instance.metadata.grips.support.z>muzzle.z,`${f.id}: hands past muzzle`);
   assert.ok(instance.metadata.grips.rear.z<stock.z&&instance.metadata.grips.support.z<stock.z,`${f.id}: hands past stock`);
  }
 });
}
