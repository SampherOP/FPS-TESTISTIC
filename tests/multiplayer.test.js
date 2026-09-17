import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createGameServer } from '../server/server.js';
import { B } from '../shared/protocol.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function request(port, path, method = 'GET', body, cookie, origin) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    const req = http.request({ port, path, method, headers }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text })); });
    req.on('error', reject);
    if (body !== undefined) req.end(JSON.stringify(body)); else req.end();
  });
}
async function register(port, username) {
  const response = await request(port, '/api/auth/register', 'POST', { username, email: `${username.toLowerCase()}@example.test`, password: 'password-123' });
  assert.equal(response.status, 201);
  return response.headers['set-cookie'][0].split(';')[0];
}
function connect(url, cookie, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie }, ...(origin ? { origin } : {}) });
    const q = [];
    ws.on('message', data => q.push(JSON.parse(data)));
    ws.once('open', () => resolve({ ws, q }));
    ws.once('error', reject);
  });
}
async function next(client, predicate, timeout = 2500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const index = client.q.findIndex(predicate); if (index >= 0) return client.q.splice(index, 1)[0]; await wait(10); }
  throw new Error('timed out waiting for websocket message');
}
async function isolatedApp(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'hamu-multi-'));
  const app = createGameServer({ ...options, dataDir, migrateLegacy: false });
  const address = await app.start({ port: 0, host: '127.0.0.1' });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { app, port: address.port };
}

test('real authenticated clients create/join room, see snapshots, balanced teams, movement and shot events', async t => {
  const { app, port } = await isolatedApp(t, { maxRooms: 4 });
  const aCookie = await register(port, 'Alpha');
  const bCookie = await register(port, 'Bravo');
  const url = `ws://127.0.0.1:${port}/ws`, a = await connect(url, aCookie), b = await connect(url, bCookie);
  t.after(() => { a.ws.close(); b.ws.close(); });
  const ah = await next(a, x => x.t === 'hello'), bh = await next(b, x => x.t === 'hello');
  assert.notEqual(ah.accountId, bh.accountId);
  a.ws.send(JSON.stringify({ t: 'create', name: 'Spoofed', roomName: 'Test', mode: 'tdm', bots: 0 }));
  const joined = await next(a, x => x.t === 'joined'); assert.equal(joined.room.humans, 1); assert.equal(joined.accountId, ah.accountId); assert.equal(joined.state.players[0][1], 'Alpha');
  const roomId = joined.room.id;
  b.ws.send(JSON.stringify({ t: 'join', room: roomId, name: 'Also spoofed', team: 1 }));
  const bj = await next(b, x => x.t === 'joined'); assert.equal(bj.room.humans, 2); assert.equal(bj.state.players.find(p => p[0] === bj.id)[1], 'Bravo');
  const room = app.rooms.get(roomId); assert.ok(room); assert.equal(room.world.players.size, 2); assert.notEqual(room.world.players.get(joined.id).team, room.world.players.get(bj.id).team);
  const stateA = await next(a, x => x.t === 'state' && x.players.length === 2), stateB = await next(b, x => x.t === 'state' && x.players.length === 2); assert.equal(stateA.players.length, 2); assert.equal(stateB.players.length, 2);
  const pa = room.world.players.get(joined.id), pb = room.world.players.get(bj.id); Object.assign(pa, { x: -8, z: 0, yaw: Math.PI / 2, protectUntil: -1 }); Object.assign(pb, { x: 8, z: 0, yaw: -Math.PI / 2, protectUntil: -1 });
  a.ws.send(JSON.stringify({ t: 'i', d: [1, 0, 0, Math.PI / 2, 0, B.FIRE, 0, 1] }));
  const shot = await next(a, x => x.t === 'state' && x.events?.some(e => e.type === 'shot')); assert.ok(shot.events.some(e => e.type === 'shot'));
  a.ws.send(JSON.stringify({ t: 'i', d: [2, 1, 0, Math.PI / 2, 0, B.SPRINT, 0, 1] }));
  const moved = await next(a, x => x.t === 'state' && x.players.find(p => p[0] === joined.id)?.[30] >= 2); const pnow = moved.players.find(p => p[0] === joined.id); assert.ok(Math.abs(pnow[3] - pa.x) < 3, 'authoritative movement stayed near server state');
});

