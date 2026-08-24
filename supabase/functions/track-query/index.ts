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
//   前端用 liff.getAccessToken() 取得 LINE access token → 本函式在**伺服器端**
//   先向 https://api.line.me/oauth2/v2.1/verify 確認這張 token 發給我們這個 channel，
//   再用它向 https://api.line.me/v2/profile 換回 userId。
//   **絕不信任前端傳來的 userId 或客編**——那等於沒有驗證。
//   （原本用 ID token，但那份憑證 LIFF SDK 不會續期，客戶隔一小時再開就過期。）
//
// 回傳前一律做欄位白名單過濾：地址遮蔽到行政區，不含金額、統編、他人資料。
//
// 部署：Supabase Edge Function「track-query」（Verify JWT 關閉，身分由 LIFF access token 驗證）
// 需要密鑰（Supabase → Edge Functions → Secrets）：
//   LINE_LOGIN_CHANNEL_ID   LIFF ID 的前半段（例：2010432600-XRCwdf5J → 2010432600）
//
// 請求：POST { accessToken }
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

// 伺服器端驗證 LINE 身分，回傳 { sub, expired }。sub 為 LINE userId。
//
// 為什麼用 access token 而不是 ID token：
//   ID token 是登入當下簽發的靜態憑證，LIFF SDK **不會**幫它續期，
//   客戶隔一小時再開頁就必然拿到過期的 token（實測 log：IdToken expired）。
//   改用 access token，SDK 會自動保持有效，不必每次開頁都跳一次登入。
//
// 安全性不變，甚至更嚴謹——userId 是拿 token 去跟 LINE 換回來的，
// 不是前端自己宣稱的；且先驗過 client_id 確認這張 token 是發給我們這個 channel。
async function verifyLineUser(accessToken: string): Promise<{ sub: string | null; expired: boolean }> {
  // 1) 這張 token 是不是發給我們這個 channel
  const vr = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!vr.ok) {
    const detail = (await vr.text()).slice(0, 300);
    console.log("[LINE token 驗證失敗]", vr.status, detail);
    // 區分「過期」與「設定錯誤」：前者前端重登一次可自救，後者重整一萬次也沒用
    return { sub: null, expired: /expire/i.test(detail) };
  }
  const v = await vr.json();
  if (String(v.client_id) !== CHANNEL_ID) {
    console.log("[LINE client_id 不符] token=", v.client_id, " 設定=", CHANNEL_ID);
    return { sub: null, expired: false };
  }

  // 2) 向 LINE 換取 userId。絕不採信前端傳來的 userId。
  const pr = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!pr.ok) {
    console.log("[LINE profile 取得失敗]", pr.status, (await pr.text()).slice(0, 200));
    return { sub: null, expired: false };
  }
  const p = await pr.json();
  return { sub: p.userId ? String(p.userId) : null, expired: false };
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

