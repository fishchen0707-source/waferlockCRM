// ==============================================
// WAFERLOCK 溝通雲 — 真人語音通話 自建後端（信令 + ICE 設定 + 錄音/回電）
// 逆向自 https://waferlock-comm-cloud.onrender.com 的 /api/rtc/* 合約重寫。
// 純 Node（Express + ws），部署到 Render/Fly/Railway 之類的常駐服務。
//   啟動：node server.js   （預設埠 PORT 或 3000）
//   前端：public/agent-call.html（客服）、public/call.html（顧客）、public/js/rtc-client.js
// 前後端同源部署 → rtc-client.js 的 location.host 直接指到本服務，零改動。
// ==============================================
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(__dirname + '/public'));

// ── GET /api/rtc/config：回 ICE servers ──
// 沒設 TURN 環境變數時只回 STUN（同網段/同 NAT 可通，跨網路需 TURN）。
// TURN 支援兩種來源：
//   ① 靜態帳密：TURN_URLS（逗號分隔）+ TURN_USERNAME + TURN_CREDENTIAL
//   ② Cloudflare Calls TURN：CF_TURN_KEY_ID + CF_TURN_API_TOKEN（動態產時效 credential）
app.get('/api/rtc/config', async (_req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const cf = await cloudflareTurn();
    // generate-ice-servers 回的是陣列 [{stun},{turn}]，要攤平放進去（不能整包當一個元素，否則變巢狀陣列＝不合法）
    if (cf) iceServers.unshift(...(Array.isArray(cf) ? cf : [cf]));
    else if (process.env.TURN_URLS) {
      iceServers.unshift({
        urls: process.env.TURN_URLS.split(',').map((s) => s.trim()),
        username: process.env.TURN_USERNAME || '',
        credential: process.env.TURN_CREDENTIAL || '',
      });
    }
  } catch (e) { /* TURN 取不到就只回 STUN，不讓整支 config 掛掉 */ }
  res.json({ iceServers });
});

// Cloudflare Realtime（前身 Calls）TURN：用 key id + token 換一組時效性 TURN 帳密（有免費額度）
// 現行端點 /credentials/generate-ice-servers 回傳 { iceServers: { urls:[...], username, credential } }（單一物件）
async function cloudflareTurn() {
  const keyId = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !token) return null;
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }),
  });
  const bodyText = await r.text();
  if (!r.ok) {
    console.log(`[CF TURN 失敗] HTTP ${r.status} — keyId 長度=${keyId.length} — 回應：${bodyText.slice(0, 300)}`);
    return null;
  }
  let d; try { d = JSON.parse(bodyText); } catch (e) { console.log('[CF TURN] 回應非 JSON：', bodyText.slice(0, 200)); return null; }
  console.log('[CF TURN 成功] 已取得時效憑證');
  return d.iceServers || null; // 單一 {urls,username,credential} 物件，交給呼叫端 unshift 進陣列
}

// ── POST /api/rtc/recording：接錄音（階段3 才落地存 Supabase，先收下不報錯）──
const multer = tryRequire('multer');
if (multer) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
  app.post('/api/rtc/recording', upload.any(), async (req, res) => {
    // TODO 階段3：webm 上 Supabase Storage、wav 送 Gemini 產摘要、寫一筆通話紀錄
    const files = (req.files || []).map((f) => `${f.fieldname}:${f.size}b`);
    console.log('[recording]', { conv: req.body.conv, name: req.body.name, durationSec: req.body.durationSec, files });
    res.json({ ok: true, stored: false, note: '階段1：僅接收未存檔' });
  });
} else {
  app.post('/api/rtc/recording', (_req, res) => res.json({ ok: true, stored: false, note: 'multer 未安裝' }));
}

// ── POST /api/rtc/callback-request：無人接聽的待回電（階段3 落 Supabase）──
app.post('/api/rtc/callback-request', (req, res) => {
  // TODO 階段3：寫入 Supabase「待回電」（對應現有 0800/客訴流程）
  console.log('[callback-request]', { room: req.body.room, name: req.body.name, phone: req.body.phone });
  res.json({ ok: true, stored: false, note: '階段1：僅接收未存檔' });
});

app.get('/healthz', (_req, res) => res.send('ok'));

// ── WS /api/rtc/signal：房間信令中繼 ──
// 協定（對照 public/js/rtc-client.js）：
//   收 join{room,role} → 回 joined{peerPresent}，並向房內既有對端廣播 peer-join
//   收 offer/answer/ice/bye → 轉發給「同房其他人」（不回送自己）
//   斷線 → 向同房其他人廣播 peer-leave
const wss = new WebSocketServer({ server, path: '/api/rtc/signal' });
const rooms = new Map(); // room -> Set<ws>

function peersOf(room, exclude) {
  const set = rooms.get(room);
  if (!set) return [];
  return [...set].filter((w) => w !== exclude && w.readyState === 1);
}
function send(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }

wss.on('connection', (ws) => {
  ws.room = null; ws.role = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }

    if (m.type === 'join') {
      ws.room = m.room; ws.role = m.role;
      if (!rooms.has(m.room)) rooms.set(m.room, new Set());
      const others = peersOf(m.room, ws);
      rooms.get(m.room).add(ws);
      send(ws, { type: 'joined', peerPresent: others.length > 0 }); // 告訴新進者：房裡已有人嗎
      others.forEach((w) => send(w, { type: 'peer-join', role: m.role })); // 告訴既有者：有人進來了
      return;
    }
    // offer/answer/ice/bye：純轉發給同房對端
    if (ws.room && ['offer', 'answer', 'ice', 'bye'].includes(m.type)) {
      peersOf(ws.room, ws).forEach((w) => send(w, m));
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const set = rooms.get(ws.room);
    if (set) {
      set.delete(ws);
      peersOf(ws.room, ws).forEach((w) => send(w, { type: 'peer-leave' }));
      if (set.size === 0) rooms.delete(ws.room);
    }
  });
});

function tryRequire(name) { try { return require(name); } catch (e) { return null; } }

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`WAFERLOCK voice server on :${PORT}  (signal ws /api/rtc/signal)`));
