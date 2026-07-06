// ==============================================
// rtc-callback-request — 真人語音無人接聽後的待回電落地
// 部署：Supabase Edge Function「rtc-callback-request」
// 前端：comm-voice/public/call.html 50 秒無人接聽後送 {room,name,phone}
// 落地：寫入 conversations，platform='phone'，供 0800 值機桌面與客服績效後續統計。
// 需要環境變數：SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（建議）
// ==============================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nkyanyjgfrmovjoqevro.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function nowText() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tsNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, error: "Supabase key missing" }, 500);

  try {
    const body = await req.json();
    const room = String(body.room || "").trim();
    const phone = String(body.phone || "").trim();
    const name = String(body.name || "").trim() || "待回電客戶";
    if (!phone) return json({ ok: false, error: "phone required" }, 400);

    const safePhone = phone.replace(/\D/g, "") || "unknown";
    const convId = `phone_callback_${room || safePhone}`;
    const text = `📞 真人語音未接｜請回電：${name}｜${phone}${room ? `｜room:${room}` : ""}`;
    const msg = {
      id: "cb" + Date.now(),
      from: "user",
      text,
      time: nowText(),
      ts: tsNow(),
      type: "callback_request",
      callback: { room, name, phone },
    };

    let oldMsgs: unknown[] = [];
    const old = await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${encodeURIComponent(convId)}&select=msgs`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (old.ok) {
      const rows = await old.json();
      oldMsgs = Array.isArray(rows?.[0]?.msgs) ? rows[0].msgs : [];
    }

    const row = {
      id: convId,
      wf_id: null,
      name: `待回電：${name}`,
      platform: "phone",
      av: "📞",
      unread: 1,
      last_msg: text,
      last_time: nowText(),
      msgs: [...oldMsgs, msg],
      agent_takeover: true,
      need_case: true,
    };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/conversations?on_conflict=id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) return json({ ok: false, status: r.status, error: await r.text() }, 502);
    return json({ ok: true, conversation: convId });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
