import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../server/auth.js';
import { ProfileStore } from '../server/profile.js';
import { SocialStore } from '../server/social.js';
import { createGameServer } from '../server/server.js';
import { PersistentDataStore, restoreBackup, STORE_FILES } from '../server/data-store.js';

async function temp(t) { const path = await mkdtemp(join(tmpdir(), 'hamu-save-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }

test('new code directory migrates a complete legacy project store once without changing account IDs or hashes', async t => {
  const base = await temp(t), oldRoot = join(base, 'old-copy'), newRoot = join(base, 'new-copy'), stable = join(base, 'private-volume');
  const legacy = join(oldRoot, 'data'); await mkdir(legacy, { recursive: true }); await mkdir(newRoot, { recursive: true });
  const oldAuth = new AuthStore({ dataDir: legacy }); const oldProfiles = new ProfileStore({ dataDir: legacy }); const oldSocial = new SocialStore({ dataDir: legacy });
  await Promise.all([oldAuth.ready, oldProfiles.ready, oldSocial.ready]);
  const user = await oldAuth.register('UpgradePilot', 'pilot@example.test', 'password-123');
  await oldProfiles.save(user.id, { profile: { xp: 321 } });
  const legacyAccounts = await readFile(join(legacy, 'accounts.json'), 'utf8');
  // A private upgrade ZIP carries the old four files inside its new extracted project.
  await mkdir(join(newRoot, 'data'), { recursive: true }); for (const name of STORE_FILES) await copyFile(join(legacy, name), join(newRoot, 'data', name)).catch(() => {});
  const app = createGameServer({ root: newRoot, dataDir: stable }); await app.start({ port: 0, host: '127.0.0.1' });
  t.after(() => app.close());
  const logged = await app.auth.login('pilot@example.test', 'password-123');
  assert.equal(logged.user.id, user.id); assert.equal((await app.profiles.get(user.id)).profile.xp, 321);
  assert.equal(await readFile(join(stable, 'accounts.json'), 'utf8'), legacyAccounts);
  assert.match(await readFile(join(stable, 'MIGRATED-FROM-PROJECT-DATA.txt'), 'utf8'), /Copied existing project data/);
  // A populated target is never replaced by a later project copy.
  await writeFile(join(newRoot, 'data', 'accounts.json'), '{"version":1,"users":[]}\n');
  assert.equal((await app.auth.login('UpgradePilot', 'password-123')).user.id, user.id);
});

test('email registration/login/linking is private, unique and legacy accounts remain usable', async t => {
  const dir = await temp(t), auth = new AuthStore({ dataDir: dir }); await auth.ready;
  const legacy = await auth.register('LegacyUser', 'legacy@example.test', 'password-123');
  // Simulate an account written by pre-email code, preserving its password hash and ID.
  const doc = JSON.parse(await readFile(join(dir, 'accounts.json'), 'utf8')); delete doc.users[0].email; await writeFile(join(dir, 'accounts.json'), JSON.stringify(doc));
  const reloaded = new AuthStore({ dataDir: dir }); await reloaded.ready;
  assert.equal((await reloaded.login('legacyuser', 'password-123')).user.id, legacy.id);
  const linked = await reloaded.linkEmail(legacy.id, ' Legacy@Example.Test ', 'password-123'); assert.equal(linked.email, 'legacy@example.test');
  assert.equal((await reloaded.login('LEGACY@example.test', 'password-123')).user.id, legacy.id);
  await assert.rejects(reloaded.register('OtherUser', 'legacy@example.test', 'password-123'), error => error.status === 409);
  await assert.rejects(reloaded.register('NoEmailUser', '', 'password-123'), error => error.status === 400);
  assert.deepEqual(Object.keys((await import('../server/auth.js')).publicUser(linked)).sort(), ['createdAt', 'id', 'username']);
});

test('store lock, corrupt/missing-account safety, bounded backup and cautious restore prevent destructive starts', async t => {
  const base = await temp(t), root = join(base, 'project'), dir = join(base, 'volume'); await mkdir(root, { recursive: true });
  const first = new PersistentDataStore({ root, dataDir: dir }); await first.ready;
  const second = new PersistentDataStore({ root, dataDir: dir }); await assert.rejects(second.ready, /already locked/);
  await first.close();
  const store = new PersistentDataStore({ root, dataDir: dir }); await store.ready;
  const auth = new AuthStore({ dataDir: dir, beforeWrite: () => store.beforeWrite() }); await auth.ready;
  await auth.register('BackupUser', 'backup@example.test', 'password-123');
  const backup = await store.backup('before-test'); assert.match(backup, /manual-before-test$/);
  assert.equal(await readFile(join(dir, 'backups', 'previous-good', 'BACKUP-MANIFEST.txt'), 'utf8').then(() => true), true);
  await assert.rejects(restoreBackup({ dataDir: dir, backupDir: backup }), /locked/);
  await store.close();
  await assert.rejects(restoreBackup({ dataDir: dir, backupDir: backup }), /Refusing to overwrite/);
  for (const name of STORE_FILES) await rename(join(dir, name), join(dir, `${name}.saved`)).catch(() => {});
  await restoreBackup({ dataDir: dir, backupDir: backup });
  assert.match(await readFile(join(dir, 'accounts.json'), 'utf8'), /BackupUser/);
  const corrupt = join(base, 'corrupt'); await mkdir(corrupt); await writeFile(join(corrupt, 'accounts.json'), '{broken');
  await assert.rejects(new PersistentDataStore({ root, dataDir: corrupt }).ready, /unreadable or corrupt/);
  const orphan = join(base, 'orphan'); await mkdir(orphan); await writeFile(join(orphan, 'profiles.json'), '{"version":1,"profiles":{}}');
  await assert.rejects(new PersistentDataStore({ root, dataDir: orphan }).ready, /accounts.json is missing/);
});
