// ==============================================
// Meta Push — 由客服後台呼叫，把回覆推回 FB Messenger / IG DM
// 部署：Supabase Edge Function「meta-push」（Verify JWT 可維持開啟，前端帶 anon key 呼叫）
// 需要密鑰：META_PAGE_ACCESS_TOKEN
// 呼叫方式（前端）：
//   sb.functions.invoke('meta-push', { body: { to: 'fb_<PSID>', text: '訊息' } })
//   sb.functions.invoke('meta-push', { body: { to: 'ig_<IGSID>', text: '訊息' } })
// 註：conversations.id 格式為 fb_<PSID> 或 ig_<IGSID>，前端用該 id 當 to。
// ==============================================
const PAGE_TOKEN = Deno.env.get("META_PAGE_ACCESS_TOKEN")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { to, text } = await req.json();
    if (!to || !text) {
      return new Response(JSON.stringify({ error: "to/text required" }), { status: 400, headers: cors });
    }

    // to 格式：fb_<PSID> 或 ig_<IGSID>，取底線後的真實 ID
    const recipientId = to.replace(/^(fb|ig)_/, "");

    const r = await fetch("https://graph.facebook.com/v19.0/me/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PAGE_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        messaging_type: "RESPONSE",
      }),
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
