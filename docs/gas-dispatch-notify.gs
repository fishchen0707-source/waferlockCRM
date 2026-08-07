/**
 * ============================================================
 * WAFERLOCK — 發包簽核通知 ＋ 每日快照備份
 * ============================================================
 * ⚠ 這支要跟 gas-dispatch-approval.gs 放在**同一個 Apps Script 專案**裡。
 *    它會直接呼叫該檔的 getPending_() / openSheets_()，不重複實作讀表邏輯。
 *
 * 用途一：定時把「待核准的發包」推到 Google Chat，附上簽核頁連結。
 *   主管的覆核因此從「每週四批次」變成「看到通知就能核」。
 *
 * 用途二：每日自動複製整份試算表到 Drive，取代表頭紅字要求的
 *   「每週五業助會定期畫面截錄，以免造成不小心刪除狀況」。
 *   截圖不能還原資料，副本可以。
 *
 * 為什麼 Chat 只做單向通知、不做互動機器人：
 *   Google Chat 機器人在空間裡預設只有被 @提及 才收得到訊息，要收全部訊息
 *   得另外訂閱 Workspace Events API 並取得管理員授權。而我們只需要「通知 + 一個連結」，
 *   incoming webhook 三分鐘就設定完，互動全部在簽核網頁上做。
 *
 * ── 一次性設定 ────────────────────────────────────────────
 * 1. 建立 Google Chat 傳入 Webhook：
 *      在要收通知的 Chat 空間 → 空間名稱旁「⋯」→ 應用程式與整合 → 管理 Webhook
 *      → 新增 Webhook（取個名字如「發包簽核通知」）→ 複製網址
 *    ⚠ 這需要「空間 Space」，一般的群組聊天沒有這個功能。
 *
 * 2. 專案設定 → 指令碼屬性新增（DISPATCH_SHEET_ID / NAME 沿用簽核那支的設定）：
 *      DISPATCH_CHAT_WEBHOOK  = <上一步複製的 Chat Webhook 網址>
 *      DISPATCH_WEBAPP_URL    = <gas-dispatch-approval.gs 部署後的網頁應用程式網址>
 *    （可選）DISPATCH_SNAPSHOT_FOLDER_ID = <存每日副本的 Drive 資料夾 ID>，未設定則不備份
 *    （可選）DISPATCH_SNAPSHOT_KEEP      = <保留幾份>，未設定＝全部保留、不自動清理
 *
 * 3. 觸發條件：本專案「觸發器由人工在 Apps Script 後台管理」。請手動新增兩個時間驅動觸發器：
 *      notifyPendingApprovals — 每日上午 9~10 點
 *      dailySnapshot          — 每日凌晨 1~2 點
 *    （本檔不自動建立觸發器，符合專案規範。）
 *
 * 注意：執行環境為 Google V8，僅能用 GAS 內建服務（UrlFetchApp / DriveApp /
 *       SpreadsheetApp / PropertiesService）；時間一律 Asia/Taipei。
 * ============================================================
 */

var MAX_LIST_IN_MESSAGE = 10;   // 訊息裡最多列幾筆，其餘用「還有 N 筆」帶過
var SNAPSHOT_PREFIX = '發包單快照_';

/**
 * 主函式（時間驅動觸發器）：有待核項目才發通知，沒有就安靜不吵人。
 */
function notifyPendingApprovals() {
  var webhook = PropertiesService.getScriptProperties().getProperty('DISPATCH_CHAT_WEBHOOK');
  if (!webhook) {
    Logger.log('❌ 未設定指令碼屬性 DISPATCH_CHAT_WEBHOOK，無法發送通知。');
    return;
  }
  var webappUrl = PropertiesService.getScriptProperties().getProperty('DISPATCH_WEBAPP_URL') || '';

  var rows;
  try {
    rows = getPending_();   // 來自 gas-dispatch-approval.gs（同一專案）
  } catch (err) {
    // 讀表失敗本身就該讓人知道，否則會誤以為「沒通知＝沒待辦」
    postToChat_(webhook, '⚠️ 發包簽核通知讀取試算表失敗：' + err);
    Logger.log('❌ 讀取待核清單失敗：' + err);
    return;
  }

  if (!rows.length) {
    Logger.log('本次無待核項目，不發送通知。');
    return;
  }

  var res = postToChat_(webhook, buildMessage_(rows, webappUrl));
  Logger.log(res.ok
    ? '✅ 已發送通知，待核 ' + rows.length + ' 筆'
    : '❌ 通知發送失敗｜HTTP ' + res.status + '｜' + res.body);
}

/**
 * 組 Chat 訊息。Chat 支援 *粗體* 與 <網址|文字> 連結。
 *
 * 分兩段列出：部分分頁有副主管那一關，兩層混在一份清單裡，
 * 副主管與主管都會不確定哪幾筆該自己處理。
 */
function buildMessage_(rows, webappUrl) {
  var subRows = [], bossRows = [];
  for (var s = 0; s < rows.length; s++) {
    (rows[s].stage === 'sub' ? subRows : bossRows).push(rows[s]);
  }

  var lines = ['*發包待核准 ' + rows.length + ' 筆*', ''];

  // 每段各自套用列出上限，避免其中一段把配額吃光、另一段整段消失
  if (subRows.length) {
    lines.push('*副主管待核 ' + subRows.length + ' 筆*');
    lines = lines.concat(listLines_(subRows));
    lines.push('');
  }
  if (bossRows.length) {
    lines.push('*主管待核 ' + bossRows.length + ' 筆*');
    lines = lines.concat(listLines_(bossRows));
  }

  lines.push('');
  lines.push(webappUrl
    ? '<' + webappUrl + '|前往簽核>'
    : '（尚未設定 DISPATCH_WEBAPP_URL，無法附上簽核連結）');

  return lines.join('\n');
}

