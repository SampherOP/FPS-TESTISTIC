// Regression coverage for the two supplied armored rigs whose authored GLBs
// contain wrist bones but no individual finger bones.  Their added Grip* bones
// must share the source bind space of every original bone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import {MODEL_DEFS,loadCharacterAssets,createImportedCharacter,equipImportedWeapon,modelAssets} from '../client/models.js';
import {animateOperator} from '../client/animation.js';
import {preloadWeaponAssets} from './weapon-test-helpers.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({close(){}});
globalThis.__HAMU_MODEL_DATA={};
for(const [id,def] of Object.entries(MODEL_DEFS))globalThis.__HAMU_MODEL_DATA[id]=(await readFile(new URL('../'+def.file,import.meta.url))).toString('base64');
await loadCharacterAssets();
await preloadWeaponAssets();

const armored=['frontline','juggernaut'];
function meshList(root){const result=[];root.traverse(node=>{if(node.isMesh)result.push(node);});return result;}
function assertSameAttribute(source,prepared,label){
 assert.equal(Boolean(prepared),Boolean(source),`${label}: presence`);
 if(!source)return;
 assert.equal(prepared.itemSize,source.itemSize,`${label}: item size`);
 assert.equal(prepared.count,source.count,`${label}: count`);
 assert.equal(prepared.array.length,source.array.length,`${label}: array length`);
 for(let i=0;i<source.array.length;i++)assert.equal(prepared.array[i],source.array[i],`${label}: source value ${i}`);
}
function generatedSamples(model){
 const bySide={L:[],R:[]};
 model.userData.visual.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
  for(let vertex=0;vertex<indices.count;vertex++)for(let slot=0;slot<4;slot++){
   const bone=mesh.skeleton.bones[indices.getComponent(vertex,slot)];
   if(weights.getComponent(vertex,slot)>0&&bone?.name.startsWith('Grip')){
    bySide[bone.name.endsWith('L')?'L':'R'].push([mesh,vertex]);
    break;
   }
  }
 });
 return bySide;
}
function finiteVector(v,label){for(const value of v.toArray())assert.ok(Number.isFinite(value),`${label}: non-finite coordinate`);}
function assertMatrixNear(actual,expected,label){for(let i=0;i<16;i++)assert.ok(Math.abs(actual.elements[i]-expected.elements[i])<1e-10,`${label}: element ${i}`);}
function pose(model,options){for(let frame=0;frame<12;frame++)animateOperator(model,{dt:1/60,time:frame/60,...options});model.updateMatrixWorld(true);}

test('wrist-only armored rigs preserve every source surface and generated-hand vertex at bind',()=>{
 for(const id of armored){
  const asset=modelAssets().get(id),model=createImportedCharacter(id);
  asset.source.updateMatrixWorld(true);model.updateMatrixWorld(true);
  const sourceMeshes=meshList(asset.source),preparedMeshes=meshList(model.userData.visual);
  assert.equal(preparedMeshes.length,sourceMeshes.length,`${id}: no authored mesh deleted`);
  let generated=0,maxError=0;
  for(let meshIndex=0;meshIndex<sourceMeshes.length;meshIndex++){
   const source=sourceMeshes[meshIndex],prepared=preparedMeshes[meshIndex],label=`${id}/${source.name||meshIndex}`;
   assert.equal(prepared.material,source.material,`${label}: source material retained`);
   assert.deepEqual(Object.keys(prepared.geometry.attributes).sort(),Object.keys(source.geometry.attributes).sort(),`${label}: source attributes retained`);
   for(const name of Object.keys(source.geometry.attributes))if(name!=='skinIndex'&&name!=='skinWeight')assertSameAttribute(source.geometry.attributes[name],prepared.geometry.attributes[name],`${label}: source ${name} retained`);
   assertSameAttribute(source.geometry.index,prepared.geometry.index,`${label}: source index retained`);
   assert.deepEqual(prepared.geometry.groups,source.geometry.groups,`${label}: source material groups retained`);
   assert.deepEqual(prepared.bindMatrix.elements,source.bindMatrix.elements,`${label}: source bind matrix retained`);
   assertMatrixNear(prepared.bindMatrixInverse,prepared.matrixWorld.clone().invert(),`${label}: attached bind inverse follows mesh world`);
   if(!prepared.isSkinnedMesh)continue;
   const sourcePoint=new THREE.Vector3(),preparedPoint=new THREE.Vector3();
   const indices=prepared.geometry.attributes.skinIndex,weights=prepared.geometry.attributes.skinWeight;
   for(let vertex=0;vertex<indices.count;vertex++){
    let added=false;
    for(let slot=0;slot<4;slot++){
     const bone=prepared.skeleton.bones[indices.getComponent(vertex,slot)];
     if(weights.getComponent(vertex,slot)>0&&bone?.name.startsWith('Grip')){added=true;break;}
    }
    if(!added)continue;
    generated++;
    source.getVertexPosition(vertex,sourcePoint).applyMatrix4(source.matrixWorld).applyMatrix4(model.userData.normalization.matrix);
    prepared.getVertexPosition(vertex,preparedPoint).applyMatrix4(prepared.matrixWorld);
    finiteVector(sourcePoint,`${label}/${vertex}: source bind`);
    finiteVector(preparedPoint,`${label}/${vertex}: prepared bind`);
    maxError=Math.max(maxError,sourcePoint.distanceTo(preparedPoint));
   }
  }
  assert.ok(generated>7000,`${id}: generated hand skin vertices found`);
  assert.ok(maxError<1e-5,`${id}: generated hand bind displacement ${maxError}`);
 }
});

test('generated armored hand skin stays finite and attached through aim, reload, and run poses',()=>{
 const states=[{name:'aim',aiming:true},{name:'reload',aiming:true,reload:.5},{name:'run',aiming:true,speed:8,moveZ:1,pitch:1.1}];
 for(const id of armored){
  const model=createImportedCharacter(id);equipImportedWeapon(model,'relay9');const samples=generatedSamples(model);
  for(const [side,items] of Object.entries(samples))assert.ok(items.length>3600,`${id}/${side}: generated hand skin samples`);
  for(const state of states){
   pose(model,state);
   for(const [side,items] of Object.entries(samples)){
    const wrist=model.userData.arms[side==='L'?0:1].hand.getWorldPosition(new THREE.Vector3());
    const extent=new THREE.Box3(),point=new THREE.Vector3();let maxDistance=0;
    for(const [mesh,vertex] of items){
     mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);
     finiteVector(point,`${id}/${state.name}/${side}/${vertex}`);
     extent.expandByPoint(point);maxDistance=Math.max(maxDistance,point.distanceTo(wrist));
    }
    finiteVector(extent.min,`${id}/${state.name}/${side}: extent min`);
    finiteVector(extent.max,`${id}/${state.name}/${side}: extent max`);
    assert.ok(maxDistance<.13,`${id}/${state.name}/${side}: hand skin detached from wrist (${maxDistance})`);
   }
  }
 }
});
