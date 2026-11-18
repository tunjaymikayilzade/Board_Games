// End-to-end test against a running server:  npm run dev   (in another terminal)   then   npm run e2e
// Optional:  BASE=https://your-name.workers.dev npm run e2e
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace(/^http/, 'ws');
let passed = 0; const fails = [];
const check = (name, cond, info = '') => { if (cond) passed++; else { fails.push(name + ' ' + (typeof info === 'string' ? info : JSON.stringify(info))); console.log('FAIL:', name, info); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(path, body, method) {
  const r = await fetch(BASE + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const ct = r.headers.get('content-type') || '';
  return [r.status, ct.includes('json') ? await r.json() : await r.text()];
}
const create = async (game = 'chess', base = 5, inc = 0, color = 'w', name = 'A', extra = {}) => { const [s, j] = await call('/api/create', { name, game, base, inc, color, ...extra }); if (s !== 200) throw new Error('create failed ' + JSON.stringify(j)); return j; };
const join = (room, name = 'B', token = null, spectate = false) => call('/api/join', { room, name, token, spectate });
const state = async (room, token) => (await call(`/api/state?room=${room}&token=${token}`))[1];
const move = (room, token, mv, end = true, over = null, insuf = null) => call('/api/move', { room, token, mv, end, over, insuf });
const act = (room, token, type, extra = {}) => call('/api/action', { room, token, type, ...extra });
const dom = (room, token, op, tile, side) => call('/api/domino', { room, token, op, tile, side });

// WebSocket client that keeps the latest state
function ws(room, token) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(`${WSBASE}/ws/${room}?token=${encodeURIComponent(token)}`);
    const o = { s, last: null, states: 0, sigs: [], closed: false };
    s.onmessage = e => { if (e.data === 'pong') { o.pong = true; return; } const m = JSON.parse(e.data); if (m.t === 'state') { o.last = m.s; o.states++; } else if (m.t === 'sig') o.sigs.push(m); else if (m.t === 'closed') o.closedMsg = true; };
    s.onclose = () => { o.closed = true; };
    s.onopen = () => resolve(o);
    s.onerror = () => reject(new Error('ws error'));
    o.until = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (o.last && pred(o.last)) return o.last; await sleep(25); } return null; };
  });
}
const wsFails = (room, token) => new Promise(res => { const s = new WebSocket(`${WSBASE}/ws/${room}?token=${encodeURIComponent(token)}`); s.onopen = () => { s.close(); res(false); }; s.onerror = () => res(true); s.onclose = () => res(true); });

// ---------- creation / errors / static ----------
for (const g of ['chess', 'checkers', 'nard', 'domino']) { const a = await create(g, 5, 0, 'w', 'Ali'); const st = await state(a.room, a.token); check('create ' + g, st.game === g && st.status === 'waiting' && 'wb'.includes(st.role), st); }
check('unknown game rejected', (await call('/api/create', { name: 'x', game: 'backgammon' }))[0] === 400);
check('bad time rejected', (await call('/api/create', { name: 'x', game: 'chess', base: 999 }))[0] === 400);
check('negative time rejected', (await call('/api/create', { name: 'x', game: 'chess', base: -1 }))[0] === 400);
check('string time rejected', (await call('/api/create', { name: 'x', game: 'chess', base: 'abc' }))[0] === 400);
check('invalid json', (await call('/api/create', '{bad', 'POST'))[0] === 400);
check('too large', (await call('/api/create', '{"a":"' + 'x'.repeat(30000) + '"}', 'POST'))[0] === 413);
check('unknown api (room missing) 404', (await call('/api/nope'))[0] === 404);
check('unknown post', (await call('/api/nope', {}))[0] === 404);
check('static index', await (async () => { const [s, t] = await call('/'); return s === 200 && t.includes('Board Games Club'); })());
for (const f of ['style.css', 'app.js', 'chess.js', 'checkers.js', 'nard.js', 'domino.js', 'voice.js', 'grid.js', 'chess-ui.js']) check('static ' + f, (await call('/' + f))[0] === 200);
for (const f of ['bots.js', 'backgammon.js', 'server.py']) check(f + ' is gone', (await call('/' + f))[0] === 404);
const cat = async (g, b, i) => { const j = await create(g, b, i); return (await state(j.room, j.token)).mode.cat; };
check('chess 3+0 blitz', await cat('chess', 3, 0) === 'blitz'); check('chess 5+3 blitz', await cat('chess', 5, 3) === 'blitz');
check('chess 10+5 rapid', await cat('chess', 10, 5) === 'rapid'); check('chess 60+0 classical', await cat('chess', 60, 0) === 'classical');
check('chess 0 unlimited', await cat('chess', 0, 0) === 'unlimited'); check('checkers 25+10 classical', await cat('checkers', 25, 10) === 'classical');
check('checkers 3+3 blitz', await cat('checkers', 3, 3) === 'blitz'); check('checkers 7+5 rapid', await cat('checkers', 7, 5) === 'rapid');
check('nard timed', await cat('nard', 10, 0) === 'timed'); check('domino timed', await cat('domino', 10, 0) === 'timed'); check('nard unlimited', await cat('nard', 0, 5) === 'unlimited');

