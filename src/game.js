// Game state machine for one room. Pure JavaScript (no Cloudflare APIs) so it can be unit-tested in Node.
// The browser engines check move legality for chess/checkers/nard; this class manages seats, turns,
// clocks, results, dice, the secret domino hands, chat and voice-chat bookkeeping.

export const GAMES = ['chess', 'checkers', 'nard', 'domino'];
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MOVE_RE = {
  chess: /^[a-h][1-8][a-h][1-8][qrbn]?$/,
  checkers: /^[a-h][1-8]([-x][a-h][1-8])+$/,
  // "24>21:3" = checker from point 24 to 21 using die 3, "o" = borne off, "pass" = no legal move
  nard: /^((\d{1,2})>(\d{1,2}|o):[1-6]|pass)$/,
};
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);
const OVER_REASONS = new Set([
  'checkmate', 'stalemate', 'insufficient', 'fivefold', '75move',   // chess
  'no_moves', 'repetition', 'kings15',                              // checkers
  'borne_off', 'mars',                                              // nard
]);
const CLAIM_REASONS = ['threefold', '50move'];
const idf = list => new Set(list.map(([m, s]) => m + ':' + s));
const IDF_CLASSIC = idf([[60, 0], [45, 30], [45, 15], [45, 10], [25, 10], [25, 5], [20, 10]]);
const IDF_RAPID = idf([[15, 0], [10, 0], [10, 3], [10, 5], [7, 3], [7, 5], [6, 3], [6, 5], [5, 3], [5, 5]]);
const IDF_BLITZ = idf([[3, 0], [3, 2], [3, 3]]);

export class ApiError extends Error {
  constructor(msg, code = 400) { super(msg); this.code = code; }
}

// Time source (replaceable in tests)
export const clock = { now: () => Date.now() };
const nowMs = () => clock.now();

// ---------- randomness (cryptographic) ----------
function rndInt(n) {
  const buf = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= lim);
  return x % n;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rndInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function newToken(len = 12) {
  const b = new Uint8Array(len); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const newPid = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), x => x.toString(16).padStart(2, '0')).join('');
export function newRoomId() { let s = ''; for (let i = 0; i < 5; i++) s += ALPHABET[rndInt(ALPHABET.length)]; return s; }

export function cleanName(n, def = 'Guest') {
  const s = String(n == null ? '' : n).replace(/\s+/g, ' ').trim().slice(0, 20);
  return s || def;
}

// FIDE categories for chess (increment counted for 60 moves), IDF lists for draughts-64 (checkers),
// plain "timed" for nərd and domino (no official speed categories).
export function category(baseS, incS, game = 'chess') {
  if (baseS === 0) return 'unlimited';
  if (game === 'nard' || game === 'domino') return 'timed';
  if (game === 'checkers') {
    const key = (Math.round(baseS / 60 * 100) / 100) + ':' + incS;
    if (IDF_BLITZ.has(key)) return 'blitz';
    if (IDF_RAPID.has(key)) return 'rapid';
    if (IDF_CLASSIC.has(key)) return 'classical';
    const m = baseS / 60;
    return m <= 3 ? 'blitz' : m <= 15 ? 'rapid' : 'classical';
  }
  const total = baseS + 60 * incS;
  return total <= 600 ? 'blitz' : total < 3600 ? 'rapid' : 'classical';
}

const num = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

// Validates the body of "create room" and returns normalised options.
export function parseCreate(b) {
  let baseMin = b.base === undefined ? 5 : num(b.base), inc = b.inc === undefined ? 0 : num(b.inc);
  if (Number.isNaN(baseMin) || Number.isNaN(inc)) throw new ApiError('Invalid time');
  if (!(baseMin >= 0 && baseMin <= 180 && inc >= 0 && inc <= 180)) throw new ApiError('Time must be between 0 and 180');
  if (baseMin === 0) inc = 0; else if (baseMin < 0.25) baseMin = 0.25;
  const game = b.game === undefined ? 'chess' : b.game;
  if (!GAMES.includes(game)) throw new ApiError('Unknown game');
  const local = !!b.local;
  let color = b.color;
  if (color !== 'w' && color !== 'b') color = rndInt(2) ? 'w' : 'b';
  return { baseS: baseMin * 60, incS: inc, game, local, private: !!b.private || local, name: cleanName(b.name), color };
}

