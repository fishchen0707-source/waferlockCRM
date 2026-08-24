# WAFERLOCK 真人語音通話（comm-voice）

逆向自 `https://waferlock-comm-cloud.onrender.com` 的真人語音通話功能，前後端自建重寫。
瀏覽器原生 WebRTC P2P 語音：客服撥號、顧客點連結接聽，聲音點對點傳輸（不經電信商）。

## 架構：B 路（掛在既有 Supabase，不用養常駐伺服器）

前端三支靜態檔可直接放 **GitHub Pages**；後端能力全掛在專案既有的 **Supabase**：
- **信令**：Supabase Realtime broadcast（頻道 `rtc-<room>`），非自建 WebSocket。
- **TURN 憑證**：Supabase Edge Function `rtc-config`（藏 Cloudflare 金鑰、產時效憑證）。
- **錄音／待回電**（階段3）：Edge Function `rtc-recording` / `rtc-callback-request`。

> `server.js` 是「A 路」（自建 Node 信令伺服器放 Render）的替代方案，**B 路不會用到它**，保留供參考。

```
comm-voice/
├─ public/                    # ← 這個資料夾整包丟 GitHub Pages 即可
│  ├─ agent-call.html         # 客服端（開啟即自動撥號）
│  ├─ call.html               # 顧客端（點「接聽」才連；50 秒無人接→留言回電）
│  ├─ js/rtc-client.js        # 共用 WebRTC 客戶端（信令走 Supabase Realtime）
│  └─ img/waferlock.svg       # logo
├─ test-signal-supabase.js    # 對真實 Supabase Realtime 的信令測試（node test-signal-supabase.js）
├─ server.js / test-signal.js # A 路（Node 自建信令）替代方案，B 路用不到
└─ ice-config-sample.json     # 原站 /api/rtc/config 活樣本（格式對照）
```

## 訊令協定（rtc-client.js ⇄ Supabase Realtime）

- 頻道名 `rtc-<room>`，broadcast event `sig`，訊息型別：`hello`／`offer`／`answer`／`ice`／`bye`。
- **探索用 hello 心跳**：SUBSCRIBED 後每秒送一次 `hello`，agent 收到對端 hello 就發 offer 並「重送直到收到 answer」（容忍剛訂閱首則走 REST 而遺失）。
- **掛斷**：優雅掛斷送 `bye`；非優雅斷線靠 WebRTC `connectionState` 轉 failed/disconnected。
- ⚠️ **room 名稱務必用 ASCII**（如 `call_h7jhe8zy`）。頻道 topic 含中文等非 ASCII 會導致 Realtime WebSocket join 失敗、send 退回 REST 而對端收不到——這在測試時實際踩過。

## 部署步驟

### ① 前端 → GitHub Pages
把 `public/` 內容放進你 Pages 站台（例如 repo 的 `/comm-voice/` 路徑）。麥克風權限要求 https，Pages 天生是 https，跨網路即可用。
- 客服：`https://<你的pages網域>/comm-voice/agent-call.html?room=call_xxx&name=專員小美&conv=案件ID`
- 顧客：`https://<你的pages網域>/comm-voice/call.html?room=call_xxx`（同一 room 才接通）

### ② Edge Function `rtc-config` → Supabase
```bash
supabase functions deploy rtc-config
# 設 Cloudflare TURN 金鑰（Supabase → Edge Functions → Secrets，或 CLI）：
supabase secrets set CF_TURN_KEY_ID=<Turn Token ID> CF_TURN_API_TOKEN=<API Token>
```
> 沒設金鑰時只回 STUN（同區網可通、跨網路不行）；設了才有 Cloudflare TURN 跨網路中繼。

## 本機測試
```bash
cd comm-voice && npm install
node test-signal-supabase.js   # 對真實 Supabase Realtime 驗證信令（兩種進場順序，含 offer/answer/ice/bye）
```
本機開兩個瀏覽器分頁測 UI：可用任意靜態伺服器（如專案的 `啟動伺服器.bat`）開 `public/`，
agent-call 與 call 帶同一 `room`。同機/同區網不需 TURN 即可通；跨網路需先部署 `rtc-config` 並設 TURN 金鑰。

## 尚未完成（見專案根 `版本紀錄.md`）
- **真機跨網路實測**：需部署 + 手機 4G vs 電腦 Wi-Fi 各開一端對講（需實體麥克風，無頭環境測不了）。
- **階段3**：`rtc-recording`（錄音存 Supabase Storage + Gemini 摘要）、`rtc-callback-request`（待回電落 DB）兩支 Edge Function。前端已改指這兩個位址，Function 未建前會 404（前端有 try/catch，不影響通話）。
- **階段4**：接進 `waferlock_LINE.html` 的 0800 值機桌面，取代「模擬來電」。
