/**
 * ============================================================
 * WAFERLOCK — Chat 成員 UID 撈取工具（一次性、用完可刪）
 * ============================================================
 * 用途：把 Chat 空間裡所有成員的數字 UID 撈出來，自動對回 email，
 *       寫進試算表的「Chat人員對照」分頁。
 *
 * 背景：實測（2026-08-20）Chat 的 incoming webhook 支援 @提及，
 *       但**只認 `<users/數字UID>`**，email 的各種寫法一律無效。
 *       而數字 UID 在 Chat 介面上挖不到（人員選擇器只給 email），
 *       所以只能透過 API 取得。
 *
 * ⚠ **這支要放在一個「全新的、獨立的」Apps Script 專案**，
 *   不要貼進派工簽核那個專案。原因：它需要新的 OAuth scope，
 *   而動到那個專案的 scope 會讓**所有使用者下次開網頁時被要求重新授權**——
 *   主管早上點通知進來看到授權畫面，很可能直接關掉然後說系統壞了。
 *   撈完 UID 之後這個專案就可以整個刪掉。
 *
 * ── 設定步驟 ──────────────────────────────────────────────
 * 1. 到 https://script.google.com 建立**新專案**，把這整個檔案貼進去。
 *
 * 2. 專案設定 → 勾選「在編輯器中顯示 appsscript.json」，
 *    把 appsscript.json 換成：
 *
 *    {
 *      "timeZone": "Asia/Taipei",
 *      "dependencies": {},
 *      "exceptionLogging": "STACKDRIVER",
 *      "runtimeVersion": "V8",
 *      "oauthScopes": [
 *        "https://www.googleapis.com/auth/chat.memberships.readonly",
 *        "https://www.googleapis.com/auth/directory.readonly",
 *        "https://www.googleapis.com/auth/spreadsheets",
 *        "https://www.googleapis.com/auth/script.external_request"
 *      ]
 *    }
 *
 * 3. **左側「服務」按 ＋，加入這兩個**（少任何一個都會 403）：
 *      - Google Chat API
 *      - People API
 *
 *    為什麼非做不可：Apps Script 專案背後有一個自動建立的 GCP 專案，
 *    那些 API 預設是關的。直接呼叫會得到
 *      403 "Google Chat API has not been used in project ... before or it is disabled"
 *    在編輯器加「服務」會自動把 API 在那個 GCP 專案上啟用，
 *    比照錯誤訊息裡的 console 連結去開更可靠——預設 GCP 專案
 *    常常沒有 console 存取權。
 *    加完等 1~2 分鐘生效再跑。
 *
 * 4. 填下面兩個常數（SPACE_ID 與 SHEET_ID）。
 *
 * 5. 先執行 listSpaceMembers() 看撈到什麼（唯讀，不寫試算表）。
 *    確認沒問題再執行 writeUidsToSheet() 寫回去。
 * ============================================================
 */

// 【要填】Chat 空間 ID。
// 取得方式：用瀏覽器打開那個 Chat 空間，看網址列：
//   https://mail.google.com/chat/u/0/#chat/space/AAAA1234BBB
// 最後那段 AAAA1234BBB 就是，貼在這裡（不用加 "spaces/"）。
var SPACE_ID = '';

// 【要填】發包試算表的 ID（就是派工簽核專案的 DISPATCH_SHEET_ID）。
// 取得方式：打開試算表看網址 /spreadsheets/d/<這一段>/edit
var SHEET_ID = '';

var TARGET_SHEET = 'Chat人員對照';

/**
 * 唯讀：列出空間所有成員的 UID 與顯示名稱，並嘗試對回 email。
 * 先跑這支確認撈得到，再跑 writeUidsToSheet()。
 */
function listSpaceMembers() {
  var rows = fetchMembers_();
  if (!rows) return;
  Logger.log('===== 共 ' + rows.length + ' 位成員 =====');
  rows.forEach(function (r) {
    Logger.log((r.email || '（查不到 email）') + '　' + r.uid + '　' + (r.name || ''));
  });
  Logger.log('');
  Logger.log('確認無誤後，執行 writeUidsToSheet() 寫進「' + TARGET_SHEET + '」分頁。');
}

/**
 * 把撈到的成員寫進試算表的 Chat人員對照 分頁。
 *
 * 刻意設計成「只補、不覆蓋」：已經有 UID 的列不動，
 * 避免有人手動修正過的資料被機器蓋掉。
 */
