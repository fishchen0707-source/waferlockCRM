/**
 * ============================================================
 * 發包／出貨 報表（獨立 Apps Script，**唯讀**）
 * 規格來源：docs/報表程式_設計.md（2026-08-10 定案）
 *
 * 這是與 gas-dispatch-approval.gs **不同的** Apps Script 專案。
 * 兩者共用「欄名契約」，不共用程式碼——GAS 沒有 import，只能複製。
 *
 *   ⚠ 下方「欄名常數與別名表」複製自 gas-dispatch-approval.gs，
 *     複製日期：2026-08-10。
 *     複製品會腐化，所以防護不是靠人記得同步，而是靠 checkFieldParity()：
 *     它把本程式認得的欄名與實際表頭比對，發現「表上有、程式不認得」就警告。
 *
 * 唯讀保證：本檔不得出現任何寫入 API（儲存格寫入、附加列、建立分頁）。
 * verify-dispatch-report.js 會把註解去掉後做字串搜尋來斷言這件事。
 *
 * 安裝：
 * 1. 新建一個 Apps Script 專案，貼上本檔。
 * 2. 服務 → 新增服務 → **Google Sheets API**（識別碼 Sheets）。
 *    全量掃描靠 Values.batchGet 一次往返讀完所有分頁，沒有它會直接報錯。
 * 3. 指令碼屬性：
 *      DISPATCH_SHEET_ID        必填，與簽核程式同一份試算表
 *      REPORT_SINCE             統計起算日 YYYY-MM-DD。**未設定會在頁面上警告**
 *      DISPATCH_BOSS_APPROVERS  主管 email（逗號分隔）
 *      DISPATCH_SUB_APPROVERS   副主管 email
 *      REPORT_OUTLIER_AMOUNT    金額極端值門檻，預設 1000000
 *      DISPATCH_ROSTER_SHEET    人員代碼分頁名（沒設就用預設兩個名字找）
 * 4. 部署為網頁應用程式：執行身分「我」、存取權「機構內的任何人」。
 *    （與簽核程式同樣的理由：選「知道連結的任何人」就拿不到登入身分。）
 * ============================================================
 */

var TZ = 'Asia/Taipei';

// ── 以下至「別名表結束」為複製區（來源 gas-dispatch-approval.gs，2026-08-10）──

var COL_ORDER_NO  = '發包單號';
var COL_APPLY_AT  = '發包申請日期';
var COL_WORKER    = '承包商';
var COL_CUSTOMER  = '客戶';
var COL_PROJECT   = '案名';
var COL_MODEL     = '型號';
var COL_QTY       = '本次請款數量';
var COL_QUOTE_QTY = '報價單數量';
var COL_WAGE      = '工資報價(對客戶)';
var COL_UNIT      = '承包報價(組)';
var COL_PRICE     = '承包總價';
var COL_DISPATCHER= '發包人員';
var COL_NOTE      = '補充說明';
var COL_APPROVAL  = '主管簽核';
var COL_SUB_APPROVAL = '副主管簽核';
var COL_STATUS    = '案件狀態';

/**
 * 累計請款數量——簽核程式沒有這個常數（它不需要），但報表最重要的一項靠它。
 * 「累計 > 報價」＝已經請款請過頭，那是唯一會直接付錯錢的地方。
 */
var COL_ACCUM_QTY = '累計請款數量';

var COL_ALIAS = {};
COL_ALIAS[COL_APPROVAL] = ['主管KEY英文名押日期', '主管簽核', '主管核准', '主管確認/押日期'];
COL_ALIAS[COL_SUB_APPROVAL] = ['副主管簽核', '副主管確認/押日期', '副主管KEY英文名押日期'];
COL_ALIAS[COL_PRICE] = ['承包總價', '發包合計'];
COL_ALIAS[COL_WAGE] = ['工資報價(對客戶)', '工資報價'];
COL_ALIAS[COL_UNIT] = ['承包報價(組)', '承包報價', '發包單價'];
COL_ALIAS[COL_QTY] = ['本次請款數量', '請款數量'];
COL_ALIAS[COL_QUOTE_QTY] = ['報價單數量', '合約數量'];
COL_ALIAS[COL_APPLY_AT] = ['發包申請日期', '發包日期'];
// 目前 18 個分頁的寫法都一致，先只留標準名。日後出現變體時由 checkFieldParity() 抓到。
COL_ALIAS[COL_ACCUM_QTY] = ['累計請款數量'];

var ROSTER_SHEET_NAMES = ['路由對照表', '人員代碼'];
var COL_R_CODE       = '業務代碼';
var COL_R_SALES      = '業務姓名';
var COL_R_SALES_MAIL = '業務email';
var COL_R_TYPE       = '類別';
var COL_R_ASSIST     = '對應助理';
var COL_R_ASSIST_MAIL= '助理email';
var COL_R_SHEET      = '發包分頁';

var SHIPMENT_SHEET = '出貨明細';
var COL_S_AT        = '登錄時間';
var COL_S_SHIP_NO   = '出貨單號';
var COL_S_ORDER_ID  = '訂單編號';
var COL_S_DISPATCH  = '發包單號';
var COL_S_CUSTOMER  = '客戶';
var COL_S_PROJECT   = '案名';
var COL_S_ITEMS     = '出貨品項';
var COL_S_TO_NAME   = '貨指寄-收件人';
var COL_S_TO_PHONE  = '貨指寄-電話';
var COL_S_TO_ADDR   = '貨指寄-地址';
var COL_S_INVOICE   = '發票別';
var COL_S_NOTE      = '出貨備註';
var COL_S_BY        = '登錄人';
var COL_S_WH_STATUS = '倉庫核單狀態';
var COL_S_WH_BY     = '倉庫核單人';
var COL_S_WH_AT     = '倉庫核單時間';
var COL_S_WH_NOTE   = '問題說明';
var COL_S_SHIP_DATE  = '出貨日期';
var COL_S_CHANNEL_NO = '通路訂單編號';
var COL_S_CUST_NAME  = '客人姓名';
var COL_S_CUST_PHONE = '客人電話';
var COL_S_CUST_ADDR  = '客人地址';
var COL_S_SALE_PRICE = '售價';
var COL_S_COST_PRICE = '進價';
var COL_S_ORDER_BY   = '下單業務';
var COL_S_WORK_TIME  = '施工時段';
var COL_S_WORK_ITEM  = '工項';

var OPTIONS_SHEET = '選單';
var OPT_CHANNEL = '購買通路';
var OPT_MODEL   = '型號';
var OPT_ITEM    = '工項';
var OPT_WORKER  = '承包商';
var OPT_INVOICE = '發票別';

var AUDIT_SHEET = '簽核紀錄';
var MAX_SCAN_HEADER_ROWS = 10;
var ORDER_NO_RE = /^[A-Za-z]{2}-\d{6}-\d+/;
var WORKER_SUFFIX_RE = /(有限公司|股份有限公司|工程行|工程|鎖印行|鎖印|鎖業|企業社|商行|師傅|先生|小姐|家)+$/g;

// ── 別名表結束（複製區到此為止）──────────────────────────────

/**
 * 這些欄名確實存在於試算表上，但報表刻意不使用。
 * 沒有這份清單，checkFieldParity() 會把它們全部報成「不認得的欄名」，
 * 十幾筆噪音會讓真正該注意的那一筆被淹掉——警告一多就沒人看，等於沒有警告。
 */
var KNOWN_UNUSED_HEADERS = [
  '訂單編號', '訂單單號', '訂單號碼', '請購單號', '客戶編號', '維修地址',
  '業務確認', '備註說明', '本期請款合計', '本次請款合計',
  '10999沖帳出貨單號', '沖轉出貨單號', '出貨沖轉單號', '10999出貨沖轉單號',
  '沖帳出貨單號', '出貨單號'
];

var BASIS_SHIP  = 'ship';    // 出貨日：銀貨兩訖，算營收
var BASIS_APPLY = 'apply';   // 發包申請日：看業務接單節奏
var REPORT_CACHE_PREFIX = 'dispatch_report2_';
var REPORT_CACHE_TTL = 900;
var CACHE_MAX_BYTES = 95000;
var DEFAULT_OUTLIER = 1000000;

// ────────────────────────────────────────────── 工具

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normHeader_(v) {
  return String(v == null ? '' : v)
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/[\s　]+/g, '')
    .trim();
}

function headerMapOf_(headRow) {
  var map = {};
  for (var i = 0; i < headRow.length; i++) {
    var key = normHeader_(headRow[i]);
    if (key && !map[key]) map[key] = i + 1;
  }
  return map;
}

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

/** 在前幾列裡找出含 key 欄名的那一列（1-based）。找不到回 0。 */
function detectHeaderRowIn_(values, key) {
  var scan = Math.min(MAX_SCAN_HEADER_ROWS, values.length);
  for (var r = 0; r < scan; r++) {
    var row = values[r] || [];
    for (var c = 0; c < row.length; c++) {
      if (normHeader_(row[c]) === key) return r + 1;
    }
  }
  return 0;
}

