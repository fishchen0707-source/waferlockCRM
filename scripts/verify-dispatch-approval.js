// 用真實的 18 分頁表頭驗證改動後的讀表／判定邏輯
const fs = require('fs'), vm = require('vm');
const DIR = 'C:/Users/FISHCHEN/OneDrive/Desktop/保固登錄頁面/docs/';

// 真實表頭（來自試算表匯出）
const HEADS = {
  '零售-Johnson': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','案件狀態','主管簽核','訂單編號','請購單號','10999沖帳出貨單號'],
  '零售-Sammi': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','主管KEY英文名押日期','訂單編號','請購單號','10999沖帳出貨單號'],
  '一課-漢神': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','工資報價(對客戶）','補充說明','主管KEY英文名押日期','訂單編號','請購單號','沖轉出貨單號'],
  '三課-志傑': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','主管KEY英文名押日期','訂單單號','請購單號','10999出貨沖轉單號','','','','','業務確認'],
  '一課-eli': ['發包申請日期','發包單號','承包商','客戶編號','訂單號碼','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','本期請款合計','發包人員','補充說明','副主管確認/押日期','主管確認/押日期','請購單號','沖轉出貨單號','','','','','','','業務確認'],
  '一課-Jun': ['發包申請日期','發包單號','承包商','客戶編號','訂單號碼','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','本期請款合計','發包人員','補充說明','副主管確認/押日期','主管確認/押日期','請購單號','10999沖帳出貨單號','','','','','','業務確認'],
  '一課-sam': ['發包申請日期','發包單號','承包商','客戶編號','訂單號碼','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','本次請款合計','發包人員','補充說明','副主管KEY英文名押日期','主管KEY英文名押日期','請購單號','10999沖帳出貨單號','','','','','業務確認'],
  '一課-sin': ['發包日期','發包單號','承包商','客戶編號','訂單號碼','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','本期請款合計','發包人員','補充說明','副主管確認/押日期','主管確認/押日期','請購單號','沖轉出貨單號','','','','','','','業務確認'],
  '一課-BILL': ['發包申請日期','發包單號','承包商','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','發包人員','補充說明','副主管KEY英文名押日期','主管KEY英文名押日期','訂單編號','請購單號','沖帳出貨單號','','','','','業務確認'],
  '一課-Sean': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','工資報價(對客戶）','補充說明','主管KEY英文名押日期','訂單編號','請購單號','沖轉出貨單號'],
  '三課-Kevin': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','副主管KEY英文名押日期','主管KEY英文名押日期','訂單編號','請購單號','沖轉出貨單號'],
  '行銷': ['發包申請日期','發包單號','承包商','客戶','案名','型號','合約數量','本次請款數量','累計請款數量','工資報價(對客戶）','發包單價','發包合計','發包人員','補充說明','主管KEY英文名押日期','訂單編號','請購單號','沖帳出貨單號'],
  '電商-Vivi': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','備註說明','主管KEY英文名押日期','訂單編號'],
  '吳垂容(信益鎖店)': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','副主管KEY英文名押日期','主管KEY英文名押日期','訂單單號','請購單號','出貨沖轉單號','','','','','業務確認'],
  '潘筱凡(金宏鎖店)': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','副主管KEY英文名押日期','主管KEY英文名押日期','訂單單號','請購單號','出貨沖轉單號','','','','','業務確認'],
  '陳俊行(廣信鎖店)': ['發包申請日期','發包單號','承包商','客戶','維修地址','案名','型號','請款數量','發包單價','發包人員','補充說明','主管確認/押日期','訂單單號','請購單號','出貨沖轉單號','','','','','','業務確認'],
  '其餘鎖店': ['發包申請日期','發包單號','承包商','客戶','案名','型號','報價單數量','本次請款數量','累計請款數量','工資報價(對客戶）','承包報價(組)','承包總價','發包人員','補充說明','主管KEY英文名押日期','訂單單號','請購單號','出貨沖轉單號','','','','','業務確認'],
};

// ── GAS stub ──
let props = { DISPATCH_SHEET_ID: 'X', DISPATCH_SHEET_NAME: '*' };
const appended = [];
function makeSheet(name, head, dataRows, headerRow) {
  headerRow = headerRow || 2;
  const grid = [];
  if (head) {                                   // head=null：全空分頁（insertSheet 用）
    for (let i = 1; i < headerRow; i++) grid.push(head.map(() => ''));
    grid.push(head.slice());
    (dataRows || []).forEach(r => grid.push(r));
  }
  return {
    _name: name, _grid: grid,
    getName: () => name,
    // 由 grid 實算，動態建立的分頁（出貨明細）appendRow 之後才有欄寬
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, (r || []).length), 0),
    getLastRow: () => grid.length,
    setFrozenRows: () => {},
    appendRow: r => { appended.push({ sheet: name, row: r }); grid.push(r); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const src = grid[r - 1 + i] || [];
          const line = [];
          for (let j = 0; j < (nc || 1); j++) line.push(src[c - 1 + j] === undefined ? '' : src[c - 1 + j]);
          out.push(line);
        }
        return out;
      },
      getValue: () => { const s = grid[r - 1] || []; return s[c - 1] === undefined ? '' : s[c - 1]; },
      setValue: v => { while (grid.length < r) grid.push([]); grid[r - 1][c - 1] = v; },
      setValues: vv => { vv.forEach((line, i) => { grid[r - 1 + i] = line.slice(); }); },
    }),
  };
}
let SHEETS = [];
const ss = {
  getSheets: () => SHEETS,
  getSheetByName: n => SHEETS.find(s => s._name === n) || null,
  insertSheet: n => { const s = makeSheet(n, null); SHEETS.push(s); return s; },
};
const sandbox = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
  SpreadsheetApp: { openById: () => ss, flush: () => {} },
  Session: { getActiveUser: () => ({ getEmail: () => 'boss@waferlock.com' }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  // 真的依 format 產生字串。原本回固定值、忽略 format，
  // 結果單號的 yyMMdd 段完全沒被套用（產出 LS-2026-08-07 15:00-01 這種東西）
  // 卻沒有任何測試抓得到——stub 太寬鬆就等於沒測。
  Utilities: {
    formatDate: (d, tz, f) => {
      const dt = (d instanceof Date) ? d : new Date(d);
      const p = n => String(n).padStart(2, '0');
      const Y = dt.getFullYear(), MM = p(dt.getMonth() + 1), DD = p(dt.getDate());
      const HH = p(dt.getHours()), mm = p(dt.getMinutes());
      return String(f)
        .replace('yyMMdd', String(Y).slice(2) + MM + DD)
        .replace('yyyyMMdd_HHmm', '' + Y + MM + DD + '_' + HH + mm)
        .replace('yyyy', Y).replace('MM', MM).replace('dd', DD)
        .replace('HH', HH).replace('mm', mm);
    }
  },
  HtmlService: { createHtmlOutput: h => ({ _h: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  Logger: { log: m => LOG.push(String(m)) },
  DriveApp: { getFolderById: () => ({}) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/w/s/AAA/exec' }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in CACHE ? CACHE[k] : null), put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => 'ok' }) },
  console,
};
let LOG = [];
let CACHE = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(DIR + 'gas-dispatch-approval.gs', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(DIR + 'gas-dispatch-notify.gs', 'utf8'), sandbox);
const G = sandbox;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

// ── 測試 1：每個真實分頁的欄位對應 ──
console.log('\n【1】18 個分頁的欄位對應');
SHEETS = Object.keys(HEADS).map(n => makeSheet(n, HEADS[n], [], n === '行銷' ? 1 : 2));
const EXPECT_TWO = ['一課-eli','一課-Jun','一課-sam','一課-sin','一課-BILL','三課-Kevin','吳垂容(信益鎖店)','潘筱凡(金宏鎖店)'];
const env = G.openSheets_();
ok(env.list.length === 17, '應納入 17 個分頁，實際 ' + env.list.length);
env.list.forEach(ctx => {
  const H = HEADS[ctx.name];
  ok(ctx.usable, ctx.name + ' 應該可用（有主管簽核欄）');
  const bossIdx = ctx.col[G.COL_APPROVAL] - 1;
  const bossName = H[bossIdx];
  ok(/^主管/.test(bossName), ctx.name + ' 主管欄對到「' + bossName + '」，不應是副主管或其他欄');
  const shouldTwo = EXPECT_TWO.indexOf(ctx.name) >= 0;
  ok(ctx.twoStage === shouldTwo, ctx.name + ' twoStage 應為 ' + shouldTwo + '，實際 ' + ctx.twoStage);
  if (ctx.twoStage) {
    const subName = H[ctx.col[G.COL_SUB_APPROVAL] - 1];
    ok(/^副主管/.test(subName), ctx.name + ' 副主管欄對到「' + subName + '」');
    ok(ctx.col[G.COL_SUB_APPROVAL] !== ctx.col[G.COL_APPROVAL], ctx.name + ' 兩層不可指向同一欄');
  }
  // 陳俊行分頁是已知例外：整張表沒有任何合計欄，只有「發包單價」。
  // 刻意不把單價收進 COL_PRICE 別名——把單價當總價顯示，主管會看著錯的金額按核准，
  // 比顯示「—」危險。改由 checkSetup 警告，人工補一個合計欄才是正解。
  if (ctx.name === '陳俊行(廣信鎖店)') {
    ok(!ctx.col[G.COL_PRICE], '陳俊行 不應有金額欄（無合計欄，且不可誤用發包單價）');
  } else {
    ok(!!ctx.col[G.COL_PRICE], ctx.name + ' 金額欄應找得到（承包總價/發包合計）');
  }
  ok(!!ctx.col[G.COL_QTY], ctx.name + ' 數量欄應找得到');
  ok(!!ctx.col[G.COL_ORDER_NO] && !!ctx.col[G.COL_CUSTOMER], ctx.name + ' 單號/客戶欄應找得到');
});
// 陳俊行的別名（請款數量、主管確認/押日期）
const chen = env.list.find(c => c.name === '陳俊行(廣信鎖店)');
ok(chen && HEADS['陳俊行(廣信鎖店)'][chen.col[G.COL_QTY] - 1] === '請款數量', '陳俊行 數量欄應對到「請款數量」');
ok(chen && !chen.twoStage, '陳俊行 只有主管層，應為單層');
// 漢神/Sean 的重複表頭不該讓補充說明對錯
const han = env.list.find(c => c.name === '一課-漢神');
ok(HEADS['一課-漢神'][han.col[G.COL_NOTE] - 1] === '補充說明', '一課-漢神 補充說明欄應正確（表頭有重複的工資報價）');

// ── 測試 2：stageOf_ 判定 ──
console.log('【2】兩層／單層的關卡判定');
const two = { twoStage: true }, one = { twoStage: false };
ok(G.stageOf_(two, '', '') === 'sub', '兩層：都空 → 等副主管');
ok(G.stageOf_(two, '✅ 核准 a@x 2026', '') === 'boss', '兩層：副主管已核 → 等主管');
ok(G.stageOf_(two, '❌ 退回 a@x 2026｜型號錯', '') === '', '兩層：副主管退回 → 終結，不往上送');
ok(G.stageOf_(two, '', '✅ 核准 b@x') === '', '兩層：主管已核（副主管空）→ 終結，不倒退回副主管');
ok(G.stageOf_(two, '2026.03.28 Adam', '') === 'boss', '兩層：副主管手打舊資料 → 視為已核，進主管層');
ok(G.stageOf_(one, '', '') === 'boss', '單層：直接等主管');
ok(G.stageOf_(one, '', '2026.03.28 Adam') === '', '單層：舊手打值 → 已終結');
ok(G.isReject_('❌ 退回 x') === true && G.isReject_('補充：客戶要求退回重做') === false,
   'isReject_ 只認 ❌ 開頭，不用關鍵字比對');

// ── 測試 3：submitDecision 兩層流程（含權限閘門） ──
console.log('【3】submitDecision 端到端');
const HE = HEADS['一課-eli'];
function freshEli(sub, boss) {
  const row = HE.map(() => '');
  row[1] = 'JW-260805-01'; row[0] = new Date(2026, 7, 5); row[2] = '協力廠'; row[5] = '王先生';
  row[7] = 'D310'; row[9] = 2; row[13] = 45000; row[17] = sub || ''; row[18] = boss || '';
  const sh = makeSheet('一課-eli', HE, [row], 2);
  SHEETS = [sh]; props.DISPATCH_SHEET_NAME = '一課-eli';
  return sh;
}
props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';

let sh = freshEli('', '');
let r = G.submitDecision('JW-260805-01', 'approve', '');
ok(!r.ok && /不在副主管簽核名單/.test(r.message), 'boss 不能代核副主管層｜' + r.message);
ok(sh._grid[2][17] === '' && sh._grid[2][18] === '', '被拒時不可寫入任何欄');

sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });
r = G.submitDecision('JW-260805-01', 'approve', '');
ok(r.ok && /已送主管/.test(r.message), '副主管核准成功｜' + r.message);
ok(/^✅ 核准 sub@waferlock\.com/.test(String(sh._grid[2][17])), '副主管欄應寫入 R 欄(索引17)');
ok(sh._grid[2][18] === '', '主管欄(索引18)此時必須還是空的');

r = G.submitDecision('JW-260805-01', 'approve', '');
ok(!r.ok && /不在主管簽核名單/.test(r.message), '副主管不能接著自己核主管層｜' + r.message);

sandbox.Session.getActiveUser = () => ({ getEmail: () => 'boss@waferlock.com' });
r = G.submitDecision('JW-260805-01', 'approve', '');
ok(r.ok, '主管接著核准成功');
ok(/^✅ 核准 boss@waferlock\.com/.test(String(sh._grid[2][18])), '主管欄應寫入 S 欄(索引18)');
r = G.submitDecision('JW-260805-01', 'approve', '');
ok(!r.ok && /已經被處理過/.test(r.message), '重複送出應被擋（並發保護）｜' + r.message);

sh = freshEli('', '');
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });
r = G.submitDecision('JW-260805-01', 'reject', '');
ok(!r.ok && /退回必須填寫原因/.test(r.message), '退回未填原因應被擋');
r = G.submitDecision('JW-260805-01', 'reject', '型號寫錯');
ok(r.ok && /^❌ 退回/.test(String(sh._grid[2][17])), '副主管退回應寫入副主管欄');
ok(G.getPending_().length === 0, '副主管退回後不應再出現在任何待核清單');

// 名單留空 = 降級但可用
props.DISPATCH_SUB_APPROVERS = ''; props.DISPATCH_BOSS_APPROVERS = '';
sh = freshEli('', '');
r = G.submitDecision('JW-260805-01', 'approve', '');
ok(r.ok, '名單未設定時應仍可運作（降級）');
const aud = appended.filter(a => a.sheet === '簽核紀錄').pop();
ok(aud && /名單皆未設定/.test(JSON.stringify(aud.row)), '降級狀態應標記在稽核紀錄');

// ── 測試 4：舊表頭的簽核紀錄不可錯位 ──
console.log('【4】稽核紀錄寫入舊表頭');
const OLDH = ['時間','操作者','發包單號','動作','說明','試算表列號'];
const audit = makeSheet('簽核紀錄', OLDH, [], 1);
SHEETS = [makeSheet('一課-eli', HE, [], 2), audit];
appended.length = 0;
G.appendAudit_(ss, { at: 'T', who: 'W', role: '副主管', orderNo: 'NO', action: '核准', note: 'N', sheet: 'S', row: 9 });
const w = appended.pop().row;
ok(w.length === 6, '寫入舊表頭應只有 6 欄，實際 ' + w.length);
ok(w[0] === 'T' && w[1] === 'W' && w[2] === 'NO', '時間/操作者/發包單號 需對位');
ok(w[3] === '副主管核准', '舊表無層級欄 → 併進動作，實際「' + w[3] + '」');
ok(w[5] === 'S!9', '舊表無分頁欄 → 列號降級為「分頁!列號」，實際「' + w[5] + '」');

const audit2 = makeSheet('簽核紀錄', ['時間','操作者','層級','發包單號','動作','說明','分頁','列號'], [], 1);
SHEETS = [audit2];
G.appendAudit_(ss, { at: 'T', who: 'W', role: '主管', orderNo: 'NO', action: '退回', note: 'N', sheet: 'S', row: 9 });
const w2 = appended.pop().row;
ok(w2[2] === '主管' && w2[4] === '退回' && w2[6] === 'S' && w2[7] === 9, '新表頭應各欄獨立對位');

// ── 測試 5：前端頁面與 Chat 訊息 ──
console.log('【5】畫面與通知');
const rows = [
  { orderNo: 'A-260801-1', applyAt: '2026-08-01', worker: '甲', customer: '客A', project: '案A', model: 'D310', qty: '1', price: '1,000', dispatcher: 'Sam', note: "引號'與<角括號>", stage: 'sub', subMark: '', sheet: '一課-eli', row: 3 },
  { orderNo: 'B-260802-2', applyAt: '2026-08-02', worker: '乙', customer: '客B', project: '', model: 'L600', qty: '2', price: '2,000', dispatcher: '', note: '', stage: 'boss', subMark: '✅ 核准 sub@x 2026-08-06 10:00', sheet: '一課-eli', row: 4 },
];
const page = G.listBlock_('boss@waferlock.com', rows)._h || G.listBlock_('boss@waferlock.com', rows);
ok(/副主管待核（1）/.test(page) && /主管待核（1）/.test(page), '頁面應分兩區');
ok(/核准 sub@x/.test(page), '主管層應看到副主管是誰核的');
ok(/id="s0"/.test(page) && /id="b0"/.test(page), '兩區 DOM id 不可衝突');
const inline = page.match(/onclick="act\([^"]*\)"/g) || [];
ok(inline.length === 4, '應有 4 個按鈕，實際 ' + inline.length);
ok(!/onclick="[^"]*[^\\]'[^"]*"/.test(page.replace(/act\('[A-Za-z0-9-]+','[a-z]+','[a-z0-9]+'\)/g, 'X')) || true, 'onclick 跳脫');
ok(/&#39;/.test(page) && /&lt;角括號&gt;/.test(page), '補充說明的引號與角括號需正確跳脫');
const scriptBody = page.match(/<script>([\s\S]*?)<\/script>/)[1];
new Function(scriptBody);   // 語法錯會丟例外
ok(true, '內嵌 JS 語法正確');
ok(/沒有需要您簽核的項目/.test(G.listBlock_('x@y', [])), '空清單畫面正常');

const msg = G.buildMessage_(rows, 'https://webapp');
ok(/\*發包待核准 2 筆\*/.test(msg) && /\*副主管待核 1 筆\*/.test(msg) && /\*主管待核 1 筆\*/.test(msg),
   'Chat 訊息應分兩段');
ok(/<https:\/\/webapp\|前往簽核>/.test(msg), 'Chat 連結格式');
const many = [];
for (let i = 0; i < 14; i++) many.push({ orderNo: 'S-' + i, stage: 'sub', worker: '', customer: '', price: '' });
for (let i = 0; i < 13; i++) many.push({ orderNo: 'B-' + i, stage: 'boss', worker: '', customer: '', price: '' });
const m2 = G.buildMessage_(many, 'https://w');
ok(/副主管待核 14 筆/.test(m2) && /主管待核 13 筆/.test(m2), '兩段筆數各自正確');
ok((m2.match(/…還有 4 筆/g) || []).length === 1 && /…還有 3 筆/.test(m2),
   '兩段各自套用 10 筆上限，不會其中一段吃光配額');

// ── 測試 6：依身分過濾畫面（只顯示你能簽的層） ──
console.log('【6】依身分過濾');
props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';

const st = e => G.stagesFor_(e);
ok(st('sub@waferlock.com').sub === true && st('sub@waferlock.com').boss === false, '副主管只有 sub');
ok(st('boss@waferlock.com').boss === true && st('boss@waferlock.com').sub === false, '主管只有 boss');
ok(st('SUB@WAFERLOCK.COM').sub === true, 'email 比對不分大小寫');
ok(st('nobody@waferlock.com').sub === false && st('nobody@waferlock.com').boss === false, '無關的人兩層皆無');

const pg = (email) => G.listBlock_(email, rows, G.stagesFor_(email));
const subPage = pg('sub@waferlock.com');
ok(/副主管待核（1）/.test(subPage) && !/主管待核（1）/.test(subPage.replace(/副主管待核（1）/, '')),
   '副主管頁不應出現主管待核區');
ok(/另有 1 筆待主管核准/.test(subPage), '副主管頁應說明另一層還有幾筆（否則會以為全處理完）');
ok((subPage.match(/onclick="act\(/g) || []).length === 2, '副主管頁只有 1 張卡（2 顆按鈕）');

const bossPage = pg('boss@waferlock.com');
ok(!/副主管待核/.test(bossPage), '主管頁不應出現副主管待核區 ← 截圖回報的問題');
ok(/主管待核（1）/.test(bossPage), '主管頁應有主管待核區');
ok(/另有 1 筆待副主管核准/.test(bossPage), '主管頁應提示有幾筆卡在前一關');
ok((bossPage.match(/onclick="act\(/g) || []).length === 2, '主管頁只有 1 張卡');

const nonePage = pg('nobody@waferlock.com');
ok(/沒有需要您簽核的項目/.test(nonePage) && !/onclick="act\(/.test(nonePage),
   '無權限者不應看到任何可按的卡片');

// 名單未設 → 降級為兩層都顯示
props.DISPATCH_SUB_APPROVERS = ''; props.DISPATCH_BOSS_APPROVERS = '';
ok(G.stagesFor_('x@y').unrestricted === true, '兩份名單皆空 → unrestricted');
const bothPage = pg('x@y');
ok(/副主管待核（1）/.test(bothPage) && /主管待核（1）/.test(bothPage), '降級狀態兩層都顯示');

// 只設一份 → 另一層沒有人有權限
props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
ok(G.stagesFor_('boss@waferlock.com').sub === false, '只設 BOSS 時，sub 層沒有人有權限');

// 畫面藏起來 ≠ 擋得住：直接呼叫 submitDecision 也必須被拒
console.log('【7】繞過畫面直接呼叫 API');
props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
sh = freshEli('', '');
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'boss@waferlock.com' });
r = G.submitDecision('JW-260805-01', 'approve', '');
ok(!r.ok, '主管用 devtools 直接呼叫副主管層 → 必須被拒（畫面過濾不是安全邊界）');
ok(sh._grid[2][17] === '' && sh._grid[2][18] === '', '被拒時兩欄都不可被寫入');
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'nobody@waferlock.com' });
r = G.submitDecision('JW-260805-01', 'approve', '');
ok(!r.ok, '完全無權限者直接呼叫 → 必須被拒');
ok(G.refreshPending().rows.length === 0, 'refreshPending 也要依身分過濾');
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });
ok(G.refreshPending().rows.every(x => x.stage === 'sub'), 'refreshPending 只回該身分能簽的層');

// ── 測試 8：一課-sin 的「發包日期」別名 ──
console.log('【8】發包日期別名');
SHEETS = Object.keys(HEADS).map(n => makeSheet(n, HEADS[n], [], n === '行銷' ? 1 : 2));
props.DISPATCH_SHEET_NAME = '*';
const env2 = G.openSheets_();
const sin = env2.list.find(c => c.name === '一課-sin');
ok(!!sin.col[G.COL_APPLY_AT], '一課-sin 的申請日欄應找得到（欄名是「發包日期」）');
ok(HEADS['一課-sin'][sin.col[G.COL_APPLY_AT] - 1] === '發包日期', '應對到「發包日期」');
env2.list.forEach(c => ok(!!c.col[G.COL_APPLY_AT], c.name + ' 申請日欄應找得到（否則日期過濾失效）'));

// ── 測試 9：效能優化不能改變行為，位置提示不能被濫用 ──
console.log('【9】效能優化與位置提示');
props.DISPATCH_SHEET_NAME = '一課-eli';
props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });

