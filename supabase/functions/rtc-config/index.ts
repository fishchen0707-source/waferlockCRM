// ==============================================
// rtc-config — 回 WebRTC 用的 ICE servers（STUN + Cloudflare TURN 時效憑證）
// 部署：Supabase Edge Function「rtc-config」（Verify JWT 可維持開啟，前端帶 anon key 呼叫）
// 需要密鑰（Supabase → Edge Functions → Secrets）：
//   CF_TURN_KEY_ID        （Cloudflare Realtime 的 Turn Token ID）
//   CF_TURN_API_TOKEN     （Cloudflare Realtime 的 API Token）
// 沒設密鑰時只回 STUN（同 NAT/區網可通，跨網路需 TURN）。
// 呼叫方式（前端）：
//   fetch('<proj>.supabase.co/functions/v1/rtc-config', { headers:{ apikey, Authorization:'Bearer '+anon } })
//   或 sb.functions.invoke('rtc-config')
// ==============================================
const CF_KEY_ID = Deno.env.get("CF_TURN_KEY_ID") || "";
const CF_TOKEN = Deno.env.get("CF_TURN_API_TOKEN") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// 用 key id + token 換 Cloudflare 的時效 TURN 憑證。
// 現行端點 generate-ice-servers 回 { iceServers: [{stun},{turn,username,credential}] }（陣列）。
async function cloudflareTurn(): Promise<unknown[] | null> {
  if (!CF_KEY_ID || !CF_TOKEN) return null;
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
      },
    );
    if (!r.ok) {
      console.log(`[CF TURN 失敗] HTTP ${r.status} keyId長度=${CF_KEY_ID.length}：${(await r.text()).slice(0, 200)}`);
      return null;
    }
    const d = await r.json();
    const s = d.iceServers;
    return Array.isArray(s) ? s : (s ? [s] : null); // 統一成陣列
  } catch (e) {
    console.log("[CF TURN 例外]", String(e));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const iceServers: unknown[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const cf = await cloudflareTurn();
  if (cf) iceServers.unshift(...cf); // 攤平放最前面（優先用 Cloudflare STUN/TURN）
  return new Response(JSON.stringify({ iceServers }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
