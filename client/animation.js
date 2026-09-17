import * as THREE from '../vendor/three.module.js';
import { animateImported, poseImportedHands, solveArm } from './models.js';
import { poseViewGlove } from './view-hands.js';

// Visual-only procedural pose controller. It reads shared movement state; it never writes simulation state.
const DOWN=new THREE.Vector3(0,-1,0);
const v0=new THREE.Vector3(),v1=new THREE.Vector3(),v2=new THREE.Vector3(),v3=new THREE.Vector3();
const q0=new THREE.Quaternion();
const smooth01=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
export function animateWeapon(gun,{reload=0,shot=0,shotAge,time=0,sprint=0,ads=0}={}) {
  if(!gun)return;const d=gun.userData,parts=d.parts||{},movement=d.movement||{};
  reload=Math.max(0,Math.min(1,reload));shot=Math.max(0,Math.min(1,shot));
  if(!d.poseBase){const base={};for(const [key,part] of Object.entries(parts))if(part?.isObject3D)base[key]={x:part.position.x,y:part.position.y,z:part.position.z,rx:part.rotation.x,ry:part.rotation.y,rz:part.rotation.z};d.poseBase=base;}
  const base=d.poseBase;
  for(const [key,part] of Object.entries(parts)){if(!part?.isObject3D||!base[key])continue;const p=base[key];part.position.set(p.x,p.y,p.z);part.rotation.set(p.rx,p.ry,p.rz);}
  // Phased movement, never frame-count based. The slow bolt/pump cycle follows
  // recoil instead of instantly snapping the mechanism backwards on muzzle flash.
  const bump=(x,start,peak,end)=>x<start||x>end?0:x<peak?smooth01((x-start)/(peak-start)):1-smooth01((x-peak)/(end-peak));
  const age=Number.isFinite(shotAge)?Math.max(0,shotAge):null;
  const fast=age===null?shot:bump(age,0,.026,.115);
  const cycle=age===null?shot:bump(age,.095,.23,.49);
  const detach=smooth01((reload-.10)/.12),reseat=smooth01((reload-.66)/.16),travel=detach*(1-reseat);
  const chamber=bump(reload,.83,.9,.985);
  if(parts.mag&&base.mag){const p=base.mag;parts.mag.position.set(p.x-.035*travel,p.y-(movement.magDrop??.17)*travel,p.z+(movement.magForward??.09)*travel);parts.mag.rotation.set(p.rx-.32*travel,p.ry+.10*travel,p.rz-.14*travel);}
  if(parts.bolt&&base.bolt){const amount=(d.visualModel==='sniper'?cycle:fast)*(d.boltShot??1);parts.bolt.position.z=base.bolt.z+(movement.boltStroke??.065)*Math.max(amount,chamber);if(d.visualModel==='sniper')parts.bolt.rotation.z=base.bolt.rz-.5*Math.max(cycle,chamber);}
  if(parts.slide&&base.slide)parts.slide.position.z=base.slide.z+(movement.slideStroke??.055)*Math.max(fast,chamber);
  if(parts.pump&&base.pump)parts.pump.position.z=base.pump.z+(movement.pumpStroke??.14)*Math.max(cycle,bump(reload,.87,.925,.99));
  if(parts.trigger&&base.trigger)parts.trigger.rotation.x=base.trigger.rx-.18*(age===null?shot:bump(age,0,.02,.09));
  let activeShell=null;
  if(Array.isArray(parts.reloadShells)){
    const shells=parts.reloadShells,span=.70/shells.length;
    shells.forEach((shell,i)=>{const start=.14+i*span,end=start+span*.80,u=smooth01((reload-start)/(end-start));shell.visible=reload>=start&&reload<end;
      if(shell.visible){const port=d.reloadGrip;shell.position.set((port?.x??-.07)-.075*(1-u),(port?.y??-.07)-.09*(1-u),port?.z??-.25);shell.rotation.set(-Math.PI/2,0,.45*(1-u));activeShell=shell;}
    });
  }
  // Actual SNIPE-RIL geometry is connected. Author a chamber-loading hand pose
  // rather than tearing random receiver triangles out to invent a magazine.
  const view=parts.viewRig?.userData;
  if(view)for(const arm of [view.rearArm,view.supportArm]){
    arm.bones.forEach((b,i)=>{b.position.copy(arm.rest[i].position);b.quaternion.copy(arm.rest[i].quaternion);});gun.updateMatrixWorld(true);
    const anchor=(arm.side<0?d.grips.support:d.grips.rear).clone();
    if(arm.side<0&&parts.pump)anchor.z+=parts.pump.position.z-base.pump.z;
    let target=gun.localToWorld(anchor);const take=smooth01((reload-.04)/.10)*(1-smooth01((reload-.78)/.18));
    if(arm.side<0&&d.reloadStyle==='integral'&&reload>0&&d.reloadGrip)target.lerp(gun.localToWorld(d.reloadGrip.clone()),take);
    if(arm.side<0&&parts.mag&&reload>0)target.lerp(parts.mag.localToWorld(new THREE.Vector3(0,-.035,0)),take);
    if(arm.side<0&&activeShell)target.copy(activeShell.localToWorld(new THREE.Vector3(0,.035,0)));
    if(arm.side<0&&chamber>0&&d.reloadStyle!=='tube'){const control=parts.bolt||parts.slide;if(control)target.lerp(control.localToWorld(new THREE.Vector3(-.045,.015,.01)),chamber);}
    const handQ=gun.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(arm.side<0?Math.PI/2*(1-take):0,0,0)));
    const palmOffset=(arm.palm||new THREE.Vector3()).clone().multiplyScalar(gun.getWorldScale(new THREE.Vector3()).x).applyQuaternion(handQ);
    const wrist=target.clone().sub(palmOffset);solveArm(arm,wrist,gun);
    arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQ));
    arm.palmTarget=target;arm.palmWorldOffset=palmOffset;poseViewGlove(arm.glove,{open:arm.side<0?take:0,shot:fast});
  }
  // Third-person melee follows the same timed slash; first-person uses its
  // independent view rig in Renderer, so the slash is never applied twice.
  if(!view&&d.reloadStyle==='knife'&&age!==null&&age<.32){const slash=Math.sin(Math.PI*age/.32);gun.rotation.z-=slash*.75;gun.position.z-=slash*.13;}
}

