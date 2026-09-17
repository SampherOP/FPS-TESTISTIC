import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import * as SkeletonUtils from '../vendor/SkeletonUtils.js';
import { createWeapon, disposeVisual } from './geometry.js';

// Game transforms belong exclusively to the identity outer wrapper. Source units,
// orientation and grounding live inside it; GLBs/materials are never overwritten.
export const MODEL_DEFS=Object.freeze({
 sentinel:{file:'./assets/models/swat.glb',name:'SWAT',creator:'Quaternius',kind:'skinned',facing:Math.PI},
 kestrel:{file:'./assets/models/umair.glb',name:'FIELD SOLDIER',creator:'Umair Yaqub',kind:'static',facing:Math.PI/2},
 circuit:{file:'./assets/models/madtroll.glb',name:'TACTICAL SOLDIER',creator:'madtrollstudio',kind:'static',facing:Math.PI},
 frontline:{file:'./assets/models/player-soldier.glb',name:'PLAYER SOLDIER',creator:'Frontline',kind:'skinned',facing:Math.PI},
 juggernaut:{file:'./assets/models/player-heavy.glb',name:'PLAYER HEAVY',creator:'Heavy',kind:'skinned',facing:Math.PI}
});
let assetsPromise;const assets=new Map();const UP=new THREE.Vector3(0,1,0);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function loadCharacterAssets(onProgress){
 if(assetsPromise)return assetsPromise;const loader=new GLTFLoader();
 assetsPromise=Promise.all(Object.entries(MODEL_DEFS).map(async([id,def])=>{
  let gltf;const embedded=globalThis.__HAMU_MODEL_DATA?.[id];
  if(embedded){const bytes=Uint8Array.from(atob(embedded),c=>c.charCodeAt(0));gltf=await loader.parseAsync(bytes.buffer,'');}
  else gltf=await loader.loadAsync(new URL('../'+def.file.replace('./',''),import.meta.url).href,x=>onProgress?.(id,x.loaded,x.total));
  const source=gltf.scene;source.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(source);
  if(!Number.isFinite(box.max.y)||box.max.y-box.min.y<.01)throw new Error(`${def.name}: invalid model bounds`);
  assets.set(id,{...def,source,clips:gltf.animations||[],baked:null});
 })).then(()=>assets).catch(error=>{assetsPromise=null;throw error;});return assetsPromise;
}
export function modelAssets(){return assets;}
export function importedReady(){return assets.size===Object.keys(MODEL_DEFS).length;}
function normalization(asset){
 if(asset.normalization)return asset.normalization;
 const rotate=new THREE.Matrix4().makeRotationY(asset.facing),box=new THREE.Box3(),p=new THREE.Vector3();
 asset.source.updateMatrixWorld(true);asset.source.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++)box.expandByPoint(p.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).applyMatrix4(rotate));});
 const scale=1.9/(box.max.y-box.min.y),center=box.getCenter(new THREE.Vector3()),position=new THREE.Vector3(-center.x*scale,-box.min.y*scale,-center.z*scale);
 return asset.normalization={scale,position,rotation:asset.facing,matrix:new THREE.Matrix4().makeTranslation(...position.toArray()).multiply(new THREE.Matrix4().makeScale(scale,scale,scale)).multiply(rotate)};
}
function canonical(n){return (n||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function boneBy(root,names){let result;root.traverse(o=>{if(o.isBone&&names.some(n=>canonical(n)===canonical(o.name)))result=o;});return result;}
function world(o){return o.getWorldPosition(new THREE.Vector3());}
function remember(bones){return new Map(bones.map(b=>[b,{position:b.position.clone(),quaternion:b.quaternion.clone()}]));}
function capturePose(pose,bones){for(const b of bones){const p=pose.get(b);p.position.copy(b.position);p.quaternion.copy(b.quaternion);}return pose;}
function reset(d){for(const [b,p] of d.basePose||d.rest){b.position.copy(p.position);b.quaternion.copy(p.quaternion);}}
function makeStaticSkeleton(visual,id){
 // Landmarks measured in the original, normalized arms-down/A-pose meshes, not a
 // generic mannequin. Distinct chains prevent sleeves/boots/helmet following hips.
 const umair=id==='kestrel';const joints=umair?{
  hip:.99,knee:.54,ankle:.105,chest:1.38,neck:1.56,head:1.66,shoulder:[.225,1.50,.005],elbow:[.30,1.20,.015],wrist:[.305,.994,-.015],legX:.14
 }:{hip:.91,knee:.48,ankle:.105,chest:1.30,neck:1.55,head:1.65,shoulder:[.235,1.49,.01],elbow:[.365,1.235,-.045],wrist:[.452,1.065,-.130],legX:.115};
 const bones=[];function bone(name,parent,point){const b=new THREE.Bone();b.name=name;b.position.copy(new THREE.Vector3(...point));if(parent?.isBone)b.position.sub(world(parent));(parent||visual).add(b);visual.updateMatrixWorld(true);bones.push(b);return b;}
 const hips=bone('Hips',null,[0,joints.hip,0]),spine=bone('Spine',hips,[0,1.14,0]),chest=bone('Chest',spine,[0,joints.chest,0]),neck=bone('Neck',chest,[0,joints.neck,0]),head=bone('Head',neck,[0,joints.head,0]);
 const arms=[];for(const side of[-1,1]){const label=side<0?'L':'R',point=a=>[a[0]*side,a[1],a[2]],shoulder=bone('Shoulder'+label,chest,point([joints.shoulder[0]-.035,joints.shoulder[1]-.015,joints.shoulder[2]])),upper=bone('UpperArm'+label,shoulder,point(joints.shoulder)),lower=bone('LowerArm'+label,upper,point(joints.elbow)),hand=bone('Hand'+label,lower,point(joints.wrist));arms.push({side,shoulder,upper,lower,hand,gripTarget:new THREE.Vector3(),palm:new THREE.Vector3(0,umair?-.065:-.07,-.012)});}
 const legs=[];for(const side of[-1,1]){const label=side<0?'L':'R',hip=bone('UpperLeg'+label,hips,[side*joints.legX,joints.hip,0]),knee=bone('LowerLeg'+label,hip,[side*joints.legX,joints.knee,-.005]),foot=bone('Foot'+label,knee,[side*joints.legX,joints.ankle,0]);legs.push({side,hip,knee,foot});}
 // Umair/madtroll do not ship an armature. Give each hand its own articulated
 // digit chains so the glove mesh can curl around the weapon instead of moving
 // as one rigid mitten. The source meshes remain untouched; these are only the
 // generated deformation bones used by the normalized copies.
 for(const arm of arms){
  const p=world(arm.hand),label=arm.side<0?'L':'R';
  arm.fingers=[];
  const fingerDefs=[['Index',-.030,.00],['Middle',-.010,.008],['Ring',.010,.006],['Pinky',.030,-.002]];
  for(const [name,dx,originalZ] of fingerDefs){
   const dz=originalZ+(umair?-.018:-.050);
   const root=bone(name+'1'+label,arm.hand,[p.x+dx,p.y-.075,p.z+dz]);
   const mid=bone(name+'2'+label,root,[p.x+dx*.95,p.y-.125,p.z+dz+.004]);
   const tip=bone(name+'3'+label,mid,[p.x+dx*.82,p.y-.168,p.z+dz+.008]);
   arm.fingers.push({name,root,mid,tip,dx});
  }
  const thumb=bone('Thumb1'+label,arm.hand,[p.x+arm.side*.082,p.y-.018,p.z-.018]);
  const thumb2=bone('Thumb2'+label,thumb,[p.x+arm.side*.105,p.y-.055,p.z-.028]);
  arm.fingers.push({name:'Thumb',root:thumb,mid:thumb2,tip:thumb2,dx:arm.side*.105});
 }
 visual.updateMatrixWorld(true);return {bones,skeleton:new THREE.Skeleton(bones),hips,spine,chest,neck,head,arms,legs,joints};
}
function weightGeometry(g,rig,materialName,id){
 const p=g.attributes.position,indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4),mat=materialName.toLowerCase(),point=new THREE.Vector3();
 const index=b=>rig.bones.indexOf(b),positions=new Map(rig.bones.map(b=>[b,world(b)]));
 // Assign adjacent influences around joint cross-sections. An unrelated distant
 // bone can never steal vertices; identical seam positions receive identical weights.
 function chain(point,nodes){let closest=0,best=Infinity,tBest=0;for(let j=0;j<nodes.length-1;j++){const a=positions.get(nodes[j]),v=positions.get(nodes[j+1]).clone().sub(a),t=clamp(point.clone().sub(a).dot(v)/v.lengthSq()),dist=point.distanceToSquared(a.clone().addScaledVector(v,t));if(dist<best){best=dist;closest=j;tBest=t;}}
  const t=smooth(.65,1,tBest);return [[index(nodes[closest]),1-t],[index(nodes[closest+1]),t]];
 }
 for(let i=0;i<p.count;i++){
  point.fromBufferAttribute(p,i);const x=Math.abs(point.x),y=point.y,arm=rig.arms[point.x<0?0:1],leg=rig.legs[point.x<0?0:1];let influence;
  const headPart=/helmet|scope|glasses|torch|mask|material\.002/.test(mat)&&id==='kestrel'&&y>1.53;
  const torsoPart=/vest|pouches|bag|belt|scarf/.test(mat);
  const armBoundary=id==='kestrel'?.19+.04*(1-smooth(1.0,1.25,y)):.21+.15*(1-smooth(1.0,1.25,y));
  const armBlend=(id==='kestrel'&&mat==='skin'&&y<1.25&&x>.22?1:smooth(armBoundary,armBoundary+.035,x))*(1-smooth(1.54,1.62,y))*smooth(.70,.80,y);
  const isArm=!torsoPart&&!headPart&&armBlend>0;
  if(headPart||y>1.61)influence=[[index(rig.head),1]];
  else if(/watch/.test(mat))influence=[[index(arm.hand),1]];
  else if(/glove/.test(mat)||(id==='circuit'&&x>.415&&y<1.09&&y>.85)){
   // Split the glove across individual finger chains by lateral position. Palm
   // vertices stay on the wrist; distal vertices progressively follow the
   // nearest digit. This removes the old grouped-finger curl while keeping the
   // source glove material and silhouette intact.
   const fingers=arm.fingers.filter(f=>f.name!=='Thumb');
   let nearest=fingers[0],best=Infinity;
   for(const f of fingers){const root=positions.get(f.root),d=Math.hypot(point.x-root.x,point.z-root.z);if(d<best){best=d;nearest=f;}}
   // Coordinates here are already normalized to a 1.9 m character. The old
   // y=2.28..2.52 threshold could never animate a single glove vertex.
   const distal=smooth(.072,.15,positions.get(arm.hand).y-y);
   const chainInf=chain(point,[nearest.root,nearest.mid,nearest.tip]);
   influence=[ [index(arm.hand),1-distal], ...chainInf.map(([b,w])=>[b,w*distal]) ];
  }
  else if(isArm){const limb=chain(point,[arm.upper,arm.lower,arm.hand]),body=chain(point,[rig.hips,rig.spine,rig.chest,rig.neck,rig.head]);influence=[...limb.map(([b,w])=>[b,w*armBlend]),...body.map(([b,w])=>[b,w*(1-armBlend)])];}
  else if((/pants|shoes|pads/.test(mat)||y<rig.joints.hip+.04)&&!torsoPart){
   if(/shoe/.test(mat)||y<.13)influence=[[index(leg.foot),1]];
   else {influence=chain(point,[leg.hip,leg.knee,leg.foot]);const pelvis=smooth(rig.joints.hip-.13,rig.joints.hip+.02,y);influence=influence.map(([b,w])=>[b,w*(1-pelvis)]);influence.push([index(rig.hips),pelvis]);}
  }else if(/belt/.test(mat))influence=[[index(rig.hips),1]];
  else if(torsoPart)influence=[[index(/scarf/.test(mat)?rig.chest:rig.spine),1]];
  else influence=chain(point,[rig.hips,rig.spine,rig.chest,rig.neck,rig.head]);
  influence.forEach(([b,w],k)=>{indices[i*4+k]=b;weights[i*4+k]=w;});
 }
 g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));g.computeBoundingSphere();
}
// Cache exact deformation-equivalent sole vertices once per shared geometry.
// Normals/UV seams do not affect skin position; no rendered geometry is simplified.
const soleIndexCache=new WeakMap(),solePoint=new THREE.Vector3(),soleInverse=new THREE.Matrix4();
function cacheSoles(root){const d=root.userData;root.updateMatrixWorld(true);d.soleSamples=[];d.soleGroups=[];const inverse=root.matrixWorld.clone().invert();
 d.visual.traverse(o=>{if(!o.isSkinnedMesh)return;let list=soleIndexCache.get(o.geometry);
 if(!list){list=[];const seen=new Set(),p=o.geometry.attributes.position,si=o.geometry.attributes.skinIndex,sw=o.geometry.attributes.skinWeight,matrix=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld);
 for(let i=0;i<p.count;i++){o.getVertexPosition(i,solePoint).applyMatrix4(matrix);if(solePoint.y>=.16)continue;const key=[p.getX(i),p.getY(i),p.getZ(i),...Array.from(si.array.subarray(i*4,i*4+4)),...Array.from(sw.array.subarray(i*4,i*4+4))].join(',');if(!seen.has(key)){seen.add(key);list.push(i);}}
 soleIndexCache.set(o.geometry,list);}
 d.soleGroups.push({mesh:o,indices:list,matrix:new THREE.Matrix4()});for(const i of list)d.soleSamples.push([o,i]);
 });}
