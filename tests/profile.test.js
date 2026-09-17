import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from '../server/profile.js';

test('server profile survives restart and sanitizes client-owned state', async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'hamu-profile-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const first=new ProfileStore({dataDir});
  await first.ready;
  const saved=await first.save('account-a',{version:1,loadout:['ar4','not-a-gun','edge'],operator:'sentinel',mode:'ffa',profile:{xp:4200,kills:9,deaths:2,wins:4,matches:7,time:99},history:Array.from({length:80},(_,i)=>({id:`m${i}`,mode:'ffa',kills:i,score:i,xp:i,result:'VICTORY',duration:60,online:true}))});
  assert.equal(saved.loadout.length,3);assert.notEqual(saved.loadout[1],'not-a-gun');assert.equal(saved.history.length,50);assert.equal(saved.profile.xp,4200);
  const raw=await readFile(join(dataDir,'profiles.json'),'utf8');assert.doesNotMatch(raw,/password|token|secret/i);
  const second=new ProfileStore({dataDir});await second.ready;const restored=await second.get('account-a');
  assert.equal(restored.profile.xp,4200);assert.equal(restored.mode,'ffa');assert.equal(restored.history.length,50);
  assert.equal(await second.get('other-account'),null);
});
