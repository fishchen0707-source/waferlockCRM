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
var COL_WAGE      = '工資報價(對客戶)';   // 對客戶收的
var COL_UNIT      = '承包報價(組)';       // 給承包商的單價
var COL_PRICE     = '承包總價';           // 給承包商的總價
var COL_DISPATCHER= '發包人員';
var COL_NOTE      = '補充說明';
var COL_APPROVAL  = '主管簽核';   // 建議改成這個欄名；下方 ALIAS 仍認得舊名，不強迫先改
var COL_SUB_APPROVAL = '副主管簽核';  // 只有部分分頁有；有這欄的走兩層簽核
var COL_STATUS    = '案件狀態';   // 新增欄，取代「黃色標示」

/**
 * 舊表頭相容：欄位還沒改名也能運作，避免「非得先改試算表才能用」的導入門檻。
 *
 * 這張別名表不是為了「以防萬一」——實際盤點 18 個分頁後，同一個概念用了 4 種寫法：
 *   簽核欄：主管簽核／主管KEY英文名押日期／主管確認/押日期
 *   金額欄：承包總價／發包合計
 *   數量欄：本次請款數量／請款數量（陳俊行分頁）
 * 少任何一個別名，對應分頁就會安靜地少掉欄位（金額顯示成「—」），不會報錯。
 *
 * ⚠ 副主管別名絕對不能寫進 COL_APPROVAL 的清單裡。normHeader_ 只去空白不做模糊比對，
 *   所以「副主管KEY英文名押日期」不會誤配到「主管KEY英文名押日期」——這是刻意依賴的行為。
 */
var COL_ALIAS = {};
COL_ALIAS[COL_APPROVAL] = ['主管KEY英文名押日期', '主管簽核', '主管核准', '主管確認/押日期'];
COL_ALIAS[COL_SUB_APPROVAL] = ['副主管簽核', '副主管確認/押日期', '副主管KEY英文名押日期'];
COL_ALIAS[COL_PRICE] = ['承包總價', '發包合計'];
// 真實表頭是「工資報價(對客戶）」——左半形、右**全形**括號，人工輸入的產物。
// normHeader_ 已統一把全形轉半形，所以這裡只需要寫半形版本。
COL_ALIAS[COL_WAGE] = ['工資報價(對客戶)', '工資報價'];
// 陳俊行分頁只有「發包單價」沒有合計——單價歸單價欄是正確的，
// 但**絕不可**把它放進 COL_PRICE 的別名：把單價當總價顯示，主管會看著錯的金額按核准。
COL_ALIAS[COL_UNIT] = ['承包報價(組)', '承包報價', '發包單價'];
COL_ALIAS[COL_QTY] = ['本次請款數量', '請款數量'];
// 一課-sin 的欄名是「發包日期」。少這個別名，該分頁的申請日一律讀成空值，
// DISPATCH_PENDING_SINCE 的日期過濾對整個分頁失效——歷史單會全部湧進待核清單。
COL_ALIAS[COL_APPLY_AT] = ['發包申請日期', '發包日期'];

// ── 人員代碼對照表（發包單號前綴 → 業務 → 對應助理）────────────────
// 為什麼一定要查表、不能用程式從姓名推導：實際的代碼規則不一致——
//   Johnson Wu → JW（名+姓）    sammi lin → LS（姓+名，反過來）    sean lin → SL
// 而且 SL 與 LS 只差順序、是兩個不同的人。任何推導規則都會出錯。
var ROSTER_SHEET_DEFAULT = '人員代碼';
var COL_R_CODE       = '業務代碼';
var COL_R_SALES      = '業務姓名';
var COL_R_SALES_MAIL = '業務email';    // normHeader_ 會去掉空白，「業務 email」也對得上
var COL_R_TYPE       = '類別';
var COL_R_ASSIST     = '對應助理';
var COL_R_ASSIST_MAIL= '助理email';

// ── 出貨明細（獨立分頁，不是加在各業務分頁上）──────────────────
//
// 為什麼獨立一張表，而不是在 17 個業務分頁各加 10 欄：
//  1. 加欄要改 17 個分頁，而那些分頁本來就有 4 種格式，改起來一定有人漏。
//  2. **一次發包可能對到多次出貨**（分批出貨）。掛在發包列上裝不下第二次，
//     而且工資欄會跟著重複，有被重複計價的風險——那是會出錯付錢的地方。
//     獨立一張表，同一個發包單號可以有多列出貨，天然解掉這個問題。
//  3. **約一半的出貨沒有發包單**（弱電料件、鎖胚、建案整批）。
//     那些單在業務分頁上根本沒有列可以掛，只能另開一張表收。
var SHIPMENT_SHEET = '出貨明細';
var COL_S_AT        = '登錄時間';
var COL_S_SHIP_NO   = '出貨單號';
var COL_S_ORDER_ID  = '訂單編號';
var COL_S_DISPATCH  = '發包單號';      // 料件出貨可留空
var COL_S_CUSTOMER  = '客戶';
var COL_S_PROJECT   = '案名';
var COL_S_ITEMS     = '出貨品項';      // 從 TipTop 整段複製貼上
var COL_S_TO_NAME   = '貨指寄-收件人';
var COL_S_TO_PHONE  = '貨指寄-電話';
var COL_S_TO_ADDR   = '貨指寄-地址';
var COL_S_INVOICE   = '發票別';
var COL_S_NOTE      = '出貨備註';
var COL_S_BY        = '登錄人';
var COL_S_WH_STATUS = '倉庫核單狀態';   // 倉庫核單頁用（下一階段）
var COL_S_WH_BY     = '倉庫核單人';
var COL_S_WH_AT     = '倉庫核單時間';
var COL_S_WH_NOTE   = '問題說明';

var SHIPMENT_HEADERS = [
  COL_S_AT, COL_S_SHIP_NO, COL_S_ORDER_ID, COL_S_DISPATCH, COL_S_CUSTOMER, COL_S_PROJECT,
  COL_S_ITEMS, COL_S_TO_NAME, COL_S_TO_PHONE, COL_S_TO_ADDR, COL_S_INVOICE, COL_S_NOTE,
  COL_S_BY, COL_S_WH_STATUS, COL_S_WH_BY, COL_S_WH_AT, COL_S_WH_NOTE
];

var INVOICE_OPTIONS = ['出貨待驗無發票', '電子發票', '二聯', '三聯'];

// 業務分頁上既有的出貨單號欄（欄名有 4 種寫法）。助理填完後回寫一份，
// 讓業務在原本的分頁上也看得到出貨進度。
var COL_SHIP_NO_BACK = '出貨單號';
var COL_ALIAS_BACK = ['10999沖帳出貨單號', '沖轉出貨單號', '出貨沖轉單號',
                      '10999出貨沖轉單號', '出貨單號'];

var AUDIT_SHEET = '簽核紀錄';     // 稽核軌跡（不存在會自動建立）
var MAX_SCAN_HEADER_ROWS = 10;    // 自動偵測表頭時最多往下找幾列

// 發包單號格式（業務代碼前綴 + 日期 + 序號），例：JW-260805-01。
// 表格最上方幾列會寫「先寄未裝」之類的狀態註記而不是單號，靠這個式子濾掉。
var ORDER_NO_RE = /^[A-Za-z]{2}-\d{6}-\d+/;

// ────────────────────────────────────────────── 網頁進入點

/**
 * 唯一進入點，依**登入身分的角色**決定顯示哪一頁。
 *
 * ⚠ 網址參數 `?page=` 只用來「在你有權限的頁面之間切換」，**不是權限依據**。
 *   參數是使用者可以隨手改的；擋人的一律是角色名單。改了參數但沒有該角色，
 *   看到的是「沒有權限」，不是那一頁。
 */
function doGet(e) {
  var email = currentUserEmail_();
  if (!email) {
    return htmlPage_(errorBlock_(
      '無法辨識您的身分',
      '請確認：①用公司 Google 帳號登入 ②部署設定的「具有存取權的使用者」是「機構內的任何人」，' +
      '不是「知道連結的任何人」。取不到身分就不能簽核，這是刻意的防護。'
    ));
  }

  var roles = rolesFor_(email);
  var canApprove = roles.sub || roles.boss;
  var want = String((e && e.parameter && e.parameter.page) || '').trim();

  // 預設頁：有簽核權就先看簽核（那是有時效的），否則看出貨
  var page = want || (canApprove ? 'approve' : 'ship');

  if (page === 'ship') {
    if (!roles.assistant) {
      return htmlPage_(errorBlock_('您沒有出貨登錄權限',
        email + ' 不在助理名單中（指令碼屬性 DISPATCH_ASSISTANTS）。'));
    }
    return renderShipPage_(email, roles);
  }

  if (!canApprove) {
    return htmlPage_(errorBlock_(
      '您沒有簽核權限',
      email + ' 不在副主管或主管的簽核名單中。若這不正確，' +
      '請確認指令碼屬性 DISPATCH_SUB_APPROVERS／DISPATCH_BOSS_APPROVERS 是否包含您的帳號。'
    ));
  }

  var data, dataAt = '', fromCache = false;
  try {
    var res = getPendingCached_();
    data = res.rows;
    dataAt = res.at;
    fromCache = res.cached;
  } catch (err) {
    return htmlPage_(errorBlock_('讀取試算表失敗', String(err)));
  }

  return htmlPage_(navBlock_('approve', roles) +
    listBlock_(email, data, { sub: roles.sub, boss: roles.boss,
      unrestricted: roles.approverUnrestricted }, { at: dataAt, cached: fromCache }));
}

function renderShipPage_(email, roles) {
  var rows = [], at = '', cached = false;
  try {
    var res = getShippableCached_();
    rows = res.rows; at = res.at; cached = res.cached;
  } catch (err) {
    return htmlPage_(navBlock_('ship', roles) +
      errorBlock_('讀取待出貨清單失敗', String(err)));
  }
  return htmlPage_(navBlock_('ship', roles) +
    shipBlock_(email, rows, roles, { at: at, cached: cached }));
}

