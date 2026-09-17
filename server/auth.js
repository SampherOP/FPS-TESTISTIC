import { mkdir, readFile, rename, unlink, open } from 'node:fs/promises';
import { randomBytes, randomUUID, scrypt as scryptCallback, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { persistDurableSnapshot } from './durable-snapshot.js';

const scrypt = promisify(scryptCallback);
const USERNAME_RE = /^[A-Za-z0-9_]{3,18}$/;
// Deliberately conservative: this only validates a contact-style address. It does not verify mailbox ownership.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,63}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const DUMMY_SALT = Buffer.from('hamu-master-login-dummy', 'utf8');
const DUMMY_HASH = scryptSync('hamu-master-invalid-password', DUMMY_SALT, 32, SCRYPT_OPTIONS);

export const SESSION_COOKIE = 'hamu_session';
export const USERNAME_PATTERN = USERNAME_RE;

// Admin secret is never bundled in source. On first protected launch the launcher supplies
// HM_ADMIN_PASSWORD only to this server process; only a salted verifier is persisted.
const ADMIN_USERNAME = 'Samphor';


export class AuthError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    if (code) this.code = code;
  }
}

export function validUsername(value) {
  return typeof value === 'string' && USERNAME_RE.test(value);
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}
export function validEmail(value) { return normalizeEmail(value) !== null; }

// Public representations are safe for social/search/WebSocket APIs: never include email.
export function publicUser(user, isAdmin = false) {
  const result = { id: user.id, username: user.username, createdAt: user.createdAt };
  if (isAdmin) result.isAdmin = true;
  return result;
}
// This representation is returned only to the authenticated account owner over the account API.
export function selfUser(user, isAdmin = false) {
  return { ...publicUser(user, isAdmin), email: user.email || null, emailStatus: user.email ? 'unverified' : 'not_linked' };
}