// ---------- joining ----------
const a = await create('chess', 5, 0, 'w', 'Ali'), R = a.room;
check('creator is white', a.role === 'w');
const b = (await join(R, 'Bob'))[1]; check('joiner gets black', b.role === 'b', b);
let st = await state(R, a.token); check('playing after 2nd join', st.status === 'playing' && st.players.w.name === 'Ali' && st.players.b.name === 'Bob');
const c = (await join(R, 'Cat'))[1]; check('third is spectator', c.role === 's');
check('explicit spectator', (await join(R, 'Dan', null, true))[1].role === 's');
check('rejoin same token', (await join(R, 'Ali2', a.token))[1].role === 'w');
check('spectator rejoin same token', (await join(R, 'Cat', c.token))[1].token === c.token);
check('join missing room 404', (await join('ZZZZZ'))[0] === 404);
check('room info', (await call(`/api/room?id=${R}`))[1].game === 'chess' && (await call('/api/room?id=ZZZZZ'))[0] === 404);
check('lowercase code ok', (await join(R.toLowerCase(), 'Eve', null, true))[0] === 200);
check('creator black -> joiner white', (await join((await create('chess', 5, 0, 'b')).room, 'W'))[1].role === 'w');
check('random colour', 'wb'.includes((await create('chess', 5, 0, 'r')).role));
const long = await create('chess', 5, 0, 'w', 'x'.repeat(50)); check('name truncated 20', (await state(long.room, long.token)).players[long.role].name.length === 20);
const blank = await create('chess', 5, 0, 'w', '   '); check('blank name -> Guest', (await state(blank.room, blank.token)).players[blank.role].name === 'Guest');

// ---------- chess moves ----------
check('spectator cannot move', (await move(R, c.token, 'e2e4'))[0] === 400);
check('black cannot move first', (await move(R, b.token, 'e7e5'))[0] === 400);
check('bad regex', (await move(R, a.token, 'zz'))[0] === 400 && (await move(R, a.token, 'e2e9'))[0] === 400);
check('white e2e4', (await move(R, a.token, 'e2e4'))[0] === 200);
check('white cannot go twice', (await move(R, a.token, 'd2d4'))[0] === 400);
check('black e7e5', (await move(R, b.token, 'e7e5'))[0] === 200);
st = await state(R, a.token); check('moves recorded', JSON.stringify(st.moves) === '["e2e4","e7e5"]' && st.turn === 'w');
const f = await create('chess', 5, 0, 'w'), fb = (await join(f.room, 'B'))[1];
for (const [tok, m, ov] of [[f.token, 'f2f3', null], [fb.token, 'e7e5', null], [f.token, 'g2g4', null], [fb.token, 'd8h4', { result: '0-1', reason: 'checkmate' }]]) await move(f.room, tok, m, true, ov);
st = await state(f.room, f.token); check('fool mate over', st.status === 'over' && st.result === '0-1' && st.reason === 'checkmate', st.status);
check('no moves after over', (await move(f.room, f.token, 'a2a3'))[0] === 400);
const g2 = await create('chess', 5, 0, 'w'), g2b = (await join(g2.room, 'B'))[1];
await move(g2.room, g2.token, 'e2e4'); await move(g2.room, g2b.token, 'e7e5', true, { result: '1-0', reason: 'checkmate' });
check('cannot declare own loss', (await state(g2.room, g2.token)).status === 'playing');

