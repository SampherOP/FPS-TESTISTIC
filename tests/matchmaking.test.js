import test from 'node:test';
import assert from 'node:assert/strict';
import { Matchmaking } from '../server/matchmaking.js';

const player=(id,team)=>({accountId:id,clientId:id,name:id,loadout:['carbine','relay9','edge'],operator:'sentinel',...(team===undefined?{}:{team})});
function queueParty(mm,id,size,mode='tdm') { const p=mm.ensureParty(id,id); if(mode!==p.mode)mm.setMode(id,mode); for(let i=1;i<size;i++)mm.addMember(p.id,`${id}-${i}`,`${id}-${i}`); for(const m of p.members)if(m.id!==p.leaderId)mm.setReady(m.id,true); mm.queue(p.id,mode,p.members.map(m=>player(m.id))); return p; }

test('FIFO compatible parties pack without splitting and assign each team at most four', () => {
  let now=0; const matches=[]; const mm=new Matchmaking({now:()=>now,queueWaitMs:100,onMatch:m=>{matches.push(m);return {roomId:m.id};}});
  queueParty(mm,'a',3); queueParty(mm,'b',1); queueParty(mm,'c',2); queueParty(mm,'d',2); mm.tick();
  assert.equal(matches.length,1); assert.equal(matches[0].players.length,8);
  for(const team of [0,1])assert.equal(matches[0].players.filter(p=>p.team===team).length,4);
  assert.deepEqual(matches[0].players.slice(0,3).map(p=>p.accountId),['a','a-1','a-2']);
});

test('partial queue waits then dispatches exactly once and can be cancelled by any member', () => {
  let now=0; const matches=[]; const mm=new Matchmaking({now:()=>now,queueWaitMs:100,onMatch:m=>{matches.push(m);return {roomId:m.id};}});
  const p=queueParty(mm,'party',2); assert.equal(mm.cancelForUser('party-1'),true); assert.equal(p.status,'idle'); assert.equal(matches.length,0);
  queueParty(mm,'party',2); now=101; mm.tick(); assert.equal(matches.length,1); mm.tick(); assert.equal(matches.length,1); assert.equal(matches[0].timedOut,true);
});

test('late human backfill removes a bot from the correct team without overcapacity', () => {
  let now=0; const matches=[], backfills=[]; const mm=new Matchmaking({now:()=>now,queueWaitMs:1,onMatch:m=>{m.roomId=m.id;matches.push(m);return {roomId:m.id};},onBackfill:(m,a)=>{backfills.push(a);return true;}});
  queueParty(mm,'first',3); now=2; mm.tick(); assert.equal(matches.length,1);
  queueParty(mm,'second',2); mm.tick(); assert.equal(backfills.length,1); assert.equal(backfills[0].players.length,2); assert.equal(backfills[0].players.every(p=>p.team===1),true);
  assert.equal(mm.matches.get(matches[0].id).teamCounts[1],2);
});

test('backtracking keeps FIFO tickets and packs 1,1,3,3 into two balanced bins', () => {
  const matches=[]; const mm=new Matchmaking({queueWaitMs:100,onMatch:m=>{matches.push(m);return {roomId:m.id};}});
  queueParty(mm,'one',1); queueParty(mm,'two',1); queueParty(mm,'three',3); queueParty(mm,'four',3);
  assert.equal(matches.length,1); assert.equal(matches[0].players.length,8);
  assert.deepEqual(matches[0].players.slice(0,1).map(p=>p.accountId),['one']);
  assert.deepEqual([0,1].map(team=>matches[0].players.filter(p=>p.team===team).length),[4,4]);
});

test('backfill skips an oldest party that cannot fit and accepts the next compatible one', () => {
  let now=0; const matches=[], backfills=[]; const mm=new Matchmaking({now:()=>now,queueWaitMs:1,onMatch:m=>{m.roomId=m.id;matches.push(m);return {roomId:m.id};},onBackfill:(m,a)=>{backfills.push(a);return true;}});
  queueParty(mm,'base',3); queueParty(mm,'base-small',2); now=2; mm.tick();
  queueParty(mm,'too-big',4); queueParty(mm,'fits',1); mm.tick();
  assert.equal(backfills.length,1);assert.equal(backfills[0].players.length,1);assert.equal(backfills[0].players[0].accountId,'fits');
});

test('party size stays capped at four while the leader can switch playlists', () => {
  const mm=new Matchmaking(); const p=mm.ensureParty('leader','leader');
  assert.equal(mm.setMode('leader','ffa'),true);
  for(let i=1;i<4;i++)assert.equal(mm.addMember(p.id,`member-${i}`,`member-${i}`),true);
  assert.equal(p.members.length,4);
  assert.equal(mm.addMember(p.id,'member-4','member-4'),false);
  assert.equal(mm.setMode('leader','tdm'),true);
  assert.equal(p.mode,'tdm');assert.equal(p.maxSize,4);
});

test('departing match users decrement human count and records can be removed', () => {
  let now=0; const matches=[]; const mm=new Matchmaking({now:()=>now,queueWaitMs:1,onMatch:m=>{m.roomId=m.id;matches.push(m);return {roomId:m.id};}});
  queueParty(mm,'depart',1); now=2; mm.tick(); const match=matches[0]; assert.equal(mm.matches.get(match.id).humanCount,1);
  mm.leaveMatch('depart'); assert.equal(mm.matches.get(match.id).humanCount,0); assert.equal(mm.matches.get(match.id).livePlayers.size,0); assert.deepEqual(mm.matches.get(match.id).teamCounts,[0,0]);
  assert.equal(mm.removeMatch(match.id),true); assert.equal(mm.matches.has(match.id),false);
});

test('selection backtracks to fill eight players instead of greedily starving later compatible tickets',()=>{
  const mm=new Matchmaking({queueWaitMs:15000,onMatch:()=>({roomId:'Q-starve'})});
  const candidates=[
    {partyId:'old1',mode:'tdm',startedAt:0,order:0,players:[{}]},
    {partyId:'old2',mode:'tdm',startedAt:1,order:1,players:[{}]},
    {partyId:'old3',mode:'tdm',startedAt:2,order:2,players:[{}]},
    {partyId:'old4',mode:'tdm',startedAt:3,order:3,players:[{}, {}, {}]},
    {partyId:'old5',mode:'tdm',startedAt:4,order:4,players:[{}, {}, {}]},
    {partyId:'old6',mode:'tdm',startedAt:5,order:5,players:[{}, {}, {}]},
  ];
  const best=mm._bestSelection('tdm',candidates,[0,0],true);
  assert.equal(best.selected.reduce((n,x)=>n+x.players.length,0),8);
  assert.equal(best.selected[0].partyId,'old1');
  assert.deepEqual(best.selected.map(x=>x.partyId),['old1','old2','old4','old5']);
});

test('FFA selection fills capacity without team packing constraints',()=>{
  const mm=new Matchmaking({capacity:8});
  const candidates=[
    {partyId:'solo',mode:'ffa',startedAt:0,order:0,players:[{}]},
    {partyId:'trioA',mode:'ffa',startedAt:1,order:1,players:[{}, {}, {}]},
    {partyId:'trioB',mode:'ffa',startedAt:2,order:2,players:[{}, {}, {}]},
    {partyId:'duo',mode:'ffa',startedAt:3,order:3,players:[{},{}]},
  ];
  const best=mm._bestSelection('ffa',candidates,[0,0],true);
  assert.equal(best.selected.reduce((n,x)=>n+x.players.length,0),7);
  assert.equal(best.assignments.every(a=>a.team===undefined),true);
});