function shipBlock_(email, rows, roles, meta) {
  var head =
    '<div class="hd"><div class="ic">📦</div><div>' +
    '<h1>出貨登錄</h1><p>' + esc_(email) + '</p></div></div>' +
    '<div id="msg"></div>' +
    (roles.assistantUnrestricted
      ? '<div class="msg warn">⚠ 尚未設定 DISPATCH_ASSISTANTS，目前任何人都能登錄出貨。</div>'
      : '');

  // 上半：已核准待出貨（點一下把資料帶進表單，省去重打客戶案名）
  var list = '';
  if (rows.length) {
    var items = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      items +=
        '<div class="pick" onclick="fill(' + i + ')">' +
          '<b>' + esc_(r.orderNo) + '</b>　' + esc_(r.customer || '—') +
          (r.project ? '（' + esc_(r.project) + '）' : '') +
          '<div class="sub">' + esc_(r.sheet) + '｜' + esc_(r.worker || '—') +
            '｜' + esc_(r.model || '—') + (r.qty ? ' × ' + esc_(r.qty) : '') + '</div>' +
        '</div>';
    }
    list =
      '<div class="card">' +
        '<div class="ometa"><b>已核准待出貨</b><span>' + rows.length + ' 筆</span></div>' +
        '<div class="note">點一下把資料帶進下方表單。' +
          '沒有發包單的出貨（弱電料件、鎖胚、建案整批）不會出現在這裡，直接填下方表單即可。</div>' +
        items +
      '</div>';
  } else {
    list = '<div class="card"><div class="center">目前沒有已核准待出貨的發包單<br>' +
      '<span style="font-size:11.5px">沒有發包單的出貨直接填下方表單</span></div></div>';
  }

  var invOpts = '<option value=""></option>';
  for (var v = 0; v < INVOICE_OPTIONS.length; v++) {
    invOpts += '<option>' + esc_(INVOICE_OPTIONS[v]) + '</option>';
  }

  var form =
    '<div class="card">' +
      '<div class="ometa"><b>登錄出貨</b></div>' +
      fld_('shipNo', '出貨單號 *', 'W5501-260807001') +
      fld_('orderId', '訂單編號', 'W5301-260807001') +
      fld_('dispatchNo', '發包單號', '沒有發包單就留空') +
      '<div class="two">' + fld_('customer', '客戶', '') + fld_('project', '案名／通路', '') + '</div>' +
      '<label>出貨品項 *</label>' +
      '<textarea id="items" rows="5" placeholder="從 TipTop 整段複製貼上，含料號與數量"></textarea>' +
      '<div class="two">' + fld_('toName', '貨指寄－收件人', '例：宇泰鎖印 李建男') +
        fld_('toPhone', '貨指寄－電話', '') + '</div>' +
      fld_('toAddr', '貨指寄－地址', '') +
      '<div class="two">' +
        '<div><label>發票別</label><select id="invoice">' + invOpts + '</select></div>' +
        fld_('note', '出貨備註', '例：不附出貨單、指定週六到貨') +
      '</div>' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="ok" id="sub" onclick="send()">📦 登錄並通知倉庫</button>' +
      '</div>' +
    '</div>';

  var footer = '<div class="note">清單資料時間 ' + esc_(meta.at) +
    (meta.cached ? '（快取）' : '') + '　·　登錄人取自您的 Google 帳號，無法修改。</div>';

  var script =
    '<script>' +
    'var ROWS=' + JSON.stringify(rows.map(function (r) {
      return { orderNo: r.orderNo, customer: r.customer, project: r.project };
    })) + ';' +
    'function g(id){return document.getElementById(id);}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';window.scrollTo(0,0);}' +
    'function fill(i){var r=ROWS[i];g("dispatchNo").value=r.orderNo;' +
      'g("customer").value=r.customer||"";g("project").value=r.project||"";' +
      'g("shipNo").focus();}' +
    'function send(){' +
      'var b=g("sub");var old=b.textContent;' +
      'var f={shipNo:g("shipNo").value,orderId:g("orderId").value,' +
        'dispatchNo:g("dispatchNo").value,customer:g("customer").value,' +
        'project:g("project").value,items:g("items").value,toName:g("toName").value,' +
        'toPhone:g("toPhone").value,toAddr:g("toAddr").value,' +
        'invoice:g("invoice").value,note:g("note").value};' +
      'if(!f.shipNo.trim()){show("出貨單號為必填","fail");return;}' +
      'if(!f.items.trim()){show("出貨品項為必填","fail");return;}' +
      'b.disabled=true;b.textContent="處理中…";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){b.disabled=false;b.textContent=old;' +
          'if(res.ok){show(res.message,"done");' +
            '["shipNo","orderId","dispatchNo","customer","project","items",' +
             '"toName","toPhone","toAddr","note"].forEach(function(k){g(k).value="";});' +
            'g("invoice").value="";}' +
          'else{show(res.message,"fail");}})' +
        '.withFailureHandler(function(e){b.disabled=false;b.textContent=old;' +
          'show("連線失敗："+e.message,"fail");})' +
        '.submitShipment(f);' +
    '}' +
    '</script>';

  return head + list + form + footer + script;
}

function fld_(id, label, ph) {
  return '<div><label>' + esc_(label) + '</label>' +
    '<input id="' + id + '" placeholder="' + esc_(ph || '') + '"></div>';
}

/** 頁面切換列。只列出這個身分真的有權限的頁，不給看得到卻點不進去的東西。 */
function navBlock_(current, roles) {
  var tabs = [];
  if (roles.sub || roles.boss) tabs.push(['approve', '簽核']);
  if (roles.assistant) tabs.push(['ship', '出貨登錄']);
  if (tabs.length < 2) return '';

  var html = '<div class="nav">';
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i][0] === current;
    html += on
      ? '<span class="tab on">' + esc_(tabs[i][1]) + '</span>'
      : '<a class="tab" href="?page=' + tabs[i][0] + '">' + esc_(tabs[i][1]) + '</a>';
  }
  return html + '</div>';
}

/**
 * 這個帳號可以看到／操作哪幾層。
 *
 * 為什麼要依身分過濾畫面，而不是把兩層都列出來讓人按了才擋：
 * 顯示一個按下去一定會被拒絕的按鈕，是在讓人做白工。主管開頁面看到 15 筆
 * 副主管待核，會先困惑再按、按了被擋、然後懷疑系統壞了。
 *
 * 為什麼不做成兩個網址（?page=sub）：GAS 一個部署只有一個網址，靠查詢參數分頁面的話，
 * 參數是使用者可以隨手改的，不能當權限依據——擋人的仍然只能是名單。
 * 兩個網址只多出「要管理、可能發錯」的成本，安全性沒有任何增加。
 * 身分由 Session.getActiveUser() 取得，不可偽造，才是唯一可靠的依據。
 *
 * 名單都沒設定＝兩層都看得到（降級狀態，checkSetup 會警告）。
 */
function stagesFor_(email) {
  var props = PropertiesService.getScriptProperties();
  var subRaw = String(props.getProperty('DISPATCH_SUB_APPROVERS') || '').trim();
  var bossRaw = String(props.getProperty('DISPATCH_BOSS_APPROVERS') || '').trim();

  // 兩份名單都沒設：維持可用，兩層都顯示（否則導入初期會直接不能用）
  if (!subRaw && !bossRaw) return { sub: true, boss: true, unrestricted: true };

  return {
    sub: inList_(subRaw, email),
    boss: inList_(bossRaw, email),
    unrestricted: false
  };
}

/**
 * 這個人有哪些角色。與 stagesFor_ 分開，因為簽核與出貨是兩套名單。
 * 沒設 DISPATCH_ASSISTANTS 時，助理頁對所有人開放但會顯示警告——
 * 導入初期不要因為名單沒設好就整個不能用，但也不能假裝有管控。
 */