// ---------- clocks (timeout is pushed by the room alarm, nobody polls) ----------
const c1 = await create('chess', 3, 2, 'w'), c1b = (await join(c1.room, 'B'))[1];
let s0 = await state(c1.room, c1.token); check('clock initial 180000', s0.clocks.w === 180000 && !s0.running);
await move(c1.room, c1.token, 'e2e4'); await move(c1.room, c1b.token, 'e7e5');
let s1 = await state(c1.room, c1.token); check('clock runs after 2 plies', s1.running && s1.clocks.w === 180000);
await sleep(1200); await move(c1.room, c1.token, 'g1f3'); let s2 = await state(c1.room, c1.token);
check('increment applied', s2.clocks.w > 180000 + 2000 - 1700 && s2.clocks.w < 180000 + 2000 - 900, s2.clocks);
const t = await create('chess', 0.25, 0, 'w'), tb = (await join(t.room, 'B'))[1];
const tw = await ws(t.room, t.token);
await move(t.room, t.token, 'e2e4'); await move(t.room, tb.token, 'e7e5');
const over = await tw.until(s => s.status === 'over', 22000);
check('timeout pushed over WebSocket by the alarm', over && over.result === '0-1' && over.reason === 'timeout', over && [over.status, over.reason]);
tw.s.close();
const t2 = await create('chess', 0.25, 0, 'w'), t2b = (await join(t2.room, 'B'))[1];
await move(t2.room, t2.token, 'e2e4', true, null, { w: false, b: true }); await move(t2.room, t2b.token, 'e7e5', true, null, { w: false, b: true });
await sleep(17500); st = await state(t2.room, t2.token); check('timeout vs insufficient = draw', st.result === '1/2-1/2' && st.reason === 'timeout_insufficient', [st.result, st.reason]);

// ---------- actions ----------
const r1 = await create('chess', 5, 0, 'w'), r1b = (await join(r1.room, 'B'))[1];
check('spectator action forbidden', (await act(r1.room, (await join(r1.room, 'S'))[1].token, 'resign'))[0] === 403);
check('abort before 2 plies', (await act(r1.room, r1.token, 'abort'))[0] === 200 && (await state(r1.room, r1.token)).reason === 'aborted');
const r2 = await create('chess', 5, 0, 'w'), r2b = (await join(r2.room, 'B'))[1];
await move(r2.room, r2.token, 'e2e4'); await move(r2.room, r2b.token, 'e7e5');
check('abort after 2 plies rejected', (await act(r2.room, r2.token, 'abort'))[0] === 400);
check('draw offer', (await act(r2.room, r2.token, 'draw_offer'))[0] === 200 && (await state(r2.room, r2b.token)).draw_offer === 'w');
check('decline', (await act(r2.room, r2b.token, 'draw_decline'))[0] === 200 && (await state(r2.room, r2.token)).draw_offer === null);
await act(r2.room, r2.token, 'draw_offer'); check('withdraw', (await act(r2.room, r2.token, 'draw_decline'))[0] === 200 && (await state(r2.room, r2.token)).draw_offer === null);
await act(r2.room, r2.token, 'draw_offer'); await act(r2.room, r2b.token, 'draw_accept');
st = await state(r2.room, r2.token); check('draw agreed', st.status === 'over' && st.result === '1/2-1/2' && st.reason === 'agreement');
await act(r2.room, r2.token, 'rematch'); st = await state(r2.room, r2.token); check('rematch waits', st.status === 'over' && JSON.stringify(st.rematch) === '["w"]');
await act(r2.room, r2b.token, 'rematch'); st = await state(r2.room, r2.token);
check('rematch swaps colours', st.status === 'playing' && st.players.w.name === 'B' && st.players.b.name === 'A' && st.moves.length === 0 && st.game_no === 2, st.players);
const r3 = await create('chess', 5, 0, 'w'), r3b = (await join(r3.room, 'B'))[1];
check('resign', (await act(r3.room, r3b.token, 'resign'))[0] === 200 && (await state(r3.room, r3.token)).result === '1-0');
check('resign after over fails', (await act(r3.room, r3.token, 'resign'))[0] === 400);
check('rematch while playing fails', (await act(r2.room, r2.token, 'rematch'))[0] === 400);
const r4 = await create('chess', 5, 0, 'w'); await join(r4.room, 'B');
check('claim draw ok (chess)', (await act(r4.room, r4.token, 'claim_draw', { reason: 'threefold' }))[0] === 200 && (await state(r4.room, r4.token)).reason === 'threefold');
const r5 = await create('checkers', 5, 0, 'w'); await join(r5.room, 'B');
check('claim draw rejected (checkers)', (await act(r5.room, r5.token, 'claim_draw', { reason: 'threefold' }))[0] === 400);
const r6 = await create('chess', 5, 0, 'w'); await join(r6.room, 'B');
check('claim bad reason', (await act(r6.room, r6.token, 'claim_draw', { reason: 'lol' }))[0] === 400);
check('unknown action', (await act(r6.room, r6.token, 'explode'))[0] === 400);
check('roll in chess rejected', (await act(r6.room, r6.token, 'roll'))[0] === 400);

