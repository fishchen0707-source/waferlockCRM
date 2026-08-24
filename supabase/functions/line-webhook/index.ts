// ==============================================
// LINE Messaging API Webhook — 收訊息進客服收件匣（先不接 AI）
// 部署：Supabase Edge Function「line-webhook」，並關閉 Verify JWT
// 需要的密鑰（Supabase → Edge Functions → Secrets）：
//   LINE_CHANNEL_SECRET        （Messaging API channel 的 Channel secret）
//   LINE_CHANNEL_ACCESS_TOKEN  （Messaging API channel 的 long-lived access token）
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入
// LINE 後台 Webhook URL：
//   https://<project-ref>.supabase.co/functions/v1/line-webhook
// ==============================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const hhmm = () =>
  new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei",
  });
// 完整時間戳（YYYY-MM-DD HH:MM）供客服績效報表算跨日回覆時效用，hhmm() 只給聊天泡泡顯示，不動它的格式
const fullTs = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

// 驗證 LINE 簽章：Base64(HMAC-SHA256(channelSecret, rawBody))
async function verifySignature(body: string, signature: string | null) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return b64 === signature;
}

async function getDisplayName(userId: string) {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (r.ok) return (await r.json()).displayName as string;
  } catch (_) { /* ignore */ }
  return null;
}

async function replyText(replyToken: string, text: string, sender?: { name: string; iconUrl?: string }) {
  const message: any = { type: "text", text };
  if (sender?.name) message.sender = sender;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [message] }),
  });
}
const AI_SENDER = { name: "維夫拉克AI 小拉" };

async function handleMessage(ev: any) {
  const userId: string = ev.source?.userId;
  if (!userId) return;
  const convId = userId;
  const text: string = ev.message?.type === "text" ? ev.message.text : `（${ev.message?.type} 訊息）`;

  // 認會員：line_users → customers
  let wfId: string | null = null, name: string | null = null;
  const { data: lu } = await sb.from("line_users").select("wf_id").eq("line_user_id", userId).maybeSingle();
  if (lu?.wf_id) {
    wfId = lu.wf_id;
    const { data: c } = await sb.from("customers").select("name").eq("wf_id", wfId).maybeSingle();
    name = c?.name ?? null;
  }
  if (!name) name = (await getDisplayName(userId)) ?? "LINE 用戶";

  const msg = { id: "u" + Date.now(), from: "user", text, time: hhmm(), ts: fullTs() };

  // 僅用於判斷「是否為新對話／是否已被客服接手」，不參與寫入路徑，不影響訊息本身的原子性
  const { data: existing } = await sb.from("conversations").select("id, agent_takeover").eq("id", convId).maybeSingle();
  const isNew = !existing;
  const takeover = !!existing?.agent_takeover;

  // 原子 append：即使 LINE 平台重送事件、或與 CRM 端同時寫入，也不會互相覆蓋（見 supabase_atomic_conv_append.sql）
  const { error: appendErr } = await sb.rpc("append_conversation_message", {
    p_id: convId, p_msg: msg, p_last_msg: text, p_last_time: hhmm(),
    p_wf_id: wfId, p_name: isNew ? `${name}（LINE）` : name, p_platform: "line",
    p_av: (name || "?")[0], p_unread_delta: 1,
  });
  if (appendErr) { console.error("append_conversation_message failed", appendErr); throw appendErr; }

  // 首則自動回覆「已收到」（未被客服接手時）。先不接 AI，故不做問答。
  if (ev.replyToken && isNew && !takeover) {
    await replyText(ev.replyToken, "您好，已收到您的訊息 🙏\n客服將盡快為您服務。如需報修或查保固，可點下方選單。", AI_SENDER);
  }
}

Deno.serve(async (req) => {
  const body = await req.text();
  const ok = await verifySignature(body, req.headers.get("x-line-signature"));
  if (!ok) return new Response("bad signature", { status: 401 });

  const events = JSON.parse(body).events ?? [];
  for (const ev of events) {
    try {
      if (ev.type === "message") await handleMessage(ev);
      else if (ev.type === "follow" && ev.replyToken) {
        await replyText(ev.replyToken, "歡迎加入 WAFERLOCK 維夫拉克 🔒\n請點下方選單「LINE綁定」連結帳戶，即可查詢保固與報修。", AI_SENDER);
      }
    } catch (e) {
      console.error("event error", e);
    }
  }
  return new Response("ok"); // LINE 需要 200
});
