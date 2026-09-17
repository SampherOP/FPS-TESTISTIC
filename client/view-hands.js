import * as THREE from '../vendor/three.module.js';

// A palm, four independently jointed fingers and an opposed thumb. The glove
// shares the arm wrist transform; it is not a floating endpoint/capped tube.
export function createViewGlove(wrist,side,material){
 const group=new THREE.Group();group.name=side<0?'LeftGlove':'RightGlove';wrist.add(group);
 const root=new THREE.Bone();root.name='GlovePalm';group.add(root);const bones=[root],fingers=[];
 const positions=[],indices=[],skinIndex=[],skinWeight=[];
 function loft(points,widths,depths,joints,segments=8){
  const base=positions.length/3;
  for(let r=0;r<points.length;r++)for(let k=0;k<segments;k++){
   const angle=k/segments*Math.PI*2,p=points[r];positions.push(p.x+Math.cos(angle)*widths[r],p.y,p.z+Math.sin(angle)*depths[r]);skinIndex.push(joints[r],0,0,0);skinWeight.push(1,0,0,0);
  }
  for(let r=0;r<points.length-1;r++)for(let k=0;k<segments;k++){const a=base+r*segments+k,b=base+r*segments+(k+1)%segments,c=b+segments,d=a+segments;indices.push(a,d,b,b,d,c);}
  for(let k=1;k<segments-1;k++){indices.push(base,base+k,base+k+1);const end=base+(points.length-1)*segments;indices.push(end,end+k+1,end+k);}
 }
 loft([new THREE.Vector3(0,.013,0),new THREE.Vector3(0,-.026,0),new THREE.Vector3(0,-.068,0)],[.028,.040,.034],[.022,.024,.018],[0,0,0]);
 for(const [i,name] of ['Index','Middle','Ring','Pinky'].entries()){
  const x=(i-1.5)*.019,length=i===3?.056:i===1?.075:.068;
  const points=[new THREE.Vector3(x,-.067,0),new THREE.Vector3(x,-.067-length*.42,0),new THREE.Vector3(x,-.067-length*.76,0),new THREE.Vector3(x,-.067-length,0)];
  let parent=root;const digit=[];
  for(let j=0;j<3;j++){const b=new THREE.Bone();b.name=`Glove${name}${j+1}`;b.position.copy(points[j]);if(j)b.position.sub(points[j-1]);parent.add(b);bones.push(b);digit.push(b);parent=b;}
  const ids=digit.map(b=>bones.indexOf(b));loft(points,[.010,.0095,.008,.0055],[.010,.010,.0085,.0055],[ids[0],ids[1],ids[2],ids[2]],6);fingers.push(digit);
 }
 const thumbPoints=[new THREE.Vector3(-side*.033,-.021,0),new THREE.Vector3(-side*.054,-.049,-.008),new THREE.Vector3(-side*.039,-.080,-.025)];let parent=root;const thumb=[];
 for(let j=0;j<2;j++){const b=new THREE.Bone();b.name='GloveThumb'+j;b.position.copy(thumbPoints[j]);if(j)b.position.sub(thumbPoints[j-1]);parent.add(b);bones.push(b);thumb.push(b);parent=b;}
 loft(thumbPoints,[.015,.013,.008],[.014,.013,.008],[bones.indexOf(thumb[0]),bones.indexOf(thumb[1]),bones.indexOf(thumb[1])],7);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndex,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeight,4));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.userData.visualOwned=true;
 const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name=group.name+'Surface';mesh.frustumCulled=false;mesh.castShadow=true;group.add(mesh);group.updateWorldMatrix(true,true);mesh.bind(new THREE.Skeleton(bones));
 const glove={group,mesh,bones,fingers,thumb,palm:new THREE.Vector3(0,-.052,0)};poseViewGlove(glove);return glove;
}
export function poseViewGlove(glove,{open=0,shot=0}={}){
 if(!glove)return;const grip=1-Math.max(0,Math.min(1,open))*.6;
 glove.fingers.forEach((chain,i)=>{chain[0].rotation.x=(i===0?.55+.12*shot:.72)*grip;chain[1].rotation.x=.95*grip;chain[2].rotation.x=.65*grip;});
}
