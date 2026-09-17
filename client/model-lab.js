import {Renderer} from './renderer.js';
import {World} from '../shared/simulation.js';
import {B} from '../shared/protocol.js';
import * as T from '../vendor/three.module.js';
import {loadCharacterAssets,createImportedCharacter,equipImportedWeapon,MODEL_DEFS} from './models.js';
import {animateOperator} from './animation.js';
import {createWeapon,disposeVisual} from './geometry.js';
import {WEAPONS} from '../shared/weapons.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);document.body.append(renderer.domElement);renderer.outputColorSpace=T.SRGBColorSpace;
const scene=new T.Scene();scene.background=new T.Color('#70828b');scene.add(new T.HemisphereLight('#eaf7ff','#424636',2.7));const sun=new T.DirectionalLight('#fff0d7',3);sun.position.set(-4,8,-6);scene.add(sun);const plane=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:'#61696c',roughness:1}));plane.rotation.x=-Math.PI/2;plane.position.y=-.005;scene.add(plane,new T.GridHelper(20,40));
const camera=new T.PerspectiveCamera(34,innerWidth/innerHeight,.01,100);camera.position.set(0,2.3,-6.9);camera.lookAt(0,1,0);
const environment=document.querySelector('#environment');
const state=document.querySelector('#state'),weapon=document.querySelector('#weapon'),view=document.querySelector('#view'),phase=document.querySelector('#phase');for(const [id,w] of Object.entries(WEAPONS))weapon.add(new Option(w.name,id));
await loadCharacterAssets();let models=[];function rebuild(){for(const m of models){scene.remove(m);disposeVisual(m);}models=Object.keys(MODEL_DEFS).map((id,i)=>{const m=createImportedCharacter(id);m.position.x=(1-i)*1.7;scene.add(m);return m;});swap();}
function swap(){for(const m of models)equipImportedWeapon(m,weapon.value);}
weapon.onchange=swap;state.onchange=rebuild;view.onchange=()=>{camera.position.set(view.value==='side'?-5:0,2.3,view.value==='back'?6.9:view.value==='side'?-4:-6.9);camera.lookAt(0,1,0);};rebuild();let prev=performance.now();
const gameCanvas=document.createElement('canvas');document.body.append(gameCanvas);const gameRenderer=new Renderer(gameCanvas,{fov:95,quality:'high',reducedMotion:false});await gameRenderer.modelPromise;
let world,actors,self,modeSince=0,seq=0,previousMode='';
function resetGame(){world=new World({mode:'ffa',duration:600});self=world.addPlayer({id:'observer',name:'Observer',operator:'sentinel'});self.x=0;self.y=0;self.z=29;self.yaw=0;self.protectUntil=1e9;
actors=Object.keys(MODEL_DEFS).map((id,i)=>{const p=world.addPlayer({id:'review-'+id,name:MODEL_DEFS[id].name,operator:id});p.x=(i-1)*2.1;p.y=0;p.z=24;p.yaw=Math.PI;p.protectUntil=1e9;p.loadout=[weapon.value,'relay9','edge'];return p;});self.loadout=[weapon.value,'relay9','edge'];modeSince=0;}
resetGame();environment.onchange=()=>{resetGame();};
function renderGameplay(dt,t){const mode=state.value;if(mode!==previousMode||actors[0].loadout[0]!==weapon.value){previousMode=mode;resetGame();}modeSince+=dt;
const selected=WEAPONS[weapon.value],shootFlags=mode==='shoot'?(selected.category==='Melee'?B.MELEE:B.FIRE|B.ADS):0;
for(const [i,p] of actors.entries()){let flags=mode==='aim'?B.ADS:mode==='crouch'?B.CROUCH:mode==='run'?B.SPRINT:shootFlags;if((mode==='jump'||mode==='fall')&&modeSince<.10)flags|=B.JUMP;if(mode==='reload'&&modeSince<.06){p.ammo[0]=1;flags|=B.RELOAD;}world.setInput(p.id,{seq:++seq,ax:0,az:['walk','run'].includes(mode)?-1:0,yaw:Math.PI,pitch:0,flags,slot:0});}
let flags=mode==='aim'?B.ADS:shootFlags;if(mode==='reload'&&modeSince<.06){self.ammo[0]=1;flags|=B.RELOAD;}world.setInput(self.id,{seq:++seq,ax:0,az:0,yaw:0,pitch:0,flags,slot:0});world.step(Math.min(dt,1/30));const events=world.drainEvents();for(const e of events){if(e.id!==self.id)continue;if(e.type==='shot')gameRenderer.localShot(WEAPONS[weapon.value]);if(e.type==='melee')gameRenderer.melee();}
if(['walk','run'].includes(mode)){self.z=actors[0].z+5;if(actors[0].z>28)resetGame();}if(['jump','fall','reload'].includes(mode)&&modeSince>3.2)resetGame();
const packet={time:world.time,mode:'ffa',players:[self,...actors],objectives:world.objectives,grenades:[]};gameRenderer.renderGame(packet,self,{flags,pitch:0,yaw:0,ax:0},dt,t);if(environment.value==='gameplay'){gameRenderer.renderer.clear();gameRenderer.renderer.render(gameRenderer.scene,gameRenderer.camera);}
}

function draw(now){const dt=Math.min(.04,(now-prev)/1000);prev=now;const mode=state.value,t=now/1000;for(const m of models){m.userData.gun.visible=mode!=='bind';if(mode!=='bind')animateOperator(m,{dt,time:t,speed:mode==='walk'?3:mode==='run'?8:0,aiming:['aim','shoot'].includes(mode),crouch:mode==='crouch'?1:0,grounded:!['jump','fall'].includes(mode),airborne:['jump','fall'].includes(mode),verticalVelocity:mode==='jump'?4:-4,reload:mode==='reload'?+phase.value:0,shot:mode==='shoot'&&Math.sin(t*10)>.8?1:0});}renderer.domElement.style.display=environment.value==='studio'?'block':'none';gameCanvas.style.display=environment.value==='studio'?'none':'block';if(environment.value==='studio')renderer.render(scene,camera);else renderGameplay(dt,t);document.querySelector('#caption').textContent=`SWAT / Quaternius                         Soldier / Umair Yaqub                         Soldier / madtrollstudio\n${mode} • ${weapon.value} • ${view.value}`;requestAnimationFrame(draw);}requestAnimationFrame(draw);
window.lab={environment,gameRenderer,gameState:()=>({actors,self,world}),capture:()=>{if(environment.value==='studio'){renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');}renderGameplay(.001,performance.now()/1000);return gameRenderer.renderer.domElement.toDataURL('image/png');},models:()=>models,scene,camera,renderer,state,weapon,view,phase,rebuild,swap};
