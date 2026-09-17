import * as THREE from '../vendor/three.module.js';
import { apiURL } from './config.js';
import { WEAPONS,WEAPON_LIST,PRIMARY_IDS,SECONDARY_IDS,OPERATORS,MODES } from '../shared/weapons.js';
import { icon,weaponSVG,operatorSVG } from './icons.js';
import { escapeHTML as esc,keyLabel,clock,DEFAULT_BINDINGS } from './storage.js';
import { defaultServerURL } from './network.js';
import { SocialUI } from './social-ui.js';

const BIND_NAMES={forward:'Move forward',back:'Move backward',left:'Strafe left',right:'Strafe right',fire:'Fire weapon',ads:'Aim down sights',sprint:'Sprint',tactical:'Tactical sprint',crouch:'Crouch (hold)',prone:'Prone (toggle)',jump:'Jump',slide:'Slide',reload:'Reload',primary:'Primary weapon',secondary:'Sidearm',knife:'Melee weapon',swap:'Swap primary / sidearm',melee:'Quick melee',grenade:'Throw frag',scoreboard:'Scoreboard (hold)'};
const modeIcon={tdm:'users',ffa:'crosshair',dom:'flag'};
export class UI {
  constructor({store,game,network,renderer,audio,auth}) {
    Object.assign(this,{store,game,network,renderer,audio,auth});this.current='play';this.settingsTab='gameplay';this.weaponCategory='All';this.selectedWeapon=store.data.loadout[0];this.historyFilter='all';this.binding=null;
    this.menu=document.getElementById('menu');this.page=document.getElementById('page');this.header=document.getElementById('topbar');this.overlay=document.getElementById('overlay');this.toastElement=document.getElementById('toast');
    this.renderer.localMemberId=auth.user?.id;this.social=new SocialUI(this);
    document.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(button&&!button.disabled)this.click(button).catch(error=>this.toast(error.message||'That action could not be completed.'));});
    document.addEventListener('input',e=>this.change(e));document.addEventListener('change',e=>this.change(e));
    document.addEventListener('keydown',e=>this.captureBinding(e),true);document.addEventListener('mousedown',e=>this.captureBinding(e),true);
    document.addEventListener('contextmenu',e=>{if(this.binding)e.preventDefault();});
    network.on('rooms',()=>{if(this.current==='multiplayer'&&!this.game.active)this.renderRooms();});
    network.on('status',()=>{this.updateStatus();if(this.current==='multiplayer'&&!this.game.active)this.renderRooms();});
    network.on('queue',()=>this.updateQuickQueue());
    network.on('party',party=>{const kitKey=JSON.stringify((party?.members||[]).map(m=>[m.id,m.username,m.operator,m.loadout]));if(kitKey!==this._lobbyKitKey){this._lobbyKitKey=kitKey;this.renderer.setMenuParty?.(party?.members||[],party?.leaderId);}void this.syncPartyKit().catch(error=>this.toast(error.message));this.updateQuickQueue();});
    network.on('party-event',event=>{if(event?.event==='cancelled')this.renderer.showPartyCancellation?.(event.playerId,event.username,event.expiresAt);});
    network.on('social',()=>this.updateQuickFriends());
    network.on('error',message=>{this.setBusy(false);this.toast(message);});
    network.on('party-return',message=>{this.game.online=false;this.game.leave();this.closeOverlay();this.nav('play');this.toast(message);});
    network.on('joined',joined=>{this.setBusy(false);this.hideMenu();this.game.startOnline(joined);this.showPause(true);});
    network.on('disconnected',message=>{if(this.game.active&&this.game.online)this.toast('Connection interrupted — attempting to restore your match…');else this.toast(message);});
    network.on('reconnected',()=>this.toast('Connection restored. Resuming your match…'));
    network.on('reconnect-wait',ms=>{if(this.game.active&&this.game.online)this.toast(`Connection lost. Retrying in ${Math.ceil(ms/1000)}s…`);});
    game.onEnd=(state,id,online)=>this.showResults(state,id,online);game.onRound=()=>{this.hideMenu();this.showPause(true);};
    game.onTick=state=>{const countdown=document.getElementById('next-round');if(countdown)countdown.textContent=`${this.network.room?.queue?'RETURNING TO PARTY':'NEXT ROUND'} IN ${Math.ceil(state.nextRound)}s`;};
    game.onFatal=error=>this.fatal(error);
    this.quickTimer=setInterval(()=>this.updateQuickQueueTime(),500);
    this.flyButtonTimer=setInterval(()=>{if(this.auth.user?.isAdmin&&this.game.active)this.installFlyEditingButton();else if(!this.game.active)this.removeFlyEditingButton();},700);
    this.editorState={open:false,tool:'select',drag:null,resize:null,selected:null,changes:this.loadEditorChanges(),world:this.loadWorldChanges(),background:this.loadEditorBackground(),history:[],redo:[],historyTxn:null,historyTimer:null,locked:false,preview:false};
    this.installEditorPointerHandlers();this.installUIResizeHandlers();
    this.menuYawSaveTimer=null;this.renderer.canvas.addEventListener('hamu-menu-rotate',e=>{const id=e.detail?.operatorId;if(!id)return;this.store.data.menuYawByOperator??={};this.store.data.menuYawByOperator[id]=Number(e.detail.yaw)||0;clearTimeout(this.menuYawSaveTimer);this.menuYawSaveTimer=setTimeout(()=>this.store.save(),180);});
    document.addEventListener('hamu-operator-portraits',()=>this.hydrateOperatorPortraits());
    this.installGameplayEditorHandlers();
    document.addEventListener('keydown',e=>{if(e.code==='F9'&&!e.repeat){e.preventDefault();if(!this.auth.user?.isAdmin){this.toast('F9 ADMIN EDITOR is restricted.');return;}this.toggleGameplayEditor();}},true);
    network.on('ui-config',config=>this.applyRemoteEditorConfig(config));
    void this.fetchEditorConfig();
    this.nav('play');
    this.renderer.setMenuOperator(this.store.data.operator,Number(this.store.data.menuYawByOperator?.[this.store.data.operator])||0);
    this.renderer.setMenuParty?.(this.network.party?.members||[{id:this.auth.user?.id,username:this.auth.user?.username||this.store.data.profile.name,operator:this.store.data.operator,loadout:this.store.data.loadout}],this.network.party?.leaderId||this.auth.user?.id);
  }
  async syncPartyKit(){
    const party=this.network.party,me=party?.members.find(m=>m.id===this.auth.user?.id);
    if(this.kitSyncing||this.network.status!=='connected'||!me||party.status!=='idle')return;
    const kit={operator:this.store.data.operator,loadout:this.store.data.loadout.slice()};
    if(me.operator===kit.operator&&JSON.stringify(me.loadout)===JSON.stringify(kit.loadout))return;
    this.kitSyncing=true;try{await this.network.request('party.ready',{ready:party.leaderId===me.id,...kit});}finally{this.kitSyncing=false;}
    // A rapid second selection during the first request must not be lost.
    if(this.store.data.operator!==kit.operator||JSON.stringify(this.store.data.loadout)!==JSON.stringify(kit.loadout))await this.syncPartyKit();
  }
  headerHTML() {
    const p=this.store.data.profile;
    return `<button class="brand btn btn-ghost" data-action="nav" data-page="play" aria-label="Hamu Master home"><img src="./assets/emblem.svg" width="36" height="36" alt=""><span>HAMU<b>MASTER<span class="brand-dot">/</span></b></span></button><nav class="primary-nav" aria-label="Main menu">${[['play','Quick Play'],['friends','Friends'],['loadout','Loadout'],['weapons','Weapons'],['operators','Characters']].map(([id,label])=>`<button class="nav-link ${this.current===id?'active':''}" data-action="nav" data-page="${id}">${label}${id==='friends'?'<span class="nav-social-badge" id="nav-social-badge" hidden></span>':''}</button>`).join('')}</nav><div class="header-right">${this.auth.user?.isAdmin?'<button class="editor-open-button btn btn-ghost" data-action="open-editor" aria-label="Open visual UI editor">'+icon('settings',18)+'<span>EDIT UI</span></button>':''}<button class="settings-button btn btn-ghost" data-action="nav" data-page="settings" aria-label="Settings">${icon('settings',20)}<span>SETTINGS</span></button><button class="profile-button btn btn-ghost" data-action="nav" data-page="profile" aria-label="Profile"><span class="profile-avatar">${icon('operator',20)}</span><span><b>${esc(p.name)}</b><small>PROFILE / LVL ${this.store.level}</small></span></button></div>`;
  }
  nav(page) {
    this.binding=null;this.current=page;this.menu.classList.remove('hidden');this.menu.classList.toggle('interior',page!=='play');this.menu.classList.toggle('in-game-settings',this.game.active);
    this.header.innerHTML=this.headerHTML();this.overlay.classList.add('hidden');
    const renderers={play:()=>this.home(),friends:()=>this.multiplayer(),multiplayer:()=>this.multiplayer(),loadout:()=>this.loadout(),weapons:()=>this.weapons(),operators:()=>this.operators(),settings:()=>this.settings(),profile:()=>this.profile(),history:()=>this.history()};
    this.page.innerHTML=(renderers[page]||renderers.play)();this.page.scrollTop=0;this.prepareEditorTargets();this.updateStatus();
    if(page==='friends'){this.social.mount();this.renderRooms();}else if(page==='multiplayer'){this.social.mount();this.renderRooms();}else this.social.update();this.hydrateOperatorPortraits();
  }
  operatorArt(operator){const source=this.renderer.operatorPortraits?.get(operator.id)||'';return `<span class="operator-model-art ${source?'loaded':''}"><span class="operator-model-fallback">${operatorSVG(operator)}</span><img data-operator-portrait="${operator.id}" ${source?`src="${source}"`:''} alt="${esc(operator.name)} 3D model preview"></span>`;}
  hydrateOperatorPortraits(){for(const image of document.querySelectorAll('[data-operator-portrait]')){const source=this.renderer.operatorPortraits?.get(image.dataset.operatorPortrait);if(source&&image.src!==source){image.src=source;image.closest('.operator-model-art')?.classList.add('loaded');}}}
  pageHeading(kicker,title,description='') {
    return `<div class="page-heading"><div><div class="eyebrow"><span></span>${kicker}</div><h1>${title}</h1>${description?`<p>${description}</p>`:''}</div><button class="back-button btn btn-ghost" data-action="${this.game.active?'back-pause':'nav'}" data-page="play">${icon('arrow',17)} ${this.game.active?'BACK TO MATCH':'QUICK PLAY'}</button></div>`;
  }
  quickQueueHTML(){
    const q=this.network.queue,d=this.store.data,mode=MODES[q?.mode||d.mode];
    if(q)return `<div class="quick-queue-card searching" aria-live="polite"><div class="quick-queue-main"><div class="queue-visual" aria-hidden="true"><i></i><i></i><i></i></div><div><span class="eyebrow">QUICK PLAY / SEARCHING</span><strong>FIND PLAYERS</strong><small><b id="quick-queue-elapsed">${clock((Date.now()-q.startedAt)/1000)}</b> · LIVE ${esc(mode?.short||'MATCH')} QUEUE · BOTS AFTER <b class="quick-queue-fill">${q.fillAt<=Date.now()?'NOW':`${Math.max(0,Math.ceil((q.fillAt-Date.now())/1000))}s`}</b></small></div></div><div class="quick-queue-found" aria-label="Players found"><span>PLAYERS FOUND</span><strong id="quick-queue-count">${q.playersSearching} / ${q.capacity||8}</strong></div><button class="btn btn-outline" data-action="quick-queue-cancel">CANCEL SEARCH</button><p>Finding available players on the live server. This panel is status-only; use CANCEL SEARCH to leave the queue.</p></div>`;
    return `<div class="quick-queue-card ready"><div><span class="eyebrow">QUICK PLAY / SERVER MATCHMAKING</span><strong>FIND A MATCH FAST.</strong><small>Up to 4 operators · invite friends here · leader controls the playlist</small></div><button class="btn btn-warning quick-find-button" data-action="quickmatch" data-mode="${esc(d.mode)}">${icon('crosshair',20)} FIND MATCH</button><button class="btn btn-ghost practice-link" data-action="practice">LOCAL PRACTICE</button></div>`;
  }
  home() {
    const d=this.store.data,w=WEAPONS[d.loadout[0]]||WEAPONS.ar4,sidearm=WEAPONS[d.loadout[1]]||WEAPONS.relay9;
    const q=this.network.queue,queueMode=MODES[q?.mode||d.mode],queueCapacity=q?.capacity||8;
    const friends=this.network.social?.friends||[];

    const xp=d.profile?.xp||0,level=this.store.level,progress=xp%1500;
    const party=this.network.party;
    const selectedMode=party?.mode||d.mode;
    const members=party?.members||[];
    const leaderMember=members.find(m=>m.id===party?.leaderId)||members[0];
    const leader=party?.leaderId===this.auth.user?.id;
    const op=OPERATORS.find(o=>o.id===(leaderMember?.operator||d.operator))||OPERATORS[0];
    const incoming=(this.network.social?.invites||[]).filter(i=>i.expiresAt>Date.now()).slice(0,3);
    const partyRows=members.map(m=>`<div class="master-party-row ${m.id===party?.leaderId?'is-leader':''}"><span class="master-party-avatar">${esc(m.username.slice(0,2).toUpperCase())}</span><span class="master-party-copy"><strong>${esc(m.username)}${m.id===this.auth.user?.id?' <small>(YOU)</small>':''}</strong><small>${m.id===party?.leaderId?'LEADER':m.ready?'✓ READY':'NOT READY'} · ${esc(m.operator||'sentinel').toUpperCase()}</small></span>${leader&&m.id!==party?.leaderId?`<button class="master-kick" data-social="kick" data-user="${esc(m.id)}">×</button>`:''}</div>`).join('');
    const friendRows=this.social.friendsHTML();
    const inviteRows=incoming.length?incoming.map(i=>`<div class="master-invite-pending"><span>${esc(i.from.username.slice(0,2).toUpperCase())}</span><div><strong>${esc(i.from.username)}</strong><small>INVITED YOU · ${esc(MODES[i.mode]?.short||'MATCH')}</small></div><button data-social="accept-invite" data-invite="${esc(i.id)}">JOIN</button><button data-social="decline-invite" data-invite="${esc(i.id)}">×</button></div>`).join(''):'';
    const sideItems=[['play','play','PLAY'],['loadout','loadout','LOADOUT'],['weapons','crosshair','WEAPONS'],['operators','operator','CHARACTERS'],['history','history','MATCH HISTORY']];
    return `<section class="master-home master-home-v2">
      <div class="master-hero-shade"></div>
      <aside class="master-side-rail" aria-label="Lobby navigation">
        <div class="master-side-label">HAMU / LOBBY</div>
        <div class="master-side-items">${sideItems.map(([id,ico,label])=>`<button class="master-side-item ${id==='play'?'active':''}" data-action="nav" data-page="${id}">${icon(ico,20)}<span>${label}</span></button>`).join('')}</div>
        <div class="master-side-spacer"></div>
        <button class="master-side-item" data-action="nav" data-page="settings">${icon('settings',20)}<span>SETTINGS</span></button>
      </aside>

      <section class="master-playdeck">
        <div class="master-playdeck-kicker"><span></span>QUICK PLAY <b>/</b> SELECT YOUR DEPLOYMENT</div>
        <div class="master-mode-stack">
          ${Object.values(MODES).map(m=>`<button class="master-mode-card-v2 ${selectedMode===m.id?'selected':''}" data-action="mode" data-mode="${m.id}" aria-pressed="${selectedMode===m.id}" ${(!leader||party?.status==='queued')?'disabled':''}><span class="mode-v2-icon">${icon(modeIcon[m.id],24)}</span><span class="mode-v2-copy"><strong>${m.name.toUpperCase()}</strong><small>${m.description}</small><em>${m.id==='ffa'?'SOLO / 8 PLAYERS':m.id==='dom'?'4V4 / 8V8':'4V4 / 8V8'}</em></span><span class="mode-v2-arrow">›</span></button>`).join('')}
        </div>
        ${q?`<div class="master-queue-status master-queue-v2" aria-live="polite"><div class="master-queue-head"><span class="master-queue-pulse"><i></i><i></i><i></i></span><div><strong>SEARCHING FOR PLAYERS</strong><small>${esc(queueMode?.name||'MATCH')} · <b id="master-queue-elapsed">${clock((Date.now()-q.startedAt)/1000)}</b> · BOTS AFTER <b id="master-queue-fill">${q.fillAt<=Date.now()?'NOW':`${Math.max(0,Math.ceil((q.fillAt-Date.now())/1000))}s`}</b></small></div></div><div class="master-queue-count"><span>PLAYERS</span><strong id="master-queue-count">${q.playersSearching} / ${queueCapacity}</strong></div></div>`:''}
        ${leader||!party?`<button class="master-start-v2 btn ${q?'btn-outline master-start-cancel':'btn-warning'}" data-action="${q?'quick-queue-cancel':'quickmatch'}" data-mode="${esc(selectedMode)}" ${!q&&!members.every(m=>m.online&&m.ready)?'disabled':''}><span>${q?'×':'▶'}</span><div><strong>${q?'CANCEL SEARCH':'START MATCH'}</strong><small>${q?esc(queueMode?.short||'MATCH'):esc(MODES[selectedMode]?.short||'MATCH')}</small></div><b>›</b></button>${!q&&!members.every(m=>m.online&&m.ready)?`<div class="master-readiness-warning" role="status">WAITING FOR ${esc((members.filter(m=>m.id!==party?.leaderId&&!m.online).map(m=>m.username).join(', ')||members.filter(m=>m.id!==party?.leaderId&&!m.ready).map(m=>m.username).join(', ')||'ALL PLAYERS'))} TO BE READY</div>`:''}`:`<div class="master-guest-deploy"><div class="master-guest-readiness ${members.find(m=>m.id===this.auth.user?.id)?.ready?'is-ready':''}" role="status">${members.find(m=>m.id===this.auth.user?.id)?.ready?'READY':'NOT READY'}</div><button class="master-start-v2 master-guest-ready-button btn ${members.find(m=>m.id===this.auth.user?.id)?.ready?'btn-outline master-start-cancel':'btn-warning'}" data-social="${members.find(m=>m.id===this.auth.user?.id)?.ready?'unready':'ready'}"><span>${members.find(m=>m.id===this.auth.user?.id)?.ready?'×':'✓'}</span><div><strong>${members.find(m=>m.id===this.auth.user?.id)?.ready?'CANCEL':'READY'}</strong><small>${q?'CANCEL SEARCH · NOT READY':'YOUR READINESS'}</small></div><b>›</b></button></div>`}
      </section>

      <section class="master-center-caption">
        <div class="master-character-tag"><span class="tag-dot"></span><div><small>SELECTED CHARACTER</small><strong>${esc(op.name)}</strong></div></div>
        <div class="master-stage-copy"><span>FOUNDRY / 72 × 64 M</span><strong>READY FOR DEPLOYMENT</strong></div>
      </section>

      <aside class="master-right-rail">
        <button class="master-profile-card" data-action="nav" data-page="profile">
          <span class="master-profile-avatar">${this.operatorArt(op)}</span>
          <span class="master-profile-copy"><small>PROFILE / LVL ${level}</small><strong>${esc(d.profile.name)}</strong><span class="master-xp"><i style="width:${Math.max(2,Math.min(100,(progress/1500)*100))}%"></i></span><em>${progress.toLocaleString()} / 1,500 XP</em></span>
          <b>›</b>
        </button>
        <div class="master-right-panel master-social-lobby">
          <div class="master-right-tabs"><span class="active">SQUAD / ${members.length} / 4</span><span>${leader?'LEADER':'READY LOBBY'}</span></div>
          <div class="master-party-list">${partyRows||'<div class="master-friends-empty"><strong>CONNECTING SQUAD…</strong></div>'}</div>
          ${inviteRows?`<div class="master-subhead">INCOMING INVITES</div><div class="master-invite-list">${inviteRows}</div>`:''}
          <div class="master-subhead">FRIENDS <small id="quick-friends-count">${friends.length} TOTAL · ${friends.filter(p=>p.online).length} ONLINE</small></div>
          <div class="master-friend-list" id="quick-friends-list">${friendRows}</div>
        </div>
        <div class="master-mini-loadout">
          <div><span>LOADOUT</span><small>${esc(w.name)} / ${esc(sidearm.name)}</small></div><button data-action="nav" data-page="loadout">EDIT ›</button>
        </div>
      </aside>

      <div class="master-bottom-dock">
        <section class="master-character-strip-v2"><div class="master-strip-heading"><span>${icon('operator',18)} CHARACTERS</span><small>Choose your hero</small></div><div class="master-character-cards">${OPERATORS.map(o=>`<button class="master-character ${o.id===op.id?'active':''}" data-action="operator" data-id="${o.id}" aria-label="Select ${o.name}">${this.operatorArt(o)}<span>${o.name}</span></button>`).join('')}</div></section>
        <section class="master-weapon-strip-v2"><div class="master-strip-heading"><span>${icon('crosshair',18)} WEAPONS</span><small>Current loadout</small></div><div class="master-weapon-cards"><button class="master-weapon-card active" data-action="nav" data-page="loadout">${weaponSVG(w.id)}<span><b>${w.name}</b><small>PRIMARY</small></span></button><button class="master-weapon-card" data-action="nav" data-page="loadout">${weaponSVG(sidearm.id)}<span><b>${sidearm.name}</b><small>SIDEARM</small></span></button><button class="master-weapon-card" data-action="nav" data-page="weapons">${weaponSVG('edge')}<span><b>${WEAPONS.edge.name}</b><small>${WEAPONS.edge.category.toUpperCase()}</small></span></button></div></section>
      </div>
      <div class="master-status master-status-v2"><span><i></i> ${this.network.status==='connected'?'SOCIAL ONLINE':'LOCAL / OFFLINE'}</span><b>HAMU MASTER</b><small>BUILD V33.4</small></div>
    </section>`;
  }
  updateQuickFriends(){
    const host=document.getElementById('quick-friends-list');if(!host||this.game.active)return;const html=this.social.friendsHTML();if(host.socialHTML!==html){const top=host.scrollTop;host.innerHTML=html;host.socialHTML=html;host.scrollTop=top;}
    const count=document.getElementById('quick-friends-count'),friends=this.network.social?.friends||[];if(count)count.textContent=`${friends.length} TOTAL · ${friends.filter(p=>p.online).length} ONLINE`;
  }
  updateQuickQueue(){
    if(this.current==='play'&&!this.game.active){
      this.updateQuickQueueTime();if(this.editorState?.open||this._quickRefreshPending)return;
      this._quickRefreshPending=true;queueMicrotask(()=>{this._quickRefreshPending=false;if(this.current!=='play'||this.game.active||this.editorState?.open)return;
        const q=this.network.queue,key=JSON.stringify([this.network.party,q?[q.mode,q.startedAt]:null,this.store.data.mode,this.store.data.operator,this.store.data.loadout]);
        // Queue heartbeats change counters, not the whole lobby. Keep portraits,
        // SVGs, scroll position and editor bindings intact for unchanged state.
        if(this._quickHomeKey!==key){this._quickHomeKey=key;const top=this.page.scrollTop;this.page.innerHTML=this.home();this.page.scrollTop=top;this.prepareEditorTargets();this.hydrateOperatorPortraits();}
        this.updateQuickQueueTime();this.updateQuickFriends();
      });return;
    }
    const host=document.getElementById('quick-play-queue');if(!host)return;const html=this.quickQueueHTML();if(host.quickHTML!==html){host.innerHTML=html;host.quickHTML=html;}
  }
  updateQuickQueueTime(){
    const q=this.network.queue;if(!q)return;
    const elapsed=document.getElementById('master-queue-elapsed')||document.getElementById('quick-queue-elapsed');
    if(elapsed)elapsed.textContent=clock((Date.now()-q.startedAt)/1000);
    const fill=document.getElementById('master-queue-fill')||this.page.querySelector('.quick-queue-fill');
    if(fill)fill.textContent=q.fillAt<=Date.now()?'NOW':`${Math.max(0,Math.ceil((q.fillAt-Date.now())/1000))}s`;
    const count=document.getElementById('master-queue-count')||document.getElementById('quick-queue-count');
    if(count)count.textContent=`${q.playersSearching} / ${q.capacity||8}`;
  }
  multiplayer() { return this.social.pageHTML(); }
  loadout() {
    const d=this.store.data,a=WEAPONS[d.loadout[0]]||WEAPONS.ar4,b=WEAPONS[d.loadout[1]]||WEAPONS.relay9;
    return `<section class="panel-page">${this.pageHeading('ARMORY / YOUR KIT','LOADOUT','Choose a primary and a sidearm. Your kit is applied when you deploy.')}<div class="loadout-grid"><div class="loadout-slot primary-slot card"><div class="row-between"><span class="eyebrow">01 / PRIMARY WEAPON</span><span class="badge badge-outline">EQUIPPED</span></div>${weaponSVG(a.id)}<div class="row-between"><div><small>${a.category.toUpperCase()}</small><h2>${a.name}</h2></div><button class="btn btn-warning" data-action="change-weapon" data-slot="0">CHANGE PRIMARY ${icon('arrow',17)}</button></div><div class="mini-stats"><span><b>${a.damage}${a.pellets>1?' × '+a.pellets:''}</b>DAMAGE</span><span><b>${Math.round(60/a.interval)}</b>RPM</span><span><b>${a.magazine}</b>ROUNDS</span><span><b>${a.reload.toFixed(2)}s</b>RELOAD</span></div></div><div class="loadout-slot secondary-slot card"><span class="eyebrow">02 / SECONDARY WEAPON</span>${weaponSVG(b.id)}<small>${b.category.toUpperCase()}</small><h2>${b.name}</h2><p>${b.description}</p><button class="btn btn-outline" data-action="change-weapon" data-slot="1">CHANGE SIDEARM ${icon('arrow',17)}</button></div></div><div class="equipment-grid"><div class="equipment-card card"><span class="equipment-number">03</span><div>${weaponSVG('edge')}</div><section><span class="eyebrow">${WEAPONS.edge.category.toUpperCase()} / ALWAYS EQUIPPED</span><h3>${WEAPONS.edge.name}</h3><p>${WEAPONS.edge.damage} damage · ${WEAPONS.edge.range} m reach · fastest movement.</p></section><kbd>${keyLabel(d.settings.bindings.knife)}</kbd></div><div class="equipment-card card"><span class="equipment-number">04</span><span class="frag-large">${icon('grenade',58)}</span><section><span class="eyebrow">LETHAL / ONE PER SPAWN</span><h3>FRAG GRENADE</h3><p>2.1 s fuse · 6.5 m blast · blocked by cover.</p></section><kbd>${keyLabel(d.settings.bindings.grenade)}</kbd></div></div><div class="info-bar">${icon('shield',19)}<span>150 TOTAL EFFECTIVE HEALTH / 100 HEALTH + 50 ARMOR. Supply beacons restore armor, ammunition reserves and one frag. Safe health regenerates after 4.5 seconds.</span></div></section>`;
  }
  weapons() {
    const categories=['All',...new Set(WEAPON_LIST.map(item=>item.category))],w=WEAPONS[this.selectedWeapon]||WEAPON_LIST[0],equipped=w.category==='Melee'||this.store.data.loadout.includes(w.id),items=WEAPON_LIST.filter(item=>this.weaponCategory==='All'||item.category===this.weaponCategory);
    const stats=[['DAMAGE',w.pellets>1?`${w.damage} × ${w.pellets}`:w.damage,Math.min(100,w.damage*w.pellets/1.5)],['FIRE RATE',`${Math.round(60/w.interval)} RPM`,Math.min(100,60/w.interval/9.6)],['HIP ACCURACY',`${(w.spread*180/Math.PI).toFixed(2)}° SPREAD`,100-w.spread*850],['RECOIL',`${(w.recoil*180/Math.PI).toFixed(2)}° / SHOT`,100-w.recoil*1000],['MOBILITY',`${(6.5*w.move).toFixed(2)} M/S`,w.move/1.2*100]];
    return `<section class="panel-page">${this.pageHeading(`ARMORY / ${WEAPON_LIST.length} WEAPONS`,'WEAPONS','Every weapon has a purpose. Find the one that fits your tempo.')}<div class="weapon-filters" role="group" aria-label="Weapon categories">${categories.map(c=>`<button class="btn btn-sm ${c===this.weaponCategory?'btn-warning':'btn-ghost'}" data-action="weapon-filter" data-category="${c}">${c.toUpperCase()}</button>`).join('')}</div><div class="armory-grid"><div class="weapon-list">${items.map(item=>`<button class="weapon-card card ${item.id===w.id?'active':''}" data-action="inspect-weapon" data-id="${item.id}"><div><span class="eyebrow">${item.short}</span>${this.store.data.loadout.includes(item.id)?'<span class="equipped-dot"></span>':''}</div>${weaponSVG(item.id)}<strong>${item.name}</strong><small>${item.automatic?'AUTOMATIC':'SEMI AUTO'} / ${item.magazine||'MELEE'}</small></button>`).join('')}</div><div class="weapon-detail card"><div class="row-between"><span class="eyebrow">${w.category.toUpperCase()} / SUPPLIED MODEL</span><span class="weapon-index">${String(WEAPON_LIST.indexOf(w)+1).padStart(2,'0')}</span></div><h2>${w.name}</h2><p>${w.description}</p><div class="detail-weapon">${weaponSVG(w.id)}</div><div class="weapon-stats">${stats.map(([name,value,percent])=>`<div><span>${name}</span><b>${value}</b><i><em style="width:${Math.max(3,percent)}%"></em></i></div>`).join('')}</div><div class="detail-numbers"><span><strong>${w.magazine||'∞'}</strong>MAGAZINE</span><span><strong>${w.reload?w.reload+'s':'—'}</strong>RELOAD</span><span><strong>${w.range}m</strong>RANGE</span></div><button class="btn ${equipped?'btn-outline':'btn-warning'} equip-weapon" data-action="equip-weapon" data-id="${w.id}" ${equipped?'disabled':''}>${w.category==='Melee'?'ALWAYS EQUIPPED':equipped?icon('check',18)+' EQUIPPED':`EQUIP ${w.category==='Pistol'?'SIDEARM':'PRIMARY'} ${icon('arrow',18)}`}</button><p class="fine-print">${w.category==='Melee'?'Always available in slot 3. Quick melee works from any weapon.':`Head multiplier ×${w.head} · ADS spread ${(w.adsSpread*180/Math.PI).toFixed(2)}° · reserve ${w.reserve} rounds. Damage falls off with range; ADS improves accuracy.`}</p></div></div></section>`;
  }
  operators() {
    return `<section class="panel-page">${this.pageHeading('PERSONNEL / CHOOSE YOUR IDENTITY','CHARACTERS','Five unique 3D characters. One level playing field.')}<div class="operator-grid">${OPERATORS.map(o=>`<div class="operator-card card ${this.store.data.operator===o.id?'active':''}"><div class="row-between"><span class="eyebrow">DIVISION ${o.tag}</span>${this.store.data.operator===o.id?'<span class="badge badge-warning">ACTIVE</span>':''}</div>${this.operatorArt(o)}<small>${o.role}</small><h2>${o.name}</h2><p>${o.description}</p><button class="btn ${this.store.data.operator===o.id?'btn-outline':'btn-warning'}" data-action="operator" data-id="${o.id}" ${this.store.data.operator===o.id?'disabled':''}>${this.store.data.operator===o.id?icon('check',18)+' SELECTED':'SELECT OPERATOR '+icon('arrow',18)}</button></div>`).join('')}</div><div class="info-bar">${icon('shield',20)}<span>COSMETIC ONLY. All operators share the same hitboxes, health, armor and movement. Team identification remains visible in matches.</span></div></section>`;
  }
  settings() {
    const s=this.store.data.settings,t=this.settingsTab;
    const range=(key,label,min,max,step,unit='',help='')=>`<div class="setting-row"><div><label for="setting-${key}">${label}</label><p>${help}</p></div><div class="range-control"><input type="range" class="range range-warning range-sm" id="setting-${key}" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><output id="value-${key}">${s[key]}${unit}</output></div></div>`;
    const toggle=(key,label,help)=>`<div class="setting-row"><div><label for="setting-${key}">${label}</label><p>${help}</p></div><input type="checkbox" id="setting-${key}" class="toggle toggle-warning" data-setting="${key}" ${s[key]?'checked':''}></div>`;
    let content='';
    if(t==='gameplay')content=range('sensitivity','Mouse sensitivity',.2,3,.05,'×','Raw mouse movement. No aim assistance.')+toggle('invertY','Invert vertical aim','Reverse the vertical mouse axis.')+`<div class="setting-tip">${icon('bolt',22)}<div><strong>MOVEMENT IS YOUR ADVANTAGE</strong><p>Double-tap sprint or hold tactical sprint for a short burst. Crouch while sprinting, or press Slide, to slide. Jump out to keep moving. Tactical sprint consumes stamina.</p></div></div>`;
    if(t==='video')content=range('fov','Field of view',70,120,1,'°','Vertical camera FOV. ADS smoothly narrows your view.')+`<div class="setting-row"><div><label for="quality-select">Graphics quality</label><p>Adjusts render resolution, dynamic shadows and impact particles.</p></div><select class="select" id="quality-select" data-setting="quality">${['low','medium','high'].map(v=>`<option value="${v}" ${s.quality===v?'selected':''}>${v.toUpperCase()}</option>`).join('')}</select></div>`+toggle('reducedMotion','Reduce camera motion','Disable head-bob, camera roll and damage shake. Gameplay recoil is unchanged.')+`<div class="setting-row"><div><strong>Fullscreen</strong><p>For the best desktop aiming experience. Escape leaves mouse capture.</p></div><button class="btn btn-outline" data-action="fullscreen">${icon('fullscreen',18)} TOGGLE FULLSCREEN</button></div>`;
    if(t==='audio')content=range('volume','Master volume',0,100,1,'%','All audio output.')+range('effects','Effects volume',0,100,1,'%','Weapon reports, footsteps, hits and UI feedback.')+range('ambience','Ambient volume',0,100,1,'%','An original synthesized hangar drone. Reduced during play.')+`<div class="setting-tip">${icon('volume',22)}<div><strong>100% PROCEDURAL AUDIO</strong><p>Every report, impact and tone is synthesized locally. No licensed game recordings or downloaded sound packs.</p></div></div>`;
    if(t==='controls')content=`<div class="bindings-intro">Select a key, then press a new key or mouse button. Escape cancels. Duplicate bindings are swapped automatically.</div><div class="bindings-grid">${Object.entries(BIND_NAMES).map(([key,label])=>`<div class="binding-row"><span>${label}</span><button class="btn btn-outline btn-sm ${this.binding===key?'listening':''}" data-action="bind" data-bind="${key}">${this.binding===key?'PRESS A KEY…':keyLabel(s.bindings[key])}</button></div>`).join('')}</div><p class="fine-print">Mouse wheel also cycles weapons. Escape is reserved for the pause menu. Sprint double-tap is always enabled.</p>`;
    return `<section class="panel-page">${this.pageHeading('SYSTEM / MAKE IT YOURS','SETTINGS','Changes apply immediately and are saved in this browser.')}<div class="settings-layout"><aside class="settings-tabs">${[['gameplay','crosshair','Gameplay'],['controls','weapon','Controls'],['video','monitor','Video'],['audio','volume','Audio']].map(([id,i,name])=>`<button class="${t===id?'active':''}" data-action="settings-tab" data-tab="${id}">${icon(i,20)}${name}</button>`).join('')}<button class="reset-settings" data-action="reset-settings">${icon('history',17)} RESET SETTINGS</button></aside><div class="settings-content card">${content}<div class="settings-saved">${icon('check',15)} SAVED LOCALLY / NO ACCOUNT REQUIRED</div></div></div></section>`;
  }
  profile() {
    const p=this.store.data.profile,level=this.store.level,progress=p.xp%1500,rank=['CADET','RECRUIT','FIELD OPERATOR','SPECIALIST','VANGUARD'][Math.min(4,Math.floor((level-1)/3))];
    return `<section class="panel-page">${this.pageHeading('SERVICE RECORD / ACCOUNT','PROFILE','Your identity and progression are saved to your account on this game server, separately for each permanent player ID.')}<div class="profile-grid"><div class="profile-identity card"><span class="rank-emblem">${icon('shield',70)}</span><span class="eyebrow">${rank}</span><h2>${esc(p.name)}</h2><span class="level-tag">LEVEL ${level}</span><div class="rank-progress"><progress class="progress progress-warning" max="1500" value="${progress}"></progress><span>${progress.toLocaleString()} / 1,500 XP TO NEXT LEVEL</span></div><label class="field-label">UNIQUE ACCOUNT NAME<input id="profile-name" class="input" value="${esc(p.name)}" readonly></label><span class="eyebrow">PERMANENT PLAYER ID</span><code class="account-id">${esc(this.auth.user.id)}</code><span class="eyebrow">LINKED EMAIL / PRIVATE</span><p class="fine-print">${this.auth.user.email?esc(this.auth.user.email)+' — UNVERIFIED':'No email linked (legacy account).'}</p><button class="btn btn-outline btn-sm" data-action="link-email">${this.auth.user.email?'CHANGE LINKED EMAIL':'LINK EMAIL'}</button><p class="fine-print">Emails are never shown to other players. This build does not verify Gmail ownership or provide password reset.</p><button class="btn btn-outline" data-action="logout">LOG OUT</button></div><div class="profile-stats"><div class="stat-cards">${[['ELIMINATIONS',p.kills],['K / D',p.deaths?(p.kills/p.deaths).toFixed(2):p.kills?'∞':'—'],['VICTORIES',p.wins],['MATCHES',p.matches],['WIN RATE',p.matches?Math.round(p.wins/p.matches*100)+'%':'—'],['TIME IN FIELD',Math.floor(p.time/60)+' MIN']].map(([label,value])=>`<div class="stat-card card"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><div class="service-note card"><span class="eyebrow">PROGRESSION / EARNED IN THE FIELD</span><h3>EVERY COMPLETED MATCH COUNTS.</h3><p>250 XP for completing a match, plus your match score. Victories earn a 150 XP bonus. Elimination +100, headshot +25, zone capture +150. No paid unlocks. Every weapon is yours from the start.</p><button class="text-link" data-action="nav" data-page="history">VIEW MATCH HISTORY ${icon('arrow',18)}</button></div></div></div><div class="info-bar">${icon('history',18)}<span>SERVER-SAVED PROGRESS. Loadouts, characters, settings, XP, stats and match history are linked to your permanent account ID. Clearing browser data does not delete server progress.</span></div></section>`;
  }
  history() {
    const matches=this.store.data.history.filter(m=>this.historyFilter==='all'||m.mode===this.historyFilter);
    return `<section class="panel-page">${this.pageHeading('AFTER ACTION / LAST 50 MATCHES','MATCH HISTORY','Completed matches only. Your record starts with your first deployment.')}<div class="history-toolbar"><div class="weapon-filters">${[['all','ALL MODES'],['tdm','TEAM DEATHMATCH'],['ffa','FREE FOR ALL'],['dom','DOMINATION']].map(([id,name])=>`<button class="btn btn-sm ${id===this.historyFilter?'btn-warning':'btn-ghost'}" data-action="history-filter" data-mode="${id}">${name}</button>`).join('')}</div><button class="btn btn-outline btn-sm" data-action="export-history" ${this.store.data.history.length?'':'disabled'}>EXPORT CSV ${icon('arrow',15)}</button></div>${matches.length?`<div class="history-table card"><table class="table"><thead><tr><th>RESULT</th><th>MODE / MAP</th><th>K / D</th><th>SCORE</th><th>XP</th><th>WHEN</th><th></th></tr></thead><tbody>${matches.map(m=>`<tr><td><span class="result-chip ${m.result.toLowerCase()}">${m.result}</span><small>${m.online?'MULTIPLAYER':'PRACTICE'}</small></td><td><b>${MODES[m.mode]?.name||m.mode}</b><small>FOUNDRY / ${clock(m.duration)}</small></td><td><strong>${m.kills}</strong> / ${m.deaths}</td><td>${m.score}</td><td class="xp-text">+${m.xp}</td><td>${new Date(m.date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}<small>${new Date(m.date).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</small></td><td><button class="btn btn-ghost btn-sm" data-action="match-detail" data-id="${esc(m.id)}" aria-label="View match details">${icon('arrow',17)}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state card">${icon('history',48)}<h2>YOUR NEXT MATCH IS YOUR FIRST ENTRY.</h2><p>${this.historyFilter==='all'?'Finish a match to record your result, score and earned XP.':'No completed matches in this mode yet.'}</p><button class="btn btn-warning" data-action="nav" data-page="play">GO TO QUICK PLAY ${icon('arrow',18)}</button></div>`}</section>`;
  }
  loadEditorChanges(){try{return JSON.parse(localStorage.getItem('hamu-master-ui-editor-v2')||'{}')||{};}catch{return {};}}
  loadWorldChanges(){try{return JSON.parse(localStorage.getItem('hamu-master-ui-world-editor-v2')||'{}')||{};}catch{return {};}}
  loadEditorBackground(){try{return JSON.parse(localStorage.getItem('hamu-master-ui-background-v1')||'{}')||{};}catch{return {};}}
  saveEditorChanges(){localStorage.setItem('hamu-master-ui-editor-v2',JSON.stringify(this.editorState.changes||{}));localStorage.setItem('hamu-master-ui-world-editor-v2',JSON.stringify(this.editorState.world||{}));localStorage.setItem('hamu-master-ui-background-v1',JSON.stringify(this.editorState.background||{}));}
  async fetchEditorConfig(){try{const r=await fetch(apiURL('/api/ui-config'),{cache:'no-store',credentials:'include'});if(!r.ok)return;const d=await r.json();this.applyRemoteEditorConfig(d.config);}catch{}}
  applyRemoteEditorConfig(config){if(!config||config.version!==2)return;this.editorState.changes=config.changes&&typeof config.changes==='object'?JSON.parse(JSON.stringify(config.changes)):{};this.editorState.world=config.world&&typeof config.world==='object'?JSON.parse(JSON.stringify(config.world)):{};this.editorState.background=config.background&&typeof config.background==='object'?JSON.parse(JSON.stringify(config.background)):{};this.saveEditorChanges();this.prepareEditorTargets();this.applyMenuBackground();this.applyWorldEditorChanges();if(this.editorState.open){this.renderUISelectionFrame();this.updateEditorInspector();}}
  async persistEditorConfig(){if(!this.auth.user?.isAdmin)throw new Error('Admin access required.');const response=await fetch(apiURL('/api/ui-config'),{method:'PUT',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes:this.editorState.changes,world:this.editorState.world,background:this.editorState.background})});const data=await response.json().catch(()=>({error:'UI save failed.'}));if(!response.ok)throw new Error(data.error||'UI save failed.');this.applyRemoteEditorConfig(data.config);return data.config;}
  applyMenuBackground(){
    const bg=this.editorState?.background||{};
    document.getElementById('hamu-menu-background-layer')?.remove();
    if(this.current!=='play'||!bg.url||!this.page)return;
    const lobby=this.page.querySelector('.master-home-v2,.master-home')||this.page;
    const layer=document.createElement('div');layer.id='hamu-menu-background-layer';layer.setAttribute('aria-hidden','true');
    Object.assign(layer.style,{position:'absolute',inset:'0',zIndex:'0',pointerEvents:'none',backgroundImage:`url("${String(bg.url).replace(/"/g,'')}")`,backgroundSize:bg.size||'cover',backgroundPosition:bg.position||'center center',backgroundRepeat:bg.repeat||'no-repeat',backgroundColor:bg.overlay||'transparent'});
    if(getComputedStyle(lobby).position==='static')lobby.style.position='relative';
    lobby.insertBefore(layer,lobby.firstChild);
    [...lobby.children].forEach(ch=>{if(ch!==layer){const z=getComputedStyle(ch).zIndex;if(z==='auto')ch.style.position=getComputedStyle(ch).position==='static'?'relative':getComputedStyle(ch).position;ch.style.zIndex=ch.style.zIndex==='auto'?'1':ch.style.zIndex;}});
  }
  async uploadEditorImage(file){
    if(!this.auth.user?.isAdmin)throw new Error('Admin access required.');
    if(!file)throw new Error('Choose an image first.');
    const mime=String(file.type||'').toLowerCase(),name=String(file.name||'').toLowerCase();
    const okMime=['image/png','image/jpeg','image/webp'].includes(mime);
    const okExt=/\.(png|jpe?g|webp)$/.test(name);
    if(!okMime&&!okExt)throw new Error('Only PNG, JPG or WebP images are allowed.');
    if(file.size>8*1024*1024)throw new Error('Image is too large. Maximum 8 MB.');
    const uploadType=okMime?mime:(name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':'image/jpeg');
    const response=await fetch(apiURL('/api/ui-image'),{method:'POST',credentials:'include',headers:{'Content-Type':uploadType,'X-File-Name':encodeURIComponent(file.name.slice(0,100))},body:file});
    const data=await response.json().catch(()=>({error:'Image upload failed.'}));
    if(!response.ok)throw new Error(data.error||'Image upload failed.');
    return data.url;
  }
  async setSelectedElementImage(file){
    const el=this.editorState.selected;if(!el)throw new Error('Select a UI element first.');
    const url=await this.uploadEditorImage(file);
    this.pushEditorHistory();const key=el.dataset.editorKey,c=this.editorState.changes[key]||{};
    c.backgroundImage=url;c.backgroundSize='cover';c.backgroundPosition='center';c.backgroundRepeat='no-repeat';
    this.editorState.changes[key]=c;this.applyEditorChange(el);this.saveEditorChanges();this.updateEditorInspector();await this.persistEditorConfig();this.toast('Image applied to the selected UI element.');
  }
  async setMenuBackground(file){
    const url=await this.uploadEditorImage(file);
    this.pushEditorHistory();this.editorState.background={url,size:'cover',position:'center center',repeat:'no-repeat'};this.saveEditorChanges();this.applyMenuBackground();await this.persistEditorConfig();this.toast('Lobby menu background saved and synced.');
  }
  clearSelectedElementImage(){
    const el=this.editorState.selected;if(!el)return;this.pushEditorHistory();const key=el.dataset.editorKey,c=this.editorState.changes[key]||{};delete c.backgroundImage;delete c.backgroundSize;delete c.backgroundPosition;delete c.backgroundRepeat;this.editorState.changes[key]=c;this.applyEditorChange(el);this.saveEditorChanges();this.persistEditorConfig().catch(e=>this.toast(e.message));this.updateEditorInspector();
  }
  clearMenuBackground(){
    this.pushEditorHistory();this.editorState.background={};this.saveEditorChanges();this.applyMenuBackground();this.persistEditorConfig().catch(e=>this.toast(e.message));
  }
  applyWorldEditorChanges(){
    const r=this.renderer;if(!r)return;const world=this.editorState.world||{};
    if(world.menuModel){const m=r.menuOperator;if(m){for(const k of ['x','y','z'])if(world.menuModel[k]!=null)m.position[k]=Number(world.menuModel[k]);if(world.menuModel.scale!=null)m.scale.setScalar(Number(world.menuModel.scale));}}
    if(world.menuCamera){const c=r.menuCamera;if(c){for(const k of ['x','y','z'])if(world.menuCamera[k]!=null)c.position[k]=Number(world.menuCamera[k]);if(world.menuCamera.fov!=null){c.fov=Number(world.menuCamera.fov);c.updateProjectionMatrix();}}}
    this.ensureEditorIds();
    const edits=world.gameObjects||{};for(const [id,v] of Object.entries(edits)){const o=this.getEditorObjectById(id);if(!o||!v)continue;for(const k of ['x','y','z'])if(v[k]!=null)o.position[k]=Number(v[k]);for(const [k,p] of [['rx','x'],['ry','y'],['rz','z']])if(v[k]!=null)o.rotation[p]=Number(v[k]);for(const [k,p] of [['sx','x'],['sy','y'],['sz','z']])if(v[k]!=null)o.scale[p]=Number(v[k]);if(v.hidden!=null)o.visible=!v.hidden;if(v.name)o.userData.editorLabel=String(v.name);}
    if(world.images)for(const [id,v] of Object.entries(world.images)){let o=this.getEditorObjectById(id);if(!o&&v.src)r.createEditorImage?.(v.src,id);o=this.getEditorObjectById(id);if(!o)continue;for(const k of ['x','y','z'])if(v[k]!=null)o.position[k]=Number(v[k]);for(const k of ['sx','sy','sz'])if(v[k]!=null)o.scale[k[1]]=Number(v[k]);if(v.ry!=null)o.rotation.y=Number(v.ry);o.userData.editorLabel=v.label||'IMAGE';}
    if(world.duplicates)for(const [id,v] of Object.entries(world.duplicates)){if(this.getEditorObjectById(id))continue;const src=this.getEditorObjectById(v.sourceId);if(!src)continue;const copy=r.duplicateEditorObject?.(src,id);if(!copy)continue;for(const k of ['x','y','z'])if(v[k]!=null)copy.position[k]=Number(v[k]);for(const [k,p] of [['rx','x'],['ry','y'],['rz','z']])if(v[k]!=null)copy.rotation[p]=Number(v[k]);for(const [k,p] of [['sx','x'],['sy','y'],['sz','z']])if(v[k]!=null)copy.scale[p]=Number(v[k]);copy.userData.editorLabel=v.label||'DUPLICATE';}
  }

  gameplayObjects(){
    const out=[];if(!this.renderer?.scene)return out;
    this.renderer.scene.traverse(o=>{if(o!==this.renderer.scene&&!o.userData?.editorHelper)out.push(o);});
    return out;
  }
  editorObjectId(o,index=0){
    if(!o.userData.editorId)o.userData.editorId=`obj-${o.uuid||Math.random().toString(36).slice(2)}-${index}`;
    return o.userData.editorId;
  }
  ensureEditorIds(){this.gameplayObjects().forEach((o,i)=>this.editorObjectId(o,i));}
  getEditorObjectById(id){let found=null;this.renderer?.scene?.traverse(o=>{if(!found&&o.userData?.editorId===id)found=o;});return found;}
  syncSelectedObject(o){
    if(!o)return;
    this.editorState.world.gameObjects??={};const id=this.editorObjectId(o),x=this.editorState.world.gameObjects[id]??={};
    Object.assign(x,{x:o.position.x,y:o.position.y,z:o.position.z,rx:o.rotation.x,ry:o.rotation.y,rz:o.rotation.z,sx:o.scale.x,sy:o.scale.y,sz:o.scale.z,hidden:!o.visible,name:o.name||o.type||'Object'});
    this.editorState.world.gameObjects[id]=x;this.saveEditorChanges();
  }
  async syncEditorLive(){if(!this.auth.user?.isAdmin)return;try{await this.persistEditorConfig();}catch(e){this.toast(e.message);}}
  installFlyEditingButton(){
    if(!this.auth.user?.isAdmin)return;
    if(document.getElementById('admin-fly-editing'))return;
    const b=document.createElement('button');b.id='admin-fly-editing';b.type='button';b.className='admin-fly-editing';b.innerHTML='✦ FLY EDITING <kbd>F9</kbd>';b.title='Admin only — enter spectator/free camera editing';b.onclick=()=>this.toggleGameplayEditor();document.body.appendChild(b);
  }
  removeFlyEditingButton(){document.getElementById('admin-fly-editing')?.remove();}
  toggleGameplayEditor(){
    const old=document.getElementById('hamu-gameplay-editor');
    if(old){this.closeGameplayEditor(true);return;}
    if(!this.auth.user?.isAdmin){this.toast('Admin access required.');return;}
    if(!this.game.active){this.openEditor();return;}
    document.exitPointerLock?.();this.game.setPaused?.(true);if(this.game.online)this.network.send({t:'fly-pause',enabled:true});
    // Freeze exactly what the admin was looking at; server/NPC updates must not move the edit view.
    try{this.game._editorFrozenState=JSON.parse(JSON.stringify(this.game.state));this.game._editorFrozenLocal=JSON.parse(JSON.stringify(this.game.local));}catch{}
    this.renderer.enableFlyEditor?.();this.ensureEditorIds();
    document.body.classList.add('gameplay-editor-open');this.installFlyEditingButton();
    const panel=document.createElement('div');panel.id='hamu-gameplay-editor';
    panel.innerHTML=`<header><div><small>ADMIN / LIVE GAMEPLAY</small><h2>FLY EDITING STUDIO</h2><p>FROZEN WORLD · WASD/QE FLY · RMB LOOK · LMB SELECT/DRAG · DEL HIDE · CTRL+Z UNDO</p></div><button data-ge="close">×</button></header>
      <div class="ge-tabs"><button class="active" data-ge-tab="world">WORLD / 3D</button><button data-ge-tab="ui">UI / MENUS</button><button data-ge-tab="assets">ASSETS / IMAGES</button></div>
      <div class="ge-body"><aside><input data-ge="search" placeholder="Search every scene object…"><div class="ge-list"></div></aside><main><div class="ge-empty">Click any visible mesh/object in the world.<br><b>WASD / QE</b> moves the spectator camera · <b>SHIFT</b> = fast · drag an object to move it.</div></main></div>
      <footer><button data-ge="undo">↶ UNDO</button><button data-ge="reset-defaults" class="ge-danger">RESET ALL DEFAULT</button><button data-ge="redo">↷ REDO</button><button data-ge="duplicate">DUPLICATE</button><button data-ge="add-image">+ IMAGE</button><button data-ge="save">SAVE + LIVE SYNC</button><button data-ge="resume">SAVE & RESUME</button></footer>`;
    document.body.appendChild(panel);this._gameEditorPanel=panel;this._gameEditorSelected=null;
    // The gameplay editor itself is movable and resizable, just like the main visual menu editor.
    const geHeader=panel.querySelector('header');
    if(geHeader){geHeader.style.touchAction='none';geHeader.style.userSelect='none';let geDrag=null;const geMove=ev=>{if(!geDrag)return;const maxX=Math.max(6,window.innerWidth-panel.offsetWidth-6),maxY=Math.max(6,window.innerHeight-panel.offsetHeight-6);panel.style.left=Math.max(6,Math.min(maxX,geDrag.ox+ev.clientX-geDrag.sx))+'px';panel.style.top=Math.max(6,Math.min(maxY,geDrag.oy+ev.clientY-geDrag.sy))+'px';panel.style.right='auto';panel.style.bottom='auto';};const geUp=()=>{if(!geDrag)return;geDrag=null;document.removeEventListener('pointermove',geMove,true);document.removeEventListener('pointerup',geUp,true);document.removeEventListener('pointercancel',geUp,true);};geHeader.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const r=panel.getBoundingClientRect();geDrag={sx:e.clientX,sy:e.clientY,ox:r.left,oy:r.top};document.addEventListener('pointermove',geMove,true);document.addEventListener('pointerup',geUp,true);document.addEventListener('pointercancel',geUp,true);e.preventDefault();e.stopPropagation();},true);}
    const list=panel.querySelector('.ge-list'),main=panel.querySelector('main');
    const renderList=filter=>{list.innerHTML='';this.ensureEditorIds();this.gameplayObjects().forEach((o,i)=>{const id=this.editorObjectId(o,i),label=(o.userData?.editorLabel||o.name||o.type||'Object')+` · ${id.slice(0,18)}`;if(filter&&!label.toLowerCase().includes(filter.toLowerCase()))return;const b=document.createElement('button');b.textContent=label;b.dataset.id=id;b.onclick=()=>{this._gameEditorSelected=o;this.renderer.highlightEditorObject?.(o);renderInspector();};list.appendChild(b);});};
    const renderInspector=()=>{const o=this._gameEditorSelected;if(!o||!o.parent){main.innerHTML='<div class="ge-empty">Select an object.</div>';return;}const id=this.editorObjectId(o),e=(this.editorState.world.gameObjects||{})[id]||{};const v=(k,d)=>e[k]??d;main.innerHTML=`<div class="ge-inspector-head"><div><small>SELECTED OBJECT</small><h3>${esc(o.userData?.editorLabel||o.name||o.type||'OBJECT')}</h3><code>${esc(id)}</code></div><button data-ge="delete">DELETE</button></div><div class="ge-grid">${[['x',o.position.x],['y',o.position.y],['z',o.position.z],['rx',o.rotation.x],['ry',o.rotation.y],['rz',o.rotation.z],['sx',o.scale.x],['sy',o.scale.y],['sz',o.scale.z]].map(([k,d])=>`<label>${k.toUpperCase()}<input data-k="${k}" type="number" step="0.01" value="${v(k,d)}"></label>`).join('')}</div><label class="ge-check"><input data-k="hidden" type="checkbox" ${v('hidden',!o.visible)?'checked':''}> HIDE OBJECT</label><label class="ge-wide">OBJECT NAME<input data-k="name" value="${esc(v('name',o.name||''))}"></label><p class="ge-tip">Mouse: drag selected object. Shift = faster. Delete = hide. Duplicate creates a persistent copy.</p>`;main.querySelectorAll('[data-k]').forEach(inp=>inp.oninput=()=>{this.pushEditorHistory();const x=this.editorState.world.gameObjects??={};const val=inp.type==='checkbox'?inp.checked:inp.dataset.k==='name'?inp.value:Number(inp.value);x[id]??={};x[id][inp.dataset.k]=val;this.editorState.world.gameObjects=x;this.applyWorldEditorChanges();this.saveEditorChanges();});main.querySelector('[data-ge="delete"]').onclick=()=>{this.pushEditorHistory();this.editorState.world.gameObjects??={};this.editorState.world.gameObjects[id]={...(this.editorState.world.gameObjects[id]||{}),hidden:true};o.visible=false;this.saveEditorChanges();renderInspector();};};
    const selectById=id=>{const o=this.getEditorObjectById(id);if(o){this._gameEditorSelected=o;this.renderer.highlightEditorObject?.(o);renderInspector();}};
    panel.querySelector('[data-ge="search"]').oninput=e=>renderList(e.target.value);panel.querySelectorAll('[data-ge-tab]').forEach(b=>b.onclick=()=>{panel.querySelectorAll('[data-ge-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(b.dataset.geTab==='assets')this.renderAssetEditor(main);else if(b.dataset.geTab==='ui')this.renderUIEditor(main);else renderInspector();});
    panel.onclick=async e=>{const c=e.target.dataset.ge;if(c==='close')this.closeGameplayEditor(true);if(c==='undo'){this.editorUndo();this.applyWorldEditorChanges();renderList('');renderInspector();}if(c==='redo'){this.editorRedo();this.applyWorldEditorChanges();renderList('');renderInspector();}if(c==='duplicate'){if(this._gameEditorSelected)this.duplicateGameplayObject(this._gameEditorSelected).then(o=>{this._gameEditorSelected=o;renderList('');renderInspector();});else this.toast('Select an object first.');}if(c==='add-image')this.addWorldImage();if(c==='reset-defaults'){if(!confirm('RESET ALL ADMIN EDITOR CHANGES TO DEFAULTS? This removes saved UI/world edits and reloads the current game.'))return;try{this.editorState.changes={};this.editorState.world={};await this.persistEditorConfig();this.toast('All admin edits reset to defaults. Reloading…');setTimeout(()=>location.reload(),350);}catch(err){this.toast(err.message);}}if(c==='save'||c==='resume'){try{await this.persistEditorConfig();this.toast('ADMIN edits saved and synced live.');if(c==='resume')this.closeGameplayEditor(true);}catch(err){this.toast(err.message);}}};
    this._gameEditorRenderList=renderList;this._gameEditorRenderInspector=renderInspector;renderList('');
  }
  closeGameplayEditor(resume=false){const panel=document.getElementById('hamu-gameplay-editor');panel?.remove();if(this.game.online)this.network.send({t:'fly-pause',enabled:false});this.renderer.disableFlyEditor?.();this.game._editorFrozenState=null;this.game._editorFrozenLocal=null;document.body.classList.remove('gameplay-editor-open');if(resume){this.game.setPaused?.(false);this.renderer.renderer.domElement.requestPointerLock?.();}this._gameEditorPanel=null;this._gameEditorSelected=null;}
  renderUIEditor(main){main.innerHTML=`<div class="ge-ui-studio"><h3>UI / MENU STUDIO</h3><p>Use the full Visual Menu Editor for every menu element. This panel also supports adding image overlays.</p><button data-ge="open-full-ui">OPEN FULL UI EDITOR</button><div class="ge-tip">All UI edits remain admin-only and are stored in the server editor configuration.</div></div>`;main.querySelector('[data-ge="open-full-ui"]').onclick=()=>this.openEditor();}
  renderAssetEditor(main){main.innerHTML=`<div class="ge-ui-studio"><h3>ASSET DROP ZONE</h3><p>Drop a PNG/JPG/WebP here or choose an image. It becomes a selectable 3D image object in the live world.</p><div id="ge-dropzone" class="ge-dropzone">DROP IMAGE HERE</div><input id="ge-image-file" type="file" accept="image/png,image/jpeg,image/webp"><div class="ge-tip">After adding it, select it from WORLD / 3D and drag, scale, rotate, hide, duplicate or delete.</div></div>`;const dz=main.querySelector('#ge-dropzone'),input=main.querySelector('#ge-image-file');const handle=f=>{if(f)this.createWorldImageFromFile(f);};input.onchange=()=>handle(input.files?.[0]);['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.add('over');}));['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.remove('over');}));dz.addEventListener('drop',e=>handle(e.dataTransfer.files?.[0]));}
  addWorldImage(){const i=this._gameEditorPanel?.querySelector('[data-ge-tab="assets"]');if(i)i.click();else this.renderAssetEditor(this._gameEditorPanel.querySelector('main'));}
  createWorldImageFromFile(file){if(!/^image\/(png|jpeg|webp)$/.test(file.type)){this.toast('Only PNG, JPG or WebP images are allowed.');return;}if(file.size>750000){this.toast('Image is too large. Use an image under 750 KB.');return;}const reader=new FileReader();reader.onload=()=>this.createWorldImage(String(reader.result));reader.readAsDataURL(file);}
  createWorldImage(src){const r=this.renderer,o=r.createEditorImage?.(src);if(!o){this.toast('Could not create image object.');return;}this.ensureEditorIds();this.pushEditorHistory();const id=this.editorObjectId(o);this.editorState.world.images??={};this.editorState.world.images[id]={src,x:o.position.x,y:o.position.y,z:o.position.z,sx:o.scale.x,sy:o.scale.y,sz:o.scale.z,ry:o.rotation.y,label:'IMAGE'};this.saveEditorChanges();this._gameEditorSelected=o;this._gameEditorRenderList?.('');this._gameEditorRenderInspector?.();this.toast('Image added to the live world.');}
  duplicateGameplayObject(o){const r=this.renderer,copy=r.duplicateEditorObject?.(o);if(!copy)return Promise.resolve(null);this.pushEditorHistory();this.ensureEditorIds();const src=this.editorObjectId(o),id=this.editorObjectId(copy);this.editorState.world.duplicates??={};this.editorState.world.duplicates[id]={sourceId:src,x:copy.position.x,y:copy.position.y,z:copy.position.z,rx:copy.rotation.x,ry:copy.rotation.y,rz:copy.rotation.z,sx:copy.scale.x,sy:copy.scale.y,sz:copy.scale.z,label:'DUPLICATE'};this.saveEditorChanges();return Promise.resolve(copy);}

  installGlobalEditorImageDrop(){
    if(this._editorImageDropInstalled)return;this._editorImageDropInstalled=true;
    document.addEventListener('dragover',e=>{if(this.auth.user?.isAdmin&&this.editorState?.open)e.preventDefault();},true);
    document.addEventListener('drop',e=>{if(!this.auth.user?.isAdmin||!this.editorState?.open)return;e.preventDefault();if(e.target.closest?.('.ui-editor-image-drop'))return;const f=e.dataTransfer?.files?.[0];if(!f)return;if(this.editorState.selected)this.setSelectedElementImage(f).catch(err=>this.toast(err.message));else this.setMenuBackground(f).catch(err=>this.toast(err.message));},true);
  }
  installGameplayEditorHandlers(){
    document.addEventListener('keydown',e=>{
      if(!this.auth.user?.isAdmin||!this.renderer?.flyEditor?.active)return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();this.editorUndo();this.applyWorldEditorChanges();this._gameEditorRenderList?.('');this._gameEditorRenderInspector?.();return;}
      if((e.key==='Delete'||e.key==='Backspace')&&!e.target.closest('input,textarea,select')){const o=this._gameEditorSelected;if(o){this.pushEditorHistory();this.editorState.world.gameObjects??={};const id=this.editorObjectId(o);this.editorState.world.gameObjects[id]={...(this.editorState.world.gameObjects[id]||{}),hidden:true};o.visible=false;this.saveEditorChanges();this._gameEditorRenderInspector?.();e.preventDefault();}return;}
      if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();e.stopPropagation();this.renderer.flyEditor.keys.add(e.code);}
    },true);
    document.addEventListener('keyup',e=>{this.renderer?.flyEditor?.keys.delete(e.code);},true);
    const canvas=this.renderer?.canvas;if(!canvas)return;
    canvas.addEventListener('mousedown',e=>{
      if(!this.renderer.flyEditor?.active||e.button!==0)return;
      const o=this.renderer.editorRaycast?.(e.clientX,e.clientY);if(!o)return;
      this.pushEditorHistory();this._gameEditorSelected=o;this.renderer.highlightEditorObject?.(o);this._gameEditorRenderInspector?.();
      this.renderer.flyEditor.dragging=true;this.editorState.drag={world:o,startX:e.clientX,startY:e.clientY,baseX:o.position.x,baseY:o.position.y,baseZ:o.position.z,moved:false};e.preventDefault();e.stopPropagation();
    },true);
    canvas.addEventListener('mousemove',e=>{
      if(!this.renderer.flyEditor?.active)return;
      const d=this.editorState.drag;
      if(d?.world){const dx=e.clientX-d.startX,dy=e.clientY-d.startY,fast=e.shiftKey?2.5:1;const dist=Math.max(1,this.renderer.camera.position.distanceTo(d.world.position));const scale=dist*.0016*fast;const right=new THREE.Vector3(1,0,0).applyQuaternion(this.renderer.camera.quaternion);const up=new THREE.Vector3(0,1,0).applyQuaternion(this.renderer.camera.quaternion);d.world.position.copy(new THREE.Vector3(d.baseX,d.baseY,d.baseZ)).addScaledVector(right,dx*scale).addScaledVector(up,-dy*scale);this.syncSelectedObject(d.world);this.renderer.highlightEditorObject?.(d.world);this._gameEditorRenderInspector?.();e.preventDefault();}
    },true);
    window.addEventListener('mouseup',e=>{const d=this.editorState.drag;if(!d)return;this.editorState.drag=null;this.renderer.flyEditor.dragging=false;this.syncSelectedObject(d.world);this.saveEditorChanges();this.syncEditorLive();},true);
    canvas.addEventListener('contextmenu',e=>{if(this.renderer.flyEditor?.active){e.preventDefault();}});
    canvas.addEventListener('mousedown',e=>{if(!this.renderer.flyEditor?.active||e.button!==2)return;this.renderer.flyEditor.rotating=true;this.renderer.flyEditor.lastMouse=[e.clientX,e.clientY];e.preventDefault();},true);
    window.addEventListener('mousemove',e=>{const f=this.renderer.flyEditor;if(!f?.active||!f.rotating)return;const [x,y]=f.lastMouse;f.yaw-=(e.clientX-x)*.006;f.pitch=Math.max(-1.45,Math.min(1.45,f.pitch+(e.clientY-y)*.006));f.lastMouse=[e.clientX,e.clientY];},true);
    window.addEventListener('mouseup',e=>{if(this.renderer?.flyEditor?.rotating&&e.button===2)this.renderer.flyEditor.rotating=false;},true);
  }
  cloneEditorChanges(){return JSON.parse(JSON.stringify({changes:this.editorState.changes||{},world:this.editorState.world||{}}));}
  pushEditorHistory(){
    if(!this.editorState?.open&&!document.getElementById('hamu-gameplay-editor'))return;
    const snap=this.cloneEditorChanges();
    const last=this.editorState.history?.[this.editorState.history.length-1];
    if(last&&JSON.stringify(last)===JSON.stringify(snap))return;
    this.editorState.history.push(snap);
    if(this.editorState.history.length>100)this.editorState.history.shift();
    this.editorState.redo=[];
    this.editorState.historyTxn=null;
    if(this.editorState.historyTimer){clearTimeout(this.editorState.historyTimer);this.editorState.historyTimer=null;}
  }
  beginEditorInputHistory(key){
    if(this.editorState.historyTxn===key)return;
    this.pushEditorHistory();
    this.editorState.historyTxn=key;
  }
  finishEditorInputHistory(){
    if(this.editorState.historyTimer)clearTimeout(this.editorState.historyTimer);
    this.editorState.historyTimer=setTimeout(()=>{this.editorState.historyTxn=null;this.editorState.historyTimer=null;},700);
  }
  editorUndo(){
    if((!this.editorState?.open&&!document.getElementById('hamu-gameplay-editor'))||this.editorState.locked)return;
    if(this.editorState.historyTxn!==null)this.editorState.historyTxn=null;
    if(!this.editorState.history?.length){this.toast('Nothing to undo.');return;}
    const current=this.cloneEditorChanges();
    const previous=this.editorState.history.pop();
    this.editorState.redo.push(current);
    this.editorState.changes=previous.changes||{};this.editorState.world=previous.world||{};
    this.saveEditorChanges();
    this.prepareEditorTargets();this.applyWorldEditorChanges();
    this.updateEditorInspector();
    this.persistEditorConfig().catch(e=>this.toast(e.message));
    this.toast('Undo — previous edit restored.');
  }
  editorRedo(){
    if((!this.editorState?.open&&!document.getElementById('hamu-gameplay-editor'))||this.editorState.locked)return;
    if(!this.editorState.redo?.length){this.toast('Nothing to redo.');return;}
    const current=this.cloneEditorChanges();
    const next=this.editorState.redo.pop();
    this.editorState.history.push(current);
    this.editorState.changes=next.changes||{};this.editorState.world=next.world||{};
    this.saveEditorChanges();
    this.prepareEditorTargets();this.applyWorldEditorChanges();
    this.updateEditorInspector();
    this.persistEditorConfig().catch(e=>this.toast(e.message));
    this.toast('Redo — edit restored.');
  }
  editorKey(el){
    // IMPORTANT: editor IDs must not depend on CSS classes. Classes such as
    // active/selected/emoji can change while editing, which used to make a
    // previously saved element lose its edit when another element was saved.
    const a=el.dataset.action||'', page=el.dataset.page||'', mode=el.dataset.mode||'', id=el.id||'';
    return `${this.current}|${el.tagName.toLowerCase()}|${a}|${page}|${mode}|${id}`;
  }
  prepareEditorTargets(){
    if(!this.page)return;
    const counts=new Map();
    const roots=[this.page,this.header].filter(Boolean);
    const nodes=[...roots.flatMap(root=>[...root.querySelectorAll('button,a,input,select,textarea,h1,h2,h3,h4,p,span,small,strong,section,aside,nav,.card,[role="button"]')])];
    this.applyMenuBackground();
    nodes.forEach(el=>{
      if(el.closest('#hamu-visual-editor'))return;
      const base=this.editorKey(el), n=counts.get(base)||0;counts.set(base,n+1);
      const stableKey=`${base}#${n}`;
      // One-time migration from V10-V13 keys, whose class portion was unstable.
      // This keeps already-saved edits instead of forcing the admin to redo them.
      if(!this.editorState.changes[stableKey]){
        const legacyPrefix=`${base}|`;
        const legacy=Object.keys(this.editorState.changes).find(k=>k.startsWith(legacyPrefix)&&k.endsWith(`#${n}`));
        if(legacy)this.editorState.changes[stableKey]=this.editorState.changes[legacy];
      }
      el.dataset.editorKey=stableKey;
      if(!el.dataset.editorBaseText)el.dataset.editorBaseText=this.directText(el);
      this.applyEditorChange(el);
    });
  }
  directText(el){return [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');}
  applyEditorChange(el){
    const c=this.editorState?.changes?.[el.dataset.editorKey]||{};
    if(c.text!==undefined)this.replaceDirectText(el,c.text);
    const st=el.style;
    // Clear only properties owned by this editor before re-applying the current state.
    ['transform','width','height','font-size','font-weight','letter-spacing','text-align','opacity','z-index','color','background','background-image','background-size','background-position','background-repeat','border-color','border-width','border-style','border-radius','box-shadow','pointer-events','display','clip-path'].forEach(k=>st.removeProperty(k));
    if(c.x!=null||c.y!=null||c.rotate!=null||c.scale!=null){const x=Number(c.x||0),y=Number(c.y||0),rot=Number(c.rotate||0),scale=Number(c.scale??1);st.transform=`translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`;}
    if(c.width!=null)st.width=c.width+'px';
    if(c.height!=null)st.height=c.height+'px';
    if(c.fontSize!=null)st.fontSize=c.fontSize+'px';
    if(c.fontWeight!=null)st.fontWeight=c.fontWeight;
    if(c.letterSpacing!=null)st.letterSpacing=c.letterSpacing+'px';
    if(c.textAlign)st.textAlign=c.textAlign;
    if(c.opacity!==undefined)st.opacity=c.opacity;
    if(c.zIndex!==undefined)st.zIndex=c.zIndex;
    if(c.color)st.color=c.color;
    if(c.background)st.background=c.background;
    if(c.backgroundImage)st.backgroundImage=`url("${String(c.backgroundImage).replace(/"/g,'')}")`;
    if(c.backgroundSize)st.backgroundSize=c.backgroundSize;
    if(c.backgroundPosition)st.backgroundPosition=c.backgroundPosition;
    if(c.backgroundRepeat)st.backgroundRepeat=c.backgroundRepeat;
    if(c.borderColor)st.borderColor=c.borderColor;
    if(c.borderWidth!=null)st.borderWidth=c.borderWidth+'px';
    if(c.borderStyle)st.borderStyle=c.borderStyle;
    if(c.radius!==undefined)st.borderRadius=c.radius+'px';
    if(c.boxShadow)st.boxShadow=c.boxShadow;
    if(c.pointerEvents)st.pointerEvents=c.pointerEvents;
    if(c.hidden)st.display='none';
    if(c.shape==='circle')st.borderRadius='50%';
    else if(c.shape==='pill')st.borderRadius='999px';
    else if(c.shape==='rounded')st.borderRadius=(c.radius!=null?c.radius:16)+'px';
    else if(c.shape==='diamond')st.clipPath='polygon(50% 0%,100% 50%,50% 100%,0% 50%)';
    let badge=el.querySelector(':scope > [data-editor-emoji]');
    if(c.emoji){if(!badge){badge=document.createElement('span');badge.dataset.editorEmoji='1';el.appendChild(badge);}badge.textContent=c.emoji;badge.style.cssText='position:absolute;right:6px;bottom:6px;z-index:20;pointer-events:none;font-size:20px;line-height:1;filter:drop-shadow(0 2px 4px #000);';el.classList.add('ui-editor-has-emoji');}else{badge?.remove();el.classList.remove('ui-editor-has-emoji');}
  }
  replaceDirectText(el,text){
    const value=String(text??'');
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    let last=null;while(walker.nextNode()){if(walker.currentNode.textContent.trim())last=walker.currentNode;}
    if(last)last.textContent=value; else if(value){const node=document.createTextNode(value);el.appendChild(node);}
  }
  removeUISelectionFrame(){document.getElementById('hamu-ui-selection-frame')?.remove();this.editorState.resize=null;}
  renderUISelectionFrame(){
    this.removeUISelectionFrame();const el=this.editorState.selected;if(!el||!this.editorState.open||this.editorState.preview)return;
    const frame=document.createElement('div');frame.id='hamu-ui-selection-frame';frame.innerHTML=`<div class="ui-frame-label">SELECTED · ${this.editorState.tool==='edges'?'8-POINT RESIZE':this.editorState.tool==='move'?'MOVE':'SELECT'}</div>`+['nw','n','ne','e','se','s','sw','w'].map(h=>`<i class="ui-resize-handle ${h}" data-handle="${h}"></i>`).join('');document.body.appendChild(frame);
    const place=()=>{if(!el.isConnected){this.removeUISelectionFrame();return;}const r=el.getBoundingClientRect();Object.assign(frame.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});};
    frame.querySelectorAll('.ui-resize-handle').forEach(h=>h.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();const c=this.editorState.changes[el.dataset.editorKey]||{};const r=el.getBoundingClientRect();this.pushEditorHistory();this.editorState.resize={el,handle:h.dataset.handle,startX:e.clientX,startY:e.clientY,startW:r.width,startH:r.height,baseX:Number(c.x||0),baseY:Number(c.y||0),baseW:Number(c.width??r.width),baseH:Number(c.height??r.height)};}));
    const tick=()=>{if(document.getElementById('hamu-ui-selection-frame')===frame){place();requestAnimationFrame(tick);}};place();requestAnimationFrame(tick);
  }
  installUIResizeHandlers(){
    // Resize is a true press-and-hold drag. Do not rebuild the selection frame on
    // every mousemove: rebuilding it used to clear editorState.resize after the
    // first tiny movement, which made handles feel like a single-click control.
    document.addEventListener('mousemove',e=>{
      const d=this.editorState?.resize;if(!d)return;
      e.preventDefault();e.stopPropagation();
      const dx=e.clientX-d.startX,dy=e.clientY-d.startY;
      const c=this.editorState.changes[d.el.dataset.editorKey]||{};
      let w=d.baseW,h=d.baseH,x=d.baseX,y=d.baseY;
      const min=18;
      if(d.handle.includes('e'))w=Math.max(min,d.baseW+dx);
      if(d.handle.includes('s'))h=Math.max(min,d.baseH+dy);
      if(d.handle.includes('w')){w=Math.max(min,d.baseW-dx);x=d.baseX+dx;}
      if(d.handle.includes('n')){h=Math.max(min,d.baseH-dy);y=d.baseY+dy;}
      c.width=Math.round(w);c.height=Math.round(h);c.x=Math.round(x);c.y=Math.round(y);
      this.editorState.changes[d.el.dataset.editorKey]=c;
      this.applyEditorChange(d.el);
      this.updateEditorInspector();
      const frame=document.getElementById('hamu-ui-selection-frame');
      if(frame&&d.el.isConnected){const r=d.el.getBoundingClientRect();Object.assign(frame.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});}
    },true);
    document.addEventListener('mouseup',()=>{
      const d=this.editorState?.resize;if(!d)return;
      this.editorState.resize=null;
      this.saveEditorChanges();
      if(this.auth.user?.isAdmin)this.persistEditorConfig().catch(e=>this.toast(e.message));
    },true);
  }
  installEditorPointerHandlers(){
    document.addEventListener('mousedown',e=>{
      const ed=document.getElementById('hamu-visual-editor');
      if(!this.auth.user?.isAdmin||!this.editorState?.open||this.editorState.preview||this.editorState.locked||!ed||ed.contains(e.target))return;
      if(e.button!==0)return;
      const el=e.target.closest('[data-editor-key]');
      if(!el||el.closest('#hamu-visual-editor'))return;
      e.preventDefault();e.stopPropagation();
      this.pushEditorHistory();
      this.selectEditorElement(el);
      const r=el.getBoundingClientRect(), c=this.editorState.changes[el.dataset.editorKey]||{};
      this.editorState.drag={el,startX:e.clientX,startY:e.clientY,baseX:Number(c.x||0),baseY:Number(c.y||0),moved:false};
    },true);
    document.addEventListener('mousemove',e=>{
      const d=this.editorState?.drag;if(!d)return;
      const dx=e.clientX-d.startX,dy=e.clientY-d.startY;if(Math.abs(dx)+Math.abs(dy)>3)d.moved=true;
      const c=this.editorState.changes[d.el.dataset.editorKey]||{};c.x=Math.round(d.baseX+dx);c.y=Math.round(d.baseY+dy);this.editorState.changes[d.el.dataset.editorKey]=c;this.applyEditorChange(d.el);this.updateEditorInspector();
    },true);
    document.addEventListener('mouseup',e=>{if(this.editorState?.drag){this.editorState.drag=null;this.saveEditorChanges();if(this.auth.user?.isAdmin)this.persistEditorConfig().catch(err=>this.toast(err.message));}},true);
    document.addEventListener('keydown',e=>{
      if(!this.auth.user?.isAdmin||!this.editorState?.open||this.editorState.preview)return;
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='z'){
        e.preventDefault();e.stopImmediatePropagation();
        if(e.shiftKey)this.editorRedo();else this.editorUndo();
        return;
      }
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='y'){
        e.preventDefault();e.stopImmediatePropagation();this.editorRedo();
      }
    },true);
    document.addEventListener('click',e=>{
      if(!this.auth.user?.isAdmin||!this.editorState?.open||this.editorState.preview||this.editorState.locked)return;
      const ed=document.getElementById('hamu-visual-editor');
      if(ed?.contains(e.target))return;
      const el=e.target.closest('[data-editor-key]');
      if(el){e.preventDefault();e.stopImmediatePropagation();this.selectEditorElement(el);}
    },true);
  }
  selectEditorElement(el){
    if(this.editorState.selected)this.editorState.selected.classList.remove('ui-editor-selected');
    this.editorState.selected=el;el.classList.add('ui-editor-selected');
    this.renderUISelectionFrame();
    this.updateEditorInspector();
  }
  openEditor(){
    if(!this.auth.user?.isAdmin){this.toast('Admin access required.');return;}
    if(this.editorState.open){this.closeEditor();return;}
    this.editorState.open=true;
    let ed=document.getElementById('hamu-visual-editor');
    if(!ed){ed=document.createElement('div');ed.id='hamu-visual-editor';document.body.appendChild(ed);}
    ed.innerHTML=`<div class="ui-editor-head"><div><span>HAMU MASTER / HEAVY UI EDITOR</span><h2>VISUAL MENU + IMAGE STUDIO</h2><small>SELECT → DROP IMAGE. Images can be applied to any selected UI element or the whole lobby background. Changes persist across pages and players.</small></div><div class="ui-editor-head-actions"><button data-editor-cmd="lock">🔓 LOCK</button><button data-editor-cmd="close">×</button></div></div><div class="ui-editor-toolbar"><button class="active" data-editor-cmd="select">SELECT</button><button data-editor-cmd="move">MOVE</button><button data-editor-cmd="edges">EDGES / 8 POINT</button><button data-editor-cmd="undo">↶ UNDO</button><button data-editor-cmd="redo">↷ REDO</button><button data-editor-cmd="duplicate">DUPLICATE</button><button data-editor-cmd="preview">PREVIEW</button><button data-editor-cmd="reset">RESET ALL UI</button></div><div class="ui-editor-hint">ADMIN MODE · Select any button, panel, text or control, then drop an image anywhere on the editor to skin that selected element. Use MENU BACKGROUND for the lobby wallpaper. CTRL+Z / CTRL+SHIFT+Z = UNDO / REDO.</div><div class="ui-editor-inspector"><div class="ui-editor-none">Select a UI element behind this panel, or use MENU BACKGROUND below.</div></div>`;
    ed.classList.add('open');
    ed.querySelectorAll('[data-editor-cmd]').forEach(b=>b.addEventListener('click',()=>this.editorCommand(b.dataset.editorCmd)));
    this.makeEditorDraggable(ed);this.installGlobalEditorImageDrop();this.updateEditorInspector();
  }
  closeEditor(){this.removeUISelectionFrame();this.editorState.open=false;this.editorState.preview=false;this.editorState.drag=null;this.editorState.selected?.classList.remove('ui-editor-selected');this.editorState.selected=null;document.getElementById('hamu-visual-editor')?.classList.remove('open');}
  makeEditorDraggable(ed){
    const head=ed.querySelector('.ui-editor-head');if(!head||head.dataset.dragReady)return;head.dataset.dragReady='1';head.style.touchAction='none';head.style.userSelect='none';
    let drag=null;
    const move=e=>{if(!drag)return;const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;const maxX=Math.max(8,window.innerWidth-ed.offsetWidth-8),maxY=Math.max(8,window.innerHeight-ed.offsetHeight-8);ed.style.left=Math.max(8,Math.min(maxX,drag.ox+dx))+'px';ed.style.top=Math.max(8,Math.min(maxY,drag.oy+dy))+'px';ed.style.right='auto';ed.style.bottom='auto';};
    const up=()=>{if(!drag)return;drag=null;document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);};
    head.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const r=ed.getBoundingClientRect();drag={sx:e.clientX,sy:e.clientY,ox:r.left,oy:r.top};try{head.setPointerCapture?.(e.pointerId);}catch{};document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);e.preventDefault();e.stopPropagation();},true);
  }
  editorCommand(cmd){
    if(cmd==='close'){this.closeEditor();return;}
    if(cmd==='select'||cmd==='move'||cmd==='edges'){this.editorState.tool=cmd;document.querySelectorAll('#hamu-visual-editor [data-editor-cmd]').forEach(b=>b.classList.toggle('active',['select','move','edges'].includes(b.dataset.editorCmd)&&b.dataset.editorCmd===cmd));if(this.editorState.selected)this.renderUISelectionFrame();return;}
    if(cmd==='lock'){this.editorState.locked=!this.editorState.locked;const b=document.querySelector('#hamu-visual-editor [data-editor-cmd="lock"]');if(b)b.textContent=this.editorState.locked?'🔒 LOCKED':'🔓 LOCK';return;}
    if(cmd==='preview'){this.editorState.preview=!this.editorState.preview;document.body.classList.toggle('ui-editor-preview',this.editorState.preview);return;}
    if(cmd==='undo'){this.editorUndo();return;}
    if(cmd==='redo'){this.editorRedo();return;}
    if(cmd==='duplicate'){this.duplicateSelectedUI();return;}
    if(cmd==='reset'){if(!confirm('Reset all saved UI edits?'))return;this.pushEditorHistory();this.editorState.changes={};this.editorState.world={};this.editorState.background={};this.saveEditorChanges();this.applyMenuBackground();this.persistEditorConfig().then(()=>this.nav(this.current)).catch(e=>this.toast(e.message));return;}
  }
  duplicateSelectedUI(){
    const el=this.editorState.selected;if(!el)return this.toast('Select a UI element first.');
    const clone=el.cloneNode(true);clone.removeAttribute('id');clone.classList.remove('ui-editor-selected');clone.querySelectorAll('[data-editor-emoji]').forEach(x=>x.remove());
    const base=this.editorKey(clone),key=`${base}#${Date.now()}`;clone.dataset.editorKey=key;clone.dataset.editorBaseText=this.directText(clone);const c=JSON.parse(JSON.stringify(this.editorState.changes[el.dataset.editorKey]||{}));c.x=Number(c.x||0)+24;c.y=Number(c.y||0)+24;this.editorState.changes[key]=c;el.parentNode?.insertBefore(clone,el.nextSibling);this.applyEditorChange(clone);this.selectEditorElement(clone);this.saveEditorChanges();this.persistEditorConfig().catch(e=>this.toast(e.message));this.toast('UI element duplicated.');
  }
  bindMenuBackgroundControls(box){
    const dz=box.querySelector('[data-drop="menu-bg"]');
    const input=box.querySelector('#ui-menu-bg-file');
    const choose=box.querySelector('[data-ei-cmd="menu-image"]');
    const pick=file=>{if(file)this.setMenuBackground(file).catch(err=>this.toast(err.message));};
    if(choose&&input){
      choose.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();input.value='';input.click();});
      input.addEventListener('change',()=>pick(input.files?.[0]));
    }
    if(dz){
      ['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';dz.classList.add('over');}));
      ['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();dz.classList.remove('over');}));
      dz.addEventListener('drop',e=>pick(e.dataTransfer?.files?.[0]));
    }
    box.querySelector('[data-ei-cmd="clear-menu-bg"]')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();this.clearMenuBackground();});
    box.querySelectorAll('[data-bg]').forEach(inp=>inp.addEventListener('input',()=>{
      if(!this.auth.user?.isAdmin)return;
      const key=inp.dataset.bg;
      this.editorState.background??={};
      this.editorState.background[key]=inp.value;
      this.saveEditorChanges();
      this.applyMenuBackground();
      clearTimeout(this.editorState.backgroundTimer);
      this.editorState.backgroundTimer=setTimeout(()=>this.persistEditorConfig().catch(err=>this.toast(err.message)),350);
    }));
  }
  updateEditorInspector(){
    const box=document.querySelector('#hamu-visual-editor .ui-editor-inspector');if(!box)return;const el=this.editorState.selected;
    if(!el){box.innerHTML=`<div class="ui-editor-bg-card"><div class="ui-editor-selected-title"><b>MENU BACKGROUND</b><small>LOCKED BACK LAYER · CHARACTER STAYS ABOVE</small></div><div class="ui-editor-image-drop" data-drop="menu-bg">DROP IMAGE HERE OR <button type="button" data-ei-cmd="menu-image">CHOOSE IMAGE</button><input id="ui-menu-bg-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="ui-editor-grid"><label>SIZE<input data-bg="size" value="${esc(this.editorState.background.size||'cover')}" placeholder="cover / contain"></label><label>POSITION<input data-bg="position" value="${esc(this.editorState.background.position||'center center')}"></label></div><button class="ui-editor-small-danger" data-ei-cmd="clear-menu-bg">CLEAR MENU BACKGROUND</button></div><div class="ui-editor-none">Select a UI element behind this panel to edit its text, layout, style or image.</div>`;this.bindMenuBackgroundControls(box);return;}
    const c=this.editorState.changes[el.dataset.editorKey]||{};const r=el.getBoundingClientRect();
    box.innerHTML=`<div class="ui-editor-bg-card"><div class="ui-editor-selected-title"><b>MENU BACKGROUND</b><small>LOCKED BACK LAYER · CHARACTER STAYS ABOVE</small></div><div class="ui-editor-image-drop" data-drop="menu-bg">DROP IMAGE HERE OR <button type="button" data-ei-cmd="menu-image">CHOOSE IMAGE</button><input id="ui-menu-bg-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="ui-editor-grid"><label>SIZE<input data-bg="size" value="${esc(this.editorState.background.size||'cover')}" placeholder="cover / contain"></label><label>POSITION<input data-bg="position" value="${esc(this.editorState.background.position||'center center')}"></label></div><button class="ui-editor-small-danger" data-ei-cmd="clear-menu-bg">CLEAR MENU BACKGROUND</button></div>`+`<div class="ui-editor-selected-title"><b>${esc(el.tagName.toLowerCase())}</b><small>${esc((el.dataset.action||el.className||'element').toString())}</small></div><label>TEXT / LABEL<input data-ei="text" value="${esc(c.text??el.dataset.editorBaseText??'')}" /></label><div class="ui-editor-image-drop" data-drop="selected-image">DROP IMAGE ON SELECTED ITEM <button type="button" data-ei-cmd="selected-image">CHOOSE IMAGE</button><input id="ui-selected-image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="ui-editor-image-actions"><button type="button" data-ei-cmd="clear-selected-image">REMOVE IMAGE</button></div><div class="ui-editor-grid"><label>X<input data-ei="x" type="number" value="${Number(c.x||0)}"></label><label>Y<input data-ei="y" type="number" value="${Number(c.y||0)}"></label><label>ROTATION<input data-ei="rotate" type="number" value="${Number(c.rotate||0)}"></label><label>SCALE<input data-ei="scale" type="number" step="0.01" value="${Number(c.scale??1)}"></label><label>WIDTH<input data-ei="width" type="number" placeholder="${Math.round(r.width)}"></label><label>HEIGHT<input data-ei="height" type="number" placeholder="${Math.round(r.height)}"></label><label>FONT SIZE<input data-ei="fontSize" type="number" placeholder="${Math.round(parseFloat(getComputedStyle(el).fontSize))}"></label><label>FONT WEIGHT<input data-ei="fontWeight" type="number" placeholder="700"></label><label>LETTER SPACING<input data-ei="letterSpacing" type="number" step="0.5" value="${c.letterSpacing??0}"></label><label>TEXT ALIGN<input data-ei="textAlign" value="${esc(c.textAlign||'')}" placeholder="left / center / right"></label><label>OPACITY<input data-ei="opacity" type="number" min="0" max="1" step="0.05" value="${c.opacity??1}"></label><label>COLOR<input data-ei="color" value="${esc(c.color||'')}" placeholder="#ffffff"></label><label>BACKGROUND<input data-ei="background" value="${esc(c.background||'')}" placeholder="rgba(...) / #..."></label><label>SHAPE<select data-ei="shape"><option value="">Rectangle</option><option value="rounded" ${c.shape==='rounded'?'selected':''}>Rounded</option><option value="pill" ${c.shape==='pill'?'selected':''}>Pill</option><option value="circle" ${c.shape==='circle'?'selected':''}>Circle</option><option value="diamond" ${c.shape==='diamond'?'selected':''}>Diamond</option></select></label><label>IMAGE EMOJI<input data-ei="emoji" maxlength="4" value="${esc(c.emoji||'')}" placeholder="🎯"></label><label>BORDER COLOR<input data-ei="borderColor" value="${esc(c.borderColor||'')}" placeholder="#f4c85a"></label><label>BORDER WIDTH<input data-ei="borderWidth" type="number" value="${c.borderWidth??0}"></label><label>BORDER STYLE<input data-ei="borderStyle" value="${esc(c.borderStyle||'')}" placeholder="solid"></label><label>RADIUS<input data-ei="radius" type="number" value="${c.radius??''}"></label><label>BOX SHADOW<input data-ei="boxShadow" value="${esc(c.boxShadow||'')}" placeholder="0 10px 30px rgba(0,0,0,.4)"></label><label>POINTER EVENTS<input data-ei="pointerEvents" value="${esc(c.pointerEvents||'')}" placeholder="auto / none"></label><label>Z-INDEX<input data-ei="zIndex" type="number" value="${c.zIndex??''}"></label></div><div class="ui-editor-actions"><button data-ei-cmd="hide">${c.hidden?'SHOW':'HIDE'} ELEMENT</button><button data-ei-cmd="reset-one">RESET SELECTED</button><button class="save" data-ei-cmd="save">SAVE CHANGES</button></div>`;
    this.bindMenuBackgroundControls(box);
    const selectedDrop=box.querySelector('[data-drop="selected-image"]');
    const selectedFile=box.querySelector('#ui-selected-image-file');
    box.querySelector('[data-ei-cmd="selected-image"]')?.addEventListener('click',()=>selectedFile?.click());
    selectedFile?.addEventListener('change',()=>{const f=selectedFile.files?.[0];if(f)this.setSelectedElementImage(f).catch(e=>this.toast(e.message));});
    const wireDrop=(dz,handler)=>{if(!dz)return;['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();dz.classList.add('over');}));['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();dz.classList.remove('over');}));dz.addEventListener('drop',e=>handler(e.dataTransfer.files?.[0]));};
    wireDrop(selectedDrop,f=>f&&this.setSelectedElementImage(f).catch(e=>this.toast(e.message)));
    box.querySelector('[data-ei-cmd="clear-selected-image"]')?.addEventListener('click',()=>this.clearSelectedElementImage());
    box.querySelectorAll('[data-ei]').forEach(inp=>inp.addEventListener('input',()=>this.editorInput(inp)));
    const worldWrap=document.createElement('div');worldWrap.className='ui-editor-world';worldWrap.innerHTML='<div class="ui-editor-world-title">GAME WORLD / ADMIN CONTROLS</div><div class="ui-editor-grid"><label>MENU X<input data-wi="x" type="number" value="'+Number(this.editorState.world.menuModel?.x||1.22)+'"></label><label>MENU Y<input data-wi="y" type="number" value="'+Number(this.editorState.world.menuModel?.y||0)+'"></label><label>MENU Z<input data-wi="z" type="number" value="'+Number(this.editorState.world.menuModel?.z||0)+'"></label><label>CHARACTER SCALE<input data-wi="scale" type="number" step="0.01" value="'+Number(this.editorState.world.menuModel?.scale||1.78)+'"></label><label>CAMERA X<input data-wi="cx" type="number" value="'+Number(this.editorState.world.menuCamera?.x||4.9)+'"></label><label>CAMERA Y<input data-wi="cy" type="number" value="'+Number(this.editorState.world.menuCamera?.y||2.7)+'"></label><label>CAMERA Z<input data-wi="cz" type="number" value="'+Number(this.editorState.world.menuCamera?.z||7.7)+'"></label><label>CAMERA FOV<input data-wi="fov" type="number" value="'+Number(this.editorState.world.menuCamera?.fov||37)+'"></label></div>';
    box.appendChild(worldWrap);worldWrap.querySelectorAll('[data-wi]').forEach(inp=>inp.addEventListener('input',()=>this.worldEditorInput(inp)));
    box.querySelector('[data-ei-cmd="hide"]').onclick=()=>{this.pushEditorHistory();c.hidden=!c.hidden;this.editorState.changes[el.dataset.editorKey]=c;this.applyEditorChange(el);this.saveEditorChanges();this.persistEditorConfig().catch(err=>this.toast(err.message));this.updateEditorInspector();};
    box.querySelector('[data-ei-cmd="reset-one"]').onclick=()=>{this.pushEditorHistory();delete this.editorState.changes[el.dataset.editorKey];this.saveEditorChanges();this.persistEditorConfig().catch(err=>this.toast(err.message));this.applyEditorChange(el);this.updateEditorInspector();};
    box.querySelector('[data-ei-cmd="save"]').onclick=async()=>{try{await this.persistEditorConfig();this.toast('Saved to the game server — all connected players updated.');}catch(e){this.toast(e.message);}};
  }
  worldEditorInput(inp){
    if(!this.auth.user?.isAdmin)return;
    const k=inp.dataset.wi,v=Number(inp.value);if(!Number.isFinite(v))return;const w=this.editorState.world;w.menuModel??={};w.menuCamera??={};if(['x','y','z','scale'].includes(k))w.menuModel[k]=v;else w.menuCamera[{cx:'x',cy:'y',cz:'z',fov:'fov'}[k]]=v;this.applyWorldEditorChanges();this.saveEditorChanges();this.finishEditorInputHistory();if(!this.editorState.worldTimer){this.editorState.worldTimer=setTimeout(()=>{this.editorState.worldTimer=null;this.persistEditorConfig().catch(e=>this.toast(e.message));},250);}}
  editorInput(inp){
    const el=this.editorState.selected;if(!el)return;const key=el.dataset.editorKey,k=inp.dataset.ei;
    this.beginEditorInputHistory(`${key}|${k}`);
    let v=inp.value,c=this.editorState.changes[key]||{};
    if(['x','y','rotate','scale','width','height','fontSize','fontWeight','letterSpacing','borderWidth','opacity','radius','zIndex'].includes(k))v=v===''?undefined:Number(v);
    if(v===undefined)delete c[k];else c[k]=v;this.editorState.changes[key]=c;this.applyEditorChange(el);this.saveEditorChanges();this.finishEditorInputHistory();if(this.auth.user?.isAdmin){clearTimeout(this.editorState.remoteTimer);this.editorState.remoteTimer=setTimeout(()=>{this.persistEditorConfig().catch(e=>this.toast(e.message));},350); }
  }
  async click(button) {
    if(button.dataset.action==='fly-editing'){this.toggleGameplayEditor();return;}
    const a=button.dataset.action;this.audio.unlock();this.audio.ui();
    const party=this.network.party;
    if(['practice','again','create-room','join-room','join-code'].includes(a)&&(party?.members.length>1||party?.status==='queued'))throw new Error('Cancel matchmaking and leave your party before starting a separate match.');
    if(['equip-weapon','operator'].includes(a)){if(party?.status==='queued')throw new Error('Cancel matchmaking before changing your ready loadout.');const me=party?.members.find(m=>m.id===this.auth.user.id);if(me?.ready&&party.leaderId!==me.id)await this.network.request('party.ready',{ready:false,operator:this.store.data.operator,loadout:this.store.data.loadout});}
    if(a==='open-editor'){this.openEditor();return;}
    if(a==='nav'){if(this.editorState?.open){this.closeEditor();}const page=button.dataset.page==='multiplayer'?'friends':button.dataset.page;this.nav(page);}
    if(a==='mode'){const mode=button.dataset.mode;if(this.network.party?.status==='queued')throw new Error('Cancel matchmaking before changing mode.');if(this.network.party?.leaderId!==this.auth.user.id)throw new Error('Only the party leader can change mode.');await this.connect();await this.network.request('party.mode',{mode});this.store.data.mode=mode;this.store.save();this.nav('play');}
    if(a==='practice'){if(!await this.auth.verify())return;this.closeOverlay();this.hideMenu();this.game.startPractice();}
    if(a==='quickmatch'){if(!await this.auth.verify())return;const p=this.network.party;if(!p||p.leaderId!==this.auth.user.id)throw new Error('Only the party leader can start the match.');if(p.status==='queued')throw new Error('You are already searching.');const mode=button.dataset.mode||p.mode||this.store.data.mode;if(mode!==p.mode){await this.network.request('party.mode',{mode});}await this.network.request('party.ready',{ready:true,loadout:this.store.data.loadout,operator:this.store.data.operator});this.store.data.mode=mode;this.store.save();this.setBusy(true);try{await this.connect();await this.network.request('queue.join',{mode,loadout:this.store.data.loadout,operator:this.store.data.operator});this.updateQuickQueue();}catch(error){this.setBusy(false);throw error;}}
    if(a==='quick-queue-cancel'){await this.network.request('queue.cancel');this.updateQuickQueue();this.toast('Quick Play search cancelled.');}
    if(a==='ready'||a==='unready'){const me=this.network.party?.members.find(m=>m.id===this.auth.user.id);if(!me||this.network.party?.leaderId===me.id)throw new Error('Only a guest can change readiness.');await this.network.request('party.ready',{ready:a==='ready',...this.store.data.loadout&&{loadout:this.store.data.loadout,operator:this.store.data.operator}});this.updateQuickQueue();return;}
    if(a==='change-weapon'){this.selectedWeapon=this.store.data.loadout[Number(button.dataset.slot)];this.weaponCategory=button.dataset.slot==='1'?'Pistol':'All';this.nav('weapons');}
    if(a==='weapon-filter'){this.weaponCategory=button.dataset.category;const first=WEAPON_LIST.find(w=>this.weaponCategory==='All'||w.category===this.weaponCategory);if(this.weaponCategory!=='All'&&WEAPONS[this.selectedWeapon].category!==this.weaponCategory)this.selectedWeapon=first.id;this.nav('weapons');}
    if(a==='inspect-weapon'){this.selectedWeapon=button.dataset.id;this.nav('weapons');}
    if(a==='equip-weapon'){const id=button.dataset.id;if(PRIMARY_IDS.includes(id))this.store.data.loadout[0]=id;else if(SECONDARY_IDS.includes(id))this.store.data.loadout[1]=id;this.store.save();this.renderer.setMenuParty?.(this.network.party?.members||[]);this.nav('weapons');this.toast(`${WEAPONS[id].name} equipped. Your next deployment uses this kit.`);await this.syncPartyKit();}
    if(a==='operator'){this.store.data.operator=button.dataset.id;this.store.save();this.renderer.setMenuOperator(button.dataset.id,Number(this.store.data.menuYawByOperator?.[button.dataset.id])||0);this.nav('operators');await this.syncPartyKit();}
    if(a==='settings-tab'){this.settingsTab=button.dataset.tab;this.nav('settings');}
    if(a==='reset-settings'){this.store.resetSettings();this.applySettings();this.nav('settings');this.toast('Settings and bindings restored to defaults.');}
    if(a==='bind'){this.binding=button.dataset.bind;button.classList.add('listening');button.textContent='PRESS A KEY…';}
    if(a==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{this.toast('Fullscreen is restricted in this preview. Run the downloaded project in Chrome or Edge.');}}
    if(a==='link-email'){this.overlay.innerHTML='<div class="modal-card card"><span class="eyebrow">PRIVATE ACCOUNT EMAIL</span><h2>LINK EMAIL</h2><p>Enter an email and your current HAMU MASTER GAME password. This only enables name-or-email login. It is UNVERIFIED: no Gmail sign-in, mailbox check, or password recovery.</p><form id="link-email-form"><label class="field-label">GMAIL OR EMAIL<input class="input" id="link-email-value" type="email" autocomplete="email" maxlength="254" required value="'+esc(this.auth.user.email||'')+'"></label><label class="field-label">CURRENT GAME PASSWORD<input class="input" id="link-email-password" type="password" autocomplete="current-password" maxlength="128" required></label><button class="btn btn-warning" type="submit">SAVE LINKED EMAIL</button><button class="btn btn-outline" type="button" data-action="close-modal">CANCEL</button></form></div>';this.overlay.classList.remove('hidden');this.overlay.querySelector('#link-email-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const submit=form.querySelector('[type="submit"]');submit.disabled=true;try{await this.auth.linkEmail(this.overlay.querySelector('#link-email-value').value,this.overlay.querySelector('#link-email-password').value);this.closeOverlay();this.nav('profile');this.toast('Linked email saved as unverified private login information.');}catch(error){this.toast(error.message||'Could not link email.');}finally{submit.disabled=false;}};}
    if(a==='logout'){this.overlay.innerHTML='<div class="modal-card card"><span class="eyebrow">ACCOUNT ACCESS</span><h2>LOG OUT?</h2><p>Your account is safe on this server. You will need your unique name and password to log in again.</p><button class="btn btn-warning" data-action="confirm-logout">LOG OUT</button><button class="btn btn-outline" data-action="close-modal">CANCEL</button></div>';this.overlay.classList.remove('hidden');}
    if(a==='confirm-logout'){button.disabled=true;try{await this.auth.logout();}finally{button.disabled=false;}}
    if(a==='history-filter'){this.historyFilter=button.dataset.mode;this.nav('history');}
    if(a==='export-history')this.exportHistory();
    if(a==='match-detail')this.matchDetail(button.dataset.id);
    if(a==='controls')this.controls();
    if(a==='close-modal')this.closeOverlay();
    if(a==='connect')await this.connect();
    if(a==='refresh-rooms'){await this.connect();this.network.refresh();}
    if(a==='create-room'||a==='quickmatch'||a==='join-room'||a==='join-code') {
      const data=this.lobbyData();if(a==='join-code')data.room=document.getElementById('room-code').value.trim().toUpperCase();if(a==='join-room')data.room=button.dataset.room;
      if((a==='join-code'||a==='join-room')&&!data.room)throw new Error('Enter a six-character room code.');
      this.setBusy(true);try{await this.connect();this.network.send({t:a==='create-room'?'create':a==='quickmatch'?'quick':'join',...data});}catch(error){this.setBusy(false);throw error;}
    }
    if(a==='resume'){this.closeOverlay();this.hideMenu();this.game.setPaused(false);}
    if(a==='pause-settings'){this.game.setPaused(true);this.nav('settings');}
    if(a==='back-pause'){this.hideMenu();this.showPause();}
    if(a==='return-party'){await this.network.request('party.return');}
    if(a==='quit'){this.game.leave();this.closeOverlay();this.nav('play');}
    if(a==='again'){this.game.leave();this.closeOverlay();this.hideMenu();this.game.startPractice();}
  }
  change(event) {
    const target=event.target;if(target.dataset.setting) {
      const key=target.dataset.setting,s=this.store.data.settings;
      s[key]=target.type==='checkbox'?target.checked:target.type==='range'?Number(target.value):target.value;
      const output=document.getElementById(`value-${key}`);if(output)output.textContent=target.value+(key==='sensitivity'?'×':key==='fov'?'°':'%');
      this.store.validateSettings();this.store.save();this.applySettings(key==='quality'||key==='fov'||key==='reducedMotion');
    }
    if(target.dataset.practice){this.store.data.practice[target.dataset.practice]=Number(target.value);this.store.save();}
  }
  applySettings(render=true){this.audio.unlock();this.audio.apply(this.store.data.settings);if(render)this.renderer.applySettings(this.store.data.settings);}
  captureBinding(event) {
    if(!this.binding)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='keydown'&&event.code==='Escape'){this.binding=null;this.nav('settings');return;}
    if(event.repeat)return;
    const code=event.type==='mousedown'?`Mouse${event.button}`:event.code;if(!code||['MetaLeft','MetaRight'].includes(code))return;
    const bindings=this.store.data.settings.bindings,previous=bindings[this.binding],conflict=Object.keys(bindings).find(k=>k!==this.binding&&bindings[k]===code);
    if(conflict)bindings[conflict]=previous;bindings[this.binding]=code;this.store.save();this.binding=null;this.nav('settings');this.toast(`Binding saved: ${keyLabel(code)}${conflict?' · duplicate key swapped':''}.`);
  }
  hideMenu(){this.menu.classList.add('hidden');this.menu.classList.remove('in-game-settings');}
  closeOverlay(){this.overlay.classList.add('hidden');this.overlay.innerHTML='';}
  showPause(ready=false) {
    if(!this.game.active)return;this.game.setPaused(true);this.hideMenu();
    this.overlay.innerHTML=`<div class="pause-card card"><span class="eyebrow">${ready?'DEPLOYMENT READY':'FIELD OPERATIONS'} / ${this.game.online?'LIVE ROOM '+esc(this.network.room?.id||''):'LOCAL PRACTICE'}</span><h1>${ready?'ENTER THE FIELD.':'TAKE A BREATH.'}</h1><p>${this.game.online?'The match remains live while this menu is open. Click below to capture your mouse and deploy.':'Your practice match is paused. Your next move can wait.'}</p><button class="btn btn-warning resume-button" data-action="resume">${icon('play',23)} ${ready?'ENTER ARENA':'RESUME MATCH'}</button><button class="btn btn-outline" data-action="pause-settings">${icon('settings',18)} SETTINGS & CONTROLS</button><button class="btn btn-ghost" data-action="quit">RETURN TO MENU ${icon('arrow',17)}</button><small>WASD MOVE · MOUSE AIM · ESC MENU<br>Mouse capture unavailable? Aim by moving your cursor over the arena.</small></div>`;
    this.overlay.classList.remove('hidden');
  }
  togglePause() {
    if(!this.game.active||this.game.state?.phase==='ended')return;
    if(this.game.paused){if(!this.menu.classList.contains('hidden')){this.hideMenu();this.showPause();}else{this.closeOverlay();this.game.setPaused(false);}}
    else this.showPause();
  }
  controls() {
    const b=this.store.data.settings.bindings;
    this.overlay.innerHTML=`<div class="modal-card field-manual card"><div class="modal-heading"><div><span class="eyebrow">FIELD MANUAL / READ. REACT. REPEAT.</span><h2>THE ADVANTAGE IS MOVEMENT.</h2></div><button class="btn btn-ghost btn-sm" data-action="close-modal" aria-label="Close manual">${icon('close',22)}</button></div><div class="manual-layout"><div><h3>CONTROLS</h3><div class="manual-keys">${Object.entries(BIND_NAMES).map(([key,name])=>`<div><span>${name}</span><kbd>${keyLabel(b[key])}</kbd></div>`).join('')}</div></div><div class="manual-intel"><img src="./assets/foundry.svg" alt="Original map overview"><h3>KNOW THE FOUNDRY</h3><p>Three lanes connect two spawn zones. Tall buildings break sightlines; low barricades are jumpable. Cargo crates create short, dangerous corners.</p><p><b>Team Deathmatch:</b> first to 40 eliminations. <b>Free For All:</b> first to 25. <b>Domination:</b> first to 150 points; each held zone scores once per second.</p><p>Stand inside a zone to capture it. More teammates capture faster, but opponents contest progress. Destroying an enemy’s hold takes longer than taking a neutral zone.</p><p>Health regenerates after 4.5 seconds without damage. Green supply beacons restore reserve ammunition, armor and a frag, then cool down for 20 seconds per operator.</p><div class="manual-tip">Double-tap sprint for tactical sprint. Sprint + crouch, or C, to slide. Escape pauses practice; multiplayer stays live.</div></div></div></div>`;this.overlay.classList.remove('hidden');
  }
  showResults(state,id,online) {
    const match=this.store.record(state,id,online),self=state.players.find(p=>p.id===id),result=state.winner===null?'DRAW':state.winner===(state.mode==='ffa'?id:self.team)?'VICTORY':'DEFEAT';this.hideMenu();
    const sorted=state.players.slice().sort((a,b)=>b.score-a.score||b.kills-a.kills);
    this.overlay.innerHTML=`<div class="results-card card"><div class="eyebrow">AFTER ACTION / FOUNDRY / ${MODES[state.mode].short}</div><h1 class="result-title ${result.toLowerCase()}">${result}</h1><p>${state.mode==='ffa'?'EVERY OPERATOR FOR THEMSELVES':`COBALT ${state.scores[0]} / EMBER ${state.scores[1]}`} <span>·</span> MATCH COMPLETE</p><div class="result-stats"><div><b>${self.kills}</b><span>ELIMINATIONS</span></div><div><b>${self.deaths}</b><span>DEATHS</span></div><div><b>+${match?.xp??250+self.score}</b><span>XP EARNED</span></div></div><table class="table result-table"><thead><tr><th>OPERATOR</th><th>K</th><th>D</th><th>SCORE</th></tr></thead><tbody>${sorted.map(p=>`<tr class="${p.id===id?'you':''}"><td>${esc(p.name)} ${p.id===id?'<small>YOU</small>':p.bot?'<small>AI</small>':''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td></tr>`).join('')}</tbody></table><div class="result-actions">${online?`<span class="eyebrow" id="next-round">${this.network.room?.queue?'RETURNING TO PARTY':'NEXT ROUND'} IN 12s</span>`:'<button class="btn btn-warning" data-action="again">DEPLOY AGAIN '+icon('arrow',20)+'</button>'}<button class="btn btn-outline" data-action="${online&&this.network.room?.queue?'return-party':'quit'}">${online&&this.network.room?.queue?'RETURN TO PARTY':'RETURN TO MENU'}</button></div><small class="fine-print">RESULT SAVED TO YOUR SERVER PROFILE & MATCH HISTORY</small></div>`;this.overlay.classList.remove('hidden');
  }
  lobbyData() {
    const value=(id,fallback)=>document.getElementById(id)?.value??fallback;const team=value('lobby-team','auto');
    const name=this.auth.user.username;
    return {name,loadout:this.store.data.loadout,operator:this.store.data.operator,mode:value('lobby-mode',this.store.data.mode),roomName:value('room-name','Foundry training'),bots:Number(value('lobby-bots',5)),duration:Number(value('lobby-duration',300)),team:team==='auto'?undefined:Number(team)};
  }
  async connect() {
    if(!await this.auth.verify())throw new Error('Please log in again.');
    const url=defaultServerURL();this.store.data.serverURL=url;this.store.save();
    try{await this.network.connect(url);this.updateStatus();}catch(error){this.updateStatus();throw error;}
  }
  updateStatus() {
    const connected=this.network.status==='connected',connecting=this.network.status==='connecting';
    const label=document.getElementById('connection-label'),dot=document.getElementById('connection-dot'),button=document.getElementById('connect-button');
    if(label)label.textContent=connected?'CONNECTED':connecting?'CONNECTING…':'NOT CONNECTED';if(dot)dot.classList.toggle('connected',connected);
    if(button){button.disabled=connecting;button.innerHTML=connected?`${icon('check',16)} CONNECTED`:connecting?'CONNECTING…':`CONNECT ${icon('arrow',17)}`;}
    const footer=document.getElementById('footer-status');if(footer)footer.textContent=connected?'SERVER CONNECTED / PRACTICE READY':'LOCAL PRACTICE READY';
  }
  renderRooms() {
    const list=document.getElementById('room-list');if(!list)return;
    if(this.network.status!=='connected'){list.innerHTML=`<div class="rooms-empty">${icon('signal',35)}<strong>FIND YOUR CONNECTION.</strong><p>Connect to your running server to discover live rooms.</p></div>`;return;}
    const customRooms=this.network.rooms.filter(r=>!r.queue);
    if(!customRooms.length){list.innerHTML=`<div class="rooms-empty">${icon('users',35)}<strong>THE FIELD IS OPEN.</strong><p>No custom rooms on this server. Create one below, or use the party lobby to find a match.</p></div>`;return;}
    list.innerHTML=customRooms.map(r=>`<div class="room-row"><span class="room-symbol">${icon(modeIcon[r.mode]||'users',24)}</span><div><strong>${esc(r.name)}</strong><small>${MODES[r.mode]?.short||'FPS'} / ${esc(r.id)} / ${r.bots} AI</small></div><span class="room-count">${r.humans}<small>/${r.capacity}</small></span><button class="btn btn-warning btn-sm" data-action="join-room" data-room="${esc(r.id)}" ${r.humans>=r.capacity?'disabled':''}>${r.humans>=r.capacity?'FULL':'JOIN'}</button></div>`).join('');
  }
  setBusy(busy){for(const button of this.page.querySelectorAll('[data-action="create-room"],[data-action="quickmatch"],[data-action="join-room"],[data-action="join-code"]'))button.disabled=busy;}
  exportHistory() {
    const quote=value=>`"${String(value).replace(/"/g,'""')}"`,header=['Date','Mode','Map','Result','Kills','Deaths','Score','XP','Duration seconds','Multiplayer'];
    const rows=this.store.data.history.map(m=>[m.date,MODES[m.mode]?.name||m.mode,m.map,m.result,m.kills,m.deaths,m.score,m.xp,m.duration,m.online]);
    const blob=new Blob([[header,...rows].map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='hamu-master-match-history.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);this.toast('Match history exported.');
  }
  matchDetail(id) {
    const m=this.store.data.history.find(m=>m.id===id);if(!m)return;
    this.overlay.innerHTML=`<div class="modal-card match-detail card"><div class="modal-heading"><span class="eyebrow">AFTER ACTION / ${esc(m.id)}</span><button class="btn btn-ghost btn-sm" data-action="close-modal" aria-label="Close match detail">${icon('close',20)}</button></div><h1 class="${m.result.toLowerCase()}">${m.result}</h1><h3>${MODES[m.mode]?.name} / FOUNDRY</h3><p>${new Date(m.date).toLocaleString()} · ${m.online?'Multiplayer':'Practice'} · ${clock(m.duration)}</p><div class="result-stats"><div><b>${m.kills} / ${m.deaths}</b><span>KILLS / DEATHS</span></div><div><b>${m.score}</b><span>SCORE</span></div><div><b>+${m.xp}</b><span>XP</span></div></div><button class="btn btn-outline" data-action="close-modal">CLOSE REPORT</button></div>`;this.overlay.classList.remove('hidden');
  }
  toast(message) {clearTimeout(this.toastTimer);this.toastElement.textContent=message;this.toastElement.classList.remove('hidden');this.toastTimer=setTimeout(()=>this.toastElement.classList.add('hidden'),6000);}
  fatal(error) {this.overlay.innerHTML=`<div class="modal-card card"><span class="eyebrow">GRAPHICS / RECOVERY</span><h2>THE ARENA COULD NOT START.</h2><p>${esc(error.message)}</p><p>Use current Chrome or Edge with hardware acceleration enabled. Run the downloaded project with npm start rather than opening index.html directly.</p><button class="btn btn-warning" data-action="reload-page">RELOAD PAGE</button></div>`;this.overlay.classList.remove('hidden');document.querySelector('[data-action="reload-page"]')?.addEventListener('click',()=>location.reload());}
}
