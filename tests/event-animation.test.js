// Headless regression coverage for the production event -> Game -> Renderer path.
// The WebGL draw target is deliberately a recorder; production pose methods still run.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { B } from '../shared/protocol.js';
import { World } from '../shared/simulation.js';
import { WEAPONS } from '../shared/weapons.js';
import { Game } from '../client/game.js';
import { Input } from '../client/input.js';
import { Renderer } from '../client/renderer.js';
import { weaponMetadata } from '../client/weapon-models.js';

const now=()=>performance.now()/1000;
const slotFor=id=>WEAPONS[id].category==='Pistol'?1:WEAPONS[id].category==='Melee'?2:0;

function fixture(id,partNames=[]){
 const gun=new THREE.Group(),parts={};
 for(const name of partNames){const part=new THREE.Group();gun.add(part);parts[name]=part;}
 gun.userData={...weaponMetadata(id),parts};gun.scale.setScalar(.82);
 const weaponRig=new THREE.Group();weaponRig.add(gun);
 const draw=[];
 const renderer={
  players:new Map(),arena:{objectives:new Map(),supplies:[]},effects:{update(){},shot(){}},flyEditor:{active:false},
  weaponRig,fpModel:gun,lastWeapon:id,kick:0,swing:0,flashTime:0,shake:0,ads:0,lastShotAt:-Infinity,
  flash:{visible:false,position:new THREE.Vector3(),scale:new THREE.Vector3(),material:{}},
  fpScene:new THREE.Scene(),fpCamera:new THREE.PerspectiveCamera(72,16/9,.012,8),
  camera:new THREE.PerspectiveCamera(80,16/9,.06,160),settings:{fov:80,reducedMotion:true},
  renderer:{clear(){draw.push('clear');},clearDepth(){draw.push('depth');},render(scene){draw.push(scene);}},draw,
  setWeapon(requested){assert.equal(requested,this.fpModel.userData.id,'render selects the current weapon instance');},
  updateRemote:Renderer.prototype.updateRemote,removeRemote:Renderer.prototype.removeRemote,
  localShot:Renderer.prototype.localShot,melee:Renderer.prototype.melee
 };
 return {renderer,gun,parts};
}
function render(renderer,id,{reload=0,flags=0,alive=true,speed=0,time=now(),dt=1/60}={}){
 const slot=slotFor(id),self={id:'local',alive,slot,loadout:[id,id,id],reloadLeft:reload,reloadTotal:reload?2:0,
  x:0,y:0,z:0,vx:speed,vz:0,grounded:true};
 Renderer.prototype.renderGame.call(renderer,{players:[],objectives:[],grenades:[],mode:'tdm'},self,{flags,yaw:0,pitch:0,ax:0},dt,time);
 return self;
}
function gameFor(renderer){
 return {id:'local',online:false,local:{id:'local',alive:true},world:null,lastLocalFX:-Infinity,
  hud:{event(){}},renderer,input:{yaw:0,recoil(){}},audio:{shoot(){},melee(){},hit(){},kill(){},reload(){},loaded(){},throw(){},explosion(){}},
  localShot:Game.prototype.localShot};
}
function emittedShot(id){
 const world=new World({seed:22}),player=world.addPlayer({id:'local',name:'local',loadout:[id,id,id]});
 player.slot=0;player.nextShot=0;world.time=1;
 assert.equal(world.fire(player),true,`${id} must emit an authoritative shot event`);
 return world.drainEvents().find(event=>event.type==='shot');
}

test('authoritative pistol and GLOCK shot events drive their separate first-person slide instances',()=>{
 for(const id of ['relay9','flick45']){
  const {renderer,parts}=fixture(id,['slide']),game=gameFor(renderer),event=emittedShot(id);
  Game.prototype.event.call(game,event);
  assert.ok(renderer.kick>0,`${id}: Game.localShot reached Renderer.localShot`);
  renderer.lastShotAt=now()-.02;render(renderer,id,{time:now()});
  assert.notEqual(parts.slide.position.z,0,`${id}: slide moves in the real renderer event pose`);
 }
});