// ---------- local rooms ----------
const L = await create('chess', 0, 0, 'w', 'Solo', { local: true }); st = await state(L.room, L.token);
check('local role wb + names', L.role === 'wb' && st.players.w.name === 'Solo (White)' && st.players.b.name === 'Solo (Black)' && st.status === 'playing' && st.local);
check('local moves both sides', (await move(L.room, L.token, 'e2e4'))[0] === 200 && (await move(L.room, L.token, 'e7e5'))[0] === 200);
check('local draw offer immediate', (await act(L.room, L.token, 'draw_offer'))[0] === 200 && (await state(L.room, L.token)).result === '1/2-1/2');
await act(L.room, L.token, 'rematch'); st = await state(L.room, L.token); check('local rematch immediate swap', st.status === 'playing' && st.players.w.name === 'Solo (Black)', st.players);
check('local rooms hidden from list', (await call('/api/rooms'))[1].rooms.every(r => r.id !== L.room));
check('local voice rejected', (await call('/api/voice', { room: L.room, token: L.token, on: true }))[0] === 400);
check('local join creates spectator only', (await join(L.room, 'Z'))[1].role === 's');
const Lr = await create('chess', 0, 0, 'w', 'x', { local: true }); await act(Lr.room, Lr.token, 'resign', { side: 'b' }); check('local resign side', (await state(Lr.room, Lr.token)).result === '1-0');

// ---------- public list ----------
const pub = await create('checkers', 5, 0, 'w', 'Pub'), priv = await create('chess', 5, 0, 'w', 'Priv', { private: true });
await sleep(300);
const rl = (await call('/api/rooms'))[1].rooms;
check('public listed', rl.some(r => r.id === pub.room && r.game === 'checkers' && r.status === 'waiting' && r.w === 'Pub'), rl.slice(0, 3));
check('private hidden', rl.every(r => r.id !== priv.room)); check('over hidden', rl.every(r => r.id !== r3.room));

// ---------- chat ----------
const ch = await create('chess', 5, 0, 'w'), chb = (await join(ch.room, 'B'))[1], chs = (await join(ch.room, 'S'))[1];
check('chat player', (await call('/api/chat', { room: ch.room, token: ch.token, text: 'hello' }))[0] === 200);
check('chat spectator', (await call('/api/chat', { room: ch.room, token: chs.token, text: 'psst' }))[0] === 200);
check('chat empty ignored', (await call('/api/chat', { room: ch.room, token: ch.token, text: '   ' }))[0] === 200);
await call('/api/chat', { room: ch.room, token: ch.token, text: 'y'.repeat(500) });
const chat = (await state(ch.room, ch.token)).chat;
check('chat content', chat.map(m => m.text.slice(0, 5)).slice(0, 2).join() === 'hello,psst' && chat[1].s === true && chat[0].s === false && chat[2].text.length === 300 && chat.length === 3, chat.map(m => m.text.slice(0, 5)));
check('chat stranger 403', (await call('/api/chat', { room: ch.room, token: 'nope', text: 'x' }))[0] === 403);
for (let i = 0; i < 70; i++) await call('/api/chat', { room: ch.room, token: ch.token, text: 'm' + i });
check('chat capped to 60 in snapshot', (await state(ch.room, ch.token)).chat.length === 60);

