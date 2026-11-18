/* Nərd (long nardy): engine + UI adapter.
   Rules:
   - 15 checkers each, all start on the "head" (white on point 24, black on point 12).
   - Both sides move the same way round the board (counter-clockwise); white's path is 24 -> 1,
     black's is 12 -> 1 then 24 -> 13. The last quarter of the path is each side's home.
   - Two dice; doubles give four moves. You must use as many dice as possible, and if only one
     die can be played it must be the larger one.
   - No hitting: a point held by the opponent is blocked.
   - Only one checker may leave the head per turn (two on a side's first turn when it rolls any double).
   - You may not build a block of six points in a row unless at least one opponent checker is ahead of it.
   - Bear off only when all 15 checkers are in the home quarter. First to bear off all wins:
     1 point, or 2 points ("mars") if the opponent has borne off nothing. */
(function (root) {
  const OPP = c => (c === 'w' ? 'b' : 'w');
  const SGN = c => (c === 'w' ? 1 : -1);
  // absolute point <-> position along the player's own path (1 = head, 24 = last point of home)
  const relOf = (c, p) => (c === 'w' ? 25 - p : ((((12 - p) % 24) + 24) % 24) + 1);
  const ptOf = relOf; // the mapping is its own inverse

  function initial() {
    const pts = new Array(25).fill(0);
    pts[24] = 15; pts[12] = -15;
    return { pts, off: { w: 0, b: 0 }, turn: 'w', dice: [], roll: [], started: false, played: [], head: 0, maxHead: 1, first: { w: true, b: true } };
  }
  const clone = s => ({ ...s, pts: s.pts.slice(), off: { ...s.off }, dice: s.dice.slice(), roll: s.roll.slice(), played: s.played.slice(), first: { ...s.first } });

  function allHome(s, c) {
    let inHome = s.off[c];
    for (let k = 19; k <= 24; k++) inHome += Math.max(0, s.pts[ptOf(c, k)] * SGN(c));
    return inHome === 15;
  }

  // Does moving a checker onto the EMPTY point `to` build a row of six or more own points
  // with no opponent checker ahead of it? Only a move that creates such a row is forbidden;
  // a row that already stands (e.g. after the opponent's last checker moved past it) never
  // blocks other moves, and piling more checkers on a point you already hold adds nothing.
  function blockIllegal(s, c, from, to) {
    const sg = SGN(c);
    if (s.pts[to] * sg !== 0) return false;
    const pts = s.pts.slice();
    pts[from] -= sg; pts[to] += sg;
    const held = k => pts[ptOf(c, k)] * sg > 0;
    const kt = relOf(c, to);
    let a = kt, b = kt;
    while (a > 1 && held(a - 1)) a--;
    while (b < 24 && held(b + 1)) b++;
    if (b - a + 1 < 6) return false;
    for (let p = 1; p <= 24; p++) if (pts[p] * sg < 0 && relOf(c, p) > b) return false;   // an opponent checker is ahead: allowed
    return true;
  }

  function rawSteps(s) {
    const c = s.turn, sg = SGN(c), out = [], dice = [...new Set(s.dice)];
    const home = allHome(s, c);
    for (let p = 1; p <= 24; p++) {
      if (s.pts[p] * sg <= 0) continue;
      const k = relOf(c, p);
      if (k === 1 && s.head >= s.maxHead) continue;
      for (const d of dice) {
        const nk = k + d;
        if (nk <= 24) {
          const to = ptOf(c, nk);
          if (s.pts[to] * sg < 0) continue;
          if (blockIllegal(s, c, p, to)) continue;
          out.push({ from: p, to, die: d });
        } else if (home) {
          const need = 25 - k;
          let farther = false;
          if (d > need) for (let j = 19; j < k; j++) if (s.pts[ptOf(c, j)] * sg > 0) farther = true;
          if (d === need || (d > need && !farther)) out.push({ from: p, to: 'o', die: d });
        }
      }
    }
    return out;
  }

  function apply(s, st) {
    const n = clone(s), c = n.turn, sg = SGN(c);
    n.pts[st.from] -= sg;
    if (st.to === 'o') n.off[c]++; else n.pts[st.to] += sg;
    n.dice.splice(n.dice.indexOf(st.die), 1);
    n.played.push(st);
    if (relOf(c, st.from) === 1) n.head++;
    return n;
  }

  const memo = new Map();
  const keyOf = s => s.turn + s.pts.join() + s.off.w + ',' + s.off.b + s.dice.slice().sort().join('') + s.head + s.maxHead;
  function best(s) {
    const k = keyOf(s);
    if (memo.has(k)) return memo.get(k);
    let b = 0;
    for (const st of rawSteps(s)) {
      const v = 1 + best(apply(s, st));
      if (v > b) b = v;
      if (b === s.dice.length) break;
    }
    if (memo.size > 200000) memo.clear();
    memo.set(k, b);
    return b;
  }

  // the moves that may be played next (respecting "use as many dice as possible" and "larger die")
  function legalSteps(s) {
    if (!s.started || !s.dice.length) return [];
    const raw = rawSteps(s);
    if (!raw.length) return [];
    const B = best(s);
    let out = raw.filter(st => 1 + best(apply(s, st)) === B);
    if (s.played.length === 0 && s.roll.length === 2 && s.roll[0] !== s.roll[1] && B === 1) {
      const mx = Math.max(...s.roll), hi = out.filter(st => st.die === mx);
      if (hi.length) out = hi;
    }
    return out;
  }

  function setRoll(s, d1, d2) {
    const n = clone(s), c = n.turn;
    n.roll = [d1, d2]; n.dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
    n.started = true; n.played = []; n.head = 0;
    n.maxHead = (n.first[c] && d1 === d2) ? 2 : 1;   // first turn of each player: any double lets two checkers leave the head
    return n;
  }
  function endTurn(s) {
    const n = clone(s), c = n.turn;
    n.first[c] = false; n.turn = OPP(c); n.dice = []; n.roll = []; n.started = false; n.played = []; n.head = 0;
    return n;
  }

  // notation: distance still to go from the end of the player's own path, so every player reads it the same way
  const disp = (c, p) => (p === 'o' ? 'off' : 25 - relOf(c, p));

  function replay(entries) {
    let s = initial();
    const positions = [s], ended = [], rows = [];
    let row = null;
    for (const e of entries) {
      let n, endedFlag = false;
      const c = s.turn;
      if (/^R[1-6][1-6]$/.test(e)) {
        if (s.started) break;
        n = setRoll(s, +e[1], +e[2]);
        row = { who: c, roll: [+e[1], +e[2]], steps: [], pass: false, first: positions.length, last: 0 };
        rows.push(row);
      } else if (e === 'pass') {
        if (!row || !s.started || legalSteps(s).length) break;
        row.pass = true; n = endTurn(s); endedFlag = true;
      } else {
        const m = /^(\d+)>(\d+|o):([1-6])$/.exec(e);
        if (!m || !row || !s.started) break;
        const st = { from: +m[1], to: m[2] === 'o' ? 'o' : +m[2], die: +m[3] };
        if (!legalSteps(s).some(x => x.from === st.from && x.to === st.to && x.die === st.die)) break;
        n = apply(s, st);
        row.steps.push({ txt: disp(c, st.from) + '/' + disp(c, st.to) });
        if (n.off[c] === 15 || n.dice.length === 0 || legalSteps(n).length === 0) { n = endTurn(n); endedFlag = true; }
      }
      positions.push(n); ended.push(endedFlag);
      if (row) row.last = positions.length - 1;
      s = n;
    }
    return { positions, ended, rows, len: positions.length, entries };
  }

  // pips = total distance still to travel before every checker is borne off
  function pips(s, c) {
    const sg = SGN(c); let t = 0;
    for (let p = 1; p <= 24; p++) if (s.pts[p] * sg > 0) t += s.pts[p] * sg * (25 - relOf(c, p));
    return t;
  }

  function status(rp, vi) {
    const s = rp.positions[vi];
    for (const c of ['w', 'b']) {
      if (s.off[c] === 15) {
        const reason = s.off[OPP(c)] === 0 ? 'mars' : 'borne_off';
        return { over: { result: c === 'w' ? '1-0' : '0-1', reason }, legal: [], turn: s.turn, lastEnded: true, needRoll: false, mustPass: false, claim: null, check: false, insuf: { w: false, b: false } };
      }
    }
    const legal = legalSteps(s);
    return {
      over: null, legal, turn: s.turn, lastEnded: vi > 0 ? rp.ended[vi - 1] : true,
      needRoll: !s.started, mustPass: s.started && legal.length === 0, dice: s.dice, roll: s.roll,
      claim: null, check: false, insuf: { w: false, b: false }
    };
  }

  /* ---------- UI adapter ---------- */
  let sel = null, hooks = null, lastAnim = '';
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const die = (n, c, used, anim) => `<div class="die ${c}${used ? ' used' : ''}${anim ? ' anim' : ''}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<i class="${PIPS[n].includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;

  function stackHtml(count, c) {
    const n = Math.abs(count), show = Math.min(n, 5);
    let h = '';
    for (let i = 0; i < show; i++) h += `<div class="ck ${c}">${i === show - 1 && n > 5 ? n : ''}</div>`;
    return h;
  }

  const G = {
    id: 'nard', label: 'Nərd', draws: false,
    replay, status,
    resetSel() { sel = null; },

    render(el, ctx) {
      const { rp, vi, st } = ctx, s = rp.positions[vi], flip = ctx.bottom === 'b';
      if (sel !== null && !(ctx.interactive && st.legal.some(x => x.from === sel))) sel = null;
      const targets = new Set(sel === null ? [] : st.legal.filter(x => x.from === sel).map(x => x.to));
      const movable = new Set(ctx.interactive ? st.legal.map(x => x.from) : []);
      // point numbers on screen; the bottom-right corner is the home of the side shown at the bottom
      const top = flip ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
      const bot = flip ? [24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13] : [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
      const cell = (p, pos) => {
        const cnt = s.pts[p], c = cnt > 0 ? 'w' : 'b';
        const cls = ['pt', pos, (p % 2 ? 'odd' : 'even'), targets.has(p) ? 'tgt' : '', sel === p ? 'sel' : '', movable.has(p) && sel === null ? 'can' : ''].join(' ');
        return `<div class="${cls}" data-pt="${p}"><span class="num">${p}</span><div class="stack">${cnt ? stackHtml(cnt, c) : ''}</div></div>`;
      };
      const row = (pts, pos, end) => pts.slice(0, 6).map(p => cell(p, pos)).join('') + '<div class="barh"></div>' + pts.slice(6).map(p => cell(p, pos)).join('') + end;
      const botC = flip ? 'b' : 'w', topC = botC === 'w' ? 'b' : 'w';
      const tray = (c, pos) => `<div class="tray ${pos}${targets.has('o') && s.turn === c ? ' tgt' : ''}" data-pt="o"><span class="trc">${s.off[c] || ''}</span><div class="offs">${('<i class="' + c + '"></i>').repeat(Math.min(s.off[c], 15))}</div></div>`;

      // dice
      let dice = '';
      const key = rp.entries.length + ':' + s.roll.join('');
      const anim = s.started && key !== lastAnim && ctx.live;
      if (ctx.live) lastAnim = key;
      if (st.over) dice = '';
      else if (st.needRoll) dice = ctx.interactive
        ? `<button class="rollbtn" data-act="roll">🎲 Roll dice</button>`
        : `<div class="dicewait">${s.turn === 'w' ? 'White' : 'Black'} to roll…</div>`;
      else {
        // always two dice; after a double the badge shows how many of the four moves are left
        const rem = s.dice.slice(), dbl = s.roll[0] === s.roll[1];
        dice = '<div class="dice">' + s.roll.map(d => {
          if (dbl) return die(d, s.turn, s.dice.length === 0, anim);
          const i = rem.indexOf(d), used = i < 0; if (!used) rem.splice(i, 1);
          return die(d, s.turn, used, anim);
        }).join('') + '</div>' + (dbl && s.dice.length ? `<div class="dleft">Double: ${s.dice.length} moves left</div>` : '');
        if (st.mustPass) dice += `<div class="nomove">No legal moves</div>`;
      }

      el.innerHTML = `<div class="bgb long">
        <div class="bgrow top">${row(top, 'top', tray(topC, 'top'))}</div>
        <div class="bgrow bot">${row(bot, 'bot', tray(botC, 'bot'))}</div>
        <div class="bgdice">${dice}</div></div>`;
    },

    bind(el, h) {
      hooks = h;
      el.addEventListener('click', e => {
        const ctx = hooks.ctx();
        if (e.target.closest('[data-act=roll]')) { if (ctx.interactive) hooks.roll(); return; }
        if (!ctx.interactive || ctx.st.needRoll) return;
        const cell = e.target.closest('[data-pt]'); if (!cell) return;
        const raw = cell.dataset.pt, pt = raw === 'o' ? 'o' : +raw;
        const legal = ctx.st.legal;
        if (sel !== null) {
          const m = legal.filter(x => x.from === sel && x.to === pt);
          if (m.length) {
            const pick = m.reduce((a, b) => (b.die < a.die ? b : a));
            sel = null; hooks.submit(`${pick.from}>${pick.to}:${pick.die}`); return;
          }
        }
        if (pt !== 'o' && legal.some(x => x.from === pt)) sel = sel === pt ? null : pt; else sel = null;
        hooks.rerender();
      });
    },

    moveList(rp, vi) {
      let h = '';
      rp.rows.forEach(r => {
        const cur = vi >= r.first && vi <= r.last;
        h += `<div class="bgm ${cur ? 'cur' : ''}" data-v="${r.last}">
          <i class="who ${r.who}"></i><b>${r.roll[0]}-${r.roll[1]}</b><span>${r.pass ? 'no move' : r.steps.map(x => x.txt).join(' ')}</span></div>`;
      });
      return h;
    },

    sound(rp) {
      const e = rp.entries[rp.entries.length - 1] || '';
      return e[0] === 'R' ? 'dice' : 'move';
    },

    sideInfo(rp, vi, color) {
      const s = rp.positions[vi];
      return `<span class="pipinfo">Pips <b>${pips(s, color)}</b> · Off <b>${s.off[color]}</b></span>`;
    }
  };
  root.Games.nard = G;
  root.Nard = { initial, replay, status, legalSteps, apply, setRoll, endTurn, rawSteps, best, pips, relOf, ptOf };
})(window);
