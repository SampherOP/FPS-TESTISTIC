import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Renderer } from '../client/renderer.js';
import { Effects } from '../client/effects.js';

test('cosmetic remote tracer origin follows transformed muzzle without mutating shot authority',()=>{
 const gun=new THREE.Group();gun.userData={id:'volt9',muzzle:new THREE.Vector3(0,.022,-.652)};
 const model=new THREE.Group();model.position.set(4,2,-7);model.rotation.y=.7;gun.scale.setScalar(.78);model.add(gun);model.userData.gun=gun;
 const renderer={localPlayerId:'self',players:new Map([['remote',{model}]])};
 const event={id:'remote',weapon:'volt9',origin:[1,2,3],ends:[[20,2,-30]]},before=structuredClone(event);
 const actual=Renderer.prototype.weaponShotOrigin.call(renderer,event),expected=gun.localToWorld(gun.userData.muzzle.clone()).toArray();assert.deepEqual(actual,expected);assert.deepEqual(event,before);
 assert.equal(Renderer.prototype.weaponShotOrigin.call(renderer,{...event,weapon:'relay9'}),null);
 assert.equal(Renderer.prototype.weaponShotOrigin.call(renderer,{...event,id:'gone'}),null);
});

test('first-person tracer projection matches muzzle pixel across distinct FP/world FOVs',()=>{
 const fpCamera=new THREE.PerspectiveCamera(72,16/9,.012,8),camera=new THREE.PerspectiveCamera(95,16/9,.06,160);
 camera.position.set(5,1.6,-8);camera.rotation.set(-.15,.9,0);camera.updateMatrixWorld();
 const rig=new THREE.Group(),gun=new THREE.Group();rig.position.set(.255,-.225,-.64);gun.scale.setScalar(.82);rig.add(gun);gun.userData={id:'volt9',muzzle:new THREE.Vector3(0,.022,-.652)};rig.updateMatrixWorld(true);
 const event={id:'self',weapon:'volt9',origin:[5,1.6,-8],ends:[[40,1,-50]]},before=structuredClone(event);
 const origin=Renderer.prototype.weaponShotOrigin.call({fpModel:gun,localPlayerId:'self',fpCamera,camera},event);
 const pixel=new THREE.Vector3(...origin).project(camera),fpPixel=gun.localToWorld(gun.userData.muzzle.clone()).project(fpCamera);
 assert.ok(Math.abs(pixel.x-fpPixel.x)<1e-10&&Math.abs(pixel.y-fpPixel.y)<1e-10);assert.deepEqual(event,before);
});

test('effect buffers use optional visual origin but retain authoritative impact endpoints',()=>{
 const array=new Float32Array(6),item={mesh:{visible:false,material:{opacity:0},geometry:{attributes:{position:{array,needsUpdate:false}}}},life:0};
 const effects={tracers:[item],index:0,quality:'low',shotOrigin:()=>[.2,.3,-.8]},event={origin:[8,9,10],ends:[[11,12,13]]},before=structuredClone(event);
 Effects.prototype.shot.call(effects,event);assert.deepEqual([...array].slice(3),[11,12,13]);assert.ok(Math.abs(array[0]-.2)<1e-6);assert.deepEqual(event,before);
 effects.shotOrigin=()=>null;Effects.prototype.shot.call(effects,event);assert.deepEqual([...array],[8,9,10,11,12,13]);
});