test('magazine reload is phased, repeatable, and clears on an interrupted weapon switch',()=>{
 const {renderer,parts}=fixture('ar4',['mag']);
 render(renderer,'ar4',{reload:1,time:4});const first=parts.mag.position.clone();
 assert.ok(first.y<-.01,'mid-reload lowers the magazine');
 render(renderer,'ar4',{reload:1,time:4.1});assert.deepEqual(parts.mag.position.toArray(),first.toArray(),'repeat render does not accumulate magazine transform');
 render(renderer,'ar4',{reload:0,time:4.2});assert.deepEqual(parts.mag.position.toArray(),[0,0,0],'zero reload resets the magazine after interruption/switch');
});

test('shotgun pump and sniper bolt wait for their delayed mechanism phase',()=>{
 for(const [id,part] of [['breach12','pump'],['lancer7','bolt']]){
  const {renderer,parts}=fixture(id,[part]),game=gameFor(renderer);
  Game.prototype.event.call(game,emittedShot(id));
  renderer.lastShotAt=now()-.20;render(renderer,id,{time:now()});
  assert.notEqual(parts[part].position.z,0,`${id}: delayed ${part} moves after the shot event`);
 }
});

test('SNIPE-RIL uses its integral reload route and fabricates no magazine or bolt part',()=>{
 const metadata=weaponMetadata('snipeRil');
 assert.equal(metadata.reloadStyle,'integral');assert.deepEqual(Object.keys(metadata.parts),[]);
 const {renderer,gun}=fixture('snipeRil');render(renderer,'snipeRil',{reload:1,time:5});
 assert.deepEqual(Object.keys(gun.userData.parts),[],'renderer did not introduce false moving geometry');
});

test('knife melee event swings but production render rejects ADS, zoom and firearm reload pose',()=>{
 const {renderer}=fixture('edge'),game=gameFor(renderer);
 renderer.ads=1;Game.prototype.event.call(game,{type:'melee',id:'local'});
 assert.equal(renderer.swing,.3,'Game melee event reached Renderer.melee');
 render(renderer,'edge',{reload:1,flags:B.ADS,time:6});
 assert.ok(renderer.weaponRig.position.z<-.6,'knife retains a timed swing pose');
 assert.ok(renderer.ads<.001,'knife ADS is rejected by Renderer.renderGame');
 assert.ok(Math.abs(renderer.camera.fov-80)<.001,'knife cannot zoom the world camera');
});

test('World MELEE input reaches the production Renderer swing without producing a firearm event',()=>{
 const {renderer}=fixture('edge'),game=gameFor(renderer);
 const world=new World({seed:24}),player=world.addPlayer({id:'local',name:'local',loadout:['edge','relay9','edge']});
 player.slot=0;player.nextMelee=0;player.nextShot=0;player.protectUntil=-1;world.time=1;world.drainEvents();
 world.setInput('local',{seq:1,ax:0,az:0,yaw:0,pitch:0,flags:B.MELEE,slot:0});world.step(1/60);
 const events=world.drainEvents();assert.deepEqual(events.filter(e=>e.id==='local').map(e=>e.type),['melee'],'knife diagnostic input emits only melee, never a firearm shot');
 Game.prototype.event.call(game,events[0]);assert.equal(renderer.swing,.3,'authoritative melee event reached Renderer.melee');
 render(renderer,'edge',{flags:0,time:1,dt:.001});const start=renderer.weaponRig.position.clone();
 render(renderer,'edge',{flags:0,time:1.15,dt:.149});const mid=renderer.weaponRig.position.clone();
 render(renderer,'edge',{flags:0,time:1.3,dt:.15});const end=renderer.weaponRig.position.clone();
 assert.ok(mid.distanceTo(start)>.1,'fixed 150 ms mid-swing production frame offsets the rendered knife rig');
 assert.ok(end.distanceTo(start)<.03,'fixed 300 ms recovery frame returns the rendered knife rig near rest');
});

