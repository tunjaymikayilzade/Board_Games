import { DurableObject } from 'cloudflare:workers';

const TTL_MS = 4 * 3600 * 1000;   // entries that were not refreshed for 4 hours disappear from the list
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// The list of public games shown on the home page. Rooms report to it whenever they change.
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = {};
    ctx.blockConcurrencyWhile(async () => { this.rooms = (await ctx.storage.get('rooms')) || {}; });
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/upsert' || path === '/remove') {
      const s = await request.json();
      if (!s || !s.id) return json({ error: 'bad' }, 400);
      if (path === '/upsert') this.rooms[s.id] = { ...s, ts: Date.now() }; else delete this.rooms[s.id];
      await this.ctx.storage.put('rooms', this.rooms);
      return json({ ok: true });
    }
    if (path === '/list') {
      const now = Date.now(); let pruned = false;
      for (const [id, r] of Object.entries(this.rooms)) if (now - r.ts > TTL_MS) { delete this.rooms[id]; pruned = true; }
      if (pruned) await this.ctx.storage.put('rooms', this.rooms);
      // open games waiting for an opponent first (newest first), then running games with the most moves
      const all = Object.values(this.rooms);
      all.sort((a, b) => (a.status !== 'waiting') - (b.status !== 'waiting') || (a.status === 'waiting' ? b.ts - a.ts : b.moves - a.moves));
      return json({ rooms: all.slice(0, 50).map(({ ts, ...r }) => r) });
    }
    return json({ error: 'Not found' }, 404);
  }
}
