import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

// Every catalog id has exactly one supplied model.  Coordinates in a definition
// are game-local metres: +Y up and muzzle direction -Z, before the existing
// first-person/character mount transforms are applied.
export const WEAPON_MODEL_MAP=Object.freeze({
 ar4:'assault',hxr8:'bullp',mag83:'mag-83',volt9:'mp5',pincer:'submachine',
 breach12:'shotgun',lancer7:'sniper',snipeRil:'snipe-ril',relay9:'pistol',
 flick45:'rigg-glock',edge:'knife'
});

// selector.boxes are source-scene AABBs. They select complete, genuinely
// disconnected components only; no face is clipped or fabricated. The named
// MP5/sniper parts come directly from the author hierarchy. Glock's parts come
// from its authored rigid bone weights (Root, Slide, Trigger, Magazine, Barrel,
// SlideCatch); both source skins are retained.
export const WEAPON_MODEL_DEFS=Object.freeze({
 // These two source meshes point opposite to their former definitions: AUG
 // muzzle is source +Z; BULLPUP muzzle is source +X. Bake them toward -Z
 // here so first-person, lobby, NPC and network mounts share the correction.
 assault:{scale:.24,rotation:[0,Math.PI,0],position:[0,-.03,-.175868],rear:[.028,-.149614,-.061213],support:[-.035,-.057007,-.241028],sightHeight:.118,sightX:-.001007,muzzle:[-.001007,-.014813,-.641],reloadStyle:'magazine',reloadGrip:[-.035,-.115,-.205],movement:{magDrop:.17,magForward:.10,boltStroke:.045},parts:{mag:{boxes:[[[-.09,-.90,-1.31],[.10,-.12,-.78]]]} }},
 bullp:{scale:.19,rotation:[0,Math.PI/2,0],position:[0,-.04,-.113351],rear:[.030,-.097,-.113351],support:[-.040,.031706,-.500039],sightHeight:.190,sightX:0,muzzle:[0,.114651,-.630],reloadStyle:'magazine',reloadGrip:[-.035,-.125,-.105],movement:{magDrop:.15,magForward:.08},parts:{mag:{boxes:[[[-.38,-.44,-.08],[.38,.42,.08]]]} }},
 'mag-83':{scale:.19,rotation:[0,Math.PI/2,0],position:[0,-.05,.10],rear:[.030,-.155,-.085],support:[-.040,-.030,-.385],sightHeight:.145,sightX:0,muzzle:[0,.060,-.595],reloadStyle:'magazine',reloadGrip:[-.035,-.135,-.085],movement:{magDrop:.18,magForward:.10},parts:{mag:{boxes:[[[.70,-.75,-.09],[1.25,-.40,.09]]]}}},
 // Existing licensed repeat assets retain their validated authored transforms.
 mp5:{boltShot:0,scale:3.4,rotation:[0,0,0],position:[0,-.03,-.192],rear:[.028,-.145,-.080],support:[-.035,-.040,-.430],sightHeight:.0918,sightX:0,muzzle:[0,.022,-.652],reloadStyle:'magazine',reloadGrip:[-.032,-.105,-.245],movement:{magDrop:.17,magForward:.10,boltStroke:.075},parts:{mag:{nodes:['Magazine']},bolt:{nodes:['Charging_Handle']},trigger:{nodes:['Trigger']}}},
 submachine:{scale:.22,rotation:[0,Math.PI/2,0],position:[0,-.04,-.10],rear:[.030,-.155,-.075],support:[-.040,-.040,-.390],sightHeight:.142,sightX:0,muzzle:[0,.048,-.595],reloadStyle:'magazine',reloadGrip:[-.035,-.150,-.205],movement:{magDrop:.19,magForward:.10},parts:{mag:{boxes:[[[.64,-.90,-.10],[1.05,.20,.10]]]}}},
 shotgun:{scale:.216,rotation:[0,Math.PI/2,0],position:[0,-.04,-.10],rear:[.028,-.105,.105],support:[-.038,-.063,-.315],sightHeight:.046,sightX:0,muzzle:[0,.028,-1.033],reloadStyle:'tube',reloadGrip:[-.038,-.085,-.250],movement:{pumpStroke:.145},parts:{pump:{boxes:[[[.20,-.34,-.13],[1.29,.34,.13]]]}}},
 sniper:{scale:.1187,rotation:[0,Math.PI/2,0],position:[.0095,-.057,-.30],rear:[.028,-.105,-.140],support:[-.035,-.045,-.600],sightHeight:.083,sightX:.0095,muzzle:[0,.025,-1.109],reloadStyle:'magazine',reloadGrip:[-.030,-.090,-.300],movement:{magDrop:.14,magForward:.08,boltStroke:.065},parts:{mag:{nodes:['Mag_Cube.007','Bullets(Mag)_Cylinder.005']},bolt:{nodes:['PullBack_Cylinder.003']},trigger:{nodes:['Trigger_Cube.003']}}},
 'snipe-ril':{scale:.15,rotation:[0,Math.PI/2,0],position:[0,-.05,-.14],rear:[.030,-.090,.045],support:[-.035,-.015,-.475],sightHeight:.125,sightX:0,muzzle:[0,.035,-.940],reloadStyle:'integral',reloadGrip:[-.032,-.060,-.155],movement:{boltStroke:.055},parts:{}},
 pistol:{scale:.253,rotation:[0,Math.PI/2,0],position:[0,-.10,-.07],rear:[.024,-.145,-.065],support:[-.043,-.135,-.040],sightHeight:.083,sightX:0,muzzle:[0,.034,-.440],reloadStyle:'magazine',reloadGrip:[-.040,-.205,-.050],movement:{magDrop:.14,magForward:.07,slideStroke:.052},parts:{mag:{boxes:[[[-.33,-.50,-.14],[.15,-.22,.14]]]},slide:{boxes:[[[-.37,.37,-.15],[1.42,.73,.15]]]}}},
 'rigg-glock':{scale:.21,rotation:[0,Math.PI,0],position:[0,-.13,-.15],rear:[.026,-.125,.015],support:[-.040,-.130,-.055],sightHeight:.105,sightX:0,muzzle:[0,.000,-.380],reloadStyle:'magazine',reloadGrip:[-.040,-.205,-.030],movement:{magDrop:.15,magForward:.07,slideStroke:.060},parts:{slide:{bones:[1]},trigger:{bones:[2]},mag:{bones:[3]}}},
 knife:{scale:1.05,rotation:[0,Math.PI/2,0],position:[0,-.065,-.10],rear:[.018,-.065,-.015],support:[-.19,-.14,.035],sightHeight:.075,sightX:0,muzzle:[0,-.065,-.539],reloadStyle:'knife',reloadGrip:null,movement:{},parts:{}}
});

