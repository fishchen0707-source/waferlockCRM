/**
 * ============================================================
 * WAFERLOCK — Gmail 進件 GAS 範例（Email → CRM 客訴單）
 * ============================================================
 * 用途：定時掃描 Gmail 中「客服進件」標籤的未讀信 → 呼叫 case-intake Edge Function
 *       建立客訴單（pending，客服審過再用 CRM「轉工單」機制轉正）→ 處理完移除未讀＋貼「已進件」標籤。
 *
 * ── 一次性設定（在 Apps Script 編輯器操作）──────────────────
 * 1. 專案設定 → 指令碼屬性（Script Properties）新增：
 *      INTAKE_API_KEY = <Supabase Secret 的主金鑰值>   （勿硬編碼在程式中）
 *    （可選）INTAKE_URL = https://<你的專案>.supabase.co/functions/v1/case-intake
 *            未設定則用下方 DEFAULT_INTAKE_URL。
 * 2. Gmail 建立兩個標籤：「客服進件」（收進件的來信貼這個，可用 Gmail 篩選器自動貼）、
 *    「已進件」（本程式處理完會自動貼）。
 * 3. 觸發條件：本專案「觸發器由人工在 Apps Script 後台管理」。
 *    請手動新增「時間驅動」觸發器：函式 pollEmailIntake、每 5～15 分鐘一次。
 *    （本檔不自動建立觸發器，符合專案規範。）
 *
 * 注意：執行環境為 Google V8，僅能用 GAS 內建服務（UrlFetchApp / GmailApp / PropertiesService），
 *       不可用 fetch/axios/Node 模組；時間一律 Asia/Taipei。
 * ============================================================
 */

var DEFAULT_INTAKE_URL = 'https://nkyanyjgfrmovjoqevro.supabase.co/functions/v1/case-intake';
var INTAKE_LABEL = '客服進件'; // 收進件來信的標籤（可用 Gmail 篩選器自動貼）
var DONE_LABEL = '已進件';     // 處理完成後貼的標籤
var MAX_THREADS = 20;          // 單次最多處理的信件串，避免逾時
var BODY_LIMIT = 1500;         // 內文擷取上限（字元）

/**
 * 主函式：掛在「時間驅動」觸發器上。
 * 掃「客服進件」標籤的未讀信 → 逐封建客訴單 → 成功則移除未讀＋貼「已進件」。
 */
function pollEmailIntake() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('INTAKE_API_KEY');
  if (!apiKey) {
    Logger.log('❌ 未設定指令碼屬性 INTAKE_API_KEY，請先於「專案設定 → 指令碼屬性」新增。');
    return;
  }
  var intakeUrl = PropertiesService.getScriptProperties().getProperty('INTAKE_URL') || DEFAULT_INTAKE_URL;

  var doneLabel = getOrCreateLabel(DONE_LABEL);
  var query = 'is:unread label:' + INTAKE_LABEL;
  var threads = GmailApp.search(query, 0, MAX_THREADS);
  if (!threads.length) { Logger.log('本次無待進件信件。'); return; }

  var ok = 0, fail = 0, skip = 0;
  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var msgs = thread.getMessages();
    // 只處理該信件串中「未讀」的訊息（一封信通常一則；回覆串取未讀那些）
    for (var j = 0; j < msgs.length; j++) {
      var msg = msgs[j];
      if (!msg.isUnread()) continue;

      var from = parseFrom(msg.getFrom());      // {name, email}
      var subject = (msg.getSubject() || '').trim();
      var body = extractPlainBody(msg.getPlainBody());

      if (!from.email || !body) { // 缺關鍵資訊 → 標記已讀避免重複卡住，但不建單
        msg.markRead();
        skip++;
        Logger.log('⚠️ 跳過（缺寄件者信箱或內文）：' + subject);
        continue;
      }

      var payload = {
        kind: 'complaint',
        source: 'email',
        name: from.name || from.email,
        email: from.email,
        subject: subject,
        content: body
      };

      var res = postIntake(intakeUrl, apiKey, payload);
      if (res.ok) {
        msg.markRead();
        ok++;
        Logger.log('✅ 已建客訴單 ' + res.case_no + '（' + from.email + '）');
      } else {
        fail++;
        Logger.log('❌ 進件失敗（' + from.email + '）：' + res.error + '｜HTTP ' + res.status);
        // 失敗不移除未讀 → 下次觸發會重試（顯性失敗，不靜默吞掉）
      }
    }
    // 整串處理完（該串已無未讀）才貼「已進件」標籤
    if (thread.isUnread() === false) thread.addLabel(doneLabel);
  }
  Logger.log('進件完成：成功 ' + ok + '、失敗 ' + fail + '、跳過 ' + skip);
}

/** 呼叫 case-intake API。回 {ok, case_no?, status, error?} */
function postIntake(url, apiKey, payload) {
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-intake-key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var data = {};
    try { data = JSON.parse(resp.getContentText()); } catch (e) { data = {}; }
    if (code >= 200 && code < 300 && data.ok) {
      return { ok: true, case_no: data.case_no, status: code };
    }
    return { ok: false, status: code, error: (data && data.error) || '未知錯誤' };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

/** 從「顯示名 <email@x.com>」解析出 {name, email} */
function parseFrom(raw) {
  raw = raw || '';
  var m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || '').trim(), email: (m[2] || '').trim().toLowerCase() };
  var em = raw.match(/[^\s<>]+@[^\s<>]+/);
  return { name: '', email: em ? em[0].toLowerCase() : '' };
}

/** 擷取純文字內文：去簽名/引用雜訊、壓縮空白、截斷長度 */
function extractPlainBody(body) {
  body = (body || '').replace(/\r/g, '');
  // 砍掉常見的引用回覆分隔（原信引用往下都不要）
  var cut = body.split(/\n>{1,}|\n-{2,}原始郵件|\nOn .* wrote:|\n寄件者：/)[0];
  cut = cut.replace(/\n{3,}/g, '\n\n').trim();
  if (cut.length > BODY_LIMIT) cut = cut.slice(0, BODY_LIMIT) + '…';
  return cut;
}

/** 取得或建立 Gmail 標籤 */
function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
