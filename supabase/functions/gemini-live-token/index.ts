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

// 改用 gemini-3.1-flash-live-preview：首音延遲 ~0.9s（native audio 約 1.5-2s），代價是不支援情感對話。
// 保留 Leda 音色。（本機實測：3.1 開 enableAffectiveDialog 會回 1011 Internal error，故移除該設定）
const MODEL_ID = "gemini-3.1-flash-live-preview";
const VOICE = "Leda";

// 人設改存 Supabase voicebot_settings 表，可在設定頁即時編輯、不用改 code。
// 以下為讀表失敗時的後備預設（fallback）。
const FALLBACK_PROMPT =
  "你是台灣門鎖公司「維夫拉克（WAFERLOCK）」的電話客服人員。" +
  "請全程用「台灣人的中文」說話：台灣國語的發音與腔調、台灣慣用詞彙與語助詞（例如：喔、齁、這邊、幫您、稍等一下下），" +
  "語氣親切、有溫度、像真人不像機器人。每次回覆盡量簡短口語、不超過40字。" +
  "你的服務範圍：門鎖的安裝、維修、保固與一般諮詢。" +
  "遇到你無法處理、客戶明確要求找真人、或需要當場承諾金額/交期時，" +
  "請客氣地說「這邊幫您轉接專員」並停下等待轉接。" +
  "不要唸出客戶的完整電話或地址。";
const FALLBACK_GREETING = "（電話已接通，請你主動用一句話親切問候並詢問客戶需要什麼協助）";

// 工具使用規則（系統固定，附加在使用者人設之後；使用者改人設不會弄丟這段）
const TOOL_RULES =
  "\n\n【查詢規則】只要客戶想知道維修或報修的進度、預約時間、師傅何時到，你就必須呼叫 get_case_status 工具查詢後再回答；" +
  "若還不知道客戶電話，先問到電話再呼叫。查詢後用口語把進度與預約時間講給客戶。" +
  "查不到就說系統查無這支電話的工單，並問是否要幫忙報修。絕對不要自己編造工單狀態或時間。" +
  "\n\n【報修規則】當客戶要報修、叫修或預約維修時，你要依序問清楚四件事：客戶怎麼稱呼、要維修的完整地址、聯絡電話、故障問題是什麼。" +
  "四項都問到後，用口語複誦一次跟客戶確認，客戶確認無誤才呼叫 create_repair 建立工單，成功後把工單編號念給客戶聽。" +
  "資訊還沒問齊、或客戶還沒確認之前，絕對不要呼叫 create_repair。";

// 工具宣告（綁進 token 的 setup，前端才吃得到；實際查詢在 voicebot-tools Edge Function）
const TOOLS_DECL = [{
  functionDeclarations: [
    {
      name: "get_case_status",
      description: "用客戶的聯絡電話查詢他目前的維修工單進度與預約時間",
      parameters: {
        type: "OBJECT",
        properties: { phone: { type: "STRING", description: "客戶的聯絡電話號碼" } },
        required: ["phone"],
      },
    },
    {
      name: "create_repair",
      description: "幫客戶建立一張新的維修報修工單（資訊問齊、客戶確認後才呼叫）",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "客戶姓名或稱呼" },
          phone: { type: "STRING", description: "聯絡電話" },
          address: { type: "STRING", description: "要維修的完整地址" },
          issue: { type: "STRING", description: "故障或問題描述" },
          product: { type: "STRING", description: "產品類型，例如電子鎖、門鎖" },
        },
        required: ["name", "address", "issue"],
      },
    },
  ],
}];

// Supabase 環境變數由平台自動注入
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// 讀設定頁存的人設；讀不到就回 null 讓呼叫端用後備預設
async function loadSettings(): Promise<{ system_prompt?: string; greeting?: string } | null> {
  if (!SUPA_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/voicebot_settings?key=eq.default&select=system_prompt,greeting`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return (Array.isArray(rows) && rows[0]) ? rows[0] : null;
  } catch (_e) {
    return null;
  }
}

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
    const settings = await loadSettings();
    const systemPrompt = (settings && settings.system_prompt) || FALLBACK_PROMPT;
    const greeting = (settings && settings.greeting) || FALLBACK_GREETING;
    const body = {
      uses: 1,                              // 一次性：一把 token 只夠開一個連線
      expireTime: iso(30 * 60 * 1000),      // token 本身 30 分鐘後失效
      newSessionExpireTime: iso(2 * 60 * 1000), // 須在 2 分鐘內開始連線
      bidiGenerateContentSetup: {
        model: "models/" + MODEL_ID,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
        systemInstruction: { parts: [{ text: systemPrompt + TOOL_RULES }] },
        tools: TOOLS_DECL,
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
    // 回傳給前端：token（auth_tokens/xxx）＋model 名（前端 SDK live.connect 用）＋開場問候觸發語
    return new Response(JSON.stringify({ token: data.name, model: MODEL_ID, greeting }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log("[gemini-live-token 例外]", String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
