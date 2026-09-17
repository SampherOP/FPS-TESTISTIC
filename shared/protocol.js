// Compact input packets; the server accepts intentions, never positions or damage.
export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 20;
export const INPUT_RATE = 30;
export const MAX_PLAYERS = 8;
export const B = Object.freeze({SPRINT:1,TACTICAL:2,CROUCH:4,PRONE:8,JUMP:16,FIRE:32,ADS:64,RELOAD:128,MELEE:256,GRENADE:512,SLIDE:1024});
export const FLAG_MASK = Object.values(B).reduce((a,b)=>a|b,0);
export const EMPTY_INPUT = Object.freeze({seq:0,ax:0,az:0,yaw:0,pitch:0,flags:0,slot:0});
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const wrapAngle = a => ((a+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
export function validateInput(d,lastSeq=-1) {
  if (!Array.isArray(d) || d.length !== 8 || !d.every(Number.isFinite)) return null;
  const [seq,ax,az,yaw,pitch,flags,slot,version] = d;
  if (version !== 1 || !Number.isSafeInteger(seq) || seq <= lastSeq || seq < 0 || seq > 2147483646 || !Number.isInteger(flags) || flags < 0 || (flags & ~FLAG_MASK) !== 0 || !Number.isInteger(slot) || slot<0 || slot>2) return null;
  if (Math.abs(ax)>1 || Math.abs(az)>1 || Math.abs(yaw)>10000 || Math.abs(pitch)>1.5) return null;
  return {seq,ax,az,yaw:wrapAngle(yaw),pitch:clamp(pitch,-1.48,1.48),flags,slot};
}
export function packInput(i) {
  return [i.seq,Math.round(i.ax*1000)/1000,Math.round(i.az*1000)/1000,Math.round(wrapAngle(i.yaw)*10000)/10000,Math.round(i.pitch*10000)/10000,i.flags,i.slot,1];
}
export function cleanName(value,fallback='Operator') {
  return typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f<>"&]/g,'').trim().slice(0,18)||fallback : fallback;
}
export function cleanRoomName(value) { return cleanName(value,'Foundry lobby').slice(0,18); }
// Snapshot player array schema. Kept shared to prevent client/server drift.
export const P = Object.freeze({ID:0,NAME:1,TEAM:2,X:3,Y:4,Z:5,YAW:6,PITCH:7,HP:8,ARMOR:9,ALIVE:10,SLOT:11,LOADOUT:12,AMMO:13,RESERVE:14,RELOAD:15,KILLS:16,DEATHS:17,SCORE:18,HEIGHT:19,VX:20,VY:21,VZ:22,GROUND:23,SLIDE:24,STAMINA:25,RESPAWN:26,PROTECT:27,BOT:28,OPERATOR:29,SEQ:30,FIRED:31,GRENADES:32,RELOAD_TOTAL:33,PREV:34,ADS:35,EXHAUSTED:36});
export function unpackPlayer(a) {
  return {id:a[0],name:a[1],team:a[2],x:a[3],y:a[4],z:a[5],yaw:a[6],pitch:a[7],hp:a[8],armor:a[9],alive:!!a[10],slot:a[11],loadout:a[12],ammo:a[13],reserve:a[14],reloadLeft:a[15],kills:a[16],deaths:a[17],score:a[18],height:a[19],vx:a[20],vy:a[21],vz:a[22],grounded:!!a[23],slide:a[24],stamina:a[25],respawnAt:a[26],protectUntil:a[27],bot:!!a[28],operator:a[29],lastSeq:a[30],firedAt:a[31],grenades:a[32],reloadTotal:a[33],prevFlags:a[34],ads:!!a[35],exhausted:!!a[36]};
}
