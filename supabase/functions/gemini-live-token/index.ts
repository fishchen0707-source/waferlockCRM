// ==============================================
// gemini-live-token — 簽發 Gemini Live API 短效憑證（ephemeral token）
// 前端拿此 token 直連 Gemini Live WebSocket，GEMINI_API_KEY 只留伺服器、不進前端。
// 客服人設（model / 台灣腔 Leda 音色 / system prompt / 情感對話）綁在 token 的
// liveConnectConstraints，鎖在伺服器端、前端無法竄改。
//
// 部署：Supabase Edge Function「gemini-live-token」（Verify JWT 維持開啟，前端帶 anon key）
// 密鑰（Supabase → Edge Functions → Secrets）：
//   GEMINI_API_KEY   （Google AI Studio 的 API key，沿用既有那把）
// 呼叫（前端）：
//   fetch('<proj>.supabase.co/functions/v1/gemini-live-token',
//         { method:'POST', headers:{ apikey, Authorization:'Bearer '+anon } })
//   回：{ token:"auth_tokens/xxxx", model:"..." } 或 { error }
// ==============================================
import { GoogleGenAI } from "npm:@google/genai";

const KEY = Deno.env.get("GEMINI_API_KEY") || "";

// 與 G0 PoC 驗證通過的一致：native audio 原生語音對話（支援 Leda 音色 + 情感對話 + function calling）
const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const VOICE = "Leda";

// 台灣客服人設（G0 試聽定案的加強版）。放伺服器端，不外洩前端。
const SYSTEM_PROMPT =
  "你是台灣門鎖公司「維夫拉克（WAFERLOCK）」的電話客服人員。" +
  "請全程用「台灣人的中文」說話：台灣國語的發音與腔調、台灣慣用詞彙與語助詞（例如：喔、齁、這邊、幫您、稍等一下下），" +
  "語氣親切、有溫度、像真人不像機器人。每次回覆盡量簡短口語、不超過40字。" +
  "你的服務範圍：門鎖的安裝、維修、保固與一般諮詢。" +
  "遇到你無法處理、客戶明確要求找真人、或需要當場承諾金額/交期時，" +
  "請客氣地說「這邊幫您轉接專員」並停下等待轉接。" +
  "不要唸出客戶的完整電話或地址。";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) {
    return new Response(JSON.stringify({ error: "伺服器未設定 GEMINI_API_KEY" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  try {
    const ai = new GoogleGenAI({ apiKey: KEY, httpOptions: { apiVersion: "v1alpha" } });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1, // 一次性：一把 token 只夠開一個連線
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),        // token 本身 30 分鐘後失效
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // 須在 2 分鐘內開始連線
        liveConnectConstraints: {
          model: MODEL,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            enableAffectiveDialog: true,
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    return new Response(JSON.stringify({ token: token.name, model: MODEL }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log("[gemini-live-token 失敗]", String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
