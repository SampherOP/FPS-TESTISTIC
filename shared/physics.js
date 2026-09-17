import { COLLIDERS, MAP } from './map.js';
import { WEAPONS } from './weapons.js';
import { B, clamp } from './protocol.js';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.78;
export const eyeHeight = p => Math.max(0.35,p.height-0.16);
export const direction = (yaw,pitch=0) => ({x:Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)});
export const distance2 = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);

export function rayBox(o,d,b,maxDistance=Infinity) {
  let low=0, high=maxDistance;
  for (const [axis,min,max] of [['x','minX','maxX'],['y','minY','maxY'],['z','minZ','maxZ']]) {
    if (Math.abs(d[axis])<1e-8) { if(o[axis]<b[min]||o[axis]>b[max]) return Infinity; }
    else {
      let a=(b[min]-o[axis])/d[axis],c=(b[max]-o[axis])/d[axis];
      if(a>c) [a,c]=[c,a];
      low=Math.max(low,a); high=Math.min(high,c);
      if(low>high) return Infinity;
    }
  }
  return high>=0 ? low : Infinity;
}
export function raySphere(o,d,c,r,maxDistance=Infinity) {
  const x=o.x-c.x,y=o.y-c.y,z=o.z-c.z;
  const b=x*d.x+y*d.y+z*d.z, det=b*b-(x*x+y*y+z*z-r*r);
  if(det<0) return Infinity;
  const t=-b-Math.sqrt(det);
  return t>=0&&t<=maxDistance ? t : Infinity;
}
export function wallDistance(o,d,maxDistance=140,colliders=COLLIDERS) {
  let closest=maxDistance;
  for(const b of colliders) closest=Math.min(closest,rayBox(o,d,b,closest));
  // The floor also stops bullets and visibility rays.
  if(d.y<0) { const t=-o.y/d.y; if(t>=0) closest=Math.min(closest,t); }
  return closest;
}
export function visible(a,b) {
  const o={x:a.x,y:a.y+eyeHeight(a),z:a.z};
  const t={x:b.x,y:b.y+b.height*0.64,z:b.z};
  const length=Math.hypot(t.x-o.x,t.y-o.y,t.z-o.z);
  if(length<0.01) return true;
  const d={x:(t.x-o.x)/length,y:(t.y-o.y)/length,z:(t.z-o.z)/length};
  return wallDistance(o,d,length)>=length-0.15;
}
export function traceShot(o,d,players,shooter,maxDistance,teams=true) {
  let length=wallDistance(o,d,maxDistance), hit=null,head=false;
  for(const p of players) {
    if(!p.alive||p.id===shooter.id||(teams&&p.team===shooter.team)) continue;
    const h=raySphere(o,d,{x:p.x,y:p.y+p.height-0.19,z:p.z},Math.min(0.235,p.height*.34),length);
    const t=rayBox(o,d,{minX:p.x-.32,maxX:p.x+.32,minY:p.y+.05,maxY:p.y+Math.max(.25,p.height-.36),minZ:p.z-.32,maxZ:p.z+.32},length);
    if(Math.min(h,t)<length) { length=Math.min(h,t);hit=p;head=h<=t; }
  }
  return {hit,head,distance:length,end:{x:o.x+d.x*length,y:o.y+d.y*length,z:o.z+d.z*length}};
}
function overlapsXZ(x,z,b,r=RADIUS) { return x+r>b.minX&&x-r<b.maxX&&z+r>b.minZ&&z-r<b.maxZ; }
export function canStand(p,height=STAND_HEIGHT,colliders=COLLIDERS) {
  return !colliders.some(b=>overlapsXZ(p.x,p.z,b)&&p.y+.05<b.maxY&&p.y+height>b.minY);
}
function moveAxis(p,axis,delta,colliders) {
  p[axis]+=delta;
  for(const b of colliders) {
    if(p.y>=b.maxY-.035||p.y+p.height<=b.minY+.02||!overlapsXZ(p.x,p.z,b)) continue;
    if(axis==='x') {
      if(delta>0) p.x=b.minX-RADIUS; else if(delta<0) p.x=b.maxX+RADIUS;
      p.vx=0;
    } else {
      if(delta>0) p.z=b.minZ-RADIUS; else if(delta<0) p.z=b.maxZ+RADIUS;
      p.vz=0;
    }
  }
}
// Shared movement is used on the authority and for immediate local prediction.
export function movePlayer(p,input,dt,colliders=COLLIDERS) {
  if(!p.alive) return;
  dt=clamp(dt,0,1/30);
  const f=input.flags,edge=f&~(p.prevFlags||0),w=WEAPONS[p.loadout[p.slot]];
  p.yaw=input.yaw;p.pitch=input.pitch;
  p.slide=Math.max(0,(p.slide||0)-dt);
  p.stamina=p.stamina??100;
  if(!(f&B.TACTICAL)&&p.stamina>25) p.exhausted=false;
  const moving=Math.hypot(input.ax,input.az)>.05;
  const wantsSprint=moving&&input.az>0.1&&!(f&(B.FIRE|B.ADS|B.PRONE|B.CROUCH));
  const tactical=wantsSprint&&!!(f&B.TACTICAL)&&!p.exhausted&&p.stamina>0;
  const sprint=wantsSprint&&!!(f&(B.SPRINT|B.TACTICAL));
  if(tactical) {p.stamina=Math.max(0,p.stamina-36*dt);if(p.stamina===0)p.exhausted=true;}
  else p.stamina=Math.min(100,p.stamina+(sprint?8:22)*dt);
  const velocity=Math.hypot(p.vx,p.vz);
  if((edge&B.SLIDE||edge&B.CROUCH)&&p.grounded&&velocity>6.5&&p.stamina>12&&p.slide===0) {
    p.slide=.68;p.stamina-=12;
    const factor=12.8/Math.max(velocity,1);p.vx*=factor;p.vz*=factor;
  }
  let height=p.slide>0?.76:(f&B.PRONE)?.56:(f&B.CROUCH)?1.08:STAND_HEIGHT;
  if(height>p.height&&!canStand(p,height,colliders)) height=p.height;
  p.height+=(height-p.height)*(1-Math.exp(-20*dt));
  if((edge&B.JUMP)&&p.grounded&&!(f&B.PRONE)) {p.vy=7.0;p.grounded=false;p.slide=0;}
  let speed=(f&B.PRONE)?1.8:(f&B.CROUCH)?3.25:(f&B.ADS)?4.1:tactical?12.2:sprint?9.3:6.5;
  speed*=w.move;
  const magnitude=Math.max(1,Math.hypot(input.ax,input.az));
  const ax=input.ax/magnitude,az=input.az/magnitude;
  const sin=Math.sin(input.yaw),cos=Math.cos(input.yaw);
  const wishX=(cos*ax+sin*az)*speed,wishZ=(sin*ax-cos*az)*speed;
  if(p.slide>0) {
    const decay=Math.exp(-1.05*dt);p.vx=p.vx*decay+wishX*.23*dt;p.vz=p.vz*decay+wishZ*.23*dt;
  } else {
    const accel=p.grounded?(moving?13.5:19):2.5,blend=1-Math.exp(-accel*dt);
    p.vx+=(wishX-p.vx)*blend;p.vz+=(wishZ-p.vz)*blend;
  }
  moveAxis(p,'x',p.vx*dt,colliders);moveAxis(p,'z',p.vz*dt,colliders);
  const oldY=p.y,oldTop=p.y+p.height;
  p.vy-=21*dt;p.y+=p.vy*dt;p.grounded=false;
  if(p.y<=0) {p.y=0;p.vy=0;p.grounded=true;}
  for(const b of colliders) {
    if(!overlapsXZ(p.x,p.z,b)) continue;
    if(p.vy<=0&&oldY>=b.maxY-.045&&p.y<=b.maxY) {p.y=b.maxY;p.vy=0;p.grounded=true;}
    else if(p.vy>0&&oldTop<=b.minY+.02&&p.y+p.height>=b.minY) {p.y=b.minY-p.height;p.vy=0;}
  }
  p.x=clamp(p.x,-MAP.width/2+RADIUS,MAP.width/2-RADIUS);
  p.z=clamp(p.z,-MAP.depth/2+RADIUS,MAP.depth/2-RADIUS);
  p.ads=!!(f&B.ADS)&&p.slide===0&&!p.reloadLeft;
}

