/* Chess adapter: connects the engine (chess.js) to the board UI. */
(function () {
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const glyph = p => GLYPH[p.toLowerCase()] + '︎';
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let sel = null, hooks = null;

  const G = {
    id: 'chess',
    label: 'Chess',
    draws: true,
    replay(moves) { const rp = Chess.replay(moves); rp.len = rp.positions.length; return rp; },
    status(rp, vi) {
      const pos = rp.positions[vi];
      const st = Chess.status(pos, rp.keys.slice(0, vi + 1));
      st.turn = pos.turn; st.lastEnded = true;
      return st;
    },
    resetSel() { sel = null; },

    render(el, ctx) {
      const { rp, vi, st } = ctx, pos = rp.positions[vi];
      const last = vi > 0 ? rp.moves[vi - 1] : null;
      const checkSq = st.check ? pos.kingSq(pos.turn) : -1;
      const legal = sel !== null && ctx.interactive ? st.legal.filter(m => m.from === sel) : [];
      const tg = new Map(legal.map(m => [m.to, m]));
      el.innerHTML = Grid.html(ctx.bottom, sq => {
        const p = pos.b[sq]; let cls = '';
        if (last && (last.from === sq || last.to === sq)) cls += ' last';
        if (sel === sq && ctx.interactive) cls += ' sel';
        if (sq === checkSq) cls += ' chk';
        if (tg.has(sq)) cls += ' tgt' + (p || tg.get(sq).flag === 'ep' ? ' has' : '');
        return { cls, inner: p ? `<span class="pc ${Chess.colorOf(p)}">${glyph(p)}</span>` : '' };
      });
    },

    bind(el, h) {
      hooks = h;
      const tryMove = (from, to) => {
        const ctx = hooks.ctx();
        const cands = ctx.st.legal.filter(m => m.from === from && m.to === to);
        if (!cands.length) return false;
        sel = null;
        if (cands[0].promo) hooks.promo(ctx.st.turn, p => hooks.submit(Chess.uci(cands.find(m => m.promo === p))));
        else hooks.submit(Chess.uci(cands[0]));
        return true;
      };
      Grid.bind(el, {
        active: () => hooks.ctx().interactive,
        press(sq) {
          const ctx = hooks.ctx(), pos = ctx.rp.positions[ctx.vi], p = pos.b[sq];
          if (sel !== null && sel !== sq && ctx.st.legal.some(m => m.from === sel && m.to === sq)) { tryMove(sel, sq); return null; }
          if (p && Chess.colorOf(p) === pos.turn) { sel = sq; hooks.rerender(); return sq; }
          sel = null; hooks.rerender(); return null;
        },
        drop(from, to) {
          if (to !== null && !tryMove(from, to)) sel = null;
          hooks.rerender();
        }
      });
    },

    moveList(rp, vi) { return Grid.pairList(rp.sans.map(s => s.replace(/[&<>]/g, '')), vi); },

    sound(rp) {
      const n = rp.moves.length, m = rp.moves[n - 1]; if (!m) return 'move';
      const st = Chess.status(rp.positions[n], rp.keys.slice(0, n + 1));
      return st.check ? 'check' : m.cap ? 'capture' : 'move';
    },

    sideInfo(rp, vi, color) {
      const pos = rp.positions[vi], enemy = color === 'w' ? 'b' : 'w';
      const init = { p: 8, n: 2, b: 2, r: 2, q: 1 };
      const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
      const mat = { w: 0, b: 0 };
      pos.b.forEach(p => { if (p && p.toLowerCase() !== 'k') { const c = Chess.colorOf(p), t = p.toLowerCase(); cnt[c][t]++; mat[c] += VAL[t]; } });
      let s = '';
      for (const t of 'qrbnp') s += glyph(t).repeat(Math.max(0, init[t] - cnt[enemy][t]));
      const d = mat[color] - mat[enemy];
      return s + (d > 0 ? `  <b class="adv">+${d}</b>` : '');
    },

    pieceHtml(c, t) { return `<span class="pc ${c}" style="font-size:56px">${glyph(t)}</span>`; }
  };
  window.Games.chess = G;
})();
