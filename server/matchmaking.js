import { randomUUID } from 'node:crypto';

const MODES = new Set(['tdm', 'dom', 'ffa']);
const capFor = mode => mode === 'ffa' ? 8 : 4;
const sizeOf = ticket => ticket.players.length;

function cloneParty(p) { return p ? { id:p.id, leaderId:p.leaderId, mode:p.mode, status:p.status, roomId:p.roomId ?? null, maxSize:p.maxSize, members:p.members.map(m=>({id:m.id,username:m.username,ready:!!m.ready,online:m.online !== false,operator:m.operator||'sentinel',loadout:Array.isArray(m.loadout)?m.loadout.slice(0,3):['ar4','relay9','edge']})) } : null; }

/** In-memory FIFO party queue. Persistence is intentionally not used: parties and matches are volatile. */
export class Matchmaking {
  constructor({ queueWaitMs=15000, now=()=>Date.now(), onMatch=()=>{}, onBackfill=()=>{}, onState=()=>{}, maxParty=4, capacity=8 }={}) {
    this.queueWaitMs = Math.max(0, Number(queueWaitMs) || 0); this.now = now; this.onMatch=onMatch; this.onBackfill=onBackfill; this.onState=onState; this.maxParty=maxParty; this.capacity=capacity;
    this.parties=new Map(); this.byUser=new Map(); this.tickets=new Map(); this.matches=new Map(); this.ticketOrder=0;
  }
  ensureParty(user, username, online=true) {
    const existing=this.byUser.get(user);
    if(existing) {
      const p=this.parties.get(existing);
      if(p) { const m=p.members.find(x=>x.id===user); if(m) { m.username=username||m.username; if(online)m.online=true; } return p; }
      this.byUser.delete(user);
    }
    const party={id:randomUUID(),leaderId:user,mode:'tdm',status:'idle',roomId:null,maxSize:4,members:[{id:user,username,ready:true,online:!!online,operator:'sentinel',loadout:['ar4','relay9','edge']}]};
    this.parties.set(party.id,party); this.byUser.set(user,party.id); return party;
  }
  partyFor(user) { return this.parties.get(this.byUser.get(user)); }
  emit(p) { this.onState(p.id,cloneParty(p)); }
  setOnline(user, online) { const p=this.partyFor(user); if(p){const m=p.members.find(x=>x.id===user);if(m)m.online=!!online;this.emit(p);} }
  addMember(partyId, user, username, online=true, kit={}) { const p=this.parties.get(partyId); if(!p||p.status!=='idle'||p.members.length>=p.maxSize)return false; if(this.byUser.has(user))return false;const loadout=Array.isArray(kit.loadout)?kit.loadout.slice(0,3):['ar4','relay9','edge'];const operator=typeof kit.operator==='string'?kit.operator:'sentinel';p.members.push({id:user,username,ready:true,online:!!online,operator,loadout});this.byUser.set(user,partyId);this.emit(p);return true; }
  removeMember(user) {
    const p=this.partyFor(user); if(!p)return null;
    const i=p.members.findIndex(m=>m.id===user); if(i<0)return null; p.members.splice(i,1);this.byUser.delete(user);
    if(p.members.length===0){this.cancel(p.id);this.parties.delete(p.id);return null;}
    if(p.leaderId===user){p.leaderId=p.members[0].id; for(const m of p.members)m.ready=false;p.members[0].ready=true;}
    if(p.status==='queued')this.cancel(p.id);
    if(p.status!=='matched'||p.members.length===0){p.status='idle';p.roomId=null;}
    this.emit(p);return p;
  }
  setMode(user, mode) {
    const p=this.partyFor(user);if(!p||p.leaderId!==user||p.status!=='idle'||!MODES.has(mode))return false;
    const maxSize=4;
    if(p.members.length>maxSize)return false;
    p.maxSize=maxSize;p.mode=mode;for(const m of p.members)if(m.id!==p.leaderId)m.ready=false;this.emit(p);return true;
  }
  setReady(user, ready) { const p=this.partyFor(user);if(!p||p.status!=='idle')return false;const m=p.members.find(x=>x.id===user);if(!m)return false;if(m.id===p.leaderId)m.ready=true;else m.ready=!!ready;this.emit(p);if(!m.ready)this.cancel(p.id);return true; }
  queue(partyId, mode, players) {
    const p=this.parties.get(partyId);if(!p||p.status!=='idle'||(mode&&mode!==p.mode)||!MODES.has(p.mode))throw new Error('Party is not available for matchmaking.');
    if(p.members.some(m=>!m.online)||p.members.some(m=>!m.ready))throw new Error('All party members must be online and ready.');
    if(this.tickets.has(p.id))throw new Error('Party is already searching.');
    const ticket={partyId:p.id,mode:p.mode,startedAt:this.now(),players:players.map(x=>({...x})),order:this.ticketOrder++};
    if(ticket.players.length<1||ticket.players.length>p.maxSize)throw new Error('Invalid party size.');
    p.status='queued';this.tickets.set(p.id,ticket);this.emit(p);this.match();return ticket;
  }
  cancel(partyId) { const t=this.tickets.get(partyId);if(t)this.tickets.delete(partyId);const p=this.parties.get(partyId);if(p){if(p.status==='queued')p.status='idle';this.emit(p);}return !!t; }
  cancelForUser(user) { const p=this.partyFor(user);return p?this.cancel(p.id):false; }
  cancelForMember(user) { const p=this.partyFor(user);if(!p||p.status!=='queued')return false;const m=p.members.find(x=>x.id===user);if(!m||m.id===p.leaderId)return false;m.ready=false;this.cancel(p.id);return true; }

