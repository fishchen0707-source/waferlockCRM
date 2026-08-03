// ==============================================
// track-query — 客戶自助訂單進度查詢 API（track.html 的唯一資料來源）
//
// ⚠ 這支是本專案第一個對外公開介面的安全邊界，改動前務必讀完這段。
//
// 為什麼不讓 track.html 直接查 Supabase：
//   專案現況是 anon key 硬編碼在前端、RLS 全開（見 CLAUDE.md 已知風險）。
//   後台自己人用還可接受，但客戶端頁面一旦公開，任何人檢視原始碼拿到 anon key
//   就能把整個 customers 表撈走。因此 track.html 一行資料庫查詢都不能有，
//   一律經本函式以 service role 取數。
//
// 身分怎麼確認：
//   前端用 liff.getIDToken() 取得 LINE ID Token → 本函式在**伺服器端**向
//   https://api.line.me/oauth2/v2.1/verify 驗證真偽並取出 sub（LINE userId）。
//   **絕不信任前端傳來的 userId 或客編**——那等於沒有驗證。
//
// 回傳前一律做欄位白名單過濾：地址遮蔽到行政區，不含金額、統編、他人資料。
//
// 部署：Supabase Edge Function「track-query」（Verify JWT 關閉，身分由 LIFF idToken 驗證）
// 需要密鑰（Supabase → Edge Functions → Secrets）：
//   LINE_LOGIN_CHANNEL_ID   LIFF ID 的前半段（例：2010432600-XRCwdf5J → 2010432600）
//
// 請求：POST { idToken }
// 回應：{ ok:true, bound:true, customerType, orders:[...] }
//       { ok:true, bound:false }        ← 尚未綁定，前端引導去 liff-bind.html
//       { ok:false, error }
// ==============================================
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CHANNEL_ID = Deno.env.get("LINE_LOGIN_CHANNEL_ID") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function dbGet(path: string): Promise<Response> {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}
async function rows(path: string): Promise<Record<string, unknown>[]> {
  const r = await dbGet(path);
  if (!r.ok) { console.log("[db 失敗]", path, r.status); return []; }
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

// 伺服器端驗證 LINE ID Token，回傳 LINE userId；驗不過一律 null
async function verifyIdToken(idToken: string): Promise<string | null> {
  const body = new URLSearchParams({ id_token: idToken, client_id: CHANNEL_ID });
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) { console.log("[LIFF 驗證失敗]", r.status, (await r.text()).slice(0, 200)); return null; }
  const data = await r.json();
  // aud 必須是我們自己的 channel，避免拿別的 channel 簽的 token 來換資料
  if (!data.sub || (data.aud && data.aud !== CHANNEL_ID)) return null;
  return String(data.sub);
}

// 地址只留到行政區，其餘遮蔽。客戶自己知道地址，頁面沒有必要把完整門牌再吐一次。
function maskAddress(addr: string): string {
  const s = String(addr || "").replace(/^\d{3,5}/, "");
  const m = s.match(/^(.{2,3}[市縣].{1,4}[區鄉鎮市])/);
  return m ? `${m[1]}***` : (s ? s.slice(0, 3) + "***" : "");
}

const CARRIERS: Record<string, { label: string; url: string }> = {
  hct: { label: "新竹物流", url: "https://www.hct.com.tw/Search/SearchGoods_Y.aspx" },
  kerry: { label: "嘉里大榮", url: "https://www.kerrytj.com/zh/search/trace.aspx" },
};

// 進度階段。刻意只有五段：本系統的「安裝完成」與「驗收」是同一個動作寫入
// （waferlock_crm.html 完工驗收同時寫 status='done' 與 verify），
// 硬拆成兩格會多出一盞永遠不會單獨亮的燈。
// 另外沒有「已送達」——沒有貨運公司 API 就不假裝知道貨到了沒。
function buildStages(ins: Record<string, any>, sp: Record<string, any> | undefined) {
  const shipped = !!(ins.shipment_no || ins.shipped_date);
  const handed = !!sp?.tracking_no;
  const booked = !!(ins.sched_date || ins.worker_id);
  const done = ins.status === "done";
  return [
    { key: "created", label: "訂單成立", done: true, at: ins.created_date || null },
    { key: "shipped", label: "已出貨", done: shipped, at: ins.shipped_date || null },
    { key: "handed", label: "已交運", done: handed, at: sp?.ship_date || null },
    { key: "booked", label: "預約安裝", done: booked, at: ins.sched_date || null },
    { key: "done", label: "完工驗收", done, at: ins.completed_date || null },
  ];
}

Deno.serve(async (req) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!CHANNEL_ID) return json({ ok: false, error: "服務未設定 LINE_LOGIN_CHANNEL_ID" }, 500);

  try {
    const b = await req.json();
    const idToken = String(b.idToken || "");
    if (!idToken) return json({ ok: false, error: "缺少 idToken" }, 401);

    const lineUserId = await verifyIdToken(idToken);
    if (!lineUserId) return json({ ok: false, error: "身分驗證失敗" }, 401);

    // 客編一律從已驗證的 idToken 反推，不接受前端傳入
    const bind = await rows(`line_users?line_user_id=eq.${encodeURIComponent(lineUserId)}&select=wf_id`);
    const wfId = bind[0]?.wf_id as string | undefined;
    if (!wfId) return json({ ok: true, bound: false });

    const custs = await rows(`customers?wf_id=eq.${encodeURIComponent(wfId)}&select=name,customer_type`);
    const cust = custs[0] || {};
    const customerType = (cust.customer_type as string) || "consumer";

    const q = encodeURIComponent(wfId);
    const [installs, shipments] = await Promise.all([
      rows(`installs?wf_id=eq.${q}&select=id,created_date,status,shipment_no,shipped_date,sched_date,worker_id,completed_date,address,product_id,qty&order=created_date.desc&limit=100`),
      rows(`shipments?wf_id=eq.${q}&select=carrier,tracking_no,ship_date,install_id,pieces&order=ship_date.desc&limit=200`),
    ]);

    const shipByInstall = new Map<string, Record<string, any>>();
    for (const s of shipments) if (s.install_id) shipByInstall.set(String(s.install_id), s);

    const orders = installs.map((ins: Record<string, any>) => {
      const sp = shipByInstall.get(String(ins.id));
      const cr = sp ? CARRIERS[String(sp.carrier)] : undefined;
      return {
        id: ins.id,
        createdDate: ins.created_date,
        address: maskAddress(String(ins.address || "")),
        productId: ins.product_id || null,
        qty: ins.qty || null,
        stages: buildStages(ins, sp),
        tracking: sp
          ? { carrier: cr?.label || sp.carrier, trackingNo: sp.tracking_no, queryUrl: cr?.url || null, shipDate: sp.ship_date }
          : null,
      };
    });

    // 沒掛到安裝單的託運單（例如經銷商叫貨，沒有安裝流程）另外列，避免資料憑空消失
    const looseShipments = shipments
      .filter((s: Record<string, any>) => !s.install_id)
      .map((s: Record<string, any>) => ({
        carrier: CARRIERS[String(s.carrier)]?.label || s.carrier,
        trackingNo: s.tracking_no,
        queryUrl: CARRIERS[String(s.carrier)]?.url || null,
        shipDate: s.ship_date,
        pieces: s.pieces,
      }));

    return json({ ok: true, bound: true, name: cust.name || null, customerType, orders, shipments: looseShipments });
  } catch (e) {
    console.log("[track-query 例外]", String(e));
    return json({ ok: false, error: String(e) }, 500);
  }
});
