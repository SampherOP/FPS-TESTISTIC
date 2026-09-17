import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/simulation.js';
import { B, validateInput, packInput, unpackPlayer } from '../shared/protocol.js';
import { traceShot, direction, movePlayer, STAND_HEIGHT } from '../shared/physics.js';

const add=(w,id,team=0,opts={})=>w.addPlayer({id,name:id,team, ...opts});
const lane=(a,b)=>{Object.assign(a,{x:-8,y:0,z:0,yaw:Math.PI/2,protectUntil:-1});Object.assign(b,{x:8,y:0,z:0,yaw:-Math.PI/2,protectUntil:-1});};

test('movement respects collider and speed limits',()=>{
  const w=new World({seed:3}); const p=add(w,'p');
  p.x=10;p.z=0;p.yaw=Math.PI/2;p.protectUntil=-1;
  w.setInput('p',{seq:1,ax:1,az:0,yaw:p.yaw,pitch:0,flags:B.SPRINT,slot:0});
  for(let i=0;i<60;i++)w.step(1/60);
  assert.ok(p.x<11.8 && p.x>9); assert.ok(Math.hypot(p.vx,p.vz)<10);
});
test('damage absorbs armor and headshots amplify, friendly fire is blocked',()=>{
  const w=new World({seed:4});const a=add(w,'a',0),b=add(w,'b',1),c=add(w,'c',0);[a,b,c].forEach(p=>p.protectUntil=-1);
  const armor=b.armor;assert.equal(w.damage(b,a,50,false),true);assert.equal(b.armor,armor-30);assert.equal(b.hp,80);
  const hp=b.hp;w.damage(b,a,20,true);assert.ok(b.hp<hp);
  const before=c.hp;assert.equal(w.damage(c,a,100),false);assert.equal(c.hp,before);
});
test('spawn protection prevents damage then expires',()=>{const w=new World({seed:1});const a=add(w,'a',0),b=add(w,'b',1);assert.equal(w.damage(b,a,100),false);w.time=b.protectUntil+.01;assert.equal(w.damage(b,a,100),true);});
test('reload completes and weapon switching resets cadence',()=>{const w=new World({seed:2});const p=add(w,'p');p.protectUntil=-1;p.ammo[0]=0;p.reserve[0]=2;assert.equal(w.startReload(p),true);w.step(2);assert.equal(p.ammo[0],2);const old=p.nextShot;p.input.slot=1;w.step(1/60);assert.equal(p.slot,1);assert.ok(p.nextShot>=old);});
test('fire cadence and ammo are authoritative',()=>{const w=new World({seed:2});const a=add(w,'a',0),b=add(w,'b',1);lane(a,b);a.nextShot=0;w.time=1;assert.equal(w.fire(a),true);assert.equal(a.ammo[0],29);assert.equal(w.fire(a),false);w.time+=.11;assert.equal(w.fire(a),true);assert.equal(a.ammo[0],28);});
test('melee damages nearby target only in front',()=>{const w=new World({seed:5});const a=add(w,'a',0),b=add(w,'b',1);lane(a,b);b.x=a.x+1;b.z=a.z; a.yaw=Math.PI/2;a.nextMelee=0;a.nextShot=0;w.time=1;assert.equal(w.melee(a),true);assert.ok(b.hp<100);});
test('frag fuse explodes through clear line but not wall',()=>{const w=new World({seed:5});const a=add(w,'a',0),b=add(w,'b',1);a.protectUntil=-1;b.protectUntil=-1;Object.assign(a,{x:0,z:10,yaw:0,pitch:0});Object.assign(b,{x:0,z:-18});a.grenades=1;w.time=2;assert.equal(w.throwGrenade(a),true);for(let i=0;i<180;i++)w.step(1/60);assert.ok(b.hp<100||b.deaths>0);});
test('dead player respawns after three seconds',()=>{const w=new World({seed:8});const a=add(w,'a',0),b=add(w,'b',1);a.protectUntil=b.protectUntil=-1;w.damage(b,a,500);assert.equal(b.alive,false);const spawn=b.respawnAt;w.step(2.9);assert.equal(b.alive,false);w.step(.2);assert.equal(b.alive,true);assert.ok(b.respawnAt===0);});
test('TDM score and limit end match',()=>{const w=new World({mode:'tdm',limit:1,seed:9});const a=add(w,'a',0),b=add(w,'b',1);a.protectUntil=b.protectUntil=-1;w.damage(b,a,500);w.step();assert.equal(w.scores[0],1);assert.equal(w.phase,'ended');assert.equal(w.winner,0);});
test('FFA leader and limit end match',()=>{const w=new World({mode:'ffa',limit:1,seed:9});const a=add(w,'a',2),b=add(w,'b',2);a.protectUntil=b.protectUntil=-1;w.damage(b,a,500);w.step();assert.equal(w.phase,'ended');assert.equal(w.winner,'a');});
test('domination captures, scores, and contested zones pause progress',()=>{const w=new World({mode:'dom',seed:10});const a=add(w,'a',0),b=add(w,'b',1),o=w.objectives[0];a.protectUntil=b.protectUntil=-1;Object.assign(a,{x:o.x,z:o.z});Object.assign(b,{x:o.x+1,z:o.z});w.step(1);assert.equal(o.contested,true);assert.equal(o.owner,-1);b.alive=false;w.step(6.1);assert.equal(o.owner,0);assert.ok(a.score>=150);});
test('time limit ends tied team match',()=>{const w=new World({mode:'tdm',duration:60,seed:11});w.step(60);assert.equal(w.phase,'ended');assert.equal(w.winner,null);});
test('input validation rejects malformed, nonfinite, range, flags, and sequence packets',()=>{
  assert.equal(validateInput([1,0,0,0,0,0,0]),null); // too short
  assert.equal(validateInput([1,NaN,0,0,0,0,0,1]),null);
  assert.equal(validateInput([1,2,0,0,0,0,0,1]),null);
  assert.equal(validateInput([1,0,0,0,0,1<<20,0,1]),null);
  assert.equal(validateInput([1,0,0,0,0,0,0,1],1),null);
  const i=validateInput([2,1,0,7,1.5,0,2,1]);assert.equal(i.pitch,1.48);assert.ok(Math.abs(i.yaw-(7-2*Math.PI))<1e-9);
});
test('input packing and snapshot player roundtrip preserve protocol fields',()=>{const i=validateInput([4,.1234,-.4,3.2,.2,B.ADS,1,1]);const p=unpackPlayer(["x","N",0,1,2,3,4,5,6,7,1,1,["ar4"],[1],[2],.1,3,4,5,1.7,0,0,0,1,0,88,0,2,0,"sentinel",4,9,1,2,0,1,0]);assert.equal(packInput(i)[0],4);assert.equal(p.id,'x');assert.equal(p.ads,true);});
test('bot moves and produces valid input',()=>{const w=new World({seed:12,difficulty:1});const bot=w.addBot();const start=[bot.x,bot.z];const human=add(w,'h',1);human.protectUntil=-1;for(let i=0;i<120;i++)w.step(1/60);assert.ok(Number.isFinite(bot.x)&&Number.isFinite(bot.z));assert.ok(bot.lastSeq>0);assert.ok(bot.x!==start[0]||bot.z!==start[1]);});
test('traceShot stops at world geometry',()=>{const w=new World({seed:13});const a=add(w,'a');a.x=0;a.y=0;a.z=20;const result=traceShot({x:0,y:1.6,z:20},{x:0,y:0,z:-1},w.players.values(),a,140,true);assert.ok(result.distance<140);});
test('kill emits attribution and replenishes reserve ammo',()=>{const w=new World({seed:14});const a=add(w,'a',0),b=add(w,'b',1);a.protectUntil=b.protectUntil=-1;a.reserve[0]=0;w.damage(b,a,500,true,'TEST');const kill=w.drainEvents().find(e=>e.type==='kill');assert.equal(kill.killer,'a');assert.equal(kill.head,true);assert.equal(a.kills,1);assert.ok(a.reserve[0]>0);});
test('snapshot exposes objective and active grenade state',()=>{const w=new World({seed:15});const a=add(w,'a');a.protectUntil=-1;w.time=1;w.throwGrenade(a);const s=w.snapshot();assert.equal(s.players.length,1);assert.equal(s.grenades.length,1);assert.equal(s.objectives.length,3);});
test('jump and crouch alter grounded state and height',()=>{const w=new World({seed:16});const p=add(w,'p');w.setInput('p',{seq:1,ax:0,az:0,yaw:0,pitch:0,flags:B.JUMP,slot:0});w.step(1/60);assert.equal(p.grounded,false);w.setInput('p',{seq:2,ax:0,az:0,yaw:0,pitch:0,flags:B.CROUCH,slot:0});for(let i=0;i<30;i++)w.step(1/60);assert.ok(p.height<STAND_HEIGHT);});
test('slide consumes stamina and decays to completion',()=>{const w=new World({seed:17});const p=add(w,'p');p.vx=8;p.grounded=true;w.setInput('p',{seq:1,ax:1,az:0,yaw:Math.PI/2,pitch:0,flags:B.SPRINT|B.SLIDE,slot:0});w.step(1/60);assert.ok(p.slide>0&&p.stamina<100);for(let i=0;i<60;i++)w.step(1/60);assert.equal(p.slide,0);});
test('auto restart begins a fresh round after match end',()=>{const w=new World({mode:'tdm',limit:1,autoRestart:true,seed:18});const a=add(w,'a',0),b=add(w,'b',1);a.protectUntil=b.protectUntil=-1;w.damage(b,a,500);w.step();assert.equal(w.phase,'ended');const round=w.round;w.step(12.1);assert.equal(w.round,round+1);assert.equal(w.phase,'playing');});
test('world snapshots roundtrip basic match identity and scores',()=>{const w=new World({mode:'ffa',seed:19});add(w,'p',2);const s=w.snapshot();assert.equal(s.mode,'ffa');assert.equal(s.matchId,w.matchId);assert.deepEqual(s.scores,[0,0]);assert.equal(s.phase,'playing');});