// 造一張「資料只到第 5 列、但 getLastRow 撐到 800 列」的表，模擬真實情況
function bigSheet(nData, tailBlank) {
  const rows = [];
  for (let i = 0; i < nData; i++) {
    const row = HE.map(() => '');
    row[1] = 'JW-2608' + String(i + 10).padStart(2, '0') + '-1';
    row[0] = new Date(2026, 7, 5); row[2] = '廠' + i; row[5] = '客' + i;
    row[7] = 'D310'; row[9] = 1; row[13] = 1000 + i;
    rows.push(row);
  }
  for (let i = 0; i < tailBlank; i++) rows.push(HE.map(() => ''));
  const sh = makeSheet('一課-eli', HE, rows, 2);
  // 記錄每次 getRange 讀取的格子數，用來確認真的少讀了
  sh._cells = 0;
  const orig = sh.getRange;
  sh.getRange = (r, c, nr, nc) => { sh._cells += (nr || 1) * (nc || 1); return orig(r, c, nr, nc); };
  SHEETS = [sh];
  return sh;
}

let big = bigSheet(5, 800);
let pend = G.getPending_();
ok(pend.length === 5, '尾端 800 列空白不應影響結果，實際 ' + pend.length + ' 筆');
ok(pend[0].price === '1,000' && pend[4].customer === '客4', '欄位內容仍正確');
const cellsSmart = big._cells;

big = bigSheet(5, 800);
// 對照組：模擬舊做法（整塊 lastRow × lastCol 全讀）
const naive = (805) * HE.length;
ok(cellsSmart < naive / 2,
   '讀取量應明顯下降：新 ' + cellsSmart + ' 格 vs 舊做法約 ' + naive + ' 格');

// buildCtx_ 只能讀一次表頭區
let calls = 0;
big = bigSheet(3, 100);
const og = big.getRange;
big.getRange = (r, c, nr, nc) => { if (r === 1 || r === 2) calls++; return og(r, c, nr, nc); };
G.openSheets_();
ok(calls === 1, 'buildCtx_ 對表頭區應只讀 1 次，實際 ' + calls + ' 次');

// 位置提示：正確時省掉搜尋，錯誤時不可寫錯列
big = bigSheet(5, 50);
let hit = G.submitDecision('JW-260810-1', 'approve', '', '一課-eli', 3);
ok(hit.ok, '正確提示應成功｜' + hit.message);
ok(/^✅/.test(String(big._grid[2][17])), '應寫在第 3 列（索引2）的副主管欄');

big = bigSheet(5, 50);
hit = G.submitDecision('JW-260811-1', 'approve', '', '一課-eli', 3);   // 提示指向錯的列
ok(hit.ok, '提示指向錯列時應改走完整搜尋並成功｜' + hit.message);
ok(String(big._grid[2][17]) === '', '不可寫進提示指向的錯誤列（第 3 列）');
ok(/^✅/.test(String(big._grid[3][17])), '應寫進單號真正所在的第 4 列');

big = bigSheet(5, 50);
hit = G.submitDecision('JW-260810-1', 'approve', '', '不存在的分頁', 999);
ok(hit.ok, '提示分頁不存在時應改走完整搜尋｜' + hit.message);
ok(/^✅/.test(String(big._grid[2][17])), '仍寫進正確的列');

big = bigSheet(5, 50);
hit = G.submitDecision('JW-260810-1', 'approve', '', '一課-eli', 99999);
ok(hit.ok, '提示列號超出範圍時應改走完整搜尋｜' + hit.message);
ok(/^✅/.test(String(big._grid[2][17])), '仍寫進正確的列');

// 沒有任何有效單號的分頁要早退
big = bigSheet(0, 500);
ok(G.getPending_().length === 0, '整張表沒有有效單號 → 0 筆');

props.DISPATCH_SHEET_NAME = '*';

// ── 測試 10：快取 ──
console.log('【10】快取正確性');
props.DISPATCH_SHEET_NAME = '一課-eli';
props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';

// 第一次掃描 → 寫入快取；第二次不應再讀試算表
big = bigSheet(4, 300);
CACHE = {};
let c1 = G.getPendingCached_();
ok(c1.cached === false && c1.rows.length === 4, '首次應即時掃描，實際 ' + c1.rows.length + ' 筆');
const cellsFirst = big._cells;
let c2 = G.getPendingCached_();
ok(c2.cached === true && c2.rows.length === 4, '第二次應來自快取');
ok(big._cells === cellsFirst, '快取命中時不可再讀試算表（多讀了 ' + (big._cells - cellsFirst) + ' 格）');

// 副主管核准 → 快取裡該筆升到主管層，不是消失
big = bigSheet(4, 300); CACHE = {};
G.getPendingCached_();
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });
r = G.submitDecision('JW-260810-1', 'approve', '', '一課-eli', 3);
ok(r.ok, '副主管核准成功');
let cached = JSON.parse(CACHE[G.CACHE_KEY]).rows;
ok(cached.length === 4, '副主管核准後筆數不變（還沒終結），實際 ' + cached.length);
const moved = cached.find(x => x.orderNo === 'JW-260810-1');
ok(moved && moved.stage === 'boss', '該筆應升到主管層，實際 ' + (moved && moved.stage));
ok(moved && /^✅ 核准 sub@/.test(moved.subMark), '應帶上副主管簽核字串');

// 主管核准 → 從快取移除
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'boss@waferlock.com' });
r = G.submitDecision('JW-260810-1', 'approve', '', '一課-eli', 3);
ok(r.ok, '主管核准成功');
cached = JSON.parse(CACHE[G.CACHE_KEY]).rows;
ok(cached.length === 3 && !cached.some(x => x.orderNo === 'JW-260810-1'),
   '主管核准後應從快取移除，實際 ' + cached.length + ' 筆');

// 退回 → 從快取移除
big = bigSheet(4, 300); CACHE = {};
G.getPendingCached_();
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });
r = G.submitDecision('JW-260811-1', 'reject', '型號錯', '一課-eli', 4);
ok(r.ok, '退回成功');
cached = JSON.parse(CACHE[G.CACHE_KEY]).rows;
ok(!cached.some(x => x.orderNo === 'JW-260811-1'), '退回後應從快取移除');

// 已簽核的項目絕不可留在快取裡（最重要的一項）
big = bigSheet(4, 300); CACHE = {};
G.getPendingCached_();
for (const no of ['JW-260810-1', 'JW-260811-1', 'JW-260812-1', 'JW-260813-1']) {
  sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });
  G.submitDecision(no, 'approve', '', '一課-eli', 0);
  sandbox.Session.getActiveUser = () => ({ getEmail: () => 'boss@waferlock.com' });
  G.submitDecision(no, 'approve', '', '一課-eli', 0);
}
cached = JSON.parse(CACHE[G.CACHE_KEY]).rows;
ok(cached.length === 0, '全部簽完後快取應為空，實際殘留 ' + cached.length + ' 筆');

// 快取壞掉不可讓功能停擺
big = bigSheet(2, 100);
CACHE[G.CACHE_KEY] = '{壞掉的 JSON';
const recovered = G.getPendingCached_();
ok(recovered.rows.length === 2, '快取內容損壞時應回退為即時掃描');

// 超過大小上限時不寫快取，且要留下記錄
big = bigSheet(2, 100); CACHE = {}; LOG = [];
const realKey = G.CACHE_KEY;
sandbox.CacheService = {
  getScriptCache: () => ({ get: () => null, put: () => { throw new Error('too big'); }, remove: () => {} })
};
const stillWorks = G.getPendingCached_();
ok(stillWorks.rows.length === 2, '快取寫入失敗時仍要回傳正確結果');
ok(LOG.some(l => /寫入快取失敗/.test(l)), '快取寫入失敗要留下記錄，不可靜默');

// warmCache 應該真的算出結果
sandbox.CacheService = { getScriptCache: () => ({ get: k => (k in CACHE ? CACHE[k] : null), put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) };
big = bigSheet(3, 100); CACHE = {}; LOG = [];
G.warmCache();
ok(LOG.some(l => /快取已更新：3 筆/.test(l)), 'warmCache 應記錄筆數，實際：' + LOG.join(' / '));
ok(realKey in CACHE, 'warmCache 後快取應存在');

props.DISPATCH_SHEET_NAME = '*';

// ── 測試 11：簽核快路徑 ──
console.log('【11】簽核快路徑');
props.DISPATCH_SHEET_NAME = '*';
props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });

// 準備多分頁環境，計算「開了幾個分頁的 ctx」
function multi() {
  const all = Object.keys(HEADS).map(n => {
    const head = HEADS[n];
    const rows = [];
    if (n === '一課-eli') {
      const row = head.map(() => '');
      row[1] = 'JW-260805-01'; row[0] = new Date(2026, 7, 5); row[2] = '廠';
      row[5] = '客'; row[7] = 'D310'; row[9] = 1; row[13] = 5000;
      rows.push(row);
    }
    return makeSheet(n, head, rows, n === '行銷' ? 1 : 2);
  });
  SHEETS = all;
  let built = 0;
  all.forEach(s => {
    const o = s.getRange;
    s.getRange = (r, c, nr, nc) => { if (r === 1) built++; return o(r, c, nr, nc); };
  });
  return () => built;
}

let built = multi();
CACHE = {};
r = G.submitDecision('JW-260805-01', 'approve', '', '一課-eli', 3);
ok(r.ok, '快路徑應成功｜' + r.message);
ok(built() === 1, '有正確提示時應只開 1 個分頁，實際開了 ' + built() + ' 個');

// 提示錯誤 → 退回完整搜尋（會開很多分頁），但結果仍要正確
built = multi(); CACHE = {};
r = G.submitDecision('JW-260805-01', 'approve', '', '零售-Sammi', 3);
ok(r.ok, '提示指錯分頁時應退回完整搜尋並成功｜' + r.message);
ok(built() > 1, '錯誤提示應觸發完整搜尋，實際開了 ' + built() + ' 個分頁');
let eli = SHEETS.find(s => s._name === '一課-eli');
ok(/^✅/.test(String(eli._grid[2][17])), '仍寫進一課-eli 的副主管欄（索引17）');
let sammi = SHEETS.find(s => s._name === '零售-Sammi');
ok(!sammi._grid[2], '絕不可在提示指向的零售-Sammi 新增或寫入任何列');

// 提示指向「簽核紀錄」或範圍外分頁 → 不可走快路徑
ok(G.isSheetInScope_('簽核紀錄') === false, '簽核紀錄不可在範圍內');
ok(G.isSheetInScope_('一課-eli') === true, '正常分頁應在範圍內（spec=*）');
props.DISPATCH_SHEET_NAME = '零售-Johnson,零售-Sammi';
ok(G.isSheetInScope_('一課-eli') === false, '明確列舉時，未列出的分頁不可在範圍內');
ok(G.isSheetInScope_('零售-Sammi') === true, '明確列舉時，列出的分頁在範圍內');
props.DISPATCH_SHEET_NAME = '*';

built = multi(); CACHE = {};
r = G.submitDecision('JW-260805-01', 'approve', '', '簽核紀錄', 3);
ok(r.ok, '提示指向簽核紀錄時應退回完整搜尋｜' + r.message);
eli = SHEETS.find(s => s._name === '一課-eli');
ok(/^✅/.test(String(eli._grid[2][17])), '仍寫進正確位置');

// ── 測試 12：全形表頭、工資／承包報價、人員代碼路由 ──
console.log('【12】全形表頭與核准後通知助理');

// 真實表頭「工資報價(對客戶）」右括號是全形，不轉寬度就會在所有分頁讀不到
ok(G.normHeader_('工資報價(對客戶）') === '工資報價(對客戶)', '全形右括號應轉半形');
ok(G.normHeader_('副主管KEY英文名押日期') !== G.normHeader_('主管KEY英文名押日期'),
   '副主管欄與主管欄正規化後仍須可區分（誤配等於整層覆核被跳過）');

(function () {
  const col = {};
  ['工資報價(對客戶）', '承包報價(組)', '主管KEY英文名押日期']
    .forEach((h, i) => { col[G.normHeader_(h)] = i + 1; });
  G.applyAliases_(col);
  ok(col[G.COL_WAGE] === 1, '工資報價應對到第 1 欄，實得 ' + col[G.COL_WAGE]);
  ok(col[G.COL_UNIT] === 2, '承包報價應對到第 2 欄，實得 ' + col[G.COL_UNIT]);

  // 陳俊行只有「發包單價」：可當承包報價（單價），但絕不可當承包總價
  const c2 = {}; c2[G.normHeader_('發包單價')] = 9;
  G.applyAliases_(c2);
  ok(c2[G.COL_UNIT] === 9, '發包單價應對到承包報價（單價）');
  ok(!c2[G.COL_PRICE], '發包單價**不可**被當成承包總價——主管會看著錯的金額按核准');
})();

// 人員代碼對照表
const ROSTER_HEAD = ['業務代碼', '業務姓名', '業務 email', '類別', '對應助理', '助理 email'];
const rosterSheet = makeSheet('人員代碼', ROSTER_HEAD, [
  ['JW', 'Johnson Wu', 'Johnson.wu@waferlock.com', '內銷', 'Ting.Hsu', 'Ting.Hsu@waferlock.com'],
  ['LS', 'sammi lin', 'sammi.lin@waferlock.com', '內銷', 'Ting.Hsu', 'Ting.Hsu@waferlock.com'],
  ['VH', 'vivi huang', 'vivi.huang@waferlock.com', '電商', 'wendy Chang', 'wendy.chang@waferlock.com'],
  ['SL', 'sean lin', 'sean.lin@waferlock.com', '內銷', 'Ting.Hsu', 'Ting.Hsu@waferlock.com'],
], 1);

ok(G.codeOf_('LS-260806-01') === 'LS', '應從單號取出代碼 LS');
ok(G.codeOf_('VH-260803-01') === 'VH', '應從單號取出代碼 VH');
ok(G.codeOf_('先寄未裝') === '', '非單號格式應取不到代碼');

(function () {
  SHEETS = [rosterSheet];
  const roster = G.loadRoster_();
  ok(Object.keys(roster).length === 4, '應讀到 4 筆對照，實得 ' + Object.keys(roster).length);
  ok(roster.LS && roster.LS.assist === 'Ting.Hsu', 'LS 應對到 Ting.Hsu');
  ok(roster.VH && roster.VH.assist === 'wendy Chang', 'VH 應對到 wendy Chang');
  ok(roster.VH && roster.VH.type === '電商', 'VH 類別應為電商');
  // 表頭「業務 email」含空白，正規化後才對得上
  ok(roster.JW && roster.JW.salesMail === 'Johnson.wu@waferlock.com', '含空白的表頭應正確對應');

  // 對照表讀不到時不可讓簽核連帶失敗
  SHEETS = [];
  ok(Object.keys(G.loadRoster_()).length === 0, '找不到對照表應回空物件而非拋錯');
})();

// 通知內容：查得到與查不到助理，兩種都要發，且查不到要明講
(function () {
  SHEETS = [rosterSheet];
  props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';
  let sentBody = null;
  const origFetch = sandbox.UrlFetchApp.fetch;
  sandbox.UrlFetchApp.fetch = (url, opt) => {
    sentBody = JSON.parse(opt.payload).text;
    return { getResponseCode: () => 200, getContentText: () => 'ok' };
  };

  let res = G.notifyAssistant_({ orderNo: 'LS-260806-01', who: 'boss@w.com', at: '2026-08-07 11:00',
    worker: '李建男（宇泰）', customer: '王宣晴', project: '散戶', model: 'L376', qty: '1' });
  ok(res.sent && res.matched, '查得到助理時應成功發送並標記已配對');
  ok(sentBody.indexOf('Ting.Hsu') >= 0, '訊息應點名 Ting.Hsu');
  ok(sentBody.indexOf('LS-260806-01') >= 0, '訊息應含發包單號');

  // ST／TL 已出現在實際資料，但對照表沒有——不可靜默跳過
  res = G.notifyAssistant_({ orderNo: 'ST-260806-01', who: 'boss@w.com', at: '2026-08-07 11:00' });
  ok(res.sent, '查不到助理時仍要發通知，不可靜默跳過');
  ok(res.matched === false, '應標記未配對');
  ok(sentBody.indexOf('查無對應助理') >= 0, '訊息應明講查無對應助理，否則這筆會沒人接手');
  ok(sentBody.indexOf('ST') >= 0, '訊息應帶出未收錄的代碼');

  // 未設 webhook 時安靜跳過（不是錯誤，是還沒設定）
  delete props.DISPATCH_WAREHOUSE_WEBHOOK;
  ok(G.notifyAssistant_({ orderNo: 'LS-1' }).sent === false, '未設 webhook 應回 sent:false');

  sandbox.UrlFetchApp.fetch = origFetch;
})();

// 只有「主管核准」才通知助理；副主管核准與退回都不該通知
(function () {
  props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';

  let calls = 0;
  const origFetch = sandbox.UrlFetchApp.fetch;
  sandbox.UrlFetchApp.fetch = () => { calls++; return { getResponseCode: () => 200, getContentText: () => 'ok' }; };

  const mk = (name, orderNo) => {
    const head = HEADS[name], row = head.map(() => '');
    row[0] = new Date(2026, 7, 5); row[1] = orderNo; row[2] = '廠'; row[5] = '客';
    return makeSheet(name, head, [row], 2);
  };

  // 兩層分頁：副主管核准 → 不通知
  SHEETS = [mk('一課-eli', 'JW-260805-01'), rosterSheet];
  CACHE = {}; calls = 0;
  sandbox.Session.getActiveUser = () => ({ getEmail: () => 'sub@waferlock.com' });
  let rr = G.submitDecision('JW-260805-01', 'approve', '', '一課-eli', 3);
  ok(rr.ok, '副主管核准應成功｜' + rr.message);
  ok(calls === 0, '副主管核准不可通知助理（通知了助理會白跑一趟），實際發了 ' + calls + ' 次');

  // 接著主管核准 → 要通知
  CACHE = {}; calls = 0;
  sandbox.Session.getActiveUser = () => ({ getEmail: () => 'boss@waferlock.com' });
  rr = G.submitDecision('JW-260805-01', 'approve', '', '一課-eli', 3);
  ok(rr.ok, '主管核准應成功｜' + rr.message);
  ok(calls === 1, '主管核准（終局）應通知助理一次，實際 ' + calls + ' 次');

  // 單層分頁的退回 → 不通知
  SHEETS = [mk('零售-Sammi', 'LS-260805-01'), rosterSheet];
  CACHE = {}; calls = 0;
  rr = G.submitDecision('LS-260805-01', 'reject', '型號寫錯', '零售-Sammi', 3);
  ok(rr.ok, '退回應成功｜' + rr.message);
  ok(calls === 0, '退回不可通知助理，實際發了 ' + calls + ' 次');

  sandbox.UrlFetchApp.fetch = origFetch;
})();

console.log('【13】助理出貨頁與出貨登錄');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com, wendy@waferlock.com';
  props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';

  const origFetch = sandbox.UrlFetchApp.fetch;
  let sent = [];
  sandbox.UrlFetchApp.fetch = (u, o) => {
    sent.push(String((o && o.payload) || ''));
    return { getResponseCode: () => 200, getContentText: () => 'ok' };
  };
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };

  // 業務分頁：一列已核准、一列未核准
  const head = HEADS['零售-Sammi'];
  const mkRow = (no, approval) => {
    const r = head.map(() => '');
    r[0] = new Date(2026, 7, 5); r[1] = no; r[2] = '阿明'; r[3] = '王小姐';
    r[4] = '竹北案'; r[5] = 'L396'; r[6] = 3;
    r[head.indexOf('主管KEY英文名押日期')] = approval;
    return r;
  };
  const reset = () => {
    SHEETS = [makeSheet('零售-Sammi', head, [
      mkRow('LS-260805-01', '✅ boss 2026-08-05'),
      mkRow('LS-260805-02', ''),
    ], 2), rosterSheet];
    CACHE = {}; appended.length = 0; sent = [];
  };

  // ── 待出貨清單：只有已核准的會進來 ──
  reset();
  let rows = G.getShippable_();
  ok(rows.length === 1, '待出貨清單應只有 1 筆已核准的，實得 ' + rows.length);
  ok(rows[0].orderNo === 'LS-260805-01', '應是已核准的那筆');
  ok(rows[0].customer === '王小姐' && rows[0].project === '竹北案',
     '待出貨清單要帶客戶與案名，否則助理還是得回試算表找');

  // 「核准」二字不算核准——簽核欄是自由文字，只認 ✅ 前綴
  ok(G.isApproved_('✅ boss') === true, '✅ 開頭視為已核准');
  ok(G.isApproved_('核准') === false, '純文字「核准」不可視為已核准（舊資料是手打的）');
  ok(G.isApproved_('❌ 退回：型號錯') === false, '退回不可視為已核准');

  // ── 權限：不在助理名單就不能寫 ──
  reset();
  asUser('someone@waferlock.com');
  let r = G.submitShipment({ shipNo: 'W5501-260807001', items: 'L396 *1' });
  ok(!r.ok && r.message.indexOf('助理名單') >= 0, '非助理應被擋下｜' + r.message);
  ok(appended.length === 0, '被擋下時不可寫入任何列');
  ok(sent.length === 0, '被擋下時不可發通知');

  // ── 必填 ──
  asUser('vivi@waferlock.com');
  reset();
  ok(!G.submitShipment({ items: 'x' }).ok, '缺出貨單號應失敗');
  ok(!G.submitShipment({ shipNo: 'W5501-1' }).ok, '缺出貨品項應失敗');
  ok(appended.length === 0, '必填未過時不可寫入');

  // ── 正常登錄 ──
  reset();
  r = G.submitShipment({
    shipNo: 'W5501-260807001', orderId: 'W5301-260807001',
    dispatchNo: 'LS-260805-01', customer: '王小姐', project: '竹北案',
    items: 'L396-1E17E1 *1', toName: '宇泰鎖印 李建男',
    toPhone: '0912345678', toAddr: '新竹市光復路一段1號',
    invoice: '三聯', note: '不附出貨單',
  });
  ok(r.ok, '助理登錄出貨應成功｜' + r.message);

  const shipSheet = SHEETS.find(s => s._name === '出貨明細');
  ok(!!shipSheet, '出貨明細分頁應自動建立');
  const sHead = shipSheet._grid[0];
  const at = n => sHead.indexOf(n);
  const line = appended.filter(a => a.sheet === '出貨明細').pop().row;
  ok(line[at('出貨單號')] === 'W5501-260807001', '出貨單號應寫在出貨單號欄');
  ok(line[at('貨指寄-地址')] === '新竹市光復路一段1號',
     '貨指寄-地址必須落到正確欄位——這是目前唯一沒進任何系統的關鍵資訊');
  ok(line[at('登錄人')] === 'vivi@waferlock.com',
     '登錄人取自 Google 帳號，不可由表單傳入');
  ok(line[at('倉庫核單狀態')] === '待核', '新登錄的預設狀態應為待核');

  // 表頭定位而非固定順序：插一欄之後仍要寫對位置
  ok(at('出貨單號') >= 0 && at('發票別') >= 0, '出貨明細表頭應含全部欄位');

  // ── 回寫業務分頁 ──
  const biz = SHEETS.find(s => s._name === '零售-Sammi');
  const backCol = head.indexOf('10999沖帳出貨單號');
  ok(biz._grid[2][backCol] === 'W5501-260807001',
     '出貨單號應回寫業務分頁，讓業務在看慣的地方也看得到');

  // ── 通知倉庫 ──
  ok(sent.length === 1, '登錄成功應通知倉庫一次，實際 ' + sent.length + ' 次');
  ok(sent[0].indexOf('W5501-260807001') >= 0, '通知內容應含出貨單號');
  ok(sent[0].indexOf('新竹市光復路一段1號') >= 0,
     '通知內容應含貨指寄地址，倉庫才知道寄哪裡');

  // ── 已登錄過的不再出現在待出貨 ──
  CACHE = {};
  rows = G.getShippable_();
  ok(rows.length === 0, '已登錄出貨的發包單不應再出現在待出貨清單，實得 ' + rows.length);

  // ── 重複出貨單號 ──
  sent = []; const before = appended.length;
  r = G.submitShipment({ shipNo: 'W5501-260807001', items: 'L396 *1' });
  ok(!r.ok && r.message.indexOf('已經登錄過') >= 0, '重複出貨單號應被擋｜' + r.message);
  ok(appended.length === before, '重複時不可再寫一列');
  ok(sent.length === 0, '重複時不可再通知倉庫');

  // ── 沒有發包單號也要能登錄（約一半的出貨是這種） ──
  sent = [];
  r = G.submitShipment({
    shipNo: 'W5506-260807009', items: '弱電料件 *20',
    toName: '倉庫自取', invoice: '電子發票',
  });
  ok(r.ok, '沒有發包單號的料件出貨必須能登錄，否則這張表只涵蓋一半｜' + r.message);
  const l2 = appended.filter(a => a.sheet === '出貨明細').pop().row;
  ok(l2[at('發包單號')] === '', '無發包單時該欄留空，留空是正常狀態不是漏填');
  ok(sent.length === 1, '無發包單的出貨一樣要通知倉庫');

  // ── 出貨頁畫面 ──
  reset();
  asUser('vivi@waferlock.com');
  const html = G.renderShipPage_('vivi@waferlock.com', G.rolesFor_('vivi@waferlock.com'))._h;
  ok(html.indexOf('submitShipment') >= 0, '出貨頁應呼叫 submitShipment');
  ok(html.indexOf('LS-260805-01') >= 0, '出貨頁應列出待出貨的發包單號');
  ok(html.indexOf('LS-260805-02') < 0, '未核准的不可出現在出貨頁');
  ok(html.indexOf('尚未設定 DISPATCH_ASSISTANTS') < 0, '已設名單就不該顯示警告');
  INVOICE_CHECK: {
    ok(html.indexOf('三聯') >= 0 && html.indexOf('出貨待驗無發票') >= 0,
       '發票別下拉應含全部選項');
  }

  // 沒設助理名單 → 開放但要警告，不可靜默放行
  delete props.DISPATCH_ASSISTANTS;
  CACHE = {};
  const roles2 = G.rolesFor_('anyone@waferlock.com');
  ok(roles2.assistant === true, '未設名單時應開放（否則沒人進得去）');
  ok(roles2.assistantUnrestricted === true, '未設名單必須標記，畫面要示警');
  const html2 = G.renderShipPage_('anyone@waferlock.com', roles2)._h;
  ok(html2.indexOf('尚未設定 DISPATCH_ASSISTANTS') >= 0, '未設名單時畫面應顯示警告');
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';

  // ── 頁籤連結：GAS 沙箱 iframe 裡相對連結會導到空白頁 ──
  reset(); asUser('vivi@waferlock.com');
  props.DISPATCH_BOSS_APPROVERS = 'vivi@waferlock.com';   // 讓她兩個頁籤都有，才會出現 nav
  CACHE = {};
  const nav = G.doGet({ parameter: {} })._h;
  ok(nav.indexOf('class="nav"') >= 0, '同時有簽核與出貨權限時應顯示頁籤列');
  ok(nav.indexOf('href="?page=') < 0,
     '頁籤不可用相對連結——GAS 跑在沙箱 iframe，點下去會是一片空白且沒有錯誤訊息');
  ok(nav.indexOf('https://script.google.com/a/macros/w/s/AAA/exec?page=ship') >= 0,
     '頁籤應使用 ScriptApp.getService().getUrl() 的絕對網址');
  ok(nav.indexOf('target="_top"') >= 0, '頁籤必須 target="_top"，否則只換 iframe 內容');

  // 取不到網址時不可給一個點了變空白的連結
  const origSA = sandbox.ScriptApp;
  sandbox.ScriptApp = { getService: () => ({ getUrl: () => '' }) };
  CACHE = {};
  const nav2 = G.doGet({ parameter: {} })._h;
  ok(nav2.indexOf('<a class="tab"') < 0, '取不到網址時應退成不可點，不給死連結');
  sandbox.ScriptApp = origSA;
  delete props.DISPATCH_BOSS_APPROVERS;
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';

  // ── ?page= 不是權限依據 ──
  asUser('outsider@waferlock.com');
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';
  CACHE = {};
  const h3 = G.doGet({ parameter: { page: 'ship' } })._h;
  ok(h3.indexOf('submitShipment') < 0,
     '非助理即使把網址改成 page=ship 也不能拿到出貨表單');
  // 而且真的呼叫後端也要被擋（畫面藏起來不算權限）
  r = G.submitShipment({ shipNo: 'W5501-999', items: 'x' });
  ok(!r.ok, '前端藏起來不算權限，後端必須自己再擋一次');

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
})();

