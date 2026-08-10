// 用真實表頭驗證獨立報表程式（gas-dispatch-report.gs）的讀表與統計邏輯
//
// 沿用 verify-dispatch-approval.js 的模式：GAS stub ＋ 真實表頭，
// 差別是這一支要 stub 的是 **Sheets 進階服務的 batchGet**，不是 SpreadsheetApp。
//
// 執行：node scripts/verify-dispatch-report.js
const fs = require('fs'), vm = require('vm');
const DIR = 'C:/Users/FISHCHEN/OneDrive/Desktop/保固登錄頁面/docs/';
const SRC = DIR + 'gas-dispatch-report.gs';

// ── 真實表頭（與 verify-dispatch-approval.js 同一份，取其中 6 個代表性分頁）──
// 選這 6 個的理由：涵蓋全部 4 種簽核欄寫法、兩種數量欄寫法、兩種金額欄寫法，
// 以及唯一一個缺欄位的分頁（陳俊行）。全部 17 個跑起來慢而且看不出更多東西。
const HEADS = {
  '零售-Johnson': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','案件狀態','主管簽核','訂單編號','請購單號','10999沖帳出貨單號'],
  '一課-eli': ['發包申請日期','發包單號','承包商','客戶編號','訂單號碼','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','本期請款合計','發包人員','補充說明','副主管確認/押日期','主管確認/押日期','請購單號','沖轉出貨單號'],
  '一課-sin': ['發包日期','發包單號','承包商','客戶編號','訂單號碼','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','本期請款合計','發包人員','補充說明','副主管確認/押日期','主管確認/押日期','請購單號','沖轉出貨單號'],
  '一課-sam': ['發包申請日期','發包單號','承包商','客戶編號','訂單號碼','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','本次請款合計','發包人員','補充說明','副主管KEY英文名押日期','主管KEY英文名押日期','請購單號','10999沖帳出貨單號'],
  '陳俊行(廣信鎖店)': ['發包申請日期','發包單號','承包商','客戶','維修地址','案名','型號','請款數量','發包單價','發包人員','補充說明','主管確認/押日期','訂單單號','請購單號','出貨沖轉單號'],
  '行銷': ['發包申請日期','發包單號','承包商','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','發包人員','補充說明','主管KEY英文名押日期','訂單編號','請購單號','沖帳出貨單號'],
};

const SHIP_HEAD = ['登錄時間','出貨單號','訂單編號','出貨日期','發包單號','客戶','案名','出貨品項',
  '貨指寄-收件人','貨指寄-電話','貨指寄-地址','發票別','出貨備註','通路訂單編號','客人姓名',
  '客人電話','客人地址','施工時段','工項','售價','進價','下單業務','登錄人',
  '倉庫核單狀態','倉庫核單人','倉庫核單時間','問題說明'];

const ROSTER_HEAD = ['業務代碼','業務姓名','業務email','類別','對應助理','助理email','發包分頁'];
const OPT_HEAD = ['購買通路','型號','工項','承包商','發票別'];

// 試算表日期序列數字（batchGet 以 SERIAL_NUMBER 取回）。1899-12-30 為原點。
const EPOCH = Date.UTC(1899, 11, 30);
const ser = ymd => {
  const [y, m, d] = ymd.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - EPOCH) / 86400000;
};
const serT = (ymd, hh, mm) => ser(ymd) + (hh * 60 + mm) / 1440;

// ── 測試資料 ────────────────────────────────────────────────
// 每一列都對應一個具體的失敗模式，不是湊數量的。
function row(head, obj) {
  return head.map(h => (h in obj ? obj[h] : ''));
}
const H_J = HEADS['零售-Johnson'];
const H_E = HEADS['一課-eli'];
const H_C = HEADS['陳俊行(廣信鎖店)'];