// Two-bone analytic IK. Each joint's local -Y is aligned to the solved bone direction.
// Targets are stored per arm for a cheap regression assertion and to make grip intent explicit.
function solveArmIK(arm,target) {
  const shoulder=arm.shoulder,elbow=arm.elbow,L1=arm.upperLength,L2=arm.lowerLength;
  const start=shoulder.position;
  v0.copy(target).sub(start);let distance=v0.length();
  const min=Math.abs(L1-L2)+.0005,max=L1+L2-.0005;distance=Math.min(max,Math.max(min,distance));
  v0.normalize();
  // Bend away from the chest. Cross with forward gives a stable lateral elbow plane.
  v1.set(0,0,1).cross(v0).normalize().multiplyScalar(-arm.side);
  const along=(L1*L1-L2*L2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,L1*L1-along*along));
  v2.copy(start).addScaledVector(v0,along).addScaledVector(v1,height); // elbow in aim coordinates
  v3.copy(v2).sub(start).normalize();shoulder.quaternion.setFromUnitVectors(DOWN,v3);
  // The elbow is parented to the rotated shoulder, so convert its aim-space ray to local space.
  v3.copy(target).sub(v2).normalize();q0.copy(shoulder.quaternion).invert();v3.applyQuaternion(q0);elbow.quaternion.setFromUnitVectors(DOWN,v3);
  arm.hand.rotation.set(0,0,arm.side*.12);arm.gripTarget.copy(target);
}
function weaponPointInAim(model,point,out) {
  const {gun,aim}=model.userData;model.updateMatrixWorld(true);gun.localToWorld(out.copy(point));return aim.worldToLocal(out);
}
function gripTargets(model,reload) {
  const d=model.userData,gun=d.gun,grips=gun?.userData?.grips;if(!gun||!grips)return null;
  const rear=weaponPointInAim(model,grips.rear,v0),support=weaponPointInAim(model,grips.support,v1);
  // During reload the support hand rides the moving magazine rather than remaining on a ghost handguard.
  const mag=gun.userData.parts?.mag;
  if(reload>0&&mag&&grips.style!=='knife'){
    model.updateMatrixWorld(true);mag.localToWorld(v2.set(0,.07,0));d.aim.worldToLocal(v2);
    support.lerp(v2,Math.sin(Math.min(1,reload)*Math.PI));
  }
  return {rear:rear.clone(),support:support.clone()};
}
export function animateOperator(model,{dt=.016,speed=0,crouch=0,slide=0,grounded=true,airborne=false,verticalVelocity=0,reload=0,aiming=false,pitch=0,shot=0,shotAge,time=0,moveX=0,moveZ=0}={}) {
  if(!model?.userData)return;
  if(model.userData.imported){
    animateImported(model,{dt,speed,crouch,slide,grounded,airborne,verticalVelocity,reload,aiming,pitch,shot,time,moveX,moveZ});
    if(model.userData.gun)animateWeapon(model.userData.gun,{reload,shot:model.userData.recoil||shot,shotAge,ads:aiming?1:0,time});
    poseImportedHands(model,{reload});
    return;
  }
  const d=model.userData;d.gaitPhase=(d.gaitPhase||0)+Math.min(.08,dt)*Math.min(15,1.5+speed*1.45);const phase=d.gaitPhase;
  const pace=Math.min(.68,speed*.065)*(grounded?1:.15),stride=Math.sin(phase)*pace,lift=Math.max(0,Math.cos(phase))*pace*.24;
  for(let i=0;i<(d.legs||[]).length;i++){const leg=d.legs[i],s=i? -1:1;leg.hip.rotation.set(s*stride-(slide?.72:0),0,s*stride*.09);leg.knee.rotation.set(Math.max(0,-s*stride)*.95+(crouch?.35:0)+(airborne?.18:0),0,0);leg.hip.position.y=.84-(crouch*.17)-(slide*.21)+lift*(s>0?1:.35);}
  const aim=d.aim;aim.position.set(0,1.22-crouch*.17-slide*.20,0);aim.rotation.set(pitch*.56-(slide?.18:0),aiming?0:Math.sin(phase*.5)*.035,0);
  if(d.gun)animateWeapon(d.gun,{reload,shot,shotAge,ads:aiming?1:0,time});
  const targets=gripTargets(model,reload);
  if(targets)for(const arm of d.arms||[])solveArmIK(arm,arm.side<0?targets.support:targets.rear);
  d.wasGrounded=grounded;
}
