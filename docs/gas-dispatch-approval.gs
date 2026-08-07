/**
 * ============================================================
 * WAFERLOCK — 發包簽核 GAS Web App（主管核准／退回）
 * ============================================================
 * 用途：主管開啟本網頁 → 看到待核的發包項目 → 按核准或退回 →
 *       系統把「真實 Google 帳號 + 時間」寫回工資發包申請單，並留一筆稽核紀錄。
 *
 * 為什麼一定要用 GAS Web App，不能用一般 HTML 網頁：
 *   Web App 可以取得 Session.getActiveUser().getEmail()，也就是登入者的
 *   Google Workspace 帳號，**無法偽造**。
 *   對照專案裡既有的互動網頁（我方主張與網聯對照.html、四階段掛鉤對焦.html…），
 *   它們的填寫人是 <input> 手打、anon key 硬編在前端，任何人改個名字就能冒名。
 *   簽核如果照抄那個模式，會比現在「主管手打英文名」更危險——因為看起來像有驗證力。
 *
 * 為什麼簽核欄位要設「受保護範圍」：
 *   只把手打改成按鈕、但欄位還是人人可編輯的話，簽核依然可以被任意竄改，
 *   等於沒做。受保護範圍 + 本 Web App 以擁有者身分執行，才是真正的閘門。
 *
 * ── 一次性設定（依序做完，缺一不可）──────────────────────────
 * 1. 專案設定 → 指令碼屬性（Script Properties）新增：
 *      DISPATCH_SHEET_ID   = <工資發包申請單的試算表 ID>
 *        取得方式：打開試算表，網址 .../spreadsheets/d/<這一段就是 ID>/edit
 *      DISPATCH_SHEET_NAME = <工作表分頁名稱>（例：工資發包申請單）
 *    （可選）DISPATCH_HEADER_ROW = <表頭在第幾列>，未設定會自動偵測（找含「發包單號」的列）
 *
 * 2. 試算表設定「受保護範圍」（資料 → 保護工作表和範圍）：
 *      把「主管簽核」「案件狀態」兩欄設為僅擁有者可編輯。
 *      沒做這步，簽核就沒有效力——詳見 docs/發包試算表_欄位規格.md。
 *
 * 3. 部署（部署 → 新增部署作業 → 類型選「網頁應用程式」）：
 *      執行身分：**我（擁有者）**      ← 才有權寫入受保護範圍
 *      具有存取權的使用者：**機構內的任何人**  ← 才拿得到 getActiveUser()
 *      ⚠ 千萬不要選「知道連結的任何人」，那樣會拿不到登入身分，簽核者無法辨識。
 *      部署後把網址記下來，填進 gas-dispatch-notify.gs 的 DISPATCH_WEBAPP_URL 屬性。
 *
 * 注意：執行環境為 Google V8，僅能用 GAS 內建服務（SpreadsheetApp / HtmlService /
 *       LockService / PropertiesService / Session）；時間一律 Asia/Taipei。
 * ============================================================
 */

var TZ = 'Asia/Taipei';

// 欄位以「表頭文字」比對，不寫死欄位代號——之後有人在中間插欄也不會錯位
var COL_ORDER_NO  = '發包單號';
var COL_APPLY_AT  = '發包申請日期';
var COL_WORKER    = '承包商';
var COL_CUSTOMER  = '客戶';
var COL_PROJECT   = '案名';
var COL_MODEL     = '型號';
var COL_QTY       = '本次請款數量';
var COL_PRICE     = '承包總價';
var COL_DISPATCHER= '發包人員';
var COL_NOTE      = '補充說明';
var COL_APPROVAL  = '主管簽核';   // 建議改成這個欄名；下方 ALIAS 仍認得舊名，不強迫先改
var COL_STATUS    = '案件狀態';   // 新增欄，取代「黃色標示」

// 舊表頭相容：欄位還沒改名也能運作，避免「非得先改試算表才能用」的導入門檻
var COL_ALIAS = {};
COL_ALIAS[COL_APPROVAL] = ['主管KEY英文名押日期', '主管簽核', '主管核准'];

var AUDIT_SHEET = '簽核紀錄';     // 稽核軌跡（不存在會自動建立）
var MAX_SCAN_HEADER_ROWS = 10;    // 自動偵測表頭時最多往下找幾列

// ────────────────────────────────────────────── 網頁進入點

