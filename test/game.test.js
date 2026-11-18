import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, ApiError, parseCreate, category, clock, cleanName } from '../src/game.js';

const make = (game = 'chess', extra = {}) => {
  const { game: g, token } = Game.create('TESTA', parseCreate({ name: 'A', game, base: 5, inc: 0, color: 'w', ...extra }));
  const j = g.join(null, 'B', false);
  return { g, a: token, b: j.token };
};
const throwsApi = (fn, msg) => assert.throws(fn, e => e instanceof ApiError && (!msg || e.message.includes(msg)));

test('create validates input', () => {
  throwsApi(() => parseCreate({ game: 'backgammon' }), 'Unknown game');
  throwsApi(() => parseCreate({ base: 999 }), 'between');
  throwsApi(() => parseCreate({ base: 'abc' }), 'Invalid time');
  assert.equal(parseCreate({ base: 0, inc: 9 }).incS, 0);
  assert.equal(cleanName('   '), 'Guest');
  assert.equal(cleanName('x'.repeat(50)).length, 20);
});

test('time categories', () => {
  assert.equal(category(180, 0, 'chess'), 'blitz');
  assert.equal(category(600, 5, 'chess'), 'rapid');
  assert.equal(category(3600, 0, 'chess'), 'classical');
  assert.equal(category(25 * 60, 10, 'checkers'), 'classical');
  assert.equal(category(600, 0, 'nard'), 'timed');
  assert.equal(category(0, 0, 'domino'), 'unlimited');
});

test('seats, spectators and persistence', () => {
  const { g, a, b } = make();
  assert.equal(g.status, 'playing');
  assert.equal(g.role(a), 'w'); assert.equal(g.role(b), 'b');
  const s = g.join(null, 'S', false);
  assert.equal(s.role, 's');
  assert.equal(g.join(a, 'again', false).role, 'w');
  const copy = Game.from(JSON.parse(JSON.stringify(g)));
  assert.equal(copy.snapshot(a).players.b.name, 'B');
  assert.deepEqual(copy.toJSON(), g.toJSON());
});

test('moves, turns and results', () => {
  const { g, a, b } = make();
  throwsApi(() => g.doMove(b, 'e7e5', true), 'not your turn');
  throwsApi(() => g.doMove(a, 'zz', true), 'Invalid move');
  g.doMove(a, 'f2f3', true); g.doMove(b, 'e7e5', true); g.doMove(a, 'g2g4', true);
  g.doMove(b, 'd8h4', true, { result: '0-1', reason: 'checkmate' });
  assert.equal(g.status, 'over'); assert.equal(g.result, '0-1');
  throwsApi(() => g.doMove(a, 'a2a3', true), 'not in progress');
});

test('a side cannot declare its own loss', () => {
  const { g, a } = make();
  g.doMove(a, 'e2e4', true, { result: '0-1', reason: 'checkmate' });
  assert.equal(g.status, 'playing');
});

test('clock runs after two plies, increment is added, timeout is detected', () => {
  let t = 1_000_000; clock.now = () => t;
  try {
    const { g, a, b } = make('chess', { base: 3, inc: 2 });
    g.doMove(a, 'e2e4', true); g.doMove(b, 'e7e5', true);
    assert.ok(g.running());
    t += 1000; g.doMove(a, 'g1f3', true);
    assert.equal(g.clocks.w, 180000 - 1000 + 2000);
    assert.equal(g.nextDeadline(), g.turn_start + g.clocks.b);
    t += 181000;
    assert.equal(g.checkTime(), true);
    assert.equal(g.result, '1-0'); assert.equal(g.reason, 'timeout');
  } finally { clock.now = () => Date.now(); }
});

test('draw offers, resign, rematch swaps colours', () => {
  const { g, a, b } = make();
  g.doMove(a, 'e2e4', true); g.doMove(b, 'e7e5', true);
  g.action(a, 'draw_offer'); assert.equal(g.draw_offer, 'w');
  g.action(b, 'draw_accept'); assert.equal(g.result, '1/2-1/2');
  g.action(a, 'rematch'); assert.equal(g.status, 'over');
  g.action(b, 'rematch'); assert.equal(g.status, 'playing');
  assert.equal(g.seats.w.name, 'B'); assert.equal(g.game_no, 2); assert.equal(g.moves.length, 0);
  throwsApi(() => g.action(g.join(null, 'S', false).token, 'resign'), 'Spectators');
});

