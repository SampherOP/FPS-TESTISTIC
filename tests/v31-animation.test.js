// V31 animation regressions intentionally use only the shipped game modules.
// Baseline equivalence is validated by a separate work script because the
// unchanged baseline tree is not available in a deployed game checkout.
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({close(){}});
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import {MODEL_DEFS,loadCharacterAssets,createImportedCharacter,equipImportedWeapon,animateImported,poseImportedHands} from '../client/models.js';
import {animateOperator} from '../client/animation.js';
import {WEAPONS} from '../shared/weapons.js';

const root=new URL('..',import.meta.url);
const embedded={};
for(const [id,def] of Object.entries(MODEL_DEFS))embedded[id]=(await readFile(new URL(def.file.replace('./',''),root))).toString('base64');
globalThis.__HAMU_MODEL_DATA=embedded;
await loadCharacterAssets();

function finiteObject(o,label){
  const p=o.getWorldPosition(new THREE.Vector3()),q=o.getWorldQuaternion(new THREE.Quaternion()),s=o.getWorldScale(new THREE.Vector3());
  for(const n of [...p.toArray(),...q.toArray(),...s.toArray()])assert.ok(Number.isFinite(n),`${label} non-finite transform`);
}
function step(model,options,n=5){for(let i=0;i<n;i++)animateOperator(model,{dt:1/60,time:i/60,...options});model.updateMatrixWorld(true);}

test('mixer basePose storage is stable and reused across animation frames',()=>{
 for(const id of Object.keys(MODEL_DEFS)){
  const model=createImportedCharacter(id),d=model.userData;
  if(d.mixer){
   const map=d.basePose,values=[...map.values()],positions=values.map(v=>v.position),quaternions=values.map(v=>v.quaternion);
   for(let i=0;i<80;i++)animateImported(model,{dt:1/60,time:i/60,speed:i%3?7:0,aiming:i%2===0,reload:i%11===0?.5:0,pitch:(i%5-2)*.4});
   assert.equal(d.basePose,map,`${id} basePose map identity`);
   assert.deepEqual([...map.keys()],d.bones,`${id} basePose bone keys`);
   for(const [i,v] of [...map.values()].entries()){assert.equal(v.position,positions[i],`${id} position storage reused`);assert.equal(v.quaternion,quaternions[i],`${id} quaternion storage reused`);}
  }
 }
});

test('all models and weapon categories stay finite through gameplay pose states on transformed roots',()=>{
 const states=[
  {name:'idle',options:{}},{name:'run',options:{speed:8,moveZ:1}},{name:'crouch',options:{crouch:1}},{name:'aim',options:{aiming:true}},{name:'pitch',options:{aiming:true,pitch:1.15}},{name:'reload',options:{aiming:true,reload:.5}}
 ];
 for(const id of Object.keys(MODEL_DEFS))for(const weapon of Object.keys(WEAPONS)){
  const model=createImportedCharacter(id);model.position.set(14,3,-21);model.rotation.y=1.37;equipImportedWeapon(model,weapon);
  for(const state of states){step(model,state.options,8);assert.deepEqual(model.position.toArray(),[14,3,-21],`${id}/${weapon}/${state.name} root position`);assert.deepEqual(model.scale.toArray(),[1,1,1],`${id}/${weapon}/${state.name} root scale`);
   finiteObject(model,`${id}/${weapon}/${state.name}`);finiteObject(model.userData.gun,`${id}/${weapon}/${state.name} weapon`);
   for(const arm of model.userData.arms){finiteObject(arm.hand,`${id}/${weapon}/${state.name} hand`);
    // One-handed melee retains the authored off-hand, not a blade contact.
    // Both limbs still require finite transforms; firearm/rear contact stays strict.
    if(WEAPONS[weapon].category!=='Melee'||arm.side>0)assert.ok(arm.hand.getWorldPosition(new THREE.Vector3()).distanceTo(arm.wristTarget)<.04,`${id}/${weapon}/${state.name} wrist target`);
   }
  }
 }
});

test('hand projection remains stable when called repeatedly after every supported weapon pose',()=>{
 for(const id of Object.keys(MODEL_DEFS)){
  const model=createImportedCharacter(id);model.position.set(-6,2,9);model.rotation.y=-.73;
  for(const weapon of Object.keys(WEAPONS)){equipImportedWeapon(model,weapon);for(const reload of [0,.18,.5,.78,.999]){
   animateOperator(model,{dt:1/60,aiming:true,pitch:-1.1,reload});
   const offHand=model.userData.arms.find(a=>a.side<0);
   const offChain=[offHand.upper,offHand.lower,offHand.hand];
   const before=offChain.map(b=>({position:b.position.toArray(),quaternion:b.quaternion.toArray()}));
   poseImportedHands(model,{reload});model.updateMatrixWorld(true);
   for(const arm of model.userData.arms){
    finiteObject(arm.hand,`${id}/${weapon}/${reload} hand`);
    if(WEAPONS[weapon].category==='Melee'&&arm.side<0){
     // Stronger melee requirement: repeated weapon IK must not drag or rotate
     // the independent off-arm into a synthetic support point on the blade.
     offChain.forEach((b,i)=>{assert.deepEqual(b.position.toArray(),before[i].position);assert.deepEqual(b.quaternion.toArray(),before[i].quaternion);});
    }else{const palm=arm.hand.getWorldPosition(new THREE.Vector3()).add(arm.palmWorldOffset||new THREE.Vector3());assert.ok(palm.distanceTo(arm.palmTarget)<.04,`${id}/${weapon}/${reload} palm target`);}
   }
  }}
 }
});