function doGet() {
  var email = currentUserEmail_();
  if (!email) {
    return htmlPage_(errorBlock_(
      '無法辨識您的身分',
      '請確認：①用公司 Google 帳號登入 ②部署設定的「具有存取權的使用者」是「機構內的任何人」，' +
      '不是「知道連結的任何人」。取不到身分就不能簽核，這是刻意的防護。'
    ));
  }

  var data;
  try {
    data = getPending_();
  } catch (err) {
    return htmlPage_(errorBlock_('讀取試算表失敗', String(err)));
  }

  return htmlPage_(listBlock_(email, data));
}

// ────────────────────────────────────────────── 給前端 google.script.run 呼叫

/**
 * 寫入簽核結果。回傳 {ok, message}。
 * 前端不傳簽核者是誰——一律由伺服器端從登入身分取得，避免被竄改。
 */
function submitDecision(orderNo, decision, note) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };

  orderNo = String(orderNo || '').trim();
  if (!orderNo) return { ok: false, message: '缺少發包單號。' };
  if (decision !== 'approve' && decision !== 'reject') {
    return { ok: false, message: '未知的動作：' + decision };
  }
  note = String(note || '').trim();
  if (decision === 'reject' && !note) {
    return { ok: false, message: '退回必須填寫原因，讓業務知道要改什麼。' };
  }

  // 多位主管可能同時操作，寫入一律加鎖
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return { ok: false, message: '系統忙碌中（有人正在寫入），請稍候再試一次。' };
  }

  try {
    var env = openSheets_();
    var hit = findByOrderNo_(env, orderNo);
    if (!hit) return { ok: false, message: '找不到發包單號 ' + orderNo + '，可能已被刪除。' };

    var ctx = hit.ctx;
    if (!ctx.col[COL_APPROVAL]) {
      return { ok: false, message: '分頁「' + ctx.name + '」找不到簽核欄，未寫入任何資料。' };
    }

    // 重讀一次當下的簽核狀態：避免兩位主管同時開著頁面、後按的人覆蓋前一位
    var already = String(ctx.sheet.getRange(hit.row, ctx.col[COL_APPROVAL]).getValue() || '').trim();
    if (already) {
      return { ok: false, message: '這筆已經被處理過了：' + already + '（畫面請重新整理）' };
    }

    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var mark = (decision === 'approve')
      ? '✅ 核准 ' + email + ' ' + stamp
      : '❌ 退回 ' + email + ' ' + stamp + '｜' + note;

    ctx.sheet.getRange(hit.row, ctx.col[COL_APPROVAL]).setValue(mark);
    if (ctx.col[COL_STATUS]) {
      ctx.sheet.getRange(hit.row, ctx.col[COL_STATUS])
        .setValue(decision === 'approve' ? '已核准' : '已退回');
    }

    // 稽核軌跡：簽核欄只留最後狀態，這裡留完整歷程（誰、何時、做了什麼、為什麼）
    appendAudit_(env.ss, {
      at: stamp, who: email, orderNo: orderNo,
      action: decision === 'approve' ? '核准' : '退回',
      note: note, sheet: ctx.name, row: hit.row
    });

    SpreadsheetApp.flush();
    return { ok: true, message: (decision === 'approve' ? '已核准 ' : '已退回 ') + orderNo };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };   // 顯性失敗，不靜默吞掉
  } finally {
    lock.releaseLock();
  }
}

/** 前端「重新整理」用：只回資料不重畫整頁 */
function refreshPending() {
  if (!currentUserEmail_()) return { ok: false, rows: [] };
  try {
    return { ok: true, rows: getPending_() };
  } catch (err) {
    return { ok: false, rows: [], message: String(err) };
  }
}

// ────────────────────────────────────────────── 試算表存取

/**
 * 開啟所有要處理的工作表。
 *
 * 為什麼要支援多分頁：實際的試算表是「每位業務一個分頁」（零售-Johnson、零售-Sammi…），
 * 只讀一頁的話，主管會看不到其他業務的發包，而且是**安靜地看不到**——最危險的那種錯。
 *
 * DISPATCH_SHEET_NAME 的三種寫法：
 *   零售-Johnson              單一分頁
 *   零售-Johnson,零售-Sammi   多個分頁，逗號分隔
 *   *                         自動掃描：所有含「發包單號」表頭的分頁都納入
 */
