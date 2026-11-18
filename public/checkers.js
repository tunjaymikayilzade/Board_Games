/* Checkers (Russian draughts / "dama"): 8x8, men move forward and capture in all
   directions, flying kings, captures are mandatory, a man that reaches the last row
   mid-capture becomes a king and keeps capturing, captured pieces are removed after
   the whole move (a piece cannot be jumped twice). */
(function (root) {
  const FILES = 'abcdefgh';
  const name = i => FILES[i & 7] + ((i >> 3) + 1);
  const idx = n => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 8;
  const DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const inb = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const colorOf = p => (p ? p.toLowerCase() : null);   // 'w' | 'b'
  const isKing = p => p === 'W' || p === 'B';

  class Pos {
    constructor() { this.b = new Array(64).fill(null); this.turn = 'w'; this.quiet = 0; }
    static start() {
      const p = new Pos();
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        if ((r + f) % 2 !== 0) continue;
        if (r <= 2) p.b[r * 8 + f] = 'w'; else if (r >= 5) p.b[r * 8 + f] = 'b';
      }
      return p;
    }
    clone() { const n = new Pos(); n.b = this.b.slice(); n.turn = this.turn; n.quiet = this.quiet; return n; }
    key() { return this.b.map(x => x || '.').join('') + this.turn; }

    // all complete capture sequences for the piece on `start`
    captures(start) {
      const b = this.b, piece = b[start], color = colorOf(piece), promoRank = color === 'w' ? 7 : 0;
      const at = s => (s === start ? null : b[s]);
      const gen = (cur, king, path, caps, capSet) => {
        const out = [], f = cur & 7, r = cur >> 3;
        for (const [df, dr] of DIRS) {
          if (!king) {
            const mf = f + df, mr = r + dr, lf = f + 2 * df, lr = r + 2 * dr;
            if (!inb(lf, lr)) continue;
            const mid = mr * 8 + mf, land = lr * 8 + lf, mp = at(mid);
            if (!mp || colorOf(mp) === color || capSet.has(mid) || at(land) !== null) continue;
            const nk = lr === promoRank;
            const nPath = path.concat(land), nCaps = caps.concat(mid), nSet = new Set(capSet).add(mid);
            const sub = gen(land, nk, nPath, nCaps, nSet);
            if (sub.length) out.push(...sub); else out.push({ path: nPath, caps: nCaps, king: nk });
          } else {
            let ff = f + df, rr = r + dr;
            while (inb(ff, rr) && at(rr * 8 + ff) === null) { ff += df; rr += dr; }
            if (!inb(ff, rr)) continue;
            const mid = rr * 8 + ff, mp = at(mid);
            if (colorOf(mp) === color || capSet.has(mid)) continue;
            const lands = [];
            let lf = ff + df, lr = rr + dr;
            while (inb(lf, lr) && at(lr * 8 + lf) === null) { lands.push(lr * 8 + lf); lf += df; lr += dr; }
            if (!lands.length) continue;
            const withCont = [], without = [];
            for (const land of lands) {
              const nPath = path.concat(land), nCaps = caps.concat(mid), nSet = new Set(capSet).add(mid);
              const sub = gen(land, true, nPath, nCaps, nSet);
              if (sub.length) withCont.push(...sub); else without.push({ path: nPath, caps: nCaps, king: true });
            }
            out.push(...(withCont.length ? withCont : without));
          }
        }
        return out;
      };
      return gen(start, isKing(piece), [start], [], new Set());
    }

    legal() {
      const b = this.b, us = this.turn, caps = [], simple = [];
      for (let s = 0; s < 64; s++) {
        const p = b[s]; if (!p || colorOf(p) !== us) continue;
        for (const q of this.captures(s)) caps.push({ from: s, to: q.path[q.path.length - 1], path: q.path, caps: q.caps, king: q.king || isKing(p), man: !isKing(p) });
      }
      if (caps.length) return caps.map(m => { m.str = m.path.map(name).join('x'); return m; });
      for (let s = 0; s < 64; s++) {
        const p = b[s]; if (!p || colorOf(p) !== us) continue;
        const f = s & 7, r = s >> 3;
        if (isKing(p)) {
          for (const [df, dr] of DIRS) {
            let ff = f + df, rr = r + dr;
            while (inb(ff, rr) && b[rr * 8 + ff] === null) { simple.push(this._simple(s, rr * 8 + ff, p)); ff += df; rr += dr; }
          }
        } else {
          const dr = us === 'w' ? 1 : -1;
          for (const df of [-1, 1]) {
            const ff = f + df, rr = r + dr;
            if (inb(ff, rr) && b[rr * 8 + ff] === null) simple.push(this._simple(s, rr * 8 + ff, p));
          }
        }
      }
      return simple;
    }
    _simple(from, to, p) {
      const promoRank = colorOf(p) === 'w' ? 7 : 0;
      return { from, to, path: [from, to], caps: [], king: isKing(p) || (to >> 3) === promoRank, man: !isKing(p), str: name(from) + '-' + name(to) };
    }
    make(m) {
      const n = this.clone(), us = this.turn, p = n.b[m.from];
      n.b[m.from] = null;
      for (const c of m.caps) n.b[c] = null;
      n.b[m.to] = m.king ? us.toUpperCase() : us;
      n.quiet = (m.caps.length || m.man) ? 0 : this.quiet + 1;
      n.turn = us === 'w' ? 'b' : 'w';
      return n;
    }
  }

  function replay(entries) {
    let pos = Pos.start();
    const positions = [pos], moves = [], keys = [pos.key()], labels = [];
    for (const e of entries) {
      const m = pos.legal().find(x => x.str === e);
      if (!m) break;
      labels.push(e); moves.push(m);
      pos = pos.make(m); positions.push(pos); keys.push(pos.key());
    }
    return { positions, moves, keys, labels, len: positions.length };
  }

  function status(rp, vi) {
    const pos = rp.positions[vi], legal = pos.legal();
    let over = null;
    const rep = rp.keys.slice(0, vi + 1).filter(k => k === rp.keys[vi]).length;
    if (!legal.length) over = { result: pos.turn === 'w' ? '0-1' : '1-0', reason: 'no_moves' };
    else if (rep >= 3) over = { result: '1/2-1/2', reason: 'repetition' };
    else if (pos.quiet >= 30) over = { result: '1/2-1/2', reason: 'kings15' };
    const mustCapture = legal.length > 0 && legal[0].caps.length > 0;
    return { over, legal, turn: pos.turn, lastEnded: true, mustCapture, claim: null, check: false, insuf: { w: false, b: false } };
  }

  /* ---------- UI adapter ---------- */
  let path = [], hooks = null;
  const discs = (pos, c) => { let n = 0, k = 0; pos.b.forEach(p => { if (colorOf(p) === c) { n++; if (isKing(p)) k++; } }); return { n, k }; };

  const G = {
    id: 'checkers', label: 'Checkers', draws: true,
    replay, status,
    resetSel() { path = []; },
    render(el, ctx) {
      const { rp, vi, st } = ctx, pos = rp.positions[vi];
      const last = vi > 0 ? rp.moves[vi - 1] : null;
      const cands = ctx.interactive && path.length ? st.legal.filter(m => path.every((s, i) => m.path[i] === s)) : [];
      const next = new Set(cands.filter(m => m.path.length > path.length).map(m => m.path[path.length]));
      const movable = new Set(ctx.interactive ? st.legal.map(m => m.from) : []);
      el.innerHTML = Grid.html(ctx.bottom, sq => {
        const p = pos.b[sq]; let cls = '';
        if (last && (last.path.includes(sq))) cls += ' last';
        if (path.includes(sq)) cls += ' sel';
        if (next.has(sq)) cls += ' tgt';
        if (st.mustCapture && movable.has(sq) && !path.length) cls += ' must';
        return { cls, inner: p ? `<span class="pc disc ${colorOf(p)}${isKing(p) ? ' k' : ''}"></span>` : '' };
      });
    },
    bind(el, h) {
      hooks = h;
      const step = sq => {
        const ctx = hooks.ctx(), st = ctx.st;
        if (path.length) {
          const cands = st.legal.filter(m => path.every((s, i) => m.path[i] === s));
          const ext = cands.filter(m => m.path[path.length] === sq);
          if (ext.length) {
            const done = ext.find(m => m.path.length === path.length + 1);
            if (done) { path = []; hooks.submit(done.str); return null; }
            path = path.concat(sq); hooks.rerender(); return null;
          }
        }
        if (st.legal.some(m => m.from === sq)) { path = [sq]; hooks.rerender(); return sq; }
        path = []; hooks.rerender(); return null;
      };
      Grid.bind(el, {
        active: () => hooks.ctx().interactive,
        press: step,
        drop(from, to) { if (to !== null) step(to); else hooks.rerender(); }
      });
    },
    moveList(rp, vi) { return Grid.pairList(rp.labels, vi); },
    sound(rp) { const m = rp.moves[rp.moves.length - 1]; return m && m.caps.length ? 'capture' : 'move'; },
    sideInfo(rp, vi, color) {
      const pos = rp.positions[vi], me = discs(pos, color), en = discs(pos, color === 'w' ? 'b' : 'w');
      const taken = 12 - en.n;
      return `<span class="mini ${color === 'w' ? 'b' : 'w'}"></span>×${taken}` + (me.k ? `  &nbsp;♛×${me.k}` : '');
    },
    pieceHtml() { return ''; }
  };
  root.Games.checkers = G;
  root.Checkers = { Pos, replay, status, name, idx };
})(window);
