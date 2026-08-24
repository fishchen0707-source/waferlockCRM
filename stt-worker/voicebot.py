import asyncio
import os
import queue
import threading
import json
import base64
import requests
from fastapi import WebSocket, WebSocketDisconnect

NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")
RIVA_FUNCTION_ID = os.environ.get("RIVA_FUNCTION_ID", "")          # ASR（parakeet zh-tw）
RIVA_TTS_FUNCTION_ID = os.environ.get("RIVA_TTS_FUNCTION_ID", "")  # TTS（Magpie/FastPitch，需另外拿）
RIVA_LANGUAGE_CODE = os.environ.get("RIVA_LANGUAGE_CODE", "zh-TW") # ASR 語言
# TTS 只支援到 zh-CN（大陸普通話腔），沒有 zh-TW；voice 依模型頁列的可用發音人填
RIVA_TTS_LANGUAGE = os.environ.get("RIVA_TTS_LANGUAGE", "zh-CN")
RIVA_TTS_VOICE = os.environ.get("RIVA_TTS_VOICE", "")
TTS_SAMPLE_RATE = int(os.environ.get("TTS_SAMPLE_RATE", "16000"))
# 即時語音要低延遲：預設用快的小模型，別用 397B 推理模型（可用 VOICEBOT_LLM_MODEL 覆寫）
VOICEBOT_LLM_MODEL = os.environ.get("VOICEBOT_LLM_MODEL", os.environ.get("NVIDIA_LLM_MODEL", "meta/llama-3.1-8b-instruct"))

# System prompt for the voicebot
SYSTEM_PROMPT = """你是一個親切的語音客服助理。
現在顧客已經進線。請用簡短、口語化的繁體中文回應。
如果顧客提到「要找真人」、「聽不懂」、「報修細節」等，或者你無法處理，
請回覆：「好的，幫您轉接給專員，請稍候。」並且在回覆結尾加上 [TRANSFER] 標記。
每次回答字數盡量少於30字，像真人一樣自然對話。"""

def _run_riva_asr(audio_queue: queue.Queue, result_queue: queue.Queue):
    """在背景執行緒跑 Riva ASR 串流，避免阻塞 asyncio"""
    if not (NVIDIA_API_KEY and RIVA_FUNCTION_ID):
        result_queue.put({"error": "Missing NVIDIA credentials"})
        return
    
    try:
        import riva.client
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
            sample_rate_hertz=16000,
        )
        raw = os.environ.get("BOOST_WORDS", "電子鎖,維夫拉克,門鎖,把手,面板,電池,感應,指紋,型號")
        boost = [" ".join(list(w.strip())) for w in raw.split(",") if w.strip()]
        try:
            riva.client.add_word_boosting_to_config(config, boost, 25.0)
        except Exception:
            pass
            
        scfg = riva.client.StreamingRecognitionConfig(config=config, interim_results=True)
        
        def audio_generator():
            while True:
                chunk = audio_queue.get()
                if chunk is None:
                    break
                yield chunk
                
        responses = asr.streaming_response_generator(audio_chunks=audio_generator(), streaming_config=scfg)
        for r in responses:
            for res in r.results:
                if res.alternatives:
                    text = res.alternatives[0].transcript
                    result_queue.put({"text": text, "is_final": res.is_final})
    except Exception as e:
        result_queue.put({"error": repr(e)})

def _strip_think(text: str) -> str:
    """剝掉推理型模型的 <think>...</think> 內心獨白，只留真正回覆。"""
    import re
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def _call_llm(history):
    """呼叫 NVIDIA LLM（即時語音用快模型）。回覆已剝除 think、去掉 [TRANSFER] 前先保留給上層判斷。"""
    if not NVIDIA_API_KEY:
        return "LLM 未設定金鑰"
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history
    try:
        r = requests.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {NVIDIA_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": VOICEBOT_LLM_MODEL,
                "messages": messages,
                "temperature": 0.5,
                "max_tokens": 512,  # 留夠空間；即時語音靠 system prompt 要求「30字內」控制長度，而非硬截斷
            },
            timeout=15,
        )
        if r.ok:
            return _strip_think(r.json()["choices"][0]["message"]["content"])
        print("[LLM 失敗]", r.status_code, r.text[:200])
        return "不好意思，我這邊有點狀況，幫您轉接專員。 [TRANSFER]"
    except Exception as e:
        print("[LLM 例外]", repr(e))
        return "不好意思，我這邊有點狀況，幫您轉接專員。 [TRANSFER]"