function openSheets_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DISPATCH_SHEET_ID');
  var spec = String(props.getProperty('DISPATCH_SHEET_NAME') || '').trim();
  if (!id) throw new Error('未設定指令碼屬性 DISPATCH_SHEET_ID');
  if (!spec) throw new Error('未設定指令碼屬性 DISPATCH_SHEET_NAME（可填分頁名、逗號分隔多個、或 * 代表全部）');

  var ss = SpreadsheetApp.openById(id);
  var list = [];

  if (spec === '*') {
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      // 簽核紀錄的表頭也有「發包單號」，不排除的話會被當成資料分頁、
      // 把稽核紀錄本身讀成待核項目
      if (all[i].getName() === AUDIT_SHEET) continue;
      var ctx = buildCtx_(all[i]);
      if (ctx) list.push(ctx);   // 沒有「發包單號」表頭的分頁自動略過
    }
    if (!list.length) {
      throw new Error('自動掃描找不到任何含「' + COL_ORDER_NO + '」表頭的分頁');
    }
  } else {
    var names = spec.split(',');
    for (var j = 0; j < names.length; j++) {
      var name = names[j].trim();
      if (!name) continue;
      var sheet = ss.getSheetByName(name);
      if (!sheet) throw new Error('找不到工作表「' + name + '」，請確認 DISPATCH_SHEET_NAME');
      var c = buildCtx_(sheet);
      if (!c) throw new Error('工作表「' + name + '」找不到「' + COL_ORDER_NO + '」欄，請檢查表頭');
      list.push(c);
    }
    if (!list.length) throw new Error('DISPATCH_SHEET_NAME 沒有指定任何有效的分頁');
  }

  return { ss: ss, list: list };
}

/** 建立單一分頁的欄位對照。找不到「發包單號」表頭回傳 null（供自動掃描略過用） */
function buildCtx_(sheet) {
  var forced = Number(PropertiesService.getScriptProperties().getProperty('DISPATCH_HEADER_ROW') || 0);
  var headerRow = forced || detectHeaderRow_(sheet);
  if (!headerRow) return null;

  var col = headerMap_(sheet, headerRow);
  applyAliases_(col);
  if (!col[COL_ORDER_NO]) return null;

  // 沒有簽核欄的分頁「不可用」：既無從判斷哪些已核（會把整張表當成待核），
  // 主管就算按了核准也沒地方寫。這種情況要當成設定錯誤報出來，不能默默列出來。
  return {
    sheet: sheet,
    name: sheet.getName(),
    headerRow: headerRow,
    col: col,
    usable: !!col[COL_APPROVAL]
  };
}

/** 自動找出表頭在第幾列：往下掃，第一個含「發包單號」的列就是。找不到回傳 0。 */
function detectHeaderRow_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return 0;

  var rows = Math.min(MAX_SCAN_HEADER_ROWS, lastRow);
  var values = sheet.getRange(1, 1, rows, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (normHeader_(values[r][c]) === COL_ORDER_NO) return r + 1;
    }
  }
  return 0;
}

/** 表頭文字 → 欄號（1-based）。表頭常有換行與多餘空白，統一正規化後比對。 */
function headerMap_(sheet, headerRow) {
  var last = sheet.getLastColumn();
  var head = sheet.getRange(headerRow, 1, 1, last).getValues()[0];
  var map = {};
  for (var i = 0; i < head.length; i++) {
    var key = normHeader_(head[i]);
    if (key && !map[key]) map[key] = i + 1;
  }
  return map;
}

function normHeader_(v) {
  return String(v == null ? '' : v).replace(/[\s　]+/g, '').trim();
}

/** 標準欄名找不到時，改用別名補上（讓舊表頭也能運作） */
function applyAliases_(col) {
  for (var std in COL_ALIAS) {
    if (col[std]) continue;
    var list = COL_ALIAS[std];
    for (var i = 0; i < list.length; i++) {
      var key = normHeader_(list[i]);
      if (col[key]) { col[std] = col[key]; break; }
    }
  }
}

/** 撈出所有分頁的待核清單 */
function getPending_() {
  var env = openSheets_();
  var out = [];
  for (var i = 0; i < env.list.length; i++) {
    out = out.concat(pendingOfSheet_(env.list[i]));
  }
  return out;
}

/**
 * 單一分頁的待核清單：有發包單號、且主管簽核欄還是空的。
 *
 * 可選的 DISPATCH_PENDING_SINCE（格式 YYYY-MM-DD）：只列出申請日在此之後的。
 * 為什麼需要：實際資料裡有 2023 年的單一直沒填簽核欄，那多半是歷史遺留、
 * 不是真的等著被核。主管開頁面看到一堆三年前的單，反而會失去信任。
 * 沒設定＝不過濾（不預設幫使用者決定哪些資料該被藏起來）。
 */
