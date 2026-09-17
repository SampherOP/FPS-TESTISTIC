import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../vendor/three.module.js';
import {OPERATORS,cleanOperator} from '../shared/weapons.js';
import {MODEL_DEFS,loadCharacterAssets,createImportedCharacter,animateImported} from '../client/models.js';
import {animateOperator} from '../client/animation.js';
import {Renderer} from '../client/renderer.js';
import {UI} from '../client/ui.js';
import {World} from '../shared/simulation.js';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({close(){}});
globalThis.__HAMU_MODEL_DATA={};for(const[id,d]of Object.entries(MODEL_DEFS))globalThis.__HAMU_MODEL_DATA[id]=(await readFile(new URL('../'+d.file,import.meta.url))).toString('base64');await loadCharacterAssets();

test('five unique selectable models; removed green ID migrates without losing the selection',()=>{
 assert.equal(OPERATORS.length,5);assert.equal(new Set(OPERATORS.map(o=>o.id)).size,5);assert.deepEqual(Object.keys(MODEL_DEFS),OPERATORS.map(o=>o.id));
 assert.equal(cleanOperator('commando'),'frontline');assert.equal(createImportedCharacter('commando').userData.operatorId,'frontline');
 assert.ok(!OPERATORS.some(o=>o.id==='commando'));
});
test('bots use only the five canonical operator IDs',()=>{const world=new World();for(let i=0;i<7;i++){const bot=world.addBot();assert.ok(OPERATORS.some(o=>o.id===bot.operator));}});
test('Heavy keeps actual weighted hand geometry and both forearms in front of its chest',()=>{
 const m=createImportedCharacter('juggernaut');for(let i=0;i<30;i++)animateOperator(m,{dt:1/30,aiming:true});m.updateMatrixWorld(true);
 assert.ok(m.userData.aim.position.z<-.12);
 for(const a of m.userData.arms){let weighted=0;m.userData.visual.traverse(o=>{if(!o.isSkinnedMesh)return;const ix=o.skeleton.bones.indexOf(a.hand),si=o.geometry.attributes.skinIndex,sw=o.geometry.attributes.skinWeight;for(let i=0;i<si.count;i++)for(let k=0;k<4;k++)if(si.array[i*4+k]===ix&&sw.array[i*4+k]>.1){weighted++;break;}});assert.ok(weighted>100);const wrist=m.worldToLocal(a.hand.getWorldPosition(new T.Vector3()));assert.ok(wrist.z<-.12);assert.ok(a.hand.getWorldPosition(new T.Vector3()).distanceTo(a.wristTarget)<.035);}
});
test('cached foot sampling preserves the exact original sole minimum through transformed poses',()=>{
 for(const id of Object.keys(MODEL_DEFS)){
  const m=createImportedCharacter(id),all=[],point=new T.Vector3();m.updateMatrixWorld(true);
  m.userData.visual.traverse(o=>{if(!o.isSkinnedMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,point).applyMatrix4(o.matrixWorld);if(m.worldToLocal(point).y<.16)all.push([o,i]);}});
  assert.ok(m.userData.soleSamples.length<all.length);
  m.position.set(13,2,-19);m.rotation.y=.78;m.scale.setScalar(1.72);
  for(const pose of [{speed:8},{crouch:1},{reload:.5},{speed:3,aiming:true}]){
   for(let i=0;i<15;i++)animateOperator(m,{dt:1/30,...pose});m.updateMatrixWorld(true);
   const minimum=list=>{let min=Infinity;const inverse=m.matrixWorld.clone().invert();for(const[o,i]of list){o.getVertexPosition(i,point).applyMatrix4(o.matrixWorld).applyMatrix4(inverse);min=Math.min(min,point.y);}return min;};
   assert.ok(Math.abs(minimum(all)-minimum(m.userData.soleSamples))<1e-6,id);
  }
 }
});
test('animation no longer performs one world inverse per foot vertex',()=>{const m=createImportedCharacter('juggernaut');let calls=0;const original=m.worldToLocal.bind(m);m.worldToLocal=v=>{calls++;return original(v);};for(let i=0;i<10;i++)animateImported(m,{dt:1/60,speed:8});assert.equal(calls,0);});
function lobby(){const r=Object.create(Renderer.prototype);Object.assign(r,{modelReady:true,menuPartyModels:[],menuScene:new T.Scene(),localMemberId:'self',pendingMenuOperator:'frontline',created:0,disposed:0});r._makeLobbyModel=(m,index)=>{r.created++;const model=new T.Group(),pad=new T.Group();model.userData.operatorId=m.operator;return{memberId:m.id,operator:m.operator,username:m.username,model,pad,index,label:{material:{map:{dispose(){}},dispose(){}}}};};r.disposeLobbyItem=()=>{r.disposed++;};return r;}
const party=()=>[{id:'self',username:'Self',operator:'sentinel',loadout:['ar4','relay9','edge']},{id:'friend',username:'Friend',operator:'circuit',loadout:['ar4','relay9','edge']}];
test('lobby renders local selection immediately without overwriting a teammate',()=>{
 const previous=globalThis.hamuMaster;try{globalThis.hamuMaster={auth:{user:{id:'self'}},store:{data:{operator:'juggernaut',loadout:['ar4','relay9','edge']}}};const r=lobby();r.setMenuParty(party());assert.equal(r.menuOperator.userData.operatorId,'juggernaut');assert.equal(r.menuPartyModels[1].operator,'circuit');}finally{globalThis.hamuMaster=previous;}
});
test('unchanged party updates reuse models and only a changed member rebuilds',()=>{const r=lobby(),list=party();r.setMenuParty(list);const initial=r.menuPartyModels.map(x=>x.model);for(let i=0;i<100;i++)r.setMenuParty(list);assert.equal(r.created,2);assert.equal(r.disposed,0);assert.equal(r.menuPartyModels[0].model,initial[0]);list[1].operator='juggernaut';r.setMenuParty(list);assert.equal(r.created,3);assert.equal(r.disposed,1);assert.equal(r.menuPartyModels[0].model,initial[0]);});
test('solo lobby keeps the authoritative leader centered in the visible character stage',()=>{const r=lobby();r.setMenuParty(party().slice(0,1),'self');assert.equal(r.menuOperator.position.x,0);assert.equal(r.menuPartyModels[0].isLeader,true);});
test('selection synchronizes a complete kit to the party and marks nonleaders unready',async()=>{
 const sent=[],me={id:'self',operator:'sentinel',loadout:['ar4','relay9','edge'],ready:true};const ui={auth:{user:{id:'self'}},store:{data:{operator:'juggernaut',loadout:['lancer7','flick45','edge']}},network:{status:'connected',party:{status:'idle',leaderId:'friend',members:[me]},request:async(op,data)=>{sent.push({op,data});Object.assign(me,data);}}};ui.syncPartyKit=UI.prototype.syncPartyKit;
 await ui.syncPartyKit();assert.equal(sent.length,1);assert.deepEqual(sent[0],{op:'party.ready',data:{ready:false,operator:'juggernaut',loadout:['lancer7','flick45','edge']}});await ui.syncPartyKit();assert.equal(sent.length,1);
});
test('a rapid second selection is synchronized after an in-flight kit request',async()=>{
 const sent=[],me={id:'self',operator:'sentinel',loadout:['ar4','relay9','edge']};const ui={auth:{user:{id:'self'}},store:{data:{operator:'frontline',loadout:['ar4','relay9','edge']}},network:{status:'connected',party:{status:'idle',leaderId:'self',members:[me]},request:async(op,data)=>{sent.push(data.operator);Object.assign(me,data);if(sent.length===1)ui.store.data.operator='juggernaut';}}};ui.syncPartyKit=UI.prototype.syncPartyKit;await ui.syncPartyKit();assert.deepEqual(sent,['frontline','juggernaut']);
});
