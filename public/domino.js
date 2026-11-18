/* Domino: public game log -> table state, plus the UI adapter.
   Classic block dominoes, double-six set (28 tiles), two players:
   - 7 tiles each, 14 tiles stay in the boneyard; the highest double opens (the server plays it).
   - Play a tile that matches either open end. With nothing to play you draw from the boneyard
     until you can; with an empty boneyard you pass.
   - First player to play their last tile wins. If both players are blocked, the lower pip total wins.
   Hands are secret: the server deals and validates; this file only draws the table. */
(function (root) {
  const OPP = c => (c === 'w' ? 'b' : 'w');
  const PIPS = { 0: [], 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

  function initial() {
    return { chain: [], l: null, r: null, cnt: { w: 7, b: 7 }, yard: 14, turn: 'w', passes: 0, lack: { w: new Array(7).fill(false), b: new Array(7).fill(false) } };
  }
  const clone = s => ({ ...s, chain: s.chain.slice(), cnt: { ...s.cnt }, lack: { w: s.lack.w.slice(), b: s.lack.b.slice() } });

  // log entries: "w:P3-4:L" played on the left end, ":R" right end, ":C" the opening tile, "b:D" drew, "w:X" passed
  function replay(entries) {
    let s = initial();
    const positions = [s], ev = [];
    for (const e of entries) {
      const m = /^([wb]):(?:P(\d)-(\d):([LRC])|(D)|(X))$/.exec(e);
      if (!m) break;
      const c = m[1], n = clone(s);
      if (m[2] !== undefined) {
        const a = +m[2], b = +m[3], side = m[4];
        if (side === 'C') { if (n.chain.length) break; n.chain = [[a, b]]; n.l = a; n.r = b; }
        else if (side === 'L') { if (a !== n.l && b !== n.l) break; const out = a === n.l ? b : a; n.chain.unshift([out, n.l]); n.l = out; }
        else { if (a !== n.r && b !== n.r) break; const out = a === n.r ? b : a; n.chain.push([n.r, out]); n.r = out; }
        n.cnt[c]--; n.passes = 0; n.turn = OPP(c);
        ev.push({ c, t: 'P', a, b, side });
      } else if (m[5]) {
        n.lack[c][n.l] = true; n.lack[c][n.r] = true;
        n.cnt[c]++; n.yard--; n.turn = c;
        ev.push({ c, t: 'D' });
      } else {
        n.lack[c][n.l] = true; n.lack[c][n.r] = true;
        n.passes++; n.turn = OPP(c);
        ev.push({ c, t: 'X' });
      }
      positions.push(n); s = n;
    }
    return { positions, ev, len: positions.length, entries };
  }

  // snap.hands holds the tiles this viewer is allowed to see (own hand; both on a shared device or at the end)
  function status(rp, vi, snap) {
    const s = rp.positions[vi], last = vi === rp.len - 1;
    let over = null;
    for (const c of ['w', 'b']) if (s.chain.length && s.cnt[c] === 0) over = { result: c === 'w' ? '1-0' : '0-1', reason: 'domino_out' };
    let legal = [], needDraw = false, mustPass = false, hint = '';
    const hand = snap && snap.hands && snap.hands[s.turn];
    if (!over && last && hand && snap.status === 'playing') {
      for (const t of hand) {
        const sides = [];
        if (t[0] === s.l || t[1] === s.l) sides.push('L');
        if (t[0] === s.r || t[1] === s.r) sides.push('R');
        if (sides.length) legal.push({ tile: t, sides });
      }
      if (!legal.length) {
        if (s.yard > 0) { needDraw = true; hint = 'no tile fits: draw from the boneyard'; }
        else { mustPass = true; hint = 'no tile fits: passing'; }
      }
    }
    return { over, legal, needDraw, mustPass, turn: s.turn, lastEnded: true, hint, claim: null, check: false, insuf: { w: false, b: false } };
  }

  /* ---------- drawing ---------- */
  const half = n => `<div class="half">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<i class="${PIPS[n].includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;
  const tile = (a, b, cls, extra) => `<div class="dt ${a === b ? 'dbl' : ''} ${cls || ''}" ${extra || ''}>${half(a)}<span class="bar"></span>${half(b)}</div>`;
  const back = n => ('<div class="dt back"><span class="bar"></span></div>').repeat(Math.max(0, n));

  const sameTile = (x, t) => x.tile[0] === t[0] && x.tile[1] === t[1];
  let sel = null, hooks = null;

  const G = {
    id: 'domino', label: 'Dominoes', draws: false,
    replay, status,
    resetSel() { sel = null; },

    render(el, ctx) {
      const { rp, vi, st, snap } = ctx, s = rp.positions[vi], live = vi === rp.len - 1;
      const bot = ctx.bottom, top = OPP(bot);
      const over = snap && snap.status === 'over';
      const hands = (snap && snap.hands) || {};
      const mine = ctx.me === bot && hands[bot] && live ? hands[bot] : null;          // my tiles, face up
      const theirs = over && live && hands[top] ? hands[top] : null;                    // revealed at the end
      if (sel !== null && !(ctx.interactive && mine && mine[sel] && st.legal.some(x => sameTile(x, mine[sel])))) sel = null;
      const selSides = sel !== null ? st.legal.find(x => sameTile(x, mine[sel])).sides : [];
      const canPlay = ctx.interactive && sel !== null;

      // table: size the tiles so the whole chain usually fits on one line
      const W = Math.max(280, el.clientWidth || 600);
      const units = s.chain.reduce((u, t) => u + (t[0] === t[1] ? 1 : 2), 0) + s.chain.length * 0.12;
      const ts = Math.max(22, Math.min(40, Math.floor((W - 130) / Math.max(6, units))));
      const chain = s.chain.map(([a, b]) => tile(a, b, a === b ? 'v' : '')).join('');
      const endBtn = (side, val) => `<button type="button" class="endbtn ${side}${canPlay && selSides.includes(side) ? ' on' : ''}" data-end="${side}" ${canPlay && selSides.includes(side) ? '' : 'disabled'}>${side === 'L' ? '◀' : ''} ${val === null ? '' : val} ${side === 'R' ? '▶' : ''}</button>`;

      const oppRow = theirs ? theirs.map(t => tile(t[0], t[1], 'rev')).join('') : back(s.cnt[top]);
      const hand = mine
        ? mine.map((t, i) => {
          const leg = ctx.interactive ? st.legal.find(x => sameTile(x, t)) : null;
          return tile(t[0], t[1], 'hand' + (leg ? ' can' : ctx.interactive ? ' dim' : '') + (sel === i ? ' sel' : ''), `data-i="${i}"`);
        }).join('')
        : (hands[bot] && over && live ? hands[bot].map(t => tile(t[0], t[1], 'rev')).join('') : back(s.cnt[bot]));

      el.innerHTML = `<div class="dom" style="--ts:${ts}px">
        <div class="dom-opp"><span class="dom-lbl">${(snap && snap.players[top] && snap.players[top].name) || ''}</span><div class="dom-row">${oppRow}</div></div>
        <div class="dom-table">
          ${s.chain.length ? `<div class="dom-chain">${endBtn('L', s.l)}<div class="dom-line">${chain}</div>${endBtn('R', s.r)}</div>` : '<div class="muted">Waiting for the opening tile…</div>'}
        </div>
        <div class="dom-yard"><span class="stack"><div class="dt back" style="--ts:20px"><span class="bar"></span></div></span><b>${s.yard}</b> in the boneyard
          <button type="button" class="btn sm ${ctx.interactive && st.needDraw ? 'primary' : ''}" data-act="draw" ${ctx.interactive && st.needDraw ? '' : 'disabled'}>Draw a tile</button></div>
        <div class="dom-mine"><span class="dom-lbl">${mine ? 'Your tiles' : (snap && snap.players[bot] && snap.players[bot].name) || ''}</span><div class="dom-row hand-row">${hand}</div></div>
      </div>`;
    },

    bind(el, h) {
      hooks = h;
      el.addEventListener('click', e => {
        const ctx = hooks.ctx();
        if (!ctx.interactive) return;
        const hands = (ctx.snap && ctx.snap.hands) || {}, mine = hands[ctx.bottom];
        if (e.target.closest('[data-act=draw]')) { if (ctx.st.needDraw) hooks.post({ op: 'draw' }); return; }
        const end = e.target.closest('[data-end]');
        if (end && sel !== null && mine && mine[sel]) { const t = mine[sel]; sel = null; hooks.post({ op: 'play', tile: t, side: end.dataset.end }); return; }
        const el2 = e.target.closest('.dom-mine .dt[data-i]');
        if (el2 && mine) {
          const i = +el2.dataset.i, t = mine[i], leg = ctx.st.legal.find(x => sameTile(x, t));
          if (!leg) { sel = null; hooks.rerender(); return; }
          if (leg.sides.length === 1) { sel = null; hooks.post({ op: 'play', tile: t, side: leg.sides[0] }); return; }
          sel = sel === i ? null : i; hooks.rerender();
        }
      });
    },

    moveList(rp, vi) {
      return rp.ev.map((x, i) => {
        const txt = x.t === 'P' ? `<b>${x.a}|${x.b}</b> ${x.side === 'C' ? 'opens' : x.side === 'L' ? '◀ left' : 'right ▶'}` : x.t === 'D' ? 'drew a tile' : 'passed';
        return `<div class="bgm ${vi === i + 1 ? 'cur' : ''}" data-v="${i + 1}"><i class="who ${x.c}"></i><span>${txt}</span></div>`;
      }).join('');
    },

    sound(rp) { const x = rp.ev[rp.ev.length - 1]; return x && x.t === 'D' ? 'capture' : 'move'; },

    sideInfo(rp, vi, color) {
      const s = rp.positions[vi];
      return `<span class="pipinfo">Tiles <b>${s.cnt[color]}</b></span>`;
    }
  };
  root.Games.domino = G;
  root.Domino = { replay, status };
})(window);