test('actual Input pulse and World state cancel repeated reloads on switch/death without changing combat timing',()=>{
 const bindings={reload:'KeyR',sprint:'ShiftLeft'};
 const input={enabled:true,held:new Set(),pulses:0,prone:false,tacticalLatch:false,slot:0,seq:0,yaw:0,pitch:0,lastShift:-1000,getSettings:()=>({bindings}),onAction(){},onScoreboard(){}};
 const press=code=>Input.prototype.key.call(input,{code,repeat:false,preventDefault(){}},true);
 press('KeyR');const first=Input.prototype.sample.call(input,true);assert.ok(first.flags&B.RELOAD,'actual Input produces reload pulse');
 const world=new World({seed:23}),player=world.addPlayer({id:'local',name:'local'});player.ammo[0]=0;player.reserve[0]=5;player.protectUntil=-1;
 world.setInput('local',first);world.step(1/60);const initial=player.reloadLeft;assert.ok(initial>0,'reload began through input/world wiring');
 world.setInput('local',{...first,seq:first.seq+1,flags:0});world.step(1/60);press('KeyR');world.setInput('local',Input.prototype.sample.call(input,true));world.step(1/60);
 assert.ok(player.reloadLeft<initial,'a repeated reload pulse does not restart the current timing');
 player.input.slot=1;world.step(1/60);assert.equal(player.reloadLeft,0,'slot switch cancels reload');assert.equal(player.reloadTotal,0,'slot switch clears visual reload total');
 player.ammo[1]=0;player.reserve[1]=2;assert.equal(world.startReload(player),true);world.damage(player,null,500);assert.equal(player.reloadLeft,0,'death cancels reload authoritatively');
});

test('weapon switches and death clear transient first-person animation state, while sprint pose returns to rest',()=>{
 const rig=new THREE.Group(),ar4=new THREE.Group(),edge=new THREE.Group();ar4.userData={id:'ar4'};edge.userData={id:'edge'};rig.add(ar4,edge);
 const switched={lastWeapon:'ar4',fpModels:new Map([['ar4',ar4],['edge',edge]]),weaponRig:rig,fpModel:ar4,kick:.1,ads:.8,swing:.3,flashTime:.04,lastShotAt:7};
 Renderer.prototype.setWeapon.call(switched,'edge');
 assert.equal(switched.fpModel,edge);assert.equal(switched.kick,0);assert.equal(switched.ads,0);assert.equal(switched.swing,0);assert.equal(switched.flashTime,0);
 const {renderer}=fixture('ar4');render(renderer,'ar4',{flags:B.SPRINT,speed:8,time:7});const sprintRotation=renderer.weaponRig.rotation.toArray();
 render(renderer,'ar4',{flags:0,speed:0,time:7.1});assert.notDeepEqual(renderer.weaponRig.rotation.toArray(),sprintRotation,'ending sprint returns the weapon pose toward rest');
 renderer.kick=.1;renderer.swing=.3;renderer.flashTime=.04;renderer.ads=.9;render(renderer,'ar4',{alive:false,time:7.2});
 assert.equal(renderer.kick,0);assert.equal(renderer.swing,0);assert.equal(renderer.flashTime,0);assert.equal(renderer.ads,0);
});

test('distinct first-person weapon instances retain independent reload transforms',()=>{
 const a=fixture('ar4',['mag']),b=fixture('ar4',['mag']);render(a.renderer,'ar4',{reload:1,time:8});
 assert.ok(a.parts.mag.position.y<-.01);assert.deepEqual(b.parts.mag.position.toArray(),[0,0,0]);
 render(b.renderer,'ar4',{reload:1,time:8.1});assert.ok(b.parts.mag.position.y<-.01);
});