const FIELDS = ['id', 'game', 'base', 'inc', 'mode', 'local', 'private', 'seats', 'specs', 'voice', 'chat', 'game_no', 'version',
  'touched', 'created', 'moves', 'clocks', 'turn', 'turn_start', 'result', 'reason', 'draw_offer', 'rematch', 'insuf', 'plies', 'rolled',
  'dhand', 'yard', 'dl', 'dr', 'dpass', 'status'];

export class Game {
  // ---- construction / persistence ----
  static create(id, o) {
    const g = new Game();
    g.id = id; g.game = o.game;
    g.base = Math.round(o.baseS * 1000); g.inc = Math.round(o.incS * 1000);
    g.mode = { base: g.base, inc: g.inc, cat: category(o.baseS, o.incS, o.game) };
    g.local = o.local; g.private = o.private;
    g.seats = { w: null, b: null }; g.specs = {}; g.voice = {}; g.chat = [];
    g.game_no = 1; g.version = 0; g.touched = nowMs(); g.created = nowMs();
    g.resetGame();
    const token = newToken();
    if (o.local) {
      g.seats.w = { name: o.name + ' (White)', token };
      g.seats.b = { name: o.name + ' (Black)', token };
      g.resetGame();
    } else g.seats[o.color] = { name: o.name, token };
    return { game: g, token };
  }
  static from(o) {
    const g = new Game();
    for (const k of FIELDS) g[k] = o[k];
    return g;
  }
  constructor() { this.onlineTokens = new Set(); }   // runtime only: tokens with an open connection (set by the room)
  toJSON() { const o = {}; for (const k of FIELDS) o[k] = this[k]; return o; }

  // ---- basic helpers ----
  role(token) {
    const w = this.seats.w, b = this.seats.b;
    if (w && b && w.token === token && b.token === token) return 'wb';
    if (w && w.token === token) return 'w';
    if (b && b.token === token) return 'b';
    return 's';
  }
  nameOf(token) {
    for (const c of ['w', 'b']) if (this.seats[c] && this.seats[c].token === token) return this.seats[c].name;
    return this.specs[token] ? this.specs[token].name : null;
  }
  present(token) { return this.onlineTokens.has(token); }
  online(c) { const s = this.seats[c]; return !!s && (this.local || this.present(s.token)); }
  bump() { this.version++; this.touched = nowMs(); }
  running() { return this.status === 'playing' && this.base > 0 && this.plies >= 2; }
  seated() { return !!(this.seats.w && this.seats.b); }

  // ---- game state ----
  resetGame() {
    this.moves = [];
    this.clocks = { w: this.base, b: this.base };
    this.turn = 'w'; this.turn_start = nowMs();
    this.result = null; this.reason = null; this.draw_offer = null; this.rematch = [];
    this.insuf = { w: false, b: false };
    this.plies = 0; this.rolled = false;
    this.dhand = { w: [], b: [] }; this.yard = []; this.dl = this.dr = null; this.dpass = 0;
    this.status = 'waiting';
    if (this.seated()) this.beginPlay();
  }
  beginPlay() {
    this.status = 'playing'; this.turn_start = nowMs();
    if (this.game === 'domino') this.domDeal();
  }
  settle() {
    if (this.running()) {
      const t = nowMs();
      this.clocks[this.turn] = Math.max(0, this.clocks[this.turn] - (t - this.turn_start));
      this.turn_start = t;
    }
  }
  finish(result, reason) {
    this.settle();
    this.status = 'over'; this.result = result; this.reason = reason;
    this.draw_offer = null; this.rematch = [];
    this.bump();
  }
  flag(side) {
    const other = side === 'w' ? 'b' : 'w';
    this.clocks[side] = 0;
    if (this.insuf[other]) this.finish('1/2-1/2', 'timeout_insufficient');
    else this.finish(side === 'w' ? '0-1' : '1-0', 'timeout');
  }
  // Called when the clock of the side to move may have run out. Returns true if the game changed.
  checkTime() {
    if (this.running() && this.clocks[this.turn] - (nowMs() - this.turn_start) <= 0) { this.flag(this.turn); return true; }
    return false;
  }
  // Moment (ms since epoch) at which the running clock reaches zero, or null.
  nextDeadline() { return this.running() ? this.turn_start + this.clocks[this.turn] : null; }

