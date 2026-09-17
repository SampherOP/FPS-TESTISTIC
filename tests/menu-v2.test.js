import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ui=await readFile(new URL('../client/ui.js',import.meta.url),'utf8');
const social=await readFile(new URL('../client/social-ui.js',import.meta.url),'utf8');

test('cinematic Quick Play menu keeps account-owned profile identity dynamic',()=>{
  assert.match(ui,/master-home-v2/);
  assert.match(ui,/d\.profile\.name/);
  assert.doesNotMatch(ui,/XavairCasmo|XaivairCasmo/);
  assert.match(ui,/data-action="nav" data-page="profile"/);
  assert.match(ui,/data-action="quickmatch"/);
});

test('Quick Play menu exposes existing mode, character, loadout and social actions',()=>{
  for(const token of ['data-action="mode"','data-action="operator"','data-action="nav" data-page="loadout"','master-character-cards','master-weapon-cards']) assert.ok(ui.includes(token),`Quick Play retains ${token}`);
  // Friend rows are shared with the new directory rather than duplicated in UI.
  assert.match(ui,/const friendRows=this\.social\.friendsHTML\(\)/);
  assert.match(ui,/\$\{friendRows\}/);
  assert.match(social,/data-social="invite"/);
});