  // Find an exact two-bin packing instead of assigning greedily.  This keeps
  // ticket order for the search while allowing (1,1,3,3), for example, to fit.
  _assignment(tickets, initialCounts=[0,0]) {
    const mode=tickets[0]?.mode;if(!mode)return null;
    if(mode==='ffa') { let n=initialCounts[0]||0; const out=[]; for(const t of tickets){n+=sizeOf(t);if(n>this.capacity)return null;out.push({ticket:t,team:undefined});} return out; }
    const limit=capFor(mode), start=[Number(initialCounts[0])||0,Number(initialCounts[1])||0];
    if(start[0]>limit||start[1]>limit)return null;
    const out=[];
    const visit=(i,a,b)=>{
      if(i===tickets.length)return true;
      const t=tickets[i],n=sizeOf(t);
      if(a+n<=limit){out.push({ticket:t,team:0});if(visit(i+1,a+n,b))return true;out.pop();}
      if(b+n<=limit){out.push({ticket:t,team:1});if(visit(i+1,a,b+n))return true;out.pop();}
      return false;
    };
    return visit(0,start[0],start[1])?out.slice():null;
  }
  _ordered(mode) { return [...this.tickets.values()].filter(t=>t.mode===mode).sort((a,b)=>a.startedAt-b.startedAt||a.order-b.order); }
  _bestSelection(mode, candidates, initialCounts=[0,0], forceFirst=false) {
    if (!candidates.length) return null;
    const capacity = this.capacity;
    const start = [Number(initialCounts[0]) || 0, Number(initialCounts[1]) || 0];
    if (mode === 'ffa') {
      const used = start[0];
      if (used >= capacity) return null;
      const memo = new Map();
      const solve = (i, remaining) => {
        if (i >= candidates.length || remaining <= 0) return { total: 0, picks: [] };
        const key = `${i}|${remaining}`;
        if (memo.has(key)) return memo.get(key);
        const skip = solve(i + 1, remaining);
        let best = { total: skip.total, picks: skip.picks };
        const size = sizeOf(candidates[i]);
        if (size <= remaining) {
          const take = solve(i + 1, remaining - size);
          const candidate = { total: take.total + size, picks: [i, ...take.picks] };
          if (candidate.total > best.total ||
              (candidate.total === best.total && candidate.picks.join(',') < best.picks.join(','))) best = candidate;
        }
        memo.set(key, best);
        return best;
      };
      const required = forceFirst ? candidates[0] : null;
      if (required) {
        if (sizeOf(required) > capacity - used) return null;
        const rest = solve(1, capacity - used - sizeOf(required));
        return {
          selected: [required, ...rest.picks.map(i => candidates[i])],
          assignments: [{ ticket: required, team: undefined }, ...rest.picks.map(i => ({ ticket: candidates[i], team: undefined }))]
        };
      }
      const best = solve(0, capacity - used);
      if (!best.total) return null;
      return {
        selected: best.picks.map(i => candidates[i]),
        assignments: best.picks.map(i => ({ ticket: candidates[i], team: undefined }))
      };
    }

    const limit = capFor(mode);
    if (start[0] > limit || start[1] > limit) return null;
    const memo = new Map();
    const compare = (a, b) => {
      if (a.total !== b.total) return a.total > b.total ? a : b;
      const aa = a.picks.map(x => x.i), bb = b.picks.map(x => x.i);
      const n = Math.max(aa.length, bb.length);
      for (let i = 0; i < n; i++) {
        if (aa[i] === undefined) return a;
        if (bb[i] === undefined) return b;
        if (aa[i] !== bb[i]) return aa[i] < bb[i] ? a : b;
      }
      return a;
    };
    const solve = (i, a, b) => {
      if (i >= candidates.length || (a >= limit && b >= limit)) return { total: 0, picks: [] };
      const key = `${i}|${a}|${b}`;
      if (memo.has(key)) return memo.get(key);
      let best = solve(i + 1, a, b);
      const size = sizeOf(candidates[i]);
      if (a + size <= limit) {
        const take = solve(i + 1, a + size, b);
        best = compare(best, { total: take.total + size, picks: [{ i, team: 0 }, ...take.picks] });
      }
      if (b + size <= limit) {
        const take = solve(i + 1, a, b + size);
        best = compare(best, { total: take.total + size, picks: [{ i, team: 1 }, ...take.picks] });
      }
      memo.set(key, best);
      return best;
    };
    if (forceFirst) {
      const first = candidates[0], size = sizeOf(first);
      const options = [];
      if (start[0] + size <= limit) {
        const rest = solve(1, start[0] + size, start[1]);
        options.push({ total: rest.total + size, picks: [{ i: 0, team: 0 }, ...rest.picks] });
      }
      if (start[1] + size <= limit) {
        const rest = solve(1, start[0], start[1] + size);
        options.push({ total: rest.total + size, picks: [{ i: 0, team: 1 }, ...rest.picks] });
      }
      if (!options.length) return null;
      const best = options.reduce(compare);
      return { selected: best.picks.map(x => candidates[x.i]), assignments: best.picks.map(x => ({ ticket: candidates[x.i], team: x.team })) };
    }
    const best = solve(0, start[0], start[1]);
    if (!best.total) return null;
    return { selected: best.picks.map(x => candidates[x.i]), assignments: best.picks.map(x => ({ ticket: candidates[x.i], team: x.team })) };
  }