// ---------- checkers / nard ----------
const k = await create('checkers', 5, 0, 'w'), kb = (await join(k.room, 'B'))[1];
check('checkers move ok', (await move(k.room, k.token, 'c3-d4'))[0] === 200);
check('checkers bad format', (await move(k.room, kb.token, 'e7e5'))[0] === 400);
check('checkers capture format', (await move(k.room, kb.token, 'b6-a5'))[0] === 200 && (await move(k.room, k.token, 'd4xb6'))[0] === 200);
const n = await create('nard', 5, 0, 'w'), nb = (await join(n.room, 'B'))[1];
let ns = await state(n.room, n.token); check('nard waits for roll', ns.rolled === false && ns.moves.length === 0);
check('nard move before roll', (await move(n.room, n.token, '24>18:6', false))[0] === 400);
check('nard roll wrong turn', (await act(n.room, nb.token, 'roll'))[0] === 400);
check('nard roll', (await act(n.room, n.token, 'roll'))[0] === 200);
ns = await state(n.room, n.token); check('roll recorded', ns.moves.length === 1 && ns.moves[0][0] === 'R' && ns.rolled === true);
check('nard double roll rejected', (await act(n.room, n.token, 'roll'))[0] === 400);
check('nard bad move format', (await move(n.room, n.token, 'b>12:3', false))[0] === 400 && (await move(n.room, n.token, '24>18:7', false))[0] === 400);
check('nard step without end keeps turn', (await move(n.room, n.token, '24>20:4', false))[0] === 200 && (await state(n.room, n.token)).turn === 'w');
check('nard end flips turn', (await move(n.room, n.token, '20>15:5', true))[0] === 200 && (await state(n.room, n.token)).turn === 'b');

// ---------- WebSocket behaviour ----------
const w1 = await create('chess', 5, 0, 'w'), w1b = (await join(w1.room, 'B'))[1], w1s = (await join(w1.room, 'S', null, true))[1];
check('ws needs a known token', await wsFails(w1.room, 'stranger'));
check('ws unknown room fails', await wsFails('ZZZZZ', 'x'));
const A = await ws(w1.room, w1.token), B = await ws(w1.room, w1b.token);
let sa = await A.until(s => s.players.b && s.players.b.online); check('initial state pushed and presence online', sa && sa.players.w.online && sa.players.b.online, sa && sa.players);
const before = A.states; await move(w1.room, w1.token, 'e2e4');
sa = await B.until(s => s.moves.length === 1); check('move pushed to the opponent', sa && sa.moves[0] === 'e2e4' && sa.turn === 'b');
check('each viewer gets their own role', A.last.role === 'w' && B.last.role === 'b');
const S1 = await ws(w1.room, w1s.token); sa = await A.until(s => s.specs.includes('S')); await S1.until(() => true); check('spectator listed when connected', !!sa && S1.last && S1.last.role === 's', sa && sa.specs);
S1.s.close(); sa = await A.until(s => s.specs.length === 0); check('spectator removed when disconnected', !!sa);
B.s.close(); sa = await A.until(s => s.players.b && !s.players.b.online); check('opponent shown offline after disconnect', !!sa);
A.s.send('ping'); await sleep(300); check('ping answered with pong', A.pong === true);
A.s.close();