  // ---- joining ----
  join(token, name, spectate) {
    name = cleanName(name);
    if (token && this.role(token) !== 's') return { room: this.id, token, role: this.role(token) };
    if (token && this.specs[token] && !(!spectate && !this.seated() && !this.local)) return { room: this.id, token, role: 's' };
    token = newToken();
    const free = ['w', 'b'].filter(c => !this.seats[c]);
    if (free.length && !spectate && !this.local) {
      const c = free[0];
      this.seats[c] = { name, token };
      if (this.seated()) this.beginPlay();
      this.bump();
      return { room: this.id, token, role: c };
    }
    this.specs[token] = { name };
    // keep the spectator list bounded: drop the oldest ones that are offline
    const keys = Object.keys(this.specs);
    if (keys.length > 100) for (const k of keys) { if (keys.length <= 100) break; if (!this.present(k) && k !== token) { delete this.specs[k]; keys.splice(keys.indexOf(k), 1); } }
    this.bump();
    return { room: this.id, token, role: 's' };
  }

  // ---- moves ----
  doMove(token, mv, end, over, insuf) {
    if (this.game === 'domino') throw new ApiError('Use the domino actions');
    if (this.status !== 'playing') throw new ApiError('The game is not in progress');
    const seat = this.seats[this.turn];
    if (!seat || seat.token !== token) throw new ApiError('It is not your turn');
    if (typeof mv !== 'string' || !MOVE_RE[this.game].test(mv)) throw new ApiError('Invalid move');
    if (this.game === 'nard') { if (!this.rolled) throw new ApiError('Roll the dice first'); } else end = true;
    const mover = this.turn;
    if (end && this.running()) {
      const rem = this.clocks[this.turn] - (nowMs() - this.turn_start);
      if (rem <= 0) { this.flag(this.turn); return; }
      this.clocks[this.turn] = rem + this.inc;
    }
    this.moves.push(mv);
    if (end) {
      this.plies++;
      this.turn = this.turn === 'w' ? 'b' : 'w';
      this.turn_start = nowMs(); this.rolled = false; this.draw_offer = null;
    }
    if (insuf && typeof insuf === 'object') this.insuf = { w: !!insuf.w, b: !!insuf.b };
    if (over && typeof over === 'object' && RESULTS.has(over.result) && OVER_REASONS.has(over.reason)) {
      // a side can only declare a draw or its own win, never its own loss
      if (over.result === '1/2-1/2' || over.result === (mover === 'w' ? '1-0' : '0-1')) { this.finish(over.result, over.reason); return; }
    }
    this.bump();
  }
  roll(token) {
    if (this.game !== 'nard') throw new ApiError('This game has no dice');
    if (this.status !== 'playing') throw new ApiError('The game is not in progress');
    const seat = this.seats[this.turn];
    if (!seat || seat.token !== token) throw new ApiError('It is not your turn');
    if (this.rolled) throw new ApiError('You already rolled');
    this.moves.push('R' + (rndInt(6) + 1) + (rndInt(6) + 1));
    this.rolled = true;
    this.bump();
  }
  action(token, typ, side, reason) {
    const role = this.role(token);
    if (role === 's') throw new ApiError('Spectators cannot do that', 403);
    side = role === 'wb' ? (side === 'w' || side === 'b' ? side : this.turn) : role;
    const other = side === 'w' ? 'b' : 'w';
    if (typ === 'roll') return this.roll(token);
    if (typ === 'rematch') {
      if (this.status !== 'over') throw new ApiError('The game is not over yet');
      if (!this.rematch.includes(side)) this.rematch.push(side);
      if (this.local || this.rematch.length === 2) {
        [this.seats.w, this.seats.b] = [this.seats.b, this.seats.w];
        this.game_no++;
        this.resetGame();
      }
      this.bump();
      return;
    }
    if (this.status !== 'playing') throw new ApiError('The game is not in progress');
    if (typ === 'resign') this.finish(side === 'w' ? '0-1' : '1-0', 'resign');
    else if (typ === 'abort') {
      if (this.plies >= 2) throw new ApiError('The game has already started, it cannot be aborted');
      this.finish('*', 'aborted');
    } else if (typ === 'draw_offer') {
      if (this.local || this.draw_offer === other) this.finish('1/2-1/2', 'agreement');
      else { this.draw_offer = side; this.bump(); }
    } else if (typ === 'draw_accept') {
      if (this.draw_offer === other) this.finish('1/2-1/2', 'agreement');
    } else if (typ === 'draw_decline') {
      if (this.draw_offer === other || this.draw_offer === side) { this.draw_offer = null; this.bump(); }
    } else if (typ === 'claim_draw') {
      if (!CLAIM_REASONS.includes(reason) || this.game !== 'chess') throw new ApiError('Invalid reason');
      this.finish('1/2-1/2', reason);
    } else throw new ApiError('Unknown action');
  }

