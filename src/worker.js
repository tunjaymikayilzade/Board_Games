import { newRoomId } from './game.js';
export { Room } from './room.js';
export { Lobby } from './lobby.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// Routes /api/* and /ws/* to the right room. Everything else is the static site in ./public
// (served by Cloudflare directly, see "assets" in wrangler.jsonc).
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    const room = code => env.ROOM.get(env.ROOM.idFromName(code));

    if (path === '/api/rooms') return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch('https://lobby/list');

    if (path.startsWith('/ws/')) {
      const code = cleanCode(path.slice(4));
      if (!code) return json({ error: 'Room not found' }, 404);
      return room(code).fetch(request);
    }

    if (path === '/api/create') {
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
      const text = await request.text();
      if (text.length > 20000) return json({ error: 'Request too large' }, 413);
      let b; try { b = JSON.parse(text || '{}'); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!b || typeof b !== 'object') return json({ error: 'Invalid JSON' }, 400);
      for (let i = 0; i < 8; i++) {           // a 5-character code that is already taken is simply re-rolled
        const id = newRoomId();
        const res = await room(id).fetch('https://room/api/create', { method: 'POST', body: JSON.stringify({ ...b, id }) });
        if (res.status !== 409) return res;
      }
      return json({ error: 'Server busy, try again' }, 503);
    }

    if (path.startsWith('/api/')) {
      let code, forward = request;
      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > 20000) return json({ error: 'Request too large' }, 413);
        let b; try { b = JSON.parse(text || '{}'); } catch { return json({ error: 'Invalid JSON' }, 400); }
        code = cleanCode(b && b.room);
        forward = new Request(request.url, { method: 'POST', body: text, headers: request.headers });
      } else code = cleanCode(url.searchParams.get('room') || url.searchParams.get('id'));
      if (!code) return json({ error: 'Room not found' }, 404);
      return room(code).fetch(forward);
    }

    return env.ASSETS.fetch(request);
  },
};