const DATA = {
  '零售-Johnson': [
    // 正常單
    row(H_J, {'發包申請日期': ser('2026-03-01'), '發包單號': 'JW-260301-01', '承包商': '蔣家工程行',
      '客戶': '甲客戶', '報價單數量': 10, '累計請款數量': 4, '承包總價': 8000,
      '主管簽核': '✅ 核准 boss@waferlock.com 2026-03-05 09:12'}),
    // 🔴 超額請款：累計 12 > 報價 10
    row(H_J, {'發包申請日期': ser('2026-03-02'), '發包單號': 'JW-260302-01', '承包商': '蔣師傅',
      '客戶': '乙客戶', '報價單數量': 10, '累計請款數量': 12, '承包總價': 5000,
      '主管簽核': '✅ 核准 boss@waferlock.com 2026-03-04 15:30'}),
    // 起算日之前，且金額極端值（112 億那一類）
    row(H_J, {'發包申請日期': ser('2024-05-01'), '發包單號': 'JW-240501-01', '承包商': '蔣家工程行',
      '客戶': '丙客戶', '報價單數量': 5, '累計請款數量': 5, '承包總價': 18000000}),
    // 日期是手打文字「3/28」——轉不出來，必須歸「日期不明」而不是猜年份
    row(H_J, {'發包申請日期': '3/28', '發包單號': 'JW-260328-01', '承包商': '蔣家工程行',
      '客戶': '丁客戶', '報價單數量': 3, '累計請款數量': 1, '承包總價': 2000}),
    // 金額欄填了非數字：合計不可變 NaN
    row(H_J, {'發包申請日期': ser('2026-04-01'), '發包單號': 'JW-260401-01', '承包商': '蔣家工程行',
      '客戶': '戊客戶', '報價單數量': 2, '累計請款數量': 2, '承包總價': '待確認'}),
    // 不是發包單號的雜訊列（表格上方常見的狀態註記）
    row(H_J, {'發包單號': '先寄未裝', '承包商': '不該被統計'}),
  ],
  '一課-eli': [
    // 別名：合約數量 / 發包合計 / 主管確認押日期
    row(H_E, {'發包申請日期': ser('2026-05-10'), '發包單號': 'EL-260510-01', '承包商': '陳家工程行',
      '客戶': '己客戶', '合約數量': 20, '累計請款數量': 25, '發包合計': 30000,
      '主管確認/押日期': '✅ 核准 boss@waferlock.com 2026-05-12 10:00'}),
  ],
  '一課-sin': [
    // 別名：發包日期（沒有「發包申請日期」這個欄名）
    row(HEADS['一課-sin'], {'發包日期': ser('2026-06-01'), '發包單號': 'SN-260601-01',
      '承包商': '陳家工程行', '合約數量': 4, '累計請款數量': 4, '發包合計': 4000}),
  ],
  '一課-sam': [],
  '行銷': [],
  '陳俊行(廣信鎖店)': [
    // 這個分頁沒有「報價單數量／合約數量」也沒有「累計請款數量」→ 必須列為「無法檢查」
    row(H_C, {'發包申請日期': ser('2026-03-20'), '發包單號': 'CJ-260320-01', '承包商': '王師傅',
      '請款數量': 3, '發包單價': 900}),
  ],
};

const SHIP_ROWS = [
  // 正常：出貨日 2026-03-10、申請日 2026-03-01（兩個基準會落在不同月份的那種案例）
  row(SHIP_HEAD, {'登錄時間': serT('2026-03-08', 9, 0), '出貨單號': 'S001', '出貨日期': ser('2026-03-10'),
    '發包單號': 'JW-260301-01', '案名': 'MOMO 三月團購', '售價': 30000, '進價': 20000,
    '下單業務': 'Johnson', '倉庫核單時間': serT('2026-03-12', 14, 0)}),
  // 未鍵出貨單號 → 不計入營收，但要被計數
  row(SHIP_HEAD, {'登錄時間': serT('2026-03-09', 9, 0), '出貨單號': '', '出貨日期': ser('2026-03-11'),
    '發包單號': 'JW-260302-01', '案名': '蝦皮', '售價': 9999}),
  // 沒有進價 → 毛利不能把它算進去
  row(SHIP_HEAD, {'出貨單號': 'S002', '出貨日期': ser('2026-04-05'), '發包單號': 'JW-260401-01',
    '案名': '官網', '售價': 5000, '下單業務': 'Johnson'}),
  // 沒有發包單號（弱電料件那一類）→ 出貨日基準算得到，發包申請日基準算不到
  row(SHIP_HEAD, {'出貨單號': 'S003', '出貨日期': ser('2026-04-06'), '發包單號': '',
    '案名': '散戶', '售價': 1200, '進價': 800, '下單業務': 'Sammi'}),
  // 跨年同月：2025-12 與 2026-12 不可合併
  row(SHIP_HEAD, {'出貨單號': 'S004', '出貨日期': ser('2025-12-15'), '案名': '官網',
    '售價': 100, '進價': 50, '下單業務': 'Johnson'}),
  row(SHIP_HEAD, {'出貨單號': 'S005', '出貨日期': ser('2026-12-15'), '案名': '官網',
    '售價': 200, '進價': 50, '下單業務': 'Johnson'}),
  // 出貨日是手打文字 → 日期不明
  row(SHIP_HEAD, {'出貨單號': 'S006', '出貨日期': '3/28', '案名': '官網', '售價': 700}),
  // 未收錄的業務代碼（ST 不在對照表）
  row(SHIP_HEAD, {'出貨單號': 'S007', '出貨日期': ser('2026-05-20'), '發包單號': 'ST-260520-01',
    '案名': '某建案', '售價': 4000, '進價': 3000}),
  // 售價極端值
  row(SHIP_HEAD, {'出貨單號': 'S008', '出貨日期': ser('2026-05-21'), '案名': 'MOMO',
    '售價': 99000000, '進價': 1, '下單業務': 'Johnson'}),
];

