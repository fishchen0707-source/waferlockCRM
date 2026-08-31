# Facebook Messenger／Instagram DM 串接 — 技術說明

> 對象：外部系統廠商
> 版本：2026-08-25
> 用途：說明現行 FB Messenger / IG DM 與客服系統的雙向串接架構、資料模型與介面規格

---

## 0. 這份文件的範圍與免責

**涵蓋**：FB Messenger / IG DM 的「收訊」與「發訊」串接實作、資料落地格式、對外介面。

**不涵蓋**（如需請另外索取）：LINE 串接、0800 語音、CRM 工單與派工流程。

⚠️ **本文件不含任何憑證**。密鑰、專案識別碼、實際端點網址一律以佔位符表示，實際值另以安全管道提供。

---

## 1. 架構總覽

FB／IG 訊息透過 Meta Webhook 進入自建客服系統，客服回覆再經由 Graph API 送回。**雙向皆為即時**，無輪詢。

```
┌─────────────┐   ①訊息      ┌──────────────────┐   ②寫入   ┌──────────────┐
│  FB / IG    │ ──────────► │  meta-webhook    │ ────────► │  Supabase    │
│  使用者      │             │ (Edge Function)  │           │  PostgreSQL  │
└─────────────┘             └──────────────────┘           └──────┬───────┘
       ▲                                                          │
       │                    ┌──────────────────┐   ③即時推送      │ Realtime
       │      ⑤送出         │   meta-push      │ ◄────────────────┤
       └────────────────────│ (Edge Function)  │   ④客服回覆      │
              Graph API     └──────────────────┘           ┌──────▼───────┐
                                                            │  客服收件匣   │
                                                            │ (單頁 Web)   │
                                                            └──────────────┘
```

**技術棧**

| 層 | 技術 |
|---|---|
| 收訊／發訊 | Supabase Edge Functions（Deno / TypeScript） |
| 資料庫 | Supabase（PostgreSQL），啟用 Realtime |
| 客服前端 | 單頁 HTML + React 18（CDN，無建置流程） |
| 對外 API | Meta Graph API **v19.0** |

---

## 2. 元件一：`meta-webhook`（收訊）

**部署**：Supabase Edge Function，名稱 `meta-webhook`，**必須關閉 Verify JWT**（Meta 不會帶 Supabase 的 JWT）。

**回呼網址**：
```
https://<supabase-project-ref>.supabase.co/functions/v1/meta-webhook
```

**Meta 後台訂閱欄位**：`messages`、`messaging_postbacks`

### 2.1 GET — Webhook 驗證握手

Meta 設定 Webhook 時會發 GET 驗證。實作比對 `hub.verify_token`，相符則原樣回傳 `hub.challenge`。

| 條件 | 回應 |
|---|---|
| `hub.mode=subscribe` 且 token 相符 | `200` + challenge 原文 |
| 其他 | `403 Forbidden` |

### 2.2 POST — 接收訊息

**① 簽章驗證（必要，先於任何處理）**

驗證 HTTP 標頭 `x-hub-signature-256`，格式為 `sha256=<hex>`：

```
expected = HMAC-SHA256(key = META_APP_SECRET, message = raw request body)
```

以 **raw body 字串**計算（不可先 JSON.parse 再序列化，會因鍵序或空白差異導致驗證失敗）。
驗證失敗回 `401`，不做任何寫入。

**② 平台判定**

依 payload 最外層 `object` 欄位判定來源：

| `payload.object` | 判定平台 |
|---|---|
| `instagram` | `instagram` |
| 其他（含 `page`） | `facebook` |

**③ 事件解析**

走訪 `payload.entry[].messaging[]`，取 `sender.id` 作為使用者識別碼（FB 為 PSID、IG 為 IGSID）。訊息內容依序判斷：

| 事件型態 | 取用欄位 | 落地文字 |
|---|---|---|
| 文字訊息 | `message.text` | 原文 |
| 附件訊息 | `message.attachments[0].type` | `（<type> 訊息）` |
| 按鈕回傳 | `postback.title` → `postback.payload` | 該值，皆無則 `（按鈕點擊）` |

⚠️ 解析後 `text` 為空字串者**目前會被靜默丟棄**（見 §8 已知問題）。

**④ 取得顯示名稱**

呼叫 Graph API 取使用者名稱，失敗時降級為固定字串，不中斷流程：

| 平台 | 端點 | 失敗降級 |
|---|---|---|
| FB | `GET /{PSID}?fields=name` | `FB 用戶` |
| IG | `GET /{IGSID}?fields=name,username` | `IG 用戶` |

**⑤ 寫入資料庫**

呼叫 PostgreSQL function `append_conversation_message`（原子寫入，見 §5）。

**⑥ 首則自動回覆**

僅當「該對話為新對話」**且**「未被真人客服接手（`agent_takeover = false`）」時，自動回覆一則制式訊息。已接手的對話不會再自動回覆，避免干擾真人對話。

**⑦ 回應**

無論個別事件處理成功與否，一律回 `200`。個別事件的例外被 catch 並寫入 log，不影響同批其他事件。

