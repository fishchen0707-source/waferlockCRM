// 真人語音通話 — 共用 WebRTC 客戶端（客服頁與顧客頁共用）
// 用法：var call = WLCall({ room, role:'agent'|'customer', iceServers, onStatus });
//       call.start();  // 取麥克風 → 連信令 → 建立 P2P 語音
//       call.setMute(true/false);  call.hangup();
// 角色：agent 為主叫（建立 offer），customer 為被叫（回 answer）。只有 agent 會發 offer，避免雙方搶話。
window.WLCall = function (opts) {
  var ws, pc, localStream, started = false, closed = false, pendingIce = [];
  var recCtx, recDest, recorder, recChunks = [], recStartAt = 0; // 通話錄音（混錄自己+對方）
  var iceServers = (opts.iceServers && opts.iceServers.length) ? opts.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];

  function status(s, d) { try { opts.onStatus && opts.onStatus(s, d); } catch (e) {} }
  function sig(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }

  function playRemote(stream) {
    var a = document.getElementById('wl-remote-audio');
    if (!a) { a = document.createElement('audio'); a.id = 'wl-remote-audio'; a.autoplay = true; a.playsInline = true; document.body.appendChild(a); }
    a.srcObject = stream;
    var p = a.play(); if (p && p.catch) p.catch(function () {});
  }

  // 通話錄音：把「自己麥克風 + 對方聲音」混成一條音軌錄成 webm（接通、拿到對方音訊後啟動）
  function startRec(remoteStream) {
    if (!opts.record || recorder || !window.MediaRecorder) return;
    try {
      recCtx = new (window.AudioContext || window.webkitAudioContext)();
      recDest = recCtx.createMediaStreamDestination();
      try { recCtx.createMediaStreamSource(localStream).connect(recDest); } catch (e) {}
      try { recCtx.createMediaStreamSource(remoteStream).connect(recDest); } catch (e) {}
      var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      recorder = new MediaRecorder(recDest.stream, { mimeType: mime });
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
      recorder.start();
      recStartAt = Date.now();
    } catch (e) { recorder = null; }
  }
  function finishRec(done) {
    if (!recorder || recorder.state === 'inactive') { done(); return; }
    var dur = Math.round((Date.now() - recStartAt) / 1000);
    recorder.onstop = function () {
      try { if (opts.onRecording && recChunks.length) opts.onRecording(new Blob(recChunks, { type: recorder.mimeType }), dur); } catch (e) {}
      try { if (recCtx) recCtx.close(); } catch (e) {}
      done();
    };
    try { recorder.stop(); } catch (e) { done(); }
  }

  function makePc() {
    pc = new RTCPeerConnection({ iceServers: iceServers });
    localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
    pc.onicecandidate = function (e) { if (e.candidate) sig({ type: 'ice', candidate: e.candidate }); };
    pc.ontrack = function (e) { playRemote(e.streams[0]); startRec(e.streams[0]); status('connected'); };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      if (st === 'connected') status('connected');
      else if (st === 'failed' || st === 'disconnected' || st === 'closed') status('ended', st);
    };
    pc.oniceconnectionstatechange = function () { if (pc.iceConnectionState === 'failed') status('ended', 'ice-failed'); };
  }
  function flushIce() { var c; while ((c = pendingIce.shift())) { try { pc.addIceCandidate(c); } catch (e) {} } }

  async function callAsAgent() {
    if (!pc) makePc();
    if (pc.signalingState !== 'stable') return; // 已在協商，避免重複 offer
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sig({ type: 'offer', sdp: pc.localDescription });
    status('ringing');
  }

  async function onSignal(m) {
    if (m.type === 'joined') { status('signaling'); if (opts.role === 'agent' && m.peerPresent) callAsAgent(); return; }
    if (m.type === 'peer-join') { if (opts.role === 'agent') callAsAgent(); else status('signaling'); return; }
    if (m.type === 'peer-leave') { status('ended', 'peer-leave'); hangup(true); return; }
    if (m.type === 'offer') { // customer = callee
      if (!pc) makePc();
      await pc.setRemoteDescription(m.sdp); flushIce();
      var ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      sig({ type: 'answer', sdp: pc.localDescription });
      return;
    }
    if (m.type === 'answer') { if (pc) { await pc.setRemoteDescription(m.sdp); flushIce(); } return; }
    if (m.type === 'ice') {
      if (m.candidate) { if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(m.candidate); } catch (e) {} } else pendingIce.push(m.candidate); }
      return;
    }
    if (m.type === 'bye') { hangup(true); return; }
  }

  async function start() {
    if (started) return; started = true;
    status('mic');
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
    catch (e) { status('error', '需要麥克風權限'); return; }
    status('connecting');
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host + '/api/rtc/signal');
    ws.onopen = function () { sig({ type: 'join', room: opts.room, role: opts.role }); };
    ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } onSignal(m); };
    ws.onclose = function () { if (!closed) status('ended', 'ws-close'); };
    ws.onerror = function () { status('error', '信令連線問題'); };
  }

  function setMute(muted) { if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; }); }
  function hangup(skipSig) {
    if (closed) return; closed = true;
    if (!skipSig) sig({ type: 'bye' });
    finishRec(function () { // 先把錄音收尾（onRecording 回傳音檔）再關閉連線
      try { if (pc) pc.close(); } catch (e) {}
      try { if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (ws) ws.close(); } catch (e) {}
      status('ended', 'hangup');
    });
  }

  return { start: start, hangup: hangup, setMute: setMute };
};