const ROSTER_ROWS = [
  row(ROSTER_HEAD, {'業務代碼': 'JW', '業務姓名': 'Johnson', '類別': '零售', '對應助理': '小美'}),
  row(ROSTER_HEAD, {'業務代碼': 'EL', '業務姓名': 'Eli', '類別': '一課', '對應助理': '小華'}),
];
const OPT_ROWS = [
  row(OPT_HEAD, {'購買通路': 'MOMO'}),
  row(OPT_HEAD, {'購買通路': '蝦皮'}),
  row(OPT_HEAD, {'購買通路': '官網'}),
  row(OPT_HEAD, {'購買通路': '散戶'}),
];

// 表格：表頭不一定在第 1 列（行銷在第 1 列，其餘在第 2 列，與實際一致）
function gridOf(head, rows, headerRow) {
  const g = [];
  for (let i = 1; i < headerRow; i++) g.push(head.map(() => ''));
  g.push(head.slice());
  rows.forEach(r => g.push(r));
  return g;
}

function buildBook() {
  const book = {};
  Object.keys(HEADS).forEach(n => {
    book[n] = gridOf(HEADS[n], DATA[n] || [], n === '行銷' ? 1 : 2);
  });
  book['出貨明細'] = gridOf(SHIP_HEAD, SHIP_ROWS, 1);
  book['路由對照表'] = gridOf(ROSTER_HEAD, ROSTER_ROWS, 1);
  book['選單'] = gridOf(OPT_HEAD, OPT_ROWS, 1);
  book['簽核紀錄'] = gridOf(['時間', '發包單號', '決定'], [], 1);
  return book;
}

// ── GAS stub ────────────────────────────────────────────────
let BOOK = buildBook();
let props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
let LOG = [], CACHE = {};
let batchGetCalls = 0;

const sandbox = {
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) })
  },
  // 進階服務。刻意只提供讀取用的兩支——程式若哪天呼叫寫入 API 會直接 TypeError。
  Sheets: {
    Spreadsheets: {
      get: () => ({ sheets: Object.keys(BOOK).map(t => ({ properties: { title: t } })) }),
      Values: {
        batchGet: (id, opt) => {
          batchGetCalls++;
          const names = opt.ranges.map(r => r.replace(/^'(.*)'!.*$/, '$1').replace(/''/g, "'"));
          return { valueRanges: names.map(n => ({ range: n, values: BOOK[n] || [] })) };
        }
      }
    }
  },
  Session: { getActiveUser: () => ({ getEmail: () => 'boss@waferlock.com' }) },
  Utilities: {
    formatDate: (d, tz, f) => {
      const dt = (d instanceof Date) ? d : new Date(d);
      const p = n => String(n).padStart(2, '0');
      const Y = dt.getFullYear(), MM = p(dt.getMonth() + 1), DD = p(dt.getDate());
      const HH = p(dt.getHours()), mm = p(dt.getMinutes());
      return String(f).replace('yyyy-MM-dd HH:mm', `${Y}-${MM}-${DD} ${HH}:${mm}`)
        .replace('yyyy-MM-dd', `${Y}-${MM}-${DD}`).replace('MM-dd HH:mm', `${MM}-${DD} ${HH}:${mm}`);
    }
  },
  HtmlService: {
    createHtmlOutput: h => ({ _h: h, setTitle() { return this; }, addMetaTag() { return this; } })
  },
  Logger: { log: m => LOG.push(String(m)) },
  CacheService: {
    getScriptCache: () => ({
      get: k => (k in CACHE ? CACHE[k] : null),
      put: (k, v) => { CACHE[k] = v; },
      remove: k => { delete CACHE[k]; }
    })
  },
  console,
};
vm.createContext(sandbox);
const SOURCE = fs.readFileSync(SRC, 'utf8');
vm.runInContext(SOURCE, sandbox);
const G = sandbox;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const reset = () => { CACHE = {}; LOG = []; BOOK = buildBook(); };