function rolesFor_(email) {
  var props = PropertiesService.getScriptProperties();
  var stages = stagesFor_(email);
  var assistRaw = String(props.getProperty('DISPATCH_ASSISTANTS') || '').trim();
  return {
    sub: stages.sub,
    boss: stages.boss,
    approverUnrestricted: stages.unrestricted,
    assistant: assistRaw ? inList_(assistRaw, email) : true,
    assistantUnrestricted: !assistRaw
  };
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

// ────────────────────────────────────────────── 給前端 google.script.run 呼叫

/**
 * 寫入簽核結果。回傳 {ok, message}。
 * 前端不傳簽核者是誰——一律由伺服器端從登入身分取得，避免被竄改。
 */
function submitDecision(orderNo, decision, note, hintSheet, hintRow) {
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
    // 快路徑：位置提示指得出分頁與列，就只開那一個分頁。
    // 提示仍然要驗證（下面會比對單號），對不上就退回完整搜尋——
    // 提示只能讓事情變快，不能讓它指向別的列。
    var env = null, hit = null;
    var hr = Number(hintRow || 0);
    if (hintSheet && hr > 0) {
      var one = openSheetByName_(hintSheet);
      if (one && hr > one.ctx.headerRow && hr <= (one.ctx.lastRow || 0)) {
        var probe = String(one.ctx.sheet
          .getRange(hr, one.ctx.col[COL_ORDER_NO]).getValue() || '').trim();
        if (probe === orderNo) {
          env = one;
          hit = { ctx: one.ctx, row: hr };
        }
      }
    }

    if (!hit) {
      env = openSheets_();
      hit = findByOrderNo_(env, orderNo, hintSheet, hr);
    }
    if (!hit) return { ok: false, message: '找不到發包單號 ' + orderNo + '，可能已被刪除。' };

    var ctx = hit.ctx;
    if (!ctx.col[COL_APPROVAL]) {
      return { ok: false, message: '分頁「' + ctx.name + '」找不到簽核欄，未寫入任何資料。' };
    }

    // 重讀一次當下的簽核狀態：避免兩人同時開著頁面、後按的人覆蓋前一位。
    // 階段一律由伺服器重算，不接受前端傳入——否則有人可以偽造 stage 跳過副主管那關。
    // 一次讀整列，而不是每個欄位各發一次 getValue()——每次往返約 0.3 秒
    var rowVals = ctx.sheet.getRange(hit.row, 1, 1, ctx.lastCol || ctx.sheet.getLastColumn())
      .getValues()[0];
    var cellOf = function (name) {
      var c = ctx.col[name];
      return (c && c <= rowVals.length) ? String(rowVals[c - 1] == null ? '' : rowVals[c - 1]).trim() : '';
    };
    var subVal = ctx.twoStage ? cellOf(COL_SUB_APPROVAL) : '';
    var bossVal = cellOf(COL_APPROVAL);

    var stage = stageOf_(ctx, subVal, bossVal);
    if (!stage) {
      return {
        ok: false,
        message: '這筆已經被處理過了：' + (bossVal || subVal) + '（畫面請重新整理）'
      };
    }

    var gate = checkApprover_(stage, email);
    if (!gate.ok) return gate;

    var targetCol = (stage === 'sub') ? ctx.col[COL_SUB_APPROVAL] : ctx.col[COL_APPROVAL];
    var roleName = (stage === 'sub') ? '副主管' : '主管';

    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var mark = (decision === 'approve')
      ? '✅ 核准 ' + email + ' ' + stamp
      : '❌ 退回 ' + email + ' ' + stamp + '｜' + note;

    ctx.sheet.getRange(hit.row, targetCol).setValue(mark);

    // 案件狀態只在「終局」才寫：副主管核准只是往上送，還沒定案，
    // 這時就寫「已核准」會讓看表的人以為整筆過了。副主管退回是終局，要寫。
    if (ctx.col[COL_STATUS]) {
      var status = '';
      if (decision === 'reject') status = '已退回（' + roleName + '）';
      else if (stage === 'boss') status = '已核准';
      else status = '待主管核准';
      ctx.sheet.getRange(hit.row, ctx.col[COL_STATUS]).setValue(status);
    }

    // 稽核軌跡：簽核欄只留最後狀態，這裡留完整歷程（誰、何時、哪一層、做了什麼、為什麼）
    appendAudit_(env.ss, {
      at: stamp, who: email, orderNo: orderNo, role: roleName,
      action: decision === 'approve' ? '核准' : '退回',
      note: note + (gate.warn ? '｜⚠ ' + gate.warn : ''),
      sheet: ctx.name, row: hit.row
    });

    SpreadsheetApp.flush();
    updatePendingCache_(orderNo, decision, stage, mark);

    // 主管核准＝終局，這時才通知助理去打出貨單。
    // 副主管核准只是往上送，通知了只會讓助理白跑一趟。
    // 整段包 try：通知是附加動作，它壞掉不該讓一次已經寫成功的簽核被回報成失敗
    //（那會讓使用者重試，然後看到「已經被處理過了」而困惑）。
    if (decision === 'approve' && stage === 'boss') {
      try {
        notifyAssistant_({
          orderNo: orderNo, who: email, at: stamp,
          worker: cellOf(COL_WORKER), customer: cellOf(COL_CUSTOMER),
          project: cellOf(COL_PROJECT), model: cellOf(COL_MODEL), qty: cellOf(COL_QTY)
        });
      } catch (e2) {
        Logger.log('核准後通知助理失敗（簽核已成功寫入）：' + e2);
      }
    }

    var done = (decision === 'approve')
      ? (stage === 'sub' ? '已核准（' + roleName + '層），已送主管 ' : '已核准 ')
      : '已退回 ';
    return { ok: true, message: done + orderNo };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };   // 顯性失敗，不靜默吞掉
  } finally {
    lock.releaseLock();
  }
}

/**
 * 這個人可以核這一層嗎？
 *
 * 為什麼需要這道閘門：兩層簽核的意義在於「兩個不同的人」。若不限制，
 * 同一個人可以先按副主管層、重新整理後再按主管層，兩層都自己核完——
 * 那就只是同一個簽名蓋兩次，比單層更糟（看起來像有覆核）。
 *
 * 名單留空＝不限制。刻意不預設擋人：導入初期還沒收集到 email 就全擋，
 * 系統會直接不能用。但這是降級狀態，checkSetup 會警告，稽核紀錄也會標記。
 *
 * 指令碼屬性（email 逗號分隔，大小寫不分）：
 *   DISPATCH_SUB_APPROVERS  = 副主管的 Google 帳號
 *   DISPATCH_BOSS_APPROVERS = 主管的 Google 帳號
 */
function checkApprover_(stage, email) {
  // 與畫面過濾（stagesFor_）共用同一套判定，這點很重要：
  // 前端 JS 是使用者可以用開發者工具改掉的，畫面藏起來不等於擋得住。
  // 兩邊若各判一次，就會出現「看不到但呼叫得動」的漏洞。
  var allow = stagesFor_(email);
  var roleName = (stage === 'sub') ? '副主管' : '主管';

  if (allow.unrestricted) {
    return { ok: true, warn: '兩份簽核名單皆未設定，任何人皆可核（同一人可自核兩層）' };
  }
  if (stage === 'sub' ? allow.sub : allow.boss) return { ok: true, warn: '' };

  return {
    ok: false,
    message: '您（' + email + '）不在' + roleName + '簽核名單中，未寫入任何資料。'
  };
}

/**
 * 前端「重新整理」用：只回資料不重畫整頁。
 * 一樣要依身分過濾——否則重新整理會把畫面藏起來的那一層帶回來。
 */
function refreshPending() {
  var email = currentUserEmail_();
  if (!email) return { ok: false, rows: [] };
  try {
    var allow = stagesFor_(email);
    var all = getPendingCached_().rows;
    var mine = [];
    for (var i = 0; i < all.length; i++) {
      var st = all[i].stage;
      if (st === 'sub' ? allow.sub : allow.boss) mine.push(all[i]);
    }
    return { ok: true, rows: mine };
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

/**
 * 這個分頁名有沒有在掃描範圍內。
 * 用途：位置提示是前端傳來的，不能讓它指向一個本來就不該被納入的分頁
 * （例如「簽核紀錄」，或 DISPATCH_SHEET_NAME 明確列舉時未列出的分頁）。
 */
function isSheetInScope_(name) {
  if (!name || name === AUDIT_SHEET) return false;
  var spec = String(PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_SHEET_NAME') || '').trim();
  if (spec === '*') return true;
  var names = spec.split(',');
  for (var i = 0; i < names.length; i++) {
    if (names[i].trim() === name) return true;
  }
  return false;
}

/**
 * 只開一個分頁（簽核寫入的快路徑）。
 *
 * submitDecision 只需要動一個分頁的一列，但原本要先跑 openSheets_() 把 17 個分頁
 * 全部建一次欄位對照——每頁 3 次 API 往返，光這樣就十幾秒，實測按核准要 18.4 秒。
 * 有位置提示時直接開那一頁，往返次數從 50 幾次降到 3 次。
 *
 * 找不到、不在掃描範圍、或沒有簽核欄都回 null，呼叫端會退回完整搜尋。
 */
function openSheetByName_(name) {
  if (!isSheetInScope_(name)) return null;
  var id = PropertiesService.getScriptProperties().getProperty('DISPATCH_SHEET_ID');
  if (!id) return null;
  try {
    var ss = SpreadsheetApp.openById(id);
    var sheet = ss.getSheetByName(name);
    if (!sheet) return null;
    var ctx = buildCtx_(sheet);
    if (!ctx || !ctx.usable) return null;
    return { ss: ss, list: [ctx], ctx: ctx };
  } catch (err) {
    return null;
  }
}

/**
 * 建立單一分頁的欄位對照。找不到「發包單號」表頭回傳 null（供自動掃描略過用）。
 *
 * 效能：整個函式只做 **1 次** getValues。
 * 原本是 detectHeaderRow_ 讀前 10 列、headerMap_ 再把同一列讀第二次，
 * 加上兩次 getLastColumn()，每個分頁 5 次 API 往返；18 個分頁約 90 次、
 * 每次約 0.3 秒 → 光開表就 28 秒。試算表 API 的成本幾乎全在往返次數，
 * 不在讀多少格，所以「一次讀足夠的範圍」比「精準只讀要的那一列」快得多。
 */
function buildCtx_(sheet) {
  var forced = Number(PropertiesService.getScriptProperties().getProperty('DISPATCH_HEADER_ROW') || 0);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;

  var scanTo = forced ? Math.min(forced, lastRow) : Math.min(MAX_SCAN_HEADER_ROWS, lastRow);
  var top = sheet.getRange(1, 1, scanTo, lastCol).getValues();

  var headerRow = forced || detectHeaderRowIn_(top);
  if (!headerRow || headerRow > top.length) return null;

  var col = headerMapOf_(top[headerRow - 1]);
  applyAliases_(col);
  if (!col[COL_ORDER_NO]) return null;

  // 沒有簽核欄的分頁「不可用」：既無從判斷哪些已核（會把整張表當成待核），
  // 主管就算按了核准也沒地方寫。這種情況要當成設定錯誤報出來，不能默默列出來。
  return {
    sheet: sheet,
    name: sheet.getName(),
    headerRow: headerRow,
    lastRow: lastRow,     // 已經問過了，別再問第二次
    lastCol: lastCol,
    col: col,
    usable: !!col[COL_APPROVAL],
    // 有副主管欄的分頁走兩層：副主管先核，核完才進主管清單。
    // 9 個分頁有這一層，先前只讀主管欄的話，副主管那關會被安靜地跳過。
    twoStage: !!col[COL_SUB_APPROVAL]
  };
}

/** 自動找出表頭在第幾列：往下掃，第一個含「發包單號」的列就是。找不到回傳 0。 */
function detectHeaderRow_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return 0;

  var rows = Math.min(MAX_SCAN_HEADER_ROWS, lastRow);
  return detectHeaderRowIn_(sheet.getRange(1, 1, rows, lastCol).getValues());
}

/** 表頭文字 → 欄號（1-based）。表頭常有換行與多餘空白，統一正規化後比對。 */
function headerMap_(sheet, headerRow) {
  var last = sheet.getLastColumn();
  return headerMapOf_(sheet.getRange(headerRow, 1, 1, last).getValues()[0]);
}

/**
 * 以下兩支是純函式版本（吃已經讀好的值，不碰試算表）。
 * 拆出來的原因：buildCtx_ 只想讀一次資料就把表頭列和欄位對照都算出來，
 * 而上面兩支帶 sheet 的版本保留不動，避免影響其他呼叫端。
 */
function detectHeaderRowIn_(values) {
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (normHeader_(values[r][c]) === COL_ORDER_NO) return r + 1;
    }
  }
  return 0;
}