function pendingOfSheet_(ctx) {
  if (!ctx.usable) return [];   // 缺簽核欄，判斷不出狀態，一律不列（由 checkSetup 報警）

  var since = String(PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_PENDING_SINCE') || '').trim();
  var startRow = ctx.headerRow + 1;
  var lastRow = ctx.sheet.getLastRow();
  if (lastRow < startRow) return [];

  var width = ctx.sheet.getLastColumn();
  var values = ctx.sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    // raw 取原始值（日期欄會是 Date 物件、金額欄會是數字）；pick 取字串。
    // 日期一定要走 raw——先轉字串的話會變成 "Wed Jul 05 2023 00:00:00 GMT+0800"。
    var raw = function (name) {
      var c = ctx.col[name];
      return c ? row[c - 1] : '';
    };
    var pick = function (name) {
      var v = raw(name);
      return String(v == null ? '' : v).trim();
    };

    var orderNo = pick(COL_ORDER_NO);
    // 最上面那幾列會寫「先寄未裝」「先寄門廠/宇泰」而不是單號——那是狀態註記，還不能簽核
    if (!orderNo || !/^[A-Za-z]{2}-\d{6}-\d+/.test(orderNo)) continue;
    if (pick(COL_APPROVAL)) continue;   // 已處理過

    var applyAt = fmtDate_(raw(COL_APPLY_AT));
    // 有設定起始日才過濾；日期空白的一律保留（無從判斷，寧可多顯示也不要漏）
    if (since && applyAt && applyAt < since) continue;

    out.push({
      orderNo: orderNo,
      applyAt: applyAt,
      worker: pick(COL_WORKER),
      customer: pick(COL_CUSTOMER),
      project: pick(COL_PROJECT),
      model: pick(COL_MODEL),
      qty: pick(COL_QTY),
      price: fmtMoney_(raw(COL_PRICE)),
      dispatcher: pick(COL_DISPATCHER),
      note: pick(COL_NOTE),
      sheet: ctx.name,
      row: startRow + i
    });
  }
  return out;
}

/**
 * 跨所有分頁找出這個發包單號在哪一列。
 * 發包單號本身已含業務代碼前綴（JW/LS/SL/VH…），全域唯一，
 * 所以不需要前端回傳分頁名稱——少一個可被竄改的輸入。
 */
function findByOrderNo_(env, orderNo) {
  for (var k = 0; k < env.list.length; k++) {
    var ctx = env.list[k];
    var startRow = ctx.headerRow + 1;
    var lastRow = ctx.sheet.getLastRow();
    if (lastRow < startRow) continue;
    var c = ctx.col[COL_ORDER_NO];
    var vals = ctx.sheet.getRange(startRow, c, lastRow - startRow + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0] || '').trim() === orderNo) {
        return { ctx: ctx, row: startRow + i };
      }
    }
  }
  return null;
}

/** 日期欄：試算表回傳的是 Date 物件，直接 String() 會變成一長串英文格式 */
function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