> ⚠️ 此設計的取捨見 §8：回 200 代表 Meta 不會重送，處理失敗的事件將永久遺失。

---

## 3. 元件二：`meta-push`（發訊）

**部署**：Supabase Edge Function，名稱 `meta-push`。Verify JWT 可維持開啟（前端以 anon key 呼叫）。

**介面規格**

```
POST /functions/v1/meta-push
Content-Type: application/json

{
  "to":   "fb_<PSID>"  或  "ig_<IGSID>",
  "text": "要送出的訊息文字"
}
```

`to` 直接使用 `conversations.id`（格式見 §4），函式內部以正則 `^(fb|ig)_` 去除前綴取得真實 recipient id。

**回應**

| 狀況 | HTTP | Body |
|---|---|---|
| 成功 | 200 | `{"ok": true}` |
| 缺 `to` 或 `text` | 400 | `{"error": "to/text required"}` |
| Graph API 回非 2xx | 502 | `{"ok": false, "status": <上游狀態碼>, "err": "<上游回應>"}` |
| 其他例外 | 500 | `{"ok": false, "err": "<訊息>"}` |

**上游呼叫**

```
POST https://graph.facebook.com/v19.0/me/messages
Authorization: Bearer <META_PAGE_ACCESS_TOKEN>

{
  "recipient":      { "id": "<PSID 或 IGSID>" },
  "message":        { "text": "<文字>" },
  "messaging_type": "RESPONSE"
}
```

FB Messenger 與 IG DM **共用同一端點**，靠 recipient id 區分。

已設定 CORS（`Access-Control-Allow-Origin: *`），支援瀏覽器直接呼叫與 `OPTIONS` 預檢。

---

## 4. 資料模型

### 4.1 `conversations`（對話串）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | text **PK** | **`fb_<PSID>`** / **`ig_<IGSID>`**（LINE 為 LINE UID、電話為 `phone_<號碼>`） |
| `wf_id` | text | 客編（已綁定客戶主檔時才有值，FB 進線初始為 null） |
| `name` | text | 顯示名稱。新對話寫入 `<名稱>（FB）` / `<名稱>（IG）` |
| `platform` | text | **`facebook`** / **`instagram`**（全名，非縮寫） |
| `av` | text | 頭像替代字（名稱首字） |
| `unread` | integer | 未讀數 |
| `last_msg` / `last_time` | text | 列表預覽用 |
| `msgs` | jsonb | 訊息陣列，見下 |
| `agent_takeover` | boolean | 真人客服是否已接手 |
| `need_case` | boolean | 是否待立案 |
| `biz_inquiry` | boolean | 是否為商機諮詢 |

> ⚠️ `platform` 存**全名**（`facebook`／`instagram`）。前端若以縮寫 `fb`／`ig` 過濾將永遠無結果 —— 此為實際發生過的缺陷。

**`msgs` 陣列元素格式**

```json
{
  "id":   "u1719734400000",
  "from": "user",
  "text": "訊息內容",
  "time": "14:30",
  "ts":   "2026-08-25 14:30"
}
```

| 欄位 | 說明 |
|---|---|
| `from` | `user`（客戶）／`agent`（客服）／`bot`（系統） |
| `time` | `HH:MM`，聊天泡泡顯示用 |
| `ts` | `YYYY-MM-DD HH:MM`，**跨日回覆時效統計用**，後加欄位（見 §8） |

時區一律 `Asia/Taipei`。

### 4.2 `customers`（客戶主檔）社群識別欄位

| 欄位 | 說明 |
|---|---|
| `fb_id` | Facebook PSID |
| `ig_id` | Instagram IGSID |
| `line_uid` | LINE UID |

社群 ID 與客編（`wf_id`）為多對一：同一客戶可綁多個社群帳號。

---

## 5. 並行寫入安全：`append_conversation_message`

**這是本串接最關鍵的設計，接手時請勿改回讀-改-寫。**

**問題**：早期所有寫入端（FB webhook、LINE webhook、客服前端、語音模組）都是「SELECT 讀出 `msgs` → 應用層 append → 整包 UPDATE 寫回」。當兩個寫入者幾乎同時發生（客服回覆的同時客戶傳訊、或平台重送事件），後寫入者手上的 `msgs` 是舊快照，整包寫回會**無聲覆蓋**先寫入的訊息，且無任何錯誤。

**解法**：收斂為單一 SQL 陳述式內的原子操作。PostgreSQL 對同一列的並行 UPDATE 以列鎖序列化，後到者會讀到最新值再串接。

```sql
insert into conversations (...) values (...)
on conflict (id) do update set
  msgs   = coalesce(conversations.msgs, '[]'::jsonb) || p_msg,
  unread = greatest(conversations.unread + p_unread_delta, 0),
  ...
```

**簽章**

```
append_conversation_message(
  p_id text, p_msg jsonb, p_last_msg text, p_last_time text,
  p_wf_id text = null, p_name text = null, p_platform text = null,
  p_av text = null, p_unread_delta int = 1,
  p_agent_takeover boolean = null, p_need_case boolean = null,
  p_biz_inquiry boolean = null
) returns void
```