// 安裝旅程六段。
//
// 這頁是給末端消費者看的，而消費者不會收到包裹——鎖是寄到鎖店（師傅）那裡，
// 師傅再帶去客戶家安裝。所以進度條講的是「我的鎖什麼時候裝好」，不是物流軌跡；
// 託運單號對消費者不但沒用，還會讓他以為東西寄錯地方（見下方 customer_type 分流）。
//
// 每一格都對得上真實欄位，沒有永遠不會亮的燈：
//   已下單     安裝單存在
//   備貨中     shipment_no（ERP 已出貨到師傅端）
//   委派師傅中  worker_id（客服指派並排定時段）
//   師傅接單    accepted_at（師傅端按下接單，sql/supabase_installs_accept.sql 新增）
//   安裝完成    status installed（師傅施工完）
//   驗收完成    status done（客服驗收、保固生效）
//
// 刻意不做「師傅到場」圓點——arrived 有資料，但改以第 4 格的補充文字呈現，
// 六格已經是手機寬度的極限。
function fmtSlot(ins: Record<string, any>): string | null {
  if (!ins.sched_date) return null;
  const start = Number(ins.sched_start ?? 9);
  const span = Number(ins.sched_span ?? 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ins.sched_date} ${pad(start)}:00–${pad(start + span)}:00`;
}

function buildStages(ins: Record<string, any>) {
  const st = String(ins.status || "");
  return [
    { key: "created", label: "已下單", done: true, at: ins.created_date || null },
    { key: "stock", label: "備貨中", done: !!ins.shipment_no, at: ins.shipped_date || null },
    { key: "assign", label: "委派師傅中", done: !!ins.worker_id, at: null },
    // at 刻意留空：預約時段另外用醒目的區塊呈現，塞進圓點標籤底下會把那一格撐高一倍
    { key: "accept", label: "師傅接單", done: !!ins.accepted_at, at: null },
    { key: "installed", label: "安裝完成", done: st === "installed" || st === "done", at: null },
    { key: "verified", label: "驗收完成", done: st === "done", at: ins.completed_date || null },
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
    const accessToken = String(b.accessToken || "");
    if (!accessToken) return json({ ok: false, error: "缺少 accessToken" }, 401);

    const v = await verifyLineUser(accessToken);
    if (!v.sub) {
      return json({
        ok: false,
        expired: v.expired,
        error: v.expired ? "登入已逾時，請重新載入" : "身分驗證失敗",
      }, 401);
    }
    const lineUserId = v.sub;

    // 客編一律從 LINE 換回來的 userId 反推，不接受前端傳入
    const bind = await rows(`line_users?line_user_id=eq.${encodeURIComponent(lineUserId)}&select=wf_id`);
    const wfId = bind[0]?.wf_id as string | undefined;
    if (!wfId) return json({ ok: true, bound: false });

    const custs = await rows(`customers?wf_id=eq.${encodeURIComponent(wfId)}&select=name,customer_type`);
    const cust = custs[0] || {};
    const customerType = (cust.customer_type as string) || "consumer";

    // 託運單號只給經銷商（鎖店）——他們才是實際收貨人，單號對他們有用。
    // 末端消費者收不到包裹，給他單號只會造成「東西怎麼寄到別人那裡」的誤會。
    // 這個分流刻意做在後端：consumer 的回應裡連 tracking_no 欄位都不存在，
    // 而不是送到前端再用 CSS 藏起來——藏起來的資料仍然外流。
    const isDealer = customerType === "dealer";

    const q = encodeURIComponent(wfId);
    const [installs, shipments, workers] = await Promise.all([
      rows(`installs?wf_id=eq.${q}&select=id,created_date,status,shipment_no,shipped_date,sched_date,sched_start,sched_span,worker_id,accepted_at,completed_date,warranty_end,address,product_id,qty&order=created_date.desc&limit=100`),
      isDealer
        ? rows(`shipments?wf_id=eq.${q}&select=carrier,tracking_no,ship_date,install_id,pieces&order=ship_date.desc&limit=200`)
        : Promise.resolve([]),
      rows(`workers?select=id,name&limit=500`),
    ]);

    const workerName = new Map<string, string>();
    for (const w of workers) workerName.set(String(w.id), String(w.name || ""));

    const shipByInstall = new Map<string, Record<string, any>>();
    for (const s of shipments) if (s.install_id) shipByInstall.set(String(s.install_id), s);

    const orders = installs.map((ins: Record<string, any>) => {
      const sp = isDealer ? shipByInstall.get(String(ins.id)) : undefined;
      const cr = sp ? CARRIERS[String(sp.carrier)] : undefined;
      return {
        id: ins.id,
        createdDate: ins.created_date,
        address: maskAddress(String(ins.address || "")),
        productId: ins.product_id || null,
        qty: ins.qty || null,
        // 客戶最想知道的一件事：師傅哪天來。接單後才給——沒接單的預約時間不算數。
        slot: ins.accepted_at ? fmtSlot(ins) : null,
        worker: ins.accepted_at ? (workerName.get(String(ins.worker_id)) || null) : null,
        arrived: ins.status === "arrived",
        failed: ins.status === "failed",
        warrantyEnd: ins.status === "done" ? (ins.warranty_end || null) : null,
        stages: buildStages(ins),
        tracking: sp
          ? { carrier: cr?.label || sp.carrier, trackingNo: sp.tracking_no, queryUrl: cr?.url || null, shipDate: sp.ship_date }
          : null,
      };
    });

    // 沒掛到安裝單的託運單（經銷商叫貨，本來就沒有安裝流程）另外列，避免資料憑空消失
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
