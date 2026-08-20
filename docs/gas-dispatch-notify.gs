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

  // 每段各自套用列出上限，避免其中一段把配額吃光、另一段整段消失。
  // 每段也各自 @提及該層的簽核者——混在一起提及的話，
  // 副主管會被主管那段的通知吵到，久了兩邊都不看。
  if (subRows.length) {
    var subAt = mentionsFromProp_('DISPATCH_SUB_APPROVERS');
    lines.push('*副主管待核 ' + subRows.length + ' 筆*' + (subAt ? '　' + subAt : ''));
    lines = lines.concat(listLines_(subRows));
    lines.push('');
  }
  if (bossRows.length) {
    var bossAt = mentionsFromProp_('DISPATCH_BOSS_APPROVERS');
    lines.push('*主管待核 ' + bossRows.length + ' 筆*' + (bossAt ? '　' + bossAt : ''));
    lines = lines.concat(listLines_(bossRows));
  }

  lines.push('');
  lines.push(webappUrl
    ? '<' + webappUrl + '|前往簽核>'
    : '（尚未設定 DISPATCH_WEBAPP_URL，無法附上簽核連結）');

  return lines.join('\n');
}

/**
 * 單一層的清單行，超過上限收斂成「還有 N 筆」。
 *
 * 每個單號都是可以點的深連結，點下去直接開到那一筆（帶分頁與列號提示，約 2 秒；
 * 沒有提示的話簽核頁要掃 17 個分頁，實測 39 秒）。
 * 取不到基底網址時 deepLink_ 回空字串，這裡就退回純文字單號——
 * 寧可沒有連結，也不要給一個點下去是錯誤頁的連結。
 */