function headerMapOf_(headRow) {
  var map = {};
  for (var i = 0; i < headRow.length; i++) {
    var key = normHeader_(headRow[i]);
    if (key && !map[key]) map[key] = i + 1;
  }
  return map;
}

/**
 * 表頭正規化：去空白 ＋ 全形英數標點轉半形。
 *
 * 為什麼要轉全形：實際表頭是「工資報價(對客戶）」——左括號半形、右括號**全形**，
 * 手打出來的。不轉的話這個欄位在所有分頁都讀不到，而且不會報錯，
 * 只是金額欄一片空白（正是本專案反覆踩到的那種靜默失效）。
 *
 * ⚠ 刻意**只做寬度統一，不做模糊比對**。「副主管KEY英文名押日期」與
 *   「主管KEY英文名押日期」必須維持可區分——副主管欄若被誤配成主管欄，
 *   等於整層覆核被跳過。
 */
function normHeader_(v) {
  return String(v == null ? '' : v)
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/[\s　]+/g, '')
    .trim();
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

var CACHE_KEY = 'dispatch_pending_v1';
var CACHE_TTL = 900;              // 秒。預熱觸發器設每 10 分鐘，留 5 分鐘餘裕
var CACHE_MAX_BYTES = 95000;      // CacheService 單一值上限 100KB，留一點安全邊界

/**
 * 待核清單（優先用快取）。
 *
 * 為什麼需要快取：掃 17 個分頁本身就要 34 次以上的試算表 API 往返，
 * 每次約 0.3 秒——這是無法再壓縮的下限，實測開頁 39 秒。
 * 主管不會接受每次開頁等 40 秒，而這份資料的新鮮度要求其實很低
 * （簽核從「每週四批次」變成「隨時可核」已經是巨大改善，差幾分鐘無關緊要）。
 *
 * 一致性怎麼保證：**簽核動作一定會清掉快取**（submitDecision 成功後 invalidate），
 * 所以「剛核完卻還看到那筆」不會發生。快取只會讓「業務新開的單」晚幾分鐘出現。
 *
 * 搭配 warmCache() 的時間觸發器，主管開頁時幾乎總是熱的。
 */
function getPendingCached_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(CACHE_KEY);
    if (hit) {
      var obj = JSON.parse(hit);
      if (obj && obj.rows) return { rows: obj.rows, at: obj.at, cached: true };
    }
  } catch (err) {
    Logger.log('讀取快取失敗，改為即時掃描：' + err);   // 快取壞掉不能讓功能停擺
  }

  var rows = getPending_();
  var at = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  try {
    var payload = JSON.stringify({ rows: rows, at: at });
    if (payload.length <= CACHE_MAX_BYTES) {
      cache.put(CACHE_KEY, payload, CACHE_TTL);
    } else {
      // 顯性失敗：不要讓人以為快取在生效卻其實每次都在重掃
      Logger.log('⚠ 待核清單 ' + payload.length + ' bytes 超過快取上限 ' +
        CACHE_MAX_BYTES + '，本次未寫入快取（開頁會維持慢速）。');
    }
  } catch (err) {
    Logger.log('寫入快取失敗：' + err);
  }
  return { rows: rows, at: at, cached: false };
}

/** 簽核寫入後一定要呼叫，否則剛核完的單還會留在清單上 */
function invalidatePendingCache_() {
  try {
    CacheService.getScriptCache().remove(CACHE_KEY);
  } catch (err) {
    Logger.log('清除快取失敗（下次開頁可能看到已處理的單）：' + err);
  }
}

/**
 * 簽核後「就地更新」快取，而不是整份丟掉。
 *
 * 為什麼不直接 invalidate：丟掉的話下一次開頁就要重跑 30 秒的完整掃描，
 * 等於每簽一筆就懲罰下一個開頁的人。這一筆的變化我們完全知道，直接改掉就好。
 *
 * 三種結果：退回→整筆移除；主管核准→整筆移除；副主管核准→留著但升到主管層。
 * 快取不存在就什麼都不做（下次開頁自然會重算）。
 */
function updatePendingCache_(orderNo, decision, stage, mark) {
  // 整段都包在 try 裡，連取得 cache 物件都算進去。
  // 資料此時已經寫進試算表了，快取只是加速層——它出任何問題都不能讓
  // 一次成功的簽核被回報成失敗，否則使用者會重試，然後看到「已經被處理過了」而困惑。
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(CACHE_KEY);
    if (!hit) return;
    var obj = JSON.parse(hit);
    if (!obj || !obj.rows) return;

    var out = [];
    for (var i = 0; i < obj.rows.length; i++) {
      var r = obj.rows[i];
      if (r.orderNo !== orderNo) { out.push(r); continue; }
      // 副主管核准：這筆還沒結束，改成等主管，並帶上副主管的簽核字串
      if (decision === 'approve' && stage === 'sub') {
        r.stage = 'boss';
        r.subMark = mark;
        out.push(r);
      }
      // 其餘（退回、主管核准）都是終局，不放回去
    }
    obj.rows = out;
    cache.put(CACHE_KEY, JSON.stringify(obj), CACHE_TTL);
  } catch (err) {
    // 更新失敗就退回「整份丟掉」，寧可慢也不要顯示錯的清單。
    // 連清除都失敗也只記錄，不往上拋——見上方註解。
    Logger.log('就地更新快取失敗，改為清除：' + err);
    invalidatePendingCache_();
  }
}

/**
 * 供時間驅動觸發器呼叫：每 10 分鐘把清單算好放進快取。
 * 這樣主管開頁時拿到的是現成結果，不必等 30 秒的掃描。
 */
function warmCache() {
  invalidatePendingCache_();
  var t0 = new Date().getTime();
  var res = getPendingCached_();
  Logger.log('✅ 快取已更新：' + res.rows.length + ' 筆待核，耗時 ' +
    ((new Date().getTime() - t0) / 1000).toFixed(1) + ' 秒');
}

/** 撈出所有分頁的待核清單（不經快取，checkSetup 與預熱用） */
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
  var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
  if (lastRow < startRow) return [];

  // 只讀到真正用得到的最後一欄。這些分頁的 getLastColumn() 常被最右邊的
  // 「業務確認」欄撐到 29，而我們最遠只需要簽核欄。
  var width = 1;
  var wanted = [COL_ORDER_NO, COL_APPLY_AT, COL_WORKER, COL_CUSTOMER, COL_PROJECT,
                COL_MODEL, COL_QTY, COL_PRICE, COL_DISPATCHER, COL_NOTE,
                COL_APPROVAL, COL_SUB_APPROVAL, COL_STATUS];
  for (var w = 0; w < wanted.length; w++) {
    var wc = ctx.col[wanted[w]];
    if (wc && wc > width) width = wc;
  }

  // 先只讀單號欄，找出最後一筆有單號的列。
  // 為什麼值得多一次往返：getLastRow() 會被格式或殘留內容撐到 800~1100 列，
  // 但實際資料只到 190 列左右。先花一次單欄讀取定出邊界，第二次就少讀 5~6 倍的格子。
  var noCol = ctx.col[COL_ORDER_NO];
  var span = lastRow - startRow + 1;
  var noVals = ctx.sheet.getRange(startRow, noCol, span, 1).getValues();
  var lastValid = -1;
  for (var v = 0; v < noVals.length; v++) {
    if (ORDER_NO_RE.test(String(noVals[v][0] || '').trim())) lastValid = v;
  }
  if (lastValid < 0) return [];

  var values = ctx.sheet.getRange(startRow, 1, lastValid + 1, width).getValues();
  var out = [];

  // raw／pick 提到迴圈外：原本每一列都重新建立兩個閉包，
  // 800 列 × 18 個分頁就是一萬多個用完即丟的函式物件。
  var row = null;
  function raw(name) {
    var c = ctx.col[name];
    return (c && c <= row.length) ? row[c - 1] : '';
  }
  function pick(name) {
    var v = raw(name);
    return String(v == null ? '' : v).trim();
  }

  for (var i = 0; i < values.length; i++) {
    row = values[i];

    var orderNo = pick(COL_ORDER_NO);
    // 最上面那幾列會寫「先寄未裝」「先寄門廠/宇泰」而不是單號——那是狀態註記，還不能簽核
    if (!orderNo || !ORDER_NO_RE.test(orderNo)) continue;

    var stage = stageOf_(ctx, pick(COL_SUB_APPROVAL), pick(COL_APPROVAL));
    if (!stage) continue;   // 已終結（主管已處理，或副主管已退回）

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
      // 主管指定要看的：工資報價（對客戶收）與承包報價（給承包商的單價），
      // 兩個並排才看得出這一單的毛利，這是他判斷要不要核的依據
      wage: fmtMoney_(raw(COL_WAGE)),
      unit: fmtMoney_(raw(COL_UNIT)),
      price: fmtMoney_(raw(COL_PRICE)),
      dispatcher: pick(COL_DISPATCHER),
      note: pick(COL_NOTE),
      stage: stage,
      subMark: pick(COL_SUB_APPROVAL),   // 主管層要看得到副主管是誰核的
      sheet: ctx.name,
      row: startRow + i
    });
  }
  return out;
}

