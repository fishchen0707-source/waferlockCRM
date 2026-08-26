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
// 下單填的是「報價單數量」（這一單總共要幾組），不是「本次請款數量」（這次要請幾組的錢）。
// 兩者在既有表上是不同欄位，寫錯會讓累計請款從第一天就算錯——防超額付款是靠累計欄的。
var COL_QUOTE_QTY = '報價單數量';
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
// 部分分頁叫「合約數量」（一課-BILL／行銷／一課-eli 等）
COL_ALIAS[COL_QUOTE_QTY] = ['報價單數量', '合約數量'];
// 一課-sin 的欄名是「發包日期」。少這個別名，該分頁的申請日一律讀成空值，
// DISPATCH_PENDING_SINCE 的日期過濾對整個分頁失效——歷史單會全部湧進待核清單。
COL_ALIAS[COL_APPLY_AT] = ['發包申請日期', '發包日期'];

// ── 人員代碼對照表（發包單號前綴 → 業務 → 對應助理）────────────────
// 為什麼一定要查表、不能用程式從姓名推導：實際的代碼規則不一致——
//   Johnson Wu → JW（名+姓）    sammi lin → LS（姓+名，反過來）    sean lin → SL
// 而且 SL 與 LS 只差順序、是兩個不同的人。任何推導規則都會出錯。
var ROSTER_SHEET_DEFAULT = '人員代碼';
// 實際建出來的分頁叫「路由對照表」。與其要求先改分頁名或多設一個屬性，
// 兩個名字都認——分頁名不符時 loadRoster_ 是「靜默回空物件」，
// 通知照發、只是點名不到人，這種失效可能幾週都沒人發現。
// 順序即優先序；DISPATCH_ROSTER_SHEET 有設定時一律以它為準。
var ROSTER_SHEET_NAMES = ['路由對照表', '人員代碼'];
var COL_R_CODE       = '業務代碼';
var COL_R_SALES      = '業務姓名';
var COL_R_SALES_MAIL = '業務email';    // normHeader_ 會去掉空白，「業務 email」也對得上
var COL_R_TYPE       = '類別';
var COL_R_ASSIST     = '對應助理';
var COL_R_ASSIST_MAIL= '助理email';
// ① 業務下單頁要知道「這個業務的單寫進哪個分頁」。
// 不能從代碼或姓名推導：JW 對應「零售-Johnson」還算看得出來，
// 但「一課-eli」「一課-sin」「一課-sam」都是暱稱，猜錯就是把單寫到別人的表上。
// 用 suggestSheetMapping() 產生建議清單，人工確認後填這一欄。
var COL_R_SHEET      = '發包分頁';

// ── ① 業務下單 ──────────────────────────────────────────────
var ORDER_KIND_INSTALL = '發包安裝';
var ORDER_KIND_PARTS   = '料件出貨';
var ORDER_KINDS = [ORDER_KIND_INSTALL, ORDER_KIND_PARTS];

// 截圖下單是下單頁上跟前兩者並列的第三顆按鈕，但它**刻意不是 ORDER_KINDS 的一員**。
// ORDER_KINDS 裡的值會被原樣寫進試算表的單別欄，而且免簽核判定（ORDER_NO_SIGN_MARK）、
// 通知文案、報表分類全都靠比對那個值。截圖下單走的是完全不同的路徑
// （submitQuickOrder → 發案件號、不寫發包單號），沒有「單別」這個欄位要填。
// 把它加進 ORDER_KINDS 會讓「截圖下單」四個字被當成一種單別寫進試算表，
// 那是資料汙染，而且要等到有人去看報表分類才會發現。
var ORDER_MODE_QUICK = '截圖下單';

// 料件出貨不經主管簽核（2026-08-07 確認）。但它必須能進助理的待出貨清單，
// 而那份清單是用 isApproved_()（只認 ✅ 開頭）判定的，簽核欄留空又會讓它
// 出現在主管待核清單裡。所以寫一個以 ✅ 開頭、文字明講免簽核的標記：
// 兩邊的判定都不必改，而且沒有人會把它誤讀成主管核准過。
var ORDER_NO_SIGN_MARK = '✅ 免簽核（' + ORDER_KIND_PARTS + '）';

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
// 全公司唯一值（案件號）。格式與 CRM 的報修 R／客訴 C／安裝 IW 同一套：
// `{前綴}{YYYYMMDD}{4碼流水}`，由 Supabase 的 next_case_no() 原子發號。
//
// ⚠ 這一欄現在**刻意允許留空**。第一階段只是把欄位與發號準備好，
//   不強制任何人填——先立規矩再談普及，只會讓大家找理由不用。
//   等業務下單頁會自動帶號之後，它才會開始有值。
var COL_S_CASE_NO   = '案件號';
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
// 發票電子檔的 Drive 連結。倉庫核單時上傳，備存通知帶這條連結，助理自己下載自己寄。
// 解掉倉庫一訪的三個痛點：紙本印了才發現對方要電子檔（白印）、寄錯發票、地址不完整被退回。
var COL_S_INVOICE_URL = '發票檔案';
// 發票號碼是倉庫的工作，不是助理的（2026-08-14 使用者確認）。掛在倉庫上傳
// 發票電子檔的同一個動作上——那正是倉庫手上會拿到號碼的時刻，不必另開一個步驟。
var COL_S_INVOICE_NO  = '發票號碼';

// 業務下單時就填的欄位（來源：業務發給助理的 Teams 訊息，見設計文件修訂節）。
// 這些原本以為是助理從 TipTop 抄回來的，實際上是業務提供的——
// 放在助理那頁等於要她重打一遍業務已經寫好的東西。
var COL_S_SHIP_DATE  = '出貨日期';        // 助理填（TipTop 出貨當天）
var COL_S_CHANNEL_NO = '通路訂單編號';    // 例 MOMO 訂單編號
var COL_S_CUST_NAME  = '客人姓名';        // 最終消費者，與「貨指寄」是不同的人
var COL_S_CUST_PHONE = '客人電話';
var COL_S_CUST_ADDR  = '客人地址';
var COL_S_SALE_PRICE = '售價';
var COL_S_COST_PRICE = '進價';            // ⚠ 敏感；目前無欄位級權限，見設計文件
var COL_S_ORDER_BY   = '下單業務';        // 業務下單時帶入，與「登錄人」（助理）分開
// 師傅通知需要、而其他地方都沒有的兩項。對照實際的師傅通知訊息：
//   2026-08-03 / L901-平日1-4 / 裝外門 / 孫明恩0953-644733 / 臺北市…/ VH-260803-01
// 六行裡有四行已經有了（型號、客人姓名電話、客人地址、發包單號），只缺這兩個。
// 安裝地點就是客人家——客人地址即案場地址，客人姓名電話即現場聯絡人。
var COL_S_WORK_TIME  = '施工時段';        // 例「平日1-4」。自由文字，沿用現行寫法
var COL_S_WORK_ITEM  = '工項';            // 例「裝外門」

// 退單（2026-08-20 使用者提出，來源是群組裡的真實對話：
// 「Molly Hsu 麻煩退單 改出貨單備註 謝謝哦」）。
//
// ⚠ **GAS 不能真的退單**。出貨單號是 TipTop 發的，真正的退單動作在 ERP 裡。
//   這一欄只做「記錄、通知、把狀態顯示出來」——讓「誰要求退、為什麼、誰處理了」
//   從群組裡一句話講完就沒了，變成有軌跡的事。
//
// 為什麼獨立一欄、不塞進「倉庫核單狀態」：
//   退單可能在倉庫還沒碰到這張單的時候就發生（使用者確認「什麼階段都有」），
//   混進去會讓倉庫的狀態機語意壞掉。而且倉庫的「有問題」是撿不了料、方向由倉庫往外，
//   退單是業務要求改單、方向相反，兩者各自獨立（2026-08-20 使用者確認）。
//
// 值的格式沿用簽核欄的既有寫法（狀態＋人＋時間＋原因塞成一個字串，靠開頭字元判斷）：
//   申請中：🔄 退單 <發起人> <時間>｜<原因>
//   已處理：✅ 已處理 <處理人> <時間>｜<原本的原因>
var COL_S_RETURN = '退單';

// ── 貨運單（倉庫上傳託運總表後自動回填）────────────────────
//
// 🔑 **這兩欄是「出貨了嗎」唯一能誠實回答的依據。**
//    使用者定義的判準就是「看到貨運單才算出貨」——出貨日期是助理人工回填的、
//    倉庫核單狀態是單據審核，兩者都不代表貨真的離開倉庫。
//    只有這裡有值，才可以說「已出貨」。
var COL_S_TRACK_NO = '貨運單號';
var COL_S_TRACK_AT = '貨運日期';

var SHIPMENT_HEADERS = [
  COL_S_CASE_NO,
  COL_S_AT, COL_S_SHIP_NO, COL_S_ORDER_ID, COL_S_SHIP_DATE, COL_S_DISPATCH,
  COL_S_CUSTOMER, COL_S_PROJECT, COL_S_ITEMS,
  COL_S_TO_NAME, COL_S_TO_PHONE, COL_S_TO_ADDR, COL_S_INVOICE, COL_S_NOTE,
  COL_S_CHANNEL_NO, COL_S_CUST_NAME, COL_S_CUST_PHONE, COL_S_CUST_ADDR,
  COL_S_WORK_TIME, COL_S_WORK_ITEM,
  COL_S_SALE_PRICE, COL_S_COST_PRICE,
  COL_S_ORDER_BY, COL_S_BY, COL_S_WH_STATUS, COL_S_WH_BY, COL_S_WH_AT, COL_S_WH_NOTE,
  COL_S_INVOICE_URL, COL_S_INVOICE_NO,
  COL_S_RETURN,
  COL_S_TRACK_NO, COL_S_TRACK_AT
];

// ── 發票電子檔上傳 ──────────────────────────────────────────
//
// 🔴 **本程式不設定任何檔案分享權限。**
//    發票含客戶名稱、地址、金額、統編。權限由「使用者自己建立並控管的那個資料夾」決定，
//    檔案放進去就繼承資料夾的權限。刻意不呼叫 setSharing()——
//    程式一旦自己開權限，就會出現「誰都打得開」而沒有人發現。
var INVOICE_FOLDER_PROP = 'DISPATCH_INVOICE_FOLDER_ID';
var INVOICE_MAX_BYTES = 10 * 1024 * 1024;   // 10 MB。發票 PDF 遠小於此，超過多半是傳錯檔
var INVOICE_MIME_OK = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png'
};

// ⚠ 不是「電子發票」。TIPTOP 課程文件特別註明：
//   公司開的是「電子計算機發票」，跟財政部電子發票平台的「電子發票」是兩種不同東西，
//   選單若寫成「電子發票」，助理選了會跟 TipTop 實際開出來的發票種類對不起來。
var INVOICE_OPTIONS = ['出貨待驗無發票', '電子計算機發票', '二聯', '三聯'];

// ── 截圖下單：Gemini 影像辨識 ──────────────────────────────────
//
// 經銷商在 LINE 傳貨的訊息現在是業務截圖丟給助理、助理自己讀圖去 TipTop key 單。
// 這裡讓業務直接上傳截圖，AI 讀出客戶與品項，業務確認後送出即可，不必逐欄手打。
//
// ⚠ 請求格式（inline_data + responseSchema）照抄 supabase/functions/rtc-recording/index.ts
//   裡已經在正式環境跑得動的那支，這部分沒問題。但**模型名稱會過期**——
//   2026-08-25 正式環境實測 gemini-2.0-flash 已下架（HTTP 404 "no longer available"）。
//
// 所以模型名稱不是常數，是一份**依序嘗試的清單**：第一個打不通（不論 404 型號不存在
// 還是 503 過載）就自動換下一個，全部都失敗才真的回報辨識失敗。
//
// 🔑 清單順序是「已驗證的排前面」，不是「版本號最大的排前面」。
//   排序這件事有實際成本：2026-08-25 曾把 gemini-3-flash-preview 放第一順位（當時是猜的），
//   它每次都 503 過載、每次都要退到第二個才成功，**每一次辨識都白等 9 秒**。
//   而且從辨識結果完全看不出來——結果是對的，只是慢，所以不會有人回報。
//   排錯順序的代價是這個，不是報錯。
//   [0] gemini-3.6-flash — **唯一端到端實測過的**（真實 LINE 截圖辨識正確，HTTP 200）
//   [1] gemini-3.7-flash — 版本較新的穩定版，[0] 過載時的退路（未實測，僅確認存在）
//   [2] gemini-flash-latest — Google 維護的別名，永遠指向當期 flash。
//       放最後而不是最前：別名會**無預警換底層模型**，辨識行為可能跟著變，
//       不適合當主要型號；但它不會像具體版號那樣被下架，是防 404 的最後保險。
//
// 之後若又 404／503，**先跑 checkGeminiModels()**（本檔案內，編輯器直接執行）取得
// 這把金鑰當下真正可用的清單，再照結果改這裡——不要照錯誤訊息或印象猜型號名稱。
// 上面那 9 秒就是猜出來的。
var GEMINI_KEY_PROP = 'GEMINI_API_KEY';
var GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];
var QUICK_IMG_MAX_BYTES = 10 * 1024 * 1024;   // 10 MB，手機截圖遠小於此
var QUICK_IMG_MIME_OK = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true
};

// ── 下拉選單（選項由試算表的「選單」分頁維護）──────────────────
//
// 為什麼放試算表而不是寫死在程式：業務要新增一個購買通路時不必找人改程式。
// GAS 是伺服器端渲染，doGet 每次開頁都讀這張表、當場組進 HTML，
// 所以改完試算表下一個開頁的人就看到了——不必重新部署。
//
// 選項刻意**不快取**：讀一次約 0.3 秒，相對開頁 1.6~6.7 秒無感；
// 換到的是「改了立刻生效」。若快取 15 分鐘，業務加了選項卻沒出現會直接來問。
var OPTIONS_SHEET = '選單';
var OPT_CHANNEL = '購買通路';
var OPT_MODEL   = '型號';
var OPT_ITEM    = '工項';
var OPT_WORKER  = '承包商';
var OPT_INVOICE = '發票別';
var OPTION_COLS = [OPT_CHANNEL, OPT_MODEL, OPT_ITEM, OPT_WORKER, OPT_INVOICE];

// 選到這個值時前端改顯示文字輸入框，送出時以文字框的值為準。
// 統一寫法不一致的欄位是這輪的目的，但不能因此讓人填不進沒收錄的值。
var OTHER_OPTION = '其他';

// 倉庫核單狀態值。'待核' 由助理登錄時寫入，其餘由倉庫核單頁寫入。
var WH_PENDING = '待核';
var WH_DONE    = '已核';
var WH_ISSUE   = '有問題';
var WH_CACHE_KEY = 'dispatch_warehouse_v1';

// 業務分頁上既有的出貨單號欄（欄名有 4 種寫法）。助理填完後回寫一份，
// 讓業務在原本的分頁上也看得到出貨進度。
var COL_SHIP_NO_BACK = '出貨單號';
var COL_ALIAS_BACK = ['10999沖帳出貨單號', '沖轉出貨單號', '出貨沖轉單號',
                      '10999出貨沖轉單號', '出貨單號'];

var AUDIT_SHEET = '簽核紀錄';     // 稽核軌跡（不存在會自動建立）
var MAX_SCAN_HEADER_ROWS = 10;    // 自動偵測表頭時最多往下找幾列

// Chat @提及對照。email → Chat 使用者 UID，用來在通知裡真的 ping 到人。
// 為什麼用 email 當鍵而不是掛在人員代碼表：助理與業務的 email 在路由對照表，
// 但簽核者與倉庫的 email 在指令碼屬性（DISPATCH_*_APPROVERS / DISPATCH_WAREHOUSE），
// 三邊唯一共通的識別是 email。用一張以 email 為鍵的小表把它們統一起來。
// 這張分頁不存在（或某人沒填 UID）不會讓通知失敗，只是退回純文字姓名。
var CHAT_UID_SHEET = 'Chat人員對照';
var COL_CU_EMAIL = 'email';
var COL_CU_UID = 'Chat UID';

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
 *
 * ⚠ 聚焦參數 `no` / `ship` / `dn` / `sh` / `rw`（Chat 通知深連結用）**同樣不是權限依據**。
 *   它們只做兩件事：決定預設頁、以及告訴伺服器「先去哪一列找」，省下掃 17 個分頁。
 *   兩條規矩不可以破：
 *     1. 每個聚焦分派都寫在該頁的角色檢查**之後**。放前面就是無聲的權限洞。
 *     2. 位置提示（sh/rw）一律要比對那一格的單號真的吻合，對不上就退回搜尋。
 *        提示只能讓事情變快，不能讓它指向別的列。
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

  // 聚焦參數：Chat 通知的深連結用，讓人點一下就直接看到「那一筆」。
  // 與 ?page= 完全一樣的規矩——**只是定位提示，不是權限依據**。
  // 每一個都會在通過角色閘門「之後」才被讀取，而且單號一定會再比對一次；
  // 提示指錯列就退回搜尋，絕不會因為網址被改就顯示或寫入到別人的單。
  var focusNo = String((e && e.parameter && e.parameter.no) || '').trim();      // 發包單號（簽核）
  var focusShip = String((e && e.parameter && e.parameter.ship) || '').trim();  // 出貨單號（倉庫核單）
  var focusDn = String((e && e.parameter && e.parameter.dn) || '').trim();      // 發包單號（助理鍵單）
  var hintSheet = String((e && e.parameter && e.parameter.sh) || '').trim();    // 分頁提示
  var hintRow = Number((e && e.parameter && e.parameter.rw) || 0);              // 列號提示

  // 預設頁按角色優先序：簽核（有時效）→ 出貨 → 倉庫核單。
  // 不能無條件預設 'ship'：只有倉庫角色的人會被導到出貨頁，然後看到「沒有權限」。
  // 帶了聚焦參數就推導到對應的頁，這樣通知網址可以短到 ?no=LS-260806-01&sh=…&rw=42。
  // 注意這裡只影響「預設值怎麼算」，一道閘門都沒有改。
  var page = want ||
    (focusNo ? 'approve' :
     focusShip ? 'warehouse' :
     focusDn ? 'ship' :
     canApprove ? 'approve' :
     roles.assistant ? 'ship' :
     roles.warehouse ? 'warehouse' : 'approve');

  if (page === 'ship') {
    if (!roles.assistant) {
      return htmlPage_(errorBlock_('您沒有出貨登錄權限',
        email + ' 不在助理名單中（指令碼屬性 DISPATCH_ASSISTANTS）。'));
    }
    // 聚焦單筆：一定放在權限檢查之後，不然帶個 dn 參數就繞過助理名單了。
    if (focusDn) return renderShipOne_(email, roles, focusDn, hintRow);
    return renderShipPage_(email, roles);
  }

  // 貨運單上傳：獨立入口，不掛在單筆核單下——一份 PDF 含好幾張出貨單
  // （2026-08-24 真實樣本 21 筆），掛在某一筆下面語意就錯了。
  if (page === 'shipdoc') {
    if (!roles.warehouse) {
      return htmlPage_(navBlock_('shipdoc', roles) +
        errorBlock_('您沒有倉庫權限',
          email + ' 不在倉庫名單中（指令碼屬性 DISPATCH_WAREHOUSE）。'));
    }
    return htmlPage_(navBlock_('shipdoc', roles) + shipDocBlock_(email));
  }

  if (page === 'warehouse') {
    if (!roles.warehouse) {
      return htmlPage_(errorBlock_('您沒有倉庫核單權限',
        email + ' 不在倉庫名單中（指令碼屬性 DISPATCH_WAREHOUSE）。'));
    }
    // 聚焦單筆：一定放在權限檢查之後，理由同 ship。
    if (focusShip) return renderWarehouseOne_(email, roles, focusShip, hintRow);
    return renderWarehousePage_(email, roles);
  }

  // 報表僅主管。getReport() 自己也會再擋一次，不靠這裡的路由判斷。
  if (page === 'report') {
    if (!roles.boss && !roles.sub) {
      return htmlPage_(errorBlock_('報表僅限主管檢視',
        email + ' 不在副主管或主管名單中。報表的本質是彙總金額，' +
        '「本月毛利」這種數字一旦顯示就等於把進價反推出來，所以整頁限制而不是遮欄位。'));
    }
    return htmlPage_(navBlock_('report', roles) + reportBlock_(email));
  }

  // 儀表板：全員可進，但看得到哪幾格由 dashCounts_ 依角色決定。
  // 這裡不擋，是因為它不顯示任何金額，只有件數。
  if (page === 'home') {
    return renderDashboard_(email, roles);
  }

  // 查詢頁全員可用（唯讀）。進價的過濾在 runQuery 的伺服器端做，不靠畫面藏。
  if (page === 'query') {
    return htmlPage_(navBlock_('query', roles) + queryBlock_(email, roles));
  }

  // 下單頁：發包安裝／料件出貨／截圖下單三種模式同頁（2026-08-25 由三個入口合併）。
  //
  // ⚠ 「缺發包分頁」的檢查**刻意不放在這裡擋整頁**。合併前截圖下單是獨立頁，
  //   權限只要 roles.sales、不需要 salesInfo.sheet（經銷商訂單不寫發包分頁）。
  //   若照舊在頁面層擋，對照表沒填分頁的業務會連截圖下單都進不去——
  //   那是合併造成的功能倒退，而且症狀是「本來能用的東西突然說你沒權限」。
  //   所以分頁的有無改成往下傳，由 orderBlock_ 決定哪幾顆按鈕能用。
  if (page === 'order' || page === 'quick') {
    if (!roles.sales) {
      return htmlPage_(errorBlock_('您沒有下單權限',
        email + ' 不在路由對照表的「' + COL_R_SALES_MAIL +
        '」欄中。下單需要知道您的業務代碼，這只在對照表裡，所以必須先把您加進去。'));
    }
    // page=quick 是合併前的舊網址，保留當別名（有人可能加了書籤），
    // 直接開在下單頁並預選截圖下單那一頁，不必記新網址。
    return renderOrderPage_(email, roles.salesInfo, page === 'quick');
  }

  if (!canApprove) {
    return htmlPage_(errorBlock_(
      '您沒有簽核權限',
      email + ' 不在副主管或主管的簽核名單中。若這不正確，' +
      '請確認指令碼屬性 DISPATCH_SUB_APPROVERS／DISPATCH_BOSS_APPROVERS 是否包含您的帳號。'
    ));
  }

  // 聚焦單筆：**必須放在上面那道 canApprove 閘門之後**。
  // 放前面就等於「網址帶了 no 參數就能看到任何一筆發包單」，而且是無聲的權限洞。
  if (focusNo) return renderApproveOne_(email, roles, focusNo, hintSheet, hintRow);

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
  var rows = [], at = '', cached = false, pending = [];
  try {
    var res = getShippableCached_();
    rows = res.rows; at = res.at; cached = res.cached;
  } catch (err) {
    return htmlPage_(navBlock_('ship', roles) +
      errorBlock_('讀取待出貨清單失敗', String(err)));
  }
  // 業務已下單、只等鍵 TipTop 單號的（新流程）。讀不到不該讓整頁掛掉——
  // 舊路徑（下方表單）仍然可用。
  try { pending = getPendingShipments_(); }
  catch (err) { Logger.log('讀取待鍵入清單失敗：' + err); }

  // 倉庫回報有問題、等助理修正的。同樣讀不到不讓整頁掛掉。
  var issues = [];
  try { issues = getWarehouseIssues_(); }
  catch (err2) { Logger.log('讀取倉庫回報問題清單失敗：' + err2); }

  return htmlPage_(navBlock_('ship', roles) +
    shipBlock_(email, rows, roles, { at: at, cached: cached }, pending, issues));
}

/**
 * 倉庫回報「有問題」、等助理修正的區塊。
 *
 * 🔴 在這一區之前，這些單**在助理的畫面上完全不存在**——待鍵入清單只撈
 *   「出貨單號為空」的列，而有問題的列早就有單號了。倉庫按下「有問題」之後
 *   通知是發出去了，但助理打開頁面看不到任何東西，也沒有地方可以把單子送回去。
 */
function warehouseIssueBlock_(issues) {
  if (!issues.length) return '';
  var cards = '';
  for (var i = 0; i < issues.length; i++) {
    var r = issues[i];
    var id = 'wi' + i;
    var no = String(r[COL_S_SHIP_NO] || '');
    cards +=
      '<div class="card wi" id="' + id + '">' +
        '<div class="ometa"><b>' + esc_(no) + '</b><span>' +
          esc_(String(r[COL_S_CUSTOMER] || '')) + '</span></div>' +
        '<div class="msg fail" style="margin:8px 0">⚠ 倉庫回報：' +
          esc_(String(r[COL_S_WH_NOTE] || '（未填說明）')) + '</div>' +
        // 🔑 出貨品項可**直接改在這裡**。倉庫回報的問題大多就是這一欄
        //   （料號不符、沒有料號、數量不對），把它做成唯讀等於叫人另外去開試算表——
        //   那正是「看得到問題卻不能在當下修正」的老毛病。
        '<label>出貨品項（倉庫多半是為了這一欄退回來的，可直接修改）</label>' +
        '<textarea id="' + id + 'i" rows="3">' +
          esc_(String(r[COL_S_ITEMS] || '')) + '</textarea>' +
        '<div class="note">回報人：' + esc_(String(r[COL_S_WH_BY] || '—')) +
          '　' + esc_(String(r[COL_S_WH_AT] || '')) + '</div>' +
        '<div class="row" style="margin-top:12px">' +
          '<button class="ok" onclick="reopen(\'' + jsq_(no) + '\',\'' + id +
            '\',' + (r.row || 0) + ')">🔄 已修正，送回倉庫重新核</button>' +
        '</div>' +
      '</div>';
  }
  return '<div class="sec">倉庫回報有問題，等你修正' +
    '<span>可直接改出貨品項；送出後倉庫會重新看到這筆，業務也會收到改動通知</span></div>' +
    cards;
}

/**
 * 業務已下單、等助理補 TipTop 單號的區塊。
 * 業務填的資料唯讀顯示（不讓助理改——那是業務的資料，改了業務不會知道），
 * 只有三個 TipTop 欄位可輸入。
 */
function pendingShipBlock_(pending) {
  if (!pending.length) return '';
  var cards = '';
  for (var i = 0; i < pending.length; i++) {
    var p = pending[i];
    var id = 'p' + i;
    var ship = [];
    if (p[COL_S_TO_NAME]) {
      ship.push(esc_(p[COL_S_TO_NAME]) +
        (p[COL_S_TO_PHONE] ? '　' + esc_(p[COL_S_TO_PHONE]) : ''));
    }
    if (p[COL_S_TO_ADDR]) ship.push(esc_(p[COL_S_TO_ADDR]));
    var cust = [];
    if (p[COL_S_CHANNEL_NO]) cust.push(esc_(p[COL_S_CHANNEL_NO]));
    if (p[COL_S_CUST_NAME]) {
      cust.push(esc_(p[COL_S_CUST_NAME]) +
        (p[COL_S_CUST_PHONE] ? '　' + esc_(p[COL_S_CUST_PHONE]) : ''));
    }
    if (p[COL_S_CUST_ADDR]) cust.push(esc_(p[COL_S_CUST_ADDR]));

    cards +=
      '<div class="card wh" id="' + id + '">' +
        '<div class="whtop">' +
          '<span class="no">' + esc_(p[COL_S_DISPATCH] || '（無發包單）') + '</span>' +
          '<span class="date">' + esc_(p[COL_S_AT]) + '</span>' +
          '<span class="who">' + esc_(p[COL_S_ORDER_BY] || '') + '</span>' +
        '</div>' +
        '<div class="whcust">' + esc_(p[COL_S_CUSTOMER] || '—') +
          (p[COL_S_PROJECT] ? '　<span>' + esc_(p[COL_S_PROJECT]) + '</span>' : '') + '</div>' +
        '<div class="whlab">出貨項目</div>' +
        '<div class="whitems">' + esc_(p[COL_S_ITEMS] || '—') + '</div>' +
        (ship.length ? '<div class="whlab">送貨資料</div><div class="whto">' +
          ship.join('<br>') + '</div>' : '') +
        (cust.length ? '<div class="whlab">客人資料</div><div class="whto">' +
          cust.join('<br>') + '</div>' : '') +
        (p[COL_S_INVOICE] ? '<div class="whrow"><b>發票</b>' + esc_(p[COL_S_INVOICE]) + '</div>' : '') +
        (p[COL_S_NOTE] ? '<div class="whrow"><b>備註</b>' + esc_(p[COL_S_NOTE]) + '</div>' : '') +
        (p[COL_S_SALE_PRICE] ? '<div class="whrow"><b>售價</b>' +
          esc_(fmtMoney_(p[COL_S_SALE_PRICE])) +
          (p[COL_S_COST_PRICE] ? '　/　進價 ' + esc_(fmtMoney_(p[COL_S_COST_PRICE])) : '') +
          '</div>' : '') +
        '<div class="whlab">請補 TipTop 產生的單號</div>' +
        '<div class="two">' +
          '<div><label>出貨單號 *</label><input id="' + id + 's" placeholder="W5501-260807001"></div>' +
          '<div><label>訂單編號</label><input id="' + id + 'o" placeholder="W5301-260807001"></div>' +
        '</div>' +
        '<div><label>出貨日期</label><input id="' + id + 'd" placeholder="例：2026/08/07"></div>' +
        '<div class="whbtn">' +
          '<button class="ok big" onclick="fillIt(\'' + id + '\',' + p.row + ')">' +
            '📦 鍵入並通知倉庫</button>' +
        '</div>' +
      '</div>';
  }
  return '<div class="sec">業務已下單，等鍵 TipTop（' + pending.length + '）' +
    '<span>資料是業務填的，只要補單號</span></div>' + cards;
}

/**
 * ⑤ 查詢頁。唯讀、全員可用。
 * 結果由前端非同步取得（掃 17 個分頁要幾秒），不在 doGet 就查——
 * 否則開頁本身就要等，而多數人開這頁是為了查特定一筆。
 */
function queryBlock_(email, roles) {
  var canSeeCost = !!(roles.boss || roles.sub);
  return '<div class="hd"><div class="ic">🔍</div><div>' +
    '<h1>查詢</h1><p>' + esc_(email) + '</p></div></div>' +
    '<div class="card">' +
      '<label>發包單號／出貨單號／客戶／案名／客人姓名／電話／通路訂單編號</label>' +
      '<input id="q" placeholder="輸入任一關鍵字，例：LS-260806、孫明恩、0953-644733">' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="ok big" id="qb" onclick="run()">🔍 查詢</button>' +
      '</div>' +
      '<div class="note">同時查發包單與出貨明細，一筆發包可能對到多次出貨。' +
        '沒有發包單號的出貨（弱電料件、鎖胚、建案整批）也查得到。' +
        (canSeeCost ? '' : '<br>進價僅主管可見。') + '</div>' +
    '</div>' +
    '<div id="msg"></div><div id="res"></div>' +
    '<script>' +
    'var NOTES=[];var SHIPS=[];' +
    'function g(id){return document.getElementById(id);}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';}' +
    'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;")' +
      '.replace(/</g,"&lt;").replace(/>/g,"&gt;");}' +
    'function money(v){if(v===""||v==null)return "";' +
      'var n=Number(v);if(isNaN(n))return esc(v);' +
      'return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");}' +
    'function run(){' +
      'var q=g("q").value.trim();' +
      'if(!q){show("請輸入關鍵字","fail");return;}' +
      'var b=g("qb");var old=b.textContent;b.disabled=true;b.textContent="查詢中…";' +
      'g("res").innerHTML="";g("msg").innerHTML="";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){b.disabled=false;b.textContent=old;' +
          'if(!res.ok){show(res.message,"fail");return;}' +
          'if(!res.rows.length){show("找不到符合的資料","fail");return;}' +
          'show("找到 "+res.count+" 筆"+(res.truncated?"（已達上限 50 筆，請縮小範圍）":""),"done");' +
          'NOTES=[];SHIPS=[];g("res").innerHTML=res.rows.map(card).join("");})' +
        '.withFailureHandler(function(e){b.disabled=false;b.textContent=old;' +
          'show("連線失敗："+e.message,"fail");})' +
        '.runQuery(q);' +
    '}' +
    'function card(r){' +
      'var h=\'<div class="card wh">\';' +
      'h+=\'<div class="whtop"><span class="no">\'+esc(r.orderNo||"（無發包單）")+\'</span>\'' +
        '+\'<span class="date">\'+esc(r.applyAt)+\'</span>\'' +
        '+\'<span class="who">\'+esc(r.sheet)+(r.dispatcher?"｜"+esc(r.dispatcher):"")+\'</span></div>\';' +
      'h+=\'<div class="whcust">\'+esc(r.customer||"—")+' +
        '(r.project?\'　<span>\'+esc(r.project)+\'</span>\':"")+\'</div>\';' +
      'if(r.model){h+=\'<div class="whrow"><b>型號</b>\'+esc(r.model)+' +
        '(r.qty?" × "+esc(r.qty):"")+\'</div>\';}' +
      'if(r.worker){h+=\'<div class="whrow"><b>承包商</b>\'+esc(r.worker)+' +
        '(r.price?"　NT$ "+esc(r.price):"")+\'</div>\';}' +
      'if(r.sub){h+=\'<div class="whrow"><b>副主管</b>\'+esc(r.sub)+\'</div>\';}' +
      'h+=\'<div class="whrow"><b>簽核</b>\'+esc(r.approval||"⏳ 待核")+\'</div>\';' +
      'if(!r.ships.length){h+=\'<div class="whrow"><b>出貨</b>⏳ 尚未出貨</div>\';}' +
      'r.ships.forEach(function(s){' +
        'h+=\'<div class="whlab">出貨 \'+esc(s["出貨單號"]||"（未鍵入單號）")+' +
          '(s["出貨日期"]?"　"+esc(s["出貨日期"]):"")+\'</div>\';' +
        'h+=\'<div class="whitems">\'+esc(s["出貨品項"]||"—")+\'</div>\';' +
        'if(s["貨指寄-收件人"]||s["貨指寄-地址"]){' +
          'h+=\'<div class="whrow"><b>貨指寄</b>\'+esc(s["貨指寄-收件人"])+' +
            '(s["貨指寄-地址"]?"　"+esc(s["貨指寄-地址"]):"")+\'</div>\';}' +
        'if(s["客人姓名"]){h+=\'<div class="whrow"><b>客人</b>\'+esc(s["客人姓名"])+' +
          '(s["客人電話"]?"　"+esc(s["客人電話"]):"")+\'</div>\';}' +
        'if(s["通路訂單編號"]){h+=\'<div class="whrow"><b>通路單號</b>\'+' +
          'esc(s["通路訂單編號"])+\'</div>\';}' +
        'if(s["發票號碼"]){h+=\'<div class="whrow"><b>發票號碼</b>\'+' +
          'esc(s["發票號碼"])+\'</div>\';}' +
        'if(s["售價"]!==""&&s["售價"]!=null){h+=\'<div class="whrow"><b>售價</b>NT$ \'+' +
          'money(s["售價"])+(s["進價"]!==undefined&&s["進價"]!==""?' +
            '"　/　進價 NT$ "+money(s["進價"]):"")+\'</div>\';}' +
        'h+=\'<div class="whrow"><b>倉庫</b>\'+esc(s["倉庫核單狀態"]||"—")+' +
          '(s["倉庫核單人"]?"　"+esc(s["倉庫核單人"]):"")+' +
          '(s["問題說明"]?"　⚠ "+esc(s["問題說明"]):"")+\'</div>\';' +
        // 退單：已在退單中就顯示狀態，否則給按鈕。沒有出貨單號代表 TipTop 還沒開單，
        // 那個階段沒有東西可以退，所以不給按鈕。
        // 單號用 SHIPS 陣列傳索引，與師傅通知的 NOTES 同一個手法——
        // 直接把單號拼進 onclick 字串要處理多層引號跳脫，是這一頁最容易出錯的地方。
        'if(s["退單"]){h+=\'<div class="whrow"><b>退單</b>\'+esc(s["退單"])+\'</div>\';' +
          // 還在退單中才給「已處理」按鈕；已處理的只顯示紀錄，不給任何按鈕
          'if(s["退單"].indexOf("🔄")===0&&s["出貨單號"]){SHIPS.push(s["出貨單號"]);' +
            'h+=\'<div class="whbtn"><button class="ok" onclick="rdone(\'+(SHIPS.length-1)+\')">\'' +
              '+\'✅ 標記已處理</button></div>\';}}' +
        'else if(s["出貨單號"]){SHIPS.push(s["出貨單號"]);' +
          'h+=\'<div class="whbtn"><button class="no-btn" onclick="ret(\'+(SHIPS.length-1)+\')">\'' +
            '+\'🔄 申請退單</button></div>\';}' +
        'if(s.techNotice){NOTES.push(s.techNotice);' +
          'h+=\'<div class="whlab">師傅通知（不含金額）</div>\'' +
            '+\'<div class="whitems">\'+esc(s.techNotice)+\'</div>\'' +
            '+\'<div class="whbtn"><button class="ok big" onclick="cp(\'+(NOTES.length-1)+\')">\'' +
            '+\'📋 複製師傅通知</button></div>\';}' +
      '});' +
      'return h+"</div>";' +
    '}' +
    // 退單：問原因 → 送出 → 成功後重跑查詢，讓畫面直接反映最新狀態
    // （不自己改 DOM，避免畫面顯示的和表上實際存的不一致）
    'function ret(i){' +
      'var sn=SHIPS[i];' +
      'var r=prompt("退單原因（會通知助理，請寫清楚要改什麼）：\\n"+sn)||"";' +
      'if(!r.trim()){return;}' +
      'show("送出中…","done");' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'show(res.message,res.ok?"done":"fail");' +
          'if(res.ok){run();}})' +
        '.withFailureHandler(function(e){show("連線失敗："+e.message,"fail");})' +
        '.requestReturn(sn,r);' +
    '}' +
    // 標記退單已處理。這裡刻意用 confirm 而不是直接送出——
    // 誤按的代價是別人以為事情做完了，而實際上 TipTop 那邊還沒改。
    'function rdone(i){' +
      'var sn=SHIPS[i];' +
      'if(!confirm("確定 "+sn+" 已經在 TipTop 處理完了嗎？\\n標記後其他人會認為這筆已完成。")){return;}' +
      'show("送出中…","done");' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'show(res.message,res.ok?"done":"fail");' +
          'if(res.ok){run();}})' +
        '.withFailureHandler(function(e){show("連線失敗："+e.message,"fail");})' +
        '.resolveReturn(sn);' +
    '}' +
    // 複製邏輯與出貨頁共用同一份（含沙箱 iframe 的 execCommand 退路）
    'function cp(i){cpText(NOTES[i]);}' +
    copyScript_() +
    '</script>';
}

/**
 * ⑥ 報表頁（僅主管）。資料由前端非同步取得——統計要掃全量，
 * 放在 doGet 就變成開頁本身要等。
 *
 * 圖表用純 CSS 條狀圖，不引入 Chart.js：無外部依賴，CDN 掛掉或被擋時不會壞頁，
 * 手機上也正常。對「每月比較」這種用途已經夠用。
 */
function reportBlock_(email) {
  return '<div class="hd"><div class="ic">📊</div><div>' +
    '<h1>報表</h1><p>' + esc_(email) + '　·　僅主管可見</p></div></div>' +
    '<div id="msg"></div>' +
    '<div class="card"><div class="center" id="load">統計中…（要掃全部資料，約需數秒）</div></div>' +
    '<div id="rep"></div>' +
    '<script>' +
    'function g(id){return document.getElementById(id);}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';}' +
    'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;")' +
      '.replace(/</g,"&lt;").replace(/>/g,"&gt;");}' +
    'function money(v){var n=Number(v);if(isNaN(n))return "0";' +
      'return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");}' +
    // 純 CSS 條狀圖：以最大值為 100%，最小給 2% 讓極小值仍看得見
    'function bars(rows,label,valFn,fmt){' +
      'if(!rows.length)return \'<div class="note">（無資料）</div>\';' +
      'var max=0;rows.forEach(function(r){var v=valFn(r);if(v>max)max=v;});' +
      'return rows.map(function(r){' +
        'var v=valFn(r);var pct=max>0?Math.max(2,Math.round(v/max*100)):0;' +
        'return \'<div class="brow"><div class="blab">\'+esc(label(r))+\'</div>\'' +
          '+\'<div class="btrack"><div class="bfill" style="width:\'+pct+\'%"></div></div>\'' +
          '+\'<div class="bval">\'+fmt(r)+\'</div></div>\';' +
      '}).join("");}' +
    'function card(title,sub,body){' +
      'return \'<div class="card"><div class="ometa"><b>\'+esc(title)+\'</b>\'' +
        '+(sub?\'<span>\'+esc(sub)+\'</span>\':"")+\'</div>\'+body+\'</div>\';}' +
    'function render(d){' +
      'var h="";' +
      // ① 待辦積壓：最重要的一組，放最前面
      'var b=d.backlog||{};' +
      'function agev(n){return (n>=0)?("　最舊 "+n+" 天"):"";}' +
      'h+=card("待辦積壓","流程卡在哪裡",' +
        '\'<div class="whrow"><b>待副主管</b>\'+(b.sub||0)+\' 筆</div>\'' +
        '+\'<div class="whrow"><b>待主管</b>\'+(b.boss||0)+\' 筆\'+esc(agev(b.approveDays))+\'</div>\'' +
        '+\'<div class="whrow"><b>待出貨</b>\'+(b.ship||0)+\' 筆\'+esc(agev(b.shipDays))+\'</div>\'' +
        '+\'<div class="whrow"><b>待核單</b>\'+(b.warehouse||0)+\' 筆\'+esc(agev(b.whDays))+\'</div>\');' +
      // ② 出貨趨勢
      'h+=card("出貨趨勢","近 12 個月，依筆數",' +
        'bars(d.months||[],function(r){return r.month;},function(r){return r.count;},' +
          'function(r){return r.count+" 筆<br><span>NT$ "+money(r.sale)+"</span>";}));' +
      // ③ 業務績效
      'h+=card("各業務","依售價合計排序",' +
        'bars(d.sales||[],function(r){return r.name;},function(r){return r.sale;},' +
          'function(r){return r.count+" 筆<br><span>NT$ "+money(r.sale)+' +
            '"　毛利 "+money(r.profit)+"</span>";}));' +
      // ④ 承包商
      'h+=card("各承包商","依接案筆數排序",' +
        'bars(d.workers||[],function(r){return r.name;},function(r){return r.count;},' +
          'function(r){return r.count+" 筆<br><span>工資 NT$ "+money(r.price)+"</span>";}));' +
      // 資料品質
      'var q=d.quality||{};var qh="";' +
      'if((q.workerDupes||[]).length){qh+=\'<div class="whlab">疑似同一承包商的不同寫法</div>\';' +
        'qh+=q.workerDupes.map(function(gp){return \'<div class="whrow">\'+' +
          'esc(gp.join("　/　"))+\'</div>\';}).join("");' +
        'qh+=\'<div class="note">統計會被拆成兩筆。請在「選單」分頁統一寫法後，\'' +
          '+\'再把試算表裡的舊值改成一致。系統刻意不自動合併——合併錯了會讓工資對到錯的人。</div>\';}' +
      'if((q.unknownCodes||[]).length){qh+=\'<div class="whlab">路由對照表沒收錄的業務代碼</div>\'' +
        '+\'<div class="whrow">\'+esc(q.unknownCodes.join("、"))+\'</div>\'' +
        '+\'<div class="note">這些單核准後不知道要通知哪位助理。</div>\';}' +
      'if(qh)h+=card("資料品質","要人工處理的不一致",qh);' +
      'if(d.shipmentError)h+=card("⚠ 出貨明細讀取失敗","",\'<div class="whrow">\'+' +
        'esc(d.shipmentError)+\'</div>\');' +
      'if(d.workerError)h+=card("⚠ 業務分頁讀取失敗","",\'<div class="whrow">\'+' +
        'esc(d.workerError)+\'</div>\');' +
      'g("rep").innerHTML=h;}' +
    'google.script.run' +
      '.withSuccessHandler(function(res){' +
        'g("load").parentNode.style.display="none";' +
        'if(!res.ok){show(res.message,"fail");return;}' +
        'render(res.data);' +
        'show("資料時間 "+esc(res.at)+(res.cached?"（快取）":"（即時統計）"),"done");})' +
      '.withFailureHandler(function(e){' +
        'g("load").textContent="統計失敗："+e.message;})' +
      '.getReport();' +
    '</script>';
}

function renderOrderPage_(email, me, wantQuick) {
  return htmlPage_(navBlock_('order', rolesFor_(email)) + orderBlock_(email, me, wantQuick));
}

/**
 * ① 業務下單畫面。三種下單方式同一頁，用最上方的按鈕切換：
 *   發包安裝／料件出貨 → 22 欄位表單，送 submitOrder
 *   截圖下單           → 上傳截圖給 AI 讀，送 submitQuickOrder
 *
 * 單別放在最上面且必選：它決定後面整條路徑（要不要簽核、要不要填承包商），
 * 選錯的成本比多點一下高得多。選了之後才顯示對應欄位——料件出貨沒有
 * 「承包商」這件事，顯示一個不該填的欄位只會製造錯誤資料。
 *
 * ⚠ 前兩者與截圖下單**不是同一種東西**，只是入口併在一起：
 *   前兩者寫「單別」欄與發包單號、可能要簽核；截圖下單發案件號、不寫發包單號、
 *   一律免簽核。共用的只有這顆按鈕列與訊息區，兩邊的送出邏輯完全獨立。
 *
 * ⚠ me.sheet 可能是空的（對照表沒填發包分頁）。那種情況下前兩者無處可寫、
 *   只有截圖下單能用，所以整段表單連同 loadOptions_ 一起跳過——
 *   loadOptions_('') 會去開一個不存在的分頁，不是留空而是直接出錯。
 */
function orderBlock_(email, me, wantQuick) {
  var canStd = !!(me && me.sheet);   // 能不能走發包安裝／料件出貨

  var head =
    '<div class="hd"><div class="ic">📝</div><div>' +
    '<h1>下單</h1><p>' + esc_(email) +
    '　·　' + esc_(me.code) + '　' + esc_(me.name) + '</p></div></div>' +
    '<div id="msg"></div>';

  // 按鈕索引要連號（k0、k1、k2…），因為切換時是用 g("k"+j) 逐一重設樣式。
  // 缺分頁時前兩顆不畫，截圖下單就會變成 k0——所以索引用累加的，不寫死。
  var kindBtns = '', btnCount = 0;
  if (canStd) {
    for (var i = 0; i < ORDER_KINDS.length; i++) {
      kindBtns += '<button class="kind" id="k' + btnCount + '" onclick="pick(\'' +
        jsq_(ORDER_KINDS[i]) + '\',' + btnCount + ')">' + esc_(ORDER_KINDS[i]) + '</button>';
      btnCount++;
    }
  }
  var quickIdx = btnCount;
  kindBtns += '<button class="kind" id="k' + quickIdx + '" onclick="pickQuick(' +
    quickIdx + ')">📷 ' + esc_(ORDER_MODE_QUICK) + '</button>';
  btnCount++;

  // 選項由「選單」分頁維護。該分頁沒有「發票別」欄時沿用程式裡的既有常數——
  // 不能因為分頁還沒建好就讓發票別變成空的下拉。
  // 帶入該業務自己的分頁：若沒有「選單」分頁，就讀那個分頁儲存格上的資料驗證
  // （使用者本來就是用資料驗證做下拉的）
  var OPT = canStd ? loadOptions_(me.sheet) : {};
  var invList = OPT[OPT_INVOICE] || INVOICE_OPTIONS;
  var invOpts = '<option value=""></option>';
  for (var v = 0; v < invList.length; v++) {
    invOpts += '<option>' + esc_(invList[v]) + '</option>';
  }

  var kindCard =
    '<div class="card">' +
      '<div class="ometa"><b>單別</b><span>決定後面要填什麼、要不要經主管簽核</span></div>' +
      '<div class="kinds">' + kindBtns + '</div>' +
      '<div id="kindNote" class="note"></div>' +
      (canStd ? '' :
        '<div class="note">⚠ 對照表的「' + esc_(COL_R_SHEET) + '」沒填代碼 ' +
        esc_(me.code) + ' 要寫入哪個分頁，系統不知道發包單要寫到哪，' +
        '所以此帳號目前只能用截圖下單。' +
        '可執行 suggestSheetMapping() 產生建議清單，人工確認後填入對照表。</div>') +
    '</div>';

  var stdFields = !canStd ? '' :
    '<div id="fields" style="display:none">' +
      '<div class="card">' +
        '<div class="ometa"><b>發包資訊</b><span>主管簽核與累計請款用</span></div>' +
        '<div class="two">' + fld_('customer', '客戶 *', '') +
          selFld_('project', '案名／購買通路', OPT[OPT_CHANNEL],
            '例：竹北案、MOMO、蝦皮') + '</div>' +
        '<div class="two">' + selFld_('model', '型號 *', OPT[OPT_MODEL], '例：L396、D310') +
          fld_('qty', '報價單數量 *', '') + '</div>' +
        '<div id="installOnly">' +
          '<div class="two">' + selFld_('worker', '承包商 *', OPT[OPT_WORKER], '') +
            fld_('price', '承包總價', '') + '</div>' +
        '</div>' +
        fld_('note', '補充說明', '') +
      '</div>' +

      '<div class="card">' +
        '<div class="ometa"><b>出貨項目</b><span>助理直接拿去鍵 TipTop，不必重打</span></div>' +
        '<textarea id="items" rows="4" placeholder="完整料號與數量，一行一項。&#10;' +
          '例：L901GEA10001AA-01 X1&#10;NSM54CMY100032-W x1 - 送感應貼"></textarea>' +
      '</div>' +

      '<div class="card">' +
        '<div class="ometa"><b>送貨資料</b><span>貨要送到哪（可能是鎖店，不是客人家）</span></div>' +
        fld_('toName', '收件人／公司', '例：大內高手鎖業有限公司') +
        '<div class="two">' + fld_('toPhone', '電話', '例：02-29266999') +
          '<div><label>發票別</label><select id="invoice">' + invOpts + '</select></div>' +
        '</div>' +
        fld_('toAddr', '地址', '例：新北市中和區橋和路122號13樓之2') +
        fld_('shipNote', '出貨備註', '例：電商-L901-孫明恩、不附出貨單') +
      '</div>' +

      '<div class="card">' +
        '<div class="ometa"><b>客人資料</b><span>最終消費者，與送貨地址可能不同</span></div>' +
        fld_('channelNo', '通路訂單編號', '例：MOMO 26080229339090-001-001-001') +
        '<div class="two">' + fld_('custName', '客人姓名', '例：孫明恩') +
          fld_('custPhone', '客人電話', '例：0953-644733') + '</div>' +
        fld_('custAddr', '客人地址／施工地址', '') +
        '<div class="two">' + selFld_('workItem', '工項', OPT[OPT_ITEM], '例：裝外門') +
          fld_('workTime', '施工時段', '例：平日1-4') + '</div>' +
        '<div class="note">工項與施工時段是師傅通知要用的。' +
          '客人姓名電話＝現場聯絡人，客人地址＝施工地址。</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="ometa"><b>金額</b></div>' +
        '<div class="two">' + fld_('salePrice', '售價', '') +
          fld_('costPrice', '進價', '') + '</div>' +
        '<div class="note">⚠ 進價目前沒有欄位級權限，看得到這張表的人都看得到。</div>' +
        '<div class="row" style="margin-top:12px">' +
          '<button class="ok big" id="sub" onclick="send()">📝 建立發包單</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  var form = kindCard + stdFields + quickOrderBlock_();

  // 這段說明只適用發包安裝／料件出貨（講的是發包單號與寫入分頁）。
  // 截圖下單不發發包單號、不寫這個分頁，所以跟著 #fields 一起切換顯示，
  // 不能固定放在頁尾——在截圖下單模式下它是錯的資訊。
  var footer = !canStd ? '' :
    '<div class="note" id="stdFoot" style="display:none">' +
    '發包單號由系統自動編號（' + esc_(me.code) + '-年月日-流水），不必手填——' +
    'LS 與 SL 只差字母順序、是兩個不同的人，人工填遲早會錯。<br>' +
    '單會寫進您的分頁「' + esc_(me.sheet || '（尚未設定）') + '」。' +
    '發包人員與日期由系統帶入。</div>';

  var script =
    '<script>' +
    'var KIND="";' +
    'var OTHER=' + JSON.stringify(OTHER_OPTION) + ';' +
    'function g(id){return document.getElementById(id);}' +
    // 選到「其他」就顯示文字框。切回其他選項時清掉文字框，
    // 否則會留著上次打的值、送出時分不清該用哪個。
    'function oth(id){var s=g(id),x=g(id+"X");if(!s||!x)return;' +
      'if(s.value===OTHER){x.style.display="";x.focus();}' +
      'else{x.style.display="none";x.value="";}}' +
    // 取值：是下拉且選了「其他」就取文字框，否則取欄位本身
    'function val(id){var e=g(id);if(!e)return "";' +
      'var x=g(id+"X");' +
      'if(x&&e.value===OTHER)return x.value;' +
      'return e.value;}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';' +
      'window.scrollTo(0,0);}' +
    // 三顆按鈕共用一組樣式重設：按鈕數量由後端算好帶進來（缺發包分頁時只有一顆），
    // 不能寫死 ORDER_KINDS.length——那樣截圖下單那顆的 on 樣式永遠不會被清掉。
    'var NBTN=' + btnCount + ';' +
    'function setBtns(i){for(var j=0;j<NBTN;j++){' +
      'var b=g("k"+j);if(b){b.className=(j===i)?"kind on":"kind";}}}' +
    // 切換到另一種下單方式時清掉訊息區：上一種模式的成功／錯誤訊息留在畫面上，
    // 會被誤讀成剛切過來這一種的結果。
    'function swap(showStd){var f=g("fields"),q=g("quickFields"),ft=g("stdFoot");' +
      'if(f)f.style.display=showStd?"":"none";' +
      'if(ft)ft.style.display=showStd?"":"none";' +
      'if(q)q.style.display=showStd?"none":"";' +
      'g("msg").innerHTML="";}' +
    'function pick(k,i){KIND=k;setBtns(i);swap(true);' +
      'var inst=(k==="' + jsq_(ORDER_KIND_INSTALL) + '");' +
      'g("installOnly").style.display=inst?"":"none";' +
      'g("kindNote").innerHTML=inst?"送出後進主管簽核佇列。":' +
        '"免簽核，送出後直接進助理出貨清單。";' +
      'g("customer").focus();}' +
    'function pickQuick(i){KIND="";setBtns(i);swap(false);' +
      'g("kindNote").innerHTML="上傳經銷商在 LINE 傳的進貨截圖，' +
        'AI 讀出客戶與品項後由您確認。免簽核，送出後直接進助理待鍵單。";}' +
    'function send(){' +
      'if(!KIND){show("請先選擇單別","fail");return;}' +
      'var f={kind:KIND,customer:val("customer"),project:val("project"),' +
        'model:val("model"),qty:val("qty"),worker:val("worker"),' +
        'price:val("price"),note:val("note"),' +
        'items:val("items"),toName:val("toName"),toPhone:val("toPhone"),' +
        'toAddr:val("toAddr"),invoice:val("invoice"),shipNote:val("shipNote"),' +
        'channelNo:val("channelNo"),custName:val("custName"),' +
        'custPhone:val("custPhone"),custAddr:val("custAddr"),' +
        'workItem:val("workItem"),workTime:val("workTime"),' +
        'salePrice:val("salePrice"),costPrice:val("costPrice")};' +
      // 選了「其他」卻沒填文字框：擋在這裡，不要送一個空值上去
      '{var miss=[];' +
        '[["project","案名／購買通路"],["model","型號"],["worker","承包商"],' +
         '["workItem","工項"]].forEach(function(p){' +
          'var s=g(p[0]),x=g(p[0]+"X");' +
          'if(s&&x&&s.value===OTHER&&!x.value.trim())miss.push(p[1]);});' +
        'if(miss.length){show("選了「其他」請填寫："+miss.join("、"),"fail");return;}}' +
      'if(!f.customer.trim()){show("客戶為必填","fail");return;}' +
      'if(!f.model.trim()){show("型號為必填","fail");return;}' +
      'if(!f.qty.trim()){show("報價單數量為必填","fail");return;}' +
      'if(KIND==="' + jsq_(ORDER_KIND_INSTALL) + '"&&!f.worker.trim()){' +
        'show("發包安裝必須填承包商","fail");return;}' +
      'var b=g("sub");var old=b.textContent;b.disabled=true;b.textContent="處理中…";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){b.disabled=false;b.textContent=old;' +
          // 出貨資訊寫入失敗時**不清空表單**，否則業務填的一大段東西就沒了
          'if(res.ok){show(res.message,res.shipFailed?"fail":"done");' +
            'if(!res.shipFailed){["customer","project","model","qty","worker","price","note",' +
              '"items","toName","toPhone","toAddr","shipNote","channelNo",' +
              '"custName","custPhone","custAddr","workItem","workTime",' +
              '"salePrice","costPrice"]' +
              '.forEach(function(k){var e=g(k);if(e)e.value="";' +
                'var x=g(k+"X");if(x){x.value="";x.style.display="none";}});' +
              'g("invoice").value="";}}' +
          'else{show(res.message,"fail");}})' +
        '.withFailureHandler(function(e){b.disabled=false;b.textContent=old;' +
          'show("連線失敗："+e.message,"fail");})' +
        '.submitOrder(f);' +
    '}' +
    // 預選截圖下單的兩種情況：從舊網址 ?page=quick 進來（保留書籤可用），
    // 或這個帳號沒有發包分頁、截圖下單是唯一能用的方式（此時不預選會看到
    // 一顆孤零零的按鈕、什麼都沒展開，像是壞掉）。
    ((wantQuick || !canStd) ? 'pickQuick(' + quickIdx + ');' : '') +
    '</script>';

  return head + form + footer + script;
}

function renderWarehousePage_(email, roles) {
  var rows = [], at = '', cached = false;
  try {
    var res = getWarehouseCached_();
    rows = res.rows; at = res.at; cached = res.cached;
  } catch (err) {
    return htmlPage_(navBlock_('warehouse', roles) +
      errorBlock_('讀取待核單失敗', String(err)));
  }
  return htmlPage_(navBlock_('warehouse', roles) +
    warehouseBlock_(email, rows, roles, { at: at, cached: cached }));
}

/**
 * 截圖下單區塊。上傳 → AI 辨識 → 業務確認（可編輯）→ 送出。
 *
 * 品項用可增刪的列，不是固定欄位：截圖裡的品項數不固定（1～3 都有過），
 * 業務也可能要手動補一項 AI 沒讀到的。整份草稿都在前端 JS 陣列裡組，
 * 沒有伺服器端初始資料——頁面一開始是空的，等使用者上傳圖片。
 *
 * ⚠ 2026-08-25 從獨立頁併進下單頁，所以這裡**只回內容區塊**：
 *   沒有自己的 <div class="hd"> 標題，也沒有自己的 <div id="msg">。
 *   下單頁已經有一個 id="msg"，這裡再放一個就會有兩個相同 id，
 *   getElementById 只認得到第一個——訊息會顯示在錯的位置，而且不會報錯。
 *
 * ⚠ 下方 script 刻意整段包在 IIFE 裡：它的 g／show／esc 與下單頁表單那組同名，
 *   靠函式作用域各自獨立。拆掉 IIFE 兩邊就會互相覆蓋。
 */
function quickOrderBlock_() {
  var upload =
    '<div class="card">' +
      '<div class="ometa"><b>1. 上傳截圖</b></div>' +
      '<div class="note" style="margin-bottom:10px">把經銷商在 LINE 傳的進貨截圖整張上傳，' +
        'AI 會讀出客戶與品項，讀完您可以再修改。</div>' +
      '<input type="file" id="qimg" accept="image/jpeg,image/png,image/webp">' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="ok" id="qgo" onclick="return false;">🔍 辨識</button>' +
      '</div>' +
    '</div>';

  var draft =
    '<div class="card" id="qdraft" style="display:none">' +
      '<div class="ometa"><b>2. 確認內容</b></div>' +
      '<div id="qwarn"></div>' +
      '<label>客戶</label><input id="qcust" placeholder="讀不到的話請手動輸入">' +
      '<label style="margin-top:10px;display:block">品項</label>' +
      '<div id="qitems"></div>' +
      '<div class="row" style="margin-top:8px">' +
        '<button class="ghost" onclick="return false;" id="qadd">＋ 新增品項</button>' +
      '</div>' +
      '<label style="margin-top:10px;display:block">備註</label>' +
      '<input id="qnote" placeholder="不屬於任何單一品項的整體備註">' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="ok big" id="qsub" onclick="return false;">📦 送出</button>' +
      '</div>' +
    '</div>';

  var qfooter = '<div class="note">送出後會通知您的對應助理去 TipTop 開單。' +
    '這條路徑不經過發包簽核——經銷商進貨本來就不走發包單。</div>';

  var script = '<script>' +
    '(function(){' +
    'var ITEMS=[];' +
    'function g(id){return document.getElementById(id);}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';window.scrollTo(0,0);}' +
    'function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML;}' +

    // 重繪品項列。每次資料變動（辨識完、增列、刪列）都整組重畫，
    // 不做局部更新——品項數量小（1~5 列），整組重畫比追蹤 diff 簡單得多，
    // 也不會有「刪到一半索引錯位」這類 bug。
    'function renderItems(){' +
      'var h="";' +
      'for(var i=0;i<ITEMS.length;i++){' +
        'h+=\'<div class="two" style="margin-bottom:6px" data-i="\'+i+\'">\'+' +
          '\'<div><input class="qmodel" placeholder="型號" value="\'+esc(ITEMS[i].model)+\'"></div>\'+' +
          '\'<div><input class="qqty" placeholder="數量" value="\'+esc(ITEMS[i].qty)+\'"></div>\'+' +
        '\'</div>\'+' +
        '\'<div style="margin-bottom:10px" data-i="\'+i+\'">\'+' +
          '\'<input class="qspec" placeholder="規格／備註（顏色、配件…）" value="\'+esc(ITEMS[i].spec)+\'" style="width:75%">\'+' +
          '\' <button class="no-btn" onclick="qdel(\'+i+\')">✕</button>\'+' +
        '\'</div>\';' +
      '}' +
      'g("qitems").innerHTML=h;' +
    '}' +
    // 送出前從畫面上的輸入框重新收值（使用者可能改過），不是直接送 ITEMS 陣列本身
    'function collectItems(){' +
      'var rows=g("qitems").querySelectorAll("[data-i]");' +
      'var seen={};var out=[];' +
      'for(var i=0;i<rows.length;i++){' +
        'var idx=rows[i].getAttribute("data-i");' +
        'if(seen[idx])continue;seen[idx]=true;' +
        'var m=g("qitems").querySelector(\'[data-i="\'+idx+\'"] .qmodel\');' +
        'var q=g("qitems").querySelector(\'[data-i="\'+idx+\'"] .qqty\');' +
        'var s=g("qitems").querySelector(\'[data-i="\'+idx+\'"] .qspec\');' +
        'if(!m)continue;' +
        'out.push({model:m.value,qty:q?q.value:"",spec:s?s.value:""});' +
      '}' +
      'return out;' +
    '}' +
    'window.qdel=function(i){ITEMS=collectItems();ITEMS.splice(i,1);renderItems();};' +
    'g("qadd").onclick=function(){ITEMS=collectItems();ITEMS.push({model:"",qty:"",spec:""});renderItems();};' +

    'g("qgo").onclick=function(){' +
      'var f=g("qimg").files&&g("qimg").files[0];' +
      'if(!f){show("請先選擇圖片","fail");return;}' +
      'if(f.size>10485760){show("圖片超過 10 MB，請截小一點的範圍","fail");return;}' +
      'var btn=g("qgo");var old=btn.textContent;btn.disabled=true;btn.textContent="辨識中…";' +
      'var rd=new FileReader();' +
      'rd.onerror=function(){btn.disabled=false;btn.textContent=old;show("讀取圖片失敗","fail");};' +
      'rd.onload=function(){' +
        'var b64=String(rd.result).split(",")[1]||"";' +
        'google.script.run' +
          '.withSuccessHandler(function(res){' +
            'btn.disabled=false;btn.textContent=old;' +
            'if(!res.ok){show(res.message,"fail");return;}' +
            'g("qcust").value=res.customer||"";' +
            'ITEMS=(res.items&&res.items.length)?res.items:[{model:"",qty:"",spec:""}];' +
            'renderItems();' +
            'g("qnote").value=res.note||"";' +
            'g("qdraft").style.display="";' +
            'g("qwarn").innerHTML=(res.confidence==="low")?' +
              '\'<div class="msg fail" style="margin-bottom:10px">這張圖有讀不準的地方，請逐項確認再送出。</div>\':\'\';' +
            'show(res.customer?"辨識完成，請確認內容":"辨識完成但沒讀到客戶名稱，請手動輸入","done");' +
          '})' +
          '.withFailureHandler(function(e){' +
            'btn.disabled=false;btn.textContent=old;' +
            'show("連線失敗："+e.message,"fail");' +
          '})' +
          '.recognizeOrderImage(b64,f.type);' +
      '};' +
      'rd.readAsDataURL(f);' +
    '};' +

    'g("qsub").onclick=function(){' +
      'var customer=g("qcust").value.trim();' +
      'if(!customer){show("客戶為必填","fail");return;}' +
      'var items=collectItems();' +
      'var hasModel=false;' +
      'for(var i=0;i<items.length;i++){if(items[i].model.trim()){hasModel=true;break;}}' +
      'if(!hasModel){show("至少需要一個型號","fail");return;}' +
      'var btn=g("qsub");var old=btn.textContent;btn.disabled=true;btn.textContent="送出中…";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'btn.disabled=false;btn.textContent=old;' +
          'if(res.ok){' +
            'show(res.message,"done");' +
            'g("qdraft").style.display="none";' +
            'g("qimg").value="";' +
            'ITEMS=[];' +
          '}else{show(res.message,"fail");}' +
        '})' +
        '.withFailureHandler(function(e){' +
          'btn.disabled=false;btn.textContent=old;' +
          'show("連線失敗："+e.message,"fail");' +
        '})' +
        '.submitQuickOrder(customer,items,g("qnote").value);' +
    '};' +
    '})();' +
    '</script>';

  // 整組包在可切換的容器裡，預設隱藏——下單頁載入時是「還沒選單別」的狀態。
  // script 放在容器外：它用 onclick 綁定，容器隱藏不影響綁定，
  // 但若放進容器內、將來有人改成動態插入 innerHTML，腳本就不會被執行。
  return '<div id="quickFields" style="display:none">' +
    upload + draft + qfooter +
    '</div>' + script;
}

// ──────────────────────── 深連結單筆頁（Chat 通知點進來就直接是那一筆）
//
// 這三支的共同鐵則：**一律不呼叫 getPending_ / getPendingCached_ /
// getShippableCached_ / getWarehouseCached_**。
//
// 那幾支會掃 17 個分頁，實測冷啟動 39 秒——那正是這個功能要解決的問題。
// 單筆頁靠位置提示只開一個分頁、只讀一列，往返次數大約 6 次。
// 哪天有人為了「順便拿個什麼」在這裡多呼叫一次 openSheets_()，
// 畫面會完全正確，只是又變回 39 秒，而且沒有任何錯誤訊息。
// verify-dispatch-approval.js 有一條斷言在數 getRange 的次數，就是為了擋這件事。

/** 單筆頁共用的「回完整清單」逃生門 */
function backToListNote_(page, label) {
  var url = deepLink_({ page: page });
  if (!url) return '';
  return '<div class="note"><a target="_top" href="' + esc_(url) + '">← 回' +
    esc_(label) + '完整清單</a></div>';
}

/**
 * 簽核單筆頁。從 Chat 通知的 ?no=…&sh=…&rw=… 進來。
 *
 * 三種收尾都要處理，尤其第一種——它是深連結最常見的情況：
 * 兩位主管同時收到通知，第二位點進來時已經被前一位核掉了。
 * 那不是錯誤，是正常競態，畫面要講清楚「誰在什麼時候處理了」，不能丟錯誤訊息。
 */
function renderApproveOne_(email, roles, orderNo, hintSheet, hintRow) {
  var located;
  try {
    located = resolveOneByOrderNo_(orderNo, hintSheet, hintRow);
  } catch (err) {
    return htmlPage_(navBlock_('approve', roles) +
      errorBlock_('讀取試算表失敗', String(err)));
  }
  if (!located) {
    return htmlPage_(navBlock_('approve', roles) +
      errorBlock_('找不到發包單號 ' + orderNo,
        '可能已被刪除，或這個單號不在系統掃描範圍的分頁裡。') +
      backToListNote_('approve', '簽核'));
  }

  var ctx = located.hit.ctx;
  var row = located.hit.row;

  // 一次讀整列。不要逐格 getValue——每次往返約 0.3 秒，
  // 讀 10 個欄位就是 3 秒，比一次讀整列慢一個量級。
  var width = ctx.lastCol || ctx.sheet.getLastColumn();
  var vals = ctx.sheet.getRange(row, 1, 1, width).getValues()[0];
  function pick(name) {
    var c = ctx.col[name];
    var v = (c && c <= vals.length) ? vals[c - 1] : '';
    return String(v == null ? '' : v).trim();
  }
  function rawOf(name) {
    var c = ctx.col[name];
    return (c && c <= vals.length) ? vals[c - 1] : '';
  }

  var subVal = pick(COL_SUB_APPROVAL);
  var bossVal = pick(COL_APPROVAL);
  var stage = stageOf_(ctx, subVal, bossVal);

  var rec = {
    orderNo: orderNo,
    applyAt: fmtDate_(rawOf(COL_APPLY_AT)),
    worker: pick(COL_WORKER),
    customer: pick(COL_CUSTOMER),
    project: pick(COL_PROJECT),
    model: pick(COL_MODEL),
    qty: pick(COL_QTY),
    wage: fmtMoney_(rawOf(COL_WAGE)),
    unit: fmtMoney_(rawOf(COL_UNIT)),
    price: fmtMoney_(rawOf(COL_PRICE)),
    dispatcher: pick(COL_DISPATCHER),
    note: pick(COL_NOTE),
    stage: stage,
    subMark: subVal,
    sheet: ctx.name,
    row: row
  };

  var head =
    '<div class="hd"><div class="ic">📋</div><div>' +
    '<h1>發包簽核</h1><p>' + esc_(email) + '</p></div></div>' +
    '<div id="msg"></div>';

  // 情況一：已經有人處理過了
  if (!stage) {
    var doneBy = bossVal || subVal;
    return htmlPage_(navBlock_('approve', roles) + head +
      '<div class="card"><div class="center">這一筆已經處理過了 👍' +
      (doneBy ? '<div class="note" style="margin-top:10px">' + esc_(doneBy) + '</div>' : '') +
      '</div></div>' +
      cardsOfReadOnly_(rec) +
      backToListNote_('approve', '簽核'));
  }

  // 情況二：卡在不屬於這個人的那一層
  var mine = (stage === 'sub') ? roles.sub : roles.boss;
  if (!mine) {
    return htmlPage_(navBlock_('approve', roles) + head +
      '<div class="card"><div class="center">這一筆目前待' +
      (stage === 'sub' ? '副主管' : '主管') + '核准，不在您的權限範圍。</div></div>' +
      cardsOfReadOnly_(rec) +
      backToListNote_('approve', '簽核'));
  }

  // 情況三：可以簽
  return htmlPage_(navBlock_('approve', roles) + head +
    '<div class="sec">' + (stage === 'sub' ? '副主管待核' : '主管待核') + '</div>' +
    cardsOf_([rec], 'd') +
    '<div class="note">簽核者身分取自您的 Google 帳號，無法手動修改。' +
    '每一筆核准／退回都會記錄在試算表的「' + AUDIT_SHEET + '」分頁。</div>' +
    backToListNote_('approve', '簽核') +
    approveScript_('這一筆已完成，可以關掉這個頁面了 👍'));
}

/** 唯讀卡片：內容與 cardsOf_ 一致，但不給按鈕（已處理完、或不是這個人的層級） */
function cardsOfReadOnly_(r) {
  return '<div class="card">' +
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
    '</table></div>';
}

/**
 * 倉庫核單單筆頁。從 Chat 通知的 ?ship=…&rw=… 進來。
 * 出貨明細只有一張分頁，即使提示失效，全欄掃描也只是一次 getValues。
 */
function renderWarehouseOne_(email, roles, shipNo, hintRow) {
  var s, row, rec;
  try {
    s = openShipmentSheet_();
    row = findShipmentRow_(s, shipNo, hintRow);
    if (!row) {
      return htmlPage_(navBlock_('warehouse', roles) +
        errorBlock_('找不到出貨單號 ' + shipNo, '可能已被刪除。') +
        backToListNote_('warehouse', '倉庫核單'));
    }
    rec = readShipmentRow_(s, row);
  } catch (err) {
    return htmlPage_(navBlock_('warehouse', roles) +
      errorBlock_('讀取出貨明細失敗', String(err)));
  }

  var st = rec[COL_S_WH_STATUS];
  if (st && st !== WH_PENDING) {
    return htmlPage_(navBlock_('warehouse', roles) +
      '<div class="hd"><div class="ic">🏭</div><div><h1>倉庫核單</h1><p>' +
      esc_(email) + '</p></div></div>' +
      '<div class="card"><div class="center">這一筆已經處理過了（' + esc_(st) + '）👍' +
      (rec[COL_S_WH_BY] ? '<div class="note" style="margin-top:10px">' +
        esc_(rec[COL_S_WH_BY]) + '　' + esc_(rec[COL_S_WH_AT]) + '</div>' : '') +
      '</div></div>' +
      backToListNote_('warehouse', '倉庫核單'));
  }

  // 轉成 getWarehousePending_ 的同一份欄位形狀，才能直接餵給既有的 warehouseBlock_
  var one = {
    shipNo: rec[COL_S_SHIP_NO],
    orderId: rec[COL_S_ORDER_ID],
    dispatchNo: rec[COL_S_DISPATCH],
    customer: rec[COL_S_CUSTOMER],
    project: rec[COL_S_PROJECT],
    items: rec[COL_S_ITEMS],
    toName: rec[COL_S_TO_NAME],
    toPhone: rec[COL_S_TO_PHONE],
    toAddr: rec[COL_S_TO_ADDR],
    invoice: rec[COL_S_INVOICE],
    invoiceUrl: rec[COL_S_INVOICE_URL] ? true : false,
    invoiceNo: rec[COL_S_INVOICE_NO],
    note: rec[COL_S_NOTE],
    by: rec[COL_S_BY],
    at: rec[COL_S_AT],
    row: row
  };

  return htmlPage_(navBlock_('warehouse', roles) +
    warehouseBlock_(email, [one], roles, { at: '', cached: false }) +
    backToListNote_('warehouse', '倉庫核單'));
}

/**
 * 助理鍵單單筆頁。從 Chat 通知的 ?dn=<發包單號>&rw=… 進來。
 *
 * ⚠ 為什麼用發包單號而不是出貨單號當參數：
 *   這一頁的目的就是「還沒有出貨單號，請助理去 TipTop 開一個回來填」，
 *   所以那一格此時是空的，沒有東西可以拿來驗證列號指對了沒。
 *   裸列號當參數是不安全的——有人在試算表插一列，連結就指到別人的單。
 *   發包單號在通知發出的當下就已經存在（notifyAssistant_ 傳的正是它），
 *   拿它當錨點，列號提示才有東西可以比對。
 */
function renderShipOne_(email, roles, dispatchNo, hintRow) {
  var s, row, rec;
  try {
    s = openShipmentSheet_();
    row = findShipmentRowByDispatch_(s, dispatchNo, hintRow);
    if (!row) {
      return htmlPage_(navBlock_('ship', roles) +
        errorBlock_('找不到待鍵入的單號 ' + dispatchNo,
          '可能已經有人鍵過單號了，或這筆已被刪除。') +
        backToListNote_('ship', '出貨登錄'));
    }
    rec = readShipmentRow_(s, row);
  } catch (err) {
    return htmlPage_(navBlock_('ship', roles) +
      errorBlock_('讀取出貨明細失敗', String(err)));
  }

  rec.row = row;
  return htmlPage_(navBlock_('ship', roles) +
    '<div class="hd"><div class="ic">📦</div><div><h1>出貨登錄</h1><p>' +
    esc_(email) + '</p></div></div>' +
    '<div id="msg"></div><div id="notice"></div>' +
    // 標題不在這裡寫——pendingShipBlock_ 自己就會產生一個帶筆數的區塊標題。
    // 這裡再寫一個會變成畫面上出現兩個「業務已下單，等鍵 TipTop」，
    // 而且上面那個沒有筆數、看起來像是一個空區塊。（2026-08-25 實機驗證發現）
    pendingShipBlock_([rec]) +
    backToListNote_('ship', '出貨登錄') +
    shipOneScript_());
}

/**
 * 依發包單號找「還沒鍵入出貨單號」的那一列。
 *
 * 驗證條件刻意是**兩個都要成立**：發包單號吻合，而且出貨單號還是空的。
 * 只比對發包單號不夠——同一個發包單號可以有多筆出貨，
 * 只驗單號的話會把提示指到一筆已經鍵過的列上，助理就會覆蓋掉別人填的資料。
 *
 * ⚠ dn 參數同時也接**案件號**（截圖下單用，見 nextCaseNo_）：那種列沒有發包單號
 *   （經銷商訂單不走發包單），要用「案件號」欄當錨點。兩者互斥不會同時有值，
 *   所以同一個比對邏輯可以兩種都吃，不必為此另開一組深連結參數。
 */
function findShipmentRowByDispatch_(s, dispatchNo, hintRow) {
  dispatchNo = String(dispatchNo || '').trim();
  if (!dispatchNo) return 0;
  var cDn = s.col[COL_S_DISPATCH], cNo = s.col[COL_S_SHIP_NO], cCase = s.col[COL_S_CASE_NO];
  if (!cDn || !cNo) return 0;
  var last = s.sheet.getLastRow();
  if (last < 2) return 0;

  var hr = Number(hintRow || 0);
  if (hr >= 2 && hr <= last) {
    var dnAt = String(s.sheet.getRange(hr, cDn).getValue() || '').trim();
    var caseAt = cCase ? String(s.sheet.getRange(hr, cCase).getValue() || '').trim() : '';
    var noAt = String(s.sheet.getRange(hr, cNo).getValue() || '').trim();
    if ((dnAt === dispatchNo || (cCase && caseAt === dispatchNo)) && !noAt) return hr;
  }

  var width = Math.max(cDn, cNo, cCase || 0);
  var vals = s.sheet.getRange(2, 1, last - 1, width).getValues();
  for (var i = 0; i < vals.length; i++) {
    var dn = String(vals[i][cDn - 1] == null ? '' : vals[i][cDn - 1]).trim();
    var cs = cCase ? String(vals[i][cCase - 1] == null ? '' : vals[i][cCase - 1]).trim() : '';
    var no = String(vals[i][cNo - 1] == null ? '' : vals[i][cNo - 1]).trim();
    if ((dn === dispatchNo || (cCase && cs === dispatchNo)) && !no) return i + 2;
  }
  return 0;
}

/**
 * 倉庫核單畫面。**手機優先**：倉庫是站在貨架前用手機操作，
 * 所以單欄卡片、大字、大按鈕，不做表格。出貨品項是撿料的依據，要最顯眼。
 */
function warehouseBlock_(email, rows, roles, meta) {
  var head =
    '<div class="hd"><div class="ic">🏭</div><div>' +
    '<h1>倉庫核單</h1><p>' + esc_(email) + '</p></div></div>' +
    '<div id="msg"></div>' +
    (roles.warehouseUnrestricted
      ? '<div class="msg warn">⚠ 尚未設定 DISPATCH_WAREHOUSE，目前任何人都能核單。</div>'
      : '');

  if (!rows.length) {
    return head + '<div class="card"><div class="center">目前沒有待撿料的出貨 👍</div></div>' +
      '<div class="note">清單資料時間 ' + esc_(meta.at) +
      (meta.cached ? '（快取）' : '') + '</div>';
  }

  var cards = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var id = 'w' + i;
    var ship = [];
    if (r.toName) ship.push(esc_(r.toName) + (r.toPhone ? '　' + esc_(r.toPhone) : ''));
    if (r.toAddr) ship.push(esc_(r.toAddr));

    cards +=
      '<div class="card wh" id="' + id + '">' +
        '<div class="whtop">' +
          '<span class="no">' + esc_(r.shipNo) + '</span>' +
          '<span class="date">' + esc_(r.at) + '</span>' +
        '</div>' +
        '<div class="whcust">' + esc_(r.customer || '—') +
          (r.project ? '　<span>' + esc_(r.project) + '</span>' : '') + '</div>' +
        '<div class="whlab">出貨品項</div>' +
        '<div class="whitems">' + esc_(r.items || '—') + '</div>' +
        (ship.length
          ? '<div class="whlab">貨指寄</div><div class="whto">' + ship.join('<br>') + '</div>'
          : '') +
        (r.invoice ? '<div class="whrow"><b>發票</b>' + esc_(r.invoice) + '</div>' : '') +
        (r.note ? '<div class="whrow"><b>備註</b>' + esc_(r.note) + '</div>' : '') +
        (r.dispatchNo ? '<div class="whrow"><b>發包單</b>' + esc_(r.dispatchNo) + '</div>' : '') +
        (r.orderId ? '<div class="whrow"><b>訂單</b>' + esc_(r.orderId) + '</div>' : '') +
        '<div class="whby">登錄：' + esc_(r.by || '—') + '</div>' +
        // 發票號碼與電子檔都是倉庫的工作（2026-08-14 確認），放在核單按鈕之上，
        // 因為要先登錄、核單通知才帶得到號碼與連結。兩者各自選填，不互相要求。
        '<div class="whlab">發票號碼（選填）</div>' +
        '<div class="upl">' +
          '<input type="text" id="n_' + id + '" placeholder="例：AB-12345678" ' +
            (r.invoiceNo ? 'value="' + esc_(r.invoiceNo) + '"' : '') + '>' +
        '</div>' +
        '<div class="whlab">發票電子檔（選填）</div>' +
        '<div class="upl">' +
          '<input type="file" id="f_' + id + '" accept=".pdf,.jpg,.jpeg,.png">' +
          '<button class="ghost" onclick="upl(\'' + jsq_(r.shipNo) + '\',\'' + id + '\',' +
            r.row + ')">⬆ 登錄</button>' +
        '</div>' +
        '<div class="uplmsg" id="u_' + id + '">' +
          (r.invoiceUrl || r.invoiceNo
            ? '✅ 已登錄' + (r.invoiceNo ? '（號碼 ' + esc_(r.invoiceNo) + '）' : '') +
              (r.invoiceUrl ? '　已有檔案' : '') + '　（重新送出會覆蓋）'
            : '尚未登錄。填號碼或選檔案（或兩者都填）再按登錄，核單的備存訊息會一起帶出去。') +
        '</div>' +
        '<div class="whbtn">' +
          '<button class="ok big" onclick="wact(\'' + jsq_(r.shipNo) + '\',\'done\',\'' +
            id + '\',' + r.row + ')">✅ 已撿料完成</button>' +
          '<button class="no-btn big" onclick="wact(\'' + jsq_(r.shipNo) + '\',\'issue\',\'' +
            id + '\',' + r.row + ')">⚠ 有問題</button>' +
        '</div>' +
      '</div>';
  }

  var footer = '<div class="note">清單資料時間 ' + esc_(meta.at) +
    (meta.cached ? '（快取）' : '') + '　·　核單人取自您的 Google 帳號，無法修改。<br>' +
    '按「已撿料完成」會把完整出貨資訊送到 Chat 備存；' +
    '「有問題」會通知助理與業務，需填寫問題說明。<br>' +
    // 沒有這一句的話，倉庫按下「有問題」只會看到單子從清單消失，
    // 不知道它去哪了、也不知道還會不會回來（2026-08-25 之前它是真的回不來）。
    '<b>回報問題後這筆會先從清單移除</b>，交給助理修正；' +
    '助理改好按「送回倉庫」，它就會帶著你填的問題說明重新出現在這裡。</div>';

  var script =
    '<script>' +
    'function show(t,c){var m=document.getElementById("msg");' +
      'm.innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';window.scrollTo(0,0);}' +
    // 發票上傳。google.script.run 傳不了 File 物件，要先讀成 base64 再送。
    // 檔名／型別／大小都在伺服器端再驗一次——前端擋掉的只是體驗，不是安全。
    // 這一段還沒登錄的發票資料嗎？（選了檔案、或打了號碼，但還沒按登錄）
    'function pendInv(cardId){' +
      'var inp=document.getElementById("f_"+cardId);' +
      'var numEl=document.getElementById("n_"+cardId);' +
      'if(!inp||!numEl)return false;' +
      'if(inp.getAttribute("data-done")==="1")return false;' +
      'return !!(inp.files&&inp.files[0])||!!(numEl.value||"").trim();' +
    '}' +
    // after：登錄成功後要接著做的事（用來串「先登錄發票、再送出核單」）
    'function upl(no,cardId,rw,after){' +
      'var inp=document.getElementById("f_"+cardId);' +
      'var numEl=document.getElementById("n_"+cardId);' +
      'var out=document.getElementById("u_"+cardId);' +
      'var f=inp.files&&inp.files[0];' +
      'var invNo=(numEl.value||"").trim();' +
      // 檔案跟號碼各自選填，但至少要有一個——兩邊都空按下去沒有意義
      'if(!f&&!invNo){out.textContent="請至少填發票號碼或選擇檔案";' +
        'out.className="uplmsg bad";return;}' +
      'if(f&&f.size>10485760){out.textContent="檔案超過 10 MB，請確認是不是選錯檔";' +
        'out.className="uplmsg bad";return;}' +
      'var btn=inp.parentNode.querySelector("button");btn.disabled=true;' +
      'var ob=btn.textContent;btn.textContent="登錄中…";' +
      'out.textContent="登錄中…";out.className="uplmsg";' +
      'function go(name,type,b64){' +
        'google.script.run' +
          '.withSuccessHandler(function(res){btn.disabled=false;btn.textContent=ob;' +
            'if(res.ok){out.textContent="✅ "+res.message;out.className="uplmsg ok";' +
              'inp.setAttribute("data-done","1");' +
              'if(after)after();}' +
            'else{out.textContent=res.message;out.className="uplmsg bad";}})' +
          '.withFailureHandler(function(e){btn.disabled=false;btn.textContent=ob;' +
            'out.textContent="連線失敗："+e.message;out.className="uplmsg bad";})' +
          '.uploadInvoice(no,name,type,b64,rw,invNo);}' +
      // 沒選檔案時不用經過 FileReader，直接把號碼送出去——這是常見情況
      // （倉庫先拿到號碼、檔案晚一步才有），沒有檔案不該卡住號碼登錄。
      'if(!f){go("","","");return;}' +
      'var rd=new FileReader();' +
      'rd.onerror=function(){btn.disabled=false;btn.textContent=ob;' +
        'out.textContent="讀取檔案失敗";out.className="uplmsg bad";};' +
      'rd.onload=function(){go(f.name,f.type,String(rd.result).split(",")[1]||"");};' +
      'rd.readAsDataURL(f);' +
    '}' +
    'function wact(no,dec,cardId,rw){' +
      // 🔑 選了發票卻沒按「登錄」就直接送出，是這個畫面最容易踩的坑：
      //   兩個動作是分開的按鈕，但使用者的心智模型是「填完按送出」。
      //   實測踩過——上傳了圖片，Chat 通知卻顯示「未上傳」，因為檔案根本沒送出去。
      //   所以這裡先幫他登錄，成功了才繼續送核單；登錄失敗就停住，不要留下
      //   「核單過了但發票沒進去」的狀態（那之後沒有任何地方會提醒要補）。
      'if(pendInv(cardId)){' +
        'upl(no,cardId,rw,function(){wact(no,dec,cardId,rw);});' +
        'return;}' +
      'var note="";' +
      'if(dec==="issue"){note=prompt("問題說明（會通知助理與業務）：")||"";' +
        'if(!note.trim()){return;}}' +
      'var card=document.getElementById(cardId);' +
      'var btns=card.querySelectorAll("button");' +
      'for(var i=0;i<btns.length;i++){btns[i].disabled=true;}' +
      'var old=btns[0].textContent;btns[0].textContent="處理中…";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'if(res.ok){card.parentNode.removeChild(card);show(res.message,"done");' +
            'if(!document.querySelectorAll(".card.wh").length){' +
              'show("全部處理完畢 👍","done");}}' +
          'else{for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
            'btns[0].textContent=old;show(res.message,"fail");}})' +
        '.withFailureHandler(function(e){' +
          'for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
          'btns[0].textContent=old;show("連線失敗："+e.message,"fail");})' +
        '.submitWarehouse(no,dec,note,rw);' +
    '}' +
    '</script>';

  return head + cards + footer + script;
}

function shipBlock_(email, rows, roles, meta, pending, issues) {
  pending = pending || [];
  issues = issues || [];
  var head =
    '<div class="hd"><div class="ic">📦</div><div>' +
    '<h1>出貨登錄</h1><p>' + esc_(email) + '</p></div></div>' +
    '<div id="msg"></div><div id="notice"></div>' +
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
      '<div class="sec">已核准待出貨（舊流程）' +
        '<span>業務還沒用下單頁的單，資料要自己填</span></div>' +
      '<div class="card">' +
        '<div class="note">點一下把客戶／案名帶進下方表單。' +
          '沒有發包單的出貨（弱電料件、鎖胚、建案整批）不會出現在這裡，直接填下方表單即可。</div>' +
        items +
      '</div>';
  } else if (!pending.length && !issues.length) {
    list = '<div class="card"><div class="center">目前沒有待出貨的項目 👍<br>' +
      '<span style="font-size:11.5px">沒有發包單的出貨直接填下方表單</span></div></div>';
  }

  // 業務已下單的擺在最前面：那是新流程、也是最不費力的（只補三格）
  list = pendingShipBlock_(pending) + list;

  // 倉庫回報有問題的擺在**最上面**：那是唯一有人在等的事——
  // 倉庫把單子退回來了，在助理處理之前整條線是停住的。
  list = warehouseIssueBlock_(issues) + list;

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
    fillItScript_() + reopenScript_() +
    copyScript_() + techNoticeScript_() +
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
          'if(res.ok){show(res.message,"done");showNotice(res.techNotice);' +
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

/**
 * 「業務已下單」卡片的送出行為（回傳 JS 原始碼字串）。
 *
 * ⚠ 抽出來的原因是**踩過**：單筆頁（renderShipOne_）畫了同一張卡片、
 *   按鈕一樣 onclick="fillIt(...)"，但整頁沒有掛任何 <script>，
 *   結果 fillIt 未定義——按下去毫無反應，連伺服器都沒收到請求，
 *   執行記錄只看得到 doGet。列表頁與單筆頁一律共用這一份，不要各自複製。
 *
 * 呼叫端需自備 g(id) / show(text,cls) / showNotice(text)。
 */
function fillItScript_() {
  // 業務已下單的：只送三個 TipTop 欄位，其餘資料留在表上不動
  return 'function fillIt(id,rw){' +
      'var sn=g(id+"s").value;' +
      'if(!sn.trim()){show("出貨單號為必填","fail");return;}' +
      'var card=g(id);var btns=card.querySelectorAll("button");' +
      'for(var i=0;i<btns.length;i++){btns[i].disabled=true;}' +
      'var old=btns[0].textContent;btns[0].textContent="處理中…";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'if(res.ok){card.parentNode.removeChild(card);show(res.message,"done");' +
            'showNotice(res.techNotice);}' +
          'else{for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
            'btns[0].textContent=old;show(res.message,"fail");}})' +
        '.withFailureHandler(function(e){' +
          'for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
          'btns[0].textContent=old;show("連線失敗："+e.message,"fail");})' +
        '.fillShipment(rw,{shipNo:sn,orderId:g(id+"o").value,shipDate:g(id+"d").value});' +
    '}';
}

/** 把倉庫退回來的單送回去重核（回傳 JS 原始碼字串，與 fillItScript_ 同一種寫法）。 */
function reopenScript_() {
  return 'function reopen(no,id,rw){' +
      // 二次確認：這個動作會把單子推回倉庫，倉庫那邊會馬上收到通知。
      // 資料還沒改就按下去的話，倉庫會白跑一趟、然後再退一次。
      'if(!confirm("確定資料已經修正好了嗎？\\n送回去之後倉庫會立刻收到通知。"))return;' +
      'var card=g(id);var btns=card.querySelectorAll("button");' +
      'for(var i=0;i<btns.length;i++){btns[i].disabled=true;}' +
      'var old=btns[0].textContent;btns[0].textContent="處理中…";' +
      'google.script.run' +
        '.withSuccessHandler(function(res){' +
          'if(res.ok){card.parentNode.removeChild(card);show(res.message,"done");}' +
          'else{for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
            'btns[0].textContent=old;show(res.message,"fail");}})' +
        '.withFailureHandler(function(e){' +
          'for(var i=0;i<btns.length;i++){btns[i].disabled=false;}' +
          'btns[0].textContent=old;show("連線失敗："+e.message,"fail");})' +
        '.reopenWarehouse(no,g(id+"i")?g(id+"i").value:"",rw);' +
    '}';
}

/**
 * 出貨登錄「單筆頁」的完整 <script>。
 * 只帶這一頁真正用得到的東西：單筆頁沒有下方的完整登錄表單，所以不含 send()/fill()。
 */
function shipOneScript_() {
  return '<script>' +
    'function g(id){return document.getElementById(id);}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t+\'</div>\';window.scrollTo(0,0);}' +
    fillItScript_() + copyScript_() + techNoticeScript_() +
    '</script>';
}

/**
 * 複製到剪貼簿的前端片段（回傳 JS 原始碼字串），供查詢頁與出貨頁共用。
 *
 * ⚠ 必須保留 navigator.clipboard → execCommand 的雙軌。GAS 的畫面跑在
 *   googleusercontent.com 的沙箱 iframe 裡，clipboard API 常被擋，
 *   沒有退路的結果是「按了沒反應、也沒有任何錯誤訊息」——最難查的那一種。
 *
 * 呼叫端需自備 show(text, cls) 函式。
 */
function copyScript_() {
  return 'function cpText(t){' +
      'function done(){show("已複製，貼到 LINE 群組即可","done");}' +
      'try{if(navigator.clipboard&&navigator.clipboard.writeText){' +
        'navigator.clipboard.writeText(t).then(done,function(){cpFb(t,done);});return;}}catch(e){}' +
      'cpFb(t,done);}' +
    'function cpFb(t,done){var a=document.createElement("textarea");a.value=t;' +
      'a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();' +
      'var okc=false;try{okc=document.execCommand("copy");}catch(e){}' +
      'document.body.removeChild(a);' +
      'if(okc){done();}else{show("這個瀏覽器不允許自動複製，請手動選取文字","fail");}}';
}

/**
 * 師傅通知的顯示區塊（前端 JS 原始碼字串）。
 * 刻意連內容一起顯示、不只給按鈕——助理要能先看一眼對不對再貼出去。
 */
function techNoticeScript_() {
  // 通知文字放全域變數、內容用 textContent 填入，不拼進 innerHTML——
  // 通知裡有地址與姓名，拼字串就得處理跳脫，textContent 天生不用。
  return 'var NOTICE="";' +
    'function showNotice(t){' +
      'if(!t){return;}' +
      'NOTICE=t;' +
      'var d=document.getElementById("notice");if(!d){return;}' +
      'd.innerHTML=\'<div class="card">\'' +
        '+\'<div class="whlab">師傅通知（不含金額，確認後貼到 LINE 群組）</div>\'' +
        '+\'<div class="whitems" id="noticeTxt"></div>\'' +
        '+\'<div class="whbtn"><button class="ok big" onclick="cpText(NOTICE)">\'' +
        '+\'📋 複製師傅通知</button></div></div>\';' +
      'document.getElementById("noticeTxt").textContent=t;}';
}

function fld_(id, label, ph) {
  return '<div><label>' + esc_(label) + '</label>' +
    '<input id="' + id + '" placeholder="' + esc_(ph || '') + '"></div>';
}

/** 頁面切換列。只列出這個身分真的有權限的頁，不給看得到卻點不進去的東西。 */
/**
 * 本 Web App 的 /exec 網址。
 *
 * ⚠ 這裡不能用相對連結。GAS 的畫面實際跑在 googleusercontent.com 的沙箱 iframe 裡，
 *   `href="?page=ship"` 會相對到那個沙箱網址而不是 /exec，點下去是**一片空白、沒有錯誤訊息**。
 *   必須用絕對網址搭配 target="_top"，才會在最外層視窗換頁。
 */
function webAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    Logger.log('取不到 Web App 網址（頁籤將無法切換）：' + err);
    return '';
  }
}

/**
 * 產生「Chat 通知裡可以點的深連結」，直接開到某一筆。
 *
 * 與 webAppUrl_() 的差別很重要，兩者不能互換：
 *   webAppUrl_()  給**頁面內部**的頁籤用，跑在使用者已經開著的那個 /exec 裡。
 *   deepLink_()   給**送到 Chat 的訊息**用，收訊的人是從零開啟。
 *
 * ⚠ 為什麼優先讀 DISPATCH_WEBAPP_URL 而不是 ScriptApp.getService().getUrl()：
 *   通知是在時間觸發器（以及未來的 Chat 事件）裡送出的，那些執行環境下
 *   getUrl() 回的可能是 Head deployment 的 /dev 網址——只有開發者本人打得開，
 *   其他人點了是 404。DISPATCH_WEBAPP_URL 是人工貼上的正式 /exec，不會變。
 *
 * ⚠ 分頁名一定要 encodeURIComponent：實際的分頁名長這樣——
 *   「零售-Johnson」「吳垂容(信益鎖店)」「潘筱凡(金宏鎖店)」。
 *   沒編碼就拼進網址，伺服器端 e.parameter.sh 會對不上，位置提示失效，
 *   於是退回掃 17 個分頁——**畫面完全正確，只是從 2 秒變回 39 秒**，
 *   沒有任何錯誤訊息，沒有人會發現慢的原因。這是本功能最容易踩的坑。
 *
 * 取不到基底網址時回空字串，讓呼叫端省略連結（沿用 navBlock_ 的原則：
 * 寧可沒有連結，也不要給一個點下去是錯誤頁的連結）。
 */
function deepLink_(params) {
  var base = '';
  try {
    base = String(PropertiesService.getScriptProperties()
      .getProperty('DISPATCH_WEBAPP_URL') || '').trim();
  } catch (err) {
    base = '';
  }
  if (!base) base = webAppUrl_();
  if (!base) {
    Logger.log('取不到 Web App 網址（DISPATCH_WEBAPP_URL 未設定），通知將不附連結。');
    return '';
  }

  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === null || v === undefined || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  if (!parts.length) return base;
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
}

function navBlock_(current, roles) {
  var tabs = [];
  // 儀表板頁籤：只有「至少會看到一格」的人才顯示，條件與 dashCounts_ 給格子的條件一致。
  // 完全沒有角色的人進去會是空白頁，那比不給入口更糟。
  if (roles.boss || roles.sub || roles.assistant || roles.warehouse) {
    tabs.push(['home', '首頁']);
  }
  if (roles.sales) tabs.push(['order', '下單']);
  // 「截圖下單」2026-08-25 併進下單頁的單別按鈕，不再是獨立頁籤。
  // ?page=quick 仍可用（doGet 當別名導到下單頁並預選），書籤不會失效。
  if (roles.sub || roles.boss) tabs.push(['approve', '簽核']);
  if (roles.assistant) tabs.push(['ship', '出貨登錄']);
  if (roles.warehouse) tabs.push(['warehouse', '倉庫核單']);
  if (roles.warehouse) tabs.push(['shipdoc', '貨運單']);
  tabs.push(['query', '查詢']);   // 唯讀，全員可用
  if (roles.boss || roles.sub) tabs.push(['report', '報表']);
  if (tabs.length < 2) return '';

  var base = webAppUrl_();
  var html = '<div class="nav">';
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i][0] === current;
    if (on) {
      html += '<span class="tab on">' + esc_(tabs[i][1]) + '</span>';
    } else if (base) {
      html += '<a class="tab" target="_top" href="' + esc_(base) + '?page=' + tabs[i][0] +
        '">' + esc_(tabs[i][1]) + '</a>';
    } else {
      // 取不到網址時寧可顯示不可點，也不要給一個點了變空白的連結
      html += '<span class="tab" title="取不到 Web App 網址">' + esc_(tabs[i][1]) + '</span>';
    }
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
  var whRaw = String(props.getProperty('DISPATCH_WAREHOUSE') || '').trim();
  // 業務身分來自路由對照表，不是另一份 email 名單——下單需要代碼與目標分頁，
  // 那些只在對照表裡。詳見 salesFor_()。
  var sales = salesFor_(email);
  return {
    sales: !!sales,
    salesInfo: sales,
    sub: stages.sub,
    boss: stages.boss,
    approverUnrestricted: stages.unrestricted,
    assistant: assistRaw ? inList_(assistRaw, email) : true,
    assistantUnrestricted: !assistRaw,
    warehouse: whRaw ? inList_(whRaw, email) : true,
    warehouseUnrestricted: !whRaw
  };
}

/**
 * 讀「選單」分頁，回傳 { 欄名: [選項…] }。橫向排列，一欄一個欄位。
 *
 * 靠表頭文字定位，所以欄序不重要——日後要加第五個下拉欄位就多開一欄。
 * 分頁不存在時回空物件，呼叫端要退回純文字輸入（不可整頁壞掉）。
 */
/**
 * 選項清單。兩個來源，依序嘗試：
 *
 *   ① 「選單」分頁（橫向排列，一欄一個欄位）
 *   ② **該業務分頁儲存格上的「資料驗證」** ← 使用者本來就在用的方式
 *
 * 為什麼要支援 ②：使用者已經在試算表用資料驗證設好了下拉。
 * 要求他再維護一張「選單」分頁，就是同一份清單存兩個地方——
 * 遲早不一致，而不一致的那天沒有人會發現（試算表選 A、網頁選 B，都寫得進去）。
 * 讀資料驗證的話，試算表與網頁永遠是同一份清單。
 *
 * 「選單」分頁優先：它能涵蓋業務分頁上沒有的欄位（例如「工項」在出貨明細，
 * 業務分頁根本沒這一欄），而且要新增選項時不必碰資料列。
 */
function loadOptions_(sheetName) {
  var fromSheet = loadOptionsSheet_();
  var fromValid = sheetName ? loadOptionsValidation_(sheetName) : {};
  // 逐欄合併：「選單」分頁有的用它，沒有的退而用資料驗證
  var out = {};
  for (var i = 0; i < OPTION_COLS.length; i++) {
    var k = OPTION_COLS[i];
    if (fromSheet[k]) out[k] = fromSheet[k];
    else if (fromValid[k]) out[k] = fromValid[k];
  }
  return out;
}

/**
 * 讀該分頁資料列上的「資料驗證」選項。
 *
 * 讀第一列資料（表頭下一列）的驗證規則。兩種 criteria 都要處理：
 *   VALUE_IN_LIST  → 選項直接寫在規則裡
 *   VALUE_IN_RANGE → 規則指向另一個範圍，要再讀那個範圍
 * 後者很常見（大家習慣把清單放在角落再指過去）。
 */
function loadOptionsValidation_(sheetName) {
  if (!sheetName || isSystemSheet_(sheetName)) return {};
  var id = PropertiesService.getScriptProperties().getProperty('DISPATCH_SHEET_ID');
  if (!id) return {};
  try {
    var sheet = SpreadsheetApp.openById(id).getSheetByName(sheetName);
    if (!sheet) return {};
    var ctx = buildCtx_(sheet);
    if (!ctx) return {};

    // 下拉欄位 → 這個分頁上對應的欄名
    var map = {};
    map[OPT_CHANNEL] = COL_PROJECT;
    map[OPT_MODEL] = COL_MODEL;
    map[OPT_WORKER] = COL_WORKER;

    var out = {};
    for (var key in map) {
      var col = ctx.col[map[key]];
      if (!col) continue;
      var list = validationList_(sheet, ctx.headerRow + 1, col);
      if (list && list.length) out[key] = list;
    }
    return out;
  } catch (err) {
    Logger.log('讀資料驗證失敗（該欄將退回文字輸入）：' + err);
    return {};
  }
}

/** 取單一儲存格的資料驗證選項清單。取不到回 null。 */
function validationList_(sheet, row, col) {
  try {
    var rule = sheet.getRange(row, col).getDataValidation();
    if (!rule) return null;
    var type = String(rule.getCriteriaType());
    var vals = rule.getCriteriaValues();
    if (!vals || !vals.length) return null;

    var raw = [];
    if (type === 'VALUE_IN_LIST') {
      raw = vals[0] || [];
    } else if (type === 'VALUE_IN_RANGE') {
      // vals[0] 是 Range 物件，要再讀一次它的值
      var rg = vals[0];
      if (!rg || !rg.getValues) return null;
      var got = rg.getValues();
      for (var i = 0; i < got.length; i++) {
        for (var j = 0; j < got[i].length; j++) raw.push(got[i][j]);
      }
    } else {
      return null;   // 其他驗證類型（數字範圍、日期…）不是選單
    }

    var list = [];
    for (var k = 0; k < raw.length; k++) {
      var v = String(raw[k] == null ? '' : raw[k]).trim();
      if (v && list.indexOf(v) < 0) list.push(v);
    }
    return list.length ? list : null;
  } catch (err) {
    return null;
  }
}

/** 讀「選單」分頁（橫向排列，一欄一個欄位） */
function loadOptionsSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('DISPATCH_SHEET_ID');
  if (!id) return {};
  try {
    var sheet = SpreadsheetApp.openById(id).getSheetByName(OPTIONS_SHEET);
    if (!sheet) return {};
    var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return {};

    var vals = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var pos = {};
    for (var c = 0; c < vals[0].length; c++) {
      var key = normHeader_(vals[0][c]);
      if (key && pos[key] === undefined) pos[key] = c;
    }

    var out = {};
    for (var i = 0; i < OPTION_COLS.length; i++) {
      var name = OPTION_COLS[i];
      var idx = pos[normHeader_(name)];
      if (idx === undefined) continue;
      var list = [];
      for (var r = 1; r < vals.length; r++) {
        var v = String(vals[r][idx] == null ? '' : vals[r][idx]).trim();
        // 空白列略過：業務中間刪掉一項不該留下空選項
        if (v && list.indexOf(v) < 0) list.push(v);
      }
      if (list.length) out[name] = list;
    }
    return out;
  } catch (err) {
    Logger.log('讀選單分頁失敗（下拉將退回純文字輸入）：' + err);
    return {};
  }
}

/**
 * 產生下拉 ＋「其他」文字框。沒有選項時退回純文字輸入（現況行為）。
 * id 給 select，id + 'X' 給文字框——送出時前端依 select 是否為「其他」決定取哪個。
 */
function selFld_(id, label, options, ph) {
  if (!options || !options.length) return fld_(id, label, ph);
  var opts = '<option value=""></option>';
  for (var i = 0; i < options.length; i++) {
    opts += '<option>' + esc_(options[i]) + '</option>';
  }
  opts += '<option>' + esc_(OTHER_OPTION) + '</option>';
  return '<div><label>' + esc_(label) + '</label>' +
    '<select id="' + id + '" onchange="oth(\'' + id + '\')">' + opts + '</select>' +
    '<input id="' + id + 'X" style="display:none;margin-top:5px" ' +
      'placeholder="請輸入' + esc_(label.replace(/ \*$/, '')) + '"></div>';
}

/**
 * 這個 email 是哪一位業務。**身分來源是路由對照表本身，不另設一份名單。**
 *
 * 為什麼不用 DISPATCH_SALES 屬性：下單需要知道「代碼」與「寫哪個分頁」，
 * 那些資訊只在對照表裡。再多一份 email 名單就是同一件事記兩個地方，
 * 遲早不一致——而不一致的那一天，會是某個業務下單時代碼抓錯人。
 *
 * 回 null 表示這個人不能下單（不在對照表，或表裡沒填他的 email）。
 */
function salesFor_(email) {
  var me = String(email || '').toLowerCase().trim();
  if (!me) return null;
  var roster;
  try { roster = loadRoster_(); } catch (err) { return null; }
  for (var code in roster) {
    var r = roster[code];
    if (String(r.salesMail || '').toLowerCase() === me) {
      return {
        code: code,
        name: r.sales || '',
        sheet: r.sheet || '',
        type: r.type || '',
        assist: r.assist || '',
        assistMail: r.assistMail || ''
      };
    }
  }
  return null;
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
  return submitDecisionAs_(currentUserEmail_(), orderNo, decision, note, hintSheet, hintRow);
}

/**
 * 簽核核心。身分由呼叫端指定，因為不是每個入口都拿得到 Session：
 *   - 網頁（google.script.run）→ 薄殼 submitDecision 傳 currentUserEmail_()
 *   - Chat 卡片按鈕            → 傳 event.user.email（Chat app 以 app 身分執行，
 *                                Session.getActiveUser() 在那個環境回空字串）
 *
 * 🔴 函式名結尾的底線是**安全邊界**，不是命名風格。
 *   GAS 只把「不以底線結尾」的函式暴露給 google.script.run。少了這個底線，
 *   前端就能直接呼叫 submitDecisionAs('boss@waferlock.com', ...) 任意指定簽核人，
 *   而 appendAudit_ 會把那個假身分忠實寫進簽核紀錄，事後查不出是偽造的。
 *   要改名字前先想清楚這件事。
 *
 * 權限檢查（checkApprover_）刻意留在這支核心裡面、不在薄殼，
 * 這樣不管從哪個入口進來，跑的都是同一套名單閘門。
 */
function submitDecisionAs_(email, orderNo, decision, note, hintSheet, hintRow) {
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
    // 定位：位置提示 → 業務指定分頁 → 全掃，三段式退路。
    // 與深連結單筆頁共用同一支，避免兩份定位邏輯日後漂移。
    var located = resolveOneByOrderNo_(orderNo, hintSheet, hintRow);
    if (!located) return { ok: false, message: '找不到發包單號 ' + orderNo + '，可能已被刪除。' };
    var env = located.env;
    var hit = located.hit;

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
/**
 * 自檢一律讀真實表頭，不用結構快取。
 * 拿舊對照去報告「欄位齊全」會讓人以為改對了，而自檢的全部價值就在於反映真實狀態。
 */
function withFreshStruct_(fn) {
  var prev = SKIP_STRUCT_CACHE_;
  SKIP_STRUCT_CACHE_ = true;
  try { return fn(); } finally { SKIP_STRUCT_CACHE_ = prev; }
}

var STRUCT_CACHE_KEY = 'dispatch_struct_v1';

/**
 * 是否略過結構快取。自檢函式必須讀真實表頭——
 * 拿舊對照去報告「欄位齊全」會讓人以為改對了，而自檢的全部價值就在於反映真實狀態。
 */
var SKIP_STRUCT_CACHE_ = false;

/** 改完表頭後手動執行，或由自檢函式暫時關閉快取用 */
function clearStructCache() {
  try {
    CacheService.getScriptCache().remove(STRUCT_CACHE_KEY);
    Logger.log('✅ 已清除分頁結構快取，下次讀取會重新偵測表頭。');
  } catch (err) {
    Logger.log('清除結構快取失敗：' + err);
  }
}

/**
 * 分頁結構（表頭列、欄位對照、寬度）的快取。
 *
 * 為什麼值得：`buildCtx_()` 每個分頁要 3 次 API 往返，17 個分頁 = 51 次 ≈ 15 秒，
 * 而**表頭幾乎不變**——每次開頁重新偵測一遍是純浪費。
 *
 * `lastRow` 刻意**不快取**：每新增一筆單它就變，快取了會讀不到最新的列。
 * 所以命中時仍逐頁問一次 lastRow（17 次往返），省下的是另外 34 次。
 *
 * ⚠ 代價：業務新增欄位後，最多 15 分鐘內仍用舊對照，新欄位讀不到。
 *   欄位變動是低頻事件，這個取捨可以接受，但 checkSetup() 會提示這份快取存在，
 *   而且自檢一律繞過它（見 SKIP_STRUCT_CACHE_）。
 */
function loadStructCache_(names) {
  if (SKIP_STRUCT_CACHE_) return null;
  try {
    var hit = CacheService.getScriptCache().get(STRUCT_CACHE_KEY);
    if (!hit) return null;
    var obj = JSON.parse(hit);
    if (!obj || !obj.sheets) return null;
    // 分頁清單變了（新增／改名／刪除）就整份重建，不做部分更新——
    // 部分更新要處理的邊界比重建多，而重建只是偶爾多花十幾秒
    if (obj.names !== names.join('|')) return null;
    return obj.sheets;
  } catch (err) {
    Logger.log('讀取結構快取失敗，改為重新偵測：' + err);
    return null;
  }
}

function saveStructCache_(names, sheets) {
  if (SKIP_STRUCT_CACHE_) return;
  try {
    var payload = JSON.stringify({ names: names.join('|'), sheets: sheets });
    if (payload.length <= CACHE_MAX_BYTES) {
      CacheService.getScriptCache().put(STRUCT_CACHE_KEY, payload, CACHE_TTL);
    } else {
      Logger.log('⚠ 結構快取 ' + payload.length + ' bytes 超過上限，未寫入（開頁會維持較慢）。');
    }
  } catch (err) {
    Logger.log('寫入結構快取失敗：' + err);
  }
}

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
    var candidates = [], names = [];
    for (var a = 0; a < all.length; a++) {
      if (isSystemSheet_(all[a].getName())) continue;
      candidates.push(all[a]);
      names.push(all[a].getName());
    }

    // 結構快取命中：只問 lastRow（每分頁 1 次往返），省下表頭偵測與寬度查詢的 34 次
    var cached = loadStructCache_(names);
    if (cached) {
      for (var c2 = 0; c2 < candidates.length; c2++) {
        var st = cached[candidates[c2].getName()];
        if (!st) continue;   // 快取裡沒有＝當時判定為非發包分頁
        list.push({
          sheet: candidates[c2],
          name: candidates[c2].getName(),
          headerRow: st.headerRow,
          lastRow: candidates[c2].getLastRow(),
          lastCol: st.lastCol,
          col: st.col,
          usable: st.usable,
          twoStage: st.twoStage
        });
      }
      if (list.length) return { ss: ss, list: list };
      // 快取內容與現況對不上（例如全部分頁都被判為非發包分頁）就重建
    }

    var struct = {};
    for (var i = 0; i < candidates.length; i++) {
      var ctx = buildCtx_(candidates[i]);
      if (!ctx) continue;   // 沒有「發包單號」表頭的分頁自動略過
      list.push(ctx);
      struct[ctx.name] = {
        headerRow: ctx.headerRow, lastCol: ctx.lastCol,
        col: ctx.col, usable: ctx.usable, twoStage: ctx.twoStage
      };
    }
    if (!list.length) {
      throw new Error('自動掃描找不到任何含「' + COL_ORDER_NO + '」表頭的分頁');
    }
    saveStructCache_(names, struct);
  } else {
    var names = spec.split(',');
    for (var j = 0; j < names.length; j++) {
      var name = names[j].trim();
      if (!name) continue;
      // 明確列舉時也要擋系統分頁：把「出貨明細」寫進 DISPATCH_SHEET_NAME
      // 會讓整張出貨資料被當成發包單掃描
      if (isSystemSheet_(name)) {
        throw new Error('DISPATCH_SHEET_NAME 不可包含系統分頁「' + name + '」');
      }
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
/**
 * 這是系統自己的分頁，不是業務發包分頁。
 *
 * 為什麼需要一份清單而不是逐一 if：這些分頁的表頭都含「發包單號」，
 * 自動掃描會把它們當成業務分頁。目前是靠「沒有主管簽核欄」而被略過，
 * 但那是**巧合而非防護**——哪天有人在出貨明細加了那一欄，
 * 整張出貨資料就會被讀進主管的待核清單。
 * 簽核紀錄早就排除了，新增出貨明細時漏了同一件事，所以改成明確列舉。
 */
function isSystemSheet_(name) {
  if (!name) return true;
  if (name === AUDIT_SHEET || name === SHIPMENT_SHEET || name === OPTIONS_SHEET) return true;
  // 路由對照表沒有「發包單號」表頭，本來就不會被納入，但一併列出免得日後改欄名時出事
  var roster = String(PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_ROSTER_SHEET') || '').trim();
  if (roster && name === roster) return true;
  for (var i = 0; i < ROSTER_SHEET_NAMES.length; i++) {
    if (name === ROSTER_SHEET_NAMES[i]) return true;
  }
  return false;
}

function isSheetInScope_(name) {
  if (!name || isSystemSheet_(name)) return false;
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

/**
 * 以下兩支是純函式（吃已經讀好的值，不碰試算表），讓 buildCtx_ 讀一次資料
 * 就把表頭列與欄位對照都算出來。
 *
 * 2026-08-25：原本還有兩支帶 sheet 參數的舊版（detectHeaderRow_／headerMap_），
 * 註解寫著「保留不動，避免影響其他呼叫端」——但全 repo（含另外四支 .gs 與
 * scripts/*.js）查證後**根本沒有那個呼叫端**，已刪除。
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
  var total = new Date().getTime();

  // 三份各自獨立 try：其中一份讀表失敗，不能讓另兩份也不更新——
  // 那會讓沒壞的兩頁也跟著變慢，而且原因看起來完全無關。
  var jobs = [
    ['待簽核', invalidatePendingCache_, getPendingCached_],
    ['待出貨', function () { try { CacheService.getScriptCache().remove(SHIP_CACHE_KEY); } catch (e) {} },
      getShippableCached_],
    ['待核單', invalidateWarehouseCache_, getWarehouseCached_]
  ];

  for (var i = 0; i < jobs.length; i++) {
    var name = jobs[i][0];
    var t0 = new Date().getTime();
    try {
      jobs[i][1]();
      var res = jobs[i][2]();
      Logger.log('✅ ' + name + ' 快取已更新：' + res.rows.length + ' 筆，耗時 ' +
        ((new Date().getTime() - t0) / 1000).toFixed(1) + ' 秒');
    } catch (err) {
      Logger.log('❌ ' + name + ' 快取更新失敗（另兩份仍會繼續）：' + err);
    }
  }

  // 儀表板快取：一定要放在三份快取都更新完之後，這樣它只是讀剛寫好的快取（毫秒），
  // 不會再多掃一次表。失敗不影響上面三份——儀表板是附屬品，不能拖累簽核。
  try {
    var d0 = new Date().getTime();
    warmDashboardCache();
    Logger.log('✅ 儀表板快取已更新，耗時 ' +
      ((new Date().getTime() - d0) / 1000).toFixed(1) + ' 秒');
  } catch (err) {
    Logger.log('❌ 儀表板快取更新失敗（不影響其他三份）：' + err);
  }

  // GAS 單次執行上限 6 分鐘。總耗時接近 3 分鐘就該回頭考慮 Advanced Sheets Service
  // 的 batchGet（一次往返讀完所有分頁），而不是繼續加預熱項目。
  var secs = (new Date().getTime() - total) / 1000;
  Logger.log('預熱總耗時 ' + secs.toFixed(1) + ' 秒');
  if (secs > 170) {
    Logger.log('⚠ 預熱已超過 170 秒，接近 GAS 6 分鐘上限的一半。' +
      '分頁數若再成長，應改用 Sheets API 的 batchGet 而不是繼續加預熱。');
  }
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
 * 依發包單號定位一列，三段式退路，回傳 { env, hit:{ctx,row} } 或 null。
 *
 * 這是「開一筆單只要 2 秒、而不是 39 秒」的核心。三段的成本差很多：
 *
 *   第一段 位置提示     約 5 次 API 往返   ← 通知連結帶了 sh/rw 就走這條
 *   第二段 業務指定分頁 約 6 次           ← 提示失效（有人插刪過列）時的退路
 *   第三段 全部分頁掃描 50 次以上、39 秒  ← 最後手段，會記錄警告
 *
 * 第二段是新加的。原本只有「提示」與「全掃」兩段，一旦提示失效就直接掉進 39 秒。
 * 但發包單號的前兩碼就是業務代碼，而路由對照表已經記了每個業務對應哪個分頁，
 * 所以完全不必猜——查表就知道要開哪一頁，把最壞情況從 17 頁縮到 1 頁。
 *
 * 三段共用同一條安全規則：**位置提示只能讓事情變快，不能讓它指向別的列。**
 * 每一段都會比對那一格的單號真的等於 orderNo，對不上就往下一段走。
 */
function resolveOneByOrderNo_(orderNo, hintSheet, hintRow) {
  orderNo = String(orderNo || '').trim();
  if (!orderNo) return null;

  // 第一段：位置提示
  var hr = Number(hintRow || 0);
  if (hintSheet && hr > 0) {
    var one = openSheetByName_(hintSheet);
    if (one && hr > one.ctx.headerRow && hr <= (one.ctx.lastRow || 0)) {
      var probe = String(one.ctx.sheet
        .getRange(hr, one.ctx.col[COL_ORDER_NO]).getValue() || '').trim();
      if (probe === orderNo) return { env: one, hit: { ctx: one.ctx, row: hr } };
    }
  }

  // 第二段：靠單號前綴查出該業務的發包分頁，只掃那一頁
  var code = codeOf_(orderNo);
  if (code) {
    var person = loadRoster_()[code];
    var named = person && person.sheet;
    // 提示已經試過而且失敗了，同一頁不必再掃一次
    if (named && named !== hintSheet) {
      var two = openSheetByName_(named);
      if (two) {
        var found = findByOrderNo_(two, orderNo, '', 0);
        if (found) return { env: two, hit: found };
      }
    }
  }

  // 第三段：全掃。記錄下來——這條路徑代表使用者要等 39 秒，不該靜默發生。
  Logger.log('⚠ ' + orderNo + ' 位置提示與業務分頁都沒命中，退回掃描全部分頁（很慢）。' +
             'hintSheet=' + hintSheet + ' hintRow=' + hintRow);
  var env = openSheets_();
  var hit = findByOrderNo_(env, orderNo, hintSheet, hr);
  return hit ? { env: env, hit: hit } : null;
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
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

/**
 * 日期時間欄用的格式化：**有時間就保留時間**，純日期就只給日期。
 *
 * ⚠ 不能一律用 fmtDate_（只輸出 yyyy-MM-dd）——出貨明細裡「登錄時間」「倉庫核單時間」
 *   是有時分的，砍掉時間會讓「同一天的兩筆」分不出先後。
 * ⚠ 也不能用 String() 硬轉——那會變成
 *   「Wed Aug 12 2026 09:18:00 GMT+0800 (台北標準時間)」直接出現在 Chat 通知裡。
 */
function fmtWhen_(v) {
  if (!isDate_(v)) return String(v == null ? '' : v).trim();
  var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
  return Utilities.formatDate(v, TZ, hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
}

/**
 * 是不是 Date。**刻意不用 `v instanceof Date`**：
 * `instanceof` 靠原型鏈比對，跨 realm 就會失效（測試用 vm 跑，Date 是另一個 realm 的，
 * `instanceof` 一律回 false）。正式 GAS 只有一個 realm 碰不到，但那代表
 * 「測試過的行為」跟「正式跑的行為」不一樣——那比 bug 更難查。
 * toString 標籤是跨 realm 安全的。
 */
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
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

  // 缺的欄位補在**表尾**，不插入中間——插入會讓既有資料整排位移。
  // 欄序因此與 SHIPMENT_HEADERS 不同，但全程靠表頭文字定位，順序不影響正確性。
  var missing = [];
  for (var m = 0; m < SHIPMENT_HEADERS.length; m++) {
    if (col[normHeader_(SHIPMENT_HEADERS[m])] === undefined) missing.push(SHIPMENT_HEADERS[m]);
  }
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    for (var k = 0; k < missing.length; k++) col[normHeader_(missing[k])] = lastCol + 1 + k;
    Logger.log('出貨明細自動補上欄位（附加在表尾，未動既有資料）：' + missing.join('、'));
  }

  return { ss: ss, sheet: sheet, col: col };
}

/**
 * 業務已下單、但助理還沒鍵 TipTop 的列（出貨明細裡出貨單號為空的）。
 *
 * 這是 ③ 的主要來源。業務下單時已經把出貨項目／送貨資料／客人資料都填好了，
 * 助理只要補 TipTop 產生的訂單編號、出貨單號、出貨日期——
 * 不必重打一遍業務寫過的東西（「一筆訂單被輸入六次」正是要解決的事）。
 */
function getPendingShipments_() {
  var s = openShipmentSheet_();
  var last = s.sheet.getLastRow();
  if (last < 2) return [];
  var cNo = s.col[COL_S_SHIP_NO];
  if (!cNo) return [];

  var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
  var values = s.sheet.getRange(2, 1, last - 1, width).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[cNo - 1] == null ? '' : row[cNo - 1]).trim()) continue;  // 已鍵過
    var rec = {};
    var any = false;
    for (var h = 0; h < SHIPMENT_HEADERS.length; h++) {
      var name = SHIPMENT_HEADERS[h];
      var c = s.col[name];
      var v = (c && c <= row.length) ? row[c - 1] : '';
      rec[name] = (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
      if (rec[name] && name !== COL_S_WH_STATUS) any = true;
    }
    if (!any) continue;   // 整列空白（有人手動加了空列）
    rec.row = i + 2;
    out.push(rec);
  }
  return out;
}

/**
 * 倉庫回報「有問題」、還沒被送回去重核的列。
 *
 * 🔴 **這支存在的理由是一個真實的資料黑洞**（2026-08-25 追出來的）：
 *   倉庫按「有問題」之後，那一列就同時從**兩張清單**消失——
 *   倉庫端被 getWarehouseCached_ 的「已核或有問題都算處理完」過濾掉，
 *   助理端則因為 getPendingShipments_ 只撈「出貨單號為空」的列而看不到
 *   （有問題的列早就有出貨單號了）。
 *   於是通知發出去了，卻**沒有任何畫面看得到這張單**，也沒有函式能把它改回待核。
 *   訪談紀錄 docs/倉庫訪談清單.md 當初就預言過「單子會憑空消失」，確實成真。
 */
function getWarehouseIssues_() {
  var s = openShipmentSheet_();
  var last = s.sheet.getLastRow();
  if (last < 2) return [];
  var cSt = s.col[COL_S_WH_STATUS];
  if (!cSt) return [];

  var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
  var values = s.sheet.getRange(2, 1, last - 1, width).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[cSt - 1] == null ? '' : row[cSt - 1]).trim() !== WH_ISSUE) continue;
    var rec = {};
    for (var h = 0; h < SHIPMENT_HEADERS.length; h++) {
      var name = SHIPMENT_HEADERS[h];
      var c = s.col[name];
      var v = (c && c <= row.length) ? row[c - 1] : '';
      rec[name] = (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
    }
    rec.row = i + 2;
    out.push(rec);
  }
  return out;
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

    // 先讀單號欄定出資料邊界，再讀該範圍——與 pendingOfSheet_ 同一套做法。
    // getLastRow() 會被格式撐到 800~1100 列，實際資料只到 190 列左右，
    // 直接讀整塊是 5~6 倍的無謂讀取。
    var noCol = ctx.col[COL_ORDER_NO];
    var noVals = ctx.sheet.getRange(startRow, noCol, lastRow - startRow + 1, 1).getValues();
    var lastValid = -1;
    for (var nv = 0; nv < noVals.length; nv++) {
      if (ORDER_NO_RE.test(String(noVals[nv][0] || '').trim())) lastValid = nv;
    }
    if (lastValid < 0) continue;

    // 只讀到真正用得到的最後一欄（lastCol 常被最右邊的「業務確認」欄撐大）
    var width = 1;
    var wanted = [COL_ORDER_NO, COL_APPLY_AT, COL_WORKER, COL_CUSTOMER, COL_PROJECT,
                  COL_MODEL, COL_QTY, COL_QUOTE_QTY, COL_NOTE, COL_APPROVAL];
    for (var wi = 0; wi < wanted.length; wi++) {
      var wc = ctx.col[wanted[wi]];
      if (wc && wc > width) width = wc;
    }

    var values = ctx.sheet.getRange(startRow, 1, lastValid + 1, width).getValues();
    var row, raw, pick;
    raw = function (name) {
      var c = ctx.col[name];
      return (c && c <= row.length) ? row[c - 1] : '';
    };
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

    // 這條路徑（從頭新增一列）手上沒有列號，深連結就少帶 rw 提示。
    // 不影響正確性，只是倉庫點進去時多掃一次單欄。
    try { notifyWarehouse_(rec); }
    catch (e4) { Logger.log('通知倉庫失敗（出貨已登錄成功）：' + e4); }

    return {
      ok: true,
      message: '已登錄出貨單 ' + shipNo + '，已通知倉庫撿料。',
      techNotice: techNotice_(rec, '')
    };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── 師傅通知

/**
 * 組師傅通知文字，格式沿用現行的師傅通知訊息：
 *   2026-08-03
 *   L901-平日1-4
 *   裝外門
 *   孫明恩0953-644733
 *   臺北市大安區和平東路三段七號四樓
 *   VH-260803-01
 *
 * 🔴 **絕不含任何金額**。師傅群組是多個師傅共用的，
 * 推承包報價進去等於每個師傅都看到別人接同樣的活拿多少——
 * 一旦發生無法收回，而且會直接影響議價。這不是選項，是寫死的。
 * 現行的人工通知本來就沒有金額，這裡只是把那個做法固定下來。
 *
 * 也不含「送貨資料」：那是料寄到哪，師傅要的是去哪裡施工。
 */
function techNotice_(rec, model) {
  var lines = [];
  // 第一行是日期。現行通知用的是出貨/施工日；出貨日還沒鍵入時退用下單日，
  // 免得師傅收到一則沒有日期的通知。
  var d = String(rec[COL_S_SHIP_DATE] || '').trim();
  if (!d) d = String(rec[COL_S_AT] || '').trim().split(' ')[0];
  if (d) lines.push(d);

  var second = String(model || '').trim();
  var t = String(rec[COL_S_WORK_TIME] || '').trim();
  if (second && t) lines.push(second + '-' + t);
  else if (second) lines.push(second);
  else if (t) lines.push(t);

  var item = String(rec[COL_S_WORK_ITEM] || '').trim();
  if (item) lines.push(item);

  var who = String(rec[COL_S_CUST_NAME] || '').trim();
  var tel = String(rec[COL_S_CUST_PHONE] || '').trim();
  if (who || tel) lines.push(who + tel);   // 現行格式是姓名電話相連，不加空白

  var addr = String(rec[COL_S_CUST_ADDR] || '').trim();
  if (addr) lines.push(addr);

  var no = String(rec[COL_S_DISPATCH] || '').trim();
  if (no) lines.push(no);

  // 沒有聯絡人也沒有地址的通知，師傅拿到也不知道要去哪找誰——
  // 給一則只有日期和單號的通知比不給更糟（助理會以為貼出去就完成了）。
  // 舊路徑（submitShipment，無發包單的出貨）的表單沒有客人資料欄位，就是這種情況。
  if (!who && !tel && !addr) return '';

  return lines.join('\n');
}

// ────────────────────────────────────────────── ⑥ 報表（僅主管）

var REPORT_CACHE_KEY = 'dispatch_report_v1';

/**
 * 承包商名稱常見的後綴。比對「疑似同一人」時去掉它們再比。
 *
 * 「家」也算後綴，否則「蔣師傅」→「蔣」與「蔣家工程行」→「蔣家」比不起來，
 * 而那正是最常見的一組不一致寫法。加了之後兩邊都變「蔣」而配對成功，
 * 「陳家工程行」→「陳」仍然不會被誤配。
 *
 * ⚠ 只剩一個姓的時候誤判率會升高（「王師傅」與「王家工程行」可能是不同人）。
 *   這是可接受的，因為結果只是**提示疑似、由人判斷**，系統絕不自動合併——
 *   合併錯了會讓工資統計對到錯的人。
 */
var WORKER_SUFFIX_RE = /(有限公司|股份有限公司|工程行|工程|鎖印行|鎖印|鎖業|企業社|商行|師傅|先生|小姐|家)+$/g;

/**
 * 報表資料。**僅副主管／主管**。
 *
 * 為什麼整頁擋而不是遮欄位：報表的本質就是彙總金額，「本月毛利」一旦顯示
 * 就等於把進價反推出來了——遮欄位在報表上沒有意義。
 * 這裡自己再擋一次，不能只靠 doGet 的路由判斷（前端可被繞過）。
 */
function getReport() {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分。' };
  var roles = rolesFor_(email);
  if (!roles.boss && !roles.sub) {
    return { ok: false, message: '報表僅限副主管／主管檢視（' + email + '）。' };
  }

  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(REPORT_CACHE_KEY);
    if (hit) {
      var obj = JSON.parse(hit);
      if (obj && obj.data) return { ok: true, data: obj.data, at: obj.at, cached: true };
    }
  } catch (err) {
    Logger.log('讀報表快取失敗，改為重新統計：' + err);
  }

  try {
    var data = buildReport_();
    var at = Utilities.formatDate(new Date(), TZ, 'MM-dd HH:mm');
    try {
      var payload = JSON.stringify({ data: data, at: at });
      if (payload.length <= CACHE_MAX_BYTES) {
        CacheService.getScriptCache().put(REPORT_CACHE_KEY, payload, CACHE_TTL);
      }
    } catch (e2) { Logger.log('寫報表快取失敗：' + e2); }
    return { ok: true, data: data, at: at, cached: false };
  } catch (err) {
    return { ok: false, message: '統計失敗：' + err };
  }
}

/** 天數差（今天 － 那一天）。日期讀不出來回 -1，呼叫端據此不顯示。 */
function daysAgo_(ymd) {
  var s = String(ymd || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return -1;
  var then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / 86400000);
}

function buildReport_() {
  var out = { backlog: {}, months: [], sales: [], workers: [], quality: {} };

  // ── ① 待辦積壓：直接用三份既有快取，不重新掃表 ──
  // 它們已經是算好的清單、由 warmCache 每 10 分鐘更新。
  // 重新算一套的話，報表和各頁的筆數可能對不上，而那種矛盾最難解釋。
  function oldest(rows, field) {
    var o = '';
    for (var i = 0; i < rows.length; i++) {
      var d = String(rows[i][field] || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
      if (!o || d < o) o = d;
    }
    return o;
  }

  try {
    var pend = getPendingCached_().rows;
    var nSub = 0;
    for (var p = 0; p < pend.length; p++) if (pend[p].stage === 'sub') nSub++;
    out.backlog.sub = nSub;
    out.backlog.boss = pend.length - nSub;
    out.backlog.approveOldest = oldest(pend, 'applyAt');
    out.backlog.approveDays = daysAgo_(out.backlog.approveOldest);
  } catch (err) { out.backlog.approveError = String(err); }

  try {
    var ship = getShippableCached_().rows;
    out.backlog.ship = ship.length;
    out.backlog.shipOldest = oldest(ship, 'applyAt');
    out.backlog.shipDays = daysAgo_(out.backlog.shipOldest);
  } catch (err) { out.backlog.shipError = String(err); }

  try {
    var wh = getWarehouseCached_().rows;
    out.backlog.warehouse = wh.length;
    out.backlog.whOldest = oldest(wh, 'at');
    out.backlog.whDays = daysAgo_(out.backlog.whOldest);
  } catch (err) { out.backlog.whError = String(err); }

  // ── ② 出貨趨勢 ＋ ③ 業務績效（來源：出貨明細）──
  // 一格裝了兩個數字時（一列兩個品項）要**相加**，不可把分隔的空白刪掉——
  // 那會把 "56,000 16,800" 黏成 5600016800。報表程式踩過：某承包商合計顯示
  // 112 億（真實值 105 萬）。而且分隔字元兩種都有：有人用 Alt+Enter、有人用
  // 空格，在試算表畫面上長得一模一樣，所以**任何空白都當分隔**。
  // 這裡來源是網頁單行輸入、機率低，但同一份試算表被兩支程式讀出不同的數字，
  // 比機率低的 bug 難查得多，所以規則要一致。
  var num = function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s0 = String(v == null ? '' : v).trim();
    if (!s0) return 0;
    var ps = s0.split(/[\s 　]+/);
    if (ps.length > 1) {
      var sum = 0, got = false;
      for (var pi = 0; pi < ps.length; pi++) {
        var t0 = ps[pi].replace(/[,$]/g, '');
        if (!t0) continue;
        var n0 = Number(t0);
        if (isFinite(n0)) { sum += n0; got = true; }
      }
      return got ? sum : 0;
    }
    var n = Number(s0.replace(/[,$]/g, ''));
    return isNaN(n) ? 0 : n;   // 空白或非數字算 0，不可讓合計變 NaN
  };

  var roster = {};
  try { roster = loadRoster_(); } catch (err) {}

  var byMonth = {}, bySales = {}, unknownCodes = {};
  try {
    var s = openShipmentSheet_();
    var last = s.sheet.getLastRow();
    if (last >= 2) {
      var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
      var vals = s.sheet.getRange(2, 1, last - 1, width).getValues();
      var cAt = s.col[COL_S_AT], cDate = s.col[COL_S_SHIP_DATE];
      var cSale = s.col[COL_S_SALE_PRICE], cCost = s.col[COL_S_COST_PRICE];
      var cDisp = s.col[COL_S_DISPATCH], cBy = s.col[COL_S_ORDER_BY];

      for (var i = 0; i < vals.length; i++) {
        var row = vals[i];
        var cell = function (c) {
          if (!c || c > row.length) return '';
          var v = row[c - 1];
          return (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
        };
        var when = cell(cDate) || cell(cAt);
        if (!when) continue;
        // 用「年-月」當鍵，不是只用月——否則 2025-12 會跟 2026-12 併在一起
        var mk = String(when).slice(0, 7).replace(/\//g, '-');
        if (!/^\d{4}-\d{2}$/.test(mk)) continue;

        var sale = num(cell(cSale)), cost = num(cell(cCost));
        if (!byMonth[mk]) byMonth[mk] = { month: mk, count: 0, sale: 0 };
        byMonth[mk].count++;
        byMonth[mk].sale += sale;

        // 業務歸屬：優先用「下單業務」，沒有就用發包單號前綴查對照表
        var who = cell(cBy);
        var code = codeOf_(cell(cDisp));
        if (!who && code && roster[code]) who = roster[code].sales || code;
        if (!who && code) { who = code; unknownCodes[code] = (unknownCodes[code] || 0) + 1; }
        if (!who) who = '（未標示）';

        if (!bySales[who]) bySales[who] = { name: who, count: 0, sale: 0, profit: 0 };
        bySales[who].count++;
        bySales[who].sale += sale;
        bySales[who].profit += (sale - cost);
      }
    }
  } catch (err) {
    out.shipmentError = String(err);
  }

  var mkeys = Object.keys(byMonth).sort();
  if (mkeys.length > 12) mkeys = mkeys.slice(mkeys.length - 12);
  for (var m2 = 0; m2 < mkeys.length; m2++) out.months.push(byMonth[mkeys[m2]]);

  var skeys = Object.keys(bySales);
  for (var s2 = 0; s2 < skeys.length; s2++) out.sales.push(bySales[skeys[s2]]);
  out.sales.sort(function (a, b) { return b.sale - a.sale; });

  // ── ④ 承包商接案量（來源：業務分頁）──
  var byWorker = {};
  try {
    var env = openSheets_();
    for (var k = 0; k < env.list.length; k++) {
      var ctx = env.list[k];
      var startRow = ctx.headerRow + 1;
      var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
      if (lastRow < startRow) continue;
      var noCol = ctx.col[COL_ORDER_NO], wCol = ctx.col[COL_WORKER];
      if (!wCol) continue;

      var noVals = ctx.sheet.getRange(startRow, noCol, lastRow - startRow + 1, 1).getValues();
      var lastValid = -1;
      for (var nv = 0; nv < noVals.length; nv++) {
        if (ORDER_NO_RE.test(String(noVals[nv][0] || '').trim())) lastValid = nv;
      }
      if (lastValid < 0) continue;

      var wide = Math.max(wCol, ctx.col[COL_PRICE] || 0, noCol);
      var rows2 = ctx.sheet.getRange(startRow, 1, lastValid + 1, wide).getValues();
      for (var r2 = 0; r2 < rows2.length; r2++) {
        var rr = rows2[r2];
        if (!ORDER_NO_RE.test(String(rr[noCol - 1] || '').trim())) continue;
        var wname = String(rr[wCol - 1] == null ? '' : rr[wCol - 1]).trim();
        if (!wname) continue;
        var price = ctx.col[COL_PRICE] ? num(rr[ctx.col[COL_PRICE] - 1]) : 0;
        if (!byWorker[wname]) byWorker[wname] = { name: wname, count: 0, price: 0 };
        byWorker[wname].count++;
        byWorker[wname].price += price;
      }
    }
  } catch (err) {
    out.workerError = String(err);
  }

  var wkeys = Object.keys(byWorker);
  for (var w2 = 0; w2 < wkeys.length; w2++) out.workers.push(byWorker[wkeys[w2]]);
  out.workers.sort(function (a, b) { return b.count - a.count; });

  // ── 資料品質檢查 ──
  // 承包商名稱不一致會讓統計失真，日後做 LINE 群組對應更會直接壞掉。
  // 只提示疑似，**不自動合併**——合併錯了會讓工資統計對到錯的人。
  var groups = {};
  for (var g2 = 0; g2 < wkeys.length; g2++) {
    var base = wkeys[g2].replace(WORKER_SUFFIX_RE, '').replace(/[\s　]+/g, '');
    if (!base) continue;
    if (!groups[base]) groups[base] = [];
    groups[base].push(wkeys[g2]);
  }
  out.quality.workerDupes = [];
  for (var b2 in groups) {
    if (groups[b2].length > 1) out.quality.workerDupes.push(groups[b2]);
  }
  out.quality.unknownCodes = Object.keys(unknownCodes);

  return out;
}

// ────────────────────────────────────────────── ⑤ 查詢

/**
 * 跨表查詢：發包單（業務分頁）＋ 出貨資訊（出貨明細），以發包單號串起來。
 *
 * 刻意不做快取：查詢條件千變萬化，快取命中率低，而全量索引會超過
 * CacheService 的 100KB 上限。查詢是主動行為，等幾秒可以接受——
 * 比自己翻 17 個分頁快得多。
 *
 * 只讀必要欄位，並沿用 pendingOfSheet_ 那套「先用單號欄定出資料邊界」的做法。
 */
/**
 * 讀整張出貨明細，建成索引：{ byNo: {發包單號: [列…]}, loose: [沒有發包單號的列…] }。
 *
 * 每一列都轉成「欄名 → 字串值」的物件，Date 一律經 fmtDate_ 轉 yyyy-MM-dd，
 * 呼叫端不必再處理型別。
 *
 * ⚠ loose 不是「壞資料」：沒有發包單號的出貨約佔一半（料件出貨、截圖下單、
 *   弱電料件、鎖胚、建案整批本來就不走發包單），漏掉它們等於查詢只涵蓋一半。
 *
 * 抽出來的原因：這是整個查詢裡**最貴的一段**（讀整張表），
 * 查詢頁與 Chat 問答都需要，抄第二份就會讀兩次表。
 * 讀失敗回空索引而不是拋錯——查詢頁沿用原本的行為：出貨明細掛掉時
 * 仍然查得到發包單本身，只是看不到出貨資訊。
 */
function buildShipIndex_() {
  var byNo = {}, loose = [];
  try {
    var s = openShipmentSheet_();
    var sLast = s.sheet.getLastRow();
    if (sLast >= 2) {
      var sWidth = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
      var sVals = s.sheet.getRange(2, 1, sLast - 1, sWidth).getValues();
      for (var i = 0; i < sVals.length; i++) {
        var rec = {};
        for (var h = 0; h < SHIPMENT_HEADERS.length; h++) {
          var nm = SHIPMENT_HEADERS[h];
          var c = s.col[nm];
          var v = (c && c <= sVals[i].length) ? sVals[i][c - 1] : '';
          rec[nm] = (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
        }
        rec.row = i + 2;
        var dno = rec[COL_S_DISPATCH];
        if (dno) {
          if (!byNo[dno]) byNo[dno] = [];
          byNo[dno].push(rec);
        } else {
          loose.push(rec);   // 無發包單號的出貨（約一半）
        }
      }
    }
  } catch (err) {
    Logger.log('查詢時讀出貨明細失敗：' + err);
  }
  return { byNo: byNo, loose: loose };
}

function queryOrders_(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return { rows: [], truncated: false };

  var MAX = 50;   // 超過就截斷：查詢頁不是用來一次看完全部的
  var out = [];
  var truncated = false;

  var idx = buildShipIndex_();
  var shipByNo = idx.byNo, shipLoose = idx.loose;

  // 掃業務分頁
  var env = openSheets_();
  for (var k = 0; k < env.list.length && !truncated; k++) {
    var ctx = env.list[k];
    var startRow = ctx.headerRow + 1;
    var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
    if (lastRow < startRow) continue;

    var noCol = ctx.col[COL_ORDER_NO];
    var noVals = ctx.sheet.getRange(startRow, noCol, lastRow - startRow + 1, 1).getValues();
    var lastValid = -1;
    for (var v2 = 0; v2 < noVals.length; v2++) {
      if (ORDER_NO_RE.test(String(noVals[v2][0] || '').trim())) lastValid = v2;
    }
    if (lastValid < 0) continue;

    var width = ctx.lastCol || ctx.sheet.getLastColumn();
    var values = ctx.sheet.getRange(startRow, 1, lastValid + 1, width).getValues();
    var row = null;
    var pick = function (name) {
      var c = ctx.col[name];
      if (!c || c > row.length) return '';
      var vv = row[c - 1];
      return String(vv == null ? '' : vv).trim();
    };

    for (var r = 0; r < values.length; r++) {
      row = values[r];
      var no = pick(COL_ORDER_NO);
      if (!no || !ORDER_NO_RE.test(no)) continue;

      var ships = shipByNo[no] || [];
      // 比對範圍含出貨資訊：查客人姓名或出貨單號也要找得到這一單
      var hay = [no, pick(COL_CUSTOMER), pick(COL_PROJECT), pick(COL_MODEL),
                 pick(COL_WORKER), pick(COL_DISPATCHER)].join(' ');
      for (var sp = 0; sp < ships.length; sp++) {
        hay += ' ' + ships[sp][COL_S_SHIP_NO] + ' ' + ships[sp][COL_S_ORDER_ID] +
               ' ' + ships[sp][COL_S_CUST_NAME] + ' ' + ships[sp][COL_S_CUST_PHONE] +
               ' ' + ships[sp][COL_S_CHANNEL_NO] + ' ' + ships[sp][COL_S_INVOICE_NO];
      }
      if (hay.toLowerCase().indexOf(q) < 0) continue;

      // 師傅通知文字在伺服器端組好，前端只負責複製到剪貼簿。
      // 放在伺服器組的原因：格式要跟現行人工通知一致，而且要保證不含金額——
      // 那個保證放在前端會被前端改動破壞。
      for (var t = 0; t < ships.length; t++) {
        ships[t].techNotice = techNotice_(ships[t], pick(COL_MODEL));
      }

      out.push({
        orderNo: no,
        sheet: ctx.name,
        applyAt: fmtDate_(ctx.col[COL_APPLY_AT] ? row[ctx.col[COL_APPLY_AT] - 1] : ''),
        customer: pick(COL_CUSTOMER),
        project: pick(COL_PROJECT),
        model: pick(COL_MODEL),
        qty: pick(COL_QUOTE_QTY) || pick(COL_QTY),
        worker: pick(COL_WORKER),
        price: fmtMoney_(ctx.col[COL_PRICE] ? row[ctx.col[COL_PRICE] - 1] : ''),
        dispatcher: pick(COL_DISPATCHER),
        sub: ctx.twoStage ? pick(COL_SUB_APPROVAL) : '',
        approval: pick(COL_APPROVAL),
        ships: ships
      });
      if (out.length >= MAX) { truncated = true; break; }
    }
  }

  // 無發包單號的出貨也要查得到（弱電料件、鎖胚、建案整批，約占一半）
  if (!truncated) {
    for (var L = 0; L < shipLoose.length; L++) {
      var sl = shipLoose[L];
      var hay2 = [sl[COL_S_SHIP_NO], sl[COL_S_ORDER_ID], sl[COL_S_CUSTOMER],
                  sl[COL_S_PROJECT], sl[COL_S_CUST_NAME], sl[COL_S_CUST_PHONE],
                  sl[COL_S_CHANNEL_NO], sl[COL_S_ITEMS], sl[COL_S_INVOICE_NO]].join(' ').toLowerCase();
      if (hay2.indexOf(q) < 0) continue;
      sl.techNotice = techNotice_(sl, '');
      out.push({
        orderNo: '', sheet: SHIPMENT_SHEET, applyAt: sl[COL_S_AT],
        customer: sl[COL_S_CUSTOMER], project: sl[COL_S_PROJECT],
        model: '', qty: '', worker: '', price: '', dispatcher: sl[COL_S_ORDER_BY],
        sub: '', approval: '', ships: [sl]
      });
      if (out.length >= MAX) { truncated = true; break; }
    }
  }

  return { rows: out, truncated: truncated };
}

// ═══════════════════════════════════════════ Chat 小幫手問答
//
// 業務在 Chat 裡直接問「8/25 下單給金宏鎖店的案件出貨了嗎？」，不必跳出去開網頁。
//
// 分工鐵則（使用者拍板）：**AI 只負責聽懂問題，查資料與組答案一律由程式碼做。**
// AI 的輸出只會是「查詢條件」，不會是任何數字、日期或狀態文字——
// 那些一律從試算表的值直接取。AI 說錯話的代價是查錯條件（看得出來），
// 不是回報錯誤的出貨狀態（看不出來）。
//
// ⚠ 回覆一律不含金額（進價、售價、承包金額）。Chat 是群組場合，
//   而 runQuery 那套「只有主管看得到進價」的分級在群組裡沒有意義——
//   訊息是貼給整個空間看的，不是貼給發問者一個人。

/**
 * 🔑 一列出貨明細的**誠實狀態**。
 *
 * ⚠ **刻意不輸出「已出貨／未出貨」這種二分答案**，因為系統根本沒有這個資訊：
 *   - 出貨明細沒有貨運單號欄位
 *   - 「出貨日期」是助理人工回填的，不是系統判定
 *   - 「倉庫核單狀態」是**單據**審核，不是貨物離庫
 *   - 真正的依據是貨運單，而貨運單在另一套系統（Supabase），目前兩邊沒有 join
 *
 * 使用者確認過「要看到貨運單才算出貨」。在貨運單串進來之前（見 v2），
 * 這裡能做的只有**如實回報登錄到哪一步**，讓人自己判斷。
 * 給一個聽起來確定的「已出貨」，比說「我不知道」危險得多。
 *
 * @return {code, label}
 */
function shipmentStage_(rec) {
  if (!rec) return { code: 'ordered_only', label: '已下單，但出貨明細還沒有這一筆（助理尚未鍵單）' };

  // 🔑 貨運單號是**唯一可以說「已出貨」的依據**——使用者定義的判準就是「看到貨運單才算」。
  //    它排在最前面：貨都上車了，前面那些登錄狀態就不是重點了。
  var track = String(rec[COL_S_TRACK_NO] || '').trim();
  if (track) {
    var tAt = String(rec[COL_S_TRACK_AT] || '').trim();
    return { code: 'shipped',
             label: '已出貨 🚚 貨運單號 ' + track + (tAt ? '（' + tAt + '）' : '') };
  }

  var wh = String(rec[COL_S_WH_STATUS] || '').trim();
  var shipDate = String(rec[COL_S_SHIP_DATE] || '').trim();
  var shipNo = String(rec[COL_S_SHIP_NO] || '').trim();

  // 有問題排在最前面：這是唯一「需要有人去處理」的狀態，被其他狀態蓋掉就沒人知道。
  if (wh === WH_ISSUE) {
    var why = String(rec[COL_S_WH_NOTE] || '').trim();
    return { code: 'wh_issue', label: '⚠ 倉庫標記有問題' + (why ? '：' + why : '') };
  }
  if (wh === WH_DONE) {
    return { code: 'wh_ok', label: '倉庫單據已核' + (shipDate ? '，出貨日期 ' + shipDate : '') };
  }
  if (shipDate) {
    return { code: 'date_filled', label: '出貨日期填了 ' + shipDate + '（此欄由助理人工回填）' };
  }
  if (shipNo) {
    return { code: 'entered_no_date', label: '已鍵 TipTop 單號 ' + shipNo + '，出貨日期還沒填' };
  }
  return { code: 'entered_no_no', label: '助理已建立這筆，但還沒鍵 TipTop 單號' };
}

/** 每則答案都附這一句。不是禮貌用語，是防止有人把登錄狀態當成實際出貨。 */
var CHAT_SHIP_DISCLAIMER =
  '※ 以上是系統登錄狀態，不是貨運公司的實際出貨紀錄。' +
  '要確認貨真的走了，請看貨運單或問倉庫。';

/** 聽不懂時回這個。列出實際可用的問法，比一句「我聽不懂」有用得多。 */
var CHAT_HELP =
  '我看不懂這個問題 🤔 可以這樣問我：\n' +
  '・「8/25 金宏鎖店的單出貨了嗎」\n' +
  '・「查 LS-260825-01」（發包單號／出貨單號／案件號都可以）\n' +
  '・「我這週下的單」\n\n' +
  '我目前*只能查登錄狀態*，不能查貨運進度、不會給金額、也不能改資料。';

/**
 * 🔑 不打 AI 的快速解析。解得出來就直接用，解不出來才送 Gemini。
 *
 * ⚠ **這支的存在是效能與可用性問題，不是最佳化**：
 *   Chat 的外掛程式有硬性執行時間上限（2026-08-25 實測 38.3 秒被砍），
 *   而 Gemini 正常回應就要 8.6 秒、過載時第一個型號等 37 秒才回 503。
 *   第一次上線就因此整支逾時，使用者在 Chat 裡**完全沒有反應**。
 *
 *   而實際上最常問的「查 LS-260825-01」根本不需要理解語意——
 *   單號有固定格式，正則就解得出來，0 秒、不打網路。
 *   把這類問題擋在 AI 之前，等於把大部分查詢的延遲從 9 秒降到接近 0，
 *   而且 Gemini 掛掉時這些問題照樣答得出來。
 *
 * 只處理**高把握**的情況，模稜兩可的一律交給 AI——這裡猜錯會查到別人的單。
 *
 * @return 條件物件，或 null（表示「我解不出來，請交給 AI」）
 */
function parseChatQuestionFast_(text) {
  var t = String(text || '').trim();
  if (!t) return null;

  // ① 單號：發包單號（XX-YYMMDD-N）、案件號（IW+8碼+4碼）
  var m = t.match(/[A-Za-z]{2}-\d{6}-\d+/);
  if (m) {
    return { intent: 'order_lookup', dateFrom: '', dateTo: '', customer: '',
             orderNo: m[0], person: '', self: false, confidence: 'high', via: 'fast' };
  }
  m = t.match(/\b[A-Za-z]{2}\d{12}\b/);
  if (m) {
    return { intent: 'order_lookup', dateFrom: '', dateTo: '', customer: '',
             orderNo: m[0], person: '', self: false, confidence: 'high', via: 'fast' };
  }

  // ② 純日期問句（「今天的單」「昨天下的單」）。
  //    只認今天／昨天這兩個絕對明確的詞——「這週」牽涉週一是哪天、
  //    「上個月」牽涉月底天數，判斷分歧的成本高於交給 AI。
  //    ⚠ 日期詞**必須**搭配訂單相關字眼才算數：「今天天氣如何」也含「今天」，
  //      少了這個條件就會被當成查詢送去掃分頁（測試抓到過）。
  var today = new Date();
  var day = null;
  if (/單|出貨|案件|訂單/.test(t)) {
    if (/今天|今日/.test(t)) day = today;
    else if (/昨天|昨日/.test(t)) day = new Date(today.getTime() - 86400000);
  }
  if (day) {
    var d = Utilities.formatDate(day, TZ, 'yyyy-MM-dd');
    return { intent: 'ship_status', dateFrom: d, dateTo: d, customer: '',
             orderNo: '', person: '', self: /我(的|下|問)/.test(t),
             confidence: 'high', via: 'fast' };
  }

  return null;   // 其餘交給 AI
}

/**
 * 用 AI 把一句中文問題轉成查詢條件。**這是整條路徑上唯一有 AI 的地方。**
 *
 * ⚠ 今天的日期由程式帶進 prompt，不讓 AI 自己假設——它不知道今天幾號，
 *   一旦自己編一個，「這週」「昨天」全部會算錯，而且錯得很合理、看不出來。
 *
 * ⚠ Prompt 的口吻沿用 recognizeOrderImage：**讀不出來就留空並標 low，不要猜**。
 *   查詢條件猜錯的後果是查到別人的單或查不到，兩種都比留空糟。
 */
function parseChatQuestion_(text) {
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  var schema = {
    type: 'OBJECT',
    properties: {
      intent:     { type: 'STRING' },   // ship_status / order_lookup / unknown
      date_from:  { type: 'STRING' },
      date_to:    { type: 'STRING' },
      customer:   { type: 'STRING' },
      order_no:   { type: 'STRING' },
      person:     { type: 'STRING' },
      self:       { type: 'BOOLEAN' },  // 問的是「我的單」
      confidence: { type: 'STRING' }
    },
    required: ['intent', 'date_from', 'date_to', 'customer', 'order_no',
               'person', 'self', 'confidence']
  };

  var prompt =
    '你是出貨查詢系統的問題解析器。今天是 ' + today + '（台北時間）。\n' +
    '把下面這句話轉成查詢條件的 JSON，欄位如下：\n' +
    '- intent："ship_status"（問某批單的出貨/處理狀態）、"order_lookup"（單純要查某張單）、' +
    '"unknown"（看不懂，或問的是這個系統答不了的事）\n' +
    '- date_from / date_to：yyyy-MM-dd。單一日期時兩者相同。' +
    '「這週」「上週」「這個月」要換算成實際區間。只講月日（如 8/25）就用今年。讀不出日期就兩個都留空字串\n' +
    '- customer：客戶或鎖店名稱，**原文照抄**（例如「金宏鎖店」就寫「金宏鎖店」），不要自己擴寫或補全。沒提到就留空字串\n' +
    '- order_no：發包單號／出貨單號／案件號，有講才填，沒有就留空字串\n' +
    '- person：問句裡指名的業務或助理姓名，沒有就留空字串\n' +
    '- self：問句是在問「我的單」「我下的」時為 true，否則 false\n' +
    '- confidence："high" 或 "low"\n\n' +
    '規則：\n' +
    '1. **讀不出來的欄位一律留空字串，絕對不要猜**。留空我會問清楚，猜錯我會查到錯的單。\n' +
    '2. 沒有任何條件可填（沒日期、沒客戶、沒單號、也不是問自己的單）→ intent 設 "unknown"。\n' +
    '3. 問到金額、毛利、貨運進度、要求修改資料、或跟出貨查詢無關的閒聊 → intent 設 "unknown"。\n\n' +
    '這句話是：\n' + text;

  // 20 秒預算：Chat 外掛約 38 秒被砍，扣掉查詢與組答案的時間，
  // 留給解析的只有這麼多。寧可少試一個模型，也不要整支被砍成零回應。
  var got = callGeminiJson_([{ text: prompt }], schema, 'Chat問答解析',
    { deadlineMs: 20000 });
  if (!got.ok) return { failed: got.reason };

  var p = got.data || {};
  return {
    intent: String(p.intent || 'unknown'),
    dateFrom: String(p.date_from || '').trim(),
    dateTo: String(p.date_to || '').trim(),
    customer: String(p.customer || '').trim(),
    orderNo: String(p.order_no || '').trim(),
    person: String(p.person || '').trim(),
    self: p.self === true,
    confidence: (p.confidence === 'low') ? 'low' : 'high'
  };
}

/**
 * 依結構化條件查單。**與 queryOrders_ 刻意分開，不是重複實作。**
 *
 * queryOrders_ 服務查詢頁，契約是「單一關鍵字、任一欄命中、50 筆」；
 * 這裡要的是「多條件 AND ＋ 日期區間 ＋ 10 筆」。兩者的比對語意相衝
 * （前者 OR、後者 AND），硬擠進同一支會讓查詢頁的行為隨 Chat 的需求漂移。
 * 共用最貴的那一段（buildShipIndex_，讀整張出貨明細）就夠了。
 *
 * ⚠ 上限 10 筆不是效能考量而是**可讀性**：Chat 訊息塞不下 50 筆，
 *   硬塞只會變成沒人看的一大坨。超過就明說「還有更多，請用查詢頁」。
 */
function chatQueryOrders_(f) {
  var MAX = 10;
  var out = [], truncated = false;
  var nearMiss = 0, nearLatest = '';   // 日期以外都符合的筆數／其中最近的一筆
  var idx = buildShipIndex_();

  var wantCust = String(f.customer || '').toLowerCase();
  var wantNo = String(f.orderNo || '').toLowerCase();
  var wantPerson = String(f.person || '').toLowerCase();

  // 日期比對用字串：欄位已經過 fmtDate_ 轉成 yyyy-MM-dd，字串比大小就等於日期比大小。
  var from = f.dateFrom || '', to = f.dateTo || '';
  var inRange = function (d) {
    d = String(d || '').slice(0, 10);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  var env = openSheets_();
  for (var k = 0; k < env.list.length && !truncated; k++) {
    var ctx = env.list[k];
    var startRow = ctx.headerRow + 1;
    var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
    if (lastRow < startRow) continue;

    var width = ctx.lastCol || ctx.sheet.getLastColumn();
    var values = ctx.sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();

    for (var r = 0; r < values.length && !truncated; r++) {
      var row = values[r];
      var pick = function (name) {
        var c = ctx.col[name];
        if (!c || c > row.length) return '';
        var v = row[c - 1];
        return (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
      };

      var no = pick(COL_ORDER_NO);
      if (!ORDER_NO_RE.test(no)) continue;

      var cust = pick(COL_CUSTOMER);
      var applyAt = pick(COL_APPLY_AT);
      var by = pick(COL_DISPATCHER);
      var ships = idx.byNo[no] || [];

      // 條件是 AND：每一個有值的條件都必須成立。
      if (wantNo) {
        var hitNo = no.toLowerCase().indexOf(wantNo) >= 0;
        if (!hitNo) {
          for (var s1 = 0; s1 < ships.length && !hitNo; s1++) {
            var sn = String(ships[s1][COL_S_SHIP_NO] || '').toLowerCase();
            var cn = String(ships[s1][COL_S_CASE_NO] || '').toLowerCase();
            if ((sn && sn.indexOf(wantNo) >= 0) || (cn && cn.indexOf(wantNo) >= 0)) hitNo = true;
          }
        }
        if (!hitNo) continue;
      }
      if (wantCust && cust.toLowerCase().indexOf(wantCust) < 0 &&
          ctx.name.toLowerCase().indexOf(wantCust) < 0) continue;
      if (wantPerson && by.toLowerCase().indexOf(wantPerson) < 0 &&
          ctx.name.toLowerCase().indexOf(wantPerson) < 0) continue;

      // 🔑 日期以外的條件都過了才記進 nearMiss。
      //   實測踩過：問「8 月金宏的單」回「我找不到」，但金宏其實有 3 筆、
      //   只是都在 2~3 月。那句回覆技術上正確卻毫無幫助，害人以為單不存在。
      //   記下「差一點就中」的筆數與最近日期，查無時就能講出有用的話。
      if (from || to) {
        nearMiss++;
        if (applyAt && applyAt > nearLatest) nearLatest = applyAt;
        if (!inRange(applyAt)) continue;
      }

      out.push({
        no: no, sheet: ctx.name, customer: cust, at: applyAt,
        model: pick(COL_MODEL), qty: pick(COL_QUOTE_QTY),
        by: by, approval: pick(COL_APPROVAL), ships: ships
      });
      if (out.length >= MAX) truncated = true;
    }
  }

  return { rows: out, truncated: truncated,
           nearMiss: nearMiss, nearLatest: nearLatest };
}

// ═══════════════════════════════════════════ 貨運單辨識（階段 0：驗證）
//
// 目標是讓「出貨了嗎」真的答得出來——使用者定義的判準是「看到貨運單才算」。
//
// 🔴 這一段目前**只有驗證工具，還沒有正式功能**。理由：有兩個假設沒被驗證過，
//    而今天早上才因為「猜 Gemini 的能力」付出過代價（猜模型名稱猜錯三次，
//    每次辨識白等 9 秒）：
//      ① Gemini 讀不讀得了 PDF？現有的 QUICK_IMG_MIME_OK 只允許 jpeg/png/webp
//      ② 一份 20+ 列的貨運清單，它認得準嗎？截圖下單只有 1~3 個品項，
//         多列表格是 AI 最容易漏行、串行的情境
//    先用真實檔案測過、人工比對正確率，合格才往下做。

/**
 * 貨運單辨識的回應結構。
 *
 * `total` 是**讓 AI 自己報總列數**，用來偵測它有沒有偷偷截斷——
 * 自報 21 筆卻只回 15 筆，這種錯用眼睛很難發現。
 *
 * 除了 order_no 之外還要 phone／note／recipient，是因為 2026-08-24 的真實樣本顯示
 * **訂單編號欄整份都是空的**（與 sql/supabase_shipments.sql:14 的記載一致）。
 * 那三欄是「倉庫還沒開始填訂單編號」期間唯一能拿來配對的線索：
 * 收件人與電話對得上出貨明細的「貨指寄-收件人／電話」，
 * 備註對得上「出貨備註」（真實樣本：「MOMO-許嘉程/陳建棠L901」）。
 */
var SHIPDOC_SCHEMA = {
  type: 'OBJECT',
  properties: {
    carrier: { type: 'STRING' },
    doc_date: { type: 'STRING' },
    total: { type: 'NUMBER' },
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          order_no: { type: 'STRING' },
          tracking_no: { type: 'STRING' },
          ship_date: { type: 'STRING' },
          recipient: { type: 'STRING' },
          phone: { type: 'STRING' },
          note: { type: 'STRING' }
        },
        required: ['order_no', 'tracking_no', 'ship_date', 'recipient', 'phone', 'note']
      }
    }
  },
  required: ['carrier', 'doc_date', 'total', 'rows']
};

/**
 * ⚠ 這個 prompt 是**針對「PDF 轉出來的純文字」**寫的，不是針對 PDF 本身。
 *   2026-08-25 實測：直接把 290KB 的 PDF 餵給 Gemini，三個模型全部 503（各等 18~32 秒），
 *   但同一時間純文字請求 2.2 秒就回 200 —— 所以改成先用 Drive 轉文字（3.8 秒）再解析。
 *
 * ⚠ 轉出來的文字有**換行造成的欄位黏連**（真實樣本：電話 `0972-809-` 換行後
 *   跟下一欄的 `11` 黏成 `02811`）。這正是用 LLM 而不是正則的理由——
 *   版面亂但語意清楚的東西，LLM 比座標式解析穩。
 */
var SHIPDOC_PROMPT =
  '以下是一份貨運公司託運總表（新竹物流或嘉里大榮）的 PDF 轉出來的純文字，' +
  '**一份文件裡含多筆託運紀錄**，而且可能分成好幾個「客代」區段。\n\n' +
  '請輸出 JSON：\n' +
  '- carrier：貨運公司名稱\n' +
  '- doc_date：這份表的發送日期，格式 yyyy-MM-dd\n' +
  '- total：整份文件**總共幾筆**託運紀錄。文件結尾通常有「全合計：N 筆」，' +
  '**以那個數字為準**；沒有的話自己數。\n' +
  '- rows：每一筆一個物件：\n' +
  '  · tracking_no：查貨號碼／託運單號（例如 345-827-1434）\n' +
  '  · order_no：該列「訂單編號」欄的值。**這一欄實務上經常整份都是空的**，' +
  '空的就留空字串，不要拿備註或其他欄位的值來填\n' +
  '  · recipient：收貨人代號-名稱（例如「金宏鎖店 王啟尚收」）\n' +
  '  · phone：收件電話。⚠ 文字是從 PDF 轉出來的，電話**可能被換行切斷並黏到隔壁欄**' +
  '（例如 `0972-809-` 換行後接 `02811`，其中 `11` 其實是別欄的）。' +
  '盡量還原成合理的電話號碼，還原不了就留空字串\n' +
  '  · note：內容品／備註欄的文字（例如「MOMO-許嘉程/陳建棠L901」「案名：…」）\n' +
  '  · ship_date：該列的指配日期，格式 yyyy-MM-dd，沒有就留空字串\n\n' +
  '規則：\n' +
  '1. **一筆都不能漏**，rows 的筆數要等於 total。漏一筆＝那張單永遠查不到貨運單號。\n' +
  '2. **絕對不要把不同列的資料湊在一起**。某欄讀不清楚就留空字串，' +
  '不要拿隔壁列的值來補——寧可空著讓人補，也不要給一個看起來對的錯值。\n' +
  '3. 「合計：N 筆」「客戶簽收」「印表日期」這些是表格的頁首頁尾，**不是託運紀錄**，不要當成一筆。\n\n' +
  '文件內容如下：\n';

// ── 貨運單佇列與配對 ────────────────────────────────────────

var SHIPDOC_FOLDER_PROP = 'DISPATCH_SHIPDOC_FOLDER_ID';
var SHIPDOC_SHEET = '貨運單處理';
var SHIPDOC_HEAD = ['上傳時間', '檔名', '檔案ID', '上傳人', '狀態',
                    '處理時間', '總筆數', '已配對', '待指定', '訊息'];
var SHIPDOC_PENDING = '待辨識';
var SHIPDOC_DONE = '已處理';
var SHIPDOC_FAIL = '失敗';

// 對不到或模稜兩可的託運紀錄放這裡，等人工指定對應哪張出貨單。
var SHIPWAIT_SHEET = '貨運單待指定';
var SHIPWAIT_HEAD = ['貨運單號', '貨運日期', '收件人', '電話', '備註',
                     '來源檔案', '候選出貨單號', '對應出貨單號', '處理狀態'];

/** 開（必要時建立）一個分頁並回傳 {sheet, col}，表頭以文字定位。 */
function openAuxSheet_(name, head) {
  var id = PropertiesService.getScriptProperties().getProperty('DISPATCH_SHEET_ID');
  if (!id) throw new Error('未設定指令碼屬性 DISPATCH_SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(head);
    sheet.setFrozenRows(1);
  }
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var i = 0; i < row.length; i++) {
    var k = normHeader_(row[i]);
    if (k && !col[k]) col[k] = i + 1;
  }
  // 缺欄補在表尾，不插中間（同 openShipmentSheet_ 的理由：插入會讓既有資料位移）
  var missing = [];
  for (var m = 0; m < head.length; m++) {
    if (col[normHeader_(head[m])] === undefined) missing.push(head[m]);
  }
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    for (var k2 = 0; k2 < missing.length; k2++) col[normHeader_(missing[k2])] = lastCol + 1 + k2;
  }
  return { ss: ss, sheet: sheet, col: col };
}

/**
 * 比對用的正規化：去掉所有空白、全形轉半形、英文轉大寫。
 *
 * ⚠ 既有的 shipment-worker/matching.py:172-176 只做 `strip()==` 完全比對，沒有容錯——
 *   格式差一個空白就靜默比不中，而症狀是「這張單永遠沒有貨運單號」。
 *   不要重蹈那個覆轍。
 */
function normKey_(s) {
  s = String(s == null ? '' : s);
  // 全形英數與全形空白 → 半形
  s = s.replace(/[！-～]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  }).replace(/　/g, ' ');
  return s.replace(/[\s\-_()（）]/g, '').toUpperCase();
}

/**
 * 把一筆託運紀錄配對到出貨明細的某一列。
 *
 * 🔑 **只回唯一命中**。真實樣本裡同一天有兩筆寄給「金宏鎖店 王啟尚」
 *   （345-844-9396 與 345-868-9312），光靠收件人分不出來——
 *   猜錯的話兩張單的貨運單號會對調，而且**看起來完全正常、沒有人會發現**。
 *   所以模稜兩可一律不猜，回傳候選讓人指定。
 *
 * 比對優先序（前面命中就不往下走）：
 *   ① 訂單編號 → 出貨單號：乾淨的鍵。**但實測整份都是空的**，
 *      要等倉庫在貨運系統開始填才會生效；程式先寫好，填了就自動生效。
 *   ② 出貨備註：真實樣本的備註長這樣「MOMO-許嘉程/陳建棠L901」，
 *      對得上出貨明細的「出貨備註」，鑑別度高。
 *   ③ 收件人＋電話：最後手段，也最容易撞號。
 *
 * @return {row, by} 唯一命中；或 {row:0, by:'', candidates:[出貨單號…]}
 */
function matchShipRow_(rec, index) {
  var on = normKey_(rec.order_no);
  if (on && index.byShipNo[on] && index.byShipNo[on].length === 1) {
    return { row: index.byShipNo[on][0], by: '訂單編號' };
  }

  var note = normKey_(rec.note);
  if (note && note.length >= 4 && index.byNote[note] && index.byNote[note].length === 1) {
    return { row: index.byNote[note][0], by: '出貨備註' };
  }

  var name = normKey_(rec.recipient), phone = normKey_(rec.phone);
  var hits = [];
  if (name) {
    var byName = index.byName[name] || [];
    for (var i = 0; i < byName.length; i++) {
      var e = byName[i];
      // 有電話就必須也對得上；沒電話就只靠名字（鑑別度低，只有唯一時才算數）
      if (phone && e.phone && normKey_(e.phone) !== phone) continue;
      hits.push(e);
    }
  }
  if (hits.length === 1) return { row: hits[0].row, by: phone ? '收件人＋電話' : '收件人' };

  var cands = [];
  for (var j = 0; j < hits.length; j++) cands.push(hits[j].shipNo || ('第' + hits[j].row + '列'));
  return { row: 0, by: '', candidates: cands };
}

/** 建出貨明細的配對索引：出貨單號 / 出貨備註 / 收件人 三種鍵。 */
function buildMatchIndex_() {
  var s = openShipmentSheet_();
  var idx = { byShipNo: {}, byNote: {}, byName: {} };
  var last = s.sheet.getLastRow();
  if (last < 2) return idx;

  var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
  var vals = s.sheet.getRange(2, 1, last - 1, width).getValues();
  var get = function (row, name) {
    var c = s.col[normHeader_(name)];
    if (!c || c > row.length) return '';
    var v = row[c - 1];
    return (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
  };

  for (var i = 0; i < vals.length; i++) {
    var row = vals[i], rowNo = i + 2;
    var shipNo = get(row, COL_S_SHIP_NO);
    // 已經有貨運單號的略過——不覆蓋已填的值，重跑同一份檔案不會改壞東西
    if (get(row, COL_S_TRACK_NO)) continue;

    var k1 = normKey_(shipNo);
    if (k1) { (idx.byShipNo[k1] = idx.byShipNo[k1] || []).push(rowNo); }

    var k2 = normKey_(get(row, COL_S_NOTE));
    if (k2 && k2.length >= 4) { (idx.byNote[k2] = idx.byNote[k2] || []).push(rowNo); }

    var k3 = normKey_(get(row, COL_S_TO_NAME));
    if (k3) {
      (idx.byName[k3] = idx.byName[k3] || []).push({
        row: rowNo, phone: get(row, COL_S_TO_PHONE), shipNo: shipNo
      });
    }
  }
  return idx;
}

/**
 * 取一份貨運單 PDF：有給 fileId 就用它，沒給就抓 SHIPMENT_FOLDER_ID 資料夾裡最新的一份。
 *
 * ⚠ 「沒給就自動找」不是方便功能，是**必要的**：Apps Script 編輯器直接執行函式
 *   時無法傳參數，沒有這個退路，所有診斷工具都得先改程式碼才能跑一次。
 *
 * @return DriveApp File，或 null（已把原因印進 Logger）
 */
function shipDocFile_(fileId) {
  try {
    if (fileId) return DriveApp.getFileById(fileId);

    var folderId = PropertiesService.getScriptProperties()
      .getProperty('SHIPMENT_FOLDER_ID');
    if (!folderId) {
      Logger.log('❌ 沒給 fileId，指令碼屬性 SHIPMENT_FOLDER_ID 也沒設定。');
      Logger.log('　 要嘛設定該屬性（Drive「貨運單」資料夾 ID），');
      Logger.log('　 要嘛在程式碼裡改成帶參數呼叫，例如 testPdfToText("檔案ID")。');
      return null;
    }
    var it = DriveApp.getFolderById(folderId).getFilesByType('application/pdf');
    var newest = null;
    while (it.hasNext()) {
      var f = it.next();
      if (!newest || f.getDateCreated() > newest.getDateCreated()) newest = f;
    }
    if (!newest) { Logger.log('❌ 資料夾裡沒有 PDF。'); return null; }
    return newest;
  } catch (err) {
    Logger.log('❌ 開檔失敗：' + err);
    return null;
  }
}

/**
 * 把 PDF 轉成純文字（靠 Google Drive 的轉檔能力）。
 *
 * 做法：Drive API 把 PDF 複製成 Google 文件（這一步會做文字抽取／OCR）
 *      → 匯出成 text/plain → 刪掉暫存文件。
 *
 * ⚠ **為什麼不直接把 PDF 餵給 Gemini**：2026-08-25 實測，290 KB 的新竹託運明細
 *   讓三個模型全部回 503（各花 18~32 秒），但**同一時間純文字請求 2.2 秒就回 200**。
 *   所以不是 Gemini 在忙，是它處理不了那個請求。純文字路徑又快又穩，
 *   先轉成文字再解析比硬塞 PDF 划算得多（實測差距是 10 倍）。
 *
 * ⚠ **刻意用 UrlFetchApp 打 Drive REST，不開進階 Drive 服務**：
 *   開進階服務要改 appsscript.json，而那份檔案同時是 Chat 外掛的 manifest，
 *   動它可能導致全體使用者要重新授權——風險與收益不成比例。
 *   這裡用的 OAuth token 來自既有的 drive 權限（uploadInvoice 本來就在用 DriveApp）。
 *
 * @return {ok, text, chars} 或 {ok:false, message}
 */
function pdfToText_(fileId) {
  var token = ScriptApp.getOAuthToken();
  var hdr = { Authorization: 'Bearer ' + token };
  var tempId = '';

  try {
    // ① 複製成 Google 文件（轉檔就發生在這一步）
    var copyResp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId +
        '/copy?supportsAllDrives=true',
      {
        method: 'post',
        contentType: 'application/json',
        headers: hdr,
        payload: JSON.stringify({
          name: 'temp-pdf2text-' + Date.now(),
          mimeType: 'application/vnd.google-apps.document'
        }),
        muteHttpExceptions: true
      });
    if (copyResp.getResponseCode() >= 300) {
      return { ok: false, message: 'PDF 轉文件失敗（HTTP ' + copyResp.getResponseCode() +
        '）：' + copyResp.getContentText().slice(0, 300) };
    }
    tempId = JSON.parse(copyResp.getContentText()).id;

    // ② 匯出純文字
    var expResp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + tempId +
        '/export?mimeType=text/plain',
      { headers: hdr, muteHttpExceptions: true });
    if (expResp.getResponseCode() >= 300) {
      return { ok: false, message: '匯出文字失敗（HTTP ' + expResp.getResponseCode() +
        '）：' + expResp.getContentText().slice(0, 300) };
    }
    var text = expResp.getContentText();
    return { ok: true, text: text, chars: text.length };

  } catch (err) {
    return { ok: false, message: '轉檔例外：' + err };
  } finally {
    // ③ 一定要刪暫存檔，否則每跑一次就在雲端硬碟留一份垃圾
    if (tempId) {
      try {
        UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + tempId +
          '?supportsAllDrives=true',
          { method: 'delete', headers: hdr, muteHttpExceptions: true });
      } catch (e) {
        Logger.log('⚠ 暫存文件 ' + tempId + ' 刪除失敗，請手動清理：' + e);
      }
    }
  }
}

/**
 * 【階段 0 驗證工具 B】測「PDF → 文字」這條路走不走得通、抽出來的表格好不好讀。
 *
 * 不呼叫 Gemini、不寫入任何資料，只把抽出來的文字印出來讓人判斷。
 * 要看的是：**表格結構有沒有活下來**——欄位還分得出來，還是全部黏成一團。
 */
function testPdfToText(fileId) {
  var file = shipDocFile_(fileId);
  if (!file) return;

  Logger.log('檔案：' + file.getName() + '　' +
    Math.round(file.getSize() / 1024) + ' KB');
  Logger.log('');

  var t0 = Date.now();
  var r = pdfToText_(file.getId());
  var secs = Math.round((Date.now() - t0) / 100) / 10;

  if (!r.ok) {
    Logger.log('❌ ' + r.message + '（耗時 ' + secs + ' 秒）');
    return;
  }

  Logger.log('✅ 轉出 ' + r.chars + ' 個字，耗時 ' + secs + ' 秒');
  Logger.log('');
  Logger.log('── 前 3000 字（看表格結構有沒有活下來）──');
  Logger.log(r.text.slice(0, 3000));
  if (r.chars > 3000) Logger.log('…（還有 ' + (r.chars - 3000) + ' 字）');
  Logger.log('');
  Logger.log('── 判讀 ──');
  if (r.chars < 100) {
    Logger.log('🔴 幾乎沒抽到文字 → 這份 PDF 可能是掃描影像，需要 OCR 或改走圖片路線。');
  } else {
    Logger.log('👉 請看上面的內容：欄位（出貨單號／託運單號／收件人）還分得出來嗎？');
    Logger.log('　 分得出來 → 下一步把這段文字餵給 Gemini 解析（純文字實測 2.2 秒）');
    Logger.log('　 黏成一團 → 改走「PDF 轉圖片」或回頭用 shipment-worker/parsers.py');
  }
}

/**
 * 【診斷】Gemini 現在到底能不能用？用**最小的純文字請求**逐一測每個模型。
 *
 * ⚠ 存在的理由：2026-08-25 下午測貨運單 PDF，三個模型全部回 503。
 *   但 503 是「服務忙碌」不是「不支援這種檔案」（後者會回 400 INVALID_ARGUMENT），
 *   所以那個結果**無法分辨**是「Gemini 整個在忙」還是「它不吃 PDF」。
 *   這支用最小的文字請求打同一批模型：
 *     文字成功、PDF 失敗 → 問題出在 PDF（或檔案大小）
 *     文字也失敗         → Gemini 當下就是不能用，跟 PDF 無關，等一下再測
 *   不先分清楚就改設計，很可能是在解一個不存在的問題。
 */
function testGeminiHealth() {
  var key = PropertiesService.getScriptProperties().getProperty(GEMINI_KEY_PROP);
  if (!key) { Logger.log('❌ 未設定 ' + GEMINI_KEY_PROP); return; }

  Logger.log('用最小的純文字請求逐一測 ' + GEMINI_MODELS.length + ' 個模型：');
  Logger.log('');
  var anyOk = false;

  for (var i = 0; i < GEMINI_MODELS.length; i++) {
    var model = GEMINI_MODELS[i];
    var t0 = Date.now();
    var resp, code, body = '';
    try {
      resp = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model +
          ':generateContent?key=' + key,
        {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            contents: [{ parts: [{ text: '回一個字：好' }] }]
          }),
          muteHttpExceptions: true
        });
      code = resp.getResponseCode();
      body = resp.getContentText();
    } catch (err) {
      code = 0; body = String(err);
    }
    var secs = Math.round((Date.now() - t0) / 100) / 10;
    if (code >= 200 && code < 300) {
      anyOk = true;
      Logger.log('  ✅ ' + model + '　HTTP ' + code + '　' + secs + ' 秒');
    } else {
      var msg = '';
      try { msg = (JSON.parse(body).error || {}).message || ''; } catch (e) { msg = body.slice(0, 120); }
      Logger.log('  ❌ ' + model + '　HTTP ' + code + '　' + secs + ' 秒　' + msg);
    }
  }

  Logger.log('');
  Logger.log('── 判讀 ──');
  if (anyOk) {
    Logger.log('✅ Gemini 本身可用（純文字打得通）。');
    Logger.log('　 那麼貨運單 PDF 失敗就**不是 Gemini 在忙**，問題出在那個請求本身');
    Logger.log('　 （檔案型別不支援、檔案太大、或處理逾時被回成 503）。');
    Logger.log('　 下一步：改用圖片試，或把 PDF 縮小／只取第一頁。');
  } else {
    Logger.log('🔴 純文字也全部失敗 → Gemini 當下整個不能用，跟 PDF 無關。');
    Logger.log('　 隔一段時間再跑一次；若持續整天失敗，要查 API 金鑰的配額或帳單狀態。');
  }
  Logger.log('');
  Logger.log('（純文字請求極小，若連它都要等十幾秒才回，本身就是異常訊號。）');
}

/**
 * 貨運單上傳畫面。**極簡＋手機優先**：倉庫是站在現場操作，
 * 一個選檔、一顆送出就夠，多一個欄位都是負擔。
 */
function shipDocBlock_(email) {
  var head =
    '<div class="hd"><div class="ic">🚚</div><div><h1>貨運單</h1><p>' +
    esc_(email) + '</p></div></div>' +
    '<div id="msg"></div>';

  var card =
    '<div class="card">' +
      '<div class="ometa"><b>上傳託運總表</b><span>新竹物流／嘉里大榮的 PDF 都可以</span></div>' +
      '<div class="note" style="margin-bottom:10px">' +
        '一份檔案裡有好幾張出貨單沒關係，系統會自動拆開，' +
        '把貨運單號填回對應的出貨明細。</div>' +
      '<input type="file" id="sdf" accept=".pdf,.jpg,.jpeg,.png">' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="ok big" id="sdb" onclick="return false;">📤 上傳</button>' +
      '</div>' +
    '</div>';

  var footer = '<div class="note">' +
    '上傳後系統會在幾分鐘內辨識完成，不必留在這一頁等。<br>' +
    '對不上的會列進「貨運單待指定」分頁，由人工指定對應哪張出貨單——' +
    '<b>系統不會用猜的</b>，因為猜錯的貨運單號看起來完全正常。</div>';

  // 沿用發票上傳同一套：google.script.run 傳不了 File 物件，要先讀成 base64 再送
  var script = '<script>' +
    '(function(){' +
    'function g(id){return document.getElementById(id);}' +
    'function show(t,c){g("msg").innerHTML=\'<div class="msg \'+c+\'">\'+t.replace(/\\n/g,"<br>")+\'</div>\';window.scrollTo(0,0);}' +
    'g("sdb").onclick=function(){' +
      'var f=g("sdf").files&&g("sdf").files[0];' +
      'if(!f){show("請先選擇檔案","fail");return;}' +
      'var b=g("sdb");var old=b.textContent;b.disabled=true;b.textContent="上傳中…";' +
      'var rd=new FileReader();' +
      'rd.onload=function(){' +
        'var s=String(rd.result);var i=s.indexOf(",");' +
        'google.script.run' +
          '.withSuccessHandler(function(res){b.disabled=false;b.textContent=old;' +
            'if(res.ok){show(res.message,"done");g("sdf").value="";}' +
            'else{show(res.message,"fail");}})' +
          '.withFailureHandler(function(e){b.disabled=false;b.textContent=old;' +
            'show("連線失敗："+e.message,"fail");})' +
          '.uploadShippingDoc(f.name,f.type,s.slice(i+1));' +
      '};' +
      'rd.onerror=function(){b.disabled=false;b.textContent=old;show("檔案讀取失敗","fail");};' +
      'rd.readAsDataURL(f);' +
    '};' +
    '})();' +
    '</script>';

  return head + card + footer + script;
}

/**
 * 倉庫上傳貨運單（託運總表）。**只存檔並排隊，不當場辨識。**
 *
 * ⚠ 為什麼不當場辨識：實測整份流程要 38.6 秒（轉文字 3.5 + Gemini 解析 35.1）。
 *   倉庫在現場用手機，盯著轉圈半分鐘不可接受，切換 app 還可能中斷。
 *   所以這裡秒回「收到了」，辨識交給時間觸發器（processShipDocQueue）。
 *
 * @return {ok, message}
 */
function uploadShippingDoc(fileName, mimeType, base64) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分，未上傳。' };
  return uploadShippingDocAs_(email, fileName, mimeType, base64);
}

/**
 * 上傳的核心（身分由呼叫端給）。
 *
 * ⚠ 權限閘門放這裡**不是放在薄殼**，比照 submitWarehouseAs_ 的做法：
 *   將來若從別的入口呼叫（Chat、觸發器），閘門自動跟著走。
 *   uploadInvoice 就是因為身分綁死 currentUserEmail_() 而無法被別的入口複用。
 */
function uploadShippingDocAs_(email, fileName, mimeType, base64) {
  var roles = rolesFor_(email);
  if (!roles.warehouse) {
    return { ok: false, message: '您（' + email + '）不在倉庫名單中（指令碼屬性 DISPATCH_WAREHOUSE），無法上傳貨運單。' };
  }
  if (!INVOICE_MIME_OK[mimeType]) {
    return { ok: false, message: '只接受 PDF 或圖片，收到的是「' + mimeType + '」。' };
  }
  if (!base64) return { ok: false, message: '沒有收到檔案內容，請重新選擇。' };

  var bytes;
  try { bytes = Utilities.base64Decode(base64); }
  catch (e) { return { ok: false, message: '檔案內容解不開，請重新選擇。' }; }
  if (bytes.length > INVOICE_MAX_BYTES) {
    return { ok: false, message: '檔案 ' + Math.round(bytes.length / 1048576) +
      ' MB 超過上限 ' + (INVOICE_MAX_BYTES / 1048576) + ' MB。' };
  }

  var folderId = shipDocFolderId_();
  if (!folderId) {
    return { ok: false, message: '未設定指令碼屬性 ' + SHIPDOC_FOLDER_PROP +
      '（或 SHIPMENT_FOLDER_ID）——不知道要把貨運單存到哪個 Drive 資料夾。' };
  }

  var file;
  try {
    var folder = DriveApp.getFolderById(folderId);
    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');
    // 不呼叫 setSharing：權限完全由該資料夾決定（同 uploadInvoice 的原則）
    file = folder.createFile(Utilities.newBlob(bytes, mimeType,
      stamp + '_' + (fileName || 'shipping.pdf')));
  } catch (err) {
    return { ok: false, message: '存進 Drive 失敗：' + err };
  }

  try {
    var q = openAuxSheet_(SHIPDOC_SHEET, SHIPDOC_HEAD);
    var rec = {};
    rec[normHeader_('上傳時間')] = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    rec[normHeader_('檔名')] = file.getName();
    rec[normHeader_('檔案ID')] = file.getId();
    rec[normHeader_('上傳人')] = email;
    rec[normHeader_('狀態')] = SHIPDOC_PENDING;
    var line = [];
    for (var h = 0; h < SHIPDOC_HEAD.length; h++) {
      line.push(rec[normHeader_(SHIPDOC_HEAD[h])] || '');
    }
    q.sheet.appendRow(line);
  } catch (err2) {
    // 檔案已經存進 Drive 了，排隊失敗要明說——不然使用者以為成功、系統卻永遠不會處理
    return { ok: false, message: '檔案已存進 Drive，但排隊失敗：' + err2 +
      '　請告知管理員，檔名 ' + file.getName() };
  }

  return { ok: true, message: '收到了 ✅ ' + file.getName() +
    '\n辨識需要約 40 秒，完成後會把貨運單號自動填回出貨明細。你可以直接離開這一頁。' };
}

/**
 * 【時間觸發器】處理佇列裡待辨識的貨運單。建議每 5 分鐘跑一次。
 *
 * ⚠ 一次只處理一份：單份實測 38.6 秒，GAS 觸發器有執行時間上限，
 *   一次吃多份會在中途被砍，而且被砍的那份狀態會卡在「待辨識」與「已處理」之間。
 *   寧可下一輪再處理，也不要處理到一半。
 */
function processShipDocQueue() {
  var q;
  try { q = openAuxSheet_(SHIPDOC_SHEET, SHIPDOC_HEAD); }
  catch (err) { Logger.log('❌ 開佇列失敗：' + err); return; }

  // 🔑 先把「直接丟進 Drive 資料夾」的檔案收進佇列。
  //
  // ⚠ 這條路不是備案，是**主要路徑之一**：倉庫用手機的 Drive app 丟檔比開網頁快，
  //   而且既有的貨運單管線（gas-shipment-intake.gs）本來就是掃資料夾的，
  //   使用者理所當然會這樣預期。2026-08-25 實測就是這樣踩到的——
  //   檔案丟進資料夾了，佇列卻說是空的，看起來像功能壞掉。
  var found = enqueueFolderShipDocs_(q);
  if (found) Logger.log('從 Drive 資料夾收進 ' + found + ' 份新檔案。');

  var last = q.sheet.getLastRow();
  if (last < 2) {
    // 訊息要講清楚「所以現在該做什麼」——只說「空的」會讓人以為是壞了。
    Logger.log('佇列裡沒有任何檔案，Drive 資料夾裡也沒有沒處理過的 PDF。');
    Logger.log('');
    Logger.log('兩種放檔案的方式都可以：');
    Logger.log('  ① 直接把 PDF 丟進 Drive 的貨運單資料夾（手機的 Drive app 也行）');
    Logger.log('  ② 開網頁 →「🚚 貨運單」頁籤 → 選檔上傳');
    Logger.log('');
    Logger.log('設定對不對？執行 checkShipDocSetup()。');
    return;
  }

  var cStatus = q.col[normHeader_('狀態')];
  var cFile = q.col[normHeader_('檔案ID')];
  var vals = q.sheet.getRange(2, 1, last - 1, q.sheet.getLastColumn()).getValues();

  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][cStatus - 1] || '').trim() !== SHIPDOC_PENDING) continue;
    var row = i + 2;
    var fileId = String(vals[i][cFile - 1] || '').trim();
    Logger.log('處理第 ' + row + ' 列，檔案 ' + fileId);
    var r = processOneShipDoc_(fileId);
    q.sheet.getRange(row, cStatus).setValue(r.ok ? SHIPDOC_DONE : SHIPDOC_FAIL);
    q.sheet.getRange(row, q.col[normHeader_('處理時間')])
      .setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    q.sheet.getRange(row, q.col[normHeader_('總筆數')]).setValue(r.total || 0);
    q.sheet.getRange(row, q.col[normHeader_('已配對')]).setValue(r.matched || 0);
    q.sheet.getRange(row, q.col[normHeader_('待指定')]).setValue(r.pending || 0);
    q.sheet.getRange(row, q.col[normHeader_('訊息')]).setValue(r.message || '');
    Logger.log(r.message);
    return;   // 一次只做一份
  }
  Logger.log('沒有待辨識的檔案。');
}

/**
 * 貨運單資料夾 ID。優先用本功能專屬的屬性；沒設就沿用既有貨運單管線那顆。
 *
 * ⚠ 沿用 SHIPMENT_FOLDER_ID 是刻意的：使用者本來就把貨運單丟在那個資料夾，
 *   要求他們為了新功能再開一顆、再改習慣，只會讓「檔案丟了卻沒反應」更常發生。
 */
function shipDocFolderId_() {
  var props = PropertiesService.getScriptProperties();
  return String(props.getProperty(SHIPDOC_FOLDER_PROP) ||
                props.getProperty('SHIPMENT_FOLDER_ID') || '').trim();
}

/**
 * 掃 Drive 資料夾，把還沒進佇列的 PDF 收進來。回傳新增了幾份。
 *
 * 用**檔案 ID** 判斷有沒有處理過，不是檔名——檔名會重複（每天都叫「託運明細」），
 * 用檔名比對會漏掉真正的新檔案，而症狀是「這份怎麼都不處理」。
 */
function enqueueFolderShipDocs_(q) {
  var folderId = shipDocFolderId_();
  if (!folderId) return 0;

  var known = {};
  var last = q.sheet.getLastRow();
  var cFile = q.col[normHeader_('檔案ID')];
  if (last >= 2) {
    var ids = q.sheet.getRange(2, cFile, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var v = String(ids[i][0] || '').trim();
      if (v) known[v] = true;
    }
  }

  var folder;
  try { folder = DriveApp.getFolderById(folderId); }
  catch (err) { Logger.log('⚠ 開貨運單資料夾失敗：' + err); return 0; }

  var added = 0;
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (known[f.getId()]) continue;
    var mime = f.getMimeType();
    if (!INVOICE_MIME_OK[mime]) continue;   // 資料夾裡可能有別的東西，只收 PDF／圖片

    var rec = {};
    rec[normHeader_('上傳時間')] =
      Utilities.formatDate(f.getDateCreated(), TZ, 'yyyy-MM-dd HH:mm');
    rec[normHeader_('檔名')] = f.getName();
    rec[normHeader_('檔案ID')] = f.getId();
    rec[normHeader_('上傳人')] = '(直接放進資料夾)';
    rec[normHeader_('狀態')] = SHIPDOC_PENDING;
    var line = [];
    for (var h = 0; h < SHIPDOC_HEAD.length; h++) {
      line.push(rec[normHeader_(SHIPDOC_HEAD[h])] || '');
    }
    q.sheet.appendRow(line);
    added++;
  }
  return added;
}

/**
 * 【診斷】貨運單功能的設定檢查。編輯器執行，不寫入任何資料。
 *
 * ⚠ 「檔案丟了卻沒反應」有好幾種原因（資料夾沒設、設錯一顆、觸發器沒建、
 *   檔案不是 PDF），但症狀全都一樣。與其一個個猜，不如一次全印出來。
 */
function checkShipDocSetup() {
  var props = PropertiesService.getScriptProperties();

  Logger.log('── 1. 貨運單資料夾 ──');
  var own = String(props.getProperty(SHIPDOC_FOLDER_PROP) || '').trim();
  var legacy = String(props.getProperty('SHIPMENT_FOLDER_ID') || '').trim();
  Logger.log(SHIPDOC_FOLDER_PROP + '：' + (own || '(未設定)'));
  Logger.log('SHIPMENT_FOLDER_ID：' + (legacy || '(未設定)') + '　← 既有貨運單管線用的');
  var fid = shipDocFolderId_();
  if (!fid) {
    Logger.log('❌ 兩顆都沒設 → 掃不到資料夾，也無法從網頁上傳。');
  } else {
    Logger.log('實際會用：' + fid + (own ? '（專屬）' : '（沿用既有那顆）'));
    try {
      var folder = DriveApp.getFolderById(fid);
      Logger.log('✅ 資料夾名稱：' + folder.getName());
      var it = folder.getFiles(), n = 0, okType = 0, names = [];
      while (it.hasNext() && n < 50) {
        var f = it.next(); n++;
        if (INVOICE_MIME_OK[f.getMimeType()]) { okType++; if (names.length < 5) names.push(f.getName()); }
      }
      Logger.log('　 檔案 ' + n + ' 份，其中可處理的（PDF／圖片）' + okType + ' 份');
      if (names.length) Logger.log('　 例如：' + names.join('、'));
      if (n && !okType) Logger.log('⚠ 資料夾裡有檔案但沒有一份是 PDF 或圖片。');
    } catch (err) {
      Logger.log('❌ 開資料夾失敗（ID 錯或沒權限）：' + err);
    }
  }

  Logger.log('');
  Logger.log('── 2. 佇列 ──');
  try {
    var q = openAuxSheet_(SHIPDOC_SHEET, SHIPDOC_HEAD);
    var last = q.sheet.getLastRow();
    Logger.log('分頁「' + SHIPDOC_SHEET + '」共 ' + Math.max(last - 1, 0) + ' 列');
    if (last >= 2) {
      var cS = q.col[normHeader_('狀態')];
      var st = q.sheet.getRange(2, cS, last - 1, 1).getValues();
      var cnt = {};
      for (var i = 0; i < st.length; i++) {
        var k = String(st[i][0] || '(空)').trim();
        cnt[k] = (cnt[k] || 0) + 1;
      }
      for (var k2 in cnt) {
        if (Object.prototype.hasOwnProperty.call(cnt, k2)) Logger.log('　 ' + k2 + '：' + cnt[k2] + ' 筆');
      }
    }
  } catch (err) { Logger.log('❌ 開佇列失敗：' + err); }

  Logger.log('');
  Logger.log('── 3. 時間觸發器 ──');
  var trigs = ScriptApp.getProjectTriggers();
  var hit = 0;
  for (var t = 0; t < trigs.length; t++) {
    if (trigs[t].getHandlerFunction() === 'processShipDocQueue') hit++;
  }
  Logger.log(hit ? '✅ 已設定 ' + hit + ' 個 processShipDocQueue 觸發器'
                 : '❌ 沒有 processShipDocQueue 的觸發器 → 檔案永遠不會被自動處理。\n' +
                   '　 到「觸發條件」新增：函式 processShipDocQueue，時間驅動，每 5 分鐘。');

  Logger.log('');
  Logger.log('── 4. 其他前提 ──');
  Logger.log('GEMINI_API_KEY：' + (props.getProperty(GEMINI_KEY_PROP) ? '✅' : '❌ 未設定'));
  Logger.log('DISPATCH_WAREHOUSE：' + (props.getProperty('DISPATCH_WAREHOUSE') || '(未設定，無人能從網頁上傳)'));
}

/**
 * 把「貨運單待指定」裡人工填好的對應關係套用到出貨明細。
 *
 * 用法：在待指定分頁的「對應出貨單號」欄填上出貨單號 → 執行這支（或設觸發器）。
 *
 * ⚠ 沒有這一支，待指定分頁就是**死路**——人填了對應單號卻沒有任何程式會讀它，
 *   而且填的人不會知道，只會以為系統壞了。（2026-08-25 補上，原本漏了。）
 *
 * ⚠ 找不到那張出貨單、或那一列已經有貨運單號時**不寫入並在分頁上說明原因**，
 *   不是靜默跳過——人工指定的東西沒生效卻沒說，比自動配對失敗更難察覺。
 */
function applyShipWaiting() {
  var w, s;
  try {
    w = openAuxSheet_(SHIPWAIT_SHEET, SHIPWAIT_HEAD);
    s = openShipmentSheet_();
  } catch (err) { Logger.log('❌ 開分頁失敗：' + err); return; }

  var last = w.sheet.getLastRow();
  if (last < 2) { Logger.log('待指定分頁是空的。'); return; }

  var cTarget = w.col[normHeader_('對應出貨單號')];
  var cState = w.col[normHeader_('處理狀態')];
  var cTrack = w.col[normHeader_('貨運單號')];
  var cDate = w.col[normHeader_('貨運日期')];

  // 出貨單號 → 列號（正規化後比對，容忍空白與全形）
  var idx = {};
  var sLast = s.sheet.getLastRow();
  if (sLast >= 2) {
    var cShipNo = s.col[normHeader_(COL_S_SHIP_NO)];
    var cHas = s.col[normHeader_(COL_S_TRACK_NO)];
    var rows = s.sheet.getRange(2, 1, sLast - 1, s.sheet.getLastColumn()).getValues();
    for (var i = 0; i < rows.length; i++) {
      var no = normKey_(rows[i][cShipNo - 1]);
      if (!no) continue;
      (idx[no] = idx[no] || []).push({
        row: i + 2, has: String(rows[i][cHas - 1] || '').trim()
      });
    }
  }

  var vals = w.sheet.getRange(2, 1, last - 1, w.sheet.getLastColumn()).getValues();
  var done = 0, failed = 0;

  for (var k = 0; k < vals.length; k++) {
    var state = String(vals[k][cState - 1] || '').trim();
    if (state !== '待指定') continue;
    var target = String(vals[k][cTarget - 1] || '').trim();
    if (!target) continue;   // 還沒填，不動它

    var row = k + 2;
    var key = normKey_(target);
    var hits = idx[key] || [];

    if (!hits.length) {
      w.sheet.getRange(row, cState).setValue('❌ 查無此出貨單號');
      failed++; continue;
    }
    if (hits.length > 1) {
      w.sheet.getRange(row, cState).setValue('❌ 出貨明細有 ' + hits.length + ' 列同單號，無法決定');
      failed++; continue;
    }
    if (hits[0].has) {
      w.sheet.getRange(row, cState).setValue('❌ 該列已有貨運單號 ' + hits[0].has);
      failed++; continue;
    }

    s.sheet.getRange(hits[0].row, s.col[normHeader_(COL_S_TRACK_NO)])
      .setValue(String(vals[k][cTrack - 1] || '').trim());
    var d = String(vals[k][cDate - 1] || '').trim();
    if (d) s.sheet.getRange(hits[0].row, s.col[normHeader_(COL_S_TRACK_AT)]).setValue(d);
    w.sheet.getRange(row, cState).setValue('✅ 已套用');
    done++;
  }

  SpreadsheetApp.flush();
  if (done) invalidateWarehouseCache_();
  Logger.log('套用完成：成功 ' + done + ' 筆，失敗 ' + failed + ' 筆。');
  if (!done && !failed) {
    Logger.log('（沒有任何一列填了「對應出貨單號」，所以沒東西可套用。）');
  }
}

/**
 * 【診斷】為什麼配對不到？把「待指定」的每一筆拿去跟出貨明細實際的值比對，
 * 印出雙方的原始寫法與正規化後的樣子。編輯器執行，不寫入任何資料。
 *
 * ⚠ 存在的理由：配對不到有好幾種原因（收件人寫法不同、出貨明細根本沒那筆、
 *   已經有貨運單號被排除），但結果一律是「待指定」，看不出差別。
 *   猜錯方向去改比對邏輯，可能讓誤配對變多——那比配對不到危險得多。
 */
function debugShipMatch() {
  var s;
  try { s = openShipmentSheet_(); }
  catch (err) { Logger.log('❌ 開出貨明細失敗：' + err); return; }

  var last = s.sheet.getLastRow();
  Logger.log('── 出貨明細現況 ──');
  Logger.log('資料列數：' + Math.max(last - 1, 0));
  if (last < 2) {
    Logger.log('🔴 出貨明細裡一列資料都沒有 → 當然配對不到任何東西。');
    return;
  }

  var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
  var vals = s.sheet.getRange(2, 1, last - 1, width).getValues();
  var get = function (row, name) {
    var c = s.col[normHeader_(name)];
    if (!c || c > row.length) return '';
    var v = row[c - 1];
    return (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
  };

  var withName = 0, withTrack = 0, samples = [];
  for (var i = 0; i < vals.length; i++) {
    var nm = get(vals[i], COL_S_TO_NAME);
    if (get(vals[i], COL_S_TRACK_NO)) withTrack++;
    if (nm) {
      withName++;
      if (samples.length < 12) {
        samples.push({ raw: nm, key: normKey_(nm), shipNo: get(vals[i], COL_S_SHIP_NO) });
      }
    }
  }
  Logger.log('有填「' + COL_S_TO_NAME + '」的：' + withName + ' 列');
  Logger.log('已經有貨運單號（會被排除在配對外）的：' + withTrack + ' 列');
  if (!withName) {
    Logger.log('🔴 沒有任何一列填了收件人 → 只能靠訂單編號或備註配對，');
    Logger.log('　 而訂單編號實測是空的，所以全部配不到是必然的。');
    return;
  }
  Logger.log('');
  Logger.log('出貨明細的收件人實際長相（原文 → 正規化）：');
  for (var j = 0; j < samples.length; j++) {
    Logger.log('  ' + samples[j].shipNo + '｜' + samples[j].raw + ' → ' + samples[j].key);
  }

  // 拿「待指定」的收件人來比對
  Logger.log('');
  Logger.log('── 待指定 vs 出貨明細 ──');
  var w;
  try { w = openAuxSheet_(SHIPWAIT_SHEET, SHIPWAIT_HEAD); }
  catch (err2) { Logger.log('（沒有待指定分頁）'); return; }
  var wLast = w.sheet.getLastRow();
  if (wLast < 2) { Logger.log('（待指定分頁是空的）'); return; }

  var wVals = w.sheet.getRange(2, 1, wLast - 1, w.sheet.getLastColumn()).getValues();
  var cName = w.col[normHeader_('收件人')];
  var idx = buildMatchIndex_();
  var exact = 0, contains = 0, none = 0;

  for (var k = 0; k < Math.min(wVals.length, 12); k++) {
    var raw = String(wVals[k][cName - 1] || '').trim();
    var key = normKey_(raw);
    var hitExact = !!idx.byName[key];
    // 包含式比對：看看放寬之後會不會有救，以及會不會一次中太多筆
    var partial = [];
    for (var n in idx.byName) {
      if (!Object.prototype.hasOwnProperty.call(idx.byName, n)) continue;
      if (n === key) continue;
      if (key && n && (n.indexOf(key) >= 0 || key.indexOf(n) >= 0)) partial.push(n);
    }
    if (hitExact) exact++; else if (partial.length) contains++; else none++;
    Logger.log('  ' + raw + ' → ' + key +
      '｜完全相符=' + (hitExact ? '✅' : '✗') +
      '｜包含式候選=' + (partial.length ? partial.join('／') : '無'));
  }

  Logger.log('');
  Logger.log('── 判讀 ──');
  Logger.log('完全相符 ' + exact + '　只有包含式相符 ' + contains + '　完全沒有 ' + none);
  if (!exact && contains) {
    Logger.log('👉 寫法有落差（例如「宇泰鎖印 李建男」vs「宇泰鎖印行-李建男」）。');
    Logger.log('　 改成包含式比對可能有救——但要確認包含式不會一次中好幾筆，');
    Logger.log('　 一次中多筆就必須維持「不猜」，寧可待指定。');
  } else if (!exact && !contains) {
    Logger.log('👉 兩邊的收件人根本是不同的人／公司，');
    Logger.log('　 多半是這批貨運單對應的出貨單還沒登錄進出貨明細。');
    Logger.log('　 那樣的話「待指定」就是正確結果，不需要改比對邏輯。');
  }
}

/** 辨識一份貨運單並回填。回 {ok, total, matched, pending, message}。 */
function processOneShipDoc_(fileId) {
  var txt = pdfToText_(fileId);
  if (!txt.ok) return { ok: false, message: '轉文字失敗：' + txt.message };
  if (txt.chars < 100) {
    return { ok: false, message: '幾乎抽不到文字（' + txt.chars +
      ' 字），這份可能是掃描影像，需要人工處理。' };
  }

  var got = callGeminiJson_([{ text: SHIPDOC_PROMPT + txt.text }],
    SHIPDOC_SCHEMA, '貨運單解析');
  if (!got.ok) return { ok: false, message: '辨識失敗（' + got.reason + '）' };

  var d = got.data || {};
  var rows = d.rows || [];
  if (!rows.length) return { ok: false, message: '辨識結果是空的。' };

  // 文件自述的合計是免費的驗證錨點：對不上就代表漏行，要讓人知道
  var expect = 0;
  var m = txt.text.match(/全合計[：:]\s*(\d+)\s*筆/) || txt.text.match(/合計[：:]\s*(\d+)\s*筆/);
  if (m) expect = Number(m[1]);
  var warn = (expect && rows.length !== expect)
    ? '⚠ 文件寫 ' + expect + ' 筆但只辨識出 ' + rows.length + ' 筆，可能漏行。' : '';

  var idx = buildMatchIndex_();
  var s = openShipmentSheet_();
  var cTrack = s.col[normHeader_(COL_S_TRACK_NO)];
  var cTrackAt = s.col[normHeader_(COL_S_TRACK_AT)];
  var matched = 0, waiting = [];

  for (var i = 0; i < rows.length; i++) {
    var rec = rows[i] || {};
    var track = String(rec.tracking_no || '').trim();
    if (!track) continue;
    var hit = matchShipRow_(rec, idx);
    if (hit.row) {
      s.sheet.getRange(hit.row, cTrack).setValue(track);
      if (rec.ship_date) s.sheet.getRange(hit.row, cTrackAt).setValue(rec.ship_date);
      matched++;
    } else {
      waiting.push({ rec: rec, cands: hit.candidates || [] });
    }
  }
  SpreadsheetApp.flush();
  invalidateWarehouseCache_();

  if (waiting.length) writeShipWaiting_(waiting, fileId);

  return {
    ok: true, total: rows.length, matched: matched, pending: waiting.length,
    message: warn + '辨識 ' + rows.length + ' 筆，自動配對 ' + matched +
      ' 筆，待人工指定 ' + waiting.length + ' 筆。'
  };
}

/** 對不到的託運紀錄寫進「貨運單待指定」，附上候選讓人挑。 */
function writeShipWaiting_(list, fileId) {
  try {
    var w = openAuxSheet_(SHIPWAIT_SHEET, SHIPWAIT_HEAD);
    var lines = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i].rec;
      var o = {};
      o[normHeader_('貨運單號')] = r.tracking_no || '';
      o[normHeader_('貨運日期')] = r.ship_date || '';
      o[normHeader_('收件人')] = r.recipient || '';
      o[normHeader_('電話')] = r.phone || '';
      o[normHeader_('備註')] = r.note || '';
      o[normHeader_('來源檔案')] = fileId;
      o[normHeader_('候選出貨單號')] = (list[i].cands || []).join('、');
      o[normHeader_('處理狀態')] = '待指定';
      var line = [];
      for (var h = 0; h < SHIPWAIT_HEAD.length; h++) {
        line.push(o[normHeader_(SHIPWAIT_HEAD[h])] || '');
      }
      lines.push(line);
    }
    if (lines.length) {
      w.sheet.getRange(w.sheet.getLastRow() + 1, 1, lines.length, SHIPWAIT_HEAD.length)
        .setValues(lines);
    }
  } catch (err) {
    Logger.log('⚠ 寫「待指定」失敗（辨識與配對已完成，不影響已寫入的資料）：' + err);
  }
}

/**
 * 【階段 0 驗證工具】拿一份真實貨運單 PDF 測 Gemini 認不認得。
 *
 * 用法：Apps Script 編輯器執行，參數給 Drive 檔案 ID；
 *      不給的話會自動從 SHIPMENT_FOLDER_ID 資料夾抓最新一份 PDF。
 * **不寫入任何資料**，只印進執行記錄供人工比對。
 *
 * 驗收要看兩件事（計畫裡的硬關卡）：
 *   ① 列數對不對（AI 自報的 total 與實際回傳的列數是否一致，以及跟 PDF 上是否相符）
 *   ② 出貨單號與貨運單號有沒有串行（拿兩三列去 PDF 上核對）
 */
function testShippingDocParse(fileId) {
  var file = shipDocFile_(fileId);
  if (!file) return;

  Logger.log('檔案：' + file.getName() + '　' +
    Math.round(file.getSize() / 1024) + ' KB');

  // ① PDF → 文字（不直接餵 PDF 給 Gemini，理由見 SHIPDOC_PROMPT 的註解）
  var t0 = Date.now();
  var txt = pdfToText_(file.getId());
  if (!txt.ok) { Logger.log('❌ ' + txt.message); return; }
  var tSecs = Math.round((Date.now() - t0) / 100) / 10;
  Logger.log('轉文字：' + txt.chars + ' 字，' + tSecs + ' 秒');

  // 文件結尾的「全合計：N 筆」是**免費的驗證錨點**——不必人工數就知道應該有幾筆
  var expect = 0;
  var m = txt.text.match(/全合計[：:]\s*(\d+)\s*筆/);
  if (!m) m = txt.text.match(/合計[：:]\s*(\d+)\s*筆/);
  if (m) { expect = Number(m[1]); Logger.log('文件自己寫的總筆數：' + expect + ' 筆'); }
  Logger.log('');

  // ② 文字 → Gemini 解析
  var t1 = Date.now();
  var got = callGeminiJson_([{ text: SHIPDOC_PROMPT + txt.text }],
    SHIPDOC_SCHEMA, '貨運單解析測試');
  var gSecs = Math.round((Date.now() - t1) / 100) / 10;

  if (!got.ok) {
    Logger.log('❌ 解析失敗（' + got.reason + '，HTTP ' + got.code + '）耗時 ' + gSecs + ' 秒');
    Logger.log(String(got.body || '').slice(0, 400));
    return;
  }

  var d = got.data || {};
  var rows = d.rows || [];
  Logger.log('✅ 解析成功｜模型 ' + got.model + '｜' + gSecs + ' 秒' +
    '（全程 ' + (tSecs + gSecs) + ' 秒）');
  Logger.log('貨運公司：' + (d.carrier || '(讀不到)') + '　日期：' + (d.doc_date || '(讀不到)'));
  Logger.log('');

  // ── 三個自動檢查，把「用眼睛很難發現的錯」抓出來 ──
  Logger.log('── 筆數核對 ──');
  Logger.log('文件寫的：' + (expect || '(找不到合計)') +
    '　AI 自報：' + d.total + '　實際回傳：' + rows.length);
  if (expect && rows.length !== expect) {
    Logger.log('🔴 實際回傳與文件合計不符 → **漏了 ' + (expect - rows.length) +
      ' 筆**。漏掉的那幾張單永遠查不到貨運單號，這是不可接受的失敗。');
  } else if (expect) {
    Logger.log('✅ 筆數與文件合計一致。');
  }
  if (Number(d.total) !== rows.length) {
    Logger.log('🔴 AI 自報 ' + d.total + ' 筆卻只回 ' + rows.length + ' 筆 → 它自己知道截斷了。');
  }
  Logger.log('');

  var withNo = 0, withPhone = 0, withNote = 0, dupTrack = {}, dupCount = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    if (String(r.order_no || '').trim()) withNo++;
    if (String(r.phone || '').trim()) withPhone++;
    if (String(r.note || '').trim()) withNote++;
    var tk = String(r.tracking_no || '').trim();
    if (tk) { if (dupTrack[tk]) dupCount++; dupTrack[tk] = true; }
    Logger.log((i + 1) + '. ' + (r.tracking_no || '(無單號)') +
      '｜' + (r.recipient || '(無收件人)') +
      '｜訂單編號=' + (r.order_no || '空') +
      '｜電話=' + (r.phone || '空') +
      (r.note ? '｜備註=' + r.note : ''));
  }

  Logger.log('');
  Logger.log('── 可配對性 ──');
  Logger.log('有「訂單編號」的：' + withNo + ' / ' + rows.length + ' 筆');
  Logger.log('有電話的：' + withPhone + '　有備註的：' + withNote);
  if (dupCount) {
    Logger.log('🔴 有 ' + dupCount + ' 個重複的託運單號 → 多半是 AI 把同一列讀了兩次。');
  }
  if (!withNo) {
    Logger.log('');
    Logger.log('⚠ 一筆都沒有訂單編號。這**不是 AI 讀錯**——真實樣本裡那一欄整份都是空的');
    Logger.log('　（與 sql/supabase_shipments.sql:14 的記載一致）。');
    Logger.log('　 → 要嘛請倉庫在貨運系統填這一欄（乾淨的配對鍵），');
    Logger.log('　 → 要嘛先靠「收件人＋電話＋備註」跟出貨明細配對（今天就能用）。');
  }
  Logger.log('');
  Logger.log('👉 請人工抽查兩三列：對照 PDF，看收件人與託運單號有沒有串行。');
}

/**
 * 診斷：把一句問題跑完整條路徑，印出**每個條件各刷掉多少列**。
 * 在編輯器執行（可改參數），不寫任何資料。
 *
 * ⚠ 存在的理由：查不到單時有好幾種原因，而回覆一律是「我找不到」——
 *   條件解析錯、客戶名比對不到、日期對不上、分頁沒被掃到，症狀完全一樣。
 *   與其一句一句在 Chat 裡試，不如直接看是哪一關把資料刷光的。
 */
function debugChatQuery(text) {
  text = text || '查 8月 金宏鎖店的單';
  Logger.log('問題：' + text);

  var fast = parseChatQuestionFast_(text);
  Logger.log('快速解析（免 AI）：' + (fast ? JSON.stringify(fast) : 'null → 會送 AI'));
  var f = fast || parseChatQuestion_(text);
  if (!f || f.failed) { Logger.log('❌ 解析失敗：' + JSON.stringify(f)); return; }
  Logger.log('最終條件：' + JSON.stringify(f));
  Logger.log('');

  var wantCust = String(f.customer || '').toLowerCase();
  var wantNo = String(f.orderNo || '').toLowerCase();
  var from = f.dateFrom || '', to = f.dateTo || '';

  var env = openSheets_();
  Logger.log('掃描 ' + env.list.length + ' 個分頁：');
  var gTotal = 0, gCust = 0, gDate = 0, gBoth = 0;
  var sampleCust = {}, sampleDate = {};

  for (var k = 0; k < env.list.length; k++) {
    var ctx = env.list[k];
    var startRow = ctx.headerRow + 1;
    var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
    if (lastRow < startRow) continue;
    var width = ctx.lastCol || ctx.sheet.getLastColumn();
    var values = ctx.sheet.getRange(startRow, 1, lastRow - startRow + 1, width).getValues();

    var tot = 0, okCust = 0, okDate = 0, both = 0;
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var pick = function (name) {
        var c = ctx.col[name];
        if (!c || c > row.length) return '';
        var v = row[c - 1];
        return (v instanceof Date) ? fmtDate_(v) : String(v == null ? '' : v).trim();
      };
      if (!ORDER_NO_RE.test(pick(COL_ORDER_NO))) continue;
      tot++;
      var cust = pick(COL_CUSTOMER), at = pick(COL_APPLY_AT);
      if (tot <= 3) {
        sampleCust[ctx.name] = (sampleCust[ctx.name] || []).concat([cust || '(空)']);
        sampleDate[ctx.name] = (sampleDate[ctx.name] || []).concat([at || '(空)']);
      }
      var hitC = !wantCust || cust.toLowerCase().indexOf(wantCust) >= 0 ||
                 ctx.name.toLowerCase().indexOf(wantCust) >= 0;
      var d = String(at || '').slice(0, 10);
      var hitD = (!from && !to) || (!!d && (!from || d >= from) && (!to || d <= to));
      if (hitC) okCust++;
      if (hitD) okDate++;
      if (hitC && hitD) both++;
    }
    if (tot) {
      Logger.log('  ' + ctx.name + '：共 ' + tot + ' 筆　客戶條件過 ' + okCust +
        '　日期條件過 ' + okDate + '　兩者都過 ' + both);
      gTotal += tot; gCust += okCust; gDate += okDate; gBoth += both;
    }
  }

  Logger.log('');
  Logger.log('合計：' + gTotal + ' 筆　客戶過 ' + gCust + '　日期過 ' + gDate +
    '　都過 ' + gBoth);
  if (gTotal && !gBoth) {
    if (!gCust) Logger.log('🔴 客戶條件「' + f.customer + '」把全部刷掉了。');
    if (!gDate) Logger.log('🔴 日期條件「' + from + '～' + to + '」把全部刷掉了。');
    Logger.log('');
    Logger.log('各分頁前 3 筆的實際值（看看寫法跟你問的差在哪）：');
    for (var n in sampleCust) {
      if (!Object.prototype.hasOwnProperty.call(sampleCust, n)) continue;
      Logger.log('  ' + n + '　客戶=' + sampleCust[n].join('｜') +
        '　日期=' + (sampleDate[n] || []).join('｜'));
    }
  }
}

/**
 * Chat 問答的總入口：一句問題進來，一段回覆出去。由 chatapp.gs 的 onMessage 呼叫。
 *
 * @param text  使用者輸入（已去掉 @小幫手 前綴）
 * @param asker {mention, name, email}——email 可能是空的（認不出這個人）
 *
 * ⚠ 回傳純文字，不丟例外：呼叫端在 Chat 事件裡，拋錯會讓小幫手變成已讀不回，
 *   使用者會以為訊息沒送出去而一直重問。
 *
 * ⚠ **一個金額欄位都不輸出**。runQuery 那套「主管才看得到進價」的分級在這裡
 *   沒有意義——Chat 訊息是貼給整個空間看的，不是貼給發問者一個人。
 */
function answerChatQuestion_(text, asker) {
  asker = asker || {};
  var at = asker.mention ? asker.mention + ' ' : '';

  // 先試不打 AI 的快速解析。解得出來就省下 9 秒，而且 Gemini 掛掉照樣能用。
  var f = parseChatQuestionFast_(text);
  if (!f) {
    f = parseChatQuestion_(text);
    if (!f || f.failed) {
      // 🔑 一定要回一句話。這裡若讓它逾時，使用者在 Chat 是**完全沒反應**，
      //    連「壞了」都不知道，只會一直重問——那比一句錯誤訊息糟得多。
      var why = (f && f.failed === 'timeout')
        ? 'AI 現在忙不過來'
        : 'AI 解析暫時打不通';
      return at + why + '，我沒辦法理解這句話。\n' +
        '不過*直接給我單號我不需要 AI 就查得到*，例如「查 LS-260825-01」。\n' +
        '或改用查詢頁。';
    }
  }

  var hasCond = !!(f.customer || f.orderNo || f.person || f.dateFrom || f.self);
  if (f.intent === 'unknown' || !hasCond) return at + CHAT_HELP;

  // 「我的單」要知道你是誰。認不出來就不能默默查成全部——那會回一份
  // 看起來像「你的單」但其實是所有人的清單，比拒絕回答誤導得多。
  if (f.self) {
    if (!asker.email) {
      return at + '我認不出你的帳號，沒辦法判斷哪些是「你的」單。\n' +
        '請管理員跑一次 writeUidsToSheet() 把你加進「Chat人員對照」，' +
        '或直接告訴我客戶名或單號。';
    }
    var me = salesFor_(asker.email);
    if (!me) {
      return at + '你（' + asker.email + '）不在路由對照表的業務名單裡，' +
        '我查不到「你的」單。可以改問客戶名或單號。';
    }
    f.person = me.name || me.code || '';
  }

  // 大範圍查詢會掃 17 個分頁而 Chat 需要秒回。與其逾時（使用者只會看到沒反應），
  // 不如當場擋下來並給出替代方案。
  if (f.dateFrom && f.dateTo) {
    var days = (new Date(f.dateTo) - new Date(f.dateFrom)) / 86400000;
    if (days > 31) {
      return at + '你問的範圍超過一個月，我在 Chat 查會逾時。' +
        '請縮小到一個月內，或用查詢頁。';
    }
  }

  var res;
  try {
    res = chatQueryOrders_(f);
  } catch (err) {
    Logger.log('Chat 查詢失敗：' + err);
    return at + '查詢時出了問題，請改用查詢頁。';
  }

  var cond = chatCondText_(f);
  if (!res.rows.length) {
    // 🔑 「其他條件都中、只有日期不中」要講出來，這是最有用的一句話。
    //   實測踩過：問「8 月金宏的單」回「我找不到」，但金宏其實有 3 筆在 2~3 月。
    //   那句回覆技術上正確卻害人以為單不存在。
    if (res.nearMiss) {
      var who = f.customer || f.person || '這個條件';
      return at + who + '有 ' + res.nearMiss + ' 筆單，但*都不在你問的日期範圍內*（' +
        (f.dateFrom || '?') + '～' + (f.dateTo || '?') + '）。\n' +
        (res.nearLatest ? '最近的一筆是 ' + res.nearLatest + '。\n' : '') +
        '把日期拿掉再問一次就看得到，例如「查' + who + '的單」。';
    }
    // 措辭刻意是「我找不到」不是「沒有這張單」——查無可能是日期或客戶名寫法不同，
    // 說成「沒有」會讓人以為單真的不存在而去重下一張。
    return at + '我找不到符合「' + cond + '」的單。\n' +
      '可能是日期或客戶名的寫法不同，換個說法再問一次，或用查詢頁查。';
  }

  var lines = [at + '「' + cond + '」找到 ' + res.rows.length + ' 筆：', ''];
  var anyUnshipped = false;   // 有沒有任何一筆還看不到貨運單號（決定要不要附免責聲明）
  for (var i = 0; i < res.rows.length; i++) {
    var r = res.rows[i];
    // 客戶欄裡常有對齊用的連續空白（實測看到「天崴建設-　　　　張小姐」），
    // 原樣貼進 Chat 會變成一長串空洞。壓成單一空白只影響顯示，不影響比對。
    lines.push('▪ ' + r.no + '　' + (String(r.customer || '(無客戶)').replace(/[\s　]+/g, ' ')) +
      (r.at ? '　下單 ' + r.at : ''));
    if (r.model) lines.push('　品項：' + r.model + (r.qty ? ' ×' + r.qty : ''));

    if (!r.ships.length) {
      lines.push('　狀態：' + shipmentStage_(null).label);
      anyUnshipped = true;
    } else {
      for (var s = 0; s < r.ships.length; s++) {
        var st = shipmentStage_(r.ships[s]);
        lines.push('　狀態：' + st.label);
        if (st.code !== 'shipped') anyUnshipped = true;
      }
    }
    lines.push('');
  }

  if (res.truncated) {
    lines.push('（只顯示前 10 筆，還有更多請用查詢頁）');
  }
  // 🔑 全部都看得到貨運單號時**不加免責聲明**——那句話說「這不是實際出貨紀錄」，
  //    但貨運單號正是實際出貨紀錄，繼續附上去會變成自相矛盾的錯話。
  if (anyUnshipped) lines.push(CHAT_SHIP_DISCLAIMER);

  var link = deepLink_({ page: 'query' });
  if (link) lines.push('<' + link + '|➡ 開查詢頁看完整資料>');

  return lines.join('\n');
}

/** 把查詢條件講回去給使用者聽，讓他知道我理解成什麼——查錯時一眼就看得出是誤解。 */
function chatCondText_(f) {
  var parts = [];
  if (f.dateFrom && f.dateTo && f.dateFrom === f.dateTo) parts.push(f.dateFrom);
  else if (f.dateFrom || f.dateTo) parts.push((f.dateFrom || '?') + '～' + (f.dateTo || '?'));
  if (f.customer) parts.push(f.customer);
  if (f.orderNo) parts.push(f.orderNo);
  if (f.person) parts.push(f.person);
  return parts.length ? parts.join('・') : '(無條件)';
}

/**
 * 查詢用的伺服器端進入點。
 *
 * ⚠ **進價一律在伺服器端就移除**，除非這個人是主管。
 * 查詢頁是全員可用的，如果只在畫面上藏起來，改一下前端就看得到——
 * 敏感欄位的過濾必須發生在資料離開伺服器之前。
 */
function runQuery(q) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分。', rows: [] };

  var roles = rolesFor_(email);
  var canSeeCost = !!(roles.boss || roles.sub);

  try {
    var res = queryOrders_(q);
    if (!canSeeCost) {
      for (var i = 0; i < res.rows.length; i++) {
        var ships = res.rows[i].ships || [];
        for (var j = 0; j < ships.length; j++) delete ships[j][COL_S_COST_PRICE];
      }
    }
    return {
      ok: true, rows: res.rows, truncated: res.truncated,
      canSeeCost: canSeeCost, count: res.rows.length
    };
  } catch (err) {
    return { ok: false, message: '查詢失敗：' + err, rows: [] };
  }
}

// ────────────────────────────────────────────── ① 業務下單

/**
 * 產生下一個發包單號：`<代碼>-<YYMMDD>-<當日流水兩位>`。
 *
 * 流水號只掃**這個分頁**當天的單。跨分頁不會撞號，因為代碼前綴已經隔開了
 * （每個業務一個代碼、一個分頁）。
 *
 * ⚠ 必須在 LockService 保護下呼叫。兩個人同時下單、都讀到「今天最大是 03」，
 * 就會產生兩張 04——而發包單號是後面所有流程的鍵，撞號等於兩筆資料混在一起。
 */
/**
 * 產生下一個「案件號」：`IW<YYYYMMDD><4碼流水>`，例：IW202608250001。
 *
 * ⚠ 格式刻意跟 CRM／Supabase 的 next_case_no() 對齊（R 報修／C 客訴／IW 安裝，
 *   前綴+8碼日期+4碼流水），但**這支不呼叫 Supabase**——GAS 從未串接過 Supabase，
 *   Supabase 目前只是使用者自己在測，正式版不會用它。所以號碼完全在 GAS 這邊
 *   自己發、直接回填 Google Sheet；格式先對齊，將來真的要接 Supabase 時
 *   不必轉換既有資料，兩邊的號碼天生就能並存不撞。
 *
 * 用途：截圖下單目前不走發包單（經銷商訂單沒有發包單號可當錨點），
 * 這個號碼就是深連結指得到那一列所需要的穩定錨點。
 *
 * 流水只掃**出貨明細這一張表**當天已有的案件號，不分業務——案件號本來就是
 * 全公司共用序列，不能像發包單號那樣用代碼前綴隔開分頁。
 *
 * ⚠ 必須在 LockService 保護下呼叫，理由同 nextOrderNo_：兩個人同時送出、
 *   都讀到「今天最大是 0003」，會產生兩個 0004——這個號碼是深連結的鍵，
 *   撞號等於兩筆資料的通知會互相指到對方。
 */
function nextCaseNo_(s, when) {
  var prefix = 'IW' + Utilities.formatDate(when || new Date(), TZ, 'yyyyMMdd');
  var c = s.col[COL_S_CASE_NO];
  var last = s.sheet.getLastRow();
  var max = 0;

  if (c && last >= 2) {
    var vals = s.sheet.getRange(2, c, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i][0] || '').trim();
      if (v.indexOf(prefix) !== 0) continue;
      var n = parseInt(v.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  var seq = max + 1;
  var padded = String(seq);
  while (padded.length < 4) padded = '0' + padded;
  return prefix + padded;
}

function nextOrderNo_(ctx, code, when) {
  var ymd = Utilities.formatDate(when || new Date(), TZ, 'yyMMdd');
  var prefix = String(code).toUpperCase() + '-' + ymd + '-';
  var startRow = ctx.headerRow + 1;
  var lastRow = ctx.lastRow || ctx.sheet.getLastRow();
  var max = 0;

  if (lastRow >= startRow) {
    var vals = ctx.sheet.getRange(startRow, ctx.col[COL_ORDER_NO],
      lastRow - startRow + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i][0] || '').trim();
      if (v.indexOf(prefix) !== 0) continue;
      var n = parseInt(v.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  var seq = max + 1;
  return prefix + (seq < 10 ? '0' + seq : String(seq));
}

/**
 * 業務下單。回傳 {ok, message, orderNo}。
 *
 * 寫進**該業務自己的分頁**，不是另開一張新表。理由在設計文件：
 * 累計請款數量是跨期的，新單若進別的表就和該業務的歷史單分家，
 * 防超額請款會失效——那是會出錯付錢的地方。
 */
function submitOrder(form) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };

  var me = salesFor_(email);
  if (!me) {
    return { ok: false, message: '您（' + email + '）不在路由對照表的業務 email 欄中，' +
      '無法下單。請先把您的帳號加進對照表。' };
  }
  if (!me.sheet) {
    return { ok: false, message: '路由對照表裡代碼 ' + me.code +
      ' 沒有填「' + COL_R_SHEET + '」，不知道要把單寫到哪個分頁。' };
  }

  form = form || {};
  var kind = String(form.kind || '').trim();
  if (ORDER_KINDS.indexOf(kind) < 0) {
    return { ok: false, message: '請選擇單別（' + ORDER_KINDS.join(' / ') + '）。' };
  }
  var customer = String(form.customer || '').trim();
  var model = String(form.model || '').trim();
  if (!customer) return { ok: false, message: '客戶為必填。' };
  if (!model) return { ok: false, message: '型號為必填。' };

  var qty = String(form.qty || '').trim();
  if (!qty) return { ok: false, message: '報價單數量為必填。' };
  if (isNaN(Number(qty))) return { ok: false, message: '報價單數量必須是數字。' };

  // 下拉選了「其他」時前端應改送文字框的值。收到字面上的「其他」表示前端沒處理好
  // （或被繞過）——那會在表上留下一列寫著「其他」的資料，比擋下來難查得多。
  var picks = [[customer, '客戶'], [String(form.project || '').trim(), '案名／購買通路'],
               [model, '型號'], [String(form.worker || '').trim(), '承包商'],
               [String(form.workItem || '').trim(), '工項']];
  for (var pk = 0; pk < picks.length; pk++) {
    if (picks[pk][0] === OTHER_OPTION) {
      return { ok: false, message: picks[pk][1] + '選了「' + OTHER_OPTION +
        '」但沒有填寫實際內容，未寫入任何資料。' };
    }
  }

  // 發包安裝才有承包商與承包金額；料件出貨沒有承包這件事
  var worker = String(form.worker || '').trim();
  if (kind === ORDER_KIND_INSTALL && !worker) {
    return { ok: false, message: '發包安裝必須填承包商。' };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return { ok: false, message: '系統忙碌中，請稍候再試。' }; }

  try {
    var one = openSheetByName_(me.sheet);
    if (!one) {
      return { ok: false, message: '找不到分頁「' + me.sheet +
        '」，或該分頁沒有簽核欄（請檢查路由對照表的「' + COL_R_SHEET + '」）。' };
    }
    var ctx = one.ctx;

    var now = new Date();
    var orderNo = nextOrderNo_(ctx, me.code, now);
    var stamp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm');

    var rec = {};
    rec[COL_ORDER_NO] = orderNo;
    rec[COL_APPLY_AT] = now;
    rec[COL_CUSTOMER] = customer;
    rec[COL_PROJECT] = String(form.project || '').trim();
    rec[COL_MODEL] = model;
    rec[COL_QUOTE_QTY] = Number(qty);
    rec[COL_DISPATCHER] = me.name || email;
    rec[COL_NOTE] = String(form.note || '').trim();

    if (kind === ORDER_KIND_INSTALL) {
      rec[COL_WORKER] = worker;
      var price = String(form.price || '').trim();
      if (price && !isNaN(Number(price))) rec[COL_PRICE] = Number(price);
    } else {
      // 料件出貨免簽核，直接進助理的待出貨清單（見 ORDER_NO_SIGN_MARK 的說明）
      rec[COL_APPROVAL] = ORDER_NO_SIGN_MARK + ' ' + email + ' ' + stamp;
      if (ctx.col[COL_STATUS]) rec[COL_STATUS] = '免簽核';
    }

    // 依表頭文字定位寫入。各分頁欄序與欄名都不同（4 種格式），
    // 不能用固定順序——這也是別名表存在的原因。
    var width = ctx.lastCol || ctx.sheet.getLastColumn();
    var line = [];
    for (var w = 0; w < width; w++) line.push('');
    var skipped = [];
    for (var key in rec) {
      var c = ctx.col[key];
      if (c && c <= width) line[c - 1] = rec[key];
      else if (String(rec[key]) !== '') skipped.push(key);
    }
    ctx.sheet.appendRow(line);
    SpreadsheetApp.flush();
    // 記下寫在哪一列，通知的深連結要用它當位置提示（省掉對方開頁時掃 17 個分頁）
    var newRow = ctx.sheet.getLastRow();

    // 出貨資訊寫進出貨明細（出貨單號留空＝等助理鍵 TipTop）。
    // 業務分頁沒有出貨項目／貨指寄／客人資料這些欄，而在 17 個分頁各加 7 欄
    // 是先前已判斷不可行的事；出貨明細本來就是為這些資料設計的。
    var shipWarn = '';
    var hasShipInfo = String(form.items || '').trim() || String(form.toName || '').trim() ||
      String(form.custName || '').trim();
    if (hasShipInfo) {
      try {
        writeOrderShipment_(orderNo, kind, form, email, me, stamp);
      } catch (e1) {
        // 顯性失敗：發包單已經建了，但出貨資訊沒進去。不能回報成單純成功——
        // 業務會以為助理拿得到出貨資料，結果助理那邊是空的。
        shipWarn = '　🔴 出貨資訊寫入失敗，請改用助理出貨頁補填：' + e1;
        Logger.log('出貨明細寫入失敗（發包單 ' + orderNo + ' 已建立）：' + e1);
      }
    }

    invalidatePendingCache_();
    try { CacheService.getScriptCache().remove(SHIP_CACHE_KEY); } catch (e0) {}
    invalidateWarehouseCache_();

    // 稽核：整條鏈的起點。有這一筆，之後才能從稽核表看出「這張單從下單到出貨走了多久」
    try {
      // env 不在這個 scope（這裡是 one.ctx），用 getParent() 取試算表物件
      appendAudit_(ctx.sheet.getParent(), {
        at: stamp, who: email, role: '業務', orderNo: orderNo, action: '下單（' + kind + '）',
        note: '客戶 ' + customer + (model ? '｜' + model : '') + (qty ? ' ×' + qty : '') +
          (skipped.length ? '｜⚠ 分頁缺欄未寫入：' + skipped.join('、') : '') +
          (shipWarn ? '｜🔴 出貨資訊寫入失敗' : ''),
        sheet: ctx.name, row: newRow
      });
    } catch (eA) {
      Logger.log('下單稽核寫入失敗（單已建立 ' + orderNo + '）：' + eA);
    }

    // 通知下一棒。包 try：單已經建好了，通知失敗不該讓業務以為下單失敗而重下一次。
    try {
      notifyOrderSubmitted_({
        orderNo: orderNo, kind: kind, sheet: ctx.name, row: newRow,
        twoStage: !!ctx.twoStage, customer: customer,
        project: String(form.project || '').trim(),
        model: model, qty: qty, worker: (kind === ORDER_KIND_INSTALL) ? worker : '',
        price: (kind === ORDER_KIND_INSTALL) ? String(form.price || '').trim() : '',
        by: me.name || email, at: stamp
      });
    } catch (eN) { Logger.log('下單通知失敗（單已建立 ' + orderNo + '）：' + eN); }

    var msg = '已建立 ' + orderNo + '（' + kind + '）';
    msg += (kind === ORDER_KIND_INSTALL) ? '，已送主管簽核。' : '，免簽核，已進助理出貨清單。';
    // 顯性失敗：該分頁沒有的欄位要講出來，不能安靜丟掉業務填的資料
    if (skipped.length) {
      msg += '　⚠ 分頁「' + ctx.name + '」沒有這些欄位，未寫入：' + skipped.join('、');
      Logger.log('下單時略過欄位（分頁缺欄）：' + ctx.name + '｜' + skipped.join('、'));
    }
    msg += shipWarn;
    return { ok: true, message: msg, orderNo: orderNo, shipFailed: !!shipWarn };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 業務下單時，把出貨資訊寫進出貨明細（出貨單號留空＝等助理鍵 TipTop）。
 * 抽成獨立函式是為了讓呼叫端能單獨 try：發包單已經寫成功了，
 * 這一段失敗必須顯性回報，但不能讓整筆下單看起來失敗。
 */
function writeOrderShipment_(orderNo, kind, form, email, me, stamp) {
  var s = openShipmentSheet_();
  var rec = {};
  rec[COL_S_AT] = stamp;
  rec[COL_S_DISPATCH] = orderNo;
  rec[COL_S_CUSTOMER] = String(form.customer || '').trim();
  rec[COL_S_PROJECT] = String(form.project || '').trim();
  rec[COL_S_ITEMS] = String(form.items || '').trim();
  rec[COL_S_TO_NAME] = String(form.toName || '').trim();
  rec[COL_S_TO_PHONE] = String(form.toPhone || '').trim();
  rec[COL_S_TO_ADDR] = String(form.toAddr || '').trim();
  rec[COL_S_INVOICE] = String(form.invoice || '').trim();
  rec[COL_S_NOTE] = String(form.shipNote || '').trim();
  rec[COL_S_CHANNEL_NO] = String(form.channelNo || '').trim();
  rec[COL_S_CUST_NAME] = String(form.custName || '').trim();
  rec[COL_S_CUST_PHONE] = String(form.custPhone || '').trim();
  rec[COL_S_CUST_ADDR] = String(form.custAddr || '').trim();
  rec[COL_S_WORK_TIME] = String(form.workTime || '').trim();
  rec[COL_S_WORK_ITEM] = String(form.workItem || '').trim();
  rec[COL_S_ORDER_BY] = me.name || email;
  rec[COL_S_WH_STATUS] = WH_PENDING;

  var sale = String(form.salePrice || '').trim();
  var cost = String(form.costPrice || '').trim();
  if (sale && !isNaN(Number(sale))) rec[COL_S_SALE_PRICE] = Number(sale);
  if (cost && !isNaN(Number(cost))) rec[COL_S_COST_PRICE] = Number(cost);

  var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
  var line = [];
  for (var w = 0; w < width; w++) line.push('');
  for (var key in rec) {
    var c = s.col[key];
    if (c && c <= width) line[c - 1] = rec[key];
  }
  s.sheet.appendRow(line);
  SpreadsheetApp.flush();
}

// ────────────────────────────────────────────── 截圖下單

/**
 * 讀業務上傳的截圖，回傳 { ok, customer, items:[{model,qty,spec}], note, confidence, message }。
 *
 * 不存檔——截圖只是辨識的輸入，辨識完就丟。存起來等於多一份含客戶名稱與對話內容
 * 的檔案要管，而且發票上傳（uploadInvoice）需要留底才存 Drive，這裡不需要。
 *
 * 權限沿用 submitOrder 同一套：只有 salesFor_ 認得的業務能呼叫，因為這支最終
 * 是要幫業務下單，不該開放給不會下單的人。
 */
/**
 * 呼叫 Gemini 取得**結構化 JSON**，是全系統唯一的 Gemini 進入點。
 *
 * @param parts  contents[0].parts 陣列。純文字就 [{text:...}]；
 *               要送圖片再加 {inline_data:{mime_type,data}}。
 * @param schema responseSchema（Gemini 會保證回傳符合此結構的 JSON）
 * @param tag    寫進 Logger 的識別字串，出事時要能一眼看出是誰在呼叫
 * @return {ok:true, data, model} 或 {ok:false, reason:'nokey'|'http'|'parse', code, body}
 *
 * ⚠ 抽出來的原因：模型名稱會過期，而且過期的方式不只一種——
 *   2026-08-25 一天之內就遇到 404（型號下架）與 503（暫時過載）兩種。
 *   模型輪替、失敗記錄、回應解析這三件事每個呼叫端都要做一遍，
 *   抄第二份的那一刻就會開始各自長歪（其中一份忘了輪替、另一份記錄格式不同）。
 *
 * ⚠ **順序是「已驗證的優先」不是「版本號最大優先」**，理由見 GEMINI_MODELS 的註解：
 *   把沒實測過的型號放第一順位，代價是每次呼叫都先白等一輪（實測慢 9 秒），
 *   而且結果是對的、只是慢，沒有人會回報。
 *
 * ⚠ 回傳刻意不含任何**使用者看得到的文案**：不同呼叫端的失敗訊息不一樣
 *   （截圖下單要說「改用下單頁」、Chat 問答要說「請用查詢頁」），
 *   在這裡寫死一種，第二個呼叫端就得繞過它。
 */
function callGeminiJson_(parts, schema, tag, opts) {
  opts = opts || {};
  var key = PropertiesService.getScriptProperties().getProperty(GEMINI_KEY_PROP);
  if (!key) {
    Logger.log('Gemini 未設定 ' + GEMINI_KEY_PROP + '｜' + tag);
    return { ok: false, reason: 'nokey', code: 0, body: '' };
  }

  // 時間預算：呼叫端有硬性時限時（Chat 外掛約 38 秒就被砍）用得上。
  //
  // ⚠ 這是**實測踩出來的**：2026-08-25 Chat 問答第一次上線，Gemini 剛好過載，
  //   第一個型號等了 37 秒才回 503、換第二個又 503，然後整支被
  //   「Exceeded maximum execution time」砍掉——使用者在 Chat 裡**完全沒有反應**，
  //   連錯誤訊息都看不到。沒設預算時維持原本行為（試完整份清單），
  //   因為截圖下單那邊使用者看著網頁等，多試幾個是划算的。
  var started = Date.now();
  var budget = Number(opts.deadlineMs || 0);
  var left = function () { return budget ? budget - (Date.now() - started) : Infinity; };

  // 依序試 GEMINI_MODELS 清單，第一個打不通就換下一個——404（型號不存在／已下架）
  // 與 503（暫時過載）都算「打不通」，用同一套退路處理：換一個型號通常比乾等或
  // 對同一個過載的型號重試更快解決，而且不需要 Utilities.sleep 拖長使用者等待時間。
  var models = opts.models || GEMINI_MODELS;
  var resp = null, lastCode = 0, lastBody = '', usedModel = '', ranOut = false;
  for (var m = 0; m < models.length; m++) {
    var model = models[m];
    // 沒把握在預算內跑完就不要開始——開始了卻被砍，使用者是零回應。
    // 門檻取 12 秒：實測正常回應約 8.6 秒，留一點組答案與回傳的時間。
    if (m > 0 && left() < 12000) {
      Logger.log('⏱ 時間預算剩 ' + Math.round(left() / 1000) + ' 秒，不再試下一個模型｜' + tag);
      ranOut = true;
      break;
    }
    var attempt;
    try {
      attempt = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model +
          ':generateContent?key=' + key,
        {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            contents: [{ parts: parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema
            }
          }),
          muteHttpExceptions: true
        }
      );
    } catch (e1) {
      Logger.log('Gemini 呼叫例外｜' + model + '｜' + e1);
      lastCode = 0; lastBody = String(e1);
      continue;
    }
    var attemptCode = attempt.getResponseCode();
    Logger.log('Gemini ' + tag + '｜' + model + '｜HTTP ' + attemptCode);
    if (attemptCode >= 200 && attemptCode < 300) {
      resp = attempt; usedModel = model;
      break;
    }
    lastCode = attemptCode;
    lastBody = attempt.getContentText();
    Logger.log('Gemini 失敗內容｜' + model + '｜' + lastBody.slice(0, 300));
  }

  if (!resp) {
    return { ok: false, reason: ranOut ? 'timeout' : 'http', code: lastCode, body: lastBody };
  }

  // 不是第一個模型才成功 → 留一行警告。連續看到這行代表第一個型號該從清單移除了。
  if (usedModel !== models[0]) {
    Logger.log('⚠ 第一個模型（' + models[0] + '）打不通，改用 ' + usedModel + ' 才成功。');
  }

  try {
    var data = JSON.parse(resp.getContentText());
    var raw = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!raw) throw new Error('回應內容為空');
    return { ok: true, data: JSON.parse(raw), model: usedModel };
  } catch (e2) {
    Logger.log('Gemini 回應解析失敗：' + e2 + '｜' + resp.getContentText().slice(0, 300));
    return { ok: false, reason: 'parse', code: 0, body: resp.getContentText() };
  }
}

function recognizeOrderImage(base64, mimeType) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分，未執行辨識。' };
  if (!salesFor_(email)) {
    return { ok: false, message: '您（' + email + '）不在路由對照表的業務 email 欄中，無法使用截圖下單。' };
  }

  if (!QUICK_IMG_MIME_OK[mimeType]) {
    return { ok: false, message: '只接受 JPG、PNG、WEBP 圖片，收到的是「' + mimeType + '」。' };
  }
  if (!base64) return { ok: false, message: '沒有收到圖片內容，請重新選擇檔案。' };

  var bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (e0) {
    return { ok: false, message: '圖片內容解不開，請重新選擇檔案。' };
  }
  if (bytes.length > QUICK_IMG_MAX_BYTES) {
    return { ok: false, message: '圖片 ' + Math.round(bytes.length / 1048576) +
      ' MB 超過上限 ' + (QUICK_IMG_MAX_BYTES / 1048576) + ' MB，請截小一點的範圍。' };
  }

  var key = PropertiesService.getScriptProperties().getProperty(GEMINI_KEY_PROP);
  if (!key) {
    return { ok: false, message: '未設定指令碼屬性 ' + GEMINI_KEY_PROP + '，無法辨識圖片。' };
  }

  var prompt =
    '這是一張 LINE 對話截圖，經銷商（鎖店）業務在跟客戶或同事討論進貨需求。' +
    '請用繁體中文輸出 JSON，欄位如下：\n' +
    '- customer：畫面最上方的聊天室名稱／對象名稱（不是對話內容裡的人名），原樣照抄，讀不到就留空字串\n' +
    '- items：品項陣列，每項含 model（型號，讀到的簡稱即可，例如「396」「D300」，不要自己補成完整料號）、' +
    'qty（數量，轉成數字，寫法可能是「×5」「*10組」「兩組」「+10」等）、' +
    'spec（顏色／連動或不連動／側板／配件等規格備註，原樣描述，讀不到就留空字串）\n' +
    '- note：讀到但不屬於任何單一品項的整體備註（例如日期要求、出貨方式），沒有就留空字串\n' +
    '- confidence：整體讀取把握，"high" 或 "low"\n\n' +
    '⚠ 對話可能跨好幾則才把一件事講完（例如「396兩組/黑」→「配件要嗎」→「不然各一」，' +
    '「各一」要對應回前面兩種配件各一份）。看得懂就寫進對應欄位，看不懂或不確定就把那個欄位' +
    '留空字串，並把 confidence 設為 "low"——寧可留空讓人補，不要用猜的填一個看起來合理但錯的值。\n' +
    '只輸出 JSON，不要其他文字。';

  var schema = {
    type: 'OBJECT',
    properties: {
      customer: { type: 'STRING' },
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            model: { type: 'STRING' },
            qty: { type: 'NUMBER' },
            spec: { type: 'STRING' }
          },
          required: ['model', 'qty', 'spec']
        }
      },
      note: { type: 'STRING' },
      confidence: { type: 'STRING' }
    },
    required: ['customer', 'items', 'note', 'confidence']
  };

  var got = callGeminiJson_(
    [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }],
    schema,
    '辨識呼叫｜' + email + '｜圖片 ' + Math.round(bytes.length / 1024) + ' KB');

  if (!got.ok) {
    return { ok: false, message: got.reason === 'parse'
      ? '辨識結果格式異常，請改用原本的下單頁手動輸入。'
      : '辨識服務目前打不通（HTTP ' + (got.code || '連線失敗') +
        '），請稍後再試或改用原本的下單頁。' };
  }
  var parsed = got.data;

  var items = [];
  var srcItems = (parsed && parsed.items) || [];
  for (var i = 0; i < srcItems.length; i++) {
    var it = srcItems[i] || {};
    items.push({
      model: String(it.model || '').trim(),
      qty: (typeof it.qty === 'number' && !isNaN(it.qty)) ? it.qty : '',
      spec: String(it.spec || '').trim()
    });
  }

  return {
    ok: true,
    customer: String((parsed && parsed.customer) || '').trim(),
    items: items,
    note: String((parsed && parsed.note) || '').trim(),
    confidence: ((parsed && parsed.confidence) === 'low') ? 'low' : 'high'
  };
}

/**
 * 業務確認截圖辨識結果後送出。回傳 {ok, message, caseNo}。
 *
 * 🔴 刻意不寫發包試算表：經銷商訂單不走發包單（使用者已確認），
 *   所以這支只碰出貨明細，跟簽核／報表／超額請款檢查完全不相干。
 *   反向驗證：送出後業務發包分頁的列數不該變。
 *
 * 沿用出貨明細既有的「發包單號留空＝助理從出貨頁直接建單」路徑
 * （見出貨登錄頁「已核准待出貨（舊流程）」那段既有說明），
 * 差別只在這裡是業務用截圖建立、不是助理手填。
 */
function submitQuickOrder(customer, items, note) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };

  var me = salesFor_(email);
  if (!me) {
    return { ok: false, message: '您（' + email + '）不在路由對照表的業務 email 欄中，無法下單。' };
  }

  customer = String(customer || '').trim();
  if (!customer) return { ok: false, message: '客戶為必填。' };

  items = items || [];
  var lines = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var model = String(it.model || '').trim();
    if (!model) continue;   // 空列（業務加了列但沒填）直接跳過，不當錯誤
    var qty = it.qty;
    var qtyOk = (qty !== '' && qty !== null && qty !== undefined && !isNaN(Number(qty)));
    var line = model + (qtyOk ? ' *' + Number(qty) : '');
    var spec = String(it.spec || '').trim();
    if (spec) line += '　' + spec;
    lines.push(line);
  }
  if (!lines.length) return { ok: false, message: '至少需要一個型號。' };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (errLock) {
    return { ok: false, message: '系統忙碌中（有人正在寫入），請稍候再試一次。' };
  }

  try {
    var s = openShipmentSheet_();
    var now = new Date();
    var stamp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm');
    var caseNo = nextCaseNo_(s, now);

    var rec = {};
    rec[COL_S_CASE_NO] = caseNo;
    rec[COL_S_AT] = stamp;
    rec[COL_S_CUSTOMER] = customer;
    rec[COL_S_ITEMS] = lines.join('\n');
    rec[COL_S_NOTE] = String(note || '').trim();
    rec[COL_S_ORDER_BY] = me.name || email;
    rec[COL_S_WH_STATUS] = WH_PENDING;
    // 發包單號、出貨單號刻意都留空：經銷商訂單沒有發包單，
    // 出貨單號等助理去 TipTop 開單後回填（既有的 fillShipment 流程）。

    var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
    var line = [];
    for (var w = 0; w < width; w++) line.push('');
    for (var key in rec) {
      var c = s.col[key];
      if (c && c <= width) line[c - 1] = rec[key];
    }
    s.sheet.appendRow(line);
    SpreadsheetApp.flush();

    try { CacheService.getScriptCache().remove(SHIP_CACHE_KEY); } catch (e3) {}

    try { appendAudit_(s.ss, { at: stamp, who: email, orderNo: caseNo, role: '業務',
      action: '截圖下單', note: customer, sheet: SHIPMENT_SHEET, row: '' }); }
    catch (e4) { Logger.log('截圖下單稽核寫入失敗（不影響下單）：' + e4); }

    // 🔴 這裡刻意不呼叫 notifyOrderSubmitted_：那支靠 codeOf_(orderNo) 從
    // 「代碼-日期-流水」格式的發包單號反解業務代碼，再去查對應助理。
    // 案件號是 IW+日期+流水，沒有連字號，codeOf_ 對它一定回空字串，
    // 通知會變成「查無對應助理」而永遠沒人被 @到。
    // submitQuickOrder 手上已經有 me（salesFor_ 查來的，本來就含 assist/assistMail），
    // 不需要反解代碼，直接用 me 自己組通知。
    try { notifyQuickOrder_(caseNo, customer, lines, me); }
    catch (e5) { Logger.log('截圖下單通知失敗（單已建立 ' + caseNo + '）：' + e5); }

    return { ok: true, message: '已建立 ' + caseNo + '，已通知助理鍵單。', caseNo: caseNo };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 截圖下單的通知。不走 notifyOrderSubmitted_（理由見呼叫端註解），
 * 直接用呼叫端已經查到的 me（該業務自己的路由紀錄）@提及對應助理。
 */
function notifyQuickOrder_(caseNo, customer, itemLines, me) {
  var uids = loadChatUids_();
  var lines = ['*新單（截圖下單，免簽核）*', ''];
  lines.push('• 案件號：' + caseNo);
  lines.push('• 客戶：' + customer);
  lines.push('• 品項：');
  for (var i = 0; i < itemLines.length; i++) lines.push('　' + itemLines[i]);
  lines.push('');

  if (me && me.assist) {
    lines.push('請 ' + mentionOf_(me.assistMail, me.assist, uids) + ' 鍵 TipTop 單號');
  } else {
    lines.push('⚠ 路由對照表沒有填「' + COL_R_ASSIST + '」，請人工確認由誰接手。');
  }

  var link = deepLink_({ page: 'ship', dn: caseNo });
  if (link) { lines.push(''); lines.push('<' + link + '|➡ 直接開這一筆鍵單>'); }

  return postWarehouseChat_(lines.join('\n'));
}

// ────────────────────────────────────────────── ④ 倉庫核單

/**
 * 待倉庫核單的出貨（讀出貨明細，狀態為「待核」或空白）。
 *
 * 為什麼把空白也算待核：助理登錄時會寫入「待核」，但如果有人手動補了一列
 * 而忘了填狀態，那一列就會永遠不出現在倉庫畫面上——是安靜的漏單。
 * 寧可多顯示，也不要漏。
 */
function getWarehousePending_() {
  var s = openShipmentSheet_();
  var last = s.sheet.getLastRow();
  if (last < 2) return [];

  var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
  var values = s.sheet.getRange(2, 1, last - 1, width).getValues();
  var out = [];

  var row = null;
  // 走 fmtWhen_ 而不是直接 String()：日期欄從試算表讀回來是 Date 物件，
  // String(Date) 會變成「Wed Aug 12 2026 09:18:00 GMT+0800 (台北標準時間)」
  // 直接印在倉庫核單卡片上。2026-08-25 實機截圖才發現——單元測試抓不到，
  // 因為 vm sandbox 的 Date 是另一個 realm，測試餵進來的是字串不是 Date。
  function pick(name) {
    var c = s.col[name];
    if (!c || c > row.length) return '';
    var v = row[c - 1];
    if (isDate_(v)) return fmtWhen_(v);
    return String(v == null ? '' : v).trim();
  }

  for (var i = 0; i < values.length; i++) {
    row = values[i];
    var shipNo = pick(COL_S_SHIP_NO);
    if (!shipNo) continue;
    var st = pick(COL_S_WH_STATUS);
    if (st && st !== WH_PENDING) continue;   // 已核或有問題都算處理完

    out.push({
      shipNo: shipNo,
      orderId: pick(COL_S_ORDER_ID),
      dispatchNo: pick(COL_S_DISPATCH),
      customer: pick(COL_S_CUSTOMER),
      project: pick(COL_S_PROJECT),
      items: pick(COL_S_ITEMS),
      toName: pick(COL_S_TO_NAME),
      toPhone: pick(COL_S_TO_PHONE),
      toAddr: pick(COL_S_TO_ADDR),
      invoice: pick(COL_S_INVOICE),
      // 只帶「有沒有上傳過」，不把 Drive 連結送到畫面上。
      // 連結進了 HTML 就等於進了瀏覽器紀錄與任何截圖，而它指向含客戶
      // 名稱、地址、金額、統編的檔案。倉庫要的只是「我傳過了沒」。
      invoiceUrl: pick(COL_S_INVOICE_URL) ? true : false,
      // 發票號碼本身直接顯示（跟上面的連結不同等級的敏感度）——
      // 顯示出來讓倉庫看得到自己之前打過的號碼，不必猜是不是重打了一次。
      invoiceNo: pick(COL_S_INVOICE_NO),
      note: pick(COL_S_NOTE),
      by: pick(COL_S_BY),
      at: pick(COL_S_AT),
      row: i + 2
    });
  }
  return out;
}

/** 待核單快取。與待簽核清單同樣的理由：掃表的往返成本不該讓倉庫每次等。 */
function getWarehouseCached_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(WH_CACHE_KEY);
    if (hit) {
      var obj = JSON.parse(hit);
      if (obj && obj.rows) return { rows: obj.rows, at: obj.at, cached: true };
    }
  } catch (err) {
    Logger.log('讀取倉庫快取失敗，改為即時掃描：' + err);
  }

  var rows = getWarehousePending_();
  var at = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  try {
    var payload = JSON.stringify({ rows: rows, at: at });
    if (payload.length <= CACHE_MAX_BYTES) cache.put(WH_CACHE_KEY, payload, CACHE_TTL);
    else Logger.log('⚠ 待核單 ' + payload.length + ' bytes 超過快取上限，本次未寫入快取。');
  } catch (err) {
    Logger.log('寫入倉庫快取失敗：' + err);
  }
  return { rows: rows, at: at, cached: false };
}

function invalidateWarehouseCache_() {
  try { CacheService.getScriptCache().remove(WH_CACHE_KEY); } catch (err) {}
}

/**
 * 倉庫核單寫入。
 *
 * 與簽核同一套安全模型：身分由伺服器取得、列號提示必須驗證出貨單號吻合、
 * 並發用 LockService、重讀當下狀態避免兩個人同時核。
 */
function submitWarehouse(shipNo, decision, note, hintRow) {
  return submitWarehouseAs_(currentUserEmail_(), shipNo, decision, note, hintRow);
}

/** 助理修正完資料後，把單子送回倉庫重新核。items 是修改後的出貨品項。 */
function reopenWarehouse(shipNo, items, hintRow) {
  return reopenWarehouseAs_(currentUserEmail_(), shipNo, items, hintRow);
}

/**
 * 把倉庫回報「有問題」的單改回「待核」，讓它重新出現在倉庫的清單裡。
 *
 * 🔴 **補的是一個資料黑洞**：在這支之前，倉庫按下「有問題」的單會同時從
 *   倉庫清單與助理清單消失，而且**全檔沒有任何函式能把狀態改回待核**——
 *   助理就算把資料修好了，也只能手動去改試算表（而且沒有人知道要去改）。
 *
 * ⚠ **問題說明刻意不清空**：倉庫重新看到這張單時，要知道上次是為什麼被退，
 *   否則他得從頭再判斷一次。稽核紀錄留的是「誰在什麼時候送回去的」，
 *   跟「上次的問題是什麼」是兩件事，不能互相取代。
 *
 * 權限閘門放在核心函式裡（比照 submitWarehouseAs_），換入口呼叫也受保護。
 */
function reopenWarehouseAs_(email, shipNo, items, hintRow) {
  if (!email) return { ok: false, message: '無法辨識身分，未執行。' };
  var roles = rolesFor_(email);
  if (!roles.assistant) {
    return { ok: false, message: '您（' + email + '）不在助理名單中，無法把單子送回倉庫。' };
  }
  shipNo = String(shipNo || '').trim();
  if (!shipNo) return { ok: false, message: '缺少出貨單號。' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (e) { return { ok: false, message: '系統忙碌中，請稍後再試。' }; }

  try {
    var s = openShipmentSheet_();
    var target = findShipmentRow_(s, shipNo, hintRow);
    if (!target) return { ok: false, message: '找不到出貨單號 ' + shipNo + '，可能已被刪除。' };

    // 重讀當下狀態：只有「有問題」的才能送回去。
    // 已核的送回去等於把倉庫做完的事推翻；待核的本來就在清單上，重送沒有意義。
    var now = String(s.sheet.getRange(target, s.col[COL_S_WH_STATUS]).getValue() || '').trim();
    if (now !== WH_ISSUE) {
      return { ok: false, message: '這筆目前是「' + (now || '（空白）') +
        '」，不是「' + WH_ISSUE + '」，不需要送回倉庫。（畫面請重新整理）' };
    }

    // 出貨品項有改就寫回去，並記下前後值。
    //
    // ⚠ 既有原則是「業務填的資料不讓助理改」（見 pendingShipBlock_ 的註解），
    //   但那條原則的**理由**是「改了業務不會知道」。倉庫退回來的單如果不能在
    //   這裡修，整條線就卡住——所以正確的解法不是禁止修改，是**讓業務知道**：
    //   前後值寫進稽核，並在通知裡明講改了什麼、@到業務本人。
    var oldItems = String(readShipmentRow_(s, target)[COL_S_ITEMS] || '').trim();
    var newItems = String(items == null ? '' : items).trim();
    var changed = !!(newItems && newItems !== oldItems);
    if (changed && s.col[COL_S_ITEMS]) {
      s.sheet.getRange(target, s.col[COL_S_ITEMS]).setValue(newItems);
    }

    s.sheet.getRange(target, s.col[COL_S_WH_STATUS]).setValue(WH_PENDING);
    // 核單人／時間清掉：那是上一次核單的人留下的，留著會讓人以為現在還是他負責
    if (s.col[COL_S_WH_BY]) s.sheet.getRange(target, s.col[COL_S_WH_BY]).setValue('');
    if (s.col[COL_S_WH_AT]) s.sheet.getRange(target, s.col[COL_S_WH_AT]).setValue('');
    SpreadsheetApp.flush();

    var rec = readShipmentRow_(s, target);
    rec[COL_S_WH_STATUS] = WH_PENDING;
    invalidateWarehouseCache_();

    var auditNote = changed
      ? '出貨品項：「' + oldItems + '」→「' + newItems + '」'
      : '未改動品項';
    try {
      auditShip_(s, target, rec, email, '助理', '重新送倉庫核', auditNote);
    } catch (eA) {
      Logger.log('重新送核稽核寫入失敗（狀態已改成功 ' + shipNo + '）：' + eA);
    }

    try {
      notifyShipReopened_(rec, target, changed ? { from: oldItems, to: newItems } : null);
    } catch (e2) {
      Logger.log('重新送核通知失敗（狀態已改成功）：' + e2);
    }

    return { ok: true, message: '已把 ' + shipNo + ' 送回倉庫待核' +
      (changed ? '（品項已更新，已通知業務）' : '') + '。' };
  } catch (err) {
    return { ok: false, message: '送回倉庫失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 倉庫核單核心。身分由呼叫端指定，理由與底線的意義見 submitDecisionAs_ 上方註解。
 * 倉庫名單檢查（rolesFor_(email).warehouse）留在這支裡面，所有入口共用同一道閘門。
 */
function submitWarehouseAs_(email, shipNo, decision, note, hintRow) {
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };
  if (!rolesFor_(email).warehouse) {
    return { ok: false, message: '您（' + email + '）不在倉庫名單中，未寫入任何資料。' };
  }

  shipNo = String(shipNo || '').trim();
  if (!shipNo) return { ok: false, message: '缺少出貨單號。' };
  if (decision !== 'done' && decision !== 'issue') {
    return { ok: false, message: '未知的動作：' + decision };
  }
  note = String(note || '').trim();
  if (decision === 'issue' && !note) {
    return { ok: false, message: '回報問題必須填寫說明，讓助理知道要處理什麼。' };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return { ok: false, message: '系統忙碌中，請稍候再試。' }; }

  try {
    var s = openShipmentSheet_();
    var cNo = s.col[COL_S_SHIP_NO];
    if (!cNo) return { ok: false, message: '出貨明細找不到「' + COL_S_SHIP_NO + '」欄。' };
    if (!s.col[COL_S_WH_STATUS]) {
      return { ok: false, message: '出貨明細找不到「' + COL_S_WH_STATUS + '」欄，未寫入任何資料。' };
    }

    // 找列的邏輯與 uploadInvoice 共用（findShipmentRow_）。同一件事留兩份實作，
    // 日後只改一邊就會出現「上傳找得到、核單找不到」這種最難查的不一致。
    var target = findShipmentRow_(s, shipNo, hintRow);
    if (!target) return { ok: false, message: '找不到出貨單號 ' + shipNo + '，可能已被刪除。' };

    // 重讀當下狀態：兩個倉庫人員可能同時開著頁面
    var already = String(s.sheet.getRange(target, s.col[COL_S_WH_STATUS]).getValue() || '').trim();
    if (already && already !== WH_PENDING) {
      return { ok: false, message: '這筆已經處理過了：' + already + '（畫面請重新整理）' };
    }

    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var status = (decision === 'done') ? WH_DONE : WH_ISSUE;

    s.sheet.getRange(target, s.col[COL_S_WH_STATUS]).setValue(status);
    if (s.col[COL_S_WH_BY]) s.sheet.getRange(target, s.col[COL_S_WH_BY]).setValue(email);
    if (s.col[COL_S_WH_AT]) s.sheet.getRange(target, s.col[COL_S_WH_AT]).setValue(stamp);
    if (note && s.col[COL_S_WH_NOTE]) {
      s.sheet.getRange(target, s.col[COL_S_WH_NOTE]).setValue(note);
    }
    SpreadsheetApp.flush();

    // 讀回整列來組通知，確保通知內容與表上實際資料一致
    var rec = readShipmentRow_(s, target);
    rec[COL_S_WH_STATUS] = status;
    rec[COL_S_WH_BY] = email;
    rec[COL_S_WH_AT] = stamp;
    rec[COL_S_WH_NOTE] = note;

    removeFromWarehouseCache_(shipNo);

    // 稽核：核單狀態欄只留最後結果，「有問題→再核過」的歷程只有這裡留得住
    try {
      auditShip_(s, target, rec, email, '倉庫',
        decision === 'done' ? '核單通過' : '核單回報問題', note);
    } catch (eA) {
      Logger.log('倉庫核單稽核寫入失敗（核單本身已成功 ' + shipNo + '）：' + eA);
    }

    // 通知整段包 try：它是附加動作，壞掉不該讓一次已寫入成功的核單被回報成失敗
    try {
      if (decision === 'done') notifyShipmentArchive_(rec);
      else notifyShipmentIssue_(rec);
    } catch (e2) {
      Logger.log('倉庫核單通知失敗（核單已寫入成功）：' + e2);
    }

    return {
      ok: true,
      message: (decision === 'done')
        ? '已核 ' + shipNo + '，完整出貨資訊已送到 Chat 備存。'
        : '已回報問題 ' + shipNo + '，已通知助理與業務。'
    };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 上傳發票電子檔。倉庫核單頁用。
 *
 * 檔案放進使用者自己建立的 Drive 資料夾（指令碼屬性 DISPATCH_INVOICE_FOLDER_ID），
 * **權限完全由那個資料夾決定，本函式不碰任何分享設定**——見 INVOICE_FOLDER_PROP 的說明。
 *
 * 連結寫回出貨明細的「發票檔案」欄，核單完成的備存通知會帶上它。
 * 助理從 Chat 點連結自己下載自己寄，倉庫不必再印、不必再問要紙本還是電子檔。
 */
function uploadInvoice(shipNo, fileName, mimeType, base64, hintRow, invoiceNo) {
  var email = currentUserEmail_();
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };
  if (!rolesFor_(email).warehouse) {
    return { ok: false, message: '您（' + email + '）不在倉庫名單中，未寫入任何資料。' };
  }

  shipNo = String(shipNo || '').trim();
  if (!shipNo) return { ok: false, message: '缺少出貨單號。' };
  invoiceNo = String(invoiceNo || '').trim();
  var hasFile = !!base64;
  // 檔案跟號碼是兩件獨立的事：可能先拿到號碼、檔案晚一步才有，或反過來。
  // 只要求「至少給一個」，不強迫兩個一起送。
  if (!hasFile && !invoiceNo) {
    return { ok: false, message: '請至少填發票號碼或選擇檔案。' };
  }

  var ext, safeName, finalName = '', folderId, bytes;
  if (hasFile) {
    mimeType = String(mimeType || '').trim();
    if (!INVOICE_MIME_OK[mimeType]) {
      return { ok: false, message: '只接受 PDF、JPG、PNG，收到的是「' + (mimeType || '未知') + '」。' };
    }

    folderId = String(
      PropertiesService.getScriptProperties().getProperty(INVOICE_FOLDER_PROP) || '').trim();
    if (!folderId) {
      return { ok: false, message:
        '尚未設定發票資料夾（指令碼屬性 ' + INVOICE_FOLDER_PROP + '）。' +
        '請先在雲端硬碟建一個資料夾、設好權限，再把資料夾 ID 填進去。' };
    }

    try { bytes = Utilities.base64Decode(base64); }
    catch (e0) { return { ok: false, message: '檔案內容解不開，請重新選擇檔案。' }; }
    if (bytes.length > INVOICE_MAX_BYTES) {
      return { ok: false, message: '檔案 ' + Math.round(bytes.length / 1048576) +
        ' MB 超過上限 ' + (INVOICE_MAX_BYTES / 1048576) + ' MB。' };
    }
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (e1) { return { ok: false, message: '系統忙碌中，請稍候再試。' }; }

  try {
    var s = openShipmentSheet_();
    if (hasFile && !s.col[COL_S_INVOICE_URL]) {
      return { ok: false, message: '出貨明細找不到「' + COL_S_INVOICE_URL + '」欄，未上傳任何檔案。' };
    }
    if (invoiceNo && !s.col[COL_S_INVOICE_NO]) {
      return { ok: false, message: '出貨明細找不到「' + COL_S_INVOICE_NO + '」欄，未寫入發票號碼。' };
    }
    var target = findShipmentRow_(s, shipNo, hintRow);
    if (!target) return { ok: false, message: '找不到出貨單號 ' + shipNo + '，可能已被刪除。' };

    var url = '';
    if (hasFile) {
      // 檔名帶出貨單號，這樣光看雲端硬碟就分得出哪張是哪張，不必回系統查
      ext = INVOICE_MIME_OK[mimeType];
      safeName = String(fileName || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
      if (!safeName) safeName = '發票' + ext;
      var stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');
      finalName = shipNo + '_' + stamp + '_' + safeName;

      var folder;
      try { folder = DriveApp.getFolderById(folderId); }
      catch (e2) {
        return { ok: false, message:
          '打不開發票資料夾（ID 可能填錯，或這支程式的執行帳號沒有權限）：' + e2 };
      }

      // ⚠ 只 createFile，不呼叫 setSharing——權限交給資料夾，見上方說明
      var file = folder.createFile(Utilities.newBlob(bytes, mimeType, finalName));
      url = file.getUrl();
      s.sheet.getRange(target, s.col[COL_S_INVOICE_URL]).setValue(url);
    }
    if (invoiceNo) {
      s.sheet.getRange(target, s.col[COL_S_INVOICE_NO]).setValue(invoiceNo);
    }
    SpreadsheetApp.flush();
    try { CacheService.getScriptCache().remove(WH_CACHE_KEY); } catch (e3) {}
    Logger.log('發票登錄：' + shipNo + '｜' +
      (hasFile ? '檔案 ' + finalName : '') + (invoiceNo ? '　號碼 ' + invoiceNo : '') +
      '｜' + email);

    // 稽核：原本只寫 Logger，但執行紀錄只留 30 天，發票是金流憑證，要留在表裡
    try {
      auditShip_(s, target, readShipmentRow_(s, target), email, '助理', '登錄發票',
        (hasFile ? '檔案 ' + finalName : '') + (invoiceNo ? (hasFile ? '｜' : '') + '號碼 ' + invoiceNo : ''));
    } catch (eA) {
      Logger.log('發票稽核寫入失敗（發票本身已登錄 ' + shipNo + '）：' + eA);
    }

    var msg = [];
    if (hasFile) msg.push('已上傳 ' + finalName);
    if (invoiceNo) msg.push('已登錄發票號碼 ' + invoiceNo);
    return { ok: true, url: url, name: finalName, invoiceNo: invoiceNo,
      message: msg.join('，') + '，核單時會一起送出。' };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}
/** 這一欄是不是「退單申請中」。與 isApproved_ 同一個寫法：靠開頭字元判斷。 */
function isReturning_(v) {
  return /^🔄/.test(String(v || '').trim());
}

/**
 * 申請退單。任何人都可以發起（2026-08-20 使用者確認），但**發起人一律由伺服器取得**，
 * 不接受前端指定——不限制身分不等於可以冒名。
 */
function requestReturn(shipNo, reason, hintRow) {
  return requestReturnAs_(currentUserEmail_(), shipNo, reason, hintRow);
}

/**
 * 退單申請核心。身分由呼叫端指定，底線的意義見 submitDecisionAs_ 上方註解。
 *
 * ⚠ 這支**不會改動倉庫核單狀態**。使用者確認退單「什麼階段都有」，
 *   如果貨已經出去了才退單，把倉庫狀態重置成「待核」會讓倉庫以為要再撿一次料。
 *   實體動作已經發生的事只能記錄，不能假裝沒發生——要不要重走倉庫由人決定。
 */
function requestReturnAs_(email, shipNo, reason, hintRow) {
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };

  shipNo = String(shipNo || '').trim();
  if (!shipNo) return { ok: false, message: '缺少出貨單號。' };
  reason = String(reason || '').trim();
  // 與簽核退回、倉庫回報問題同一條規矩：沒有原因，收到的人不知道要改什麼。
  if (!reason) return { ok: false, message: '退單必須填寫原因，讓助理知道要改什麼。' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return { ok: false, message: '系統忙碌中，請稍候再試。' }; }

  try {
    var s = openShipmentSheet_();
    if (!s.col[COL_S_SHIP_NO]) {
      return { ok: false, message: '出貨明細找不到「' + COL_S_SHIP_NO + '」欄。' };
    }
    if (!s.col[COL_S_RETURN]) {
      return { ok: false, message: '出貨明細找不到「' + COL_S_RETURN + '」欄，未寫入任何資料。' };
    }

    var target = findShipmentRow_(s, shipNo, hintRow);
    if (!target) return { ok: false, message: '找不到出貨單號 ' + shipNo + '，可能已被刪除。' };

    // 重讀當下狀態：兩個人可能同時開著查詢頁對同一張單按退單
    var already = String(s.sheet.getRange(target, s.col[COL_S_RETURN]).getValue() || '').trim();
    if (isReturning_(already)) {
      return { ok: false, message: '這張單已經在退單中了：' + already + '（畫面請重新整理）' };
    }

    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    // 發起人可能是業務、助理、倉庫或客服，salesFor_ 只查得到業務，
    // 查不到就退回 email——顯示名稱不完美好過整支壞掉。
    var sales = salesFor_(email);
    var byName = (sales && sales.name) ? sales.name : email;
    var value = '🔄 退單 ' + byName + ' ' + stamp + '｜' + reason;

    s.sheet.getRange(target, s.col[COL_S_RETURN]).setValue(value);
    SpreadsheetApp.flush();

    var rec = readShipmentRow_(s, target);
    rec[COL_S_RETURN] = value;

    // 稽核：退單欄之後會被「已處理」覆蓋掉，所以「誰申請、為什麼」只有這裡留得住
    try {
      auditShip_(s, target, rec, email, '退單申請', '申請退單', reason);
    } catch (eA) {
      Logger.log('退單申請稽核寫入失敗（退單本身已成功 ' + shipNo + '）：' + eA);
    }

    // 通知包 try：退單已經記錄成功了，通知壞掉不該回報成失敗而讓人再按一次
    try {
      notifyReturnRequest_(rec, target, reason, byName, stamp);
    } catch (eN) {
      Logger.log('退單通知失敗（已寫入 ' + shipNo + '）：' + eN);
    }

    return { ok: true, message: '已送出退單申請：' + shipNo + '　' + reason };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 標記退單已處理（助理去 TipTop 改完之後回來按）。
 *
 * 沒有這一步的話，退單欄會永遠停在 🔄，看表的人分不出「還沒處理」和「處理完沒人回報」——
 * 那就跟在群組裡講一句話沒兩樣，只是換個地方留言而已。閉環才是這功能的價值。
 */
function resolveReturn(shipNo, hintRow) {
  return resolveReturnAs_(currentUserEmail_(), shipNo, hintRow);
}

/** 標記退單已處理的核心。底線的意義見 submitDecisionAs_ 上方註解。 */
function resolveReturnAs_(email, shipNo, hintRow) {
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };

  shipNo = String(shipNo || '').trim();
  if (!shipNo) return { ok: false, message: '缺少出貨單號。' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return { ok: false, message: '系統忙碌中，請稍候再試。' }; }

  try {
    var s = openShipmentSheet_();
    if (!s.col[COL_S_RETURN]) {
      return { ok: false, message: '出貨明細找不到「' + COL_S_RETURN + '」欄。' };
    }
    var target = findShipmentRow_(s, shipNo, hintRow);
    if (!target) return { ok: false, message: '找不到出貨單號 ' + shipNo + '，可能已被刪除。' };

    var cur = String(s.sheet.getRange(target, s.col[COL_S_RETURN]).getValue() || '').trim();
    if (!isReturning_(cur)) {
      return { ok: false, message: '這張單目前不在退單中，沒有東西要標記。（畫面請重新整理）' };
    }

    // 把原本的原因留下來——處理完了還是要看得出當初為什麼退，
    // 蓋掉的話稽核軌跡就斷在這裡了。
    var reason = cur.indexOf('｜') >= 0 ? cur.slice(cur.indexOf('｜') + 1) : '';
    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var sales = salesFor_(email);
    var byName = (sales && sales.name) ? sales.name : email;
    var value = '✅ 已處理 ' + byName + ' ' + stamp + (reason ? '｜' + reason : '');

    s.sheet.getRange(target, s.col[COL_S_RETURN]).setValue(value);
    SpreadsheetApp.flush();

    // 稽核：這一步把退單欄從「🔄 申請中」改寫成「✅ 已處理」，
    // 是流程上最後一次改動退單欄，不記就查不到是誰結掉的
    try {
      auditShip_(s, target, readShipmentRow_(s, target), email, '退單處理',
        '退單標記已處理', reason ? '原退單原因：' + reason : '');
    } catch (eA) {
      Logger.log('退單處理稽核寫入失敗（標記本身已成功 ' + shipNo + '）：' + eA);
    }

    try {
      var rec = readShipmentRow_(s, target);
      var lines = ['*✅ 退單已處理*', ''];
      lines.push('• 出貨單號：' + shipNo);
      if (rec[COL_S_CUSTOMER]) lines.push('• 客戶：' + rec[COL_S_CUSTOMER]);
      if (reason) lines.push('• 原退單原因：' + reason);
      lines.push('• 處理：' + byName + '　' + stamp);
      postWarehouseChat_(lines.join('\n'));
    } catch (eN) {
      Logger.log('退單處理通知失敗（已寫入 ' + shipNo + '）：' + eN);
    }

    return { ok: true, message: '已標記處理完成：' + shipNo };
  } catch (err) {
    return { ok: false, message: '寫入失敗：' + err };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 依出貨單號找列。hintRow 只用來省一次搜尋，一律驗證那一格吻合，
 * 不吻合就當提示不存在走完整搜尋——提示不能讓它指向別的列。
 */
function findShipmentRow_(s, shipNo, hintRow) {
  var cNo = s.col[COL_S_SHIP_NO];
  if (!cNo) return 0;
  var last = s.sheet.getLastRow();
  var hr = Number(hintRow || 0);
  if (hr >= 2 && hr <= last) {
    if (String(s.sheet.getRange(hr, cNo).getValue() || '').trim() === shipNo) return hr;
  }
  if (last < 2) return 0;
  var all = s.sheet.getRange(2, cNo, last - 1, 1).getValues();
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][0] || '').trim() === shipNo) return i + 2;
  }
  return 0;
}

/** 讀出貨明細的一整列，回傳 {欄名: 值} */
function readShipmentRow_(s, row) {
  var width = Math.max(s.sheet.getLastColumn(), SHIPMENT_HEADERS.length);
  var vals = s.sheet.getRange(row, 1, 1, width).getValues()[0];
  var rec = {};
  for (var i = 0; i < SHIPMENT_HEADERS.length; i++) {
    var name = SHIPMENT_HEADERS[i];
    var c = s.col[name];
    var v = (c && c <= vals.length) ? vals[c - 1] : '';
    // ⚠ Date 一定要走 fmtDate_，不能用 String() 硬轉——
    //   String(new Date()) 會變成「Wed Aug 12 2026 09:18:00 GMT+0800 (台北標準時間)」
    //   那一長串直接出現在 Chat 通知裡（2026-08-25 真實通知截圖看到）。
    //   這支被 11 個地方共用（通知、稽核、退單…），所以修在這裡一次解決。
    //   其他讀表的地方（buildShipIndex_、getPendingShipments_）本來就這樣做，
    //   是這支漏了。
    rec[name] = fmtWhen_(v);
  }
  return rec;
}

/** 從待核快取移除某筆（核完就不該再出現） */
function removeFromWarehouseCache_(shipNo) {
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(WH_CACHE_KEY);
    if (!hit) return;
    var obj = JSON.parse(hit);
    if (!obj || !obj.rows) return;
    var out = [];
    for (var i = 0; i < obj.rows.length; i++) {
      if (obj.rows[i].shipNo !== shipNo) out.push(obj.rows[i]);
    }
    obj.rows = out;
    cache.put(WH_CACHE_KEY, JSON.stringify(obj), CACHE_TTL);
  } catch (err) {
    Logger.log('更新倉庫快取失敗，改為清除：' + err);
    invalidateWarehouseCache_();
  }
}

/**
 * 倉庫核單完成 → 推完整出貨資訊。
 * **這則訊息就是取代 Teams 備存的那一則**，所以要完整、可日後搜尋。
 */
function notifyShipmentArchive_(rec) {
  var lines = ['*出貨完成（備存）*', ''];
  lines.push('出貨單號：' + rec[COL_S_SHIP_NO]);
  if (rec[COL_S_ORDER_ID]) lines.push('訂單編號：' + rec[COL_S_ORDER_ID]);
  if (rec[COL_S_DISPATCH]) lines.push('發包單號：' + rec[COL_S_DISPATCH]);
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
    if (rec[COL_S_TO_NAME]) {
      lines.push(rec[COL_S_TO_NAME] + (rec[COL_S_TO_PHONE] ? '　' + rec[COL_S_TO_PHONE] : ''));
    }
    if (rec[COL_S_TO_ADDR]) lines.push(rec[COL_S_TO_ADDR]);
  }
  if (rec[COL_S_INVOICE]) { lines.push(''); lines.push('發票：' + rec[COL_S_INVOICE]); }
  // 發票號碼是倉庫的工作（2026-08-14 確認），放進備存訊息才有地方可查——
  // 之前只存了發票別（格式分類）跟檔案連結，號碼本身完全沒進系統，查詢頁查不到。
  lines.push('發票號碼：' + (rec[COL_S_INVOICE_NO] || '未登錄'));
  // 發票電子檔連結。助理點這條自己下載自己寄，倉庫不必再印、不必再問要紙本還是電子檔。
  // 沒上傳就明講「未上傳」——留白會讓人以為是自己漏看，然後又跑去問倉庫。
  // 組成 Chat 的連結格式 <網址|文字>，點一下就開得起來。
  // 裸網址雖然多半會自動變連結，但那串 Drive 網址很長，會把整則通知撐開。
  lines.push('發票電子檔：' + invoiceLink_(rec[COL_S_INVOICE_URL]));
  if (rec[COL_S_NOTE]) lines.push('備註：' + rec[COL_S_NOTE]);
  lines.push('');
  lines.push('登錄：' + rec[COL_S_BY] + '　' + rec[COL_S_AT]);
  lines.push('倉庫核單：' + rec[COL_S_WH_BY] + '　' + rec[COL_S_WH_AT]);

  return postWarehouseChat_(lines.join('\n'));
}

/**
 * 助理修正完、把單子送回倉庫時的通知。
 *
 * ⚠ **刻意不複用 `notifyWarehouse_`**：那支的標題是「新出貨單待核」，
 *   但這是一張**退回來又修好的單**。用同一則訊息會讓倉庫分不出
 *   「這是新的」還是「這是我剛退回去的那張」——後者他要對照上次的問題再看一次。
 *
 * ⚠ **改了什麼一定要寫出來、而且要 @到業務**：既有原則是「業務的資料不讓助理改，
 *   因為改了業務不會知道」。這裡允許改，那就必須補上「讓業務知道」這一半，
 *   否則等於把那條原則的保護拆掉卻沒有補回來。
 */
function notifyShipReopened_(rec, row, change) {
  var uids = loadChatUids_();
  var lines = ['*🔄 退回的單已修正，重新送核*', ''];
  lines.push('出貨單號：' + rec[COL_S_SHIP_NO]);
  if (rec[COL_S_CUSTOMER]) lines.push('客戶：' + rec[COL_S_CUSTOMER]);
  lines.push('');
  if (rec[COL_S_WH_NOTE]) {
    lines.push('上次倉庫回報：' + rec[COL_S_WH_NOTE]);
  }
  if (change) {
    lines.push('已修正 — 出貨品項：');
    lines.push('　原：' + (change.from || '（空白）'));
    lines.push('　新：' + change.to);
  } else {
    lines.push('（助理未改動品項，可能是其他欄位或外部因素已排除）');
  }
  lines.push('');
  lines.push('出貨品項：');
  lines.push(rec[COL_S_ITEMS]);
  lines.push('');
  // 找不到業務時不要加「請確認」——那句是講給業務聽的，
  // 沒有業務可對的時候接在後面只是一句對著空氣說的話。
  var sl = salesLine_(rec, uids);
  lines.push(sl.text + (sl.found ? '　← 你的單被改過，請確認' : ''));
  lines.push('登錄：' + rec[COL_S_BY] + '　' + rec[COL_S_AT]);

  var link = deepLink_({ page: 'warehouse', ship: rec[COL_S_SHIP_NO], rw: row || '' });
  if (link) {
    lines.push('');
    lines.push('<' + link + '|➡ 開這一筆重新核單>');
  }
  return postWarehouseChat_(lines.join('\n'));
}

/**
 * 通知裡的「業務：」那一行——找出這張出貨單該點名哪位業務。
 *
 * 🔴 **修的是一個實際的通知缺漏**（2026-08-25 真實通知截圖看到）：
 *   原本只會「從發包單號反解代碼再查對照表」，沒有發包單號就直接印
 *   「（無發包單號，無法自動點名業務）」——而**沒有發包單號的出貨約佔一半**
 *   （料件出貨、截圖下單、弱電料件、鎖胚、建案整批本來就不走發包單）。
 *   等於有一半的出貨出問題時，業務根本不會被通知到。
 *
 * 🔑 **資料一直都在，只是通知沒讀它**：出貨明細有「下單業務」欄，
 *   submitOrder 與 submitQuickOrder 都會寫入。報表那邊早就用對了
 *   （見 reportBlock_ 的「業務歸屬：優先用『下單業務』，沒有就用發包單號前綴查」），
 *   通知這邊卻沒跟上。這裡沿用報表那套已驗證的優先序。
 */
function salesLine_(rec, uids) {
  var roster = {};
  try { roster = loadRoster_(); } catch (err) { Logger.log('讀人員代碼失敗：' + err); }

  // ① 下單業務（業務自己下單時帶入的姓名）——沒有發包單號的單只有這個
  var who = String(rec[COL_S_ORDER_BY] || '').trim();
  if (who) {
    // 有姓名就再查一次 email，才能真的 @到人而不只是寫名字
    for (var code in roster) {
      if (!Object.prototype.hasOwnProperty.call(roster, code)) continue;
      if (roster[code].sales === who && roster[code].salesMail) {
        return { text: '業務：' + mentionOf_(roster[code].salesMail, who, uids), found: true };
      }
    }
    return { text: '業務：' + who + '（對照表查無 email，無法 @到本人）', found: true };
  }

  // ② 退回原本的做法：從發包單號前綴反解代碼
  var dispatchNo = String(rec[COL_S_DISPATCH] || '').trim();
  if (dispatchNo) {
    var c = codeOf_(dispatchNo);
    var hit = c ? roster[c] : null;
    if (hit && (hit.sales || hit.salesMail)) {
      return { text: '業務：' + mentionOf_(hit.salesMail, hit.sales || hit.salesMail, uids),
               found: true };
    }
    if (c) {
      return { text: '業務：代碼 ' + c + ' 查無對應（請補「人員代碼」對照表）', found: false };
    }
  }

  // ③ 兩條路都沒有。**明講而不是靜默略過**——業務不知道自己的單卡住了，
  //    比訊息裡多一行難看的字糟得多。
  return { text: '業務：查不到（這張單沒有「下單業務」也沒有發包單號）', found: false };
}

/**
 * 發票電子檔在 Chat 訊息裡的呈現。
 *
 * ⚠ 「未上傳」這三個字很重要，不要改成留白：倉庫核完單之後，
 *   這則備存通知是唯一會提醒「這張單的發票還沒進系統」的地方。
 *   留白的話沒有人會發現漏了。
 */
function invoiceLink_(url) {
  url = String(url || '').trim();
  if (!url) return '未上傳';
  return '<' + url + '|📄 開啟發票>';
}

/**
 * 倉庫回報問題 → 通知助理與業務。
 * 點名登錄人（助理）；業務靠發包單號前綴查人員代碼對照表。
 */
function notifyShipmentIssue_(rec) {
  var lines = ['*⚠ 出貨有問題*', ''];
  lines.push('出貨單號：' + rec[COL_S_SHIP_NO]);
  if (rec[COL_S_CUSTOMER]) lines.push('客戶：' + rec[COL_S_CUSTOMER]);
  lines.push('');
  lines.push('問題說明：' + rec[COL_S_WH_NOTE]);
  lines.push('');
  lines.push('出貨項目：');
  lines.push(rec[COL_S_ITEMS]);
  lines.push('');
  // 登錄人（助理）是要動手處理的人，@提及本人而不只是寫名字
  var uids = loadChatUids_();
  lines.push('請 ' + mentionOf_(rec[COL_S_BY], rec[COL_S_BY] || '登錄人', uids) +
    ' 處理（登錄人）');

  lines.push(salesLine_(rec, uids).text);
  lines.push('倉庫回報：' + rec[COL_S_WH_BY] + '　' + rec[COL_S_WH_AT]);

  var link = deepLink_({ page: 'ship', ship: rec[COL_S_SHIP_NO] });
  if (link) {
    lines.push('');
    lines.push('<' + link + '|➡ 開這一筆出貨明細>');
  }

  return postWarehouseChat_(lines.join('\n'));
}

/**
 * 退單申請的 Chat 通知。
 *
 * 這一則的存在理由，就是要取代群組裡那句「Molly Hsu 麻煩退單 改出貨單備註 謝謝哦」——
 * 同樣是 @人 說要退單，差別在於它有單號、有原因、有連結、而且留得下軌跡。
 *
 * @提及對象是**助理**（退單要她去 TipTop 改），依發包單號的業務代碼查路由對照表。
 * 沒有發包單號的出貨（弱電料件、鎖胚、建案整批）查不到對應助理，
 * 退回 DISPATCH_ASSISTANTS 整份名單——寧可多 ping 幾個人，也不要沒有人被通知。
 */
function notifyReturnRequest_(rec, row, reason, byName, stamp) {
  var uids = loadChatUids_();
  var shipNo = rec[COL_S_SHIP_NO];

  var lines = ['*🔄 退單申請*', ''];
  lines.push('• 出貨單號：' + shipNo);
  if (rec[COL_S_DISPATCH]) lines.push('• 發包單號：' + rec[COL_S_DISPATCH]);
  if (rec[COL_S_CUSTOMER]) {
    lines.push('• 客戶：' + rec[COL_S_CUSTOMER] +
      (rec[COL_S_PROJECT] ? '（' + rec[COL_S_PROJECT] + '）' : ''));
  }
  if (rec[COL_S_ITEMS]) lines.push('• 品項：' + rec[COL_S_ITEMS]);
  lines.push('• 🔴 退單原因：' + reason);
  lines.push('• 申請：' + byName + '　' + stamp);

  // 倉庫已經核過的單要特別提醒：貨可能已經動了，不是改一改就沒事
  var whStatus = String(rec[COL_S_WH_STATUS] || '').trim();
  if (whStatus && whStatus !== WH_PENDING) {
    lines.push('');
    lines.push('⚠ 這張單倉庫已經是「' + whStatus + '」，貨可能已經出了，請一併確認。');
  }

  lines.push('');
  var person = null;
  try {
    person = loadRoster_()[codeOf_(rec[COL_S_DISPATCH] || '')] || null;
  } catch (err) {
    Logger.log('（退單通知讀路由對照表失敗，改用助理名單）' + err);
  }
  if (person && person.assist) {
    lines.push('請 ' + mentionOf_(person.assistMail, person.assist, uids) + ' 到 TipTop 退單處理');
  } else {
    var at = mentionsFromProp_('DISPATCH_ASSISTANTS');
    lines.push('請助理到 TipTop 退單處理' + (at ? '　' + at : ''));
  }

  var link = deepLink_({ page: 'ship', ship: shipNo });
  if (link) { lines.push(''); lines.push('<' + link + '|➡ 開這一筆出貨明細>'); }

  return postWarehouseChat_(lines.join('\n'));
}

/** 送到倉庫 Chat 空間。webhook 未設就回報未送出，不假裝成功。 */
function postWarehouseChat_(text) {
  var webhook = PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_WAREHOUSE_WEBHOOK');
  if (!webhook) {
    Logger.log('未設定 DISPATCH_WAREHOUSE_WEBHOOK，通知未送出。');
    return { sent: false, reason: '未設定 DISPATCH_WAREHOUSE_WEBHOOK' };
  }
  var resp = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var ok = code >= 200 && code < 300;
  if (!ok) Logger.log('倉庫 Chat 通知失敗 HTTP ' + code + '｜' + resp.getContentText().slice(0, 200));
  return { sent: ok, status: code };
}

/**
 * 助理補 TipTop 產生的單號到既有的出貨明細列（業務已下單的那些）。
 *
 * 與 submitShipment 分開：那支是「從頭建一列」（無發包單的出貨、舊資料），
 * 這支是「補三個欄位」。混成一支會讓參數語意變成「有 row 就更新、沒有就新增」，
 * 而那種函式最容易在邊界出錯——尤其這裡的邊界是「會不會覆蓋業務填的資料」。
 */
function fillShipment(hintRow, form) {
  return fillShipmentAs_(currentUserEmail_(), hintRow, form);
}

/**
 * 助理鍵單核心。身分由呼叫端指定，理由與底線的意義見 submitDecisionAs_ 上方註解。
 * 助理名單檢查（rolesFor_(email).assistant）留在這支裡面，所有入口共用同一道閘門。
 */
function fillShipmentAs_(email, hintRow, form) {
  if (!email) return { ok: false, message: '無法辨識身分，未寫入任何資料。' };
  if (!rolesFor_(email).assistant) {
    return { ok: false, message: '您（' + email + '）不在助理名單中，未寫入任何資料。' };
  }

  form = form || {};
  var shipNo = String(form.shipNo || '').trim();
  if (!shipNo) return { ok: false, message: '出貨單號為必填。' };
  var row = Number(hintRow || 0);
  if (row < 2) return { ok: false, message: '缺少目標列。' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return { ok: false, message: '系統忙碌中，請稍候再試。' }; }

  try {
    var s = openShipmentSheet_();
    var last = s.sheet.getLastRow();
    if (row > last) return { ok: false, message: '目標列不存在（畫面請重新整理）。' };
    var cNo = s.col[COL_S_SHIP_NO];
    if (!cNo) return { ok: false, message: '出貨明細找不到「' + COL_S_SHIP_NO + '」欄。' };

    // 重讀：兩個助理可能同時開著頁面
    var already = String(s.sheet.getRange(row, cNo).getValue() || '').trim();
    if (already) {
      return { ok: false, message: '這筆已經鍵入過了（出貨單號 ' + already + '），畫面請重新整理。' };
    }

    // 出貨單號全表唯一
    if (last >= 2) {
      var exist = s.sheet.getRange(2, cNo, last - 1, 1).getValues();
      for (var i = 0; i < exist.length; i++) {
        if (String(exist[i][0] || '').trim() === shipNo) {
          return { ok: false, message: '出貨單號 ' + shipNo + ' 已經登錄過了（第 ' + (i + 2) + ' 列）。' };
        }
      }
    }

    s.sheet.getRange(row, cNo).setValue(shipNo);
    var orderId = String(form.orderId || '').trim();
    if (orderId && s.col[COL_S_ORDER_ID]) {
      s.sheet.getRange(row, s.col[COL_S_ORDER_ID]).setValue(orderId);
    }
    var shipDate = String(form.shipDate || '').trim();
    if (shipDate && s.col[COL_S_SHIP_DATE]) {
      s.sheet.getRange(row, s.col[COL_S_SHIP_DATE]).setValue(shipDate);
    }
    // 登錄時間（COL_S_AT）刻意不覆寫——那是業務下單的時間。這裡記的是誰鍵入的。
    if (s.col[COL_S_BY]) s.sheet.getRange(row, s.col[COL_S_BY]).setValue(email);
    if (s.col[COL_S_WH_STATUS]) {
      var st = String(s.sheet.getRange(row, s.col[COL_S_WH_STATUS]).getValue() || '').trim();
      if (!st) s.sheet.getRange(row, s.col[COL_S_WH_STATUS]).setValue(WH_PENDING);
    }
    SpreadsheetApp.flush();

    var rec = readShipmentRow_(s, row);

    // 稽核：這一步同時動了兩張表（出貨明細＋回寫業務分頁），是最需要留痕的一步
    try {
      auditShip_(s, row, rec, email, '助理', '鍵入出貨單號',
        (orderId ? '訂單編號 ' + orderId : '') + (shipDate ? '｜出貨日 ' + shipDate : ''));
    } catch (eA) {
      Logger.log('鍵單稽核寫入失敗（鍵單本身已成功 ' + shipNo + '）：' + eA);
    }

    if (rec[COL_S_DISPATCH]) {
      try { writeBackShipNo_(rec[COL_S_DISPATCH], shipNo); }
      catch (e2) { Logger.log('回寫業務分頁出貨單號失敗（不影響登錄）：' + e2); }
    }

    // 鍵完單 → 把 Chat 認領卡片改成「✅ 已完成」。查無卡片就安靜跳過（不是每張單都有卡片）。
    try { markShipClaimDone_(rec[COL_S_DISPATCH] || '', email); }
    catch (eD) { Logger.log('Chat 卡片標記完成失敗（鍵單已成功）：' + eD); }
    try { CacheService.getScriptCache().remove(SHIP_CACHE_KEY); } catch (e3) {}
    invalidateWarehouseCache_();

    try { notifyWarehouse_(rec, row); }
    catch (e4) { Logger.log('通知倉庫失敗（出貨已登錄成功）：' + e4); }

    // 附上師傅通知：助理鍵完單就是最順的時機，順手複製貼到 LINE 群組。
    // 型號在業務分頁上，這裡沒有——techNotice_ 會自己降級（不留下尾巴的破折號）。
    return {
      ok: true,
      message: '已鍵入 ' + shipNo + '，已通知倉庫撿料。',
      techNotice: techNotice_(rec, '')
    };
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
function notifyWarehouse_(rec, row) {
  var webhook = PropertiesService.getScriptProperties()
    .getProperty('DISPATCH_WAREHOUSE_WEBHOOK');
  if (!webhook) return { sent: false, reason: '未設定 DISPATCH_WAREHOUSE_WEBHOOK' };

  // row 是選填的位置提示。沒有也不影響正確性——出貨明細只有一張分頁，
  // 找不到提示就掃一次單欄，成本遠低於發包單那邊的 17 分頁。
  var lines = ['*待撿料出貨*', ''];
  var whMention = warehouseMentions_();
  if (whMention) { lines[0] = '*待撿料出貨*　' + whMention; }
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

  var link = deepLink_({ page: 'warehouse', ship: rec[COL_S_SHIP_NO], rw: row || '' });
  if (link) {
    lines.push('');
    lines.push('<' + link + '|➡ 直接開這一筆核單>');
  }

  var ok = postWarehouseChat_(lines.join('\n')).sent;
  return { sent: ok };
}

// ────────────────────────────────────────────── Chat @提及

/**
 * 讀 Chat 人員對照分頁，回傳 { email小寫: UID }。
 *
 * ⚠ 只在**發通知的路徑**呼叫（時間觸發器、寫入完成之後），
 *   絕對不要放進 rolesFor_ 那種每次開頁都會跑的地方——
 *   loadRoster_ 已經是每次 rolesFor_ 都重讀一次而且沒有快取了，不要再加一筆。
 *
 * 讀不到就回空物件：@提及只是錦上添花，不能讓通知本身發不出去。
 */
function loadChatUids_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DISPATCH_SHEET_ID');
  if (!id) return {};

  try {
    var sheet = SpreadsheetApp.openById(id).getSheetByName(CHAT_UID_SHEET);
    if (!sheet) return {};
    var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return {};

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    // normHeader_ 會把空白全部拿掉，所以「Chat UID」正規化後是「ChatUID」。
    // 查表一律用正規化後的鍵，否則永遠對不上——而症狀只是「大家都沒被 @到」。
    var keyEmail = normHeader_(COL_CU_EMAIL);
    var keyUid = normHeader_(COL_CU_UID);

    var headerRow = -1, col = {};
    for (var r = 0; r < Math.min(values.length, MAX_SCAN_HEADER_ROWS); r++) {
      for (var c = 0; c < values[r].length; c++) {
        if (normHeader_(values[r][c]) === keyEmail) { headerRow = r; break; }
      }
      if (headerRow >= 0) break;
    }
    if (headerRow < 0) return {};
    for (var k = 0; k < values[headerRow].length; k++) {
      var key = normHeader_(values[headerRow][k]);
      if (key && col[key] === undefined) col[key] = k;
    }
    if (col[keyEmail] === undefined || col[keyUid] === undefined) return {};

    var map = {};
    for (var i = headerRow + 1; i < values.length; i++) {
      // email 與 UID 都去掉「所有」空白，不只頭尾——儲存格裡誤打的空格或換行
      // 會讓比對失敗，而症狀只是「這個人沒被 @到」，看起來像 Chat 的問題。
      var mail = String(values[i][col[keyEmail]] || '').replace(/[\s　]+/g, '').toLowerCase();
      var uid = String(values[i][col[keyUid]] || '').replace(/[\s　]+/g, '');
      if (!mail || !uid) continue;
      // 格式不對的一律當作沒填。放行的話 Chat 會收到 <users/亂值>，
      // 它認不得就渲染成空白的「<users/>」——通知照送、沒人被 ping、也沒有錯誤。
      var bad = chatUidProblem_(uid);
      if (bad) { Logger.log('⚠ ' + CHAT_UID_SHEET + ' 的 ' + mail + ' UID「' + uid +
                            '」' + bad + ' 該員不會收到 @提及。'); continue; }
      map[mail] = uid;
    }
    return map;
  } catch (err) {
    Logger.log('讀 ' + CHAT_UID_SHEET + ' 失敗（通知會退回純文字姓名）：' + err);
    return {};
  }
}

/**
 * 檢查一個 Chat UID 值有沒有問題，沒問題回空字串、有問題回中文原因。
 *
 * 為什麼需要這道關卡：錯的 UID **不會**讓通知失敗，Chat 只是把
 * `<users/錯的值>` 渲染成空白的「<users/>」。訊息照送、畫面正常、
 * 沒有任何錯誤——只有「大家都沒被 @到」這個很難聯想到原因的症狀。
 *
 * 兩種真實踩過的填錯：
 *   1. 位數不對——Chat 的 user id 是 21 位數字，填到別的 id（10 位）認不得。
 *   2. 科學記號——21 位純數字貼進試算表會被當成「數值」，超過 JS 安全整數
 *      範圍後存成 1.0823456789e+20，讀回來已經失去精度、救不回來。
 *      解法是把那一欄設成純文字再重貼，不是改程式。
 */
function chatUidProblem_(uid) {
  uid = String(uid || '');
  if (/[eE+.]/.test(uid)) {
    return '被 Google 試算表當成數值存成科學記號了（21 位數會失去精度）。' +
           '請把「' + COL_CU_UID + '」整欄設為「格式 → 數值 → 純文字」後重貼一次。';
  }
  if (!/^\d+$/.test(uid)) return '不是純數字（Chat user id 只有數字，別把 users/ 前綴也貼進來）。';
  if (uid.length < 15) {
    return '只有 ' + uid.length + ' 位，不像 Chat user id（應為 21 位數字）。' +
           '正確取法：Chat 網頁版對該人名字按右鍵 → 檢查 → 搜尋 data-member-id。';
  }
  return '';
}

/**
 * 把 email 轉成 Chat 的 @提及字串 `<users/UID>`。
 *
 * 查不到 UID 時**回傳退而求其次的純文字姓名，並記錄警告**——
 * 通知照樣送得出去，只是那個人不會被 ping。這是刻意的取捨：
 * 少一個 UID 就讓整則通知失敗，代價遠大於少一次 ping。
 * 但也不能靜默——沒有 Logger 記錄的話，沒人會知道要去補那一列。
 *
 * @param {string} email  要提及的人
 * @param {string} fallback  查不到時顯示的文字（通常是姓名）
 * @param {Object} uids  loadChatUids_() 的結果，由呼叫端傳入以免重複讀表
 */
function mentionOf_(email, fallback, uids) {
  var mail = String(email || '').replace(/[\s　]+/g, '').toLowerCase();
  var name = String(fallback || '').trim() || mail;
  if (!mail) return name;
  var uid = uids && uids[mail];
  if (uid) return '<users/' + uid + '>';
  Logger.log('⚠ ' + CHAT_UID_SHEET + ' 查無 ' + mail + ' 的 Chat UID，' +
             '通知改用純文字「' + name + '」（該員不會收到 @提及）。');
  return name;
}

/**
 * 把某個指令碼屬性裡的 email 清單，整串轉成 @提及。
 * 用在倉庫（DISPATCH_WAREHOUSE）與簽核者（DISPATCH_*_APPROVERS）——
 * 這幾種角色不在人員代碼對照表裡，名單只存在屬性中。
 *
 * 名單沒設定（＝degraded 模式，任何人都能做）時回空字串：
 * 那種情況下本來就不知道該 ping 誰，硬提及只會提及到錯的人。
 */
function mentionsFromProp_(propName) {
  var raw = '';
  try {
    raw = String(PropertiesService.getScriptProperties()
      .getProperty(propName) || '').trim();
  } catch (err) {
    return '';
  }
  if (!raw) return '';

  var uids = loadChatUids_();
  var mails = raw.split(',');
  var out = [];
  for (var i = 0; i < mails.length; i++) {
    var m = String(mails[i] || '').replace(/[\s　]+/g, '').toLowerCase();
    if (!m) continue;
    var uid = uids[m];
    // 這裡刻意只收查得到 UID 的。純文字 email 混在提及裡既不會 ping 人、
    // 又讓訊息變得很長很難讀；查不到的那幾位由 mentionOf_ 的 Logger 警告負責交代。
    if (uid) out.push('<users/' + uid + '>');
    else Logger.log('⚠ ' + CHAT_UID_SHEET + ' 查無 ' + m + ' 的 Chat UID（' +
                    propName + '），該員不會收到 @提及。');
  }
  return out.join(' ');
}

/** 倉庫成員的 @提及字串 */
function warehouseMentions_() {
  return mentionsFromProp_('DISPATCH_WAREHOUSE');
}

// ────────────────────────────────────────────── 人員代碼對照 ／ 核准後通知助理

/**
 * 業務下單的當下就通知該接手的人。
 *
 * 為什麼要有這一則：在這之前，下單完全不發通知。
 *   - 發包安裝 → 要等隔天早上 9~10 點的每日摘要，主管才知道有單要簽
 *   - 料件出貨 → 免簽核直接進助理清單，但**沒有任何人被通知**，
 *     助理只能自己記得去開頁面看，漏掉了也不會有人發現
 * 兩條路都靠「人主動去看」，這則通知就是把它改成「事情來找人」。
 *
 * 通知誰依單別而定，因為下一棒的人不同：
 *   發包安裝 → 這一關的簽核者（有副主管層就先找副主管）
 *   料件出貨 → 對應助理（直接就要去鍵 TipTop 單號）
 */
function notifyOrderSubmitted_(info) {
  var uids = loadChatUids_();
  var lines, link;

  if (info.kind === ORDER_KIND_PARTS) {
    // 免簽核，下一棒直接是助理
    var person = loadRoster_()[codeOf_(info.orderNo)] || null;
    lines = ['*新單（料件出貨，免簽核）*', ''];
    lines.push('• 發包單號：' + info.orderNo);
    if (info.customer) lines.push('• 客戶：' + info.customer +
      (info.project ? '（' + info.project + '）' : ''));
    if (info.model) lines.push('• 型號：' + info.model + (info.qty ? ' × ' + info.qty : ''));
    lines.push('• 下單：' + info.by + '　' + info.at);
    lines.push('');
    if (person && person.assist) {
      lines.push('請 ' + mentionOf_(person.assistMail, person.assist, uids) +
        ' 鍵 TipTop 單號');
    } else {
      lines.push('⚠ 代碼「' + (codeOf_(info.orderNo) || '?') +
        '」在人員代碼對照表查無對應助理，請人工確認由誰接手。');
    }
    link = deepLink_({ page: 'ship', dn: info.orderNo });
    if (link) { lines.push(''); lines.push('<' + link + '|➡ 直接開這一筆鍵單>'); }

  } else {
    // 需簽核。有副主管層就先找副主管——找錯人的話，被 @到的人會覺得不干他的事，
    // 幾次之後整個空間的通知都會被忽略。
    var stage = info.twoStage ? 'sub' : 'boss';
    var at = mentionsFromProp_(stage === 'sub'
      ? 'DISPATCH_SUB_APPROVERS' : 'DISPATCH_BOSS_APPROVERS');
    lines = ['*新單待' + (stage === 'sub' ? '副主管' : '主管') + '核准*' +
      (at ? '　' + at : ''), ''];
    lines.push('• 發包單號：' + info.orderNo);
    if (info.worker) lines.push('• 承包商：' + info.worker);
    if (info.customer) lines.push('• 客戶：' + info.customer +
      (info.project ? '（' + info.project + '）' : ''));
    if (info.model) lines.push('• 型號：' + info.model + (info.qty ? ' × ' + info.qty : ''));
    if (info.price) lines.push('• 承包總價：NT$ ' + info.price);
    lines.push('• 下單：' + info.by + '　' + info.at);
    link = deepLink_({ page: 'approve', no: info.orderNo, sh: info.sheet, rw: info.row });
    if (link) { lines.push(''); lines.push('<' + link + '|➡ 直接開這一筆簽核>'); }
  }

  return postWarehouseChat_(lines.join('\n'));
}

/**
 * 讀人員代碼對照表，回傳 { 代碼大寫: {code,sales,salesMail,type,assist,assistMail} }。
 * 讀不到就回空物件——路由通知失效不該讓簽核本身失敗，簽核才是主線。
 */
function loadRoster_() {
  var props = PropertiesService.getScriptProperties();
  var forced = String(props.getProperty('DISPATCH_ROSTER_SHEET') || '').trim();
  var id = props.getProperty('DISPATCH_SHEET_ID');
  if (!id) return {};

  try {
    var ss = SpreadsheetApp.openById(id);
    var tryNames = forced ? [forced] : ROSTER_SHEET_NAMES;
    var sheet = null;
    for (var n = 0; n < tryNames.length; n++) {
      sheet = ss.getSheetByName(tryNames[n]);
      if (sheet) break;
    }
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
    // email 欄位去掉「所有」空白，不只頭尾。儲存格裡的換行或誤打的空格
    // 會讓通知裡的 email 斷成兩行、也讓比對失敗，而且看起來只像排版問題。
    var mailAt = function (row, name2) {
      return at(row, name2).replace(/[\s　]+/g, '');
    };

    var out = {};
    for (var i = headerRow + 1; i < values.length; i++) {
      var code = at(values[i], COL_R_CODE).toUpperCase();
      if (!code) continue;
      out[code] = {
        code: code,
        sales: at(values[i], COL_R_SALES),
        salesMail: mailAt(values[i], COL_R_SALES_MAIL),
        type: at(values[i], COL_R_TYPE),
        sheet: at(values[i], COL_R_SHEET),
        assist: at(values[i], COL_R_ASSIST),
        assistMail: mailAt(values[i], COL_R_ASSIST_MAIL)
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
    // @提及本人，不只是寫名字——寫名字不會 ping 到人，訊息會被整個空間一起忽略
    var who = mentionOf_(person.assistMail, person.assist, loadChatUids_());
    lines.push('請 ' + who + ' 接手打出貨單' +
      (person.type ? '（' + person.type + '）' : ''));
  } else {
    lines.push('⚠ 代碼「' + (code || '?') + '」在人員代碼對照表查無對應助理，請人工確認由誰接手。');
  }

  // 深連結：點進去直接是這一筆的鍵單畫面，不用自己回系統翻清單
  var link = deepLink_({ page: 'ship', dn: rec.orderNo });
  if (link) {
    lines.push('');
    lines.push('<' + link + '|➡ 直接開這一筆鍵單>');
  }

  try {
    var res = postWarehouseChat_(lines.join('\n'));
    // 額外貼一張可認領的互動卡片到助理群組。閘門在 postShipClaimCard_ 裡：
    // DISPATCH_ASSISTANT_SPACE 沒設就是 no-op，webhook 那則照樣送出，零影響。
    try { postShipClaimCard_(rec); }
    catch (eC) { Logger.log('Chat 互動卡片貼出失敗（webhook 通知已送出）：' + eC); }
    return { sent: res.sent, matched: !!(person && person.assist) };
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

/**
 * 出貨明細那一側的稽核包裝。
 *
 * 為什麼需要包裝：appendAudit_ 的「發包單號」欄是跨兩張表的 join key，
 * 但出貨側的動作手上拿到的是**出貨單號**。這裡統一成
 *   發包單號欄 → 該列的發包單號（料件出貨可能為空，退而填出貨單號）
 *   說明欄     → 一定帶上出貨單號，這樣兩種情況都查得回來
 *
 * 每一個呼叫端都要自己包 try：稽核是附加動作，
 * 它壞掉不該讓一次已經寫成功的操作被回報成失敗（沿用簽核那邊的原則）。
 */
function auditShip_(s, row, rec, who, role, action, note) {
  var dispatchNo = String((rec && rec[COL_S_DISPATCH]) || '').trim();
  var shipNo = String((rec && rec[COL_S_SHIP_NO]) || '').trim();
  appendAudit_(s.ss, {
    at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
    who: who,
    role: role,
    orderNo: dispatchNo || shipNo,
    action: action,
    note: (shipNo ? '出貨單號 ' + shipNo + (note ? '｜' : '') : '') + (note || ''),
    sheet: SHIPMENT_SHEET,
    row: row
  });
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
    '.sec span{font-weight:400;font-size:11px;color:#94A3B8}' +

    // ── 倉庫核單（手機優先）──
    // 倉庫是站在貨架前用手機操作：字要大、按鈕要好按（44px 是可靠的觸控目標下限）、
    // 出貨品項是撿料依據所以最顯眼，且用等寬字體讓長料號好逐字核對。
    '.wh .whtop{display:flex;align-items:baseline;gap:9px;margin-bottom:6px;flex-wrap:wrap}' +
    '.wh .whcust{font-size:15px;font-weight:700;color:#1E293B;margin-bottom:10px}' +
    '.wh .whcust span{font-weight:400;font-size:13px;color:#64748B}' +
    '.wh .whlab{font-size:11px;font-weight:700;color:#64748B;margin:9px 0 3px;' +
      'letter-spacing:.04em}' +
    '.wh .whitems{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'font-size:14px;line-height:1.65;background:#F8FAFC;border:1px solid #E2E8F0;' +
      'border-radius:8px;padding:10px 11px;white-space:pre-wrap;word-break:break-all;' +
      'color:#0F172A}' +
    '.wh .whto{font-size:14px;line-height:1.6;color:#1E293B}' +
    '.wh .whrow{font-size:13px;color:#334155;margin-top:5px}' +
    '.wh .whrow b{display:inline-block;min-width:58px;color:#64748B;font-weight:600;' +
      'font-size:11.5px}' +
    '.wh .whby{font-size:11px;color:#94A3B8;margin-top:9px}' +
    // ── ① 下單：單別選擇 ──
    '.kinds{display:flex;gap:9px;margin:4px 0 2px}' +
    '.kind{flex:1;min-height:44px;background:#F1F5F9;color:#475569;' +
      'border:1.5px solid #E2E8F0;font-size:14px}' +
    '.kind.on{background:#0F2744;color:#fff;border-color:#0F2744}' +

    // ── ⑥ 報表：純 CSS 條狀圖（不引入 Chart.js，避免外部依賴）──
    '.brow{display:flex;align-items:center;gap:9px;margin:6px 0;font-size:12.5px}' +
    '.blab{width:88px;flex:none;color:#475569;font-weight:600;word-break:break-all}' +
    '.btrack{flex:1;min-width:40px;height:22px;background:#F1F5F9;border-radius:5px;' +
      'overflow:hidden}' +
    '.bfill{height:100%;background:linear-gradient(90deg,#0F2744,#38BDF8);border-radius:5px}' +
    '.bval{width:132px;flex:none;text-align:right;color:#1E293B;line-height:1.35}' +
    '.bval span{font-size:10.5px;color:#94A3B8}' +
    '@media(max-width:520px){' +
      '.blab{width:66px;font-size:11.5px}' +
      '.bval{width:104px;font-size:11.5px}' +
    '}' +
    '.wh .upl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:3px}' +
    '.wh .upl input[type=file]{flex:1;min-width:0;font-size:12px;border:1px dashed #CBD5E1;' +
      'border-radius:7px;padding:7px 8px;background:#fff}' +
    '.wh .upl button{padding:7px 14px;font-size:12.5px}' +
    '.wh .uplmsg{font-size:11.5px;color:#94A3B8;margin-top:5px;line-height:1.55;word-break:break-all}' +
    '.wh .uplmsg.ok{color:#065F46;font-weight:700}.wh .uplmsg.bad{color:#B91C1C;font-weight:700}' +
    '.wh .whbtn{display:flex;gap:9px;margin-top:13px}' +
    'button.big{flex:1;min-height:46px;font-size:15px}' +
    // 窄螢幕：按鈕改上下排列，避免兩顆都被壓到很窄而誤按
    '@media(max-width:420px){' +
      '.wh .whbtn{flex-direction:column}' +
      '.wh .whitems{font-size:13.5px}' +
      'body{padding:11px}' +
    '}';

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

  var script = approveScript_('全部處理完畢 👍');

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

/**
 * 簽核卡片的前端行為，清單頁與深連結單筆頁共用。
 *
 * 抽出來的理由：兩邊如果各留一份，日後只改一邊就會出現最難查的不一致
 * （例如清單頁修好了退回驗證、單筆頁還是舊的）。
 *
 * @param {string} emptyMsg 卡片全部處理完之後顯示的話。
 *   兩邊必須不一樣——清單頁是「全部處理完畢」，
 *   但單筆頁本來就只有一張卡，簽完說「全部處理完畢」會讓人以為
 *   自己把整個待辦清單都簽掉了。
 */
function approveScript_(emptyMsg) {
  return '<script>' +
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
              'show(' + jsStr_(emptyMsg) + ',"done");}}' +
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
}

/** 把字串包成可以安全嵌進 <script> 的 JS 字面值 */
function jsStr_(s) {
  return "'" + jsq_(String(s == null ? '' : s)) + "'";
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

/**
 * 倉庫核單頁的唯讀自檢。部署前先跑，省得倉庫的人打開才發現設定沒好。
 */
/**
 * 產生「業務 → 發包分頁」的建議配對，供人工填進路由對照表的「發包分頁」欄。
 *
 * 刻意只**建議**、不自動寫入：`JW → 零售-Johnson` 看得出來，
 * 但「一課-eli」「一課-sin」「一課-sam」都是暱稱，猜錯就是把單寫到別人的表上，
 * 而且要等到有人下單才會發現。這種事必須由人確認。
 */
function suggestSheetMapping() {
  return withFreshStruct_(function () {
  var roster;
  try { roster = loadRoster_(); } catch (err) { Logger.log('❌ ' + err); return; }
  var codes = Object.keys(roster);
  if (!codes.length) {
    Logger.log('❌ 讀不到路由對照表，先確認分頁名（' + ROSTER_SHEET_NAMES.join('、') + '）。');
    return;
  }

  var env;
  try { env = openSheets_(); } catch (err) { Logger.log('❌ ' + err); return; }
  var sheetNames = [];
  for (var i = 0; i < env.list.length; i++) sheetNames.push(env.list[i].name);

  Logger.log('=== 建議的「' + COL_R_SHEET + '」填法（請人工確認後填進對照表）===');
  var used = {};
  for (var c = 0; c < codes.length; c++) {
    var r = roster[codes[c]];
    if (r.sheet) {
      var okSheet = sheetNames.indexOf(r.sheet) >= 0;
      Logger.log('　' + codes[c] + '（' + r.sales + '）已填「' + r.sheet + '」' +
        (okSheet ? ' ✅' : ' ❌ 這個分頁不存在或未被納入掃描'));
      if (okSheet) used[r.sheet] = codes[c];
      continue;
    }
    // 用姓名的英文片段去比對分頁名（一課-Sean、零售-Johnson 這種）
    var parts = String(r.sales || '').toLowerCase().split(/[\s.]+/);
    var guesses = [];
    for (var s = 0; s < sheetNames.length; s++) {
      var low = sheetNames[s].toLowerCase();
      for (var p = 0; p < parts.length; p++) {
        if (parts[p].length >= 2 && low.indexOf(parts[p]) >= 0) {
          guesses.push(sheetNames[s]);
          break;
        }
      }
    }
    Logger.log('　' + codes[c] + '（' + r.sales + '）→ ' +
      (guesses.length ? '建議：' + guesses.join(' 或 ') : '⚠ 猜不出來，請人工指定'));
  }

  var orphan = [];
  for (var k = 0; k < sheetNames.length; k++) {
    if (!used[sheetNames[k]]) orphan.push(sheetNames[k]);
  }
  if (orphan.length) {
    Logger.log('--- 尚未被任何代碼指到的分頁（' + orphan.length + ' 個）---');
    Logger.log('　' + orphan.join('、'));
    Logger.log('　→ 這些分頁的業務還不能用下單頁。若他們要用，' +
      '對照表得補上該人的代碼、email 與發包分頁。');
  }
  });
}

/** ① 業務下單頁的唯讀自檢 */
function checkOrderSetup() {
  return withFreshStruct_(function () {
  var roster;
  try { roster = loadRoster_(); } catch (err) { Logger.log('❌ ' + err); return; }
  var codes = Object.keys(roster);
  Logger.log('路由對照表：' + codes.length + ' 筆');
  if (!codes.length) {
    Logger.log('❌ 讀不到對照表，下單頁完全無法使用。');
    return;
  }

  var noMail = [], noSheet = [], ready = [];
  for (var i = 0; i < codes.length; i++) {
    var r = roster[codes[i]];
    if (!r.salesMail) noMail.push(codes[i]);
    else if (!r.sheet) noSheet.push(codes[i]);
    else ready.push(codes[i] + '→' + r.sheet);
  }
  Logger.log('✅ 可以下單的業務：' + (ready.length ? ready.join('、') : '（無）'));
  if (noMail.length) {
    Logger.log('⚠ 缺「' + COL_R_SALES_MAIL + '」，這些人無法被辨識：' + noMail.join('、'));
  }
  if (noSheet.length) {
    Logger.log('⚠ 缺「' + COL_R_SHEET + '」，這些人開下單頁會被擋：' + noSheet.join('、') +
      '　→ 執行 suggestSheetMapping() 取得建議');
  }

  // 分頁真的存在嗎，以及寫入需要的欄位齊不齊
  try {
    var env = openSheets_();
    var names = {};
    for (var e = 0; e < env.list.length; e++) names[env.list[e].name] = env.list[e];
    for (var j = 0; j < codes.length; j++) {
      var rr = roster[codes[j]];
      if (!rr.sheet) continue;
      var ctx = names[rr.sheet];
      if (!ctx) {
        Logger.log('❌ ' + codes[j] + ' 指定的分頁「' + rr.sheet + '」不存在或未被納入掃描');
        continue;
      }
      var need = [COL_ORDER_NO, COL_APPLY_AT, COL_CUSTOMER, COL_MODEL, COL_QUOTE_QTY,
                  COL_DISPATCHER, COL_APPROVAL];
      var miss = [];
      for (var n = 0; n < need.length; n++) if (!ctx.col[need[n]]) miss.push(need[n]);
      if (miss.length) {
        Logger.log('⚠ ' + codes[j] + '｜' + rr.sheet + ' 缺欄位：' + miss.join('、') +
          '（下單時這些資料會被略過並在畫面上提示）');
      } else {
        Logger.log('　✅ ' + codes[j] + '｜' + rr.sheet + ' 欄位齊全，' +
          '下一個單號會是 ' + nextOrderNo_(ctx, codes[j], new Date()));
      }
    }
  } catch (err) {
    Logger.log('❌ 檢查分頁失敗：' + err);
  }
  Logger.log('登入身分（編輯器手動執行時可能為空，屬正常）：' + currentUserEmail_());
  });
}

/**
 * 列出這把 GEMINI_API_KEY 實際可用的模型（截圖下單用）。
 *
 * ⚠ 存在的理由是**踩過**：GEMINI_MODELS 清單裡的型號名稱一直是「從錯誤訊息推測」來的，
 *   結果 gemini-2.0-flash 下架（404）、換 gemini-3.6-flash 又遇 503、
 *   補的 gemini-3-flash-preview 也是猜的。猜錯的代價不是報錯，是**每次辨識都先白等
 *   一輪逾時再退到第二個型號**（實測慢了 9 秒），而且從辨識結果完全看不出來。
 *
 * ListModels 是 Google 官方端點，回的是這把金鑰當下真正能用的清單——
 * 是「查證」不是「推測」。之後再遇到 404／503，先跑這支，再照結果改 GEMINI_MODELS。
 *
 * 用法：Apps Script 編輯器選這支 → 執行 → 看執行記錄。不會改到任何資料。
 */
function checkGeminiModels() {
  var key = (PropertiesService.getScriptProperties()
    .getProperty(GEMINI_KEY_PROP) || '').trim();
  if (!key) {
    Logger.log('❌ 指令碼屬性 ' + GEMINI_KEY_PROP + ' 未設定，截圖下單無法使用。');
    return;
  }

  // 分頁取完整清單：pageSize 給到上限，仍可能有 nextPageToken，不取完會漏掉型號，
  // 而「漏掉」的症狀跟「不存在」一模一樣，會讓這支診斷本身變成誤導來源。
  var all = [], token = '', guard = 0;
  do {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + key +
      '&pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var resp;
    try {
      resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    } catch (err) {
      Logger.log('❌ 呼叫 ListModels 例外：' + err);
      return;
    }
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log('❌ ListModels HTTP ' + code + '：' + resp.getContentText().slice(0, 300));
      return;
    }
    var data = JSON.parse(resp.getContentText());
    var list = (data && data.models) || [];
    for (var i = 0; i < list.length; i++) all.push(list[i]);
    token = (data && data.nextPageToken) || '';
  } while (token && ++guard < 10);

  // 只有支援 generateContent 的才對我們有意義——截圖辨識就是打這個方法。
  // 清單裡混著 embedding／TTS 等模型，不濾掉會看不出哪些是真的能用。
  var usable = {};
  var flash = [], other = [];
  for (var j = 0; j < all.length; j++) {
    var m = all[j];
    var methods = m.supportedGenerationMethods || [];
    if (methods.indexOf('generateContent') < 0) continue;
    var name = String(m.name || '').replace(/^models\//, '');
    usable[name] = true;
    if (name.indexOf('flash') >= 0) flash.push(name); else other.push(name);
  }

  Logger.log('可用模型共 ' + all.length + ' 個，其中支援 generateContent 的 ' +
    (flash.length + other.length) + ' 個。');
  Logger.log('── flash 系列（截圖辨識要挑這裡，快又便宜）──');
  Logger.log(flash.length ? flash.join('\n') : '（無）');
  Logger.log('── 其他支援 generateContent 的 ──');
  Logger.log(other.length ? other.join('\n') : '（無）');

  // 逐一驗證目前清單裡的型號是否真的存在，直接指出該改哪一個。
  Logger.log('── 目前 GEMINI_MODELS 的驗證結果 ──');
  var bad = [];
  for (var k = 0; k < GEMINI_MODELS.length; k++) {
    var want = GEMINI_MODELS[k];
    if (usable[want]) {
      Logger.log('  ✅ [' + k + '] ' + want + ' 存在');
    } else {
      Logger.log('  ❌ [' + k + '] ' + want + ' 不在可用清單中 → 應從 GEMINI_MODELS 移除或改名');
      bad.push(want);
    }
  }
  if (bad.length) {
    Logger.log('⚠ 有 ' + bad.length + ' 個型號查無此名：' + bad.join('、') +
      '　→ 從上面 flash 清單挑一個換掉（GEMINI_MODELS 在檔案開頭）。');
  } else {
    Logger.log('✅ GEMINI_MODELS 裡的型號全部存在。若仍遇 503，那是暫時過載不是名稱錯誤。');
  }
}

function checkWarehouseSetup() {
  var props = PropertiesService.getScriptProperties();
  var wh = String(props.getProperty('DISPATCH_WAREHOUSE') || '').trim();
  Logger.log('DISPATCH_WAREHOUSE         = ' + (wh || '❌ 未設定（任何人都能核單）'));
  Logger.log('DISPATCH_WAREHOUSE_WEBHOOK = ' +
    (props.getProperty('DISPATCH_WAREHOUSE_WEBHOOK') ? '已設定' : '❌ 未設定（核單後不會有備存訊息）'));

  // 發票資料夾。權限由這個資料夾決定，程式不碰分享設定。
  var fid = String(props.getProperty(INVOICE_FOLDER_PROP) || '').trim();
  if (!fid) {
    Logger.log(INVOICE_FOLDER_PROP + ' = ❌ 未設定（倉庫按上傳會被擋下並提示，不會壞頁）');
  } else {
    try {
      var fo = DriveApp.getFolderById(fid);
      Logger.log(INVOICE_FOLDER_PROP + ' = ✅「' + fo.getName() + '」');
      Logger.log('　 ⚠ 請自行確認這個資料夾的共用權限：發票含客戶名稱、地址、金額、統編，' +
        '不可設成「知道連結的任何人」。程式刻意不動任何分享設定。');
    } catch (e) {
      Logger.log(INVOICE_FOLDER_PROP + ' = 🔴 打不開（ID 填錯，或這支程式的執行帳號沒權限）：' + e);
    }
  }

  try {
    var s = openShipmentSheet_();
    var need = [COL_S_WH_STATUS, COL_S_WH_BY, COL_S_WH_AT, COL_S_WH_NOTE];
    var missing = [];
    for (var i = 0; i < need.length; i++) if (!s.col[need[i]]) missing.push(need[i]);
    if (missing.length) {
      Logger.log('❌ 出貨明細缺倉庫核單欄位：' + missing.join('、') +
        '　→ 缺「' + COL_S_WH_STATUS + '」會完全無法核單');
    } else {
      Logger.log('✅ 出貨明細的倉庫核單欄位齊全');
    }

    var rows = getWarehousePending_();
    Logger.log('目前待撿料：' + rows.length + ' 筆');
    for (var r = 0; r < Math.min(rows.length, 5); r++) {
      Logger.log('　• ' + rows[r].shipNo + '｜' + (rows[r].customer || '—') +
        '｜登錄 ' + (rows[r].by || '—'));
    }
    if (rows.length > 5) Logger.log('　…還有 ' + (rows.length - 5) + ' 筆');

    // 已核但沒有核單人，多半是有人手改試算表而不是走網頁
    var last = s.sheet.getLastRow();
    if (last >= 2 && s.col[COL_S_WH_STATUS] && s.col[COL_S_WH_BY]) {
      var st = s.sheet.getRange(2, s.col[COL_S_WH_STATUS], last - 1, 1).getValues();
      var by = s.sheet.getRange(2, s.col[COL_S_WH_BY], last - 1, 1).getValues();
      var orphan = 0;
      for (var k = 0; k < st.length; k++) {
        var v = String(st[k][0] || '').trim();
        if (v && v !== WH_PENDING && !String(by[k][0] || '').trim()) orphan++;
      }
      if (orphan) {
        Logger.log('⚠ 有 ' + orphan + ' 筆已核單但沒有核單人——' +
          '那是有人直接手改試算表，不是走網頁核的（無法追溯是誰）。');
      }
    }
  } catch (err) {
    Logger.log('❌ ' + err);
  }
  Logger.log('登入身分（編輯器手動執行時可能為空，屬正常）：' + currentUserEmail_());
}

function checkSetup() {
  return withFreshStruct_(function () {
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
    Logger.log('❌ 讀不到人員代碼對照表（找過的分頁名：' +
      (props.getProperty('DISPATCH_ROSTER_SHEET') || ROSTER_SHEET_NAMES.join('、')) +
      '），核准後無法判斷通知誰。' +
      '若你的分頁叫別的名字，設指令碼屬性 DISPATCH_ROSTER_SHEET。');
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
  });
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
  return withFreshStruct_(function () {
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
  });
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