/** 金額欄：加千分位。不用 toLocaleString，避免不同執行環境的地區設定差異 */
function fmtMoney_(v) {
  if (v === '' || v == null) return '';
  var n = Number(v);
  if (isNaN(n)) return String(v).trim();
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ────────────────────────────────────────────── 稽核軌跡

function appendAudit_(ss, rec) {
  var sh = ss.getSheetByName(AUDIT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_SHEET);
    sh.appendRow(['時間', '操作者', '發包單號', '動作', '說明', '分頁', '列號']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([rec.at, rec.who, rec.orderNo, rec.action, rec.note, rec.sheet, rec.row]);
}

// ────────────────────────────────────────────── 身分

/**
 * 取得登入者的 Google 帳號。取不到就回空字串，呼叫端必須拒絕動作。
 * 取不到的常見原因：部署時「具有存取權的使用者」選成「知道連結的任何人」。
 */
function currentUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

// ────────────────────────────────────────────── 畫面

function htmlPage_(bodyHtml) {
  var css =
    '*{box-sizing:border-box;margin:0;padding:0;font-family:"Noto Sans TC",-apple-system,sans-serif}' +
    'body{background:#EEF2F7;color:#1E293B;padding:16px;max-width:760px;margin:0 auto}' +
    '.hd{display:flex;align-items:center;gap:10px;margin-bottom:14px}' +
    '.hd .ic{width:38px;height:38px;background:#0F2744;border-radius:9px;display:flex;' +
      'align-items:center;justify-content:center;font-size:19px}' +
    '.hd h1{font-size:17px;font-weight:700}.hd p{font-size:11.5px;color:#64748B}' +
    '.card{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:10px;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.08)}' +
    '.top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}' +
    '.no{font-size:15px;font-weight:800;color:#0F2744}' +
    '.date{font-size:11.5px;color:#94A3B8}' +
    '.who{margin-left:auto;font-size:11.5px;color:#64748B}' +
    'table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:10px}' +
    'th{text-align:left;color:#64748B;font-weight:600;padding:4px 8px 4px 0;width:78px;' +
      'vertical-align:top;white-space:nowrap}' +
    'td{padding:4px 0;color:#1E293B}' +
    '.amt{font-size:16px;font-weight:800;color:#B91C1C}' +
    '.row{display:flex;gap:8px;flex-wrap:wrap}' +
    'button{padding:9px 18px;border:none;border-radius:7px;font-size:13.5px;font-weight:700;' +
      'cursor:pointer;font-family:inherit}' +
    '.ok{background:#10B981;color:#fff}.no-btn{background:#F1F5F9;color:#B91C1C}' +
    'button:disabled{opacity:.45;cursor:not-allowed}' +
    '.center{text-align:center;color:#64748B;font-size:13px;padding:36px 0}' +
    '.msg{padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.6;margin-bottom:10px}' +
    '.msg.fail{background:#FEE2E2;color:#991B1B}.msg.done{background:#D1FAE5;color:#065F46}' +
    '.note{font-size:11px;color:#94A3B8;margin-top:8px;line-height:1.6}';

  var html =
    '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<style>' + css + '</style></head><body>' + bodyHtml + '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('發包簽核')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function errorBlock_(title, detail) {
  return '<div class="hd"><div class="ic">📋</div><div><h1>發包簽核</h1></div></div>' +
         '<div class="card"><div class="msg fail"><b>' + esc_(title) + '</b><br>' +
         esc_(detail) + '</div></div>';
}

function listBlock_(email, rows) {
  var head =
    '<div class="hd"><div class="ic">📋</div><div>' +
    '<h1>發包簽核</h1><p>' + esc_(email) + '</p></div></div>' +
    '<div id="msg"></div>';

  if (!rows.length) {
    return head + '<div class="card"><div class="center">目前沒有待核准的發包項目 👍</div></div>';
  }

  var cards = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var id = 'c' + i;
    cards +=
      '<div class="card" id="' + id + '">' +
        '<div class="top">' +
          '<span class="no">' + esc_(r.orderNo) + '</span>' +
          '<span class="date">' + esc_(r.applyAt) + '</span>' +
          '<span class="who">' + esc_(r.sheet) +
            (r.dispatcher ? '｜' + esc_(r.dispatcher) : '') + '</span>' +
        '</div>' +
        '<table>' +
          tr_('承包商', r.worker) +
          tr_('客戶', r.customer + (r.project ? '（' + r.project + '）' : '')) +
          tr_('型號', r.model + (r.qty ? ' × ' + r.qty : '')) +
          '<tr><th>承包總價</th><td class="amt">' +
            (r.price ? 'NT$ ' + esc_(r.price) : '—') + '</td></tr>' +
          (r.note ? tr_('補充說明', r.note) : '') +
        '</table>' +
        '<div class="row">' +
          '<button class="ok" onclick="act(\'' + jsq_(r.orderNo) + '\',\'approve\',\'' + id + '\')">✅ 核准</button>' +
          '<button class="no-btn" onclick="act(\'' + jsq_(r.orderNo) + '\',\'reject\',\'' + id + '\')">❌ 退回</button>' +
        '</div>' +
      '</div>';
  }

  var script =
    '<script>' +
    'function show(t,cls){var m=document.getElementById("msg");' +
      'm.innerHTML=\'<div class="msg \'+cls+\'">\'+t+\'</div>\';window.scrollTo(0,0);}' +
    'function act(no,dec,cardId){' +
      'var note="";' +
      'if(dec==="reject"){note=prompt("退回原因（會寫進紀錄，讓業務知道要改什麼）：")||"";' +
        'if(!note.trim()){return;}}' +
      'var card=document.getElementById(cardId);' +
      'var btns=card.querySelectorAll("button");' +
      'for(var i=0;i<btns.length;i++){btns[i].disabled=true;}' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'if(res.ok){card.parentNode.removeChild(card);show(res.message,"done");' +
            'if(!document.querySelectorAll(".card").length){' +
              'show("全部處理完畢 👍","done");}}' +
          'else{for(var i=0;i<btns.length;i++){btns[i].disabled=false;}show(res.message,"fail");}' +
        '})' +
        '.withFailureHandler(function(err){' +
          'for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
          'show("連線失敗："+err.message,"fail");})' +
        '.submitDecision(no,dec,note);' +
    '}' +
    '</script>';

  var footer = '<div class="note">簽核者身分取自您的 Google 帳號，無法手動修改。' +
               '每一筆核准／退回都會記錄在試算表的「' + AUDIT_SHEET + '」分頁。</div>';

  return head + cards + footer + script;
}

function tr_(label, value) {
  return '<tr><th>' + esc_(label) + '</th><td>' + esc_(value || '—') + '</td></tr>';
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 供內嵌到 onclick='...' 的單引號字串用 */
function jsq_(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ────────────────────────────────────────────── 設定自檢

/**
 * 手動執行這支，確認設定是否齊全（部署前先跑一次，省得部署完才發現漏設）。
 * 在編輯器選這個函式按「執行」，看執行記錄。
 */
function checkSetup() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('DISPATCH_SHEET_ID   = ' + (props.getProperty('DISPATCH_SHEET_ID') || '❌ 未設定'));
  Logger.log('DISPATCH_SHEET_NAME = ' + (props.getProperty('DISPATCH_SHEET_NAME') || '❌ 未設定'));
  Logger.log('DISPATCH_HEADER_ROW = ' + (props.getProperty('DISPATCH_HEADER_ROW') || '（未設定，將自動偵測）'));
  try {
    var env = openSheets_();
    Logger.log('✅ 試算表開啟成功，納入 ' + env.list.length + ' 個分頁');

    var need = [COL_WORKER, COL_CUSTOMER, COL_MODEL, COL_STATUS];
    var all = [];
    var blocked = [];

    // 只掃一次，邊掃邊累計——不要掃完再呼叫 getPending_() 整個重來（18 個分頁會多花一分鐘）
    for (var i = 0; i < env.list.length; i++) {
      var ctx = env.list[i];
      if (!ctx.usable) {
        blocked.push(ctx.name);
        Logger.log('　⛔ ' + ctx.name + '｜表頭第 ' + ctx.headerRow +
          ' 列｜**缺「' + COL_APPROVAL + '」欄，整個分頁略過**（無處記錄簽核結果）');
        continue;
      }
      var missing = [];
      for (var j = 0; j < need.length; j++) {
        if (!ctx.col[need[j]]) missing.push(need[j]);
      }
      var rows = pendingOfSheet_(ctx);
      all = all.concat(rows);
      Logger.log('　• ' + ctx.name + '｜表頭第 ' + ctx.headerRow + ' 列｜待核 ' + rows.length + ' 筆' +
        (missing.length ? '｜⚠ 缺欄位：' + missing.join('、') : '｜欄位齊全'));
    }

    Logger.log('合計待核：' + all.length + ' 筆（納入 ' +
      (env.list.length - blocked.length) + ' 個分頁）');

    if (blocked.length) {
      Logger.log('⛔ 以下 ' + blocked.length + ' 個分頁因缺「' + COL_APPROVAL +
        '」欄而完全略過，主管看不到、也核不了：' + blocked.join('、'));
      Logger.log('　 → 請在這些分頁補上「' + COL_APPROVAL + '」欄（或確認欄名是否不同）。');
    }

    // 最舊的待核項目：若是很久以前的資料，多半是歷史單從沒填過簽核欄，
    // 而不是真的等著被核——建議用 DISPATCH_PENDING_SINCE 過濾
    if (all.length) {
      var oldest = '';
      var noDate = 0;
      for (var k = 0; k < all.length; k++) {
        var d = all[k].applyAt;
        if (!d) { noDate++; continue; }
        if (!oldest || d < oldest) oldest = d;
      }
      if (oldest) Logger.log('最舊待核申請日：' + oldest);
      if (noDate) {
        Logger.log('⚠ 其中 ' + noDate + ' 筆沒有申請日期，日期過濾對它們無效（一律保留）。');
      }
    }
  } catch (err) {
    Logger.log('❌ ' + err);
  }
  Logger.log('DISPATCH_PENDING_SINCE = ' +
    (props.getProperty('DISPATCH_PENDING_SINCE') || '（未設定，不過濾舊資料）'));
  Logger.log('登入身分（在編輯器手動執行時可能為空，屬正常）：' + currentUserEmail_());
}