function writeUidsToSheet() {
  if (!SHEET_ID) { Logger.log('❌ 請先填 SHEET_ID'); return; }
  var rows = fetchMembers_();
  if (!rows) return;

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TARGET_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TARGET_SHEET);
    sh.appendRow(['email', 'Chat UID', '姓名備註']);
    sh.setFrozenRows(1);
    Logger.log('已建立分頁「' + TARGET_SHEET + '」');
  }

  // 讀現有內容，建 email → 列號
  var last = sh.getLastRow();
  var existing = {};
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      var m = String(vals[i][0] || '').replace(/[\s　]+/g, '').toLowerCase();
      if (m) existing[m] = { row: i + 2, uid: String(vals[i][1] || '').trim() };
    }
  }

  var added = 0, filled = 0, skipped = 0, noEmail = 0;
  rows.forEach(function (r) {
    if (!r.email) { noEmail++; return; }        // 沒 email 就無法對應，略過並回報
    var hit = existing[r.email];
    if (!hit) {
      sh.appendRow([r.email, r.uid, r.name || '']);
      added++;
    } else if (!hit.uid) {
      sh.getRange(hit.row, 2).setValue(r.uid);   // 只補空的
      filled++;
    } else {
      skipped++;                                  // 已有值，不覆蓋
    }
  });

  SpreadsheetApp.flush();
  Logger.log('新增 ' + added + ' 列，補上 UID ' + filled + ' 列，' +
             '已有值未動 ' + skipped + ' 列。');
  if (noEmail) {
    Logger.log('⚠ 有 ' + noEmail + ' 位成員查不到 email（可能是機器人或外部帳號），已略過。');
    Logger.log('　這些人若真的需要被 @到，請用 listSpaceMembers() 看 UID 後人工填入。');
  }
}

// ────────────────────────────────────────────── 內部

/** 呼叫 Chat API 取得成員清單，並用 People API 把 UID 換成 email */
function fetchMembers_() {
  if (!SPACE_ID) { Logger.log('❌ 請先填 SPACE_ID'); return null; }
  var space = String(SPACE_ID).indexOf('spaces/') === 0 ? SPACE_ID : 'spaces/' + SPACE_ID;

  var token = ScriptApp.getOAuthToken();
  var out = [], pageToken = '';

  // 分頁抓完，不要只拿第一頁——空間人多時會漏人，而且漏得很安靜
  do {
    var url = 'https://chat.googleapis.com/v1/' + space + '/members?pageSize=100' +
              (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code !== 200) {
      var body = resp.getContentText();
      Logger.log('❌ Chat API 失敗 HTTP ' + code);
      Logger.log(body.slice(0, 500));
      // 把最常見的那個錯誤直接翻成解法，不要讓人自己從英文訊息裡猜
      if (body.indexOf('has not been used in project') >= 0 || body.indexOf('is disabled') >= 0) {
        Logger.log('→ 解法：左側「服務」按 ＋，加入 **Google Chat API** 與 **People API**，'
                 + '等 1~2 分鐘再跑一次。');
      } else {
        Logger.log('常見原因：① SPACE_ID 填錯 ② 您不是該空間成員 ③ scope 沒加或沒重新授權');
      }
      return null;
    }
    var data = JSON.parse(resp.getContentText());
    (data.memberships || []).forEach(function (m) {
      var u = m.member || {};
      if (u.type && u.type !== 'HUMAN') return;      // 略過機器人
      var uid = String(u.name || '').replace('users/', '');
      if (!uid) return;
      out.push({ uid: uid, name: u.displayName || '', email: '' });
    });
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  // 用 People API 把數字 UID 換成 email。
  // Chat API 本身不回傳 email，這一步是必要的——沒有 email 就沒辦法
  // 對回我們試算表裡的助理／業務／簽核者。
  out.forEach(function (r) {
    r.email = emailOfUid_(r.uid, token);
  });

  return out;
}

/** 用 People API 查某個數字 UID 的 email，查不到回空字串 */
function emailOfUid_(uid, token) {
  try {
    var url = 'https://people.googleapis.com/v1/people/' + encodeURIComponent(uid) +
              '?personFields=emailAddresses';
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return '';
    var p = JSON.parse(resp.getContentText());
    var list = p.emailAddresses || [];
    return list.length ? String(list[0].value || '').trim().toLowerCase() : '';
  } catch (err) {
    return '';
  }
}
