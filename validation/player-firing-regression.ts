import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Renderer } from '../client/renderer.js';
import { Input } from '../client/input.js';
import { DEFAULT_SETTINGS } from '../client/storage.js';
import { World } from '../shared/simulation.js';
import { B } from '../shared/protocol.js';
const window=new Window();Object.assign(globalThis,{window,document:window.document});
const document=window.document;document.body.innerHTML='<canvas id="world" tabindex="0"></canvas><div id="menu">Lobby</div>';
const canvas=document.querySelector('canvas')!,menu=document.querySelector('#menu')!;
canvas.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600,right:800,bottom:600,x:0,y:0,toJSON(){}});
const camera=new THREE.PerspectiveCamera(37,800/600,.1,100);camera.position.z=5;camera.updateMatrixWorld();
const model=new THREE.Mesh(new THREE.BoxGeometry(3,3,1),new THREE.MeshBasicMaterial());model.userData.operatorId='sentinel';model.updateMatrixWorld();
const renderer=Object.assign(Object.create(Renderer.prototype),{canvas,menuCamera:camera,menuPartyModels:[{model,operator:'sentinel'}],menuOperator:model,flyEditor:{active:false},menuDrag:{active:false}});
let rotations=0;renderer.installMenuCharacterDrag(()=>rotations++);
const input=new Input(canvas,()=>DEFAULT_SETTINGS);input.fallback=true;input.enabled=true;input.inGame=true;
const mouse=(type:string,button=0,x=400)=>canvas.dispatchEvent(new window.MouseEvent(type,{button,buttons:type==='mouseup'?0:button===0?1:2,bubbles:true,cancelable:true,clientX:x,clientY:300}));
menu.className='hidden';mouse('mousedown');
const results:any={fireReceived:!!(input.sample().flags&B.FIRE),menuDragDuringMatch:renderer.menuDrag.active,modes:[]};
for(const mode of ['tdm','ffa','dom']){const w=new World({mode,seed:1}),p=w.addPlayer({id:'human'});for(let i=0;i<60;i++){w.setInput(p.id,input.sample(true));w.step(1/60);}results.modes.push({mode,ammo:p.ammo[0],shots:w.drainEvents().filter(e=>e.type==='shot').length});}
mouse('mouseup');results.released=!(input.sample().flags&B.FIRE);
mouse('mousedown',2);results.ads=!!(input.sample().flags&B.ADS);mouse('mouseup',2);
document.dispatchEvent(new window.KeyboardEvent('keydown',{code:'KeyW',bubbles:true,cancelable:true}));results.forward=input.sample().az===1;document.dispatchEvent(new window.KeyboardEvent('keyup',{code:'KeyW',bubbles:true}));
menu.className='';input.pause();mouse('mousedown');const before=model.userData.menuYaw||0;mouse('mousemove',0,450);mouse('mouseup');results.lobbyRotation=(model.userData.menuYaw||0)!==before&&rotations>0;
mouse('mousedown');const beforeMatch=model.userData.menuYaw;menu.className='hidden';mouse('mousemove',0,480);results.staleDragCancelled=!renderer.menuDrag.active&&model.userData.menuYaw===beforeMatch;mouse('mouseup');
for(const state of ['in-game-settings','pointerlock','fly-editor']){menu.className=state==='in-game-settings'?'in-game-settings':'';renderer.flyEditor.active=state==='fly-editor';Object.defineProperty(document,'pointerLockElement',{value:state==='pointerlock'?canvas:null,configurable:true});mouse('mousedown');results[state]=!renderer.menuDrag.active;mouse('mouseup');}
console.log(JSON.stringify(results,null,2));
if(process.argv.includes('--assert')){assert.equal(results.fireReceived,true);assert.equal(results.menuDragDuringMatch,false);for(const m of results.modes){assert.ok(m.shots>=5);assert.ok(m.ammo<30);}for(const key of ['released','ads','forward','lobbyRotation','staleDragCancelled','in-game-settings','pointerlock','fly-editor'])assert.equal(results[key],true,key);}
await window.happyDOM.close();
