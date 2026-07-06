# ==============================================
# WAFERLOCK 通話 STT Worker — 用 NVIDIA Riva(zh-TW ASR) 轉逐字稿 + NVIDIA LLM 產摘要
# 為什麼要這支：NVIDIA 語音辨識走 gRPC（grpc.nvcf.nvidia.com），
#   Supabase Edge Function(Deno) 打不了 gRPC，所以另跑這支 Python 服務。
# 流程：收前端錄音(webm+wav) → 存 Supabase Storage → Riva gRPC 轉逐字稿(zh-TW)
#       → NVIDIA LLM(OpenAI 相容) 產摘要 → 寫回 conversations 一則「通話錄音」訊息
# 部署：Render/Railway/Fly（Python 3.10+）。啟動：uvicorn main:app --host 0.0.0.0 --port $PORT
#
# 需要的環境變數：
#   NVIDIA_API_KEY        （build.nvidia.com 產的 nvapi-... 金鑰，ASR 與 LLM 共用）
#   RIVA_FUNCTION_ID      （parakeet-ctc-0.6b-zh-tw 模型頁 Try API 顯示的 function-id）
#   RIVA_LANGUAGE_CODE    （預設 zh-TW）
#   NVIDIA_LLM_MODEL      （摘要用，如 qwen/qwen2.5-7b-instruct 或 nvidia/llama-3.1-nemotron-70b-instruct）
#   SUPABASE_URL          （https://<ref>.supabase.co）
#   SUPABASE_SERVICE_ROLE_KEY （寫 conversations / 上傳 Storage 用）
#   STORAGE_BUCKET        （預設 call-recordings，需先在 Supabase 建好私有 bucket）
# ==============================================
import os
import time
import io
import datetime
import requests
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")
RIVA_FUNCTION_ID = os.environ.get("RIVA_FUNCTION_ID", "")
RIVA_LANGUAGE_CODE = os.environ.get("RIVA_LANGUAGE_CODE", "zh-TW")
NVIDIA_LLM_MODEL = os.environ.get("NVIDIA_LLM_MODEL", "qwen/qwen2.5-7b-instruct")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = os.environ.get("STORAGE_BUCKET", "call-recordings")

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


def _tsnow():
    d = datetime.datetime.now()
    return d.strftime("%Y-%m-%d %H:%M")


def _hhmm():
    return datetime.datetime.now().strftime("%H:%M")


def riva_transcribe(wav_bytes: bytes) -> str:
    """用 NVIDIA Riva(NVCF) 辨識 16k 單聲道 wav → 逐字稿。
    注意：parakeet-ctc-0.6b-zh-tw 只支援 streaming（不支援 offline_recognize）。
    金鑰/function-id 缺就回空字串。"""
    if not (NVIDIA_API_KEY and RIVA_FUNCTION_ID and wav_bytes):
        return ""
    try:
        import riva.client  # nvidia-riva-client
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            sr = w.getframerate()  # 讀真實取樣率，不能讓 Riva 收到 sample_rate=0
        auth = riva.client.Auth(
            uri="grpc.nvcf.nvidia.com:443",
            use_ssl=True,
            metadata_args=[
                ["function-id", RIVA_FUNCTION_ID],
                ["authorization", f"Bearer {NVIDIA_API_KEY}"],
            ],
        )
        asr = riva.client.ASRService(auth)
        config = riva.client.RecognitionConfig(
            language_code=RIVA_LANGUAGE_CODE,
            max_alternatives=1,
            enable_automatic_punctuation=True,
            audio_channel_count=1,
            sample_rate_hertz=sr,
        )
        # 加強詞：冷門專有名詞（電子鎖/維夫拉克/型號…）易被聽成常見詞（如電子書），
        # 中文加強詞每字之間要空格。可用環境變數 BOOST_WORDS 覆寫（逗號分隔，不用空格，程式自動補）。
        raw = os.environ.get("BOOST_WORDS", "電子鎖,維夫拉克,門鎖,把手,面板,電池,感應,指紋,型號")
        boost = [" ".join(list(w.strip())) for w in raw.split(",") if w.strip()]
        try:
            riva.client.add_word_boosting_to_config(config, boost, 25.0)
        except Exception as be:
            print("[加強詞略過]", repr(be))
        scfg = riva.client.StreamingRecognitionConfig(config=config, interim_results=False)
        responses = asr.streaming_response_generator(audio_chunks=[wav_bytes], streaming_config=scfg)
        parts = []
        for r in responses:
            for res in r.results:
                if res.alternatives:
                    parts.append(res.alternatives[0].transcript)
        return " ".join(p.strip() for p in parts if p).strip()
    except Exception as e:
        print("[Riva ASR 失敗]", repr(e))
        return ""