/**
 * 金額／數量：空白與非數字一律當 0，**絕不可讓合計變 NaN**。
 * 一個 NaN 會讓整張報表的合計欄變成「NaN」，而那看起來像程式壞了，
 * 不像資料有問題——真正的問題（某一格填了「待確認」）反而被藏起來。
 */
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = Number(String(v == null ? '' : v).replace(/[,\s$　]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** 這一格是不是「填了東西、但不是數字」。用來把資料問題與空白分開計數。 */
function isNonNumeric_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return false;
  if (typeof v === 'number') return !isFinite(v);
  return isNaN(Number(s.replace(/[,\s$　]/g, '')));
}

// 試算表序列數字的原點。Google Sheets 與 Excel 一樣用 1899-12-30。
var SHEET_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * 任何形式的日期 → 'YYYY-MM-DD'。**轉不出來回空字串**，呼叫端必須歸入「日期不明」並計數。
 *
 * 為什麼可以接受轉不出來：部分分頁的日期是手打文字（`3/28`，沒有年份）。
 * 猜年份在出單流程會漏單，在報表只是少統計一筆——而且那一筆會被列出來，
 * 比安靜地猜一個年份誠實。
 */
function toYmd_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  if (typeof v === 'number') {
    // batchGet 以 SERIAL_NUMBER 取回日期。用 UTC 還原再取 UTC 欄位，
    // 中間不經過時區換算——經過的話台北比 UTC 早 8 小時，整數日會被推成前一天。
    if (!isFinite(v) || v < 1 || v > 200000) return '';
    var d = new Date(SHEET_EPOCH_UTC + Math.floor(v) * 86400000);
    return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (!m) return '';
  var mo = Number(m[2]), dy = Number(m[3]);
  if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
  return m[1] + '-' + pad2_(mo) + '-' + pad2_(dy);
}

/** 日期＋時間 → 'YYYY-MM-DD HH:mm'。取不到時間就只回日期；完全取不到回空字串。 */
function toYmdHm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm');
  if (typeof v === 'number' && isFinite(v) && v >= 1 && v <= 200000) {
    // 小數部分是一天內的時間；先取整數日再把餘數換成分鐘，避免浮點誤差跨日
    var days = Math.floor(v);
    var mins = Math.round((v - days) * 1440);
    var base = new Date(SHEET_EPOCH_UTC + days * 86400000);
    return base.getUTCFullYear() + '-' + pad2_(base.getUTCMonth() + 1) + '-' +
      pad2_(base.getUTCDate()) + ' ' + pad2_(Math.floor(mins / 60)) + ':' + pad2_(mins % 60);
  }
  var s = String(v == null ? '' : v);
  var m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2}))?/);
  if (!m) return '';
  var out = m[1] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[3]));
  if (m[4]) out += ' ' + pad2_(Number(m[4])) + ':' + m[5];
  return out;
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** 'YYYY-MM-DD HH:mm' → 毫秒。取不到回 -1。 */
function msOf_(ymdhm) {
  var m = String(ymdhm || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:\s(\d{2}):(\d{2}))?/);
  if (!m) return -1;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0)).getTime();
}

function codeOf_(orderNo) {
  var m = String(orderNo || '').match(/^([A-Za-z]{2})-/);
  return m ? m[1].toUpperCase() : '';
}

function isSystemSheet_(name) {
  if (!name) return true;
  if (name === AUDIT_SHEET || name === SHIPMENT_SHEET || name === OPTIONS_SHEET) return true;
  var roster = String(prop_('DISPATCH_ROSTER_SHEET') || '').trim();
  if (roster && name === roster) return true;
  for (var i = 0; i < ROSTER_SHEET_NAMES.length; i++) {
    if (name === ROSTER_SHEET_NAMES[i]) return true;
  }
  return false;
}

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}

function inList_(raw, email) {
  if (!raw) return false;
  var list = String(raw).split(',');
  var me = String(email).toLowerCase().trim();
  for (var i = 0; i < list.length; i++) {
    if (list[i].toLowerCase().trim() === me) return true;
  }
  return false;
}

function currentUserEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (err) { return ''; }
}

/**
 * 沿用簽核程式的名單屬性與「兩份都沒設就全開」的行為（約定優先於新意），
 * 但這裡回傳 unrestricted 讓畫面把「目前無權限管控」寫出來——
 * 報表顯示的是金額，不能一邊沒設名單一邊裝作有管控。
 */
function stagesFor_(email) {
  var subRaw = String(prop_('DISPATCH_SUB_APPROVERS') || '').trim();
  var bossRaw = String(prop_('DISPATCH_BOSS_APPROVERS') || '').trim();
  if (!subRaw && !bossRaw) return { sub: true, boss: true, unrestricted: true };
  return { sub: inList_(subRaw, email), boss: inList_(bossRaw, email), unrestricted: false };
}

// ────────────────────────────────────────────── 讀表（batchGet）

/**
 * 一次往返把整份試算表讀回來。
 *
 * 為什麼這裡可以用 batchGet 而簽核程式不行：那邊每次只動一列、而且會寫回去，
 * 日期轉錯就是漏單漏錢；這裡是全量唯讀，轉不出來的日期歸「日期不明」並顯示筆數。
 * 換到的是 17 個分頁一次讀完，而不是每個分頁 3 次 API 往返。
 */
