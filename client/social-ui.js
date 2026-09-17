import { escapeHTML as esc, clock } from './storage.js';
import { MODES } from '../shared/weapons.js';
import { icon } from './icons.js';
import { defaultServerURL } from './network.js';

const STATUS={offline:'OFFLINE',online:'ONLINE',in_party:'IN PARTY',queued:'SEARCHING',in_match:'IN MATCH'};
export class SocialUI {
  constructor(ui){
    this.ui=ui;this.network=ui.network;this.tab='directory';this.query='';this.results=[];this.searchMessage='';this.sequence=0;this.busy=false;this.selected=null;this.confirmRemove=false;this.directory={users:[],total:0,offset:0,limit:24,hasMore:false};this.directoryLoading=false;this.directoryLoaded=false;
    for(const event of ['social','party','queue','status'])this.network.on(event,()=>{this.update();if(event==='status'&&this.network.status==='connected'&&document.getElementById('friends-directory-results'))void this.loadDirectory(0);});
    this.network.on('notice',message=>ui.toast(message));
    document.addEventListener('click',event=>{const b=event.target.closest('[data-social]');if(b&&!b.disabled){event.preventDefault();this.click(b).catch(error=>this.problem(error.message));}});
    document.addEventListener('input',event=>{if(event.target.id==='directory-search'){this.query=event.target.value.trim();this.tab='directory';clearTimeout(this.searchTimer);++this.sequence;this.directoryLoading=true;this.searchMessage='';this.update();this.searchTimer=setTimeout(()=>this.loadDirectory(0),250);}});
    document.addEventListener('keydown',event=>{if(event.target.id==='directory-search'&&event.key==='Enter'){event.preventDefault();clearTimeout(this.searchTimer);void this.loadDirectory(0);}if(event.key==='Escape'&&this.ui.overlay.dataset.social==='profile'){this.selected=null;delete this.ui.overlay.dataset.social;this.ui.closeOverlay();}});
    document.addEventListener('change',event=>{if(event.target.id==='party-mode')this.perform('party.mode',{mode:event.target.value}).catch(error=>this.problem(error.message));});
    this.timer=setInterval(()=>{if(!document.hidden)this.updateTime();},500);
  }
  get self(){return this.ui.auth.user.id;}
  get party(){return this.network.party;}
  get isLeader(){return this.party?.leaderId===this.self;}
  kit(){return {loadout:this.ui.store.data.loadout,operator:this.ui.store.data.operator};}
  button(action,text,attrs='',disabled=false,kind='btn-outline'){return `<button type="button" class="btn btn-sm ${kind}" data-social="${action}" ${attrs} ${disabled||this.busy?'disabled':''}>${text}</button>`;}
  pageHTML(){
    return `<section class="panel-page social-page operator-directory-page" id="operator-directory-page"><div class="directory-title"><div><span class="eyebrow">HAMU MASTER / PLAYER NETWORK</span><h1>FIND YOUR SQUAD.</h1><p>Search by game name, meet players and bring your friends into the lobby.</p></div><button class="back-button btn btn-ghost" data-action="nav" data-page="play">← QUICK PLAY</button></div>
    <div class="directory-search-toolbar"><label class="directory-search-field" for="directory-search">${icon('users',20)}<input id="directory-search" type="search" placeholder="SEARCH PLAYER ID / UNIQUE NAME" aria-label="Search players by game name" autocomplete="off" spellcheck="false" maxlength="18" value="${esc(this.query)}"><kbd>ENTER</kbd></label><button class="directory-pending-button" data-social="pending" id="directory-pending" aria-pressed="false">PENDING <span id="directory-pending-count">0</span></button></div>
    <div class="directory-toolbar"><span id="directory-connection-state"></span><button class="btn btn-ghost btn-sm" data-social="refresh">↻ REFRESH</button><button class="btn btn-ghost btn-sm" data-social="connect" id="directory-connect">RECONNECT</button></div><div id="social-error" class="social-error" role="alert" hidden></div>
    <div id="friends-directory-results" class="operator-directory-results" role="region" aria-label="Player directory"></div>
    <p class="directory-scope">GLOBAL PLAYERS · Registered players on this game server (${esc(location.host)}). Your accepted friends also appear in Quick Play, even when offline.</p>
    <details class="custom-room-details"><summary>CUSTOM ROOMS <span>Optional · Solo operators · Room codes</span>${icon('arrow',16)}</summary><p class="fine-print">For a friends party, use the lobby above. Custom rooms are separate from matchmaking.</p><div class="lobby-grid"><div class="lobby-create card"><span class="eyebrow">CUSTOM / HOST A ROOM</span><h2>YOUR FIELD. YOUR RULES.</h2><label class="field-label">ROOM NAME<input id="room-name" class="input" maxlength="18" value="Foundry training"></label><div class="field-pair"><label class="field-label">MODE<select class="select" id="lobby-mode">${Object.values(MODES).map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select></label><label class="field-label">BOTS<select class="select" id="lobby-bots"><option value="0">No bots</option><option value="3">3 bots</option><option value="7" selected>7 bots</option></select></label></div><button class="btn btn-warning" data-action="create-room">CREATE CUSTOM ROOM ${icon('plus',17)}</button></div><div class="room-browser card"><div class="section-title row-between"><h2>CUSTOM ROOMS</h2><button class="btn btn-ghost btn-sm" data-action="refresh-rooms">REFRESH</button></div><div id="room-list" class="room-list"></div><div class="join-code"><label class="input"><input id="room-code" maxlength="6" placeholder="ROOM CODE" aria-label="Room code"></label><button class="btn btn-outline" data-action="join-code">JOIN</button></div></div></div></details></section>`;
  }
  mount(){this.selected=null;this.confirmRemove=false;delete this.ui.overlay.dataset.social;this.update();void this.loadDirectory(0);}
  html(id,value){const element=document.getElementById(id);if(element&&element.socialHTML!==value){element.innerHTML=value;element.socialHTML=value;}}
  update(){
    const s=this.network.social,counts=s.incoming.length+s.invites.filter(i=>i.expiresAt>Date.now()).length;
    const badge=document.getElementById('nav-social-badge');if(badge){badge.textContent=counts||'';badge.hidden=!counts;}
    const dock=document.getElementById('squad-dock');if(dock){const q=this.network.queue;
      // Quick Play and the party lobby already show queue status; do not duplicate it with the floating dock.
      dock.hidden=!q||this.ui.current==='play'||this.ui.current==='friends'||this.ui.current==='multiplayer'||this.ui.game.active;
      dock.textContent=q?`FINDING ${MODES[q.mode]?.short||'MATCH'} · ${q.partySize} IN PARTY · VIEW QUEUE`:'';
    }
    if(document.getElementById('friends-directory-results')){
      this.html('friends-directory-results',this.socialHTML());this.updateTime();

    }
    this.ui.updateQuickFriends?.();
    const pending=document.getElementById('directory-pending');if(pending){pending.setAttribute('aria-pressed',String(this.tab==='pending'));document.getElementById('directory-pending-count').textContent=String(s.incoming.length);}
    const status=document.getElementById('directory-connection-state');if(status)status.textContent=this.network.status==='connected'?'● CONNECTED · PLAYER DIRECTORY':this.network.status==='connecting'?'CONNECTING…':'OFFLINE · RECONNECT TO FIND PLAYERS';
    const connect=document.getElementById('directory-connect');if(connect){connect.hidden=this.network.status==='connected';connect.disabled=this.network.status==='connecting';}
    this.renderInvitePrompt();
    if(this.selected&&this.ui.overlay.dataset.social==='profile'&&!this.ui.game.active)this.renderProfile();
  }
  avatar(p){const name=String(p?.username||p?.name||'OP').trim();const initials=name.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'OP';return `<span class="social-avatar" aria-hidden="true"><span>${esc(initials)}</span></span>`;}
  person(p){return `<button class="person-identity" data-social="profile" data-user="${esc(p.id)}">${this.avatar(p)}<span><strong>${esc(p.username)}</strong><small>${STATUS[p.status]||'OFFLINE'}</small></span></button>`;}
  empty(title,description){return `<div class="social-empty">${icon('users',33)}<h3>${title}</h3><p>${description}</p></div>`;}
  inviteReason(p){
    if(!p.online)return 'Player is offline';if(p.status!=='online')return 'Player is busy';if(this.network.status!=='connected')return 'Reconnect first';if(!this.isLeader)return 'Only the lobby leader can invite';if(this.party?.status!=='idle'||this.ui.game.active)return 'Return to an idle lobby first';if(this.party.members.length>=this.party.maxSize)return 'Lobby is full';return '';
  }
  friendsHTML(){
    const friends=[...(this.network.social.friends||[])].sort((a,b)=>Number(b.online)-Number(a.online)||a.username.localeCompare(b.username));
    if(!friends.length)return `<div class="master-friends-empty">${icon('users',28)}<strong>NO FRIENDS YET</strong><small>Accepted friends will appear here, online or offline.</small><button class="btn btn-ghost btn-sm" data-action="nav" data-page="friends">ADD FRIENDS →</button></div>`;
    return friends.map(p=>{const reason=this.inviteReason(p);return `<div class="master-friend-row" data-friend-id="${esc(p.id)}"><button class="master-friend-person" data-social="profile" data-user="${esc(p.id)}"><span class="master-avatar ${p.online?'online':''}">${esc(p.username.slice(0,2).toUpperCase())}<i></i></span><span><strong>${esc(p.username)}</strong><small>${p.online?'ONLINE':'OFFLINE'}${p.online&&p.status!=='online'?' · '+(STATUS[p.status]||'BUSY'):''}</small></span></button><button class="master-invite" data-social="invite" data-user="${esc(p.id)}" title="${esc(reason||'Send a lobby invitation')}" ${reason||this.busy?'disabled':''}>INVITE TO LOBBY</button></div>`;}).join('');
  }
  playerCard(p){
    const relationship=this.relation(p.id),incoming=this.network.social.incoming.find(r=>r.from.id===p.id),outgoing=this.network.social.outgoing.find(r=>r.to.id===p.id);let action='';
    if(relationship==='none')action=this.button('add-friend','ADD FRIEND',`data-user="${esc(p.id)}"`,false,'btn-warning');
    if(relationship==='friend')action='<span class="directory-friend-badge">✓ FRIENDS</span>';
    if(relationship==='incoming')action=this.button('accept-friend','ACCEPT',`data-request="${esc(incoming.id)}"`,false,'btn-warning')+this.button('decline-friend','CANCEL',`data-request="${esc(incoming.id)}"`);
    if(relationship==='outgoing')action='<span class="directory-request-sent">REQUEST SENT</span>'+this.button('cancel-friend','CANCEL',`data-request="${esc(outgoing.id)}"`);
    const reason=this.inviteReason(p);
    return `<article class="operator-player-card" data-player-id="${esc(p.id)}"><div class="operator-player-card-top"><span class="directory-presence ${p.online?'is-online':''}">● ${p.online?'ONLINE':'OFFLINE'}</span><small>${p.online&&p.status!=='online'?STATUS[p.status]||'BUSY':'HAMU OPERATOR'}</small></div><button class="operator-player-profile" data-social="profile" data-user="${esc(p.id)}">${this.avatar(p)}<strong>${esc(p.username)}</strong><small title="${esc(p.id)}">ID · ${esc(p.id)}</small></button><div class="operator-player-actions">${action}${this.button('invite','INVITE TO LOBBY',`data-user="${esc(p.id)}" title="${esc(reason||'Send a lobby invitation')}"`,!!reason)}</div></article>`;
  }
  socialHTML(){
    const s=this.network.social;if(this.network.status!=='connected')return this.empty('CONNECT TO FIND PLAYERS.','Reconnect to load the player directory, friend requests and profiles.');
    if(this.tab==='pending'){
      const incoming=s.incoming||[],outgoing=s.outgoing||[],invites=(s.invites||[]).filter(i=>i.expiresAt>Date.now());
      const rows=incoming.map(r=>`<div class="directory-request-row">${this.person(r.from)}<div class="request-actions">${this.button('accept-friend','ACCEPT',`data-request="${esc(r.id)}"`,false,'btn-warning')}${this.button('decline-friend','CANCEL',`data-request="${esc(r.id)}"`)}</div></div>`).join('');
      return `<div class="directory-results-heading"><div><span class="eyebrow">WAITING FOR YOU</span><h2>PENDING REQUESTS <small>${incoming.length}</small></h2></div>${this.button('directory','← ALL PLAYERS')}</div><div class="directory-requests">${rows||this.empty('YOU’RE ALL CAUGHT UP.','New friend requests will appear here. Accept to become friends, or cancel the request.')}${outgoing.length?' <h3>REQUESTS YOU SENT</h3>'+outgoing.map(r=>`<div class="directory-request-row">${this.person(r.to)}${this.button('cancel-friend','CANCEL REQUEST',`data-request="${esc(r.id)}"`)}</div>`).join(''):''}${invites.length?'<h3>LOBBY INVITATIONS</h3>'+invites.map(i=>`<div class="directory-request-row">${this.person(i.from)}<div class="request-actions">${this.button('accept-invite','JOIN LOBBY',`data-invite="${esc(i.id)}"`,false,'btn-warning')}${this.button('decline-invite','CANCEL',`data-invite="${esc(i.id)}"`)}</div></div>`).join(''):''}</div>`;
    }
    const d=this.directory;return `<div class="directory-results-heading"><div><span class="eyebrow">${this.query?'SEARCH RESULTS':'DISCOVER YOUR NEXT TEAMMATE'}</span><h2>${this.query?'PLAYERS FOUND':'GLOBAL PLAYERS'} <small>${this.directoryLoading?'…':d.total}</small></h2></div><span>${this.query?'GAME NAME · '+esc(this.query):'THIS SERVER / ALL OPERATORS'}</span></div>${this.directoryLoading?'<div class="directory-loading" role="status">SEARCHING PLAYERS…</div>':this.searchMessage?`<div class="directory-loading" role="alert">${esc(this.searchMessage)} ${this.button('directory','TRY AGAIN')}</div>`:d.users.length?`<div class="operator-player-grid">${d.users.map(p=>this.playerCard(s.friends.find(f=>f.id===p.id)||p)).join('')}</div>`:this.empty('NO PLAYERS FOUND.',this.query?'Try another game name.':'Other registered players will appear here.')}<div class="directory-pagination">${this.button('directory-prev','← PREVIOUS','',this.directoryLoading||d.offset===0)}<span>${d.total?d.offset+1:0}–${Math.min(d.offset+d.users.length,d.total)} OF ${d.total}</span>${this.button('directory-next','NEXT →','',this.directoryLoading||!d.hasMore)}</div>`;
  }
  relation(id){const s=this.network.social;if(id===this.self)return'self';if(s.friends.some(x=>x.id===id))return'friend';if(s.incoming.some(x=>x.from.id===id))return'incoming';if(s.outgoing.some(x=>x.to.id===id))return'outgoing';return'none';}
  async loadDirectory(offset=0){
    const seq=++this.sequence;this.directoryLoading=true;this.searchMessage='';this.update();
    if(this.network.status!=='connected'){this.directoryLoading=false;this.update();return;}
    try{const result=await this.network.request('social.directory',{query:this.query,offset,limit:24});if(seq!==this.sequence)return;this.directory=result;this.directoryLoaded=true;this.results=result.users;}catch(error){if(seq!==this.sequence)return;this.searchMessage=error.message;}finally{if(seq===this.sequence){this.directoryLoading=false;this.update();}}
  }
  async search(){return this.loadDirectory(0);}
  renderSearch(){this.html('friends-directory-results',this.socialHTML());}
  renderProfile(){const p=this.selected;if(!p)return;const relation=this.relation(p.id),known=this.network.social.friends.find(x=>x.id===p.id)||p;let controls='';if(relation==='none')controls=this.button('add-friend','ADD FRIEND',`data-user="${esc(p.id)}"`,false,'btn-warning');if(relation==='friend')controls=this.button('invite','INVITE TO PARTY',`data-user="${esc(p.id)}"`,!known.online||known.status!=='online'||!this.isLeader||this.party?.status!=='idle','btn-warning')+this.button('remove-friend','REMOVE FRIEND',`data-user="${esc(p.id)}"`);if(relation==='outgoing'){const r=this.network.social.outgoing.find(x=>x.to.id===p.id);controls=`<span class="badge badge-outline">REQUEST SENT</span>${this.button('cancel-friend','CANCEL REQUEST',`data-request="${esc(r.id)}"`)}`;}if(relation==='incoming'){const r=this.network.social.incoming.find(x=>x.from.id===p.id);controls=this.button('accept-friend','ACCEPT FRIEND REQUEST',`data-request="${esc(r.id)}"`,false,'btn-warning')+this.button('decline-friend','DECLINE',`data-request="${esc(r.id)}"`);}if(relation==='self')controls='<span class="badge badge-warning">THIS IS YOU</span>';
    this.ui.overlay.dataset.social='profile';this.ui.overlay.innerHTML=`<div class="modal-card public-profile card"><div class="modal-heading"><span class="eyebrow">PLAYER DOSSIER / VERIFIED IDENTITY</span><button class="btn btn-ghost btn-sm" data-social="close-profile" aria-label="Close player profile">${icon('close',22)}</button></div><div class="public-profile-hero">${this.avatar(known)}<span class="eyebrow">${relation==='friend'?'YOUR FRIEND':'HAMU MASTER OPERATOR'}</span><h2>${esc(p.username)}</h2><span class="presence-label">${STATUS[known.status]||'OFFLINE'}</span></div><div class="dossier-facts"><div><span>PLAYER ID</span><code>${esc(p.id)}</code></div><div><span>JOINED</span><b>${new Date(p.createdAt).toLocaleDateString()}</b></div></div><p class="fine-print">Verified account details only. Match XP and rank are local to each player’s browser and are not shown as online stats.</p><div class="public-profile-actions">${this.confirmRemove?`<p>Remove ${esc(p.username)} from your friends?</p>${this.button('remove-confirm','YES, REMOVE',`data-user="${esc(p.id)}"`,false,'btn-warning')}${this.button('remove-cancel','KEEP FRIEND')}`:controls}</div><div id="profile-social-error" role="alert"></div></div>`;this.ui.overlay.classList.remove('hidden');}
  async perform(op,data={}){if(this.busy)return;this.busy=true;this.update();try{const result=await this.network.request(op,data);return result;}finally{this.busy=false;this.update();}}
  problem(message){this.busy=false;this.update();this.ui.toast(message);const e=document.getElementById('profile-social-error')||document.getElementById('social-error');if(e){e.textContent=message;e.hidden=false;}}
  async click(b){const a=b.dataset.social;if(a==='close-profile'){this.selected=null;delete this.ui.overlay.dataset.social;this.ui.closeOverlay();return;}if(a==='friends'){this.tab='friends';this.update();document.getElementById('friends-directory-results')?.scrollIntoView({block:'nearest',behavior:'smooth'});return;}if(a==='remove-friend'){this.confirmRemove=true;this.renderProfile();return;}if(a==='remove-cancel'){this.confirmRemove=false;this.renderProfile();return;}if(this.busy)return;
    const warning=document.getElementById('social-error');if(warning)warning.hidden=true;
    if(a==='connect'){await this.ui.connect();return;}
    if(a==='pending'){this.tab=this.tab==='pending'?'directory':'pending';this.update();return;}
    if(a==='directory'){this.tab='directory';await this.loadDirectory(0);return;}
    if(a==='directory-next'||a==='directory-prev'){await this.loadDirectory(Math.max(0,this.directory.offset+(a==='directory-next'?24:-24)));return;}
    if(a==='refresh'){await this.perform('social.sync');await this.loadDirectory(this.directory.offset);return;}
    if(a==='profile'){this.searchOpen=false;const result=await this.perform('social.profile',{userId:b.dataset.user});if(result){this.selected=result.profile;this.confirmRemove=false;const drop=document.getElementById('player-results');if(drop)drop.hidden=true;this.renderProfile();}return;}
    const userId=b.dataset.user,friendRequestId=b.dataset.request;
    if(a==='add-friend'){await this.perform('social.request',{userId});this.ui.toast('Friend request sent.');}
    if(a==='accept-friend'||a==='decline-friend')await this.perform('social.respond',{friendRequestId,accept:a==='accept-friend'});
    if(a==='cancel-friend')await this.perform('social.cancel',{friendRequestId});
    if(a==='remove-confirm'){await this.perform('social.remove',{userId});this.confirmRemove=false;this.ui.toast('Friend removed.');}
    if(a==='invite'){await this.perform('party.invite',{userId});this.ui.toast('Party invite sent. It expires after 60 seconds.');}
    if(a==='accept-invite'||a==='decline-invite'){await this.perform('party.inviteRespond',{inviteId:b.dataset.invite,accept:a==='accept-invite',...(a==='accept-invite'?this.kit():{})});if(a==='accept-invite'){this.ui.toast('Party joined. You are READY.');this.tab='friends';}}
    if(a==='ready'||a==='unready')await this.perform('party.ready',{ready:a==='ready',explicitCancel:a==='unready',...this.kit()});
    if(a==='find-match'){if(!await this.ui.auth.verify())return;await this.perform('queue.join',{mode:this.party.mode,...this.kit()});}
    if(a==='queue-cancel')await this.perform('queue.cancel');
    if(a==='leave-party')await this.perform('party.leave');
    if(a==='kick')await this.perform('party.kick',{userId});
    this.update();
  }
  renderInvitePrompt(){
    const invite=this.network.social.invites.filter(i=>i.expiresAt>Date.now()).sort((a,b)=>b.expiresAt-a.expiresAt)[0];
    let box=document.getElementById('party-invite-prompt');
    if(!invite){box?.remove();return;}
    if(!box){box=document.createElement('div');box.id='party-invite-prompt';box.className='party-invite-prompt';document.body.appendChild(box);}
    const promptKey=invite.id+':'+invite.from.username+':'+invite.mode+':'+this.busy;if(box.dataset.promptKey===promptKey)return;box.dataset.promptKey=promptKey;
    box.innerHTML=`<div class="party-invite-prompt-kicker">PARTY INVITE · QUICK PLAY</div><strong>${esc(invite.from.username)}</strong><span>invited you to their ${esc(MODES[invite.mode]?.name||'match')} lobby.</span><small>Expires in <b data-invite-prompt-expiry="${invite.expiresAt}">${Math.max(0,Math.ceil((invite.expiresAt-Date.now())/1000))}</b>s</small><div><button class="btn btn-warning btn-sm" data-social="accept-invite" data-invite="${esc(invite.id)}" ${this.busy?'disabled':''}>ACCEPT</button><button class="btn btn-ghost btn-sm" data-social="decline-invite" data-invite="${esc(invite.id)}" ${this.busy?'disabled':''}>CANCEL</button></div>`;
  }
  updateTime(){const q=this.network.queue;if(q){const elapsed=document.getElementById('queue-elapsed'),fill=document.getElementById('queue-fill-time'),count=document.getElementById('queue-search-count');if(elapsed)elapsed.textContent=clock((Date.now()-q.startedAt)/1000);if(fill)fill.textContent=`${Math.max(0,Math.ceil((q.fillAt-Date.now())/1000))}s`;if(count)count.textContent=q.playersSearching;}
    for(const element of document.querySelectorAll('[data-invite-expiry]')){const n=Math.max(0,Math.ceil((Number(element.dataset.inviteExpiry)-Date.now())/1000));element.textContent=n;if(!n){this.html('friends-directory-results',this.socialHTML());break;}}for(const element of document.querySelectorAll('[data-invite-prompt-expiry]')){const n=Math.max(0,Math.ceil((Number(element.dataset.invitePromptExpiry)-Date.now())/1000));element.textContent=n;}this.renderInvitePrompt();
  }
}
