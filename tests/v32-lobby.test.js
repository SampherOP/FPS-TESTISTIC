import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import * as THREE from '../vendor/three.module.js';
import { Renderer } from '../client/renderer.js';
import { createGameServer } from '../server/server.js';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout=3500){const end=Date.now()+timeout;while(Date.now()<end){const v=fn();if(v)return v;await delay(10);}throw Error('Timed out waiting for condition');}
async function fixture(t, options={}){
  const dataDir=await mkdtemp(join(tmpdir(),'hamu-v32-'));
  const app=createGameServer({dataDir,migrateLegacy:false,matchmakingIntervalMs:20,queueWaitMs:800,...options});
  const addr=await app.start({port:0,host:'127.0.0.1'});const clients=[];
  t.after(async()=>{for(const c of clients)c.ws.terminate();await app.close();await rm(dataDir,{recursive:true,force:true});});
  async function connect(name){
    const user=await app.auth.register(name,`${name.toLowerCase()}@example.test`,'V32-password-77');
    const session=await app.auth.login(user.username,'V32-password-77');
    const ws=new WebSocket(`ws://127.0.0.1:${addr.port}/ws`,{headers:{Cookie:`hamu_session=${session.token}`}});
    const c={user,ws,events:[],state:{},serial:0};clients.push(c);
    ws.on('message',raw=>{const data=JSON.parse(raw);c.events.push(data);c.state[data.t]=data;});
    await until(()=>c.state.hello);await until(()=>c.state.party_state?.party&&c.state.social_state);
    c.rpc=async(op,fields={})=>{const requestId=String(++c.serial);ws.send(JSON.stringify({...fields,t:op,requestId}));const end=Date.now()+3500;while(Date.now()<end){const i=c.events.findIndex(x=>x.t==='reply'&&x.requestId===requestId);if(i>=0){const result=c.events.splice(i,1)[0];if(!result.ok)throw Error(result.error);return result.result;}await delay(10);}throw Error(`RPC timeout: ${op}`);};
    return c;
  }
  return {app,connect};
}
async function makeFriends(a,b){await a.rpc('social.request',{userId:b.user.id});await until(()=>b.state.social_state.incoming.length);await b.rpc('social.respond',{friendRequestId:b.state.social_state.incoming[0].id,accept:true});await until(()=>a.state.social_state.friends.some(x=>x.id===b.user.id));}
async function invite(a,b,kit={operator:'circuit',loadout:['lancer7','flick45','edge']}){await a.rpc('party.invite',{userId:b.user.id});await until(()=>b.state.social_state.invites.length);await b.rpc('party.inviteRespond',{inviteId:b.state.social_state.invites[0].id,accept:true,...kit});await until(()=>b.state.party_state.party.members.some(m=>m.id===b.user.id));}

function rendererHarness(){
  const r=Object.create(Renderer.prototype);
  Object.assign(r,{modelReady:true,menuPartyModels:[],menuScene:new THREE.Scene(),localMemberId:'local',pendingMenuOperator:'sentinel',pendingCancellationEvents:[]});
  r._makeLobbyModel=(m,index)=>{const model=new THREE.Group(),pad=new THREE.Group();return {memberId:m.id,operator:m.operator||'sentinel',username:m.username,model,pad,index,label:{material:{map:{dispose(){}},dispose(){}}}};};
  r.disposeLobbyItem=()=>{};
  return r;
}

const member=(id,operator='sentinel')=>({id,username:id,operator,loadout:['ar4','relay9','edge']});

test('authoritative leader stays centered for 1-4 members and follows leadership transfer',()=>{
  const r=rendererHarness();
  for(let n=1;n<=4;n++){
    const members=Array.from({length:n},(_,i)=>member(`p${i}`,i?'circuit':'sentinel'));
    r.setMenuParty(members,'p0');
    const leader=r.menuPartyModels.find(x=>x.memberId==='p0');
    assert.equal(leader.model.position.x,0,`leader centered at ${n} members`);
    assert.equal(leader.isLeader,true);
    assert.ok(r.menuPartyModels.filter(x=>!x.isLeader).every(x=>x.model.position.z<0),'guests sit behind leader');
  }
  const members=[member('guestA','circuit'),member('guestB','frontline'),member('guestC','juggernaut')];
  r.setMenuParty(members,'guestB');
  assert.equal(r.menuPartyModels.find(x=>x.memberId==='guestB').model.position.x,0);
  assert.equal(r.menuPartyModels.find(x=>x.memberId==='guestA').isLeader,false);
  assert.equal(r.menuPartyModels.find(x=>x.memberId==='guestB').isLeader,true);
});

test('invite acceptance is ready immediately and synchronizes the invited player kit',async t=>{
  const {connect}=await fixture(t);const leader=await connect('KitLeader'),guest=await connect('KitGuest');await makeFriends(leader,guest);await invite(leader,guest);
  const p=guest.state.party_state.party,m=p.members.find(x=>x.id===guest.user.id);
  assert.equal(p.leaderId,leader.user.id);assert.equal(m.ready,true);assert.equal(m.operator,'circuit');assert.deepEqual(m.loadout,['lancer7','flick45','edge']);
});