function fetchAll_() {
  var id = prop_('DISPATCH_SHEET_ID');
  if (!id) throw new Error('未設定指令碼屬性 DISPATCH_SHEET_ID');
  if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets) {
    throw new Error('未啟用 Google Sheets API 進階服務。' +
      '請到「服務 → 新增服務 → Google Sheets API」加入（識別碼須為 Sheets）。');
  }

  var meta = Sheets.Spreadsheets.get(id, { fields: 'sheets.properties.title' });
  var titles = [];
  var metaSheets = (meta && meta.sheets) || [];
  for (var i = 0; i < metaSheets.length; i++) {
    var t = metaSheets[i].properties && metaSheets[i].properties.title;
    if (t) titles.push(t);
  }
  if (!titles.length) throw new Error('試算表沒有任何分頁（DISPATCH_SHEET_ID 是否正確？）');

  var ranges = [];
  for (var r = 0; r < titles.length; r++) {
    // 分頁名可能含單引號；A1 表示法用兩個單引號跳脫
    ranges.push("'" + titles[r].replace(/'/g, "''") + "'!A:CV");
  }

  var res = Sheets.Spreadsheets.Values.batchGet(id, {
    ranges: ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER'
  });

  var out = {};
  var vrs = (res && res.valueRanges) || [];
  for (var k = 0; k < titles.length; k++) {
    out[titles[k]] = (vrs[k] && vrs[k].values) || [];
  }
  return { titles: titles, byName: out };
}

/** 建立單一發包分頁的欄位對照。沒有「發包單號」表頭回 null（非發包分頁）。 */
function ctxOf_(name, values) {
  if (!values || !values.length) return null;
  var headerRow = detectHeaderRowIn_(values, COL_ORDER_NO);
  if (!headerRow) return null;
  var col = headerMapOf_(values[headerRow - 1]);
  applyAliases_(col);
  if (!col[COL_ORDER_NO]) return null;
  return { name: name, headerRow: headerRow, col: col, values: values };
}

/** 取一列的第 c 欄（1-based）原始值。超出範圍回空字串。 */
function at_(row, c) {
  if (!c || !row || c > row.length) return '';
  var v = row[c - 1];
  return v == null ? '' : v;
}

function str_(row, c) {
  var v = at_(row, c);
  return (typeof v === 'string') ? v.trim() : String(v);
}

/** 把 fetchAll_ 的結果拆成：發包分頁清單、出貨明細、選單、人員代碼。 */
function splitBook_(book) {
  var sheets = [], shipment = null, options = null, roster = null;

  for (var i = 0; i < book.titles.length; i++) {
    var name = book.titles[i];
    var values = book.byName[name];

    if (name === SHIPMENT_SHEET) {
      var hr = detectHeaderRowIn_(values, COL_S_SHIP_NO);
      if (hr) shipment = { name: name, headerRow: hr, col: headerMapOf_(values[hr - 1]), values: values };
      continue;
    }
    if (name === OPTIONS_SHEET) {
      var ho = detectHeaderRowIn_(values, OPT_CHANNEL);
      if (ho) options = { name: name, headerRow: ho, col: headerMapOf_(values[ho - 1]), values: values };
      continue;
    }
    if (isSystemSheet_(name)) {
      var hrr = detectHeaderRowIn_(values, COL_R_CODE);
      if (hrr) roster = { name: name, headerRow: hrr, col: headerMapOf_(values[hrr - 1]), values: values };
      continue;
    }
    var ctx = ctxOf_(name, values);
    if (ctx) sheets.push(ctx);
  }

  return { sheets: sheets, shipment: shipment, options: options, roster: roster };
}

/** 人員代碼對照：代碼 → { sales, assist, type }。讀不到回空物件（點名不到人而已）。 */
function rosterOf_(rosterSheet) {
  var out = {};
  if (!rosterSheet) return out;
  var col = rosterSheet.col;
  if (!col[COL_R_CODE]) return out;
  for (var i = rosterSheet.headerRow; i < rosterSheet.values.length; i++) {
    var row = rosterSheet.values[i];
    var code = str_(row, col[COL_R_CODE]).toUpperCase();
    if (!code) continue;
    out[code] = {
      code: code,
      sales: str_(row, col[COL_R_SALES]),
      type: str_(row, col[COL_R_TYPE]),
      assist: str_(row, col[COL_R_ASSIST])
    };
  }
  return out;
}

/** 「選單」分頁的購買通路清單。讀不到就用預設值（分組仍可運作）。 */
var DEFAULT_CHANNELS = ['MOMO', '蝦皮', '官網', '散戶'];
function channelsOf_(optionsSheet) {
  if (!optionsSheet || !optionsSheet.col[OPT_CHANNEL]) return DEFAULT_CHANNELS.slice();
  var c = optionsSheet.col[OPT_CHANNEL], out = [];
  for (var i = optionsSheet.headerRow; i < optionsSheet.values.length; i++) {
    var v = str_(optionsSheet.values[i], c);
    if (v && out.indexOf(v) < 0) out.push(v);
  }
  return out.length ? out : DEFAULT_CHANNELS.slice();
}

var OTHER_CHANNEL = '其他';
/** 案名 → 通路分類。用包含比對，因為案名常寫成「MOMO 8月團購」這種。 */
function channelOf_(project, list) {
  var p = normHeader_(project).toUpperCase();
  if (!p) return '';
  for (var i = 0; i < list.length; i++) {
    var key = normHeader_(list[i]).toUpperCase();
    if (key && p.indexOf(key) >= 0) return list[i];
  }
  return OTHER_CHANNEL;
}

// ────────────────────────────────────────────── 欄名一致性檢查

/**
 * 把「本程式認得的欄名」與「表上實際存在的欄名」比對。
 *
 * 這支存在的理由：欄名常數是從簽核程式**複製**過來的，複製品一定會腐化。
 * 靠人記得同步不可靠，靠文件寫「記得同步」更不可靠——
 * 會變動的事實要寫成可執行的檢查。
 *
 * 只報「表上有、程式不認得」的方向：那才是會讓報表安靜少一欄的情況。
 */
function knownHeaderSet_() {
  var set = {};
  var std = [COL_ORDER_NO, COL_APPLY_AT, COL_WORKER, COL_CUSTOMER, COL_PROJECT, COL_MODEL,
    COL_QTY, COL_QUOTE_QTY, COL_ACCUM_QTY, COL_WAGE, COL_UNIT, COL_PRICE, COL_DISPATCHER,
    COL_NOTE, COL_APPROVAL, COL_SUB_APPROVAL, COL_STATUS,
    COL_S_AT, COL_S_SHIP_NO, COL_S_ORDER_ID, COL_S_DISPATCH, COL_S_CUSTOMER, COL_S_PROJECT,
    COL_S_ITEMS, COL_S_TO_NAME, COL_S_TO_PHONE, COL_S_TO_ADDR, COL_S_INVOICE, COL_S_NOTE,
    COL_S_BY, COL_S_WH_STATUS, COL_S_WH_BY, COL_S_WH_AT, COL_S_WH_NOTE, COL_S_SHIP_DATE,
    COL_S_CHANNEL_NO, COL_S_CUST_NAME, COL_S_CUST_PHONE, COL_S_CUST_ADDR, COL_S_SALE_PRICE,
    COL_S_COST_PRICE, COL_S_ORDER_BY, COL_S_WORK_TIME, COL_S_WORK_ITEM,
    COL_R_CODE, COL_R_SALES, COL_R_SALES_MAIL, COL_R_TYPE, COL_R_ASSIST, COL_R_ASSIST_MAIL,
    COL_R_SHEET, OPT_CHANNEL, OPT_MODEL, OPT_ITEM, OPT_WORKER, OPT_INVOICE];
  for (var i = 0; i < std.length; i++) set[normHeader_(std[i])] = true;
  for (var k in COL_ALIAS) {
    for (var j = 0; j < COL_ALIAS[k].length; j++) set[normHeader_(COL_ALIAS[k][j])] = true;
  }
  for (var u = 0; u < KNOWN_UNUSED_HEADERS.length; u++) set[normHeader_(KNOWN_UNUSED_HEADERS[u])] = true;
  return set;
}

function parityOf_(parts) {
  var known = knownHeaderSet_();
  var out = [];
  var targets = parts.sheets.slice();
  if (parts.shipment) targets.push(parts.shipment);

  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var head = t.values[t.headerRow - 1] || [];
    var unknown = [];
    for (var c = 0; c < head.length; c++) {
      var key = normHeader_(head[c]);
      if (!key || known[key]) continue;
      if (unknown.indexOf(key) < 0) unknown.push(key);
    }
    if (unknown.length) out.push({ sheet: t.name, headers: unknown });
  }
  return out;
}

/** 可在編輯器直接執行：印出欄名比對結果。 */
function checkFieldParity() {
  var parts = splitBook_(fetchAll_());
  var rows = parityOf_(parts);
  if (!rows.length) {
    Logger.log('✅ 沒有本程式不認得的欄名（掃描 ' + parts.sheets.length + ' 個發包分頁）');
    return rows;
  }
  Logger.log('⚠ 以下欄名實際存在於表上，但本程式不認得（可能是新增欄，或欄名被改過）：');
  for (var i = 0; i < rows.length; i++) {
    Logger.log('  ' + rows[i].sheet + '：' + rows[i].headers.join('、'));
  }
  return rows;
}

// ────────────────────────────────────────────── 統計

/** 起算日。未設定時 warn=true，呼叫端**必須**把警告顯示出來。 */
function sinceOf_() {
  var raw = String(prop_('REPORT_SINCE') || '').trim();
  var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { since: '', warn: true, raw: raw };
  return { since: raw, warn: false, raw: raw };
}

function outlierOf_() {
  var n = Number(prop_('REPORT_OUTLIER_AMOUNT'));
  return (isFinite(n) && n > 0) ? n : DEFAULT_OUTLIER;
}

/**
 * 從簽核欄的文字取出時間。實際內容像
 *   「✅ 核准 email 2026-08-06 09:12」
 * 取不到回空字串，呼叫端歸入「無法計算」並計數——不可猜。
 */
function approvedAtOf_(v) {
  if (v instanceof Date || typeof v === 'number') return toYmdHm_(v);
  var s = String(v == null ? '' : v);
  if (!s.trim()) return '';
  return toYmdHm_(s);
}

function isApproved_(v) {
  return /^\s*✅/.test(String(v == null ? '' : v));
}

function addStat_(bag, key, fields) {
  if (!bag[key]) {
    bag[key] = { name: key };
    for (var f in fields) bag[key][f] = 0;
  }
  return bag[key];
}

function sortDesc_(map, field) {
  var keys = Object.keys(map), out = [];
  for (var i = 0; i < keys.length; i++) out.push(map[keys[i]]);
  out.sort(function (a, b) { return b[field] - a[field]; });
  return out;
}

/**
 * 篩選條件正規化。接受字串（＝只給基準，沿用舊呼叫方式）或物件。
 *
 * 起算日與使用者選的起日取「較晚的那個」：REPORT_SINCE 存在的理由是
 * 更早的資料本身不可信，讓畫面上的日期選擇器繞過它，等於把那個理由取消掉。
 * 被夾住時回傳 clamped，畫面要講出來——不能讓人以為自己看到的是 2024 年的數字。
 */
