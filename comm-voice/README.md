# WAFERLOCK 真人語音通話（comm-voice）

逆向自 `https://waferlock-comm-cloud.onrender.com` 的真人語音通話功能，前後端自建重寫。
瀏覽器原生 WebRTC P2P 語音：客服撥號、顧客點連結接聽，聲音點對點傳輸（不經電信商）。

## 目錄
```
comm-voice/
├─ server.js              # Node 後端：信令中繼 + ICE 設定 + 錄音/回電端點
├─ package.json           # express + ws（+ 選配 multer）
├─ ice-config-sample.json # 原站 /api/rtc/config 的活樣本（格式對照用）
├─ test-signal.js         # 信令協定自動測試（node test-signal.js）
└─ public/
   ├─ agent-call.html     # 客服端（開啟即自動撥號）
   ├─ call.html           # 顧客端（點「接聽」才連；50 秒無人接→留言回電）
   ├─ js/rtc-client.js    # 客服/顧客共用 WebRTC 客戶端
   └─ img/waferlock.svg   # logo
```

## 本機啟動
```bash
cd comm-voice
npm install
npm start          # 預設 http://localhost:3000
```
- 客服：`http://localhost:3000/agent-call.html?room=abc&name=專員小美&conv=案件ID`
- 顧客：`http://localhost:3000/call.html?room=abc`
- 兩邊用同一個 `room` 才會接通。

## API 端點（對照原站合約）
| 端點 | 說明 | 狀態 |
|------|------|------|
| `GET /api/rtc/config` | 回 ICE servers（STUN；設環境變數後含 TURN） | ✅ 可用 |
| `WS /api/rtc/signal` | 房間信令中繼（join/offer/answer/ice/bye） | ✅ 可用（test-signal.js 全通過） |
| `POST /api/rtc/recording` | 收通話錄音（webm/wav） | 🟡 階段1 僅接收；階段3 才存 Supabase+Gemini |
| `POST /api/rtc/callback-request` | 無人接聽的待回電 | 🟡 階段1 僅接收；階段3 才寫 Supabase |

## TURN（跨網路必須，階段2）
不設 TURN 時**只有同一 NAT/區網內能通**（自我測試 OK，正式對外不夠）。跨網路需 TURN 中繼，二選一設環境變數：

**① Cloudflare Calls TURN（原站用的，有免費額度）**
```
CF_TURN_KEY_ID=<你的 key id>
CF_TURN_API_TOKEN=<你的 api token>
```
**② 任意靜態 TURN（如 metered.ca / 自架 coturn）**
```
TURN_URLS=turn:xxx:3478?transport=udp,turn:xxx:3478?transport=tcp
TURN_USERNAME=<user>
TURN_CREDENTIAL=<pass>
```

## 部署（Render，同原站模式）
- New Web Service → 指到本 repo 的 `comm-voice/` 目錄
- Build: `npm install`　Start: `npm start`
- 環境變數：上面的 TURN 設定；階段3 再加 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GEMINI_API_KEY`
- 前端與後端同源（都在這支服務下），`rtc-client.js` 用 `location.host` 自動指向，零改動。

## 尚未完成（見專案根 `版本紀錄.md`）
- 階段2：TURN 供應商申請 + 跨網路實測
- 階段3：錄音存 Supabase Storage、Gemini 摘要、待回電落 DB
- 階段4：接進 `waferlock_LINE.html` 的 0800 值機桌面，取代「模擬來電」
