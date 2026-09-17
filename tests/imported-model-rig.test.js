// Browser GLTFLoader uses createImageBitmap for embedded image textures. This minimal
// Node shim lets the loader parse the actual supplied GLBs without decoding pixels.
globalThis.self=globalThis;
globalThis.createImageBitmap=globalThis.createImageBitmap|| (async()=>({close(){}}));
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import {loadCharacterAssets,createImportedCharacter,MODEL_DEFS} from '../client/models.js';
import {animateOperator} from '../client/animation.js';

const root=new URL('..',import.meta.url);
const embedded={};for(const [id,def] of Object.entries(MODEL_DEFS))embedded[id]=(await readFile(new URL(def.file.replace('./',''),root))).toString('base64');
globalThis.__HAMU_MODEL_DATA=embedded;
await loadCharacterAssets();
const worldPosition=o=>o.getWorldPosition(new THREE.Vector3());
// A grip touches the palm, not the wrist joint. The original WIP assertion
// compared the wrong anatomical point; now require tighter real palm contact.
const palm=arm=>worldPosition(arm.hand).add(arm.palmWorldOffset||new THREE.Vector3());
const grip=(model,p)=>model.userData.gun.localToWorld(p.clone());

test('actual GLBs normalize into identity game wrappers with continuous skinned static meshes',()=>{
 for(const id of Object.keys(MODEL_DEFS)){
  const model=createImportedCharacter(id);model.updateMatrixWorld(true);
  assert.deepEqual(model.position.toArray(),[0,0,0],`${id} outer position`);assert.deepEqual(model.scale.toArray(),[1,1,1],`${id} outer scale`);
  const b=new THREE.Box3().setFromObject(model.userData.visual),size=b.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.y-1.9)<.055,`${id} normal height`);assert.ok(Math.abs(b.min.y)<.025,`${id} grounded`);
  if(id!=='sentinel'){
   const meshes=[];model.userData.visual.traverse(x=>x.isSkinnedMesh&&meshes.push(x));assert.ok(meshes.length>0,`${id} has real skinned primitives`);
   for(const mesh of meshes){const ix=mesh.geometry.getAttribute('skinIndex'),w=mesh.geometry.getAttribute('skinWeight');assert.ok(ix&&w&&ix.count===w.count);for(let n=0;n<Math.min(40,w.count);n++){const sum=w.getX(n)+w.getY(n)+w.getZ(n)+w.getW(n);assert.ok(sum>.99&&sum<1.01,`${id} normalized weights`);}}
  }
 }
});

test('static auto rigs deform limbs and all three hand endpoints reach their real gun grips',()=>{
 for(const id of Object.keys(MODEL_DEFS)){
  const model=createImportedCharacter(id);animateOperator(model,{dt:.12,speed:5,grounded:true,aiming:true,reload:0,time:1});model.updateMatrixWorld(true);
  const d=model.userData;
  if(d.importedKind==='static'){
   assert.ok(d.arms.some(a=>Math.abs(a.upper.rotation.x)+Math.abs(a.upper.rotation.y)+Math.abs(a.upper.rotation.z)>.05),`${id} arm IK rotates skin bones`);
   // At least one auto-weighted arm vertex gets a changed bone-space transform in walk.
   let changed=false;d.visual.traverse(mesh=>{if(!mesh.isSkinnedMesh||changed)return;mesh.skeleton.update();const p=mesh.geometry.getAttribute('position'),si=mesh.geometry.getAttribute('skinIndex');for(let i=0;i<p.count;i++){let arm=false;for(let k=0;k<4;k++)if([6,7,8,10,11,12].includes(si.array[i*4+k]))arm=true;if(!arm)continue;const before=new THREE.Vector3().fromBufferAttribute(p,i),after=mesh.applyBoneTransform(i,before.clone());if(after.distanceTo(before)>.002){changed=true;break;}}});assert.ok(changed,`${id} weighted arm vertices change`);
   for(const arm of d.arms){const desired=arm.side<0?grip(model,d.gun.userData.grips.support):grip(model,d.gun.userData.grips.rear);assert.ok(palm(arm).distanceTo(desired)<.015,`${id} hand on grip`);}
  }else{
   const a=d.armRig;assert.ok(palm(a.left).distanceTo(grip(model,d.gun.userData.grips.support))<.015,'SWAT support hand on grip');assert.ok(palm(a.right).distanceTo(grip(model,d.gun.userData.grips.rear))<.015,'SWAT rear hand on grip');
  }
 }
});

test('SWAT clones have independent authored skeleton state and repeated posing creates no geometry',()=>{
 const a=createImportedCharacter('sentinel'),b=createImportedCharacter('sentinel'),before=[];a.traverse(x=>x.isMesh&&before.push(x.geometry));
 animateOperator(a,{dt:.2,speed:6,aiming:true,time:2});a.updateMatrixWorld(true);b.updateMatrixWorld(true);
 assert.notEqual(a.userData.source,b.userData.source);assert.notDeepEqual(worldPosition(a.userData.armRig.right.hand).toArray(),worldPosition(b.userData.armRig.right.hand).toArray());
 for(let i=0;i<80;i++)animateOperator(a,{dt:.016,speed:i%2?5:0,reload:i%20/20,aiming:true,time:i*.016});const after=[];a.traverse(x=>x.isMesh&&after.push(x.geometry));assert.equal(after.length,before.length);
});
