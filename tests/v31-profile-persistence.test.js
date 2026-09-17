import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../client/storage.js';
import { sanitizeProfile, ProfileStore } from '../server/profile.js';

function installLocalStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
  return values;
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function staleProfile(overrides = {}) {
  return {
    version: 1,
    settings: {},
    loadout: ['ar4', 'relay9', 'edge'],
    operator: 'sentinel',
    mode: 'tdm',
    practice: { bots: 5, difficulty: .8, duration: 180 },
    profile: { xp: 1, kills: 0, deaths: 0, wins: 0, matches: 0, time: 0 },
    history: [],
    ...overrides,
  };
}

test('an unsynced profile marker wins over a stale valid server profile after reload', async () => {
  const values = installLocalStorage();
  try {
    const account = { id: 'reload-account', username: 'ReloadUser' };
    const store = new Store(account);
    store.data.profile.xp = 777;
    store.data.loadout = ['hxr8', 'flick45', 'edge'];
    store.save();

    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    store.setRemoteSync(() => blocked);
    const saving = store.saveRemote();
    const pendingKey = `${store.key}:pending-profile`;
    const pending = JSON.parse(values.get(pendingKey));
    assert.equal(pending.profile.profile.xp, 777);
    assert.deepEqual(pending.profile.loadout, ['hxr8', 'flick45', 'edge']);

    const reloaded = new Store(account, staleProfile({ profile: { xp: 2 } }));
    assert.equal(reloaded.remotePending, true);
    assert.equal(reloaded.data.profile.xp, 777);
    assert.deepEqual(reloaded.data.loadout, ['hxr8', 'flick45', 'edge']);

    release();
    assert.equal(await saving, true);
  } finally {
    delete globalThis.localStorage;
  }
});

