import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import {MODEL_DEFS,loadCharacterAssets} from '../client/models.js';
import {Renderer} from '../client/renderer.js';
import {UI} from '../client/ui.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({close(){}});
function installCanvas(){
  globalThis.document ??={};
  document.createElement=(tag)=>tag==='canvas'?{width:0,height:0,getContext(){return {fillStyle:'',textAlign:'',textBaseline:'',font:'',fillRect(){},fillText(){},drawImage(){},putImageData(){}};},toDataURL(){return 'data:image/png;base64,';}}:{};
}
installCanvas();
const embedded={};
for(const [id,def] of Object.entries(MODEL_DEFS))embedded[id]=(await readFile(new URL('../'+def.file,import.meta.url))).toString('base64');
globalThis.__HAMU_MODEL_DATA=embedded;
await loadCharacterAssets();

const member=(id='self',operator='sentinel')=>({id,username:id,operator,loadout:['ar4','relay9','edge']});
function lobbyRenderer(extra={}){
  return Object.assign(Object.create(Renderer.prototype),{modelReady:true,menuScene:new THREE.Scene(),menuPartyModels:[],pendingMenuParty:[],pendingMenuOperator:'sentinel',localMemberId:'self',...extra});
}

test('equip-weapon action invokes the real syncPartyKit handler after immediate menu update',async()=>{
  const order=[],me=member();
  const ui={audio:{unlock(){order.push('unlock');},ui(){order.push('ui');}},auth:{user:{id:'self'}},store:{data:{operator:'sentinel',loadout:['ar4','relay9','edge']},save(){order.push('save');}},network:{status:'connected',party:{status:'idle',leaderId:'self',members:[me]},request:async(op,data)=>{order.push('request');Object.assign(me,data);}},renderer:{setMenuParty(){order.push('setMenuParty');}},nav(){order.push('nav');},toast(){order.push('toast');}};
  ui.syncPartyKit=UI.prototype.syncPartyKit;
  await UI.prototype.click.call(ui,{dataset:{action:'equip-weapon',id:'lancer7'},disabled:false});
  assert.equal(ui.store.data.loadout[0],'lancer7');
  assert.deepEqual(order.slice(order.indexOf('setMenuParty')),['setMenuParty','nav','toast','request']);
  assert.deepEqual(me.loadout,['lancer7','relay9','edge']);
});

test('deferred operator selection retains nonzero yaw when model loading completes without explicit yaw',()=>{
  const previous=globalThis.hamuMaster;
  try{
    globalThis.hamuMaster={auth:{user:{id:'self'}},store:{data:{operator:'frontline',loadout:['ar4','relay9','edge'],menuYawByOperator:{frontline:0}}},network:{party:{members:[member('self','frontline')]}}};
    const r=lobbyRenderer({modelReady:false});
    r.setMenuOperator('frontline',1.37);
    assert.equal(r.pendingMenuRotation.yaw,1.37);
    r.modelReady=true;r.setMenuOperator('frontline');
    assert.equal(r.menuOperator.userData.menuYaw,1.37);
  } finally {globalThis.hamuMaster=previous;}
});

test('ready no-yaw operator selection preserves the saved store yaw',()=>{
  const previous=globalThis.hamuMaster;
  try {
    globalThis.hamuMaster={auth:{user:{id:'self'}},store:{data:{operator:'frontline',loadout:['ar4','relay9','edge'],menuYawByOperator:{frontline:.83}}},network:{party:{members:[member('self','frontline')]}}};
    const r=lobbyRenderer();r.setMenuOperator('frontline');
    assert.equal(r.menuOperator.userData.menuYaw,.83);
  } finally {globalThis.hamuMaster=previous;}
});

test('disposeLobbyItem disposes the unique hit geometry and material',()=>{
  const r=lobbyRenderer();const model=new THREE.Group(),pad=new THREE.Group();
  const hit=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());const label=new THREE.Sprite(new THREE.SpriteMaterial());
  let geometryDisposed=0,materialDisposed=0;hit.geometry.dispose=()=>geometryDisposed++;hit.material.dispose=()=>materialDisposed++;
  r.disposeLobbyItem({model,pad,hit,label});
  assert.equal(geometryDisposed,1);assert.equal(materialDisposed,1);
});

test('clear removes remotes and disposes owned model, skeleton, name texture and material',()=>{
  const r=lobbyRenderer({scene:new THREE.Scene(),players:new Map(),effects:{clear(){}}});const p={...member('remote','sentinel'),name:'Remote',team:1,bot:false};const item=r.createRemote(p);
  assert.ok(item);const resources=[];
  item.model.traverse(o=>{if(o.geometry?.userData?.visualOwned)resources.push(o.geometry);if(o.isSkinnedMesh&&o.skeleton)resources.push(o.skeleton);});
  resources.push(item.model.userData.teamMaterial,item.name.material,item.name.material.map);
  const counts=new Map(resources.map(x=>[x,0]));for(const x of resources){const d=x.dispose?.bind(x);if(d)x.dispose=()=>{counts.set(x,counts.get(x)+1);return d();};}
  r.clear();
  assert.equal(r.players.size,0);assert.equal(r.scene.children.includes(item.model),false);
  for(const [resource,count] of counts)assert.equal(count,1,resource?.type||'resource');
});

test('updateRemote self avoids createRemote and changed/removal remotes are cleaned up',()=>{
  const r=lobbyRenderer({scene:new THREE.Scene(),players:new Map(),effects:{clear(){}}});let creates=0,removes=0;const originalCreate=r.createRemote.bind(r),originalRemove=r.removeRemote.bind(r);
  r.createRemote=(p)=>{creates++;return originalCreate(p);};r.removeRemote=(id,item)=>{removes++;return originalRemove(id,item);};
  const state={mode:'tdm',time:0};const self={id:'self',team:0};
  const base={...member('remote','sentinel'),name:'Remote',team:1,x:1,y:0,z:2,yaw:0,vx:0,vz:0,vy:0,height:1.78,alive:true,grounded:true,slide:0,slot:0,loadout:['ar4','relay9','edge'],ads:false,pitch:0,reloadLeft:0,reloadTotal:1,protectUntil:0,firedAt:0};
  r.updateRemote({...base,id:'self'},self,state,0);assert.equal(creates,0);
  r.updateRemote(base,self,state,0);assert.equal(creates,1);const first=r.players.get('remote');
  r.updateRemote({...base,operator:'frontline'},self,state,0);assert.equal(removes,2);assert.notEqual(r.players.get('remote'),first);
  r.clear();assert.equal(removes,3);assert.equal(r.players.size,0);
});
