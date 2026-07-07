# voicebot（自建 Gemini Live 替代品）— Bug 盤點與達標路線圖

> 產出日期：2026-07-07。給後續 AI session／工程師依序執行用。
> 目標：用 NVIDIA API（Riva ASR zh-TW → NVIDIA LLM → Riva TTS）做到 Gemini Live 等級的即時語音客服、零 API 費用，並讓 AI 讀取自己的資料庫（既有 Supabase CRM ＋ 新建產品知識庫）像真人一樣回答。
> 相關程式碼：`stt-worker/voicebot.py`（後端 WS）、`comm-voice/public/js/voicebot-client.js`、`comm-voice/public/call.html`（前端）。已 commit 但**未部署**（卡在缺中文 TTS function-id）。

---

## 一、現況診斷摘要

- **管線可運作**：前端 16kHz/16-bit/mono PCM 上行 ↔ 後端 Riva streaming ASR 設定一致；TTS 裸 PCM＋`sampleRate` 欄位 ↔ 前端手動建 AudioBuffer 一致。前後端音訊格式契約對得上。
- **進場流程**：0800 值機桌面（`waferlock_LINE.html:992-1024`）產 room → 顧客開 `call.html` 按接聽 → **先接 AI**（`call.html:95-96` startVoicebot）→ 講「找真人」→ `[TRANSFER]` → 原頁轉 WebRTC 真人。
- **AI 讀資料庫目前 0% 實作**：`voicebot.py` 無任何 Supabase 存取、無 RAG、無 tool-calling，AI 只靠 system prompt 空講。
- **阻塞部署的唯一前置**：`RIVA_TTS_FUNCTION_ID` 未取得（沒有它機器人無聲）。

---

## 二、Bug 清單（依嚴重度分級，附檔案:行號）

### P0 — 部署後會直接壞掉使用者體驗

1. `comm-voice/public/call.html:54-55,88` — 50 秒「無人接聽」計時器在載入即起算、只在 WebRTC connected 才取消：顧客跟 AI 講超過 50 秒必彈「留電回電」表單蓋掉對話。修法：startVoicebot 成功（WS open 或收到第一則訊息）即 `cancelWait()`。
2. `stt-worker/voicebot.py:193-195` — `asr_reader` 任一例外即永久 break，但主迴圈仍收音訊：**連線假死**，bot 不再回話且前端無感知。修法：例外時通知前端＋關閉 WS。
3. `comm-voice/public/js/voicebot-client.js:93`（對照 `:84`）— 只有 transfer 分支停麥克風 track；`onclose` 不停 track、不 `actx.close()`：斷線後麥克風燈恆亮＋AudioContext 洩漏。
4. `comm-voice/public/js/voicebot-client.js:93-94` — WS 無重連/keepalive：Render 免費方案閒置斷線後 AI 直接失效。至少要顯性告知顧客並提供「重新接聽」。
5. **轉真人無信令閉環**：`[TRANSFER]` 只讓顧客端自己加入 WebRTC room（`voicebot-client.js:82-87`），**客服端收不到任何通知**（`agent-call.html` 需客服事先手動開啟並空等撥號）。若無人值機，顧客轉真人後永遠沒人接、也不回落留電表單。→ Phase 3a 處理。
6. `stt-worker/voicebot.py`（全檔無 Supabase 存取）— AI 對話逐字稿完全不落地 CRM：`conversations` 只有真人段錄音，AI 段問答蒸發，違反「凡走過必留下痕跡」。→ Phase 3b 處理。

### P1 — 品質/穩定性缺陷

7. `stt-worker/voicebot.py:170-190` — 無 barge-in：AI 講話期間顧客無法打斷（前端半雙工閉麥是防回音手段，但也讓「插話」不可能）。→ Phase 4。
8. `stt-worker/voicebot.py:143,172,179` — `history` 無限增長，長通話 context 撐爆、延遲上升。修法：裁切保留最近 N 輪。
9. `stt-worker/voicebot.py:162` — `asyncio.to_thread(result_q.get, timeout=1.0)` 每連線常駐佔一個 executor 執行緒，多路並發會餓死 LLM/TTS 呼叫。
10. `stt-worker/voicebot.py:163-164,187-190,211` — ASR error/transfer 後 ASR 執行緒與主迴圈不清理、`reader_task.cancel()` 未 await。
11. `comm-voice/public/js/voicebot-client.js:55-61` — 48k→16k 最近鄰抽取無低通濾波，aliasing 降低 ASR 辨識率。
12. `comm-voice/public/js/voicebot-client.js:12`＋`call.html:94` — AudioContext 在 fetch 回呼中建立，脫離使用者手勢，iOS/Safari 會停在 suspended → 全程無聲。需在點擊接聽的同步路徑建立或 `actx.resume()`。
13. `stt-worker/voicebot.py:117-125,36-44` — 每次 TTS/ASR 呼叫重建 gRPC auth/service，增加延遲。

### P2 — 次要/文件

14. `stt-worker/main.py:208-210` — `/healthz` 不檢查 `RIVA_TTS_FUNCTION_ID`，無法從健檢得知 bot 能否發聲。
15. `stt-worker/voicebot.py:96-101` — 若覆寫成 reasoning 模型且 `<think>` 被 512 token 截斷，內心獨白會被念出。
16. `comm-voice/public/call.html:50-52` — `ho` 參數死碼（無任何產生端帶它）。
17. `stt-worker/README.md` — 完全沒寫 voicebot/`/ws/voicebot`/TTS 環境變數/前端音訊格式契約（16k/16-bit/mono PCM）。
18. `stt-worker/voicebot.py:178-185` — LLM 回覆剝除標記後可能為空字串仍送 TTS。

