# 廠商平台（溝通雲）FB／IG 串接評估 — 架構對照與實作方式

> 日期：2026-08-25
> 分析對象：`waferlock-cloud-main`（廠商平台，部署於 Render）
> 對照對象：我方 MVP（Supabase Edge Functions）
> 目的：釐清兩套架構在 FB 訊息與 LINE webhook 的差異，並提出在廠商架構上串 FB／IG 的做法

---

## 0. 三句話結論

1. **廠商平台目前完全沒有 FB／IG 支援** —— 現有管道只有 LINE、WhatsApp、官網 Widget。
2. **但地基已經預留好了**：`Contact.channel` 欄位註解就寫著 `line | fb | ig | web | whatsapp`，且既有的 **WhatsApp 也是 Meta Cloud API**，webhook 結構與 FB／IG 幾乎相同 —— 可直接照抄。
3. **LINE webhook 目前指向 ngrok 臨時網址**（廠商工程師本機），上線前必須改為 Render 正式網址；同一時間我方 Supabase 已收不到 LINE 訊息。

---

## 1. 廠商平台架構速覽

**定位**：整合「行銷自動化 / AI 客服 / 數據洞察」的**單體 Node.js 應用**，以 `Contact`（顧客 360）為核心。

| 項目 | 內容 |
|---|---|
| 框架 | Express 4（單體，非微服務） |
| 資料庫 | PostgreSQL + Prisma ORM（~45 個 model） |
| AI | Claude（`@anthropic-ai/sdk`），未設 key 時降級為示範模式 |
| 前端 | 原生 JS SPA，無建置流程 |
| 部署 | **Render**，push `main` 自動部署 |
| 排程 | `services/scheduler.js`，每 3 分鐘 |

### 1.1 核心設計：所有管道共用單一進線管線

**這是與我方架構最大的不同。**

```
LINE webhook ─┐
WhatsApp   ───┼──► handleInbound() ──► ① 建/找 Contact
官網 Widget ──┤    (inbound.js)        ② 寫 Message / Conversation
後台模擬器 ───┘                        ③ 派工時間協調攔截
                                       ④ 真人接手判斷（aiPaused）
                                       ⑤ 關鍵字自動回應 → 真人修正庫 → AI Agent
                                       ⑥ AI 判斷轉真人
                                       ⑦ 自動指派規則
                                       ⑧ 更新生命週期
                                       ⑨ 回推訊息（依 channel 分流）
```

**AI Agent 具備 tool-calling**，可在對話中直接執行：`create_inquiry`（建工單）、`update_contact`、`show_manual_image`、`search_products`、`lookup_warranty`（查保固）。

---

## 2. 兩套架構對照

### 2.1 整體差異

| 面向 | 我方 MVP（Supabase） | 廠商平台（Render） |
|---|---|---|
| 執行環境 | Edge Function（Deno，每管道一支） | Express 單體（所有管道共用） |
| 進線處理 | 各管道各自寫一份邏輯 | **單一 `handleInbound` 管線** |
| 資料庫 | Supabase PostgreSQL（直接 SQL） | PostgreSQL + Prisma ORM |
| AI | ❌ 無（純轉接客服） | ✅ Claude AI Agent + RAG 知識庫 + tool-calling |
| 自動化 | ❌ 無 | ✅ 旅程、分眾、推播、自動指派、關鍵字回應 |
| 即時推送 | Supabase Realtime | 後台輪詢／WebSocket |
| 併發安全 | `append_conversation_message` RPC（原子 append） | Prisma 標準寫入（`Message` 為獨立列，天然無覆蓋問題） |

> **併發設計的差異值得注意**：我方把訊息全部塞在 `conversations.msgs` 這個 jsonb 陣列裡，才需要特製原子 RPC 防覆蓋；廠商用 `Message` 獨立資料表、一則訊息一列，結構上就沒有這個問題。**廠商的做法比較正統**。

### 2.2 FB 訊息處理對照

| 環節 | 我方 MVP | 廠商平台 |
|---|---|---|
| Webhook 端點 | `/functions/v1/meta-webhook` | **不存在** |
| 簽章驗證 | HMAC-SHA256（`x-hub-signature-256`） | 不存在（WhatsApp 有現成的可抄） |
| 收訊後 | 寫 `conversations` 表 → 客服收件匣 | 不存在 |
| 自動回覆 | 固定文字「已收到您的訊息」 | 不存在 |
| 發訊 | `meta-push` Edge Function | 不存在 |
| AI 處理 | ❌ 無 | 不存在（但接上後可享有完整 AI 管線） |

**結論：FB／IG 在廠商平台是從零開始，但可大量複用 WhatsApp 既有程式碼。**

### 2.3 LINE 對照（廠商功能遠比我方豐富）

