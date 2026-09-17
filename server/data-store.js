import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir, hostname as osHostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { probeProcess } from './process-probe.js';
import { PostgresSnapshot } from './postgres-snapshot.js';

export const STORE_FILES = ['accounts.json', 'sessions.json', 'social.json', 'profiles.json'];
const VERSION = 1;
const LOCK_HEADER = 'HAMU MASTER data-store lock';
const GUARD_HEADER = 'HAMU MASTER lock recovery guard';

function defaultDataDir() {
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'HamuMaster');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'HamuMaster');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'hamu-master');
}
export function resolveDataDir({ root, dataDir } = {}) {
  // An explicit argument wins for tests/embedding; HAMU_DATA_DIR wins for deployments.
  return resolve(dataDir || process.env.HAMU_DATA_DIR || defaultDataDir());
}
async function exists(file) { try { return (await stat(file)).isFile(); } catch (e) { if (e?.code === 'ENOENT') return false; throw e; } }
async function directoryExists(file) { try { return (await stat(file)).isDirectory(); } catch (e) { if (e?.code === 'ENOENT') return false; throw e; } }
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
function basicValid(name, value) {
  if (!value || value.version !== VERSION || typeof value !== 'object') return false;
  if (name === 'accounts.json') return Array.isArray(value.users);
  if (name === 'sessions.json') return value.sessions && typeof value.sessions === 'object';
  if (name === 'social.json') return value.friends && typeof value.friends === 'object' && value.requests && typeof value.requests === 'object';
  return name === 'profiles.json' && value.profiles && typeof value.profiles === 'object';
}
async function inspect(dir) {
  const present = [];
  for (const name of STORE_FILES) if (await exists(join(dir, name))) present.push(name);
  if (present.length && !present.includes('accounts.json')) throw new Error(`Unsafe account store at ${dir}: ${present.join(', ')} exists but accounts.json is missing. Restore all four files from a backup; the server will not create a replacement account registry.`);
  for (const name of present) {
    let value;
    try { value = await json(join(dir, name)); } catch { throw new Error(`Unsafe account store at ${dir}: ${name} is unreadable or corrupt. Restore it from a backup; do not start this server against it.`); }
    if (!basicValid(name, value)) throw new Error(`Unsafe account store at ${dir}: ${name} has an unsupported format. Restore a compatible backup before starting.`);
  }
  return present;
}
async function copySnapshot(from, to) {
  await mkdir(to, { recursive: true, mode: 0o700 });
  for (const name of STORE_FILES) if (await exists(join(from, name))) await copyFile(join(from, name), join(to, name));
}

function fieldsFromLock(text, header) {
  const lines = String(text).split(/\r?\n/);
  // One final newline is normal; embedded/extra blank lines are malformed rather than ignored.
  if (lines.at(-1) === '') lines.pop();
  if (lines.shift() !== header) return null;
  const fields = new Map();
  for (const line of lines) {
    const match = /^([a-z]+)=(.*)$/.exec(line);
    if (!match || fields.has(match[1])) return null;
    fields.set(match[1], match[2]);
  }
  return fields;
}
function validPid(value) { return /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647; }
function validHost(value) { return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\r\n]/.test(value); }
function validOwner(value) { return /^[a-f0-9]{32}$/.test(value); }
function parseLock(text) {
  const fields = fieldsFromLock(text, LOCK_HEADER);
  if (!fields || !validPid(fields.get('pid')) || !fields.get('started')) return null;
  const allowedLegacy = new Set(['pid', 'started']);
  const allowedCurrent = new Set(['pid', 'started', 'hostname', 'owner']);
  const hasHostOrOwner = fields.has('hostname') || fields.has('owner');
  const allowed = hasHostOrOwner ? allowedCurrent : allowedLegacy;
  if ([...fields.keys()].some(key => !allowed.has(key))) return null;
  if (!hasHostOrOwner) return { pid: Number(fields.get('pid')), legacy: true };
  if (!validHost(fields.get('hostname')) || !validOwner(fields.get('owner'))) return null;
  return { pid: Number(fields.get('pid')), hostname: fields.get('hostname'), owner: fields.get('owner'), legacy: false };
}
function lockText({ pid = process.pid, hostname = osHostname(), owner }) {
  return `${LOCK_HEADER}\npid=${pid}\nhostname=${hostname}\nowner=${owner}\nstarted=${new Date().toISOString()}\n`;
}
function guardText({ pid = process.pid, hostname = osHostname(), owner }) {
  return `${GUARD_HEADER}\npid=${pid}\nhostname=${hostname}\nowner=${owner}\nstarted=${new Date().toISOString()}\n`;
}
function lockError(dataDir, detail) { return new Error(`Account store is already locked: ${dataDir}. ${detail}`); }