function soleMinimum(model){let min=Infinity;soleInverse.copy(model.matrixWorld).invert();for(const group of model.userData.soleGroups){group.matrix.multiplyMatrices(soleInverse,group.mesh.matrixWorld);for(const i of group.indices){group.mesh.getVertexPosition(i,solePoint).applyMatrix4(group.matrix);min=Math.min(min,solePoint.y);}}return min;}
function installWeapon(root,color){const aim=new THREE.Group();aim.name='WeaponAim';root.add(aim);const teamMaterial=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.3});const patch=new THREE.Mesh(new THREE.CircleGeometry(.028,10),teamMaterial);patch.position.set(.28,1.4,0);patch.rotation.y=Math.PI/2;patch.geometry.userData.visualOwned=true;root.add(patch);Object.assign(root.userData,{aim,weaponMount:aim,teamMaterial});equipImportedWeapon(root,'ar4');}
export function equipImportedWeapon(model,id){const d=model.userData;if(d.gun){d.aim.remove(d.gun);disposeVisual(d.gun);}const gun=createWeapon(id);const rifle=gun.userData.grips.style==='rifle';// Normalized operators are 1.9 m tall; .65 keeps the supplied rifle bounds at 0.578–0.923 m on the shorter SWAT rig. Reach projection moves the mount, never scales a weapon down to hide an IK miss.
 gun.scale.setScalar(rifle?(d.operatorId==='sentinel'?.65:.70):.78);d.aim.add(gun);d.gun=gun;return gun;}
