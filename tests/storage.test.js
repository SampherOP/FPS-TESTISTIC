import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../client/storage.js';

test('local progress is isolated by permanent account ID, canonical names cannot be overwritten',()=>{
  const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  try {
    const a={id:'test-account-a',username:'Alpha'},b={id:'test-account-b',username:'Bravo'};
    const first=new Store(a);first.data.profile.xp=3100;first.data.profile.name='Impostor';first.save();
    assert.equal(first.data.profile.name,'Alpha');assert.equal(new Store(a).data.profile.xp,3100);
    const second=new Store(b);assert.equal(second.data.profile.xp,0);assert.equal(second.data.profile.name,'Bravo');second.save();
    assert.equal(new Store(a).data.profile.xp,3100);assert.notEqual(first.key,second.key);
    assert.equal([...values.values()].some(v=>v.includes('password')),false);
  } finally {delete globalThis.localStorage;}
});

test('registration does not silently assign old anonymous progress to a new account',()=>{
  const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  try {const legacy=new Store();legacy.data.profile.xp=9000;legacy.save();assert.equal(new Store({id:'new-user',username:'NewUser'}).data.profile.xp,0);assert.equal(new Store().data.profile.xp,9000);}
  finally {delete globalThis.localStorage;}
});

test('account name remains correct when browser storage is blocked',()=>{
  globalThis.localStorage={getItem:()=>{throw Error('Storage blocked');},setItem:()=>{throw Error('Storage blocked');}};
  try {const store=new Store({id:'blocked-storage',username:'VerifiedUser'});assert.equal(store.data.profile.name,'VerifiedUser');store.save();assert.equal(store.persistent,false);}
  finally {delete globalThis.localStorage;}
});

test('server profile is preferred over stale local cache and saves updated loadout',async()=>{
  const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  try {
    const account={id:'sync-account',username:'SyncUser'};
    const local=new Store(account);local.data.profile.xp=100;local.data.loadout=['ar4','relay9','edge'];local.save();
    const remote={version:1,profile:{xp:9000,kills:12,deaths:3,wins:5,matches:8,time:400},loadout:['ar4','relay9','edge'],operator:'sentinel',mode:'ffa',practice:local.data.practice,settings:local.data.settings,history:[]};
    const restored=new Store(account,remote);assert.equal(restored.data.profile.xp,9000);assert.equal(restored.data.mode,'ffa');
    let payload=null;restored.setRemoteSync(async p=>{payload=p;});restored.data.loadout=['ar4','relay9','edge'];restored.save();await new Promise(r=>setTimeout(r,0));
    assert.equal(payload.profile?.name,undefined);assert.equal(payload.profile.xp,9000);assert.deepEqual(payload.loadout,['ar4','relay9','edge']);
  } finally {delete globalThis.localStorage;}
});
