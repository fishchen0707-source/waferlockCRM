// ==============================================
// Meta Webhook — 收 Facebook Messenger / Instagram DM 訊息進客服收件匣
// 部署：Supabase Edge Function「meta-webhook」，關閉 Verify JWT
// 需要的密鑰（Supabase → Edge Functions → Secrets）：
//   META_APP_SECRET         （Meta App 基本資料頁的 App Secret）
//   META_PAGE_ACCESS_TOKEN  （Messenger 設定頁的 Page Access Token）
//   META_VERIFY_TOKEN       （自訂驗證字串，填在 Meta 後台 Webhook 的「驗證權杖」）
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入
// Meta 後台 Webhook 回呼網址：
//   https://<project-ref>.supabase.co/functions/v1/meta-webhook
// 訂閱欄位：messages, messaging_postbacks
// ==============================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_SECRET   = Deno.env.get("META_APP_SECRET")!;
const PAGE_TOKEN   = Deno.env.get("META_PAGE_ACCESS_TOKEN")!;
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN")!;

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

// 驗證 Meta 簽章：sha256=hex(HMAC-SHA256(appSecret, rawBody))
async function verifySignature(rawBody: string, signature: string | null) {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = signature.slice(7);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === expected;
}

// 取 FB 用戶名稱（沙盒期間只能拿到部分用戶資料）
async function getFbName(psid: string): Promise<string> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${psid}?fields=name&access_token=${PAGE_TOKEN}`
    );
    if (r.ok) return (await r.json()).name ?? "FB 用戶";
  } catch (_) { /* ignore */ }
  return "FB 用戶";
}

// 取 IG 用戶名稱
async function getIgName(igsid: string): Promise<string> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${igsid}?fields=name,username&access_token=${PAGE_TOKEN}`
    );
    if (r.ok) {
      const d = await r.json();
      return d.name ?? d.username ?? "IG 用戶";
    }
  } catch (_) { /* ignore */ }
  return "IG 用戶";
}

// 發送訊息回 Meta（FB Messenger 與 IG 共用同一端點）
async function sendMessage(recipientId: string, text: string) {
  await fetch("https://graph.facebook.com/v19.0/me/messages", {
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
}

async function handleMessaging(senderId: string, platform: "facebook" | "instagram", text: string, isNew_: boolean) {
  const convId = `${platform === "facebook" ? "fb" : "ig"}_${senderId}`;
  const displayName = platform === "facebook"
    ? await getFbName(senderId)
    : await getIgName(senderId);

  const msg = { id: "u" + Date.now(), from: "user", text, time: hhmm(), ts: fullTs() };

  // 僅用於判斷「是否為新對話／是否已被客服接手」，不參與寫入路徑
  const { data: existing } = await sb.from("conversations").select("id, agent_takeover").eq("id", convId).maybeSingle();
  const isNew = !existing;
  const takeover = !!existing?.agent_takeover;

  // 原子 append：多筆 messaging 事件交錯處理、或與 CRM 端同時寫入，也不會互相覆蓋
  const { error: appendErr } = await sb.rpc("append_conversation_message", {
    p_id: convId, p_msg: msg, p_last_msg: text, p_last_time: hhmm(),
    p_wf_id: null,
    p_name: isNew ? `${displayName}（${platform === "facebook" ? "FB" : "IG"}）` : displayName,
    p_platform: platform, p_av: displayName[0] ?? "?", p_unread_delta: 1,
    p_biz_inquiry: isNew ? false : null,
  });
  if (appendErr) { console.error("append_conversation_message failed", appendErr); throw appendErr; }

  // 首則自動回覆（未被客服接手時）
  if (isNew && !takeover) {
    await sendMessage(senderId, "您好，已收到您的訊息 🙏\n客服將盡快為您服務。");
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // GET：Meta Webhook 驗證握手
  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // POST：收訊息
  if (req.method === "POST") {
    const rawBody = await req.text();
    const ok = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"));
    if (!ok) return new Response("bad signature", { status: 401 });

    const payload = JSON.parse(rawBody);
    const platform: "facebook" | "instagram" =
      payload.object === "instagram" ? "instagram" : "facebook";

    for (const entry of payload.entry ?? []) {
      for (const ev of entry.messaging ?? []) {
        try {
          const senderId: string = ev.sender?.id;
          if (!senderId) continue;

          let text = "";
          if (ev.message) {
            if (ev.message.text) {
              text = ev.message.text;
            } else if (ev.message.attachments) {
              text = `（${ev.message.attachments[0]?.type ?? "附件"} 訊息）`;
            }
          } else if (ev.postback) {
            text = ev.postback.title ?? ev.postback.payload ?? "（按鈕點擊）";
          }

          if (text) await handleMessaging(senderId, platform, text, false);
        } catch (e) {
          console.error("event error", e);
        }
      }
    }
    return new Response("ok", { status: 200 }); // Meta 需要 200
  }

  return new Response("Method Not Allowed", { status: 405 });
});
