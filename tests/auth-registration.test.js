import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/server.js';

function request(port, path, method = 'GET', body, cookie, headers = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (body !== undefined && !requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
    if (cookie) requestHeaders.cookie = cookie;
    const req = http.request({ port, path, method, headers: requestHeaders }, res => {
      let text = '';
      res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body)); else req.end();
  });
}

async function appFor(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'hamu-registration-'));
  const app = createGameServer({ dataDir, migrateLegacy: false });
  const address = await app.start({ port: 0, host: '127.0.0.1' });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { app, port: address.port, dataDir };
}
function cookie(response) { return response.headers['set-cookie']?.[0]?.split(';')[0]; }


test('registration check normalizes email, does not reserve identity, and rejects invalid input', async t => {
  const { port, dataDir } = await appFor(t);
  const checked = await request(port, '/api/auth/registration-check', 'POST', { username: 'Check_User', email: '  CHECK@Example.TEST ' });
  assert.equal(checked.status, 200);
  assert.deepEqual(checked.json, { available: true, username: 'Check_User', email: 'check@example.test' });
  assert.equal(await readFile(join(dataDir, 'accounts.json'), 'utf8').catch(() => ''), '');
  const registered = await request(port, '/api/auth/register', 'POST', { username: 'Check_User', email: 'check@example.test', password: 'check-password' });
  assert.equal(registered.status, 201);

  for (const [username, email, code] of [['ab', 'valid@example.test', 'INVALID_USERNAME'], ['bad-name', 'valid@example.test', 'INVALID_USERNAME'], ['Good_Name', 'not-an-email', 'INVALID_EMAIL'], ['Good_Name', 'x@y', 'INVALID_EMAIL']]) {
    const result = await request(port, '/api/auth/registration-check', 'POST', { username, email });
    assert.equal(result.status, 400); assert.equal(result.json.code, code);
  }
});

test('duplicate email is checked and registered consistently without reserving the new name', async t => {
  const { port, dataDir } = await appFor(t);
  const originalPassword = 'original-password';
  assert.equal((await request(port, '/api/auth/register', 'POST', { username: 'OriginalName', email: 'Owner@Example.TEST', password: originalPassword })).status, 201);
  const check = await request(port, '/api/auth/registration-check', 'POST', { username: 'NewName', email: ' owner@example.test ' });
  assert.equal(check.status, 409); assert.equal(check.json.code, 'EMAIL_TAKEN');
  const duplicate = await request(port, '/api/auth/register', 'POST', { username: 'NewName', email: 'owner@example.test', password: 'new-password' });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.json.code, 'EMAIL_TAKEN');
  const nowFree = await request(port, '/api/auth/register', 'POST', { username: 'NewName', email: 'new-owner@example.test', password: 'new-password' });
  assert.equal(nowFree.status, 201);
  assert.equal((await request(port, '/api/auth/login', 'POST', { identity: 'originalname', password: originalPassword })).status, 200);
  assert.equal((await request(port, '/api/auth/login', 'POST', { identity: 'owner@example.test', password: originalPassword })).status, 200);
  assert.equal((await request(port, '/api/auth/login', 'POST', { identity: 'owner@example.test', password: 'new-password' })).status, 401);
  const accounts = await readFile(join(dataDir, 'accounts.json'), 'utf8');
  assert.match(accounts, /OriginalName/); assert.match(accounts, /NewName/); assert.doesNotMatch(accounts, /original-password|new-password/);
});