// ── 1. 唯讀保證 ──────────────────────────────────────────────
console.log('\n【1】唯讀保證');
{
  // 註解裡本來就會提到這些 API 的名字（說明「不可以用」），所以先把註解去掉再搜尋。
  // 不去註解的話，這個斷言只能靠「別在註解裡寫出關鍵字」來通過——那是假的防護。
  const noComment = SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  ['setValue', 'setValues', 'appendRow', 'insertSheet', 'deleteRow', 'setFormula',
   'Values.update', 'Values.append', 'batchUpdate'].forEach(bad => {
    ok(noComment.indexOf(bad) < 0, '🔴 唯讀程式不可出現「' + bad + '」');
  });
  ok(/Values\.batchGet/.test(noComment), '要用 batchGet 讀表');
}

// ── 2. batchGet 讀表與欄位對應 ──────────────────────────────
console.log('\n【2】batchGet 讀表與欄位對應');
{
  reset();
  batchGetCalls = 0;
  const parts = G.splitBook_(G.fetchAll_());
  ok(batchGetCalls === 1, '全部分頁應該只用 1 次 batchGet，實際 ' + batchGetCalls);
  ok(parts.sheets.length === 6, '應納入 6 個發包分頁，實際 ' + parts.sheets.length);
  ok(!!parts.shipment, '應找到出貨明細');
  ok(!!parts.roster, '應找到人員代碼對照表');
  ok(!!parts.options, '應找到選單分頁');
  const names = parts.sheets.map(s => s.name);
  ['出貨明細', '選單', '路由對照表', '簽核紀錄'].forEach(n => {
    ok(names.indexOf(n) < 0, '系統分頁「' + n + '」不可被當成發包分頁');
  });

  const eli = parts.sheets.find(s => s.name === '一課-eli');
  ok(eli.col[G.COL_QUOTE_QTY] === HEADS['一課-eli'].indexOf('合約數量') + 1,
     '「合約數量」別名應對到報價單數量欄');
  ok(eli.col[G.COL_PRICE] === HEADS['一課-eli'].indexOf('發包合計') + 1,
     '「發包合計」別名應對到金額欄');
  ok(/^主管/.test(HEADS['一課-eli'][eli.col[G.COL_APPROVAL] - 1]),
     '主管欄不可誤配到副主管欄');
  const sin = parts.sheets.find(s => s.name === '一課-sin');
  ok(sin.col[G.COL_APPLY_AT] === 1, '「發包日期」別名應對到申請日欄');
  const chen = parts.sheets.find(s => s.name === '陳俊行(廣信鎖店)');
  ok(!chen.col[G.COL_QUOTE_QTY] && !chen.col[G.COL_ACCUM_QTY],
     '陳俊行分頁確實缺報價／累計欄（後面的「無法檢查」靠這個前提）');
  const mk = parts.sheets.find(s => s.name === '行銷');
  ok(mk.headerRow === 1, '行銷分頁表頭在第 1 列，應自動偵測到');
}

// ── 3. 日期轉換：序列數字、文字、轉不出來 ─────────────────────
console.log('\n【3】日期轉換');
{
  ok(G.toYmd_(ser('2026-08-10')) === '2026-08-10', '序列數字應轉成正確日期（不可因時區差一天）');
  ok(G.toYmd_(ser('2026-01-01')) === '2026-01-01', '年初邊界');
  ok(G.toYmd_(ser('2025-12-31')) === '2025-12-31', '年末邊界');
  ok(G.toYmd_('2026-08-10') === '2026-08-10', '文字日期');
  ok(G.toYmd_('2026/8/6') === '2026-08-06', '斜線日期要補零');
  ok(G.toYmd_('3/28') === '', '🔴 手打「3/28」無年份，必須轉不出來（不可猜年份）');
  ok(G.toYmd_('') === '' && G.toYmd_(null) === '', '空值');
  ok(G.toYmd_('待確認') === '', '非日期文字');
  ok(G.toYmdHm_(serT('2026-08-06', 9, 12)) === '2026-08-06 09:12', '序列數字含時間');
  ok(G.toYmdHm_('✅ 核准 boss@waferlock.com 2026-08-06 09:12') === '2026-08-06 09:12',
     '要能從簽核文字裡取出時間');
  ok(G.toYmdHm_('✅ 核准 boss@waferlock.com') === '', '簽核文字沒寫時間時要取不到（歸「無法計算」）');
}