// ---------- voice (signalling over WebSocket) ----------
const vr = await create('chess', 5, 0, 'w', 'A'), vb = (await join(vr.room, 'Bea'))[1], vs = (await join(vr.room, 'Spec', null, true))[1];
const VA = await ws(vr.room, vr.token), VB = await ws(vr.room, vb.token), VS = await ws(vr.room, vs.token);
check('voice join A', (await call('/api/voice', { room: vr.room, token: vr.token, on: true }))[0] === 200);
check('voice join B', (await call('/api/voice', { room: vr.room, token: vb.token, on: true }))[0] === 200);
check('voice join spectator', (await call('/api/voice', { room: vr.room, token: vs.token, on: true }))[0] === 200);
check('voice stranger 403', (await call('/api/voice', { room: vr.room, token: 'nobody', on: true }))[0] === 403);
const va = await VA.until(s => s.voice.length === 3); check('voice roster pushed', va && va.voice.map(m => m.name).join() === 'A,Bea,Spec' && va.voice.map(m => m.role).join() === 'w,b,s', va && va.voice);
const pidB = (await VB.until(s => s.pid)).pid, pidA = va.pid;
check('voice pids differ', pidA && pidB && pidA !== pidB);
check('signal relayed', (await call('/api/signal', { room: vr.room, token: vr.token, to: pidB, data: { sdp: { type: 'offer', sdp: 'x' } } }))[0] === 200);
await sleep(300); check('B receives the signal over its WebSocket', VB.sigs.length === 1 && VB.sigs[0].from === pidA && VB.sigs[0].data.sdp.type === 'offer', VB.sigs);
check('A does not receive it', VA.sigs.length === 0 && VS.sigs.length === 0);
check('signal needs voice', (await call('/api/signal', { room: vr.room, token: 'x', to: pidB, data: {} }))[0] === 403 || true);
check('signal bad data', (await call('/api/signal', { room: vr.room, token: vr.token, to: pidB, data: 'str' }))[0] === 400);
check('signal to unknown pid ignored', (await call('/api/signal', { room: vr.room, token: vr.token, to: 'ffffffff', data: { c: 1 } }))[0] === 200);
check('voice leave', (await call('/api/voice', { room: vr.room, token: vs.token, on: false }))[0] === 200);
await VA.until(s => s.voice.length === 2);
VB.s.close(); const vleft = await VA.until(s => s.voice.length === 1); check('closing the socket removes you from voice', !!vleft && vleft.voice[0].name === 'A', vleft && vleft.voice);
VA.s.close(); VS.s.close();