function usernameKey(username) { return username.toLowerCase(); }
function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
function now() { return Date.now(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function atomicJson(file, value) {
  const dir = join(file, '..');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value) + '\n', 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, file);
    await persistDurableSnapshot(file.slice(file.lastIndexOf('/')+1), value);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

async function readJsonOr(file, fallback) {
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

class ScryptLimiter {
  constructor(limit = 4, queueLimit = 32) {
    this.limit = limit;
    this.queueLimit = queueLimit;
    this.active = 0;
    this.queue = [];
  }
  run(fn) {
    if (this.active >= this.limit && this.queue.length >= this.queueLimit) {
      return Promise.reject(new AuthError(503, 'Password service is busy. Try again shortly.'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }
  pump() {
    while (this.active < this.limit && this.queue.length) {
      const task = this.queue.shift();
      this.active++;
      Promise.resolve().then(task.fn).then(task.resolve, task.reject).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
}

export class AuthStore {
  constructor({ dataDir, beforeReady, beforeWrite, scryptLimit = 4, scryptQueueLimit = 32 } = {}) {
    if (!dataDir) throw new TypeError('dataDir is required');
    this.dataDir = dataDir;
    this.beforeWrite = beforeWrite;
    this.accountsFile = join(dataDir, 'accounts.json');
    this.sessionsFile = join(dataDir, 'sessions.json');
    this.adminFile = join(dataDir, 'admin-secret.json');
    this.adminVerifier = null;
    this.users = new Map();
    this.emails = new Map();
    this.sessions = new Map();
    this.writeChain = Promise.resolve();
    this.scryptLimiter = new ScryptLimiter(scryptLimit, scryptQueueLimit);
    this.ready = Promise.resolve(beforeReady).then(() => this._load());
  }

  async _load() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const accounts = await readJsonOr(this.accountsFile, { version: 1, users: [] });
    const sessions = await readJsonOr(this.sessionsFile, { version: 1, sessions: {} });
    if (!accounts || accounts.version !== 1 || !Array.isArray(accounts.users)) throw new Error('Invalid accounts store');
    if (!sessions || sessions.version !== 1 || !sessions.sessions || typeof sessions.sessions !== 'object') throw new Error('Invalid sessions store');
    for (let user of accounts.users) {
      if (!user || typeof user.id !== 'string' || !validUsername(user.username) || typeof user.createdAt !== 'string' || typeof user.passwordHash !== 'string') throw new Error('Invalid account record');
      const key = usernameKey(user.username);
      if (this.users.has(key)) throw new Error('Duplicate account record');
      if (user.email !== undefined && user.email !== null) {
        const email = normalizeEmail(user.email);
        if (!email) throw new Error('Invalid account email record');
        if (this.emails.has(email)) throw new Error('Duplicate account email record');
        this.emails.set(email, user.id);
        user = { ...user, email };
      }
      this.users.set(key, { ...user });
    }
    for (const [hash, session] of Object.entries(sessions.sessions)) {
      if (/^[a-f0-9]{64}$/.test(hash) && session && typeof session.userId === 'string' && Number.isFinite(session.createdAt) && Number.isFinite(session.expiresAt)) this.sessions.set(hash, { ...session });
    }
    await this._purgeExpired(false);
    await this._loadAdminVerifier();
  }


  async _loadAdminVerifier() {
    // START_GAME provisions HM_ADMIN_PASSWORD in the child server process. Keep a
    // compatibility fallback for Windows launches where the child environment is
    // not inherited correctly: a launcher-created verifier is still preferred.
    const bootstrap = process.env.HM_ADMIN_PASSWORD;
    const saved = await readJsonOr(this.adminFile, null);
    // Launcher-provisioned password wins over any stale verifier so START_GAME always
    // brings the whitelisted admin back to the configured credentials without prompts.
    if (validPassword(bootstrap)) {
      const salt = randomBytes(16);
      const derived = await this.scryptLimiter.run(() => scrypt(bootstrap, salt, 32, SCRYPT_OPTIONS));
      this.adminVerifier = `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
      await atomicJson(this.adminFile, { version: 1, username: ADMIN_USERNAME, passwordHash: this.adminVerifier, createdAt: saved?.createdAt || new Date().toISOString() });
    } else if (saved?.username === ADMIN_USERNAME && typeof saved.passwordHash === 'string') {
      this.adminVerifier = saved.passwordHash;
    }
    // Admin login is a separate credential, but it still needs a real account record
    // for the session/profile layer. Create only the missing whitelisted account; never
    // overwrite an existing account or its private data.
    if (this.adminVerifier && !this.users.has(usernameKey(ADMIN_USERNAME))) {
      const seedPassword = validPassword(bootstrap) ? bootstrap : randomBytes(24).toString('base64url');
      const salt = randomBytes(16);
      const derived = await this.scryptLimiter.run(() => scrypt(seedPassword, salt, 32, SCRYPT_OPTIONS));
      const passwordHash = `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
      const user = { id: randomUUID(), username: ADMIN_USERNAME, createdAt: new Date().toISOString(), passwordHash };
      const next = new Map(this.users); next.set(usernameKey(ADMIN_USERNAME), user);
      await this._saveAccounts(next);
      this.users = next;
    }
  }

  async _ensureReady() { await this.ready; }
  _withWriteLock(fn) {
    const result = this.writeChain.then(fn);
    this.writeChain = result.catch(() => {});
    return result;
  }
  async _beforeWrite() { if (this.beforeWrite) await this.beforeWrite(); }
  async _saveAccounts(users = this.users) {
    await this._beforeWrite();
    await atomicJson(this.accountsFile, { version: 1, users: [...users.values()] });
  }
  async _saveSessions(sessions = this.sessions) {
    await this._beforeWrite();
    await atomicJson(this.sessionsFile, { version: 1, sessions: Object.fromEntries(sessions) });
  }
  async _purgeExpired(persist = true) {
    const cutoff = now();
    const next = new Map([...this.sessions].filter(([, session]) => session.expiresAt > cutoff));
    if (next.size === this.sessions.size) return;
    if (persist) await this._withWriteLock(async () => {
      // Recheck while serialized so a newly-created session is never removed.
      const latest = new Map([...this.sessions].filter(([, session]) => session.expiresAt > now()));
      if (latest.size !== this.sessions.size) {
        await this._saveSessions(latest);
        this.sessions = latest;
      }
    });
    else this.sessions = next;
  }

  _assertRegistrationAvailable(username, normalizedEmail) {
    if (this.users.has(usernameKey(username))) throw new AuthError(409, 'That username is already registered. Choose another name, or log in to your existing account.', 'USERNAME_TAKEN');
    if (this.emails.has(normalizedEmail)) throw new AuthError(409, 'That email is already linked to an account. Log in with that email and its existing GAME password, or use a different email to create a new account.', 'EMAIL_TAKEN');
  }

  async checkRegistration(username, email) {
    if (!validUsername(username)) throw new AuthError(400, 'Username must be 3-18 ASCII letters, numbers, or underscores.', 'INVALID_USERNAME');
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new AuthError(400, 'Enter a valid Gmail or email address. It is stored as unverified contact/login information.', 'INVALID_EMAIL');
    await this._ensureReady();
    this._assertRegistrationAvailable(username, normalizedEmail);
    // A check does not reserve a name/email or create an account. Registration rechecks under the write lock.
    return { available: true, username, email: normalizedEmail };
  }

  async register(username, email, password) {
    if (!validUsername(username)) throw new AuthError(400, 'Username must be 3-18 ASCII letters, numbers, or underscores.');
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new AuthError(400, 'Enter a valid Gmail or email address. It is stored as unverified contact/login information.');
    if (!validPassword(password)) throw new AuthError(400, 'Password must be 8-128 characters.');
    await this.checkRegistration(username, normalizedEmail);
    const passwordHash = await this.scryptLimiter.run(async () => {
      const salt = randomBytes(16);
      const derived = await scrypt(password, salt, 32, SCRYPT_OPTIONS);
      return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
    });
    return this._withWriteLock(async () => {
      const key = usernameKey(username);
      this._assertRegistrationAvailable(username, normalizedEmail);
      const user = { id: randomUUID(), username, email: normalizedEmail, createdAt: new Date().toISOString(), passwordHash };
      const next = new Map(this.users);
      next.set(key, user);
      await this._saveAccounts(next);
      this.users = next;
      this.emails.set(normalizedEmail, user.id);
      return user;
    });
  }

  async _verify(password, encoded) {
    const parts = typeof encoded === 'string' ? encoded.split('$') : [];
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    if (n !== SCRYPT_OPTIONS.N || r !== SCRYPT_OPTIONS.r || p !== SCRYPT_OPTIONS.p) return false;
    let salt, expected;
    try { salt = Buffer.from(parts[4], 'base64url'); expected = Buffer.from(parts[5], 'base64url'); } catch { return false; }
    if (salt.length < 8 || expected.length !== 32) return false;
    const actual = await this.scryptLimiter.run(() => scrypt(password, salt, expected.length, SCRYPT_OPTIONS));
    return timingSafeEqual(Buffer.from(actual), expected);
  }

  async _createExclusiveSession(user, admin = false) {
    return this._withWriteLock(async () => {
      const token = randomBytes(32).toString('base64url');
      const hash = hashToken(token);
      const timestamp = now();
      const session = { userId: user.id, admin: Boolean(admin), createdAt: timestamp, expiresAt: timestamp + SESSION_MAX_AGE };
      // Exactly one live session per account: a successful new login atomically
      // revokes every older browser/device token belonging to this user.
      const next = new Map([...this.sessions].filter(([, existing]) => existing.userId !== user.id));
      next.set(hash, session);
      await this._saveSessions(next);
      this.sessions = next;
      return { token, tokenHash: hash, user };
    });
  }

  async login(identity, password) {
    if (typeof identity !== 'string' || !validPassword(password)) throw new AuthError(401, 'Invalid username/email or password.');
    await this._ensureReady();
    const email = normalizeEmail(identity);
    const user = email ? [...this.users.values()].find(candidate => candidate.id === this.emails.get(email)) : this.users.get(usernameKey(identity));
    const valid = await this._verify(password, user?.passwordHash || `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${DUMMY_SALT.toString('base64url')}$${DUMMY_HASH.toString('base64url')}`);
    if (!user || !valid) throw new AuthError(401, 'Invalid username or password.');
    return this._createExclusiveSession(user, false);
  }

  async adminLogin(identity, password) {
    if (typeof identity !== 'string' || identity.trim().toLowerCase() !== ADMIN_USERNAME.toLowerCase() || !validPassword(password)) throw new AuthError(401, 'Invalid admin name or password.');
    await this._ensureReady();
    if (!this.adminVerifier) throw new AuthError(503, 'Admin access is not initialized on this server. Restart START_GAME and set the admin password.');
    const user = this.users.get(usernameKey(ADMIN_USERNAME));
    const valid = await this._verify(password, this.adminVerifier);
    if (!user || !valid) throw new AuthError(401, 'Invalid admin name or password.');
    return this._createExclusiveSession(user, true);
  }

  async sessionForToken(token) {
    await this._ensureReady();
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
    const hash = hashToken(token), session = this.sessions.get(hash);
    if (!session || session.expiresAt <= now()) return null;
    const user = [...this.users.values()].find(candidate => candidate.id === session.userId);
    return user ? { user, admin: Boolean(session.admin) } : null;
  }

  async isAdminToken(token) {
    const session = await this.sessionForToken(token);
    return Boolean(session?.admin);
  }

  async linkEmail(userId, email, password) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new AuthError(400, 'Enter a valid email address.');
    if (!validPassword(password)) throw new AuthError(401, 'Enter your current GAME password to link an email.');
    await this._ensureReady();
    const current = [...this.users.values()].find(user => user.id === userId);
    const valid = await this._verify(password, current?.passwordHash || `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${DUMMY_SALT.toString('base64url')}$${DUMMY_HASH.toString('base64url')}`);
    if (!current || !valid) throw new AuthError(401, 'Your GAME password was incorrect.');
    return this._withWriteLock(async () => {
      const latest = [...this.users.values()].find(user => user.id === userId);
      if (!latest) throw new AuthError(404, 'Account not found.');
      const owner = this.emails.get(normalizedEmail);
      if (owner && owner !== userId) throw new AuthError(409, 'That email is already linked to another account.');
      if (latest.email === normalizedEmail) return latest;
      const updated = { ...latest, email: normalizedEmail };
      const next = new Map(this.users);
      next.set(usernameKey(updated.username), updated);
      await this._saveAccounts(next);
      if (latest.email) this.emails.delete(latest.email);
      this.emails.set(normalizedEmail, userId);
      this.users = next;
      return updated;
    });
  }

  async userForToken(token) {
    await this._ensureReady();
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
    return this.userForSessionHash(hashToken(token));
  }

  userForSessionHash(hash) {
    const session = this.sessions.get(hash);
    if (!session || session.expiresAt <= now()) return null;
    return [...this.users.values()].find(user => user.id === session.userId) || null;
  }

  sessionValid(hash) {
    const session = this.sessions.get(hash);
    return Boolean(session && session.expiresAt > now() && [...this.users.values()].some(user => user.id === session.userId));
  }

  async logout(token) {
    await this._ensureReady();
    if (typeof token !== 'string') return;
    const hash = hashToken(token);
    return this._withWriteLock(async () => {
      if (!this.sessions.has(hash)) return;
      const next = new Map(this.sessions);
      next.delete(hash);
      await this._saveSessions(next);
      this.sessions = next;
      return hash;
    });
  }

  async availability(username) {
    await this._ensureReady();
    return !this.users.has(usernameKey(username));
  }

  async purgeExpired() { await this._ensureReady(); await this._purgeExpired(true); }
}

export function cookieValue(header, name = SESSION_COOKIE) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

export function sessionCookie(token, secure = false, maxAge = SESSION_MAX_AGE, sameSite = 'Strict') {
  const site = sameSite === 'None' ? 'None' : 'Strict';
  return `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=${site}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = false, sameSite = 'Strict') { return sessionCookie('', secure, 0, sameSite); }
export { SESSION_MAX_AGE };
