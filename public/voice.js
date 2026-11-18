/* Voice chat: WebRTC mesh between everyone in the room who joined the voice chat.
   Signaling goes through the room on the server: /api/voice and /api/signal to send, the room's WebSocket
   delivers the messages addressed to you (app.js forwards them to Voice.onSignal).
   Per person you choose whether you HEAR them and whether they HEAR YOU.
   NOTE: the microphone needs https:// or http://localhost (the public tunnel link is https). */
(function (root) {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let speakTimer = null;
  let cfg = null, joined = false, stream = null, micOn = true, myPid = null, roster = [], ac = null, open = false;
  const peers = new Map();            // pid -> peer
  const prefs = new Map();            // name -> { hear, speak }  (kept while the page is open)
  const pref = name => { if (!prefs.has(name)) prefs.set(name, { hear: true, speak: true }); return prefs.get(name); };

  function init(c) {
    cfg = c;
    $('#voiceHead').onclick = () => { open = !open; render(); };
    $('#voiceJoin').onclick = join;
    $('#voiceLeave').onclick = () => leave(true);
    $('#voiceMute').onclick = () => { micOn = !micOn; applyTracks(); render(); };
    $('#voiceList').onclick = e => {
      const h = e.target.closest('[data-vh]'), s = e.target.closest('[data-vs]');
      if (h) { const p = peers.get(h.dataset.vh); if (p) { p.hear = !p.hear; pref(p.name).hear = p.hear; p.audio.muted = !p.hear; render(); } }
      if (s) { const p = peers.get(s.dataset.vs); if (p) { p.speak = !p.speak; pref(p.name).speak = p.speak; applyTracks(); render(); } }
    };
    $('#voiceQuick').onclick = e => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      const [kind, val] = b.dataset.q.split(':'), on = val === 'all';
      for (const p of peers.values()) {
        if (kind === 'hear') { p.hear = on; pref(p.name).hear = on; p.audio.muted = !on; } else { p.speak = on; pref(p.name).speak = on; }
      }
      applyTracks(); render();
    };
    document.addEventListener('click', () => { for (const p of peers.values()) p.audio.play().catch(() => { }); if (ac && ac.state === 'suspended') ac.resume(); });
    render();
  }

  const micError = e => {
    if (!window.isSecureContext) return 'The microphone needs https. Use the public link (https://…) or open the site as localhost.';
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'Microphone permission was denied. Allow it in the browser address bar.';
    if (e && e.name === 'NotFoundError') return 'No microphone found.';
    return 'Could not start the microphone.';
  };

  async function join() {
    if (joined) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) { cfg.toast(micError()); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) { cfg.toast(micError(e)); return; }
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch { }
    joined = true; micOn = true; open = true;
    clearInterval(speakTimer); speakTimer = setInterval(speakTick, 160);   // only runs while you are in voice
    try { await register(); } catch (e) { cfg.toast(e.message); leave(false); return; }
    render();
  }
  async function register() { const c = cfg.ctx(); await cfg.api('/api/voice', { room: c.room, token: c.token, on: true }); }

  function leave(notify) {
    const was = joined;
    joined = false; clearInterval(speakTimer);
    roster = roster.filter(m => m.pid !== myPid); myPid = null;
    for (const pid of [...peers.keys()]) removePeer(pid);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (was && notify) { const c = cfg.ctx(); if (c.room) cfg.api('/api/voice', { room: c.room, token: c.token, on: false }).catch(() => { }); }
    render();
  }

  function applyTracks() { for (const p of peers.values()) if (p.track) p.track.enabled = micOn && p.speak; }

  function send(to, data) { const c = cfg.ctx(); return cfg.api('/api/signal', { room: c.room, token: c.token, to, data }).catch(() => { }); }

  function createPeer(m, initiator) {
    const pc = new RTCPeerConnection(ICE), pf = pref(m.name);
    const p = { pid: m.pid, name: m.name, role: m.role, pc, initiator, audio: new Audio(), track: null, hear: pf.hear, speak: pf.speak, pending: [], state: 'connecting', an: null, speaking: false };
    p.audio.autoplay = true; p.audio.playsInline = true; p.audio.muted = !p.hear;
    const t = stream.getAudioTracks()[0].clone(); t.enabled = micOn && p.speak; p.track = t;
    pc.addTrack(t, stream);
    pc.ontrack = e => {
      p.audio.srcObject = e.streams[0]; p.audio.play().catch(() => { });
      try {
        if (ac) { const src = ac.createMediaStreamSource(e.streams[0]), an = ac.createAnalyser(); an.fftSize = 256; src.connect(an); p.an = an; p.buf = new Uint8Array(an.fftSize); }
      } catch { }
    };
    pc.onicecandidate = e => { if (e.candidate) send(m.pid, { c: e.candidate }); };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { if (peers.get(m.pid) === p) { removePeer(m.pid); setTimeout(() => sync(null), 800); } }
      render();
    };
    peers.set(m.pid, p);
    if (initiator) (async () => { try { const o = await pc.createOffer(); await pc.setLocalDescription(o); send(m.pid, { sdp: pc.localDescription }); } catch { } })();
    return p;
  }
  function removePeer(pid) {
    const p = peers.get(pid); if (!p) return;
    peers.delete(pid);
    try { p.track && p.track.stop(); p.pc.close(); p.audio.srcObject = null; } catch { }
  }

  async function onSignal(from, data) {
    if (!joined || !stream) return;
    let p = peers.get(from);
    if (!p) p = createPeer(roster.find(x => x.pid === from) || { pid: from, name: 'Guest' }, false);
    const pc = p.pc;
    if (data.sdp) {
      if (data.sdp.type === 'offer' && pc.signalingState !== 'stable') { if (p.initiator) return; await pc.setLocalDescription({ type: 'rollback' }).catch(() => { }); }
      await pc.setRemoteDescription(data.sdp);
      for (const c of p.pending.splice(0)) await pc.addIceCandidate(c).catch(() => { });
      if (data.sdp.type === 'offer') { const a = await pc.createAnswer(); await pc.setLocalDescription(a); send(from, { sdp: pc.localDescription }); }
    } else if (data.c) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.c).catch(() => { }); else p.pending.push(data.c);
    }
  }

  // Called with every game snapshot (and internally to re-check peers)
  function sync(snap) {
    if (snap) { roster = snap.voice || []; myPid = snap.pid; }
    if (joined && snap && !snap.pid) register().catch(() => { });
    if (joined && stream && myPid) {
      const myIdx = roster.findIndex(m => m.pid === myPid);
      if (myIdx >= 0) {
        roster.forEach((m, i) => { if (m.pid !== myPid && !peers.has(m.pid)) createPeer(m, i < myIdx); });
        for (const pid of [...peers.keys()]) if (!roster.some(m => m.pid === pid)) removePeer(pid);
        for (const m of roster) { const p = peers.get(m.pid); if (p) { p.name = m.name; p.role = m.role; } }
      }
    }
    render();
  }

  function speakTick() {
    if (!joined) return;
    for (const p of peers.values()) {
      if (!p.an) continue;
      p.an.getByteTimeDomainData(p.buf);
      let max = 0; for (let i = 0; i < p.buf.length; i++) max = Math.max(max, Math.abs(p.buf[i] - 128));
      const sp = max > 10 && p.hear;
      if (sp !== p.speaking) { p.speaking = sp; const row = document.querySelector(`.vrow[data-pid="${p.pid}"]`); if (row) row.classList.toggle('speaking', sp); }
    }
  }

  const tag = r => (r === 's' ? '<i class="vtag">👁</i>' : r === 'w' ? '<i class="vtag w">W</i>' : r === 'b' ? '<i class="vtag b">B</i>' : '');
  const stateText = p => (p.state === 'connected' ? '' : p.state === 'failed' ? 'failed' : 'connecting…');

  function render() {
    const panel = $('#voicePanel'); if (!panel) return;
    const n = roster.length;
    $('#voiceCount').textContent = n ? String(n) : '';
    panel.classList.toggle('on', joined);
    $('#voiceBody').classList.toggle('hidden', !open);
    $('#voiceHead').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('#voiceJoin').classList.toggle('hidden', joined);
    $('#voiceLeave').classList.toggle('hidden', !joined);
    const mb = $('#voiceMute'); mb.classList.toggle('hidden', !joined); mb.textContent = micOn ? '🎤 Mic on' : '🔇 Mic muted'; mb.classList.toggle('off', !micOn);
    $('#voiceQuick').classList.toggle('hidden', !joined || !peers.size);
    const list = $('#voiceList');
    if (!joined) {
      list.innerHTML = n ? `<div class="vnote">In voice now: ${roster.map(m => esc(m.name)).join(', ')}</div>` : '<div class="vnote">Nobody is in the voice chat yet. Join and talk with the players and spectators — you choose who you hear and who hears you.</div>';
      return;
    }
    const others = roster.filter(m => m.pid !== myPid);
    if (!others.length) { list.innerHTML = '<div class="vnote">You are in the voice chat. Waiting for others to join…</div>'; return; }
    list.innerHTML = '<div class="vcols"><span></span><span title="You hear them">Hear</span><span title="They hear you">Talk</span></div>' + others.map(m => {
      const p = peers.get(m.pid) || { hear: true, speak: true, state: 'connecting' };
      return `<div class="vrow${p.speaking ? ' speaking' : ''}" data-pid="${m.pid}"><span class="vname">${esc(m.name)} ${tag(m.role)}<small>${stateText(p)}</small></span>
        <button class="vbtn ${p.hear ? 'on' : ''}" data-vh="${m.pid}" title="${p.hear ? 'You hear ' : 'You do not hear '}${esc(m.name)}">${p.hear ? '🔊' : '🔇'}</button>
        <button class="vbtn ${p.speak ? 'on' : ''}" data-vs="${m.pid}" title="${p.speak ? esc(m.name) + ' hears you' : esc(m.name) + ' does not hear you'}">${p.speak ? '🎤' : '🚫'}</button></div>`;
    }).join('');
  }

  // diagnostics (used for testing): connection state, routing flags and received audio bytes per peer
  async function debug() {
    const out = [];
    for (const p of peers.values()) {
      let bytes = 0, energy = 0;
      try { (await p.pc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') { bytes += r.bytesReceived || 0; energy += r.totalAudioEnergy || 0; } }); } catch { }
      out.push({ name: p.name, state: p.pc.connectionState, ice: p.pc.iceConnectionState, sig: p.pc.signalingState, gather: p.pc.iceGatheringState, remote: p.pc.remoteDescription && p.pc.remoteDescription.type, hear: p.hear, speak: p.speak, sending: !!(p.track && p.track.enabled), muted: p.audio.muted, bytesIn: bytes, energy });
    }
    return out;
  }
  root.Voice = { init, sync, leave: () => leave(true), render, isJoined: () => joined, debug, onSignal: (from, data) => onSignal(from, data).catch(() => { }) };
})(window);