// ── 4. 金額：空白／非數字／極端值不可讓合計變 NaN ──────────────
console.log('\n【4】金額處理');
{
  ok(G.num_('') === 0 && G.num_(null) === 0, '空白算 0');
  ok(G.num_('待確認') === 0, '🔴 非數字算 0，不可回 NaN');
  ok(G.num_('1,234') === 1234, '千分位');
  // batchGet 用 UNFORMATTED_VALUE，格式成貨幣的儲存格取回來就是數字，
  // 所以「NT$5,000」只會出現在**真的被打成文字**的格子。那是資料問題，
  // 該被 isNonNumeric_ 抓出來列在稽核區，而不是靠猜去解析。
  ok(G.num_('NT$ 5,000') === 0, '文字型「NT$ 5,000」算 0（不猜）');
  ok(G.isNonNumeric_('NT$ 5,000') === true, '而且要被標為非數字，讓人去修那一格');
  ok(G.num_(1234.5) === 1234.5, '數字直接用');
  ok(G.isNonNumeric_('待確認') === true, '「待確認」要被認出是非數字');
  ok(G.isNonNumeric_('') === false, '空白不算「填了非數字」');
  ok(G.isNonNumeric_(1234) === false, '數字不算');
}

// ── 5. REPORT_SINCE ─────────────────────────────────────────
console.log('\n【5】起算日 REPORT_SINCE');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X' };            // 不設 REPORT_SINCE
  let d = G.buildReport_('ship');
  ok(d.sinceWarn === true, '🔴 未設定 REPORT_SINCE 必須警告');
  ok(d.since === '', '未設定時 since 為空');
  ok(d.audit.excludedBySince.dispatch === 0, '未設定時不排除任何資料');
  const withoutSince = d.months.length;

  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '亂填' };
  ok(G.buildReport_('ship').sinceWarn === true, '格式不對也要警告');

  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  d = G.buildReport_('ship');
  ok(d.sinceWarn === false, '設定後不再警告');
  ok(d.since === '2026-01-01', 'since 要帶到前端顯示');
  ok(d.months.every(m => m.month >= '2026-01'), '🔴 起算日之前的月份必須完全被排除');
  ok(d.months.length < withoutSince, '設起算日後月份數應減少（2025-12 被排掉）');
  ok(d.audit.excludedBySince.shipment >= 1, '被排除的筆數要計數，不可靜默丟掉');
  // 發包分頁的排除要在申請日基準下看：出貨日基準時，2024 那張沒出貨的單
  // 是「查不到出貨日」而不是「早於起算日」，兩者是不同的原因，不可混為一談。
  ok(G.buildReport_('apply').audit.excludedBySince.dispatch >= 1,
     '發包分頁被排除的筆數也要計數');
  const has2024 = d.workers.some(w => w.months.some(m => m.month < '2026-01'));
  ok(!has2024, '承包商工資也要吃起算日');
}

// ── 6. 跨年同月不可合併 ─────────────────────────────────────
console.log('\n【6】跨年同月');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X' };   // 不設起算日，才看得到 2025-12
  const d = G.buildReport_('ship');
  const dec = d.months.filter(m => /-12$/.test(m.month));
  ok(dec.length === 2, '🔴 2025-12 與 2026-12 必須是兩列，實際 ' + dec.length);
  const m2025 = d.months.find(m => m.month === '2025-12');
  const m2026 = d.months.find(m => m.month === '2026-12');
  ok(m2025 && m2025.sale === 100, '2025-12 售價應為 100，實際 ' + (m2025 && m2025.sale));
  ok(m2026 && m2026.sale === 200, '2026-12 售價應為 200，實際 ' + (m2026 && m2026.sale));
}

// ── 7. 超額請款 ─────────────────────────────────────────────
console.log('\n【7】超額請款警示');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  const d = G.buildReport_('ship');
  const o = d.overbilling;
  const nos = o.rows.map(r => r.orderNo);
  ok(nos.indexOf('JW-260302-01') >= 0, '🔴 累計 12 > 報價 10 要被抓到');
  ok(nos.indexOf('EL-260510-01') >= 0, '🔴 別名欄（合約數量）的超額也要抓到');
  ok(nos.indexOf('JW-260301-01') < 0, '累計 4 < 報價 10 不該被列出');
  const r1 = o.rows.find(r => r.orderNo === 'JW-260302-01');
  ok(r1.sheet === '零售-Johnson', '要指出在哪個分頁');
  ok(r1.row === 4, '要指出在哪一列（表頭第 2 列 + 2 筆資料 → 第 4 列），實際 ' + r1.row);
  ok(r1.diff === 2, '差額應為 2');
  ok(r1.worker === '蔣師傅', '要帶承包商，才知道找誰');
  ok(o.rows[0].diff >= o.rows[o.rows.length - 1].diff, '應依超出量排序');

  const un = o.uncheckable.map(u => u.sheet);
  ok(un.indexOf('陳俊行(廣信鎖店)') >= 0, '🔴 缺欄位的分頁要列為「無法檢查」，不可靜默略過');
  const ue = o.uncheckable.find(u => u.sheet === '陳俊行(廣信鎖店)');
  ok(ue.missing.length === 2, '要具名指出缺哪些欄位');
  ok(un.indexOf('零售-Johnson') < 0, '欄位齊全的分頁不該出現在無法檢查清單');
  ok(o.checked >= 5, '要回報實際比對過幾列（「沒查到」與「沒有查」要分得開）');

  // 起算日之前的舊單也要查——多付的錢沒有時效
  reset();
  // grid：[0]空列 [1]表頭 [2..]資料。2024 那一列是第 3 筆資料 → index 4
  BOOK['零售-Johnson'][4][H_J.indexOf('累計請款數量')] = 99;
  const d2 = G.buildReport_('ship');
  ok(d2.overbilling.rows.some(r => r.orderNo === 'JW-240501-01'),
     '🔴 起算日之前的超額請款仍要被抓到（不受 REPORT_SINCE 限制）');
}

