import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperator, createWeapon } from '../client/geometry.js';
import { animateOperator, animateWeapon } from '../client/animation.js';
import { WEAPON_LIST, OPERATORS } from '../shared/weapons.js';
import { preloadWeaponAssets } from './weapon-test-helpers.js';

// These tests inspect actual bodies and moving parts, not the metadata-only
// pending state. Install the supplied GLBs before constructing any weapon.
await preloadWeaponAssets();
const finiteObject=o=>{let ok=true;o.traverse(n=>{for(const v of [n.position.x,n.position.y,n.position.z,n.rotation.x,n.rotation.y,n.rotation.z,n.scale.x,n.scale.y,n.scale.z])if(!Number.isFinite(v))ok=false;});return ok;};
function meshCount(o){let n=0;o.traverse(x=>n+=x.isMesh?1:0);return n;}
test('all original weapons build detailed animated silhouettes with stable muzzle metadata',()=>{
  for(const weapon of WEAPON_LIST){const gun=createWeapon(weapon.id,{hands:true}),m=gun.userData.muzzle;
    assert.ok(gun.userData.parts,'animated mechanism metadata');assert.ok(m?.isVector3);assert.ok(Number.isFinite(m.z)&&m.z<-.3,weapon.id);
    const initial=meshCount(gun);assert.ok(initial>=2&&initial<=42,`${weapon.id}: ${initial} meshes`);
    for(let i=0;i<120;i++)animateWeapon(gun,{reload:(i%50)/50,shot:(i%9)/9,ads:i%2,time:i/60});
    assert.equal(meshCount(gun),initial);assert.ok(finiteObject(gun));
  }
});
test('three operators keep articulated human tactical rigs under movement poses',()=>{
  for(const op of OPERATORS){const model=createOperator(op.id);const initial=meshCount(model);assert.ok(model.userData.arms.length===2&&model.userData.legs.length===2);assert.ok(initial>=25&&initial<=95,`${op.id}: ${initial} meshes`);
    for(const pose of [{speed:0},{speed:9},{speed:10,crouch:1},{speed:11,slide:1},{speed:0,airborne:true,reload:.5,aiming:true}])for(let i=0;i<30;i++)animateOperator(model,{dt:1/60,grounded:!pose.airborne,pitch:.3,time:i/60,...pose});
    assert.equal(meshCount(model),initial);assert.ok(finiteObject(model));
    // The new Assault GLB has an authored magazine, not a fabricated bolt.
    assert.ok(model.userData.gun.userData.parts.mag,'default ar4 has its real magazine part');
  }
});
test('operator hands stay on authored weapon grips, including the moving reload magazine',()=>{
  for(const op of OPERATORS){const model=createOperator(op.id);
    for(const reload of [0,.5,1]){animateOperator(model,{reload,aiming:true,pitch:.15,time:1});model.updateMatrixWorld(true);
      for(const arm of model.userData.arms){const hand=arm.hand.getWorldPosition(new (arm.gripTarget.constructor)()),target=model.userData.aim.localToWorld(arm.gripTarget.clone());
        assert.ok(hand.distanceTo(target)<.026,`${op.id} ${arm.side<0?'support':'rear'} grip drift at reload ${reload}`);
      }
    }
  }
});
