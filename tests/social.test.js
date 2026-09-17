import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../server/auth.js';
import { SocialStore } from '../server/social.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'hamu-social-'));
  const auth = new AuthStore({ dataDir }); await auth.ready;
  const users = {};
  for (const name of ['Alice', 'Bob', 'Bobby']) users[name] = await auth.register(name, `${name.toLowerCase()}@example.test`, 'password-123');
  const social = new SocialStore({ dataDir }); await social.ready;
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, auth, social, users };
}

test('friend request authorization, duplicate race, accept, decline, cancel, and symmetric removal', async t => {
  const { social, auth, users } = await fixture(t), a=users.Alice.id, b=users.Bob.id;
  const [first, second] = await Promise.allSettled([social.request(a,b,auth), social.request(a,b,auth)]);
  assert.equal([first,second].filter(x=>x.status==='fulfilled').length, 1);
  const state = await social.state(b,auth,()=> 'online'); assert.equal(state.incoming.length,1);
  await assert.rejects(() => social.cancel(b,state.incoming[0].id,auth), /not found/);
  await social.respond(b,state.incoming[0].id,true,auth);
  assert.equal((await social.state(a,auth,()=> 'online')).friends[0].username,'Bob');
  await social.remove(a,b,auth); assert.equal((await social.state(a,auth,()=> 'online')).friends.length,0);
  const request = await social.request(a,b,auth); await social.cancel(a,request.id,auth);
  const declined = await social.request(a,users.Bobby.id,auth); await social.respond(users.Bobby.id,declined.id,false,auth);
});

test('search is bounded, exact-first, presence-aware, and does not expose passwords or emails', async t => {
  const { social, auth, users } = await fixture(t);
  const result = social.search('bo', users.Alice.id, auth, id => id===users.Bob.id?'in_party':'offline');
  assert.equal(result.users[0].username,'Bob'); assert.equal(result.users[0].status,'in_party'); assert.equal(result.users[0].online,true); assert.equal(result.users[0].passwordHash,undefined); assert.equal(result.users[0].email,undefined);
  assert.deepEqual(social.search('x',users.Alice.id,auth,()=> 'online'),{users:[],truncated:false});
});

test('social graph survives restart with atomic JSON data', async t => {
  const { dataDir, auth, social, users } = await fixture(t);
  const request=await social.request(users.Alice.id,users.Bob.id,auth); await social.respond(users.Bob.id,request.id,true,auth);
  const restartedAuth=new AuthStore({dataDir}); await restartedAuth.ready; const restarted=new SocialStore({dataDir}); await restarted.ready;
  assert.equal((await restarted.state(users.Alice.id,restartedAuth,()=> 'offline')).friends[0].id,users.Bob.id);
  const persisted=JSON.parse(await readFile(join(dataDir,'social.json'),'utf8')); assert.equal(persisted.version,1);
});
