// ==============================================
// shipment-intake — 貨運託運單 PDF 收檔 API（Google Drive → GAS → 本函式）
// 骨架比照 case-intake：x-intake-key 驗證、service role 直打 REST、顯性錯誤回應。
//
// 本函式「不解析 PDF」。解析用 PyMuPDF（Python），Deno 端沒有對應品，
// 因此這裡只做三件事：去重 → 原檔存 Storage → 排進 shipment_files 佇列。
// 實際解析與配對由 shipment-worker/main.py 輪詢處理。
//
// 部署：Supabase Edge Function「shipment-intake」（Verify JWT 關閉——
//       呼叫端是 GAS，沒有 anon key 概念，改用自訂 API Key 驗證）。
// 需要密鑰（Supabase → Edge Functions → Secrets）：
//   SHIPMENT_INTAKE_KEY  本條線專屬金鑰
//
// 為什麼不共用 case-intake 的 INTAKE_API_KEY：
//   那是主金鑰，持有者可以建客訴單與安裝單。取檔 GAS 只需要送貨運單 PDF，
//   給它主金鑰等於過度授權。比照 case-intake 另開 INTAKE_FORM_KEY 收窄網頁表單權限的做法，
//   這裡也用獨立金鑰，外洩時的影響面僅限於灌假的託運單 PDF。
// 前置：先在 SQL Editor 執行 sql/supabase_shipments.sql（建表與 shipment-docs bucket）
//
// 請求：POST，header `x-intake-key: <金鑰>`，body：
//   { file_id, file_name, content_b64 }        ← 皆必填
// 回應：{ ok:true, file_id, skipped?:true } 或 { ok:false, error }
// ==============================================
const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const API_KEY = Deno.env.get("SHIPMENT_INTAKE_KEY") || "";

const BUCKET = "shipment-docs";
const MAX_BYTES = 8 * 1024 * 1024; // 單檔上限 8MB；實務上託運清單約 0.2～1MB

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-intake-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const pad = (n: number) => String(n).padStart(2, "0");
function nowTW() { // Asia/Taipei 當地時間
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return {
    today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    stamp: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
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

// 原檔上傳到 private bucket，保留稽核軌跡（解析錯了要能回頭看原始 PDF）
async function uploadPdf(path: string, bytes: Uint8Array): Promise<boolean> {
  const r = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!r.ok) console.log("[storage 上傳失敗]", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 檔名可能含中文與空白，不能直接當 Storage 路徑
function safeName(name: string): string {
  return (name || "unnamed.pdf").replace(/[^\w.\-]+/g, "_").slice(-80);
}

Deno.serve(async (req) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const key = req.headers.get("x-intake-key") || "";
  if (!API_KEY) return json({ ok: false, error: "服務未設定金鑰" }, 500);
  if (key !== API_KEY) return json({ ok: false, error: "invalid api key" }, 401);

  try {
    const b = await req.json();
    const fileId = String(b.file_id || "").trim();
    const fileName = String(b.file_name || "").trim();
    const b64 = String(b.content_b64 || "");

    if (!fileId || !b64) return json({ ok: false, error: "file_id 與 content_b64 為必填" }, 400);

    // ── 去重：同一份 Drive 檔案重送直接跳過，不重複建佇列 ──
    const dup = await dbGet(`shipment_files?id=eq.${encodeURIComponent(fileId)}&select=id,status`);
    const dupRows = dup.ok ? await dup.json() : [];
    if (Array.isArray(dupRows) && dupRows[0]) {
      return json({ ok: true, skipped: true, file_id: fileId, status: dupRows[0].status });
    }

    const bytes = b64ToBytes(b64);
    if (bytes.length > MAX_BYTES) {
      return json({ ok: false, error: `檔案過大（${bytes.length} bytes，上限 ${MAX_BYTES}）` }, 413);
    }

    const { today, stamp } = nowTW();
    const path = `${today}/${stamp}_${safeName(fileName)}`;
    if (!(await uploadPdf(path, bytes))) {
      return json({ ok: false, error: "原檔上傳 Storage 失敗" }, 502);
    }

    const ins = await dbPost("shipment_files", {
      id: fileId,
      file_name: fileName,
      storage_path: path,
      status: "pending",
    });
    if (!ins.ok) {
      console.log("[shipment_files 失敗]", ins.status, (await ins.text()).slice(0, 300));
      return json({ ok: false, error: "建立待解析記錄失敗" }, 502);
    }

    return json({ ok: true, file_id: fileId, storage_path: path });
  } catch (e) {
    console.log("[shipment-intake 例外]", String(e));
    return json({ ok: false, error: String(e) }, 500);
  }
});