| 功能 | 我方 MVP | 廠商平台 |
|---|---|---|
| 收訊進收件匣 | ✅ | ✅ |
| 簽章驗證 | ✅ | ✅ |
| 加好友歡迎訊息 | ✅ 固定文字 | ✅ 可設定＋**連結專屬歡迎詞＋掃碼歸因** |
| 會員綁定 | ✅ LIFF 綁定頁 | ✅ LIFF ＋ 一般網頁雙軌 |
| **師傅綁定** | ❌ | ✅ 傳「綁定 <代碼>」 |
| **後台同仁綁定** | ❌ | ✅ 指派通知推 LINE |
| **優惠券匣** | ❌ | ✅ 傳「優惠券」查個人券 |
| **遊戲領獎閉環** | ❌ | ✅ 輸入手機自動領獎 |
| **圖片理解** | ❌ | ✅ AI 判讀 |
| **影片／語音理解** | ❌ | ✅ Gemini 原生理解 |
| **派工時間協調** | ❌ | ✅ 自然語言跟客戶喬時間 |
| AI 客服 | ❌ | ✅ RAG + tool-calling |

---

## 3. LINE Webhook URL 差異（重點）

**LINE 官方帳號只能設定一個 webhook URL**，所以三者互斥、只能擇一。

| 階段 | Webhook URL | 狀態 |
|---|---|---|
| 我方 MVP | `https://<supabase-ref>.supabase.co/functions/v1/line-webhook` | ⚠️ **已被取代，現在收不到訊息** |
| 廠商開發測試（現況） | `https://unrivaled-unripe-lugged.ngrok-free.dev/callback` | ⚠️ 臨時通道，工程師電腦關閉即失效 |
| 廠商正式上線 | `https://<render-app>.onrender.com/webhook` | ⬜ 待設定 |

### 3.1 路徑差異

| | 路徑 | 說明 |
|---|---|---|
| 我方 | `/functions/v1/line-webhook` | Supabase Edge Function 固定路徑格式 |
| 廠商 | `/webhook` | `app.js:24` → `line.routes.js` |

> 目前 ngrok 顯示的 `/callback` 與 repo 裡的 `/webhook` **不一致** —— 可能是工程師本機另接了路徑，或 repo 版本與實際測試版本有落差。**建議向廠商確認正式路徑**。

### 3.2 現況風險

LINE webhook 指向 ngrok 期間：

- 我方 Supabase 收不到任何 LINE 訊息（客服收件匣、自動回覆、會員辨識全部停擺）
- 真實客戶傳來的訊息**進入廠商工程師的本機環境** —— 需確認是否有人在看、是否會回覆
- ngrok 免費版網址**每次重啟都會變**，斷線期間訊息直接遺失（LINE 不重送）

---

## 4. 在廠商架構上串接 FB／IG 的做法

### 4.1 為什麼 FB 和 IG 是同一套工程

Meta 的設計讓兩者高度共用：

| 項目 | FB Messenger | Instagram DM |
|---|---|---|
| Webhook | **同一個端點** | 同左（靠 `payload.object` 區分） |
| 簽章驗證 | `x-hub-signature-256` | 同左 |
| 發訊端點 | `graph.facebook.com/v21.0/me/messages` | **同一個端點** |
| 使用者 ID | PSID | IGSID（格式不同，用法相同） |

**所以做 FB 就等於做完 IG**，差別只在平台判定與名稱取得。

### 4.2 建議實作（照抄 WhatsApp 模式）

廠商的 WhatsApp 已是 Meta Cloud API，**結構可直接沿用**。需新增／修改 4 個地方：

**① 新增 `src/services/meta.js`**（照抄 `services/whatsapp.js`）

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

// 與 WhatsApp 同一套簽章驗證邏輯
function verifySignature(rawBody, signature) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); } catch { return false; }
}

// 取使用者名稱（FB / IG 欄位略有差異）
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

**② 新增 `src/routes/meta.routes.js`**（照抄 `whatsapp.routes.js`）

⚠️ 注意：`src/routes/meta.routes.js` 這個檔名**已被佔用**（現有的是標籤／下拉選單 API，掛在 `/api/meta`）。建議新檔命名為 **`messenger.routes.js`** 避免混淆。

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

**③ `app.js` 掛載（必須在 `authMiddleware` 之前）**

```js
// 放在既有 whatsapp / line webhook 旁邊（app.js 第 23-25 行區塊）
app.use('/webhook/meta', require('./src/routes/messenger.routes'));
```

**④ `src/services/inbound.js` 兩處修改**

