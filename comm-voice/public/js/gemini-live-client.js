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
  var msgCount = 0, totalAudio = 0;

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
      console.log("[gemini live] 已取得憑證，model=" + tok.model);
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
        console.log("[gemini live] SDK 已載入，開始連線");
        var GoogleGenAI = mod.GoogleGenAI, Modality = mod.Modality;
        var ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
        return ai.live.connect({
          model: tok.model,
          // 其餘設定（音色/人設/情感對話）已鎖在 token 的 liveConnectConstraints
          config: { responseModalities: [Modality.AUDIO] },
          callbacks: {
            onopen: function () {
              if (closed) return;
              console.log("[gemini live] WS 已連上（onopen）");
              setState("🔴 通話中"); onLive();
              // 麥克風 → 16k PCM 上行
              source = actx.createMediaStreamSource(stream);
              processor = actx.createScriptProcessor(4096, 1, 1);
              var sink = actx.createGain(); sink.gain.value = 0; sink.connect(actx.destination);
              var upCount = 0, upErrShown = 0;
              processor.onaudioprocess = function (e) {
                if (closed || !session) return;
                var input = e.inputBuffer.getChannelData(0);
                var ratio = actx.sampleRate / 16000;
                var outLen = Math.floor(input.length / ratio);
                var out = new Int16Array(outLen);
                var rms = 0;
                for (var i = 0; i < outLen; i++) {
                  var v = input[Math.floor(i * ratio)];
                  rms += v * v;
                  out[i] = Math.max(-32768, Math.min(32767, v * 32768));
                }
                rms = Math.sqrt(rms / (outLen || 1));
                try {
                  session.sendRealtimeInput({
                    audio: { data: bytesToB64(new Uint8Array(out.buffer)), mimeType: "audio/pcm;rate=16000" },
                  });
                  upCount++;
                  if (upCount % 25 === 0) console.log("[gemini live] 上行 " + upCount + " 塊  當前麥克風音量=" + rms.toFixed(3) + "（講話時應明顯>0.01）");
                } catch (err) {
                  if (upErrShown < 3) { console.error("[gemini live] 上行送音訊失敗（這就是 AI 不回應的原因）", err); upErrShown++; }
                }
              };
              source.connect(processor); processor.connect(sink);
            },
            onmessage: function (message) {
              if (closed) return;
              msgCount++;
              var sc = message.serverContent;
              // barge-in：使用者插話 → 立刻停掉 AI 正在播的話
              if (sc && sc.interrupted) { console.log("[gemini live] 被打斷（barge-in）"); stopPlayback(); return; }
              var gotAudio = false;
              // 下行音訊（native audio 走 modelTurn.parts[].inlineData）
              if (sc && sc.modelTurn && sc.modelTurn.parts) {
                for (var i = 0; i < sc.modelTurn.parts.length; i++) {
                  var p = sc.modelTurn.parts[i];
                  if (p.inlineData && p.inlineData.data) { var b = b64ToBytes(p.inlineData.data); totalAudio += b.byteLength; gotAudio = true; playPcm24k(b); }
                }
              } else if (message.data) {
                // 部分 SDK 版本提供便捷欄位 message.data（base64 音訊）；與上面二擇一避免重複播放
                try { var bb = b64ToBytes(message.data); totalAudio += bb.byteLength; gotAudio = true; playPcm24k(bb); } catch (e) {}
              }
              // 前 3 則與首次收到音訊時印出結構，方便除錯
              if (msgCount <= 3 || (gotAudio && totalAudio > 0 && msgCount <= 30)) {
                console.log("[gemini live] 第" + msgCount + "則  keys=" + Object.keys(message).join(",") +
                  "  scKeys=" + (sc ? Object.keys(sc).join(",") : "無serverContent") +
                  "  累積音訊=" + totalAudio + "bytes");
              }
            },
            onerror: function (e) { fail("AI 客服連線發生問題"); console.error("[gemini live] error", e); },
            onclose: function (e) {
              console.log("[gemini live] closed", e && e.reason);
              if (!closed) { cleanup(); onEnded("closed"); }
            },
          },
        }).then(function (sess) {
          session = sess;
          // native audio 是對話模型，連上後會靜靜等對方開口；主動送一個觸發讓 AI 先用 Leda 聲音問候客戶
          console.log("[gemini live] session ready，送出開場問候觸發");
          if (!closed) {
            try {
              session.sendClientContent({
                turns: [{ role: "user", parts: [{ text: "（電話已接通，請你主動用一句話親切問候並詢問客戶需要什麼協助）" }] }],
                turnComplete: true,
              });
            } catch (e) { console.error("[gemini live] 送開場問候失敗", e); }
          }
        });
      });
    })
    .catch(function (err) {
      console.error("[gemini live] start failed", err);
      var m = String(err && err.name || "") + " " + String(err && err.message || err);
      if (/NotAllowed|Permission|SecurityError/i.test(m)) fail("麥克風權限被拒，請允許後重試");
      else if (/NotReadable|Could not start audio|NotFound|Overconstrained|Device/i.test(m)) fail("麥克風無法啟動（可能被其他程式或分頁佔用），請關掉其他用到麥克風的程式再重試");
      else fail("無法連上 AI 客服");
    });

  return {
    hangup: function () { cleanup(); onEnded("hangup"); },
    setMute: function (m) {
      try { if (stream) stream.getAudioTracks().forEach(function (t) { t.enabled = !m; }); } catch (e) {}
    },
  };
}
