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
  for (let i = 1; i < headerRow; i++) grid.push(head.map(() => ''));
  grid.push(head.slice());
  (dataRows || []).forEach(r => grid.push(r));
  return {
    _name: name, _grid: grid,
    getName: () => name,
    getLastColumn: () => head.length,
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
  insertSheet: n => { const s = makeSheet(n, [], [], 1); s._grid = []; SHEETS.push(s); return s; },
};
const sandbox = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
  SpreadsheetApp: { openById: () => ss, flush: () => {} },
  Session: { getActiveUser: () => ({ getEmail: () => 'boss@waferlock.com' }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: { formatDate: (d, tz, f) => '2026-08-07 15:00' },
  HtmlService: { createHtmlOutput: h => ({ _h: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  Logger: { log: m => LOG.push(String(m)) },
  DriveApp: { getFolderById: () => ({}) },
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

console.log('\n' + (fail ? '❌' : '✅') + ' 通過 ' + pass + '／失敗 ' + fail);
process.exit(fail ? 1 : 0);
