# Facebook Messenger／Instagram DM 串接 — 需求說明

> 提供對象：溝通雲開發團隊
> 日期：2026-08-25
> 主旨：希望在溝通雲平台上新增 FB Messenger 與 Instagram DM 兩個進線管道

---

## 1. 需求摘要

WAFERLOCK 目前的顧客進線管道，除了 LINE 之外，**Facebook 粉絲專頁的 Messenger 與 Instagram 商業帳號的 DM 也有實際客戶詢問**。希望這兩個管道的訊息能與 LINE 一樣，進入溝通雲的客服收件匣，並享有相同的 AI 客服、知識庫與工單流程。

**期望效果**：顧客從 FB 或 IG 傳訊 → 進入收件匣 → AI 客服回應（可查保固、建工單）→ 必要時轉真人 → 客服在後台回覆 → 訊息送回顧客的 FB／IG。

---

## 2. 為什麼 FB 與 IG 建議一起做

Meta 的架構讓這兩個管道高度共用，**分開做反而多工**：

| 項目 | FB Messenger | Instagram DM |
|---|---|---|
| Webhook 端點 | 同一個 | 同一個（以 `payload.object` 區分） |
| 簽章驗證 | `x-hub-signature-256` | 相同 |
| 發訊端點 | `graph.facebook.com/.../me/messages` | 同一個 |
| 使用者 ID | PSID | IGSID（格式不同，用法相同） |

差異只在「平台判定」與「取得使用者名稱的欄位」，其餘完全共用。

---

## 3. 技術現況參考

我們理解貴平台目前已支援 **LINE、WhatsApp、官網 Widget** 三個管道，且所有進線共用 `handleInbound` 管線。

其中 **WhatsApp 使用的 Meta Cloud API 與 FB／IG 的 Messenger API 屬同一套機制**（相同的 `hub.challenge` 驗證流程、相同的 `x-hub-signature-256` 簽章、相同的 `graph.facebook.com` 端點），因此我們理解 FB／IG 應可沿用既有的 WhatsApp 實作模式，而非全新開發。

另外注意到 `prisma/schema.prisma` 中 `Contact.channel` 欄位的註解已列出 `line | fb | ig | web | whatsapp`，資料模型層面應已預留。

> 以下實作建議僅供參考，實際做法請依貴團隊的工程判斷。

---

## 4. 實作建議（供參考）

### 4.1 新增檔案

**`src/services/meta.js`** — 比照 `src/services/whatsapp.js`

```js
// FB Messenger / IG DM（Meta Graph API）— 未設定憑證時自動降級
const crypto = require('crypto');
const TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const enabled = () => !!TOKEN;

async function sendText(recipientId, text) {
  if (!enabled()) { console.log(`[meta:模擬] → ${recipientId}: ${text}`); return { simulated: true }; }
  const r = await fetch('https://graph.facebook.com/v21.0/me/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, messaging_type: 'RESPONSE' }),
  });
  if (!r.ok) { console.error('[meta] 發送失敗', r.status, await r.text().catch(() => '')); return { ok: false }; }
  return { ok: true };
}

function verifySignature(rawBody, signature) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); } catch { return false; }
}

async function getProfileName(id, isIg) {
  if (!enabled()) return isIg ? 'IG 用戶' : 'FB 用戶';
  try {
    const fields = isIg ? 'name,username' : 'name';
    const r = await fetch(`https://graph.facebook.com/${id}?fields=${fields}&access_token=${TOKEN}`);
    if (r.ok) { const d = await r.json(); return d.name || d.username || (isIg ? 'IG 用戶' : 'FB 用戶'); }
  } catch (e) { console.error('[meta] 取名稱失敗', e.message); }
  return isIg ? 'IG 用戶' : 'FB 用戶';
}

module.exports = { enabled, sendText, verifySignature, getProfileName };
```

**`src/routes/messenger.routes.js`** — 比照 `src/routes/whatsapp.routes.js`

> ⚠️ 檔名建議：`src/routes/meta.routes.js` 已被既有的標籤／下拉選單 API 使用，為避免混淆建議命名為 `messenger.routes.js`。

```js
// FB Messenger / IG DM webhook — 驗證 + 收訊 → 共用進線管線
const router = require('express').Router();
const { handleInbound } = require('../services/inbound');
const meta = require('../services/meta');

// Meta webhook 驗證（GET challenge）
router.get('/', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === (process.env.META_VERIFY_TOKEN || 'waferlock')) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// 收訊（POST）
router.post('/', async (req, res) => {
  res.sendStatus(200); // 先回 200，避免 Meta 重送
  try {
    if (!meta.verifySignature(req.rawBody, req.headers['x-hub-signature-256'])) {
      console.warn('[meta] 簽章驗證失敗'); return;
    }
    const isIg = req.body.object === 'instagram';
    const channel = isIg ? 'ig' : 'fb';

    for (const entry of req.body.entry || []) {
      for (const ev of entry.messaging || []) {
        const senderId = ev.sender && ev.sender.id;
        if (!senderId) continue;

        let text = '';
        if (ev.message) {
          if (ev.message.text) text = ev.message.text;
          else if (ev.message.attachments) text = `（${ev.message.attachments[0]?.type || '附件'} 訊息）`;
        } else if (ev.postback) {
          text = ev.postback.title || ev.postback.payload || '（按鈕點擊）';
        }
        if (!text) continue;

        const name = await meta.getProfileName(senderId, isIg);
        await handleInbound({ lineUserId: senderId, displayName: name, text, channel });
      }
    }
  } catch (e) { console.error('[meta webhook]', e.message); }
});