// Calibrate to a point on the visible authored palm, in normalized model metres.
// A finite wrist/IK target alone does not prove the rendered hand touches a gun.
function configureHand(model,arm){
 model.updateMatrixWorld(true);const d=model.userData,id=d.operatorId,wrist=world(arm.hand);let palmPoint;
 if(id==='sentinel'){
  const knuckle=boneBy(arm.hand,[arm.side<0?'Middle2L':'Middle2R']);
  palmPoint=knuckle?wrist.clone().lerp(world(knuckle),.52):wrist.clone().add(new THREE.Vector3(0,-.08,0));
 }else if(id==='kestrel')palmPoint=new THREE.Vector3(arm.side*.300,.920,-.055);
 else if(id==='circuit')palmPoint=new THREE.Vector3(arm.side*.480,.990,-.175);
 else palmPoint=wrist.clone().add(new THREE.Vector3(arm.side*.006,-.067,-.018));
 arm.palmLocal=arm.hand.worldToLocal(palmPoint.clone());
 const delta=palmPoint.sub(wrist),align=new THREE.Quaternion().setFromUnitVectors(delta.clone().normalize(),new THREE.Vector3(0,-1,0));
 arm.palm=new THREE.Vector3(0,-delta.length(),0);
 arm.handBasis=align.multiply(arm.hand.getWorldQuaternion(new THREE.Quaternion()));
 arm.authoredPalm=true;
}
// The two armored GLBs have detailed finger surfaces but only a wrist bone.
// Add deformation joints to cloned geometry; never replace/delete the source hand.
function articulateAuthoredHands(root,source,arms){
 const added=[];root.updateMatrixWorld(true);
 for(const arm of arms){
  const authored=[];for(const name of ['Index','Middle','Ring','Pinky']){
   const label=arm.side<0?'L':'R',a=boneBy(arm.hand,[name+'2'+label]),b=boneBy(arm.hand,[name+'3'+label]),c=boneBy(arm.hand,[name+'4'+label]);
   if(a&&b)authored.push({name,root:a,mid:b,tip:c||b,authored:true});
  }
  if(authored.length){arm.fingers=authored;continue;}
  arm.fingers=[];const wrist=world(arm.hand);
  for(const [i,name] of ['Index','Middle','Ring','Pinky'].entries()){
   const x=(i-1.5)*.018;let parent=arm.hand;const chain=[];
   for(const [j,y] of [.065,.100,.128].entries()){
    const p=wrist.clone().add(new THREE.Vector3(x,-y,-.012));const b=new THREE.Bone();b.name=`Grip${name}${j+1}${arm.side<0?'L':'R'}`;b.position.copy(parent.worldToLocal(p));parent.add(b);root.updateMatrixWorld(true);added.push(b);chain.push(b);parent=b;
   }arm.fingers.push({name,root:chain[0],mid:chain[1],tip:chain[2],generated:true});
  }
 }
 if(!added.length)return;
 source.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const old=mesh.skeleton;const relevant=arms.filter(a=>a.fingers.some(f=>f.generated)&&old.bones.includes(a.hand));if(!relevant.length)return;
  const geometry=mesh.geometry.clone(),ix=geometry.attributes.skinIndex,sw=geometry.attributes.skinWeight;
  // Existing GLB inverses are authored in source bind space, whereas matrixWorld
  // below includes the normalized visual parent. Make each added inverse produce
  // the same bind skin matrix as the supplied wrist bones. Using its normalized
  // world inverse directly made the new finger influences disagree with every
  // original influence and displaced the source hand surfaces at rest.
  const reference=old.bones.indexOf(relevant[0].hand);
  const bindSkinMatrix=old.bones[reference].matrixWorld.clone().multiply(old.boneInverses[reference]);
  const addedInverses=added.map(b=>b.matrixWorld.clone().invert().multiply(bindSkinMatrix));
  const skeleton=new THREE.Skeleton([...old.bones,...added],[...old.boneInverses.map(m=>m.clone()),...addedInverses]);
  const wp=new THREE.Vector3();
  for(let i=0;i<ix.count;i++)for(const arm of relevant){
   const handIndex=old.bones.indexOf(arm.hand);let handWeight=0;for(let k=0;k<4;k++)if(ix.getComponent(i,k)===handIndex)handWeight+=sw.getComponent(i,k);if(handWeight<.5)continue;
   mesh.getVertexPosition(i,wp).applyMatrix4(mesh.matrixWorld);const wrist=world(arm.hand),depth=wrist.y-wp.y,distal=smooth(.060,.092,depth);if(!distal)continue;
   let nearest=arm.fingers[0],best=Infinity;for(const f of arm.fingers){const p=world(f.root),d=Math.abs(wp.x-p.x);if(d<best){best=d;nearest=f;}}
   const f=nearest,bone=depth<.10?f.root:depth<.127?f.mid:f.tip;
   ix.setXYZW(i,handIndex,skeleton.bones.indexOf(bone),0,0);sw.setXYZW(i,1-distal,distal,0,0);
  }
  // Rebind only the new skeleton. The authored bindMatrix stays unchanged;
  // retain the current attached-mode inverse until the next world update
  // refreshes it from mesh.matrixWorld.
  const bindMatrix=mesh.bindMatrix.clone(),bindMatrixInverse=mesh.bindMatrixInverse.clone();
  geometry.userData.visualOwned=true;mesh.geometry=geometry;mesh.bind(skeleton,bindMatrix);mesh.bindMatrixInverse.copy(bindMatrixInverse);
 });
}
function createSkinned(asset,id,color){
 const root=new THREE.Group(),visual=new THREE.Group(),n=normalization(asset);visual.name='ImportedVisual';visual.position.copy(n.position);visual.rotation.y=n.rotation;visual.scale.setScalar(n.scale);root.add(visual);const source=SkeletonUtils.clone(asset.source);visual.add(source);root.updateMatrixWorld(true);
 const bones=[];source.traverse(o=>{if(o.isBone)bones.push(o);if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;}});
 const bone=(...names)=>boneBy(source,names),long=(s,part)=>`${s==='L'?'Left':'Right'}${part}`;
 const arms=['L','R'].map((s,i)=>({side:i?1:-1,shoulder:bone('Shoulder'+s,long(s,'Shoulder')),upper:bone('UpperArm'+s,long(s,'UpperArm')),lower:bone('LowerArm'+s,long(s,'LowerArm')),hand:bone('Wrist'+s,'Hand'+s,long(s,'Hand')),palm:new THREE.Vector3(0,-.09,-.005),gripTarget:new THREE.Vector3()}));
 articulateAuthoredHands(root,source,arms);bones.length=0;source.traverse(o=>{if(o.isBone)bones.push(o);});
 const motionRoot=bone('Body','Hips'),actions=new Map(),mixer=new THREE.AnimationMixer(source);for(const original of asset.clips){const clip=original.clone();clip.tracks=clip.tracks.filter(t=>!/^Root\.(position|quaternion)$/.test(t.name));for(const t of clip.tracks){if(motionRoot&&t.name===motionRoot.name+'.position'){// Keep authored vertical motion, but strip locomotion translation; the game wrapper owns world movement.
    const base=motionRoot.position;for(let i=0;i<t.values.length;i+=3){t.values[i]=base.x;t.values[i+2]=base.z;}
   }}actions.set(original.name.split('|').pop(),mixer.clipAction(clip));}
 const legs=['L','R'].map((s,i)=>({side:i?1:-1,hip:bone('UpperLeg'+s,long(s,'UpperLeg')),knee:bone('LowerLeg'+s,long(s,'LowerLeg')),foot:bone('Foot'+s,long(s,'Foot'))}));
 const spine=bone('Torso','Abdomen','Spine'),chest=bone('Chest')||spine,head=bone('Head')||chest;
 if(!motionRoot||!spine||arms.some(a=>!a.upper||!a.lower||!a.hand)||legs.some(l=>!l.hip||!l.knee||!l.foot))throw new Error(`${asset.name}: unsupported skinned bone layout`);
 root.userData={imported:true,importedKind:'skinned',operatorId:id,visual,source,bones,rest:remember(bones),basePose:remember(bones),mixer,actions,active:null,clips:asset.clips,arms,armRig:{left:arms[0],right:arms[1]},hips:motionRoot,spine,chest,head,legs,normalization:n};
 for(const arm of root.userData.arms)configureHand(root,arm);cacheSoles(root);installWeapon(root,color);return root;
}
function createStatic(asset,id,color){
 const root=new THREE.Group(),visual=new THREE.Group();visual.name='ImportedVisual';root.add(visual);const n=normalization(asset),rig=makeStaticSkeleton(visual,id);
 if(!asset.baked){asset.baked=[];asset.source.updateMatrixWorld(true);asset.source.traverse(o=>{if(!o.isMesh)return;const geometry=o.geometry.clone().applyMatrix4(n.matrix.clone().multiply(o.matrixWorld));if(geometry.attributes.normal)geometry.normalizeNormals();weightGeometry(geometry,rig,(Array.isArray(o.material)?o.material:[o.material]).map(m=>m.name).join(' '),id);asset.baked.push({geometry,material:o.material,name:o.name});});}
 for(const entry of asset.baked){const mesh=new THREE.SkinnedMesh(entry.geometry,entry.material);mesh.name=entry.name;mesh.bind(rig.skeleton);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;visual.add(mesh);}
 root.userData={imported:true,importedKind:'static',operatorId:id,visual,body:visual,...rig,rest:remember(rig.bones),gaitPhase:0};for(const arm of root.userData.arms)configureHand(root,arm);cacheSoles(root);installWeapon(root,color);return root;
}
export function createImportedCharacter(id='sentinel',teamColor='#d5a955'){if(id==='commando')id='frontline';const asset=assets.get(id)||assets.get('sentinel');if(!asset)throw new Error(`Character asset not loaded: ${id}`);return asset.kind==='skinned'?createSkinned(asset,id,teamColor):createStatic(asset,id,teamColor);}
function rotateWorld(bone,axis,angle){if(!bone||!angle)return;bone.updateWorldMatrix(true,false);const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()),q=bone.getWorldQuaternion(new THREE.Quaternion());bone.quaternion.copy(parent.invert().multiply(new THREE.Quaternion().setFromAxisAngle(axis,angle).multiply(q)));bone.updateWorldMatrix(false,false);}
function aimBoneAt(bone,child,target){bone.updateWorldMatrix(true,true);const from=world(child).sub(world(bone)).normalize(),to=target.clone().sub(world(bone)).normalize();if(!from.lengthSq()||!to.lengthSq())return;const q=new THREE.Quaternion().setFromUnitVectors(from,to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));bone.updateWorldMatrix(false,false);}
export function solveArm(arm,target,model){
 const {upper,lower,hand}=arm;if(!upper||!lower||!hand)return;model.updateWorldMatrix(true,false);upper.updateWorldMatrix(true,true);const a=world(upper),b=world(lower),c=world(hand),l1=a.distanceTo(b),l2=b.distanceTo(c),dir=target.clone().sub(a),distance=clamp(dir.length(),Math.abs(l1-l2)+.0001,l1+l2-.0001);dir.normalize();
 const armored=model.userData.operatorId==='juggernaut'||model.userData.operatorId==='frontline';
 const pole=new THREE.Vector3(arm.side*(armored?2:.65),-1,armored?-.7:.35).transformDirection(model.matrixWorld),bend=pole.addScaledVector(dir,-pole.dot(dir));if(bend.lengthSq()<.00001)bend.set(arm.side,0,0);bend.normalize();const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));const elbow=a.clone().addScaledVector(dir,along).addScaledVector(bend,height);aimBoneAt(upper,lower,elbow);aimBoneAt(lower,hand,target);arm.gripTarget.copy(target);
}
export function poseImportedHands(model,{reload=0}={}){
 const d=model?.userData,gun=d?.gun;if(!d?.imported||!gun)return;model.updateMatrixWorld(true);const grips=gun.userData.grips;
 // Use the same visible contact point for reach projection and the later IK
 // solve. In particular, a partial pistol reload moves the support palm to
 // the real animated magazine rather than its resting grip anchor.
 const gripPoint=arm=>{
  const anchor=(arm.side<0?grips.support:grips.rear).clone();if(arm.side<0&&gun.userData.parts?.pump)anchor.z+=gun.userData.parts.pump.position.z-(gun.userData.poseBase?.pump?.z||0);
  let point=gun.localToWorld(anchor);
  if(arm.side<0&&reload>0&&gun.userData.reloadStyle==='integral')point.lerp(gun.localToWorld(gun.userData.reloadGrip.clone()),smooth(0,.18,reload)*(1-smooth(.78,1,reload)));
  if(arm.side<0&&reload>0&&gun.userData.parts?.mag){const mag=gun.userData.parts.mag.localToWorld(new THREE.Vector3(0,-.035,0));point.lerp(mag,smooth(0,.18,reload)*(1-smooth(.78,1,reload)));}
  if(arm.side<0&&Array.isArray(gun.userData.parts?.reloadShells)&&reload>.12&&reload<.98){
   const idx=Math.min(6,Math.floor((reload-.12)/(.86/7))),shell=gun.userData.parts.reloadShells[idx];if(shell?.visible)point.copy(shell.localToWorld(new THREE.Vector3(0,.045,0)));
  }
  return point;
 };
 // Project the weapon mount into both arms' reachable volumes, not the wrists
 // beyond their bone lengths. This handles the shorter SWAT arms and long rifles.
 for(let pass=0;pass<12;pass++){
  // Both wrist targets share one weapon mount. Applying a complete correction
  // to one arm and then the other made the pistol magazine hand and rear hand
  // pull the mount back and forth at partial reload. Project their simultaneous
  // reach corrections together, so the mount converges on their shared feasible
  // volume rather than leaving the first arm short by the final correction.
  const correction=new THREE.Vector3(),origin=model.worldToLocal(world(d.aim));let corrections=0;
  for(const arm of d.arms){if(arm.side<0&&grips.style==='knife')continue;const q=model.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((d.posePitch||0)+(arm.side<0?Math.PI/2*(1-smooth(0,.18,reload)*(1-smooth(.78,1,reload))):0),0,arm.side<0?-.12:.12)));const start=world(arm.upper),elbow=world(arm.lower),hand=world(arm.hand),limit=start.distanceTo(elbow)+elbow.distanceTo(hand)-.012*model.scale.x;const target=gripPoint(arm).sub(arm.palm.clone().multiplyScalar(model.scale.x).applyQuaternion(q)),ray=target.clone().sub(start);const minimum=Math.abs(start.distanceTo(elbow)-elbow.distanceTo(hand))+.018*model.scale.x;if(ray.length()>limit||ray.length()<minimum){if(ray.length()<1e-7)ray.set(0,0,-.0001);correction.add(ray.multiplyScalar(clamp(ray.length(),minimum,limit)/ray.length()-1));corrections++;}}
  if(!corrections)break;
  const moved=model.worldToLocal(world(d.aim).add(correction.multiplyScalar(1/corrections)));d.aim.position.add(moved.sub(origin));d.aim.updateWorldMatrix(true,true);
 }
 for(const arm of d.arms){
  // A knife is one-handed: leave the support arm in its authored/action pose
  // instead of forcing an unreachable synthetic contact beyond the blade.
  if(arm.side<0&&grips.style==='knife')continue;
  const point=gripPoint(arm);
  // Palm is an offset from the wrist; solving the wrist directly to a receiver
  // anchor would leave the visible fingers hanging below the grip.
  const handQ=model.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((d.posePitch||0)+(arm.side<0?Math.PI/2*(1-smooth(0,.18,reload)*(1-smooth(.78,1,reload))):0),0,arm.side<0?-.12:.12)));
  const wrist=point.clone().sub(arm.palm.clone().multiplyScalar(model.scale.x).applyQuaternion(handQ));solveArm(arm,wrist,model);
  // Keep a stable authored hand basis rather than inheriting arbitrary elbow roll.
  arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQ.clone().multiply(arm.handBasis)));
  // Individually curl the generated digits. Keep the thumb more open so the
  // palm wraps the receiver/magazine naturally rather than producing a fist.
  if(Array.isArray(arm.fingers)){
   const curlAxis=new THREE.Vector3(1,0,0).applyQuaternion(handQ);
   for(const f of arm.fingers){
    const curl=f.name==='Thumb'?.25:.78;
    rotateWorld(f.root,curlAxis,curl);
    if(f.mid!==f.root)rotateWorld(f.mid,curlAxis,curl*.95);
    if(f.tip&&f.tip!==f.mid)rotateWorld(f.tip,curlAxis,curl*.60);
   }
  }
  arm.palmTarget=point;arm.wristTarget=wrist;arm.palmWorldOffset=arm.palm.clone().multiplyScalar(model.scale.x).applyQuaternion(handQ);
 }
 model.updateMatrixWorld(true);
}
function offsetLocalHeight(d,metres){const b=d.hips,p=world(b);p.y+=metres; b.position.copy(b.parent.worldToLocal(p));}
export function animateImported(model,{dt=.016,speed=0,crouch=0,slide=0,grounded=true,airborne=false,verticalVelocity=0,reload=0,aiming=false,pitch=0,shot=0,time=0,moveX=0,moveZ=0}={}){
 const d=model?.userData;if(!d?.imported)return false;dt=clamp(dt,0,.08);reset(d);d.visual.position.y=d.importedKind==='skinned'?d.normalization.position.y:0;model.updateMatrixWorld(true);
 const blend=1-Math.exp(-12*dt);d.crouch=(d.crouch||0)+(Math.max(crouch,slide*.85)-(d.crouch||0))*blend;d.aimBlend=(d.aimBlend||0)+((aiming?1:0)-(d.aimBlend||0))*blend;d.posePitch=(d.posePitch||0)+(clamp(pitch,-1.25,1.25)-(d.posePitch||0))*blend;d.recoil=Math.max(shot,(d.recoil||0)*Math.exp(-18*dt));
 const c=d.crouch,air=airborne||!grounded;d.airBlend=(d.airBlend||0)+((air?1:0)-(d.airBlend||0))*blend;const airPose=d.airBlend;d.state=reload>0?'reload':air?(verticalVelocity>0?'jump':'fall'):c>.5?'crouch':aiming?'aim':speed>5?'run':speed>.3?'walk':'idle';
 const sideAxis=new THREE.Vector3(1,0,0).transformDirection(model.matrixWorld);
 if(d.mixer){let choices;
  if(reload>0)choices=['Reload','Idle_Gun','Idle'];
  else if(slide>.25)choices=['Idle_Gun','Idle'];
  else if(air)choices=['Idle_Gun','Idle'];
  else if(c>.3)choices=['Idle_Gun','Idle'];
  else if(speed>5&&Math.abs(moveX)>Math.abs(moveZ))choices=[moveX>0?'Run_Right':'Run_Left','Sprint','Run_Shoot','Run'];
  else if(speed>5&&moveZ>0)choices=['Run_Back','Sprint','Run_Shoot','Run'];
  else if(speed>7)choices=['Sprint','Run_Shoot','Run'];
  else if(speed>5)choices=['Run_Shoot','Run','Sprint'];
  else if(speed>.3)choices=['Walk','Run'];
  else if(shot>.05)choices=['Gun_Shoot','Shoot','Idle_Gun_Shoot','Idle_Gun','Idle'];
  else choices=aiming?['Idle_Gun_Pointing','Idle_Gun','Idle']:['Idle_Gun','Idle','Idle_Neutral'];
  const action=choices.map(name=>d.actions.get(name)).find(Boolean)||d.actions.values().next().value;if(action&&action!==d.active){d.active?.fadeOut(.18);action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(.18).play();d.active=action;}d.mixer.update(dt);capturePose(d.basePose,d.bones);
 }else{
  d.gaitPhase+=dt*(speed>.3?Math.min(13,5+speed*.8):0);const stride=Math.sin(d.gaitPhase)*Math.min(.62,speed*.075)*(air?0:1)*(1-c*.65),back=moveZ>.1?-1:1;
  const lateral=clamp(Math.abs(moveX)/Math.max(.01,speed)),forward=1-lateral;
  for(const leg of d.legs){leg.hip.rotation.x=leg.side*stride*back*forward;leg.hip.rotation.z=leg.side*stride*lateral*Math.sign(moveX);leg.knee.rotation.x=-Math.max(0,leg.side*stride)*1.1;leg.foot.rotation.x=-leg.hip.rotation.x-leg.knee.rotation.x;leg.foot.rotation.z=-leg.hip.rotation.z;}
  d.spine.rotation.x=.018*Math.sin(time*1.9)+Math.min(.12,speed*.012);d.chest.rotation.z=.009*Math.sin(time*1.9+.6);
 }
 model.updateMatrixWorld(true);
 if(c>.001||airPose>.001){const tips=d.legs.map(leg=>leg.knee.worldToLocal(world(leg.foot)));offsetLocalHeight(d,-.43*c);for(const [i,leg] of d.legs.entries()){rotateWorld(leg.hip,sideAxis,.9*c+airPose*(verticalVelocity>0?.38:.20));rotateWorld(leg.knee,sideAxis,-1.65*c-airPose*.6);if(d.importedKind==='static')rotateWorld(leg.foot,sideAxis,.75*c+airPose*.25);else{leg.foot.position.copy(leg.foot.parent.worldToLocal(leg.knee.localToWorld(tips[i])));rotateWorld(leg.foot,sideAxis,airPose*.12);}}rotateWorld(d.spine,sideAxis,-.22*c);}
 rotateWorld(d.chest,sideAxis,d.posePitch*.27-d.recoil*.055);rotateWorld(d.head,sideAxis,d.posePitch*.25);
 // Keep the weapon in front of the supplied broad chest armor, not embedded in it.
 const armored=d.operatorId==='juggernaut'||d.operatorId==='frontline';
 d.aim.position.set(.045,1.31+.09*d.aimBlend-.43*c,(d.operatorId==='sentinel'?-.32:armored?-.39:-.36)+d.recoil*.035);d.aim.rotation.set(d.posePitch,-.08*(1-d.aimBlend),reload>0?-.15*Math.sin(reload*Math.PI):0);d.gun.position.set(0,0,0);d.gun.rotation.set(-d.recoil*.055,0,0);
 // Root remains authoritative. Only the skeleton/presentation move; grounded visual
 // feet are corrected in model metres, never by scaling the whole character.
 d.visual.position.y=d.importedKind==='skinned'?d.normalization.position.y:0;model.updateMatrixWorld(true);
 if(grounded&&!air){const min=soleMinimum(model);if(Number.isFinite(min))d.visual.position.y-=min;}
 return true;
}