function listLines_(rows) {
  var out = [];
  var show = Math.min(rows.length, MAX_LIST_IN_MESSAGE);
  for (var i = 0; i < show; i++) {
    var r = rows[i];
    var link = deepLink_({ page: 'approve', no: r.orderNo, sh: r.sheet, rw: r.row });
    var parts = [link ? '<' + link + '|' + r.orderNo + '>' : r.orderNo];
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
/**
 * 測 @提及到底要用哪種格式，省下人工去挖每個人的數字 UID。
 *
 * 背景：Chat 的人員選擇器只給 email（`pkd-target="1:someone@corp.com"`），
 * 數字 UID 要到「已發出的訊息」上按右鍵檢查 `data-member-id` 才挖得到，很費工。
 * 但 Google 的使用者識別格式文件說 email 也是合法的識別方式，
 * 如果 `<users/email>` 直接可用，那 Chat人員對照 那張表就只是備案而不是必需品。
 *
 * 用法：在 Apps Script 編輯器把下面的 TEST_EMAIL 換成要測的人，選這支函式按「執行」，
 *       然後去 Chat 空間看那則訊息——**看哪一行真的變成藍色可點的 @提及**。
 *
 * ⚠ 這支會真的發一則訊息到 Chat 空間，測完記得跟同事說一聲那是測試。
 */
function checkChatMentionFormat() {
  var TEST_EMAIL = 'ting.hsu@waferlock.com';   // ← 改成要測的人
  var TEST_UID = '';                           // ← 把挖到的數字 UID 貼這裡再執行一次

  var webhook = PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_WAREHOUSE_WEBHOOK');
  if (!webhook) {
    Logger.log('❌ 未設定 DISPATCH_WAREHOUSE_WEBHOOK，無法測試。');
    return;
  }

  // 沒手動指定就退回查對照表，兩種來源都支援
  var uid = String(TEST_UID || '').trim();
  if (!uid) {
    try {
      uid = loadChatUids_()[String(TEST_EMAIL).toLowerCase()] || '';
    } catch (err) {
      Logger.log('（讀 Chat人員對照 失敗，略過）' + err);
    }
  }

  var lines = [
    '*🔧 @提及格式測試（測完可忽略）*',
    '對象：' + TEST_EMAIL,
    '',
    'A. email 格式：<users/' + TEST_EMAIL + '>',
    'B. 純文字（對照組）：' + TEST_EMAIL,
    uid ? 'C. 數字 UID 格式：<users/' + uid + '>'
        : 'C. 數字 UID：未提供（請把 UID 填進 TEST_UID 或 Chat人員對照）',
    'D. 直接加小老鼠：@' + TEST_EMAIL,
    'E. 全體提及：<users/all>'
  ];

  var res = postToChat_(webhook, lines.join('\n'));
  Logger.log(res.ok ? '✅ 已送出，請到 Chat 看哪一行變成可點的 @提及'
                    : '❌ 送出失敗｜HTTP ' + res.status + '｜' + res.body);
  Logger.log('');
  Logger.log('判讀（看哪一行變成藍色、可點的 @提及）：');
  Logger.log('  C 行有效 → 把每個人的 UID 填進 Chat人員對照 就完成。');
  Logger.log('  D 行有效 → 更好，連 UID 都不用挖，直接用 @email 就行。');
  Logger.log('  E 行有效 → 至少還能「全體提及」，雖然點不到特定人，但總比沒人被通知好。');
  Logger.log('  全都是純文字 → **webhook 不支援 @提及**，跟格式無關。');
  Logger.log('                 要嘛改用 Chat App（需 GCP 專案），要嘛放棄 @提及。');
}

/**
 * 列出「還缺哪些人的 Chat UID」——把挖 UID 這件苦工變成一張明確的清單。
 *
 * 實測結論（2026-08-20）：Chat 的 incoming webhook **支援** @提及，
 * 但只認 `<users/數字UID>`；email 的各種寫法（<users/email>、@email）一律無效。
 * 所以每個要被 @到的人都必須在 Chat人員對照 有一列。
 *
 * 這支不會發任何訊息，純粹讀設定並印出清單，可以放心重複執行。
 */
function listChatUidTodo() {
  var props = PropertiesService.getScriptProperties();
  var need = {};   // email → 角色清單

  function add(email, role) {
    var m = String(email || '').replace(/[\s　]+/g, '').toLowerCase();
    if (!m) return;
    if (!need[m]) need[m] = [];
    if (need[m].indexOf(role) < 0) need[m].push(role);
  }
  function addList(propName, role) {
    var raw = String(props.getProperty(propName) || '').trim();
    if (!raw) {
      Logger.log('（' + propName + ' 未設定＝不限制身分，無法得知該 @誰）');
      return;
    }
    raw.split(',').forEach(function (e) { add(e, role); });
  }

  addList('DISPATCH_BOSS_APPROVERS', '主管簽核');
  addList('DISPATCH_SUB_APPROVERS', '副主管簽核');
  addList('DISPATCH_WAREHOUSE', '倉庫');
  addList('DISPATCH_ASSISTANTS', '助理');

  // 路由對照表裡的業務與助理：出貨有問題時要通知他們
  try {
    var roster = loadRoster_();
    for (var code in roster) {
      add(roster[code].assistMail, '助理(' + code + ')');
      add(roster[code].salesMail, '業務(' + code + ')');
    }
  } catch (err) {
    Logger.log('（讀人員代碼對照表失敗，業務/助理清單不完整）' + err);
  }

  var have = {};
  try { have = loadChatUids_(); } catch (err) { Logger.log('（讀 Chat人員對照 失敗）' + err); }

  var missing = [], ok = [];
  Object.keys(need).sort().forEach(function (m) {
    (have[m] ? ok : missing).push(m + '　［' + need[m].join('、') + '］');
  });

  Logger.log('===== Chat UID 盤點 =====');
  Logger.log('已有 UID：' + ok.length + ' 人');
  ok.forEach(function (l) { Logger.log('  ✓ ' + l); });
  Logger.log('');
  Logger.log('缺 UID：' + missing.length + ' 人　← 這些人不會被 @到，只會顯示純文字姓名');
  missing.forEach(function (l) { Logger.log('  ✗ ' + l); });
  Logger.log('');
  Logger.log('挖 UID 的方法：在 Chat 裡自己 @那個人並送出 → 對送出後的 @標籤按右鍵 → 檢查');
  Logger.log('　→ 搜尋 data-member-id，users/ 後面那串數字就是。');
  Logger.log('　（人員選擇器的下拉只給 email，那裡挖不到。）');
  Logger.log('填好後貼進試算表的「' + CHAT_UID_SHEET + '」分頁，欄位：email／Chat UID／姓名備註');
}

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
