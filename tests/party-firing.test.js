import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createGameServer } from '../server/server.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout=3000) { const end=Date.now()+timeout; while(Date.now()<end){const v=fn();if(v)return v;await wait(10);}throw new Error('timeout'); }
async function connect(app,port,name){
  const user=await app.auth.register(name,`${name.toLowerCase()}@example.test`,'Integration-password-77');
  const session=await app.auth.login(name,'Integration-password-77');
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{headers:{Cookie:`hamu_session=${session.token}`}});
  const c={user,ws,events:[],serial:0}; ws.on('message',raw=>c.events.push(JSON.parse(raw)));
  const hello=await until(()=>c.events.find(x=>x.t==='hello')); c.hello=hello;
  c.rpc=async(op,fields={})=>{const requestId=`r${++c.serial}`;ws.send(JSON.stringify({...fields,t:op,requestId}));const reply=await until(()=>{const i=c.events.findIndex(x=>x.t==='reply'&&x.requestId===requestId);return i<0?null:c.events.splice(i,1)[0];});if(!reply.ok)throw new Error(reply.error);return reply.result;};
  return c;
}

test('party members have independent authoritative fire channels even when assigned to the same team', async t => {
  const dataDir=await mkdtemp(join(tmpdir(),'hamu-party-fire-'));
  const app=createGameServer({dataDir,migrateLegacy:false,queueWaitMs:50,matchmakingIntervalMs:10});
  const addr=await app.start({port:0,host:'127.0.0.1'});
  const a=await connect(app,addr.port,'PartyFireAlpha'), b=await connect(app,addr.port,'PartyFireBravo');
  t.after(async()=>{a.ws.close();b.ws.close();await app.close();await rm(dataDir,{recursive:true,force:true});});
  const party=app.matchmaking.partyFor(a.user.id); app.matchmaking.removeMember(b.user.id); assert.equal(app.matchmaking.addMember(party.id,b.user.id,b.user.username,true),true);
  for(const m of party.members)m.ready=true;
  await a.rpc('queue.join',{mode:'tdm'});
  const aj=await until(()=>a.events.find(x=>x.t==='joined')); const bj=await until(()=>b.events.find(x=>x.t==='joined'));
  assert.equal(aj.room.id,bj.room.id);
  const room=app.rooms.get(aj.room.id), pa=room.world.players.get(aj.id), pb=room.world.players.get(bj.id);
  assert.equal(pa.team,pb.team);
  pa.protectUntil=-1;pb.protectUntil=-1;pa.nextShot=0;pb.nextShot=0;room.world.time=1;
  a.ws.send(JSON.stringify({t:'f',d:[pa.yaw,pa.pitch,0,1]}));
  b.ws.send(JSON.stringify({t:'f',d:[pb.yaw,pb.pitch,0,1]}));
  await wait(80);
  assert.equal(pa.ammo[0],29); assert.equal(pb.ammo[0],29); assert.equal(pa.firedAt,1); assert.equal(pb.firedAt,1);
  room.world.time=2; pa.nextShot=0; pb.nextShot=0;
  a.ws.send(JSON.stringify({t:'f',d:[pa.yaw,pa.pitch,0,2]}));
  b.ws.send(JSON.stringify({t:'f',d:[pb.yaw,pb.pitch,0,2]}));
  await wait(80);
  assert.equal(pa.ammo[0],28); assert.equal(pb.ammo[0],28);
});