function optsOf_(o) {
  if (typeof o === 'string' || o == null) o = { basis: o };
  var sinceInfo = sinceOf_();
  var from = String(o.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? o.from : '';
  var to = String(o.to || '').match(/^\d{4}-\d{2}-\d{2}$/) ? o.to : '';
  var clamped = false;
  if (sinceInfo.since && (!from || from < sinceInfo.since)) {
    clamped = !!from;
    from = sinceInfo.since;
  }
  return {
    basis: (o.basis === BASIS_APPLY) ? BASIS_APPLY : BASIS_SHIP,
    from: from,
    to: to,
    clamped: clamped,
    worker: String(o.worker || '').trim(),
    sales: String(o.sales || '').trim(),
    since: sinceInfo.since,
    sinceWarn: sinceInfo.warn
  };
}

/** 日期在區間內嗎。空字串的邊界代表不限。 */
function inRange_(ymd, from, to) {
  if (!ymd) return false;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

/**
 * 主統計。basis 決定「每一筆用哪個日期分組」，**金額來源不變**——
 * 換基準只換分組的日期軸，否則兩個基準的數字沒有可比性。
 * 換不到基準日期的筆數會列在「日期不明」，不會被安靜丟掉。
 *
 * 師傅／業務的篩選同時作用在兩邊的資料：出貨明細沒有承包商欄，
 * 但它有發包單號，可以回查發包分頁的承包商——不做這層回查的話，
 * 選了師傅之後「業務銷售額」會維持全部，看起來像沒篩到。
 */
function buildReport_(o) {
  var opts = optsOf_(o);
  var basis = opts.basis;
  var from = opts.from, to = opts.to;

  var book = fetchAll_();
  var parts = splitBook_(book);
  var limit = outlierOf_();
  var roster = rosterOf_(parts.roster);
  var channelList = channelsOf_(parts.options);

  var out = {
    basis: basis,
    from: from,
    to: to,
    clamped: opts.clamped,
    worker: opts.worker,
    salesPick: opts.sales,
    options: { workers: [], sales: [] },
    since: opts.since,
    sinceWarn: opts.sinceWarn,
    sheetCount: parts.sheets.length,
    sheetNames: [],
    overbilling: { rows: [], uncheckable: [], checked: 0, skipped: 0 },
    months: [],
    sales: [],
    channels: [],
    workers: [],
    gaps: {},
    audit: {
      unknownDate: { shipment: 0, dispatch: 0 },
      excludedByRange: { shipment: 0, dispatch: 0 },
      noShipNo: 0,
      nonNumeric: [],
      outliers: [],
      workerDupes: [],
      unknownCodes: [],
      noCost: 0
    },
    parity: parityOf_(parts),
    errors: []
  };
  for (var sn = 0; sn < parts.sheets.length; sn++) out.sheetNames.push(parts.sheets[sn].name);

  // ── ① 發包分頁：超額請款、承包商工資、申請日索引 ──────────────
  var applyByNo = {};      // 發包單號 → 申請日 YYYY-MM-DD
  var approvedByNo = {};   // 發包單號 → 主管核准時間 YYYY-MM-DD HH:mm
  // 已核准、但簽核文字裡沒有可解析的時間。這種列不能當成「沒核准」而消失，
  // 也不能當成 0 天混進平均——它是「無法計算」，要單獨計數。
  var approvedNoTs = 0;
  var byWorker = {};
  // 出貨明細沒有承包商欄，靠發包單號回查。師傅篩選要作用在營收那幾區就得靠它。
  var workerByNo = {};

  for (var s = 0; s < parts.sheets.length; s++) {
    var ctx = parts.sheets[s];
    var col = ctx.col;
    var noCol = col[COL_ORDER_NO];

    // 超額請款：兩個欄位缺任一個就無法比對。**具名列出，不可靜默略過**——
    // 這是唯一會直接造成金錢損失的檢查，「沒查到」與「沒有查」必須分得開。
    var missing = [];
    if (!col[COL_QUOTE_QTY]) missing.push(COL_QUOTE_QTY + '／' + '合約數量');
    if (!col[COL_ACCUM_QTY]) missing.push(COL_ACCUM_QTY);
    if (missing.length) out.overbilling.uncheckable.push({ sheet: ctx.name, missing: missing });

    for (var r = ctx.headerRow; r < ctx.values.length; r++) {
      var row = ctx.values[r];
      var orderNo = str_(row, noCol);
      if (!ORDER_NO_RE.test(orderNo)) continue;
      var sheetRow = r + 1;

      var applyYmd = toYmd_(at_(row, col[COL_APPLY_AT]));
      if (applyYmd) {
        if (!applyByNo[orderNo]) applyByNo[orderNo] = applyYmd;
      } else {
        out.audit.unknownDate.dispatch++;
      }

      var appVal = at_(row, col[COL_APPROVAL]);
      if (isApproved_(appVal)) {
        var ts = approvedAtOf_(appVal);
        if (ts) { if (!approvedByNo[orderNo]) approvedByNo[orderNo] = ts; }
        else approvedNoTs++;
      }

      // 超額請款不受起算日限制：起算日是為了讓「統計數字可信」，
      // 但少付／多付錢沒有時效——舊單超額了現在才發現，錢一樣是付出去的。
      if (!missing.length) {
        var qRaw = at_(row, col[COL_QUOTE_QTY]);
        var aRaw = at_(row, col[COL_ACCUM_QTY]);
        var qEmpty = String(qRaw).trim() === '', aEmpty = String(aRaw).trim() === '';
        if (qEmpty || aEmpty || isNonNumeric_(qRaw) || isNonNumeric_(aRaw)) {
          out.overbilling.skipped++;
        } else {
          out.overbilling.checked++;
          var quote = num_(qRaw), accum = num_(aRaw);
          if (accum > quote) {
            out.overbilling.rows.push({
              sheet: ctx.name, row: sheetRow, orderNo: orderNo,
              worker: str_(row, col[COL_WORKER]),
              customer: str_(row, col[COL_CUSTOMER]),
              quote: quote, accum: accum, diff: accum - quote
            });
          }
        }
      }

      // 承包商工資：先收原始列，分組要等基準日期決定（出貨日要靠出貨明細回填）
      var wname = str_(row, col[COL_WORKER]);
      if (!wname) continue;
      var priceRaw = col[COL_PRICE] ? at_(row, col[COL_PRICE]) : '';
      if (isNonNumeric_(priceRaw) && out.audit.nonNumeric.length < 50) {
        out.audit.nonNumeric.push({ sheet: ctx.name, row: sheetRow, orderNo: orderNo,
          field: COL_PRICE, value: String(priceRaw).slice(0, 20) });
      }
      var price = num_(priceRaw);
      if (price > limit || price < 0) {
        if (out.audit.outliers.length < 50) {
          out.audit.outliers.push({ sheet: ctx.name, row: sheetRow, orderNo: orderNo,
            field: COL_PRICE, value: price });
        }
      }
      if (!workerByNo[orderNo]) workerByNo[orderNo] = wname;
      if (!byWorker[wname]) byWorker[wname] = { name: wname, count: 0, price: 0, months: {} };
      byWorker[wname]._rows = byWorker[wname]._rows || [];
      byWorker[wname]._rows.push({ orderNo: orderNo, applyYmd: applyYmd, price: price });
    }
  }

  out.overbilling.rows.sort(function (a, b) { return b.diff - a.diff; });

  // ── ② 出貨明細：出貨日索引、業務／通路銷售額 ──────────────────
  var shipByNo = {};   // 發包單號 → 最早出貨日
  var bySales = {}, byChannel = {}, byMonth = {}, otherProjects = {};
  var unknownCodes = {}, allSales = {};
  var gapShipToWh = [], gapApproveToShip = [];

  if (!parts.shipment) {
    out.errors.push('找不到「' + SHIPMENT_SHEET + '」分頁，或它沒有「' + COL_S_SHIP_NO + '」表頭。' +
      '業務／通路銷售額與出貨日基準全部無法統計。');
  } else {
    var sc = parts.shipment.col;
    var sv = parts.shipment.values;
    for (var i2 = parts.shipment.headerRow; i2 < sv.length; i2++) {
      var srow = sv[i2];
      var shipNo = str_(srow, sc[COL_S_SHIP_NO]);
      var dispatchNo = str_(srow, sc[COL_S_DISPATCH]);
      var shipYmd = toYmd_(at_(srow, sc[COL_S_SHIP_DATE]));

      // 出貨日索引：**不看有沒有出貨單號**——時間間距分析要的是「東西什麼時候出去」
      if (dispatchNo && shipYmd && (!shipByNo[dispatchNo] || shipYmd < shipByNo[dispatchNo])) {
        shipByNo[dispatchNo] = shipYmd;
      }

      // 出貨→倉庫核單（與基準無關，出貨明細自己就有兩個時間戳）
      var whAt = toYmdHm_(at_(srow, sc[COL_S_WH_AT]));
      if (shipYmd && whAt) {
        var g1 = msOf_(whAt) - msOf_(shipYmd);
        if (g1 >= 0) gapShipToWh.push({ days: g1 / 86400000, no: shipNo || dispatchNo });
      }

      // 營收統計：未鍵出貨單號的不計入（規格 §1：銀貨兩訖才算營收）
      if (!shipNo) { out.audit.noShipNo++; continue; }

      // 業務歸屬：優先用「下單業務」，沒有就用發包單號前綴查對照表。
      // 這一段要在所有 continue 之前算完——下拉選單得收齊**所有出現過**的業務，
      // 放在日期檢查之後的話，沒有發包單號的那些單在申請日基準下會先被踢掉，
      // 那位業務就從選單裡消失，看起來像系統不認得她。
      var who = str_(srow, sc[COL_S_ORDER_BY]);
      var code = codeOf_(dispatchNo);
      if (!who && code && roster[code]) who = roster[code].sales || code;
      if (!who && code) { who = code; unknownCodes[code] = (unknownCodes[code] || 0) + 1; }
      if (!who) who = '（未標示）';
      allSales[who] = true;

      var when = (basis === BASIS_SHIP) ? shipYmd : (dispatchNo ? applyByNo[dispatchNo] : '');
      if (!when) { out.audit.unknownDate.shipment++; continue; }
      if (!inRange_(when, from, to)) { out.audit.excludedByRange.shipment++; continue; }

      // 用「年-月」當鍵，不是只用月——否則 2025-12 會跟 2026-12 併在一起
      var mk = when.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(mk)) { out.audit.unknownDate.shipment++; continue; }

      if (opts.sales && who !== opts.sales) continue;
      // 選了師傅時，出貨列靠發包單號回查承包商。沒有發包單號的出貨（料件那一類）
      // 查不到承包商，選了師傅就不該算進來——它本來就不是那位師傅的工。
      if (opts.worker && (workerByNo[dispatchNo] || '') !== opts.worker) continue;

      var saleRaw = at_(srow, sc[COL_S_SALE_PRICE]);
      var costRaw = at_(srow, sc[COL_S_COST_PRICE]);
      if (isNonNumeric_(saleRaw) && out.audit.nonNumeric.length < 50) {
        out.audit.nonNumeric.push({ sheet: SHIPMENT_SHEET, row: i2 + 1, orderNo: shipNo,
          field: COL_S_SALE_PRICE, value: String(saleRaw).slice(0, 20) });
      }
      var sale = num_(saleRaw), cost = num_(costRaw);
      var hasCost = String(costRaw).trim() !== '' && !isNonNumeric_(costRaw);
      if (!hasCost) out.audit.noCost++;
      if (sale > limit || sale < 0) {
        if (out.audit.outliers.length < 50) {
          out.audit.outliers.push({ sheet: SHIPMENT_SHEET, row: i2 + 1, orderNo: shipNo,
            field: COL_S_SALE_PRICE, value: sale });
        }
      }

      if (!byMonth[mk]) byMonth[mk] = { month: mk, count: 0, sale: 0 };
      byMonth[mk].count++;
      byMonth[mk].sale += sale;

      var sr = addStat_(bySales, who, { count: 0, sale: 0, profit: 0, profitRows: 0 });
      sr.count++; sr.sale += sale;
      if (hasCost) { sr.profit += (sale - cost); sr.profitRows++; }

      var project = str_(srow, sc[COL_S_PROJECT]);
      var ch = channelOf_(project, channelList) || '（未填案名）';
      var cr = addStat_(byChannel, ch, { count: 0, sale: 0 });
      cr.count++; cr.sale += sale;
      if (ch === OTHER_CHANNEL && project) {
        otherProjects[project] = (otherProjects[project] || 0) + 1;
      }

      // 簽核→出貨
      var appTs = dispatchNo ? approvedByNo[dispatchNo] : '';
      if (appTs && shipYmd) {
        var g2 = msOf_(shipYmd) - msOf_(appTs);
        if (g2 >= -86400000) gapApproveToShip.push({ days: Math.max(0, g2) / 86400000, no: dispatchNo });
      }
    }
  }

  var mkeys = Object.keys(byMonth).sort();
  if (mkeys.length > 24) mkeys = mkeys.slice(mkeys.length - 24);
  for (var m3 = 0; m3 < mkeys.length; m3++) out.months.push(byMonth[mkeys[m3]]);
  out.sales = sortDesc_(bySales, 'sale');
  out.channels = sortDesc_(byChannel, 'sale');
  out.audit.unknownCodes = Object.keys(unknownCodes);
  out.audit.otherProjects = Object.keys(otherProjects).sort(function (a, b) {
    return otherProjects[b] - otherProjects[a];
  }).slice(0, 15).map(function (p) { return { name: p, count: otherProjects[p] }; });

  // ── ③ 承包商工資：依基準日期分月 ────────────────────────────
  var wkeys = Object.keys(byWorker);
  for (var w = 0; w < wkeys.length; w++) {
    var wk = byWorker[wkeys[w]];
    var rows = wk._rows || [];
    for (var wr = 0; wr < rows.length; wr++) {
      var rec = rows[wr];
      var when2 = (basis === BASIS_SHIP) ? (shipByNo[rec.orderNo] || '') : (rec.applyYmd || '');
      if (!when2) { out.audit.unknownDate.dispatch++; continue; }
      if (!inRange_(when2, from, to)) { out.audit.excludedByRange.dispatch++; continue; }
      if (opts.worker && wk.name !== opts.worker) continue;
      // 發包分頁沒有「下單業務」欄，業務身分只能從單號前綴推。查不到對照的
      // 就用代碼本身比對——與出貨明細那邊的規則一致（見上方 who 的推導）。
      if (opts.sales) {
        var c2 = codeOf_(rec.orderNo);
        var s2 = (c2 && roster[c2] && roster[c2].sales) ? roster[c2].sales : c2;
        if (s2 !== opts.sales) continue;
      }
      var mk2 = when2.slice(0, 7);
      wk.count++;
      wk.price += rec.price;
      if (!wk.months[mk2]) wk.months[mk2] = { month: mk2, count: 0, price: 0 };
      wk.months[mk2].count++;
      wk.months[mk2].price += rec.price;
    }
    delete wk._rows;
    var mo = Object.keys(wk.months).sort();
    var arr = [];
    for (var mi = 0; mi < mo.length; mi++) arr.push(wk.months[mo[mi]]);
    wk.months = arr;
  }
  out.workers = sortDesc_(byWorker, 'price').filter(function (x) { return x.count > 0; });

  // 下拉選單的選項：收全部出現過的名字，**不受目前篩選影響**——
  // 篩過之後才建選單的話，選了某位師傅就再也選不回別人（清單只剩他一個）。
  out.options.workers = wkeys.slice().sort();
  out.options.sales = Object.keys(allSales).sort();

  // 超額請款不吃日期篩選（多付的錢沒有時效），但吃師傅／業務篩選——
  // 選了某位師傅就是要看他的事，其他人的警示留在畫面上只是雜訊。
  if (opts.worker || opts.sales) {
    out.overbilling.rows = out.overbilling.rows.filter(function (r) {
      if (opts.worker && r.worker !== opts.worker) return false;
      if (opts.sales) {
        var c3 = codeOf_(r.orderNo);
        var s3 = (c3 && roster[c3] && roster[c3].sales) ? roster[c3].sales : c3;
        if (s3 !== opts.sales) return false;
      }
      return true;
    });
  }

  // ── ④ 時間間距 ────────────────────────────────────────────
  var gapApplyToApprove = [];
  for (var no in approvedByNo) {
    var a1 = applyByNo[no];
    if (!a1) continue;
    var d = msOf_(approvedByNo[no]) - msOf_(a1);
    if (d >= -86400000) gapApplyToApprove.push({ days: Math.max(0, d) / 86400000, no: no });
  }
  var approvedCount = Object.keys(approvedByNo).length;
  out.gaps.applyToApprove = statOf_(gapApplyToApprove, '下單→簽核',
    approvedNoTs + Math.max(0, approvedCount - gapApplyToApprove.length));
  out.gaps.approveToShip = statOf_(gapApproveToShip, '簽核→出貨', 0);
  out.gaps.shipToWarehouse = statOf_(gapShipToWh, '出貨→倉庫核單', 0);

  // ── ⑤ 承包商名稱不一致（只提示疑似，**不自動合併**）──────────
  var groups = {};
  for (var g3 = 0; g3 < wkeys.length; g3++) {
    var base = wkeys[g3].replace(WORKER_SUFFIX_RE, '').replace(/[\s　]+/g, '');
    if (!base) continue;
    if (!groups[base]) groups[base] = [];
    groups[base].push(wkeys[g3]);
  }
  for (var b3 in groups) {
    if (groups[b3].length > 1) out.audit.workerDupes.push(groups[b3]);
  }

  return out;
}

/** 一組間距的平均／最久。unknown 是「該有這段間距、但時間取不到」的筆數。 */
function statOf_(list, label, unknown) {
  var s = { label: label, n: list.length, avg: 0, max: 0, maxNo: '', unknown: unknown || 0 };
  if (!list.length) return s;
  var sum = 0;
  for (var i = 0; i < list.length; i++) {
    sum += list[i].days;
    if (list[i].days > s.max) { s.max = list[i].days; s.maxNo = list[i].no; }
  }
  s.avg = Math.round(sum / list.length * 10) / 10;
  s.max = Math.round(s.max * 10) / 10;
  return s;
}

// ────────────────────────────────────────────── 對外進入點

/**
 * 報表資料。**僅副主管／主管**。
 * 這裡自己再擋一次，不能只靠 doGet 的路由判斷（網址參數是使用者可以改的）。
 */
function getReport(o) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分（部署的存取權要選「機構內的任何人」）。' };
  var roles = stagesFor_(email);
  if (!roles.boss && !roles.sub) {
    return { ok: false, message: '報表僅限副主管／主管檢視（' + email + '）。' };
  }
  var opts = optsOf_(o);

  // 快取鍵含全部篩選條件：少帶任何一個，換了條件卻會拿到上一次的結果，
  // 而那個錯誤看起來像「篩選沒有作用」，最難查。
  var key = REPORT_CACHE_PREFIX + cacheVer_() + '|' +
    [opts.basis, opts.from, opts.to, opts.worker, opts.sales].join('|');
  try {
    var hit = CacheService.getScriptCache().get(key);
    if (hit) {
      var obj = JSON.parse(hit);
      if (obj && obj.data) return { ok: true, data: obj.data, at: obj.at, cached: true,
        unrestricted: roles.unrestricted };
    }
  } catch (err) {
    Logger.log('讀報表快取失敗，改為重新統計：' + err);
  }

  try {
    var data = buildReport_(opts);
    var at = Utilities.formatDate(new Date(), TZ, 'MM-dd HH:mm');
    try {
      var payload = JSON.stringify({ data: data, at: at });
      if (payload.length <= CACHE_MAX_BYTES) {
        CacheService.getScriptCache().put(key, payload, REPORT_CACHE_TTL);
      }
    } catch (e2) { Logger.log('寫報表快取失敗：' + e2); }
    return { ok: true, data: data, at: at, cached: false, unrestricted: roles.unrestricted };
  } catch (err) {
    return { ok: false, message: '統計失敗：' + err };
  }
}

