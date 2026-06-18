// ==============================================
// LINE Push — 由客服後台 / CRM 呼叫，把回覆或通知（派工、結案）推回客戶 LINE
// 部署：Supabase Edge Function「line-push」（Verify JWT 可維持開啟，前端帶 anon key 呼叫）
// 需要密鑰：LINE_CHANNEL_ACCESS_TOKEN
// 呼叫方式（前端）：
//   sb.functions.invoke('line-push', { body: { to: '<lineUserId>', text: '訊息' } })
//   或 POST { "to": "<lineUserId>", "text": "..." }
// 註：conversations 的 id 即為 lineUserId，前端用該 id 當 to。
// ==============================================
const ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { to, text, sender } = await req.json();
    if (!to || !text) {
      return new Response(JSON.stringify({ error: "to/text required" }), { status: 400, headers: cors });
    }
    const message: any = { type: "text", text };
    if (sender && sender.name) message.sender = sender; // {name, iconUrl?} 逐則顯示小名/頭像
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ to, messages: [message] }),
    });
    if (!r.ok) {
      const err = await r.text();
      return new Response(JSON.stringify({ ok: false, status: r.status, err }), { status: 502, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, err: String(e) }), { status: 500, headers: cors });
  }
});
