import * as THREE from '../vendor/three.module.js';
import { MAP } from '../shared/map.js';
import { WEAPONS, OPERATORS } from '../shared/weapons.js';
import { WEAPON_MODEL_MAP, weaponAssetCache, instantiateWeaponAsset, weaponMetadata } from './weapon-models.js';
import { createViewGlove } from './view-hands.js';

const geometries={box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,10),sphere:new THREE.SphereGeometry(1,12,8),helmetDome:new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2)};
const materials=new Map();
export function material(color,emissive=false) {
  const key=color+':'+emissive;
  if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness:emissive?.45:.78,metalness:emissive?.2:.16,emissive:emissive?color:'#000000',emissiveIntensity:emissive?.4:0}));
  return materials.get(key);
}
export function box(parent,w,h,d,x,y,z,color,options={}) {
  const mesh=new THREE.Mesh(geometries.box,options.material||material(color,options.glow));mesh.scale.set(w,h,d);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;
  if(options.rx)mesh.rotation.x=options.rx;if(options.ry)mesh.rotation.y=options.ry;if(options.rz)mesh.rotation.z=options.rz;parent.add(mesh);return mesh;
}
function cylinder(parent,r,h,x,y,z,color,rotation=0) {
  const mesh=new THREE.Mesh(geometries.cylinder,material(color));mesh.scale.set(r,h,r);mesh.position.set(x,y,z);mesh.rotation.x=rotation;mesh.castShadow=true;parent.add(mesh);return mesh;
}
function sphere(parent,x,y,z,sx,sy,sz,color) {
  const mesh=new THREE.Mesh(geometries.sphere,material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);return mesh;
}
// A true curved shell: the upper half of a low-poly sphere, never a flat cylinder cap.
function helmetDome(parent,x,y,z,sx,sy,sz,color) {
  const mesh=new THREE.Mesh(geometries.helmetDome,material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);return mesh;
}
// Merge immutable geometry by material to reduce draw calls. Animated joints remain separate groups.
export function mergeStatic(root) {
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),buckets=new Map();
  root.traverse(object=> {
    if(!object.isMesh||Array.isArray(object.material))return;
    const g=object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const flat=g.index?g.toNonIndexed():g;
    if(!buckets.has(object.material))buckets.set(object.material,[]);buckets.get(object.material).push(flat);if(flat!==g)g.dispose();
  });
  root.clear();
  for(const [mat,list] of buckets) {
    const geometry=new THREE.BufferGeometry();
    for(const name of ['position','normal','uv']) {
      const itemSize=name==='uv'?2:3,total=list.reduce((s,g)=>s+(g.getAttribute(name)?.array.length||0),0);if(!total)continue;
      const array=new Float32Array(total);let offset=0;
      for(const g of list){const attr=g.getAttribute(name);if(attr){array.set(attr.array,offset);offset+=attr.array.length;}}
      geometry.setAttribute(name,new THREE.BufferAttribute(array,itemSize));
    }
    geometry.computeBoundingSphere();geometry.userData.visualOwned=true;const mesh=new THREE.Mesh(geometry,mat);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
    for(const g of list)g.dispose();
  }
  return root;
}
export function textTexture(text,{color='#e6e9df',background='transparent',size=256}={}) {
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size/2;const ctx=canvas.getContext('2d');
  if(background!=='transparent'){ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);}
  ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${size*.19}px Arial, sans-serif`;ctx.fillText(text,size/2,size/4);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
export function label(parent,text,x,y,z,w,h,rotation=0,color='#e6e9df',floor=false) {
  const texture=textTexture(text,{color});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1}));
  mesh.position.set(x,y,z);if(floor)mesh.rotation.x=-Math.PI/2;else mesh.rotation.y=rotation;parent.add(mesh);return mesh;
}

// First-person arms are one continuous low-poly tube per side.  They are real
// SkinnedMeshes (rather than a pile of floating glove boxes), so the wrist can
// follow the magazine/pump while the shoulder and elbow remain visually connected.
function viewArm(parent,side,points,color='#586866') {
  const rig=new THREE.Group();rig.name=side<0?'SupportArmRig':'RearArmRig';parent.add(rig);
  const bones=[],names=['Shoulder','Elbow','Wrist'];
  points.forEach((point,i)=>{const bone=new THREE.Bone();bone.name=`${names[i]}${side<0?'L':'R'}`;bone.position.copy(point);if(i)bone.position.sub(points[i-1]);(i?bones[i-1]:rig).add(bone);bones.push(bone);});
  const wrist=points[2];const rings=[...points];
  const radial=[.105,.075,.035],segments=8,positions=[],skinIndex=[],skinWeight=[],indices=[];
  const basisX=new THREE.Vector3(1,0,0),basisZ=new THREE.Vector3(0,0,1);
  for(let ring=0;ring<rings.length;ring++)for(let k=0;k<segments;k++){
    const a=k/segments*Math.PI*2,center=rings[ring],r=radial[ring];positions.push(center.x+basisX.x*Math.cos(a)*r+basisZ.x*Math.sin(a)*r,center.y+basisX.y*Math.cos(a)*r+basisZ.y*Math.sin(a)*r,center.z+basisX.z*Math.cos(a)*r+basisZ.z*Math.sin(a)*r);
    if(ring===0){skinIndex.push(0,0,0,0);skinWeight.push(1,0,0,0);}else if(ring===1){skinIndex.push(0,1,0,0);skinWeight.push(.5,.5,0,0);}else if(ring===2){skinIndex.push(1,2,0,0);skinWeight.push(.5,.5,0,0);}else{skinIndex.push(2,2,0,0);skinWeight.push(1,0,0,0);}
  }
  for(let ring=0;ring<rings.length-1;ring++)for(let k=0;k<segments;k++){const a=ring*segments+k,b=ring*segments+(k+1)%segments,c=(ring+1)*segments+(k+1)%segments,d=(ring+1)*segments+k;indices.push(a,b,d,b,c,d);}
  for(let k=1;k<segments-1;k++)indices.push((rings.length-1)*segments,(rings.length-1)*segments+k,(rings.length-1)*segments+k+1);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndex,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeight,4));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.userData.visualOwned=true;
  geometry.addGroup(0,segments*6*2,0);geometry.addGroup(segments*6*2,indices.length-segments*6*2,1);
  const mesh=new THREE.SkinnedMesh(geometry,[material(color),material('#263332')]);mesh.name=side<0?'SupportArm':'RearArm';mesh.castShadow=true;mesh.receiveShadow=true;rig.add(mesh);rig.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton(bones));
  const glove=createViewGlove(bones[2],side,material('#263332'));mesh.frustumCulled=false;
  return {rig,bones,mesh,glove,palm:glove.palm,side,upper:bones[0],lower:bones[1],hand:bones[2],gripTarget:new THREE.Vector3(),rest:bones.map(b=>({position:b.position.clone(),quaternion:b.quaternion.clone()}))};
}
function addViewHands(gun,grips,moving){
    // The arms begin below the frame and terminate at the authored grip points.
    // Shared bones keep every visible surface connected as the wrist moves.
    const viewRig=new THREE.Group();viewRig.name='ViewHands';gun.add(viewRig);
    const rearShoulder=new THREE.Vector3(.42,-.76,.16),rearElbow=new THREE.Vector3(.27,-.39,.01),rearWrist=grips.rear.clone().add(new THREE.Vector3(0,.052,0));
    const supportShoulder=new THREE.Vector3(-.48,-.76,.16),supportElbow=new THREE.Vector3(-.27,-.39,-.20),supportWrist=grips.support.clone().add(new THREE.Vector3(0,0,.052));
    const rearArm=viewArm(viewRig,1,[rearShoulder,rearElbow,rearWrist]),supportArm=viewArm(viewRig,-1,[supportShoulder,supportElbow,supportWrist]);
    moving.rearHand=rearArm.bones[2];moving.supportHand=supportArm.bones[2];moving.viewRig=viewRig;
    viewRig.userData={rearArm,supportArm,continuous:true};
}
function installImportedWeapon(gun,asset,id,hands){
  const {root,metadata}=instantiateWeaponAsset(asset,id);
  // Replace, never overlay. Only instance-owned fallback buffers/skeletons die.
  for(const child of [...gun.children]){gun.remove(child);disposeVisual(child);}
  const cancel=gun.userData.cancelWeaponLoad;
  gun.userData={...metadata,cancelWeaponLoad:cancel};gun.add(root);
  if(asset.key==='shotgun'){
    const shells=[];for(let i=0;i<7;i++){
      const shell=new THREE.Group();shell.name='ImportedReloadShell'+(i+1);shell.visible=false;
      cylinder(shell,.014,.06,0,0,0,'#7b4d32');cylinder(shell,.015,.009,0,.026,0,'#9aa8a7');
      gun.add(shell);shells.push(shell);
    }gun.userData.parts.reloadShells=shells;
  }
  if(hands)addViewHands(gun,gun.userData.grips,gun.userData.parts);
}
export function createWeapon(id,{hands=false}={}){
  const key=WEAPON_MODEL_MAP[id],asset=key&&weaponAssetCache.get(key);
  const gun=new THREE.Group();gun.name='Weapon:'+id;gun.userData=weaponMetadata(id);if(!asset&&hands)addViewHands(gun,gun.userData.grips,gun.userData.parts);
  if(asset)installImportedWeapon(gun,asset,id,hands);
  else if(key){
    gun.userData.visualStatus='loading';
    gun.userData.cancelWeaponLoad=weaponAssetCache.subscribe(key,
      ready=>{if(!gun.userData.visualDisposed)installImportedWeapon(gun,ready,id,hands);},
      error=>{gun.userData.visualStatus='error';gun.userData.visualError=String(error.message||error);});
  }
  return gun;
}

function tapered(parent,top,bottom,height,x,y,z,color,segments=10){
  const key=`t${top}:${bottom}:${height}:${segments}`;if(!geometries[key]){geometries[key]=new THREE.CylinderGeometry(top,bottom,height,segments,1,false);geometries[key].computeVertexNormals();}
  const mesh=new THREE.Mesh(geometries[key],material(color));mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
}
function jointPart(parent,r1,r2,h,y,color){tapered(parent,r1,r2,h,0,y,0,color,10);}
function operatorPalette(id){return id==='sentinel'?{cloth:'#81745c',armor:'#81795f',dark:'#263034',skin:'#a97858',lens:'#34484c',accent:'#d5a955'}:id==='kestrel'?{cloth:'#526d70',armor:'#718285',dark:'#1b292d',skin:'#9d6d50',lens:'#324d52',accent:'#65b8b4'}:{cloth:'#30343c',armor:'#41434b',dark:'#171c22',skin:'#785644',lens:'#1d252a',accent:'#a47db8'};}
export function createOperator(operatorId='sentinel',teamColor=null) {
  const op=OPERATORS.find(o=>o.id===operatorId)||OPERATORS[0],c=operatorPalette(operatorId),root=new THREE.Group(),body=new THREE.Group(),aim=new THREE.Group();root.add(body,aim);aim.position.y=1.22;
  // Flattened, oval uniform torso reads as a person under a carrier rather than a barrel.
  sphere(body,0,1.18,.025,.285,.355,.195,c.cloth);tapered(body,.255,.275,.11,0,.89,.02,c.dark,12);tapered(body,.20,.245,.19,0,.83,.02,c.cloth,12);
  addVest(body,c);for(const x of[-.18,0,.18]){box(body,.105,.16,.07,x,1.08,-.285,c.dark);box(body,.09,.025,.012,x,1.17,-.327,c.accent);}
  for(const x of[-.25,.25]){sphere(body,x,1.41,.02,.15,.12,.15,c.armor);}
  tapered(body,.105,.12,.13,0,1.50,.02,c.skin,10);buildHead(body,operatorId,c);
  mergeStatic(body);
  const legs=[],arms=[];
  for(const side of[-1,1]){
    const hip=new THREE.Group();hip.position.set(side*.155,.84,.025);root.add(hip);jointPart(hip,.14,.12,.37,-.185,c.cloth);box(hip,.19,.065,.18,0,-.37,-.01,c.armor);
    const knee=new THREE.Group();knee.position.y=-.37;hip.add(knee);jointPart(knee,.12,.095,.35,-.175,c.cloth);box(knee,.18,.105,.19,0,-.16,-.065,c.armor);box(knee,.18,.105,.31,0,-.38,-.07,c.dark);box(knee,.16,.035,.20,0,-.45,-.16,'#11191d');mergeStatic(knee);legs.push({hip,knee});
    const shoulder=new THREE.Group();shoulder.position.set(side*.29,.19,.0);aim.add(shoulder);tapered(shoulder,.105,.082,.39,0,-.195,0,c.cloth,10);sphere(shoulder,0,-.01,0,.13,.115,.13,c.armor);
    const elbow=new THREE.Group();elbow.position.y=-.39;shoulder.add(elbow);tapered(elbow,.086,.068,.39,0,-.195,-.015,c.cloth,10);const hand=new THREE.Group();hand.position.set(0,-.39,0);elbow.add(hand);sphere(hand,0,0,0,.075,.065,.07,'#202c2d');mergeStatic(hand);arms.push({shoulder,elbow,hand,side,upperLength:.39,lowerLength:.39,gripTarget:new THREE.Vector3()});
  }
  // Held close to the carrier; arm IK attaches to authored grip anchors each frame.
  const gun=createWeapon('ar4');gun.position.set(.03,-.12,-.02);gun.scale.setScalar(.88);aim.add(gun);
  const teamMaterial=new THREE.MeshStandardMaterial({color:teamColor||op.color,emissive:teamColor||op.color,emissiveIntensity:.22,roughness:.65});const patch=new THREE.Mesh(new THREE.CircleGeometry(.045,10),teamMaterial);patch.position.set(.32,.16,-.10);patch.rotation.y=-Math.PI/2;aim.add(patch);
  root.userData={limbs:legs.map(x=>x.hip),legs,arms,aim,body,gun,teamMaterial,operatorId,gaitPhase:0,wasGrounded:true};return root;
}
function addVest(body,c){box(body,.49,.38,.085,0,1.20,-.245,c.armor);box(body,.42,.08,.05,0,1.38,-.30,c.dark);box(body,.50,.055,.32,0,.95,.0,c.dark);for(const x of[-.16,.16])box(body,.115,.19,.08,x,1.12,-.305,c.dark);box(body,.045,.31,.04,.23,1.20,-.285,c.accent);}
function faceDetails(body,c,{masked=false}={}){
  const face=masked?'#4a403b':c.skin, feature=masked?'#171d20':'#362820';
  // Small separated features preserve a readable face at normal play distance.
  for(const x of[-.057,.057]){box(body,.046,.011,.012,x,1.745,-.153,feature,{rz:x<0?.10:-.10});sphere(body,x,1.712,-.162,.025,.015,.010,masked?c.lens:'#202628');}
  sphere(body,0,1.685,-.171,.016,.029,.015,face);box(body,.052,.010,.010,0,1.646,-.158,feature);
}
function buildHead(body,id,c){
  // 1.9 m body proportions: a compact .155 m wide, .21 m tall human head.
  if(id==='circuit'){
    sphere(body,0,1.69,.01,.158,.208,.162,c.dark); // balaclava ellipsoid
    sphere(body,0,1.69,-.145,.105,.115,.025,'#59463d');faceDetails(body,c,{masked:true});
    helmetDome(body,0,1.735,.012,.178,.178,.182,c.armor);box(body,.35,.032,.135,0,1.744,-.145,'#20272c');
    for(const x of[-.18,.18])sphere(body,x,1.69,.005,.028,.058,.026,c.dark);
  } else {
    sphere(body,0,1.69,.01,.155,.208,.160,c.skin);
    if(id==='sentinel'){
      helmetDome(body,0,1.735,.016,.177,.176,.178,c.armor);box(body,.35,.035,.15,0,1.748,-.145,c.dark);
      for(const x of[-.061,.061])sphere(body,x,1.714,-.169,.048,.030,.012,c.lens);
      box(body,.11,.014,.012,0,1.649,-.158,c.dark);
    } else {
      // Soft curved field cap: dome and a thin brim, not a flat top-hat slab.
      helmetDome(body,0,1.735,.035,.171,.145,.166,c.dark);box(body,.31,.027,.115,0,1.752,-.143,c.dark);
      faceDetails(body,c);box(body,.040,.10,.035,.20,1.675,-.005,c.dark);tapered(body,.17,.20,.10,0,1.515,.03,c.cloth,10);
    }
    for(const x of[-.17,.17])sphere(body,x,1.69,.005,.027,.052,.024,c.skin);
  }
}

export function disposeVisual(root){const skeletons=new Set();root?.traverse(o=>{o.userData.visualDisposed=true;o.userData.cancelWeaponLoad?.();delete o.userData.cancelWeaponLoad;if(o.geometry?.userData?.visualOwned)o.geometry.dispose();if(o.isSkinnedMesh)skeletons.add(o.skeleton);});for(const skeleton of skeletons)skeleton.dispose();root?.userData?.mixer?.stopAllAction();root?.userData?.teamMaterial?.dispose?.();}

export function buildArena(scene) {
  const root=new THREE.Group(),solid=new THREE.Group();root.add(solid);scene.add(root);
  box(solid,180,.12,170,0,-.1,0,'#66726d');box(solid,72,.07,64,0,-.025,0,'#6f7d7e');
  box(solid,39,.012,64,0,.017,0,'#44545c');box(solid,72,.013,15,0,.025,0,'#526167');
  for(const x of [-10.5,10.5])for(let z=-29;z<=29;z+=5)box(solid,.10,.012,2.35,x,.04,z,'#c8b87d');
  for(const z of [-25,25])box(solid,16,.02,.14,0,.04,z,'#c8b87d');
  for(const b of MAP.obstacles) {
    const colors={building:'#a0aaa9',relay:'#687c85',cargo:'#c99740','cargo-dark':'#42667a',barrier:'#c1c3b3',crate:'#748078',plinth:'#8b9699',boundary:'#73868c'};
    box(solid,b.w,b.h,b.d,b.x,b.y+b.h/2,b.z,colors[b.kind]);
    if(['building','relay'].includes(b.kind)) {
      box(solid,b.w+.18,.22,b.d+.18,b.x,b.h+.11,b.z,'#435763');
      for(const z of [b.z-b.d/2-.014,b.z+b.d/2+.014]) {
        for(let x=b.x-b.w/2+1.15;x<b.x+b.w/2-.7;x+=2)box(solid,1.23,.75,.035,x,3.1,z,'#345663');
        box(solid,1.6,2.5,.06,b.x,.0+1.25,z,'#3b4f58');box(solid,1.66,.075,.075,b.x,2.53,z,'#d2aa54');
        if(b.kind==='building')for(let x=b.x-b.w/2+1.2;x<b.x+b.w/2-.7;x+=2)box(solid,1.24,.75,.03,x,5.1,z,'#345663');
      }
      const faceX=b.x+(b.x<0?1:-1)*(b.w/2+.014);
      for(let z=b.z-b.d/2+1.2;z<b.z+b.d/2-1;z+=2.4)box(solid,.035,.82,1.55,faceX,3,z,'#345663');
      box(solid,1.8,.8,1.5,b.x+.5,b.h+.58,b.z+.5,'#6a7a7c');box(solid,.035,1.8,.035,b.x,b.h+1,b.z,'#394d59');
    }
    if(b.kind.startsWith('cargo')) {
      for(let z=b.z-b.d/2+.24;z<b.z+b.d/2;z+=.45)for(const x of [b.x-b.w/2-.024,b.x+b.w/2+.024])box(solid,.04,b.h-.22,.045,x,b.h/2,z,b.kind==='cargo'?'#a37832':'#325268');
      for(const z of [b.z-b.d/2-.03,b.z+b.d/2+.03]) {
        box(solid,b.w-.2,b.h-.2,.035,b.x,b.h/2,z,b.kind==='cargo'?'#b58438':'#365e72');
        for(const x of [-.8,.8])box(solid,.065,b.h-.3,.065,b.x+x,b.h/2,z+.03,'#d2c395');
      }
    }
    if(b.kind==='barrier') {
      const wide=b.w>b.d;
      for(let k=0;k<(wide?b.w:b.d)-.4;k+=.8) {
        const x=wide?b.x-b.w/2+.4+k:b.x,z=wide?b.z:b.z-b.d/2+.4+k;
        box(solid,wide?.4:b.w+.015,.2,wide?b.d+.015:.4,x,b.h-.2,z,'#43545b');
      }
    }
  }
  // Decorative perimeter skyline is outside the playable collision boundary.
  for(let i=0;i<20;i++) {
    const angle=i/20*Math.PI*2,rad=60+(i%3)*9,h=7+(i*7%16);
    box(solid,7+(i%4)*2,h,8,Math.cos(angle)*rad,h/2,Math.sin(angle)*rad,'#788c93');
  }
  mergeStatic(solid);
  label(root,'FOUNDRY',0,.065,19,8,3,0,'#a3b3b5',true);label(root,'TRAINING / 01',0,.065,-19,7,2.2,0,'#a3b3b5',true);
  label(root,'RELAY 04',-15,3.4,6.526,5,1,0);label(root,'RELAY 05',15,3.4,-6.526,5,1,Math.PI);
  label(root,'NORTH',0,2.8,-31.98,7,2,0);label(root,'SOUTH',0,2.8,31.98,7,2,Math.PI);
  label(root,'07',-6,1.8,-9.46,2.4,1.2,0,'#f0dfac');label(root,'12',6,1.8,18.54,2.4,1.2,0,'#f0dfac');
  const objectives=new Map();
  for(const o of MAP.objectives) {
    const ring=new THREE.Mesh(new THREE.RingGeometry(o.radius-.12,o.radius,64),new THREE.MeshBasicMaterial({color:'#b5c4c1',transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.set(o.x,.066,o.z);root.add(ring);
    const marker=label(root,o.id,o.x,.07,o.z+o.radius-.8,1.6,1.1,0,'#e7ede4',true);
    objectives.set(o.id,{ring,marker});
  }
  const supplies=[];
  for(const s of MAP.supplies) {
    const group=new THREE.Group();group.position.set(s.x,0,s.z);root.add(group);
    const crate=box(group,.7,.36,.5,0,.18,0,'#376d69');box(group,.37,.05,.53,0,.39,0,'#b0e3c1',{glow:true});box(group,.09,.05,.53,0,.4,0,'#d3ead1');
    const beacon=new THREE.Mesh(new THREE.OctahedronGeometry(.16),new THREE.MeshBasicMaterial({color:'#b1e3c6',wireframe:true}));beacon.position.y=.85;group.add(beacon);supplies.push(beacon);
  }
  return {root,objectives,supplies};
}

export function buildMenuScene() {
  const scene=new THREE.Scene();scene.background=new THREE.Color('#18262f');scene.fog=new THREE.Fog('#18262f',12,32);
  const stage=new THREE.Group();scene.add(stage);
  box(stage,70,.1,70,0,-.10,0,'#111b22');
  box(stage,5.2,.12,4.8,1.0,-.025,0,'#3b474a');
  // Extra low-poly hangar dressing keeps the menu lively while staying cheap
  // enough for older GPUs.
  for(const x of [-12,-8,8,12]) {
    box(stage,.18,6.5,.18,x,3.2,-5.6,'#4b5d65');
    box(stage,2.8,.12,.35,x,6.15,-5.55,'#7a8488',{glow:true});
  }
  for(const x of [-9,0,9]) {
    const lamp=new THREE.PointLight('#f0bd5d',18,9);lamp.position.set(x,5.5,-1.5);scene.add(lamp);
    box(stage,.35,.06,.35,x,5.45,-1.5,'#d6ad55',{glow:true});
  }
  for(let i=0;i<6;i++){box(stage,1.2,.8,1.2,-5+i*2.1,.4,2.2,'#263940');box(stage,1.0,.08,1.0,-5+i*2.1,.84,2.2,'#42545a');}
  box(stage,6,.08,.6,1.5,.9,2.9,'#c0a253',{glow:true});
  box(stage,17,7,.3,0,3.5,-6.3,'#263841');
  for(let x=-10;x<14;x+=1.2)box(stage,.01,.005,22,x,.012,0,'#35474f');
  for(let z=-10;z<14;z+=1.2)box(stage,25,.005,.01,0,.013,z,'#35474f');
  box(stage,17,7,.3,0,3.5,-6.3,'#263841');
  for(let x=-8;x<10;x+=2)box(stage,.11,7,.2,x,3.5,-6.05,'#53616a');
  for(const x of [-7,7]) {box(stage,.75,8,.75,x,4,-2,'#354c57');box(stage,.035,4.5,.78,x-.4,3.9,-2,'#7ba6aa',{glow:true});}
  box(stage,2.6,1.4,2.5,5,.7,-3,'#354b53');box(stage,1.8,.7,1.8,4.8,1.75,-3,'#4d5c61');
  for(let i=0;i<7;i++)box(stage,.11,.01,.5,-.75+i*.5,.06,1.7,'#d1ae57',{ry:-.4});
  mergeStatic(stage);label(scene,'F O U N D R Y',0,4.9,-6.1,8,2,0,'#71858b');label(scene,'OPERATIONS / 01',2.4,3.8,-6.08,5,1,0,'#71858b');
  const ambient=new THREE.HemisphereLight('#d0e1e6','#243039',2.3);scene.add(ambient);
  const key=new THREE.DirectionalLight('#ffe5b1',3.5);key.position.set(-3,7,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-7;key.shadow.camera.right=7;key.shadow.camera.top=8;key.shadow.camera.bottom=-4;key.shadow.normalBias=.02;scene.add(key);
  const rim=new THREE.PointLight('#74c9df',27,18);rim.position.set(3,4,-3);scene.add(rim);
  const warm=new THREE.PointLight('#f0bd5d',15,12);warm.position.set(-3,2,1);scene.add(warm);
  return {scene,key};
}
