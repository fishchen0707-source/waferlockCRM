# 最小連線測試：讀 secret.txt 的金鑰，連 NVIDIA Riva，確認「金鑰有效、gRPC 通、zh-TW 模型能辨識」。
# 用法：把金鑰填進 stt-worker/secret.txt，然後 python check.py [可選的wav檔]
import os
import sys
import wave
import struct

# Windows 主控台預設 cp950 會對 emoji 報 UnicodeEncodeError，強制 stdout 走 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

def load_secret():
    d = {}
    p = os.path.join(os.path.dirname(__file__), "secret.txt")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                d[k.strip()] = v.strip()
    return d

def make_beep_wav(path):
    # 產一個 1 秒、16k、單聲道的測試音（440Hz），只為確認 gRPC 連線與授權，不求辨識內容
    import math
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        for i in range(16000):
            w.writeframes(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / 16000))))

def main():
    s = load_secret()
    key = s.get("NVIDIA_API_KEY", "")
    fid = s.get("RIVA_FUNCTION_ID", "")
    lang = s.get("RIVA_LANGUAGE_CODE", "zh-TW")
    print(f"金鑰長度={len(key)}　function-id長度={len(fid)}　語言={lang}")
    if not key or not fid:
        print("❌ secret.txt 缺 NVIDIA_API_KEY 或 RIVA_FUNCTION_ID"); return 1

    wav_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "_beep.wav")
    if not os.path.exists(wav_path):
        make_beep_wav(wav_path); print(f"（用測試音 {wav_path}，只驗連線；要驗中文請丟一個真的中文 wav 當參數）")

    try:
        import riva.client
    except Exception as e:
        print("❌ 尚未安裝 nvidia-riva-client：", e); return 1

    try:
        auth = riva.client.Auth(
            uri="grpc.nvcf.nvidia.com:443", use_ssl=True,
            metadata_args=[["function-id", fid], ["authorization", f"Bearer {key}"]],
        )
        asr = riva.client.ASRService(auth)
        with wave.open(wav_path, "rb") as _w:
            sr = _w.getframerate()  # 讀 wav 真實取樣率（不能讓 Riva 收到 sample_rate=0）
        print("wav 取樣率 =", sr)
        cfg = riva.client.RecognitionConfig(
            language_code=lang, max_alternatives=1,
            enable_automatic_punctuation=True, audio_channel_count=1,
            sample_rate_hertz=sr,
        )
        # 加強詞（domain vocabulary）：中文要每個字之間空一格。冷門專有名詞才聽得準。
        boost = ["電 子 鎖", "維 夫 拉 克", "門 鎖", "把 手", "面 板", "電 池", "感 應", "指 紋"]
        try:
            riva.client.add_word_boosting_to_config(cfg, boost, 25.0)
            print("已加強詞：", " / ".join(b.replace(" ", "") for b in boost))
        except Exception as be:
            print("（加強詞設定略過：", str(be)[:80], "）")
        data = open(wav_path, "rb").read()
        # 先試 offline，失敗（模型可能只支援串流）就改試 streaming
        try:
            resp = asr.offline_recognize(data, cfg)
            text = " ".join(r.alternatives[0].transcript for r in resp.results if r.alternatives).strip()
            print("[offline] 連線＋授權成功！")
            print("辨識結果：", repr(text) if text else "（測試音無語音，空字串正常；要驗中文請丟真人中文 wav）")
            return 0
        except Exception as off_e:
            print("[offline 不行，改試 streaming]", str(off_e)[:120])
            scfg = riva.client.StreamingRecognitionConfig(config=cfg, interim_results=False)
            responses = asr.streaming_response_generator(audio_chunks=[data], streaming_config=scfg)
            got = []
            for r in responses:
                for res in r.results:
                    if res.alternatives:
                        got.append(res.alternatives[0].transcript)
            print("[streaming] 連線＋授權成功！")
            print("辨識結果：", repr(" ".join(got).strip()) if got else "（測試音無語音，空字串正常）")
            return 0
    except Exception as e:
        print("❌ 呼叫 Riva 失敗：", repr(e))
        print("   常見原因：金鑰錯/過期、function-id 錯、或該模型未授權給此帳號")
        return 1

if __name__ == "__main__":
    sys.exit(main())