/**
 * 這一列現在卡在哪一關。回傳 'sub'（等副主管）、'boss'（等主管）或 ''（已終結）。
 *
 * 判定順序刻意是「先看主管欄」：主管欄一填就終結，不管副主管欄是什麼狀態。
 * 為什麼：舊資料裡有主管已手打簽核、但副主管欄從沒填過的列。若先看副主管欄，
 * 這些單會被重新拉回副主管待核，等於把已完成的單倒退回去。
 */
function stageOf_(ctx, subVal, bossVal) {
  if (bossVal) return '';
  if (!ctx.twoStage) return 'boss';
  if (!subVal) return 'sub';
  if (isReject_(subVal)) return '';   // 副主管退回即終結，不往上送
  return 'boss';
}

/**
 * 是否為「退回」標記。只認 ❌ 開頭——那是本系統寫入的格式。
 * 不用關鍵字比對「退回」二字：舊資料是人工手打的姓名日期，
 * 若備註裡剛好出現「退回」就會被誤判成已退回而終結，是靜默的資料損失。
 */
function isReject_(v) {
  return String(v || '').charAt(0) === '❌';
}

/**
 * 跨所有分頁找出這個發包單號在哪一列。
 * 發包單號本身已含業務代碼前綴（JW/LS/SL/VH…），全域唯一，
 * 所以不需要前端回傳分頁名稱——少一個可被竄改的輸入。
 */
function findByOrderNo_(env, orderNo, hintSheet, hintRow) {
  // 位置提示（前端帶回來的分頁＋列號）只用來「先看一眼」，省下掃 18 個分頁的成本。
  // 它是可被竄改的輸入，所以一律要驗證那一格的單號真的吻合；不吻合就當提示不存在，
  // 走完整搜尋。也就是說提示只能讓事情變快，不能讓它指向別的列。
  if (hintSheet && hintRow) {
    for (var h = 0; h < env.list.length; h++) {
      var hc = env.list[h];
      if (hc.name !== hintSheet) continue;
      if (hintRow <= hc.headerRow || hintRow > (hc.lastRow || hc.sheet.getLastRow())) break;
      var at = String(hc.sheet.getRange(hintRow, hc.col[COL_ORDER_NO]).getValue() || '').trim();
      if (at === orderNo) return { ctx: hc, row: hintRow };
      break;   // 提示對不上（有人插刪過列），改走完整搜尋
    }
  }

  for (var k = 0; k < env.list.length; k++) {
    var ctx = env.list[k];
    var startRow = ctx.headerRow + 1;
    var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
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

// ────────────────────────────────────────────── 出貨登錄

var SHIP_CACHE_KEY = 'dispatch_shippable_v1';

/** 已核准？簽核欄以 ✅ 開頭。刻意不比對「核准」二字——舊資料是人工手打的自由文字。 */
function isApproved_(v) {
  return /^✅/.test(String(v || '').trim());
}

/** 取得（必要時建立）出貨明細分頁，回傳 {sheet, col} */
function openShipmentSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('DISPATCH_SHEET_ID');
  if (!id) throw new Error('未設定指令碼屬性 DISPATCH_SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(SHIPMENT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SHIPMENT_SHEET);
    sheet.appendRow(SHIPMENT_HEADERS);
    sheet.setFrozenRows(1);
  }
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var head = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var i = 0; i < head.length; i++) {
    var key = normHeader_(head[i]);
    if (key && !col[key]) col[key] = i + 1;
  }
  return { ss: ss, sheet: sheet, col: col };
}

/** 已經登錄過出貨的發包單號集合（同一發包單號可有多筆出貨，這裡只用來標示「已出過」） */
function shippedDispatchNos_() {
  var s = openShipmentSheet_();
  var last = s.sheet.getLastRow();
  var c = s.col[COL_S_DISPATCH];
  var set = {};
  if (!c || last < 2) return set;
  var vals = s.sheet.getRange(2, c, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] || '').trim();
    if (v) set[v] = (set[v] || 0) + 1;
  }
  return set;
}

/**
 * 待出貨清單：主管已核准、但還沒登錄過出貨的發包單。
 *
 * ⚠ 目前只涵蓋「有發包單」的那一半。約有一半的出貨是弱電料件、鎖胚、建案整批，
 *   在業務分頁上根本沒有列——那些要靠出貨頁下方的「直接登錄」新增，
 *   不會出現在這個清單裡。這是資料現況的限制，不是漏做。
 */
function getShippable_() {
  var env = openSheets_();
  var shipped = shippedDispatchNos_();
  var out = [];

  for (var k = 0; k < env.list.length; k++) {
    var ctx = env.list[k];
    if (!ctx.usable) continue;
    var startRow = ctx.headerRow + 1;
    var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
    if (lastRow < startRow) continue;

    var width = ctx.lastCol || ctx.sheet.getLastColumn();
    var values = ctx.sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();
    var row, raw, pick;
    raw = function (name) { var c = ctx.col[name]; return c ? row[c - 1] : ''; };
    pick = function (name) { var v = raw(name); return String(v == null ? '' : v).trim(); };

    for (var i = 0; i < values.length; i++) {
      row = values[i];
      var no = pick(COL_ORDER_NO);
      if (!no || !ORDER_NO_RE.test(no)) continue;
      if (!isApproved_(pick(COL_APPROVAL))) continue;   // 還沒核准的不能出貨
      if (shipped[no]) continue;                        // 已登錄過

      out.push({
        orderNo: no,
        applyAt: fmtDate_(raw(COL_APPLY_AT)),
        worker: pick(COL_WORKER),
        customer: pick(COL_CUSTOMER),
        project: pick(COL_PROJECT),
        model: pick(COL_MODEL),
        qty: pick(COL_QTY),
        note: pick(COL_NOTE),
        sheet: ctx.name,
        row: startRow + i
      });
    }
  }
  return out;
}

function getShippableCached_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(SHIP_CACHE_KEY);
    if (hit) {
      var obj = JSON.parse(hit);
      if (obj && obj.rows) return { rows: obj.rows, at: obj.at, cached: true };
    }
  } catch (err) {
    Logger.log('讀取待出貨快取失敗，改為即時掃描：' + err);
  }

  var rows = getShippable_();
  var at = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  try {
    var payload = JSON.stringify({ rows: rows, at: at });
    if (payload.length <= CACHE_MAX_BYTES) {
      cache.put(SHIP_CACHE_KEY, payload, CACHE_TTL);
    } else {
      Logger.log('⚠ 待出貨清單 ' + payload.length + ' bytes 超過快取上限，本次未寫入。');
    }
  } catch (err) {
    Logger.log('寫入待出貨快取失敗：' + err);
  }
  return { rows: rows, at: at, cached: false };
}

/**
 * 登錄一筆出貨。
 *
 * dispatchNo 可留空——約一半的出貨（弱電料件、鎖胚、建案整批）沒有發包單，
 * 那些單如果不能登錄，這張表就只涵蓋一半的出貨，等於沒有取代 Teams。
 */