const canonical=name=>(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const validPoint=p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
const finite=box=>!box.isEmpty()&&[...box.min.toArray(),...box.max.toArray()].every(Number.isFinite);
const boxContains=(outer,inner,epsilon=.0005)=>inner.min.x>=outer[0][0]-epsilon&&inner.min.y>=outer[0][1]-epsilon&&inner.min.z>=outer[0][2]-epsilon&&inner.max.x<=outer[1][0]+epsilon&&inner.max.y<=outer[1][1]+epsilon&&inner.max.z<=outer[1][2]+epsilon;

function namedPart(object,def){
 for(let node=object;node;node=node.parent)for(const [part,rule] of Object.entries(def.parts))if(rule.nodes?.some(name=>canonical(name)===canonical(node.name)))return part;
 return null;
}
function dominantBone(mesh,vertex){
 const joints=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');if(!joints||!weights)return 0;
 let weight=-1,joint=0;for(let n=0;n<4;n++){const w=weights.getComponent(vertex,n);if(w>weight){weight=w;joint=joints.getComponent(vertex,n);}}return joint;
}
function skinMatrix(mesh,vertex){
 const joints=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
 if(!joints||!weights)return null;
 const result=new THREE.Matrix4().identity(),tmp=new THREE.Matrix4();let total=0;
 // Supplied Glock vertices are rigid (one weight of 1). Keep blended data
 // correct too by blending matrix elements before the bind transforms.
 const values=new Float32Array(16);for(let n=0;n<4;n++){
  const weight=weights.getComponent(vertex,n);if(weight<=0)continue;const joint=joints.getComponent(vertex,n);
  tmp.fromArray(mesh.skeleton.boneMatrices,joint*16);for(let i=0;i<16;i++)values[i]+=tmp.elements[i]*weight;total+=weight;
 }
 if(!total)return null;for(let i=0;i<16;i++)values[i]/=total;
 return result.fromArray(values).premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
}
function vertexPosition(mesh,vertex,matrix,out){
 out.fromBufferAttribute(mesh.geometry.getAttribute('position'),vertex);
 if(mesh.isSkinnedMesh){const skin=skinMatrix(mesh,vertex);if(skin)out.applyMatrix4(skin);}
 out.applyMatrix4(mesh.matrixWorld).applyMatrix4(matrix);
 // A handful of unused Glock vertices have zero/invalid bind data. Their raw
 // vertex coordinate is the bind-pose fallback; all weighted geometry above
 // remains baked with its actual skin/bind matrices.
 if(!validPoint(out))out.fromBufferAttribute(mesh.geometry.getAttribute('position'),vertex).applyMatrix4(mesh.matrixWorld).applyMatrix4(matrix);
 return out;
}
function vertexNormal(mesh,vertex,matrix,out){
 const normal=mesh.geometry.getAttribute('normal');if(!normal)return out.set(0,1,0);
 out.fromBufferAttribute(normal,vertex);const skin=mesh.isSkinnedMesh?skinMatrix(mesh,vertex):null;
 const transform=matrix.clone().multiply(mesh.matrixWorld);if(skin)transform.multiply(skin);
 return out.applyMatrix3(new THREE.Matrix3().getNormalMatrix(transform)).normalize();
}
function triangles(geometry){
 const index=geometry.getIndex(),count=index?index.count:geometry.getAttribute('position').count,result=[];
 for(let i=0;i<count;i+=3)result.push(index?[index.getX(i),index.getX(i+1),index.getX(i+2)]:[i,i+1,i+2]);return result;
}
// Vertices split only for normals/UVs are welded by quantised position while
// finding components. This separates real loose meshes without tearing an
// otherwise continuous authored surface into individual faces.
function disconnectedComponents(mesh){
 const tris=triangles(mesh.geometry),position=mesh.geometry.getAttribute('position'),byPoint=new Map(),key=index=>`${Math.round(position.getX(index)*1e5)},${Math.round(position.getY(index)*1e5)},${Math.round(position.getZ(index)*1e5)}`;
 tris.forEach((tri,i)=>tri.forEach(vertex=>{const k=key(vertex),bucket=byPoint.get(k)||[];bucket.push(i);byPoint.set(k,bucket);}));
 const seen=new Uint8Array(tris.length),components=[];
 for(let start=0;start<tris.length;start++)if(!seen[start]){
  const todo=[start],faces=[];seen[start]=1;while(todo.length){const face=todo.pop();faces.push(face);for(const vertex of tris[face])for(const neighbor of byPoint.get(key(vertex)))if(!seen[neighbor]){seen[neighbor]=1;todo.push(neighbor);}}
  components.push(faces);
 }return {tris,components};
}
function sourceComponentBox(mesh,faces,tris){
 const box=new THREE.Box3(),p=new THREE.Vector3();for(const face of faces)for(const vertex of tris[face])box.expandByPoint(p.fromBufferAttribute(mesh.geometry.getAttribute('position'),vertex).applyMatrix4(mesh.matrixWorld));return box;
}
function boxedPart(mesh,faces,tris,def){
 const box=sourceComponentBox(mesh,faces,tris);
 for(const [part,rule] of Object.entries(def.parts))if(rule.boxes?.some(ruleBox=>boxContains(ruleBox,box)))return part;
 return null;
}
function triangleBonePart(mesh,tri,def){
 const score=new Map();for(const vertex of tri){const bone=dominantBone(mesh,vertex);score.set(bone,(score.get(bone)||0)+1);}let bone=0,points=-1;for(const [candidate,count] of score)if(count>points){bone=candidate;points=count;}
 return Object.entries(def.parts).find(([,rule])=>rule.bones?.includes(bone))?.[0]||null;
}
function buildGeometry(mesh,faces,tris,matrix){
 const source=mesh.geometry,attributes={};for(const [name,attribute] of Object.entries(source.attributes)){
  if(name==='skinIndex'||name==='skinWeight')continue;
  attributes[name]={attribute,array:new attribute.array.constructor(faces.length*3*attribute.itemSize)};
 }
 const p=new THREE.Vector3(),n=new THREE.Vector3();let output=0;
 for(const face of faces)for(const vertex of tris[face]){
  for(const [name,{attribute,array}] of Object.entries(attributes)){
   const at=output*attribute.itemSize;if(name==='position'){vertexPosition(mesh,vertex,matrix,p);array[at]=p.x;array[at+1]=p.y;array[at+2]=p.z;}
   else if(name==='normal'){vertexNormal(mesh,vertex,matrix,n);array[at]=n.x;array[at+1]=n.y;array[at+2]=n.z;}
   else for(let component=0;component<attribute.itemSize;component++)array[at+component]=attribute.getComponent(vertex,component);
  }output++;
 }
 const geometry=new THREE.BufferGeometry();for(const [name,{attribute,array}] of Object.entries(attributes))geometry.setAttribute(name,new THREE.BufferAttribute(array,attribute.itemSize,attribute.normalized));geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
function visualSourceBounds(source,matrix){
 const box=new THREE.Box3(),p=new THREE.Vector3();source.traverse(mesh=>{if(!mesh.isMesh)return;const position=mesh.geometry.getAttribute('position');for(let i=0;i<position.count;i++){vertexPosition(mesh,i,matrix,p);if(validPoint(p))box.expandByPoint(p);}});return box;
}

// Bake exact source transforms once, retaining every source triangle and its
// original material. Moving groups retain only author-named, bone-weighted, or
// truly disconnected source components; nothing is modelled on top of an asset.
export function prepareWeaponAsset(key,gltf){
 const def=WEAPON_MODEL_DEFS[key];if(!def)throw new Error(`Unknown weapon model: ${key}`);
 const source=gltf.scene;source.updateMatrixWorld(true);source.traverse(node=>node.isSkinnedMesh&&node.skeleton.update());
 const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...def.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.rotation)),new THREE.Vector3().setScalar(def.scale));
 const sourceBounds=visualSourceBounds(source,new THREE.Matrix4());if(!finite(sourceBounds))throw new Error(`${key}: empty/non-finite source`);
 const pieces=[];let sourceMeshes=0;
 source.traverse(mesh=>{
  if(!mesh.isMesh)return;sourceMeshes++;if(Array.isArray(mesh.material))throw new Error(`${key}: unsupported multi-material primitive`);
  const explicit=namedPart(mesh,def),{tris,components}=disconnectedComponents(mesh);
  if(mesh.isSkinnedMesh){
   const grouped=new Map();tris.forEach((tri,index)=>{const part=explicit||triangleBonePart(mesh,tri,def)||'body',list=grouped.get(part)||[];list.push(index);grouped.set(part,list);});
   for(const [part,faces] of grouped)pieces.push({part,mesh,faces,tris});
  }else if(explicit)pieces.push({part:explicit,mesh,faces:tris.map((_,i)=>i),tris});
  else for(const faces of components)pieces.push({part:boxedPart(mesh,faces,tris,def)||'body',mesh,faces,tris});
 });
 const partBoxes=new Map();for(const piece of pieces){const geometry=buildGeometry(piece.mesh,piece.faces,piece.tris,matrix);if(!geometry.getAttribute('position')?.count)continue;const box=geometry.boundingBox;partBoxes.set(piece.part,(partBoxes.get(piece.part)||new THREE.Box3()).union(box));piece.geometry=geometry;}
 const root=new THREE.Group();root.name=`ImportedWeapon:${key}`;const groups={body:new THREE.Group()};groups.body.name='WeaponBody';root.add(groups.body);
 for(const [name,box] of partBoxes)if(name!=='body'&&finite(box)){const group=new THREE.Group();group.name=`WeaponPart:${name}`;group.position.copy(box.getCenter(new THREE.Vector3()));groups[name]=group;root.add(group);}
 const buckets=new Map();for(const piece of pieces){if(!piece.geometry)continue;const group=groups[piece.part]||groups.body,geometry=piece.geometry;geometry.translate(-group.position.x,-group.position.y,-group.position.z);
  const material=piece.mesh.material,signature=`${group.name}:${material.uuid}:${Object.keys(geometry.attributes).sort().map(name=>`${name}/${geometry.getAttribute(name).itemSize}/${geometry.getAttribute(name).normalized}`).join(',')}`;
  // Separate transparent surfaces preserve GLTF draw ordering rather than being merged.
  const bucketKey=material.transparent?`${signature}:${piece.mesh.uuid}:${buckets.size}`:signature;const bucket=buckets.get(bucketKey)||{group,material,list:[]};bucket.list.push(geometry);buckets.set(bucketKey,bucket);
 }
 for(const {group,material,list} of buckets.values()){
  const geometry=list.length===1?list[0]:mergeGeometries(list,false);if(!geometry)throw new Error(`${key}: geometry batching failed`);if(list.length>1)for(const item of list)item.dispose();geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData.weaponShared=true;delete geometry.userData.visualOwned;
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
 }
 root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root);if(!sourceMeshes||!finite(bounds)||bounds.getSize(new THREE.Vector3()).length()<.01)throw new Error(`${key}: invalid prepared bounds`);
 return {key,root,def,bounds,sourceBounds,sourceMeshes,clips:gltf.animations?.length||0,partNames:Object.keys(groups).filter(name=>name!=='body')};
}