  _select(mode) {
    const candidates = this._ordered(mode);
    if (!candidates.length) return [];
    const best = this._bestSelection(mode, candidates, [0, 0], true);
    return best?.selected || [];
  }

  _dispatch(selected, timedOut=false) {
    const ass=this._assignment(selected);if(!ass||ass.length!==selected.length)return false;const players=[];
    for(const a of ass)for(const player of a.ticket.players)players.push({...player,team:a.team});
    const mode=selected[0].mode, partyIds=selected.map(t=>t.partyId);for(const t of selected)this.tickets.delete(t.partyId);
    const match={id:randomUUID(),mode,partyIds,players,assignments:ass.map(a=>({partyId:a.ticket.partyId,team:a.team,count:a.ticket.players.length})),startedAt:this.now(),timedOut,livePlayers:new Set(players.map(p=>p.accountId)),humanCount:players.length,teamCounts:[0,0]};
    for(const id of partyIds){const p=this.parties.get(id);if(p){p.status='matched';p.roomId=match.id;this.emit(p);}}
    const result=this.onMatch(match);
    if(!result){ for(const id of partyIds){const p=this.parties.get(id);if(p){p.status='idle';p.roomId=null;this.emit(p);}} return false; }
    match.roomId=result.roomId||match.id;match.room=result.room||null;
    for(const p of players)if(p.team===0||p.team===1)match.teamCounts[p.team]++;
    // The callback may allocate the actual Q-room id. Publish that id, not the
    // provisional match UUID emitted before onMatch ran.
    for(const id of partyIds){const p=this.parties.get(id);if(p){p.roomId=match.roomId;this.emit(p);}}
    this.matches.set(match.id,match);return true;
  }
  match() {
    for(const mode of ['tdm','dom','ffa']) { let guard=0; while(guard++<this.tickets.size+1){const selected=this._select(mode);if(!selected.length)break;const n=selected.reduce((x,t)=>x+sizeOf(t),0);if(n===this.capacity){this._dispatch(selected,false);continue;}const oldest=selected[0];if(this.now()-oldest.startedAt>=this.queueWaitMs){this._dispatch(selected,true);continue;}break;} }
    this._backfill();
  }
  _backfill() {
    for(const match of this.matches.values()) {
      if(match.humanCount>=this.capacity)continue;
      const candidates=this._ordered(match.mode);
      const packed=this._bestSelection(
        match.mode,
        candidates,
        match.mode==='ffa'?[match.humanCount,0]:match.teamCounts,
        false
      );
      const selected=packed?.selected || [];
      const ass=packed?.assignments || [];
      if(!selected.length)continue;
      const players=[];for(const a of ass)for(const p of a.ticket.players)players.push({...p,team:a.team});for(const t of selected)this.tickets.delete(t.partyId);
      const ok=this.onBackfill(match,{players,assignments:ass});if(!ok) { for(const t of selected)this.tickets.set(t.partyId,t);continue; }
      for(const t of selected){const p=this.parties.get(t.partyId);if(p){p.status='matched';p.roomId=match.roomId||match.id;this.emit(p);}}
      match.humanCount+=players.length;for(const p of players)if(p.team===0||p.team===1)match.teamCounts[p.team]++;
      for(const p of players)match.livePlayers.add(p.accountId);
    }
  }
  tick() { this.match(); }
  leaveMatch(user) {
    for(const match of this.matches.values()) if(match.livePlayers?.has(user)) {
      match.livePlayers.delete(user);match.humanCount=Math.max(0,match.humanCount-1);
      const departed=match.players.find(x=>x.accountId===user);if(departed&&(departed.team===0||departed.team===1))match.teamCounts[departed.team]=Math.max(0,match.teamCounts[departed.team]-1);
      for(const p of match.partyIds.map(id=>this.parties.get(id)).filter(Boolean)) {
        const live=p.members.some(m=>match.livePlayers.has(m.id));
        if(!live&&p.status==='matched'){p.status='idle';p.roomId=null;for(const m of p.members)if(m.id!==p.leaderId)m.ready=false;this.emit(p);}
      }
      return match;
    }
    const p=this.partyFor(user);if(p?.status==='matched'){p.status='idle';p.roomId=null;this.emit(p);}
    return null;
  }
  removeMatch(id) { return this.matches.delete(id); }
  snapshot(user) { return cloneParty(this.partyFor(user)); }
}
export default Matchmaking;
