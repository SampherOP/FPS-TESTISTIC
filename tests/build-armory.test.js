import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {UI} from '../client/ui.js';
import {WEAPON_LIST} from '../shared/weapons.js';

test('armory renders the actual catalog count and exactly one selector for each retained ID',()=>{
 const ui=Object.create(UI.prototype); ui.game={active:false};
 ui.store={data:{loadout:['mag83','relay9','edge']}};
 ui.weaponCategory='All'; ui.selectedWeapon='mag83';
 const html=ui.weapons();
 assert.ok(html.includes(`ARMORY / ${WEAPON_LIST.length} WEAPONS`));
 assert.ok(!html.includes('${WEAPON_LIST.length}'));
 const ids=Array.from(html.matchAll(/data-action="inspect-weapon" data-id="([^"]+)"/g),m=>m[1]);
 assert.deepEqual(ids,WEAPON_LIST.map(w=>w.id));
 assert.equal(new Set(ids).size,11);
 for(const w of WEAPON_LIST){ui.selectedWeapon=w.id;const detail=ui.weapons();assert.ok(detail.includes(`<h2>${w.name}</h2>`));}
});

test('visible build labels consistently name V33.4',async()=>{
 for(const file of ['../index.html','../client/ui.js']){
  const text=await readFile(new URL(file,import.meta.url),'utf8');
  assert.ok(text.includes('BUILD V33.4'));
  assert.ok(!text.includes('BUILD V30'));
 }
});