// ── 8. 日期不明不可靜默丟棄 ─────────────────────────────────
console.log('\n【8】日期不明');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  const d = G.buildReport_('ship');
  ok(d.audit.unknownDate.shipment >= 1, '🔴 出貨日「3/28」要計入日期不明');
  ok(d.audit.unknownDate.dispatch >= 1, '🔴 申請日「3/28」要計入日期不明');
  const total = d.months.reduce((s, m) => s + m.count, 0);
  ok(total < 9, '日期不明的筆數不可混進月份統計');
  ok(d.audit.noShipNo === 1, '未鍵出貨單號要計數（1 筆），實際 ' + d.audit.noShipNo);
}

// ── 9. 兩種時間基準 ─────────────────────────────────────────
console.log('\n【9】時間基準切換');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  const ship = G.buildReport_('ship');
  const apply = G.buildReport_('apply');
  ok(ship.basis === 'ship' && apply.basis === 'apply', 'basis 要回傳');
  ok(G.buildReport_('亂填').basis === 'ship', '不認得的 basis 要退回出貨日基準');

  // JW-260301-01：申請 2026-03-01、出貨 2026-03-10 → 同月，但另一筆會分開
  const shipMar = ship.months.find(m => m.month === '2026-03');
  const applyMar = apply.months.find(m => m.month === '2026-03');
  ok(!!shipMar && !!applyMar, '兩種基準都要有 2026-03');

  // 沒有發包單號的出貨（S003）在申請日基準下算不到日期 → 要被計入日期不明，不可消失
  ok(apply.audit.unknownDate.shipment > ship.audit.unknownDate.shipment,
     '🔴 申請日基準下，沒有發包單號的出貨要歸「日期不明」並計數');
  const shipTotal = ship.months.reduce((s, m) => s + m.count, 0);
  const applyTotal = apply.months.reduce((s, m) => s + m.count, 0);
  ok(shipTotal > applyTotal, '出貨日基準涵蓋的筆數應多於申請日基準（後者需要發包單號）');

  // 承包商工資在出貨日基準下要靠發包單號回查出貨日
  const wShip = ship.workers.reduce((s, w) => s + w.count, 0);
  const wApply = apply.workers.reduce((s, w) => s + w.count, 0);
  ok(wShip > 0 && wApply > 0, '兩種基準都要算得出承包商工資');
  ok(wApply > wShip, '申請日基準下承包商筆數較多（不是每張發包單都有出貨）');
}

// ── 10. 業務／通路／工資彙總 ────────────────────────────────
console.log('\n【10】彙總');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  const d = G.buildReport_('ship');

  const john = d.sales.find(s => s.name === 'Johnson');
  ok(!!john, '應有業務 Johnson');
  ok(john.sale === 30000 + 5000 + 200 + 99000000,
     '售價合計應為 4 筆相加，實際 ' + john.sale);
  ok(isFinite(john.sale) && isFinite(john.profit), '🔴 合計不可為 NaN');
  ok(john.profitRows === 3, '毛利只算有進價的列（3 筆），實際 ' + john.profitRows);
  ok(d.sales[0].sale >= d.sales[1].sale, '業務應依售價排序');

  // ST 沒收錄在對照表 → 以代碼顯示並列入稽核
  ok(d.audit.unknownCodes.indexOf('ST') >= 0, '未收錄的業務代碼要列出');

  const chNames = d.channels.map(c => c.name);
  ['MOMO', '官網', '散戶'].forEach(c => ok(chNames.indexOf(c) >= 0, '通路應含 ' + c));
  const momo = d.channels.find(c => c.name === 'MOMO');
  ok(momo.count === 2, '「MOMO 三月團購」與「MOMO」應歸同一通路，實際 ' + momo.count);
  ok(chNames.indexOf('其他') >= 0, '不認得的案名要歸「其他」');
  ok((d.audit.otherProjects || []).some(p => p.name === '某建案'),
     '「其他」裡有哪些案名要列出來（否則無法收斂）');

  const w = d.workers.find(x => x.name === '蔣家工程行');
  ok(!!w && isFinite(w.price), '承包商工資合計不可為 NaN');
  ok(w.months.length >= 1 && /^\d{4}-\d{2}$/.test(w.months[0].month), '工資要有月分組');
}

