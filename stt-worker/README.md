# WAFERLOCK 通話 STT Worker（NVIDIA Riva zh-TW）

把通話錄音轉逐字稿 + 摘要，寫回 CRM。因為 NVIDIA 語音辨識走 **gRPC**（Supabase Edge Function 打不了），所以獨立成這支 Python 服務。

## 流程
```
agent-call.html 掛斷 → POST webm+wav 到本服務 /stt
  → 存 webm 進 Supabase Storage(call-recordings)
  → NVIDIA Riva gRPC 轉逐字稿（parakeet-ctc-0.6b-zh-tw，語言 zh-TW）
  → NVIDIA LLM(OpenAI 相容) 產一句摘要
  → 寫回 conversations 一則「🎙️ 通話錄音」訊息（含 transcript / summary）
```

## 環境變數
| 變數 | 說明 |
|------|------|
| `NVIDIA_API_KEY` | build.nvidia.com 產的 `nvapi-...`（ASR 與 LLM 共用） |
| `RIVA_FUNCTION_ID` | **parakeet-ctc-0.6b-zh-tw** 模型頁「Try API」顯示的 function-id |
| `RIVA_LANGUAGE_CODE` | 預設 `zh-TW` |
| `NVIDIA_LLM_MODEL` | 摘要用，如 `qwen/qwen2.5-7b-instruct`（中文佳）或 `nvidia/llama-3.1-nemotron-70b-instruct` |
| `SUPABASE_URL` | `https://nkyanyjgfrmovjoqevro.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 寫 conversations / 上傳 Storage（**service role**，勿放前端） |
| `STORAGE_BUCKET` | 預設 `call-recordings`（需先在 Supabase 建私有 bucket） |

> **function-id 哪裡拿**：build.nvidia.com 開 `parakeet-ctc-0.6b-zh-tw` → **Try API** → 指令裡 `--metadata function-id "xxxx"` 那串就是。

## 本機跑
```bash
cd stt-worker
pip install -r requirements.txt
export NVIDIA_API_KEY=nvapi-...
export RIVA_FUNCTION_ID=...        # zh-tw 模型的 function-id
export SUPABASE_URL=https://nkyanyjgfrmovjoqevro.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...
export NVIDIA_LLM_MODEL=qwen/qwen2.5-7b-instruct
uvicorn main:app --host 0.0.0.0 --port 8000
# 健檢：curl http://localhost:8000/healthz  → 應回 {"ok":true,"riva_ready":true,...}
```

## 部署（Render）
- New Web Service → 指到 repo 的 `stt-worker/`
- Build：`pip install -r requirements.txt`
- Start：`uvicorn main:app --host 0.0.0.0 --port $PORT`
- 環境變數：填上表全部
- 部署後拿到網址（如 `https://waferlock-stt.onrender.com`）

## 接上前端
編輯 `comm-voice/public/agent-call.html`，把這行填上服務網址：
```js
var STT_WORKER_URL = 'https://waferlock-stt.onrender.com/stt';
```
沒填時錄音會回退走 Supabase 的 `rtc-recording`（Gemini 路線）。

## 前置：Supabase Storage bucket
先在 Supabase → Storage 建一個 **私有** bucket 叫 `call-recordings`。

## 驗證要點
- `/healthz` 回 `riva_ready:true` = 金鑰+function-id 有設
- 講一通中文測試電話 → 掛斷 → 客戶 CRM 的通話紀錄該筆帶「含逐字稿」，`recording.transcript` 有中文逐字稿
- ⚠️ 若逐字稿是空的：多半是 function-id 錯、或 wav 不是 16k 單聲道（agent-call.html 已轉好，理論上 OK）；看服務 log 的 `[Riva ASR 失敗]`
