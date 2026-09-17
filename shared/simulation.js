import { MAP, COLLIDERS } from './map.js';
import { WEAPONS, PRIMARY_IDS, cleanLoadout, cleanOperator, MODES } from './weapons.js';
import { B, EMPTY_INPUT, clamp, wrapAngle, cleanName } from './protocol.js';
import { STAND_HEIGHT, eyeHeight, direction, distance2, movePlayer, traceShot, visible, wallDistance, Navigation } from './physics.js';

const BOT_NAMES=['Rook','Mica','Flint','Echo','Sable','Talon','Vex','Oriel'];
const round=(n,places=100)=>Math.round(n*places)/places;
function rng(seed) { let s=seed|0||271828;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;}; }

export class World {
  constructor({mode='tdm',duration=300,limit,seed=Date.now(),roomId='practice',difficulty=.8,autoRestart=false}={}) {
    this.mode=MODES[mode]?mode:'tdm';this.duration=clamp(Number(duration)||300,60,900);
    this.limit=clamp(Number(limit)||MODES[this.mode].limit,1,500);
    this.random=rng(seed);this.roomId=roomId;this.difficulty=clamp(difficulty,.35,1.4);this.autoRestart=autoRestart;
    this.players=new Map();this.events=[];this.eventId=0;this.time=0;this.round=0;this.botCounter=0;
    this.navigation=new Navigation();this.grenades=Array.from({length:24},(_,id)=>({id,active:false}));
    this.resetRound();
  }
  emit(type,data={}) { const event={type,eid:++this.eventId,...data};this.events.push(event);return event; }
  resetRound() {
    this.round++;this.matchId=`${this.roomId}-${this.round}-${Math.floor(Date.now()/1000)}`;
    this.phase='playing';this.startedAt=this.time;this.endedAt=0;this.winner=null;this.scores=[0,0];this.nextScore=this.time+1;
    this.objectives=MAP.objectives.map(o=>({...o,owner:-1,progress:0,contested:false}));
    for(const g of this.grenades)g.active=false;
    for(const p of this.players.values()) {p.kills=0;p.deaths=0;p.score=0;this.spawn(p);}
    this.emit('round',{matchId:this.matchId});
  }
  get teams() {return MODES[this.mode].teams;}
  chooseTeam(preferred) {
    if(!this.teams)return 2;
    const counts=[0,0];for(const p of this.players.values())counts[p.team]++;
    if((preferred===0||preferred===1)&&counts[preferred]<=counts[1-preferred])return preferred;
    return counts[0]<=counts[1]?0:1;
  }
  addPlayer({id,name='Operator',team,forcedTeam,bot=false,loadout,operator='sentinel'}={}) {
    if(!id||this.players.has(id))return null;
    const authoritativeTeam=(forcedTeam===0||forcedTeam===1)?forcedTeam:undefined;
    const p={id,name:cleanName(name),team:authoritativeTeam ?? this.chooseTeam(team),bot,operator:cleanOperator(operator),loadout:cleanLoadout(loadout),slot:0,
      kills:0,deaths:0,score:0,input:{...EMPTY_INPUT},lastInputTime:this.time,lastSeq:-1,
      x:0,y:0,z:0,yaw:0,pitch:0,vx:0,vy:0,vz:0,height:STAND_HEIGHT,grounded:true,
      ai:{path:[],nextPath:0,target:null,reaction:0,phase:this.random()*6.28}};
    this.players.set(id,p);this.spawn(p);this.emit('joined',{id,name:p.name,team:p.team,bot});return p;
  }
  addBot() {
    const n=this.botCounter++,id=`bot-${n}`;
    return this.addPlayer({id,name:BOT_NAMES[n%BOT_NAMES.length],bot:true,loadout:[PRIMARY_IDS[n%PRIMARY_IDS.length],'relay9','edge'],operator:['sentinel','kestrel','circuit','frontline','juggernaut'][n%5]});
  }
  removePlayer(id) {const p=this.players.get(id);if(p){this.players.delete(id);this.emit('left',{id,name:p.name});}}
  spawn(p) {
    const enemies=[...this.players.values()].filter(q=>q.id!==p.id&&q.alive&&(!this.teams||q.team!==p.team));
    const candidates=MAP.spawns.filter(s=>!this.teams||s.team===p.team);
    let best=candidates[0],bestScore=-Infinity;
    for(const s of candidates) {
      let score=50+this.random()*9;
      if(enemies.length)score=Math.min(...enemies.map(e=>distance2(s,e)))+this.random()*5;
      for(const e of enemies)if(visible({...s,y:0,height:STAND_HEIGHT},e))score-=7;
      if(score>bestScore){bestScore=score;best=s;}
    }
    Object.assign(p,{x:best.x,y:0,z:best.z,yaw:best.yaw,pitch:0,vx:0,vy:0,vz:0,hp:100,armor:50,alive:true,grounded:true,
      height:STAND_HEIGHT,slide:0,stamina:100,exhausted:false,slot:0,ammo:p.loadout.map(id=>WEAPONS[id].magazine),reserve:p.loadout.map(id=>WEAPONS[id].reserve),
      reloadLeft:0,reloadTotal:0,nextShot:this.time+.2,nextMelee:this.time+.2,grenades:1,respawnAt:0,protectUntil:this.time+1.5,
      firedAt:-999,lastDamage:-999,spreadHeat:0,prevFlags:0,ads:false,nextSupply:this.time+4});
    p.input={...EMPTY_INPUT,yaw:best.yaw,seq:p.lastSeq,slot:0};p.lastInputTime=this.time;
    p.ai.path=[];p.ai.nextPath=0;
    this.emit('spawn',{id:p.id,x:p.x,z:p.z,yaw:p.yaw});
  }
  setInput(id,input) {
    const p=this.players.get(id);if(!p)return;
    p.input=input;p.lastSeq=input.seq;p.lastInputTime=this.time;
  }
  startReload(p) {
    const w=WEAPONS[p.loadout[p.slot]];
    if(w.magazine===0||p.reloadLeft>0||p.ammo[p.slot]>=w.magazine||p.reserve[p.slot]<=0)return false;
    p.reloadLeft=w.reload;p.reloadTotal=w.reload;this.emit('reload',{id:p.id,weapon:w.id});return true;
  }
  fire(p) {
    const w=WEAPONS[p.loadout[p.slot]];
    if(w.category==='Melee')return this.melee(p,true);
    if(this.time<p.nextShot||p.reloadLeft>0)return false;
    if(p.ammo[p.slot]<=0){this.startReload(p);return false;}
    p.nextShot=this.time+w.interval;p.ammo[p.slot]--;p.firedAt=this.time;p.protectUntil=this.time;
    const origin={x:p.x,y:p.y+eyeHeight(p),z:p.z},ends=[],hits=new Map();
    const moving=Math.hypot(p.vx,p.vz),base=p.ads?w.adsSpread:w.spread;
    const spread=base*(1+moving*.075+(p.grounded?0:1.3))+(p.ads?.18:1)*p.spreadHeat;
    for(let i=0;i<w.pellets;i++) {
      // Uniform disk distribution avoids an axis-aligned square spread pattern.
      const angle=this.random()*Math.PI*2,radius=Math.sqrt(this.random())*spread;
      const d=direction(p.yaw+Math.cos(angle)*radius,p.pitch+Math.sin(angle)*radius);
      const result=traceShot(origin,d,this.players.values(),p,w.range,this.teams);
      ends.push([round(result.end.x),round(result.end.y),round(result.end.z)]);
      if(result.hit) {
        const decay=1-(1-w.falloff)*clamp((result.distance-w.range*.25)/(w.range*.75),0,1);
        const previous=hits.get(result.hit.id)||{target:result.hit,damage:0,head:false};
        previous.damage+=w.damage*decay*(result.head?w.head:1);previous.head ||= result.head;hits.set(result.hit.id,previous);
      }
    }
    p.spreadHeat=Math.min(.035,p.spreadHeat+.005);
    this.emit('shot',{id:p.id,weapon:w.id,seq:p.lastSeq,origin:[round(origin.x),round(origin.y),round(origin.z)],ends});
    for(const hit of hits.values())this.damage(hit.target,p,hit.damage,hit.head,w.name);
    return true;
  }
  melee(p,equipped=false) {
    const w=WEAPONS.edge;
    if(this.time<p.nextMelee||this.time<p.nextShot)return false;
    p.nextMelee=this.time+w.interval;p.nextShot=this.time+w.interval;p.reloadLeft=0;p.firedAt=this.time;p.protectUntil=this.time;
    this.emit('melee',{id:p.id});
    let closest=null,distance=w.range;
    const forward=direction(p.yaw),o={x:p.x,y:p.y+eyeHeight(p)*.8,z:p.z};
    for(const q of this.players.values()) {
      if(!q.alive||q.id===p.id||(this.teams&&q.team===p.team))continue;
      const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz);
      if(d<distance&&Math.abs((q.y+q.height*.5)-(p.y+p.height*.5))<1.6&&(dx*forward.x+dz*forward.z)/Math.max(d,.01)>.55&&visible(p,q)){closest=q;distance=d;}
    }
    if(closest)this.damage(closest,p,w.damage,false,equipped?WEAPONS.edge.name:'MELEE');
    return true;
  }
  throwGrenade(p) {
    if(p.grenades<=0)return false;
    const g=this.grenades.find(g=>!g.active);if(!g)return false;
    p.grenades--;p.protectUntil=this.time;
    const d=direction(p.yaw,p.pitch),o={x:p.x,y:p.y+eyeHeight(p),z:p.z};
    const clearance=wallDistance(o,d,.65),offset=Math.max(0,clearance-.16);
    Object.assign(g,{active:true,owner:p.id,team:p.team,x:o.x+d.x*offset,y:o.y+d.y*offset,z:o.z+d.z*offset,vx:d.x*15,vy:d.y*15+5,vz:d.z*15,fuse:2.1});
    this.emit('throw',{id:p.id});return true;
  }
  damage(target,source,amount,head=false,weapon='FRAG') {
    if(!target.alive||target.protectUntil>this.time||!Number.isFinite(amount)||amount<=0)return false;
    if(source&&source.id!==target.id&&this.teams&&source.team===target.team)return false;
    amount=clamp(amount,0,500);
    const absorbed=Math.min(target.armor,amount*.6);target.armor-=absorbed;target.hp=Math.max(0,target.hp-(amount-absorbed));target.lastDamage=this.time;
    this.emit('hit',{source:source?.id||null,target:target.id,damage:Math.round(amount),head,x:source?.x??target.x,z:source?.z??target.z});
    if(target.hp<=0) {
      target.alive=false;target.deaths++;target.respawnAt=this.time+3;target.reloadLeft=0;target.vx=target.vy=target.vz=0;
      if(source&&source.id!==target.id&&this.players.get(source.id)===source) {
        source.kills++;source.score+=100+(head?25:0);
        const w=WEAPONS[source.loadout[source.slot]];source.reserve[source.slot]=Math.min(w.reserve,source.reserve[source.slot]+w.magazine);
        if(this.mode==='tdm')this.scores[source.team]++;
      }
      this.emit('kill',{killer:source?.id||null,killerName:source?.name||'Environment',victim:target.id,victimName:target.name,team:source?.team??2,weapon,head,suicide:source?.id===target.id});
    }
    return true;
  }
  updateGrenades(dt) {
    for(const g of this.grenades) {
      if(!g.active)continue;
      g.fuse-=dt;g.vy-=16*dt;
      for(const axis of ['x','z','y']) {
        const old=g[axis];g[axis]+=g[`v${axis}`]*dt;
        for(const b of COLLIDERS)if(g.x+.12>b.minX&&g.x-.12<b.maxX&&g.y+.12>b.minY&&g.y-.12<b.maxY&&g.z+.12>b.minZ&&g.z-.12<b.maxZ) {g[axis]=old;g[`v${axis}`]*=-.43;break;}
      }
      if(g.y<.13){g.y=.13;g.vy=Math.abs(g.vy)*.35;g.vx*=.96;g.vz*=.96;}
      if(g.fuse<=0) {
        g.active=false;this.emit('explosion',{x:g.x,y:g.y,z:g.z,owner:g.owner});
        const source=this.players.get(g.owner)||{id:g.owner,team:g.team,name:'Departed operator',x:g.x,z:g.z};
        for(const p of this.players.values())if(p.alive) {
          const target={x:p.x,y:p.y+p.height*.5,z:p.z},dist=Math.hypot(target.x-g.x,target.y-g.y,target.z-g.z);
          if(dist>6.5)continue;
          const d={x:(target.x-g.x)/Math.max(.01,dist),y:(target.y-g.y)/Math.max(.01,dist),z:(target.z-g.z)/Math.max(.01,dist)};
          if(wallDistance(g,d,dist)<dist-.25)continue;
          this.damage(p,source,150*Math.pow(1-dist/6.5,.7),false,'FRAG');
        }
      }
    }
  }
  updateBot(p,dt) {
    const ai=p.ai,skill=this.difficulty;
    const enemies=[...this.players.values()].filter(q=>q.alive&&q.id!==p.id&&(!this.teams||q.team!==p.team));
    enemies.sort((a,b)=>distance2(p,a)-distance2(p,b));
    const target=enemies.find(q=>distance2(p,q)<46&&visible(p,q));
    let goal=target||enemies[0]||MAP.objectives[1],engage=!!target;
    if(this.mode==='dom') {
      const uncaptured=this.objectives.filter(o=>o.owner!==p.team);
      const chosen=(uncaptured.length?uncaptured:this.objectives).slice().sort((a,b)=>distance2(p,a)-distance2(p,b))[0];
      if(!target||distance2(p,target)>15){goal=chosen;engage=false;}
    }
    const input={seq:p.lastSeq+1,ax:0,az:0,yaw:p.yaw,pitch:p.pitch,flags:0,slot:0};
    if(engage) {
      if(ai.target!==target.id){ai.target=target.id;ai.reaction=this.time+.32/skill;}
      const dx=target.x-p.x,dz=target.z-p.z,dist=Math.hypot(dx,dz),idealYaw=Math.atan2(dx,-dz);
      const wobble=Math.sin(this.time*2.9+ai.phase)*.017/skill;
      input.yaw=wrapAngle(p.yaw+clamp(wrapAngle(idealYaw+wobble-p.yaw),-dt*4.5*skill,dt*4.5*skill));
      const idealPitch=Math.atan2(target.y+target.height*.67-(p.y+eyeHeight(p)),dist);
      input.pitch=p.pitch+(idealPitch-p.pitch)*Math.min(1,dt*8*skill);
      if(dist>12)input.flags|=B.ADS;
      if(this.time>=ai.reaction&&Math.abs(wrapAngle(idealYaw-input.yaw))<.07&&p.protectUntil<this.time+.7) {
        const w=WEAPONS[p.loadout[0]];
        if(w.automatic||!(p.prevFlags&B.FIRE))input.flags|=B.FIRE;
      }
      input.ax=Math.sin(this.time*1.3+ai.phase)*.7;
      input.az=dist>23?.5:dist<6?-.7:0;
      if(p.ammo[p.slot]===0)input.flags|=B.RELOAD;
    } else {
      ai.target=null;
      if(this.time>ai.nextPath||!ai.path.length) {ai.path=this.navigation.path(p,goal);ai.nextPath=this.time+.8+this.random()*.4;}
      while(ai.path.length&&distance2(p,ai.path[0])<.8)ai.path.shift();
      const waypoint=ai.path[0]||goal,dx=waypoint.x-p.x,dz=waypoint.z-p.z,dist=Math.hypot(dx,dz);
      if(dist>.7) {
        const ideal=Math.atan2(dx,-dz);input.yaw=wrapAngle(p.yaw+clamp(wrapAngle(ideal-p.yaw),-dt*5,dt*5));
        input.ax=(dx*Math.cos(input.yaw)+dz*Math.sin(input.yaw))/dist;
        input.az=(dx*Math.sin(input.yaw)-dz*Math.cos(input.yaw))/dist;
        if(dist>2)input.flags|=B.SPRINT;
      }
      input.pitch*=Math.exp(-4*dt);
      if(p.ammo[p.slot]<WEAPONS[p.loadout[p.slot]].magazine*.4)input.flags|=B.RELOAD;
    }
    if(target&&distance2(p,target)<2.15)input.flags|=B.MELEE;
    this.setInput(p.id,input);
  }
  updateObjectives(dt) {
    if(this.mode!=='dom')return;
    for(const o of this.objectives) {
      const present=[...this.players.values()].filter(p=>p.alive&&distance2(p,o)<o.radius&&p.y<2.5),counts=[0,0];
      for(const p of present)counts[p.team]++;
      o.contested=counts[0]>0&&counts[1]>0;
      if(!o.contested&&(counts[0]||counts[1])) {
        const team=counts[0]?0:1,old=o.owner;
        o.progress=clamp(o.progress+(team===0?1:-1)*dt/6*Math.min(counts[team],2),-1,1);
        if(o.owner===0&&o.progress<=0||o.owner===1&&o.progress>=0)o.owner=-1;
        if(o.progress>=1)o.owner=0;else if(o.progress<=-1)o.owner=1;
        if(o.owner!==-1&&o.owner!==old) {
          for(const p of present)if(p.team===o.owner)p.score+=150;
          this.emit('capture',{objective:o.id,team:o.owner});
        }
      }
    }
    if(this.time>=this.nextScore) {this.nextScore=this.time+1;for(const o of this.objectives)if(o.owner>=0)this.scores[o.owner]++;}
  }
  finish(winner) {
    if(this.phase!=='playing')return;
    this.phase='ended';this.endedAt=this.time;this.winner=winner;this.emit('end',{winner,matchId:this.matchId});
  }
  checkEnd() {
    if(this.teams) {
      if(this.scores.some(s=>s>=this.limit))return this.finish(this.scores[0]===this.scores[1]?null:this.scores[0]>this.scores[1]?0:1);
    } else {
      const leader=[...this.players.values()].sort((a,b)=>b.kills-a.kills)[0];if(leader?.kills>=this.limit)return this.finish(leader.id);
    }
    if(this.time-this.startedAt>=this.duration) {
      if(this.teams)this.finish(this.scores[0]===this.scores[1]?null:this.scores[0]>this.scores[1]?0:1);
      else {const sorted=[...this.players.values()].sort((a,b)=>b.kills-a.kills);this.finish(sorted[0]&&sorted[0].kills!==(sorted[1]?.kills??-1)?sorted[0].id:null);}
    }
  }
  step(dt=1/60) {
    this.time+=dt;
    if(this.phase==='ended') {if(this.autoRestart&&this.time-this.endedAt>=12)this.resetRound();return;}
    for(const p of this.players.values()) {
      if(!p.alive) {if(this.time>=p.respawnAt)this.spawn(p);continue;}
      if(p.bot)this.updateBot(p,dt);
      if(this.time-p.lastInputTime>.3)p.input={...p.input,ax:0,az:0,flags:0};
      const input=p.input;
      if(input.slot!==p.slot) {p.slot=clamp(input.slot,0,2);p.reloadLeft=0;p.reloadTotal=0;p.nextShot=Math.max(p.nextShot,this.time+.17);}
      if(p.reloadLeft>0) {
        p.reloadLeft=Math.max(0,p.reloadLeft-dt);
        if(p.reloadLeft===0) {
          const slot=p.slot,w=WEAPONS[p.loadout[slot]],count=Math.min(w.magazine-p.ammo[slot],p.reserve[slot]);
          p.ammo[slot]+=count;p.reserve[slot]-=count;this.emit('reloaded',{id:p.id});
        }
      }
      p.spreadHeat*=Math.exp(-4*dt);
      movePlayer(p,input,dt);
      const edge=input.flags&~p.prevFlags;
      if(edge&B.RELOAD)this.startReload(p);
      if(edge&B.GRENADE)this.throwGrenade(p);
      if(edge&B.MELEE)this.melee(p);
      const w=WEAPONS[p.loadout[p.slot]];
      if(input.flags&B.FIRE&&(w.automatic||edge&B.FIRE))this.fire(p);
      p.prevFlags=input.flags;
      if(this.time-p.lastDamage>4.5)p.hp=Math.min(100,p.hp+11*dt);
      if(this.time>=p.nextSupply&&MAP.supplies.some(s=>distance2(s,p)<1.65)&&p.y<1) {
        const needs=p.armor<50||p.grenades<1||p.reserve.some((n,i)=>n<WEAPONS[p.loadout[i]].reserve);
        if(needs) {p.armor=50;p.grenades=1;p.reserve=p.loadout.map(id=>WEAPONS[id].reserve);p.nextSupply=this.time+20;this.emit('supply',{id:p.id});}
      }
    }
    this.updateGrenades(dt);this.updateObjectives(dt);this.checkEnd();
  }
  drainEvents() {const events=this.events;this.events=[];return events;}
  snapshot() {
    return {t:'state',time:round(this.time,1000),matchId:this.matchId,mode:this.mode,phase:this.phase,duration:this.duration,limit:this.limit,
      remaining:Math.max(0,round(this.duration-(this.time-this.startedAt),10)),scores:this.scores.slice(),winner:this.winner,nextRound:this.phase==='ended'?Math.max(0,round(12-(this.time-this.endedAt),10)):0,
      players:[...this.players.values()].map(p=>[p.id,p.name,p.team,round(p.x),round(p.y),round(p.z),round(p.yaw,1000),round(p.pitch,1000),Math.ceil(p.hp),Math.ceil(p.armor),+p.alive,p.slot,p.loadout,p.ammo.slice(),p.reserve.slice(),round(p.reloadLeft),p.kills,p.deaths,p.score,round(p.height),round(p.vx),round(p.vy),round(p.vz),+p.grounded,round(p.slide),round(p.stamina),round(p.respawnAt),round(p.protectUntil),+p.bot,p.operator,p.lastSeq,round(p.firedAt),p.grenades,round(p.reloadTotal),p.prevFlags,+p.ads,+!!p.exhausted]),
      objectives:this.objectives.map(o=>[o.id,o.owner,round(o.progress),+o.contested]),
      grenades:this.grenades.filter(g=>g.active).map(g=>[g.id,round(g.x),round(g.y),round(g.z),round(g.fuse)])};
  }
}
