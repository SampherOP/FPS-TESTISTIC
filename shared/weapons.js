// Canonical weapon catalog. IDs are intentionally stable compatibility keys: saved
// loadouts and network packets keep the original IDs while public labels and
// supplied model references use the current arsenal names.
// All distances are metres; times are seconds.
const preview = id => `assets/weapon-previews/${id}.png`;
const weapon = (value) => ({...value, preview: preview(value.id)});

export const WEAPON_LIST = [
  weapon({ id:'ar4', name:'ASSAULT', model:'assault.glb', category:'Assault rifle', slot:'primary', short:'AR', damage:29, interval:0.105, recoil:0.018, spread:0.018, adsSpread:0.0025, adsFov:68, scopeZoom:1.08, magazine:30, reserve:120, reload:1.85, move:1, range:62, falloff:0.58, head:1.6, pellets:1, automatic:true, color:'#f4c85a', description:'A balanced assault rifle. Precise bursts, quick handling, no wasted motion.' }),
  weapon({ id:'hxr8', name:'BULLPUP', model:'bullp.glb', category:'Assault rifle', slot:'primary', short:'AR', damage:38, interval:0.15, recoil:0.029, spread:0.024, adsSpread:0.0035, adsFov:66, scopeZoom:1.12, magazine:24, reserve:96, reload:2.2, move:0.94, range:70, falloff:0.65, head:1.65, pellets:1, automatic:true, color:'#c89167', description:'A heavy bullpup receiver. Trade rate of fire for deliberate stopping power.' }),
  weapon({ id:'mag83', name:'MAG-83', model:'mag-83.glb', category:'Assault rifle', slot:'primary', short:'AR', damage:33, interval:0.12, recoil:0.022, spread:0.02, adsSpread:0.003, adsFov:67, scopeZoom:1.1, magazine:30, reserve:120, reload:2.0, move:0.98, range:65, falloff:0.6, head:1.6, pellets:1, automatic:true, color:'#d9a45d', description:'A versatile assault rifle with a steady sight picture and dependable sustained fire.' }),
  weapon({ id:'volt9', name:'MP5', model:'mp5.glb', category:'SMG', slot:'primary', short:'SMG', damage:21, interval:0.067, recoil:0.013, spread:0.026, adsSpread:0.005, adsFov:70, scopeZoom:1.05, magazine:36, reserve:144, reload:1.55, move:1.08, range:36, falloff:0.4, head:1.5, pellets:1, automatic:true, color:'#72d7d6', description:'High cyclic rate and featherweight mobility. Own the inside lane.' }),
  weapon({ id:'pincer', name:'SUBMACHINE', model:'submachine.glb', category:'SMG', slot:'primary', short:'SMG', damage:26, interval:0.085, recoil:0.017, spread:0.023, adsSpread:0.0045, adsFov:70, scopeZoom:1.05, magazine:28, reserve:140, reload:1.4, move:1.12, range:32, falloff:0.43, head:1.5, pellets:1, automatic:true, color:'#a4c597', description:'Compact and aggressive. The fastest primary, built for close flanks.' }),
  weapon({ id:'breach12', name:'SHOTGUN', model:'shotgun.glb', category:'Shotgun', slot:'primary', short:'SG', damage:19, interval:0.68, recoil:0.075, spread:0.075, adsSpread:0.046, adsFov:72, scopeZoom:1.0, magazine:7, reserve:35, reload:2.65, move:0.96, range:23, falloff:0.27, head:1.2, pellets:8, automatic:false, color:'#e8a272', description:'Eight pellets per shot. Devastating up close, forgiving nowhere else.' }),
  weapon({ id:'lancer7', name:'SNIPER', model:'sniper.glb', category:'Sniper rifle', slot:'primary', short:'SR', damage:108, interval:1.15, recoil:0.064, spread:0.1, adsSpread:0.0008, adsFov:28, scopeZoom:3.4, magazine:5, reserve:25, reload:2.8, move:0.85, range:130, falloff:0.8, head:2, pellets:1, automatic:false, color:'#bfc8d1', description:'Precision bolt-action. Settle the scope, pick your lane, make one shot count.' }),
  weapon({ id:'snipeRil', name:'SNIPE-RIL', model:'snipe-ril.glb', category:'Sniper rifle', slot:'primary', short:'SR', damage:92, interval:0.95, recoil:0.052, spread:0.09, adsSpread:0.001, adsFov:32, scopeZoom:3.0, magazine:6, reserve:30, reload:2.55, move:0.9, range:120, falloff:0.75, head:1.9, pellets:1, automatic:false, color:'#9fbed1', description:'A fast precision rifle for disciplined marksmen who keep moving between shots.' }),
  weapon({ id:'relay9', name:'PISTOL', model:'pistol.glb', category:'Pistol', slot:'secondary', short:'HG', damage:30, interval:0.185, recoil:0.027, spread:0.027, adsSpread:0.008, adsFov:70, scopeZoom:1.05, magazine:15, reserve:75, reload:1.2, move:1.14, range:36, falloff:0.5, head:1.7, pellets:1, automatic:false, color:'#89b1ce', description:'Reliable backup with a generous magazine. Tap quickly; stay accurate.' }),
  weapon({ id:'flick45', name:'GLOCK 19', model:'rigg-glock.glb', category:'Pistol', slot:'secondary', short:'HG', damage:47, interval:0.29, recoil:0.044, spread:0.031, adsSpread:0.007, adsFov:69, scopeZoom:1.05, magazine:9, reserve:54, reload:1.35, move:1.1, range:42, falloff:0.62, head:1.75, pellets:1, automatic:false, color:'#d0b6a3', description:'A deliberate heavy sidearm. Fewer rounds, a much louder argument.' }),
  weapon({ id:'edge', name:'KNIFE', model:'knife.glb', category:'Melee', slot:'melee', short:'MELEE', damage:82, interval:0.52, recoil:0, spread:0, adsSpread:0, adsFov:75, scopeZoom:1, magazine:0, reserve:0, reload:0, move:1.2, range:2.5, falloff:1, head:1, pellets:1, automatic:true, color:'#dce8df', description:'No ammunition. Maximum mobility. Two quick strikes finish a fully armored target.' })
];
export const WEAPONS = Object.fromEntries(WEAPON_LIST.map(w => [w.id, Object.freeze(w)]));
export const PRIMARY_IDS = WEAPON_LIST.filter(w => !['Pistol','Melee'].includes(w.category)).map(w => w.id);
export const SECONDARY_IDS = WEAPON_LIST.filter(w => w.category === 'Pistol').map(w => w.id);
export const DEFAULT_LOADOUT = Object.freeze(['ar4','relay9','edge']);
export function cleanLoadout(value) {
  return [PRIMARY_IDS.includes(value?.[0]) ? value[0] : 'ar4', SECONDARY_IDS.includes(value?.[1]) ? value[1] : 'relay9', 'edge'];
}
export const OPERATORS = [
  {id:'sentinel',name:'SWAT',role:'QUATERNIUS / ASSAULT',color:'#d5a955',tag:'01',description:'Imported SWAT character by Quaternius. Original embedded clips drive the ready, walk and run states.'},
  {id:'kestrel',name:'FIELD SOLDIER',role:'UMAIR YAQUB / SKELETAL RIG',color:'#65b8b4',tag:'02',description:'Imported Soldier by Umair Yaqub. Original geometry and materials use a generated weighted skeleton with blended gameplay posing.'},
  {id:'circuit',name:'TACTICAL SOLDIER',role:'MADTROLLSTUDIO / SKELETAL RIG',color:'#a47db8',tag:'03',description:'Imported Soldier by madtrollstudio. Original geometry and materials use a generated weighted skeleton with blended gameplay posing.'},
  {id:'frontline',name:'PLAYER SOLDIER',role:'FRONTLINE / ANIMATED RIG',color:'#58a9df',tag:'04',description:'Frontline soldier with a gameplay-ready skeleton and a complete animation set mapped to HAMU MASTER movement and weapon states.'},
  {id:'juggernaut',name:'PLAYER HEAVY',role:'HEAVY / ANIMATED RIG',color:'#c87945',tag:'05',description:'Heavy combat character with preserved materials, normalized scale, weapon hand IK and the full matched gameplay animation set.'}
];
export function cleanOperator(value) { if(value==='commando')value='frontline';return OPERATORS.some(o => o.id === value) ? value : 'sentinel'; }
export const MODES = Object.freeze({
  tdm:{id:'tdm',name:'Team Deathmatch',short:'TDM',description:'Two teams. Every elimination counts.',objective:'ELIMINATE ENEMY OPERATORS',limit:40,teams:true},
  ffa:{id:'ffa',name:'Free For All',short:'FFA',description:'No allies. Reach the top of the board.',objective:'EVERY OPERATOR FOR THEMSELVES',limit:25,teams:false},
  dom:{id:'dom',name:'Domination',short:'DOM',description:'Capture three zones. Hold the advantage.',objective:'CAPTURE AND HOLD A · B · C',limit:150,teams:true}
});
