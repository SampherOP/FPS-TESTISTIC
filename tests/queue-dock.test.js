import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialUI } from '../client/social-ui.js';
import { Network } from '../client/network.js';
import { UI } from '../client/ui.js';
import { MODES } from '../shared/weapons.js';

function fixture(t) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const dock = { hidden: true, textContent: '' };
  globalThis.document = {
    addEventListener() {},
    getElementById(id) { return id === 'squad-dock' ? dock : null; },
  };
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  t.mock.method(globalThis, 'setInterval', () => 0);
  const network = new Network();
  const ui = { network, current: 'play', game: { active: false }, store: { data: { mode: 'tdm' } } };
  const social = new SocialUI(ui);
  const setQueue = (mode = 'tdm', playersSearching = 1) => {
    const now = Date.now();
    network.queue = { mode, partySize: 1, playersSearching, capacity: 8, startedAt: now, fillAt: now + 15000 };
    network.emit('queue', network.queue);
  };
  return { dock, network, ui, social, setQueue };
}

test('Quick Play keeps FIND PLAYERS and its live counter without the duplicate floating dock', t => {
  const { dock, network, ui, setQueue } = fixture(t);
  for (const mode of Object.keys(MODES)) {
    for (const count of [1, 4, 8]) {
      setQueue(mode, count);
      for (const event of ['queue', 'party', 'social', 'status']) {
        network.emit(event);
        assert.equal(dock.hidden, true, `${mode}: dock stays hidden after ${event}`);
      }
      const html = UI.prototype.quickQueueHTML.call(ui);
      assert.match(html, /<strong>FIND PLAYERS<\/strong>/);
      assert.ok(html.includes(`id="quick-queue-count">${count} / 8</strong>`));
      assert.match(html, /id="quick-queue-elapsed"/);
      assert.match(html, /data-action="quick-queue-cancel">CANCEL SEARCH/);
      assert.doesNotMatch(html, /VIEW QUEUE/);
      assert.equal(network.queue.playersSearching, count);
    }
  }
});

test('Returning to Quick Play hides the dock while other menu tabs retain their existing shortcut', t => {
  const { dock, ui, social, setQueue } = fixture(t);
  setQueue();
  for (const page of ['loadout', 'weapons', 'operators', 'settings', 'profile', 'history']) {
    ui.current = page;
    social.update();
    assert.equal(dock.hidden, false, `${page}: existing shortcut is preserved`);
    assert.match(dock.textContent, /FINDING TDM · 1 IN PARTY · VIEW QUEUE/);
    ui.current = 'play';
    social.update();
    assert.equal(dock.hidden, true, 'returning to Quick Play removes the duplicate');
  }
  ui.current = 'multiplayer';
  social.update();
  assert.equal(dock.hidden, true, 'party lobby remains unchanged');
});

test('Queue cancellation, idle state and active gameplay keep the dock hidden', t => {
  const { dock, network, ui, social, setQueue } = fixture(t);
  social.update();
  assert.equal(dock.hidden, true);
  assert.equal(dock.textContent, '');
  setQueue();
  network.queue = null;
  network.emit('queue', null);
  assert.equal(dock.hidden, true);
  assert.equal(dock.textContent, '');
  assert.match(UI.prototype.quickQueueHTML.call(ui), /FIND MATCH/);
  assert.doesNotMatch(UI.prototype.quickQueueHTML.call(ui), /<strong>FIND PLAYERS<\/strong>/);
  ui.current = 'loadout';
  ui.game.active = true;
  setQueue();
  assert.equal(dock.hidden, true);
});
