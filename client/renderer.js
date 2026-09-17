import * as THREE from '../vendor/three.module.js';
import { MAP } from '../shared/map.js';
import { WEAPONS, OPERATORS, cleanOperator } from '../shared/weapons.js';
import { eyeHeight } from '../shared/physics.js';
import { B, wrapAngle, clamp } from '../shared/protocol.js';
import { buildArena, buildMenuScene, createWeapon, textTexture, disposeVisual } from './geometry.js';
import { animateOperator, animateWeapon } from './animation.js';
import { loadCharacterAssets, createImportedCharacter, equipImportedWeapon } from './models.js';
import { Effects, flashTexture } from './effects.js';
import { loadWeaponAssets } from './weapon-models.js';
import { weaponViewPose } from './weapon-view.js';

const BLUE='#76d6eb',ORANGE='#ee9864';
export class Renderer {
  constructor(canvas,settings) {
    this.canvas=canvas;this.settings=settings;this.players=new Map();this.menuModels=new Map();this.menuPartyModels=[];this.fpModels=new Map();this.kick=0;this.swing=0;this.flashTime=0;this.shake=0;this.ads=0;this.lastWeapon=null;
    this.flyEditor={active:false,pos:new THREE.Vector3(),yaw:0,pitch:0,keys:new Set(),dragging:false};this.menuDrag={active:false,lastX:0,operatorId:null};
    this.editorRaycaster=new THREE.Raycaster();this.editorPointer=new THREE.Vector2();this.editorHighlight=null;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',alpha:false});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.16;this.renderer.autoClear=false;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#90a7b0');this.scene.fog=new THREE.Fog('#90a7b0',45,130);
    this.camera=new THREE.PerspectiveCamera(settings.fov,1,.06,160);this.camera.rotation.order='YXZ';
    this.scene.add(new THREE.HemisphereLight('#d0e6f4','#676957',2.7));
    this.sun=new THREE.DirectionalLight('#ffeec9',2.8);this.sun.position.set(-32,50,25);this.sun.castShadow=true;this.sun.shadow.camera.left=-45;this.sun.shadow.camera.right=45;this.sun.shadow.camera.top=42;this.sun.shadow.camera.bottom=-42;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=130;this.sun.shadow.normalBias=.025;this.sun.shadow.bias=-.0001;this.scene.add(this.sun);
    this.arena=buildArena(this.scene);this.effects=new Effects(this.scene);
    this.effects.shotOrigin=event=>this.weaponShotOrigin(event);
    const menu=buildMenuScene();this.menuScene=menu.scene;this.menuLight=menu.key;this.menuCamera=new THREE.PerspectiveCamera(37,1,.08,65);this.menuCamera.position.set(4.9,2.7,7.7);this.menuCamera.lookAt(.15,1.75,0);
    this.fpScene=new THREE.Scene();this.fpCamera=new THREE.PerspectiveCamera(72,1,.012,8);
    this.fpScene.add(new THREE.HemisphereLight('#f0f2dd','#3c5669',3.2));const fpLight=new THREE.DirectionalLight('#ffe6b2',2.5);fpLight.position.set(-2,3,1);this.fpScene.add(fpLight);
    this.weaponRig=new THREE.Group();this.fpScene.add(this.weaponRig);
    this.flash=new THREE.Sprite(new THREE.SpriteMaterial({map:flashTexture(),color:'#ffdaa4',transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false}));this.flash.visible=false;
    this.fpScene.add(this.flash);this.modelReady=false;this.modelError=null;this.menuOperator=null;
    // Independent preload: a missing weapon never blocks characters, input or lobby.
    this.weaponModelPromise=loadWeaponAssets().then(results=>{for(const result of results)if(result.status==='rejected')console.warn('Weapon model unavailable; keep the supplied assets/models/weapons folder intact.',result.reason);return results;});
    this.modelPromise=loadCharacterAssets((id,loaded,total)=>{this.modelProgress={id,loaded,total};}).then(()=>{this.modelReady=true;this.setMenuOperator(this.pendingMenuOperator||'sentinel');try{this.generateOperatorPortraits();}catch(error){console.warn('Character portraits unavailable; gameplay is still ready.',error);}}).catch(error=>{this.modelError=error;console.error('Character model preload failed:',error);const notice=document.createElement('div');notice.setAttribute('role','alert');notice.textContent='Character models could not load. Keep the assets/models folder intact, run the Node server, then refresh this page. No account data has been reset.';notice.style.cssText='position:fixed;z-index:10000;bottom:12px;left:12px;right:12px;padding:14px;background:#742b28;color:white;font:14px system-ui';document.body.append(notice);});
    this.applySettings(settings);this.resize();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);window.addEventListener('resize',()=>this.resize());this.installMenuCharacterDrag((yaw,id)=>{this.menuOperator&&(this.menuOperator.userData.operatorId=id);this.canvas.dispatchEvent(new CustomEvent('hamu-menu-rotate',{detail:{operatorId:id,yaw}}));});
  }
  applySettings(settings) {
    this.settings=settings;const quality=settings.quality;this.effects.quality=quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,quality==='high'?1.6:quality==='medium'?1:.8));
    this.renderer.shadowMap.enabled=quality!=='low';const size=quality==='high'?2048:1024;
    if(this.sun.shadow.mapSize.x!==size){this.sun.shadow.mapSize.set(size,size);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;}
    this.resize();
  }
  resize() {
    const width=this.canvas.parentElement.clientWidth||window.innerWidth,height=this.canvas.parentElement.clientHeight||window.innerHeight;
    this.width=width;this.height=height;this.renderer.setSize(width,height,false);
    for(const camera of [this.camera,this.menuCamera,this.fpCamera]){camera.aspect=width/height;camera.updateProjectionMatrix();}
    this.menuCamera.fov=width/height<1.1?47:37;this.menuCamera.updateProjectionMatrix();
  }
  generateOperatorPortraits(){
    if(this.operatorPortraitsReady||!this.modelReady)return;this.operatorPortraitsReady=true;this.operatorPortraits=new Map();
    const width=360,height=420,target=new THREE.WebGLRenderTarget(width,height,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,depthBuffer:true});target.texture.colorSpace=THREE.SRGBColorSpace;
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(31,width/height,.05,20);camera.position.set(2.55,1.58,4.15);camera.lookAt(0,1.03,0);
    scene.add(new THREE.HemisphereLight('#e7f3ff','#25313b',3.5));const key=new THREE.DirectionalLight('#ffe1b0',4.2);key.position.set(-3,5,4);scene.add(key);const rim=new THREE.DirectionalLight('#72b9e7',2.2);rim.position.set(4,3,-3);scene.add(rim);
    const previousTarget=this.renderer.getRenderTarget(),clearColor=this.renderer.getClearColor(new THREE.Color()).clone(),clearAlpha=this.renderer.getClearAlpha();
    try{for(const operator of OPERATORS){const model=createImportedCharacter(operator.id,operator.color);model.rotation.y=Math.PI+.18;model.position.y=0;scene.add(model);for(let i=0;i<8;i++)animateOperator(model,{dt:1/30,speed:0,grounded:true,aiming:true,pitch:-.04,time:i/30});
      this.renderer.setRenderTarget(target);this.renderer.setClearColor(0x000000,0);this.renderer.clear(true,true,true);this.renderer.render(scene,camera);
      const pixels=new Uint8Array(width*height*4);this.renderer.readRenderTargetPixels(target,0,0,width,height,pixels);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d'),flipped=new Uint8ClampedArray(pixels.length),row=width*4;for(let y=0;y<height;y++)flipped.set(pixels.subarray(y*row,(y+1)*row),(height-1-y)*row);context.putImageData(new ImageData(flipped,width,height),0,0);this.operatorPortraits.set(operator.id,canvas.toDataURL('image/png'));scene.remove(model);disposeVisual(model);
    }}finally{this.renderer.setRenderTarget(previousTarget);this.renderer.setClearColor(clearColor,clearAlpha);target.dispose();}
    document.dispatchEvent(new CustomEvent('hamu-operator-portraits'));
  }
  _makeLobbyModel(member,index){
    const id=member.operator||'sentinel',model=createImportedCharacter(id);
    model.scale.setScalar(1.72);
    const positions=[[-2.05,0,.24],[-.68,0,0],[.68,0,0],[2.05,0,.24]];
    const pos=positions[index]||[index*1.0,0,.2];model.position.set(pos[0],0,pos[2]);
    const pad=new THREE.Group();pad.name='LobbyCharacterPad';pad.position.set(pos[0],.028,pos[2]);
    const outer=new THREE.Mesh(new THREE.CircleGeometry(.82,64),new THREE.MeshBasicMaterial({color:'#1578ff',transparent:true,opacity:.13,depthWrite:false,depthTest:false}));
    const mid=new THREE.Mesh(new THREE.CircleGeometry(.56,64),new THREE.MeshBasicMaterial({color:'#2196ff',transparent:true,opacity:.21,depthWrite:false,depthTest:false}));
    const inner=new THREE.Mesh(new THREE.CircleGeometry(.33,64),new THREE.MeshBasicMaterial({color:'#67c7ff',transparent:true,opacity:.30,depthWrite:false,depthTest:false}));
    for(const disc of [outer,mid,inner]){disc.rotation.x=-Math.PI/2;pad.add(disc);}
    this.menuScene.add(pad);model.userData.lobbyPad=pad;
    const hit=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,2.65,20),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false}));
    hit.name='LobbyCharacterHitArea';hit.position.set(0,1.28,0);hit.userData.lobbyHitArea=true;model.add(hit);
    const label=textTexture(member.username||'PLAYER',{color:'#dce8f0',size:256});const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:label,transparent:true,depthTest:false,depthWrite:false}));sprite.scale.set(.95,.32,1);sprite.position.set(0,2.02,0);model.add(sprite);
    this.menuScene.add(model);return {model,pad,hit,memberId:member.id,operator:id,index,username:member.username||'PLAYER',loadout:Array.isArray(member.loadout)?member.loadout:[],label:sprite};
  }
  disposeLobbyItem(item){this.menuScene.remove(item.model,item.pad);if(item.cancelPrompt){item.model.remove(item.cancelPrompt);item.cancelPrompt.material.map?.dispose();item.cancelPrompt.material.dispose();item.cancelPrompt=null;}disposeVisual(item.model);item.hit?.geometry.dispose();item.hit?.material.dispose();item.label?.material.map?.dispose();item.label?.material.dispose();item.pad?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
  _lobbyPositions(count,index,isLeader){
    if(isLeader)return [0,0];
    const guests=[[-1.18,-.42],[1.18,-.42],[-2.02,-.78],[2.02,-.78]];
    return guests[Math.max(0,index)]||[index%2?-2.35:2.35,-.95];
  }
  setMenuParty(members=[],leaderId=globalThis.hamuMaster?.network?.party?.leaderId){
    this.pendingMenuParty=members;this.pendingMenuLeaderId=leaderId;if(!this.modelReady)return;
    const selfId=this.localMemberId||globalThis.hamuMaster?.auth?.user?.id;
    const list=(members||[]).slice(0,4).map(m=>({...m,operator:cleanOperator(m.id===selfId?(globalThis.hamuMaster?.store?.data?.operator||this.pendingMenuOperator||m.operator):m.operator)}));
    if(!list.length)list.push({id:selfId||'local',username:globalThis.hamuMaster?.store?.data?.profile?.name||'PLAYER',operator:cleanOperator(this.pendingMenuOperator),loadout:globalThis.hamuMaster?.store?.data?.loadout||['ar4','relay9','edge']});
    const authoritativeLeaderId=leaderId||this.pendingMenuLeaderId||list[0]?.id;
    const old=new Map(this.menuPartyModels.map(item=>[item.memberId,item]));
    this.menuPartyModels=list.map((member,index)=>{let item=old.get(member.id);old.delete(member.id);
      if(item&&item.operator!==member.operator){this.disposeLobbyItem(item);item=null;}
      if(!item)item=this._makeLobbyModel(member,index);
      if(item.username!==member.username){item.label.material.map?.dispose();item.label.material.map=textTexture(member.username||'PLAYER',{color:'#dce8f0',size:256});item.username=member.username;}
      item.loadout=Array.isArray(member.loadout)?member.loadout:[];if(member.id===selfId&&globalThis.hamuMaster?.store)item.loadout=globalThis.hamuMaster.store.data.loadout;
      item.index=index;item.isLeader=member.id===authoritativeLeaderId;const [x,z]=this._lobbyPositions(list.length,index,item.isLeader);
      item.model.position.set(x,0,z);item.pad.position.set(x,.028,z);item.model.scale.setScalar(item.isLeader?1.86:1.56);
      if(member.id===selfId)item.model.userData.menuYaw=Number(globalThis.hamuMaster?.store?.data?.menuYawByOperator?.[member.operator])||0;
      return item;
    });for(const item of old.values())this.disposeLobbyItem(item);
    for(const event of this.pendingCancellationEvents||[])this._applyPartyCancellation(event);this.pendingCancellationEvents=[];
    const self=this.menuPartyModels.find(item=>item.memberId===selfId)||this.menuPartyModels.find(item=>item.isLeader)||this.menuPartyModels[0];this.menuOperator=self?.model||null;this.pendingMenuOperator=self?.operator||this.pendingMenuOperator;
  }
  _applyPartyCancellation(event){
    const item=this.menuPartyModels.find(x=>x.memberId===event.playerId);if(!item){return false;}
    const expiresAt=Math.max(Date.now()+1,Number(event.expiresAt)||Date.now()+2000);
    if(item.cancelPrompt){item.model.remove(item.cancelPrompt);item.cancelPrompt.material.map?.dispose();item.cancelPrompt.material.dispose();item.cancelPrompt=null;}
    const map=textTexture('THIS PLAYER CANCELED',{color:'#f5c45c',size:256});
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthTest:false,depthWrite:false}));sprite.scale.set(1.22,.28,1);sprite.position.set(0,2.34,0);item.model.add(sprite);item.cancelPrompt=sprite;item.cancelPromptExpiresAt=expiresAt;
    return true;
  }
  showPartyCancellation(playerId,username,expiresAt){
    const event={playerId,username,expiresAt:Number(expiresAt)||Date.now()+2000};
    if(!this._applyPartyCancellation(event)){this.pendingCancellationEvents??=[];this.pendingCancellationEvents=this.pendingCancellationEvents.filter(x=>x.playerId!==playerId);this.pendingCancellationEvents.push(event);}
  }
  setMenuOperator(id,yaw){
    id=cleanOperator(id);this.pendingMenuOperator=id;
    // Asset loading may finish after the UI supplied its saved rotation. An
    // omitted yaw means preserve it, not silently replace it with zero.
    if(yaw!==undefined)this.pendingMenuRotation={id,yaw:Number(yaw)||0};
    if(!this.modelReady)return;
    const party=globalThis.hamuMaster?.network?.party;this.setMenuParty(party?.members||this.pendingMenuParty||[],party?.leaderId||this.pendingMenuLeaderId);
    if(this.menuOperator&&this.pendingMenuRotation?.id===id)this.menuOperator.userData.menuYaw=this.pendingMenuRotation.yaw;
    this.pendingMenuRotation=null;
  }
  installMenuCharacterDrag(onRotate){
    if(this._menuCharacterDragInstalled)return;this._menuCharacterDragInstalled=true;
    const canvas=this.canvas,ray=new THREE.Raycaster(),point=new THREE.Vector2();
    // Lobby models stay loaded during matches, but must never capture gameplay clicks.
    const canDrag=()=>{const menu=document.getElementById('menu');return !!menu&&!menu.classList.contains('hidden')&&!menu.classList.contains('in-game-settings')&&!document.pointerLockElement&&!this.flyEditor.active;};
    const hitCharacter=(e)=>{if(!canDrag()||!this.menuPartyModels.length)return false;const r=canvas.getBoundingClientRect();point.x=((e.clientX-r.left)/r.width)*2-1;point.y=-((e.clientY-r.top)/r.height)*2+1;ray.setFromCamera(point,this.menuCamera);const hits=ray.intersectObjects(this.menuPartyModels.map(x=>x.hit||x.model),true);if(!hits.length)return false;let o=hits[0].object;while(o.parent&&!this.menuPartyModels.some(x=>x.model===o))o=o.parent;const item=this.menuPartyModels.find(x=>x.model===o);if(!item)return false;this.menuOperator=item.model;this.menuDrag.operatorId=item.operator;return true;};
    const begin=(e)=>{if(e.button!==0||!hitCharacter(e))return;this.menuDrag={active:true,lastX:e.clientX,operatorId:this.menuOperator?.userData?.operatorId};canvas.style.cursor='grabbing';e.preventDefault();e.stopPropagation();};
    canvas.addEventListener('mousedown',begin,true);document.addEventListener('mousedown',e=>{if(e.button!==0||this.flyEditor.active)return;const t=e.target;if(t?.closest?.('button,a,input,select,textarea,[contenteditable="true"]'))return;begin(e);},true);
    window.addEventListener('mousemove',e=>{const d=this.menuDrag;if(!d.active||!this.menuOperator)return;if(!canDrag()){d.active=false;canvas.style.cursor='';return;}const dx=e.clientX-d.lastX;d.lastX=e.clientX;this.menuOperator.userData.menuYaw=(Number(this.menuOperator.userData.menuYaw)||0)+dx*.012;if(onRotate)onRotate(this.menuOperator.userData.menuYaw,d.operatorId);});
    window.addEventListener('mouseup',e=>{if(!this.menuDrag.active||e.button!==0)return;this.menuDrag.active=false;canvas.style.cursor='';if(onRotate)onRotate(this.menuOperator?.userData?.menuYaw||0,this.menuOperator?.userData?.operatorId);});
  }
  renderMenu(time,dt) {
    // Full-page panels cover the stage: retain its last frame instead of rendering invisible animation.
    const interior=document.getElementById('menu')?.classList.contains('interior');if(interior&&this._interiorFrame)return;this._interiorFrame=!!interior;
    if(!this.menuPartyModels.length){this.renderer.clear();this.renderer.render(this.menuScene,this.menuCamera);return;}
    for(const item of this.menuPartyModels){const model=item.model;const yaw=Number(model.userData.menuYaw)||0;model.rotation.y=Math.PI+.12+yaw;model.position.y=0;model.scale.setScalar(item.isLeader?1.86:1.56);if(item.cancelPrompt&&Date.now()>=item.cancelPromptExpiresAt){model.remove(item.cancelPrompt);item.cancelPrompt.material.map?.dispose();item.cancelPrompt.material.dispose();item.cancelPrompt=null;}const pad=item.pad;if(pad){const pulse=.92+Math.sin(time*2.2+item.index*.45)*.05;pad.scale.set(pulse,pulse,pulse);pad.children.forEach((disc,i)=>disc.material.opacity=([.13,.21,.30][i])*(.92+Math.sin(time*2.2+i*.7+item.index)*.08));}const weapon=item.loadout?.[0]||'ar4';try{if(item.weapon!==weapon){equipImportedWeapon(model,weapon);item.weapon=weapon;}}catch{}animateOperator(model,{dt,speed:.18,grounded:true,aiming:true,pitch:-.08,time});}
    this.renderer.clear();this.renderer.render(this.menuScene,this.menuCamera);
  }
  setWeapon(id) {
    if(this.lastWeapon===id)return;this.lastWeapon=id;
    for(const model of this.fpModels.values())model.visible=false;
    if(!this.fpModels.has(id)){const model=createWeapon(id,{hands:true});model.scale.setScalar(.82);this.weaponRig.add(model);this.fpModels.set(id,model);}
    this.fpModel=this.fpModels.get(id);this.fpModel.visible=true;
    // A selected weapon inherits no transient firing, slash, or flash pose.
    this.kick=0;this.ads=0;this.swing=0;this.flashTime=0;this.lastShotAt=-Infinity;
  }
  createRemote(p) {
    if(!this.modelReady)return null;
    const color=p.team===0?BLUE:ORANGE,model=createImportedCharacter(p.operator,color);this.scene.add(model);
    const texture=textTexture(p.name+(p.bot?' · AI':''),{color,size:256});
    const name=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false}));name.scale.set(1.8,.9,1);name.position.y=2.25;model.add(name);
    const item={model,name,operator:p.operator,weapon:'ar4',lastTeam:p.team};this.players.set(p.id,item);return item;
  }
  removeRemote(id,item=this.players.get(id)) {
    if(!item)return;this.scene.remove(item.model);disposeVisual(item.model);
    item.name.material.map?.dispose();item.name.material.dispose();this.players.delete(id);
  }
  updateRemote(p,self,state,time,dt=.016) {
    // The local third-person model was always hidden; don't allocate a full
    // skeleton and weapon for a model that cannot be drawn in this FPS view.
    if(p.id===self.id){this.removeRemote(p.id);return;}
    let item=this.players.get(p.id);if(item&&item.operator!==p.operator){this.removeRemote(p.id,item);item=null;}if(!item){item=this.createRemote(p);if(!item)return;}
    const model=item.model;model.visible=p.alive&&p.id!==self.id;if(!model.visible)return;
    model.position.set(p.x,p.y,p.z);model.rotation.y=-p.yaw;model.scale.set(1,1,1);
    const speed=Math.hypot(p.vx,p.vz),crouch=Math.max(0,Math.min(1,(1.78-p.height)/.70)),id=p.loadout[p.slot];
    // Swap before posing so the hands solve against the selected weapon on this same frame.
    if(item.weapon!==id){
      equipImportedWeapon(model,id);item.weapon=id;
    }
    const shot=item.firedAt!==undefined&&item.firedAt!==p.firedAt?1:0;item.firedAt=p.firedAt;
    animateOperator(model,{dt,speed,crouch,slide:Math.min(1,(p.slide||0)/.68),grounded:p.grounded,airborne:!p.grounded,verticalVelocity:p.vy,moveX:p.vx*Math.cos(p.yaw)+p.vz*Math.sin(p.yaw),moveZ:-p.vx*Math.sin(p.yaw)+p.vz*Math.cos(p.yaw),reload:p.reloadLeft>0?1-p.reloadLeft/Math.max(.01,p.reloadTotal):0,aiming:p.ads,pitch:p.pitch,shot,shotAge:Math.max(0,state.time-p.firedAt),time});
    const friendly=state.mode!=='ffa'&&p.team===self.team;
    item.name.visible=friendly;const teamColor=friendly?BLUE:ORANGE;model.userData.teamMaterial.color.set(teamColor);model.userData.teamMaterial.emissive.set(teamColor);model.userData.teamMaterial.emissiveIntensity=p.protectUntil>state.time?1.8:.35;
  }
  // Cosmetic tracer origin only: event endpoints, aim rays and damage stay authoritative.
  weaponShotOrigin(event){
    if(event.id===this.localPlayerId){
      const gun=this.fpModel;if(!gun||gun.userData.id!==event.weapon)return null;
      gun.updateWorldMatrix(true,false);const muzzle=gun.localToWorld(gun.userData.muzzle.clone());
      // FP and world cameras have different FOVs. Preserve the muzzle screen pixel.
      const distance=muzzle.length();muzzle.project(this.fpCamera);muzzle.z=.5;
      this.camera.updateMatrixWorld();return muzzle.unproject(this.camera).sub(this.camera.position).normalize().multiplyScalar(distance).add(this.camera.position).toArray();
    }
    const gun=this.players.get(event.id)?.model?.userData.gun;
    if(!gun||gun.userData.id!==event.weapon)return null;
    gun.updateWorldMatrix(true,false);return gun.localToWorld(gun.userData.muzzle.clone()).toArray();
  }
  renderGame(state,self,input,dt,time) {
    if(!self)return;this.localPlayerId=self.id;
    const activeIds=new Set(state.players.map(p=>p.id));
    for(const [id,item]of this.players)if(!activeIds.has(id))this.removeRemote(id,item);
    for(const p of state.players)this.updateRemote(p,self,state,time,dt);
    for(const [id,item] of this.arena.objectives) {
      const obj=state.objectives.find(o=>o.id===id),color=obj?.owner===0?BLUE:obj?.owner===1?ORANGE:'#b5c4c1';
      item.ring.visible=state.mode==='dom';item.marker.visible=state.mode==='dom';item.ring.material.color.set(color);item.ring.material.opacity=obj?.contested?.35+.3*Math.sin(time*12):.65;
    }
    for(const beacon of this.arena.supplies){beacon.rotation.y=time;beacon.position.y=.86+Math.sin(time*2)*.07;}
    this.effects.update(dt,state.grenades);
    if(this.flyEditor.active){this.updateFlyEditor(dt);if(this.editorHighlight){this.editorHighlight.box.setFromObject(this._editorHighlightedObject||this.scene);}this.renderer.clear();this.renderer.render(this.scene,this.camera);return;}
    const w=WEAPONS[self.loadout[self.slot]];this.setWeapon(w.id);
    // Death must not leave a shot, slash, flash, or ADS pose queued for respawn.
    if(!self.alive){this.ads=0;this.kick=0;this.swing=0;this.flashTime=0;this.lastShotAt=-Infinity;}
    // Do not blend a firearm's prior ADS state onto the knife when it is selected.
    if(w.category==='Melee')this.ads=0;
    const adsTarget=(input.flags&B.ADS)&&self.alive&&self.reloadLeft<=0&&self.slot!==2?1:0;
    this.ads+=(adsTarget-this.ads)*(1-Math.exp(-14*dt));this.kick*=Math.exp(-16*dt);this.shake*=Math.exp(-10*dt);this.swing=Math.max(0,this.swing-dt);
    const reduced=this.settings.reducedMotion,speed=Math.hypot(self.vx,self.vz),bob=reduced?0:Math.sin(time*speed*1.7)*Math.min(.027,speed*.003)*(1-this.ads*.8)*(self.grounded?1:0);
    this.camera.position.set(self.x,self.y+eyeHeight(self)+bob-(self.alive?0:.45),self.z);
    const shake=reduced?0:this.shake;
    this.camera.rotation.set(input.pitch+(Math.random()-.5)*shake,-input.yaw+(Math.random()-.5)*shake,(!reduced?-input.ax*.014*(1-this.ads):0),'YXZ');
    const targetFov=this.settings.fov+(Math.min(this.settings.fov,w.adsFov??this.settings.fov-18)-this.settings.fov)*this.ads;
    this.camera.fov+=(targetFov-this.camera.fov)*(1-Math.exp(-15*dt));this.camera.updateProjectionMatrix();
    this.setWeapon(w.id);
    const reloadProgress=self.reloadLeft>0?1-self.reloadLeft/Math.max(.01,self.reloadTotal):0,reloadCurve=self.reloadLeft>0?Math.sin(reloadProgress*Math.PI):0;
    const sprint=!!(input.flags&(B.SPRINT|B.TACTICAL))&&speed>7&&!(input.flags&(B.FIRE|B.ADS));
    const sway=reduced?0:Math.sin(time*speed*1.4)*Math.min(.012,speed*.0015)*(1-this.ads);
    const viewPose=weaponViewPose({weapon:w,metadata:this.fpModel.userData,scale:this.fpModel.scale.y,ads:this.ads,kick:this.kick,reload:reloadProgress,sprint,sway,bob,baseFov:this.settings.fov});
    this.weaponRig.position.fromArray(viewPose.position);this.weaponRig.rotation.set(...viewPose.rotation);
    this.fpCamera.fov=viewPose.viewFov;this.fpCamera.updateProjectionMatrix();
    animateWeapon(this.fpModel,{reload:reloadProgress,shot:Math.min(1,this.kick/.12),shotAge:time-(this.lastShotAt??-Infinity),sprint:sprint?1:0,ads:this.ads,time});
    if(this.swing>0){const arc=Math.sin((1-this.swing/.3)*Math.PI);this.weaponRig.rotation.z-=arc*.8;this.weaponRig.position.z-=arc*.32;this.weaponRig.position.x-=arc*.18;}
    this.flashTime=Math.max(0,this.flashTime-dt);this.flash.visible=this.flashTime>0&&self.alive&&w.category!=='Melee';
    if(this.flash.visible){const muzzle=this.fpModel.userData.muzzle.clone();this.weaponRig.updateMatrixWorld();this.fpModel.localToWorld(muzzle);this.flash.position.copy(muzzle);this.flash.material.rotation=Math.random()*6.28;this.flash.scale.setScalar(.2+Math.random()*.1);}
    this.renderer.clear();this.renderer.render(this.scene,this.camera);
    if(self.alive&&!(w.category==='Sniper rifle'&&this.ads>.85)){this.renderer.clearDepth();this.renderer.render(this.fpScene,this.fpCamera);}
  }
  enableFlyEditor(){
    if(this.flyEditor.active)return;
    const p=this.camera.position.clone();this.flyEditor.active=true;this.flyEditor.pos.copy(p);this.flyEditor.yaw=-this.camera.rotation.y;this.flyEditor.pitch=this.camera.rotation.x;
    this.fpModel&&(this.fpModel.visible=false);this.editorHighlight?.material?.dispose?.();
  }
  disableFlyEditor(){this.flyEditor.active=false;this.flyEditor.keys.clear();this.clearEditorHighlight();this._editorHighlightedObject=null;}
  clearEditorHighlight(){if(this.editorHighlight){this.scene.remove(this.editorHighlight);this.editorHighlight.geometry?.dispose?.();this.editorHighlight.material?.dispose?.();this.editorHighlight=null;}}
  highlightEditorObject(o){
    this.clearEditorHighlight();if(!o)return;this._editorHighlightedObject=o;const box=new THREE.Box3().setFromObject(o);if(box.isEmpty())return;
    const helper=new THREE.Box3Helper(box,0xe7ae35);helper.userData.editorHelper=true;this.scene.add(helper);this.editorHighlight=helper;
  }
  createEditorImage(src,id){
    const texture=new THREE.TextureLoader().load(src);texture.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});const sp=new THREE.Sprite(mat);sp.position.copy(this.flyEditor.active?this.flyEditor.pos:new THREE.Vector3(0,2,-2));sp.scale.set(2,2,1);sp.name='EditorImage';sp.userData.editorImage=true;sp.userData.editorId=id||`img-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;sp.userData.editorLabel='IMAGE';this.scene.add(sp);return sp;
  }
  duplicateEditorObject(o,id){
    if(!o||!o.parent)return null;const copy=o.clone(true);copy.position.x+=.75;copy.position.z+=.75;copy.traverse(n=>{if(n.userData)delete n.userData.editorId;});copy.userData={...(copy.userData||{}),editorId:id||`dup-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`,editorLabel:'DUPLICATE'};o.parent.add(copy);return copy;
  }
  editorRaycast(clientX,clientY){
    const rect=this.canvas.getBoundingClientRect();this.editorPointer.x=((clientX-rect.left)/rect.width)*2-1;this.editorPointer.y=-((clientY-rect.top)/rect.height)*2+1;this.editorRaycaster.setFromCamera(this.editorPointer,this.camera);
    const hits=this.editorRaycaster.intersectObjects(this.scene.children,true).filter(h=>h.object.visible&&!h.object.userData?.editorHelper&&h.object!==this.editorHighlight);
    let o=hits[0]?.object||null;while(o&&o.parent&&o.parent!==this.scene&&!o.userData?.editorId)o=o.parent;return o&&o!==this.scene?o:null;
  }
  updateFlyEditor(dt){
    if(!this.flyEditor.active)return;
    const k=this.flyEditor.keys,speed=(k.has('ShiftLeft')||k.has('ShiftRight'))?10:4.5;
    // FPS-standard camera convention: W = forward, S = backward, D = right, A = left.
    const forward=new THREE.Vector3(-Math.sin(this.flyEditor.yaw),0,-Math.cos(this.flyEditor.yaw)),right=new THREE.Vector3(Math.cos(this.flyEditor.yaw),0,-Math.sin(this.flyEditor.yaw));
    const v=new THREE.Vector3();if(k.has('KeyW'))v.add(forward);if(k.has('KeyS'))v.sub(forward);if(k.has('KeyD'))v.add(right);if(k.has('KeyA'))v.sub(right);if(k.has('KeyE'))v.y+=1;if(k.has('KeyQ'))v.y-=1;if(v.lengthSq())this.flyEditor.pos.addScaledVector(v.normalize(),speed*dt);
    this.camera.position.copy(this.flyEditor.pos);this.camera.rotation.set(this.flyEditor.pitch,-this.flyEditor.yaw,0,'YXZ');this.camera.fov=this.settings.fov;this.camera.updateProjectionMatrix();
  }
  localShot(w){this.lastShotAt=performance.now()/1000;this.kick=Math.min(.12,this.kick+w.recoil*1.4+.025);this.flashTime=.045;}
  melee(){this.swing=.3;}
  damage(){this.shake=.025;}
  clear(){for(const [id,item] of this.players)this.removeRemote(id,item);this.effects.clear();this.ads=0;this.flashTime=0;}
  get stats(){return {calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures};}
}
