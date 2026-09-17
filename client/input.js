import { B, clamp, wrapAngle } from '../shared/protocol.js';
export class Input {
  constructor(canvas,getSettings,{pause=()=>{},scoreboard=()=>{},notice=()=>{},action=()=>{}}={}) {
    this.canvas=canvas;this.getSettings=getSettings;this.onPause=pause;this.onScoreboard=scoreboard;this.notice=notice;this.onAction=action;
    this.enabled=false;this.inGame=false;this.held=new Set();this.pulses=0;this.prone=false;this.tacticalLatch=false;this.slot=0;this.seq=0;this.yaw=0;this.pitch=0;this.fallback=false;this.locked=false;
    this.lastShift=-1000;this.lastMouse={x:0,y:0};this.pointerDelta={x:0,y:0};
    document.addEventListener('keydown',e=>this.key(e,true));document.addEventListener('keyup',e=>this.key(e,false));
    document.addEventListener('mousemove',e=>this.mouseMove(e));
    canvas.addEventListener('mousedown',e=>{if(!this.enabled)return;e.preventDefault();canvas.focus();this.key({code:`Mouse${e.button}`,repeat:false,preventDefault(){}},true);if(!this.locked&&!this.fallback)this.lock();});
    document.addEventListener('mouseup',e=>this.key({code:`Mouse${e.button}`,repeat:false,preventDefault(){}},false));
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{if(!this.enabled)return;e.preventDefault();this.slot=(this.slot+(e.deltaY>0?1:2))%3;},{passive:false});
    window.addEventListener('blur',()=>{this.release();if(this.enabled)this.onPause();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.release();if(this.enabled)this.onPause();}});
    document.addEventListener('pointerlockchange',()=>{const was=this.locked;this.locked=document.pointerLockElement===canvas;if(this.locked&&!was)this.ignoreMouseUntil=performance.now()+120;if(was&&!this.locked&&this.enabled){this.release();this.onPause();}});
    document.addEventListener('pointerlockerror',()=>this.enableFallback());
  }
  key(e,down) {
    if(e.code==='Escape'&&down&&this.inGame){e.preventDefault();this.onPause();return;}
    if(!this.enabled){if(!down)this.held.delete(e.code);return;}
    if(e.target?.closest?.('input,textarea,select'))return;
    const b=this.getSettings().bindings,action=Object.keys(b).find(k=>b[k]===e.code);
    if(!action)return;
    e.preventDefault();if(down)this.held.add(e.code);else this.held.delete(e.code);this.onAction(action,down,e);
    if(action==='scoreboard'){this.onScoreboard(down);return;}
    if(action==='sprint'&&!down)this.tacticalLatch=false;
    if(!down||e.repeat)return;
    if(action==='sprint'){const now=performance.now();if(now-this.lastShift<290)this.tacticalLatch=true;this.lastShift=now;}
    if(action==='prone')this.prone=!this.prone;
    if(action==='crouch'||action==='jump')this.prone=false;
    if(action==='primary')this.slot=0;if(action==='secondary')this.slot=1;if(action==='knife')this.slot=2;if(action==='swap')this.slot=this.slot===0?1:0;
    const pulse={jump:B.JUMP,slide:B.SLIDE,reload:B.RELOAD,melee:B.MELEE,grenade:B.GRENADE}[action];if(pulse)this.pulses|=pulse;
  }
  mouseMove(e) {
    if(!this.enabled||performance.now()<(this.ignoreMouseUntil||0))return;
    if(!this.locked&&(!this.fallback||e.target!==this.canvas))return;
    const settings=this.getSettings(),scale=.0022*settings.sensitivity;
    const dx=clamp(e.movementX||0,-180,180),dy=clamp(e.movementY||0,-180,180);
    this.yaw=wrapAngle(this.yaw+dx*scale);this.pitch=clamp(this.pitch+dy*scale*(settings.invertY?1:-1),-1.48,1.48);
    this.pointerDelta.x+=dx;this.pointerDelta.y+=dy;
  }
  sample(consume=false) {
    const b=this.getSettings().bindings,has=k=>this.enabled&&this.held.has(b[k]);
    let flags=this.enabled?this.pulses:0;
    if(has('sprint'))flags|=B.SPRINT;if(has('tactical')||this.tacticalLatch)flags|=B.TACTICAL;
    if(has('crouch'))flags|=B.CROUCH;if(this.prone&&this.enabled)flags|=B.PRONE;if(has('fire'))flags|=B.FIRE;if(has('ads'))flags|=B.ADS;
    const result={seq:this.seq,ax:Number(has('right'))-Number(has('left')),az:Number(has('forward'))-Number(has('back')),yaw:this.yaw,pitch:this.pitch,flags,slot:this.slot};
    if(consume){result.seq=++this.seq;this.pulses=0;}
    return result;
  }
  recoil(w) {this.pitch=clamp(this.pitch+w.recoil,-1.48,1.48);this.yaw=wrapAngle(this.yaw+(Math.random()-.5)*w.recoil*.35);}
  setView(p){this.yaw=p.yaw;this.pitch=p.pitch;this.slot=p.slot??0;this.prone=false;}
  release(){this.held.clear();this.pulses=0;this.tacticalLatch=false;this.onScoreboard(false);}
  enableFallback(){this.fallback=true;if(!this.fallbackNotified){this.fallbackNotified=true;this.notice('Mouse capture is restricted here. Move the cursor over the arena to aim; run locally for unrestricted aiming.');}}
  lock() {
    this.canvas.focus({preventScroll:true});
    try {
      if(!this.canvas.requestPointerLock){this.enableFallback();return;}
      const promise=this.canvas.requestPointerLock();promise?.catch(()=>this.enableFallback());
    }catch{this.enableFallback();}
  }
  start(p){this.inGame=true;this.enabled=true;this.release();if(p)this.setView(p);this.lock();}
  pause(){this.enabled=false;this.release();if(document.pointerLockElement===this.canvas)document.exitPointerLock();}
  stop(){this.inGame=false;this.pause();}
}
