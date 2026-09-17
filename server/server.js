import http from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { performance } from 'node:perf_hooks';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { World } from '../shared/simulation.js';
import { MODES, cleanLoadout, cleanOperator } from '../shared/weapons.js';
import { TICK_RATE, SNAPSHOT_RATE, MAX_PLAYERS, validateInput, cleanName, cleanRoomName, clamp } from '../shared/protocol.js';
import { staticHandler } from './static.js';
import { AuthStore, AuthError, clearSessionCookie, cookieValue, publicUser, selfUser, sessionCookie, validUsername } from './auth.js';
import { PersistentDataStore } from './data-store.js';
import { SocialStore } from './social.js';
import { Matchmaking } from './matchmaking.js';
import { ProfileStore } from './profile.js';
import { regionConfig, publicRegionInfo } from './region.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_LIMIT = 8 * 1024 * 1024, UI_IMAGE_LIMIT = 8 * 1024 * 1024;
function json(res,status,value,extra={}) { if(res.headersSent)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value)); }
function requestIp(req) { return typeof req.socket.remoteAddress==='string'?req.socket.remoteAddress:'unknown'; }
// The configured deployment scheme is trusted; X-Forwarded-* is deliberately ignored.
export function originMatchesRequest(req,origin) {
  if(!origin)return true;const host=req.headers.host;
  if(typeof host!=='string'||!host||/[^A-Za-z0-9.:[\]-]/.test(host))return false;
  try { const scheme=process.env.COOKIE_SECURE==='1'||req.socket.encrypted?'https':'http';return new URL(origin).origin===new URL(`${scheme}://${host}`).origin; } catch{return false;}
}
function requestOriginAllowed(req,origin,allowedOrigins=[]){if(!origin)return true;if(originMatchesRequest(req,origin))return true;return allowedOrigins.includes(origin);}
function jsonContentType(req) { return typeof req.headers['content-type']==='string'&&/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']); }
function readJson(req) { return new Promise((resolveBody,rejectBody)=>{const length=Number(req.headers['content-length']);if(Number.isFinite(length)&&length>JSON_LIMIT){rejectBody(new AuthError(400,'Request body is too large.'));return;}let total=0,body='',done=false;const fail=e=>{if(!done){done=true;rejectBody(e);req.destroy();}};req.setEncoding('utf8');req.on('data',chunk=>{total+=Buffer.byteLength(chunk);if(total>JSON_LIMIT)fail(new AuthError(400,'Request body is too large.'));else body+=chunk;});req.on('end',()=>{if(done)return;done=true;try{const v=JSON.parse(body||'{}');if(!v||typeof v!=='object'||Array.isArray(v))throw 0;resolveBody(v);}catch{rejectBody(new AuthError(400,'Request body must be a JSON object.'));}});req.on('error',fail);}); }
function readBinary(req,limit=UI_IMAGE_LIMIT){return new Promise((resolveBody,rejectBody)=>{const length=Number(req.headers['content-length']);if(Number.isFinite(length)&&length>limit){rejectBody(new AuthError(400,'Image is too large. Maximum 8 MB.'));return;}const chunks=[];let total=0,done=false;const fail=e=>{if(!done){done=true;rejectBody(e);req.destroy();}};req.on('data',chunk=>{total+=chunk.length;if(total>limit)fail(new AuthError(400,'Image is too large. Maximum 8 MB.'));else chunks.push(chunk);});req.on('end',()=>{if(done)return;done=true;resolveBody(Buffer.concat(chunks));});req.on('error',fail);}); }
function detectImageType(buf){if(buf.length>=8&&buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';if(buf.length>=3&&buf.subarray(0,3).equals(Buffer.from([255,216,255])))return 'jpg';if(buf.length>=12&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')return 'webp';return null;}
class RateLimiter { constructor(){this.entries=new Map();} hit(key,limit,windowMs=60000){const t=Date.now();let e=this.entries.get(key);if(!e||t-e.start>=windowMs)e={start:t,count:0};e.count++;this.entries.set(key,e);if(this.entries.size>4096)for(const [k,v] of this.entries)if(t-v.start>=windowMs)this.entries.delete(k);return e.count<=limit;} }
const sessionHash=token=>token?createHash('sha256').update(token).digest('hex'):null;

export function createGameServer({root=ROOT,allowedOrigins=process.env.ALLOWED_ORIGINS?.split(',').map(s=>s.trim()).filter(Boolean)||[],maxRooms=32,dataDir,migrateLegacy=true,queueWaitMs=15000,inviteTtlMs=60000,matchmakingIntervalMs=250,reconnectGraceMs=Number(process.env.RECONNECT_GRACE_MS)||0}={}) {
  const rooms=new Map(),clients=new Map(),accountClients=new Map(),invites=new Map(),suspended=new Map(),rates=new RateLimiter(),presenceRates=new RateLimiter();
  const region=regionConfig(process.env);
  const dataStore=new PersistentDataStore({root,dataDir,migrateLegacy});
  const auth=new AuthStore({dataDir:dataStore.dataDir,beforeReady:dataStore.ready,beforeWrite:()=>dataStore.beforeWrite()});
  const social=new SocialStore({dataDir:auth.dataDir,beforeReady:dataStore.ready,beforeWrite:()=>dataStore.beforeWrite()});
  const profiles=new ProfileStore({dataDir:auth.dataDir,beforeReady:dataStore.ready,beforeWrite:()=>dataStore.beforeWrite()});
  const uiConfigFile=join(auth.dataDir,'ui-config.json');
  const uiImageDir=join(auth.dataDir,'ui-assets');
  let uiConfig={version:2,changes:{},world:{}};
  const uiConfigReady=Promise.resolve(dataStore.ready).then(async()=>{
    try { const parsed=JSON.parse(await readFile(uiConfigFile,'utf8')); if(parsed?.version===2&&parsed.changes&&typeof parsed.changes==='object') uiConfig={version:2,changes:parsed.changes,world:parsed.world&&typeof parsed.world==='object'?parsed.world:{},background:parsed.background&&typeof parsed.background==='object'?parsed.background:{}}; }
    catch(error){ if(error?.code!=='ENOENT') console.warn('HAMU MASTER: UI config could not be loaded; using defaults.',error.message); }
  });
  async function saveUIConfig(next){
    await uiConfigReady;
    await dataStore.beforeWrite();
    await mkdir(auth.dataDir,{recursive:true,mode:0o700});
    const tmp=uiConfigFile+'.tmp-'+process.pid;
    await writeFile(tmp,JSON.stringify(next)+'\n',{mode:0o600});
    await rename(tmp,uiConfigFile);
    uiConfig=next;
  }
  const broadcastUIConfig=()=>{const payload={t:'ui_config',config:uiConfig};for(const c of clients.values())send(c,payload);};
  const send=(c,data)=>{if(c?.ws?.readyState===WebSocket.OPEN&&c.ws.bufferedAmount<262144)c.ws.send(JSON.stringify(data));};
  const sendReply=(c,requestId,ok,result,errorText)=>send(c,{t:'reply',requestId,ok,...(ok?{result:result||{}}:{error:errorText||'Request failed.'})});
  const error=(c,message)=>send(c,{t:'error',message});
  const presence=id=>{const c=accountClients.get(id);if(!c)return'offline';const p=mm.partyFor(id);if(c.room)return'in_match';if(p?.status==='queued')return'queued';if(p?.members.length>1)return'in_party';return'online';};
  const publicProfile=(id,actor)=>social.profile(id,actor,auth,presence);
  const socialState=async id=>social.state(id,auth,presence);
  const sendSocial=async id=>{const c=accountClients.get(id);if(!c)return;try{const state=await socialState(id);state.invites=[...invites.values()].filter(i=>i.to===id&&i.expiresAt>Date.now()).map(i=>({id:i.id,from:publicProfile(i.from,id),partyId:i.partyId,mode:i.mode,expiresAt:i.expiresAt})).filter(i=>i.from);if(accountClients.get(id)===c)send(c,{t:'social_state',...state});}catch{ /* persistence failures are never exposed over RPC */ }};
  const notice=(id,message)=>{const c=accountClients.get(id);if(c)send(c,{t:'social_notice',message});};
  const partyEvent=(p,event)=>{if(!p)return;const payload={t:'party_event',...event};for(const m of p.members){const c=accountClients.get(m.id);if(c)send(c,payload);}};
  const broadcastSocial=async ids=>{await Promise.allSettled([...new Set(ids)].map(id=>sendSocial(id)));};
  const socialTargets=id=>[id,...(social._friends(id)||[])];
  const presenceCache=new Map();
  const notifyPresence=ids=>{const changed=[];for(const id of new Set(ids||[])){const next=presence(id),old=presenceCache.get(id);presenceCache.set(id,next);if(old!==next)changed.push(...socialTargets(id));}if(changed.length)void broadcastSocial(changed);};
  const publishRooms=()=>{const data={t:'rooms',rooms:[...rooms.values()].filter(r=>r.clients.size>0).map(metadata)};for(const c of clients.values())if(!c.room)send(c,data);};
  const metadata=r=>({id:r.id,name:r.name,mode:r.world.mode,humans:r.clients.size,bots:[...r.world.players.values()].filter(p=>p.bot).length,capacity:MAX_PLAYERS,phase:r.world.phase,queue:!!r.queueRoom});
  const serve=staticHandler(root);
  const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');const requestOrigin=req.headers.origin;if(requestOriginAllowed(req,requestOrigin,allowedOrigins)){res.setHeader('Access-Control-Allow-Origin',requestOrigin||'');if(requestOrigin){res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-File-Name');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');}}if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Resource-Policy','same-origin');let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{json(res,400,{error:'Bad URL.'});return;}if(pathname==='/health'){json(res,200,{ok:true,version:2,region:publicRegionInfo(region,{players:[...clients.values()].filter(c=>c.room).length,rooms:rooms.size}),rooms:rooms.size,players:[...clients.values()].filter(c=>c.room).length});return;}if(pathname==='/ready'){json(res,200,{ok:true,ready:true,region:publicRegionInfo(region,{players:[...clients.values()].filter(c=>c.room).length,rooms:rooms.size})});return;}if(pathname==='/api/region'){json(res,200,{ok:true,region:publicRegionInfo(region,{players:[...clients.values()].filter(c=>c.room).length,rooms:rooms.size}),regions:region.knownRegions});return;}if(pathname.startsWith('/api/auth/')){await handleAuth(req,res,pathname);return;}if(pathname==='/api/profile'){await handleProfile(req,res);return;}if(pathname==='/api/ui-config'){await handleUIConfig(req,res);return;}
    if(pathname==='/api/ui-image' || pathname.startsWith('/api/ui-image/')){await handleUIImage(req,res,pathname);return;}let decoded;try{decoded=decodeURIComponent(pathname);}catch{json(res,400,{error:'Bad URL.'});return;}if(decoded.split('/').includes('..')){res.writeHead(404);res.end('Not found');return;}serve(req,res);});
  async function handleAuth(req,res,pathname){const ip=requestIp(req);try{await auth.ready;await profiles.ready;if(pathname==='/api/auth/me'&&req.method==='GET'){const session=await auth.sessionForToken(cookieValue(req.headers.cookie));if(!session){json(res,401,{error:'Not authenticated.'});return;}json(res,200,{user:selfUser(session.user,session.admin)});return;}if(pathname==='/api/auth/username'&&req.method==='GET'){if(!rates.hit(`${ip}:username`,60)){json(res,429,{error:'Too many username checks. Try again shortly.'});return;}const name=new URL(req.url,'http://localhost').searchParams.get('name');if(!validUsername(name)){json(res,400,{error:'Username must be 3-18 ASCII letters, numbers, or underscores.'});return;}json(res,200,{available:await auth.availability(name),username:name});return;}if((pathname==='/api/auth/registration-check'||pathname==='/api/auth/register'||pathname==='/api/auth/login'||pathname==='/api/auth/admin-login'||pathname==='/api/auth/logout'||pathname==='/api/auth/email')&&req.method==='POST'){if(!requestOriginAllowed(req,req.headers.origin,allowedOrigins)){json(res,403,{error:'This website origin is not allowed by the game backend.'});return;}if(!jsonContentType(req)){json(res,400,{error:'Content-Type must be application/json.'});return;}const bucket=pathname.endsWith('/registration-check')?'registration-check':pathname.endsWith('/register')?'register':pathname.endsWith('/admin-login')?'admin-login':pathname.endsWith('/login')?'login':pathname.endsWith('/email')?'email':'logout',max=bucket==='registration-check'?30:bucket==='logout'?60:bucket==='register'?12:bucket==='admin-login'?10:bucket==='email'?12:30;if(!rates.hit(`${ip}:${bucket}`,max)){json(res,429,{error:'Too many requests. Try again shortly.'});return;}const body=await readJson(req),secure=Boolean(req.socket.encrypted||process.env.COOKIE_SECURE==='1'),sameSite=allowedOrigins.includes(req.headers.origin)?'None':'Strict';if(bucket==='registration-check'){json(res,200,await auth.checkRegistration(body.username,body.email));return;}if(bucket==='register'){const user=await auth.register(body.username,body.email,body.password),session=await auth.login(body.username,body.password);res.setHeader('Set-Cookie',sessionCookie(session.token,secure,undefined,sameSite));json(res,201,{user:selfUser(user)});return;}if(bucket==='login'){const session=await auth.login(body.identity??body.username,body.password);for(const c of [...clients.values()])if(c.accountId===session.user.id&&c.sessionHash!==session.tokenHash)disconnect(c,4003,'Account logged in on another device');res.setHeader('Set-Cookie',sessionCookie(session.token,secure,undefined,sameSite));json(res,200,{user:selfUser(session.user)});return;}if(bucket==='admin-login'){const session=await auth.adminLogin(body.identity??body.username,body.password);for(const c of [...clients.values()])if(c.accountId===session.user.id&&c.sessionHash!==session.tokenHash)disconnect(c,4003,'Account logged in on another device');res.setHeader('Set-Cookie',sessionCookie(session.token,secure,undefined,sameSite));json(res,200,{user:selfUser(session.user,true)});return;}if(bucket==='email'){const session=await auth.sessionForToken(cookieValue(req.headers.cookie));if(!session)throw new AuthError(401,'Not authenticated.');const updated=await auth.linkEmail(session.user.id,body.email,body.password);json(res,200,{user:selfUser(updated,session.admin)});return;}const token=cookieValue(req.headers.cookie),hash=await auth.logout(token);if(hash)for(const c of clients.values())if(c.sessionHash===hash)c.ws.close(4001,'Session ended');res.setHeader('Set-Cookie',clearSessionCookie(secure,sameSite));json(res,200,{ok:true});return;}json(res,404,{error:'Not found.'});}catch(e){if(res.writableEnded)return;if(e instanceof AuthError)json(res,e.status,{error:e.message,...(e.code?{code:e.code}:{})});else{console.error('auth request failed:',e);json(res,503,{error:'Authentication service temporarily unavailable.'});}}}

  async function handleUIConfig(req,res){
    try {
      await uiConfigReady;
      if(req.method==='GET'){json(res,200,{config:uiConfig});return;}
      if(req.method!=='PUT'){json(res,405,{error:'Method not allowed.'});return;}
      const session=await auth.sessionForToken(cookieValue(req.headers.cookie));
      if(!session?.admin){json(res,403,{error:'Admin access required.'});return;}
      if(!rates.hit(`${session.user.id}:ui`,240)){json(res,429,{error:'Too many editor saves. Try again shortly.'});return;}
      if(!requestOriginAllowed(req,req.headers.origin,allowedOrigins)){json(res,403,{error:'This website origin is not allowed by the game backend.'});return;}
      if(!jsonContentType(req)){json(res,400,{error:'Content-Type must be application/json.'});return;}
      const body=await readJson(req),changes=body.changes&&typeof body.changes==='object'&&!Array.isArray(body.changes)?body.changes:{},world=body.world&&typeof body.world==='object'&&!Array.isArray(body.world)?body.world:{},background=body.background&&typeof body.background==='object'&&!Array.isArray(body.background)?body.background:{};
      const serializedWorld=JSON.stringify(world),serializedBackground=JSON.stringify(background);if(Object.keys(changes).length>8000 || serializedWorld.length>1800000 || serializedBackground.length>12000) throw new AuthError(400,'Editor configuration is too large.');
      const next={version:2,changes,world,background}; await saveUIConfig(next); broadcastUIConfig(); json(res,200,{config:next});
    } catch(e){if(e instanceof AuthError)json(res,e.status,{error:e.message});else{console.error('ui config request failed:',e);json(res,503,{error:'UI configuration service temporarily unavailable.'});}}
  }

  async function handleUIImage(req,res,pathname){
    try{
      await uiConfigReady;
      if(req.method==='POST'&&pathname==='/api/ui-image'){
        const session=await auth.sessionForToken(cookieValue(req.headers.cookie));
        if(!session?.admin){json(res,403,{error:'Admin access required.'});return;}
        if(!requestOriginAllowed(req,req.headers.origin,allowedOrigins)){json(res,403,{error:'This website origin is not allowed by the game backend.'});return;}
        if(!rates.hit(`${session.user.id}:ui-image`,60)){json(res,429,{error:'Too many image uploads. Try again shortly.'});return;}
        const type=String(req.headers['content-type']||'').toLowerCase();
        if(!['image/png','image/jpeg','image/webp'].includes(type)){json(res,400,{error:'Only PNG, JPG or WebP images are allowed.'});return;}
        const buf=await readBinary(req);const detected=detectImageType(buf);
        if(!detected || (type==='image/png'&&detected!=='png') || (type==='image/jpeg'&&detected!=='jpg') || (type==='image/webp'&&detected!=='webp')){json(res,400,{error:'Invalid or mismatched image file.'});return;}
        await mkdir(uiImageDir,{recursive:true,mode:0o700});
        const id=randomUUID(),file=join(uiImageDir,`${id}.${detected}`);await writeFile(file,buf,{mode:0o600});
        json(res,201,{url:`/api/ui-image/${id}.${detected}`,id});return;
      }
      if(req.method==='GET'&&pathname.startsWith('/api/ui-image/')){
        const name=decodeURIComponent(pathname.slice('/api/ui-image/'.length));
        if(!/^[0-9a-f-]{36}\.(?:png|jpg|webp)$/i.test(name)){res.writeHead(404);res.end('Not found');return;}
        const file=join(uiImageDir,name);if(!file.startsWith(uiImageDir))throw new Error('Not found.');
        const info=await stat(file);if(!info.isFile())throw new Error('Not found.');
        const ext=name.slice(name.lastIndexOf('.')+1).toLowerCase(),mime=ext==='png'?'image/png':ext==='jpg'?'image/jpeg':'image/webp';
        res.writeHead(200,{'Content-Type':mime,'Content-Length':info.size,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});
        if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);return;
      }
      json(res,405,{error:'Method not allowed.'});
    }catch(e){if(e instanceof AuthError)json(res,e.status,{error:e.message});else if(e?.code==='ENOENT')json(res,404,{error:'Image not found.'});else{console.error('ui image request failed:',e);json(res,503,{error:'UI image service temporarily unavailable.'});}}
  }

  async function handleProfile(req,res){
    try{
      await profiles.ready;
      const user=await auth.userForToken(cookieValue(req.headers.cookie));
      if(!user){json(res,401,{error:'Not authenticated.'});return;}
      if(req.method==='GET'){const profile=await profiles.get(user.id);json(res,200,{profile});return;}
      if(req.method==='PUT'){if(!rates.hit(`${user.id}:profile`,120)){json(res,429,{error:'Too many profile saves. Try again shortly.'});return;}if(!requestOriginAllowed(req,req.headers.origin,allowedOrigins)){json(res,403,{error:'This website origin is not allowed by the game backend.'});return;}if(!jsonContentType(req)){json(res,400,{error:'Content-Type must be application/json.'});return;}const body=await readJson(req);const profile=await profiles.save(user.id,body.profile);json(res,200,{profile});return;}
      json(res,405,{error:'Method not allowed.'});
    }catch(e){if(e instanceof AuthError)json(res,e.status,{error:e.message});else{console.error('profile request failed:',e);json(res,503,{error:'Profile service temporarily unavailable.'});}}
  }

  function cleanupInvites(){const t=Date.now(),expired=[];for(const [id,i] of invites)if(i.expiresAt<=t){invites.delete(id);expired.push(i.to);}if(expired.length)void broadcastSocial(expired);}
  function removeInvitesForUser(user){const affected=[];for(const [id,i] of invites)if(i.from===user||i.to===user){invites.delete(id);affected.push(i.from,i.to);}if(affected.length)void broadcastSocial(affected);}
  function removeInvitesForParty(partyId){const affected=[];for(const [id,i] of invites)if(i.partyId===partyId){invites.delete(id);affected.push(i.from,i.to);}if(affected.length)void broadcastSocial(affected);}
  function queueView(partyId){const t=mm.tickets.get(partyId);if(!t)return null;const all=[...mm.tickets.values()].filter(x=>x.mode===t.mode);const playersSearching=all.reduce((n,x)=>n+x.players.length,0),oldest=Math.min(...all.map(x=>x.startedAt));return{partyId,mode:t.mode,startedAt:t.startedAt,fillAt:oldest+queueWaitMs,playersSearching,partySize:t.players.length,capacity:8};}
  function publishParty(partyId){const p=mm.parties.get(partyId);if(!p)return;const state={t:'party_state',party:cloneParty(p)};for(const m of p.members){const c=accountClients.get(m.id);if(c)send(c,state);const q=queueView(p.id);if(c)send(c,{t:'queue_state',queue:q});}notifyPresence(p.members.map(m=>m.id));}
  const cloneParty=p=>p?{id:p.id,leaderId:p.leaderId,mode:p.mode,status:p.status,roomId:p.roomId??null,maxSize:p.maxSize,members:p.members.map(m=>({id:m.id,username:m.username,ready:!!m.ready,online:m.online!==false,operator:m.operator||'sentinel',loadout:Array.isArray(m.loadout)?m.loadout.slice(0,3):['ar4','relay9','edge']}))}:null;
  const mm=new Matchmaking({queueWaitMs,onState:publishParty,onMatch:startQueueMatch,onBackfill:backfillMatch});
  function ensureParty(c){const p=mm.ensureParty(c.accountId,c.user.username,true);publishParty(p.id);return p;}
  function broadcastParty(p){if(p)publishParty(p.id);}
  function addBots(room){while(room.world.players.size<MAX_PLAYERS){const n=room.world.players.size;let forced;if(room.world.teams)forced=room.teamCounts[0]<=room.teamCounts[1]?0:1;const bot=room.world.addPlayer({id:`bot-${room.id}-${n}`,name:'Bot',bot:true,forcedTeam:forced});if(bot&&room.world.teams)room.teamCounts[bot.team]++;}}
  function queuePlayer(client,member){return{accountId:member.id,clientId:client.id,name:member.username,loadout:cleanLoadout(member.loadout),operator:cleanOperator(member.operator)}}
  function startQueueMatch(match){
    cleanupInvites();
    if(rooms.size>=maxRooms){for(const p of match.players)notice(p.accountId,'Matchmaking is temporarily full. Try again shortly.');return null;}
    const seen=new Set();
    for(const item of match.players){const c=clients.get(item.clientId);if(!c||c.accountId!==item.accountId||c.room||seen.has(c.id)){for(const p of match.players)notice(p.accountId,'Matchmaking could not start this match. Please try again.');return null;}seen.add(c.id);}
    const id=`Q-${randomBytes(4).toString('hex').toUpperCase()}`,mode=match.mode,room={id,name:`${MODES[mode].short} · Match`,world:new World({mode,duration:300,roomId:id,autoRestart:false}),target:MAX_PLAYERS,clients:new Set(),lastOccupied:Date.now(),queueRoom:true,teamCounts:[0,0],matchId:match.id,flyPaused:false,flyPausedBy:null};
    const added=[];
    try {
      rooms.set(id,room);
      for(const item of match.players){const c=clients.get(item.clientId);const p=room.world.addPlayer({id:c.id,name:c.name,forcedTeam:item.team,loadout:item.loadout,operator:item.operator});if(!p)throw new Error('player unavailable');room.clients.add(c.id);if(item.team===0||item.team===1)room.teamCounts[item.team]++;c.room=id;c.lastSeq=-1;c.lastFireSeq=-1;added.push(c);}
      addBots(room);if(room.world.players.size>MAX_PLAYERS)throw new Error('room capacity');
    } catch {
      for(const c of added){room.world.removePlayer(c.id);room.clients.delete(c.id);c.room=null;}
      rooms.delete(id);for(const p of match.players)notice(p.accountId,'Matchmaking could not start this match. Please try again.');return null;
    }
    match.roomId=id;match.room=room;for(const item of match.players){const c=clients.get(item.clientId);send(c,{t:'joined',id:c.id,accountId:c.accountId,room:metadata(room),state:room.world.snapshot()});}
    publishRooms();return{roomId:id,room};
  }
  function backfillMatch(match,add){
    const room=rooms.get(match.roomId);if(!room||room.world.phase!=='playing'||room.clients.size+add.players.length>MAX_PLAYERS)return false;
    const wanted=[],seen=new Set(),reservedBots=new Set();
    for(const item of add.players){const c=clients.get(item.clientId);if(!c||c.accountId!==item.accountId||c.room||room.world.players.has(c.id)||seen.has(c.id))return false;seen.add(c.id);const bot=[...room.world.players.values()].find(p=>p.bot&&!reservedBots.has(p.id)&&(item.team===undefined||p.team===item.team));if(!bot)return false;reservedBots.add(bot.id);wanted.push({item,c,bot});}
    const added=[];
    for(const x of wanted){room.world.removePlayer(x.bot.id);if(x.bot.team===0||x.bot.team===1)room.teamCounts[x.bot.team]--;const p=room.world.addPlayer({id:x.c.id,name:x.c.name,forcedTeam:x.item.team,loadout:x.item.loadout,operator:x.item.operator});if(!p){for(const y of added){const yp=room.world.players.get(y.id);if(yp&&(yp.team===0||yp.team===1))room.teamCounts[yp.team]--;room.world.removePlayer(y.id);room.clients.delete(y.id);y.room=null;}for(const y of wanted)if(!room.world.players.has(y.bot.id)){const bp=room.world.addPlayer({id:y.bot.id,name:'Bot',bot:true,forcedTeam:y.bot.team});if(bp&&(bp.team===0||bp.team===1))room.teamCounts[bp.team]++;}return false;}room.clients.add(x.c.id);x.c.room=room.id;x.c.lastSeq=-1;x.c.lastFireSeq=-1;if(p.team===0||p.team===1)room.teamCounts[p.team]++;added.push(x.c);}
    for(const c of added){send(c,{t:'joined',id:c.id,accountId:c.accountId,room:metadata(room),state:room.world.snapshot()});notifyPresence([c.accountId]);}publishRooms();return true;
  }
  function removeFromRoom(c,notify=false){const room=rooms.get(c.room);if(!room){c.room=null;return;}if(room.flyPausedBy===c.id){room.flyPaused=false;room.flyPausedBy=null;}const departing=room.world.players.get(c.id);room.clients.delete(c.id);room.world.removePlayer(c.id);if(departing&&(departing.team===0||departing.team===1))room.teamCounts[departing.team]--;mm.leaveMatch(c.accountId);c.room=null;room.lastOccupied=Date.now();if(room.queueRoom&&room.clients.size===0){rooms.delete(room.id);mm.removeMatch(room.matchId);}else{while(room.world.players.size<Math.min(room.target,MAX_PLAYERS)){const bot=room.world.addBot();if(bot&&(bot.team===0||bot.team===1))room.teamCounts[bot.team]++;}}if(notify)send(c,{t:'left'});notifyPresence([c.accountId]);publishRooms();}
  function returnToParty(c){const room=rooms.get(c.room);if(!room?.queueRoom||room.world.phase!=='ended')throw Error('The match has not finished.');removeFromRoom(c);const p=mm.partyFor(c.accountId);if(p)publishParty(p.id);send(c,{t:'party_return',message:'Match complete. Your squad is back in the lobby. Ready up for the leader’s next search.'});}
  function directJoin(c,room,data){
    if(room.queueRoom){error(c,'This is a matchmaking room; use Find Match.');return;}
    if(room.clients.size>=MAX_PLAYERS){error(c,'This room is full. Try another room.');return;}
    if(c.room)removeFromRoom(c);
    const team=room.world.teams?room.world.chooseTeam(data.team):undefined;
    if(room.world.players.size>=MAX_PLAYERS){const bot=[...room.world.players.values()].find(p=>p.bot&&(team===undefined||p.team===team))||[...room.world.players.values()].find(p=>p.bot);if(!bot){error(c,'This room is full. Try another room.');return;}room.world.removePlayer(bot.id);if(bot.team===0||bot.team===1)room.teamCounts[bot.team]--;}
    c.name=c.user.username;c.room=room.id;c.lastSeq=-1;room.clients.add(c.id);room.lastOccupied=Date.now();const p=room.world.addPlayer({id:c.id,name:c.name,forcedTeam:team,loadout:cleanLoadout(data.loadout),operator:cleanOperator(data.operator)});if(!p){room.clients.delete(c.id);c.room=null;error(c,'Unable to join this room. Try again.');return;}if(p.team===0||p.team===1)room.teamCounts[p.team]++;while(room.world.players.size<Math.min(room.target,MAX_PLAYERS))room.world.addBot();send(c,{t:'joined',id:c.id,accountId:c.accountId,room:metadata(room),state:room.world.snapshot()});notifyPresence([c.accountId]);publishRooms();
  }
  function createRoom(c,data){const p=mm.partyFor(c.accountId);if(p?.members.length>1||p?.status==='queued'||p?.status==='matched'){error(c,'Leave your party or matchmaking search before using a custom room.');return;}if(rooms.size>=maxRooms){error(c,'Server room limit reached. Join an existing room.');return;}const id=randomBytes(3).toString('hex').toUpperCase(),mode=MODES[data.mode]?data.mode:'tdm',bots=clamp(Math.trunc(Number(data.bots)||0),0,7),duration=clamp(Number(data.duration)||300,60,900),room={id,name:cleanRoomName(data.roomName||`${c.name}'s lobby`),world:new World({mode,duration,roomId:id,autoRestart:true}),target:bots+1,clients:new Set(),lastOccupied:Date.now(),queueRoom:false,teamCounts:[0,0],flyPaused:false,flyPausedBy:null};rooms.set(id,room);directJoin(c,room,data);}
  function legacyAllowed(c){const p=mm.partyFor(c.accountId);return p?.members.length===1&&p.status==='idle';}

  function safeRpcError(e){const message=typeof e?.message==='string'?e.message:'';return message&&message.length<=180&&!/[\\/\n\r]|\b(?:EACCES|ENOENT|EPERM|ENOSPC|EISDIR|EINVAL)\b/.test(message)?message:'Request failed.';}
  async function socialRpc(c,data){const op=data.t,requestId=typeof data.requestId==='string'?data.requestId.slice(0,100):'';try{
    const readOp=op==='social.search'||op==='social.directory'||op==='social.profile'||op==='social.sync';const limit=readOp?90:45;if(!presenceRates.hit(`${c.accountId}:${readOp?'read':'write'}`,limit)){sendReply(c,requestId,false,null,'Too many social requests. Try again shortly.');return;}
    if(op==='social.search'){const result=social.search(data.query,c.accountId,auth,presence);sendReply(c,requestId,true,result);return;}
    if(op==='social.directory'){sendReply(c,requestId,true,social.directory(data.query??'',data.offset??0,data.limit??24,c.accountId,auth,presence));return;}
    if(op==='social.profile'){const profile=publicProfile(data.userId,c.accountId);if(!profile)throw Error('User not found.');sendReply(c,requestId,true,{profile});return;}
    if(op==='social.request'){const r=await social.request(c.accountId,data.userId,auth);sendReply(c,requestId,true,{ok:true});await broadcastSocial([c.accountId,r.to]);notice(r.to,`${c.user.username} sent you a friend request.`);return;}
    if(op==='social.respond'){const r=await social.respond(c.accountId,data.friendRequestId,Boolean(data.accept),auth);sendReply(c,requestId,true,{ok:true});await broadcastSocial([r.from,r.to]);notice(r.from,data.accept?`${c.user.username} accepted your friend request.`:`${c.user.username} declined your friend request.`);return;}
    if(op==='social.cancel'){const r=await social.cancel(c.accountId,data.friendRequestId,auth);sendReply(c,requestId,true,{ok:true});await broadcastSocial([c.accountId,r.to||data.userId]);return;}
    if(op==='social.remove'){const r=await social.remove(c.accountId,data.userId,auth);removeInvitesForUser(data.userId);sendReply(c,requestId,true,{ok:true});await broadcastSocial([c.accountId,data.userId]);return;}
    if(op==='social.sync'){sendReply(c,requestId,true,{ok:true});await sendSocial(c.accountId);return;}
    if(op==='party.invite'){
      const p=mm.partyFor(c.accountId);if(!p||p.leaderId!==c.accountId)throw Error('Only the party leader can invite.');
      if(p.members.length>=p.maxSize)throw Error('Your party is full.');
      if(p.status!=='idle'||c.room||p.members.some(m=>accountClients.get(m.id)?.room))throw Error('Party is not available.');
      if(typeof data.userId!=='string'||!data.userId)throw Error('Choose a player to invite.');
      const target=accountClients.get(data.userId);if(!target)throw Error('That player is offline.');
      const tp=mm.partyFor(data.userId);if(!tp||tp.members.length!==1||tp.status!=='idle'||target.room)throw Error('That friend is busy.');cleanupInvites();
      if([...invites.values()].some(i=>i.from===c.accountId&&i.to===data.userId))throw Error('Invitation already pending.');
      const count=[...invites.values()].filter(i=>i.from===c.accountId).length;if(count>=20)throw Error('Invitation limit reached.');const invite={id:randomUUID(),from:c.accountId,to:data.userId,partyId:p.id,mode:p.mode,expiresAt:Date.now()+inviteTtlMs};invites.set(invite.id,invite);sendReply(c,requestId,true,{ok:true});await sendSocial(data.userId);notice(data.userId,`${c.user.username} invited you to a ${p.mode.toUpperCase()} party.`);return;
    }
    if(op==='party.inviteRespond'){
      cleanupInvites();const i=invites.get(data.inviteId);if(!i||i.to!==c.accountId)throw Error('Invitation expired or not found.');invites.delete(i.id);
      if(!data.accept){sendReply(c,requestId,true,{ok:true});await sendSocial(c.accountId);return;}
      const target=mm.partyFor(c.accountId),host=mm.parties.get(i.partyId),hostClient=accountClients.get(i.from);
      if(!hostClient||hostClient.room||!target||target.members.length!==1||target.status!=='idle'||target.members[0].id!==c.accountId||c.room||!host||host.leaderId!==i.from||host.status!=='idle'||host.members.length>=host.maxSize||host.members.some(m=>accountClients.get(m.id)?.room))throw Error('You are busy or the party is no longer available.');
      mm.removeMember(c.accountId);
      const inviteKit={loadout:cleanLoadout(data.loadout),operator:cleanOperator(data.operator)};
      if(!mm.addMember(host.id,c.accountId,c.user.username,true,inviteKit))throw Error('The party is no longer available.');
      // Accepting a party invite also establishes a mutual friendship. This makes
      // the Quick Play invite flow work even when the two players were not friends yet.
      await social.ensureFriend(i.from,c.accountId,auth);
      sendReply(c,requestId,true,{ok:true});broadcastParty(host);await broadcastSocial([c.accountId,i.from]);notice(i.from,`${c.user.username} joined your party.`);return;
    }
    if(op==='party.return'){returnToParty(c);sendReply(c,requestId,true,{ok:true});return;}
    if(op==='party.ready'){const p=mm.partyFor(c.accountId);if(!p)throw Error('Party not found.');const m=p.members.find(x=>x.id===c.accountId);if(!m)throw Error('Party member not found.');if(m.id===p.leaderId&&data.ready===false)throw Error('The party leader is always ready.');if(m){m.loadout=cleanLoadout(data.loadout);m.operator=cleanOperator(data.operator);}if(!data.ready&&m.id!==p.leaderId){if(p.status==='queued'){if(!mm.cancelForMember(c.accountId))throw Error('Only a guest can cancel their readiness while searching.');}else if(!mm.setReady(c.accountId,false))throw Error('Party is not idle.');if(data.explicitCancel===true)partyEvent(p,{event:'cancelled',playerId:m.id,username:m.username,eventId:randomUUID(),expiresAt:Date.now()+2000});sendReply(c,requestId,true,{ok:true});return;}if(!mm.setReady(c.accountId,true))throw Error('Party is not idle.');sendReply(c,requestId,true,{ok:true});return;}
    if(op==='party.mode'){const p=mm.partyFor(c.accountId);if(!mm.setMode(c.accountId,data.mode))throw Error('Only the idle leader may change mode.');removeInvitesForParty(p.id);sendReply(c,requestId,true,{ok:true});return;}
    if(op==='party.leave'){const p=mm.partyFor(c.accountId);if(!p)throw Error('Party not found.');const remaining=p.members.filter(m=>m.id!==c.accountId).map(m=>m.id);if(p.leaderId===c.accountId)removeInvitesForParty(p.id);if(p.status==='queued')mm.cancel(p.id);if(c.room)removeFromRoom(c,true);mm.leaveMatch(c.accountId);mm.removeMember(c.accountId);const solo=mm.ensureParty(c.accountId,c.user.username,true);sendReply(c,requestId,true,{ok:true});broadcastParty(solo);notifyPresence([c.accountId]);for(const id of remaining)notice(id,`${c.user.username} left the party.`);return;}
    if(op==='party.kick'){const p=mm.partyFor(c.accountId);if(!p||p.leaderId!==c.accountId||p.status!=='idle'||data.userId===c.accountId)throw Error('Only the idle leader can kick members.');const target=mm.partyFor(data.userId);if(!target||target.id!==p.id)throw Error('Member not found.');removeInvitesForParty(p.id);mm.removeMember(data.userId);const tc=accountClients.get(data.userId);if(tc){const solo=mm.ensureParty(data.userId,tc.user.username,true);broadcastParty(solo);notice(data.userId,`${c.user.username} removed you from the party.`);}sendReply(c,requestId,true);return;}
    if(op==='queue.join'){const p=mm.partyFor(c.accountId);if(!p||p.leaderId!==c.accountId)throw Error('Only the party leader can start matchmaking.');if(c.room||p.status!=='idle')throw Error('Leave your current room first.');const mode=data.mode||p.mode;if(mode!==p.mode)throw Error('Selected mode does not match party mode.');for(const m of p.members){const mc=accountClients.get(m.id);if(!mc||mc.room)throw Error('All party members must be connected and out of a room.');if(m.id===c.accountId){m.loadout=cleanLoadout(data.loadout);m.operator=cleanOperator(data.operator);}}const players=p.members.map(m=>queuePlayer(accountClients.get(m.id),m));try{mm.queue(p.id,mode,players);}catch(error){publishParty(p.id);throw error;}sendReply(c,requestId,true,{ok:true});return;}
    if(op==='queue.cancel'){const p=mm.partyFor(c.accountId);if(!p||!mm.cancel(p.id))throw Error('Party is not searching.');sendReply(c,requestId,true,{ok:true});return;}
    throw Error('Unknown operation.');
  }catch(e){sendReply(c,requestId,false,null,safeRpcError(e));}}

  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});let timer=null,heartbeat=null,queueTimer=null;
  server.on('upgrade',async(req,socket,head)=>{let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{socket.destroy();return;}if(path!=='/ws'){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}let user;try{const stored=await auth.userForToken(cookieValue(req.headers.cookie));user=stored?publicUser(stored):null;}catch{socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}const origin=req.headers.origin,originOk=requestOriginAllowed(req,origin,allowedOrigins),ip=req.socket.remoteAddress;if(!user||clients.size>=region.maxClients||[...clients.values()].filter(c=>c.ip===ip).length>=16||!originOk){socket.end(`HTTP/1.1 ${user?403:401} ${user?'Forbidden':'Unauthorized'}\r\nConnection: close\r\n\r\n`);return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,user));});
  function disconnect(c,closeCode,closeReason='Replaced by a newer connection'){if(clients.get(c.id)!==c)return;suspended.delete(c.accountId);removeInvitesForUser(c.accountId);removeFromRoom(c);const p=mm.partyFor(c.accountId);if(p){const remaining=p.members.filter(m=>m.id!==c.accountId).map(m=>m.id);if(p.leaderId===c.accountId)removeInvitesForParty(p.id);mm.setOnline(c.accountId,false);if(p.status==='queued')mm.cancel(p.id);mm.removeMember(c.accountId);if(mm.parties.has(p.id))broadcastParty(p);for(const id of remaining)notice(id,`${c.user.username} left the party.`);}clients.delete(c.id);if(accountClients.get(c.accountId)===c)accountClients.delete(c.accountId);presenceCache.delete(c.accountId);notifyPresence([c.accountId]);if(closeCode&&c.ws?.readyState===WebSocket.OPEN){c.finalClose=true;c.ws.close(closeCode,closeReason);}}
  function detachForReconnect(c){if(reconnectGraceMs<=0){disconnect(c);return;}if(clients.get(c.id)!==c||c.finalClose)return;const p=mm.partyFor(c.accountId);if(p&&p.status==='queued')mm.cancel(p.id);if(accountClients.get(c.accountId)===c)accountClients.delete(c.accountId);c.ws=null;c.disconnectedAt=Date.now();c.alive=true;suspended.set(c.accountId,c);mm.setOnline(c.accountId,false);presenceCache.delete(c.accountId);notifyPresence([c.accountId]);setTimeout(()=>{if(suspended.get(c.accountId)===c)disconnect(c);},reconnectGraceMs);}
  wss.on('connection',(ws,req,user)=>{const old=accountClients.get(user.id);if(old)disconnect(old,4002);const resumed=suspended.get(user.id);let c;if(resumed&&Date.now()-resumed.disconnectedAt<=reconnectGraceMs){suspended.delete(user.id);c=resumed;c.ws=ws;c.ip=req.socket.remoteAddress;c.sessionHash=sessionHash(cookieValue(req.headers.cookie));c.disconnectedAt=null;c.finalClose=false;c.alive=true;clients.set(c.id,c);accountClients.set(c.accountId,c);mm.setOnline(c.accountId,true);const p=ensureParty(c);send(c,{t:'hello',id:c.id,accountId:c.accountId,version:2,resumed:true,region:publicRegionInfo(region,{players:[...clients.values()].filter(x=>x.room).length,rooms:rooms.size}),uiConfig,rooms:[...rooms.values()].filter(r=>r.clients.size>0).map(metadata)});if(c.room&&rooms.has(c.room)){const room=rooms.get(c.room);send(c,{t:'joined',id:c.id,room:metadata(room),state:room.world.snapshot(),resumed:true});}sendSocial(c.accountId);publishParty(p.id);notifyPresence([c.accountId]);}else{const c0={id:randomBytes(6).toString('hex'),accountId:user.id,user,name:user.username,ws,room:null,ip:req.socket.remoteAddress,sessionHash:sessionHash(cookieValue(req.headers.cookie)),lastSeq:-1,lastFireSeq:-1,budget:100,lastBudget:performance.now(),bad:0,alive:true,disconnectedAt:null,finalClose:false};c=c0;clients.set(c.id,c);accountClients.set(c.accountId,c);const p=ensureParty(c);send(c,{t:'hello',id:c.id,accountId:c.accountId,version:2,region:publicRegionInfo(region,{players:[...clients.values()].filter(x=>x.room).length,rooms:rooms.size}),uiConfig,rooms:[...rooms.values()].filter(r=>r.clients.size>0).map(metadata)});sendSocial(c.accountId);publishParty(p.id);notifyPresence([c.accountId]);}
    ws.on('pong',()=>c.alive=true);ws.on('error',()=>{});ws.on('message',(raw,isBinary)=>{if(clients.get(c.id)!==c||accountClients.get(c.accountId)!==c)return;if(!auth.sessionValid(c.sessionHash)){ws.close(4001,'Session expired');return;}const now=performance.now();c.budget=Math.min(100,c.budget+(now-c.lastBudget)*.07);c.lastBudget=now;if(isBinary||--c.budget<0){ws.close(1008,'Rate limit');return;}let data;try{data=JSON.parse(raw.toString());}catch{if(++c.bad>=3)ws.close(1008,'Invalid JSON');else error(c,'Invalid JSON');return;}if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.t!=='string'){if(++c.bad>=8)ws.close(1008,'Invalid message');return;}
      if(data.t.startsWith('social.')||data.t.startsWith('party.')||data.t.startsWith('queue.')){socialRpc(c,data);return;}
      switch(data.t){case'ping':if(Number.isFinite(data.at))send(c,{t:'pong',at:data.at});break;case'fly-pause':{const room=rooms.get(c.room);if(!c.user?.isAdmin||!room){error(c,'Admin FLY pause unavailable.');break;}const enabled=!!data.enabled;if(enabled){room.flyPaused=true;room.flyPausedBy=c.id;}else if(room.flyPausedBy===c.id){room.flyPaused=false;room.flyPausedBy=null;}send(c,{t:'fly-pause',enabled:room.flyPaused});break;}case'list':c.budget-=2;send(c,{t:'rooms',rooms:[...rooms.values()].filter(r=>r.clients.size>0).map(metadata)});break;case'create':c.budget-=12;if(legacyAllowed(c))createRoom(c,data);else error(c,'Custom rooms are for solo operators only.');break;case'quick':c.budget-=8;error(c,'Quick play uses Find Match. Set your party ready and use queue.join.');break;case'join':c.budget-=6;{const room=typeof data.room==='string'?rooms.get(data.room.toUpperCase()):null;if(!room)error(c,'Room not found. Refresh the room browser.');else if(!legacyAllowed(c))error(c,'Custom rooms are for solo operators only.');else directJoin(c,room,data);}break;case'leave':{const wasQueue=rooms.get(c.room)?.queueRoom;removeFromRoom(c,true);if(wasQueue){mm.removeMember(c.accountId);const solo=mm.ensureParty(c.accountId,c.user.username,true);broadcastParty(solo);}break;}case'i':{const room=rooms.get(c.room);if(!room)break;const input=validateInput(data.d,c.lastSeq);if(!input){if(++c.bad>=8)ws.close(1008,'Invalid input');break;}c.lastSeq=input.seq;room.world.setInput(c.id,input);break;}case'f':{const room=rooms.get(c.room),p=room?.world.players.get(c.id);if(!room||!p||!p.alive||room.world.phase!=='playing')break;const d=data.d;if(!Array.isArray(d)||(d.length!==3&&d.length!==4)||!d.slice(0,3).every(Number.isFinite)||Math.abs(d[0])>10000||Math.abs(d[1])>1.5||!Number.isInteger(d[2])||d[2]<0||d[2]>2||(d.length===4&&(!Number.isSafeInteger(d[3])||d[3]<=c.lastFireSeq))){if(++c.bad>=8)ws.close(1008,'Invalid fire intent');break;}if(d.length===4)c.lastFireSeq=d[3];p.yaw=((d[0]+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;p.pitch=Math.max(-1.48,Math.min(1.48,d[1]));p.slot=d[2];room.world.fire(p);break;}default:if(++c.bad>=8)ws.close(1008,'Unknown message');}
    });ws.on('close',()=>{if(c.finalClose)disconnect(c);else detachForReconnect(c);});});
  let snapshotAccumulator=0;
  function tick(){for(const room of rooms.values())if(room.clients.size){if(!room.flyPaused)room.world.step(1/TICK_RATE);if(room.queueRoom&&room.world.phase==='ended'&&room.world.time-room.world.endedAt>=12){for(const id of [...room.clients]){const c=clients.get(id);if(c)returnToParty(c);}}}snapshotAccumulator++;if(snapshotAccumulator>=TICK_RATE/SNAPSHOT_RATE){snapshotAccumulator=0;for(const room of rooms.values())if(room.clients.size){const state=room.world.snapshot();state.events=room.world.drainEvents().slice(-192);const encoded=JSON.stringify(state);for(const id of room.clients){const c=clients.get(id);if(!c||c.ws.readyState!==WebSocket.OPEN)continue;if(c.ws.bufferedAmount>1048576){c.ws.close(1013,'Slow connection');continue;}if(c.ws.bufferedAmount<131072)c.ws.send(encoded);}}}}
  async function start({port=Number(process.env.PORT)||3000,host=process.env.HOST||'0.0.0.0'}={}){
    try {
      await Promise.all([auth.ready,social.ready,profiles.ready,uiConfigReady]);
      await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,host,resolveListen);});
    } catch (error) {
      // A bind/startup failure must not strand the already-open private-store lock.
      await dataStore.close();
      throw error;
    }
    let previous=performance.now(),acc=0;timer=setInterval(()=>{const current=performance.now();acc+=Math.min(.15,(current-previous)/1000);previous=current;let steps=0;while(acc>=1/TICK_RATE&&steps++<8){tick();acc-=1/TICK_RATE;}if(steps>=8)acc=0;},1000/TICK_RATE/2);queueTimer=setInterval(()=>{cleanupInvites();mm.tick();for(const p of mm.parties.values())if(p.status==='queued')publishParty(p.id);},Math.max(20,matchmakingIntervalMs));heartbeat=setInterval(async()=>{await auth.purgeExpired().catch(()=>{});for(const c of clients.values()){if(!c.ws)continue;if(!auth.sessionValid(c.sessionHash)){c.finalClose=true;c.ws.close(4001,'Session expired');continue;}if(!c.alive){c.finalClose=true;c.ws.terminate();continue;}c.alive=false;c.ws.ping();}for(const [id,r] of rooms)if(!r.clients.size&&Date.now()-r.lastOccupied>30000){rooms.delete(id);if(r.matchId)mm.removeMatch(r.matchId);}},15000);return server.address();
  }
  let closePromise;
  async function close(){
    if (!closePromise) closePromise = (async()=>{
      clearInterval(timer);clearInterval(heartbeat);clearInterval(queueTimer);
      for(const c of clients.values()){c.finalClose=true;c.ws?.terminate();}
      // Let already admitted, serialized account/social/profile writes settle before releasing their lock.
      await Promise.allSettled([auth.writeChain,social.writeChain,profiles.writeChain]);
      await new Promise(resolveClose=>wss.close(()=>resolveClose()));
      if(server.listening)await new Promise(resolveClose=>server.close(()=>resolveClose()));
      await dataStore.close();
    })();
    return closePromise;
  }
  return{start,close,server,wss,rooms,clients,auth,social,profiles,dataStore,matchmaking:mm,region,tick};
}
// npm start opts in with --open-browser; start.bat uses HM_OPEN_BROWSER=1.
// Only open a browser after startup succeeds; importing the server in tests does not open one.
export function shouldOpenBrowser({platform=process.platform,args=process.argv,env=process.env}={}) {
  return platform==='win32' && env.HM_OPEN_BROWSER!=='0' && (env.HM_OPEN_BROWSER==='1'||args.includes('--open-browser'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const app=createGameServer();
  app.start().then(a=>{
    const url=`http://localhost:${a.port}`;
    console.log(`\nHAMU MASTER\nClient: ${url}\nWebSocket: ws://localhost:${a.port}/ws\nKeep this server window open. Press Ctrl+C to stop safely.\n`);
    // The launcher opens the browser only AFTER this process acquired the store and port.
    // No existing Node process is killed and a failed startup never opens an old server tab.
    if(shouldOpenBrowser()){
      const cmd=join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe');
      execFile(cmd,['/d','/c','start','',url],{windowsHide:true,timeout:5000},error=>{
        if(error)console.warn(`Could not open the browser automatically. Open ${url} manually.`);
      });
    }
  }).catch(e=>{console.error(e);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
