import test from 'node:test';
import assert from 'node:assert/strict';
import {weaponViewPose} from '../client/weapon-view.js';
import {weaponMetadata} from '../client/weapon-models.js';
import {WEAPONS} from '../shared/weapons.js';

test('settled ADS places every firearm authored sight point on the camera centre after weapon scaling',()=>{
 const scale=.82;
 for(const [id,weapon] of Object.entries(WEAPONS)){
  if(weapon.category==='Melee')continue;
  const metadata=weaponMetadata(id),pose=weaponViewPose({weapon,metadata,scale,ads:1,baseFov:80});
  // The view position is the negative of the scaled authored sight offset.
  assert.ok(Math.abs(pose.position[0]+metadata.sightX*scale)<1e-12,`${id}: sight X not centred`);
  assert.ok(Math.abs(pose.position[1]+metadata.sightHeight*scale)<1e-12,`${id}: sight Y not centred`);
  assert.equal(pose.worldFov,weapon.adsFov,`${id}: settled FOV`);
 }
});

test('catalog ADS FOV references include the two authored sniper values',()=>{
 assert.equal(WEAPONS.lancer7.adsFov,28,'lancer7 sniper ADS FOV');
 assert.equal(WEAPONS.snipeRil.adsFov,32,'snipeRil ADS FOV');
});

test('knife view pose has no ADS, zoom, scope, or reload state',()=>{
 const weapon=WEAPONS.edge,metadata=weaponMetadata('edge'),base={weapon,metadata,scale:.82,baseFov:80};
 const hip=weaponViewPose(base),aimed=weaponViewPose({...base,ads:1}),reloading=weaponViewPose({...base,reload:.5});
 assert.deepEqual(aimed.position,hip.position,'knife ADS must not sight-centre the blade');
 assert.deepEqual(aimed.rotation,hip.rotation,'knife ADS must not apply an aiming pose');
 assert.deepEqual(reloading.position,hip.position,'knife must not animate a firearm reload');
 assert.deepEqual(reloading.rotation,hip.rotation,'knife must not animate a firearm reload');
 for(const pose of [hip,aimed,reloading]){
  assert.equal(pose.worldFov,80,'knife must not zoom the world camera');
  assert.equal(pose.scoped,false,'knife is not scoped');
 }
});
