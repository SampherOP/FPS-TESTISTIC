import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/server.js';

function request(port, path, method = 'GET', body, cookie, headers = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (body !== undefined && !requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
    if (cookie) requestHeaders.cookie = cookie;
    const req = http.request({ port, path, method, headers: requestHeaders }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() })); });
    req.on('error', reject);
    if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body)); else req.end();
  });
}
async function appFor(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'hamu-auth-'));
  const app = createGameServer({ dataDir, migrateLegacy: false });
  const address = await app.start({ port: 0, host: '127.0.0.1' });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { app, port: address.port, dataDir };
}
function cookie(response) { return response.headers['set-cookie']?.[0]?.split(';')[0]; }


test('register/login/me expose only public user and persist accounts/sessions', async t => {
  const first = await appFor(t);
  const registered = await request(first.port, '/api/auth/register', 'POST', { username: 'Case_User', email: 'case_user@example.test', password: 'password-123' });
  assert.equal(registered.status, 201); assert.deepEqual(Object.keys(registered.json.user).sort(), ['createdAt', 'email', 'emailStatus', 'id', 'username']); assert.equal(registered.json.user.email, 'case_user@example.test');
  const sessionCookie = cookie(registered); assert.match(sessionCookie, /^hamu_session=\S+$/);
  const me = await request(first.port, '/api/auth/me', 'GET', undefined, sessionCookie); assert.equal(me.status, 200); assert.deepEqual(me.json.user, registered.json.user);
  assert.doesNotMatch(JSON.stringify(me.json), /password|scrypt/i);
  const accountText = await readFile(join(first.dataDir, 'accounts.json'), 'utf8'); assert.doesNotMatch(accountText, /password-123/); assert.match(accountText, /Case_User/);
  await first.app.close();

  const second = createGameServer({ dataDir: first.dataDir, migrateLegacy: false }); const address = await second.start({ port: 0, host: '127.0.0.1' }); t.after(async () => { await second.close(); await rm(first.dataDir, { recursive: true, force: true }); });
  const oldMe = await request(address.port, '/api/auth/me', 'GET', undefined, sessionCookie); assert.equal(oldMe.status, 200); assert.equal(oldMe.json.user.id, registered.json.user.id);
  const login = await request(address.port, '/api/auth/login', 'POST', { username: 'case_user', password: 'password-123' }); assert.equal(login.status, 200); assert.equal(login.json.user.id, registered.json.user.id);
});

test('validation, case-insensitive uniqueness, and authentication errors have useful statuses', async t => {
  const { port } = await appFor(t);
  for (const value of ['ab', 'bad-name!', 'éclair', 'a'.repeat(19)]) { const response = await request(port, '/api/auth/register', 'POST', { username: value, password: 'password-123' }); assert.equal(response.status, 400); }
  assert.equal((await request(port, '/api/auth/register', 'POST', { username: 'ValidName', password: 'short' })).status, 400);
  assert.equal((await request(port, '/api/auth/register', 'POST', { username: 'ValidName', password: 'p'.repeat(129) })).status, 400);
  const first = await request(port, '/api/auth/register', 'POST', { username: 'ValidName', email: 'valid@example.test', password: 'password-123' }); assert.equal(first.status, 201);
  const duplicate = await request(port, '/api/auth/register', 'POST', { username: 'validname', email: 'another@example.test', password: 'password-123' }); assert.equal(duplicate.status, 409);
  assert.equal((await request(port, '/api/auth/login', 'POST', { username: 'validname', password: 'wrongpass' })).status, 401);
  assert.equal((await request(port, '/api/auth/me')).status, 401);
  assert.equal((await request(port, '/api/auth/username?name=VALIDNAME')).json.available, false);
  assert.equal((await request(port, '/api/auth/username?name=Fresh_Name')).json.available, true);
  assert.equal((await request(port, '/api/auth/username?name=not-ok!')).status, 400);
});

test('concurrent registration has one winner and no duplicate accounts', async t => {
  const { port, dataDir } = await appFor(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => request(port, '/api/auth/register', 'POST', { username: 'RaceUser', email: 'race@example.test', password: 'password-123' })));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 7);
  const accounts = JSON.parse(await readFile(join(dataDir, 'accounts.json'), 'utf8'));
  assert.equal(accounts.users.length, 1);
});

test('mutations require JSON and reject a mismatched browser origin; logout revokes token', async t => {
  const { port } = await appFor(t);
  assert.equal((await request(port, '/api/auth/register', 'POST', JSON.stringify({ username: 'JsonUser', email: 'json@example.test', password: 'password-123' }), undefined, { 'content-type': 'text/plain' })).status, 400);
  assert.equal((await request(port, '/api/auth/register', 'POST', { username: 'OriginUser', email: 'origin@example.test', password: 'password-123' }, undefined, { origin: 'http://evil.invalid' })).status, 403);
  const registered = await request(port, '/api/auth/register', 'POST', { username: 'LogoutUser', email: 'logout@example.test', password: 'password-123' }); const session = cookie(registered);
  const loggedOut = await request(port, '/api/auth/logout', 'POST', {}, session); assert.equal(loggedOut.status, 200); assert.deepEqual(loggedOut.json, { ok: true });
  assert.equal((await request(port, '/api/auth/me', 'GET', undefined, session)).status, 401);
  const repeated = await request(port, '/api/auth/logout', 'POST', {}, session); assert.equal(repeated.status, 200); assert.deepEqual(repeated.json, { ok: true });
});


test('new login revokes the old browser session and disconnects it immediately', async t => {
  const { port, dataDir } = await appFor(t);
  const registered = await request(port, '/api/auth/register', 'POST', { username: 'SoloSession', email: 'solo-session@example.test', password: 'single-device-password' });
  assert.equal(registered.status, 201);
  const oldCookie = cookie(registered);
  const oldSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: oldCookie } });
  t.after(() => oldSocket.close());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('old browser WebSocket did not connect')), 3000);
    oldSocket.once('open', () => { clearTimeout(timer); resolve(); });
    oldSocket.once('error', reject);
  });
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('old browser was not disconnected')), 3000);
    oldSocket.once('close', code => { clearTimeout(timer); resolve(code); });
  });
  const second = await request(port, '/api/auth/login', 'POST', { identity: 'SoloSession', password: 'single-device-password' });
  assert.equal(second.status, 200);
  const newCookie = cookie(second);
  assert.equal(await closed, 4003);
  assert.equal((await request(port, '/api/auth/me', 'GET', undefined, oldCookie)).status, 401);
  assert.equal((await request(port, '/api/auth/me', 'GET', undefined, newCookie)).status, 200);
  const sessions = JSON.parse(await readFile(join(dataDir, 'sessions.json'), 'utf8'));
  assert.equal(Object.keys(sessions.sessions).length, 1);
});
