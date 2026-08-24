// 即時 AI 語音客服（voicebot）WebSocket 前端 + 轉真人 fallback
// 顧客頁在 GitHub Pages(https)，WS 必須用 wss 且指向 Render 服務（不能是 localhost）。
// 可用 window.VOICEBOT_URL 覆寫（本機開發時指到 ws://localhost:8000/ws/voicebot）。
var VOICEBOT_URL = window.VOICEBOT_URL || 'wss://waferlock-stt.onrender.com/ws/voicebot';

function startVoicebot(room, cfg, setState, SUPABASE_URL, SUPABASE_KEY, onStatus) {
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  }).then(function (stream) {
    var ws = new WebSocket(VOICEBOT_URL);
    ws.binaryType = 'arraybuffer';
    var actx = new (window.AudioContext || window.webkitAudioContext)();
    var source = actx.createMediaStreamSource(stream);
    var processor = actx.createScriptProcessor(4096, 1, 1);
    // 靜音匯流：processor 必須連到 destination 才會持續觸發 onaudioprocess，
    // 但直接連會把麥克風原音播出去造成回饋，所以中間串一個 gain=0 的節點。
    var sink = actx.createGain(); sink.gain.value = 0; sink.connect(actx.destination);

    // TTS 播放佇列 + 半雙工控制
    var playQueue = [], isPlaying = false, botSpeaking = false, resumeMicAt = 0;
    function playNext() {
      if (playQueue.length === 0) {
        isPlaying = false; botSpeaking = false;
        resumeMicAt = Date.now() + 350; // 播完再等 350ms 才恢復收音，避開喇叭回音尾巴
        return;
      }
      isPlaying = true; botSpeaking = true;
      var src = actx.createBufferSource();
      src.buffer = playQueue.shift();
      src.connect(actx.destination);
      src.onended = playNext;
      src.start();
    }
    // Riva TTS 回的是裸 16-bit PCM（無 WAV 表頭），decodeAudioData 會失敗，直接手動建 AudioBuffer
    function pcm16ToBuffer(bytes, sr) {
      var n = Math.floor(bytes.byteLength / 2);
      var view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
      var buf = actx.createBuffer(1, n, sr || 16000);
      var ch = buf.getChannelData(0);
      for (var i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
      return buf;
    }

    ws.onopen = function () {
      console.log('Voicebot WS connected');
      source.connect(processor);
      processor.connect(sink);
    };

    processor.onaudioprocess = function (e) {
      if (ws.readyState !== WebSocket.OPEN) return;
      // 半雙工：機器人講話中（或剛講完的緩衝期）不送麥克風，避免辨識到機器人自己的聲音而無限對話
      if (botSpeaking || Date.now() < resumeMicAt) return;
      var input = e.inputBuffer.getChannelData(0);
      var ratio = actx.sampleRate / 16000;
      var outLen = Math.floor(input.length / ratio);
      var out = new Int16Array(outLen);
      for (var i = 0; i < outLen; i++) {
        var s = input[Math.floor(i * ratio)];
        out[i] = Math.max(-32768, Math.min(32767, s * 32768));
      }
      ws.send(out.buffer);
    };

    ws.onmessage = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'text') {
        if (msg.role === 'assistant') {
          setState('🤖 ' + msg.text);
        } else {
          var h = document.getElementById('hint');
          if (h) { h.style.display = 'block'; h.innerText = '你：' + msg.text; }
        }
      } else if (msg.type === 'audio') {
        try {
          var binary = atob(msg.data), len = binary.length, bytes = new Uint8Array(len);
          for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
          playQueue.push(pcm16ToBuffer(bytes, msg.sampleRate || 16000));
          botSpeaking = true; // 一收到音訊就先閉麥，等真正播放
          if (!isPlaying) playNext();
        } catch (err) { console.error('audio decode', err); }
      } else if (msg.type === 'transfer') {
        // 轉真人：關掉 bot、改用 WebRTC 接通專員
        try { ws.close(); processor.disconnect(); source.disconnect(); stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) {}
        setState('正在為您接通真人客服，請稍候…');
        window.call = WLCall({ room: room, role: 'customer', iceServers: cfg.iceServers, onStatus: onStatus, supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY });
        window.call.start();
      } else if (msg.type === 'error') {
        setState('⚠️ ' + (msg.text || 'AI 客服暫時無法服務'));
      }
    };

    ws.onclose = function () { console.log('Voicebot WS closed'); try { processor.disconnect(); source.disconnect(); } catch (e) {} };
    ws.onerror = function () { setState('⚠️ 無法連上 AI 客服'); };
  }).catch(function () {
    setState('無法存取麥克風');
  });
}