function submitShipment(form) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };
  if (!rolesFor_(email).assistant) {
    return { ok: false, message: '您（' + email + '）不在助理名單中，未寫入任何資料。' };
  }

  form = form || {};
  var shipNo = String(form.shipNo || '').trim();
  var items = String(form.items || '').trim();
  if (!shipNo) return { ok: false, message: '出貨單號為必填。' };
  if (!items) return { ok: false, message: '出貨品項為必填（可從 TipTop 整段複製貼上）。' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return { ok: false, message: '系統忙碌中，請稍候再試。' }; }

  try {
    var s = openShipmentSheet_();

    // 同一張出貨單號重複登錄多半是手滑或重複送出，擋下來並告知已存在
    var last = s.sheet.getLastRow();
    var cNo = s.col[COL_S_SHIP_NO];
    if (cNo && last >= 2) {
      var exist = s.sheet.getRange(2, cNo, last - 1, 1).getValues();
      for (var i = 0; i < exist.length; i++) {
        if (String(exist[i][0] || '').trim() === shipNo) {
          return { ok: false, message: '出貨單號 ' + shipNo + ' 已經登錄過了（第 ' + (i + 2) + ' 列）。' };
        }
      }
    }

    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var rec = {};
    rec[COL_S_AT] = stamp;
    rec[COL_S_SHIP_NO] = shipNo;
    rec[COL_S_ORDER_ID] = String(form.orderId || '').trim();
    rec[COL_S_DISPATCH] = String(form.dispatchNo || '').trim();
    rec[COL_S_CUSTOMER] = String(form.customer || '').trim();
    rec[COL_S_PROJECT] = String(form.project || '').trim();
    rec[COL_S_ITEMS] = items;
    rec[COL_S_TO_NAME] = String(form.toName || '').trim();
    rec[COL_S_TO_PHONE] = String(form.toPhone || '').trim();
    rec[COL_S_TO_ADDR] = String(form.toAddr || '').trim();
    rec[COL_S_INVOICE] = String(form.invoice || '').trim();
    rec[COL_S_NOTE] = String(form.note || '').trim();
    rec[COL_S_BY] = email;
    rec[COL_S_WH_STATUS] = '待核';

    // 依表頭文字定位寫入，不用固定順序——之後有人在出貨明細插欄也不會錯位
    var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
    var line = [];
    for (var w = 0; w < width; w++) line.push('');
    for (var key in rec) {
      var c = s.col[key];
      if (c) line[c - 1] = rec[key];
    }
    s.sheet.appendRow(line);

    // 回寫出貨單號到業務分頁，讓業務在原本看慣的地方也看得到進度。
    // 失敗不影響主要登錄——出貨明細才是這筆資料的家。
    if (rec[COL_S_DISPATCH]) {
      try { writeBackShipNo_(rec[COL_S_DISPATCH], shipNo); }
      catch (e2) { Logger.log('回寫業務分頁出貨單號失敗（不影響登錄）：' + e2); }
    }

    SpreadsheetApp.flush();
    try { CacheService.getScriptCache().remove(SHIP_CACHE_KEY); } catch (e3) {}

    try { notifyWarehouse_(rec); }
    catch (e4) { Logger.log('通知倉庫失敗（出貨已登錄成功）：' + e4); }

    return { ok: true, message: '已登錄出貨單 ' + shipNo + '，已通知倉庫撿料。' };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

/** 把出貨單號回寫到業務分頁既有的出貨單號欄（欄名有 4 種寫法，靠別名找） */
function writeBackShipNo_(dispatchNo, shipNo) {
  var env = openSheets_();
  var hit = findByOrderNo_(env, dispatchNo);
  if (!hit) return;
  var ctx = hit.ctx, target = 0;
  for (var i = 0; i < COL_ALIAS_BACK.length; i++) {
    var c = ctx.col[normHeader_(COL_ALIAS_BACK[i])];
    if (c) { target = c; break; }
  }
  if (!target) return;   // 該分頁沒有這欄就算了，不是錯誤
  var cur = String(ctx.sheet.getRange(hit.row, target).getValue() || '').trim();
  ctx.sheet.getRange(hit.row, target).setValue(cur ? cur + '／' + shipNo : shipNo);
}

/** 通知倉庫撿料 */
function notifyWarehouse_(rec) {
  var webhook = PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_WAREHOUSE_WEBHOOK');
  if (!webhook) return { sent: false, reason: '未設定 DISPATCH_WAREHOUSE_WEBHOOK' };

  var lines = ['*待撿料出貨*', ''];
  lines.push('出貨單號：' + rec[COL_S_SHIP_NO]);
  if (rec[COL_S_ORDER_ID]) lines.push('訂單編號：' + rec[COL_S_ORDER_ID]);
  if (rec[COL_S_CUSTOMER]) {
    lines.push('客戶：' + rec[COL_S_CUSTOMER] +
      (rec[COL_S_PROJECT] ? '（' + rec[COL_S_PROJECT] + '）' : ''));
  }
  lines.push('');
  lines.push('出貨項目：');
  lines.push(rec[COL_S_ITEMS]);
  if (rec[COL_S_TO_NAME] || rec[COL_S_TO_ADDR]) {
    lines.push('');
    lines.push('貨指寄：');
    if (rec[COL_S_TO_NAME]) lines.push(rec[COL_S_TO_NAME] +
      (rec[COL_S_TO_PHONE] ? '　' + rec[COL_S_TO_PHONE] : ''));
    if (rec[COL_S_TO_ADDR]) lines.push(rec[COL_S_TO_ADDR]);
  }
  if (rec[COL_S_INVOICE]) { lines.push(''); lines.push('發票：' + rec[COL_S_INVOICE]); }
  if (rec[COL_S_NOTE]) lines.push('備註：' + rec[COL_S_NOTE]);
  lines.push('');
  lines.push('登錄：' + rec[COL_S_BY] + '　' + rec[COL_S_AT]);

  var resp = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text: lines.join('\n') }),
    muteHttpExceptions: true
  });
  var ok = resp.getResponseCode() >= 200 && resp.getResponseCode() < 300;
  if (!ok) Logger.log('通知倉庫失敗 HTTP ' + resp.getResponseCode());
  return { sent: ok };
}

// ────────────────────────────────────────────── 人員代碼對照 ／ 核准後通知助理

/**
 * 讀人員代碼對照表，回傳 { 代碼大寫: {code,sales,salesMail,type,assist,assistMail} }。
 * 讀不到就回空物件——路由通知失效不該讓簽核本身失敗，簽核才是主線。
 */
function loadRoster_() {
  var props = PropertiesService.getScriptProperties();
  var name = String(props.getProperty('DISPATCH_ROSTER_SHEET') || ROSTER_SHEET_DEFAULT).trim();
  var id = props.getProperty('DISPATCH_SHEET_ID');
  if (!id || !name) return {};

  try {
    var sheet = SpreadsheetApp.openById(id).getSheetByName(name);
    if (!sheet) return {};
    var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return {};

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headerRow = -1;
    for (var r = 0; r < Math.min(values.length, MAX_SCAN_HEADER_ROWS); r++) {
      for (var c = 0; c < values[r].length; c++) {
        if (normHeader_(values[r][c]) === COL_R_CODE) { headerRow = r; break; }
      }
      if (headerRow >= 0) break;
    }
    if (headerRow < 0) return {};

    var col = {};
    for (var k = 0; k < values[headerRow].length; k++) {
      var key = normHeader_(values[headerRow][k]);
      if (key && !col[key]) col[key] = k;
    }
    if (col[COL_R_CODE] === undefined) return {};

    var at = function (row, name2) {
      var idx = col[name2];
      return idx === undefined ? '' : String(row[idx] == null ? '' : row[idx]).trim();
    };

    var out = {};
    for (var i = headerRow + 1; i < values.length; i++) {
      var code = at(values[i], COL_R_CODE).toUpperCase();
      if (!code) continue;
      out[code] = {
        code: code,
        sales: at(values[i], COL_R_SALES),
        salesMail: at(values[i], COL_R_SALES_MAIL),
        type: at(values[i], COL_R_TYPE),
        assist: at(values[i], COL_R_ASSIST),
        assistMail: at(values[i], COL_R_ASSIST_MAIL)
      };
    }
    return out;
  } catch (err) {
    Logger.log('讀人員代碼對照表失敗（不影響簽核）：' + err);
    return {};
  }
}

/** 從發包單號取出業務代碼前綴（LS-260806-01 → LS） */
function codeOf_(orderNo) {
  var m = String(orderNo || '').match(/^([A-Za-z]{2})-/);
  return m ? m[1].toUpperCase() : '';
}

/**
 * 主管核准（＝終局）後通知對應助理去 TipTop 打出貨單。
 *
 * 查不到對照時**不靜默跳過**——照樣發通知但明講「查無對應助理」。
 * 實際資料裡已經出現 ST、TL 這兩個代碼，而對照表目前只有 JW/LS/VH/SL；
 * 靜默跳過的話，那些單會核完就沒下文，沒有人知道該接手。
 */
function notifyAssistant_(rec) {
  var webhook = PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_WAREHOUSE_WEBHOOK');
  if (!webhook) return { sent: false, reason: '未設定 DISPATCH_WAREHOUSE_WEBHOOK' };

  var code = codeOf_(rec.orderNo);
  var person = loadRoster_()[code] || null;

  var lines = ['*已核准，可開出貨單*', ''];
  lines.push('• 發包單號：' + rec.orderNo);
  if (rec.worker) lines.push('• 承包商：' + rec.worker);
  if (rec.customer) lines.push('• 客戶：' + rec.customer + (rec.project ? '（' + rec.project + '）' : ''));
  if (rec.model) lines.push('• 型號：' + rec.model + (rec.qty ? ' × ' + rec.qty : ''));
  lines.push('• 核准：' + rec.who + '　' + rec.at);
  lines.push('');

  if (person && person.assist) {
    lines.push('請 *' + person.assist + '* 接手打出貨單' +
      (person.type ? '（' + person.type + '）' : ''));
  } else {
    lines.push('⚠ 代碼「' + (code || '?') + '」在人員代碼對照表查無對應助理，請人工確認由誰接手。');
  }

  try {
    var resp = UrlFetchApp.fetch(webhook, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ text: lines.join('\n') }),
      muteHttpExceptions: true
    });
    var ok = resp.getResponseCode() >= 200 && resp.getResponseCode() < 300;
    if (!ok) Logger.log('通知助理失敗 HTTP ' + resp.getResponseCode() + '：' +
      resp.getContentText().slice(0, 200));
    return { sent: ok, matched: !!(person && person.assist) };
  } catch (err) {
    Logger.log('通知助理例外（不影響簽核）：' + err);
    return { sent: false, reason: String(err) };
  }
}

// ────────────────────────────────────────────── 稽核軌跡

/**
 * 寫一筆稽核紀錄。
 *
 * 依「表頭文字」定位，不靠欄位順序——沿用本檔讀發包表的同一套做法。
 * 為什麼非這樣不可：既有的簽核紀錄分頁是早期版本的表頭（6 欄，且叫「試算表列號」
 * 而不是「分頁」＋「列號」）。若照新順序 appendRow 8 個值，整張稽核表會錯位，
 * 而稽核紀錄錯位是最不能接受的一種 bug——它是出事時唯一的依據。
 *
 * 舊表頭沒有「層級」欄時，層級併進「動作」（寫成「主管核准」），資訊不遺失。
 */