/**
 * 清快取。篩選條件是使用者自由組合的，快取鍵有無限多種，列舉不完，
 * 所以改成把版本號往上加一，舊的鍵自然再也對不上（15 分鐘後自己過期）。
 *
 * ⚠ 這會寫入**指令碼屬性**，不是試算表。本程式的唯讀保證是對資料而言的，
 *   自己的設定不在其中。
 */
function cacheVer_() {
  return String(prop_('REPORT_CACHE_VER') || '1');
}

function clearReportCache() {
  var next = String((Number(cacheVer_()) || 1) + 1);
  PropertiesService.getScriptProperties().setProperty('REPORT_CACHE_VER', next);
  return '已清除報表快取（版本 → ' + next + '）';
}

/** 部署自檢：在編輯器直接執行，把設定與讀表狀況一次印出來。 */
function checkReportSetup() {
  var lines = [];
  var id = prop_('DISPATCH_SHEET_ID');
  lines.push(id ? '✅ DISPATCH_SHEET_ID 已設定' : '🔴 缺 DISPATCH_SHEET_ID');
  var si = sinceOf_();
  lines.push(si.warn
    ? '🔴 REPORT_SINCE 未設定或格式不對（' + (si.raw || '空') + '）：報表會統計全部歷史，' +
      '包含那些 900 多天前的殘留資料，數字不可信'
    : '✅ REPORT_SINCE = ' + si.since);
  lines.push('・金額極端值門檻 = ' + outlierOf_());
  var boss = String(prop_('DISPATCH_BOSS_APPROVERS') || '').trim();
  var sub = String(prop_('DISPATCH_SUB_APPROVERS') || '').trim();
  lines.push((boss || sub) ? '✅ 已設定主管名單' : '⚠ 主管名單皆未設定：目前任何登入者都看得到金額');

  try {
    var parts = splitBook_(fetchAll_());
    lines.push('✅ batchGet 讀表成功：發包分頁 ' + parts.sheets.length + ' 個');
    lines.push(parts.shipment ? '✅ 找到「' + SHIPMENT_SHEET + '」'
      : '🔴 找不到「' + SHIPMENT_SHEET + '」，營收統計無法運作');
    lines.push(parts.roster ? '✅ 找到人員代碼對照表' : '⚠ 找不到人員代碼對照表，業務歸屬只會顯示代碼');
    var uncheck = [];
    for (var i = 0; i < parts.sheets.length; i++) {
      var c = parts.sheets[i].col;
      if (!c[COL_QUOTE_QTY] || !c[COL_ACCUM_QTY]) uncheck.push(parts.sheets[i].name);
    }
    lines.push(uncheck.length
      ? '🔴 無法檢查超額請款的分頁：' + uncheck.join('、')
      : '✅ 所有分頁都有報價／累計數量欄，超額請款可全量檢查');
    var par = parityOf_(parts);
    lines.push(par.length ? '⚠ 有不認得的欄名，請執行 checkFieldParity() 看細節（' + par.length + ' 個分頁）'
      : '✅ 欄名比對無異常');
  } catch (err) {
    lines.push('🔴 讀表失敗：' + err);
  }

  var txt = lines.join('\n');
  Logger.log(txt);
  return txt;
}

