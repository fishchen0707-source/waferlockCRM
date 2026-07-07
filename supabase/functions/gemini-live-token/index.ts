// ==============================================
// gemini-live-token — 簽發 Gemini Live API 短效憑證（ephemeral token）
// 前端拿此 token 直連 Gemini Live WebSocket，GEMINI_API_KEY 只留伺服器、不進前端。
// 客服人設（model / 台灣腔 Leda 音色 / system prompt / 情感對話）綁在 token 的
// bidiGenerateContentSetup，鎖在伺服器端、前端無法竄改。
//
// 純 Deno fetch（無 npm 相依，與專案其他 Edge Function 一致），打 Gemini v1alpha REST：
//   POST https://generativelanguage.googleapis.com/v1alpha/auth_tokens
//   （body 格式已用 SDK 攔截＋手寫 REST 實測 200 驗證）
//
// 部署：Supabase Edge Function「gemini-live-token」（Verify JWT 維持開啟，前端帶 anon key）
// 密鑰（Supabase → Edge Functions → Secrets）：
//   GEMINI_API_KEY   （Google AI Studio 的 API key，沿用既有那把）
// 呼叫（前端）：
//   fetch('<proj>.supabase.co/functions/v1/gemini-live-token',
//         { method:'POST', headers:{ apikey, Authorization:'Bearer '+anon } })
//   回：{ token:"auth_tokens/xxxx", model:"..." } 或 { error }
// ==============================================
const KEY = Deno.env.get("GEMINI_API_KEY") || "";

// 與 G0 PoC 驗證通過的一致：native audio 原生語音對話（支援 Leda 音色 + 情感對話 + function calling）
const MODEL_ID = "gemini-2.5-flash-native-audio-preview-12-2025";
const VOICE = "Leda";

// 台灣客服人設（G0 試聽定案）。放伺服器端，不外洩前端。
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

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) {
    return new Response(JSON.stringify({ error: "伺服器未設定 GEMINI_API_KEY" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  try {
    const body = {
      uses: 1,                              // 一次性：一把 token 只夠開一個連線
      expireTime: iso(30 * 60 * 1000),      // token 本身 30 分鐘後失效
      newSessionExpireTime: iso(2 * 60 * 1000), // 須在 2 分鐘內開始連線
      bidiGenerateContentSetup: {
        model: "models/" + MODEL_ID,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          enableAffectiveDialog: true,
        },
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      },
    };
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=" + encodeURIComponent(KEY),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!r.ok) {
      const errText = await r.text();
      console.log("[gemini-live-token] Gemini 回非 200", r.status, errText.slice(0, 300));
      return new Response(JSON.stringify({ error: "簽發憑證失敗", status: r.status }), {
        status: 502, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const data = await r.json();
    if (!data.name) {
      return new Response(JSON.stringify({ error: "Gemini 未回傳 token name" }), {
        status: 502, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    // 回傳給前端：token（auth_tokens/xxx）＋不帶前綴的 model 名（前端 SDK live.connect 用）
    return new Response(JSON.stringify({ token: data.name, model: MODEL_ID }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log("[gemini-live-token 例外]", String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