function appendAudit_(ss, rec) {
  var HEAD = ['時間', '操作者', '層級', '發包單號', '動作', '說明', '分頁', '列號'];
  var sh = ss.getSheetByName(AUDIT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_SHEET);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
  }

  var lastCol = sh.getLastColumn();
  var head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var pos = {};
  for (var i = 0; i < head.length; i++) {
    var k = normHeader_(head[i]);
    if (k && !pos[k]) pos[k] = i + 1;
  }

  // 表頭是空的（有人清過內容）就補回來，否則資料會落在沒有標題的欄位上
  if (!pos[normHeader_('發包單號')]) {
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    pos = {};
    for (var j = 0; j < HEAD.length; j++) pos[normHeader_(HEAD[j])] = j + 1;
    lastCol = HEAD.length;
  }

  var hasRole = !!pos[normHeader_('層級')];
  // 舊表頭沒有「分頁」欄，只有「試算表列號」。單獨一個列號在 18 個分頁的表裡
  // 指不到任何東西，所以降級成「分頁名!列號」，維持可追溯。
  var hasSheetCol = !!pos[normHeader_('分頁')];
  var vals = {};
  vals[normHeader_('時間')] = rec.at;
  vals[normHeader_('操作者')] = rec.who;
  vals[normHeader_('層級')] = rec.role || '';
  vals[normHeader_('發包單號')] = rec.orderNo;
  vals[normHeader_('動作')] = hasRole ? rec.action : ((rec.role || '') + rec.action);
  vals[normHeader_('說明')] = rec.note;
  vals[normHeader_('分頁')] = rec.sheet;
  vals[normHeader_('列號')] = rec.row;
  vals[normHeader_('試算表列號')] = hasSheetCol ? rec.row : (rec.sheet + '!' + rec.row);

  var width = Math.max(lastCol, 1);
  var out = [];
  for (var c = 0; c < width; c++) out.push('');
  for (var name in vals) {
    if (pos[name]) out[pos[name] - 1] = vals[name];
  }
  sh.appendRow(out);
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
    '.msg.warn{background:#FEF3C7;color:#92400E}' +
    '.nav{display:flex;gap:6px;margin-bottom:12px}' +
    '.tab{padding:6px 16px;border-radius:7px;font-size:13px;font-weight:700;' +
      'text-decoration:none;background:#fff;color:#64748B;border:1px solid #E2E8F0}' +
    '.tab.on{background:#0F2744;color:#fff;border-color:#0F2744}' +
    'label{display:block;font-size:11.5px;font-weight:700;color:#475569;margin:10px 0 3px}' +
    'input,select,textarea{width:100%;border:1px solid #E2E8F0;border-radius:7px;' +
      'padding:8px 10px;font-size:13.5px;font-family:inherit;outline:none}' +
    'input:focus,select:focus,textarea:focus{border-color:#38BDF8}' +
    'textarea{resize:vertical;font-family:ui-monospace,monospace;font-size:12.5px}' +
    '.two{display:flex;gap:10px}.two>div{flex:1;min-width:0}' +
    '.pick{padding:9px 11px;border:1px solid #E2E8F0;border-radius:8px;margin-top:6px;' +
      'cursor:pointer;font-size:13px}' +
    '.pick:hover{background:#F8FAFC;border-color:#38BDF8}' +
    '.pick .sub{font-size:11px;color:#94A3B8;margin-top:2px}' +
    '.note{font-size:11px;color:#94A3B8;margin-top:8px;line-height:1.6}' +
    '.sec{font-size:12.5px;font-weight:700;color:#0F2744;margin:14px 0 7px;' +
      'display:flex;align-items:baseline;gap:7px}' +
    '.sec span{font-weight:400;font-size:11px;color:#94A3B8}';

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

function listBlock_(email, rows, allow, meta) {
  allow = allow || { sub: true, boss: true, unrestricted: true };
  meta = meta || {};

  var role = allow.unrestricted ? ''
    : (allow.sub && allow.boss) ? '副主管＋主管'
    : allow.sub ? '副主管' : '主管';

  var head =
    '<div class="hd"><div class="ic">📋</div><div>' +
    '<h1>發包簽核</h1><p>' + esc_(email) +
    (role ? '　·　' + esc_(role) : '') + '</p></div></div>' +
    '<div id="msg"></div>';

  var subRows = [], bossRows = [];
  for (var s = 0; s < rows.length; s++) {
    (rows[s].stage === 'sub' ? subRows : bossRows).push(rows[s]);
  }

  // 只顯示這個人能簽的那幾層。不顯示按下去一定會被拒絕的按鈕——
  // 主管看到 15 筆副主管待核，會先困惑、再按、被擋，然後懷疑系統壞了。
  var hiddenSub = allow.sub ? 0 : subRows.length;
  var hiddenBoss = allow.boss ? 0 : bossRows.length;
  if (!allow.sub) subRows = [];
  if (!allow.boss) bossRows = [];

  // 別人那一層還有多少，用一行字說明就好。完全不提的話，
  // 主管會以為「清單空了＝全部處理完了」，其實是卡在副主管那關。
  var otherNote = '';
  if (hiddenSub) otherNote += '另有 ' + hiddenSub + ' 筆待副主管核准（不在您的權限範圍）。';
  if (hiddenBoss) otherNote += '另有 ' + hiddenBoss + ' 筆待主管核准（不在您的權限範圍）。';

  if (!subRows.length && !bossRows.length) {
    return head + '<div class="card"><div class="center">' +
      '目前沒有需要您簽核的項目 👍' +
      (otherNote ? '<div class="note" style="margin-top:10px">' + esc_(otherNote) + '</div>' : '') +
      '</div></div>';
  }

  var cards = '';
  if (subRows.length) {
    cards += '<div class="sec">副主管待核（' + subRows.length + '）' +
             '<span>核准後才會送到主管清單</span></div>' + cardsOf_(subRows, 's');
  }
  if (bossRows.length) {
    cards += '<div class="sec">主管待核（' + bossRows.length + '）</div>' +
             cardsOf_(bossRows, 'b');
  }
  // 不論有沒有卡片都要說明別層的筆數，否則清單看起來短、卻不知道是卡在別人那關
  if (otherNote) {
    cards += '<div class="note">' + esc_(otherNote) + '</div>';
  }

  var script =
    '<script>' +
    'function show(t,cls){var m=document.getElementById("msg");' +
      'm.innerHTML=\'<div class="msg \'+cls+\'">\'+t+\'</div>\';window.scrollTo(0,0);}' +
    'function act(no,dec,cardId,sh,rw){' +
      'var note="";' +
      'if(dec==="reject"){note=prompt("退回原因（會寫進紀錄，讓業務知道要改什麼）：")||"";' +
        'if(!note.trim()){return;}}' +
      'var card=document.getElementById(cardId);' +
      'var btns=card.querySelectorAll("button");' +
      'for(var i=0;i<btns.length;i++){btns[i].disabled=true;}' +
      'var old=btns[0].textContent;btns[0].textContent="處理中…";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'if(res.ok){card.parentNode.removeChild(card);show(res.message,"done");' +
            'if(!document.querySelectorAll(".card").length){' +
              'show("全部處理完畢 👍","done");}}' +
          'else{for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
            'btns[0].textContent=old;show(res.message,"fail");}' +
        '})' +
        '.withFailureHandler(function(err){' +
          'for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
          'btns[0].textContent=old;' +
          'show("連線失敗："+err.message,"fail");})' +
        '.submitDecision(no,dec,note,sh,rw);' +
    '}' +
    '</script>';

  // 清單可能是幾分鐘前算的，這件事要寫在畫面上。
  // 藏起來的話，業務剛開的單沒出現時，主管會以為系統漏單。
  var stamp = meta.at
    ? '清單資料時間 ' + esc_(meta.at) + (meta.cached ? '（快取）' : '（即時）') + '。' +
      '業務新開的單最多 15 分鐘後出現；您自己剛簽的會立刻反映。'
    : '';

  var footer = '<div class="note">' + stamp +
               '<br>簽核者身分取自您的 Google 帳號，無法手動修改。' +
               '簽核的層級由系統依該筆目前狀態判定，不由畫面決定。' +
               '每一筆核准／退回都會記錄在試算表的「' + AUDIT_SHEET + '」分頁。</div>';

  return head + cards + footer + script;
}

/** 產生卡片群。prefix 讓兩區的 DOM id 不會撞在一起 */
function cardsOf_(rows, prefix) {
  var cards = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var id = prefix + i;
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
          (r.wage ? tr_('工資報價', 'NT$ ' + r.wage + '（對客戶）') : '') +
          (r.unit ? tr_('承包報價', 'NT$ ' + r.unit + '（單價）') : '') +
          '<tr><th>承包總價</th><td class="amt">' +
            (r.price ? 'NT$ ' + esc_(r.price) : '—') + '</td></tr>' +
          (r.note ? tr_('補充說明', r.note) : '') +
          (r.stage === 'boss' && r.subMark ? tr_('副主管', r.subMark) : '') +
        '</table>' +
        '<div class="row">' +
          '<button class="ok" onclick="act(\'' + jsq_(r.orderNo) + '\',\'approve\',\'' + id +
            '\',\'' + jsq_(r.sheet) + '\',' + r.row + ')">✅ 核准</button>' +
          '<button class="no-btn" onclick="act(\'' + jsq_(r.orderNo) + '\',\'reject\',\'' + id +
            '\',\'' + jsq_(r.sheet) + '\',' + r.row + ')">❌ 退回</button>' +
        '</div>' +
      '</div>';
  }
  return cards;
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
/**
 * 出貨頁自檢。唯讀，不會寫入任何資料、不會發任何通知。
 * 另開一支而不是塞進 checkSetup()——checkSetup 已經要掃 18 個分頁，
 * 再加一次完整掃描會讓每天的例行自檢變成兩倍時間。
 */
function checkShipSetup() {
  var props = PropertiesService.getScriptProperties();

  var raw = String(props.getProperty('DISPATCH_ASSISTANTS') || '').trim();
  if (!raw) {
    Logger.log('❌ DISPATCH_ASSISTANTS 未設定 → 出貨頁目前對所有人開放（畫面會示警）');
  } else {
    Logger.log('DISPATCH_ASSISTANTS = ' + raw.split(/[,;\s]+/).filter(String).join('、'));
  }
  Logger.log('DISPATCH_WAREHOUSE_WEBHOOK = ' +
    (props.getProperty('DISPATCH_WAREHOUSE_WEBHOOK') ? '已設定' : '❌ 未設定（登錄後不會通知倉庫）'));

  var me = currentUserEmail_();
  var roles = rolesFor_(me);
  var canApprove = roles.sub || roles.boss;
  Logger.log('目前登入 ' + me + '｜可看頁面：' +
    (canApprove ? '簽核 ' : '') + (roles.assistant ? '出貨' : '') +
    (canApprove || roles.assistant ? '' : '（無，會看到「無權限」畫面）'));

  try {
    var s = openShipmentSheet_();
    var last = s.sheet.getLastRow();
    Logger.log('✅ 出貨明細分頁存在，目前 ' + Math.max(last - 1, 0) + ' 筆資料');

    var missing = [];
    for (var i = 0; i < SHIPMENT_HEADERS.length; i++) {
      if (!s.col[normHeader_(SHIPMENT_HEADERS[i])]) missing.push(SHIPMENT_HEADERS[i]);
    }
    if (missing.length) {
      Logger.log('⚠ 出貨明細缺欄位：' + missing.join('、') +
        ' → 這些欄位的內容會被丟掉（寫入依表頭文字定位，找不到就不寫）');
    } else {
      Logger.log('　 欄位齊全（' + SHIPMENT_HEADERS.length + ' 欄）');
    }
  } catch (err) {
    Logger.log('❌ 出貨明細分頁檢查失敗：' + err);
    return;
  }

  try {
    var rows = getShippable_();
    Logger.log('待出貨（已核准、尚未登錄出貨）：' + rows.length + ' 筆');
    for (var k = 0; k < Math.min(rows.length, 5); k++) {
      Logger.log('　• ' + rows[k].orderNo + '｜' + rows[k].sheet + '｜' +
        (rows[k].customer || '—') + '｜' + (rows[k].project || '—'));
    }
    if (rows.length > 5) Logger.log('　…其餘 ' + (rows.length - 5) + ' 筆略');
    if (!rows.length) {
      Logger.log('　 清單空的不一定是壞掉：簽核欄必須是 ✅ 開頭才算已核准（手打「核准」不算）。');
    }
  } catch (e2) {
    Logger.log('❌ 待出貨清單讀取失敗：' + e2);
  }
}

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
      if (!ctx.col[COL_PRICE]) missing.push(COL_PRICE + '（金額會顯示為 —）');
      var rows = pendingOfSheet_(ctx);
      all = all.concat(rows);
      var nSub = 0;
      for (var m = 0; m < rows.length; m++) if (rows[m].stage === 'sub') nSub++;
      Logger.log('　• ' + ctx.name + '｜表頭第 ' + ctx.headerRow + ' 列｜' +
        (ctx.twoStage ? '兩層簽核' : '單層簽核') + '｜待核 ' + rows.length + ' 筆' +
        (ctx.twoStage ? '（副主管 ' + nSub + '／主管 ' + (rows.length - nSub) + '）' : '') +
        (missing.length ? '｜⚠ 缺欄位：' + missing.join('、') : '｜欄位齊全'));
    }

    var totalSub = 0;
    for (var n = 0; n < all.length; n++) if (all[n].stage === 'sub') totalSub++;
    Logger.log('合計待核：' + all.length + ' 筆（副主管層 ' + totalSub +
      '／主管層 ' + (all.length - totalSub) + '，納入 ' +
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

  // 人員代碼對照：核准後要靠它決定通知哪位助理
  Logger.log('DISPATCH_WAREHOUSE_WEBHOOK = ' +
    (props.getProperty('DISPATCH_WAREHOUSE_WEBHOOK') ? '已設定' : '❌ 未設定（核准後不會通知助理）'));
  var roster = loadRoster_();
  var codes = Object.keys(roster);
  if (!codes.length) {
    Logger.log('❌ 讀不到人員代碼對照表（分頁「' +
      (props.getProperty('DISPATCH_ROSTER_SHEET') || ROSTER_SHEET_DEFAULT) +
      '」），核准後無法判斷通知誰');
  } else {
    Logger.log('人員代碼對照：' + codes.length + ' 筆　' +
      codes.map(function (c) { return c + '→' + (roster[c].assist || '?'); }).join('、'));

    // 實際待核資料裡出現、但對照表沒有的代碼——這些單核完會沒人接手
    try {
      var seen = {};
      var pend = getPending_();
      for (var m = 0; m < pend.length; m++) {
        var cd = codeOf_(pend[m].orderNo);
        if (cd && !roster[cd]) seen[cd] = (seen[cd] || 0) + 1;
      }
      var orphan = Object.keys(seen);
      if (orphan.length) {
        Logger.log('⚠ 待核資料裡有對照表沒收錄的代碼：' +
          orphan.map(function (c) { return c + '(' + seen[c] + '筆)'; }).join('、') +
          ' → 這些單核准後只會提示「查無對應助理」');
      }
    } catch (e3) { /* 對照檢查失敗不影響其他自檢項目 */ }
  }

  // 兩層簽核若沒有名單，同一個人可以自己核完兩層——那就只是同一個簽名蓋兩次
  var sub = String(props.getProperty('DISPATCH_SUB_APPROVERS') || '').trim();
  var boss = String(props.getProperty('DISPATCH_BOSS_APPROVERS') || '').trim();
  Logger.log('DISPATCH_SUB_APPROVERS  = ' + (sub || '❌ 未設定'));
  Logger.log('DISPATCH_BOSS_APPROVERS = ' + (boss || '❌ 未設定'));
  if (!sub && !boss) {
    Logger.log('⚠ 兩份名單都沒設定：任何機構內成員都能核，' +
      '且同一個人可以先核副主管層、再核主管層——兩層覆核形同虛設。' +
      '（系統仍可運作，稽核紀錄會標記此降級狀態）');
  } else if (!sub || !boss) {
    Logger.log('⛔ 只設定了一份名單。沒設的那一層「沒有任何人有權限」，' +
      '該層的待核項目不會顯示給任何人，也核不了——那些單會就這樣卡住。' +
      '請把兩份都設好。');
  }

  Logger.log('登入身分（在編輯器手動執行時可能為空，屬正常）：' + currentUserEmail_());
}