function doGet(e) {
  var email = currentUserEmail_();
  if (!email) {
    return htmlPage_(errorBlock_('無法辨識您的身分',
      '請用公司 Google 帳號登入，且部署設定的「具有存取權的使用者」要是「機構內的任何人」。'));
  }
  var roles = stagesFor_(email);
  if (!roles.boss && !roles.sub) {
    return htmlPage_(errorBlock_('報表僅限主管檢視',
      email + ' 不在副主管或主管名單中。報表的本質是彙總金額，' +
      '「毛利」一旦顯示就等於把進價反推出來，所以整頁限制而不是遮欄位。'));
  }
  var basis = String((e && e.parameter && e.parameter.basis) || BASIS_SHIP);
  return htmlPage_(reportBlock_(email, basis === BASIS_APPLY ? BASIS_APPLY : BASIS_SHIP,
    sinceOf_().since));
}

// ────────────────────────────────────────────── 畫面

function htmlPage_(bodyHtml) {
  var css =
    '*{box-sizing:border-box;margin:0;padding:0;font-family:"Noto Sans TC",-apple-system,sans-serif}' +
    'body{background:#EEF2F7;color:#1E293B;padding:16px;max-width:860px;margin:0 auto}' +
    '.hd{display:flex;align-items:center;gap:10px;margin-bottom:14px}' +
    '.hd .ic{width:38px;height:38px;background:#0F2744;border-radius:9px;display:flex;' +
      'align-items:center;justify-content:center;font-size:19px}' +
    '.hd h1{font-size:17px;font-weight:700}.hd p{font-size:11.5px;color:#64748B}' +
    '.card{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:10px;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.08)}' +
    '.card.alert{border:1.5px solid #FCA5A5;background:#FFF5F5}' +
    '.ometa{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;flex-wrap:wrap}' +
    '.ometa b{font-size:13.5px;color:#0F2744}.ometa span{font-size:11px;color:#94A3B8}' +
    '.msg{padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.6;margin-bottom:10px}' +
    '.msg.fail{background:#FEE2E2;color:#991B1B}.msg.done{background:#D1FAE5;color:#065F46}' +
    '.msg.warn{background:#FEF3C7;color:#92400E}' +
    '.center{text-align:center;color:#64748B;font-size:13px;padding:36px 0}' +
    '.note{font-size:11px;color:#94A3B8;margin-top:8px;line-height:1.6}' +
    '.whrow{font-size:13px;color:#334155;margin-top:5px}' +
    '.whrow b{display:inline-block;min-width:92px;color:#64748B;font-weight:600;font-size:11.5px}' +
    '.whlab{font-size:11px;font-weight:700;color:#64748B;margin:9px 0 3px;letter-spacing:.04em}' +
    'table{width:100%;border-collapse:collapse;font-size:12.5px}' +
    'th{text-align:left;color:#64748B;font-weight:600;padding:5px 8px 5px 0;white-space:nowrap;' +
      'border-bottom:1px solid #E2E8F0}' +
    'td{padding:5px 8px 5px 0;color:#1E293B;border-bottom:1px solid #F1F5F9;vertical-align:top}' +
    'td.n{text-align:right;font-variant-numeric:tabular-nums}' +
    '.bad{color:#B91C1C;font-weight:800}' +
    '.tabs{display:flex;gap:6px;margin-bottom:12px}' +
    '.tab{padding:7px 16px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;' +
      'background:#fff;color:#64748B;border:1px solid #E2E8F0}' +
    '.tab.on{background:#0F2744;color:#fff;border-color:#0F2744}' +
    // ── 篩選列 ──
    '.filt .frow{display:flex;gap:9px;align-items:flex-end;flex-wrap:wrap}' +
    '.filt .fi{display:flex;flex-direction:column;gap:3px;min-width:0}' +
    '.filt label{font-size:11px;font-weight:700;color:#64748B}' +
    '.filt input,.filt select{border:1px solid #E2E8F0;border-radius:7px;padding:7px 9px;' +
      'font-size:13px;font-family:inherit;outline:none;background:#fff;color:#1E293B;' +
      'min-height:36px;max-width:100%}' +
    '.filt input:focus,.filt select:focus{border-color:#38BDF8}' +
    '.filt select{min-width:112px}' +
    '.filt button{padding:8px 18px;border:none;border-radius:7px;font-size:13.5px;' +
      'font-weight:700;cursor:pointer;font-family:inherit;background:#0F2744;color:#fff;' +
      'min-height:36px}' +
    '.filt button.ghost{background:#F1F5F9;color:#475569}' +
    '.filt button:disabled{opacity:.45;cursor:not-allowed}' +
    // 純 CSS 條狀圖：不引入外部圖表庫（GAS 網頁應用程式沒有 CDN 保證，也不想多一個依賴）
    '.brow{display:flex;align-items:center;gap:9px;margin:6px 0;font-size:12.5px}' +
    '.blab{width:96px;flex:none;color:#475569;font-weight:600;word-break:break-all}' +
    '.btrack{flex:1;min-width:40px;height:22px;background:#F1F5F9;border-radius:5px;overflow:hidden}' +
    '.bfill{height:100%;background:linear-gradient(90deg,#0F2744,#38BDF8);border-radius:5px}' +
    '.bval{width:150px;flex:none;text-align:right;color:#1E293B;line-height:1.35}' +
    '.bval span{font-size:10.5px;color:#94A3B8}' +
    '@media(max-width:520px){' +
      '.blab{width:66px;font-size:11.5px}' +
      '.bval{width:106px;font-size:11.5px}' +
      'body{padding:11px}' +
      '.whrow b{min-width:76px}' +
      // 手機上四個欄位擠成一列會每個都只剩指甲寬；改成兩兩一行
      '.filt .fi{flex:1 1 45%}' +
      '.filt input,.filt select{width:100%}' +
      '.filt button{flex:1 1 45%}' +
    '}';

  var html =
    '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<style>' + css + '</style></head><body>' + bodyHtml + '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('發包報表')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function errorBlock_(title, detail) {
  return '<div class="hd"><div class="ic">📊</div><div><h1>發包報表</h1></div></div>' +
    '<div class="card"><div class="msg fail"><b>' + esc_(title) + '</b><br>' +
    esc_(detail) + '</div></div>';
}