test('leader-only mode/start permissions and guest readiness controls are reflected server-side',async t=>{
  const {connect}=await fixture(t);const leader=await connect('PermLeader'),guest=await connect('PermGuest');await makeFriends(leader,guest);await invite(leader,guest);
  await assert.rejects(guest.rpc('party.mode',{mode:'ffa'}),/leader/i);
  await assert.rejects(guest.rpc('queue.join',{mode:'tdm'}),/leader/i);
  await leader.rpc('queue.join',{});
  await until(()=>guest.state.queue_state?.queue);
  assert.equal(guest.state.party_state.party.members.find(m=>m.id===guest.user.id).ready,true);
  await guest.rpc('party.ready',{ready:false,operator:'circuit',loadout:['lancer7','flick45','edge']});
  await until(()=>leader.state.party_state.party.status==='idle');
  assert.equal(leader.state.party_state.party.members.find(m=>m.id===guest.user.id).ready,false);
  assert.equal(leader.state.party_state.party.members.find(m=>m.id===leader.user.id).ready,true);
  await assert.rejects(leader.rpc('queue.join',{}),/ready/i);
  await guest.rpc('party.ready',{ready:true,operator:'circuit',loadout:['lancer7','flick45','edge']});
  await leader.rpc('queue.join',{});
  await until(()=>leader.state.queue_state?.queue);
});

test('guest cancellation emits a party-scoped two-second event to every participant, repeats cleanly, and ignores unrelated updates',async t=>{
  const {connect}=await fixture(t);const a=await connect('EventLeader'),b=await connect('EventGuest'),c=await connect('EventThird');
  await makeFriends(a,b);await makeFriends(a,c);await invite(a,b);await invite(a,c);
  for(const x of [a,b,c])x.events=x.events.filter(e=>e.t!=='party_event');
  await b.rpc('party.ready',{ready:false,explicitCancel:true,operator:'circuit',loadout:['ar4','relay9','edge']});
  const first=await Promise.all([a,b,c].map(x=>until(()=>{const i=x.events.findIndex(e=>e.t==='party_event'&&e.event==='cancelled');return i>=0?x.events.splice(i,1)[0]:null})));
  assert.equal(new Set(first.map(x=>x.eventId)).size,1);assert.ok(first.every(x=>x.playerId===b.user.id));assert.ok(first.every(x=>x.expiresAt-Date.now()>1500));
  await b.rpc('party.ready',{ready:true,operator:'circuit',loadout:['ar4','relay9','edge']});
  assert.equal(a.events.some(e=>e.t==='party_event'),false);
  await delay(300);await b.rpc('party.ready',{ready:false,explicitCancel:true,operator:'circuit',loadout:['ar4','relay9','edge']});
  const second=await Promise.all([a,b,c].map(x=>until(()=>{const i=x.events.findIndex(e=>e.t==='party_event'&&e.event==='cancelled');return i>=0?x.events.splice(i,1)[0]:null})));
  assert.notEqual(second[0].eventId,first[0].eventId);assert.ok(second[0].expiresAt>Date.now()+1500);
});

test('non-explicit readiness synchronization never emits a cancellation event',async t=>{
  const {connect}=await fixture(t);const a=await connect('SyncLeader'),b=await connect('SyncGuest');await makeFriends(a,b);await invite(a,b);
  for(const x of [a,b])x.events=x.events.filter(e=>e.t!=='party_event');
  await b.rpc('party.ready',{ready:false,explicitCancel:false,operator:'frontline',loadout:['hxr8','relay9','edge']});
  await delay(120);assert.equal(a.events.some(e=>e.t==='party_event'),false);assert.equal(b.state.party_state.party.members.find(m=>m.id===b.user.id).ready,false);
});

test('cancelling during matchmaking only makes the cancelling guest unready and does not unready the leader or other guest',async t=>{
  const {connect}=await fixture(t);const a=await connect('QueueLeader'),b=await connect('QueueGuest'),c=await connect('QueueOther');await makeFriends(a,b);await makeFriends(a,c);await invite(a,b);await invite(a,c);
  await a.rpc('queue.join',{});await until(()=>b.state.queue_state?.queue&&c.state.queue_state?.queue);
  await b.rpc('party.ready',{ready:false,explicitCancel:true,operator:'circuit',loadout:['ar4','relay9','edge']});
  await until(()=>a.state.party_state.party.status==='idle');
  const p=a.state.party_state.party;assert.equal(p.members.find(m=>m.id===a.user.id).ready,true);assert.equal(p.members.find(m=>m.id===b.user.id).ready,false);assert.equal(p.members.find(m=>m.id===c.user.id).ready,true);assert.equal(a.state.queue_state.queue,null);
});

test('party source uses server-authoritative leaderId and guest control markup has no right-rail READY UP control',async()=>{
  const ui=await readFile(new URL('../client/ui.js',import.meta.url),'utf8');
  assert.match(ui,/party\?\.leaderId===this\.auth\.user\?\.id/);
  assert.match(ui,/master-guest-deploy/);
  assert.match(ui,/data-social=\"\$\{members\.find/);
  assert.match(ui,/master-guest-ready-button/);
  assert.doesNotMatch(ui,/class=\"master-ready/);
});
