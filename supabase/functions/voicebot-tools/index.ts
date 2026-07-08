// ==============================================
// voicebot-tools — AI 語音客服的工具執行端（function calling 落地）
// 前端把 Gemini 的 toolCall 轉發到這裡，這裡查 Supabase 真實資料後回結果，AI 再依結果回答。
// 確定性邏輯（查表、狀態碼轉中文）由這支普通程式處理，不交給模型。
//
// 部署：Supabase Edge Function「voicebot-tools」（Verify JWT 開啟，前端帶 anon key）
// 用到平台自動注入的 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// 請求：POST { name:"get_case_status", args:{ phone:"0911111111" } }
// 回應：該工具的結果物件（AI 會讀這個 JSON）
// ==============================================
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 工單狀態碼 → 給客戶聽的中文
const STATUS_ZH: Record<string, string> = {
  pending: "待安排", dispatched: "已派工給師傅", scheduled: "已排定時間",
  arrived: "師傅已到場", working: "施工中", done: "已完工", completed: "已完工",
  closed: "已結案", cancelled: "已取消",
};

function db(path: string): Promise<Response> {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}
const digits = (s: string) => (s || "").replace(/\D/g, "");

// 用電話查客戶目前的維修工單進度（只回進度相關欄位，不回完整地址以保護隱私）
async function getCaseStatus(args: { phone?: string }) {
  const phone = digits(args.phone || "");
  if (!phone) return { found: false, message: "沒有提供電話號碼" };
  const r = await db(`repairs?or=(phone.eq.${phone},contact_phone.eq.${phone})&select=id,type,status,scheduled_date,date,worker_id&order=date.desc`);
  if (!r.ok) return { found: false, message: "查詢失敗，請稍後再試" };
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return { found: false, message: "查無這支電話的維修工單" };
  }
  const c = rows[0];
  return {
    found: true,
    case_no: c.id,
    product: c.type || "門鎖",
    status: STATUS_ZH[c.status] || c.status,
    scheduled: c.scheduled_date || "尚未排定時間",
    has_worker: !!c.worker_id,
    total_cases: rows.length,
  };
}

// POST helper（rpc / insert 用）
function dbPost(path: string, body: unknown, prefer?: string): Promise<Response> {
  const h: Record<string, string> = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
  if (prefer) h.Prefer = prefer;
  return fetch(`${SUPA_URL}/rest/v1/${path}`, { method: "POST", headers: h, body: JSON.stringify(body) });
}
async function rpc(name: string, args: Record<string, unknown>): Promise<string | null> {
  const r = await dbPost(`rpc/${name}`, args);
  return r.ok ? await r.json() : null;
}

// 口頭報修 → 建維修工單（掛正確客編：地址為唯一鍵，既有客戶沿用、新客戶發客編建檔）
async function createRepair(args: { name?: string; phone?: string; address?: string; issue?: string; product?: string }) {
  const name = (args.name || "").trim();
  const phone = digits(args.phone || "");
  const address = (args.address || "").trim();
  const issue = (args.issue || "").trim();
  const product = (args.product || "門鎖").trim();
  if (!name || !address || !issue) return { ok: false, message: "還缺必要資訊：需要姓名、地址、和要報修的問題" };

  const caseNo = await rpc("next_case_no", { p_prefix: "R" });
  if (!caseNo) return { ok: false, message: "系統取號失敗，請稍後再試" };
  const today = new Date().toISOString().slice(0, 10);
  const createdAt = today + " AI語音報修";

  // 依地址找既有客戶（客編唯一鍵＝地址）
  const cr = await db(`customers?address=eq.${encodeURIComponent(address)}&select=wf_id,repair_ids`);
  const custs = cr.ok ? await cr.json() : [];
  let wfId: string | null, isNew = false;
  if (Array.isArray(custs) && custs[0]) {
    wfId = custs[0].wf_id;
    const ids = (custs[0].repair_ids || []).concat([caseNo]);
    await fetch(`${SUPA_URL}/rest/v1/customers?wf_id=eq.${wfId}`, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repair_ids: ids }),
    });
  } else {
    wfId = await rpc("next_wf_id", {});
    if (!wfId) return { ok: false, message: "系統發客編失敗，請稍後再試" };
    isNew = true;
    await dbPost("customers", { wf_id: wfId, name, phone, address, reg_type: "ai_voice", reg_date: today, tags: ["待整理"], repair_ids: [caseNo], complaint_ids: [] });
  }
  // 建維修單
  const ir = await dbPost("repairs", {
    id: caseNo, wf_id: wfId, name, phone, building: address, date: today, type: product,
    issue, status: "pending", urgency: "normal", contact_name: name, contact_phone: phone,
    created_by: "AI語音客服", created_at: createdAt, sla_level: "normal", warranty_in: false,
  });
  if (!ir.ok) return { ok: false, message: "建立工單失敗，建議改由專員處理" };
  return { ok: true, case_no: caseNo, is_new_customer: isNew };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const { name, args } = await req.json();
    let result: unknown;
    switch (name) {
      case "get_case_status":
        result = await getCaseStatus(args || {});
        break;
      case "create_repair":
        result = await createRepair(args || {});
        break;
      default:
        return json({ error: "未知的工具：" + name }, 400);
    }
    return json(result);
  } catch (e) {
    console.log("[voicebot-tools 例外]", String(e));
    return json({ error: String(e) }, 500);
  }
});