test('nard: dice are server-side and a move needs a roll', () => {
  const { g, a, b } = make('nard');
  throwsApi(() => g.doMove(a, '24>20:4', false), 'Roll');
  g.roll(a);
  assert.match(g.moves[0], /^R[1-6][1-6]$/);
  throwsApi(() => g.roll(a), 'already');
  g.doMove(a, '24>20:4', false); assert.equal(g.turn, 'w');
  g.doMove(a, '20>15:5', true); assert.equal(g.turn, 'b');
  throwsApi(() => g.roll(a), 'not your turn');
  g.roll(b);
});

test('domino: secret hands, rules, full random games conserve the 28 tiles', () => {
  for (let n = 0; n < 40; n++) {
    const { g, a, b } = make('domino');
    const toks = { w: a, b };
    assert.equal(g.moves.length, 1);
    assert.deepEqual(Object.keys(g.snapshot(a).hands), ['w']);
    assert.deepEqual(g.snapshot(g.join(null, 'S', true).token).hands, {});
    for (let step = 0; step < 500 && g.status === 'playing'; step++) {
      const c = g.turn, hand = g.dhand[c], tok = toks[c];
      const options = [];
      for (const t of hand) for (const [side, e] of [['L', g.dl], ['R', g.dr]]) if (t.includes(e)) options.push([t, side]);
      if (options.length) { const [t, side] = options[Math.floor(Math.random() * options.length)]; g.domOp(tok, 'play', t, side); }
      else if (g.yard.length) g.domOp(tok, 'draw');
      else g.domOp(tok, 'pass');
    }
    assert.equal(g.status, 'over');
    const plays = g.moves.filter(m => m.includes(':P')).length, draws = g.moves.filter(m => m.endsWith(':D')).length;
    assert.equal(plays + g.dhand.w.length + g.dhand.b.length + (14 - draws), 28);
    assert.deepEqual(Object.keys(g.snapshot(a).hands).sort(), ['b', 'w']);   // revealed at the end
  }
});

test('domino: illegal actions are refused', () => {
  const { g, a, b } = make('domino');
  const c = g.turn, tok = c === 'w' ? a : b, other = c === 'w' ? b : a;
  throwsApi(() => g.domOp(other, 'draw'), 'not your turn');
  throwsApi(() => g.domOp(tok, 'play', [9, 9], 'L'), 'hold');
  throwsApi(() => g.domOp(tok, 'play', g.dhand[c][0], 'X'), 'side');
  throwsApi(() => g.doMove(tok, 'e2e4', true), 'domino');
});

test('voice: roster and signalling', () => {
  const { g, a, b } = make();
  g.voiceSet(a, true); g.voiceSet(b, true);
  const roster = g.voiceRoster();
  assert.deepEqual(roster.map(r => r.name), ['A', 'B']);
  const r = g.signal(a, g.voice[b].pid, { c: 1 });
  assert.equal(r.to, b); assert.equal(r.msg.from, g.voice[a].pid);
  assert.equal(g.signal(a, 'ffffffff', {}), null);
  throwsApi(() => g.signal('stranger', g.voice[b].pid, {}), 'voice');
  g.voiceSet(a, false); assert.equal(g.voiceRoster().length, 1);
});

test('local rooms: one token plays both seats, no voice', () => {
  const { game: g, token } = Game.create('LOCAL', parseCreate({ name: 'Solo', game: 'chess', local: true }));
  assert.equal(g.role(token), 'wb'); assert.equal(g.private, true);
  g.doMove(token, 'e2e4', true); g.doMove(token, 'e7e5', true);
  throwsApi(() => g.voiceSet(token, true), 'shared device');
  assert.equal(g.lobbySummary(), null);
});

test('lobby summary hides private and finished games', () => {
  const { g, a } = make();
  assert.equal(g.lobbySummary().game, 'chess');
  g.action(a, 'resign');
  assert.equal(g.lobbySummary(), null);
});
