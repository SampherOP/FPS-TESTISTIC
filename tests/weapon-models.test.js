// Weapon visual regression coverage parses the actual shipped GLBs. Embedded
// texture decode is irrelevant to geometry/rig preparation in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {WEAPON_MODEL_DEFS,WEAPON_MODEL_MAP,WeaponAssetCache,weaponAssetCache,loadWeaponAssets,instantiateWeaponAsset} from '../client/weapon-models.js';
import {createWeapon,disposeVisual} from '../client/geometry.js';
import {animateOperator,animateWeapon} from '../client/animation.js';
import {MODEL_DEFS,createImportedCharacter,equipImportedWeapon} from '../client/models.js';
import {WEAPONS} from '../shared/weapons.js';
import {installWeaponLoader,preloadCharacterAssets,readWeaponGltf} from './weapon-test-helpers.js';

installWeaponLoader();

function meshTriangles(root){let count=0;root.traverse(node=>{if(node.isMesh)count+=(node.geometry.index?.count||node.geometry.getAttribute('position').count)/3;});return count;}
function meshes(root){const result=[];root.traverse(object=>{if(object.isMesh)result.push(object);});return result;}
function finiteNumbers(values,label){for(const value of values)assert.ok(Number.isFinite(value),`${label}: non-finite ${value}`);}
function finiteBox(box,label){assert.ok(!box.isEmpty(),`${label}: empty`);finiteNumbers([...box.min.toArray(),...box.max.toArray()],label);}
function world(o){return o.getWorldPosition(new THREE.Vector3());}
function palm(arm){return world(arm.hand).add(arm.palmWorldOffset||new THREE.Vector3());}
function approx(actual,expected,label,epsilon=1e-6){assert.ok(Math.abs(actual-expected)<=epsilon,`${label}: ${actual} !== ${expected}`);}

// Exercise metadata-only loading before warming the singleton cache. The
// loader promise is allowed to start before any later test-only failure hook.
const pending=createWeapon('ar4',{hands:true}),pendingChildCount=pending.children.length;
await new Promise(resolve=>setImmediate(resolve));
disposeVisual(pending);
await loadWeaponAssets();
await preloadCharacterAssets();
// Failure is tested after the real cache is warm, so no supplied GLB request
// can be poisoned by the synthetic loader.
weaponAssetCache.entries.delete('pistol');
weaponAssetCache.loader=()=>Promise.reject(new Error('synthetic GLB failure'));
const failed=createWeapon('relay9',{hands:true});
await weaponAssetCache.load('pistol').catch(()=>{});
await new Promise(resolve=>setImmediate(resolve));
const failureStatus=failed.userData.visualStatus,failureChildren=failed.children.map(child=>child.name);
weaponAssetCache.entries.delete('pistol');
installWeaponLoader();
await weaponAssetCache.load('pistol');

const expectedMap={ar4:'assault',hxr8:'bullp',mag83:'mag-83',volt9:'mp5',pincer:'submachine',breach12:'shotgun',lancer7:'sniper',snipeRil:'snipe-ril',relay9:'pistol',flick45:'rigg-glock',edge:'knife'};

test('all eleven catalog IDs map exactly to a supplied prepared GLB',()=>{
 assert.deepEqual(WEAPON_MODEL_MAP,expectedMap);
 assert.deepEqual(Object.keys(WEAPON_MODEL_DEFS).sort(),Object.values(WEAPON_MODEL_MAP).sort());
 for(const [id,key] of Object.entries(WEAPON_MODEL_MAP)){const asset=weaponAssetCache.get(key);assert.ok(asset,`${id}: asset loaded`);assert.equal(asset.clips,0,`${id}: supplied static asset has no clips`);}
});

test('preparation preserves every source triangle/material surface at bind and exposes finite aiming metadata',async()=>{
 for(const [id,key] of Object.entries(WEAPON_MODEL_MAP)){
  const source=await readWeaponGltf(key),asset=weaponAssetCache.get(key),instance=instantiateWeaponAsset(asset,id);
  assert.equal(meshTriangles(instance.root),meshTriangles(source.scene),`${key}: exact triangle count`);
  finiteBox(asset.sourceBounds,`${key}: source`);finiteBox(asset.bounds,`${key}: prepared`);finiteBox(new THREE.Box3().setFromObject(instance.root),`${key}: instance`);
  const m=instance.metadata;for(const value of [...m.muzzle.toArray(),...m.grips.rear.toArray(),...m.grips.support.toArray(),m.sightHeight,m.sightX])assert.ok(Number.isFinite(value),`${key}: aiming metadata`);
  const box=new THREE.Box3().setFromObject(instance.root);assert.ok(m.muzzle.z<=box.min.z+.075,`${key}: muzzle lies at -Z front`);
 }
});