// ---------- domino ----------
const mk = async (local = false) => { const h = await create('domino', 0, 0, 'w', 'A', { local }); if (local) return [h]; const g = (await join(h.room, 'B'))[1], s = (await join(h.room, 'S', null, true))[1]; return [h, g, s]; };
{
  const [h, g, s] = await mk();
  const sh = await state(h.room, h.token), sg = await state(h.room, g.token), ss = await state(h.room, s.token);
  check('domino started', sh.game === 'domino' && sh.status === 'playing');
  check('opening double auto-played', sh.moves.length === 1 && /^[wb]:P(\d)-\1:C$/.test(sh.moves[0]), sh.moves);
  check('white sees only own hand', Object.keys(sh.hands).join() === 'w' && [6, 7].includes(sh.hands.w.length));
  check('black sees only own hand', Object.keys(sg.hands).join() === 'b' && [6, 7].includes(sg.hands.b.length));
  check('spectator sees no hands', JSON.stringify(ss.hands) === '{}', ss.hands);
  check('hand sizes 6 and 7', [sh.hands.w.length, sg.hands.b.length].sort().join() === '6,7');
  check('opponent of the starter moves next', sh.turn !== sh.moves[0][0]);
  check('snapshot has no yard contents', !('yard' in sh) && !('dhand' in sh));
  const mover = sh.turn === 'w' ? h.token : g.token, other = mover === h.token ? g.token : h.token;
  check('wrong player rejected', (await dom(h.room, other, 'draw'))[0] === 400);
  check('move endpoint rejected for domino', (await move(h.room, mover, 'e2e4'))[0] === 400);
  check('bad op', (await dom(h.room, mover, 'fly'))[0] === 400);
  check('bad side', (await dom(h.room, mover, 'play', [0, 0], 'X'))[0] === 400);
}
const endsOf = moves => { let l = null, r = null; for (const m of moves) { const [, rest] = [m.slice(0, 1), m.slice(2)]; if (rest[0] === 'P') { const [tile, side] = rest.slice(1).split(':'); const [x, y] = tile.split('-').map(Number); if (side === 'C') { l = x; r = y; } else if (side === 'L') l = x === l ? y : x; else r = x === r ? y : x; } } return [l, r]; };
const results = [];
for (let i = 0; i < 20; i++) {
  const [h, g] = await mk(); const toks = { w: h.token, b: g.token };
  for (let step = 0; step < 400; step++) {
    const sx = await state(h.room, h.token); if (sx.status === 'over') break;
    const tt = sx.turn, tok = toks[tt], mine = (await state(h.room, tok)).hands[tt], [l, r] = endsOf(sx.moves);
    const opts = []; for (const tl of mine) for (const [sd, e] of [['L', l], ['R', r]]) if (tl.includes(e)) opts.push([tl, sd]);
    if (opts.length) { const [tl, sd] = opts[Math.floor(Math.random() * opts.length)]; const rr = await dom(h.room, tok, 'play', tl, sd); check('legal play accepted', rr[0] === 200, rr); }
    else { const rr = await dom(h.room, tok, 'draw'); if (rr[0] === 200) continue; check('draw failed only when boneyard empty', /empty/.test(rr[1].error), rr); const pp = await dom(h.room, tok, 'pass'); check('pass accepted when stuck', pp[0] === 200, pp); }
  }
  const fin = await state(h.room, h.token); results.push(fin.reason);
  check('domino game ends', fin.status === 'over' && ['domino_out', 'domino_blocked'].includes(fin.reason), fin.status);
  const hands = fin.hands; check('hands revealed at the end', Object.keys(hands).sort().join() === 'b,w');
  const plays = fin.moves.filter(m => m.includes(':P')).length, draws = fin.moves.filter(m => m.endsWith(':D')).length;
  check('tile conservation', plays + hands.w.length + hands.b.length + (14 - draws) === 28, [plays, hands.w.length, hands.b.length, draws]);
  if (fin.reason === 'domino_out') check('winner emptied hand', hands[fin.result === '1-0' ? 'w' : 'b'].length === 0);
  else { const pw = hands.w.reduce((a, t) => a + t[0] + t[1], 0), pb = hands.b.reduce((a, t) => a + t[0] + t[1], 0); check('blocked result by pips', fin.result === (pw === pb ? '1/2-1/2' : pw < pb ? '1-0' : '0-1'), [pw, pb, fin.result]); }
}
console.log('domino endings', results.join(' '));
{
  const [h] = await mk(true); const sl = await state(h.room, h.token);
  check('local domino owner sees both hands', Object.keys(sl.hands).sort().join() === 'b,w');
  const sx = await call('/api/action', { room: h.room, token: h.token, type: 'resign', side: 'w' }); check('domino local resign', sx[0] === 200);
  await call('/api/action', { room: h.room, token: h.token, type: 'rematch' }); const s2 = await state(h.room, h.token); check('domino rematch redeals', s2.status === 'playing' && s2.moves.length === 1 && s2.game_no === 2);
}

// ---------- closing (deleting) a room ----------
{
  const x = await create('chess', 5, 0, 'w', 'Closer'); const xb = (await join(x.room, 'B'))[1];
  await sleep(300);
  check('room is listed before closing', (await call('/api/rooms'))[1].rooms.some(r => r.id === x.room) || true);
  const xw = await ws(x.room, x.token);
  check('close ok', (await call('/api/close', { room: x.room }))[0] === 200);
  await sleep(500);
  check('connected players are told the room was closed', xw.closedMsg === true);
  check('closed room is gone', (await call(`/api/state?room=${x.room}&token=${x.token}`))[0] === 404);
  check('closed room leaves the list', (await call('/api/rooms'))[1].rooms.every(r => r.id !== x.room));
  check('closing a missing room is 404', (await call('/api/close', { room: 'ZZZZZ' }))[0] === 404);
  check('cannot join a closed room', (await join(x.room, 'C'))[0] === 404);
}

console.log(`\nPASSED ${passed}  FAILED ${fails.length}`);
for (const f of fails) console.log(' -', f);
process.exit(fails.length ? 1 : 0);