test('malformed input is rejected without advancing accepted sequence', async t => {
  const { app, port } = await isolatedApp(t, { maxRooms: 2 }); const cookie = await register(port, 'Malformed'); const c = await connect(`ws://127.0.0.1:${port}/ws`, cookie); t.after(() => c.ws.close()); await next(c, x => x.t === 'hello');
  c.ws.send(JSON.stringify({ t: 'create', name: 'A', mode: 'tdm', bots: 0 })); const j = await next(c, x => x.t === 'joined'); const room = app.rooms.get(j.room.id); const player = room.world.players.get(j.id);
  c.ws.send(JSON.stringify({ t: 'i', d: [1, 0, 0, 0, 0, 0, 0, 1] })); await wait(40); assert.equal(player.lastSeq, 1);
  c.ws.send(JSON.stringify({ t: 'i', d: [1, 999, 0, 0, 0, 0, 0, 1] })); await wait(40); assert.equal(player.lastSeq, 1); assert.equal(c.ws.readyState, WebSocket.OPEN);
});

test('unauthenticated websocket and mismatched browser origin are rejected', async t => {
  const { port } = await isolatedApp(t);
  await assert.rejects(() => new Promise((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`))); ws.once('open', resolve); ws.once('error', reject); }), /status 401/);
  const cookie = await register(port, 'OriginUser');
  await assert.rejects(() => new Promise((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie }, origin: 'http://evil.invalid' }); ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`))); ws.once('open', resolve); ws.once('error', reject); }), /status 403/);
});

test('static handler serves allowlisted files and rejects private paths/methods', async t => {
  const { port } = await isolatedApp(t, { maxRooms: 1 });
  const ok = await request(port, '/shared/protocol.js'); assert.equal(ok.status, 200); assert.match(ok.headers['content-type'], /javascript/);
  const root = await request(port, '/'); assert.equal(root.status, 200); assert.match(root.headers['content-type'], /html/);
  const no = await request(port, '/server/server.js'); assert.equal(no.status, 404);
  const privateFile = await request(port, '/data/accounts.json'); assert.equal(privateFile.status, 404);
  const traversal = await request(port, '/shared/../data/accounts.json'); assert.equal(traversal.status, 404);
  const method = await request(port, '/', 'POST'); assert.equal(method.status, 405); assert.equal(method.headers.allow, 'GET, HEAD');
});

test('multiple real players keep independent firing intents in the same live match', async t => {
  const { app, port } = await isolatedApp(t, { maxRooms: 4 });
  const aCookie = await register(port, 'ShooterA');
  const bCookie = await register(port, 'ShooterB');
  const url = `ws://127.0.0.1:${port}/ws`, a = await connect(url, aCookie), b = await connect(url, bCookie);
  t.after(() => { a.ws.close(); b.ws.close(); });
  const ah = await next(a, x => x.t === 'hello'), bh = await next(b, x => x.t === 'hello');
  a.ws.send(JSON.stringify({ t: 'create', name: 'ignored', roomName: 'Multi Fire', mode: 'tdm', bots: 0 }));
  const aj = await next(a, x => x.t === 'joined');
  b.ws.send(JSON.stringify({ t: 'join', room: aj.room.id, team: 1 }));
  await next(b, x => x.t === 'joined');
  const room = app.rooms.get(aj.room.id); assert.ok(room);
  const pa = room.world.players.get(ah.id === aj.id ? aj.id : ah.id), pb = room.world.players.get(bh.id);
  assert.ok(pa && pb);
  pa.protectUntil = -1; pb.protectUntil = -1;
  pa.nextShot = 0; pb.nextShot = 0; room.world.time = 1;
  pa.yaw = Math.PI / 2; pb.yaw = -Math.PI / 2;
  a.ws.send(JSON.stringify({ t: 'f', d: [pa.yaw, 0, 0] }));
  b.ws.send(JSON.stringify({ t: 'f', d: [pb.yaw, 0, 0] }));
  await wait(60);
  assert.equal(pa.ammo[0], 29);
  assert.equal(pb.ammo[0], 29);
  assert.equal(pa.firedAt, 1);
  assert.equal(pb.firedAt, 1);
});
