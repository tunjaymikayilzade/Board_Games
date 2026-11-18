/* Chess engine: full rules (castling, en passant, promotion, checkmate,
   stalemate, repetition, 50/75-move rule, insufficient material). */
(function (root) {
  const FILES = 'abcdefgh';
  const sqName = i => FILES[i & 7] + ((i >> 3) + 1);
  const sqIdx = n => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 8;
  const colorOf = p => (p === null ? null : (p < 'a' ? 'w' : 'b'));

  const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const inb = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

  class Pos {
    constructor() {
      this.b = new Array(64).fill(null);
      this.turn = 'w'; this.castle = 'KQkq'; this.ep = -1; this.half = 0; this.full = 1;
    }
    static start() {
      return Pos.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    }
    static fromFEN(fen) {
      const p = new Pos(), [pl, t, c, ep, h, f] = fen.split(' ');
      pl.split('/').forEach((row, i) => {
        let file = 0; const r = 7 - i;
        for (const ch of row) {
          if (/\d/.test(ch)) file += +ch; else p.b[r * 8 + file++] = ch;
        }
      });
      p.turn = t; p.castle = c === '-' ? '' : c; p.ep = ep === '-' ? -1 : sqIdx(ep);
      p.half = +h || 0; p.full = +f || 1;
      return p;
    }
    clone() {
      const n = new Pos(); n.b = this.b.slice(); n.turn = this.turn; n.castle = this.castle;
      n.ep = this.ep; n.half = this.half; n.full = this.full; return n;
    }
    kingSq(c) { return this.b.indexOf(c === 'w' ? 'K' : 'k'); }
    attacked(sq, by) {
      const b = this.b, f = sq & 7, r = sq >> 3, up = by === 'w';
      const ch = c => (up ? c.toUpperCase() : c);
      const pr = up ? r - 1 : r + 1;
      if (pr >= 0 && pr < 8) {
        for (const df of [-1, 1]) if (inb(f + df, pr) && b[pr * 8 + f + df] === ch('p')) return true;
      }
      for (const [df, dr] of KN) if (inb(f + df, r + dr) && b[(r + dr) * 8 + f + df] === ch('n')) return true;
      for (const [df, dr] of KG) if (inb(f + df, r + dr) && b[(r + dr) * 8 + f + df] === ch('k')) return true;
      for (const [dirs, a] of [[ORTH, 'r'], [DIAG, 'b']]) {
        for (const [df, dr] of dirs) {
          let ff = f + df, rr = r + dr;
          while (inb(ff, rr)) {
            const p = b[rr * 8 + ff];
            if (p) { if (p === ch(a) || p === ch('q')) return true; break; }
            ff += df; rr += dr;
          }
        }
      }
      return false;
    }
    inCheck() { return this.attacked(this.kingSq(this.turn), this.turn === 'w' ? 'b' : 'w'); }
    pseudo() {
      const out = [], b = this.b, us = this.turn, them = us === 'w' ? 'b' : 'w';
      for (let s = 0; s < 64; s++) {
        const p = b[s]; if (!p || colorOf(p) !== us) continue;
        const t = p.toLowerCase(), f = s & 7, r = s >> 3;
        if (t === 'p') {
          const dr = us === 'w' ? 1 : -1, start = us === 'w' ? 1 : 6, last = us === 'w' ? 7 : 0, r1 = r + dr;
          const add = (to, cap) => {
            if (r1 === last) for (const pr of 'qrbn') out.push({ from: s, to, promo: pr, piece: p, cap });
            else out.push({ from: s, to, piece: p, cap });
          };
          if (!b[r1 * 8 + f]) {
            add(r1 * 8 + f, null);
            if (r === start && !b[(r + 2 * dr) * 8 + f]) out.push({ from: s, to: (r + 2 * dr) * 8 + f, piece: p, flag: 'double' });
          }
          for (const df of [-1, 1]) {
            const ff = f + df; if (ff < 0 || ff > 7) continue;
            const to = r1 * 8 + ff, tp = b[to];
            if (tp && colorOf(tp) === them) add(to, tp);
            else if (to === this.ep) out.push({ from: s, to, piece: p, flag: 'ep', cap: us === 'w' ? 'p' : 'P' });
          }
        } else if (t === 'n' || t === 'k') {
          for (const [df, dr] of (t === 'n' ? KN : KG)) {
            const ff = f + df, rr = r + dr; if (!inb(ff, rr)) continue;
            const tp = b[rr * 8 + ff];
            if (!tp || colorOf(tp) === them) out.push({ from: s, to: rr * 8 + ff, piece: p, cap: tp });
          }
        } else {
          const dirs = t === 'r' ? ORTH : t === 'b' ? DIAG : ORTH.concat(DIAG);
          for (const [df, dr] of dirs) {
            let ff = f + df, rr = r + dr;
            while (inb(ff, rr)) {
              const tp = b[rr * 8 + ff];
              if (!tp) out.push({ from: s, to: rr * 8 + ff, piece: p });
              else { if (colorOf(tp) === them) out.push({ from: s, to: rr * 8 + ff, piece: p, cap: tp }); break; }
              ff += df; rr += dr;
            }
          }
        }
      }
      // castling
      const home = us === 'w' ? 0 : 56, K = us === 'w' ? 'K' : 'k', R = us === 'w' ? 'R' : 'r';
      if (b[home + 4] === K && !this.attacked(home + 4, them)) {
        if (this.castle.includes(us === 'w' ? 'K' : 'k') && b[home + 7] === R && !b[home + 5] && !b[home + 6] &&
          !this.attacked(home + 5, them) && !this.attacked(home + 6, them))
          out.push({ from: home + 4, to: home + 6, piece: K, flag: 'K' });
        if (this.castle.includes(us === 'w' ? 'Q' : 'q') && b[home] === R && !b[home + 1] && !b[home + 2] && !b[home + 3] &&
          !this.attacked(home + 3, them) && !this.attacked(home + 2, them))
          out.push({ from: home + 4, to: home + 2, piece: K, flag: 'Q' });
      }
      return out;
    }
    make(m) {
      const n = this.clone(), b = n.b, us = this.turn, p = b[m.from];
      b[m.from] = null;
      b[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo) : p;
      if (m.flag === 'ep') b[m.to + (us === 'w' ? -8 : 8)] = null;
      const rook = us === 'w' ? 'R' : 'r';
      if (m.flag === 'K') { b[m.from + 3] = null; b[m.from + 1] = rook; }
      if (m.flag === 'Q') { b[m.from - 4] = null; b[m.from - 1] = rook; }
      let c = n.castle;
      if (p === 'K') c = c.replace(/[KQ]/g, '');
      if (p === 'k') c = c.replace(/[kq]/g, '');
      for (const sq of [m.from, m.to]) {
        if (sq === 0) c = c.replace('Q', ''); if (sq === 7) c = c.replace('K', '');
        if (sq === 56) c = c.replace('q', ''); if (sq === 63) c = c.replace('k', '');
      }
      n.castle = c;
      n.ep = m.flag === 'double' ? (m.from + m.to) / 2 : -1;
      n.half = (p.toLowerCase() === 'p' || m.cap) ? 0 : this.half + 1;
      if (us === 'b') n.full++;
      n.turn = us === 'w' ? 'b' : 'w';
      return n;
    }
    // keeps the moves that do not leave our own king in check (tries each move on the board and undoes it)
    filterLegal(moves) {
      const us = this.turn, them = us === 'w' ? 'b' : 'w', b = this.b, king = this.kingSq(us), out = [];
      for (const m of moves) {
        const piece = b[m.from], target = b[m.to];
        let epSq = -1, epCap = null;
        b[m.to] = piece; b[m.from] = null;
        if (m.flag === 'ep') { epSq = m.to + (us === 'w' ? -8 : 8); epCap = b[epSq]; b[epSq] = null; }
        const bad = this.attacked(piece === 'K' || piece === 'k' ? m.to : king, them);
        b[m.from] = piece; b[m.to] = target;
        if (epSq >= 0) b[epSq] = epCap;
        if (!bad) out.push(m);
      }
      return out;
    }
    legal() { return this.filterLegal(this.pseudo()); }
    legalCaptures() { return this.filterLegal(this.pseudo().filter(m => m.cap || m.promo)); }
    key() {
      let k = this.b.map(x => x || '.').join('') + this.turn + this.castle;
      if (this.ep >= 0 && this.pseudo().some(m => m.flag === 'ep')) k += this.ep;
      return k;
    }
  }

  function san(pos, m, legal) {
    let s;
    if (m.flag === 'K') s = 'O-O';
    else if (m.flag === 'Q') s = 'O-O-O';
    else {
      const t = m.piece.toUpperCase(); s = '';
      if (t !== 'P') {
        s = t;
        const others = legal.filter(o => o !== m && o.piece === m.piece && o.to === m.to);
        if (others.length) {
          const sameFile = others.some(o => (o.from & 7) === (m.from & 7));
          const sameRank = others.some(o => (o.from >> 3) === (m.from >> 3));
          if (!sameFile) s += FILES[m.from & 7];
          else if (!sameRank) s += (m.from >> 3) + 1;
          else s += sqName(m.from);
        }
      } else if (m.cap) s += FILES[m.from & 7];
      if (m.cap) s += 'x';
      s += sqName(m.to);
      if (m.promo) s += '=' + m.promo.toUpperCase();
    }
    const n = pos.make(m);
    if (n.inCheck()) s += n.legal().length ? '+' : '#';
    return s;
  }

  function findMove(legal, u) {
    const from = sqIdx(u.slice(0, 2)), to = sqIdx(u.slice(2, 4)), pr = u[4] || null;
    return legal.find(m => m.from === from && m.to === to && (m.promo || null) === pr) || null;
  }
  const uci = m => sqName(m.from) + sqName(m.to) + (m.promo || '');

  function replay(ucis) {
    let pos = Pos.start();
    const positions = [pos], sans = [], moves = [], keys = [pos.key()];
    for (const u of ucis) {
      const legal = pos.legal(), m = findMove(legal, u);
      if (!m) break;
      sans.push(san(pos, m, legal)); moves.push(m);
      pos = pos.make(m); positions.push(pos); keys.push(pos.key());
    }
    return { positions, sans, moves, keys };
  }

  function insufficient(pos) {
    const minors = []; let heavy = false;
    pos.b.forEach((p, i) => {
      if (!p) return;
      const t = p.toLowerCase();
      if (t === 'k') return;
      if (t === 'n' || t === 'b') minors.push({ t, sq: i }); else heavy = true;
    });
    if (heavy) return false;
    if (minors.length <= 1) return true;
    if (minors.every(x => x.t === 'b')) {
      const c = minors.map(x => ((x.sq & 7) + (x.sq >> 3)) % 2);
      return c.every(v => v === c[0]);
    }
    return false;
  }

  // can this side theoretically deliver mate (for the draw-on-timeout rule)
  function canMate(pos, color) {
    let minors = 0;
    for (const p of pos.b) {
      if (!p || colorOf(p) !== color) continue;
      const t = p.toLowerCase();
      if (t === 'p' || t === 'r' || t === 'q') return true;
      if (t === 'n' || t === 'b') minors++;
    }
    return minors >= 2;
  }

  function status(pos, keys) {
    const legal = pos.legal(), check = pos.inCheck();
    let over = null, claim = null;
    const rep = keys.filter(k => k === keys[keys.length - 1]).length;
    if (!legal.length) over = check ? { result: pos.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' } : { result: '1/2-1/2', reason: 'stalemate' };
    else if (insufficient(pos)) over = { result: '1/2-1/2', reason: 'insufficient' };
    else if (rep >= 5) over = { result: '1/2-1/2', reason: 'fivefold' };
    else if (pos.half >= 150) over = { result: '1/2-1/2', reason: '75move' };
    else if (rep >= 3) claim = 'threefold';
    else if (pos.half >= 100) claim = '50move';
    return { over, check, legal, claim, insuf: { w: !canMate(pos, 'w'), b: !canMate(pos, 'b') } };
  }

  function perft(pos, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of pos.legal()) n += perft(pos.make(m), d - 1);
    return n;
  }

  root.Chess = { Pos, replay, status, findMove, uci, sqName, sqIdx, colorOf, perft };
})(window);
