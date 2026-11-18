import { DurableObject } from 'cloudflare:workers';
import { Game, ApiError, parseCreate } from './game.js';

const IDLE_MS = 3 * 3600 * 1000;      // a room nobody has touched for 3 hours is deleted
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// One Durable Object = one room. It keeps the game in memory, saves it to storage after every change,
// pushes a personal snapshot to every connected WebSocket and wakes up (alarm) when a clock runs out.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.g = null; this.lastVersion = -1; this.lastSum = null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));   // keep-alive without waking the room
    ctx.blockConcurrencyWhile(async () => {
      const s = await ctx.storage.get('g');
      if (s) { this.g = Game.from(s); this.lastVersion = this.g.version; }
    });
  }

  // ---------- presence ----------
  refreshOnline(exclude) {
    const set = new Set(), skip = exclude && exclude.deserializeAttachment() ? exclude.deserializeAttachment().id : null;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState > 1) continue;                    // closing or closed
      const a = ws.deserializeAttachment();
      if (!a || !a.t || (skip && a.id === skip)) continue;
      set.add(a.t);
    }
    if (this.g) this.g.onlineTokens = set;
    return set;
  }
  socketsOf(token) {
    return this.ctx.getWebSockets().filter(ws => { const a = ws.deserializeAttachment(); return a && a.t === token; });
  }

  // ---------- change handling ----------
  broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a) continue;
      try { ws.send(JSON.stringify({ t: 'state', s: this.g.snapshot(a.t) })); } catch { /* socket is closing */ }
    }
  }
  async syncLobby() {
    const g = this.g;
    if (!g) return;
    const sum = g.lobbySummary(), key = sum ? JSON.stringify(sum) : null;
    if (key === this.lastSum) return;
    this.lastSum = key;
    try {
      const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
      await lobby.fetch('https://lobby/' + (sum ? 'upsert' : 'remove'), { method: 'POST', body: JSON.stringify(sum || { id: g.id }) });
    } catch { /* the list is only a convenience */ }
  }
  // Call after anything that may have changed the game.
  async commit() {
    const g = this.g;
    this.refreshOnline();
    if (g.version !== this.lastVersion) {
      this.lastVersion = g.version;
      await this.ctx.storage.put('g', g.toJSON());
      this.broadcast();
      await this.syncLobby();
    }
    await this.reschedule();
  }
  async reschedule() {
    const g = this.g, now = Date.now();
    let t = g.nextDeadline();
    if (t !== null) t += 25;
    let idleAt = g.touched + IDLE_MS;
    if (idleAt <= now) idleAt = now + 30 * 60 * 1000;   // someone is still connected: look again later
    t = t === null ? idleAt : Math.min(t, idleAt);
    await this.ctx.storage.setAlarm(Math.max(t, now + 50));
  }
  async alarm() {
    const g = this.g;
    if (!g) return;
    this.refreshOnline();
    if (this.ctx.getWebSockets().length === 0 && Date.now() - g.touched > IDLE_MS) { await this.destroy(); return; }
    g.checkTime();
    await this.commit();
  }

  // Closes the room for everybody: connections are dropped, the saved game is deleted, it leaves the public list.
  async destroy() {
    const g = this.g;
    if (!g) return;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ t: 'closed' })); } catch { /* closing */ }
      try { ws.close(4000, 'Room closed'); } catch { /* already closed */ }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.g = null; this.lastSum = null; this.lastVersion = -1;
    try { const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby')); await lobby.fetch('https://lobby/remove', { method: 'POST', body: JSON.stringify({ id: g.id }) }); } catch { /* the list is only a convenience */ }
  }

  // ---------- HTTP / WebSocket entry ----------
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path.startsWith('/ws/')) return this.upgrade(request, url);
      if (path === '/api/create') return await this.create(request);
      const g = this.g;
      if (!g) throw new ApiError('Room not found', 404);
      this.refreshOnline();
      if (request.method === 'GET') {
        if (path === '/api/state') return json(g.snapshot(url.searchParams.get('token') || ''));
        if (path === '/api/room') return json(g.info());
        throw new ApiError('Not found', 404);
      }
      let b;
      try { b = await request.json(); } catch { throw new ApiError('Invalid JSON'); }
      if (!b || typeof b !== 'object') throw new ApiError('Invalid JSON');
      let out = { ok: true };
      if (path === '/api/close') { await this.destroy(); return json(out); }
      switch (path) {
        case '/api/join': out = g.join(b.token, b.name, !!b.spectate); break;
        case '/api/move': g.doMove(b.token, b.mv, b.end === undefined ? true : !!b.end, b.over, b.insuf); break;
        case '/api/action': g.action(b.token, b.type, b.side, b.reason); break;
        case '/api/chat': g.addChat(b.token, b.text); break;
        case '/api/domino': g.domOp(b.token, b.op, b.tile, b.side); break;
        case '/api/voice': g.voiceSet(b.token, !!b.on); break;
        case '/api/signal': {
          if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) throw new ApiError('Invalid signal');
          const r = g.signal(b.token, String(b.to || ''), b.data);
          if (r) for (const ws of this.socketsOf(r.to)) { try { ws.send(JSON.stringify(r.msg)); } catch { /* closing */ } }
          break;
        }
        default: throw new ApiError('Not found', 404);
      }
      await this.commit();
      return json(out);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message }, e.code);
      console.error(e);
      return json({ error: 'Server error' }, 500);
    }
  }

  async create(request) {
    if (this.g) return json({ error: 'exists' }, 409);
    const b = await request.json();
    const { game, token } = Game.create(String(b.id), parseCreate(b));
    this.g = game;
    this.lastVersion = game.version;
    await this.ctx.storage.put('g', game.toJSON());
    await this.syncLobby();
    await this.reschedule();
    return json({ room: game.id, token, role: game.role(token) });
  }

  upgrade(request, url) {
    const g = this.g;
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (!g) return json({ error: 'Room not found' }, 404);
    const token = url.searchParams.get('token') || '';
    if (g.role(token) === 's' && !g.specs[token]) return json({ error: 'Join the room first' }, 403);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ t: token, id: crypto.randomUUID() });
    this.presenceChanged();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // someone connected or left: everybody gets a fresh snapshot (online dots, spectator list, voice roster)
  presenceChanged(closing) {
    const g = this.g;
    if (!g) return;
    this.ctx.waitUntil((async () => {
      const online = this.refreshOnline(closing);
      for (const t of Object.keys(g.voice)) if (!online.has(t)) delete g.voice[t];   // left without ending voice
      g.bump();
      await this.commit();
    })());
  }
  webSocketMessage() { /* all actions are HTTP calls; only the keep-alive ping arrives here and is auto-answered */ }
  webSocketClose(ws) { try { ws.close(); } catch { /* already closed */ } this.presenceChanged(ws); }
  webSocketError(ws) { this.presenceChanged(ws); }
}