---

## 三、達標路線圖（依序執行）

### Phase 0 — 讓機器人出聲（人工前置，無法由 AI 代做）

- 到 build.nvidia.com 取得中文 TTS 模型 function-id（Magpie TTS Multilingual 等，語言只有 zh-CN，無台灣腔）→ 設 `RIVA_TTS_FUNCTION_ID`（＋必要時 `RIVA_TTS_VOICE`）。
- 本機跑 `python stt-worker/check_tts.py` 驗證能發中文聲音（產出 out_tts.wav）。
- Render 環境變數補齊後重部署 `stt-worker`。

### Phase 1 — 修 P0 bug（第 1~4 項＋第 10 項的清理）

- 一項一修一驗，前端用瀏覽器實測、後端至少 `py_compile`＋本機 WS 冒煙測試。

### Phase 2 — AI 讀資料庫（本專案核心目標）

設計原則：確定性邏輯不交給模型（CLAUDE.md 規則 5），起步不用 embeddings，最少代碼。

- **2a 來電者身分注入（CRM）**：`voiceUrls()`（`waferlock_LINE.html:994`）產顧客連結時帶 `wfId`/`phone` → `call.html` 轉交 → 前端 WS 連上後第一則送 JSON hello（含 wfId）→ `voicebot.py` 用 `SUPABASE_URL`＋`SUPABASE_SERVICE_ROLE_KEY`（`main.py` 已有這兩個環境變數）以 REST 查 `customers`/`repairs`/`installs`，把「姓名/進行中工單狀態/保固狀態」摘要注入 system prompt。AI 即可回答「我的維修排到什麼時候」。
- **2b 產品知識庫**：Supabase 新表 `kb_articles`（id/title/content/keywords/updated_at）。第一版檢索用關鍵字比對（`ilike`/`pg_trgm`），每輪 ASR final 後取 top 3 條目附進該輪 context（輕量 RAG）。知識內容由人工在 CRM 後台或 SQL 塞入。
- **2c（選配，2a/2b 驗證後再做）**：升級為 NVIDIA embedding＋pgvector 語意檢索；或改 LLM tool-calling 動態查詢。
- **隱私護欄**：AI 只能讀取「本通來電 wfId 對應」的客戶資料，不得跨客戶查詢；system prompt 明示不可唸出完整電話/地址。

### Phase 3 — 轉真人閉環＋對話落地 CRM

- **3a 轉真人信令**：`[TRANSFER]` 時後端（或前端）向 Supabase Realtime 頻道廣播/寫入 `conversations`（沿用 `rtc-callback-request` 的 upsert 模式），0800 值機桌面跳「AI 轉接來電」彈屏＋一鍵開 `agent-call.html`；顧客端轉真人後若 60 秒無人接，回落既有留電表單（接回 `rtc-callback-request`）。
- **3b AI 對話落地**：通話結束/轉接時，`voicebot.py` 把 ASR/LLM 全程逐字稿＋一句摘要經既有 `append_conversation_message` RPC 寫入 `conversations`（`platform:'phone'`、conv id 沿用 `phone_<純數字>`＋`wfId`，與 `/stt` 錄音掛載一致），CRM 歷史紀錄即自動顯示。

### Phase 4 — 逼近 Gemini Live 體驗（延遲/自然度）

- LLM 改 streaming，按句切分即送 TTS（sentence-level pipeline），首音延遲從「整段生成＋整段合成」降到首句。
- Barge-in：前端加簡單能量 VAD，AI 播放中偵測到顧客講話即停播並通知後端捨棄未播段。
- 前端重取樣加低通（或改 `AudioWorklet`＋`OfflineAudioContext` 正規重取樣）。
- gRPC 連線重用、executor 佇列改造（P1 第 9、13 項）。

**每階段完成判準**：真機打一通中文電話端到端驗證＋補一筆 `版本紀錄.md` 再 commit。

---

## 四、部署前置清單（環境變數）

Render `stt-worker` 服務需要：

| 變數 | 必要性 | 說明 |
|---|---|---|
| `NVIDIA_API_KEY` | 必要 | ASR/LLM/TTS 共用，`nvapi-` 開頭 |
| `RIVA_FUNCTION_ID` | 必要 | ASR（parakeet-ctc-0.6b-zh-tw） |
| `RIVA_TTS_FUNCTION_ID` | **缺，Phase 0 目標** | 沒有它機器人無聲 |
| `RIVA_TTS_VOICE` | 選配 | Magpie 多語模型可能必填發音人 |
| `RIVA_TTS_LANGUAGE` | 選配 | 預設 zh-CN（NVIDIA TTS 無 zh-TW） |
| `TTS_SAMPLE_RATE` | 選配 | 預設 16000 |
| `VOICEBOT_LLM_MODEL` | 選配 | 預設 `meta/llama-3.1-8b-instruct`（即時語音勿用大型推理模型） |
| `BOOST_WORDS` | 選配 | ASR word boosting（電子鎖/維夫拉克…） |
| `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` | Phase 2 起必要 | 既有變數，voicebot 屆時共用 |
