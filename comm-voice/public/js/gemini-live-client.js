// 即時 AI 語音客服 — 直連 Google Gemini Live API（native audio）
// 取代自建的 voicebot-client.js（舊檔保留不刪）。
// 流程：向 Edge Function gemini-live-token 取短效憑證 → 用它直連 Gemini Live WebSocket
//       → 麥克風 16k PCM 上行、AI 24k PCM 下行、barge-in 由 Gemini 原生處理。
// GEMINI_API_KEY 不進前端；model/音色/人設都鎖在 token 的 liveConnectConstraints（見 Edge Function）。
//
// 用法（call.html）：
//   var bot = startGeminiVoicebot({
//     actx, tokenUrl, headers, setState, onLive, onEnded
//   });
//   ...掛斷時：bot.hangup();
//
// SDK 由 CDN 動態載入（esm.sh 提供瀏覽器 ESM 打包）。

function startGeminiVoicebot(opts) {
  var actx = opts.actx; // 由 call.html 在使用者點擊手勢內建立並 resume（iOS/Safari 需要）
  var setState = opts.setState || function () {};
  var onLive = opts.onLive || function () {};
  var onEnded = opts.onEnded || function () {};

  var session = null, stream = null, source = null, processor = null;
  var closed = false;

  // ---- 下行播放：排程串接 + 支援 barge-in 中斷 ----
  var nextStartTime = 0;      // 下一段音訊的排程起始時間
  var activeSources = [];     // 已排程但尚未播完的 BufferSource（中斷時全停）

  function playPcm24k(bytes) {
    var n = Math.floor(bytes.byteLength / 2);
    if (n === 0) return;
    var view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    var buf = actx.createBuffer(1, n, 24000); // Gemini Live 下行固定 24kHz 16-bit mono PCM
    var ch = buf.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    var src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(actx.destination);
    var now = actx.currentTime;
    var start = Math.max(now, nextStartTime);
    src.start(start);
    nextStartTime = start + buf.duration;
    activeSources.push(src);
    src.onended = function () {
      var idx = activeSources.indexOf(src);
      if (idx >= 0) activeSources.splice(idx, 1);
    };
  }

  function stopPlayback() { // barge-in：使用者插話時停掉 AI 正在講的話
    for (var i = 0; i < activeSources.length; i++) {
      try { activeSources[i].stop(); } catch (e) {}
    }
    activeSources = [];
    nextStartTime = 0;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), len = bin.length, out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(u8) {
    var s = "", chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    try { if (processor) processor.disconnect(); } catch (e) {}
    try { if (source) source.disconnect(); } catch (e) {}
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} // 修：確實釋放麥克風
    try { if (session) session.close(); } catch (e) {}
    stopPlayback();
  }

  function fail(msg) {
    setState("⚠️ " + msg);
    cleanup();
    onEnded("error");
  }

  // 1) 取短效憑證
  fetch(opts.tokenUrl, { method: "POST", headers: opts.headers })
    .then(function (r) { return r.json(); })
    .then(function (tok) {
      if (!tok || !tok.token) throw new Error(tok && tok.error ? tok.error : "取不到憑證");
      return tok;
    })
    // 2) 麥克風權限（echoCancellation 消喇叭回授，因為現在全雙工持續收音）
    .then(function (tok) {
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }).then(function (s) { stream = s; return tok; });
    })
    // 3) 載入 SDK 並連線
    .then(function (tok) {
      return import("https://esm.sh/@google/genai").then(function (mod) {
        var GoogleGenAI = mod.GoogleGenAI, Modality = mod.Modality;
        var ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
        return ai.live.connect({
          model: tok.model,
          // 其餘設定（音色/人設/情感對話）已鎖在 token 的 liveConnectConstraints
          config: { responseModalities: [Modality.AUDIO] },
          callbacks: {
            onopen: function () {
              if (closed) return;
              setState("🔴 通話中"); onLive();
              // 麥克風 → 16k PCM 上行
              source = actx.createMediaStreamSource(stream);
              processor = actx.createScriptProcessor(4096, 1, 1);
              var sink = actx.createGain(); sink.gain.value = 0; sink.connect(actx.destination);
              processor.onaudioprocess = function (e) {
                if (closed || !session) return;
                var input = e.inputBuffer.getChannelData(0);
                var ratio = actx.sampleRate / 16000;
                var outLen = Math.floor(input.length / ratio);
                var out = new Int16Array(outLen);
                for (var i = 0; i < outLen; i++) {
                  var v = input[Math.floor(i * ratio)];
                  out[i] = Math.max(-32768, Math.min(32767, v * 32768));
                }
                try {
                  session.sendRealtimeInput({
                    audio: { data: bytesToB64(new Uint8Array(out.buffer)), mimeType: "audio/pcm;rate=16000" },
                  });
                } catch (err) {}
              };
              source.connect(processor); processor.connect(sink);
            },
            onmessage: function (message) {
              if (closed) return;
              var sc = message.serverContent;
              // barge-in：使用者插話 → 立刻停掉 AI 正在播的話
              if (sc && sc.interrupted) { stopPlayback(); return; }
              // 下行音訊（native audio 走 modelTurn.parts[].inlineData）
              if (sc && sc.modelTurn && sc.modelTurn.parts) {
                for (var i = 0; i < sc.modelTurn.parts.length; i++) {
                  var p = sc.modelTurn.parts[i];
                  if (p.inlineData && p.inlineData.data) playPcm24k(b64ToBytes(p.inlineData.data));
                }
              }
              // 部分 SDK 版本也提供便捷欄位 message.data（base64 音訊）
              if (message.data) { try { playPcm24k(b64ToBytes(message.data)); } catch (e) {} }
            },
            onerror: function (e) { fail("AI 客服連線發生問題"); console.error("[gemini live] error", e); },
            onclose: function (e) {
              console.log("[gemini live] closed", e && e.reason);
              if (!closed) { cleanup(); onEnded("closed"); }
            },
          },
        }).then(function (sess) { session = sess; });
      });
    })
    .catch(function (err) {
      console.error("[gemini live] start failed", err);
      var m = String(err && err.message || err);
      if (/getUserMedia|Permission|NotAllowed/i.test(m)) fail("無法存取麥克風，請允許權限");
      else fail("無法連上 AI 客服");
    });

  return {
    hangup: function () { cleanup(); onEnded("hangup"); },
    setMute: function (m) {
      try { if (stream) stream.getAudioTracks().forEach(function (t) { t.enabled = !m; }); } catch (e) {}
    },
  };
}