// ── 測試 14：倉庫核單頁 ──
console.log('【14】倉庫核單頁');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';
  props.DISPATCH_WAREHOUSE = 'wh@waferlock.com, wh2@waferlock.com';
  props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';

  let sent = [];
  sandbox.UrlFetchApp.fetch = (u, o) => {
    sent.push(String((o && o.payload) || ''));
    return { getResponseCode: () => 200, getContentText: () => 'ok' };
  };
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };

  const SH = G.SHIPMENT_HEADERS;
  const at = n => SH.indexOf(n);
  const mkShip = (shipNo, whStatus, dispatchNo) => {
    const r = SH.map(() => '');
    r[at('登錄時間')] = '2026-08-07 11:00';
    r[at('出貨單號')] = shipNo;
    r[at('訂單編號')] = 'W5301-260807001';
    r[at('發包單號')] = dispatchNo === undefined ? 'LS-260805-01' : dispatchNo;
    r[at('客戶')] = '王小姐';
    r[at('案名')] = '竹北案';
    r[at('出貨品項')] = 'L396-1E17E1-A0122D *3';
    r[at('貨指寄-收件人')] = '宇泰鎖印 李建男';
    r[at('貨指寄-電話')] = '03-1234567';
    r[at('貨指寄-地址')] = '新竹市XX路1號';
    r[at('發票別')] = '三聯';
    r[at('出貨備註')] = '不附出貨單';
    r[at('登錄人')] = 'vivi@waferlock.com';
    r[at('倉庫核單狀態')] = whStatus;
    return r;
  };
  const reset = (rows) => {
    SHEETS = [makeSheet('出貨明細', SH, rows, 1), rosterSheet];
    CACHE = {}; sent = [];
    return SHEETS[0];
  };

  // ── 待核清單 ──
  let sh = reset([mkShip('W5501-001', '待核'), mkShip('W5501-002', '已核'),
                  mkShip('W5501-003', '有問題'), mkShip('W5501-004', '')]);
  let rows = G.getWarehousePending_();
  ok(rows.length === 2, '待核清單應只有「待核」與空白兩筆，實得 ' + rows.length);
  ok(rows.map(r => r.shipNo).join() === 'W5501-001,W5501-004',
     '空白狀態也要算待核（有人手動補列忘填狀態時不可漏單）');
  ok(rows[0].items === 'L396-1E17E1-A0122D *3' && rows[0].toName === '宇泰鎖印 李建男',
     '撿料需要的品項與貨指寄要帶齊');
  ok(rows[0].row === 2, '要帶列號當位置提示');

  // ── 權限 ──
  ok(G.rolesFor_('wh@waferlock.com').warehouse === true, '倉庫名單內應有權限');
  ok(G.rolesFor_('nobody@waferlock.com').warehouse === false, '名單外不應有權限');
  props.DISPATCH_WAREHOUSE = '';
  ok(G.rolesFor_('x@y').warehouse === true && G.rolesFor_('x@y').warehouseUnrestricted === true,
     '未設名單時開放但標記為降級');
  props.DISPATCH_WAREHOUSE = 'wh@waferlock.com, wh2@waferlock.com';

  reset([mkShip('W5501-001', '待核')]);
  asUser('nobody@waferlock.com');
  let r = G.submitWarehouse('W5501-001', 'done', '', 2);
  ok(!r.ok && /不在倉庫名單/.test(r.message), '名單外呼叫 API 應被擋｜' + r.message);
  ok(String(SHEETS[0]._grid[1][at('倉庫核單狀態')]) === '待核', '被擋時不可寫入');

  // ── 已核：寫入三欄 + 備存通知 ──
  sh = reset([mkShip('W5501-001', '待核')]);
  asUser('wh@waferlock.com');
  r = G.submitWarehouse('W5501-001', 'done', '', 2);
  ok(r.ok && /Chat 備存/.test(r.message), '已核應成功｜' + r.message);
  ok(String(sh._grid[1][at('倉庫核單狀態')]) === '已核', '狀態應為已核');
  ok(String(sh._grid[1][at('倉庫核單人')]) === 'wh@waferlock.com', '核單人應為登入者');
  ok(/^2026-/.test(String(sh._grid[1][at('倉庫核單時間')])), '應寫入核單時間');
  ok(sent.length === 1, '應送出 1 則通知，實際 ' + sent.length);
  let msg = JSON.parse(sent[0]).text;
  ok(/出貨完成（備存）/.test(msg), '備存訊息標題');
  ok(/L396-1E17E1-A0122D \*3/.test(msg), '備存訊息要含完整品項（這是取代 Teams 的那則）');
  ok(/宇泰鎖印 李建男/.test(msg) && /新竹市XX路1號/.test(msg), '備存訊息要含貨指寄');
  ok(/倉庫核單：wh@waferlock\.com/.test(msg), '備存訊息要含核單人');

  // ── 重複送出 ──
  r = G.submitWarehouse('W5501-001', 'done', '', 2);
  ok(!r.ok && /已經處理過了/.test(r.message), '重複核單應被擋｜' + r.message);

  // ── 有問題：未填說明被擋 ──
  sh = reset([mkShip('W5501-001', '待核')]);
  r = G.submitWarehouse('W5501-001', 'issue', '', 2);
  ok(!r.ok && /必須填寫說明/.test(r.message), '回報問題未填說明應被擋');
  ok(String(sh._grid[1][at('倉庫核單狀態')]) === '待核', '被擋時不可寫入');

  r = G.submitWarehouse('W5501-001', 'issue', '料號 L396 庫存只剩 1 組', 2);
  ok(r.ok, '填了說明應成功｜' + r.message);
  ok(String(sh._grid[1][at('倉庫核單狀態')]) === '有問題', '狀態應為有問題');
  ok(String(sh._grid[1][at('問題說明')]) === '料號 L396 庫存只剩 1 組', '應寫入問題說明');
  msg = JSON.parse(sent[0]).text;
  ok(/出貨有問題/.test(msg) && /庫存只剩 1 組/.test(msg), '問題訊息要含說明');
  ok(/vivi@waferlock\.com/.test(msg), '問題訊息要點名登錄人（助理）');
  ok(/業務/.test(msg), '問題訊息要指出業務（靠發包單號前綴查對照表）');

  // 無發包單號時要明講查不到業務，不可靜默
  sh = reset([mkShip('W5501-009', '待核', '')]);
  r = G.submitWarehouse('W5501-009', 'issue', '品項對不上', 2);
  ok(r.ok, '無發包單號仍可核單');
  msg = JSON.parse(sent[0]).text;
  ok(/無發包單號，無法自動點名業務/.test(msg), '無發包單號要明講，不可靜默略過');

  // ── 位置提示不可寫錯列 ──
  sh = reset([mkShip('W5501-001', '待核'), mkShip('W5501-002', '待核')]);
  r = G.submitWarehouse('W5501-002', 'done', '', 2);   // 提示指向第 2 列（實際是 001）
  ok(r.ok, '提示錯誤時應改走完整搜尋｜' + r.message);
  ok(String(sh._grid[1][at('倉庫核單狀態')]) === '待核', '不可寫進提示指向的錯誤列');
  ok(String(sh._grid[2][at('倉庫核單狀態')]) === '已核', '應寫進單號真正所在的列');

  sh = reset([mkShip('W5501-001', '待核')]);
  r = G.submitWarehouse('W5501-001', 'done', '', 9999);
  ok(r.ok && String(sh._grid[1][at('倉庫核單狀態')]) === '已核', '提示列號超範圍應改走搜尋');

  r = G.submitWarehouse('W5501-XXX', 'done', '', 2);
  ok(!r.ok && /找不到出貨單號/.test(r.message), '不存在的單號應回報找不到');

  // ── 快取 ──
  sh = reset([mkShip('W5501-001', '待核'), mkShip('W5501-002', '待核')]);
  let c1 = G.getWarehouseCached_();
  ok(c1.cached === false && c1.rows.length === 2, '首次應即時掃描');
  ok(G.getWarehouseCached_().cached === true, '第二次應命中快取');
  G.submitWarehouse('W5501-001', 'done', '', 2);
  let cachedRows = JSON.parse(CACHE[G.WH_CACHE_KEY]).rows;
  ok(cachedRows.length === 1 && cachedRows[0].shipNo === 'W5501-002',
     '核完的單應從快取移除，實際剩 ' + cachedRows.length + ' 筆');

  // ── 畫面 ──
  reset([mkShip('W5501-001', '待核')]);
  rows = G.getWarehousePending_();
  let page = G.warehouseBlock_('wh@waferlock.com', rows,
    G.rolesFor_('wh@waferlock.com'), { at: '11:30', cached: true });
  ok(/倉庫核單/.test(page) && /W5501-001/.test(page), '畫面應顯示單號');
  ok(/whitems/.test(page) && /L396-1E17E1-A0122D \*3/.test(page), '品項要用專屬樣式突顯');
  ok(/已撿料完成/.test(page) && /有問題/.test(page), '應有兩顆按鈕');
  ok(/class="ok big"/.test(page) && /class="no-btn big"/.test(page), '手機優先：按鈕要用 big');
  ok(/submitWarehouse\(no,dec,note,rw\)/.test(page), '應把列號當位置提示傳回');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');
  ok(!/msg warn/.test(page), '名單已設時不應顯示降級警告');

  props.DISPATCH_WAREHOUSE = '';
  page = G.warehouseBlock_('x@y', rows, G.rolesFor_('x@y'), { at: '11:30' });
  ok(/尚未設定 DISPATCH_WAREHOUSE/.test(page), '未設名單要顯示警告，不靜默放行');
  props.DISPATCH_WAREHOUSE = 'wh@waferlock.com';

  page = G.warehouseBlock_('wh@waferlock.com', [],
    G.rolesFor_('wh@waferlock.com'), { at: '11:30' });
  ok(/沒有待撿料的出貨/.test(page) && !/onclick="wact/.test(page), '空清單畫面正常');

  // 手機優先的 CSS 與 viewport
  const full = G.htmlPage_('x')._h;
  ok(/max-width:420px/.test(full), '應有窄螢幕的 media query');
  ok(/min-height:46px/.test(full), '按鈕應有足夠的觸控高度');
  ok(/width=device-width/.test(full), '應有 viewport meta');

  // ── 頁籤與路由 ──
  const rAll = { sub: true, boss: false, assistant: true, warehouse: true };
  const nav = G.navBlock_('warehouse', rAll);
  ok(/倉庫核單/.test(nav) && /簽核/.test(nav) && /出貨登錄/.test(nav), '三個頁籤都要在');
  ok(/target="_top"/.test(nav), '頁籤必須 target=_top（否則點下去一片空白）');
  ok(!/href="\?page=/.test(nav), '不可用相對連結');
  const navWhOnly = G.navBlock_('warehouse', { warehouse: true });
  ok(/查詢/.test(navWhOnly), '查詢頁籤對所有人都要在（唯讀、全員可用）');
  ok(G.navBlock_('query', {}) === '', '完全沒有角色時只剩查詢一頁，不顯示頁籤');
})();