test('corrected unique email permits rejected name, login is case-insensitive, logout and restart persist', async t => {
  const first = await appFor(t);
  assert.equal((await request(first.port, '/api/auth/registration-check', 'POST', { username: 'ReusableName', email: 'taken@example.test' })).status, 200);
  assert.equal((await request(first.port, '/api/auth/register', 'POST', { username: 'Existing', email: 'taken@example.test', password: 'old-password' })).status, 201);
  assert.equal((await request(first.port, '/api/auth/register', 'POST', { username: 'ReusableName', email: 'unique@example.test', password: 'persist-password' })).status, 201);
  const logged = await request(first.port, '/api/auth/login', 'POST', { identity: 'reusablename', password: 'persist-password' });
  assert.equal(logged.status, 200); const session = cookie(logged); assert.ok(session);
  assert.equal((await request(first.port, '/api/auth/login', 'POST', { identity: 'UNIQUE@EXAMPLE.TEST', password: 'persist-password' })).status, 200);
  assert.equal((await request(first.port, '/api/auth/logout', 'POST', {}, session)).status, 200);
  assert.equal((await request(first.port, '/api/auth/me', 'GET', undefined, session)).status, 401);
  await first.app.close();

  const restarted = createGameServer({ dataDir: first.dataDir, migrateLegacy: false });
  const address = await restarted.start({ port: 0, host: '127.0.0.1' });
  t.after(async () => { await restarted.close(); await rm(first.dataDir, { recursive: true, force: true }); });
  assert.equal((await request(address.port, '/api/auth/login', 'POST', { identity: 'REUSABLENAME', password: 'persist-password' })).status, 200);
  assert.equal((await request(address.port, '/api/auth/login', 'POST', { identity: 'unique@example.test', password: 'persist-password' })).status, 200);
  const persisted = await readFile(join(first.dataDir, 'accounts.json'), 'utf8');
  assert.doesNotMatch(persisted, /old-password|persist-password/); assert.doesNotMatch(await readFile(join(first.dataDir, 'sessions.json'), 'utf8'), /persist-password/);
});

test('duplicate username reports USERNAME_TAKEN', async t => {
  const { port } = await appFor(t);
  assert.equal((await request(port, '/api/auth/register', 'POST', { username: 'Taken_Name', email: 'taken-name@example.test', password: 'username-password' })).status, 201);
  const checked = await request(port, '/api/auth/registration-check', 'POST', { username: 'taken_name', email: 'other@example.test' });
  assert.equal(checked.status, 409); assert.equal(checked.json.code, 'USERNAME_TAKEN');
  const registered = await request(port, '/api/auth/register', 'POST', { username: 'TAKEN_NAME', email: 'other@example.test', password: 'other-password' });
  assert.equal(registered.status, 409); assert.equal(registered.json.code, 'USERNAME_TAKEN');
});

test('racing different usernames for one email yields one winner and EMAIL_TAKEN losers', async t => {
  const { port, dataDir } = await appFor(t);
  const results = await Promise.all(['EmailRaceA', 'EmailRaceB', 'EmailRaceC', 'EmailRaceD'].map(username => request(port, '/api/auth/register', 'POST', { username, email: 'race-email@example.test', password: 'race-password' })));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409 && result.json.code === 'EMAIL_TAKEN').length, 3);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'accounts.json'), 'utf8')).users.length, 1);
});

test('registration checks require same-origin JSON and are rate limited', async t => {
  const { port } = await appFor(t);
  assert.equal((await request(port, '/api/auth/registration-check', 'POST', { username: 'OriginCheck', email: 'origin-check@example.test' }, undefined, { origin: 'http://evil.invalid' })).status, 403);
  assert.equal((await request(port, '/api/auth/registration-check', 'POST', JSON.stringify({ username: 'TextCheck', email: 'text-check@example.test' }), undefined, { 'content-type': 'text/plain' })).status, 400);
  const results = await Promise.all(Array.from({ length: 31 }, (_, i) => request(port, '/api/auth/registration-check', 'POST', { username: `RateCheck${String(i).padStart(2, '0')}`, email: `rate-${i}@example.test` })));
  assert.equal(results.filter(result => result.status === 200).length, 30);
  assert.equal(results.filter(result => result.status === 429).length, 1);
  assert.match(results.find(result => result.status === 429).json.error, /Too many requests/i);
});