  // ---- domino (block dominoes, double-six, two players) ----
  // Hands and the boneyard are secret, so the server deals and checks every action.
  // Public log entries: "w:P3-4:L" (tile 3-4 played on the left end), "b:D" (drew a tile),
  // "w:X" (passed). The very first entry is the opening double, played by the server.
  domDeal() {
    const tiles = [];
    for (let i = 0; i < 7; i++) for (let j = i; j < 7; j++) tiles.push([i, j]);
    let hands, doubles = [];
    for (let k = 0; k < 500 && !doubles.length; k++) {
      shuffle(tiles);
      hands = { w: tiles.slice(0, 7), b: tiles.slice(7, 14) };
      doubles = [];
      for (const c of ['w', 'b']) for (const t of hands[c]) if (t[0] === t[1]) doubles.push([c, t]);
    }
    let starter, first;
    if (doubles.length) {
      [starter, first] = doubles.reduce((best, x) => (x[1][0] > best[1][0] ? x : best));
    } else {   // practically never: nobody holds a double, the highest tile opens
      const all = []; for (const c of ['w', 'b']) for (const t of hands[c]) all.push([c, t]);
      [starter, first] = all.reduce((best, x) => (x[1][0] + x[1][1] > best[1][0] + best[1][1] || (x[1][0] + x[1][1] === best[1][0] + best[1][1] && x[1][1] > best[1][1]) ? x : best));
    }
    hands[starter].splice(hands[starter].indexOf(first), 1);
    this.dhand = { w: hands.w.map(t => [...t]), b: hands.b.map(t => [...t]) };
    this.yard = tiles.slice(14).map(t => [...t]);
    this.dl = first[0]; this.dr = first[1]; this.dpass = 0;
    this.moves = [`${starter}:P${first[0]}-${first[1]}:C`];
    this.turn = starter === 'w' ? 'b' : 'w';
    this.plies = 1;
  }
  domActor(token) {
    if (this.game !== 'domino') throw new ApiError('This game has no tiles');
    if (this.status !== 'playing') throw new ApiError('The game is not in progress');
    const seat = this.seats[this.turn];
    if (!seat || seat.token !== token) throw new ApiError('It is not your turn');
    return this.turn;
  }
  domCan(c) { return this.dhand[c].some(t => t[0] === this.dl || t[1] === this.dl || t[0] === this.dr || t[1] === this.dr); }
  timeOk(c) {
    if (this.running() && this.clocks[c] - (nowMs() - this.turn_start) <= 0) { this.flag(c); return false; }
    return true;
  }
  turnDone(c) {
    if (this.running()) this.clocks[c] = Math.max(0, this.clocks[c] - (nowMs() - this.turn_start)) + this.inc;
    this.plies++;
    this.turn = c === 'w' ? 'b' : 'w';
    this.turn_start = nowMs(); this.draw_offer = null;
  }
  domOp(token, op, tile, side) {
    const c = this.domActor(token);
    if (op === 'play') {
      const a = Array.isArray(tile) ? Number(tile[0]) : NaN, b = Array.isArray(tile) ? Number(tile[1]) : NaN;
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new ApiError('Invalid tile');
      if (side !== 'L' && side !== 'R') throw new ApiError('Invalid side');
      const idx = this.dhand[c].findIndex(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a));
      if (idx < 0) throw new ApiError('You do not hold that tile');
      const t = this.dhand[c][idx], end = side === 'L' ? this.dl : this.dr;
      if (t[0] !== end && t[1] !== end) throw new ApiError('That tile does not fit there');
      if (!this.timeOk(c)) return;
      const out = t[0] === end ? t[1] : t[0];
      this.dhand[c].splice(idx, 1);
      if (side === 'L') this.dl = out; else this.dr = out;
      this.dpass = 0;
      this.moves.push(`${c}:P${t[0]}-${t[1]}:${side}`);
      this.turnDone(c);
      if (!this.dhand[c].length) this.finish(c === 'w' ? '1-0' : '0-1', 'domino_out'); else this.bump();
    } else if (op === 'draw') {
      if (this.domCan(c)) throw new ApiError('You have a tile you can play');
      if (!this.yard.length) throw new ApiError('The boneyard is empty');
      this.dhand[c].push(this.yard.shift());
      this.moves.push(`${c}:D`);
      this.bump();
    } else if (op === 'pass') {
      if (this.domCan(c)) throw new ApiError('You have a tile you can play');
      if (this.yard.length) throw new ApiError('Draw from the boneyard first');
      if (!this.timeOk(c)) return;
      this.moves.push(`${c}:X`);
      this.dpass++;
      this.turnDone(c);
      if (this.dpass >= 2) {   // both blocked: the lowest pip total wins
        const pips = h => h.reduce((s, t) => s + t[0] + t[1], 0), pw = pips(this.dhand.w), pb = pips(this.dhand.b);
        this.finish(pw === pb ? '1/2-1/2' : pw < pb ? '1-0' : '0-1', 'domino_blocked');
      } else this.bump();
    } else throw new ApiError('Unknown domino action');
  }
  // Tiles this viewer may see: own hand, both when the game is over or on a shared device.
  handsFor(token) {
    if (this.game !== 'domino') return null;
    const role = this.role(token);
    const show = this.status === 'over' || role === 'wb' ? ['w', 'b'] : (role === 'w' || role === 'b' ? [role] : []);
    const out = {};
    for (const c of show) out[c] = this.dhand[c].map(t => [...t]);
    return out;
  }

  // ---- chat ----
  addChat(token, text) {
    const name = this.nameOf(token);
    if (!name) throw new ApiError('You are not in this room', 403);
    text = String(text == null ? '' : text).trim().slice(0, 300);
    if (!text) return;
    this.chat.push({ name, s: this.role(token) === 's', text, t: Math.floor(nowMs() / 1000) });
    if (this.chat.length > 100) this.chat = this.chat.slice(-100);
    this.bump();
  }

  // ---- voice chat bookkeeping (signalling messages travel over the room's WebSockets) ----
  voiceRoster() {
    return Object.entries(this.voice).sort((a, b) => a[1].joined - b[1].joined)
      .map(([t, v]) => ({ pid: v.pid, name: this.nameOf(t) || 'Guest', role: this.role(t) }));
  }
  voiceSet(token, on) {
    if (this.local) throw new ApiError('Voice chat is not available on a shared device');
    if (this.nameOf(token) === null) throw new ApiError('You are not in this room', 403);
    if (on) {
      if (!this.voice[token]) { this.voice[token] = { pid: newPid(), joined: nowMs() }; this.bump(); }
    } else if (this.voice[token]) { delete this.voice[token]; this.bump(); }
  }
  // Returns the recipient's token and the message to deliver, or null if the recipient is not in voice.
  signal(token, toPid, data) {
    const me = this.voice[token];
    if (!me) throw new ApiError('Join the voice chat first', 403);
    for (const [t, v] of Object.entries(this.voice)) if (v.pid === toPid) return { to: t, msg: { t: 'sig', from: me.pid, data } };
    return null;
  }

  // ---- views ----
  snapshot(token) {
    const pl = c => { const s = this.seats[c]; return s ? { name: s.name, online: this.online(c) } : null; };
    return {
      id: this.id, game: this.game, rolled: this.rolled, mode: this.mode, local: this.local, private: this.private,
      status: this.status, result: this.result, reason: this.reason, turn: this.turn, moves: this.moves, clocks: this.clocks,
      running: this.running(), turn_start: this.turn_start, now: nowMs(),
      players: { w: pl('w'), b: pl('b') },
      specs: Object.entries(this.specs).filter(([t]) => this.present(t)).map(([, v]) => v.name),
      draw_offer: this.draw_offer, rematch: [...this.rematch].sort(), chat: this.chat.slice(-60), game_no: this.game_no,
      role: this.role(token), hands: this.handsFor(token), voice: this.voiceRoster(),
      pid: this.voice[token] ? this.voice[token].pid : null, version: this.version,
    };
  }
  info() {
    return { id: this.id, game: this.game, mode: this.mode, status: this.status, local: this.local,
      w: this.seats.w ? this.seats.w.name : null, b: this.seats.b ? this.seats.b.name : null };
  }
  // Entry for the public lobby list (null = must not be listed)
  lobbySummary() {
    if (this.private || this.status === 'over') return null;
    return { id: this.id, game: this.game, mode: this.mode, status: this.status, w: this.seats.w ? this.seats.w.name : null,
      b: this.seats.b ? this.seats.b.name : null, moves: this.moves.length, specs: Object.keys(this.specs).filter(t => this.present(t)).length };
  }
}