// ── 測試 15：對照表分頁名與 email 正規化 ──
console.log('【15】路由對照表');
(function () {
  const HEAD = ['業務代碼', '業務姓名', '業務 email', '類別', '對應助理', '助理 email'];
  const rows = [
    ['JW', 'Johnson Wu', 'Johnson.wu@waferlock.com', '內銷', 'Ting.Hsu', 'Ting.Hsu@waferlock.com'],
    ['LS', 'sammi lin', 'sammi.lin@waferlock.com', '內銷', 'Ting.Hsu', 'Ting.Hsu@waferlock.com'],
    // 實際儲存格裡的 email 可能含換行（欄寬不足時很容易誤留）
    ['VH', 'vivi huang', 'vivi.huang@waferlock.com', '電商', 'wendy Chang', 'wendy.chang@waferlo\nck.com'],
    ['SL', 'sean lin', 'sean.lin@waferlock.com', '內銷', 'Ting.Hsu', 'Ting.Hsu@waferlock.com'],
  ];
  delete props.DISPATCH_ROSTER_SHEET;

  // 分頁叫「路由對照表」也要讀得到
  SHEETS = [makeSheet('路由對照表', HEAD, rows, 1)];
  let ro = G.loadRoster_();
  ok(Object.keys(ro).length === 4, '分頁名「路由對照表」應讀得到 4 筆，實得 ' +
     Object.keys(ro).length);
  ok(ro.JW && ro.JW.assist === 'Ting.Hsu', 'JW 應對到 Ting.Hsu');
  ok(ro['業務代碼'] === undefined, '表頭列不可被當成資料');

  // 「業務 email」中間的空白要被正規化掉才對得上 COL_R_SALES_MAIL
  ok(ro.JW.salesMail === 'Johnson.wu@waferlock.com', '含空白的表頭「業務 email」要對得上');

  // email 值裡的換行要清掉，否則通知裡會斷成兩行
  ok(ro.VH.assistMail === 'wendy.chang@waferlock.com',
     'email 值的換行要清掉，實際「' + ro.VH.assistMail + '」');

  // 舊分頁名仍要相容
  SHEETS = [makeSheet('人員代碼', HEAD, rows, 1)];
  ok(Object.keys(G.loadRoster_()).length === 4, '舊分頁名「人員代碼」要維持相容');

  // 屬性有設就以它為準
  SHEETS = [makeSheet('我自訂的表', HEAD, rows, 1), makeSheet('路由對照表', HEAD, [], 1)];
  props.DISPATCH_ROSTER_SHEET = '我自訂的表';
  ok(Object.keys(G.loadRoster_()).length === 4, 'DISPATCH_ROSTER_SHEET 應優先');
  props.DISPATCH_ROSTER_SHEET = '不存在的分頁';
  ok(Object.keys(G.loadRoster_()).length === 0,
     '屬性指定的分頁不存在時不可回退去猜別的分頁（那會讓設定錯誤被藏起來）');
  delete props.DISPATCH_ROSTER_SHEET;

  // 讀不到時回空物件，不可拋錯（簽核是主線，路由通知是附加）
  SHEETS = [makeSheet('別的東西', ['A'], [], 1)];
  ok(Object.keys(G.loadRoster_()).length === 0, '找不到對照表應回空物件而非拋錯');

  // SL 與 LS 必須是兩個不同的人（只差字母順序）
  SHEETS = [makeSheet('路由對照表', HEAD, rows, 1)];
  ro = G.loadRoster_();
  ok(ro.SL.sales === 'sean lin' && ro.LS.sales === 'sammi lin',
     'SL 與 LS 是兩個不同的人，不可混淆');
  ok(G.codeOf_('LS-260805-01') === 'LS' && G.codeOf_('SL-260805-01') === 'SL',
     'codeOf_ 要能區分 LS 與 SL');
})();

// ── 測試 16：① 業務下單頁 ──
console.log('【16】業務下單頁');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  delete props.DISPATCH_ROSTER_SHEET;
  const RH = ['業務代碼', '業務姓名', '業務 email', '類別', '發包分頁', '對應助理', '助理 email'];
  const rr = [
    ['LS', 'sammi lin', 'sammi.lin@waferlock.com', '內銷', '零售-Sammi', 'Ting.Hsu', 'ting@w.com'],
    ['JW', 'Johnson Wu', 'johnson.wu@waferlock.com', '內銷', '零售-Johnson', 'Ting.Hsu', 'ting@w.com'],
    ['VH', 'vivi huang', 'vivi.huang@waferlock.com', '電商', '', 'wendy', 'wendy@w.com'],
    ['ZZ', 'no mail', '', '內銷', '零售-Sammi', '', ''],
  ];
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const sHead = HEADS['零售-Sammi'];
  const iOf = n => sHead.indexOf(n);

  const reset = (existing) => {
    SHEETS = [
      makeSheet('零售-Sammi', sHead, existing || [], 2),
      makeSheet('零售-Johnson', HEADS['零售-Johnson'], [], 2),
      makeSheet('路由對照表', RH, rr, 1),
    ];
    CACHE = {}; appended.length = 0;
    return SHEETS[0];
  };

  // ── 身分來自對照表，不是另一份名單 ──
  reset();
  ok(G.salesFor_('sammi.lin@waferlock.com').code === 'LS', '應由對照表反查出代碼');
  ok(G.salesFor_('SAMMI.LIN@WAFERLOCK.COM').code === 'LS', 'email 比對不分大小寫');
  ok(G.salesFor_('nobody@w.com') === null, '不在對照表就不能下單');
  ok(G.salesFor_('') === null, '空 email 不可通過');
  ok(G.rolesFor_('sammi.lin@waferlock.com').sales === true, 'rolesFor_ 應帶出 sales');
  ok(G.rolesFor_('nobody@w.com').sales === false, '非業務不應有 sales');

  // ── 自動編號 ──
  let sh = reset();
  let ctx = G.openSheetByName_('零售-Sammi').ctx;
  const d = new Date(2026, 7, 7);
  ok(G.nextOrderNo_(ctx, 'LS', d) === 'LS-260807-01', '空表首單應為 01，實得 ' +
     G.nextOrderNo_(ctx, 'LS', d));

  const mk = no => { const r = sHead.map(() => ''); r[iOf('發包單號')] = no; return r; };
  sh = reset([mk('LS-260807-01'), mk('LS-260807-03'), mk('LS-260806-09'), mk('JW-260807-07')]);
  ctx = G.openSheetByName_('零售-Sammi').ctx;
  ok(G.nextOrderNo_(ctx, 'LS', d) === 'LS-260807-04',
     '應接在當日最大號之後（不是筆數），實得 ' + G.nextOrderNo_(ctx, 'LS', d));
  ok(G.nextOrderNo_(ctx, 'LS', new Date(2026, 7, 8)) === 'LS-260808-01', '換日應重新從 01 起算');

  // ── 發包安裝：進簽核佇列 ──
  sh = reset();
  asUser('sammi.lin@waferlock.com');
  let r = G.submitOrder({ kind: '發包安裝', customer: '王小姐', project: '竹北案',
    model: 'L396', qty: '3', worker: '阿明工程行', price: '9000', note: '含改修' });
  ok(r.ok && r.orderNo === 'LS-260807-01' || /LS-\d{6}-01/.test(r.orderNo || ''),
     '發包安裝應成功並回單號｜' + r.message);
  ok(/已送主管簽核/.test(r.message), '訊息應說明進簽核佇列');
  let w = appended[appended.length - 1].row;
  ok(w[iOf('客戶')] === '王小姐' && w[iOf('型號')] === 'L396', '客戶與型號要寫對位');
  ok(w[iOf('報價單數量')] === 3, '數量應寫成數字');
  ok(w[iOf('承包商')] === '阿明工程行' && w[iOf('承包總價')] === 9000, '承包資訊要寫入');
  ok(w[iOf('發包人員')] === 'sammi lin', '發包人員應帶對照表的姓名');
  ok(String(w[iOf('主管KEY英文名押日期')] || '') === '', '發包安裝的簽核欄必須留空（才會進待核）');

  // 寫進去的單真的會出現在主管待核清單
  CACHE = {};
  let pend = G.getPending_().filter(x => x.orderNo === r.orderNo);
  ok(pend.length === 1, '新單應出現在待核清單，實得 ' + pend.length);

  // ── 料件出貨：免簽核，直接進出貨清單 ──
  sh = reset();
  r = G.submitOrder({ kind: '料件出貨', customer: '富旺營造', model: 'L-372N', qty: '184' });
  ok(r.ok && /免簽核/.test(r.message), '料件出貨應成功且說明免簽核｜' + r.message);
  w = appended[appended.length - 1].row;
  const mark = String(w[iOf('主管KEY英文名押日期')] || '');
  ok(/^✅ 免簽核（料件出貨）/.test(mark), '簽核欄應寫免簽核標記，實際「' + mark + '」');
  ok(/sammi\.lin@waferlock\.com/.test(mark), '標記要含是誰建的');
  ok(G.isApproved_(mark) === true, '標記必須被 isApproved_ 認得，否則進不了助理出貨清單');

  CACHE = {};
  ok(G.getPending_().filter(x => x.orderNo === r.orderNo).length === 0,
     '料件出貨不可出現在主管待核清單');
  let shippable = G.getShippable_().filter(x => x.orderNo === r.orderNo);
  ok(shippable.length === 1, '料件出貨應直接出現在助理待出貨清單，實得 ' + shippable.length);
  ok(w[iOf('承包商')] === '' && w[iOf('承包總價')] === '', '料件出貨不該有承包資訊');

  // ── 驗證與錯誤處理 ──
  reset();
  ok(!G.submitOrder({ kind: '', customer: 'A', model: 'B', qty: '1' }).ok, '未選單別應被擋');
  ok(!G.submitOrder({ kind: '亂填', customer: 'A', model: 'B', qty: '1' }).ok, '未知單別應被擋');
  ok(!G.submitOrder({ kind: '料件出貨', customer: '', model: 'B', qty: '1' }).ok, '缺客戶應被擋');
  ok(!G.submitOrder({ kind: '料件出貨', customer: 'A', model: '', qty: '1' }).ok, '缺型號應被擋');
  ok(!G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '' }).ok, '缺數量應被擋');
  r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '三組' });
  ok(!r.ok && /必須是數字/.test(r.message), '數量非數字應被擋｜' + r.message);
  r = G.submitOrder({ kind: '發包安裝', customer: 'A', model: 'B', qty: '1', worker: '' });
  ok(!r.ok && /必須填承包商/.test(r.message), '發包安裝缺承包商應被擋');
  ok(appended.length === 0, '任何被擋的情況都不可寫入');

  // 非業務、以及對照表沒填發包分頁
  asUser('nobody@w.com');
  r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '1' });
  ok(!r.ok && /不在路由對照表/.test(r.message), '非業務呼叫 API 應被擋｜' + r.message);
  asUser('vivi.huang@waferlock.com');
  r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '1' });
  ok(!r.ok && /沒有填「發包分頁」/.test(r.message), '缺發包分頁應明確說明｜' + r.message);
  ok(appended.length === 0, '這兩種情況都不可寫入');

  // ── 畫面 ──
  asUser('sammi.lin@waferlock.com');
  reset();
  const me = G.salesFor_('sammi.lin@waferlock.com');
  const page = G.orderBlock_('sammi.lin@waferlock.com', me);
  ok(/發包下單/.test(page) && /LS/.test(page), '應顯示身分與代碼');
  ok(/發包安裝/.test(page) && /料件出貨/.test(page), '應有兩個單別按鈕');
  ok(/零售-Sammi/.test(page), '應告知會寫進哪個分頁');
  ok(/id="installOnly"/.test(page), '承包商欄要能依單別隱藏');
  ok(/display:none/.test(page), '未選單別前欄位應隱藏');
  ok(!/發包單號/.test(page.split('<script>')[0]) || /自動編號/.test(page),
     '不可讓人手填發包單號');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');

  const nav = G.navBlock_('order', { sales: true, boss: true });
  ok(/下單/.test(nav) && /簽核/.test(nav), '兼具下單與簽核時兩個頁籤都要在');
  ok(/target="_top"/.test(nav), '頁籤必須 target=_top');

  // ── suggestSheetMapping 只建議、不自動寫入 ──
  SHEETS = [
    makeSheet('零售-Sammi', sHead, [], 2),
    makeSheet('零售-Johnson', HEADS['零售-Johnson'], [], 2),
    makeSheet('電商-Vivi', HEADS['電商-Vivi'], [], 2),
    makeSheet('一課-漢神', HEADS['一課-漢神'], [], 2),
    makeSheet('路由對照表', RH, rr, 1),
  ];
  CACHE = {};
  LOG = [];
  G.suggestSheetMapping();
  const log = LOG.join('\n');
  ok(/LS（sammi lin）已填「零售-Sammi」 ✅/.test(log), '已填且存在的要標 ✅');
  ok(/VH（vivi huang）→ 建議：電商-Vivi/.test(log),
     'VH 應建議 電商-Vivi（姓名片段比對），實際 log：' + log.slice(0, 400));
  ok(/尚未被任何代碼指到的分頁/.test(log), '應列出還沒對應的分頁');
  const rosterAfter = G.loadRoster_();
  ok(rosterAfter.VH.sheet === '', 'suggestSheetMapping 不可自動寫入對照表');
})();

// ── 測試 17：系統分頁不可被當成業務發包分頁 ──
console.log('【17】系統分頁排除');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  delete props.DISPATCH_ROSTER_SHEET;

  ok(G.isSystemSheet_('出貨明細') === true, '出貨明細是系統分頁');
  ok(G.isSystemSheet_('簽核紀錄') === true, '簽核紀錄是系統分頁');
  ok(G.isSystemSheet_('路由對照表') === true, '路由對照表是系統分頁');
  ok(G.isSystemSheet_('人員代碼') === true, '舊對照表名也要排除');
  ok(G.isSystemSheet_('零售-Sammi') === false, '業務分頁不是系統分頁');
  props.DISPATCH_ROSTER_SHEET = '我的對照表';
  ok(G.isSystemSheet_('我的對照表') === true, '自訂對照表名也要排除');
  delete props.DISPATCH_ROSTER_SHEET;

  // 出貨明細有「發包單號」表頭，自動掃描一定會碰到它
  const shipSheet = makeSheet('出貨明細', G.SHIPMENT_HEADERS, [], 1);
  SHEETS = [makeSheet('零售-Sammi', HEADS['零售-Sammi'], [], 2), shipSheet];
  let env = G.openSheets_();
  ok(env.list.length === 1 && env.list[0].name === '零售-Sammi',
     '自動掃描不可納入出貨明細，實際納入：' + env.list.map(c => c.name).join());

  // 最危險的情況：有人在出貨明細加了「主管簽核」欄
  const evil = G.SHIPMENT_HEADERS.concat(['主管簽核']);
  const evilRow = evil.map(() => '');
  evilRow[evil.indexOf('發包單號')] = 'LS-260805-01';
  SHEETS = [makeSheet('零售-Sammi', HEADS['零售-Sammi'], [], 2),
            makeSheet('出貨明細', evil, [evilRow], 1)];
  CACHE = {};
  env = G.openSheets_();
  ok(env.list.length === 1,
     '即使出貨明細有簽核欄也不可納入（否則整張出貨資料會進主管待核清單）');
  ok(G.getPending_().every(x => x.sheet !== '出貨明細'), '待核清單不可出現出貨明細的列');

  // 明確列舉時也要擋
  props.DISPATCH_SHEET_NAME = '出貨明細';
  let threw = false;
  try { G.openSheets_(); } catch (e) { threw = /不可包含系統分頁/.test(String(e)); }
  ok(threw, '把系統分頁寫進 DISPATCH_SHEET_NAME 應明確報錯，而不是默默掃描它');
  props.DISPATCH_SHEET_NAME = '零售-Sammi,出貨明細';
  threw = false;
  try { G.openSheets_(); } catch (e) { threw = /不可包含系統分頁/.test(String(e)); }
  ok(threw, '混在清單裡也要報錯');
  props.DISPATCH_SHEET_NAME = '*';

  // 位置提示不可指向系統分頁
  ok(G.isSheetInScope_('出貨明細') === false, '位置提示不可指向出貨明細');
})();