/** One durable private data root for every store, with migration, a process lock and recovery snapshots. */
export class PersistentDataStore {
  constructor({ root, dataDir, migrateLegacy = true, pidProbe, hostname = osHostname() } = {}) {
    if (!root) throw new TypeError('root is required');
    this.root = resolve(root);
    this.dataDir = resolveDataDir({ root, dataDir });
    this.legacyDir = resolve(this.root, 'data');
    this.migrateLegacy = migrateLegacy;
    this.hostname = hostname;
    this.pidProbe = pidProbe || PersistentDataStore.defaultPidProbe;
    this.lockFile = join(this.dataDir, '.hamu-store.lock');
    this.recoveryGuardFile = join(this.dataDir, '.hamu-store.recovery.lock');
    this.backupsDir = join(this.dataDir, 'backups');
    this.lockHandle = null;
    this.lockOwner = null;
    this.lockOwned = false;
    this.closePromise = null;
    this.postgres = new PostgresSnapshot({dataDir:this.dataDir});
    this.ready = this._open();
    this.backupMade = false;
  }

  // Signal 0 never terminates a process. Windows ambiguous errors receive a read-only
  // OS query before deciding whether an abandoned lock can safely be recovered.
  static defaultPidProbe(pid) { return probeProcess(pid); }

  async _probe(pid) {
    try {
      const result = await this.pidProbe(pid);
      if (result === 'dead' || result === false) return 'dead';
      if (result === 'alive' || result === true) return 'alive';
      return 'unknown';
    } catch (error) {
      return error?.code === 'ESRCH' ? 'dead' : 'unknown';
    }
  }

  async _createLock() {
    const handle = await open(this.lockFile, 'wx', 0o600);
    this.lockHandle = handle;
    this.lockOwner = randomBytes(16).toString('hex');
    this.lockOwned = true;
    try {
      await handle.writeFile(lockText({ hostname: this.hostname, owner: this.lockOwner }));
      await handle.sync();
    } catch (error) {
      await this._releaseOwnedLock({ allowPartial: true });
      throw error;
    }
  }

