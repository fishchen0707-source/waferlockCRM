# TTS 連線測試：讀 secret.txt 的 TTS function-id/voice，呼叫 NVIDIA Riva TTS 合成一句中文，
# 存成 out_tts.wav 讓你放來聽，確認「機器人能發出中文聲音」再部署。
# secret.txt 需加：RIVA_TTS_FUNCTION_ID、RIVA_TTS_VOICE（可空）、RIVA_TTS_LANGUAGE（預設 zh-CN）
# 用法：python check_tts.py "要合成的中文句子"
import os
import sys
import wave

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


def main():
    s = load_secret()
    key = s.get("NVIDIA_API_KEY", "")
    fid = s.get("RIVA_TTS_FUNCTION_ID", "")
    voice = s.get("RIVA_TTS_VOICE", "")
    lang = s.get("RIVA_TTS_LANGUAGE", "zh-CN")
    sr = int(s.get("TTS_SAMPLE_RATE", "16000"))
    text = sys.argv[1] if len(sys.argv) > 1 else "您好，歡迎致電維夫拉克客服，請問有什麼可以幫您？"
    print(f"金鑰長度={len(key)}　TTS_function-id長度={len(fid)}　voice={voice or '(預設)'}　語言={lang}")
    if not key or not fid:
        print("❌ secret.txt 缺 NVIDIA_API_KEY 或 RIVA_TTS_FUNCTION_ID"); return 1

    try:
        import riva.client
    except Exception as e:
        print("❌ 未安裝 nvidia-riva-client：", e); return 1

    try:
        auth = riva.client.Auth(
            uri="grpc.nvcf.nvidia.com:443", use_ssl=True,
            metadata_args=[["function-id", fid], ["authorization", f"Bearer {key}"]],
        )
        tts = riva.client.SpeechSynthesisService(auth)
        resp = tts.synthesize(
            text=text, voice_name=voice or None, language_code=lang,
            encoding=riva.client.AudioEncoding.LINEAR_PCM, sample_rate_hz=sr,
        )
        audio = resp.audio
        if not audio:
            print("❌ TTS 回傳空音訊（可能 voice/語言不對）"); return 1
        out = os.path.join(os.path.dirname(__file__), "out_tts.wav")
        with wave.open(out, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(audio)
        print(f"✅ 合成成功！{len(audio)} bytes → {out}（放來聽有沒有中文人聲）")
        return 0
    except Exception as e:
        print("❌ 呼叫 TTS 失敗：", repr(e))
        print("   常見原因：TTS function-id 錯、voice 名稱不對、或該模型不支援此語言")
        return 1


if __name__ == "__main__":
    sys.exit(main())