// ── 11. 時間間距 ────────────────────────────────────────────
console.log('\n【11】時間間距');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  const d = G.buildReport_('ship');
  const g1 = d.gaps.applyToApprove;
  ok(g1.n >= 2, '下單→簽核應有可計算的筆數');
  ok(g1.max > 0 && g1.maxNo, '最久的那一筆要指出單號');
  ok(d.gaps.approveToShip.n >= 1, '簽核→出貨應算得到');
  const g3 = d.gaps.shipToWarehouse;
  // 出貨日只有日期（當成 00:00），核單有時間（14:00）→ 2.58 天，四捨五入到 2.6。
  // 刻意不把它抹成整數：核單延遲半天在營運上看得出差別。
  ok(g3.n === 1 && Math.abs(g3.avg - 2.6) < 0.05,
     '出貨 3/10 00:00 → 核單 3/12 14:00 應為 2.6 天，實際 ' + g3.avg);

  // 簽核欄沒寫時間 → 要進 unknown，不可當 0 天拉低平均
  reset();
  BOOK['零售-Johnson'][2][H_J.indexOf('主管簽核')] = '✅ 核准 boss@waferlock.com';
  const d2 = G.buildReport_('ship');
  ok(d2.gaps.applyToApprove.unknown >= 1,
     '🔴 簽核文字取不到時間的筆數要計入「無法計算」，不可當 0 天');
}

// ── 12. 資料稽核 ────────────────────────────────────────────
console.log('\n【12】資料稽核');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01', REPORT_OUTLIER_AMOUNT: '1000000' };
  const d = G.buildReport_('ship');
  ok(d.audit.outliers.some(o => o.value === 99000000), '售價極端值要被列出');
  ok(d.audit.outliers.every(o => o.sheet && o.row), '極端值要指出分頁與列號');
  ok(d.audit.nonNumeric.some(n => n.value === '待確認'),
     '金額欄填「待確認」要被列出（否則只會看到合計少了一筆卻不知為何）');
  ok(d.audit.noCost >= 1, '沒有進價的筆數要計數');

  const flat = d.audit.workerDupes.map(g => g.join('|'));
  ok(flat.some(s => /蔣家工程行/.test(s) && /蔣師傅/.test(s)),
     '「蔣家工程行」與「蔣師傅」應被列為疑似同一人');
  ok(!flat.some(s => /蔣/.test(s) && /陳家/.test(s)),
     '🔴「蔣家工程行」與「陳家工程行」不可被誤判為同一人');

  // 門檻可調
  props.REPORT_OUTLIER_AMOUNT = '100000000';
  reset();
  ok(!G.buildReport_('ship').audit.outliers.some(o => o.value === 99000000),
     '調高門檻後不再算極端值');
}

// ── 13. checkFieldParity ────────────────────────────────────
console.log('\n【13】欄名一致性檢查');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  let par = G.checkFieldParity();
  ok(par.length === 0, '目前的真實表頭不該有不認得的欄名，實際 ' + JSON.stringify(par));

  // 有人在表上新增一欄 → 必須被抓到
  BOOK['零售-Johnson'][1].push('新增的神秘欄位');
  par = G.checkFieldParity();
  ok(par.length === 1 && par[0].sheet === '零售-Johnson',
     '🔴 表上有、程式不認得的欄名要被抓出來');
  ok(par[0].headers.indexOf('新增的神秘欄位') >= 0, '要具名指出是哪一欄');
  ok(LOG.join('\n').indexOf('新增的神秘欄位') >= 0, '要寫進 Logger 讓人看得到');

  // 欄名被改掉（累計請款數量 → 累計請款數） → 也要被抓到
  reset();
  BOOK['零售-Johnson'][1][H_J.indexOf('累計請款數量')] = '累計請款數';
  par = G.checkFieldParity();
  ok(par.some(p => p.headers.indexOf('累計請款數') >= 0), '欄名被改過要被抓到');
  const d = G.buildReport_('ship');
  ok(d.overbilling.uncheckable.some(u => u.sheet === '零售-Johnson'),
     '🔴 欄名被改掉時，該分頁要變成「無法檢查」而不是「沒問題」');
}