test('real authored/disconnected parts are isolated and Assault exposes its magazine rather than a bolt',()=>{
 const expected={assault:['mag'],bullp:['mag'],'mag-83':['mag'],mp5:['mag','bolt','trigger'],submachine:['mag'],shotgun:['pump'],sniper:['mag','bolt','trigger'],'snipe-ril':[],pistol:['mag','slide'],'rigg-glock':['mag','slide','trigger'],knife:[]};
 for(const [key,parts] of Object.entries(expected)){
  const asset=weaponAssetCache.get(key),a=instantiateWeaponAsset(asset,'a'),b=instantiateWeaponAsset(asset,'b');assert.deepEqual(Object.keys(a.metadata.parts).sort(),parts.slice().sort(),`${key}: valid real parts only`);
  for(const name of parts){assert.notEqual(a.metadata.parts[name],b.metadata.parts[name],`${key}/${name}: own group`);const before=b.metadata.parts[name].position.clone();a.metadata.parts[name].position.z+=.05;assert.deepEqual(b.metadata.parts[name].position.toArray(),before.toArray(),`${key}/${name}: isolated pose`);}
  if(key==='assault')assert.equal(a.metadata.parts.bolt,undefined,'Assault has no fabricated bolt');
  if(key==='rigg-glock'){let meshesSeen=0;a.root.traverse(node=>{if(node.isMesh)meshesSeen++;});assert.ok(meshesSeen>=6,'Glock keeps material surfaces from both authored skins');}
 }
});

test('shared prepared GPU resources survive disposal of every instance',()=>{
 for(const key of Object.keys(WEAPON_MODEL_DEFS)){
  const asset=weaponAssetCache.get(key),a=instantiateWeaponAsset(asset,`${key}-a`),b=instantiateWeaponAsset(asset,`${key}-b`),geometry=meshes(a.root)[0]?.geometry;
  assert.ok(geometry,`${key}: prepared geometry`);assert.equal(geometry.userData.weaponShared,true,`${key}: shared ownership marker`);
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  disposeVisual(a.root);disposeVisual(b.root);
  assert.equal(disposed,0,`${key}: instance disposal destroyed shared geometry`);
  const c=instantiateWeaponAsset(asset,`${key}-c`);assert.equal(meshes(c.root)[0].geometry,geometry,`${key}: cache asset remains reusable`);
 }
});

test('pending metadata/view arms have no legacy body, cancellation prevents install, and failure is visible without fallback',()=>{
 assert.equal(pending.userData.visualDisposed,true);assert.equal(pending.children.length,pendingChildCount,'disposed pending instance kept only its view rig');
 assert.equal(pending.userData.visualStatus,'loading');assert.equal(pending.getObjectByName('WeaponBody'),undefined);assert.equal(pending.getObjectByName('ImportedWeapon:assault'),undefined);
 assert.ok(pending.getObjectByName('RearArm')&&pending.getObjectByName('SupportArm'),'pending hands remain available');
 assert.equal(failureStatus,'error');assert.deepEqual(failureChildren,['ViewHands'],'failed weapon retained metadata/view hands only');assert.equal(failed.getObjectByName('WeaponBody'),undefined);
});

test('cache deduplicates in-flight requests, cancels subscribers, and retries latched failures explicitly',async()=>{
 const source=await readWeaponGltf('mp5');let calls=0,resolveLoad;
 const slow=new WeaponAssetCache(()=>{calls++;return new Promise(resolve=>{resolveLoad=()=>resolve(source);});});
 let installed=0;const cancel=slow.subscribe('mp5',()=>installed++);const same=slow.load('mp5');cancel();await new Promise(resolve=>setImmediate(resolve));resolveLoad();await same;assert.equal(calls,1);assert.equal(installed,0,'cancelled subscriber was not installed');
 let attempt=0;const flaky=new WeaponAssetCache(()=>{attempt++;return attempt===1?Promise.reject(new Error('synthetic weapon failure')):Promise.resolve(source);});
 let errors=0;const unsubscribe=flaky.subscribe('sniper',()=>assert.fail('failed asset installed'),()=>errors++);await assert.rejects(flaky.load('sniper'),/synthetic weapon failure/);unsubscribe();assert.equal(attempt,1);assert.equal(errors,1);
 const retried=await flaky.retry('sniper');assert.equal(retried.key,'sniper');assert.equal(attempt,2);assert.equal(flaky.get('sniper'),retried);
});

