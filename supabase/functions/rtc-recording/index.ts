// ==============================================
// rtc-recording — 真人語音通話錄音落地（存 Supabase Storage，選配 Gemini 摘要）
// 部署：Supabase Edge Function「rtc-recording」
// 前端：comm-voice/public/agent-call.html 掛斷後送 multipart：
//   audio(webm)、wav(16k單聲道,選配,給AI用)、conv(案件/客編/電話)、name(客服)、durationSec
// 落地：webm 上傳私有 bucket「call-recordings」；若 conv 對得上既有 conversations 就附一則錄音訊息。
// 需要環境變數：SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY；GEMINI_API_KEY（選配，設了才產摘要）
// 前置：Supabase Storage 需先建一個名為「call-recordings」的 bucket（建議私有）。
// ==============================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nkyanyjgfrmovjoqevro.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const BUCKET = "call-recordings";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const pad = (n: number) => String(n).padStart(2, "0");
const nowText = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const tsNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// 選配：把 wav 丟 Gemini 產一句話通話摘要（沒設金鑰或失敗都回空字串，不擋主流程）
async function summarize(wav: Uint8Array): Promise<string> {
  if (!GEMINI_KEY || !wav.length) return "";
  try {
    let bin = ""; for (let i = 0; i < wav.length; i++) bin += String.fromCharCode(wav[i]);
    const b64 = btoa(bin);
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: "這是一通客服電話錄音，請用繁體中文一句話（40字內）摘要通話重點與後續待辦。" },
            { inline_data: { mime_type: "audio/wav", data: b64 } },
          ] }],
        }),
      },
    );
    if (!r.ok) return "";
    const d = await r.json();
    return (d?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  } catch (_) { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, error: "Supabase key missing" }, 500);

  try {
    const form = await req.formData();
    const audio = form.get("audio") as File | null;
    const wav = form.get("wav") as File | null;
    const conv = String(form.get("conv") || "").trim();
    const name = String(form.get("name") || "").trim() || "客服";
    const durationSec = parseInt(String(form.get("durationSec") || "0"), 10) || 0;
    if (!audio) return json({ ok: false, error: "audio required" }, 400);

    // 1) 上傳 webm 到私有 bucket
    const safeConv = (conv || "unknown").replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
    const path = `${safeConv}/${Date.now()}.webm`;
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "audio/webm" },
      body: bytes,
    });
    if (!up.ok) return json({ ok: false, stage: "storage", status: up.status, error: await up.text() }, 502);

    // 2) 選配 Gemini 摘要
    const summary = wav ? await summarize(new Uint8Array(await wav.arrayBuffer())) : "";

    // 3) 若 conv 對得上既有 conversation（id 相同）就附一則錄音訊息，否則只存 Storage
    let attached = false;
    if (conv) {
      const q = await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${encodeURIComponent(conv)}&select=msgs`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (q.ok) {
        const rows = await q.json();
        if (Array.isArray(rows) && rows.length) {
          const oldMsgs = Array.isArray(rows[0].msgs) ? rows[0].msgs : [];
          const mm = Math.floor(durationSec / 60), ss = durationSec % 60;
          const text = `🎙️ 通話錄音（${mm}分${pad(ss)}秒）${summary ? `｜摘要：${summary}` : ""}`;
          const msg = { id: "rec" + Date.now(), from: "agent", by: name, text, time: nowText(), ts: tsNow(), type: "recording", recording: { path, durationSec, summary } };
          await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${encodeURIComponent(conv)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "return=minimal" },
            body: JSON.stringify({ msgs: [...oldMsgs, msg], last_msg: text, last_time: nowText() }),
          });
          attached = true;
        }
      }
    }

    return json({ ok: true, path, durationSec, summary, attached });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
