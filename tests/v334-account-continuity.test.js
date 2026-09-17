import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/server.js';

function request(port, path, method = 'GET', body, cookie) {
  return new Promise((resolve, reject) => {
    const headers = body === undefined ? {} : { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => {
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const cookie = response => response.headers['set-cookie']?.[0]?.split(';')[0];
async function start(dataDir) {
  const app = createGameServer({ dataDir, migrateLegacy: false });
  const address = await app.start({ port: 0, host: '127.0.0.1' });
  return { app, port: address.port };
}
async function isolated(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'hamu-v334-account-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

// This is deliberately an end-to-end store restart: credentials, cookie session and
// profile must all be read back by a newly-created server instance using one data dir.
test('account ID, settings, loadout and progress survive a clean server restart', async t => {
  const dataDir = await isolated(t);
  const first = await start(dataDir);
  const registered = await request(first.port, '/api/auth/register', 'POST', { username: 'Durable334', email: 'durable334@example.test', password: 'password-334' });
  assert.equal(registered.status, 201);
  const originalId = registered.json.user.id, session = cookie(registered);
  const profile = { settings: { sensitivity: 1.7, fov: 111, volume: 22, quality: 'medium' }, loadout: ['mag83', 'flick45', 'edge'], operator: 'frontline', mode: 'dom', profile: { xp: 3340, kills: 33, deaths: 4, wins: 5, matches: 6, time: 700 } };
  assert.equal((await request(first.port, '/api/profile', 'PUT', { profile }, session)).status, 200);
  await first.app.close();

  const second = await start(dataDir); t.after(() => second.app.close());
  const me = await request(second.port, '/api/auth/me', 'GET', undefined, session);
  assert.equal(me.status, 200); assert.equal(me.json.user.id, originalId);
  const restored = await request(second.port, '/api/profile', 'GET', undefined, session);
  assert.equal(restored.status, 200);
  assert.equal(restored.json.profile.settings.fov, 111);
  assert.deepEqual(restored.json.profile.loadout, ['mag83', 'flick45', 'edge']);
  assert.deepEqual(restored.json.profile.profile, profile.profile);
});

test('synthetic legacy stable account ID maps to MAG-83 and SNIPE-RIL after restart', async t => {
  const dataDir = await isolated(t);
  const first = await start(dataDir);
  const registered = await request(first.port, '/api/auth/register', 'POST', { username: 'Legacy334', email: 'legacy334@example.test', password: 'password-334' });
  const oldId = registered.json.user.id, session = cookie(registered);
  assert.equal((await request(first.port, '/api/profile', 'PUT', { profile: { loadout: ['snipeRil', 'relay9', 'edge'], mode: 'ffa', profile: { xp: 83 } } }, session)).status, 200);
  await first.app.close();
  const stableId = 'legacy-stable-id-v334';
  const accountsFile = join(dataDir, 'accounts.json'), profilesFile = join(dataDir, 'profiles.json');
  const accounts = JSON.parse(await readFile(accountsFile, 'utf8')); accounts.users[0].id = stableId;
  const profiles = JSON.parse(await readFile(profilesFile, 'utf8')); profiles.profiles[stableId] = profiles.profiles[oldId]; delete profiles.profiles[oldId];
  await writeFile(accountsFile, JSON.stringify(accounts) + '\n'); await writeFile(profilesFile, JSON.stringify(profiles) + '\n');

  const second = await start(dataDir); t.after(() => second.app.close());
  const login = await request(second.port, '/api/auth/login', 'POST', { identity: 'Legacy334', password: 'password-334' });
  assert.equal(login.status, 200); assert.equal(login.json.user.id, stableId);
  const restored = await request(second.port, '/api/profile', 'GET', undefined, cookie(login));
  assert.deepEqual(restored.json.profile.loadout, ['snipeRil', 'relay9', 'edge']);
  assert.equal(restored.json.profile.profile.xp, 83);
});

test('a new login replaces the old session rather than allowing a simultaneous same-account login', async t => {
  const dataDir = await isolated(t), app = await start(dataDir); t.after(() => app.app.close());
  const registered = await request(app.port, '/api/auth/register', 'POST', { username: 'Single334', email: 'single334@example.test', password: 'password-334' });
  const oldCookie = cookie(registered);
  const replacement = await request(app.port, '/api/auth/login', 'POST', { identity: 'Single334', password: 'password-334' });
  assert.equal(replacement.status, 200);
  assert.equal((await request(app.port, '/api/auth/me', 'GET', undefined, oldCookie)).status, 401);
  assert.equal((await request(app.port, '/api/auth/me', 'GET', undefined, cookie(replacement))).status, 200);
});