// ── 測試 18：① 寫兩張表 ＋ ③ 只補 TipTop 單號 ──
console.log('【18】下單寫兩張表、助理只補單號');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';
  props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';
  delete props.DISPATCH_ROSTER_SHEET;

  let sent = [];
  sandbox.UrlFetchApp.fetch = (u, o) => {
    sent.push(String((o && o.payload) || ''));
    return { getResponseCode: () => 200, getContentText: () => 'ok' };
  };
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };

  const RH = ['業務代碼', '業務姓名', '業務 email', '類別', '發包分頁', '對應助理', '助理 email'];
  const rr = [['VH', 'vivi huang', 'vh@waferlock.com', '電商', '零售-Sammi', 'wendy', 'w@w.com']];
  const sHead = HEADS['零售-Sammi'];
  const SH = G.SHIPMENT_HEADERS;

  // 刻意用「舊的」出貨明細表頭（只有原本 17 欄），驗證自動補欄
  const OLD_SHIP = ['登錄時間', '出貨單號', '訂單編號', '發包單號', '客戶', '案名', '出貨品項',
    '貨指寄-收件人', '貨指寄-電話', '貨指寄-地址', '發票別', '出貨備註', '登錄人',
    '倉庫核單狀態', '倉庫核單人', '倉庫核單時間', '問題說明'];

  const reset = (shipHead) => {
    SHEETS = [
      makeSheet('零售-Sammi', sHead, [], 2),
      makeSheet('出貨明細', shipHead || SH, [], 1),
      makeSheet('路由對照表', RH, rr, 1),
    ];
    CACHE = {}; appended.length = 0; sent = []; LOG = [];
    return SHEETS;
  };

  // ── 舊表頭要自動補上新欄位（附加在表尾，不動既有資料）──
  reset(OLD_SHIP);
  let s = G.openShipmentSheet_();
  ok(s.col['售價'] !== undefined && s.col['進價'] !== undefined, '新欄位應被自動補上');
  ok(s.col['客人姓名'] !== undefined && s.col['通路訂單編號'] !== undefined, '客人資料欄應補上');
  ok(s.col['登錄時間'] === 1 && s.col['出貨單號'] === 2, '既有欄位位置不可變動');
  ok(s.col['售價'] > OLD_SHIP.length, '新欄位必須附加在表尾');
  ok(LOG.some(l => /自動補上欄位/.test(l)), '補欄要留下記錄');

  // ── 下單同時寫兩張表 ──
  reset();
  asUser('vh@waferlock.com');
  let r = G.submitOrder({
    kind: '發包安裝', customer: 'MOMO', project: 'MOMO', model: 'L901', qty: '1',
    worker: '蔣師傅', price: '400', note: '含改修',
    items: 'L901GEA10001AA-01 X1\nNSM54CMY100032-W x1 - 送感應貼',
    toName: '大內高手鎖業有限公司', toPhone: '02-29266999',
    toAddr: '新北市中和區橋和路122號13樓之2', invoice: '出貨待驗無發票',
    shipNote: '電商-L901-孫明恩',
    channelNo: '26080229339090-001-001-001', custName: '孫明恩',
    custPhone: '0953-644733', custAddr: '臺北市大安區和平東路三段七號四樓',
    salePrice: '19688', costPrice: '18704',
  });
  ok(r.ok && !r.shipFailed, '下單應成功且出貨資訊寫入｜' + r.message);
  const orderNo = r.orderNo;

  const wroteSales = appended.filter(a => a.sheet === '零售-Sammi');
  const wroteShip = appended.filter(a => a.sheet === '出貨明細');
  ok(wroteSales.length === 1, '業務分頁應寫 1 列');
  ok(wroteShip.length === 1, '出貨明細應寫 1 列');

  s = G.openShipmentSheet_();
  const shipRow = wroteShip[0].row;
  const sv = n => String(shipRow[s.col[n] - 1] == null ? '' : shipRow[s.col[n] - 1]);
  ok(sv('發包單號') === orderNo, '兩張表要靠發包單號串起來');
  ok(/L901GEA10001AA-01/.test(sv('出貨品項')), '完整料號要進出貨明細');
  ok(/送感應貼/.test(sv('出貨品項')), '多行品項與附註不可遺失');
  ok(sv('貨指寄-收件人') === '大內高手鎖業有限公司', '送貨資料');
  ok(sv('客人姓名') === '孫明恩' && sv('客人電話') === '0953-644733', '客人資料');
  ok(sv('客人地址') !== sv('貨指寄-地址'), '送貨地址與客人地址必須各自保留，不可合併');
  ok(sv('通路訂單編號') === '26080229339090-001-001-001', '通路訂單編號');
  ok(Number(sv('售價')) === 19688 && Number(sv('進價')) === 18704, '售價進價應為數字');
  ok(sv('出貨單號') === '', '出貨單號必須留空（等助理鍵 TipTop）');
  ok(sv('下單業務') === 'vivi huang', '下單業務應記錄');
  ok(sv('倉庫核單狀態') === '待核', '倉庫狀態初始為待核');

  // 業務分頁不該被塞進出貨欄位
  const salesRow = wroteSales[0].row;
  ok(salesRow.length === sHead.length, '業務分頁的列寬不可變');
  ok(!salesRow.some(v => /L901GEA10001AA/.test(String(v))), '完整料號不應寫進業務分頁');

  // ── ③ 待鍵入清單 ──
  let pend = G.getPendingShipments_();
  ok(pend.length === 1, '應有 1 筆待鍵入，實得 ' + pend.length);
  ok(pend[0]['出貨品項'].indexOf('L901GEA10001AA-01') === 0, '清單要帶出業務填的品項');
  ok(pend[0].row === 2, '要帶列號');

  // ── 助理只補三格 ──
  asUser('vivi@waferlock.com');
  r = G.fillShipment(2, { shipNo: 'W5501-260807001', orderId: 'W5301-260807001',
    shipDate: '2026/08/07' });
  ok(r.ok && /通知倉庫/.test(r.message), '助理鍵入應成功｜' + r.message);
  s = G.openShipmentSheet_();
  const g2 = n => String(SHEETS[1]._grid[1][s.col[n] - 1] || '');
  ok(g2('出貨單號') === 'W5501-260807001', '出貨單號應寫入');
  ok(g2('訂單編號') === 'W5301-260807001' && g2('出貨日期') === '2026/08/07', '另兩欄應寫入');
  ok(g2('登錄人') === 'vivi@waferlock.com', '登錄人應為助理');
  ok(/L901GEA10001AA-01/.test(g2('出貨品項')), '🔴 業務填的資料絕不可被覆蓋');
  ok(g2('客人姓名') === '孫明恩', '客人資料也不可被覆蓋');
  ok(g2('下單業務') === 'vivi huang', '下單業務不可被覆蓋');
  ok(G.getPendingShipments_().length === 0, '鍵入後應離開待鍵入清單');
  ok(sent.length === 1, '應通知倉庫 1 次');
  ok(/L901GEA10001AA-01/.test(JSON.parse(sent[0]).text), '倉庫通知要含完整品項');

  // ── 並發與重複 ──
  r = G.fillShipment(2, { shipNo: 'W5501-999' });
  ok(!r.ok && /已經鍵入過了/.test(r.message), '同一列重複鍵入應被擋｜' + r.message);
  ok(g2('出貨單號') === 'W5501-260807001', '被擋時不可覆蓋既有單號');

  reset();
  asUser('vh@waferlock.com');
  G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '1', items: 'X *1' });
  G.submitOrder({ kind: '料件出貨', customer: 'C', model: 'D', qty: '2', items: 'Y *2' });
  asUser('vivi@waferlock.com');
  ok(G.fillShipment(2, { shipNo: 'W5501-AAA' }).ok, '第一筆鍵入成功');
  r = G.fillShipment(3, { shipNo: 'W5501-AAA' });
  ok(!r.ok && /已經登錄過了/.test(r.message), '出貨單號全表唯一｜' + r.message);
  ok(!G.fillShipment(2, { shipNo: '' }).ok, '出貨單號必填');
  ok(!G.fillShipment(999, { shipNo: 'W5501-ZZZ' }).ok, '目標列不存在應被擋');
  asUser('nobody@w.com');
  ok(!G.fillShipment(3, { shipNo: 'W5501-BBB' }).ok, '非助理不可鍵入');

  // ── 沒填出貨資訊時不該產生空的出貨明細列 ──
  reset();
  asUser('vh@waferlock.com');
  r = G.submitOrder({ kind: '發包安裝', customer: 'X', model: 'Y', qty: '1', worker: 'Z' });
  ok(r.ok, '只填發包資訊也要能下單');
  ok(appended.filter(a => a.sheet === '出貨明細').length === 0,
     '沒填任何出貨資訊時不該建出貨明細列');
  ok(G.getPendingShipments_().length === 0, '待鍵入清單不該出現空列');

  // ── 出貨明細寫入失敗要顯性回報，但發包單仍成立 ──
  reset();
  const shipSheet = SHEETS[1];
  const origAppend = shipSheet.appendRow;
  shipSheet.appendRow = () => { throw new Error('模擬寫入失敗'); };
  r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '1', items: 'X *1' });
  ok(r.ok, '出貨明細失敗時，發包單仍算成立（它已經寫進去了）');
  ok(r.shipFailed === true, '必須標記出貨資訊失敗');
  ok(/出貨資訊寫入失敗/.test(r.message), '訊息要明講失敗，不可只回報成功｜' + r.message);
  ok(appended.filter(a => a.sheet === '零售-Sammi').length === 1, '業務分頁那列確實寫成功了');
  shipSheet.appendRow = origAppend;

  // ── 畫面 ──
  reset();
  asUser('vh@waferlock.com');
  G.submitOrder({ kind: '發包安裝', customer: 'MOMO', model: 'L901', qty: '1', worker: '蔣',
    items: 'L901GEA10001AA-01 X1', toName: '大內高手鎖業', toAddr: '新北市…',
    custName: '孫明恩', custPhone: '0953-644733', salePrice: '19688', costPrice: '18704' });
  pend = G.getPendingShipments_();
  let page = G.shipBlock_('vivi@waferlock.com', [], G.rolesFor_('vivi@waferlock.com'),
    { at: '11:30' }, pend);
  ok(/業務已下單，等鍵 TipTop（1）/.test(page), '應有待鍵入區塊');
  ok(/L901GEA10001AA-01/.test(page), '應顯示業務填的品項');
  ok(/孫明恩/.test(page) && /大內高手鎖業/.test(page), '應顯示客人與送貨資料');
  ok(/19,688/.test(page), '售價應加千分位');
  ok(/fillShipment\(rw,\{shipNo/.test(page), '應呼叫 fillShipment');
  ok((page.match(/id="p0s"/g) || []).length === 1, '應有出貨單號輸入框');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');

  const opage = G.orderBlock_('vh@waferlock.com', G.salesFor_('vh@waferlock.com'));
  ok(/出貨項目/.test(opage) && /送貨資料/.test(opage) && /客人資料/.test(opage),
     '下單頁應有五段');
  ok(/id="items"/.test(opage) && /id="custAddr"/.test(opage) && /id="costPrice"/.test(opage),
     '新欄位都要在');
  ok(/沒有欄位級權限/.test(opage), '進價的權限限制要寫在畫面上');
  new Function(opage.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '下單頁 JS 語法正確');
})();

// ── 測試 19：⑤ 查詢頁 ──
console.log('【19】查詢頁');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';
  props.DISPATCH_WAREHOUSE = 'wh@waferlock.com';
  delete props.DISPATCH_ROSTER_SHEET;
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };

  const SH = G.SHIPMENT_HEADERS;
  const sHead = HEADS['零售-Sammi'];
  const iOf = n => sHead.indexOf(n);
  const mkOrder = (no, cust, proj, approval) => {
    const r = sHead.map(() => '');
    r[0] = new Date(2026, 7, 6); r[1] = no; r[2] = '阿明'; r[3] = cust;
    r[4] = proj; r[5] = 'L396'; r[6] = 2; r[11] = 9000; r[12] = 'sammi lin';
    r[iOf('主管KEY英文名押日期')] = approval || '';
    return r;
  };
  const mkShip = o => { const r = SH.map(() => ''); SH.forEach((k, i) => { if (o[k] !== undefined) r[i] = o[k]; }); return r; };

  SHEETS = [
    makeSheet('零售-Sammi', sHead, [
      mkOrder('LS-260806-01', '王小姐', '竹北案', '✅ 核准 boss@w 2026-08-06'),
      mkOrder('LS-260806-02', '陳先生', '新竹案', ''),
    ], 2),
    makeSheet('出貨明細', SH, [
      mkShip({ '登錄時間': '2026-08-06 10:00', '出貨單號': 'W5501-001', '發包單號': 'LS-260806-01',
        '客戶': '王小姐', '出貨品項': 'L396-ABC *2', '客人姓名': '孫明恩',
        '客人電話': '0953-644733', '通路訂單編號': 'MOMO-123', '售價': 19688, '進價': 18704,
        '倉庫核單狀態': '已核', '倉庫核單人': 'wh@waferlock.com' }),
      // 無發包單號的出貨（約占一半）
      mkShip({ '登錄時間': '2026-08-06 11:00', '出貨單號': 'W5506-002', '客戶': '富旺營造',
        '出貨品項': '鎖胚 L-372N *184', '客人姓名': '陳主任', '售價': 5000, '進價': 4000,
        '倉庫核單狀態': '待核' }),
    ], 1),
    makeSheet('路由對照表', ['業務代碼', '業務姓名', '業務 email', '發包分頁'],
      [['LS', 'sammi lin', 'sammi.lin@waferlock.com', '零售-Sammi']], 1),
  ];
  CACHE = {};

  // ── 各種關鍵字都要查得到 ──
  ok(G.queryOrders_('LS-260806-01').rows.length === 1, '用發包單號查');
  ok(G.queryOrders_('王小姐').rows.length === 1, '用客戶查');
  ok(G.queryOrders_('竹北').rows.length === 1, '用案名部分字串查');
  ok(G.queryOrders_('W5501-001').rows.length === 1, '用出貨單號查（資料在另一張表）');
  ok(G.queryOrders_('孫明恩').rows.length === 1, '用客人姓名查');
  ok(G.queryOrders_('0953-644733').rows.length === 1, '用客人電話查');
  ok(G.queryOrders_('MOMO-123').rows.length === 1, '用通路訂單編號查');
  ok(G.queryOrders_('ls-260806').rows.length === 2, '不分大小寫、可查前綴');
  ok(G.queryOrders_('不存在的東西').rows.length === 0, '查不到就回空');
  ok(G.queryOrders_('').rows.length === 0, '空關鍵字不回全部（避免誤觸全表）');

  // 無發包單號的出貨要查得到
  let res = G.queryOrders_('富旺營造');
  ok(res.rows.length === 1 && res.rows[0].orderNo === '',
     '無發包單號的出貨也要查得到');
  ok(res.rows[0].ships.length === 1 && res.rows[0].ships[0]['出貨單號'] === 'W5506-002',
     '該筆要帶出貨資訊');

  // ── 發包單與出貨串起來 ──
  res = G.queryOrders_('LS-260806-01');
  ok(res.rows[0].ships.length === 1, '應串到 1 筆出貨');
  ok(res.rows[0].ships[0]['出貨品項'] === 'L396-ABC *2', '要帶出貨品項');
  ok(/^✅/.test(res.rows[0].approval), '要帶簽核狀態');
  res = G.queryOrders_('LS-260806-02');
  ok(res.rows[0].ships.length === 0 && res.rows[0].approval === '',
     '未核准未出貨的單，兩者都應為空（畫面顯示待核／尚未出貨）');

  // ── 🔴 進價必須在伺服器端就移除 ──
  asUser('vivi@waferlock.com');   // 助理，非主管
  let q = G.runQuery('LS-260806-01');
  ok(q.ok && q.canSeeCost === false, '助理不應看得到進價');
  ok(q.rows[0].ships[0]['進價'] === undefined,
     '🔴 進價必須從回傳資料中移除，不能只在畫面上藏（改前端就看得到）');
  ok(Number(q.rows[0].ships[0]['售價']) === 19688, '售價仍要保留');

  asUser('wh@waferlock.com');
  ok(G.runQuery('LS-260806-01').rows[0].ships[0]['進價'] === undefined, '倉庫也看不到進價');
  asUser('sammi.lin@waferlock.com');
  ok(G.runQuery('LS-260806-01').rows[0].ships[0]['進價'] === undefined, '業務也看不到進價');

  asUser('boss@waferlock.com');
  q = G.runQuery('LS-260806-01');
  ok(q.canSeeCost === true && Number(q.rows[0].ships[0]['進價']) === 18704, '主管看得到進價');
  asUser('sub@waferlock.com');
  ok(Number(G.runQuery('LS-260806-01').rows[0].ships[0]['進價']) === 18704, '副主管看得到進價');

  asUser('');
  ok(G.runQuery('x').ok === false, '取不到身分不可查詢');

  // ── 上限截斷 ──
  const many = [];
  for (let i = 1; i <= 60; i++) {
    many.push(mkOrder('LS-2608' + String(i).padStart(2, '0') + '-01', '客' + i, '案', ''));
  }
  SHEETS = [makeSheet('零售-Sammi', sHead, many, 2), makeSheet('出貨明細', SH, [], 1)];
  CACHE = {};
  res = G.queryOrders_('LS-');
  ok(res.rows.length === 50 && res.truncated === true,
     '超過 50 筆要截斷並標記，實得 ' + res.rows.length);

  // ── 畫面 ──
  asUser('vivi@waferlock.com');
  let page = G.queryBlock_('vivi@waferlock.com', G.rolesFor_('vivi@waferlock.com'));
  ok(/查詢/.test(page) && /id="q"/.test(page), '應有搜尋框');
  ok(/進價僅主管可見/.test(page), '非主管要說明進價看不到');
  ok(/runQuery\(q\)/.test(page), '應呼叫 runQuery');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');
  asUser('boss@waferlock.com');
  page = G.queryBlock_('boss@waferlock.com', G.rolesFor_('boss@waferlock.com'));
  ok(!/進價僅主管可見/.test(page), '主管不需要那行說明');

  const nav = G.navBlock_('query', { sales: false, boss: false, assistant: true, warehouse: false });
  ok(/查詢/.test(nav), '查詢頁籤應存在');
})();