// ── 14. 權限與快取 ──────────────────────────────────────────
console.log('\n【14】權限與快取');
{
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01',
            DISPATCH_BOSS_APPROVERS: 'boss@waferlock.com' };
  let res = G.getReport('ship');
  ok(res.ok === true, '主管應可取得報表');
  ok(res.unrestricted === false, '有設名單時 unrestricted 應為 false');
  ok(G.getReport('ship').cached === true, '第二次應命中快取');
  ok(G.getReport('apply').cached !== true, '不同基準應分開快取');

  props.DISPATCH_BOSS_APPROVERS = 'someone.else@waferlock.com';
  reset();
  res = G.getReport('ship');
  ok(res.ok === false && /僅限/.test(res.message), '🔴 非主管必須被擋（不能只靠 doGet 路由）');

  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  reset();
  ok(G.getReport('ship').unrestricted === true, '未設名單時要標示「目前無權限管控」');

  G.clearReportCache();
  ok(Object.keys(CACHE).length === 0, 'clearReportCache 應清掉兩個基準的快取');
}

// ── 15. 設定缺失要顯性失敗 ──────────────────────────────────
console.log('\n【15】設定缺失');
{
  reset();
  props = {};
  let threw = '';
  try { G.fetchAll_(); } catch (e) { threw = String(e); }
  ok(/DISPATCH_SHEET_ID/.test(threw), '缺 DISPATCH_SHEET_ID 要明確報錯');

  props = { DISPATCH_SHEET_ID: 'X' };
  const savedSheets = sandbox.Sheets;
  sandbox.Sheets = undefined;
  threw = '';
  try { G.fetchAll_(); } catch (e) { threw = String(e); }
  ok(/Sheets API/.test(threw), '未啟用進階服務要講清楚怎麼開，而不是丟 ReferenceError');
  sandbox.Sheets = savedSheets;

  // 出貨明細不見了 → 不可整個掛掉，但必須把失敗寫出來
  reset();
  props = { DISPATCH_SHEET_ID: 'X', REPORT_SINCE: '2026-01-01' };
  delete BOOK['出貨明細'];
  const d = G.buildReport_('ship');
  ok(d.errors.length >= 1 && /出貨明細/.test(d.errors[0]),
     '🔴 找不到出貨明細要顯性報出，不可靜默回 0');
  ok(d.overbilling.rows.length >= 1, '出貨明細壞掉時，超額請款檢查仍要能運作');

  // checkReportSetup 的自檢輸出
  reset();
  props = { DISPATCH_SHEET_ID: 'X' };
  const txt = G.checkReportSetup();
  ok(/REPORT_SINCE/.test(txt) && /🔴/.test(txt), '未設起算日時自檢要標紅');
  ok(/陳俊行/.test(txt), '自檢要指出哪些分頁無法檢查超額請款');
}

// ── 16. 畫面 ────────────────────────────────────────────────
console.log('\n【16】畫面');
{
  const page = G.reportBlock_('boss@waferlock.com', 'ship');
  ok(/發包報表/.test(page), '標題');
  ok(/出貨日基準/.test(page) && /發包申請日基準/.test(page), '要有兩種基準的切換');
  ok(/getReport\(BASIS\)/.test(page), '前端要把基準帶回伺服器');
  ok(/統計中…/.test(page), '要有載入提示（全量掃描要數秒）');
  ok(!/chart\.js|cdn|https?:\/\//i.test(page), '不可引入外部圖表庫或外部資源');
  ok(/class="bfill"/.test(page), '要用純 CSS 條狀圖');
  ok(page.indexOf('超額請款') < page.indexOf('業務銷售額'),
     '🔴 超額請款警示必須排在最前面');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');

  const full = G.htmlPage_('x')._h;
  ok(/\.bfill\{/.test(full) && /\.btrack\{/.test(full), '條狀圖樣式要在');
  ok(/max-width:520px/.test(full), '要有窄螢幕的 media query');

  const err = G.doGet({ parameter: {} });
  ok(/發包報表/.test(err._h), 'doGet 應回傳頁面');
  props = { DISPATCH_SHEET_ID: 'X', DISPATCH_BOSS_APPROVERS: 'nobody@waferlock.com' };
  ok(/僅限主管/.test(G.doGet({ parameter: {} })._h), '非主管開頁要看到擋下的訊息');
}

console.log('\n' + (fail ? '❌' : '✅') + ' 通過 ' + pass + '／失敗 ' + fail);
process.exit(fail ? 1 : 0);