def _call_tts(text: str):
    """呼叫 Riva TTS 產生音訊（回裸 16-bit PCM bytes）。缺 function-id 或失敗回 b""。"""
    if not (NVIDIA_API_KEY and RIVA_TTS_FUNCTION_ID):
        print("[TTS] 未設 RIVA_TTS_FUNCTION_ID，跳過（機器人將無聲）")
        return b""
    if not text:
        return b""
    try:
        import riva.client
        auth = riva.client.Auth(
            uri="grpc.nvcf.nvidia.com:443",
            use_ssl=True,
            metadata_args=[
                ["function-id", RIVA_TTS_FUNCTION_ID],
                ["authorization", f"Bearer {NVIDIA_API_KEY}"],
            ],
        )
        tts = riva.client.SpeechSynthesisService(auth)
        resp = tts.synthesize(
            text=text,
            voice_name=RIVA_TTS_VOICE or None,   # Magpie 多語模型要指定發音人；空字串→None 用預設
            language_code=RIVA_TTS_LANGUAGE,      # TTS 只到 zh-CN
            encoding=riva.client.AudioEncoding.LINEAR_PCM,
            sample_rate_hz=TTS_SAMPLE_RATE,
        )
        return resp.audio
    except Exception as e:
        print("[TTS Error]", repr(e))
        return b""

async def voicebot_handler(websocket: WebSocket):
    await websocket.accept()
    
    # 傳送歡迎詞
    welcome = "您好！歡迎致電維夫拉克客服，請問有什麼可以幫您？"
    history = [{"role": "assistant", "content": welcome}]
    
    # 在背景執行緒呼叫 TTS 以免卡住 event loop
    tts_audio = await asyncio.to_thread(_call_tts, welcome)
    await websocket.send_json({"type": "text", "text": welcome, "is_final": True, "role": "assistant"})
    if tts_audio:
        await websocket.send_json({"type": "audio", "data": base64.b64encode(tts_audio).decode('utf-8'), "sampleRate": TTS_SAMPLE_RATE})
    
    audio_q = queue.Queue()
    result_q = queue.Queue()
    
    # 啟動 ASR 執行緒
    asr_thread = threading.Thread(target=_run_riva_asr, args=(audio_q, result_q), daemon=True)
    asr_thread.start()
    
    async def asr_reader():
        while True:
            try:
                # 輪詢 ASR 結果
                res = await asyncio.to_thread(result_q.get, timeout=1.0)
                if "error" in res:
                    print("ASR Error:", res["error"])
                    break
                
                # 回傳 interim 給前端顯示
                await websocket.send_json({"type": "text", "text": res["text"], "is_final": res["is_final"], "role": "user"})
                
                if res["is_final"] and res["text"].strip():
                    user_text = res["text"].strip()
                    history.append({"role": "user", "content": user_text})
                    
                    # 呼叫 LLM
                    bot_text = await asyncio.to_thread(_call_llm, history)
                    
                    do_transfer = "[TRANSFER]" in bot_text
                    clean_text = bot_text.replace("[TRANSFER]", "").strip()
                    history.append({"role": "assistant", "content": clean_text})
                    
                    # 回傳文字與發音
                    await websocket.send_json({"type": "text", "text": clean_text, "is_final": True, "role": "assistant"})
                    tts_audio = await asyncio.to_thread(_call_tts, clean_text)
                    if tts_audio:
                        await websocket.send_json({"type": "audio", "data": base64.b64encode(tts_audio).decode('utf-8'), "sampleRate": TTS_SAMPLE_RATE})
                        
                    if do_transfer:
                        await asyncio.sleep(1) # 給一點時間播放語音
                        await websocket.send_json({"type": "transfer"})
                        break
            except queue.Empty:
                pass
            except Exception as e:
                print("ASR reader error:", e)
                break

    # 啟動非同步任務監聽 ASR 結果
    reader_task = asyncio.create_task(asr_reader())
    
    try:
        while True:
            data = await websocket.receive_bytes()
            # 將收到的音訊(16kHz 16-bit PCM)塞給 ASR
            audio_q.put(data)
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print("WebSocket exception:", e)
    finally:
        audio_q.put(None)
        reader_task.cancel()
