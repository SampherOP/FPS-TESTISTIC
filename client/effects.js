import * as THREE from '../vendor/three.module.js';
export function flashTexture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d');
  const g=c.createRadialGradient(32,32,0,32,32,31);g.addColorStop(0,'rgba(255,255,229,1)');g.addColorStop(.13,'rgba(255,222,148,.98)');g.addColorStop(.36,'rgba(255,144,41,.65)');g.addColorStop(1,'rgba(255,99,20,0)');c.fillStyle=g;c.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
export class Effects {
  constructor(scene) {
    this.scene=scene;this.index=0;this.sparkIndex=0;this.blastIndex=0;this.quality='high';
    this.tracers=Array.from({length:96},()=> {
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
      const mesh=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#ffe1a4',transparent:true,opacity:.65,depthWrite:false}));mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh);return {mesh,life:0};
    });
    const sparkGeometry=new THREE.TetrahedronGeometry(.035);
    this.sparks=Array.from({length:96},()=>{const mesh=new THREE.Mesh(sparkGeometry,new THREE.MeshBasicMaterial({color:'#ffd284',transparent:true}));mesh.visible=false;scene.add(mesh);return {mesh,life:0,vx:0,vy:0,vz:0};});
    const blastGeometry=new THREE.IcosahedronGeometry(1,1);
    this.blasts=Array.from({length:6},()=>{const mesh=new THREE.Mesh(blastGeometry,new THREE.MeshBasicMaterial({color:'#ffb251',transparent:true,opacity:.5,depthWrite:false,wireframe:false}));mesh.visible=false;scene.add(mesh);return {mesh,life:0};});
    this.grenades=Array.from({length:24},()=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),new THREE.MeshStandardMaterial({color:'#738958',emissive:'#af6732',emissiveIntensity:.4}));mesh.visible=false;scene.add(mesh);return mesh;});
  }
  shot(event) {
    const origin=this.shotOrigin?.(event)||event.origin;
    for(const end of event.ends) {
      const item=this.tracers[this.index++%this.tracers.length];item.life=.085;item.mesh.visible=true;item.mesh.material.opacity=.75;
      const array=item.mesh.geometry.attributes.position.array;array.set(origin,0);array.set(end,3);item.mesh.geometry.attributes.position.needsUpdate=true;
      if(this.quality!=='low')for(let i=0;i<2;i++) {
        const spark=this.sparks[this.sparkIndex++%this.sparks.length];spark.life=.12+Math.random()*.12;spark.mesh.visible=true;spark.mesh.position.set(...end);spark.vx=(Math.random()-.5)*2;spark.vy=Math.random()*2;spark.vz=(Math.random()-.5)*2;
      }
    }
  }
  explosion(x,y,z){const item=this.blasts[this.blastIndex++%this.blasts.length];item.life=.42;item.mesh.visible=true;item.mesh.position.set(x,y,z);item.mesh.scale.setScalar(.3);}
  update(dt,grenades=[]) {
    for(const item of this.tracers)if(item.life>0){item.life-=dt;item.mesh.visible=item.life>0;item.mesh.material.opacity=Math.max(0,item.life/.085)*.65;}
    for(const item of this.sparks)if(item.life>0){item.life-=dt;item.vy-=8*dt;item.mesh.position.x+=item.vx*dt;item.mesh.position.y+=item.vy*dt;item.mesh.position.z+=item.vz*dt;item.mesh.visible=item.life>0;}
    for(const item of this.blasts)if(item.life>0){item.life-=dt;item.mesh.scale.setScalar(.5+(1-item.life/.42)*5.5);item.mesh.material.opacity=Math.max(0,item.life/.42)*.5;item.mesh.visible=item.life>0;}
    for(const mesh of this.grenades)mesh.visible=false;
    for(const g of grenades){const mesh=this.grenades[g[0]%24];mesh.visible=true;mesh.position.set(g[1],g[2],g[3]);}
  }
  clear(){for(const list of [this.tracers,this.sparks,this.blasts])for(const item of list){item.life=0;item.mesh.visible=false;}for(const mesh of this.grenades)mesh.visible=false;}
}