// Failed requests are latched, not retried each frame/switch. Explicit retry is
// available for diagnostics/recovery. In-flight subscribers can cancel on disposal.
export class WeaponAssetCache {
 constructor(load=key=>new GLTFLoader().loadAsync(new URL(`../assets/models/weapons/${key}.glb`,import.meta.url).href)){this.loader=load;this.entries=new Map();}
 get(key){return this.entries.get(key)?.asset;}
 load(key){
  if(!WEAPON_MODEL_DEFS[key])return Promise.reject(new Error(`Unknown weapon model: ${key}`));if(this.entries.has(key))return this.entries.get(key).promise;
  const entry={listeners:new Set(),asset:null,error:null};this.entries.set(key,entry);
  entry.promise=Promise.resolve().then(()=>this.loader(key)).then(gltf=>{entry.asset=prepareWeaponAsset(key,gltf);for(const listener of entry.listeners)listener(entry.asset);entry.listeners.clear();return entry.asset;}).catch(error=>{entry.error=error;entry.listeners.clear();throw error;});return entry.promise;
 }
 subscribe(key,install,onError=()=>{}){const ready=this.get(key);if(ready){install(ready);return ()=>{};}const promise=this.load(key),entry=this.entries.get(key);let active=true;const listener=asset=>{if(active)install(asset);};entry.listeners.add(listener);promise.catch(error=>{entry.listeners.delete(listener);if(active)onError(error);});return ()=>{active=false;entry.listeners.delete(listener);};}
 retry(key){const entry=this.entries.get(key);if(entry?.error)this.entries.delete(key);return this.load(key);}
}
export const weaponAssetCache=new WeaponAssetCache();
export function loadWeaponAssets(){return Promise.allSettled(Object.keys(WEAPON_MODEL_DEFS).map(key=>weaponAssetCache.load(key)));}
export function instantiateWeaponAsset(asset,id){
 const root=asset.root.clone(true),def=asset.def,parts={};for(const name of asset.partNames||[])parts[name]=root.getObjectByName(`WeaponPart:${name}`);
 const v=value=>value?new THREE.Vector3(...value):null;
 return {root,metadata:{id,visualModel:asset.key,visualStatus:'ready',parts,grips:{rear:v(def.rear),support:v(def.support),style:asset.key==='knife'?'knife':['pistol','rigg-glock'].includes(asset.key)?'pistol':'rifle'},muzzle:v(def.muzzle),sightHeight:def.sightHeight,sightX:def.sightX??0,reloadStyle:def.reloadStyle,reloadGrip:v(def.reloadGrip),movement:{...(def.movement||{})},boltShot:def.boltShot??1,base:{}}};
}

// Metadata exists before the GLB finishes loading so hands, camera and network
// state never depend on a legacy procedural weapon appearing for a frame.
export function weaponMetadata(id){
 const key=WEAPON_MODEL_MAP[id],def=WEAPON_MODEL_DEFS[key];
 if(!def)throw new Error(`Unknown weapon: ${id}`);
 return instantiateWeaponAsset({key,def,root:new THREE.Group(),partNames:[]},id).metadata;
}
