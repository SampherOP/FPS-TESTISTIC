import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PersistentDataStore, restoreBackup } from '../server/data-store.js';
import { createGameServer } from '../server/server.js';

async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'hamu-lock-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function store(root, dataDir, options = {}) { return new PersistentDataStore({ root, dataDir, migrateLegacy: false, ...options }); }
function legacy(pid = 424242) { return `HAMU MASTER data-store lock\npid=${pid}\nstarted=2025-01-01T00:00:00.000Z\n`; }
function currentLock(pid, host, owner = 'a'.repeat(32)) { return `HAMU MASTER data-store lock\npid=${pid}\nhostname=${host}\nowner=${owner}\nstarted=2025-01-01T00:00:00.000Z\n`; }

// A contender that did not acquire the lock must never release the winner's lock.
test('live lock is refused and a failed contender close cannot remove its winner', async t => {
  const base = await temp(t), root = join(base, 'project'), dir = join(base, 'store');
  const first = store(root, dir); await first.ready;
  const second = store(root, dir); await assert.rejects(second.ready, /already locked/);
  await second.close();
  const third = store(root, dir); await assert.rejects(third.ready, /already locked/);
  await third.close(); await first.close();
});

test('close is idempotent and an old instance cannot delete the next owner lock', async t => {
  const base = await temp(t), root = join(base, 'project'), dir = join(base, 'store');
  const first = store(root, dir); await first.ready; await first.close();
  const next = store(root, dir); await next.ready;
  const before = await readFile(join(dir, '.hamu-store.lock'), 'utf8');
  await first.close();
  assert.equal(await readFile(join(dir, '.hamu-store.lock'), 'utf8'), before);
  await next.close();
});

test('confirmed-dead legacy CRLF lock is recovered without changing data or IDs', async t => {
  const base = await temp(t), root = join(base, 'project'), dir = join(base, 'store');
  await writeFile(join(base, 'seed'), '');
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
  const accounts = '{"version":1,"users":[{"id":"permanent-id-unchanged"}]}\n';
  await writeFile(join(dir, 'accounts.json'), accounts);
  await writeFile(join(dir, '.hamu-store.lock'), legacy().replace(/\n/g, '\r\n'));
  const recovered = store(root, dir, { hostname: 'same-host', pidProbe: () => 'dead' }); await recovered.ready;
  assert.equal(await readFile(join(dir, 'accounts.json'), 'utf8'), accounts);
  assert.match(await readFile(join(dir, '.hamu-store.lock'), 'utf8'), /hostname=same-host\nowner=[a-f0-9]{32}/);
  await recovered.close();
});

test('new-format lock from a real forced-stopped child is recovered conservatively', async t => {
  const base = await temp(t), root = join(base, 'project'), dir = join(base, 'store');
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
  const accounts = '{"version":1,"users":[{"id":"child-permanent-id"}]}\n'; await writeFile(join(dir, 'accounts.json'), accounts);
  const moduleUrl = pathToFileURL(new URL('../server/data-store.js', import.meta.url).pathname).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `import { PersistentDataStore } from ${JSON.stringify(moduleUrl)}; const s=new PersistentDataStore({root:${JSON.stringify(root)},dataDir:${JSON.stringify(dir)},migrateLegacy:false}); await s.ready; console.log('LOCKED'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => output += chunk);
  await new Promise((resolveReady, rejectReady) => { const timer = setTimeout(() => rejectReady(new Error('child did not acquire lock')), 5000); const poll = setInterval(() => { if (output.includes('LOCKED')) { clearTimeout(timer); clearInterval(poll); resolveReady(); } }, 10); child.once('error', rejectReady); });
  t.after(() => { if (!child.killed) child.kill('SIGKILL'); });
  child.kill('SIGKILL'); await once(child, 'exit');
  const recovered = store(root, dir); await recovered.ready;
  assert.equal(await readFile(join(dir, 'accounts.json'), 'utf8'), accounts);
  await recovered.close();
});

test('concurrent stale contenders serialize recovery so exactly one owns the store', async t => {
  const base = await temp(t), root = join(base, 'project'), dir = join(base, 'store');
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.hamu-store.lock'), legacy());
  const contenders = Array.from({ length: 5 }, () => store(root, dir, { hostname: 'same-host', pidProbe: pid => pid === 424242 ? 'dead' : 'alive' }));
  const settled = await Promise.allSettled(contenders.map(x => x.ready));
  assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1);
  await Promise.all(contenders.map(x => x.close()));
});

test('malformed, permission-ambiguous, foreign-host and live locks stay blocked', async t => {
  const base = await temp(t), root = join(base, 'project');
  for (const [name, text, options, expected] of [
    ['malformed', 'not a HAMU lock\n', { hostname: 'same-host', pidProbe: () => 'dead' }, /malformed/],
    ['eperm', currentLock(3333, 'same-host'), { hostname: 'same-host', pidProbe: () => { const e = new Error('no permission'); e.code = 'EPERM'; throw e; } }, /could not be proven stopped/],
    ['foreign', currentLock(3333, 'other-host'), { hostname: 'same-host', pidProbe: () => 'dead' }, /belongs to host/],
    ['live', currentLock(3333, 'same-host'), { hostname: 'same-host', pidProbe: () => 'alive' }, /still running/]
  ]) {
    const dir = join(base, name); await (await import('node:fs/promises')).mkdir(dir, { recursive: true }); await writeFile(join(dir, '.hamu-store.lock'), text);
    const candidate = store(root, dir, options); await assert.rejects(candidate.ready, expected); await candidate.close();
    assert.equal((await readFile(join(dir, '.hamu-store.lock'), 'utf8')), text);
  }
});

test('backup containment rejects a sibling prefix rather than relying on slash paths', async t => {
  const base = await temp(t), dir = join(base, 'store'), outside = join(base, 'store-backups-looking');
  await (await import('node:fs/promises')).mkdir(outside, { recursive: true });
  await assert.rejects(restoreBackup({ dataDir: dir, backupDir: outside }), /Backup must be inside/);
});

test('listen EADDRINUSE releases the startup store lock and ordinary restarts remain safe', async t => {
  const base = await temp(t), root = join(base, 'project'), dir = join(base, 'store');
  const blocker = http.createServer(); blocker.listen(0, '127.0.0.1'); await once(blocker, 'listening');
  const app = createGameServer({ root, dataDir: dir, migrateLegacy: false });
  await assert.rejects(app.start({ port: blocker.address().port, host: '127.0.0.1' }), error => error?.code === 'EADDRINUSE');
  await assert.rejects(readFile(join(dir, '.hamu-store.lock'), 'utf8'), error => error?.code === 'ENOENT');
  await app.close(); await new Promise(resolveClose => blocker.close(resolveClose));
  for (let i = 0; i < 2; i++) { const s = store(root, dir); await s.ready; await s.close(); }
});