test('all five operators and all eleven loaded weapons keep grip IK finite through aim, movement, and reload',()=>{
 const failures=[];
 for(const operator of Object.keys(MODEL_DEFS))for(const id of Object.keys(WEAPONS)){
  const model=createImportedCharacter(operator);model.position.set(7,2,-11);model.rotation.y=.91;equipImportedWeapon(model,id);
  for(const [stateIndex,state] of [{speed:0,aiming:true,pitch:-1.1,reload:0},{speed:8,moveZ:1,aiming:true,pitch:1.1,reload:0},{speed:4,crouch:1,aiming:true,reload:.18},{speed:0,airborne:true,grounded:false,verticalVelocity:-3,aiming:true,reload:.5},{speed:6,aiming:true,reload:.78},{speed:0,aiming:true,reload:.999}].entries()){
   for(let frame=0;frame<8;frame++)animateOperator(model,{dt:1/60,time:frame/60,...state});model.updateMatrixWorld(true);
   for(const value of [...model.position.toArray(),...model.scale.toArray()])if(!Number.isFinite(value))failures.push(`${operator}/${id}/state${stateIndex}: non-finite root ${value}`);
   for(const arm of model.userData.arms){for(const value of [...world(arm.hand).toArray(),...arm.hand.quaternion.toArray()])if(!Number.isFinite(value))failures.push(`${operator}/${id}/state${stateIndex}/side${arm.side}: non-finite hand ${value}`);if(id==='edge'&&arm.side<0)continue;const error=palm(arm).distanceTo(arm.palmTarget);if(error>=.055)failures.push(`${operator}/${id}/state${stateIndex}/side${arm.side}: palm IK ${error}`);}
  }
 }
 assert.deepEqual(failures,[]);
});

test('first-person loaded weapon arms stay continuous, preserve bone lengths, and reach every grip',()=>{
 for(const id of Object.keys(WEAPONS)){
  const gun=createWeapon(id,{hands:true}),view=gun.userData.parts.viewRig?.userData;assert.ok(view,`${id}: first-person view rig`);
  const arms=[view.rearArm,view.supportArm];for(const arm of arms){assert.ok(arm.mesh.isSkinnedMesh,`${id}: skinned arm`);assert.equal(arm.mesh.geometry.attributes.skinWeight.count,arm.mesh.geometry.attributes.position.count);}
  const lengths=arms.map(arm=>arm.bones.slice(1).map(b=>b.position.length()));
  for(const reload of [0,.18,.5,.78,.999,0]){animateWeapon(gun,{reload,shotAge:.026});gun.updateMatrixWorld(true);for(const [index,arm] of arms.entries()){
   for(let i=0;i<arm.bones.slice(1).length;i++)assert.ok(Math.abs(arm.bones.slice(1)[i].position.length()-lengths[index][i])<1e-6,`${id}: arm bone ${i} stretched`);
   assert.ok(world(arm.hand).distanceTo(arm.gripTarget)<.055,`${id}: wrist grip`);
  }}
 }
});

test('shot mechanisms use per-GLB movement metadata, reset cleanly, and never alter body triangle counts',()=>{
 const bodyTriangles=new Map();for(const id of Object.keys(WEAPONS)){const gun=createWeapon(id),key=WEAPON_MODEL_MAP[id];bodyTriangles.set(id,meshTriangles(gun));}
 const reloadMag=createWeapon('ar4'),mag=reloadMag.userData.parts.mag,magBase=mag.position.clone();animateWeapon(reloadMag,{reload:.5});assert.ok(mag.position.distanceTo(magBase)>0.01,'Assault magazine moves during reload');animateWeapon(reloadMag,{reload:0});assert.deepEqual(mag.position.toArray(),magBase.toArray(),'Assault magazine resets');
 for(const id of ['relay9','flick45']){const gun=createWeapon(id),slide=gun.userData.parts.slide,base=slide.position.clone(),stroke=gun.userData.movement.slideStroke;animateWeapon(gun,{shotAge:.026});approx(slide.position.z,base.z+stroke,`${id}: shot slide stroke`);animateWeapon(gun,{shotAge:0});assert.deepEqual(slide.position.toArray(),base.toArray(),`${id}: slide reset`);}
 const shotgun=createWeapon('breach12'),pump=shotgun.userData.parts.pump,pumpBase=pump.position.clone();animateWeapon(shotgun,{shotAge:0});assert.deepEqual(pump.position.toArray(),pumpBase.toArray(),'shotgun pump waits at shot start');animateWeapon(shotgun,{shotAge:.23});approx(pump.position.z,pumpBase.z+shotgun.userData.movement.pumpStroke,'shotgun delayed pump');animateWeapon(shotgun,{shotAge:0});assert.deepEqual(pump.position.toArray(),pumpBase.toArray(),'shotgun pump reset');
 const sniper=createWeapon('lancer7'),bolt=sniper.userData.parts.bolt,boltBase=bolt.position.clone();animateWeapon(sniper,{shotAge:.23});approx(bolt.position.z,boltBase.z+sniper.userData.movement.boltStroke,'sniper bolt stroke');animateWeapon(sniper,{shotAge:0});assert.deepEqual(bolt.position.toArray(),boltBase.toArray(),'sniper bolt reset');
 for(const id of Object.keys(WEAPONS)){const gun=createWeapon(id);animateWeapon(gun,{reload:.5,shotAge:.23});assert.equal(meshTriangles(gun),bodyTriangles.get(id),`${id}: animation changed body triangle count`);}
});