def nvidia_summary(transcript: str) -> str:
    """把逐字稿丟 NVIDIA LLM(OpenAI 相容) 產一句話摘要。缺金鑰或失敗回空字串。"""
    if not (NVIDIA_API_KEY and transcript):
        return ""
    try:
        r = requests.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {NVIDIA_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": NVIDIA_LLM_MODEL,
                "messages": [{
                    "role": "user",
                    "content": "以下是一通客服電話的逐字稿，請用繁體中文一句話（40字內）摘要通話重點與後續待辦：\n\n" + transcript,
                }],
                "temperature": 0.2,
                "max_tokens": 200,
            },
            timeout=60,
        )
        if not r.ok:
            print("[NVIDIA LLM 失敗]", r.status_code, r.text[:200])
            return ""
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print("[NVIDIA LLM 例外]", repr(e))
        return ""


def upload_webm(conv: str, webm: bytes) -> str:
    """webm 上傳私有 bucket，回 storage 物件路徑。失敗回空字串。"""
    if not (SUPABASE_URL and SERVICE_KEY and webm):
        return ""
    safe = "".join(ch for ch in (conv or "unknown") if ch.isalnum() or ch in "_-") or "unknown"
    path = f"{safe}/{int(time.time()*1000)}.webm"
    try:
        r = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
            headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}", "Content-Type": "audio/webm"},
            data=webm, timeout=60,
        )
        if r.ok:
            return path
        print("[Storage 上傳失敗]", r.status_code, r.text[:200])
    except Exception as e:
        print("[Storage 例外]", repr(e))
    return ""


def attach_to_conversation(conv: str, name: str, duration: int, path: str, transcript: str, summary: str) -> bool:
    """若 conv 對得上既有 conversation，附一則「通話錄音」訊息（含逐字稿/摘要）。"""
    if not (SUPABASE_URL and SERVICE_KEY and conv):
        return False
    try:
        q = requests.get(
            f"{SUPABASE_URL}/rest/v1/conversations",
            headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
            params={"id": f"eq.{conv}", "select": "msgs"}, timeout=30,
        )
        rows = q.json() if q.ok else []
        if not (isinstance(rows, list) and rows):
            return False
        old = rows[0].get("msgs") or []
        mm, ss = duration // 60, duration % 60
        text = f"🎙️ 通話錄音（{mm}分{ss:02d}秒）"
        if summary:
            text += f"｜摘要：{summary}"
        if transcript:
            text += "｜含逐字稿"
        msg = {
            "id": "rec" + str(int(time.time() * 1000)),
            "from": "agent", "by": name or "客服", "text": text,
            "time": _hhmm(), "ts": _tsnow(), "type": "recording",
            "recording": {"path": path, "durationSec": duration, "summary": summary, "transcript": transcript},
        }
        p = requests.patch(
            f"{SUPABASE_URL}/rest/v1/conversations",
            headers={
                "apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": "application/json", "Prefer": "return=minimal",
            },
            params={"id": f"eq.{conv}"},
            json={"msgs": old + [msg], "last_msg": text, "last_time": _hhmm()}, timeout=30,
        )
        return p.ok
    except Exception as e:
        print("[attach 例外]", repr(e))
        return False


@app.get("/healthz")
def healthz():
    return {"ok": True, "riva_ready": bool(NVIDIA_API_KEY and RIVA_FUNCTION_ID), "lang": RIVA_LANGUAGE_CODE}


@app.post("/stt")
async def stt(
    audio: UploadFile = File(...),                 # webm 原檔（存檔用）
    wav: UploadFile = File(None),                  # 16k 單聲道 wav（給 ASR）
    conv: str = Form(""), name: str = Form(""), durationSec: str = Form("0"),
):
    duration = int(durationSec) if str(durationSec).isdigit() else 0
    webm_bytes = await audio.read()
    wav_bytes = await wav.read() if wav is not None else b""

    path = upload_webm(conv, webm_bytes)
    transcript = riva_transcribe(wav_bytes)
    summary = nvidia_summary(transcript)
    attached = attach_to_conversation(conv, name, duration, path, transcript, summary)

    return {
        "ok": True, "path": path, "durationSec": duration,
        "transcript": transcript, "summary": summary, "attached": attached,
    }
