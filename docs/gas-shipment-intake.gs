/**
 * ============================================================
 * WAFERLOCK — 貨運託運單取檔 GAS（Google Drive → CRM shipments）
 * ============================================================
 * 用途：定時掃描 Drive「貨運單」資料夾裡的新 PDF → 呼叫 shipment-intake Edge Function
 *       收檔排隊 → 處理完把檔案移到「已處理」子資料夾。
 *       實際的 PDF 解析與客戶配對由 shipment-worker/main.py 負責，本檔只管把檔案送過去。
 *
 * 為什麼用「移動到子資料夾」而不是比對檔名：
 *   檔名可能重複或被改，移動資料夾則是不可逆的狀態，人打開 Drive 也一眼看得出處理到哪。
 *   （對照 gas-email-intake.gs 用 Gmail 標籤達成同樣目的。）
 *
 * ── 一次性設定（在 Apps Script 編輯器操作）──────────────────
 * 1. 專案設定 → 指令碼屬性（Script Properties）新增：
 *      SHIPMENT_INTAKE_KEY = <與 Supabase Secret「SHIPMENT_INTAKE_KEY」同值>（勿硬編碼在程式中）
 *        這是貨運單專屬金鑰，不是 case-intake 的 INTAKE_API_KEY，也不是
 *        外部諮詢單.html 裡的 INTAKE_FORM_KEY——那兩把 shipment-intake 都不認。
 *      SHIPMENT_FOLDER_ID = <Drive「貨運單」資料夾 ID>
 *        取得方式：在瀏覽器打開該資料夾，網址 .../folders/<這一段就是 ID>
 *    （可選）SHIPMENT_INTAKE_URL = https://<你的專案>.supabase.co/functions/v1/shipment-intake
 *            未設定則用下方 DEFAULT_INTAKE_URL。
 * 2. Drive 資料夾權限：內含客戶姓名、電話、地址，屬個資。
 *    共用設定務必限定特定人員，**絕不可設為「知道連結的任何人」**。
 * 3. 觸發條件：本專案「觸發器由人工在 Apps Script 後台管理」。
 *    請手動新增「時間驅動」觸發器：函式 pollShipmentIntake、每 5 分鐘一次。
 *    （本檔不自動建立觸發器，符合專案規範。）
 *
 * 注意：執行環境為 Google V8，僅能用 GAS 內建服務（UrlFetchApp / DriveApp / PropertiesService），
 *       不可用 fetch/axios/Node 模組；時間一律 Asia/Taipei。
 * ============================================================
 */

var DEFAULT_INTAKE_URL = 'https://nkyanyjgfrmovjoqevro.supabase.co/functions/v1/shipment-intake';
var DONE_FOLDER = '已處理';   // 處理完成後移入的子資料夾（不存在會自動建立）
var MAX_FILES = 20;           // 單次最多處理的檔案數，避免 GAS 逾時
var MAX_BYTES = 8 * 1024 * 1024; // 與 Edge Function 的上限一致

/**
 * 主函式：掛在「時間驅動」觸發器上。
 * 掃資料夾內的 PDF → 逐份送出 → 成功才移到「已處理」。
 */
function pollShipmentIntake() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('SHIPMENT_INTAKE_KEY');
  if (!apiKey) {
    Logger.log('❌ 未設定指令碼屬性 SHIPMENT_INTAKE_KEY，請先於「專案設定 → 指令碼屬性」新增。');
    return;
  }
  var folderId = props.getProperty('SHIPMENT_FOLDER_ID');
  if (!folderId) {
    Logger.log('❌ 未設定指令碼屬性 SHIPMENT_FOLDER_ID（Drive「貨運單」資料夾 ID）。');
    return;
  }
  var intakeUrl = props.getProperty('SHIPMENT_INTAKE_URL') || DEFAULT_INTAKE_URL;

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    Logger.log('❌ 找不到資料夾（SHIPMENT_FOLDER_ID 是否正確、帳號有無權限）：' + e);
    return;
  }
  var doneFolder = getOrCreateChildFolder(folder, DONE_FOLDER);

  var files = folder.getFilesByType(MimeType.PDF);
  var ok = 0, fail = 0, skip = 0, seen = 0;

  while (files.hasNext() && seen < MAX_FILES) {
    var file = files.next();
    seen++;

    var name = file.getName();
    var size = file.getSize();
    if (size > MAX_BYTES) {
      skip++;
      Logger.log('⚠️ 跳過（檔案過大 ' + size + ' bytes）：' + name);
      continue; // 刻意不移走：留在原地讓人看得到，避免靜默消失
    }

    var payload = {
      file_id: file.getId(),
      file_name: name,
      content_b64: Utilities.base64Encode(file.getBlob().getBytes())
    };

    var res = postIntake(intakeUrl, apiKey, payload);
    if (res.ok) {
      // 先移檔再計數：移動失敗會丟例外，寧可下次重送（Edge Function 會去重）也不要漏移
      file.moveTo(doneFolder);
      ok++;
      Logger.log((res.skipped ? '↷ 已處理過（去重）：' : '✅ 已送出：') + name);
    } else {
      fail++;
      Logger.log('❌ 送出失敗：' + name + '｜' + res.error + '｜HTTP ' + res.status);
      // 失敗不移走 → 下次觸發自動重試（顯性失敗，不靜默吞掉）
    }
  }

  if (seen === 0) { Logger.log('本次無待處理的貨運單 PDF。'); return; }
  Logger.log('取檔完成：成功 ' + ok + '、失敗 ' + fail + '、跳過 ' + skip +
             (files.hasNext() ? '（仍有待處理檔案，下次觸發續跑）' : ''));
}

/** 呼叫 shipment-intake API。回 {ok, skipped?, status, error?} */
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
      return { ok: true, skipped: !!data.skipped, status: code };
    }
    return { ok: false, status: code, error: (data && data.error) || '未知錯誤' };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

/** 取得或建立子資料夾 */
function getOrCreateChildFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
