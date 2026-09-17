import { mkdir, readFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { persistDurableSnapshot } from './durable-snapshot.js';
import { randomBytes, randomUUID } from 'node:crypto';

function clone(x) { return JSON.parse(JSON.stringify(x)); }
async function atomicJson(file, value) {
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  let h;
  try {
    h = await open(temp, 'wx', 0o600); await h.writeFile(JSON.stringify(value) + '\n', 'utf8'); await h.sync(); await h.close(); h = undefined;
    await rename(temp, file);
    await persistDurableSnapshot(file.slice(file.lastIndexOf('/')+1), value);
  } catch (e) { if (h) await h.close().catch(() => {}); await unlink(temp).catch(() => {}); throw e; }
}
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
function validId(x) { return typeof x === 'string' && x.length >= 8 && x.length <= 80; }

/** Durable social graph. All mutations are serialized and committed atomically. */
export class SocialStore {
  constructor({ dataDir, file, beforeReady, beforeWrite } = {}) {
    if (!dataDir && !file) throw new TypeError('dataDir or file is required');
    this.file = file || join(dataDir, 'social.json');
    this.beforeWrite = beforeWrite;
    this.friends = new Map();
    this.requests = new Map();
    this.writeChain = Promise.resolve();
    this.ready = Promise.resolve(beforeReady).then(() => this._load());
  }
  async _load() {
    const value = await readJson(this.file, { version: 1, friends: {}, requests: {} });
    if (!value || value.version !== 1 || !value.friends || typeof value.friends !== 'object' || !value.requests || typeof value.requests !== 'object') throw new Error('Invalid social store');
    for (const [id, list] of Object.entries(value.friends)) if (validId(id) && Array.isArray(list)) this.friends.set(id, new Set(list.filter(validId).filter(x => x !== id)));
    let repaired = false;
    for (const [id, set] of this.friends) for (const other of set) {
      if (!this.friends.get(other)?.has(id)) { this._friends(other).add(id); repaired = true; }
    }
    for (const [id, r] of Object.entries(value.requests)) if (validId(id) && r && validId(r.from) && validId(r.to) && r.from !== r.to && Number.isFinite(r.createdAt)) this.requests.set(id, { id, from: r.from, to: r.to, createdAt: r.createdAt });
    if (repaired) await this._save();
  }
  async _ready() { await this.ready; }
  _mutate(fn) { const p = this.writeChain.then(fn); this.writeChain = p.catch(() => {}); return p; }
  async _save() {
    if (this.beforeWrite) await this.beforeWrite();
    const friends = Object.fromEntries([...this.friends].map(([id, set]) => [id, [...set]]));
    const requests = Object.fromEntries(this.requests);
    await atomicJson(this.file, { version: 1, friends, requests });
  }
  _friends(id) { if (!this.friends.has(id)) this.friends.set(id, new Set()); return this.friends.get(id); }
  _isFriend(a, b) { return this.friends.get(a)?.has(b) || false; }
  _findRequest(id) { return typeof id === 'string' ? this.requests.get(id) : null; }
  _public(id, actorId, auth, presence) {
    const user = [...auth.users.values()].find(u => u.id === id);
    if (!user) return null;
    let status = 'offline';
    if (presence) status = presence(id) || 'offline';
    let relationship = 'none';
    if (id === actorId) relationship = 'self';
    else if (this._isFriend(actorId, id)) relationship = 'friend';
    else if ([...this.requests.values()].some(r => r.from === id && r.to === actorId)) relationship = 'incoming';
    else if ([...this.requests.values()].some(r => r.from === actorId && r.to === id)) relationship = 'outgoing';
    return { id: user.id, username: user.username, createdAt: user.createdAt, online: status !== 'offline', status, relationship };
  }
  profile(id, actorId, auth, presence) { return this._public(id, actorId, auth, presence); }
  search(query, actorId, auth, presence) {
    if (typeof query !== 'string' || query.length < 2) return { users: [], truncated: false };
    const q = query.toLocaleLowerCase();
    const users = [...auth.users.values()].filter(u => u.username.toLocaleLowerCase().includes(q));
    users.sort((a, b) => {
      const ae = a.username.toLocaleLowerCase() === q ? 0 : 1, be = b.username.toLocaleLowerCase() === q ? 0 : 1;
      return ae - be || a.username.localeCompare(b.username);
    });
    const truncated = users.length > 20;
    return { users: users.slice(0, 20).map(u => this._public(u.id, actorId, auth, presence)), truncated };
  }
  directory(query, offset, limit, actorId, auth, presence) {
    if (typeof query !== 'string' || query.length > 18 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 24) throw new Error('Invalid directory request.');
    const q=query.trim().toLocaleLowerCase();
    const matches=[...auth.users.values()].filter(u=>u.id!==actorId&&(!q||u.username.toLocaleLowerCase().includes(q)));
    matches.sort((a,b)=>Number(b.username.toLocaleLowerCase()===q)-Number(a.username.toLocaleLowerCase()===q)||a.username.localeCompare(b.username)||a.id.localeCompare(b.id));
    const start=Math.min(offset,Math.max(0,Math.floor((matches.length-1)/limit)*limit));
    const users=matches.slice(start,start+limit).map(u=>this._public(u.id,actorId,auth,presence));
    return {users,total:matches.length,offset:start,limit,hasMore:start+users.length<matches.length};
  }
  async ensureFriend(a, b, auth) {
    await this._ready();
    if (!validId(a) || !validId(b) || a === b) throw new Error('Invalid friendship.');
    if (![...auth.users.values()].some(u => u.id === a) || ![...auth.users.values()].some(u => u.id === b)) throw new Error('User not found.');
    return this._mutate(async () => {
      this._friends(a).add(b);
      this._friends(b).add(a);
      for (const [id, r] of this.requests) {
        if ((r.from === a && r.to === b) || (r.from === b && r.to === a)) this.requests.delete(id);
      }
      await this._save();
      return true;
    });
  }
  async request(from, to, auth) {
    await this._ready();
    if (!validId(to) || from === to || ![...auth.users.values()].some(u => u.id === to)) throw new Error('User not found.');
    if (this._isFriend(from, to)) throw new Error('You are already friends.');
    if ([...this.requests.values()].some(r => r.from === from && r.to === to)) throw new Error('Friend request already pending.');
    if ([...this.requests.values()].some(r => r.from === to && r.to === from)) throw new Error('This user has already requested you.');
    const count = [...this.requests.values()].filter(r => r.from === from || r.to === from).length + (this.friends.get(from)?.size || 0);
    if (count >= 100) throw new Error('Friend request limit reached.');
    const id = randomUUID(), record = { id, from, to, createdAt: Date.now() };
    return this._mutate(async () => {
      // Recheck inside the serialized section so concurrent sends cannot create
      // two durable requests after both passed the optimistic checks above.
      if (this._isFriend(from, to) || [...this.requests.values()].some(r => r.from === from && r.to === to)) throw new Error('Friend request already pending.');
      if ([...this.requests.values()].some(r => r.from === to && r.to === from)) throw new Error('This user has already requested you.');
      this.requests.set(id, record); await this._save(); return clone(record);
    });
  }
  async respond(actor, id, accept, auth) {
    await this._ready();
    const r = this._findRequest(id); if (!r || r.to !== actor) throw new Error('Friend request not found.');
    return this._mutate(async () => {
      const latest = this._findRequest(id); if (!latest || latest.to !== actor) throw new Error('Friend request not found.');
      if (accept && (this._friends(latest.from).size >= 100 || this._friends(latest.to).size >= 100)) throw new Error('Friend limit reached.');
      this.requests.delete(id);
      if (accept) { this._friends(latest.from).add(latest.to); this._friends(latest.to).add(latest.from); }
      await this._save(); return { accepted: Boolean(accept), from: latest.from, to: latest.to };
    });
  }
  async cancel(actor, id, auth) {
    await this._ready(); const r = this._findRequest(id); if (!r || r.from !== actor) throw new Error('Friend request not found.');
    return this._mutate(async () => { const latest = this._findRequest(id); if (!latest || latest.from !== actor) throw new Error('Friend request not found.'); this.requests.delete(id); await this._save(); return { from: latest.from, to: latest.to }; });
  }
  async remove(actor, other, auth) {
    await this._ready(); if (!validId(other) || !this._isFriend(actor, other)) throw new Error('Friend not found.');
    return this._mutate(async () => { this._friends(actor).delete(other); this._friends(other).delete(actor); await this._save(); return true; });
  }
  async state(actor, auth, presence) {
    await this._ready();
    const friends = [...this._friends(actor)].map(id => this._public(id, actor, auth, presence)).filter(Boolean).sort((a,b)=>a.username.localeCompare(b.username));
    const incoming = [...this.requests.values()].filter(r => r.to === actor).map(r => ({ id:r.id, from:this._public(r.from,actor,auth,presence), to:this._public(r.to,actor,auth,presence), createdAt:r.createdAt })).filter(r=>r.from&&r.to);
    const outgoing = [...this.requests.values()].filter(r => r.from === actor).map(r => ({ id:r.id, from:this._public(r.from,actor,auth,presence), to:this._public(r.to,actor,auth,presence), createdAt:r.createdAt })).filter(r=>r.from&&r.to);
    return { friends, incoming, outgoing };
  }
}