  async _releaseOwnedLock({ allowPartial = false } = {}) {
    const handle = this.lockHandle;
    this.lockHandle = null;
    if (handle) await handle.close().catch(() => {});
    if (!this.lockOwned) return;
    const owner = this.lockOwner;
    this.lockOwned = false;
    this.lockOwner = null;
    let text = null;
    try { text = await readFile(this.lockFile, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const parsed = text === null ? null : parseLock(text);
    // A normally initialized lock is removed only if its nonce still names this instance.
    // A failed initial write has no usable metadata, but the exclusive handle proves this instance created it.
    if ((parsed?.owner === owner) || (allowPartial && text !== null && !parsed)) await unlink(this.lockFile).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  }

  async _acquireRecoveryGuard() {
    let handle;
    try { handle = await open(this.recoveryGuardFile, 'wx', 0o600); }
    catch (error) {
      if (error?.code === 'EEXIST') throw lockError(this.dataDir, `A short-lived stale-lock recovery is already in progress. Retry shortly. If it remains after verifying no HAMU MASTER startup is running, remove only this recovery guard manually: ${this.recoveryGuardFile}`);
      throw error;
    }
    const owner = randomBytes(16).toString('hex');
    try { await handle.writeFile(guardText({ hostname: this.hostname, owner })); await handle.sync(); }
    catch (error) { await handle.close().catch(() => {}); await unlink(this.recoveryGuardFile).catch(() => {}); throw error; }
    return { handle, owner };
  }

  async _releaseRecoveryGuard(guard) {
    await guard.handle.close().catch(() => {});
    try {
      const fields = fieldsFromLock(await readFile(this.recoveryGuardFile, 'utf8'), GUARD_HEADER);
      if (fields?.get('owner') === guard.owner) await unlink(this.recoveryGuardFile).catch(() => {});
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }

  async _recoverOrRefuse() {
    const guard = await this._acquireRecoveryGuard();
    try {
      // Recheck under the cooperating-version guard: a prior owner may have just released normally.
      try { await this._createLock(); return; }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      let text;
      try { text = await readFile(this.lockFile, 'utf8'); }
      catch (error) {
        if (error?.code === 'ENOENT') { await this._createLock(); return; }
        throw error;
      }
      // A competing process may have just created the file and still be writing its metadata.
      // Give that normal write one short, bounded chance to finish before treating it as malformed.
      let lock = parseLock(text);
      if (!lock) {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
        try { text = await readFile(this.lockFile, 'utf8'); } catch (error) {
          if (error?.code === 'ENOENT') { await this._createLock(); return; }
          throw error;
        }
        lock = parseLock(text);
      }
      if (!lock) throw lockError(this.dataDir, `The lock metadata is malformed, so it was not removed automatically. After verifying HAMU MASTER is stopped, remove only this lock file manually: ${this.lockFile}`);
      if (!lock.legacy && lock.hostname !== this.hostname) throw lockError(this.dataDir, `The lock belongs to host ${JSON.stringify(lock.hostname)}, not this host. It was not removed automatically; stop and verify the owner on that host.`);
      const state = await this._probe(lock.pid);
      if (state === 'alive') throw lockError(this.dataDir, `PID ${lock.pid}${lock.legacy ? ' (legacy lock)' : ''} is still running. Stop that HAMU MASTER server with Ctrl+C before retrying.`);
      if (state !== 'dead') throw lockError(this.dataDir, `PID ${lock.pid} could not be proven stopped, so the lock was not removed automatically. Close other HAMU MASTER server windows with Ctrl+C and retry. If the old server window cannot be found, restart Windows once and retry. Do not delete accounts or the HamuMaster folder. Lock kept at: ${this.lockFile}`);
      // Rename is atomic within this directory. Unlike unlinking after a stale read, it leaves no interval
      // in which another cooperating contender can create a lock that this recovery then deletes.
      const quarantine = join(this.dataDir, `.hamu-store.stale-${lock.owner || `legacy-${lock.pid}`}-${randomBytes(6).toString('hex')}`);
      try { await rename(this.lockFile, quarantine); }
      catch (error) {
        if (error?.code === 'ENOENT') { await this._createLock(); return; }
        throw error;
      }
      try { await this._createLock(); }
      catch (error) {
        // Keep the renamed stale evidence; never delete a lock that appeared after the atomic rename.
        if (error?.code === 'EEXIST') throw lockError(this.dataDir, 'The lock changed during stale-lock recovery and was left untouched. Retry after verifying the owner.');
        throw error;
      }
      await unlink(quarantine).catch(() => {});
    } finally {
      await this._releaseRecoveryGuard(guard);
    }
  }

  async _acquireLock() {
    try { await this._createLock(); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await this._recoverOrRefuse();
    }
  }

  async _open() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await this._acquireLock();
    try {
      await this.postgres.hydrate();
      this.postgres.attach();
      const target = await inspect(this.dataDir);
      // A populated stable target is authoritative. Never merge it with a project copy.
      if (this.migrateLegacy && target.length && this.dataDir !== this.legacyDir && await exists(join(this.legacyDir, 'accounts.json'))) console.warn(`HAMU MASTER: using existing private store ${this.dataDir}; project data at ${this.legacyDir} was not merged or replaced.`);
      // Only an entirely empty target may receive the supplied project's legacy data.
      if (this.migrateLegacy && !target.length && this.dataDir !== this.legacyDir) {
        const legacy = await inspect(this.legacyDir);
        if (legacy.length) {
          await copySnapshot(this.legacyDir, this.dataDir);
          await writeFile(join(this.dataDir, 'MIGRATED-FROM-PROJECT-DATA.txt'), `Copied existing project data from ${this.legacyDir} on ${new Date().toISOString()}. Keep both backups private.\n`, { mode: 0o600 });
          await this.postgres.seedFromLocal();
        }
      }
    } catch (error) {
      this.postgres.detach();
      await this._releaseOwnedLock();
      throw error;
    }
  }
  async beforeWrite() {
    await this.ready;
    if (this.backupMade) return;
    // One bounded, process-start snapshot gives a known-good restore point before the first mutation.
    const stage = join(this.dataDir, `.previous-good-${process.pid}-${randomBytes(4).toString('hex')}`);
    const destination = join(this.backupsDir, 'previous-good');
    await mkdir(this.backupsDir, { recursive: true, mode: 0o700 });
    await copySnapshot(this.dataDir, stage);
    await writeFile(join(stage, 'BACKUP-MANIFEST.txt'), `Automatic previous-good snapshot\nCreated: ${new Date().toISOString()}\nFiles: ${STORE_FILES.join(', ')}\nAbsent files were not yet created.\n`, { mode: 0o600 });
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
    this.backupMade = true;
  }
  async backup(label = new Date().toISOString().replace(/[:.]/g, '-')) {
    await this.ready;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(label)) throw new Error('Backup label may use only letters, numbers, _ and -.');
    const destination = join(this.backupsDir, `manual-${label}`);
    if (await directoryExists(destination)) throw new Error(`Backup already exists: ${destination}`);
    await mkdir(this.backupsDir, { recursive: true, mode: 0o700 });
    await copySnapshot(this.dataDir, destination);
    await writeFile(join(destination, 'BACKUP-MANIFEST.txt'), `Manual backup\nCreated: ${new Date().toISOString()}\nFiles: ${STORE_FILES.join(', ')}\n`, { mode: 0o600 });
    const dirs = (await readdir(this.backupsDir, { withFileTypes: true })).filter(x => x.isDirectory() && x.name.startsWith('manual-')).map(x => x.name).sort();
    while (dirs.length > 5) await rm(join(this.backupsDir, dirs.shift()), { recursive: true, force: true });
    return destination;
  }
  async close() {
    if (!this.closePromise) this.closePromise = (async () => {
      await this.ready.catch(() => {});
      this.postgres.detach();
      await this._releaseOwnedLock();
    })();
    return this.closePromise;
  }
}

export async function restoreBackup({ dataDir, backupDir }) {
  const target = resolve(dataDir), source = resolve(backupDir), backups = resolve(target, 'backups');
  const pathWithinBackups = relative(backups, source);
  if (!pathWithinBackups || pathWithinBackups.startsWith('..') || isAbsolute(pathWithinBackups)) throw new Error('Backup must be inside this store’s backups directory.');
  if (await exists(join(target, '.hamu-store.lock'))) throw new Error(`Account store is locked at ${target}. Stop the running server before restoring.`);
  await inspect(source);
  // Deliberately refuse overwrite: operator must stop server and move current files aside first.
  const current = await inspect(target);
  if (current.length) throw new Error(`Refusing to overwrite existing data in ${target}. Stop the server, move all four current files aside, then restore manually from ${source}.`);
  await copySnapshot(source, target);
}
