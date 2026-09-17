import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createGameServer } from '../server/server.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function next(c,p){for(let i=0;i<350;i++){const x=c.events.findIndex(p);if(x>=0)return c.events.splice(x,1)[0];await wait(10);}throw new Error('Timed out waiting for event');}
async function connect(app,user){const session=await app.auth.login(user.username,'Integration-password-77');const ws=new WebSocket(`ws://127.0.0.1:${app.addr.port}/ws`,{headers:{Cookie:`hamu_session=${session.token}`}});const c={user,ws,events:[],serial:0};ws.on('message',r=>c.events.push(JSON.parse(r)));await next(c,x=>x.t==='hello');c.rpc=async(t,fields={})=>{const id=String(++c.serial);ws.send(JSON.stringify({...fields,t,requestId:id}));const r=await next(c,x=>x.t==='reply'&&x.requestId===id);if(!r.ok)throw new Error(r.error);return r.result;};return c;}

test('two distinct accounts can party, enter one authoritative match, fire/damage, reconnect, and retain saved progress',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'hamu-public-play-'));const app=createGameServer({dataDir,migrateLegacy:false,queueWaitMs:50,matchmakingIntervalMs:10,reconnectGraceMs:1000});app.addr=await app.start({port:0,host:'127.0.0.1'});const aUser=await app.auth.register('PublicAlpha','publicalpha@example.test','Integration-password-77');const bUser=await app.auth.register('PublicBravo','publicbravo@example.test','Integration-password-77');
 const a=await connect(app,aUser),b=await connect(app,bUser);t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close();await rm(dataDir,{recursive:true,force:true});});
 await a.rpc('party.invite',{userId:bUser.id});const invite=await next(b,x=>x.t==='social_state'&&x.invites?.length);await b.rpc('party.inviteRespond',{inviteId:invite.invites[0].id,accept:true});await next(a,x=>x.t==='party_state'&&x.party?.members?.length===2);await a.rpc('party.ready',{ready:true});await b.rpc('party.ready',{ready:true});await a.rpc('queue.join',{});
 const aj=await next(a,x=>x.t==='joined'),bj=await next(b,x=>x.t==='joined');assert.equal(aj.room.id,bj.room.id);const room=app.rooms.get(aj.room.id);const pa=room.world.players.get(aj.id),pb=room.world.players.get(bj.id);assert.ok(pa&&pb);assert.notEqual(pa.team,pb.team);
 pa.x=pb.x-2;pa.z=pb.z;pa.yaw=0;pa.pitch=0;pa.protectUntil=0;pb.protectUntil=0;const hp=pb.hp;room.world.fire(pa);assert.ok(pb.hp<hp,'authoritative firing should apply damage');
 const saved={version:1,settings:{sensitivity:1.1},loadout:['ar4','relay9','edge'],operator:'sentinel',mode:'tdm',practice:{bots:5,difficulty:.8,duration:180},profile:{xp:123,kills:4,deaths:2,wins:1,matches:3,time:40},history:[]};await app.profiles.save(aUser.id,saved);assert.equal((await app.profiles.get(aUser.id)).profile.xp,123);
 const wsOld=a.ws;a.ws.close();await wait(100);const a2=await connect(app,aUser);const resumed=await next(a2,x=>x.t==='joined'&&x.resumed);assert.equal(resumed.room.id,aj.room.id);assert.equal(resumed.id,aj.id);assert.equal((await app.profiles.get(aUser.id)).profile.xp,123);assert.equal(wsOld.readyState,WebSocket.CLOSED);
});
