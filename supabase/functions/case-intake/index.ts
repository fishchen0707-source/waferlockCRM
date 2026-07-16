// ==============================================
// case-intake — 外部管道進件 API（網頁諮詢單／Gmail GAS／未來其他來源）
// 骨架比照 voicebot-tools 的 create_repair：next_case_no/next_wf_id RPC 取號、
// 地址為客編唯一鍵、查無自動建「待整理」客戶；另比照 LINE webhook 慣例，
// 進件同步用 append_conversation_message RPC 落一則 conversations，客服收件匣可見。
//
// 部署：Supabase Edge Function「case-intake」（Verify JWT 關閉——外部呼叫者沒有 anon key 概念，
//       改用自訂 API Key 驗證）。
// 需要密鑰（Supabase → Edge Functions → Secrets）：
//   INTAKE_API_KEY   主金鑰（GAS／後端用）：兩種 kind 都可建
//   INTAKE_FORM_KEY  表單金鑰（網頁諮詢單用）：只允許 install_inquiry——
//                    前端金鑰必然公開，權限收窄後外洩頂多被灌諮詢單，不能建客訴
// 請求：POST，header `x-intake-key: <金鑰>`，body：
//   { kind:'install_inquiry'|'complaint', name, content,          ← 必填
//     phone?, address?, email?, subject?, source?('web'|'email'|...) }
// 回應：{ ok, kind, case_no, wf_id, is_new_customer } 或 { ok:false, error }
// ==============================================
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const API_KEY = Deno.env.get("INTAKE_API_KEY") || "";
const FORM_KEY = Deno.env.get("INTAKE_FORM_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-intake-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const digits = (s: string) => (s || "").replace(/\D/g, "");
const pad = (n: number) => String(n).padStart(2, "0");
function nowTW() { // Asia/Taipei 當地時間（today/hhmm/ts 三種格式）
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return {
    today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hhmm: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    ts: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function dbGet(path: string): Promise<Response> {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}
function dbPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function dbPatch(path: string, body: unknown): Promise<Response> {
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await dbPost(`rpc/${name}`, args);
  if (!r.ok) { console.log(`[rpc ${name} 失敗]`, r.status, (await r.text()).slice(0, 200)); return null; }
  const t = await r.text();
  try { return t ? JSON.parse(t) : true; } catch { return true; }
}

// 找客戶（地址為客編唯一鍵）；查無或無地址 → 發客編建「待整理」客戶。回 {wfId, isNew}
async function findOrCreateCustomer(p: {
  name: string; phone: string; address: string; email: string; source: string;
  caseNo: string; caseField: "repair_ids" | "complaint_ids" | null;
}): Promise<{ wfId: string | null; isNew: boolean }> {
  const { today } = nowTW();
  if (p.address) {
    const r = await dbGet(`customers?address=eq.${encodeURIComponent(p.address)}&select=wf_id,repair_ids,complaint_ids`);
    const rows = r.ok ? await r.json() : [];
    if (Array.isArray(rows) && rows[0]) {
      const wfId = rows[0].wf_id;
      if (p.caseField) { // 把案號掛回客戶的案件清單（維修/客訴；安裝單靠 wf_id 關聯不用掛）
        const ids = (rows[0][p.caseField] || []).concat([p.caseNo]);
        await dbPatch(`customers?wf_id=eq.${encodeURIComponent(wfId)}`, { [p.caseField]: ids });
      }
      return { wfId, isNew: false };
    }
  }
  const wfId = (await rpc("next_wf_id", {})) as string | null;
  if (!wfId) return { wfId: null, isNew: false };
  await dbPost("customers", {
    wf_id: wfId, name: p.name, phone: p.phone, address: p.address, email: p.email || null,
    reg_type: p.source === "email" ? "email_intake" : "web_intake",
    reg_date: today, tags: ["待整理"],
    repair_ids: p.caseField === "repair_ids" ? [p.caseNo] : [],
    complaint_ids: p.caseField === "complaint_ids" ? [p.caseNo] : [],
  });
  return { wfId, isNew: true };
}

// 進件同步落一則 conversations（原子 RPC），客服收件匣可見、同寄件者聚合同一對話
async function appendConv(p: {
  source: string; name: string; phone: string; email: string; wfId: string | null; text: string;
}) {
  const { hhmm, ts } = nowTW();
  const convId = p.source === "email"
    ? `email_${(p.email || "unknown").toLowerCase()}`
    : `web_${digits(p.phone) || Date.now()}`;
  await rpc("append_conversation_message", {
    p_id: convId,
    p_msg: { id: "u" + Date.now(), from: "user", text: p.text, time: hhmm, ts },
    p_last_msg: p.text.slice(0, 120),
    p_last_time: hhmm,
    p_wf_id: p.wfId,
    p_name: p.name + (p.source === "email" ? "（Email）" : "（網頁）"),
    p_platform: p.source === "email" ? "email" : "web",
    p_av: p.name ? p.name[0] : "✉",
    p_unread_delta: 1,
  });
}

Deno.serve(async (req) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  // ── API Key 驗證：主金鑰全能；表單金鑰只能建諮詢單 ──
  const key = req.headers.get("x-intake-key") || "";
  if (!API_KEY && !FORM_KEY) return json({ ok: false, error: "服務未設定金鑰" }, 500);
  const isMaster = !!API_KEY && key === API_KEY;
  const isForm = !!FORM_KEY && key === FORM_KEY;
  if (!isMaster && !isForm) return json({ ok: false, error: "invalid api key" }, 401);

  try {
    const b = await req.json();
    const kind = String(b.kind || "");
    const name = String(b.name || "").trim();
    const content = String(b.content || "").trim();
    const phone = digits(String(b.phone || ""));
    const address = String(b.address || "").trim();
    const email = String(b.email || "").trim();
    const subject = String(b.subject || "").trim();
    const source = String(b.source || (kind === "complaint" ? "email" : "web")).trim();

    if (!name || !content) return json({ ok: false, error: "name 與 content 為必填" }, 400);
    if (kind !== "install_inquiry" && kind !== "complaint") return json({ ok: false, error: "kind 需為 install_inquiry 或 complaint" }, 400);
    if (isForm && kind !== "install_inquiry") return json({ ok: false, error: "此金鑰僅允許 install_inquiry" }, 403);

    const { today, ts } = nowTW();

    if (kind === "install_inquiry") {
      // ── 網頁新裝機諮詢 → 安裝單（pending，落 CRM 案件池未處理區）──
      const id = "IW" + Date.now();
      const cust = await findOrCreateCustomer({ name, phone, address, email, source, caseNo: id, caseField: null });
      if (!cust.wfId) return json({ ok: false, error: "發客編失敗" }, 502);
      const ir = await dbPost("installs", {
        id, wf_id: cust.wfId, name, phone, address, channel: "web",
        product_id: b.product_id || null, serial_no: null,
        status: "pending", created_date: today, created_ts: Date.now(),
        note: (subject ? subject + "\n" : "") + content,
        history: [{ by: source === "email" ? "Email進件" : "網頁諮詢單", ts: Date.now(), action: "外部進件：新裝機諮詢" }],
      });
      if (!ir.ok) { console.log("[installs 失敗]", ir.status, (await ir.text()).slice(0, 300)); return json({ ok: false, error: "建立安裝單失敗" }, 502); }
      await appendConv({ source, name, phone, email, wfId: cust.wfId, text: `🏠 新裝機諮詢｜${content}` });
      return json({ ok: true, kind, case_no: id, wf_id: cust.wfId, is_new_customer: cust.isNew });
    }

    // ── Email 進件 → 客訴單（pending，客服審過再轉工單）──
    const caseNo = (await rpc("next_case_no", { p_prefix: "C" })) as string | null;
    if (!caseNo) return json({ ok: false, error: "取號失敗" }, 502);
    const cust = await findOrCreateCustomer({ name, phone, address, email, source, caseNo, caseField: "complaint_ids" });
    if (!cust.wfId) return json({ ok: false, error: "發客編失敗" }, 502);
    const process = (subject ? `【${subject}】` : "") + content + (email ? `\n（寄件者：${email}）` : "");
    const cr = await dbPost("complaints", {
      id: caseNo, wf_id: cust.wfId, name, phone,
      date: today, created_at: ts, created_by: source === "email" ? "Email進件" : "外部進件",
      call_channel: "email", department: "客服課",
      cat1: "", cat2: "", cat3: "",
      process, status: "pending", closed_date: null,
      timeline: [{ ts, note: "外部進件建立客訴單" + (subject ? `：${subject}` : "") }],
    });
    if (!cr.ok) { console.log("[complaints 失敗]", cr.status, (await cr.text()).slice(0, 300)); return json({ ok: false, error: "建立客訴單失敗" }, 502); }
    await appendConv({ source, name, phone, email, wfId: cust.wfId, text: `✉️ ${subject || "Email 進件"}｜${content.slice(0, 300)}` });
    return json({ ok: true, kind, case_no: caseNo, wf_id: cust.wfId, is_new_customer: cust.isNew });
  } catch (e) {
    console.log("[case-intake 例外]", String(e));
    return json({ ok: false, error: String(e) }, 500);
  }
});
