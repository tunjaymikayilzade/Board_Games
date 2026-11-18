/* Board Games Club - core: lobby, connection, clocks, chat, controls.
   Each game (chess, checkers, nard) plugs in through window.Games[id]. */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };

  /* ---------- static data ---------- */
  const GAMES = {
    chess: { name: 'Chess', icon: '♞', defTime: [5, 3], desc: 'The classic game of kings. Full rules with official Blitz, Rapid and Classical clocks.' },
    checkers: { name: 'Checkers', icon: '🔴', defTime: [10, 5], desc: 'Dama — Russian draughts. Flying kings, men capture backwards, captures are mandatory.' },
    nard: { name: 'Nərd', icon: '🎲', defTime: [10, 0], desc: 'The classic Azerbaijani nard (long nardy) with real dice.' },
    domino: { name: 'Dominoes', icon: '🀄', defTime: [10, 0], desc: 'Classic block dominoes: match the open ends, draw from the boneyard when stuck.' }
  };
  const RULES = {
    domino: ['Classic block dominoes with the double-six set (28 tiles). Each player gets 7 tiles; the other 14 stay face down in the boneyard.', 'The player holding the highest double opens with it automatically.', 'On your turn play a tile that matches either open end of the line: click a tile, and if it fits both ends click ◀ or ▶ to choose.', 'If nothing fits, draw from the boneyard until you can play (the Draw button). With an empty boneyard you pass.', 'First to play their last tile wins. If both players are blocked, the player with the fewest pips left wins (equal = draw). Tiles are shown at the end.', 'Your tiles stay hidden from your opponent and from spectators.'],
    chess: ['Checkmate the enemy king to win.', 'All rules: castling, en passant, promotion, check, stalemate.', 'Draws: threefold repetition and 50-move rule (claim), fivefold and 75-move (automatic), insufficient material, agreement.', 'Running out of time loses (a draw if the opponent cannot possibly mate).', 'Drag a piece or click it, then click the target square.'],
    checkers: ['Rus. draughts on the dark squares, 12 pieces each. White moves first.', 'Men move one square diagonally forward; kings move any distance diagonally.', 'Captures are <b>mandatory</b>. Men may capture backwards too; kings fly over any distance.', 'Multi-jumps must be completed. Click the piece, then each landing square in turn. Captured pieces are removed after the whole move.', 'A man reaching the far row becomes a king (even mid-capture, and then keeps capturing).', 'You lose when you have no pieces or no legal move. Draws: threefold repetition, or 15 moves of only kings without a capture.'],
    nard: ['Race all 15 checkers around the board and bear them off before your opponent. Roll the dice, then click a checker and its destination.', 'All checkers start on the <b>head</b> (white on point 24, black on point 12). Both players move the same way round the board. There is no hitting: a point held by the opponent is simply blocked.', 'Only <b>one checker may leave the head per turn</b> (two on your first turn if you roll any double).', 'You cannot build a row of 6 blocked points unless an opponent checker is already ahead of it.', 'You must use both dice if possible, otherwise the larger one. Doubles give four moves.', 'Bear off once all your checkers are in the last quarter. First to bear off all 15 wins: 1 point, or 2 points ("mars") if the opponent has borne off none.']
  };
  // Chess: official FIDE time categories (the increment is counted for 60 moves).
  // Nərd has no official speed categories.
  const FIDE_TIPS = [
    ['Blitz', [[3, 0], [3, 2], [5, 0], [5, 3]], '<b>Blitz</b> is the official fast category: 10 minutes or less per player (counting the increment as 60 moves). Quick decisions, but you can still calculate a few moves ahead.'],
    ['Rapid', [[10, 5], [15, 10], [30, 0]], '<b>Rapid</b> is the official middle category: more than 10 and less than 60 minutes per player (counting the increment as 60 moves). Time to plan and think carefully.'],
    ['Classical', [[60, 0], [90, 30]], '<b>Classical</b> (standard) is the official slow category: 60 minutes or more per player (counting the increment as 60 moves). Deep, tournament-style games that can last for hours.']
  ];
  // Checkers: the time controls listed in section 10 of the IDF "Rules of Official competitions in draughts-64"
  const IDF_TIPS = [
    ['Blitz', [[3, 0], [3, 2], [3, 3]], '<b>Blitz</b> in draughts-64: the International Draughts Federation (IDF) rules allow 3 minutes for the whole game, with either no increment or 2 or 3 seconds added per move.'],
    ['Rapid', [[15, 0], [10, 0], [10, 3], [10, 5], [7, 3], [7, 5], [6, 3], [6, 5], [5, 3], [5, 5]], '<b>Rapid</b> in draughts-64: the IDF rules allow 15 or 10 minutes per player for the whole game, or 10, 7, 6 or 5 minutes plus 3 or 5 seconds added per move.'],
    ['Classical', [[60, 0], [45, 30], [45, 15], [45, 10], [25, 10], [25, 5], [20, 10]], '<b>Classical</b> in draughts-64: the IDF rules allow 60 minutes for the whole game, or 45, 25 or 20 minutes plus a per-move increment of 30, 15, 10 or 5 seconds (as listed). The IDF board may set other controls for specific events.']
  ];
  const TIPS = { domino: [['Match clock', [[5, 0], [10, 0], [20, 0], [30, 0]], 'Dominoes has <b>no official speed categories</b>, so there are no names like Blitz or Rapid. Pick the total time each player has for the whole game. For no clock at all, type 0 in the minutes box below.']], chess: FIDE_TIPS, checkers: IDF_TIPS, nard: [['Match clock', [[5, 0], [10, 0], [20, 0], [30, 0]], 'Nərd has <b>no official speed categories</b>, so there are no names like Blitz or Rapid. Pick the total time each player has for the whole game. For no clock at all, type 0 in the minutes box below.']] };
  const CATS = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', timed: '', unlimited: 'No clock' };
  const REASONS = {
    checkmate: 'Checkmate', stalemate: 'Stalemate', insufficient: 'Insufficient material', fivefold: 'Fivefold repetition',
    '75move': '75-move rule', resign: 'Resignation', timeout: 'Time out', timeout_insufficient: 'Time out, but the opponent has insufficient material',
    agreement: 'Agreement', threefold: 'Threefold repetition', '50move': '50-move rule', aborted: 'Game aborted',
    no_moves: 'No legal moves left', repetition: 'Threefold repetition', kings15: '15 moves with only kings',
    borne_off: 'All checkers borne off (1 point)', mars: 'Mars (2 points)',
    domino_out: 'Played the last tile', domino_blocked: 'Blocked: fewest pips wins'
  };

  const S = {
    room: null, token: null, role: 's', snap: null, offset: 0, moves: [], rp: null, rpKey: '', view: null, flip: false,
    game: null, G: null, gen: 0, sound: lsGet('chess.sound', true), snapSeen: false, lastStatus: null, setupGame: null
  };
  const preset = { base: 5, inc: 0 };
  let color = 'r';

  /* ---------- helpers ---------- */
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Error'), { status: r.status });
    return j;
  }
  function toast(t) {
    const el = $('#toast'); el.textContent = t; el.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2800);
  }
  const showScreen = id => $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id));
  const setTheme = g => { document.body.dataset.game = g || 'home'; };
  const getName = () => ($('#nameInput').value || $('#invName').value || '').trim() || 'Guest';
  const rooms = () => lsGet('chess.rooms', {});
  const saveRoom = (id, v) => { const r = rooms(); r[id] = v; lsSet('chess.rooms', r); };
  const modeLabel = m => m.cat === 'unlimited' ? 'No clock' : `${m.base / 60000}+${m.inc / 1000}` + (CATS[m.cat] ? ' · ' + CATS[m.cat] : '');
  const gameLabel = g => (GAMES[g] ? GAMES[g].name : g);
  const parseCode = str => { const m = /[?&]r=([A-Za-z0-9]+)/.exec(str); return (m ? m[1] : String(str).trim()).toUpperCase().replace(/[^A-Z0-9]/g, ''); };

  /* ---------- sounds: real recordings (CC0), see sounds/CREDITS.txt ---------- */
  let ac;
  const BANK = {          // game -> event -> sample names (a random one is played, slightly varied in pitch)
    chess: { move: ['chess-move-1', 'chess-move-2', 'chess-move-3'], capture: ['chess-cap-1', 'chess-cap-2', 'chess-cap-3'], check: ['chess-check'] },
    checkers: { move: ['checkers-move-1', 'checkers-move-2', 'checkers-move-3'], capture: ['checkers-cap-1', 'checkers-cap-2', 'checkers-cap-3', 'checkers-cap-4'] },
    nard: { move: ['nard-move-1', 'nard-move-2', 'nard-move-3'], dice: ['nard-dice-1', 'nard-dice-2', 'nard-dice-3', 'nard-dice-4'] },
    domino: { move: ['domino-move-1', 'domino-move-2', 'domino-move-3', 'domino-move-4'], capture: ['domino-draw-1', 'domino-draw-2', 'domino-draw-3'] }
  };
  const bufs = {}, loading = {};
  function audioCtx() { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; }
  function load(name) {
    if (bufs[name] || loading[name]) return;
    loading[name] = true;
    fetch('/sounds/' + name + '.wav').then(r => r.arrayBuffer())
      .then(ab => new Promise((ok, no) => audioCtx().decodeAudioData(ab, ok, no)))
      .then(b => { bufs[name] = b; }).catch(() => { loading[name] = false; });
  }
  function sample(name, vol = 1, delay = 0) {
    if (!S.sound) return;
    try {
      const b = bufs[name]; if (!b) { load(name); return; }
      const c = audioCtx(), src = c.createBufferSource(), g = c.createGain();
      src.buffer = b; src.playbackRate.value = 0.95 + Math.random() * 0.1; g.gain.value = vol;
      src.connect(g).connect(c.destination); src.start(c.currentTime + delay);
    } catch { }
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function playEvent(game, ev) { const bank = BANK[game] || BANK.chess; sample(pick(bank[ev] || bank.move), game === 'domino' && ev === 'move' ? 1.25 : 1); }
  function preload(game) { const bank = BANK[game]; if (bank) Object.values(bank).flat().forEach(load); }
  window.SndDebug = () => ({ state: ac && ac.state, loaded: Object.keys(bufs), sound: S.sound });
  const SND = {
    end: () => sample('end', .9),
    win: () => { sample('win-1', .8); sample('win-2', .8, .16); sample('win-1', .7, .34); }
  };

  /* ---------- confetti ---------- */
  function confetti() {
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight; cv.style.display = 'block';
    const cols = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb', '#ffffff'];
    const ps = Array.from({ length: 160 }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .5, vx: (Math.random() - .5) * 4, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6, c: cols[(Math.random() * cols.length) | 0], a: Math.random() * 6, va: (Math.random() - .5) * .3 }));
    let t0 = performance.now();
    clearTimeout(confetti.stop); confetti.stop = setTimeout(() => { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; }, 4300);   // also stops in hidden tabs
    (function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of ps) { p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r * .6); ctx.restore(); }
      if (t - t0 < 3800) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; }
    })(t0);
  }

  /* ---------- LOBBY: home ---------- */
  function showHome() {
    leaveRoomState(); setTheme('home'); showScreen('lobby'); document.title = 'Board Games Club';
    $('#home').classList.remove('hidden'); $('#setup').classList.add('hidden');
    history.replaceState(null, '', location.pathname); refreshLive();
  }
  function liveItem(r, showGame) {
    const g = GAMES[r.game] || GAMES.chess;
    return `<div class="item ${r.game}" data-room="${r.id}" title="Right-click for options"><div class="gi">${g.icon}</div><div class="info"><div class="vs">${esc(r.w || '⏳ waiting')} ⚔ ${esc(r.b || '⏳ waiting')}</div>
      <div class="meta">${showGame ? gameLabel(r.game) + ' · ' : ''}${modeLabel(r.mode)} · ${r.status === 'waiting' ? 'looking for opponent' : r.moves + ' moves'} · 👁 ${r.specs}</div></div>
      ${r.status === 'waiting' ? `<button class="btn primary sm" data-join="${r.id}">Join</button>` : ''}<button class="btn sm" data-watch="${r.id}">Watch</button></div>`;
  }
  // right-click (or long-press) a game in the live list -> delete it for everybody
  function initLiveMenu() {
    const menu = document.createElement('div');
    menu.className = 'ctxmenu hidden';
    menu.innerHTML = '<button type="button" data-del>🗑 Delete game</button>';
    document.body.appendChild(menu);
    let target = null;
    const hide = () => menu.classList.add('hidden');
    document.addEventListener('contextmenu', e => {
      const it = e.target.closest('.live .item');
      if (!it) { hide(); return; }
      e.preventDefault();
      target = it.dataset.room;
      menu.style.left = Math.min(e.clientX, innerWidth - 170) + 'px';
      menu.style.top = Math.min(e.clientY, innerHeight - 50) + 'px';
      menu.classList.remove('hidden');
    });
    menu.querySelector('[data-del]').onclick = async () => {
      hide();
      if (!target || !confirm('Delete this game for everyone? Players and spectators will be disconnected.')) return;
      try { await api('/api/close', { room: target }); toast('Game deleted'); } catch (e) { toast(e.message); }
      target = null; refreshLive();
    };
    document.addEventListener('click', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  }
  async function refreshLive() {
    try {
      const { rooms: all } = await api('/api/rooms');
      const home = $('#liveListAll'), setup = $('#liveList');
      $('#liveCountAll').textContent = all.length ? `(${all.length})` : '';
      home.innerHTML = all.length ? all.map(r => liveItem(r, true)).join('') : '<div class="muted">No open games yet. Pick a game above and create the first one!</div>';
      const mine = all.filter(r => r.game === S.setupGame);
      $('#liveCount').textContent = mine.length ? `(${mine.length})` : '';
      setup.innerHTML = mine.length ? mine.map(r => liveItem(r, false)).join('') : '<div class="muted">No open games right now.</div>';
      $$('[data-join]').forEach(b => b.onclick = () => enter(b.dataset.join, false));
      $$('[data-watch]').forEach(b => b.onclick = () => enter(b.dataset.watch, true));
    } catch { }
  }

  /* ---------- LOBBY: setup for one game ---------- */
  function showSetup(g) {
    S.setupGame = g; setTheme(g);
    const m = GAMES[g];
    $('#home').classList.add('hidden'); $('#setup').classList.remove('hidden');
    $('#setupIcon').textContent = m.icon; $('#setupTitle').textContent = m.name; $('#setupDesc').textContent = m.desc;
    $('#liveGameName').textContent = m.name.toLowerCase();
    $('#rules').innerHTML = '<ul>' + RULES[g].map(x => `<li>${x}</li>`).join('') + '</ul>';
    buildPresets(g);
    preset.base = m.defTime[0]; preset.inc = m.defTime[1]; $('#cMin').value = preset.base; $('#cInc').value = preset.inc; markPreset();
    $('#localBtn').classList.toggle('hidden', g === 'domino');   // hidden tiles make a shared screen pointless (the computer mode still works)
    window.scrollTo(0, 0); refreshLive();
  }
  function buildPresets(g) {
    const box = $('#presets'); box.innerHTML = '';
    for (const [lbl, items, info] of TIPS[g]) {
      const g = document.createElement('div'); g.className = 'pgroup';
      g.innerHTML = `<span class="lbl">${lbl} <button type="button" class="pinfo-btn" title="What is ${lbl}?" aria-label="What is ${lbl}?">▾</button></span>`;
      const tip = document.createElement('div'); tip.className = 'pinfo hidden'; tip.innerHTML = info;
      const ib = g.querySelector('.pinfo-btn');
      ib.onclick = () => { const open = tip.classList.toggle('hidden') === false; ib.classList.toggle('open', open); };
      for (const [m, i] of items) {
        const b = document.createElement('button'); b.className = 'pbtn'; b.textContent = m === 0 ? '∞' : `${m}+${i}`;
        b.dataset.m = m; b.dataset.i = i;
        b.onclick = () => { preset.base = m; preset.inc = i; $('#cMin').value = m; $('#cInc').value = i; markPreset(); };
        g.appendChild(b);
      }
      g.appendChild(tip); box.appendChild(g);
    }
    markPreset();
  }
  function markPreset() { $$('.pbtn').forEach(b => b.classList.toggle('on', +b.dataset.m === +preset.base && +b.dataset.i === +preset.inc)); }

  function initLobby() {
    $('#nameInput').value = lsGet('chess.name', '');
    $('#nameInput').oninput = e => lsSet('chess.name', e.target.value);
    for (const id of ['#cMin', '#cInc']) $(id).oninput = () => { preset.base = +$('#cMin').value || 0; preset.inc = +$('#cInc').value || 0; markPreset(); };
    $$('#colorSeg button').forEach(b => b.onclick = () => { color = b.dataset.c; $$('#colorSeg button').forEach(x => x.classList.toggle('on', x === b)); });
    $$('[data-pick]').forEach(b => b.onclick = () => showSetup(b.dataset.pick));
    $('#backHome').onclick = showHome;
    $('#createBtn').onclick = () => create(false);
    $('#localBtn').onclick = () => create(true);
    $('#joinBtn').onclick = () => joinCode(false);
    $('#watchBtn').onclick = () => joinCode(true);
    $('#codeInput').onkeydown = e => { if (e.key === 'Enter') joinCode(false); };
    clearInterval(initLobby.t);
    initLobby.t = setInterval(() => { if (!$('#lobby').classList.contains('hidden')) refreshLive(); }, 4000);
  }
  async function create(local) {
    try {
      const j = await api('/api/create', { name: getName(), game: S.setupGame, base: preset.base, inc: preset.inc, color, private: $('#privChk').checked, local });
      lsSet('chess.name', getName());
      begin(j);
    } catch (e) { toast(e.message); }
  }
  function joinCode(spectate) {
    const c = parseCode($('#codeInput').value);
    if (!c) return toast('Paste a room link or code first');
    if (!$('#nameInput').value) $('#nameInput').value = lsGet('chess.name', '');
    enter(c, spectate);
  }
  async function enter(id, spectate) {
    try {
      const saved = rooms()[id];
      const j = await api('/api/join', { room: id, name: getName(), token: saved && saved.token, spectate: spectate || (saved && saved.role === 's') });
      begin(j);
    } catch (e) { toast(e.message); }
  }
  function leaveRoomState() {
    S.gen++; S.room = null; S.snap = null; S.game = null; S.rp = null; S.rpKey = ''; S.moves = []; S.view = null;
    S.snapSeen = false; S.lastStatus = null; S.shownOver = null; S.gameNo = null; S.pendUntil = 0; renderControls.sig = null;
    $('#modal').classList.add('hidden');
    Voice.leave();
    if (S.ws) { const w = S.ws; S.ws = null; try { w.close(); } catch { } }
  }
  function begin(j) {
    leaveRoomState();
    saveRoom(j.room, { token: j.token, role: j.role });
    S.room = j.room; S.token = j.token; S.role = j.role; S.flip = false;
    history.replaceState(null, '', '?r=' + j.room);
    showScreen('game'); $('#roomCode').textContent = j.room; connect();
  }

  /* ---------- invite link ---------- */
  async function openInvite(id) {
    const saved = rooms()[id];
    if (saved) { try { const j = await api('/api/join', { room: id, name: getName(), token: saved.token, spectate: saved.role === 's' }); return begin(j); } catch { } }
    try {
      const r = await api('/api/room?id=' + encodeURIComponent(id));
      setTheme(r.game);
      $('#invName').value = lsGet('chess.name', '');
      const free = !r.local && (!r.w || !r.b);
      $('#invIcon').textContent = (GAMES[r.game] || GAMES.chess).icon;
      $('#invTitle').textContent = gameLabel(r.game) + ' · invitation';
      $('#invInfo').innerHTML = `${esc(r.w || '?')} ⚔ ${esc(r.b || '?')}<br>${modeLabel(r.mode)} · room ${esc(r.id)}<br>${free ? 'A seat is free — you can play.' : 'The game is full — you can watch.'}`;
      $('#invJoin').classList.toggle('hidden', !free);
      const go = spectate => { lsSet('chess.name', $('#invName').value); $('#nameInput').value = $('#invName').value; enter(id, spectate); };
      $('#invJoin').onclick = () => go(false);
      $('#invWatch').onclick = () => go(true);
      $('#invBack').onclick = showHome;
      showScreen('invite');
    } catch (e) { toast(e.message); showHome(); }
  }

  /* ---------- connection (WebSocket: the room pushes a fresh snapshot after every change) ---------- */
  function connect() {
    const gen = S.gen;
    let fails = 0;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    (async () => {
      while (S.gen === gen && S.room) {
        const opened = await openSocket(gen);
        if (S.gen !== gen) return;
        fails = opened ? 0 : fails + 1;
        if (!opened) {   // could not connect: is the room gone, or is it just the network?
          try { await api(`/api/state?room=${S.room}&token=${encodeURIComponent(S.token)}`); }
          catch (e) { if (e.status === 404 || e.status === 403) { toast('The room is closed or does not exist'); showHome(); return; } }
        }
        if (fails > 1 || opened) $('#status').innerHTML = 'Connection lost, reconnecting…';
        await sleep(Math.min(1000 * Math.max(1, fails), 5000));
      }
    })();
  }
  // Resolves true if the socket was open at some point, false if it never connected.
  function openSocket(gen) {
    return new Promise(resolve => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws, opened = false, ping;
      try { ws = new WebSocket(`${proto}://${location.host}/ws/${S.room}?token=${encodeURIComponent(S.token)}`); } catch { return resolve(false); }
      S.ws = ws;
      ws.onopen = () => { opened = true; ping = setInterval(() => { try { ws.send('ping'); } catch { } }, 25000); };
      ws.onmessage = e => {
        if (S.gen !== gen || e.data === 'pong') return;
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'state') onSnap(m.s); else if (m.t === 'sig') Voice.onSignal(m.from, m.data);
        else if (m.t === 'closed') { toast('This game was deleted'); showHome(); }
      };
      ws.onclose = () => { clearInterval(ping); if (S.ws === ws) S.ws = null; resolve(opened); };
      ws.onerror = () => { try { ws.close(); } catch { } };
    });
  }
  async function resync() {
    try { const s = await api(`/api/state?room=${S.room}&token=${encodeURIComponent(S.token)}`); S.moves = s.moves.slice(); S.rpKey = ''; onSnap(s, true); } catch { }
  }

  // swap in a fresh board element and attach the right game
  function setupGame(s) {
    S.game = s.game; S.G = Games[s.game]; S.rp = null; S.rpKey = ''; S.stKey = ''; preload(s.game);
    setTheme(s.game);
    const old = $('#board'), nb = old.cloneNode(false);
    old.replaceWith(nb); nb.className = s.game === 'nard' ? 'bgmode' : s.game === 'domino' ? 'dommode' : '';
    S.G.resetSel();
    S.G.bind(nb, {
      ctx: getCtx, rerender: renderBoard, submit: submitEntry, promo: choosePromo,
      roll: () => act('roll'), post: domPost
    });
    $('#gIcon').textContent = GAMES[s.game].icon; $('#gName').textContent = gameLabel(s.game);
    $('#gMode').textContent = modeLabel(s.mode);
    document.title = GAMES[s.game].name + ' · Board Games Club';
  }

  function onSnap(s, force) {
    if (S.game !== s.game) setupGame(s);
    const prevCount = S.moves.length;
    S.snap = s; S.role = s.role; S.offset = s.now - Date.now();
    const sm = s.moves, sameGame = S.gameNo === s.game_no;
    // keep our own just-played (not yet confirmed) moves if the server list is a prefix of ours
    const keepLocal = sameGame && Date.now() < S.pendUntil && S.moves.length > sm.length && sm.every((m, i) => S.moves[i] === m);
    if (!keepLocal || force) S.moves = sm.slice();
    if (!sameGame) { S.gameNo = s.game_no; S.view = null; S.G.resetSel(); S.passFor = null; S.stKey = ''; }
    ensureReplay();
    if (S.snapSeen && S.moves.length === prevCount + 1) playMoveSound();
    if (S.snapSeen && s.status === 'over' && S.lastStatus && S.lastStatus !== 'over') SND.end();
    if (!S.snapSeen && s.status === 'over') S.shownOver = s.id + ':' + s.game_no;
    S.snapSeen = true; S.lastStatus = s.status;
    renderAll();
    maybeShowResult(s);
    $('#voicePanel').classList.toggle('hidden', !!s.local);
    if (!s.local) Voice.sync(s);
  }
  function ensureReplay() {
    const k = S.game + '|' + S.moves.join(',');
    if (k !== S.rpKey || !S.rp) { S.rp = S.G.replay(S.moves); S.rpKey = k; }
  }
  function playMoveSound() { playEvent(S.game, S.G.sound(S.rp)); }

  /* ---------- state helpers ---------- */
  const lastIdx = () => S.rp.len - 1;
  const viewIdx = () => (S.view === null || S.view >= lastIdx() ? lastIdx() : Math.max(0, S.view));
  const isLive = () => viewIdx() === lastIdx();
  function statusAt(vi) {
    const k = S.rpKey + '#' + vi + '#' + (S.snap ? S.snap.version : '');
    if (S.stKey !== k) { S.stVal = S.G.status(S.rp, vi, S.snap); S.stKey = k; }
    return S.stVal;
  }
  // the colour this person plays (null for spectators and for shared-device games)
  function myColor() { return S.role === 'w' || S.role === 'b' ? S.role : null; }
  function canMoveNow() {
    const s = S.snap; if (!s || s.status !== 'playing' || !isLive()) return false;
    return S.role.includes(s.turn);
  }
  function getCtx() {
    const vi = viewIdx();
    return { rp: S.rp, vi, st: statusAt(vi), bottom: bottomColor(), interactive: canMoveNow(), live: isLive(), role: S.role, snap: S.snap, me: myColor() };
  }
  function bottomColor() {
    const mc = myColor(), base = mc === 'b' ? 'b' : 'w';
    return S.flip ? (base === 'w' ? 'b' : 'w') : base;
  }

  /* ---------- rendering ---------- */
  function renderAll() { renderBoard(); renderBars(); renderStatus(); renderMoves(); renderControls(); renderSide(); autoPass(); }
  function renderBoard() { S.G.render($('#board'), getCtx()); }

  function fmt(ms, unlimited) {
    if (unlimited) return '∞';
    ms = Math.max(0, ms);
    if (ms < 10000) return (Math.floor(ms / 100) / 10).toFixed(1);
    const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0');
  }
  function remaining(c) {
    const s = S.snap; let t = s.clocks[c];
    if (s.running && s.turn === c) t -= (Date.now() + S.offset - s.turn_start);
    return t;
  }
  function tickClocks() {
    const s = S.snap; if (!s || $('#game').classList.contains('hidden')) return;
    const bot = bottomColor(), top = bot === 'w' ? 'b' : 'w', un = s.mode.cat === 'unlimited';
    for (const [id, c] of [['#topBar', top], ['#botBar', bot]]) {
      const el = $(id + ' .clock'), t = remaining(c);
      el.textContent = fmt(t, un);
      el.classList.toggle('active', s.status === 'playing' && s.turn === c);
      el.classList.toggle('low', !un && s.status === 'playing' && t < 10000 && s.running);
      $(id).classList.toggle('turn', s.status === 'playing' && s.turn === c);
    }
  }
  // clocks refresh fast only while a timed game is actually running (keeps an idle page quiet)
  (function clockLoop() {
    tickClocks();
    const s = S.snap;
    let wait = 1000;
    if (s && !document.hidden && s.status === 'playing' && s.mode.cat !== 'unlimited' && !$('#game').classList.contains('hidden')) {
      wait = Math.min(remaining('w'), remaining('b')) < 11000 ? 100 : 250;
    }
    setTimeout(clockLoop, wait);
  })();

  const hue = str => { let h = 0; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  function renderBars() {
    const s = S.snap, vi = viewIdx();
    const bot = bottomColor(), top = bot === 'w' ? 'b' : 'w';
    for (const [id, c] of [['#topBar', top], ['#botBar', bot]]) {
      const pl = s.players[c], bar = $(id), name = pl ? pl.name : 'Waiting…';
      bar.querySelector('.pname').textContent = name;
      const av = bar.querySelector('.avatar');
      av.textContent = pl ? name[0].toUpperCase() : '?';
      av.style.background = pl ? `hsl(${hue(name)} 55% 45%)` : '#555';
      av.className = 'avatar ' + c;
      bar.querySelector('.dot').classList.toggle('on', !!(pl && pl.online));
      bar.querySelector('.cap').innerHTML = S.G.sideInfo(S.rp, vi, c);
    }
    tickClocks();
  }

  function resultText(s) {
    if (s.result === '1-0') return 'White wins'; if (s.result === '0-1') return 'Black wins';
    if (s.result === '1/2-1/2') return 'Draw'; return 'Game over';
  }
  function renderStatus() {
    const s = S.snap, el = $('#status');
    el.classList.toggle('over', s.status === 'over');
    if (s.status === 'waiting') { el.innerHTML = '⏳ Waiting for an opponent…<small>Send the link below to your friend</small>'; return; }
    if (s.status === 'over') {
      let me = '';
      const mc = myColor();
      if (mc) {
        const won = (s.result === '1-0' && mc === 'w') || (s.result === '0-1' && mc === 'b');
        me = s.result === '1/2-1/2' ? '🤝 ' : s.result === '*' ? '' : won ? '🏆 ' : '😔 ';
      }
      let n = S.game === 'nard' ? S.rp.rows.length + ' turns' : S.moves.length + ' moves';
      if (S.game === 'domino' && s.hands && s.hands.w && s.hands.b) {   // tiles are revealed at the end
        const pips = c => s.hands[c].reduce((t, x) => t + x[0] + x[1], 0);
        n = `pips left: White ${pips('w')}, Black ${pips('b')}`;
      }
      el.innerHTML = `${me}${resultText(s)}<small>${REASONS[s.reason] || ''} · ${n}</small>`; return;
    }
    const st = statusAt(lastIdx());
    const turnName = s.turn === 'w' ? 'White' : 'Black';
    let t;
    if (S.role === 'wb' || S.role === 's') t = `${turnName} to move`;
    else if (S.role === s.turn) t = '🟢 Your turn';
    else t = "Opponent's turn";
    if (st.check) t += ' — Check!';
    if (S.game === 'nard' && st.needRoll) t += ' — roll the dice';
    if (S.game === 'domino' && st.hint && (S.role === s.turn || S.role === 'wb')) t += ' — ' + st.hint;
    if (S.game === 'checkers' && st.mustCapture && (S.role === s.turn || S.role === 'wb')) t += ' — you must capture';
    const sub = [];
    if (!isLive()) sub.push('Viewing an earlier position (use ⏭ to return)');
    if (S.role === 's') sub.push('👁 Spectator mode');
    if (!s.running && s.mode.cat !== 'unlimited') sub.push('The clock starts after both sides have moved');
    el.innerHTML = t + (sub.length ? `<small>${sub.join('<br>')}</small>` : '');
  }

  function renderMoves() {
    const box = $('#moves'), vi = viewIdx();
    const html = S.G.moveList(S.rp, vi);
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.className = 'moves ' + (S.game === 'nard' || S.game === 'domino' ? 'bgl' : '');
    box.innerHTML = html || '<span class="muted" style="grid-column:1/4;padding:6px">Moves will appear here</span>';
    if (atBottom || isLive()) box.scrollTop = box.scrollHeight;
  }

  function renderControls() {
    const s = S.snap, box = $('#controls'), role = S.role, player = role !== 's';
    const st = statusAt(lastIdx());
    const claim = s.status === 'playing' && player ? st.claim : null;
    const sig = [s.status, role, s.draw_offer, s.rematch.join(), s.moves.length >= 2, claim, S.game].join('|');
    if (renderControls.sig === sig) return; renderControls.sig = sig;
    let h = '';
    if (player && s.status === 'playing') {
      h += `<button class="btn danger" data-a="resign">🏳 Resign</button>`;
      if (S.G.draws) {
        if (s.moves.length < 2) h += `<button class="btn" data-a="abort">✖ Abort</button>`;
        else if (s.local) h += `<button class="btn" data-a="draw_offer">🤝 Draw</button>`;
        else if (s.draw_offer === role) h += `<button class="btn" data-a="draw_decline">Withdraw offer</button>`;
        else h += `<button class="btn" data-a="draw_offer">🤝 Offer draw</button>`;
      } else if (s.moves.length < 4) h += `<button class="btn" data-a="abort">✖ Abort</button>`;
      if (claim) h += `<button class="btn primary" data-a="claim_draw" data-r="${claim}">Claim draw (${REASONS[claim]})</button>`;
    }
    if (player && s.status === 'over') {
      const mine = s.rematch.includes(role === 'wb' ? 'w' : role);
      h += `<button class="btn primary" data-a="rematch" ${mine ? 'disabled' : ''}>${mine ? 'Waiting for opponent…' : s.rematch.length ? '🔁 Accept rematch' : '🔁 Rematch (swap colors)'}</button>`;
    }
    box.innerHTML = h;
    const off = $('#offer');
    const offered = s.status === 'playing' && player && s.draw_offer && s.draw_offer !== role && role !== 'wb';
    off.classList.toggle('hidden', !offered);
    if (offered) off.innerHTML = `<span>🤝 Your opponent offers a draw</span><button class="btn primary sm" data-a="draw_accept">Accept</button><button class="btn sm" data-a="draw_decline">Decline</button>`;
  }

  function renderSide() {
    const s = S.snap;
    const share = $('#shareBox');
    if (s.local) share.innerHTML = '';
    else {
      const url = location.origin + '/?r=' + s.id;
      const key = s.id + s.status;
      if (share.dataset.k !== key) {
        share.dataset.k = key;
        share.innerHTML = `Room code: <b>${s.id}</b><br>${s.status === 'waiting' ? 'Send this link to your friend:' : 'Spectators can join with this link:'}
          <div class="row"><input readonly value="${esc(url)}" id="shareUrl"><button class="btn sm" id="copyBtn">Copy</button></div>`;
        $('#copyBtn').onclick = copyLink;
      }
    }
    $('#viewers').innerHTML = s.specs.length ? `👁 Spectators (${s.specs.length}): ${s.specs.map(esc).join(', ')}` : '';
    const log = $('#chatLog'); const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    const html = s.chat.map(m => `<div class="m ${m.s ? 's' : ''}"><b>${esc(m.name)}${m.s ? ' 👁' : ''}:</b> ${esc(m.text)}</div>`).join('');
    if (log.dataset.h !== html) { log.dataset.h = html; log.innerHTML = html; if (stick) log.scrollTop = log.scrollHeight; }
    $('#soundBtn').textContent = S.sound ? '🔊' : '🔇';
  }
  async function copyLink() {
    const url = location.origin + '/?r=' + S.room;
    try { await navigator.clipboard.writeText(url); } catch { const i = $('#shareUrl'); if (i) { i.select(); document.execCommand('copy'); } }
    toast('Link copied ✔');
  }

  /* ---------- result overlay ---------- */
  function maybeShowResult(s) {
    const k = s.id + ':' + s.game_no;
    if (s.status !== 'over' || S.shownOver === k) return;
    S.shownOver = k;
    if (s.result === '*') return;
    setTimeout(() => {
      if (!S.snap || S.snap.status !== 'over') return;
      const mc = myColor(), player = !!mc;
      const won = (s.result === '1-0' && mc === 'w') || (s.result === '0-1' && mc === 'b');
      let emoji = '🏁', title = resultText(s);
      if (player) { if (s.result === '1/2-1/2') { emoji = '🤝'; title = 'Draw'; } else if (won) { emoji = '🏆'; title = 'You won!'; SND.win(); confetti(); } else { emoji = '😔'; title = 'You lost'; } }
      const md = $('#modal');
      md.innerHTML = `<div class="box result"><div class="re">${emoji}</div><h2>${title}</h2><p class="muted">${player && !won && s.result !== '1/2-1/2' ? resultText(s) + ' · ' : ''}${REASONS[s.reason] || ''}</p>
        <div class="row" style="justify-content:center">${player ? '<button class="btn primary" data-a="rematch" data-close="1">🔁 Rematch</button>' : ''}<button class="btn" data-close="1">Close</button></div></div>`;
      md.classList.remove('hidden');
      md.onclick = e => { if (e.target === md || e.target.closest('[data-close]')) md.classList.add('hidden'); };
    }, 650);
  }

  /* ---------- moving ---------- */
  function choosePromo(c, cb) {
    const md = $('#modal');
    md.innerHTML = `<div class="box"><div>Promote your pawn to:</div><div class="promo">${['q', 'r', 'b', 'n'].map(p => `<button class="pcb" data-p="${p}">${Games.chess.pieceHtml(c, p)}</button>`).join('')}</div></div>`;
    md.classList.remove('hidden');
    md.onclick = e => {
      const b = e.target.closest('[data-p]');
      if (b) { md.classList.add('hidden'); cb(b.dataset.p); } else if (e.target === md) md.classList.add('hidden');
    };
  }
  async function submitEntry(entry) {
    S.moves.push(entry); S.view = null; S.pendUntil = Date.now() + 3000; ensureReplay();
    const st = statusAt(lastIdx());
    playMoveSound();
    renderAll();
    try {
      await api('/api/move', { room: S.room, token: S.token, mv: entry, end: st.lastEnded !== false, over: st.over, insuf: st.insuf });
    } catch (e) { toast(e.message); S.moves.pop(); S.rpKey = ''; await resync(); }
  }
  async function domPost(body) {
    try { await api('/api/domino', { room: S.room, token: S.token, ...body }); } catch (e) { toast(e.message); }
  }
  // nard / domino: nothing can be played -> pass automatically
  function autoPass() {
    if ((S.game !== 'nard' && S.game !== 'domino') || !canMoveNow()) return;
    const st = statusAt(lastIdx());
    if (!st.mustPass || S.passFor === S.moves.length) return;
    S.passFor = S.moves.length;
    setTimeout(() => {
      if (S.moves.length !== S.passFor || !canMoveNow()) return;
      if (S.game === 'domino') domPost({ op: 'pass' }); else submitEntry('pass');
    }, 1300);
  }

  /* ---------- buttons ---------- */
  async function act(type, extra = {}) {
    try { await api('/api/action', { room: S.room, token: S.token, type, ...extra }); } catch (e) { toast(e.message); }
  }
  function initUi() {
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-a]');
      if (a) {
        const t = a.dataset.a, s = S.snap;
        if (t === 'leave') return showHome();
        if (!s) return;
        if (t === 'resign') {
          const who = S.role === 'wb' ? (s.turn === 'w' ? 'White' : 'Black') : 'You';
          if (confirm(`${who === 'You' ? 'Do you' : who + ', do you'} really want to resign?`)) act('resign', { side: s.turn });
          return;
        }
        if (t === 'draw_offer' && s.local) { if (confirm('End the game as a draw?')) act(t); return; }
        if (t === 'claim_draw') return act(t, { reason: a.dataset.r });
        return act(t);
      }
      const mv = e.target.closest('[data-v]');
      if (mv && S.rp) { S.view = +mv.dataset.v; S.G.resetSel(); renderAll(); return; }
      const nav = e.target.closest('[data-nav]'); if (nav) navMove(nav.dataset.nav);
    });
    $('#flipBtn').onclick = () => { S.flip = !S.flip; renderAll(); };
    $('#soundBtn').onclick = () => { S.sound = !S.sound; lsSet('chess.sound', S.sound); renderSide(); };
    $('#roomChip').onclick = copyLink;
    $('#chatForm').onsubmit = async e => {
      e.preventDefault(); const i = $('#chatInput'), text = i.value.trim(); if (!text) return; i.value = '';
      try { await api('/api/chat', { room: S.room, token: S.token, text }); } catch (er) { toast(er.message); }
    };
    document.addEventListener('keydown', e => {
      if ($('#game').classList.contains('hidden') || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const k = { ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'start', ArrowDown: 'end', Home: 'start', End: 'end' }[e.key];
      if (k) { e.preventDefault(); navMove(k); }
    });
    addEventListener('resize', () => { if (S.rp && !$('#game').classList.contains('hidden')) renderBoard(); });
  }
  function navMove(k) {
    if (!S.rp) return; const vi = viewIdx(), last = lastIdx();
    const t = { start: 0, prev: Math.max(0, vi - 1), next: Math.min(last, vi + 1), end: last }[k];
    S.view = t >= last ? null : t; S.G.resetSel(); renderAll();
  }

  /* ---------- start ---------- */
  initLobby(); initUi(); initLiveMenu();
  Voice.init({ api, ctx: () => ({ room: S.room, token: S.token }), toast });
  const r = new URLSearchParams(location.search).get('r');
  if (r) openInvite(r.toUpperCase()); else showHome();
})();