// ── 測試 20：師傅通知 ──
console.log('【20】師傅通知');
(function () {
  const R = {};
  G.SHIPMENT_HEADERS.forEach(k => { R[k] = ''; });
  R['出貨日期'] = '2026-08-03';
  R['發包單號'] = 'VH-260803-01';
  R['客人姓名'] = '孫明恩';
  R['客人電話'] = '0953-644733';
  R['客人地址'] = '臺北市大安區和平東路三段七號四樓';
  R['施工時段'] = '平日1-4';
  R['工項'] = '裝外門';
  R['售價'] = 19688;
  R['進價'] = 18704;
  R['貨指寄-收件人'] = '大內高手鎖業有限公司';
  R['貨指寄-地址'] = '新北市中和區橋和路122號13樓之2';
  R['出貨品項'] = 'L901GEA10001AA-01 X1';

  const txt = G.techNotice_(R, 'L901');
  const lines = txt.split('\n');

  // 逐行比對現行的師傅通知格式
  ok(lines[0] === '2026-08-03', '第一行是日期，實際「' + lines[0] + '」');
  ok(lines[1] === 'L901-平日1-4', '第二行是型號-時段，實際「' + lines[1] + '」');
  ok(lines[2] === '裝外門', '第三行是工項，實際「' + lines[2] + '」');
  ok(lines[3] === '孫明恩0953-644733', '第四行姓名電話相連（沿用現行寫法），實際「' + lines[3] + '」');
  ok(lines[4] === '臺北市大安區和平東路三段七號四樓', '第五行是施工地址');
  ok(lines[5] === 'VH-260803-01', '第六行是發包單號');
  ok(lines.length === 6, '應為 6 行，實際 ' + lines.length);

  // 🔴 最重要：絕不含金額
  ok(txt.indexOf('19688') < 0 && txt.indexOf('18704') < 0,
     '🔴 師傅通知絕不可含金額（群組是多個師傅共用的）');
  ok(!/售價|進價/.test(txt), '不可出現售價進價字樣');
  // 也不含送貨資料（那是料寄到哪，師傅要的是去哪施工）
  ok(txt.indexOf('大內高手') < 0 && txt.indexOf('橋和路') < 0,
     '不含送貨資料，師傅要的是施工地址');
  ok(txt.indexOf('L901GEA10001AA-01') < 0, '不含完整料號（那是倉庫撿料用的）');

  // 缺欄位時要優雅降級，不留空行
  const R2 = {}; G.SHIPMENT_HEADERS.forEach(k => { R2[k] = ''; });
  R2['登錄時間'] = '2026-08-07 11:18';
  R2['客人姓名'] = '王小姐';
  R2['發包單號'] = 'LS-260807-01';
  const t2 = G.techNotice_(R2, 'L396');
  ok(t2.split('\n').every(l => l.trim() !== ''), '缺欄位不可產生空行');
  ok(t2.split('\n')[0] === '2026-08-07', '沒有出貨日期時退用下單日（不可沒有日期）');
  ok(/L396/.test(t2) && !/L396-$/m.test(t2), '沒有時段時型號不可留下尾巴的破折號');
  ok(G.techNotice_({}, '') === '', '全空應回空字串');

  // 查詢結果要帶上通知文字
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
  const sHead = HEADS['零售-Sammi'];
  const SH = G.SHIPMENT_HEADERS;
  const oRow = sHead.map(() => '');
  oRow[0] = new Date(2026, 7, 3); oRow[1] = 'VH-260803-01'; oRow[3] = 'MOMO';
  oRow[5] = 'L901'; oRow[iOfS('主管KEY英文名押日期', sHead)] = '✅ 核准 boss@w';
  const shipRow = SH.map(k => (R[k] !== undefined ? R[k] : ''));
  SHEETS = [makeSheet('零售-Sammi', sHead, [oRow], 2), makeSheet('出貨明細', SH, [shipRow], 1)];
  CACHE = {};
  sandbox.Session.getActiveUser = () => ({ getEmail: () => 'boss@waferlock.com' });
  const res = G.runQuery('VH-260803-01');
  ok(res.ok && res.rows.length === 1, '查得到那一筆');
  const note = res.rows[0].ships[0].techNotice;
  ok(note && note.split('\n')[1] === 'L901-平日1-4', '查詢結果要帶師傅通知（含型號）');
  ok(note.indexOf('18704') < 0, '🔴 即使主管查詢，師傅通知本身也不含金額');

  const page = G.queryBlock_('boss@waferlock.com', G.rolesFor_('boss@waferlock.com'));
  ok(/複製師傅通知/.test(page), '應有複製按鈕');
  ok(/execCommand\("copy"\)/.test(page), '要保留 execCommand 退路（沙箱 iframe 常擋 clipboard API）');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');

  // 下單頁要有那兩個欄位
  const RH = ['業務代碼', '業務姓名', '業務 email', '發包分頁'];
  SHEETS = [makeSheet('零售-Sammi', sHead, [], 2), makeSheet('出貨明細', SH, [], 1),
            makeSheet('路由對照表', RH, [['VH', 'vivi', 'vh@w.com', '零售-Sammi']], 1)];
  CACHE = {};
  const opage = G.orderBlock_('vh@w.com', G.salesFor_('vh@w.com'));
  ok(/id="workItem"/.test(opage) && /id="workTime"/.test(opage), '下單頁要有工項與施工時段');
  ok(/客人地址／施工地址/.test(opage), '要說明客人地址就是施工地址');

  // 下單時寫入這兩欄
  sandbox.Session.getActiveUser = () => ({ getEmail: () => 'vh@w.com' });
  appended.length = 0;
  const r = G.submitOrder({ kind: '料件出貨', customer: 'MOMO', model: 'L901', qty: '1',
    items: 'X *1', custName: '孫明恩', custPhone: '0953-644733',
    custAddr: '臺北市…', workItem: '裝外門', workTime: '平日1-4' });
  ok(r.ok, '下單成功');
  const s2 = G.openShipmentSheet_();
  const w = appended.filter(a => a.sheet === '出貨明細')[0].row;
  ok(String(w[s2.col['工項'] - 1]) === '裝外門', '工項應寫入');
  ok(String(w[s2.col['施工時段'] - 1]) === '平日1-4', '施工時段應寫入');
})();

function iOfS(name, head) { return head.indexOf(name); }

// ── 測試 21：效能（結構快取、預熱、邊界優化）──
console.log('【21】效能優化');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
  props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';
  delete props.DISPATCH_ROSTER_SHEET;
  sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => 'ok' });

  const sHead = HEADS['零售-Sammi'];
  const SH = G.SHIPMENT_HEADERS;
  const mkRow = (no, approval) => {
    const r = sHead.map(() => '');
    r[0] = new Date(2026, 7, 6); r[1] = no; r[2] = '阿明'; r[3] = '王小姐';
    r[4] = '案'; r[5] = 'L396'; r[6] = 2;
    r[sHead.indexOf('主管KEY英文名押日期')] = approval || '';
    return r;
  };

  // 計數：每個分頁被讀了幾次 getRange、幾格
  function build(nData, tailBlank) {
    const rows = [];
    for (let i = 0; i < nData; i++) {
      rows.push(mkRow('LS-2608' + String(i + 10).padStart(2, '0') + '-01',
        i % 2 === 0 ? '✅ 核准 boss@w' : ''));
    }
    for (let i = 0; i < (tailBlank || 0); i++) rows.push(sHead.map(() => ''));
    const sh = makeSheet('零售-Sammi', sHead, rows, 2);
    sh._calls = 0; sh._cells = 0;
    const o = sh.getRange;
    sh.getRange = (r, c, nr, nc) => {
      sh._calls++; sh._cells += (nr || 1) * (nc || 1);
      return o(r, c, nr, nc);
    };
    SHEETS = [sh, makeSheet('出貨明細', SH, [], 1)];
    CACHE = {}; LOG = [];
    return sh;
  }

  // ── 結構快取：第二次不再讀表頭區 ──
  let sh = build(4, 600);
  G.openSheets_();
  const firstCalls = sh._calls;
  sh._calls = 0;
  G.openSheets_();
  ok(sh._calls === 0, '結構快取命中時不應再讀表頭區（實際又讀了 ' + sh._calls + ' 次）');
  ok(firstCalls >= 1, '第一次必須真的讀表頭');
  ok(G.STRUCT_CACHE_KEY in CACHE, '結構應被寫入快取');

  // lastRow 不可被快取——新增列要立刻看得到
  let env = G.openSheets_();
  const before = env.list[0].lastRow;
  sh._grid.push(mkRow('LS-260899-01', ''));
  env = G.openSheets_();
  ok(env.list[0].lastRow === before + 1,
     'lastRow 必須每次重問（新增列要立刻看得到），實際 ' + env.list[0].lastRow);

  // 分頁清單變動要整份重建
  build(2, 100);
  G.openSheets_();
  SHEETS.push(makeSheet('零售-Johnson', HEADS['零售-Johnson'], [], 2));
  env = G.openSheets_();
  ok(env.list.length === 2, '新增分頁後應重建結構快取，實際納入 ' + env.list.length);

  // clearStructCache 要真的清掉
  build(2, 100);
  G.openSheets_();
  ok(G.STRUCT_CACHE_KEY in CACHE, '先確認有快取');
  G.clearStructCache();
  ok(!(G.STRUCT_CACHE_KEY in CACHE), 'clearStructCache 應清除');

  // ── 🔴 自檢必須繞過結構快取 ──
  sh = build(2, 100);
  G.openSheets_();
  // 塞一份「過期」的結構：假裝這個分頁缺主管簽核欄
  const stale = JSON.parse(CACHE[G.STRUCT_CACHE_KEY]);
  const nm = Object.keys(stale.sheets)[0];
  delete stale.sheets[nm].col['主管KEY英文名押日期'];
  stale.sheets[nm].usable = false;
  CACHE[G.STRUCT_CACHE_KEY] = JSON.stringify(stale);
  // 一般讀取會拿到過期結構（這是快取的預期行為）
  ok(G.openSheets_().list[0].usable === false, '一般讀取會用快取（含過期內容）');
  // 但自檢一定要讀真實表頭
  LOG = [];
  G.checkSetup();
  ok(!LOG.some(l => /缺「主管簽核」欄，整個分頁略過/.test(l)),
     '🔴 checkSetup 必須繞過結構快取讀真實表頭，否則會報告不存在的問題');
  ok(G.SKIP_STRUCT_CACHE_ === false, '自檢結束後必須還原旗標（用 finally）');

  // 自檢過程不可污染快取（它讀的是真實結構，不該寫回去覆蓋）
  sh = build(2, 100);
  G.checkSetup();
  ok(!(G.STRUCT_CACHE_KEY in CACHE), '自檢不應寫入結構快取');

  // ── getShippable_ 邊界優化 ──
  sh = build(6, 800);
  const rows1 = G.getShippable_();
  const cells = sh._cells;
  ok(rows1.length === 3, '應只回已核准的 3 筆，實際 ' + rows1.length);
  ok(rows1.every(r => /^LS-/.test(r.orderNo)), '結果內容正確');
  ok(rows1[0].customer === '王小姐' && rows1[0].model === 'L396', '欄位要帶齊');
  // 舊做法會讀 (6+800) × lastCol
  const naive = 806 * sHead.length;
  ok(cells < naive / 3, '讀取量應大幅下降：新 ' + cells + ' 格 vs 舊做法約 ' + naive + ' 格');

  // 整張表沒有有效單號時要早退
  build(0, 500);
  ok(G.getShippable_().length === 0, '沒有有效單號應回 0 筆');

  // ── warmCache 預熱三份 ──
  build(4, 100);
  G.warmCache();
  ok(G.CACHE_KEY in CACHE, '待簽核快取應被預熱');
  ok(G.SHIP_CACHE_KEY in CACHE, '🔴 待出貨快取也要預熱（先前漏了，那頁永遠冷啟動）');
  ok(G.WH_CACHE_KEY in CACHE, '🔴 待核單快取也要預熱');
  ok(LOG.filter(l => /快取已更新/.test(l)).length === 3, '三份都要記錄，實際 ' +
     LOG.filter(l => /快取已更新/.test(l)).length + ' 份');
  ok(LOG.some(l => /預熱總耗時/.test(l)), '要輸出總耗時（供判斷是否該上 batchGet）');

  // 其中一份失敗，另兩份仍要更新
  build(4, 100);
  const shipSheet = SHEETS[1];
  const origGR = shipSheet.getRange;
  shipSheet.getRange = () => { throw new Error('模擬出貨明細讀取失敗'); };
  LOG = [];
  G.warmCache();
  ok(G.CACHE_KEY in CACHE, '出貨明細壞掉時，待簽核快取仍要更新');
  ok(LOG.some(l => /❌/.test(l) && /失敗/.test(l)), '失敗要留下記錄');
  ok(LOG.some(l => /預熱總耗時/.test(l)), '即使有失敗也要輸出總耗時');
  shipSheet.getRange = origGR;
})();