// Cached walkability; A* is only run a few times per second, never per render frame.
export class Navigation {
  constructor() {
    this.cell=2;this.cols=36;this.rows=32;
    this.walkable=new Uint8Array(this.cols*this.rows);
    for(let z=0;z<this.rows;z++)for(let x=0;x<this.cols;x++) {
      const p=this.point(z*this.cols+x);
      this.walkable[z*this.cols+x]=COLLIDERS.some(b=>overlapsXZ(p.x,p.z,b,.65))?0:1;
    }
  }
  point(i) { return {x:(i%this.cols+.5)*this.cell-MAP.width/2,z:(Math.floor(i/this.cols)+.5)*this.cell-MAP.depth/2}; }
  index(p) { return clamp(Math.floor((p.z+MAP.depth/2)/this.cell),0,this.rows-1)*this.cols+clamp(Math.floor((p.x+MAP.width/2)/this.cell),0,this.cols-1); }
  nearest(p) {
    const start=this.index(p);if(this.walkable[start])return start;
    let best=start,d=Infinity;
    for(let i=0;i<this.walkable.length;i++)if(this.walkable[i]) {const q=this.point(i),v=Math.hypot(q.x-p.x,q.z-p.z);if(v<d){d=v;best=i;}}
    return best;
  }
  path(from,to) {
    const start=this.nearest(from),goal=this.nearest(to);
    if(start===goal) return [this.point(goal)];
    const n=this.walkable.length,g=new Float32Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),closed=new Uint8Array(n);
    const goalX=goal%this.cols,goalZ=Math.floor(goal/this.cols);
    const heuristic=i=>Math.abs(i%this.cols-goalX)+Math.abs(Math.floor(i/this.cols)-goalZ);
    const open=[start];g[start]=0;
    for(let steps=0;open.length&&steps<n;steps++) {
      let at=0;for(let k=1;k<open.length;k++)if(g[open[k]]+heuristic(open[k])<g[open[at]]+heuristic(open[at]))at=k;
      const current=open.splice(at,1)[0];
      if(current===goal) {
        const result=[];for(let p=goal;p!==start&&p!==-1;p=parent[p])result.push(this.point(p));
        return result.reverse();
      }
      closed[current]=1;
      for(const next of [current-1,current+1,current-this.cols,current+this.cols]) {
        if(next<0||next>=n||closed[next]||!this.walkable[next])continue;
        if(Math.abs(next%this.cols-current%this.cols)+Math.abs(Math.floor(next/this.cols)-Math.floor(current/this.cols))!==1)continue;
        const tentative=g[current]+1;
        if(tentative<g[next]) {g[next]=tentative;parent[next]=current;if(!open.includes(next))open.push(next);}
      }
    }
    return [];
  }
}
