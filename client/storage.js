import { cleanLoadout, cleanOperator } from '../shared/weapons.js';
import { cleanName, clamp } from '../shared/protocol.js';
export const DEFAULT_BINDINGS=Object.freeze({forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',fire:'Mouse0',ads:'Mouse2',sprint:'ShiftLeft',tactical:'AltLeft',crouch:'ControlLeft',prone:'KeyZ',jump:'Space',slide:'KeyC',reload:'KeyR',primary:'Digit1',secondary:'Digit2',knife:'Digit3',swap:'KeyQ',melee:'KeyV',grenade:'KeyG',scoreboard:'Tab'});
export const DEFAULT_SETTINGS=Object.freeze({sensitivity:1,fov:95,volume:65,effects:85,ambience:18,quality:'high',invertY:false,reducedMotion:false,bindings:{...DEFAULT_BINDINGS}});
const KEY='hamu-master-v1';
const LEGACY_KEY='vector-breach-v1';
const initial=()=>({version:1,settings:{...DEFAULT_SETTINGS,bindings:{...DEFAULT_BINDINGS}},loadout:['ar4','relay9','edge'],operator:'sentinel',menuYawByOperator:{},mode:'tdm',practice:{bots:5,difficulty:.8,duration:180},serverURL:'',profile:{name:'Operator',xp:0,kills:0,deaths:0,wins:0,matches:0,time:0},history:[]});
export class Store {
  constructor(account=null,remoteData=null) {
    this.account=account;this.key=account?`${KEY}:account:${account.id}`:KEY;
    this.data=initial();this.persistent=true;this.remoteSave=null;this.remoteQueue=Promise.resolve();this.remoteHealthy=true;this.pendingKey=`${this.key}:pending-profile`;this.remotePending=false;
    try {
      const localRaw=JSON.parse(localStorage.getItem(this.key)||(!account?localStorage.getItem(LEGACY_KEY):null)||'null');
      let pending=null;try{pending=JSON.parse(localStorage.getItem(this.pendingKey)||'null');}catch{/* Ignore a malformed sync marker, not the valid profile. */}
      this.remotePending=typeof pending?.revision==='string'&&pending.revision.length>0&&pending.profile?.version===1&&typeof pending.profile.operator==='string'&&Array.isArray(pending.profile.loadout)&&!!pending.profile.settings&&typeof pending.profile.settings==='object'&&!!pending.profile.profile&&typeof pending.profile.profile==='object';
      // An unacknowledged local save is newer than the server copy. Keep it on
      // reload and retry it after login instead of silently reverting the kit.
      const raw=this.remotePending?pending.profile:remoteData?.version===1?remoteData:localRaw;
      if(raw?.version===1) {
        this.data={...this.data,...raw,profile:{...this.data.profile,...raw.profile},settings:{...DEFAULT_SETTINGS,...raw.settings,bindings:{...DEFAULT_BINDINGS,...raw.settings?.bindings}}};
        this.data.loadout=cleanLoadout(raw.loadout);this.data.operator=cleanOperator(raw.operator);this.data.menuYawByOperator=(raw.menuYawByOperator&&typeof raw.menuYawByOperator==='object'&&!Array.isArray(raw.menuYawByOperator))?{...raw.menuYawByOperator}:{};
        this.data.history=Array.isArray(raw.history)?raw.history.slice(0,50):[];
        this.data.profile.name=cleanName(this.data.profile.name);
      }
      this.validateSettings();
      if(account)this.data.profile.name=account.username;
    }catch{this.persistent=false;}
    if(account)this.data.profile.name=account.username;
  }
  validateSettings() {
    const s=this.data.settings;
    for(const [key,min,max] of [['sensitivity',.2,3],['fov',70,120],['volume',0,100],['effects',0,100],['ambience',0,100]])s[key]=clamp(Number(s[key])||0,min,max);
    if(!['low','medium','high'].includes(s.quality))s.quality='high';
    for(const key of Object.keys(DEFAULT_BINDINGS))if(typeof s.bindings[key]!=='string'||s.bindings[key].length>24)s.bindings[key]=DEFAULT_BINDINGS[key];
  }
  setRemoteSync(fn){this.remoteSave=typeof fn==='function'?fn:null;return this;}
  serialize(){
    const copy={...this.data,profile:{...this.data.profile,name:undefined}};delete copy.profile.name;return JSON.parse(JSON.stringify(copy));
  }
  saveRemote(){
    if(!this.remoteSave)return Promise.resolve(false);
    const payload=this.serialize(),revision=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;this.remoteRevision=revision;this.remotePending=true;
    try{localStorage.setItem(this.pendingKey,JSON.stringify({revision,profile:payload}));}catch{this.persistent=false;}
    this.remoteQueue=this.remoteQueue.then(()=>this.remoteSave(payload)).then(()=>{
      this.remoteHealthy=true;
      // A slow acknowledgment of an earlier kit must not clear a newer save.
      try{const pending=JSON.parse(localStorage.getItem(this.pendingKey)||'null');if(pending?.revision===revision)localStorage.removeItem(this.pendingKey);}catch{this.persistent=false;}
      if(this.remoteRevision===revision)this.remotePending=false;
      return true;
    }).catch(()=>{this.remoteHealthy=false;return false;});
    return this.remoteQueue;
  }
  save() {
    if(this.account)this.data.profile.name=this.account.username;
    try{localStorage.setItem(this.key,JSON.stringify(this.data));this.persistent=true;}catch{this.persistent=false;}
    void this.saveRemote();
  }
  resetSettings() {this.data.settings={...DEFAULT_SETTINGS,bindings:{...DEFAULT_BINDINGS}};this.save();}
  record(state,id,online=false) {
    if(state.phase!=='ended'||this.data.history.some(m=>m.id===state.matchId))return null;
    const p=state.players.find(p=>p.id===id);if(!p)return null;
    const win=state.winner===(state.mode==='ffa'?p.id:p.team),draw=state.winner===null;
    const xp=250+p.score+(win?150:0),duration=Math.round(state.duration-state.remaining);
    const match={id:state.matchId,date:new Date().toISOString(),mode:state.mode,map:'Foundry',kills:p.kills,deaths:p.deaths,score:p.score,xp,result:draw?'DRAW':win?'VICTORY':'DEFEAT',duration,online};
    this.data.history.unshift(match);this.data.history.length=Math.min(this.data.history.length,50);
    const profile=this.data.profile;profile.matches++;profile.kills+=p.kills;profile.deaths+=p.deaths;profile.xp+=xp;profile.time+=duration;if(win)profile.wins++;
    this.save();return match;
  }
  get level(){return 1+Math.floor(this.data.profile.xp/1500);}
}
export const keyLabel=key=>({Mouse0:'LMB',Mouse1:'MMB',Mouse2:'RMB',Space:'SPACE',ControlLeft:'CTRL',ControlRight:'R CTRL',ShiftLeft:'SHIFT',ShiftRight:'R SHIFT',AltLeft:'ALT',AltRight:'R ALT',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'}[key]||key.replace('Key','').replace('Digit','').toUpperCase());
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clock=seconds=>`${Math.floor(Math.max(0,seconds)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