```js
// (a) CHANNEL_META 加兩個管道（約第 15 行）
const CHANNEL_META = {
  line:     { source: 'LINE 自然加入', name: 'LINE 好友' },
  web:      { source: '官網 Widget',   name: '官網訪客' },
  whatsapp: { source: 'WhatsApp',      name: 'WhatsApp 用戶' },
  fb:       { source: 'Facebook',      name: 'FB 用戶' },   // ← 新增
  ig:       { source: 'Instagram',     name: 'IG 用戶' },   // ← 新增
};

// (b) 回推訊息分流加一個分支（約第 308 行）
} else if ((channel === 'fb' || channel === 'ig') && contact.lineUserId) {
  const meta = require('./meta');
  for (const r of replies) await meta.sendText(contact.lineUserId, r);
}
```

### 4.3 環境變數

```
META_PAGE_ACCESS_TOKEN=   # Meta App → Messenger → 存取權杖
META_APP_SECRET=          # Meta App → 應用程式設定 → 基本資料
META_VERIFY_TOKEN=        # 自訂字串，需與 Meta 後台一致
```

### 4.4 Meta 後台設定

| 項目 | 值 |
|---|---|
| Webhook 回呼網址 | `https://<render-app>.onrender.com/webhook/meta` |
| 驗證權杖 | 同 `META_VERIFY_TOKEN` |
| 訂閱欄位 | `messages`、`messaging_postbacks` |
| 需連結 | 粉絲專頁；IG 另需連結商業帳號 |

### 4.5 工作量估計

| 項目 | 說明 |
|---|---|
| 新增 2 個檔案 | `services/meta.js`、`routes/messenger.routes.js`（皆可照抄 WhatsApp） |
| 修改 2 個檔案 | `app.js` 一行、`inbound.js` 兩處 |
| **接上後自動具備** | AI 客服、RAG 知識庫、tool-calling（建工單／查保固）、自動指派、旅程觸發、顧客 360 —— **無需額外開發** |

這是照抄既有模式的工作，**不是新架構設計**。

---

## 5. ⚠️ 必須注意的三個問題

### 5.1 顧客身分會分裂（設計層面，建議廠商評估）

`Contact.lineUserId` 是 `@unique`，被當成**所有管道的通用外部 ID**（WhatsApp 存電話、FB 要存 PSID）。

後果：**同一位顧客用 LINE 和 FB 各聯絡一次，會產生兩筆 Contact 記錄**，顧客 360 就分裂了。

建議廠商考慮其中一種：
- 新增 `fbUserId` / `igUserId` 獨立欄位，允許一個 Contact 綁多個管道 ID
- 或提供後台「合併顧客」功能

### 5.2 Meta 平台限制（沿用，無法迴避）

| 限制 | 說明 |
|---|---|
| **App Review** | 對外開放需通過 Meta 審查，申請 `pages_messaging` 權限。開發模式下只有 App 角色成員的訊息會觸發 webhook |
| **24 小時訊息視窗** | 只能回覆 24 小時內有互動的用戶，超出需付費訊息標籤 |
| **IG 需商業帳號** | Instagram 必須是商業帳號並連結粉絲專頁 |

### 5.3 憑證歸屬（合約層面）

Meta App、Page Access Token、粉絲專頁管理權若掛在廠商名下，**更換廠商等同官方帳號與歷史對話歸零**。

建議：
- Meta App 建立於**客戶方**企業管理平台
- 粉絲專頁管理權歸客戶方，僅授予廠商必要角色
- 合約載明終止時的資料匯出格式與期限

---

## 6. 建議向廠商確認的事項

**關於 LINE（急）**

1. 正式上線的 webhook URL 是什麼？（`onrender.com/webhook` 還是別的路徑）
2. ngrok 測試階段預計持續多久？期間真實客戶的 LINE 訊息由誰處理？
3. repo 是 `/webhook`，ngrok 顯示 `/callback` —— 哪個才是正確路徑？

**關於 FB／IG**

4. 是否已列入開發範圍？目前 repo 完全沒有實作
5. 若要做，是否採用本文件建議的 WhatsApp 複用模式？
6. `Contact.lineUserId` 的身分分裂問題打算怎麼解？

**關於憑證**

7. LINE Channel、Meta App 的憑證掛誰名下？

---

## 附錄：關鍵檔案位置（廠商 repo）

| 用途 | 路徑 |
|---|---|
| 路由總表 | `app.js`（webhook 掛載在第 23-25 行） |
| LINE webhook | `src/routes/line.routes.js` |
| WhatsApp webhook（FB 範本） | `src/routes/whatsapp.routes.js` |
| WhatsApp service（FB 範本） | `src/services/whatsapp.js` |
| **核心進線管線** | `src/services/inbound.js#handleInbound` |
| AI 層 | `src/ai.js` |
| 資料模型 | `prisma/schema.prisma`（`Contact` 在第 50 行） |
| 架構說明 | `ARCHITECTURE.md` |