/** 單一層的清單行，超過上限收斂成「還有 N 筆」 */
function listLines_(rows) {
  var out = [];
  var show = Math.min(rows.length, MAX_LIST_IN_MESSAGE);
  for (var i = 0; i < show; i++) {
    var r = rows[i];
    var parts = [r.orderNo];
    if (r.worker) parts.push(r.worker);
    if (r.customer) parts.push(r.customer);
    if (r.price) parts.push('NT$' + r.price);
    out.push('• ' + parts.join('　'));
  }
  if (rows.length > show) out.push('• …還有 ' + (rows.length - show) + ' 筆');
  return out;
}

function postToChat_(webhook, text) {
  try {
    var resp = UrlFetchApp.fetch(webhook, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    return { ok: code >= 200 && code < 300, status: code, body: resp.getContentText().slice(0, 300) };
  } catch (err) {
    return { ok: false, status: 0, body: String(err) };
  }
}

// ────────────────────────────────────────────── 每日快照備份

/**
 * 每日複製整份試算表到指定 Drive 資料夾。
 * 取代「每週五人工截圖」——截圖看得到卻救不回來，副本可以直接還原。
 */
function dailySnapshot() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('DISPATCH_SHEET_ID');
  var folderId = props.getProperty('DISPATCH_SNAPSHOT_FOLDER_ID');

  if (!sheetId) { Logger.log('❌ 未設定 DISPATCH_SHEET_ID，無法備份。'); return; }
  if (!folderId) { Logger.log('未設定 DISPATCH_SNAPSHOT_FOLDER_ID，略過備份。'); return; }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    Logger.log('❌ 找不到備份資料夾（ID 是否正確、帳號有無權限）：' + err);
    return;
  }

  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd_HHmm');
  var name = SNAPSHOT_PREFIX + stamp;
  try {
    DriveApp.getFileById(sheetId).makeCopy(name, folder);
    Logger.log('✅ 已建立快照：' + name);
  } catch (err) {
    Logger.log('❌ 建立快照失敗：' + err);
    return;
  }

  cleanupSnapshots_(folder, props.getProperty('DISPATCH_SNAPSHOT_KEEP'));
}

/**
 * 清理舊快照。
 * 刻意設計成「預設不刪」：沒設定 DISPATCH_SNAPSHOT_KEEP 就全部保留，只在記錄檔提醒。
 * 有設定時也只移到垃圾桶（setTrashed），不永久刪除——備份機制自己把資料弄丟最諷刺。
 */
function cleanupSnapshots_(folder, keepRaw) {
  var keep = Number(keepRaw || 0);
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(SNAPSHOT_PREFIX) === 0) {
      files.push({ file: f, at: f.getDateCreated().getTime() });
    }
  }

  if (!keep || keep < 1) {
    if (files.length > 60) {
      Logger.log('提醒：資料夾內已有 ' + files.length + ' 份快照。' +
                 '要自動清理請設定指令碼屬性 DISPATCH_SNAPSHOT_KEEP（例如 60）。');
    }
    return;
  }

  if (files.length <= keep) return;
  files.sort(function (a, b) { return b.at - a.at; });   // 新到舊
  var trashed = 0;
  for (var i = keep; i < files.length; i++) {
    files[i].file.setTrashed(true);   // 進垃圾桶，30 天內可還原
    trashed++;
  }
  Logger.log('已將 ' + trashed + ' 份舊快照移至垃圾桶（保留最新 ' + keep + ' 份，可從垃圾桶還原）。');
}

// ────────────────────────────────────────────── 設定自檢

/**
 * 手動執行這支，確認通知與備份的設定是否齊全，並實際送一則測試訊息到 Chat。
 */
function checkNotifySetup() {
  var props = PropertiesService.getScriptProperties();
  var webhook = props.getProperty('DISPATCH_CHAT_WEBHOOK');
  var webapp = props.getProperty('DISPATCH_WEBAPP_URL');
  var folderId = props.getProperty('DISPATCH_SNAPSHOT_FOLDER_ID');

  Logger.log('DISPATCH_CHAT_WEBHOOK        = ' + (webhook ? '已設定' : '❌ 未設定'));
  Logger.log('DISPATCH_WEBAPP_URL          = ' + (webapp || '❌ 未設定（通知會缺少簽核連結）'));
  Logger.log('DISPATCH_SNAPSHOT_FOLDER_ID  = ' + (folderId || '（未設定，不做每日備份）'));
  Logger.log('DISPATCH_SNAPSHOT_KEEP       = ' + (props.getProperty('DISPATCH_SNAPSHOT_KEEP') || '（未設定＝全部保留）'));

  try {
    Logger.log('目前待核項目：' + getPending_().length + ' 筆');
  } catch (err) {
    Logger.log('❌ 讀取待核清單失敗：' + err);
  }

  if (folderId) {
    try {
      DriveApp.getFolderById(folderId);
      Logger.log('✅ 備份資料夾可存取');
    } catch (err) {
      Logger.log('❌ 備份資料夾無法存取：' + err);
    }
  }

  if (webhook) {
    var res = postToChat_(webhook, '🔧 發包簽核通知測試訊息（來自 checkNotifySetup，可忽略）');
    Logger.log(res.ok ? '✅ Chat 測試訊息已送出' : '❌ Chat 發送失敗｜HTTP ' + res.status + '｜' + res.body);
  }
}
