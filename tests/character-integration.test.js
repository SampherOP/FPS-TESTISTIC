import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../vendor/three.module.js';
import {MODEL_DEFS,loadCharacterAssets,createImportedCharacter,equipImportedWeapon,modelAssets} from '../client/models.js';
import {animateOperator,animateWeapon} from '../client/animation.js';
import {createWeapon} from '../client/geometry.js';
import {WEAPONS} from '../shared/weapons.js';
import {preloadWeaponAssets} from './weapon-test-helpers.js';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({close(){}});
globalThis.__HAMU_MODEL_DATA={};for(const[id,d]of Object.entries(MODEL_DEFS))globalThis.__HAMU_MODEL_DATA[id]=(await readFile(new URL('../'+d.file,import.meta.url))).toString('base64');await loadCharacterAssets();
// Body/part assertions below must exercise the authored weapon GLBs.
await preloadWeaponAssets();
const wp=o=>o.getWorldPosition(new T.Vector3());
function pose(m,options,n=12){for(let i=0;i<n;i++)animateOperator(m,{dt:1/30,time:i/30,...options});m.updateMatrixWorld(true);}
function bounds(m){const b=new T.Box3(),v=new T.Vector3();m.userData.visual.traverse(o=>{if(!o.isSkinnedMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)b.expandByPoint(m.worldToLocal(o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld)).clone());});return b;}
test('all generated skin weights are finite, normalized and reference valid independent bones',()=>{
 for(const id of Object.keys(MODEL_DEFS)){const a=createImportedCharacter(id),b=createImportedCharacter(id);assert.notEqual(a.userData.arms[0].hand,b.userData.arms[0].hand);const original=b.userData.arms[0].hand.quaternion.clone();pose(a,{speed:8,aiming:true});assert.ok(b.userData.arms[0].hand.quaternion.equals(original));
 a.userData.visual.traverse(o=>{if(!o.isSkinnedMesh)return;const si=o.geometry.attributes.skinIndex,sw=o.geometry.attributes.skinWeight;for(let i=0;i<si.count;i++){let sum=0;for(let k=0;k<4;k++){const w=sw.array[i*4+k],ix=si.array[i*4+k];assert.ok(Number.isFinite(w)&&w>=0&&ix<o.skeleton.bones.length);sum+=w;}assert.ok(Math.abs(sum-1)<.0001);}});
 }
});
test('source materials, texture references, vertex counts and GLB appearance are preserved',()=>{
 for(const id of Object.keys(MODEL_DEFS)){const asset=modelAssets().get(id),m=createImportedCharacter(id);const original=[];asset.source.traverse(o=>{if(o.isMesh)original.push(o);});const loaded=[];m.userData.visual.traverse(o=>{if(o.isMesh)loaded.push(o);});assert.equal(loaded.length,original.length);for(let i=0;i<loaded.length;i++){assert.equal(loaded[i].material,original[i].material);assert.equal(loaded[i].geometry.attributes.position.count,original[i].geometry.attributes.position.count);}const b=bounds(m);assert.ok(Math.abs(b.max.y-b.min.y-1.9)<.055);}
});
test('game wrapper transforms never undo normalization, and grounded crouches bend knees without scale squashing',()=>{
 for(const id of Object.keys(MODEL_DEFS)){const m=createImportedCharacter(id);pose(m,{});const standing=bounds(m);m.position.set(14,3,-21);m.rotation.y=1.37;m.scale.set(1,1,1);pose(m,{crouch:1});const crouched=bounds(m);assert.deepEqual(m.position.toArray(),[14,3,-21]);assert.deepEqual(m.scale.toArray(),[1,1,1]);assert.ok(crouched.max.y<standing.max.y-.12,`${id}: crouch lowers head`);assert.ok(Math.abs(crouched.min.y)<.035,`${id}: sole contact ${crouched.min.y}`);assert.ok(m.userData.legs.some(l=>Math.abs(l.knee.rotation.x)>.2));}
});
test('all eleven weapons use palm contacts, two-bone IK, magazine handoff and extreme pitch without nonfinite bones',()=>{
 const failures=[];
 for(const id of Object.keys(MODEL_DEFS)){const m=createImportedCharacter(id);m.position.set(7,2,-11);m.rotation.y=.91;for(const weapon of Object.keys(WEAPONS)){equipImportedWeapon(m,weapon);for(const [pitch,reload]of [[0,0],[-1.15,0],[1.15,0],[0,.18],[0,.5],[0,.78],[0,.999]]){pose(m,{aiming:true,pitch,reload},14);for(const a of m.userData.arms){if(weapon==='edge'&&a.side<0)continue;const error=wp(a.hand).distanceTo(a.wristTarget),palmError=wp(a.hand).add(a.palmWorldOffset).distanceTo(a.palmTarget);if(error>=.035)failures.push(`${id}/${weapon}/${pitch}/${reload}/side${a.side}: wrist error ${error}`);if(palmError>=.035)failures.push(`${id}/${weapon}/${pitch}/${reload}/side${a.side}: palm error ${palmError}`);for(const q of a.hand.quaternion.toArray())if(!Number.isFinite(q))failures.push(`${id}/${weapon}/${pitch}/${reload}/side${a.side}: non-finite hand quaternion`);}if(!(m.userData.gun.scale.x>=.65&&m.userData.gun.scale.x<=.9))failures.push(`${id}/${weapon}: physical gun scale ${m.userData.gun.scale.x} outside .65-.9`);}}}
 assert.deepEqual(failures,[]);
});
test('idle, locomotion, ADS, shooting, crouch, ascent, fall and reload select actual skeletal states',()=>{
 for(const id of Object.keys(MODEL_DEFS)){const m=createImportedCharacter(id);for(const [expected,opts] of [['idle',{}],['walk',{speed:3}],['run',{speed:8}],['aim',{aiming:true}],['crouch',{crouch:1}],['jump',{grounded:false,airborne:true,verticalVelocity:4}],['fall',{grounded:false,airborne:true,verticalVelocity:-4}],['reload',{reload:.5}]]){pose(m,opts,30);assert.equal(m.userData.state,expected,id);}pose(m,{shot:1});const recoil=m.userData.recoil;pose(m,{});assert.ok(m.userData.recoil<recoil*.1);}
});
test('authored locomotion remains in-place after repeated complete clip loops',()=>{
 const m=createImportedCharacter('sentinel'),rest=m.userData.rest.get(m.userData.hips).position.clone();for(let i=0;i<400;i++)animateOperator(m,{dt:.05,time:i*.05,speed:8,aiming:true});const p=m.userData.hips.position;assert.ok(Math.abs(p.x-rest.x)<.00001);assert.ok(Math.abs(p.z-rest.z)<.00001);assert.deepEqual(m.position.toArray(),[0,0,0]);
});
test('first-person has only weapons and continuous skinned arms; grips follow magazine without bone stretching',()=>{
 for(const id of Object.keys(WEAPONS)){const gun=createWeapon(id,{hands:true}),rig=gun.userData.parts.viewRig.userData;assert.equal(rig.continuous,true);assert.ok(gun.userData.sightHeight>0);for(const arm of [rig.rearArm,rig.supportArm]){assert.ok(arm.mesh.isSkinnedMesh);assert.equal(arm.mesh.geometry.attributes.skinWeight.count,arm.mesh.geometry.attributes.position.count);}
 const lengths=[rig.rearArm,rig.supportArm].map(a=>a.bones.map(b=>b.position.length()));for(const reload of [0,.18,.5,.8,.999,0]){animateWeapon(gun,{reload});gun.updateMatrixWorld(true);for(const [i,a]of [rig.rearArm,rig.supportArm].entries()){for(let j=1;j<3;j++)assert.ok(Math.abs(a.bones[j].position.length()-lengths[i][j])<1e-6);assert.ok(wp(a.hand).distanceTo(a.gripTarget)<.035,`${id} FP grip`);}}}
});

test('static gloves expose independent finger chains and shotgun reload advances shells one at a time',()=>{
 for(const id of ['kestrel','circuit']){
  const m=createImportedCharacter(id);for(const arm of m.userData.arms){assert.equal(arm.fingers.length,5,`${id} five digit chains`);const nonThumb=arm.fingers.filter(f=>f.name!=='Thumb');assert.equal(new Set(nonThumb.map(f=>f.root)).size,4);}
 }
 const m=createImportedCharacter('sentinel');equipImportedWeapon(m,'breach12');const shells=m.userData.gun.userData.parts.reloadShells;assert.equal(shells.length,7);
 for(const r of [0,.13,.25,.37,.49,.61,.73,.85,.97]){animateOperator(m,{reload:r,aiming:true,dt:1/60});const visible=shells.filter(s=>s.visible);assert.ok(visible.length<=1,`single shell step at ${r}`);if(visible.length){assert.ok(m.userData.arms[0].palmTarget.distanceTo(visible[0].localToWorld(new T.Vector3(0,.045,0)))<.04);}}
});
