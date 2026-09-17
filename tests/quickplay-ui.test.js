import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ui = await readFile(new URL('../client/ui.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../client/styles.css', import.meta.url), 'utf8');

test('Quick Play queue status uses non-clickable FIND PLAYERS presentation', () => {
  assert.match(ui, /<strong>FIND PLAYERS<\/strong>/);
  assert.match(ui, /aria-live=\"polite\"/);
  assert.match(ui, /id=\"quick-queue-count\">\$\{q\.playersSearching\} \/ \$\{q\.capacity\|\|8\}/);
  assert.match(ui, /Finding available players on the live server/);
  assert.doesNotMatch(ui, /data-action=\"nav\" data-page=\"multiplayer\"[^>]*>[^<]*FIND PLAYERS/);
});

test('Quick Play queue counter and loading indicator are visibly animated and status-only', () => {
  assert.match(css, /\.quick-queue-found\{[^}]*pointer-events:none/);
  assert.match(css, /@keyframes quickQueuePulse/);
  assert.match(css, /\.quick-queue-card \.queue-visual i\{[^}]*animation:quickQueuePulse/);
});

const input = await readFile(new URL('../client/input.js', import.meta.url), 'utf8');
const game = await readFile(new URL('../client/game.js', import.meta.url), 'utf8');
const social = await readFile(new URL('../client/social-ui.js', import.meta.url), 'utf8');

test('short mouse clicks flush FIRE immediately for online matches instead of waiting for the 30 Hz network sample', () => {
  assert.match(input, /this\.onAction\(action,down,e\)/);
  assert.match(game, /flushInputIntent\(\)/);
  assert.match(game, /this\.network\.input\(this\.input\.sample\(true\)\)/);
});

test('Friends navigation uses the single new player-directory page and no obsolete party/tabs renderer', () => {
  assert.match(ui, /friends:\(\)=>this\.multiplayer\(\)/);
  assert.match(ui, /multiplayer\(\) \{ return this\.social\.pageHTML\(\); \}/);
  assert.doesNotMatch(social, /partyHTML\(\)|tabsHTML\(\)/);
  assert.match(social, /SEARCH PLAYER ID \/ UNIQUE NAME/);
});

test('Friends directory avatar rendering and post-match menu navigation are wired without the old avatar crash', () => {
  assert.match(social, /avatar\(p\)\{/);
  assert.match(social, /social-avatar/);
  assert.match(social, /this\.avatar\(p\)/);
  assert.match(ui, /party-return.*nav\('play'\)/);
  assert.match(ui, /if\(a==='quit'\).*nav\('play'\)/);
});