/**
 * 檢查每個分頁的「受保護範圍」有沒有蓋住該分頁的簽核欄。
 *
 * 為什麼需要這支：18 個分頁的欄位順序不同，同一個欄位代號在不同分頁是不同東西。
 * 逐頁人工核對 18 次很容易漏，而漏掉的後果是「簽核看起來有效、其實可被任意手改」——
 * 這種失效不會有任何錯誤訊息。順帶也抓出鎖錯欄（例如鎖到金額欄，業務會填不進去）。
 *
 * 唯讀，不會修改任何保護設定。
 */
function checkProtections() {
  var env;
  try {
    env = openSheets_();
  } catch (err) {
    Logger.log('❌ ' + err);
    return;
  }

  var bad = [], wrong = [];

  for (var i = 0; i < env.list.length; i++) {
    var ctx = env.list[i];
    var prot = ctx.sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);

    // 蒐集被保護的欄號
    var locked = {};
    var desc = [];
    for (var p = 0; p < prot.length; p++) {
      var rg = prot[p].getRange();
      if (!rg) continue;
      var c1 = rg.getColumn(), c2 = c1 + rg.getNumColumns() - 1;
      for (var c = c1; c <= c2; c++) locked[c] = true;
      desc.push(rg.getA1Notation());
    }
    var sheetProt = ctx.sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0;

    var need = [{ col: ctx.col[COL_APPROVAL], name: COL_APPROVAL }];
    if (ctx.twoStage) need.push({ col: ctx.col[COL_SUB_APPROVAL], name: COL_SUB_APPROVAL });
    if (ctx.col[COL_STATUS]) need.push({ col: ctx.col[COL_STATUS], name: COL_STATUS });

    var unlocked = [];
    for (var n = 0; n < need.length; n++) {
      if (!locked[need[n].col]) {
        unlocked.push(need[n].name + '(' + colLetter_(need[n].col) + ')');
      }
    }

    // 被鎖住、但不該被鎖的欄位（人工填寫欄被誤鎖，業務會填不進去）
    var over = [];
    for (var lc in locked) {
      var isNeeded = false;
      for (var m = 0; m < need.length; m++) if (String(need[m].col) === lc) isNeeded = true;
      if (!isNeeded) {
        var hname = headerNameOf_(ctx, Number(lc));
        if (hname) over.push(hname + '(' + colLetter_(Number(lc)) + ')');
      }
    }

    var line = '　' + (unlocked.length ? '⛔' : '✅') + ' ' + ctx.name +
      '｜' + (ctx.twoStage ? '兩層' : '單層') +
      '｜已保護：' + (desc.length ? desc.join('、') : (sheetProt ? '整個工作表' : '（無）'));
    if (unlocked.length) line += '｜🔴 未保護：' + unlocked.join('、');
    if (over.length) line += '｜⚠ 多鎖了：' + over.join('、');
    Logger.log(line);

    if (unlocked.length) bad.push(ctx.name);
    if (over.length) wrong.push(ctx.name + '→' + over.join('、'));
  }

  Logger.log('──────────');
  if (bad.length) {
    Logger.log('⛔ ' + bad.length + ' 個分頁的簽核欄「沒有」受保護，簽核結果可被任意手改：' +
      bad.join('、'));
    Logger.log('　 → 依 docs/發包試算表_欄位規格.md 第三節的對照表逐頁補設。');
  } else {
    Logger.log('✅ 所有納入的分頁，簽核欄都在受保護範圍內。');
  }
  if (wrong.length) {
    Logger.log('⚠ 以下分頁鎖到了不該鎖的欄位，該欄位的填寫人（業務／助理）會被擋住：');
    for (var w = 0; w < wrong.length; w++) Logger.log('　 • ' + wrong[w]);
  }
  Logger.log('（注意：被略過的分頁不在檢查範圍內，它們連簽核欄都還沒有。）');
}

/** 欄號 → 欄字母（1→A、27→AA） */
function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 欄號 → 該分頁的表頭文字（供錯誤訊息指名道姓） */
function headerNameOf_(ctx, colNum) {
  for (var k in ctx.col) {
    if (ctx.col[k] === colNum) return k;
  }
  var v = ctx.sheet.getRange(ctx.headerRow, colNum).getValue();
  return normHeader_(v);
}
