import { Store,escapeHTML } from './storage.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { AudioSystem } from './audio.js';
import { Network } from './network.js';
import { HUD } from './hud.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';

// HAMU MASTER: game UI is not a document. Disable native text selection/copy/drag
// so dragging text cannot leave the canvas/page in a browser-selection state.
// This applies to admins too, while inputs/buttons remain fully clickable/typable.
(function installNoTextCopy(){
  const stop=e=>{ e.preventDefault(); e.stopPropagation(); };
  document.addEventListener('copy',stop,true);
  document.addEventListener('cut',stop,true);
  document.addEventListener('dragstart',stop,true);
  document.addEventListener('selectstart',stop,true);
  document.addEventListener('contextmenu',stop,true);
  document.addEventListener('keydown',e=>{
    const k=String(e.key||'').toLowerCase();
    if((e.ctrlKey||e.metaKey)&&(k==='c'||k==='x')) stop(e);
  },true);
  document.documentElement.classList.add('hamu-no-native-selection');
})();

try {
  const auth=new Auth();
  const account=await auth.requireAccount();
  let remoteProfile=null;
  try { remoteProfile=await auth.getProfile(); } catch(error) { console.warn('Profile sync unavailable; using local account cache.',error); }
  const store=new Store(account,remoteProfile),canvas=document.getElementById('world');
  const audio=new AudioSystem(store.data.settings),network=new Network(),hud=new HUD(document.getElementById('hud'));
  const renderer=new Renderer(canvas,store.data.settings);
  let ui;
  const input=new Input(canvas,()=>store.data.settings,{pause:()=>ui?.togglePause(),scoreboard:show=>hud.scoreboard(show),notice:message=>ui?.toast(message),action:(action,down)=>{if(action==='fire'&&down)game?.flushInputIntent?.();}});
  const game=new Game({renderer,input,audio,hud,network,store});
  store.setRemoteSync(profile=>auth.saveProfile(profile));
  if(!remoteProfile||store.remotePending) void store.saveRemote();
  ui=new UI({store,game,network,renderer,audio,auth});renderer.setMenuOperator(store.data.operator);
  // Readable diagnostics for local development. These cannot override the server authority.
  window.hamuMaster={store,game,renderer,input,hud,network,ui,auth,version:'1.3.0'};
  // Recheck on tab focus and periodically so logout/account changes in another tab cannot mix identities.
  let checking=false;
  const checkSession=async()=>{if(checking||document.hidden)return;checking=true;try{await auth.verify();}catch{/* Offline practice can continue; server still enforces online authentication. */}finally{checking=false;}};
  window.addEventListener('focus',checkSession);
  document.addEventListener('visibilitychange',checkSession);
  setInterval(checkSession,60000);
  document.getElementById('boot').classList.add('hidden');
  // Stay connected from the menu so incoming friend requests and party invites arrive live.
  network.on('session-replaced',()=>{
    const target=new URL(location.href);
    target.searchParams.set('sessionNotice','replaced');
    target.hash='';
    location.replace(target.href);
  });
  network.connect().catch(error=>ui.toast(error.message));
  window.addEventListener('beforeunload',()=>network.disconnect());
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();game.setPaused(true);ui.fatal(new Error('The graphics device was reset. Reload to restore the arena.'));});
} catch(error) {
  console.error('HAMU MASTER startup failed:',error);
  document.getElementById('boot').classList.remove('hidden');
  document.getElementById('boot').innerHTML=`<div class="fatal-startup"><h1>GRAPHICS CHECK REQUIRED</h1><p>${escapeHTML(error.message)}</p><p>Use current Chrome or Edge with WebGL and hardware acceleration enabled. Run <code>npm install</code>, then <code>npm start</code>, and open <code>http://localhost:3000</code>.</p><button class="btn btn-warning" id="retry-start">RELOAD</button></div>`;
  document.getElementById('retry-start').onclick=()=>location.reload();
}
