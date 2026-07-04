// 真人語音通話 — 共用 WebRTC 客戶端（客服頁與顧客頁共用）
// 信令走 Supabase Realtime（頁面需先以 CDN 載入 @supabase/supabase-js，暴露 window.supabase）。
// 用法：var call = WLCall({ room, role:'agent'|'customer', iceServers, onStatus,
//                          supabaseUrl, supabaseKey, record, onRecording });
//       call.start();  // 取麥克風 → 連信令頻道 → 建立 P2P 語音
//       call.setMute(true/false);  call.hangup();
// 角色：agent 為主叫（建立 offer），customer 為被叫（回 answer）。只有 agent 會發 offer，避免雙方搶話。
window.WLCall = function (opts) {
  var channel, sbClient; // 信令走 Supabase Realtime broadcast（hello 探索 + SDP/ICE 傳遞）
  var pc, localStream, started = false, closed = false, pendingIce = [];
  var recCtx, recDest, recorder, recChunks = [], recStartAt = 0; // 通話錄音（混錄自己+對方）
  var iceServers = (opts.iceServers && opts.iceServers.length) ? opts.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];

  function status(s, d) { try { opts.onStatus && opts.onStatus(s, d); } catch (e) {} }
  // offer/answer/ice/bye 走 broadcast 傳給同房對端（join/joined/peer-* 改由 presence 事件產生，不再走這裡）
  function sig(obj) { try { if (channel) channel.send({ type: 'broadcast', event: 'sig', payload: obj }); } catch (e) {} }

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

  // agent 發 offer，並「每秒重送、直到收到 answer」為止（上限 8 次）。
  // 為何要重送：Supabase Realtime broadcast 對「剛訂閱就馬上送」的訊息可能丟包，
  // 而誰剛訂閱取決於進場順序，無法只靠角色/時機避開；重送直到有回應最穩，也順帶容忍偶發丟包。
  var offerTimer = null, answered = false, offering = false;
  async function callAsAgent() {
    if (offering || answered) return; offering = true;
    if (!pc) makePc();
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    var tries = 0;
    function blast() {
      if (answered || closed) { clearInterval(offerTimer); offerTimer = null; return; }
      if (pc && pc.localDescription) sig({ type: 'offer', sdp: pc.localDescription });
      status('ringing');
      if (++tries >= 8) { clearInterval(offerTimer); offerTimer = null; } // 約 8 秒仍無 answer 就停
    }
    blast();
    offerTimer = setInterval(blast, 1000);
  }

  async function onSignal(m) {
    // hello：探索用心跳。agent 一收到對端 hello 就發 offer（並重送直到 answer）。
    if (m.type === 'hello') { if (opts.role === 'agent') callAsAgent(); return; }
    if (m.type === 'offer') { // customer = callee
      if (!pc) makePc();
      stopHello(); // 已進入協商，停止 hello 心跳
      // 重複 offer（對方沒收到 answer 而重送）→ 若已答過就直接重送既有 answer，不重跑協商
      if (pc.signalingState === 'stable' && pc.currentRemoteDescription && pc.localDescription) {
        sig({ type: 'answer', sdp: pc.localDescription }); return;
      }
      await pc.setRemoteDescription(m.sdp); flushIce();
      var ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      sig({ type: 'answer', sdp: pc.localDescription });
      return;
    }
    if (m.type === 'answer') { answered = true; stopHello(); if (offerTimer) { clearInterval(offerTimer); offerTimer = null; } if (pc && pc.signalingState !== 'stable') { await pc.setRemoteDescription(m.sdp); flushIce(); } return; }
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
    // 信令：Supabase Realtime broadcast。頻道名 = rtc-<room>。
    // 探索用週期性 hello，且只在 SUBSCRIBED 後才送——關鍵：頻道未 join 就 send 會被 supabase-js
    // 退回 REST 傳送而對端收不到；等 SUBSCRIBED 後送才走 WebSocket，實測可靠。
    // agent 收到對端 hello → 發 offer（並重送直到 answer）；掛斷走 bye，非優雅斷線靠 WebRTC connectionState。
    if (!window.supabase || !opts.supabaseUrl || !opts.supabaseKey) { status('error', '信令設定缺漏'); return; }
    sbClient = window.supabase.createClient(opts.supabaseUrl, opts.supabaseKey);
    channel = sbClient.channel('rtc-' + opts.room, { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'sig' }, function (e) { onSignal(e.payload); }) // 收對端的 hello/offer/answer/ice/bye
      .subscribe(function (st) {
        if (st === 'SUBSCRIBED') { startHello(); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { status('error', '信令連線問題'); }
        else if (st === 'CLOSED') { if (!closed) status('ended', 'ws-close'); }
      });
  }

  // 週期性 hello 探索：SUBSCRIBED 後開始，直到進入協商（agent 收 answer / customer 收 offer）或逾時。
  var helloTimer = null;
  function stopHello() { if (helloTimer) { clearInterval(helloTimer); helloTimer = null; } }
  function startHello() {
    status('signaling');
    var n = 0;
    function ping() {
      if (closed || answered || n++ > 20) { stopHello(); return; } // 上限約 20 秒
      sig({ type: 'hello', role: opts.role }); // 已 SUBSCRIBED，走 WebSocket
    }
    ping();
    helloTimer = setInterval(ping, 1000);
  }

  function setMute(muted) { if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; }); }
  function hangup(skipSig) {
    if (closed) return; closed = true;
    stopHello();
    if (!skipSig) sig({ type: 'bye' });
    finishRec(function () { // 先把錄音收尾（onRecording 回傳音檔）再關閉連線
      try { if (pc) pc.close(); } catch (e) {}
      try { if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (channel) sbClient.removeChannel(channel); } catch (e) {} // 退頻道 → 對端收到 presence leave
      status('ended', 'hangup');
    });
  }

  return { start: start, hangup: hangup, setMute: setMute };
};
