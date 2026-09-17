import { MAP } from '../shared/map.js';
import { WEAPONS, MODES } from '../shared/weapons.js';
import { B } from '../shared/protocol.js';
import { clock, escapeHTML } from './storage.js';
import { icon,weaponSVG } from './icons.js';

export class HUD {
  constructor(root) {
    this.root=root;this.feed=[];this.scoreOpen=false;this.lastWeapon='';this.lastUpdate=0;
    root.innerHTML=`<div class="damage-vignette" id="damage-vignette"></div><div id="scope" class="scope hidden"><div class="scope-reticle"></div><span id="scope-label">PRECISION</span></div>
    <div class="hud-map"><div class="hud-map-header"><span>FOUNDRY</span><span>N ↑</span></div><canvas id="minimap" width="320" height="284"></canvas><div class="hud-map-footer"><i></i><span id="hud-location">TRAINING COMPLEX</span></div></div>
    <div class="hud-match"><div class="hud-mode" id="hud-mode"></div><div class="score-strip"><div class="team-score team-blue"><small id="score-label-blue">COBALT</small><strong id="score-blue">0</strong></div><div class="timer"><b id="match-timer">03:00</b><small id="score-limit">FIRST TO 40</small></div><div class="team-score team-orange"><small id="score-label-orange">EMBER</small><strong id="score-orange">0</strong></div></div><div id="hud-objectives" class="hud-objectives"></div><div class="objective-caption" id="objective-caption"></div></div>
    <div class="hud-right"><div class="net-status"><span id="hud-fps">60 FPS</span><i></i><span id="hud-network">LOCAL</span></div><div class="score-hint"><kbd>TAB</kbd> SCOREBOARD</div><div id="kill-feed" class="kill-feed"></div></div>
    <div id="crosshair" class="crosshair"><i></i><i></i><i></i><i></i><b></b></div><div id="hitmarker" class="hitmarker">×</div><div id="damage-direction" class="damage-direction"><i></i></div>
    <div id="event-notice" class="event-notice"></div><div class="capture-status hidden" id="capture-status"><span></span><progress class="progress progress-warning" max="1" value="0"></progress></div>
    <div class="hud-vitals"><div class="vital-row">${icon('plus',17)}<strong id="hp">100</strong><div class="vital-track"><i id="hp-bar"></i></div><small>HEALTH</small></div><div class="vital-row armor-row">${icon('shield',17)}<strong id="armor">50</strong><div class="vital-track"><i id="armor-bar"></i></div><small>ARMOR</small></div><div class="player-tag"><span id="player-tag">OPERATOR</span><b id="spawn-protect"></b></div></div>
    <div class="hud-movement"><span id="movement-state">STANDING</span><div class="stamina-track"><i id="stamina-bar"></i></div><small id="movement-hint">SHIFT SPRINT · C SLIDE · ESC MENU</small></div>
    <div class="hud-weapon"><div class="equipment"><kbd id="grenade-key">G</kbd>${icon('grenade',21)}<b id="frag-count">1</b><span>FRAG</span></div><div class="weapon-hud-icon" id="weapon-hud-icon"></div><div class="weapon-ammo"><div><small id="weapon-name">${WEAPONS.ar4.name}</small><span id="weapon-mode">AUTO / 5.56</span></div><strong id="ammo">30</strong><span class="reserve">/ <b id="reserve">120</b></span></div><div class="reload-info" id="reload-info"></div><progress class="reload-track progress progress-warning" id="reload-track" max="1" value="0"></progress></div>
    <div id="death-overlay" class="death-overlay hidden"><div class="eyebrow">OPERATOR DOWN</div><h2>REDEPLOYING</h2><p id="death-by"></p><div class="respawn-counter" id="respawn-counter">3</div><small>Automatic respawn · protection for 1.5 seconds</small></div>
    <div id="scoreboard" class="scoreboard hidden"></div>`;
    this.el=Object.fromEntries([...root.querySelectorAll('[id]')].map(el=>[el.id,el]));
    this.map=this.el.minimap.getContext('2d');this.baseMap=document.createElement('canvas');this.baseMap.width=320;this.baseMap.height=284;
    const c=this.baseMap.getContext('2d');c.fillStyle='#18272e';c.fillRect(0,0,320,284);
    c.strokeStyle='#2d4148';c.lineWidth=1;for(let x=0;x<320;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,284);c.stroke();}for(let y=0;y<284;y+=36){c.beginPath();c.moveTo(0,y);c.lineTo(320,y);c.stroke();}
    for(const b of MAP.obstacles){c.fillStyle=b.kind.startsWith('cargo')?'#887744':'#51676d';c.fillRect((b.x-b.w/2+36)/72*320,(b.z-b.d/2+32)/64*284,b.w/72*320,b.d/64*284);}
    this.hitUntil=0;this.damageUntil=0;this.noticeUntil=0;
  }
  show(){this.root.classList.remove('hidden');this.feed=[];this.scoreOpen=false;this.el['scoreboard'].classList.add('hidden');}
  hide(){this.root.classList.add('hidden');this.scoreboard(false);}
  scoreboard(show){this.scoreOpen=show;this.el.scoreboard.classList.toggle('hidden',!show);}
  notice(text,sub='',duration=1.8){this.el['event-notice'].innerHTML=`<strong>${escapeHTML(text)}</strong><span>${escapeHTML(sub)}</span>`;this.noticeUntil=performance.now()+duration*1000;}
  event(event,id,self) {
    const now=performance.now();
    if(event.type==='hit') {
      if(event.source===id&&event.target!==id){this.hitUntil=now+140;this.el.hitmarker.classList.toggle('headshot',event.head);}
      if(event.target===id){this.damageUntil=now+550;if(self){const angle=Math.atan2(event.x-self.x,-(event.z-self.z))-self.yaw;this.el['damage-direction'].style.transform=`translate(-50%,-50%) rotate(${angle}rad)`;}}
    }
    if(event.type==='kill') {
      this.feed.unshift({...event,expires:now+6500});this.feed=this.feed.slice(0,5);
      if(event.killer===id&&!event.suicide)this.notice(event.head?'+125  HEADSHOT':'+100  ELIMINATION',event.victimName);
      if(event.victim===id)this.el['death-by'].textContent=event.suicide?'YOUR OWN FRAG':`BY ${event.killerName.toUpperCase()} / ${event.weapon}`;
    }
    if(event.type==='supply'&&event.id===id)this.notice('RESUPPLIED','AMMUNITION · ARMOR · FRAG');
    if(event.type==='capture')this.notice(`ZONE ${event.objective} CAPTURED`,event.team===0?'COBALT CONTROL':'EMBER CONTROL');
  }
  update(state,self,{fps=60,ping=0,online=false,input={flags:0},settings,adsBlend}={}) {
    if(!self)return;const e=this.el,now=performance.now(),w=WEAPONS[self.loadout[self.slot]],mode=MODES[state.mode];
    e['hud-mode'].textContent=mode.name.toUpperCase();e['match-timer'].textContent=clock(state.remaining);e['score-limit'].textContent=`FIRST TO ${state.limit}`;
    if(state.mode==='ffa'){e['score-blue'].textContent=self.kills;e['score-orange'].textContent=Math.max(0,...state.players.map(p=>p.kills));e['score-label-blue'].textContent='YOU';e['score-label-orange'].textContent='LEADER';}
    else {e['score-blue'].textContent=state.scores[0];e['score-orange'].textContent=state.scores[1];e['score-label-blue'].textContent='COBALT';e['score-label-orange'].textContent='EMBER';}
    e['hud-fps'].textContent=`${Math.round(fps)} FPS`;e['hud-network'].textContent=online?`${ping} MS / LIVE`:'LOCAL / 60 HZ';e['player-tag'].textContent=self.name.toUpperCase();
    e['hp'].textContent=Math.ceil(self.hp);e['hp-bar'].style.width=`${self.hp}%`;e['armor'].textContent=Math.ceil(self.armor);e['armor-bar'].style.width=`${self.armor*2}%`;e['spawn-protect'].textContent=self.protectUntil>state.time?'PROTECTED':'';
    e['stamina-bar'].style.width=`${self.stamina}%`;e['movement-state'].textContent=self.slide>0?'SLIDING':self.height<.7?'PRONE':self.height<1.3?'CROUCHED':!self.grounded?'AIRBORNE':input.flags&B.TACTICAL?'TACTICAL SPRINT':input.flags&B.SPRINT?'SPRINTING':'STANDING';
    e['ammo'].textContent=w.magazine?self.ammo[self.slot]:'∞';e['reserve'].textContent=w.magazine?self.reserve[self.slot]:'—';e['ammo'].classList.toggle('low-ammo',w.magazine>0&&self.ammo[self.slot]<=Math.ceil(w.magazine*.2));
    e['weapon-name'].textContent=w.name;e['weapon-mode'].textContent=w.category==='Melee'?'CLOSE COMBAT':w.automatic?'FULL AUTO':'SEMI AUTO';e['frag-count'].textContent=self.grenades;
    if(this.lastWeapon!==w.id){e['weapon-hud-icon'].innerHTML=weaponSVG(w.id);this.lastWeapon=w.id;}
    e['reload-info'].textContent=self.reloadLeft>0?`RELOADING / ${self.reloadLeft.toFixed(1)}s`:self.ammo[self.slot]===0&&w.magazine?'RELOAD REQUIRED':'';
    e['reload-track'].value=self.reloadLeft>0?1-self.reloadLeft/self.reloadTotal:0;e['reload-track'].style.opacity=self.reloadLeft>0?'1':'0';
    const ads=!!(input.flags&B.ADS)&&self.reloadLeft<=0&&self.alive&&w.category!=='Melee',scope=ads&&(adsBlend===undefined||adsBlend>.85)&&w.category==='Sniper rifle';
    if(scope){const fov=settings?.fov||80,target=Math.min(fov,w.adsFov||28);e['scope-label'].textContent=`${w.name} / ×${(Math.tan(fov*Math.PI/360)/Math.tan(target*Math.PI/360)).toFixed(1)}`;}
    e.scope.classList.toggle('hidden',!scope);e.crosshair.classList.toggle('hidden',scope||!self.alive);e.crosshair.classList.toggle('ads',ads);
    e.crosshair.style.setProperty('--spread',`${ads?3:7+Math.hypot(self.vx,self.vz)*1.0+w.spread*90}px`);
    e.hitmarker.style.opacity=now<this.hitUntil?'1':'0';e['damage-vignette'].style.opacity=now<this.damageUntil?'.7':self.hp<28&&self.alive?'.25':'0';e['damage-direction'].style.opacity=now<this.damageUntil?'1':'0';
    e['event-notice'].style.opacity=now<this.noticeUntil?'1':'0';
    e['death-overlay'].classList.toggle('hidden',self.alive||state.phase==='ended');e['respawn-counter'].textContent=Math.max(1,Math.ceil(self.respawnAt-state.time));
    this.feed=this.feed.filter(f=>f.expires>now);
    e['kill-feed'].innerHTML=this.feed.map(f=>`<div class="feed-line ${f.killer===self.id?'feed-yours':''}"><b class="${f.team===0?'team-blue':'team-orange'}">${escapeHTML(f.killerName)}</b><span>${f.head?'⌖ ':''}${escapeHTML(f.weapon)}</span><b>${escapeHTML(f.victimName)}</b></div>`).join('');
    if(state.mode==='dom') {
      e['hud-objectives'].innerHTML=state.objectives.map(o=>`<div class="objective-pill ${o.owner===0?'owned-blue':o.owner===1?'owned-orange':''} ${o.contested?'contested':''}">${o.id}</div>`).join('');
      const near=state.objectives.find(o=>Math.hypot(self.x-o.x,self.z-o.z)<o.radius&&self.y<2.5);
      e['capture-status'].classList.toggle('hidden',!near||!self.alive);
      if(near){e['capture-status'].querySelector('span').textContent=`${near.contested?'CONTESTED':near.owner===self.team?'DEFENDING':'CAPTURING'} ${near.id}`;e['capture-status'].querySelector('progress').value=Math.abs(near.progress);}
    }else{e['hud-objectives'].innerHTML='';e['capture-status'].classList.add('hidden');}
    e['objective-caption'].textContent=mode.objective;
    this.drawMap(state,self);
    if(this.scoreOpen)this.drawScoreboard(state,self.id);
  }
  drawMap(state,self) {
    const c=this.map;c.drawImage(this.baseMap,0,0);const px=x=>(x+36)/72*320,pz=z=>(z+32)/64*284;
    if(state.mode==='dom')for(const o of state.objectives){c.fillStyle=o.owner===0?'#76d6eb':o.owner===1?'#ee9864':'#d4d5b5';c.beginPath();c.arc(px(o.x),pz(o.z),o.radius*3.6,0,6.283);c.globalAlpha=.3;c.fill();c.globalAlpha=1;c.font='bold 15px Arial';c.textAlign='center';c.fillText(o.id,px(o.x),pz(o.z)+5);}
    for(const s of MAP.supplies){c.fillStyle='#9fddba';c.fillRect(px(s.x)-2,pz(s.z)-2,4,4);}
    for(const p of state.players) {
      if(!p.alive||p.id===self.id)continue;
      const friendly=state.mode!=='ffa'&&p.team===self.team;
      if(!friendly&&(state.time-p.firedAt>1.5||Math.hypot(p.x-self.x,p.z-self.z)>32))continue;
      c.fillStyle=friendly?'#76d6eb':'#f09367';c.beginPath();c.arc(px(p.x),pz(p.z),4,0,Math.PI*2);c.fill();
    }
    c.save();c.translate(px(self.x),pz(self.z));c.rotate(self.yaw);c.fillStyle='#f9f2c3';c.beginPath();c.moveTo(0,-9);c.lineTo(6,6);c.lineTo(0,3);c.lineTo(-6,6);c.closePath();c.fill();c.restore();
  }
  drawScoreboard(state,id) {
    const sorted=state.players.slice().sort((a,b)=>b.score-a.score||b.kills-a.kills);
    this.el.scoreboard.innerHTML=`<div class="scoreboard-head"><div><div class="eyebrow">FOUNDRY / ${MODES[state.mode].short}</div><h2>MATCH SCOREBOARD</h2></div><b>${clock(state.remaining)}</b></div><table class="table"><thead><tr><th>OPERATOR</th><th>TEAM</th><th>K</th><th>D</th><th>SCORE</th></tr></thead><tbody>${sorted.map((p,i)=>`<tr class="${p.id===id?'you':''}"><td><span class="rank-index">${i+1}</span>${escapeHTML(p.name)} ${p.bot?'<small>AI</small>':p.id===id?'<small>YOU</small>':''}</td><td class="${p.team===0?'team-blue':'team-orange'}">${state.mode==='ffa'?'SOLO':p.team===0?'COBALT':'EMBER'}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td></tr>`).join('')}</tbody></table><div class="scoreboard-foot">${state.mode==='dom'?'ELIMINATION +100 · HEADSHOT +25 · CAPTURE +150':'ELIMINATION +100 · HEADSHOT +25'}<span>RELEASE TAB TO CLOSE</span></div>`;
  }
}