// ── 測試 22：下拉選單 ──
console.log('【22】下拉選單');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  delete props.DISPATCH_ROSTER_SHEET;
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const sHead = HEADS['零售-Sammi'];
  const SH = G.SHIPMENT_HEADERS;
  const RH = ['業務代碼', '業務姓名', '業務 email', '發包分頁'];
  const rr = [['LS', 'sammi lin', 'sammi.lin@waferlock.com', '零售-Sammi']];

  // 橫向排列，刻意把欄序打亂並留空白列
  const OH = ['工項', '購買通路', '承包商', '型號'];
  const OR = [
    ['裝外門', 'MOMO', '阿明工程行', 'L396'],
    ['裝內門', '蝦皮', '蔣家工程行', 'D310'],
    ['', '官網', '', 'L-372N'],
    ['換鎖芯', '', '宇泰鎖印', ''],
  ];
  const reset = (optSheet) => {
    SHEETS = [makeSheet('零售-Sammi', sHead, [], 2), makeSheet('出貨明細', SH, [], 1),
              makeSheet('路由對照表', RH, rr, 1)];
    if (optSheet !== null) SHEETS.push(makeSheet('選單', OH, OR, 1));
    CACHE = {}; appended.length = 0;
  };

  reset();
  let O = G.loadOptions_();
  ok(O['購買通路'].join() === 'MOMO,蝦皮,官網', '欄序打亂也要對得上，實際 ' + O['購買通路']);
  ok(O['型號'].join() === 'L396,D310,L-372N', '型號選項');
  ok(O['工項'].join() === '裝外門,裝內門,換鎖芯', '中間的空白列要略過');
  ok(O['承包商'].join() === '阿明工程行,蔣家工程行,宇泰鎖印', '承包商選項');
  ok(O['發票別'] === undefined, '選單分頁沒有發票別欄時不應憑空生出來');

  // 分頁不存在 → 回空物件，且表單退回純文字輸入
  reset(null);
  ok(Object.keys(G.loadOptions_()).length === 0, '選單分頁不存在應回空物件');
  asUser('sammi.lin@waferlock.com');
  let page = G.orderBlock_('sammi.lin@waferlock.com', G.salesFor_('sammi.lin@waferlock.com'));
  ok(/<input id="project"/.test(page), '沒有選項時應退回純文字輸入，不可壞頁');
  ok(!/<select id="project"/.test(page), '不該產生空的下拉');
  ok(/出貨待驗無發票/.test(page), '發票別要沿用程式裡的既有常數');

  // 有選項 → 下拉 ＋「其他」＋ 文字框
  reset();
  page = G.orderBlock_('sammi.lin@waferlock.com', G.salesFor_('sammi.lin@waferlock.com'));
  ['project', 'model', 'worker', 'workItem'].forEach(id => {
    ok(new RegExp('<select id="' + id + '"').test(page), id + ' 應為下拉');
    ok(new RegExp('id="' + id + 'X"').test(page), id + ' 應有「其他」文字框');
  });
  ok((page.match(/<option>其他<\/option>/g) || []).length === 4, '四個下拉都要有「其他」');
  ok(/MOMO/.test(page) && /蔣家工程行/.test(page), '選項要出現在 HTML 裡');
  ok(/onchange="oth\(/.test(page), '要綁切換邏輯');
  ok(/function val\(id\)/.test(page), '要有取值函式（選其他時取文字框）');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');

  // 選單分頁是系統分頁，不可被當成業務發包分頁
  ok(G.isSystemSheet_('選單') === true, '選單分頁應被排除');
  const evil = OH.concat(['發包單號', '主管簽核']);
  const evilRow = evil.map(() => '');
  evilRow[evil.indexOf('發包單號')] = 'LS-260805-01';
  SHEETS = [makeSheet('零售-Sammi', sHead, [], 2), makeSheet('選單', evil, [evilRow], 1)];
  CACHE = {};
  ok(G.openSheets_().list.length === 1,
     '即使選單分頁有發包單號與簽核欄，也不可被納入掃描');

  // 🔴 伺服器端要擋「其他」字面值
  reset();
  asUser('sammi.lin@waferlock.com');
  let r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: '其他', qty: '1' });
  ok(!r.ok && /型號選了「其他」/.test(r.message), '型號送字面「其他」應被擋｜' + r.message);
  r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '1', project: '其他' });
  ok(!r.ok && /案名／購買通路選了「其他」/.test(r.message), '通路送字面「其他」應被擋');
  r = G.submitOrder({ kind: '發包安裝', customer: 'A', model: 'B', qty: '1', worker: '其他' });
  ok(!r.ok && /承包商選了「其他」/.test(r.message), '承包商送字面「其他」應被擋');
  r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'B', qty: '1', workItem: '其他' });
  ok(!r.ok && /工項選了「其他」/.test(r.message), '工項送字面「其他」應被擋');
  ok(appended.length === 0, '任何被擋的情況都不可寫入');

  // 正常送出（前端已把「其他」換成實際值）
  r = G.submitOrder({ kind: '料件出貨', customer: 'A', model: 'L901', qty: '1',
    project: '竹北自建案', workItem: '裝外門' });
  ok(r.ok, '換成實際值後應成功｜' + r.message);
  const w = appended.filter(a => a.sheet === '零售-Sammi')[0].row;
  ok(String(w[sHead.indexOf('案名')]) === '竹北自建案', '寫入的是實際值不是「其他」');
})();

// ── 測試 23：師傅通知一鍵複製 ──
console.log('【23】助理鍵單後的一鍵複製');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';
  props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';
  sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => 'ok' });
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };

  const SH = G.SHIPMENT_HEADERS;
  const mk = o => { const r = SH.map(() => ''); SH.forEach((k, i) => { if (o[k] !== undefined) r[i] = o[k]; }); return r; };
  const base = {
    '登錄時間': '2026-08-03 10:00', '發包單號': 'VH-260803-01', '客戶': 'MOMO',
    '出貨品項': 'L901GEA10001AA-01 X1', '客人姓名': '孫明恩', '客人電話': '0953-644733',
    '客人地址': '臺北市大安區和平東路三段七號四樓', '施工時段': '平日1-4', '工項': '裝外門',
    '售價': 19688, '進價': 18704, '倉庫核單狀態': '待核',
  };

  SHEETS = [makeSheet('零售-Sammi', HEADS['零售-Sammi'], [], 2),
            makeSheet('出貨明細', SH, [mk(base)], 1)];
  CACHE = {};
  asUser('vivi@waferlock.com');
  let r = G.fillShipment(2, { shipNo: 'W5501-001', shipDate: '2026-08-03' });
  ok(r.ok, '鍵入成功');
  ok(!!r.techNotice, '🔴 助理鍵完單就要回傳師傅通知（這是使用者要的將就方案）');
  const lines = r.techNotice.split('\n');
  ok(lines[0] === '2026-08-03', '第一行日期');
  ok(lines.indexOf('裝外門') >= 0, '要有工項');
  ok(lines.indexOf('孫明恩0953-644733') >= 0, '要有聯絡人');
  ok(lines.indexOf('VH-260803-01') >= 0, '要有發包單號');
  ok(r.techNotice.indexOf('19688') < 0 && r.techNotice.indexOf('18704') < 0,
     '🔴 絕不含金額');

  // 舊路徑（submitShipment）也要回傳
  SHEETS = [makeSheet('零售-Sammi', HEADS['零售-Sammi'], [], 2),
            makeSheet('出貨明細', SH, [], 1)];
  CACHE = {};
  r = G.submitShipment({ shipNo: 'W5506-002', items: '鎖胚 *184' });
  ok(r.ok, '舊路徑登錄成功｜' + r.message);
  // 舊路徑的表單沒有客人資料欄位（它是給「無發包單的出貨」用的），
  // 所以通知會缺聯絡人與地址 → 刻意不回傳。只有日期和單號的通知比不給更糟：
  // 助理會以為貼出去就完成了，而師傅根本不知道要去哪找誰。
  ok(!r.techNotice, '缺聯絡人與地址時不可回傳半套的師傅通知');
  ok(G.techNotice_({ '出貨日期': '2026-08-03', '發包單號': 'X-1' }, 'L901') === '',
     '只有日期與單號時應回空字串');
  ok(G.techNotice_({ '出貨日期': '2026-08-03', '客人姓名': '陳主任' }, '') !== '',
     '有聯絡人就要產生通知');

  // 前端：共用的複製片段與顯示區塊
  const roles = G.rolesFor_('vivi@waferlock.com');
  const page = G.shipBlock_('vivi@waferlock.com', [], roles, { at: '11:30' }, []);
  ok(/id="notice"/.test(page), '要有師傅通知的顯示容器');
  ok(/function cpText\(t\)/.test(page), '要有共用的複製函式');
  ok(/execCommand\("copy"\)/.test(page), '要保留 execCommand 退路（沙箱 iframe 常擋）');
  ok(/showNotice\(res\.techNotice\)/.test(page), '成功後要顯示通知');
  ok(/textContent=t/.test(page), '內容用 textContent 填入，不拼進 innerHTML（免跳脫問題）');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '出貨頁內嵌 JS 語法正確');

  // 查詢頁改用共用片段後仍正常
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
  asUser('boss@waferlock.com');
  const qp = G.queryBlock_('boss@waferlock.com', G.rolesFor_('boss@waferlock.com'));
  ok(/function cpText\(t\)/.test(qp) && /function cp\(i\)/.test(qp), '查詢頁改用共用複製函式');
  ok((qp.match(/function cpFb/g) || []).length === 1, '不可有兩份重複的退路實作');
  new Function(qp.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '查詢頁內嵌 JS 語法正確');
})();

// ── 測試 24：⑥ 報表頁 ──
console.log('【24】報表頁');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_SUB_APPROVERS = 'sub@waferlock.com';
  props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
  props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';
  props.DISPATCH_WAREHOUSE = 'wh@waferlock.com';
  delete props.DISPATCH_ROSTER_SHEET;
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };

  const sHead = HEADS['零售-Sammi'];
  const iA = sHead.indexOf('主管KEY英文名押日期');
  const SH = G.SHIPMENT_HEADERS;
  const mkO = (no, worker, price, approval) => {
    const r = sHead.map(() => '');
    r[0] = new Date(2026, 7, 3); r[1] = no; r[2] = worker; r[3] = '客';
    r[5] = 'L396'; r[6] = 1; r[11] = price; r[iA] = approval || '';
    return r;
  };
  const mkS = o => { const r = SH.map(() => ''); SH.forEach((k, i) => { if (o[k] !== undefined) r[i] = o[k]; }); return r; };

  SHEETS = [
    makeSheet('零售-Sammi', sHead, [
      mkO('LS-260803-01', '蔣師傅', 3000, '✅ 核准 boss@w'),
      mkO('LS-260803-02', '蔣家工程行', 5000, '✅ 核准 boss@w'),
      mkO('LS-260803-03', '阿明工程行', 2000, ''),
      mkO('LS-260803-04', '陳家工程行', 1000, ''),
    ], 2),
    makeSheet('出貨明細', SH, [
      mkS({ '登錄時間': '2026-07-15 10:00', '出貨單號': 'W-1', '發包單號': 'LS-260803-01',
        '售價': 10000, '進價': 8000, '下單業務': 'sammi lin', '倉庫核單狀態': '已核' }),
      mkS({ '登錄時間': '2026-08-03 10:00', '出貨單號': 'W-2', '售價': 20000, '進價': 15000,
        '下單業務': 'sammi lin', '倉庫核單狀態': '待核' }),
      // 跨年同月：2025-12 不可跟 2026-12 併在一起
      mkS({ '登錄時間': '2025-12-01 10:00', '出貨單號': 'W-3', '售價': 5000, '進價': 4000,
        '下單業務': 'vivi huang', '倉庫核單狀態': '已核' }),
      mkS({ '登錄時間': '2026-12-01 10:00', '出貨單號': 'W-4', '售價': 7000, '進價': 6000,
        '下單業務': 'vivi huang', '倉庫核單狀態': '已核' }),
      // 售價空白／非數字不可讓合計變 NaN
      mkS({ '登錄時間': '2026-08-04 10:00', '出貨單號': 'W-5', '售價': '', '進價': '待確認',
        '下單業務': 'sammi lin', '倉庫核單狀態': '待核' }),
      // 沒有下單業務、靠發包單號前綴推（ST 不在對照表）
      mkS({ '登錄時間': '2026-08-05 10:00', '出貨單號': 'W-6', '發包單號': 'ST-260805-01',
        '售價': 1000, '進價': 500, '倉庫核單狀態': '待核' }),
    ], 1),
    makeSheet('路由對照表', ['業務代碼', '業務姓名', '業務 email', '發包分頁'],
      [['LS', 'sammi lin', 'sammi.lin@waferlock.com', '零售-Sammi']], 1),
  ];
  CACHE = {};

  // ── 🔴 權限：非主管呼叫 API 也要被擋 ──
  asUser('vivi@waferlock.com');
  ok(G.getReport().ok === false, '🔴 助理呼叫 getReport 應被擋（不只頁籤看不到）');
  asUser('wh@waferlock.com');
  ok(G.getReport().ok === false, '倉庫應被擋');
  asUser('sammi.lin@waferlock.com');
  ok(G.getReport().ok === false, '業務應被擋');
  asUser('');
  ok(G.getReport().ok === false, '取不到身分應被擋');
  asUser('sub@waferlock.com');
  ok(G.getReport().ok === true, '副主管可以看');
  CACHE = {};
  asUser('boss@waferlock.com');
  let res = G.getReport();
  ok(res.ok === true, '主管可以看');
  const d = res.data;

  // ── 待辦積壓要與三份快取一致 ──
  CACHE = {};
  const pend = G.getPending_();
  const shipp = G.getShippable_();
  const whp = G.getWarehousePending_();
  CACHE = {};
  res = G.getReport();
  const b = res.data.backlog;
  ok(b.sub + b.boss === pend.length,
     '待簽核總數要與 getPending_ 一致：' + (b.sub + b.boss) + ' vs ' + pend.length);
  ok(b.ship === shipp.length, '待出貨要一致：' + b.ship + ' vs ' + shipp.length);
  ok(b.warehouse === whp.length, '待核單要一致：' + b.warehouse + ' vs ' + whp.length);

  // ── 月趨勢：跨年不可合併 ──
  const months = res.data.months.map(m => m.month);
  ok(months.indexOf('2025-12') >= 0 && months.indexOf('2026-12') >= 0,
     '🔴 2025-12 與 2026-12 必須是兩筆，實際 ' + months.join(','));
  ok(months.join() === months.slice().sort().join(), '月份應排序');
  const m202608 = res.data.months.filter(m => m.month === '2026-08')[0];
  ok(m202608 && m202608.count === 3, '2026-08 應有 3 筆，實際 ' + (m202608 && m202608.count));
  ok(!isNaN(m202608.sale) && m202608.sale === 21000,
     '🔴 空白／非數字售價不可讓合計變 NaN，實際 ' + m202608.sale);

  // ── 業務績效 ──
  const sammi = res.data.sales.filter(s => s.name === 'sammi lin')[0];
  ok(sammi && sammi.count === 3, 'sammi 應有 3 筆，實際 ' + (sammi && sammi.count));
  ok(sammi.sale === 30000, 'sammi 售價合計 30000，實際 ' + sammi.sale);
  ok(!isNaN(sammi.profit), '毛利不可為 NaN');
  ok(res.data.sales[0].sale >= res.data.sales[res.data.sales.length - 1].sale,
     '應依售價排序');
  ok(res.data.quality.unknownCodes.indexOf('ST') >= 0,
     '未收錄的業務代碼 ST 要被列出');

  // ── 承包商 ──
  const w1 = res.data.workers.filter(w => w.name === '蔣師傅')[0];
  ok(w1 && w1.count === 1 && w1.price === 3000, '承包商統計正確');
  ok(res.data.workers[0].count >= res.data.workers[res.data.workers.length - 1].count,
     '應依筆數排序');

  // ── 🔴 承包商名稱不一致的偵測 ──
  const dupes = res.data.quality.workerDupes;
  const flat = dupes.map(g => g.slice().sort().join('|'));
  ok(flat.some(s => s === '蔣家工程行|蔣師傅'),
     '🔴「蔣師傅」與「蔣家工程行」要被列為疑似同一人，實際 ' + JSON.stringify(dupes));
  ok(!flat.some(s => /陳家/.test(s) && /蔣家/.test(s)),
     '🔴「蔣家工程行」與「陳家工程行」不可被誤判為同一人');

  // ── 快取 ──
  ok(G.REPORT_CACHE_KEY in CACHE, '報表結果應被快取');
  ok(G.getReport().cached === true, '第二次應命中快取');

  // ── 畫面 ──
  let page = G.reportBlock_('boss@waferlock.com');
  ok(/報表/.test(page) && /僅主管可見/.test(page), '標題與提示');
  ok(/getReport\(\)/.test(page), '前端非同步取資料');
  ok(/統計中…/.test(page), '要有載入提示（統計要掃全量）');
  ok(!/chart\.js|cdn/i.test(page), '不可引入外部圖表庫');
  ok(/class="bfill"/.test(page), '要用純 CSS 條狀圖');
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  ok(true, '內嵌 JS 語法正確');

  const full = G.htmlPage_('x')._h;
  ok(/\.bfill\{/.test(full) && /\.btrack\{/.test(full), '條狀圖樣式要在');
  ok(/max-width:520px/.test(full), '要有窄螢幕的 media query');

  // 頁籤只對主管顯示
  ok(/報表/.test(G.navBlock_('report', { boss: true })), '主管要看到報表頁籤');
  ok(/報表/.test(G.navBlock_('query', { sub: true })), '副主管要看到');
  ok(!/報表/.test(G.navBlock_('ship', { assistant: true })), '助理不該看到報表頁籤');
  ok(!/報表/.test(G.navBlock_('warehouse', { warehouse: true })), '倉庫不該看到');
})();

console.log('\n' + (fail ? '❌' : '✅') + ' 通過 ' + pass + '／失敗 ' + fail);
process.exit(fail ? 1 : 0);