傳 `null` 的選填參數代表「不更動該欄位」（以 `coalesce` 保留原值）。所有訊息寫入端一律走此 RPC。

---

## 6. 客服前端整合

**發訊路由**：依 `conversations.platform` 決定走哪支函式。

| `platform` | 呼叫 |
|---|---|
| `facebook` / `instagram` | `meta-push` |
| `line` | `line-push` |

```js
// 前端呼叫範例
sb.functions.invoke('meta-push', { body: { to: conv.id, text: message } });
```

**即時更新**：前端訂閱 Supabase Realtime 的 `conversations` 表變更，webhook 寫入後客服端立即顯示，無需輪詢。

**平台徽章**：以對照表統一 DB 全名與顯示縮寫。

```js
const platBadge = p => ({
  line:      { cls: 'line',  label: 'LINE' },
  facebook:  { cls: 'fb',    label: 'FB'   },
  instagram: { cls: 'ig',    label: 'IG'   },
  phone:     { cls: 'phone', label: '電話' },
  email:     { cls: 'email', label: 'Email' },
  web:       { cls: 'web',   label: '網頁' },
}[p] || { cls: '', label: (p || '?').toUpperCase() });
```

---

## 7. 環境設定需求

### 7.1 Supabase Edge Function 密鑰

| 密鑰名稱 | 用途 | 取得位置 |
|---|---|---|
| `META_APP_SECRET` | 驗證 webhook 簽章 | Meta App → 應用程式設定 → 基本資料 |
| `META_PAGE_ACCESS_TOKEN` | 呼叫 Graph API 收發訊息 | Meta App → Messenger → 存取權杖 |
| `META_VERIFY_TOKEN` | Webhook 握手驗證（自訂字串） | 自行產生，兩端需一致 |
| `SUPABASE_URL` | — | 平台自動注入 |
| `SUPABASE_SERVICE_ROLE_KEY` | — | 平台自動注入 |

### 7.2 Meta 後台設定

| 項目 | 值 |
|---|---|
| Webhook 回呼網址 | `https://<project-ref>.supabase.co/functions/v1/meta-webhook` |
| 驗證權杖 | 同 `META_VERIFY_TOKEN` |
| 訂閱欄位 | `messages`、`messaging_postbacks` |
| 需連結 | 目標粉絲專頁（IG 另需連結商業帳號） |

---

## 8. 目前狀態與已知限制

**端到端驗證**：2026-06-30 完成 FB Messenger 全流程實測（用戶傳訊 → 收件匣顯示 → 客服回覆 → 用戶收到）。

### ⚠️ 限制

| # | 項目 | 說明 |
|---|---|---|
| 1 | **App 處於開發模式** | 僅 App 角色成員（管理員／開發人員／測試人員）的訊息會觸發 webhook。**正式對外需通過 Meta App Review 申請 `pages_messaging` 權限。** |
| 2 | **IG Webhook 未設定** | 程式已支援 IG（解析、命名、發訊皆有），但 Meta 後台的 IG Webhook 尚未設定，實際未啟用。 |
| 3 | **24 小時訊息視窗** | 受 Meta 標準訊息政策限制，只能回覆 24 小時內有互動的用戶。超出需改用付費訊息標籤。 |

### 🔧 已知技術債

| # | 項目 | 影響 |
|---|---|---|
| 4 | **事件處理失敗仍回 200** | Meta 不會重送，該筆事件永久遺失。需改為失敗時回非 2xx，或先落地原始事件再非同步處理。 |
| 5 | **空 text 事件靜默丟棄** | 貼圖、純表情等解析後為空字串者不落地，客服端看不到客戶曾傳過東西。 |
| 6 | **`ts` 欄位回填未驗證** | `ts`（完整時間戳）為後加欄位，既有歷史訊息無此欄位，跨日回覆時效統計對舊資料不適用。 |

---

## 9. 交接與移轉注意事項

**憑證歸屬**（合約層面，建議明確約定）：

Meta App、Page Access Token、粉絲專頁管理權若掛在廠商名下，更換廠商等同**官方帳號與歷史對話歸零**，為代價最大的鎖定風險。建議：

- Meta App 建立於**客戶方**的企業管理平台
- 粉絲專頁管理權歸客戶方，僅授予廠商必要角色
- 合約載明終止時的資料匯出格式與期限

**資料可攜性**：對話資料全部存於 Supabase PostgreSQL，`conversations` 表可直接以標準 SQL 匯出，無專有格式。

---

## 附錄：檔案位置

| 元件 | 路徑 |
|---|---|
| 收訊 Edge Function | `supabase/functions/meta-webhook/index.ts` |
| 發訊 Edge Function | `supabase/functions/meta-push/index.ts` |
| 原子寫入 RPC | `sql/supabase_atomic_conv_append.sql` |
| 資料表定義 | `sql/supabase_setup.sql` |
| 客服前端 | `waferlock_LINE.html` |
