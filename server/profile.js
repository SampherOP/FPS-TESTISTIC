import { mkdir, readFile, rename, unlink, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { persistDurableSnapshot } from './durable-snapshot.js';
import { cleanLoadout, cleanOperator, OPERATORS } from '../shared/weapons.js';

const PROFILE_VERSION = 1;
const MAX_HISTORY = 50;
const DEFAULT = {
  version: PROFILE_VERSION,
  settings: { sensitivity:1, fov:95, volume:65, effects:85, ambience:18, quality:'high', invertY:false, reducedMotion:false, bindings:{} },
  loadout: ['ar4','relay9','edge'], operator: 'sentinel', menuYawByOperator:{}, mode:'tdm',
  practice: { bots:5, difficulty:.8, duration:180 },
  profile: { xp:0, kills:0, deaths:0, wins:0, matches:0, time:0 }, history: []
};

async function atomicJson(file,value){
  await mkdir(join(file,'..'),{recursive:true,mode:0o700});
  const temp=`${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n','utf8');await handle.sync();await handle.close();handle=undefined;await rename(temp,file);await persistDurableSnapshot(file.split(/[\\/]/).pop(),value);}
  catch(error){if(handle)await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});throw error;}
}
async function readJsonOr(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error?.code==='ENOENT')return fallback;throw error;}}
const clone=value=>JSON.parse(JSON.stringify(value));
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

function sanitize(input){
  const x=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const s=x.settings&&typeof x.settings==='object'?x.settings:{};
  const bindings={};
  if(s.bindings&&typeof s.bindings==='object'&&!Array.isArray(s.bindings))for(const [k,v] of Object.entries(s.bindings).slice(0,32))if(typeof k==='string'&&k.length<=32&&typeof v==='string'&&v.length<=24)bindings[k]=v;
  // Keep only known operators and finite rotations. Old commando rotation
  // follows the same migration as the selected operator; unknown keys are dropped.
  const rotations=x.menuYawByOperator&&typeof x.menuYawByOperator==='object'&&!Array.isArray(x.menuYawByOperator)?x.menuYawByOperator:{};
  const menuYawByOperator={};
  for(const {id} of OPERATORS){const yaw=rotations[id]??(id==='frontline'?rotations.commando:undefined);if(typeof yaw==='number'&&Number.isFinite(yaw))menuYawByOperator[id]=yaw%(Math.PI*2);}
  const p=x.practice&&typeof x.practice==='object'?x.practice:{};
  const stats=x.profile&&typeof x.profile==='object'?x.profile:{};
  const history=Array.isArray(x.history)?x.history.slice(0,MAX_HISTORY).filter(m=>m&&typeof m==='object').map(m=>({
    id:typeof m.id==='string'?m.id.slice(0,100):'',date:typeof m.date==='string'?m.date:'',mode:['tdm','ffa','dom'].includes(m.mode)?m.mode:'tdm',map:'Foundry',
    kills:clamp(Number(m.kills)||0,0,100000),deaths:clamp(Number(m.deaths)||0,0,100000),score:clamp(Number(m.score)||0,0,100000),xp:clamp(Number(m.xp)||0,0,1000000),
    result:['VICTORY','DEFEAT','DRAW'].includes(m.result)?m.result:'DRAW',duration:clamp(Number(m.duration)||0,0,86400),online:Boolean(m.online)
  })).filter(m=>m.id):[];
  return {
    version:PROFILE_VERSION,
    settings:{sensitivity:clamp(Number(s.sensitivity)||1,.2,3),fov:clamp(Number(s.fov)||95,70,120),volume:clamp(Number(s.volume)||0,0,100),effects:clamp(Number(s.effects)||0,0,100),ambience:clamp(Number(s.ambience)||0,0,100),quality:['low','medium','high'].includes(s.quality)?s.quality:'high',invertY:Boolean(s.invertY),reducedMotion:Boolean(s.reducedMotion),bindings},
    loadout:cleanLoadout(Array.isArray(x.loadout)?x.loadout:DEFAULT.loadout),operator:cleanOperator(x.operator),menuYawByOperator,mode:['tdm','ffa','dom'].includes(x.mode)?x.mode:'tdm',
    practice:{bots:[0,3,5,7].includes(Number(p.bots))?Number(p.bots):5,difficulty:[.5,.8,1.2].includes(Number(p.difficulty))?Number(p.difficulty):.8,duration:[60,180,300,600].includes(Number(p.duration))?Number(p.duration):180},
    profile:{xp:clamp(Number(stats.xp)||0,0,1e9),kills:clamp(Number(stats.kills)||0,0,1e9),deaths:clamp(Number(stats.deaths)||0,0,1e9),wins:clamp(Number(stats.wins)||0,0,1e9),matches:clamp(Number(stats.matches)||0,0,1e9),time:clamp(Number(stats.time)||0,0,1e9)},
    history
  };
}

export class ProfileStore {
  constructor({dataDir,beforeReady,beforeWrite}={}){if(!dataDir)throw new TypeError('dataDir is required');this.file=join(dataDir,'profiles.json');this.beforeWrite=beforeWrite;this.profiles=new Map();this.writeChain=Promise.resolve();this.ready=Promise.resolve(beforeReady).then(()=>this._load());}
  async _load(){const data=await readJsonOr(this.file,{version:1,profiles:{}});if(!data||data.version!==1||!data.profiles||typeof data.profiles!=='object')throw new Error('Invalid profile store');for(const [id,value] of Object.entries(data.profiles))if(typeof id==='string'&&id.length<=64)this.profiles.set(id,sanitize(value));}
  async _ensureReady(){await this.ready;}
  _withWriteLock(fn){const result=this.writeChain.then(fn);this.writeChain=result.catch(()=>{});return result;}
  async _save(next){if(this.beforeWrite)await this.beforeWrite();await atomicJson(this.file,{version:1,profiles:Object.fromEntries(next)});this.profiles=next;}
  async get(userId){await this._ensureReady();const p=this.profiles.get(userId);return p?clone(p):null;}
  async save(userId,value){await this._ensureReady();const clean=sanitize(value);return this._withWriteLock(async()=>{const next=new Map(this.profiles);next.set(userId,clean);await this._save(next);return clone(clean);});}
}
export { sanitize as sanitizeProfile, DEFAULT as DEFAULT_PROFILE };