module.exports = router;
```

### 4.2 修改既有檔案

**`app.js`** — 掛載於 `authMiddleware` 之前（既有 webhook 區塊旁）

```js
app.use('/webhook/meta', require('./src/routes/messenger.routes'));
```

**`src/services/inbound.js`** — 兩處

```js
// (a) CHANNEL_META 增加兩個管道
const CHANNEL_META = {
  line:     { source: 'LINE 自然加入', name: 'LINE 好友' },
  web:      { source: '官網 Widget',   name: '官網訪客' },
  whatsapp: { source: 'WhatsApp',      name: 'WhatsApp 用戶' },
  fb:       { source: 'Facebook',      name: 'FB 用戶' },   // 新增
  ig:       { source: 'Instagram',     name: 'IG 用戶' },   // 新增
};

// (b) 回推訊息分流增加分支
} else if ((channel === 'fb' || channel === 'ig') && contact.lineUserId) {
  const meta = require('./meta');
  for (const r of replies) await meta.sendText(contact.lineUserId, r);
}
```

### 4.3 環境變數

| 變數 | 用途 |
|---|---|
| `META_PAGE_ACCESS_TOKEN` | 呼叫 Graph API 收發訊息 |
| `META_APP_SECRET` | 驗證 webhook 簽章 |
| `META_VERIFY_TOKEN` | Webhook 握手驗證（自訂字串，需與 Meta 後台一致） |

### 4.4 Meta 後台設定

| 項目 | 值 |
|---|---|
| Webhook 回呼網址 | `https://<render-app>.onrender.com/webhook/meta` |
| 驗證權杖 | 同 `META_VERIFY_TOKEN` |
| 訂閱欄位 | `messages`、`messaging_postbacks` |
| 需連結 | Facebook 粉絲專頁；Instagram 另需商業帳號並連結粉專 |

---

## 5. 需要一起討論的技術議題

### 5.1 顧客身分識別（建議一併評估）

目前 `Contact.lineUserId` 為 `@unique`，並作為各管道的通用外部識別碼（WhatsApp 存電話號碼）。若 FB／IG 也沿用此欄位存 PSID／IGSID，**同一位顧客分別從 LINE 與 FB 聯繫時，會建立兩筆獨立的 Contact 記錄**，顧客 360 的完整性會受影響。

想請教貴團隊的規劃，可能的方向：

- 新增 `fbUserId` / `igUserId` 獨立欄位，允許一位 Contact 綁定多個管道識別碼
- 或提供後台「顧客合併」功能，由客服人工併檔
- 或以手機／Email 作為跨管道比對依據

這一題不影響 FB／IG 能不能收發訊息，但會影響顧客資料品質，希望在實作前先有共識。

### 5.2 Meta 平台限制（需納入時程評估）

| 項目 | 說明 |
|---|---|
| **App Review** | 對外開放需通過 Meta 審查並取得 `pages_messaging` 權限。審查前為開發模式，只有 App 角色成員（管理員／開發者／測試人員）的訊息會觸發 webhook |
| **24 小時訊息視窗** | 僅能回覆 24 小時內有互動的用戶，超出需使用付費訊息標籤 |
| **IG 帳號要求** | Instagram 須為商業帳號並連結粉絲專頁 |

其中 **App Review 需要準備操作影片與用途說明、審查約需數個工作天**，建議提早啟動。

### 5.3 憑證管理

Meta App、Page Access Token 與粉絲專頁管理權的歸屬，建議依以下原則安排：

- Meta App 建立於 **WAFERLOCK 的企業管理平台**下
- 粉絲專頁管理權保留於 WAFERLOCK，並授予貴團隊開發所需角色
- 憑證異動時雙方同步

此安排是為確保官方帳號與歷史對話的延續性，並非對合作的疑慮。

---

## 6. LINE Webhook URL 確認事項

另有一項與 FB／IG 無直接關聯、但需一併確認的事項。

目前 LINE 官方帳號的 Webhook URL 設定為：

```
https://unrivaled-unripe-lugged.ngrok-free.dev/callback
```

想確認三件事：

1. **正式上線後的 Webhook URL** 為何？（例如 `https://<render-app>.onrender.com/webhook`）
2. **目前測試階段預計持續多久？** 此期間真實顧客傳來的 LINE 訊息由誰負責查看與回覆？
3. **路徑確認**：程式碼中 LINE webhook 掛載於 `/webhook`，而目前設定為 `/callback`，想確認正式環境應使用哪一個路徑。

> 說明：LINE 官方帳號僅能設定單一 Webhook URL。目前指向測試環境期間，我方原有的接收端已停止收訊，故想確認切換時程與過渡期的訊息處理方式。

---

## 7. 希望取得的回覆

| # | 項目 |
|---|---|
| 1 | FB／IG 串接是否可納入開發範圍？預計時程？ |
| 2 | 顧客身分識別（§5.1）的規劃方向 |
| 3 | Meta App Review 由哪一方主導申請？ |
| 4 | LINE Webhook 正式 URL 與切換時程（§6） |

---

## 附錄：本文件參考的程式碼位置

| 用途 | 路徑 |
|---|---|
| 路由總表、webhook 掛載 | `app.js` |
| LINE webhook | `src/routes/line.routes.js` |
| WhatsApp webhook（建議參考範本） | `src/routes/whatsapp.routes.js` |
| WhatsApp service（建議參考範本） | `src/services/whatsapp.js` |
| 共用進線管線 | `src/services/inbound.js#handleInbound` |
| 資料模型 | `prisma/schema.prisma` |
