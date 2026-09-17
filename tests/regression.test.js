import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/simulation.js';
import { canStand } from '../shared/physics.js';

test('standing clearance includes suspended ceilings',()=>{
  const ceiling={minX:-2,maxX:2,minZ:-2,maxZ:2,minY:1.3,maxY:2};
  assert.equal(canStand({x:0,z:0,y:0,height:1.08},1.78,[ceiling]),false);
  assert.equal(canStand({x:0,z:0,y:0,height:1.08},1.08,[ceiling]),true);
});

test('a departed grenade owner cannot cause friendly fire',()=>{
  const world=new World({mode:'tdm',seed:42});
  const owner=world.addPlayer({id:'owner',team:0});
  world.addPlayer({id:'enemy',team:1});
  const friend=world.addPlayer({id:'friend',team:0});
  Object.assign(friend,{x:0,z:27,y:0,protectUntil:0});
  const grenade=world.grenades[0];
  Object.assign(grenade,{active:true,owner:owner.id,team:owner.team,x:0,y:.5,z:27,vx:0,vy:0,vz:0,fuse:0});
  world.removePlayer(owner.id);world.updateGrenades(1/60);
  assert.equal(friend.hp,100);assert.equal(friend.armor,50);
});

test('departed source attribution does not access a missing inventory',()=>{
  const world=new World({mode:'tdm',seed:42});
  const target=world.addPlayer({id:'target',team:1});
  Object.assign(target,{protectUntil:0,hp:20,armor:0});
  assert.doesNotThrow(()=>world.damage(target,{id:'gone',team:0,name:'Departed operator',x:0,z:0},100,false,'FRAG'));
  assert.equal(target.alive,false);
});