test('a successful remote acknowledgment clears the latest marker', async () => {
  const values = installLocalStorage();
  try {
    const store = new Store({ id: 'ack-account', username: 'AckUser' });
    let sent;
    store.setRemoteSync(async payload => { sent = payload; });
    assert.equal(await store.saveRemote(), true);
    assert.ok(sent);
    assert.equal(values.get(`${store.key}:pending-profile`), undefined);
    assert.equal(store.remotePending, false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('an earlier in-flight save cannot clear a later marker', async () => {
  const values = installLocalStorage();
  try {
    const store = new Store({ id: 'race-account', username: 'RaceUser' });
    const gates = [];
    store.setRemoteSync(payload => new Promise(resolve => gates.push({ payload, resolve })));

    store.data.profile.xp = 10;
    const first = store.saveRemote();
    store.data.profile.xp = 20;
    const second = store.saveRemote();
    await tick();
    assert.equal(gates.length, 1);
    assert.equal(gates[0].payload.profile.xp, 10);
    const pendingKey = `${store.key}:pending-profile`;
    const latestRevision = JSON.parse(values.get(pendingKey)).revision;

    gates[0].resolve();
    assert.equal(await first, true);
    assert.equal(JSON.parse(values.get(pendingKey)).revision, latestRevision);
    await tick();
    assert.equal(gates.length, 2);
    assert.equal(gates[1].payload.profile.xp, 20);

    gates[1].resolve();
    assert.equal(await second, true);
    assert.equal(values.get(pendingKey), undefined);
  } finally {
    delete globalThis.localStorage;
  }
});

test('a failed save preserves its marker and a later retry can clear it on success', async () => {
  const values = installLocalStorage();
  try {
    const store = new Store({ id: 'retry-account', username: 'RetryUser' });
    let fail = true;
    store.setRemoteSync(async () => {
      if (fail) throw new Error('offline');
    });
    assert.equal(await store.saveRemote(), false);
    const pendingKey = `${store.key}:pending-profile`;
    assert.ok(values.get(pendingKey));
    assert.equal(store.remotePending, true);

    assert.equal(await store.saveRemote(), false);
    assert.ok(values.get(pendingKey));
    assert.equal(store.remotePending, true);

    fail = false;
    assert.equal(await store.saveRemote(), true);
    assert.equal(values.get(pendingKey), undefined);
    assert.equal(store.remotePending, false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('pending profiles are isolated by account and malformed markers fall back safely', () => {
  const values = installLocalStorage();
  try {
    const accountA = { id: 'account-a', username: 'AccountA' };
    const accountB = { id: 'account-b', username: 'AccountB' };
    const first = new Store(accountA);
    first.data.profile.xp = 111;
    first.save();
    values.set(`${first.key}:pending-profile`, JSON.stringify({ revision: 'a', profile: first.serialize() }));

    const second = new Store(accountB, staleProfile({ profile: { xp: 222 } }));
    assert.equal(second.data.profile.xp, 222);
    assert.equal(second.remotePending, false);
    assert.notEqual(first.key, second.key);
    assert.ok(values.get(`${first.key}:pending-profile`));
    assert.equal(values.get(`${second.key}:pending-profile`), undefined);

    values.set(`${second.key}:pending-profile`, '{not-json');
    const withMalformedJson = new Store(accountB, staleProfile({ profile: { xp: 333 } }));
    assert.equal(withMalformedJson.remotePending, false);
    assert.equal(withMalformedJson.data.profile.xp, 333);

    values.set(`${second.key}:pending-profile`, JSON.stringify({ profile: { version: 1 } }));
    const withMalformedShape = new Store(accountB, staleProfile({ profile: { xp: 444 } }));
    assert.equal(withMalformedShape.remotePending, false);
    assert.equal(withMalformedShape.data.profile.xp, 444);
  } finally {
    delete globalThis.localStorage;
  }
});

test('server profile sanitization keeps five allowed finite yaws and rejects unknown/non-finite values', () => {
  const sanitized = sanitizeProfile({
    menuYawByOperator: {
      sentinel: .1,
      kestrel: 1.2,
      circuit: 2.3,
      frontline: 3.4,
      juggernaut: 4.5,
      unknown: 5.6,
      nan: Number.NaN,
      infinity: Number.POSITIVE_INFINITY,
      negativeInfinity: Number.NEGATIVE_INFINITY,
    },
  });
  assert.deepEqual(sanitized.menuYawByOperator, {
    sentinel: .1,
    kestrel: 1.2,
    circuit: 2.3,
    frontline: 3.4,
    juggernaut: 4.5,
  });

  const migrated = sanitizeProfile({ menuYawByOperator: { commando: 5.7 } });
  assert.deepEqual(migrated.menuYawByOperator, { frontline: 5.7 });
  assert.equal(Object.hasOwn(migrated.menuYawByOperator, 'commando'), false);
});

test('ProfileStore preserves yaw, stats, history and loadout across a save and restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'hamu-v31-profile-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const input = {
    version: 1,
    settings: { sensitivity: 1.4, quality: 'medium', bindings: { forward: 'KeyW' } },
    loadout: ['hxr8', 'flick45', 'edge'],
    operator: 'frontline',
    menuYawByOperator: { sentinel: .1, kestrel: 1.2, circuit: 2.3, frontline: 3.4, juggernaut: 4.5 },
    mode: 'dom',
    practice: { bots: 7, difficulty: 1.2, duration: 600 },
    profile: { xp: 9876, kills: 123, deaths: 45, wins: 67, matches: 89, time: 3210 },
    history: [{ id: 'history-1', date: '2026-09-16T00:00:00.000Z', mode: 'dom', map: 'Foundry', kills: 12, deaths: 3, score: 450, xp: 700, result: 'VICTORY', duration: 180, online: true }],
  };
  const first = new ProfileStore({ dataDir });
  await first.ready;
  const saved = await first.save('account-yaw', input);
  const second = new ProfileStore({ dataDir });
  await second.ready;
  const restored = await second.get('account-yaw');

  assert.deepEqual(restored.menuYawByOperator, input.menuYawByOperator);
  assert.deepEqual(restored.loadout, input.loadout);
  assert.deepEqual(restored.profile, input.profile);
  assert.deepEqual(restored.history, saved.history);
  assert.equal(restored.operator, 'frontline');
  assert.equal(restored.mode, 'dom');
  assert.deepEqual(restored.practice, input.practice);
  assert.doesNotMatch(await readFile(join(dataDir, 'profiles.json'), 'utf8'), /NaN|Infinity/);
});

test('main wiring reads remote profiles, installs sync and retries unsynced state', async () => {
  const main = await readFile(new URL('../client/main.js', import.meta.url), 'utf8');
  assert.match(main, /new Store\(account,remoteProfile\)/);
  assert.match(main, /store\.setRemoteSync\(profile=>auth\.saveProfile\(profile\)\)/);
  assert.match(main, /if\(!remoteProfile\|\|store\.remotePending\) void store\.saveRemote\(\)/);
});
