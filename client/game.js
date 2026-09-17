import { World } from '../shared/simulation.js';
import { MAP } from '../shared/map.js';
import { WEAPONS } from '../shared/weapons.js';
import { B, unpackPlayer, wrapAngle } from '../shared/protocol.js';
import { movePlayer } from '../shared/physics.js';

export function decodeState(packet) {
  return {...packet,players:packet.players.map(unpackPlayer),objectives:packet.objectives.map((o,i)=>({...MAP.objectives[i],id:o[0],owner:o[1],progress:o[2],contested:!!o[3]}))};
}
const MOTION=new Set(['x','y','z','vx','vy','vz','yaw','pitch','height','slide','stamina','exhausted','prevFlags']);
export class Game {
  constructor({renderer,input,audio,hud,network,store}) {
    Object.assign(this,{renderer,input,audio,hud,network,store});
    this.active=false;this.online=false;this.paused=false;this.world=null;this.state=null;this.local=null;this.snapshots=[];this.accumulator=0;this.sendAccumulator=0;this.fps=60;this.lastFrame=performance.now();this.lastHUD=0;this.lastEvent=0;this.lastFoot=0;this.correction={x:0,y:0,z:0};this.visualPrev=0;this.nextVisualShot=0;this.lastLocalFX=-Infinity;this.resultHandled=null;
    network.on('state',s=>this.receive(s));
    this.frame=this.frame.bind(this);this.raf=requestAnimationFrame(this.frame);
  }
  startPractice({mode=this.store.data.mode,...options}={}) {
    if(this.active)this.leave();
    this.online=false;this.id='local';this.world=new World({mode,...this.store.data.practice,...options,roomId:'practice'});
    const p=this.world.addPlayer({id:this.id,name:this.store.data.profile.name,operator:this.store.data.operator,loadout:this.store.data.loadout});
    const count=Number(options.bots??this.store.data.practice.bots);for(let i=0;i<count;i++)this.world.addBot();
    this.active=true;this.paused=false;this.accumulator=0;this.resultHandled=null;this.lastEvent=0;this.state=this.liveState();this.local=p;this.renderer.clear();this.hud.show();this.audio.unlock();this.audio.setGame(true);this.input.start(p);
    this.hud.notice('FIELD IS LIVE',`${this.state.mode.toUpperCase()} / FOUNDRY`,2.5);
  }
  startOnline(joined) {
    if(this.active){this.active=false;this.input.stop();}
    this.online=true;this.world=null;this.id=joined.id;this.state=decodeState(joined.state);this.local={...this.state.players.find(p=>p.id===this.id)};this.local.ammo=this.local.ammo.slice();
    this.snapshots=[{state:this.state,at:performance.now()}];this.lastReceive=performance.now();this.active=true;this.paused=true;this.lastEvent=0;this.resultHandled=null;this.accumulator=0;this.sendAccumulator=0;this.lastDedicatedFire=-Infinity;this.correction={x:0,y:0,z:0};this.input.inGame=true;this.input.setView(this.local);this.input.pause();this.renderer.clear();this.hud.show();this.audio.unlock();this.audio.setGame(true);
  }
  liveState() {
    const w=this.world;
    return {t:'state',time:w.time,matchId:w.matchId,mode:w.mode,phase:w.phase,duration:w.duration,limit:w.limit,remaining:Math.max(0,w.duration-(w.time-w.startedAt)),scores:w.scores,winner:w.winner,nextRound:0,players:[...w.players.values()],objectives:w.objectives,grenades:w.grenades.filter(g=>g.active).map(g=>[g.id,g.x,g.y,g.z,g.fuse])};
  }
  receive(packet) {
    if(!this.active||!this.online)return;
    const state=decodeState(packet),p=state.players.find(p=>p.id===this.id);if(!p)return;
    const newRound=this.state&&state.matchId!==this.state.matchId,respawn=p.alive&&(!this.local?.alive||newRound);
    this.state=state;this.lastReceive=performance.now();
    if(!this.local||respawn) {
      this.local={...p,ammo:p.ammo.slice(),reserve:p.reserve.slice()};this.input.setView(p);this.correction={x:0,y:0,z:0};this.nextVisualShot=0;this.visualPrev=0;
    } else {
      const future={...p};
      const lead=Math.min(.085,(this.network.ping||30)/2000);
      let remaining=lead;while(remaining>0){const dt=Math.min(1/60,remaining);movePlayer(future,this.input.sample(),dt);remaining-=dt;}
      const error={x:future.x-this.local.x,y:future.y-this.local.y,z:future.z-this.local.z};
      if(Math.hypot(error.x,error.y,error.z)>3.5||!p.alive){this.local.x=p.x;this.local.y=p.y;this.local.z=p.z;this.correction={x:0,y:0,z:0};}
      else this.correction=error;
      for(const [key,value] of Object.entries(p))if(!MOTION.has(key))this.local[key]=Array.isArray(value)?value.slice():value;
      for(const axis of ['vx','vy','vz'])this.local[axis]=this.local[axis]*.4+p[axis]*.6;
    }
    this.snapshots.push({state,at:this.lastReceive});if(this.snapshots.length>12)this.snapshots.shift();
    for(const event of packet.events||[])if(event.eid>this.lastEvent){this.lastEvent=event.eid;this.event(event);}
    if(newRound){this.resultHandled=null;this.snapshots=[{state,at:this.lastReceive}];this.setPaused(true);this.onRound?.();}
    this.checkEnd();
  }
  interpolate() {
    if(this.snapshots.length<2)return this.state;
    const target=this.state.time+(performance.now()-this.lastReceive)/1000-.085;
    let a=this.snapshots[0].state,b=this.state;
    for(let i=1;i<this.snapshots.length;i++)if(this.snapshots[i].state.time>=target){a=this.snapshots[i-1].state;b=this.snapshots[i].state;break;}
    const mix=Math.max(0,Math.min(1,(target-a.time)/Math.max(.001,b.time-a.time)));
    return {...this.state,players:this.state.players.map(p=> {
      const prev=a.players.find(q=>q.id===p.id),next=b.players.find(q=>q.id===p.id);if(!prev||!next||!prev.alive||!next.alive)return p;
      return {...p,x:prev.x+(next.x-prev.x)*mix,y:prev.y+(next.y-prev.y)*mix,z:prev.z+(next.z-prev.z)*mix,yaw:prev.yaw+wrapAngle(next.yaw-prev.yaw)*mix,pitch:prev.pitch+(next.pitch-prev.pitch)*mix,height:prev.height+(next.height-prev.height)*mix};
    })};
  }
  event(event) {
    const self=this.local||this.world?.players.get(this.id);this.hud.event(event,this.id,self);
    if(event.type==='shot') {
      this.renderer.effects.shot(event);const w=WEAPONS[event.weapon];
      if(event.id===this.id){if(!this.online||performance.now()-this.lastLocalFX>230)this.localShot(w);}
      else if(self){const dx=event.origin[0]-self.x,dz=event.origin[2]-self.z,dist=Math.hypot(dx,dz),pan=Math.sin(Math.atan2(dx,-dz)-this.input.yaw);this.audio.shoot(w,dist,pan);}
    }
    if(event.type==='hit'){if(event.source===this.id&&event.target!==this.id)this.audio.hit(event.head);if(event.target===this.id)this.renderer.damage();}
    if(event.type==='kill'&&event.killer===this.id&&!event.suicide)this.audio.kill();
    if(event.type==='reload'&&event.id===this.id)this.audio.reload();
    if(event.type==='reloaded'&&event.id===this.id)this.audio.loaded();
    if(event.type==='melee'&&event.id===this.id){this.renderer.melee();this.audio.melee();}
    if(event.type==='throw'&&event.id===this.id)this.audio.throw();
    if(event.type==='explosion'){this.renderer.effects.explosion(event.x,event.y,event.z);const dist=self?Math.hypot(event.x-self.x,event.z-self.z):0;this.audio.explosion(dist);if(dist<8)this.renderer.damage();}
    if(event.type==='spawn'&&event.id===this.id){const p=this.online?this.local:this.world.players.get(this.id);if(p){this.input.setView(p);this.nextVisualShot=0;this.visualPrev=0;this.lastDedicatedFire=-Infinity;}}
  }
  localShot(w){this.lastLocalFX=performance.now();this.renderer.localShot(w);this.input.recoil(w);this.audio.shoot(w);}
  flushInputIntent() {
    if(!this.online||!this.active||this.paused||!this.local?.alive||this.state?.phase!=='playing')return;
    this.network.fire(this.input.sample());
  }
  pumpDedicatedFire(input,now) {
    if(!this.online||!this.active||this.paused||!this.local?.alive||this.state?.phase!=='playing'||!(input.flags&B.FIRE))return;
    const w=WEAPONS[this.local.loadout[input.slot]], interval=Math.max(.06,w?.interval||.15)*1000;
    if(now-this.lastDedicatedFire>=interval){
      if(this.network.fire(input))this.lastDedicatedFire=now;
    }
  }
  predictShot(input) {
    const p=this.local,w=WEAPONS[p.loadout[input.slot]],now=performance.now()/1000,edge=input.flags&~this.visualPrev;
    if(p.alive&&!this.paused&&p.reloadLeft<=0&&input.flags&B.FIRE&&(w.automatic||edge&B.FIRE)&&now>=this.nextVisualShot) {
      if(w.category==='Melee'){this.renderer.melee();this.nextVisualShot=now+w.interval;}
      else if(p.ammo[input.slot]>0){p.ammo[input.slot]--;this.localShot(w);this.nextVisualShot=now+w.interval;}
    }
    this.visualPrev=input.flags;
  }
  checkEnd() {
    if(this.state?.phase==='ended'&&this.resultHandled!==this.state.matchId){this.resultHandled=this.state.matchId;this.setPaused(true);this.hud.scoreboard(false);this.onEnd?.(this.state,this.id,this.online);}
  }
  setPaused(paused) {
    if(!this.active)return;this.paused=paused;
    if(paused){this.input.pause();if(this.online)this.network.input(this.input.sample(true));}
    else{if(this.state?.phase==='ended')return;this.audio.unlock();this.input.start();}
  }
  leave() {
    if(this.online)this.network.leave();this.active=false;this.paused=false;this.world=null;this.state=null;this.local=null;this.snapshots=[];this.input.stop();this.renderer.clear();this.hud.hide();this.audio.setGame(false);
  }
  frame(now) {
    const rawDt=Math.max(.001,(now-this.lastFrame)/1000),dt=Math.min(.1,rawDt);this.lastFrame=now;this.fps+=(1/rawDt-this.fps)*.035;
    try {
      if(!this.active)this.renderer.renderMenu(now/1000,dt);
      else {
        // Admin FLY EDITING is a true frozen spectator/editing state.
        // Do not advance local simulation, predict shots, or render incoming network motion.
        if(this.renderer?.flyEditor?.active){
          const frozenState=this._editorFrozenState||this.state;
          const frozenLocal=this._editorFrozenLocal||this.local;
          if(frozenState&&frozenLocal)this.renderer.renderGame(frozenState,frozenLocal,{flags:0,yaw:this.input.yaw,pitch:this.input.pitch,slot:frozenLocal.slot??0},dt,now/1000);
          this.raf=requestAnimationFrame(this.frame);return;
        }
        this.accumulator+=dt;this.sendAccumulator+=dt;
        if(this.online) {
          while(this.accumulator>=1/60) {
            this.accumulator-=1/60;
            if(!this.paused&&this.local.alive&&this.state.phase==='playing') {
              const input=this.input.sample();this.local.slot=input.slot;movePlayer(this.local,input,1/60);this.local.prevFlags=input.flags;this.local.reloadLeft=Math.max(0,this.local.reloadLeft-1/60);
              for(const axis of ['x','y','z']){const step=this.correction[axis]*.18;this.local[axis]+=step;this.correction[axis]-=step;}
            }
          }
          const frameInput=this.input.sample();
          this.pumpDedicatedFire(frameInput,now);
          this.predictShot(frameInput);
          // Consume one-shot intentions only after local prediction has seen them.
          if(this.sendAccumulator>=1/30){this.network.input(this.input.sample(true));this.sendAccumulator%=1/30;}
        } else {
          while(this.accumulator>=1/60) {
            this.accumulator-=1/60;
            if(!this.paused){this.world.setInput(this.id,this.input.sample(true));this.world.step(1/60);this.local=this.world.players.get(this.id);for(const event of this.world.drainEvents())this.event(event);}
          }
          this.state=this.liveState();this.local=this.world.players.get(this.id);this.checkEnd();
        }
        const input=this.input.sample(),renderState=this.online?this.interpolate():this.state;
        this.renderer.renderGame(renderState,this.local,input,dt,now/1000);
        if(this.local.alive&&this.local.grounded&&!this.paused&&Math.hypot(this.local.vx,this.local.vz)>2&&now-this.lastFoot>Math.max(190,410-Math.hypot(this.local.vx,this.local.vz)*15)) {this.audio.step(Math.hypot(this.local.vx,this.local.vz)>7);this.lastFoot=now;}
        if(now-this.lastHUD>75){this.lastHUD=now;this.hud.update(this.state,this.local,{fps:this.fps,ping:this.network.ping,online:this.online,input,settings:this.store.data.settings,adsBlend:this.renderer.ads});this.onTick?.(this.state);}
      }
    } catch(error){console.error('Game loop failed:',error);this.input.stop();this.onFatal?.(error);return;}
    this.raf=requestAnimationFrame(this.frame);
  }
}
