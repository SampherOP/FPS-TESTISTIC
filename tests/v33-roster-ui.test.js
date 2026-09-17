import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WEAPON_LIST, WEAPONS, PRIMARY_IDS, SECONDARY_IDS, DEFAULT_LOADOUT, cleanLoadout } from '../shared/weapons.js';
import { weaponSVG } from '../client/icons.js';

const ids=['ar4','hxr8','mag83','volt9','pincer','breach12','lancer7','snipeRil','relay9','flick45','edge'];
const expectedModels=['assault.glb','bullp.glb','mag-83.glb','mp5.glb','submachine.glb','shotgun.glb','sniper.glb','snipe-ril.glb','pistol.glb','rigg-glock.glb','knife.glb'];
const expectedNames=['ASSAULT','BULLPUP','MAG-83','MP5','SUBMACHINE','SHOTGUN','SNIPER','SNIPE-RIL','PISTOL','GLOCK 19','KNIFE'];
const expectedCategories=['Assault rifle','Assault rifle','Assault rifle','SMG','SMG','Shotgun','Sniper rifle','Sniper rifle','Pistol','Pistol','Melee'];
const expectedSlots=['primary','primary','primary','primary','primary','primary','primary','primary','secondary','secondary','melee'];

 test('v33 catalog contains eleven independent supplied weapons with stable compatibility IDs',()=>{
  assert.deepEqual(WEAPON_LIST.map(w=>w.id),ids);
  assert.deepEqual(WEAPON_LIST.map(w=>w.model),expectedModels);
  assert.deepEqual(WEAPON_LIST.map(w=>w.name),expectedNames);
  assert.deepEqual(WEAPON_LIST.map(w=>w.category),expectedCategories);
  assert.deepEqual(WEAPON_LIST.map(w=>w.slot),expectedSlots);
  assert.equal(new Set(WEAPON_LIST.map(w=>w.model)).size,11);
  assert.equal(new Set(WEAPON_LIST.map(w=>w.name)).size,11);
  assert.deepEqual(PRIMARY_IDS,['ar4','hxr8','mag83','volt9','pincer','breach12','lancer7','snipeRil']);
  assert.deepEqual(SECONDARY_IDS,['relay9','flick45']);
  assert.equal(WEAPONS.edge.category,'Melee');
  assert.deepEqual(cleanLoadout(['mag83','flick45','edge']),['mag83','flick45','edge']);
  assert.deepEqual(DEFAULT_LOADOUT,['ar4','relay9','edge']);
  for(const weapon of WEAPON_LIST){
   assert.match(weapon.preview,new RegExp(`assets/weapon-previews/${weapon.id}\\.png$`));
   assert.ok(Number.isFinite(weapon.adsFov));
   assert.ok(Number.isFinite(weapon.scopeZoom));
  }
 });

test('weapon selector previews use generated asset paths and no inline gun silhouettes',()=>{
 for(const id of ids){
  const markup=weaponSVG(id);
  assert.match(markup,new RegExp(`assets/weapon-previews/${id}\\.png`));
  assert.match(markup,new RegExp(`data-weapon-preview="${id}"`));
  assert.doesNotMatch(markup,/<svg|<path/);
  assert.match(markup,/preview pending/);
 }
});

test('UI weapon gallery is catalog-driven and advertises the complete roster',async()=>{
 const ui=await readFile(new URL('../client/ui.js',import.meta.url),'utf8');
 assert.match(ui,/WEAPON_LIST\.length/);
 assert.match(ui,/new Set\(WEAPON_LIST\.map\(item=>item\.category\)\)/);
 assert.match(ui,/weaponSVG\(item\.id\)/);
 assert.match(ui,/data-action="inspect-weapon" data-id="\$\{item\.id\}"/);
 assert.doesNotMatch(ui,/ASTER-4|HXR-8|VOLT-9|PINCER|BREACH-12|LANCER-7|RELAY-9|FLICK \.45/);
});