function reportBlock_(email, basis, since) {
  return '<div class="hd"><div class="ic">📊</div><div>' +
    '<h1>發包報表</h1><p>' + esc_(email) + '　·　僅主管可見　·　唯讀</p></div></div>' +
    '<div class="tabs">' +
      '<div class="tab' + (basis === BASIS_SHIP ? ' on' : '') + '" id="t_ship" ' +
        'onclick="pick(\'' + BASIS_SHIP + '\')">出貨日基準</div>' +
      '<div class="tab' + (basis === BASIS_APPLY ? ' on' : '') + '" id="t_apply" ' +
        'onclick="pick(\'' + BASIS_APPLY + '\')">發包申請日基準</div>' +
    '</div>' +
    // 篩選列。師傅／業務的選項由伺服器回傳後填入，不寫死——
    // 寫死的清單一定會跟試算表上的實際名字分家。
    '<div class="card filt">' +
      '<div class="frow">' +
        '<div class="fi"><label>起</label><input type="date" id="f_from" value="' +
          esc_(since || '') + '"></div>' +
        '<div class="fi"><label>訖</label><input type="date" id="f_to"></div>' +
        '<div class="fi"><label>師傅</label><select id="f_worker"><option value="">全部</option></select></div>' +
        '<div class="fi"><label>業務</label><select id="f_sales"><option value="">全部</option></select></div>' +
        '<button id="f_go" onclick="load()">套用</button>' +
        '<button class="ghost" onclick="resetF()">清除</button>' +
      '</div>' +
      '<div class="note" id="quick"></div>' +
    '</div>' +
    '<div id="msg"></div>' +
    '<div class="card" id="loadcard"><div class="center" id="load">統計中…（全量掃描，約需數秒）</div></div>' +
    '<div id="rep"></div>' +
    '<script>' +
    'var BASIS=' + JSON.stringify(basis) + ';' +
    'var SINCE=' + JSON.stringify(since || '') + ';' +
    'function g(id){return document.getElementById(id);}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';}' +
    'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;")' +
      '.replace(/</g,"&lt;").replace(/>/g,"&gt;");}' +
    'function money(v){var n=Number(v);if(!isFinite(n))return "0";' +
      'return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");}' +
    'function bars(rows,label,valFn,fmt){' +
      'if(!rows||!rows.length)return \'<div class="note">（無資料）</div>\';' +
      'var max=0;rows.forEach(function(r){var v=valFn(r);if(v>max)max=v;});' +
      'return rows.map(function(r){' +
        'var v=valFn(r);var pct=max>0?Math.max(2,Math.round(v/max*100)):0;' +
        'return \'<div class="brow"><div class="blab">\'+esc(label(r))+\'</div>\'' +
          '+\'<div class="btrack"><div class="bfill" style="width:\'+pct+\'%"></div></div>\'' +
          '+\'<div class="bval">\'+fmt(r)+\'</div></div>\';' +
      '}).join("");}' +
    'function card(title,sub,body,cls){' +
      'return \'<div class="card\'+(cls?" "+cls:"")+\'"><div class="ometa"><b>\'+esc(title)+\'</b>\'' +
        '+(sub?\'<span>\'+esc(sub)+\'</span>\':"")+\'</div>\'+body+\'</div>\';}' +
    // 切基準**不重新載入頁面**。GAS 網頁應用程式的內容跑在沙箱 iframe 裡，
    // 改 location 只會動到 iframe 自己的網址，doGet 根本不會被呼叫——
    // 按了沒反應就是這個原因。改成直接用新基準再取一次資料。
    'function pick(b){if(b===BASIS)return;BASIS=b;' +
      'g("t_ship").className="tab"+(b==="ship"?" on":"");' +
      'g("t_apply").className="tab"+(b==="apply"?" on":"");load();}' +
    'function resetF(){g("f_from").value=SINCE;g("f_to").value="";' +
      'g("f_worker").value="";g("f_sales").value="";load();}' +
    // 選項只在第一次填，之後保留使用者的選擇（重填會把選到的值洗掉）
    'var optsFilled=false;' +
    'function fillOpts(o){if(optsFilled||!o)return;optsFilled=true;' +
      '[["f_worker",o.workers],["f_sales",o.sales]].forEach(function(p){' +
        'var el=g(p[0]);(p[1]||[]).forEach(function(v){' +
          'var op=document.createElement("option");op.value=v;op.textContent=v;' +
          'el.appendChild(op);});});}' +

    'function overbill(d){' +
      'var o=d.overbilling||{};var h="";' +
      'if((o.rows||[]).length){' +
        'h+=\'<table><tr><th>分頁</th><th>列</th><th>發包單號</th><th>承包商</th>\'' +
          '+\'<th class="n">報價</th><th class="n">累計</th><th class="n">超出</th></tr>\';' +
        'h+=o.rows.map(function(r){return \'<tr><td>\'+esc(r.sheet)+\'</td><td class="n">\'+r.row' +
          '+\'</td><td>\'+esc(r.orderNo)+\'</td><td>\'+esc(r.worker)+\'</td><td class="n">\'' +
          '+money(r.quote)+\'</td><td class="n">\'+money(r.accum)+\'</td>\'' +
          '+\'<td class="n bad">+\'+money(r.diff)+\'</td></tr>\';}).join("");' +
        'h+=\'</table>\';' +
      '}else{h+=\'<div class="whrow">✅ 已比對 \'+money(o.checked)+\' 列，沒有累計超過報價的案。</div>\';}' +
      'if((o.uncheckable||[]).length){' +
        'h+=\'<div class="whlab">🔴 無法檢查的分頁（缺欄位，不是沒問題）</div>\';' +
        'h+=o.uncheckable.map(function(u){return \'<div class="whrow"><b>\'+esc(u.sheet)+\'</b>缺 \'' +
          '+esc(u.missing.join("、"))+\'</div>\';}).join("");}' +
      'if(o.skipped)h+=\'<div class="note">另有 \'+money(o.skipped)+\' 列因數量欄空白或非數字而無法比對。</div>\';' +
      'h+=\'<div class="note">這一區不受起算日限制，一律全量檢查——多付的錢沒有時效。</div>\';' +
      'return h;}' +

    'function gapCard(d){var G=d.gaps||{};var h="";' +
      '[G.applyToApprove,G.approveToShip,G.shipToWarehouse].forEach(function(s){' +
        'if(!s)return;' +
        'h+=\'<div class="whrow"><b>\'+esc(s.label)+\'</b>\'' +
          '+(s.n?("平均 "+s.avg+" 天　最久 "+s.max+" 天（"+esc(s.maxNo||"—")+"）　"+s.n+" 筆")' +
          ':"（無可計算的筆數）")' +
          '+(s.unknown?\'　<span class="bad">另 \'+s.unknown+\' 筆時間取不到</span>\':"")+\'</div>\';});' +
      'h+=\'<div class="note">簽核欄是文字（例「✅ 核准 email 2026-08-06 09:12」），\'' +
        '+\'取不到時間的筆數列在右邊，不會被當成 0 天混進平均。</div>\';' +
      'return h;}' +

    'function auditCard(d){var a=d.audit||{};var h="";' +
      'h+=\'<div class="whrow"><b>日期不明</b>出貨明細 \'+money(a.unknownDate.shipment)' +
        '+\' 筆　發包分頁 \'+money(a.unknownDate.dispatch)+\' 筆</div>\';' +
      'h+=\'<div class="whrow"><b>區間外排除</b>出貨明細 \'+money(a.excludedByRange.shipment)' +
        '+\' 筆　發包分頁 \'+money(a.excludedByRange.dispatch)+\' 筆</div>\';' +
      'h+=\'<div class="whrow"><b>未鍵出貨單號</b>\'+money(a.noShipNo)+\' 筆（不計入營收）</div>\';' +
      'h+=\'<div class="whrow"><b>無進價</b>\'+money(a.noCost)+\' 筆（毛利不含這些）</div>\';' +
      'if((a.outliers||[]).length){h+=\'<div class="whlab">金額極端值</div><table>\'' +
        '+\'<tr><th>分頁</th><th>列</th><th>單號</th><th>欄位</th><th class="n">值</th></tr>\'' +
        '+a.outliers.map(function(r){return \'<tr><td>\'+esc(r.sheet)+\'</td><td class="n">\'+r.row' +
          '+\'</td><td>\'+esc(r.orderNo)+\'</td><td>\'+esc(r.field)+\'</td>\'' +
          '+\'<td class="n bad">\'+money(r.value)+\'</td></tr>\';}).join("")+\'</table>\';}' +
      'if((a.nonNumeric||[]).length){h+=\'<div class="whlab">金額欄填了非數字</div><table>\'' +
        '+\'<tr><th>分頁</th><th>列</th><th>單號</th><th>欄位</th><th>內容</th></tr>\'' +
        '+a.nonNumeric.map(function(r){return \'<tr><td>\'+esc(r.sheet)+\'</td><td class="n">\'+r.row' +
          '+\'</td><td>\'+esc(r.orderNo)+\'</td><td>\'+esc(r.field)+\'</td><td>\'' +
          '+esc(r.value)+\'</td></tr>\';}).join("")+\'</table>\';}' +
      'if((a.workerDupes||[]).length){h+=\'<div class="whlab">疑似同一承包商的不同寫法</div>\'' +
        '+a.workerDupes.map(function(gp){return \'<div class="whrow">\'+esc(gp.join("　/　"))' +
          '+\'</div>\';}).join("")' +
        '+\'<div class="note">工資會被拆成兩筆。系統刻意不自動合併——合併錯了會讓工資對到錯的人。</div>\';}' +
      'if((a.unknownCodes||[]).length)h+=\'<div class="whlab">對照表沒收錄的業務代碼</div>\'' +
        '+\'<div class="whrow">\'+esc(a.unknownCodes.join("、"))+\'</div>\';' +
      'if((a.otherProjects||[]).length)h+=\'<div class="whlab">歸到「其他」通路的案名（前 15）</div>\'' +
        '+\'<div class="whrow">\'+esc(a.otherProjects.map(function(p){return p.name+"×"+p.count;})' +
          '.join("　"))+\'</div>\';' +
      'return h;}' +

    'function render(d){' +
      'var h="";' +
      'var bn=(d.basis==="ship"?"出貨日":"發包申請日");' +
      'var rng="<b>"+esc(d.from||"不限")+"</b> ～ <b>"+esc(d.to||"今天")+"</b>";' +
      'var sel=[];if(d.worker)sel.push("師傅："+esc(d.worker));' +
      'if(d.salesPick)sel.push("業務："+esc(d.salesPick));' +
      'if(d.sinceWarn){show("🔴 未設定 REPORT_SINCE，以下統計包含<b>全部歷史資料</b>（含早已作廢的殘留列）。'
        + '請在指令碼屬性設定起算日，例如 2026-01-01。","fail");}' +
      // ⚠ 這裡是 sel，不是 pick。pick 是上面切換基準的**函式**，
      //   函式的 .length 是參數個數（1，truthy），接著 pick.join 就會擲例外，
      //   而例外發生在 g("rep").innerHTML 之前 → 整片空白、連錯誤訊息都沒有。
      'else{show("範圍 "+rng+"　·　基準："+bn+(sel.length?"　·　"+sel.join("　·　"):"")' +
        '+(d.clamped?\'<br><span style="color:#92400E">起日早於 REPORT_SINCE（\'+esc(d.since)' +
          '+\'），已自動改成起算日。</span>\':""),"done");}' +
      'fillOpts(d.options);' +
      'h+=card("🔴 超額請款警示","累計請款數量 > 報價單數量",overbill(d),"alert");' +
      'h+=card("每月銷售","依"+(d.basis==="ship"?"出貨日":"發包申請日")+"分組，最多 24 個月",' +
        'bars(d.months,function(r){return r.month;},function(r){return r.sale;},' +
          'function(r){return r.count+" 筆<br><span>NT$ "+money(r.sale)+"</span>";}));' +
      'h+=card("業務銷售額","依售價合計排序",' +
        'bars(d.sales,function(r){return r.name;},function(r){return r.sale;},' +
          'function(r){return r.count+" 筆<br><span>NT$ "+money(r.sale)+' +
            '"　毛利 "+money(r.profit)+"("+r.profitRows+"筆)</span>";}));' +
      'h+=card("通路銷售額","依案名分類",' +
        'bars(d.channels,function(r){return r.name;},function(r){return r.sale;},' +
          'function(r){return r.count+" 筆<br><span>NT$ "+money(r.sale)+"</span>";}));' +
      'h+=card("外包師傅工資","依工資合計排序",' +
        'bars(d.workers,function(r){return r.name;},function(r){return r.price;},' +
          'function(r){return r.count+" 筆<br><span>NT$ "+money(r.price)+' +
            '"　"+r.months.length+" 個月</span>";}));' +
      'h+=card("時間間距","各階段耗時",gapCard(d));' +
      'h+=card("資料稽核","要人工處理的不一致",auditCard(d));' +
      'if((d.parity||[]).length){' +
        'h+=card("⚠ 表上有、程式不認得的欄名","欄名常數是從簽核程式複製的，可能已經過時",' +
          'd.parity.map(function(p){return \'<div class="whrow"><b>\'+esc(p.sheet)+\'</b>\'' +
            '+esc(p.headers.join("、"))+\'</div>\';}).join("")' +
          '+\'<div class="note">若其中有本報表該用的欄位，現在是被安靜略過的狀態。</div>\');}' +
      'if((d.errors||[]).length){h+=card("🔴 讀取失敗","",d.errors.map(function(x){' +
        'return \'<div class="whrow">\'+esc(x)+\'</div>\';}).join(""),"alert");}' +
      'g("rep").innerHTML=h;}' +

    // 每次取資料都把按鈕鎖住。不鎖的話連按兩次「套用」會有兩個請求在飛，
    // 先回來的那個未必是後按的那組條件，畫面就會顯示對不上篩選列的數字。
    'var busy=false;' +
    'function load(){' +
      'if(busy)return;busy=true;' +
      'g("f_go").disabled=true;g("f_go").textContent="統計中…";' +
      'g("loadcard").style.display="";g("load").textContent="統計中…（全量掃描，約需數秒）";' +
      'g("rep").innerHTML="";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'busy=false;g("f_go").disabled=false;g("f_go").textContent="套用";' +
          'g("loadcard").style.display="none";' +
          'if(!res.ok){show(esc(res.message),"fail");return;}' +
          'render(res.data);' +
          'if(res.unrestricted){var m=g("msg");m.innerHTML+=' +
            '\'<div class="msg warn">⚠ 未設定主管名單（DISPATCH_BOSS_APPROVERS／DISPATCH_SUB_APPROVERS），\'' +
            '+\'目前任何登入者都看得到金額與毛利。</div>\';}' +
          'var m2=document.createElement("div");m2.className="note";' +
          'm2.innerHTML="資料時間 "+esc(res.at)+(res.cached?"（快取，最多 15 分鐘）":"（即時統計）");' +
          'g("rep").appendChild(m2);})' +
        '.withFailureHandler(function(e){' +
          'busy=false;g("f_go").disabled=false;g("f_go").textContent="套用";' +
          'g("load").textContent="統計失敗："+e.message;})' +
        '.getReport({basis:BASIS,from:g("f_from").value,to:g("f_to").value,' +
          'worker:g("f_worker").value,sales:g("f_sales").value});}' +
    'load();' +
    '</script>';
}
