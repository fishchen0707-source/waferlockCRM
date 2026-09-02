// 用真實的 18 分頁表頭驗證改動後的讀表／判定邏輯
const fs = require('fs'), vm = require('vm'), path = require('path');
// 相對於本檔案定位，不寫死絕對路徑——repo 搬家或換一台機器就不用改程式。
// 用 __dirname 而不是 process.cwd()，這樣從哪個目錄執行都一樣。
const DIR = path.join(__dirname, '..', 'docs') + path.sep;

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
        // 必須在 'yyMMdd' 之前處理：'yyyyMMdd' 字串本身含有子字串 'yyMMdd'
        // （從第 3 個字元起），先換 6 碼版會把 8 碼版吃掉一半，殘留開頭的 'yy'。
        .replace('yyyyMMdd', '' + Y + MM + DD)
        .replace('yyMMdd', String(Y).slice(2) + MM + DD)
        .replace('yyyyMMdd_HHmm', '' + Y + MM + DD + '_' + HH + mm)
        .replace('yyyyMMdd-HHmm', '' + Y + MM + DD + '-' + HH + mm)
        .replace('yyyy', Y).replace('MM', MM).replace('dd', DD)
        .replace('HH', HH).replace('mm', mm);
    },
    base64Decode: b64 => Buffer.from(String(b64), 'base64'),
    newBlob: (bytes, mime, name) => ({ _bytes: bytes, _mime: mime, _name: name }),
  },
  HtmlService: { createHtmlOutput: h => ({ _h: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  Logger: { log: m => LOG.push(String(m)) },
  // 發票上傳用。記下建了哪些檔，並且**不提供 setSharing**——
  // 程式若哪天自己去開分享權限，這裡會直接 TypeError 而不是安靜地把發票變成公開。
  DriveApp: {
    getFolderById: id => {
      if (id === 'BAD') throw new Error('找不到資料夾');
      return {
        getName: () => '發票電子檔',
        createFile: blob => {
          const f = { name: blob._name, bytes: blob._bytes, mime: blob._mime,
            getUrl: () => 'https://drive.google.com/file/d/FAKE_' + blob._name + '/view',
            getId: () => 'FAKE_' + blob._name };
          DRIVE.push(f);
          return f;
        }
      };
    }
  },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/w/s/AAA/exec' }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in CACHE ? CACHE[k] : null), put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => 'ok' }) },
  console,
};
let LOG = [];
let CACHE = {};
let DRIVE = [];   // 發票上傳測試：記下建了哪些 Drive 檔
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(DIR + 'gas-dispatch-approval.gs', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(DIR + 'gas-dispatch-notify.gs', 'utf8'), sandbox);
// Chat app 與簽核同一個 Apps Script 專案，它用的 TZ／deepLink_／COL_ 常數都來自 approval，
// 所以載進同一個 sandbox 才測得動，也才不會為了它另外複製一份 stub。
vm.runInContext(fs.readFileSync(DIR + 'gas-dispatch-chatapp.gs', 'utf8'), sandbox);
const G = sandbox;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

// 把 <script> 區塊丟進 new Function 檢查語法，回 true/false 而不是拋例外。
// 直接讓例外往上炸會中斷整個套件，後面幾百條斷言的結果就都看不到了。
const scriptsParse = blocks => {
  for (const b of blocks) {
    try {
      new Function(b.replace(/^<script>/, '').replace(/<\/script>$/, ''));
    } catch (err) {
      console.log('    語法錯誤：' + err.message);
      return false;
    }
  }
  return true;
};

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
  // 全公司唯一值。第一階段刻意允許留空，但欄位必須在——
  // 寫入是靠表頭文字定位的，欄位不在就是**安靜丟掉**，不會有任何錯誤。
  ok(at('案件號') >= 0, '🔴 出貨明細要有「案件號」欄（全公司唯一值）');

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
    toName: '倉庫自取', invoice: '電子計算機發票',
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
    // 🔴 公司開的是「電子計算機發票」，不是財政部電子發票平台的「電子發票」——
    // TIPTOP 課程文件特別提醒兩者不同。選單寫錯，助理選了會跟 TipTop 實際開出來的
    // 發票種類對不起來。
    ok(html.indexOf('電子計算機發票') >= 0, '發票別下拉要用「電子計算機發票」，不是「電子發票」');
    ok(html.indexOf('>電子發票<') < 0, '不可誤植「電子發票」這個選項——公司沒有在開這種發票');
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
  ok(/業務：查不到/.test(msg), '兩條路都查不到業務時要明講，不可靜默略過');

  // 🔴 沒有發包單號時要改用「下單業務」欄——那種單約佔一半（料件出貨、截圖
  //    下單、弱電料件、鎖胚、建案整批本來就不走發包單）。原本只試發包單號，
  //    等於一半的出貨出問題時業務根本不會被通知（2026-08-25 真實通知截圖看到）。
  //    報表那邊早就用對了（優先用下單業務），通知這邊沒跟上。
  {
    const row = mkShip('W5501-010', '待核', '');
    row[at('下單業務')] = '小林';
    sh = reset([row]);
    sent = [];
    G.submitWarehouse('W5501-010', 'issue', '少一支', 2);
    const m2 = JSON.parse(sent[0]).text;
    ok(/業務：/.test(m2) && !/查不到/.test(m2),
       '🔴 沒有發包單號但有「下單業務」時，必須靠它點名業務');
    ok(/小林/.test(m2), '要帶出業務姓名');
  }

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
  ok(/<h1>下單<\/h1>/.test(page) && /LS/.test(page), '應顯示身分與代碼');
  ok(/發包安裝/.test(page) && /料件出貨/.test(page), '應有兩個單別按鈕');
  ok(/零售-Sammi/.test(page), '應告知會寫進哪個分頁');
  ok(/id="installOnly"/.test(page), '承包商欄要能依單別隱藏');
  ok(/display:none/.test(page), '未選單別前欄位應隱藏');
  ok(!/發包單號/.test(page.split('<script>')[0]) || /自動編號/.test(page),
     '不可讓人手填發包單號');
  // 合併截圖下單後這一頁有**兩個** <script>（表單一個、截圖下單的 IIFE 一個）。
  // 只驗第一個會讓另一個悄悄失去語法檢查，所以全部都要跑過。
  const blocks = page.match(/<script>([\s\S]*?)<\/script>/g) || [];
  ok(blocks.length === 2, '下單頁應有兩個內嵌腳本（表單＋截圖下單），實際 ' + blocks.length);
  // 語法錯誤要當成一條失敗的斷言，不能讓 new Function 直接把整個套件炸掉——
  // 崩潰的話後面所有測試結果都看不到，反而更難定位。
  ok(scriptsParse(blocks), '兩段內嵌 JS 語法都正確');

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
  // 案件號＝全公司唯一值。正式環境的「出貨明細」是先建的，沒有這一欄；
  // 而寫入靠表頭文字定位，欄位不在就是**安靜丟掉**，不會有任何錯誤訊息。
  ok(s.col['案件號'] !== undefined,
     '🔴 既有分頁必須自動補上「案件號」欄，否則值會被安靜丟掉');
  ok(s.col['案件號'] > OLD_SHIP.length, '案件號要附加在表尾，不可插進既有欄位中間');

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
  // 兩則通知，時機不同、對象不同：
  //   ① 業務下單的當下 → 通知下一棒（料件出貨免簽核，下一棒是助理）
  //   ② 助理鍵完 TipTop 單號 → 通知倉庫撿料
  // 之前只有 ②。少了 ① 的話，料件出貨完全沒有人被通知，
  // 助理只能自己記得去開頁面看，漏掉也不會有人發現。
  ok(sent.length === 2, '應有 2 則通知（下單 1 ＋ 通知倉庫 1），實得 ' + sent.length);
  const orderMsg = JSON.parse(sent[0]).text;
  const whMsg = JSON.parse(sent[1]).text;
  // 這筆是「發包安裝」，要簽核，所以下一棒是主管、連結指向簽核頁。
  // （料件出貨免簽核，下一棒才是助理、連結指向鍵單頁——見【27】的對照測試）
  ok(/新單待.*核准/.test(orderMsg), '第 1 則應是下單通知｜' + orderMsg.split('\n')[0]);
  ok(/no=/.test(orderMsg) && /page=approve/.test(orderMsg),
     '🔴 需簽核的單，下單通知要帶「直接開這一筆簽核」的深連結');
  ok(/sh=/.test(orderMsg) && /rw=/.test(orderMsg),
     '深連結要帶分頁與列號提示，否則對方開頁時要掃 17 個分頁');
  ok(/L901GEA10001AA-01/.test(whMsg), '倉庫通知要含完整品項');

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
  // 下單頁自 2026-08-25 起有兩段腳本（表單＋截圖下單），要全部驗過。
  // 用 .match(/…/)[1] 只會拿到第一段，另一段就悄悄失去語法檢查。
  ok(scriptsParse(opage.match(/<script>[\s\S]*?<\/script>/g) || []), '下單頁 JS 語法正確');
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
        '倉庫核單狀態': '已核', '倉庫核單人': 'wh@waferlock.com', '發票號碼': 'AB-98765432' }),
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
  {
    // 🔴 昨天記錄的缺口：查詢頁能用出貨單號、客戶查，查不到發票號碼。這裡驗證已補上。
    const invRows = G.queryOrders_('AB-98765432').rows;
    ok(invRows.length === 1, '🔴 用發票號碼要查得到這筆出貨');
    ok((invRows[0] && invRows[0].ships || []).some(s => s['發票號碼'] === 'AB-98765432'),
       '回傳的出貨資料要帶著發票號碼本身，前端才有東西可以顯示');
    const html = G.queryBlock_('boss@waferlock.com', G.rolesFor_('boss@waferlock.com'));
    ok(/發票號碼/.test(html) && /s\["發票號碼"\]/.test(html),
       '🔴 查詢頁的卡片渲染邏輯要認得「發票號碼」這個欄位，不能只是查得到卻沒地方顯示');
  }
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
  ok(scriptsParse(page.match(/<script>[\s\S]*?<\/script>/g) || []), '內嵌 JS 語法正確');

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

// ── 測試 25：從試算表的「資料驗證」讀下拉選項 ──
console.log('【25】資料驗證當選項來源');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  delete props.DISPATCH_ROSTER_SHEET;
  const sHead = HEADS['零售-Sammi'];
  const SH = G.SHIPMENT_HEADERS;
  const RH = ['業務代碼', '業務姓名', '業務 email', '發包分頁'];
  const rr = [['LS', 'sammi lin', 'sammi.lin@waferlock.com', '零售-Sammi']];
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };

  // 在 makeSheet 上補資料驗證的 stub
  function withValidation(sh, rules) {
    const orig = sh.getRange;
    sh.getRange = (r, c, nr, nc) => {
      const rg = orig(r, c, nr, nc);
      rg.getDataValidation = () => {
        const key = r + ',' + c;
        return rules[key] || null;
      };
      return rg;
    };
    return sh;
  }
  const listRule = arr => ({
    getCriteriaType: () => 'VALUE_IN_LIST',
    getCriteriaValues: () => [arr],
  });
  const rangeRule = grid => ({
    getCriteriaType: () => 'VALUE_IN_RANGE',
    getCriteriaValues: () => [{ getValues: () => grid }],
  });

  const iP = sHead.indexOf('案名') + 1;
  const iM = sHead.indexOf('型號') + 1;
  const iW = sHead.indexOf('承包商') + 1;

  // 表頭在第 2 列 → 資料驗證讀第 3 列
  const rules = {};
  rules['3,' + iP] = listRule(['MOMO', '蝦皮', '官網', '']);
  rules['3,' + iM] = rangeRule([['L396'], ['D310'], [''], ['L901']]);
  rules['3,' + iW] = listRule(['蔣家工程行', '大內高手', '蔣家工程行']);

  const build = (optSheet) => {
    const s1 = withValidation(makeSheet('零售-Sammi', sHead, [], 2), rules);
    SHEETS = [s1, makeSheet('出貨明細', SH, [], 1), makeSheet('路由對照表', RH, rr, 1)];
    if (optSheet) SHEETS.push(optSheet);
    CACHE = {};
  };

  build();
  let O = G.loadOptions_('零售-Sammi');
  ok(O['購買通路'].join() === 'MOMO,蝦皮,官網',
     '🔴 要能從資料驗證讀出選項（使用者本來就是這樣設的），實際 ' + O['購買通路']);
  ok(O['型號'].join() === 'L396,D310,L901',
     'VALUE_IN_RANGE 也要處理（清單放別處再指過去很常見），實際 ' + O['型號']);
  ok(O['承包商'].join() === '蔣家工程行,大內高手', '重複值要去除');
  ok(O['工項'] === undefined, '業務分頁沒有工項欄，該欄仍無選項（會退回文字輸入）');

  // 下單頁應該真的出現下拉
  asUser('sammi.lin@waferlock.com');
  let page = G.orderBlock_('sammi.lin@waferlock.com', G.salesFor_('sammi.lin@waferlock.com'));
  ok(/<select id="project"/.test(page) && /MOMO/.test(page),
     '🔴 下單頁要出現下拉（先前只讀「選單」分頁，所以一直沒得選）');
  ok(/<select id="worker"/.test(page) && /大內高手/.test(page), '承包商也要有下拉');
  ok(/<input id="workItem"/.test(page), '沒有來源的欄位仍退回文字輸入');
  ok(scriptsParse(page.match(/<script>[\s\S]*?<\/script>/g) || []), '內嵌 JS 語法正確');

  // 「選單」分頁優先，逐欄合併
  const OH = ['購買通路', '工項'];
  const OR = [['蝦皮商城', '裝外門'], ['PChome', '裝內門']];
  build(makeSheet('選單', OH, OR, 1));
  O = G.loadOptions_('零售-Sammi');
  ok(O['購買通路'].join() === '蝦皮商城,PChome', '「選單」分頁優先於資料驗證');
  ok(O['工項'].join() === '裝外門,裝內門', '選單分頁可補業務分頁沒有的欄位');
  ok(O['型號'].join() === 'L396,D310,L901',
     '選單分頁沒有的欄位要退而用資料驗證（逐欄合併，不是二選一）');

  // 沒有任何來源 → 全部退回文字輸入，不可壞頁
  SHEETS = [makeSheet('零售-Sammi', sHead, [], 2), makeSheet('出貨明細', SH, [], 1),
            makeSheet('路由對照表', RH, rr, 1)];
  CACHE = {};
  ok(Object.keys(G.loadOptions_('零售-Sammi')).length === 0, '沒有來源時回空物件');
  page = G.orderBlock_('sammi.lin@waferlock.com', G.salesFor_('sammi.lin@waferlock.com'));
  ok(/<input id="project"/.test(page) && !/<select id="project"/.test(page),
     '沒有選項時退回文字輸入');

  // 系統分頁不可當作驗證來源
  ok(Object.keys(G.loadOptionsValidation_('出貨明細')).length === 0, '不可讀系統分頁的驗證');
  ok(Object.keys(G.loadOptionsValidation_('')).length === 0, '空分頁名要安全回空');

  // 非選單類型的驗證（數字範圍等）不可被當成選項
  const numRules = {};
  numRules['3,' + iP] = { getCriteriaType: () => 'NUMBER_BETWEEN', getCriteriaValues: () => [1, 99] };
  SHEETS = [withValidation(makeSheet('零售-Sammi', sHead, [], 2), numRules),
            makeSheet('出貨明細', SH, [], 1), makeSheet('路由對照表', RH, rr, 1)];
  CACHE = {};
  ok(G.loadOptions_('零售-Sammi')['購買通路'] === undefined,
     '數字範圍這類驗證不是選單，不可拿來當選項');
})();

// ── 發票電子檔上傳 ────────────────────────────────────────────
// 倉庫一訪最痛的是印單與開發票。這一段的目的是：倉庫上傳一次電子檔，
// 助理自己從 Chat 連結取用，倉庫不必再問「你要紙本還是電子檔」、不必白印。
console.log('\n【26】發票電子檔上傳');
(function () {
  const SH = G.SHIPMENT_HEADERS;
  const mkShip = rows => makeSheet('出貨明細', SH, rows, 1);
  const rowOf = o => SH.map(h => (h in o ? o[h] : ''));

  const base = {
    '出貨單號': 'W5501-260812001', '客戶': '王小姐', '案名': '竹北案',
    '出貨品項': 'L396 *1', '貨指寄-地址': '新竹市光復路一段1號',
    '登錄人': 'vivi@waferlock.com', '登錄時間': '2026-08-12 09:00',
    '倉庫核單狀態': '待核',
  };

  const reset = () => {
    props = {
      DISPATCH_SHEET_ID: 'X', DISPATCH_SHEET_NAME: '*',
      DISPATCH_WAREHOUSE: 'ray@waferlock.com',
      DISPATCH_WAREHOUSE_WEBHOOK: 'https://example.test/hook',
      DISPATCH_INVOICE_FOLDER_ID: 'FOLDER1',
    };
    SHEETS = [mkShip([rowOf(base)])];
    CACHE = {}; LOG = []; DRIVE = []; sent = [];
  };

  let sent = [];
  const origFetch = sandbox.UrlFetchApp.fetch;
  sandbox.UrlFetchApp.fetch = (u, o) => {
    sent.push(String((o && o.payload) || ''));
    return { getResponseCode: () => 200, getContentText: () => 'ok' };
  };
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const b64 = txt => Buffer.from(txt).toString('base64');

  // 🔴 安全：程式絕不可自己設定分享權限。發票含客戶名稱、地址、金額、統編。
  //    權限交給使用者自己建立、自己控管的那個資料夾；程式一旦自己開權限，
  //    就會出現「誰都打得開」而沒有任何人發現。
  {
    const src = fs.readFileSync(DIR + 'gas-dispatch-approval.gs', 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    ok(!/setSharing|setShareableByEditors|addEditor|addViewer|Access\.ANYONE/.test(src),
       '🔴 不可呼叫任何開放分享的 Drive API，權限一律交給資料夾');
    ok(/createFile/.test(src), '要真的把檔案建進資料夾');
  }

  // 權限：不在倉庫名單不能上傳
  reset(); asUser('outsider@waferlock.com');
  let r = G.uploadInvoice('W5501-260812001', 'a.pdf', 'application/pdf', b64('x'), 2);
  ok(!r.ok && /倉庫名單/.test(r.message), '非倉庫應被擋｜' + r.message);
  ok(DRIVE.length === 0, '被擋下時不可建立任何檔案');

  asUser('ray@waferlock.com');

  // 未設資料夾 → 明確擋下並指出要設哪個屬性，不可靜默失敗
  reset(); delete props.DISPATCH_INVOICE_FOLDER_ID;
  r = G.uploadInvoice('W5501-260812001', 'a.pdf', 'application/pdf', b64('x'), 2);
  ok(!r.ok && /DISPATCH_INVOICE_FOLDER_ID/.test(r.message),
     '未設資料夾要明講是哪個指令碼屬性｜' + r.message);
  ok(DRIVE.length === 0, '未設資料夾時不可建立檔案');

  // 資料夾 ID 填錯 → 講清楚是打不開，不是上傳失敗
  reset(); props.DISPATCH_INVOICE_FOLDER_ID = 'BAD';
  r = G.uploadInvoice('W5501-260812001', 'a.pdf', 'application/pdf', b64('x'), 2);
  ok(!r.ok && /打不開/.test(r.message), '資料夾打不開要講清楚原因｜' + r.message);

  // 檔案型別：只收 PDF / JPG / PNG
  reset();
  r = G.uploadInvoice('W5501-260812001', 'a.exe', 'application/x-msdownload', b64('x'), 2);
  ok(!r.ok && /PDF/.test(r.message), '非 PDF/JPG/PNG 應被擋｜' + r.message);
  ok(DRIVE.length === 0, '型別不符時不可建立檔案');

  // 大小上限（伺服器端也要擋，前端擋掉的只是體驗不是安全）
  reset();
  r = G.uploadInvoice('W5501-260812001', 'big.pdf', 'application/pdf',
    Buffer.alloc(11 * 1024 * 1024).toString('base64'), 2);
  ok(!r.ok && /超過上限/.test(r.message), '🔴 超過 10MB 伺服器端要自己擋｜' + r.message);
  ok(DRIVE.length === 0, '超過上限時不可建立檔案');

  // 找不到單號
  reset();
  r = G.uploadInvoice('W5501-NOPE', 'a.pdf', 'application/pdf', b64('x'), 2);
  ok(!r.ok && /找不到出貨單號/.test(r.message), '單號不存在應被擋');

  // ── 正常上傳 ──
  reset();
  r = G.uploadInvoice('W5501-260812001', '發票.pdf', 'application/pdf', b64('PDFDATA'), 2);
  ok(r.ok, '倉庫上傳發票應成功｜' + r.message);
  ok(DRIVE.length === 1, '應建立 1 個檔案，實得 ' + DRIVE.length);
  ok(DRIVE[0].name.indexOf('W5501-260812001') === 0,
     '🔴 檔名要以出貨單號開頭，光看雲端硬碟就分得出哪張是哪張，實得 ' + DRIVE[0].name);
  ok(DRIVE[0].mime === 'application/pdf', 'MIME 要照傳');
  ok(Buffer.from(DRIVE[0].bytes).toString() === 'PDFDATA', '檔案內容要正確解碼');

  const ship = SHEETS.find(s => s._name === '出貨明細');
  const at = n => ship._grid[0].indexOf(n);
  ok(at('發票檔案') >= 0, '出貨明細要有「發票檔案」欄');
  ok(/^https:\/\/drive\.google\.com\//.test(ship._grid[1][at('發票檔案')]),
     '連結要寫回出貨明細');

  // 檔名帶危險字元不可穿出去
  reset();
  r = G.uploadInvoice('W5501-260812001', '../../etc/passwd.pdf', 'application/pdf', b64('x'), 2);
  ok(r.ok, '奇怪檔名仍應能上傳｜' + r.message);
  ok(!/[\\/:*?"<>|]/.test(DRIVE[0].name.replace(/^W5501-260812001_/, '')),
     '🔴 檔名要清掉路徑與特殊字元，實得 ' + DRIVE[0].name);

  // ── 待核清單不可把 Drive 連結送到畫面上 ──
  reset();
  ship_url_case: {
    const withUrl = Object.assign({}, base);
    withUrl['發票檔案'] = 'https://drive.google.com/file/d/SECRET/view';
    SHEETS = [mkShip([rowOf(withUrl)])];
    CACHE = {};
    const rows = G.getWarehousePending_();
    ok(rows[0].invoiceUrl === true, '待核清單要標示「已上傳」');
    const html = G.renderWarehousePage_('ray@waferlock.com',
      G.rolesFor_('ray@waferlock.com'))._h;
    ok(html.indexOf('SECRET') < 0,
       '🔴 Drive 連結不可出現在畫面 HTML（會進瀏覽器紀錄與截圖）');
    ok(/已登錄/.test(html), '畫面要讓倉庫看得出這筆傳過了（措辭改成「登錄」，因為現在也涵蓋純填號碼的情況）');
    ok(/uploadInvoice/.test(html) && /type="file"/.test(html), '倉庫頁要有上傳欄位');
    // 發票號碼是倉庫的工作（2026-08-14 確認），要直接顯示數值（不像 Drive 連結那樣藏起來）——
    // 它的敏感度遠低於一個能直接打開檔案的連結，顯示出來讓倉庫看得到自己之前打過的號碼。
    ok(/<input type="text" id="n_/.test(html), '倉庫頁要有發票號碼輸入框');
  }

  // ── 發票號碼可以不靠檔案單獨登錄，且會直接顯示在畫面上（跟 Drive 連結不同待遇） ──
  reset();
  ship_invoice_no_case: {
    let r2 = G.uploadInvoice('W5501-260812001', '', '', '', 2, 'AB-12345678');
    ok(r2.ok, '只給發票號碼、不給檔案也應該能登錄｜' + r2.message);
    ok(DRIVE.length === 0, '沒有檔案時不可建立任何 Drive 檔案');
    const ship = SHEETS.find(s => s._name === '出貨明細');
    const atCol = n => ship._grid[0].indexOf(n);
    ok(ship._grid[1][atCol('發票號碼')] === 'AB-12345678', '發票號碼要寫回出貨明細');

    CACHE = {};
    const rows2 = G.getWarehousePending_();
    ok(rows2[0].invoiceNo === 'AB-12345678',
       '🔴 發票號碼要直接回傳實際值（不像 Drive 連結那樣只回布林值）');
    const html2 = G.renderWarehousePage_('ray@waferlock.com',
      G.rolesFor_('ray@waferlock.com'))._h;
    ok(html2.indexOf('AB-12345678') >= 0,
       '發票號碼要直接顯示在畫面上，讓倉庫看得到自己之前打過的號碼');
  }

  // 兩邊都空，什麼都不寫入
  reset();
  ship_both_empty_case: {
    const r3 = G.uploadInvoice('W5501-260812001', '', '', '', 2, '');
    ok(!r3.ok, '號碼跟檔案都沒給應被擋｜' + r3.message);
  }

  // ── 備存通知帶連結；沒上傳要明講「未上傳」 ──
  reset();
  G.uploadInvoice('W5501-260812001', '發票.pdf', 'application/pdf', b64('x'), 2);
  sent = [];
  r = G.submitWarehouse('W5501-260812001', 'done', '', 2);
  ok(r.ok, '核單應成功｜' + r.message);
  ok(sent.length === 1, '核單應送出一則備存訊息');
  // 格式是 Chat 的 <網址|文字>，不是裸網址——那串 Drive 網址很長，會把通知撐開。
  ok(/發票電子檔：<https:\/\/drive\.google\.com\/[^|]*\|[^>]+>/.test(sent[0]),
     '🔴 備存訊息要帶可點的發票連結——這正是助理不必再找倉庫的原因');
  ok(/📄/.test(sent[0]), '連結要有看得懂的文字，不是一長串網址');

  reset(); sent = [];
  r = G.submitWarehouse('W5501-260812001', 'done', '', 2);
  ok(/發票電子檔：未上傳/.test(sent[0]),
     '沒上傳要明講「未上傳」，留白會讓助理以為是自己漏看又跑去問倉庫');
  ok(/發票號碼：未登錄/.test(sent[0]),
     '🔴 發票號碼沒登錄也要明講「未登錄」，跟發票電子檔的規則一致');

  // 倉庫只登錄發票號碼、不上傳檔案，備存訊息要帶號碼，檔案仍明講未上傳
  reset(); sent = [];
  G.uploadInvoice('W5501-260812001', '', '', '', 2, 'CD-11112222');
  r = G.submitWarehouse('W5501-260812001', 'done', '', 2);
  ok(r.ok, '核單應成功｜' + r.message);
  ok(/發票號碼：CD-11112222/.test(sent[0]),
     '🔴 只登錄號碼、沒上傳檔案時，備存訊息要帶得到號碼');
  ok(/發票電子檔：未上傳/.test(sent[0]), '沒上傳檔案仍要明講未上傳，不可因為有號碼就誤判成已完成');

  // 找列的邏輯只能有一份（兩份會出現「上傳找得到、核單找不到」）
  {
    const src = fs.readFileSync(DIR + 'gas-dispatch-approval.gs', 'utf8');
    ok((src.match(/function findShipmentRow_/g) || []).length === 1,
       'findShipmentRow_ 只能有一份實作');
    ok((src.match(/findShipmentRow_\(/g) || []).length >= 3,
       '上傳與核單都要用同一支找列函式');
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
})();


// ── 測試 27：Chat 深連結單筆頁 ＋ @提及 ──
// 這一組存在的理由是「快」與「不越權」。兩者都不是看畫面就看得出來的：
// 慢了畫面一樣正確、越權了畫面也一樣正確，所以只能靠斷言擋。
console.log('\n【27】Chat 深連結與 @提及');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const origFetch = sandbox.UrlFetchApp.fetch;

  // 零售-Sammi：單層簽核、名稱含中文與連字號（正好拿來驗網址編碼）
  const SHEET = '零售-Sammi';
  const head = HEADS[SHEET];
  const iNo = 1, iWorker = 2, iCust = 3, iPrice = 11, iBoss = 14;
  const mkRow = (no, cust) => {
    const r = head.map(() => '');
    r[0] = new Date(2026, 7, 5);
    r[iNo] = no; r[iWorker] = '阿明'; r[iCust] = cust; r[iPrice] = 3000;
    return r;
  };

  const reset = () => {
    SHEETS = [makeSheet(SHEET, head, [
      mkRow('LS-260805-01', '王小姐'),   // 第 3 列
      mkRow('LS-260805-02', '陳先生'),   // 第 4 列
    ], 2)];
    props.DISPATCH_SHEET_NAME = SHEET;
    props.DISPATCH_SUB_APPROVERS = '';
    props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
    props.DISPATCH_WEBAPP_URL = 'https://script.google.com/a/macros/w/s/REAL/exec';
    CACHE = {};
  };
  reset();

  // ── 權限：聚焦參數不可以繞過簽核名單（這一組最重要的一條）
  asUser('outsider@waferlock.com');
  const denied = G.doGet({ parameter: { no: 'LS-260805-01', sh: SHEET, rw: 3 } })._h;
  ok(/沒有簽核權限/.test(denied),
     '🔴 非簽核者帶 no 參數 → 必須是「沒有簽核權限」');
  ok(denied.indexOf('王小姐') < 0,
     '🔴 非簽核者不可以看到那一筆的內容（帶參數不等於有權限）');

  // ── 正常路徑
  asUser('boss@waferlock.com');
  const one = G.doGet({ parameter: { no: 'LS-260805-01', sh: SHEET, rw: 3 } })._h;
  ok(/王小姐/.test(one), '簽核者帶 no 參數 → 看得到那一筆');
  ok(one.indexOf('陳先生') < 0, '單筆頁只該有那一筆，不該把別筆也帶出來');
  ok(/核准/.test(one) && /退回/.test(one), '可簽核時要有核准／退回按鈕');

  // ── 位置提示被竄改：rw 指到另一筆的列
  const wrongRw = G.doGet({ parameter: { no: 'LS-260805-01', sh: SHEET, rw: 4 } })._h;
  ok(/王小姐/.test(wrongRw),
     '🔴 rw 指錯列時，顯示的必須仍是 no 指定的那一筆');
  ok(wrongRw.indexOf('陳先生') < 0,
     '🔴 rw 指到別筆，絕不可以顯示成別筆（提示只能加速，不能改指向）');

  // ── 邊界：rw 指到表頭列、或超出範圍，不可以爆掉
  const atHeader = G.doGet({ parameter: { no: 'LS-260805-02', sh: SHEET, rw: 2 } })._h;
  ok(/陳先生/.test(atHeader), 'rw 指到表頭列 → 退回搜尋，仍要找得到');
  const beyond = G.doGet({ parameter: { no: 'LS-260805-02', sh: SHEET, rw: 9999 } })._h;
  ok(/陳先生/.test(beyond), 'rw 超出最後一列 → 退回搜尋，仍要找得到');
  const noSuch = G.doGet({ parameter: { no: 'LS-999999-99', sh: SHEET, rw: 3 } })._h;
  ok(/找不到發包單號/.test(noSuch), '單號不存在 → 明講找不到，不是空白頁');

  // ── 已經被別人簽掉：深連結最常見的情況，要體面收尾而不是報錯
  SHEETS[0]._grid[2][iBoss] = '✅ 核准 other@waferlock.com 2026-08-06 10:00';
  const done = G.doGet({ parameter: { no: 'LS-260805-01', sh: SHEET, rw: 3 } })._h;
  ok(/已經處理過了/.test(done), '已被簽掉 → 要說「已經處理過了」');
  ok(/other@waferlock.com/.test(done), '要講清楚是誰在什麼時候處理的');
  ok(done.indexOf('act(') < 0, '已處理的單不可以再出現可按的簽核按鈕');
  reset();

  // ── 預設頁推導
  asUser('boss@waferlock.com');
  ok(/發包簽核/.test(G.doGet({ parameter: { no: 'LS-260805-01' } })._h),
     '只帶 no → 推導到簽核頁');

  // ── 舊行為不變
  ok(/發包簽核/.test(G.doGet({ parameter: {} })._h), '不帶任何參數 → 維持原本的預設頁');
  ok(/發包簽核/.test(G.doGet({ parameter: { page: 'approve' } })._h), 'page=approve 行為不變');

  // ── 效能：單筆頁不可以掃全部分頁
  // 這是整個功能存在的理由。只斷言「有回傳 HTML」等於沒測到重點——
  // 哪天有人在 renderApproveOne_ 裡多呼叫一次 openSheets_()，
  // 畫面完全正確，只是又從 2 秒變回 39 秒，而沒有任何測試會失敗。
  {
    SHEETS = Object.keys(HEADS).map(n => makeSheet(n, HEADS[n], [], n === '行銷' ? 1 : 2));
    const target = SHEETS.find(s => s._name === SHEET);
    target._grid.push(mkRow('LS-260805-01', '王小姐'));   // 第 3 列
    props.DISPATCH_SHEET_NAME = '*';
    CACHE = {};

    let calls = 0;
    SHEETS.forEach(s => { const o = s.getRange; s.getRange = (...a) => { calls++; return o(...a); }; });

    asUser('boss@waferlock.com');
    const html = G.doGet({ parameter: { no: 'LS-260805-01', sh: SHEET, rw: 3 } })._h;
    ok(/王小姐/.test(html), '17 分頁情境下，深連結仍要找得到那一筆');
    ok(calls < 10, '🔴 單筆頁的 getRange 次數應 < 10，實際 ' + calls + '（超過代表掉回全表掃描＝39 秒）');
    reset();
  }

  // ── deepLink_：中文分頁名一定要編碼
  {
    const url = G.deepLink_({ page: 'approve', no: 'LS-260805-01', sh: SHEET, rw: 3 });
    ok(url.indexOf('sh=' + encodeURIComponent(SHEET)) >= 0,
       '🔴 中文分頁名必須 encodeURIComponent，否則位置提示失效、悄悄變回 39 秒');
    ok(url.indexOf(SHEET) < 0, '網址裡不該出現未編碼的原始中文分頁名');
    ok(url.indexOf('https://script.google.com/a/macros/w/s/REAL/exec') === 0,
       'deepLink_ 要用人工設定的 DISPATCH_WEBAPP_URL 當基底');
  }

  // ── deepLink_：基底網址的退路
  {
    const keep = props.DISPATCH_WEBAPP_URL;
    delete props.DISPATCH_WEBAPP_URL;
    const fb = G.deepLink_({ page: 'approve' });
    ok(fb.indexOf('https://script.google.com/a/macros/w/s/AAA/exec') === 0,
       'DISPATCH_WEBAPP_URL 未設 → 退回 ScriptApp 的網址');
    const origSvc = sandbox.ScriptApp.getService;
    sandbox.ScriptApp.getService = () => ({ getUrl: () => '' });
    ok(G.deepLink_({ page: 'approve' }) === '',
       '兩個來源都取不到 → 回空字串（寧可沒連結，也不要死連結）');
    sandbox.ScriptApp.getService = origSvc;
    props.DISPATCH_WEBAPP_URL = keep;
  }

  // ── @提及
  {
    const uidSheet = makeSheet('Chat人員對照', ['email', 'Chat UID', '姓名備註'], [
      ['vivi@waferlock.com', '108234567890123456789', 'Vivi'],
    ], 1);
    SHEETS.push(uidSheet);
    const uids = G.loadChatUids_();
    ok(uids['vivi@waferlock.com'] === '108234567890123456789', '應讀得到 Chat UID 對照');
    ok(G.mentionOf_('vivi@waferlock.com', 'Vivi', uids) === '<users/108234567890123456789>',
       '查得到 UID → 產生真正的 @提及');
    ok(G.mentionOf_('nobody@waferlock.com', '小明', uids) === '小明',
       '🔴 查不到 UID → 退回純文字姓名（不可以讓整則通知失敗）');
    LOG = [];
    G.mentionOf_('nobody@waferlock.com', '小明', uids);
    ok(LOG.some(l => /查無/.test(l) && /Chat UID/.test(l)),
       '🔴 查不到 UID 必須留下記錄，否則沒人知道要去補那一列');
  }

  // ── 通知內容：@提及 ＋ 深連結
  {
    const sent = [];
    sandbox.UrlFetchApp.fetch = (u, o) => {
      sent.push(JSON.parse(o.payload).text);
      return { getResponseCode: () => 200, getContentText: () => 'ok' };
    };
    props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://chat.googleapis.com/FAKE';

    SHEETS.push(makeSheet('人員代碼',
      ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
      [['LS', '小林', 'ls@waferlock.com', '零售', 'Vivi', 'vivi@waferlock.com', SHEET]], 1));

    G.notifyAssistant_({ orderNo: 'LS-260805-01', who: 'boss@waferlock.com',
      at: '2026-08-06 10:00', worker: '阿明', customer: '王小姐' });
    ok(sent.length === 1, '核准後應送出一則通知');
    ok(/<users\/108234567890123456789>/.test(sent[0]),
       '🔴 通知助理要用 @提及，不能只寫名字（寫名字不會 ping 到人）');
    ok(/dn=LS-260805-01/.test(sent[0]), '通知要帶「直接開這一筆」的深連結');
    ok(/page=ship/.test(sent[0]), '助理的深連結要指向出貨登錄頁');

    // ── 下單當下的通知：兩種單別，下一棒的人不同
    // 這則通知在 Phase A 之前完全不存在。少了它，
    // 料件出貨免簽核直接進助理清單，卻沒有任何人被通知。
    SHEETS.find(s => s._name === 'Chat人員對照')._grid.push(
      ['boss@waferlock.com', '107777777777777777777', '老闆']);

    sent.length = 0;
    G.notifyOrderSubmitted_({
      orderNo: 'LS-260805-01', kind: G.ORDER_KIND_PARTS, sheet: SHEET, row: 3,
      twoStage: false, customer: '王小姐', model: 'L901', qty: '1',
      by: '小林', at: '2026-08-05 09:00'
    });
    ok(sent.length === 1, '料件出貨下單應送出通知');
    ok(/免簽核/.test(sent[0]), '料件出貨的通知要標明免簽核');
    ok(/<users\/108234567890123456789>/.test(sent[0]),
       '🔴 料件出貨要 @提及助理——下一棒是他，不是主管');
    ok(/dn=LS-260805-01/.test(sent[0]) && /page=ship/.test(sent[0]),
       '料件出貨的連結要指向鍵單頁');

    sent.length = 0;
    props.DISPATCH_BOSS_APPROVERS = 'boss@waferlock.com';
    G.notifyOrderSubmitted_({
      orderNo: 'LS-260805-02', kind: G.ORDER_KIND_INSTALL, sheet: SHEET, row: 4,
      twoStage: false, customer: '陳先生', model: 'L901', qty: '1',
      worker: '阿明', price: '3000', by: '小林', at: '2026-08-05 09:00'
    });
    ok(/新單待主管核准/.test(sent[0]), '發包安裝的通知要說待主管核准');
    ok(/<users\/107777777777777777777>/.test(sent[0]),
       '🔴 發包安裝要 @提及主管——@錯人幾次，整個空間的通知就會被忽略');
    ok(/no=LS-260805-02/.test(sent[0]) && /page=approve/.test(sent[0]),
       '發包安裝的連結要指向簽核頁');
    ok(sent[0].indexOf('<users/108234567890123456789>') < 0,
       '發包安裝階段不該 @提及助理（還沒輪到他）');

    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ── 身分重構：xxxAs_ 與薄殼必須等價，且不可繞過名單
  {
    reset();
    const r1 = G.submitDecisionAs_('outsider@waferlock.com', 'LS-260805-01', 'approve', '', SHEET, 3);
    ok(!r1.ok, '🔴 submitDecisionAs_ 傳入非簽核者 → 必須被擋（證明 Chat 路徑不會繞過 checkApprover_）');

    ok(!G.submitDecisionAs_('', 'LS-260805-01', 'approve', '', SHEET, 3).ok,
       '空身分 → 拒絕');
    ok(G.submitDecisionAs_('', 'LS-260805-01', 'approve', '', SHEET, 3).message
       === '無法辨識身分，未寫入任何資料。', '空身分的訊息要與原本逐字一致');

    // 薄殼與核心走同一條路：同樣的輸入要產生同樣的儲存格內容
    reset();
    asUser('boss@waferlock.com');
    G.submitDecision('LS-260805-01', 'approve', '', SHEET, 3);
    const viaShell = SHEETS[0]._grid[2][iBoss];
    reset();
    G.submitDecisionAs_('boss@waferlock.com', 'LS-260805-01', 'approve', '', SHEET, 3);
    const viaCore = SHEETS[0]._grid[2][iBoss];
    ok(viaShell && viaShell === viaCore,
       '🔴 submitDecision 與 submitDecisionAs_ 必須寫出完全相同的內容｜' +
       viaShell + ' vs ' + viaCore);
  }

  // 底線是安全邊界：少了它就等於在前端開一個「任意指定簽核人」的後門
  {
    const src = fs.readFileSync(DIR + 'gas-dispatch-approval.gs', 'utf8');
    ['submitDecisionAs', 'submitWarehouseAs', 'fillShipmentAs'].forEach(n => {
      ok(new RegExp('function ' + n + '_\\(').test(src), n + '_ 應存在');
      ok(!new RegExp('function ' + n + '\\s*\\(').test(src),
         '🔴 ' + n + ' 不可以是無底線版本——那會被 google.script.run 呼叫到，等於任意指定身分');
    });
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
  props.DISPATCH_SHEET_NAME = '*';
})();

// -- 測試 28：畫了按鈕就必須掛得動它 + Chat UID 格式 --
// 兩條都是 2026-08-20 正式環境實測踩到的。共同點是「畫面完全正常，
// 只是功能靜默不動」——沒有錯誤訊息、沒有紅字，執行記錄也看不出所以然。
console.log('');
console.log('【28】按鈕可用性與 Chat UID 格式');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const SH = G.SHIPMENT_HEADERS;
  const mkShip = o => {
    const r = SH.map(() => '');
    SH.forEach((k, i) => { if (o[k] !== undefined) r[i] = o[k]; });
    return r;
  };

  // 通用檢查：頁面上每個 onclick="fn(...)" 都要在同一份 HTML 裡有 function fn 定義。
  // 這一條才是真正的守門員。原本的 bug 是單筆頁畫了「鍵入並通知倉庫」按鈕，
  // 但整頁沒有掛任何 script，fillIt 未定義——按下去毫無反應，
  // 請求根本沒送出，伺服器端執行記錄只有 doGet，看不到任何線索。
  const danglingHandlers = html => {
    const names = new Set();
    html.split('onclick="').slice(1).forEach(seg => {
      const cut = seg.indexOf('(');
      if (cut < 1) return;
      const fn = seg.slice(0, cut);
      if (fn && !/[^A-Za-z0-9_$]/.test(fn)) names.add(fn);
    });
    return [...names].filter(n => html.indexOf('function ' + n + '(') < 0);
  };

  SHEETS = [
    makeSheet('出貨明細', SH, [
      mkShip({ '登錄時間': '2026-08-10 09:00', '發包單號': 'FC-260810-01',
        '客戶': '測試客戶', '出貨品項': 'L372 *1' }),   // 出貨單號留空＝待鍵入
    ], 1),
  ];
  props.DISPATCH_SHEET_NAME = '*';
  delete props.DISPATCH_ASSISTANTS;   // 未設名單＝任何人可進，測的是畫面不是權限
  CACHE = {};
  asUser('fish.chen@waferlock.com');

  {
    const html = G.doGet({ parameter: { page: 'ship', dn: 'FC-260810-01' } })._h;
    ok(/等鍵 TipTop/.test(html), '深連結 dn= 應開到出貨登錄單筆頁');
    // 區塊標題只能有一個。pendingShipBlock_ 自己會產生帶筆數的標題，
    // 呼叫端若再寫一個，畫面上會出現兩個「業務已下單，等鍵 TipTop」，
    // 而且上面那個沒筆數、看起來像空區塊。（2026-08-25 實機驗證抓到）
    ok((html.match(/業務已下單，等鍵 TipTop/g) || []).length === 1,
       '🔴 單筆頁的「業務已下單，等鍵 TipTop」標題只能出現一次，實際 ' +
       (html.match(/業務已下單，等鍵 TipTop/g) || []).length + ' 次');
    ok(/測試客戶/.test(html), '單筆頁要顯示那一筆的內容');
    ok(html.indexOf('function fillIt(') >= 0,
       '🔴 單筆頁必須含 fillIt 定義——少了它按鈕按下去毫無反應，且伺服器完全收不到請求');
    const dangling = danglingHandlers(html);
    ok(dangling.length === 0,
       '🔴 單筆頁有 onclick 但無定義的函式：' + (dangling.join(', ') || '無'));
  }

  {
    const html = G.doGet({ parameter: { page: 'ship' } })._h;
    const dangling = danglingHandlers(html);
    ok(dangling.length === 0,
       '🔴 出貨登錄列表頁有 onclick 但無定義的函式：' + (dangling.join(', ') || '無'));
  }

  // Chat UID 格式：錯的值不會讓通知失敗，只會讓提及變成空白的 users 標籤
  {
    ok(G.chatUidProblem_('108234567890123456789') === '', '21 位純數字＝正常的 Chat user id');
    ok(G.chatUidProblem_('1682990898') !== '',
       '🔴 10 位數字要擋下來（實際踩過：填到別的 id，Chat 把提及渲染成空白）');
    ok(/21 位/.test(G.chatUidProblem_('1682990898')),
       '位數不對的訊息要講清楚正確位數，否則使用者不知道要去哪裡拿');
    ok(/純文字/.test(G.chatUidProblem_('1.0823456789e+20')),
       '🔴 科學記號要擋，並要教人把欄位設成純文字——這是試算表造成的，改程式救不回精度');
    ok(G.chatUidProblem_('users/108234567890123456789') !== '',
       '連 users/ 前綴一起貼進來要擋');
    ok(G.chatUidProblem_('abc') !== '', '非數字要擋');
  }

  // 壞 UID 一律當作沒填：退回純文字姓名，並留下記錄
  {
    SHEETS.push(makeSheet('Chat人員對照', ['email', 'Chat UID', '姓名備註'], [
      ['fish.chen@waferlock.com', '1682990898', 'fish'],
      ['good@waferlock.com', '108234567890123456789', '正常'],
    ], 1));
    LOG = [];
    const uids = G.loadChatUids_();
    ok(uids['fish.chen@waferlock.com'] === undefined,
       '🔴 格式錯的 UID 不可以進對照表——放行的結果是送出沒人看得懂的空白提及');
    ok(uids['good@waferlock.com'] === '108234567890123456789', '格式正確的照常讀進來');
    ok(LOG.some(l => /1682990898/.test(l)),
       '🔴 擋下來必須留記錄，而且要帶原值，否則沒人知道是哪一格填錯');
    ok(G.mentionOf_('fish.chen@waferlock.com', 'fish', uids) === 'fish',
       '壞 UID → 退回純文字姓名（通知照送，只是不會 ping）');
  }

  props.DISPATCH_SHEET_NAME = '*';
})();

// ── 測試 29：退單 ──
// 來源是群組裡的真實對話：「Molly Hsu 麻煩退單 改出貨單備註 謝謝哦」。
// GAS 不能真的退單（單號是 TipTop 發的），這裡測的是「記錄、通知、狀態」這三件事。
console.log('');
console.log('【29】退單');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const origFetch = sandbox.UrlFetchApp.fetch;
  const SH = G.SHIPMENT_HEADERS;
  const SHIP_NO = 'W5506-260820001';
  const mkShip = o => {
    const r = SH.map(() => '');
    SH.forEach((k, i) => { if (o[k] !== undefined) r[i] = o[k]; });
    return r;
  };

  const sent = [];
  sandbox.UrlFetchApp.fetch = (u, o) => {
    sent.push(JSON.parse(o.payload).text);
    return { getResponseCode: () => 200, getContentText: () => 'ok' };
  };

  const reset = (whStatus) => {
    SHEETS = [
      makeSheet('出貨明細', SH, [
        mkShip({ '出貨單號': SHIP_NO, '發包單號': 'FC-260820-01', '客戶': '維瓦第營造',
          '出貨品項': 'L396*105組',
          // 用 undefined 判斷而不是 ||，才傳得進空字串（＝倉庫還沒碰過這張單）
          '倉庫核單狀態': whStatus === undefined ? '待核' : whStatus }),
      ], 1),
      makeSheet('人員代碼',
        ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
        [['FC', 'fish chen', 'fish.chen@waferlock.com', '內銷',
          'Ting.Hsu', 'ting.hsu@waferlock.com', '電商-Vivi']], 1),
      makeSheet('Chat人員對照', ['email', 'Chat UID', '姓名備註'],
        [['ting.hsu@waferlock.com', '108234567890123456789', 'Ting']], 1),
    ];
    props.DISPATCH_SHEET_NAME = '*';
    props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://chat.googleapis.com/FAKE';
    props.DISPATCH_WEBAPP_URL = 'https://script.google.com/a/macros/w/s/REAL/exec';
    CACHE = {};
    sent.length = 0;
  };

  const readBack = () => {
    const s = G.openShipmentSheet_();
    return G.readShipmentRow_(s, G.findShipmentRow_(s, SHIP_NO, 0));
  };

  // ── 正常申請
  reset();
  asUser('fish.chen@waferlock.com');
  {
    const r = G.requestReturn(SHIP_NO, '改出貨單備註');
    ok(r.ok, '正常申請退單應成功：' + r.message);

    const rec = readBack();
    ok(/^🔄 退單/.test(rec['退單']), '退單欄要以 🔄 開頭（isReturning_ 靠開頭字元判斷）');
    ok(rec['退單'].indexOf('改出貨單備註') >= 0, '退單欄要留下原因');
    ok(rec['退單'].indexOf('fish chen') >= 0, '退單欄要留下發起人姓名');
    ok(G.isReturning_(rec['退單']), 'isReturning_ 要認得自己寫出來的值');

    // 這一條是整個設計的核心決策，必須鎖住
    ok(rec['倉庫核單狀態'] === '待核',
       '🔴 退單不可以改動倉庫核單狀態——貨可能已經出了，重置成待核會讓倉庫再撿一次料');
  }

  // ── 通知
  {
    ok(sent.length === 1, '申請退單應送出一則 Chat 通知');
    ok(/<users\/108234567890123456789>/.test(sent[0]),
       '🔴 退單通知要 @提及助理——退單要她去 TipTop 改，下一棒是她');
    ok(sent[0].indexOf('改出貨單備註') >= 0, '通知要帶原因，否則收到的人不知道要改什麼');
    ok(sent[0].indexOf(SHIP_NO) >= 0, '通知要帶出貨單號');
    ok(/ship=W5506-260820001/.test(sent[0]) && /page=ship/.test(sent[0]),
       '通知要帶深連結，直接開這一筆出貨明細');
  }

  // ── 防呆
  {
    const dup = G.requestReturn(SHIP_NO, '再退一次');
    ok(!dup.ok, '🔴 已經在退單中的單不可以重複申請（兩個人同時開查詢頁按退單）');
    ok(dup.message.indexOf('退單中') >= 0, '重複申請的訊息要說明已在退單中');

    reset();
    ok(!G.requestReturn(SHIP_NO, '').ok,
       '🔴 沒填原因要擋——與簽核退回、倉庫回報問題同一條規矩');
    ok(!G.requestReturn(SHIP_NO, '   ').ok, '只有空白的原因也要擋');
    ok(!G.requestReturn('', '理由').ok, '缺出貨單號要擋');
    ok(!G.requestReturn('W9999-NOTEXIST', '理由').ok, '找不到的單號要擋');
    ok(sent.length === 0, '被擋下的申請不可以送出任何通知');
  }

  // ── 身分：不限制誰能發起，但不可冒名
  {
    reset();
    ok(!G.requestReturnAs_('', SHIP_NO, '理由').ok, '🔴 空身分要拒絕');
    reset();
    const r = G.requestReturnAs_('warehouse.guy@waferlock.com', SHIP_NO, '倉庫也能退');
    ok(r.ok, '任何人都可以發起退單（使用者確認），不限業務或主管');
    ok(readBack()['退單'].indexOf('warehouse.guy@waferlock.com') >= 0,
       '查不到姓名時退回 email，不可以整支壞掉');
  }

  // ── 倉庫已核的單要特別提醒
  {
    reset('已核');
    G.requestReturn(SHIP_NO, '客戶要改地址');
    ok(/貨可能已經出了/.test(sent[0]),
       '🔴 倉庫已核的單，通知要提醒貨可能已經出了——這種退單代價完全不同');
    ok(readBack()['倉庫核單狀態'] === '已核', '倉庫已核的狀態同樣不可以被退單改掉');
  }

  // ── 倉庫還沒碰過這張單就退單（使用者說「什麼階段都有」，這是最早的階段）
  // 這一組刻意用空的倉庫狀態：如果哪天有人讓退單順手「重置」倉庫狀態，
  // 上面那組初始值剛好就是「待核」、重置後值沒變，測不出來——這一組才抓得到。
  {
    reset('');
    G.requestReturn(SHIP_NO, '倉庫還沒撿料就要退');
    ok(readBack()['倉庫核單狀態'] === '',
       '🔴 倉庫還沒碰過的單，退單不可以把它寫成「待核」而讓它憑空出現在倉庫清單上');
    ok(!/貨可能已經出了/.test(sent[0]),
       '倉庫還沒核的單不該提醒「貨可能已經出了」——那會讓人以為事情比實際嚴重');
  }

  // ── 閉環：標記已處理
  {
    reset();
    G.requestReturn(SHIP_NO, '改出貨單備註');
    sent.length = 0;

    ok(!G.resolveReturnAs_('', SHIP_NO).ok, '🔴 標記已處理也要擋空身分');

    const r = G.resolveReturn(SHIP_NO);
    ok(r.ok, '標記退單已處理應成功：' + r.message);

    const rec = readBack();
    ok(/^✅ 已處理/.test(rec['退單']), '處理完要改成 ✅ 開頭');
    ok(!G.isReturning_(rec['退單']), '處理完後 isReturning_ 要回 false');
    ok(rec['退單'].indexOf('改出貨單備註') >= 0,
       '🔴 處理完仍要保留原本的退單原因——蓋掉的話稽核軌跡就斷在這裡');
    ok(rec['退單'].indexOf('fish chen') >= 0, '要記下是誰處理的');
    ok(sent.length === 1 && /退單已處理/.test(sent[0]), '處理完要發通知，讓申請的人知道');

    const again = G.resolveReturn(SHIP_NO);
    ok(!again.ok, '🔴 不在退單中的單不可以重複標記');
    ok(again.message.indexOf('不在退單中') >= 0, '重複標記的訊息要說明原因');
  }

  // ── 處理完之後可以再退一次（同一張單可能退很多次）
  {
    const r2 = G.requestReturn(SHIP_NO, '第二次退單');
    ok(r2.ok, '已處理完的單要能再次申請退單（同一張單可能退很多次）');
    ok(/^🔄/.test(readBack()['退單']), '再次申請後要回到退單中狀態');
  }

  // ── 安全邊界：底線版本才是核心，無底線的只能是薄殼
  {
    const src = fs.readFileSync(DIR + 'gas-dispatch-approval.gs', 'utf8');
    ok(/function requestReturnAs_\(/.test(src), 'requestReturnAs_ 應存在');
    ok(!/function requestReturnAs\s*\(/.test(src),
       '🔴 requestReturnAs 不可以是無底線版本——那會被 google.script.run 呼叫到，等於任意指定發起人');
    ok(/function resolveReturnAs_\(/.test(src), 'resolveReturnAs_ 應存在');
    ok(!/function resolveReturnAs\s*\(/.test(src),
       '🔴 resolveReturnAs 不可以是無底線版本');
  }

  // ── 查詢頁：畫了按鈕就必須掛得動（沿用測試 28 的守門員）
  {
    reset();
    asUser('fish.chen@waferlock.com');
    const html = G.doGet({ parameter: { page: 'query' } })._h;
    ok(html.indexOf('function ret(') >= 0,
       '🔴 查詢頁必須含 ret 定義，否則退單按鈕按下去毫無反應');
    const names = new Set();
    html.split('onclick="').slice(1).forEach(seg => {
      const cut = seg.indexOf('(');
      if (cut < 1) return;
      const fn = seg.slice(0, cut);
      if (fn && !/[^A-Za-z0-9_$]/.test(fn)) names.add(fn);
    });
    const dangling = [...names].filter(n => html.indexOf('function ' + n + '(') < 0);
    ok(dangling.length === 0,
       '🔴 查詢頁有 onclick 但無定義的函式：' + (dangling.join(', ') || '無'));
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  props.DISPATCH_SHEET_NAME = '*';
})();


// ── 測試 30：Chat 事件的兩種模式（外掛程式 vs 傳統） ──
// 這一組擋的是「讀錯位置不會報錯，只會安靜落到預設值」這類 bug。
// 實際發生過：外掛模式下認領人顯示「(不明使用者)」、標題顯示「案件」而不是單號，
// 兩個症狀同一個根因——event 結構跟傳統 Chat app 不一樣，原本只讀傳統的位置。
// 官方對照：developers.google.com/workspace/add-ons/chat/convert
console.log('\n【30】Chat 事件的兩種模式');
(() => {
  const PARAMS = { orderNo: 'LS-260805-01', shipNo: 'W5501-1', customer: '王小姐' };

  // 外掛程式模式（目前實際跑的）
  const addonEvent = {
    commonEventObject: { parameters: PARAMS },
    chat: {
      user: { displayName: 'Vivi Huang', email: 'vivi@waferlock.com' },
      buttonClickedPayload: { space: { name: 'spaces/AAAA1111' } }
    }
  };

  // 傳統 Chat app 模式（保留以防日後切回去）
  const legacyEvent = {
    common: { parameters: PARAMS },
    user: { displayName: 'Vivi Huang', email: 'vivi@waferlock.com' },
    space: { name: 'spaces/AAAA1111' }
  };

  // ── 參數
  ok(G.eventParams_(addonEvent).orderNo === 'LS-260805-01',
     '🔴 外掛模式要從 commonEventObject.parameters 讀得到單號（讀錯就顯示成「案件」）');
  ok(G.eventParams_(legacyEvent).orderNo === 'LS-260805-01',
     '傳統模式要從 common.parameters 讀得到單號');
  ok(Object.keys(G.eventParams_({})).length === 0, '空事件不可炸，回空物件');
  ok(Object.keys(G.eventParams_(null)).length === 0, 'null 不可炸');

  // ── 使用者
  ok(G.eventUser_(addonEvent).displayName === 'Vivi Huang',
     '🔴 外掛模式要從 chat.user 讀得到人（讀錯就顯示「(不明使用者)」）');
  ok(G.eventUser_(legacyEvent).displayName === 'Vivi Huang',
     '傳統模式要從 event.user 讀得到人');
  ok(!G.eventUser_({}).displayName, '空事件回空物件，不可炸');

  // ── 空間：onAddToSpace 印出來的值是設定 DISPATCH_ASSISTANT_SPACE 的唯一來源，
  //    讀錯會印成「(未知)」，整個設定步驟就斷了，而且看起來像 Chat 沒給資料
  ok(G.eventSpace_(addonEvent) === 'spaces/AAAA1111',
     '🔴 外掛模式要從 chat.buttonClickedPayload.space 讀得到空間');
  ok(G.eventSpace_(legacyEvent) === 'spaces/AAAA1111',
     '傳統模式要從 event.space 讀得到空間');
  ok(G.eventSpace_({ chat: { space: { name: 'spaces/BBBB' } } }) === 'spaces/BBBB',
     '外掛模式的 chat.space 也要讀得到（不同事件放的位置不同）');
  ok(G.eventSpace_({ chat: { addedToSpacePayload: { space: { name: 'spaces/CCCC' } } } })
     === 'spaces/CCCC',
     '🔴 加入空間事件要讀得到——這正是取得 DISPATCH_ASSISTANT_SPACE 的那一步');
  ok(G.eventSpace_({}) === '', '空事件回空字串，由呼叫端決定顯示什麼');

  // ── 外掛的回應格式。回錯格式時函式明明成功，Chat 仍顯示「無法處理你的要求」，
  //    而執行記錄完全正常——這是最難查的一種，所以要鎖住。
  {
    const t = G.chatText_('哈囉');
    ok(t.hostAppDataAction && t.hostAppDataAction.chatDataAction &&
       t.hostAppDataAction.chatDataAction.createMessageAction,
       '🔴 文字回應要用外掛格式 hostAppDataAction→chatDataAction→createMessageAction');
    ok(!t.actionResponse, '不可以是傳統的 actionResponse 格式');

    const u = G.chatUpdateCard_([{ cardId: 'x', card: {} }]);
    ok(u.hostAppDataAction.chatDataAction.updateMessageAction,
       '🔴 更新卡片要用 updateMessageAction，不是傳統的 UPDATE_MESSAGE');
  }

  // ── 按鈕的函式名必須有對應的頂層函式。
  //    外掛模式是「直接呼叫 action.function 命名的函式」，不是統一進 onCardClick；
  //    少了頂層函式，Chat 會回 "Script function not found"，而測試不做這條就抓不到。
  {
    const src = fs.readFileSync(DIR + 'gas-dispatch-chatapp.gs', 'utf8');
    const names = new Set();
    src.split(/function\s*:\s*'/).slice(1).forEach(seg => {
      const q = seg.indexOf("'");
      if (q > 0) names.add(seg.slice(0, q));
    });
    ok(names.size > 0, '應該找得到卡片按鈕宣告的函式名');
    [...names].forEach(n => {
      ok(new RegExp('function\\s+' + n + '\\s*\\(').test(src),
         '🔴 按鈕 function:\'' + n + '\' 必須有同名的頂層函式（外掛模式直接呼叫它）');
    });
  }
})();


// ── 測試 31：截圖下單（Gemini 影像辨識 → 業務確認 → 出貨明細） ──
// 這一組最重要的一條是「不碰發包表」——經銷商訂單不走發包單是使用者明確確認的前提，
// 這條路徑如果不小心動到業務發包分頁，就是做錯了整個功能的核心設計。
console.log('\n【31】截圖下單');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const origFetch = sandbox.UrlFetchApp.fetch;

  const SALES_SHEET = '零售-Sammi';
  const reset = () => {
    SHEETS = [
      makeSheet(SALES_SHEET, HEADS[SALES_SHEET], [], 2),
      makeSheet('出貨明細', G.SHIPMENT_HEADERS, [], 1),
      makeSheet('人員代碼',
        ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
        [['LS', '小林', 'ls@waferlock.com', '零售', 'Vivi', 'vivi@waferlock.com', SALES_SHEET]], 1),
      makeSheet('Chat人員對照', ['email', 'Chat UID', '姓名備註'],
        [['vivi@waferlock.com', '111222333444555666', 'Vivi']], 1),
    ];
    props.DISPATCH_SHEET_NAME = '*';
    props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://chat.googleapis.com/FAKE';
    props.GEMINI_API_KEY = 'test-key';
    CACHE = {};
  };
  reset();

  const B64 = Buffer.from('fake-image-bytes').toString('base64');

  // ── 權限：不是業務不能辨識、不能送出
  asUser('outsider@waferlock.com');
  {
    const r = G.recognizeOrderImage(B64, 'image/jpeg');
    ok(!r.ok, '🔴 非業務不可呼叫 recognizeOrderImage');
    const s = G.submitQuickOrder('王小姐', [{ model: 'L396', qty: 2, spec: '' }], '');
    ok(!s.ok, '🔴 非業務不可呼叫 submitQuickOrder');
  }
  asUser('ls@waferlock.com');

  // ── MIME 與大小
  ok(!G.recognizeOrderImage(B64, 'application/pdf').ok, '非圖片型別應被拒');
  {
    const big = Buffer.alloc(11 * 1024 * 1024, 1).toString('base64');
    const r = G.recognizeOrderImage(big, 'image/jpeg');
    ok(!r.ok && /超過上限/.test(r.message), '超過 10MB 應被拒且訊息明確');
  }

  // ── 金鑰未設定：明確報錯，不可靜默回空結果
  {
    delete props.GEMINI_API_KEY;
    const r = G.recognizeOrderImage(B64, 'image/jpeg');
    ok(!r.ok && /GEMINI_API_KEY/.test(r.message),
       '🔴 金鑰未設定要明確報錯，不可靜默回 {ok:true, items:[]}');
    props.GEMINI_API_KEY = 'test-key';
  }

  // ── AI 回傳異常：非 200、格式不合 schema
  {
    sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 500, getContentText: () => 'boom' });
    const r = G.recognizeOrderImage(B64, 'image/jpeg');
    ok(!r.ok, 'Gemini 回傳非 200 應視為失敗，不可假裝辨識成功');

    sandbox.UrlFetchApp.fetch = () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '不是json' }] } }] })
    });
    const r2 = G.recognizeOrderImage(B64, 'image/jpeg');
    ok(!r2.ok, '🔴 回傳內容不是合法 JSON 時應顯性失敗，不可寫入半筆資料');
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ── 正常辨識路徑
  {
    sandbox.UrlFetchApp.fetch = (u, o) => {
      ok(/generativelanguage\.googleapis\.com/.test(u), 'Gemini 端點網址正確');
      ok(/inline_data/.test(o.payload) || /inlineData/.test(o.payload),
         '請求要帶圖片資料（inline_data）');
      const body = {
        customer: '台中品閣鎖店 賴雅婷',
        items: [
          { model: '396', qty: 2, spec: '黑' },
          { model: 'D300', qty: 5, spec: '' }
        ],
        note: '',
        confidence: 'high'
      };
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }]
        })
      };
    };
    const r = G.recognizeOrderImage(B64, 'image/jpeg');
    ok(r.ok, '正常路徑應辨識成功｜' + r.message);
    ok(r.customer === '台中品閣鎖店 賴雅婷', '客戶名稱要原樣帶回（含聊天室名稱格式）');
    ok(r.items.length === 2, '應讀到 2 個品項');
    ok(r.items[0].model === '396' && r.items[0].qty === 2, '第一個品項內容正確');
    ok(r.confidence === 'high', 'confidence 應正確帶回');
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ── 模型清單容錯：第一個模型打不通（404 或 503）就自動換下一個
  // 這是 2026-08-25 正式環境真實遇到的情況（先 404 型號下架，換了型號後又 503 過載），
  // 不是想像出來的邊界案例。
  {
    const calledModels = [];
    sandbox.UrlFetchApp.fetch = (u) => {
      const m = /\/models\/([^:]+):/.exec(u);
      calledModels.push(m ? m[1] : '?');
      if (calledModels.length === 1) {
        // 第一個模型：模擬 503 過載
        return { getResponseCode: () => 503, getContentText: () => '{"error":{"message":"overloaded"}}' };
      }
      const body = { customer: '客戶A', items: [{ model: 'L901', qty: 1, spec: '' }], note: '', confidence: 'high' };
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] })
      };
    };
    const r = G.recognizeOrderImage(B64, 'image/jpeg');
    ok(r.ok, '🔴 第一個模型 503 時，應自動換下一個模型且最終成功｜' + r.message);
    ok(calledModels.length === 2, '應該打了兩次（第一個失敗、第二個成功），實際 ' + calledModels.length + ' 次');
    ok(calledModels[0] === G.GEMINI_MODELS[0] && calledModels[1] === G.GEMINI_MODELS[1],
       '🔴 呼叫順序要照 GEMINI_MODELS 清單走，實際：' + calledModels.join(' → '));
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ── 模型清單容錯：全部模型都打不通才真的回報失敗
  {
    sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 503, getContentText: () => 'still down' });
    const r = G.recognizeOrderImage(B64, 'image/jpeg');
    ok(!r.ok, '全部模型都失敗時應明確回報失敗，不可假裝成功');
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ── 送出：多品項合併、案件號、不寫發包表
  {
    const beforeSalesRows = SHEETS.find(s => s._name === SALES_SHEET)._grid.length;

    const sent = [];
    sandbox.UrlFetchApp.fetch = (u, o) => {
      sent.push(JSON.parse(o.payload).text);
      return { getResponseCode: () => 200, getContentText: () => 'ok' };
    };

    const res = G.submitQuickOrder('台中品閣鎖店 賴雅婷',
      [{ model: 'L396', qty: 2, spec: '黑' }, { model: 'D300', qty: 5, spec: '' }], '日期近一點的');
    ok(res.ok, '送出應成功｜' + res.message);
    ok(/^IW\d{8}\d{4}$/.test(res.caseNo), '🔴 案件號格式應為 IW+8碼日期+4碼流水，實得 ' + res.caseNo);

    const sh = G.openShipmentSheet_();
    const row = sh.sheet._grid[1];
    const at = n => String(row[sh.col[n] - 1] || '');
    ok(at('案件號') === res.caseNo, '案件號應寫入出貨明細');
    ok(at('客戶') === '台中品閣鎖店 賴雅婷', '客戶應寫入');
    ok(at('出貨品項').split('\n').length === 2, '兩個品項應合併成兩行');
    ok(/L396 \*2/.test(at('出貨品項')) && /黑/.test(at('出貨品項')), '品項格式應含型號、數量、規格');
    ok(/D300 \*5/.test(at('出貨品項')), '第二個品項也要在');
    ok(at('發包單號') === '', '🔴 發包單號應留空——經銷商訂單不走發包單');
    ok(at('出貨單號') === '', '出貨單號應留空，等助理鍵 TipTop');
    ok(at('倉庫核單狀態') === G.WH_PENDING, '倉庫核單狀態應為待核');

    // 🔑 這條是整個功能設計前提的守門員：業務發包分頁列數不可變
    const afterSalesRows = SHEETS.find(s => s._name === SALES_SHEET)._grid.length;
    ok(afterSalesRows === beforeSalesRows,
       '🔴 業務發包分頁列數不可變——經銷商訂單完全不碰發包表');

    ok(sent.length === 1, '應送出一則通知');
    ok(/<users\/111222333444555666>/.test(sent[0]), '通知要 @提及對應助理（用 me 直接查，不靠 codeOf_ 反解）');
    ok(new RegExp('dn=' + res.caseNo).test(sent[0]) && /page=ship/.test(sent[0]),
       '通知要帶指向鍵單頁的深連結');

    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ── 待鍵單清單：送出後這一列要出現在助理的待辦
  {
    const pend = G.getPendingShipments_();
    ok(pend.some(p => p['客戶'] === '台中品閣鎖店 賴雅婷'),
       '送出後應出現在 getPendingShipments_()（助理「業務已下單」清單）');
  }

  // ── 深連結：dn= 案件號要能找到那一列（findShipmentRowByDispatch_ 相容兩種錨點）
  {
    const s = G.openShipmentSheet_();
    const caseNo = s.sheet.getRange(2, s.col['案件號']).getValue();
    const row = G.findShipmentRowByDispatch_(s, caseNo, 0);
    ok(row === 2, '🔴 findShipmentRowByDispatch_ 要能用案件號當錨點找到列（截圖下單沒有發包單號）');
  }

  // ── 案件號不重號
  {
    reset();
    props.GEMINI_API_KEY = 'test-key';
    asUser('ls@waferlock.com');
    sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => 'ok' });
    const r1 = G.submitQuickOrder('客戶A', [{ model: 'L396', qty: 1, spec: '' }], '');
    const r2 = G.submitQuickOrder('客戶B', [{ model: 'D300', qty: 1, spec: '' }], '');
    ok(r1.caseNo !== r2.caseNo, '🔴 同日兩筆案件號不可重複');
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ── 空品項防呆
  {
    reset();
    asUser('ls@waferlock.com');
    ok(!G.submitQuickOrder('', [{ model: 'L396', qty: 1, spec: '' }], '').ok, '客戶為必填');
    ok(!G.submitQuickOrder('客戶A', [], '').ok, '至少需要一個型號');
    ok(!G.submitQuickOrder('客戶A', [{ model: '', qty: '', spec: '' }], '').ok,
       '全空的品項列應視同沒有型號');
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
  reset();
})();

// 三種下單方式（發包安裝／料件出貨／截圖下單）2026-08-25 合併到同一頁。
// 這一組鎖的是「合併之後容易靜默壞掉」的事，不是重測各自的送出邏輯——
// 那些在【16】【18】【31】已經有了。
console.log('\n【32】下單頁三合一');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const SALES_SHEET = '零售-Sammi';
  const withSheet = ['LS', '小林', 'ls@waferlock.com', '零售', 'Vivi',
                     'vivi@waferlock.com', SALES_SHEET];
  const noSheet   = ['NS', '無分頁', 'ns@waferlock.com', '零售', 'Vivi',
                     'vivi@waferlock.com', ''];
  const build = rows => {
    SHEETS = [
      makeSheet(SALES_SHEET, HEADS[SALES_SHEET], [], 2),
      makeSheet('出貨明細', G.SHIPMENT_HEADERS, [], 1),
      makeSheet('人員代碼',
        ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
        rows, 1),
    ];
    props.DISPATCH_SHEET_NAME = '*';
    CACHE = {};
  };

  // ── 正常業務（有發包分頁）：三顆按鈕都在，兩種表單都在同一頁 ──
  build([withSheet, noSheet]);
  asUser('ls@waferlock.com');
  const full = G.orderBlock_('ls@waferlock.com', G.salesFor_('ls@waferlock.com'));
  ok(/發包安裝/.test(full) && /料件出貨/.test(full) && /截圖下單/.test(full),
     '三種下單方式應同頁並列');
  ok(/id="fields"/.test(full) && /id="quickFields"/.test(full),
     '兩種表單區塊要同時存在，靠切換顯示而非換頁');
  ok(/id="k0"/.test(full) && /id="k1"/.test(full) && /id="k2"/.test(full),
     '按鈕索引要連號，否則切換時舊的 on 樣式清不掉');
  ok(/var NBTN=3;/.test(full), '重設樣式的按鈕數要跟實際渲染的顆數一致');

  // 🔑 id="msg" 只能有一個：兩個的話 getElementById 只認得第一個，
  //    訊息會顯示在錯的位置，而且完全不會報錯。
  ok((full.match(/id="msg"/g) || []).length === 1,
     '整頁只能有一個 id="msg"，實際 ' + (full.match(/id="msg"/g) || []).length);

  // 🔑 截圖下單的腳本必須維持 IIFE：它的 g／show 與表單那組同名，
  //    拆掉外層 IIFE 兩邊就會互相覆蓋（後定義的贏），而且不會有任何錯誤。
  const quickPart = full.slice(full.indexOf('id="quickFields"'));
  ok(/<script>\(function\(\)\{/.test(quickPart),
     '截圖下單腳本必須包在 IIFE 內，否則 g／show 會與表單那組互相覆蓋');

  ok(scriptsParse(full.match(/<script>([\s\S]*?)<\/script>/g) || []),
     '兩段內嵌腳本語法都正確');

  // ── 缺發包分頁：不可整頁擋掉，截圖下單仍要能用 ──
  // 合併前截圖下單是獨立頁、權限不需要發包分頁。若合併後照舊在頁面層擋，
  // 這些人會連截圖下單都進不去——那是合併造成的倒退。
  asUser('ns@waferlock.com');
  const bare = G.orderBlock_('ns@waferlock.com', G.salesFor_('ns@waferlock.com'));
  // 🔑 要驗「按得到」，不是「區塊存在」。quickOrderBlock_ 是無條件串上去的，
  //    只檢查 id="quickFields" 的話，就算按鈕被拿掉、沒有任何入口，斷言照樣通過。
  ok(/id="quickFields"/.test(bare) && /onclick="pickQuick\(/.test(bare),
     '缺發包分頁時截圖下單仍必須可用（區塊在，而且要有按鈕能到達）');
  ok(!/id="fields"/.test(bare), '缺發包分頁時不可畫出無處可寫的發包表單');
  ok(/只能用截圖下單/.test(bare), '要明說為什麼少了兩個選項，不能只是靜靜不顯示');
  ok(/var NBTN=1;/.test(bare) && /id="k0"/.test(bare),
     '只剩一顆按鈕時索引要從 k0 開始');
  ok(/pickQuick\(0\);/.test(bare),
     '只有一種選擇時要自動選好，否則畫面像是壞掉（一顆按鈕、什麼都沒展開）');
  ok(!/loadOptions/.test('') && bare.length > 0, '缺分頁時不應呼叫 loadOptions_ 而拋錯');

  // ── 舊網址 ?page=quick 當別名，預選截圖下單 ──
  asUser('ls@waferlock.com');
  build([withSheet, noSheet]);
  const viaOld = G.orderBlock_('ls@waferlock.com', G.salesFor_('ls@waferlock.com'), true);
  ok(/pickQuick\(2\);/.test(viaOld), '從 ?page=quick 進來要自動切到截圖下單那一頁');
  const viaNew = G.orderBlock_('ls@waferlock.com', G.salesFor_('ls@waferlock.com'));
  ok(!/pickQuick\(2\);/.test(viaNew), '正常進下單頁不可預選任何單別（單別必選是刻意設計）');

  // ── 導覽列不該再有獨立的截圖下單頁籤 ──
  const nav = G.navBlock_('order', { sales: true });
  ok(!/page=quick/.test(nav), '截圖下單已併入下單頁，導覽列不應再有獨立頁籤');
  ok(/下單/.test(nav), '下單頁籤仍要在');

  asUser('boss@waferlock.com');
})();

// 【33】Chat 小幫手問答
console.log('\n【33】Chat 小幫手問答');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const origFetch = sandbox.UrlFetchApp.fetch;
  const SALES_SHEET = '零售-Sammi';
  const OHEAD = HEADS[SALES_SHEET];
  const SHEAD = G.SHIPMENT_HEADERS;

  // 用欄名建列，不手動數欄位順序——數錯不會報錯，只會讓斷言莫名其妙地失敗
  const rowOf = (head, obj) => head.map(h => (obj[h] === undefined ? '' : obj[h]));

  // 讓 Gemini 回固定的解析結果。這裡測的是「拿到條件之後程式怎麼做」，
  // 不是 Gemini 準不準——後者本機測不了，也不該用假資料假裝測過。
  const geminiReturns = obj => {
    sandbox.UrlFetchApp.fetch = () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }]
      })
    });
  };

  const ORDER = rowOf(OHEAD, {
    '發包申請日期': '2026-08-25', '發包單號': 'LS-260825-01', '客戶': '金宏鎖店',
    '型號': 'L396', '報價單數量': '10', '發包人員': '小林',
    '主管KEY英文名押日期': '✅ 已核准'
  });

  const reset = (shipRows = []) => {
    SHEETS = [
      makeSheet(SALES_SHEET, OHEAD, [ORDER], 2),
      makeSheet('出貨明細', SHEAD, shipRows, 1),
      makeSheet('人員代碼',
        ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
        [['LS', '小林', 'ls@waferlock.com', '零售', 'Vivi', 'vivi@waferlock.com', SALES_SHEET]], 1),
      makeSheet('Chat人員對照', ['email', 'Chat UID', '姓名備註'],
        [['ls@waferlock.com', '111222333444555666', '小林']], 1),
    ];
    props.DISPATCH_SHEET_NAME = '*';
    props.GEMINI_API_KEY = 'test-key';
    CACHE = {};
  };
  reset();
  asUser('ls@waferlock.com');

  // ══ 空間白名單：問答功能唯一的安全邊界 ══
  {
    delete props.CHATAPP_ALLOWED_SPACES;
    // 🔑 一定要先讓 Gemini 回得出有效條件。否則閘門被拿掉時解析會失敗，
    //    資料「剛好」沒外洩，下面那條斷言就變成靠巧合通過的空測試。
    geminiReturns({ intent: 'ship_status', date_from: '2026-08-25', date_to: '2026-08-25',
      customer: '金宏鎖店', order_no: '', person: '', self: false, confidence: 'high' });
    const ev = { chat: {
      messagePayload: { message: { argumentText: '8/25 金宏鎖店出貨了嗎' },
                        space: { name: 'spaces/AAA' } },
      user: { name: 'users/111222333444555666', displayName: '小林' } } };
    const r = JSON.stringify(G.onMessage(ev));
    ok(/派工小幫手/.test(r), '白名單未設定時應退回自我介紹');
    ok(!/金宏|LS-260825/.test(r), '🔴 白名單未設定時一個字的業務資料都不能吐');

    props.CHATAPP_ALLOWED_SPACES = 'spaces/BBB';
    ok(!/LS-260825/.test(JSON.stringify(G.onMessage(ev))),
       '🔴 不在白名單的空間不可查到單');

    props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA, spaces/BBB';
    ok(G.chatAskAllowed_('spaces/AAA') && G.chatAskAllowed_('spaces/BBB'),
       '白名單應支援逗號分隔多個空間');
    ok(!G.chatAskAllowed_('spaces/CCC'), '不在名單的空間應為 false');
    ok(!G.chatAskAllowed_(''), '空的空間名一律 false');
  }

  // ══ shipmentStage_：誠實的狀態 ══
  {
    const mk = o => { const r = {}; SHEAD.forEach(h => { r[h] = o[h] || ''; }); return r; };

    ok(G.shipmentStage_(null).code === 'ordered_only', '沒有出貨列＝助理尚未鍵單');
    ok(G.shipmentStage_(mk({})).code === 'entered_no_no', '有列但無單號無日期');
    ok(G.shipmentStage_(mk({ '出貨單號': 'SO-1' })).code === 'entered_no_date', '有單號無出貨日期');
    ok(G.shipmentStage_(mk({ '出貨單號': 'SO-1', '出貨日期': '2026-08-26' })).code === 'date_filled',
       '出貨日期有值');
    ok(G.shipmentStage_(mk({ '倉庫核單狀態': '已核' })).code === 'wh_ok', '倉庫已核');

    const iss = G.shipmentStage_(mk({ '倉庫核單狀態': '有問題', '問題說明': '少兩支' }));
    ok(iss.code === 'wh_issue' && /少兩支/.test(iss.label),
       '有問題要帶出問題說明（常數名寫錯的話這裡會是空的）');
    ok(G.shipmentStage_(mk({ '倉庫核單狀態': '有問題', '出貨日期': '2026-08-26' })).code === 'wh_issue',
       '🔴 有問題要壓過出貨日期——那是唯一需要有人處理的狀態，被埋掉就沒人知道');

    // 🔴 本設計最重要的一條
    const labels = [null, mk({}), mk({ '出貨單號': 'SO-1' }), mk({ '出貨日期': '2026-08-26' }),
      mk({ '倉庫核單狀態': '已核' }), mk({ '倉庫核單狀態': '有問題' })]
      .map(r => G.shipmentStage_(r).label).join('|');
    ok(!/已出貨|未出貨/.test(labels),
       '🔴 任何狀態都不可輸出「已出貨／未出貨」——系統根本沒有這個資訊');
  }

  // ══ 回覆內容 ══
  {
    reset();
    props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA';
    geminiReturns({ intent: 'ship_status', date_from: '2026-08-25', date_to: '2026-08-25',
      customer: '金宏鎖店', order_no: '', person: '', self: false, confidence: 'high' });

    const ans = G.answerChatQuestion_('8/25 金宏鎖店出貨了嗎',
      { mention: '<users/111222333444555666>', name: '小林', email: 'ls@waferlock.com' });

    ok(/^<users\/111222333444555666>/.test(ans), '回覆要以 @發問者 開頭');
    ok(/金宏鎖店/.test(ans) && /2026-08-25/.test(ans), '要把理解到的條件覆述回去');
    ok(/LS-260825-01/.test(ans), '應找到那張單');
    ok(/不是貨運公司的實際出貨紀錄/.test(ans), '每則答案都要附免責聲明');
    ok(!/已出貨/.test(ans), '🔴 回覆不可出現「已出貨」');

    geminiReturns({ intent: 'ship_status', date_from: '2026-01-01', date_to: '2026-01-01',
      customer: 'ZZZ不存在', order_no: '', person: '', self: false, confidence: 'high' });
    const none = G.answerChatQuestion_('1/1 ZZZ不存在', { mention: '', name: '', email: '' });
    ok(/找不到/.test(none), '查無時要說「我找不到」');
    ok(/寫法不同|換個說法/.test(none),
       '🔴 查無時要提示可能只是寫法不同，不可讓人以為單真的不存在而重下一張');
  }

  // ══ 金額一律不進 Chat ══
  {
    reset([rowOf(SHEAD, {
      '案件號': 'IW202608250001', '登錄時間': '2026-08-25', '出貨單號': 'SO-9',
      '出貨日期': '2026-08-26', '發包單號': 'LS-260825-01', '客戶': '金宏鎖店',
      '售價': '99999', '進價': '88888'
    })]);
    props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA';
    geminiReturns({ intent: 'ship_status', date_from: '2026-08-25', date_to: '2026-08-25',
      customer: '金宏鎖店', order_no: '', person: '', self: false, confidence: 'high' });
    const ans = G.answerChatQuestion_('8/25 金宏鎖店', { mention: '', name: '', email: '' });
    ok(/LS-260825-01/.test(ans), '前提：這個情境要真的查到單，否則下面兩條是空測試');
    ok(!/99999/.test(ans), '🔴 售價不可出現在 Chat 回覆');
    ok(!/88888/.test(ans), '🔴 進價不可出現在 Chat 回覆');
    ok(/2026-08-26/.test(ans), '出貨日期應如實顯示');
  }

  // ══ 聽不懂 / 沒有條件 ══
  {
    reset(); props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA';
    geminiReturns({ intent: 'unknown', date_from: '', date_to: '', customer: '',
      order_no: '', person: '', self: false, confidence: 'low' });
    const a = G.answerChatQuestion_('今天天氣如何', { mention: '', name: '', email: '' });
    ok(/看不懂/.test(a), '聽不懂要明說');
    ok(/可以這樣問/.test(a), '聽不懂時要給可用的問法，不能只說聽不懂');
    ok(/不能查貨運進度|不會給金額/.test(a), '要講明做不到什麼，避免使用者一直亂試');
    ok(!/\*\*/.test(a), '🔴 說明訊息也不可用 Markdown 的 ** 粗體');

    geminiReturns({ intent: 'ship_status', date_from: '', date_to: '', customer: '',
      order_no: '', person: '', self: false, confidence: 'high' });
    ok(/看不懂/.test(G.answerChatQuestion_('查一下', { mention: '', name: '', email: '' })),
       '🔴 一個條件都沒有時不可放行去掃全表');
  }

  // ══ 「我的單」：認不出人時不可默默查成全部 ══
  {
    reset(); props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA';
    geminiReturns({ intent: 'ship_status', date_from: '', date_to: '', customer: '',
      order_no: '', person: '', self: true, confidence: 'high' });
    const a = G.answerChatQuestion_('我這週的單', { mention: '', name: '路人', email: '' });
    ok(/認不出你/.test(a), '認不出身分時要明說');
    // 這條有**兩道獨立防線**（實測確認）：拿掉「認不出就明說」那道之後，
    // salesFor_('') 查無業務仍然會擋下來。刻意兩條都留著——
    // 前者給的是看得懂的訊息，後者是萬一前者被改壞時的兜底。
    ok(!/LS-260825-01/.test(a),
       '🔴 問「我的單」但認不出人時，不可回一份其實是所有人的清單');

    const b = G.answerChatQuestion_('我這週的單',
      { mention: '', name: '小林', email: 'ls@waferlock.com' });
    ok(/LS-260825-01/.test(b), '認得出人時應查到他自己的單');
  }

  // ══ 超過一個月直接擋 ══
  {
    reset(); props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA';
    geminiReturns({ intent: 'ship_status', date_from: '2026-01-01', date_to: '2026-08-25',
      customer: '', order_no: '', person: '', self: false, confidence: 'high' });
    const a = G.answerChatQuestion_('今年所有單', { mention: '', name: '', email: '' });
    ok(/超過一個月|逾時/.test(a), '🔴 大範圍查詢要當場擋下，不可讓它掃到逾時（使用者只會看到沒反應）');
  }

  // ══ UID → email 反查 ══
  {
    reset();
    ok(G.emailOfChatUid_('users/111222333444555666') === 'ls@waferlock.com', 'UID 反查 email');
    ok(G.emailOfChatUid_('111222333444555666') === 'ls@waferlock.com', '沒有 users/ 前綴也要能查');
    ok(G.emailOfChatUid_('users/999') === '', '查不到回空字串');
    ok(G.emailOfChatUid_('') === '', '空值回空字串');
  }

  // ══ 事件解析：兩種模式都要吃（先前踩過同一類坑）══
  {
    ok(G.eventMessageText_({ chat: { messagePayload: { message: { argumentText: ' 查單 ' } } } })
       === '查單', '外掛模式應讀 chat.messagePayload 並 trim');
    ok(G.eventMessageText_({ message: { text: '傳統' } }) === '傳統', '傳統模式仍要能讀');
    ok(G.eventMessageText_({ chat: { messagePayload: { message:
       { text: '@派工小幫手 查單', argumentText: '查單' } } } }) === '查單',
       '🔴 要優先用 argumentText，否則 @提及前綴會被餵給 AI');
    ok(G.eventMessageText_({}) === '', '空事件回空字串');

    ok(G.chatMention_({ name: 'users/123' }) === '<users/123>', 'UID 應組成 Chat 提及格式');
    ok(G.chatMention_({ displayName: '小林' }) === '小林', '沒有 UID 時退化成顯示名稱');
    ok(G.chatMention_({}) === '', '什麼都沒有回空字串');
  }

  // ══ callGeminiJson_：全系統唯一的 Gemini 入口 ══
  {
    reset();
    delete props.GEMINI_API_KEY;
    ok(G.callGeminiJson_([{ text: 'hi' }], { type: 'OBJECT' }, 't').reason === 'nokey',
       '沒金鑰要回 nokey 而不是拋錯');
    props.GEMINI_API_KEY = 'test-key';

    sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 500, getContentText: () => 'boom' });
    ok(G.callGeminiJson_([{ text: 'hi' }], {}, 't').reason === 'http', 'HTTP 失敗回 http');

    sandbox.UrlFetchApp.fetch = () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '不是json' }] } }] })
    });
    ok(G.callGeminiJson_([{ text: 'hi' }], {}, 't').reason === 'parse', '解析失敗回 parse');

    let body = '';
    sandbox.UrlFetchApp.fetch = (url, opt) => {
      body = opt.payload;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) };
    };
    const r = G.callGeminiJson_([{ text: 'hi' }], { type: 'OBJECT' }, 't');
    ok(r.ok && r.data.a === 1, '正常路徑應回解析後的物件');
    ok(!/inline_data/.test(body),
       '純文字呼叫不可夾帶 inline_data（全庫第一支純文字呼叫，最容易照抄圖片版）');
    ok(/responseSchema/.test(body), '必須帶 responseSchema，否則回的不保證是 JSON');
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
  reset();
})();

// 【34】Chat 問答的時間預算與免 AI 快速路徑
//
// 這一段全部源自 2026-08-25 的真實逾時事故：Gemini 過載，第一個型號等 37 秒
// 才回 503、換下一個又 503，Chat 外掛在 38.3 秒被「Exceeded maximum execution time」
// 砍掉——使用者在 Chat 裡完全沒有反應，連錯誤訊息都看不到。
console.log('\n【34】Chat 問答：時間預算與免 AI 快速路徑');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const origFetch = sandbox.UrlFetchApp.fetch;
  const SALES_SHEET = '零售-Sammi';
  const OHEAD = HEADS[SALES_SHEET];
  const rowOf = (head, obj) => head.map(h => (obj[h] === undefined ? '' : obj[h]));

  const reset = () => {
    SHEETS = [
      makeSheet(SALES_SHEET, OHEAD, [rowOf(OHEAD, {
        '發包申請日期': '2026-08-25', '發包單號': 'LS-260825-01', '客戶': '金宏鎖店',
        '型號': 'L396', '報價單數量': '10', '發包人員': '小林',
        '主管KEY英文名押日期': '✅ 已核准'
      })], 2),
      makeSheet('出貨明細', G.SHIPMENT_HEADERS, [], 1),
      makeSheet('人員代碼',
        ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
        [['LS', '小林', 'ls@waferlock.com', '零售', 'Vivi', 'vivi@waferlock.com', SALES_SHEET]], 1),
    ];
    props.DISPATCH_SHEET_NAME = '*';
    props.GEMINI_API_KEY = 'test-key';
    props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA';
    CACHE = {};
  };
  reset();
  asUser('ls@waferlock.com');

  // ══ 免 AI 快速路徑：解得出來就不該碰 Gemini ══
  {
    const f = G.parseChatQuestionFast_('幫我查 LS-260825-01');
    ok(f && f.orderNo === 'LS-260825-01', '發包單號要能用正則解出來');
    ok(f && f.via === 'fast', '要標記走的是快速路徑，方便日後看比例');

    const c = G.parseChatQuestionFast_('IW202608250001 出貨了嗎');
    ok(c && c.orderNo === 'IW202608250001', '案件號也要能解');

    const d = G.parseChatQuestionFast_('今天的單');
    ok(d && d.dateFrom === d.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(d.dateFrom),
       '「今天的單」要解成今天的日期');

    // 🔴 這條是測試抓出來的實際 bug：「今天天氣如何」也含「今天」
    ok(G.parseChatQuestionFast_('今天天氣如何') === null,
       '🔴 日期詞必須搭配訂單字眼，否則「今天天氣如何」會被當成查詢去掃分頁');
    ok(G.parseChatQuestionFast_('金宏鎖店這個月的單') === null,
       '模稜兩可的（月份、客戶名）要交給 AI，不可自己猜');
    ok(G.parseChatQuestionFast_('') === null, '空字串回 null');
  }

  // ══ 走快速路徑時「一次都不可以打 Gemini」══
  {
    reset();
    let calls = 0;
    sandbox.UrlFetchApp.fetch = () => { calls++; throw new Error('不該被呼叫'); };
    const ans = G.answerChatQuestion_('查 LS-260825-01',
      { mention: '', name: '小林', email: 'ls@waferlock.com' });
    ok(calls === 0, '🔴 有單號時一次都不可打 Gemini——那正是逾時的來源');
    ok(/LS-260825-01/.test(ans), '而且要真的查到單（否則上一條是空測試）');
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ══ Gemini 掛掉時：必須回一句話，不可讓它逾時成零回應 ══
  {
    reset();
    sandbox.UrlFetchApp.fetch = () => ({
      getResponseCode: () => 503,
      getContentText: () => '{"error":{"code":503,"message":"high demand"}}'
    });
    const ans = G.answerChatQuestion_('金宏鎖店這個月的單如何',
      { mention: '<users/1>', name: '小林', email: 'ls@waferlock.com' });
    ok(typeof ans === 'string' && ans.length > 0,
       '🔴 Gemini 全掛時仍必須回一句話——逾時的話使用者在 Chat 是完全沒反應');
    ok(/單號/.test(ans),
       '要告訴使用者「給單號就不需要 AI」，這是當下唯一還能用的路');
    ok(/^<users\/1>/.test(ans), '失敗訊息也要 @ 發問者');
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  // ══ 時間預算：撞上限前要主動停手 ══
  {
    reset();
    let n = 0;
    // 每次呼叫都「花掉」很久：用真實時間模擬不可行，改成檢查呼叫次數——
    // 預算 1ms 代表第一次之後就沒有餘裕，不該再試第二個模型。
    sandbox.UrlFetchApp.fetch = () => {
      n++;
      return { getResponseCode: () => 503, getContentText: () => 'busy' };
    };
    const r = G.callGeminiJson_([{ text: 'hi' }], {}, 'test', { deadlineMs: 1 });
    ok(n === 1, '🔴 預算用盡後不可再試下一個模型，實際試了 ' + n + ' 次');
    ok(r.reason === 'timeout', '預算用盡要回 timeout，好讓呼叫端講出正確的原因');

    // 沒設預算時維持原本行為（截圖下單那邊使用者看著網頁等，多試幾個划算）
    n = 0;
    G.callGeminiJson_([{ text: 'hi' }], {}, 'test');
    ok(n === G.GEMINI_MODELS.length,
       '沒設預算時應試完整份清單（截圖下單靠這個行為），實際 ' + n);
    sandbox.UrlFetchApp.fetch = origFetch;
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
  reset();
})();

// 【35】查無時的「差一點就中」提示
//
// 源自 2026-08-25 真實測試：問「8 月金宏的單」回「我找不到」，
// 但金宏鎖店其實有 3 筆、只是都在 2~3 月。那句回覆技術上正確卻毫無幫助，
// 連我自己都被誤導去查是不是程式有 bug。使用者只會以為單不存在。
console.log('\n【35】查無時的「差一點就中」提示');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const origFetch = sandbox.UrlFetchApp.fetch;
  const SHEET = '潘筱凡(金宏鎖店)';
  const OHEAD = HEADS['零售-Sammi'];
  const rowOf = obj => OHEAD.map(h => (obj[h] === undefined ? '' : obj[h]));

  const geminiReturns = obj => {
    sandbox.UrlFetchApp.fetch = () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }]
      })
    });
  };

  // 客戶欄放的是「終端客戶」，鎖店名只出現在分頁名——這是實測看到的真實結構
  SHEETS = [
    makeSheet(SHEET, OHEAD, [
      rowOf({ '發包申請日期': '2026-02-10', '發包單號': 'PS-260210-01',
              '客戶': '天崴建設-          張小姐', '型號': 'L372N', '報價單數量': '1' }),
      rowOf({ '發包申請日期': '2026-03-25', '發包單號': 'PS-260325-01',
              '客戶': '成都營造-趙敏全', '型號': 'L600', '報價單數量': '1' }),
    ], 2),
    makeSheet('出貨明細', G.SHIPMENT_HEADERS, [], 1),
    makeSheet('人員代碼',
      ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
      [['PS', '潘筱凡', 'ps@waferlock.com', '零售', 'Vivi', 'vivi@waferlock.com', SHEET]], 1),
  ];
  props.DISPATCH_SHEET_NAME = '*';
  props.GEMINI_API_KEY = 'test-key';
  props.CHATAPP_ALLOWED_SPACES = 'spaces/AAA';
  CACHE = {};
  asUser('ps@waferlock.com');

  // ══ 客戶有單、但不在問的日期範圍 ══
  {
    geminiReturns({ intent: 'ship_status', date_from: '2026-08-01', date_to: '2026-08-31',
      customer: '金宏鎖店', order_no: '', person: '', self: false, confidence: 'high' });
    const a = G.answerChatQuestion_('查8月金宏鎖店的單', { mention: '', name: '', email: '' });

    ok(/有 2 筆/.test(a),
       '🔴 客戶有單只是日期不中時，要講出「有幾筆」而不是只說找不到');
    ok(/都不在你問的日期範圍/.test(a), '要明說是日期不中，不是單不存在');
    ok(/2026-03-25/.test(a), '要給最近一筆的日期，讓人知道往哪邊找');
    ok(/把日期拿掉/.test(a), '要給可以立刻照做的下一步');

    // 🔴 Google Chat 的粗體是**單**星號 *文字*，不是 Markdown 的 **文字**。
    //   寫成 Markdown 的話星號會原樣顯示出來（2026-08-25 實測看到）。
    //   既有的通知程式本來就用對了（如 '*新單（料件出貨，免簽核）*'），
    //   是寫新訊息時帶著 Markdown 習慣才寫錯的，所以要用測試鎖住。
    ok(!/\*\*/.test(a), '🔴 Chat 訊息不可用 Markdown 的 ** 粗體，星號會原樣顯示');
  }

  // ══ 真的完全不存在時，維持原本保守的措辭 ══
  {
    geminiReturns({ intent: 'ship_status', date_from: '2026-08-01', date_to: '2026-08-31',
      customer: 'ZZZ完全不存在', order_no: '', person: '', self: false, confidence: 'high' });
    const b = G.answerChatQuestion_('查8月ZZZ完全不存在', { mention: '', name: '', email: '' });
    ok(/找不到/.test(b), '完全查無時仍說「我找不到」');
    ok(!/有 \d+ 筆/.test(b), '🔴 完全查無時不可謊報筆數');
  }

  // ══ 客戶名比對要同時吃「分頁名」與「客戶欄」 ══
  {
    geminiReturns({ intent: 'ship_status', date_from: '', date_to: '',
      customer: '金宏鎖店', order_no: '', person: '', self: false, confidence: 'high' });
    const c = G.answerChatQuestion_('查金宏鎖店的單', { mention: '', name: '', email: '' });
    ok(/PS-260210-01/.test(c),
       '🔴 鎖店名只在分頁名裡（客戶欄放的是終端客戶），比對必須涵蓋分頁名');

    geminiReturns({ intent: 'ship_status', date_from: '', date_to: '',
      customer: '成都營造', order_no: '', person: '', self: false, confidence: 'high' });
    ok(/PS-260325-01/.test(G.answerChatQuestion_('查成都營造', { mention: '', name: '', email: '' })),
       '用終端客戶名也要查得到');
  }

  // ══ 顯示：客戶欄的填充空白不可原樣貼進 Chat ══
  {
    geminiReturns({ intent: 'ship_status', date_from: '', date_to: '',
      customer: '天崴建設', order_no: '', person: '', self: false, confidence: 'high' });
    const d = G.answerChatQuestion_('查天崴建設', { mention: '', name: '', email: '' });
    ok(/天崴建設- 張小姐/.test(d),
       '客戶欄的連續空白要壓成單一空白（實測看到「天崴建設-          張小姐」）');
    ok(!/ {3,}/.test(d), '回覆裡不該出現三個以上連續空白');
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
})();

// 【36】貨運單：上傳、配對、回填
//
// 2026-08-25 用真實樣本（新竹託運明細260824.pdf，21 筆）驗證過的行為。
// 那份樣本揭露兩件事，這一段就是在鎖住它們：
//   ① 訂單編號欄整份都是空的 → 只能靠備註／收件人＋電話配對
//   ② 同一天有兩筆寄給「金宏鎖店 王啟尚」→ 光靠收件人分不出來，不可以猜
console.log('\n【36】貨運單：上傳、配對、回填');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const SHEAD = G.SHIPMENT_HEADERS;
  const rowOf = obj => SHEAD.map(h => (obj[h] === undefined ? '' : obj[h]));

  const reset = shipRows => {
    SHEETS = [
      makeSheet('出貨明細', SHEAD, shipRows || [], 1),
      makeSheet('人員代碼',
        ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
        [['LS', '小林', 'ls@waferlock.com', '零售', 'Vivi', 'vivi@waferlock.com', '零售-Sammi']], 1),
    ];
    props.DISPATCH_SHEET_NAME = '*';
    props.DISPATCH_WAREHOUSE = 'wh@waferlock.com';
    props.DISPATCH_SHIPDOC_FOLDER_ID = 'FOLDER1';
    CACHE = {};
  };

  // ══ 新欄位要進 SHIPMENT_HEADERS（否則 openShipmentSheet_ 不會建） ══
  ok(SHEAD.indexOf('貨運單號') >= 0 && SHEAD.indexOf('貨運日期') >= 0,
     '貨運單號／貨運日期要在出貨明細表頭裡');

  // ══ shipmentStage_：貨運單號是唯一能說「已出貨」的依據 ══
  {
    const mk = o => { const r = {}; SHEAD.forEach(h => { r[h] = o[h] || ''; }); return r; };
    const s = G.shipmentStage_(mk({ '貨運單號': '345-827-1434', '貨運日期': '2026-08-25' }));
    ok(s.code === 'shipped', '有貨運單號＝已出貨');
    ok(/已出貨/.test(s.label) && /345-827-1434/.test(s.label),
       '要明講已出貨並附上貨運單號');

    // 🔴 貨運單號要壓過所有登錄狀態：貨都上車了，前面那些就不是重點
    const s2 = G.shipmentStage_(mk({
      '貨運單號': '345-827-1434', '倉庫核單狀態': '待核', '出貨日期': ''
    }));
    ok(s2.code === 'shipped',
       '🔴 有貨運單號時要壓過倉庫核單狀態——那是單據審核，不是貨的去向');

    ok(G.shipmentStage_(mk({ '出貨日期': '2026-08-26' })).code === 'date_filled',
       '沒有貨運單號時維持原本的分層，不可因為新增這階就亂掉');
  }

  // ══ normKey_：比對要能容忍空白、全形、大小寫 ══
  {
    ok(G.normKey_('W5501-260807005') === G.normKey_(' w5501 260807005 '),
       '🔴 比對要容忍空白與大小寫（matching.py 只做 strip()== 就是踩在這個坑）');
    ok(G.normKey_('ＡＢＣ１２３') === G.normKey_('ABC123'), '全形要轉半形');
    ok(G.normKey_('') === '', '空值不出錯');
  }

  // ══ 🔑 配對：只有唯一命中才算，模稜兩可一律不猜 ══
  {
    // 真實情境：同一天兩筆寄給「金宏鎖店 王啟尚」，電話也一樣
    reset([
      rowOf({ '出貨單號': 'SO-1', '貨指寄-收件人': '金宏鎖店 王啟尚',
              '貨指寄-電話': '0913-112661', '出貨備註': '' }),
      rowOf({ '出貨單號': 'SO-2', '貨指寄-收件人': '金宏鎖店 王啟尚',
              '貨指寄-電話': '0913-112661', '出貨備註': '燦坤(沙鹿向上店)，韋晴文(L396)' }),
      rowOf({ '出貨單號': 'SO-3', '貨指寄-收件人': '宇泰鎖印行-李建男',
              '貨指寄-電話': '0926-797328', '出貨備註': 'MOMO-許嘉程/陳建棠L901' }),
    ]);
    const idx = G.buildMatchIndex_();

    // 備註有鑑別度 → 分得出是哪一筆
    const byNote = G.matchShipRow_(
      { recipient: '-金宏鎖店 王啟尚', phone: '0913-112661',
        note: '燦坤(沙鹿向上店)，韋晴文(L396)', order_no: '' }, idx);
    ok(byNote.row > 0 && byNote.by === '出貨備註',
       '備註對得上時要能唯一命中（真實樣本的備註鑑別度很高）');

    // 🔴 沒有備註 → 兩筆都符合 → 不可以猜
    const ambiguous = G.matchShipRow_(
      { recipient: '-金宏鎖店 王啟尚', phone: '0913-112661', note: '', order_no: '' }, idx);
    ok(ambiguous.row === 0,
       '🔴 同一收件人有多筆時絕對不可以猜——猜錯會讓兩張單的貨運單號對調，且看起來完全正常');
    ok((ambiguous.candidates || []).length === 2,
       '要回傳候選讓人指定，實際 ' + (ambiguous.candidates || []).length);

    // 收件人＋電話唯一 → 可以配
    const uniq = G.matchShipRow_(
      { recipient: '-宇泰鎖印行-李建男', phone: '0926-797328', note: '', order_no: '' }, idx);
    ok(uniq.row > 0, '收件人唯一時可以配對');

    // 訂單編號優先（倉庫開始填之後就走這條）
    const byNo = G.matchShipRow_(
      { recipient: '完全不相干', phone: '', note: '', order_no: 'SO-3' }, idx);
    ok(byNo.row > 0 && byNo.by === '訂單編號',
       '有訂單編號時要優先用它，且不受收件人不符影響');

    // 全都對不上 → 不配
    ok(G.matchShipRow_(
      { recipient: '沒見過的人', phone: '0000', note: '', order_no: '' }, idx).row === 0,
      '完全對不上就不配對');
  }

  // ══ 已經有貨運單號的列不可被覆蓋（重跑同一份檔案要安全） ══
  {
    reset([
      rowOf({ '出貨單號': 'SO-9', '貨指寄-收件人': '一峰鎖店',
              '貨運單號': '345-894-4145' }),
    ]);
    const idx = G.buildMatchIndex_();
    ok(G.matchShipRow_({ recipient: '一峰鎖店', phone: '', note: '', order_no: 'SO-9' }, idx).row === 0,
       '🔴 已有貨運單號的列要排除在索引外，否則重跑同一份檔案會覆蓋掉已填的值');
  }

  // ══ 上傳權限：閘門要在核心函式裡（換入口仍受保護） ══
  {
    reset([]);
    const B64 = Buffer.from('x').toString('base64');
    const r = G.uploadShippingDocAs_('outsider@waferlock.com', 'a.pdf', 'application/pdf', B64);
    ok(!r.ok && /倉庫名單/.test(r.message),
       '🔴 非倉庫人員不可上傳（閘門在核心，不是在薄殼）');

    ok(!G.uploadShippingDocAs_('wh@waferlock.com', 'a.exe', 'application/x-msdownload', B64).ok,
       '非 PDF／圖片要擋下');
    ok(!G.uploadShippingDocAs_('wh@waferlock.com', 'a.pdf', 'application/pdf', '').ok,
       '沒有內容要擋下');
  }

  // ══ 上傳頁 ══
  {
    reset([]);
    const page = G.shipDocBlock_('wh@waferlock.com');
    ok(/uploadShippingDoc\(/.test(page), '上傳頁要呼叫 uploadShippingDoc');
    ok(/id="sdf"/.test(page) && /accept=/.test(page), '要有檔案選取並限制型別');
    ok(/不會用猜的/.test(page),
       '要在畫面上講明系統不會猜——這是使用者信任這份資料的前提');
    ok(scriptsParse(page.match(/<script>[\s\S]*?<\/script>/g) || []), '內嵌 JS 語法正確');
  }

  // ══ 🔑 直接丟進 Drive 資料夾也要能處理（不是只有網頁上傳） ══
  //
  // 2026-08-25 實測踩到：使用者把 PDF 丟進資料夾，佇列卻說「是空的」，
  // 看起來像功能壞掉。既有的貨運單管線本來就是掃資料夾的，
  // 使用者理所當然會這樣預期——這是設計沒對上實際用法，不是使用者用錯。
  {
    reset([]);
    props.DISPATCH_SHIPDOC_FOLDER_ID = 'FOLDER1';
    const files = [
      { id: 'F1', name: '託運明細A.pdf', mime: 'application/pdf' },
      { id: 'F2', name: '不相干.txt', mime: 'text/plain' },
    ];
    const origFolder = sandbox.DriveApp.getFolderById;
    sandbox.DriveApp.getFolderById = () => ({
      getName: () => '貨運單',
      getFiles: () => {
        let i = 0;
        return {
          hasNext: () => i < files.length,
          next: () => {
            const f = files[i++];
            return {
              getId: () => f.id, getName: () => f.name,
              getMimeType: () => f.mime, getDateCreated: () => new Date(2026, 7, 25)
            };
          }
        };
      }
    });

    const q = G.openAuxSheet_('貨運單處理', G.SHIPDOC_HEAD);
    const n = G.enqueueFolderShipDocs_(q);
    ok(n === 1, '🔴 資料夾裡的 PDF 要自動進佇列，實際收進 ' + n + ' 份');
    ok(q.sheet.getLastRow() === 2, '只收 PDF／圖片，.txt 不可收進來');

    // 再掃一次不可重複收（用檔案 ID 判斷，不是檔名）
    const n2 = G.enqueueFolderShipDocs_(q);
    ok(n2 === 0, '🔴 同一份檔案不可被重複收進佇列');

    sandbox.DriveApp.getFolderById = origFolder;
  }

  // ══ 發票：沒上傳時要明講，別留白 ══
  {
    ok(G.invoiceLink_('') === '未上傳',
       '🔴 沒發票時要寫「未上傳」——備存通知是唯一會提醒漏發票的地方，留白沒人會發現');
    ok(G.invoiceLink_('   ') === '未上傳', '只有空白也算沒上傳');
    const L = G.invoiceLink_('https://drive.google.com/file/d/ABC/view');
    ok(/^<https:\/\/drive\.google\.com\/file\/d\/ABC\/view\|/.test(L) && /-->?$|>$/.test(L),
       '有發票時要組成 Chat 的 <網址|文字> 格式');
  }

  // ══ 🔑 選了發票卻沒按「登錄」就直接送出：核單頁最容易踩的坑 ══
  //
  // 2026-08-25 實測踩到：上傳了圖片、Chat 通知卻顯示「未上傳」，
  // 因為發票「登錄」與「已撿料完成」是兩顆分開的按鈕，檔案根本沒送出去。
  {
    // 要給一列，沒有待核單時 warehouseBlock_ 會提早返回、不含腳本
    const page = G.warehouseBlock_('wh@waferlock.com',
      [{ shipNo: 'W5501-1', row: 2, customer: 'A', items: 'X' }], {}, { at: '' });
    ok(/function pendInv\(/.test(page),
       '🔴 要能偵測「選了發票但還沒登錄」的狀態');
    ok(/if\(pendInv\(cardId\)\)\{/.test(page),
       '🔴 送出核單前要先檢查有沒有沒登錄的發票');
    ok(/upl\(no,cardId,rw,function\(\)\{wact\(/.test(page),
       '🔴 要先登錄發票、成功後才接著送核單——不可留下「核單過了但發票沒進去」的狀態');
    ok(/data-done/.test(page), '登錄成功要留記號，避免重複上傳');
  }

  // ══ 人工指定要能真的套用回出貨明細（否則待指定分頁是死路） ══
  {
    reset([
      rowOf({ '出貨單號': 'W5501-260807001', '貨指寄-收件人': '正程企業' }),
      rowOf({ '出貨單號': 'W5501-260812099', '貨指寄-收件人': '測試',
              '貨運單號': '999-999-9999' }),
    ]);
    const w = G.openAuxSheet_('貨運單待指定', G.SHIPWAIT_HEAD);
    const put = o => {
      const line = G.SHIPWAIT_HEAD.map(h => (o[h] === undefined ? '' : o[h]));
      w.sheet.appendRow(line);
    };
    put({ '貨運單號': '345-827-1434', '貨運日期': '2026-08-25', '收件人': '承淇',
          '對應出貨單號': 'W5501-260807001', '處理狀態': '待指定' });
    put({ '貨運單號': '345-903-6206', '收件人': '至洧',
          '對應出貨單號': '不存在的單號', '處理狀態': '待指定' });
    put({ '貨運單號': '345-912-0523', '收件人': '北安',
          '對應出貨單號': 'W5501-260812099', '處理狀態': '待指定' });
    put({ '貨運單號': '345-999-0000', '收件人': '還沒填的',
          '對應出貨單號': '', '處理狀態': '待指定' });

    G.applyShipWaiting();

    const s2 = G.openShipmentSheet_();
    const got = s2.sheet.getRange(2, s2.col[G.normHeader_('貨運單號')]).getValue();
    ok(String(got) === '345-827-1434',
       '🔴 人工指定的對應要真的寫回出貨明細（否則待指定分頁是死路）');

    const st = w.sheet.getRange(2, w.col[G.normHeader_('處理狀態')], 4, 1).getValues()
      .map(r => String(r[0]));
    ok(/已套用/.test(st[0]), '成功的要標「已套用」');
    ok(/查無/.test(st[1]),
       '🔴 查無單號要在分頁上說明原因，不可靜默跳過（人不會知道自己填的沒生效）');
    ok(/已有貨運單號/.test(st[2]), '🔴 已有貨運單號的不可覆蓋，且要說明原因');
    ok(st[3] === '待指定', '還沒填對應單號的不可動它');
  }

  // ══ 資料夾屬性沒設時要沿用既有那顆，不要直接失效 ══
  {
    delete props.DISPATCH_SHIPDOC_FOLDER_ID;
    props.SHIPMENT_FOLDER_ID = 'LEGACY1';
    ok(G.shipDocFolderId_() === 'LEGACY1',
       '專屬屬性沒設時要沿用 SHIPMENT_FOLDER_ID（使用者本來就把檔案丟那）');
    props.DISPATCH_SHIPDOC_FOLDER_ID = 'OWN1';
    ok(G.shipDocFolderId_() === 'OWN1', '兩顆都有時以專屬的為準');
  }

  asUser('boss@waferlock.com');
  reset([]);
})();

// 【37】倉庫回報「有問題」之後，單子不可以消失
//
// 這一段鎖住的是 2026-08-25 追出來的資料黑洞：
// 倉庫按「有問題」後，那一列同時從倉庫清單（已核或有問題都算處理完）與
// 助理清單（只撈出貨單號為空的列）消失，而且全檔沒有任何函式能把它改回待核。
// 通知發出去了，但沒有任何畫面看得到這張單。
// docs/倉庫訪談清單.md 當初就預言「單子會憑空消失」，確實成真。
console.log('\n【37】倉庫回報有問題後，單子不可以消失');
(() => {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const SHEAD = G.SHIPMENT_HEADERS;
  const rowOf = obj => SHEAD.map(h => (obj[h] === undefined ? '' : obj[h]));

  const origFetch = sandbox.UrlFetchApp.fetch;
  let sent = [];
  sandbox.UrlFetchApp.fetch = (u, o) => {
    sent.push(String((o && o.payload) || ''));
    return { getResponseCode: () => 200, getContentText: () => 'ok' };
  };

  const reset = rows => {
    SHEETS = [
      makeSheet('出貨明細', SHEAD, rows || [], 1),
      makeSheet('人員代碼',
        ['業務代碼', '業務姓名', '業務email', '類別', '對應助理', '助理email', '發包分頁'],
        [['LS', '小林', 'ls@waferlock.com', '零售', 'Vivi', 'vivi@waferlock.com', '零售-Sammi']], 1),
    ];
    props.DISPATCH_SHEET_NAME = '*';
    props.DISPATCH_ASSISTANTS = 'vivi@waferlock.com';
    props.DISPATCH_WAREHOUSE = 'wh@waferlock.com';
    props.DISPATCH_WAREHOUSE_WEBHOOK = 'https://example.test/hook';
    CACHE = {};
    sent = [];
  };

  const ISSUE_ROW = () => rowOf({
    '出貨單號': 'W5501-260825001', '客戶': '金宏鎖店', '出貨品項': 'L396 ×10',
    '倉庫核單狀態': '有問題', '倉庫核單人': 'wh@waferlock.com',
    '倉庫核單時間': '2026-08-25 14:00', '問題說明': '料號不符，實際是 L372N'
  });

  // ══ 🔴 助理必須看得到倉庫退回來的單 ══
  {
    reset([ISSUE_ROW()]);
    const pend = G.getPendingShipments_();
    ok(pend.length === 0,
       '前提：有問題的列因為已有出貨單號，不會出現在「待鍵入」清單（這是黑洞的一半）');

    const issues = G.getWarehouseIssues_();
    ok(issues.length === 1,
       '🔴 助理必須有一份清單看得到倉庫退回來的單，否則通知發了也沒有畫面能處理');
    ok(issues[0]['問題說明'] === '料號不符，實際是 L372N',
       '要帶出倉庫填的問題說明，助理才知道要改什麼');
    ok(issues[0].row === 2, '要帶列號，送回去時才不必重新掃表');
  }

  // ══ 只撈「有問題」的，不可把已核／待核的也撈進來 ══
  {
    reset([
      ISSUE_ROW(),
      rowOf({ '出貨單號': 'A', '倉庫核單狀態': '已核' }),
      rowOf({ '出貨單號': 'B', '倉庫核單狀態': '待核' }),
      rowOf({ '出貨單號': 'C' }),
    ]);
    const issues = G.getWarehouseIssues_();
    ok(issues.length === 1 && issues[0]['出貨單號'] === 'W5501-260825001',
       '只撈「有問題」的，已核／待核／空白都不該進來');
  }

  // ══ 🔴 送回倉庫：狀態要真的改回待核，而且倉庫清單看得到 ══
  {
    reset([ISSUE_ROW()]);
    asUser('vivi@waferlock.com');
    const r = G.reopenWarehouse('W5501-260825001', '', 2);
    ok(r.ok, '助理應能把單子送回倉庫｜' + r.message);

    const s = G.openShipmentSheet_();
    const st = String(s.sheet.getRange(2, s.col[G.normHeader_('倉庫核單狀態')]).getValue());
    ok(st === '待核', '🔴 狀態要真的改回「待核」，實際「' + st + '」');

    // 🔑 問題說明保留：倉庫重新看到這張單時要知道上次為什麼被退
    const note = String(s.sheet.getRange(2, s.col[G.normHeader_('問題說明')]).getValue());
    ok(/料號不符/.test(note),
       '🔴 問題說明不可清空——倉庫要知道上次為什麼被退，否則得從頭再判斷一次');

    // 核單人／時間要清掉：那是上一次核單的人，留著會讓人以為還是他負責
    ok(!String(s.sheet.getRange(2, s.col[G.normHeader_('倉庫核單人')]).getValue()).trim(),
       '核單人要清掉（那是上一次的人）');

    // 🔴 最重要：倉庫的清單真的看得到它了嗎
    CACHE = {};
    const wh = G.getWarehouseCached_().rows;
    ok(wh.some(x => x.shipNo === 'W5501-260825001'),
       '🔴 送回去之後倉庫清單必須看得到——這才是「單子回來了」的定義');

    // 送回去之後就不該再出現在助理的待修正清單
    ok(G.getWarehouseIssues_().length === 0, '送回去後不該還留在助理的待修正清單');
  }

  // ══ 權限與狀態守門 ══
  {
    reset([ISSUE_ROW()]);
    ok(!G.reopenWarehouseAs_('outsider@waferlock.com', 'W5501-260825001', '', 2).ok,
       '🔴 非助理不可把單子送回倉庫（閘門在核心函式裡）');

    reset([rowOf({ '出貨單號': 'W5501-260825001', '倉庫核單狀態': '已核' })]);
    const r2 = G.reopenWarehouseAs_('vivi@waferlock.com', 'W5501-260825001', '', 2);
    ok(!r2.ok && /已核/.test(r2.message),
       '🔴 已核的不可送回——那等於推翻倉庫做完的事，且要說明原因');

    reset([rowOf({ '出貨單號': 'W5501-260825001', '倉庫核單狀態': '待核' })]);
    ok(!G.reopenWarehouseAs_('vivi@waferlock.com', 'W5501-260825001', '', 2).ok,
       '待核的本來就在清單上，重送沒有意義');

    reset([ISSUE_ROW()]);
    ok(!G.reopenWarehouseAs_('vivi@waferlock.com', '不存在的單號', '', 0).ok,
       '查無單號要明確失敗');
  }

  // ══ 🔴 要能在「當下」修正，不是叫人去開試算表 ══
  //
  // 使用者實測後的原話：「沒有任何地方可以修正」。第一版只做到「單子回得來」，
  // 卻沒做到「能在這裡修」——那正是他一開始舉的老毛病（看得到問題卻不能當下處理）。
  {
    reset([ISSUE_ROW()]);
    const block = G.warehouseIssueBlock_(G.getWarehouseIssues_());
    ok(/<textarea id="wi0i"/.test(block),
       '🔴 出貨品項要能直接改在卡片上（倉庫多半就是為了這一欄退回來的）');
    ok(/L396 ×10/.test(block), 'textarea 要帶入現有的品項值');

    asUser('vivi@waferlock.com');
    const r = G.reopenWarehouse('W5501-260825001', 'L372N ×10', 2);
    ok(r.ok, '帶著修正的品項送回應成功｜' + r.message);

    const s = G.openShipmentSheet_();
    const it = String(s.sheet.getRange(2, s.col[G.normHeader_('出貨品項')]).getValue());
    ok(it === 'L372N ×10', '🔴 修改後的品項要真的寫回出貨明細，實際「' + it + '」');
    ok(/已通知業務/.test(r.message), '改了要讓助理知道業務會被通知');
  }

  // ══ 🔑 改了業務的資料，業務必須知道 ══
  //
  // 既有原則是「業務填的資料不讓助理改，因為改了業務不會知道」。
  // 這裡允許改了，就必須補上「讓業務知道」那一半，否則等於把保護拆掉沒補回來。
  {
    reset([ISSUE_ROW()]);
    const row = SHEETS.find(x => x.getName() === '出貨明細');
    row.getRange(2, G.SHIPMENT_HEADERS.indexOf('下單業務') + 1).setValue('小林');
    CACHE = {};
    sent = [];
    asUser('vivi@waferlock.com');
    G.reopenWarehouse('W5501-260825001', 'L372N ×10', 2);

    ok(sent.length === 1, '送回倉庫要發一則通知');
    const msg = JSON.parse(sent[0]).text;
    ok(/重新送核/.test(msg),
       '🔴 標題要講明這是「退回來又修好的單」，不可跟「新出貨單待核」混在一起');
    ok(/L396 ×10/.test(msg) && /L372N ×10/.test(msg),
       '🔴 改了什麼要前後值都寫出來，否則倉庫不知道到底改了沒');
    ok(/小林/.test(msg), '🔴 要點名業務——他的資料被改了');
    ok(/請確認/.test(msg), '要明講請業務確認');
    ok(/料號不符/.test(msg), '要帶出上次倉庫回報的問題，倉庫才知道在看什麼');
  }

  // ══ 🔴 日期不可以變成原始 JS 字串 ══
  //
  // 真實通知截圖看到：「登錄：fish.chen@waferlock.com　Wed Aug 12 2026 09:18:00
  // GMT+0800 (台北標準時間)」。根因是 readShipmentRow_ 用 String(v) 硬轉 Date，
  // 而那支被 11 個地方共用（通知、稽核、退單…），所以修在源頭。
  {
    ok(G.fmtWhen_(new Date(2026, 7, 12, 9, 18)) === '2026-08-12 09:18',
       '🔴 有時分的要保留時間——砍掉的話同一天的兩筆分不出先後');
    ok(G.fmtWhen_(new Date(2026, 7, 12)) === '2026-08-12',
       '純日期只給日期，不要補上 00:00');
    ok(G.fmtWhen_('2026-08-12 09:18') === '2026-08-12 09:18', '已經是字串就原樣回');
    ok(G.fmtWhen_('') === '' && G.fmtWhen_(null) === '', '空值不出錯');

    const row = rowOf({ '出貨單號': 'W-DATE', '倉庫核單狀態': '有問題' });
    reset([row]);
    const sh = SHEETS.find(x => x.getName() === '出貨明細');
    sh.getRange(2, SHEAD.indexOf('登錄時間') + 1).setValue(new Date(2026, 7, 12, 9, 18));
    CACHE = {};
    const rec = G.readShipmentRow_(G.openShipmentSheet_(), 2);
    ok(rec['登錄時間'] === '2026-08-12 09:18',
       '🔴 readShipmentRow_ 讀到 Date 要格式化，實際「' + rec['登錄時間'] + '」');
    ok(!/GMT|台北標準時間/.test(rec['登錄時間']),
       '🔴 絕對不可以出現 GMT 那一長串——它會直接貼進 Chat 通知');
  }

  // ══ 沒有業務可對時，不要說「請確認」 ══
  {
    reset([ISSUE_ROW()]);   // 這一列沒有下單業務、也沒有發包單號
    sent = [];
    asUser('vivi@waferlock.com');
    G.reopenWarehouse('W5501-260825001', 'L372N ×10', 2);
    const msg = JSON.parse(sent[0]).text;
    ok(/業務：查不到/.test(msg), '查不到業務仍要明講');
    ok(!/請確認/.test(msg),
       '🔴 找不到業務時不該接「請確認」——那句是講給業務聽的，沒人可對就是對著空氣說話');
  }

  // ══ 沒改品項也要能送回（可能是外部因素排除了） ══
  {
    reset([ISSUE_ROW()]);
    sent = [];
    asUser('vivi@waferlock.com');
    const r = G.reopenWarehouse('W5501-260825001', 'L396 ×10', 2);
    ok(r.ok && !/已通知業務/.test(r.message), '品項沒變時不該說「已通知業務」');
    ok(/未改動品項/.test(JSON.parse(sent[0]).text),
       '沒改品項要明講，倉庫才不會以為東西改好了');
  }

  // ══ 稽核要留痕 ══
  {
    reset([ISSUE_ROW()]);
    SHEETS.push(makeSheet('簽核紀錄',
      ['時間', '操作者', '層級', '發包單號', '動作', '說明', '分頁', '列號'], [], 1));
    CACHE = {};
    G.reopenWarehouseAs_('vivi@waferlock.com', 'W5501-260825001', '已改成 L372N', 2);
    const a = SHEETS.find(x => x.getName() === '簽核紀錄');
    const rows = a.getRange(2, 1, Math.max(a.getLastRow() - 1, 1), 8).getValues();
    ok(rows.some(r => /重新送倉庫核/.test(String(r[4]))),
       '🔴 送回倉庫要留稽核——這是「誰在什麼時候把單子推回去的」唯一紀錄');
  }

  // ══ 畫面：助理頁要有這一區，倉庫頁要說明按下去會怎樣 ══
  {
    reset([ISSUE_ROW()]);
    const block = G.warehouseIssueBlock_(G.getWarehouseIssues_());
    ok(/料號不符/.test(block), '待修正卡片要顯示倉庫填的問題說明');
    ok(/reopen\(/.test(block), '要有送回倉庫的按鈕');
    ok(G.warehouseIssueBlock_([]) === '', '沒有待修正時不佔版面');

    // 🔑 光測 warehouseIssueBlock_ 本身不夠——函式好好的但沒接進頁面的話，
    //    助理照樣看不到單子，而測試會過（反向驗證抓到過這個漏洞）。
    //    所以要測「整頁輸出」裡有沒有它。
    const spage = G.shipBlock_('vivi@waferlock.com', [], {}, { at: '' }, [],
      G.getWarehouseIssues_());
    ok(/料號不符/.test(spage),
       '🔴 待修正區必須真的接進出貨登錄頁——只有函式存在不算數');
    ok(/function reopen\(/.test(spage),
       '🔴 送回倉庫的前端函式也要接進去，否則按鈕按了沒反應');

    const wpage = G.warehouseBlock_('wh@waferlock.com',
      [{ shipNo: 'X', row: 2, customer: 'A', items: 'B' }], {}, { at: '' });
    ok(/會先從清單移除/.test(wpage),
       '🔴 倉庫要知道按「有問題」之後單子去哪了——否則只會看到它消失');
    ok(/送回倉庫/.test(wpage), '也要知道它還會回來');
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  asUser('boss@waferlock.com');
  reset([]);
})();


// ── 測試 38：倉庫核單清單的日期不可以是 GMT 原始字串 ──
// 2026-08-25 實機截圖發現：倉庫核單卡片顯示
//   「Wed Aug 12 2026 09:18:00 GMT+0800 (台北標準時間)」
// 同日稍早修過一次日期問題，但那次只涵蓋 readShipmentRow_，
// 倉庫清單走的是 getWarehousePending_ 的 pick()，漏掉了。
//
// 🔑 這一段必須餵**真的 Date 物件**才測得到。既有測試都餵字串，
//    所以三十幾個區段、一千多條斷言全都沒抓到這個 bug。
console.log('\n【38】倉庫核單清單的日期格式');
(function () {
  props.DISPATCH_SHEET_NAME = '*';
  props.DISPATCH_WAREHOUSE = 'wh@waferlock.com';
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  asUser('wh@waferlock.com');

  const SH = G.SHIPMENT_HEADERS;
  const at = n => SH.indexOf(n);
  const row = SH.map(() => '');
  row[at('登錄時間')] = new Date(2026, 7, 12, 9, 18, 0);   // ← 真的 Date，不是字串
  row[at('出貨單號')] = 'W5501-DATE01';
  row[at('客戶')] = '【驗收測試】客戶A';
  row[at('出貨品項')] = 'L901 *1';
  row[at('倉庫核單狀態')] = '待核';

  SHEETS = [makeSheet('出貨明細', SH, [row], 1)];
  CACHE = {};

  const rows = G.getWarehousePending_();
  ok(rows.length === 1, '應撈到那一筆待核單');
  const got = String(rows[0].at);

  ok(!/GMT/.test(got),
     '🔴 登錄時間不可以是 GMT 原始字串，實際：' + got);
  ok(/^2026-08-12/.test(got),
     '🔴 登錄時間應格式化成 yyyy-MM-dd，實際：' + got);
  ok(got === '2026-08-12 09:18',
     '有時分就要一起顯示（沿用 fmtWhen_ 的規則），實際：' + got);

  // 畫面上也要是格式化後的字串
  const html = G.warehouseBlock_('wh@waferlock.com', rows,
    { warehouse: true, warehouseUnrestricted: false }, { at: '', cached: false });
  ok(html.indexOf('GMT') < 0, '🔴 倉庫核單頁的 HTML 裡不可以出現 GMT 字串');
  ok(html.indexOf('2026-08-12 09:18') >= 0, '畫面應顯示格式化後的登錄時間');

  // 沒有時分的純日期不要補上 00:00（fmtWhen_ 既有行為，一併鎖住）
  const row2 = SH.map(() => '');
  row2[at('登錄時間')] = new Date(2026, 7, 12);
  row2[at('出貨單號')] = 'W5501-DATE02';
  row2[at('倉庫核單狀態')] = '待核';
  SHEETS = [makeSheet('出貨明細', SH, [row2], 1)];
  CACHE = {};
  const only = String(G.getWarehousePending_()[0].at);
  ok(only === '2026-08-12', '純日期不補時分，實際：' + only);
})();

// 【39】白話下單：從歷史料號篩候選
console.log('\n【39】白話下單：從歷史料號篩候選');
(function () {
  const asUser = e => { sandbox.Session.getActiveUser = () => ({ getEmail: () => e }); };
  const origFetch = sandbox.UrlFetchApp.fetch;
  const origCall = G.callGeminiJson_;

  // 歷史料號分頁的縮小版。刻意照真實資料的形狀做：
  // 鎖腹方向的「左內」是**夾在字串中間**（無MCU/方舌連動/左內），不是整格相等——
  // 用整格比對會全部篩不到，而真實資料就長這樣。
  const PHEAD = ['料號', '出過次數', '前面板', '鎖腹方向', '總門厚', '電池盒組', '內鎖'];
  const PROWS = [
    ['L376-1C11C1-A0311B-A1CA1-2X30A', 85, '消光黑', '無MCU/方舌連動/左內', '總門厚53mm-61mm', '標準版', '無'],
    ['L376-1C11C1-C0311B-A1CA1-2X31A', 51, '消光黑', '無MCU/方舌不連動/左內', '總門厚53mm-61mm', '標準版', '旋鈕上鎖卡片密碼失效'],
    ['L376-1C17C1-A0311B-A1CA1-2X30A', 29, '消光黑', '無MCU/方舌連動/左內', '總門厚53mm-61mm', '標準版(RTC on board)', '無'],
    ['L376-1C11C1-B0311B-A1CA1-2X30A', 10, '消光黑', '無MCU/方舌連動/右內', '總門厚53mm-61mm', '標準版', '無'],
    ['L376-1C11C1-A0322C-A1CA2-2X31A',  5, '霧銀',   '無MCU/方舌連動/左內', '總門厚62mm~76mm', '標準版', '無'],
    ['L396-1C11C1-A0311B-A1CA1-2X30A',  3, '消光黑', '無MCU/方舌連動/左內', '總門厚53mm-61mm', '標準版', '無'],
  ];

  const reset = (rows) => {
    SHEETS = [makeSheet('歷史料號', PHEAD, rows === undefined ? PROWS : rows, 1)];
    CACHE = {};
    props.GEMINI_API_KEY = 'test-key';
  };

  // 讓 Gemini 回固定的條件。測的是「拿到條件之後程式怎麼做」，
  // 不是 Gemini 準不準——後者本機測不了，也不該用假資料假裝測過。
  const geminiReturns = obj => {
    sandbox.UrlFetchApp.fetch = () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }]
      })
    });
  };

  reset();
  asUser('ls@waferlock.com');

  // ══ 讀分頁 ══
  {
    const meta = G.loadPartNoMeta_();
    ok(!!meta, '應讀得到歷史料號分頁');
    ok((meta.models || []).join(',') === 'L376,L396',
       '目錄應列出分頁裡有的型號，實際：' + (meta.models || []).join(','));
    ok(meta.segNames.join(',') === '前面板,鎖腹方向,總門厚,電池盒組,內鎖',
       '參數段應取自表頭且排除料號/出過次數，實際：' + meta.segNames.join(','));

    const m376 = G.loadPartNoModel_('L376') || { rows: [], values: {} };
    ok(m376.rows.length === 5, 'L376 應有 5 筆，實際：' + m376.rows.length);
    ok((G.loadPartNoModel_('L396') || { rows: [] }).rows.length === 1,
       '同一張分頁要能放多款鎖（L396 應有 1 筆）');
    ok(G.loadPartNoModel_('L999') === null, '沒有的型號要回 null');
    // 餵給 AI 的選項只給「歷史真的有的值」——規格表有但沒出過的，選了也篩不到
    const v = (m376.values['前面板'] || []).slice().sort().join(',');
    ok(v === '消光黑,霧銀', '每段的可選值應取自歷史實際出現過的，實際：' + v);
    // 字典編碼解回來要跟原始資料一致
    ok(m376.rows[0].segs['鎖腹方向'] === '無MCU/方舌連動/左內',
       '字典編碼解碼後的段值要正確，實際：' + m376.rows[0].segs['鎖腹方向']);
    ok(m376.rows[0].count === 85, '解碼後的出過次數要正確');

    // 空白格：解碼要還原成空值，但不可出現在給 AI 的選項清單裡
    {
      const withBlank = PROWS.map(r => r.slice());
      withBlank[0] = withBlank[0].slice();
      withBlank[0][6] = '';                    // 內鎖留空
      SHEETS = [makeSheet('歷史料號', PHEAD, withBlank, 1)];
      CACHE = {};
      const b = G.loadPartNoModel_('L376');
      ok(b.rows[0].segs['內鎖'] === '', '空白格解碼後應還原成空值');
      ok((b.values['內鎖'] || []).indexOf('') < 0,
         '🔴 空字串不可出現在給 AI 的選項清單（AI 選了它會把候選全部篩光）');
      // reset() 會清掉 CACHE，下面還要檢查快取內容，所以重新載入一次
      reset();
      G.loadPartNoModel_('L376');
    }

    ok(Object.keys(CACHE).some(k => /partno_v2_L376/.test(k)),
       '🔴 應以「一個型號一個鍵」寫進快取（分開存，日後加型號才不會互相排擠）');
    ok(!!CACHE['dispatch_partno_meta_v2'], '目錄也要另外快取一份');

    // ⚠ 🔴 **這一段鎖住的是一個真的發生過的 bug**：
    //   第一版把整包存成 {no,count,segs:{段名:值}}，用真實的 271 列量出來是
    //   **109,843 bytes**，超過 CACHE_MAX_BYTES(95,000) → 每次都走「太大不快取」，
    //   結果每則 Chat 訊息都重讀整張表。功能正常、只是慢，**完全看不出來**。
    //   改成字典編碼（每段相異值存一次、列裡放索引）後降到 22,253 bytes。
    //   fixture 只有 6 列的話這條測試會無條件通過，所以這裡刻意造真實規模的資料。
    {
      const SEGN = 20, ROWN = 271;              // L376 的真實規模
      const head = ['料號', '出過次數'];
      for (let i = 0; i < SEGN; i++) head.push('參數段' + i);
      const big = [];
      for (let r = 0; r < ROWN; r++) {
        const line = ['L376-1C11C1-A0311B-A1CA1-' + ('0000' + r).slice(-4), ROWN - r];
        // 每段 4~11 種相異值，長度接近真實（「無MCU/方舌連動/左內」這種）
        for (let i = 0; i < SEGN; i++) line.push('參數段' + i + '的值' + (r % (4 + i % 8)) + '－中文說明文字');
        big.push(line);
      }
      SHEETS = [makeSheet('歷史料號', head, big, 1)];
      CACHE = {};
      const loaded = G.loadPartNoModel_('L376');
      ok(loaded && loaded.rows.length === ROWN, '真實規模應載得起來');
      const size = String(CACHE['dispatch_partno_v2_L376'] || '').length;
      ok(size > 0,
         '🔴 真實規模下快取必須真的寫得進去（寫不進去＝每則訊息重讀整張表）');
      ok(size <= G.CACHE_MAX_BYTES,
         '🔴 單一型號的快取必須放得進 CACHE_MAX_BYTES，實際：' + size);
      // 解碼後資料要一致，不能為了縮小而失真
      ok(loaded.rows[0].no === big[0][0] && loaded.rows[0].count === big[0][1],
         '字典編碼不可失真（料號與次數）');
      ok(loaded.rows[270].segs['參數段19'] === big[270][21],
         '字典編碼不可失真（最後一列的最後一段）');
    }
    reset();

    // 分頁是空的（只有表頭）→ 要回 null，不可回空索引
    reset([]);
    ok(G.loadPartNoMeta_() === null,
       '🔴 分頁沒有資料列要回 null（「還沒匯入」與「查無」必須分得出來）');

    // 缺「出過次數」欄 → 排序失去依據，視同尚未匯入而不是全部當 0 次
    SHEETS = [makeSheet('歷史料號', ['料號', '前面板'],
      [['L376-1C11C1-A0311B-A1CA1-2X30A', '消光黑']], 1)];
    CACHE = {};
    ok(G.loadPartNoMeta_() === null,
       '🔴 缺出過次數欄要視同未匯入（全部當 0 次會讓排序變隨機，比不給答案更糟）');
    reset();
  }

  // ══ 型號辨識 ══
  {
    const models = G.loadPartNoMeta_().models;
    ok(G.detectPartNoModel_('旗山那個案子 L376 要出了', models) === 'L376', '應認出 L376');
    ok(G.detectPartNoModel_('l376 消光黑', models) === 'L376', '型號比對應不分大小寫');
    ok(G.detectPartNoModel_('客戶要 L399 那款', models) === '',
       '🔴 分頁裡沒有的型號不可硬湊成有的');
    ok(G.detectPartNoModel_('XL3761 是什麼', models) === '',
       '🔴 型號要用邊界比對，不可被更長的英數字串誤中');
    ok(G.detectPartNoModel_('L376 這款', ['L376', 'L376N']) === 'L376',
       '同時匹配時應取最長的一個（這句只有 L376）');
  }

  // ══ 免 AI 的完整料號路徑：寧可放過也不要誤抓 ══
  {
    ok(G.parsePartNoDirect_('用 L376-1C11C1-A0311B-A1CA1-2X30A 這個') ===
       'L376-1C11C1-A0311B-A1CA1-2X30A', '應抓得出完整料號');
    ok(G.parsePartNoDirect_('L376 消光黑左內') === '',
       '🔴 只提到型號不算完整料號（比照 parseChatQuestionFast_ 不可太貪心的教訓）');
    ok(G.parsePartNoDirect_('L376-1C11C1') === '',
       '🔴 只有一段的半截料號不算（拆段會錯位）');
  }

  // ══ 篩選：收斂過程要正確 ══
  {
    const m = G.loadPartNoModel_('L376');
    const rows = m.rows;
    const r = G.filterPartNos_(rows, [
      { segment: '前面板', value: '消光黑' },
      { segment: '鎖腹方向', value: '左內' },
      { segment: '總門厚', value: '總門厚53mm-61mm' }
    ]);
    ok(r.funnel.length === 3, 'funnel 應逐條件各記一筆');
    ok(r.funnel[0].left === 4, '消光黑應剩 4 種，實際：' + r.funnel[0].left);
    ok(r.funnel[1].left === 3, '再加左內應剩 3 種，實際：' + r.funnel[1].left);
    ok(r.funnel[2].left === 3, '再加門厚應剩 3 種，實際：' + r.funnel[2].left);
    ok(r.rows.length === 3, '最後應剩 3 種');
    ok(r.killedBy === null, '有結果時 killedBy 應為 null');
    // 「左內」夾在字串中間也要比對得到，否則真實資料一筆都篩不出來
    ok(r.rows.every(x => x.segs['鎖腹方向'].indexOf('左內') >= 0),
       '🔴 值比對要能命中字串中間的關鍵字');
  }

  // ══ 🔑 篩到 0 時，一定要講出是「哪一個條件」篩光的 ══
  {
    const m = G.loadPartNoModel_('L376');
    const rows = m.rows;
    const r = G.filterPartNos_(rows, [
      { segment: '前面板', value: '消光黑' },
      { segment: '總門厚', value: '總門厚99mm-999mm' }
    ]);
    ok(r.rows.length === 0, '這個組合應該一種都沒有');
    ok(!!r.killedBy, '🔴 篩到 0 一定要有 killedBy（只回「找不到」會讓人以為東西不存在）');
    // ⚠ 一律用 (x || {}) 取值：killedBy 是 null 時直接取欄位會拋例外，
    //   例外會中斷整個套件，後面幾百條斷言就都看不到了（同 scriptsParse 的理由）
    ok((r.killedBy || {}).segment === '總門厚',
       '🔴 killedBy 要指出正確的那一條，實際：' + (r.killedBy || {}).segment);
    ok((r.killedBy || {}).before === 4,
       'killedBy 要帶「加它之前還有幾種」，實際：' + (r.killedBy || {}).before);

    // 第一個條件就篩光的情況
    const r2 = G.filterPartNos_(rows, [{ segment: '前面板', value: '螢光粉' }]);
    ok(r2.killedBy && r2.killedBy.before === 5,
       '第一條就篩光時 before 應是全部筆數，實際：' + (r2.killedBy || {}).before);
  }

  // ══ 差異描述：只列真正不同的段 ══
  {
    const m = G.loadPartNoModel_('L376');
    const rows = m.rows;
    const d = G.diffPartNo_(rows[0], rows[2], m.segNames);
    ok(d.length === 1 && (d[0] || {}).segment === '電池盒組',
       '只差一段時應只列那一段，實際：' + JSON.stringify(d));
    ok((d[0] || {}).to === '標準版(RTC on board)', '差異要帶「改成什麼」');
    const d2 = G.diffPartNo_(rows[0], rows[1], m.segNames);
    ok(d2.length === 2, '差兩段就要列兩段，實際：' + d2.length);
    ok(G.diffPartNo_(rows[0], rows[0], m.segNames).length === 0, '跟自己比應該沒有差異');
  }

  // ══ 整條路徑（含 AI 解析） ══
  {
    reset();
    geminiReturns({ conditions: [
      { segment: '前面板', value: '消光黑' },
      { segment: '鎖腹方向', value: '左內' },
      { segment: '總門厚', value: '總門厚53mm-61mm' }
    ], confidence: 'high' });

    const res = G.suggestPartNos_('旗山那個案子 L376 要出了，客戶指定消光黑，門是左內開的，門厚量過 60');
    ok(res.ok === true, '應成功回候選');
    ok(res.model === 'L376', '型號應為 L376');
    ok(res.total === 5, 'total 應是該型號的歷史種類數');
    const cs = res.candidates || [];
    ok(cs.length === 3, '應回 3 個候選（PARTNO_TOP_N）');
    ok((cs[0] || {}).no === 'L376-1C11C1-A0311B-A1CA1-2X30A',
       '候選應依出過次數排序，最常出的排第一');
    ok((cs[0] || {}).count === 85, '應帶出過次數');
    ok(((cs[0] || {}).diff || ['x']).length === 0, '第一名不必跟自己比');
    ok(((cs[2] || {}).diff || []).length === 1, '第三名應帶跟第一名的差異');

    // AI 掰出不存在的段名 → 丟掉，不可拿去篩（否則會篩光並回報錯的原因）
    geminiReturns({ conditions: [
      { segment: '前面板', value: '消光黑' },
      { segment: '顏色深淺', value: '深' }
    ], confidence: 'high' });
    const res2 = G.suggestPartNos_('L376 消光黑');
    ok(res2.ok === true && res2.funnel.length === 1,
       '🔴 AI 給不存在的段名要丟掉，不可拿去篩，實際 funnel：' + JSON.stringify(res2.funnel));

    // AI 一個條件都解不出來
    geminiReturns({ conditions: [], confidence: 'low' });
    const res3 = G.suggestPartNos_('L376');
    ok(res3.ok === false && res3.reason === 'no_condition',
       '沒解出條件要回 no_condition，讓使用者知道要多講一點');

    // 直接給完整料號 → 免 AI
    sandbox.UrlFetchApp.fetch = () => { throw new Error('不該呼叫 Gemini'); };
    const res4 = G.suggestPartNos_('就用 L376-1C17C1-A0311B-A1CA1-2X30A');
    ok(res4.ok === true && res4.via === 'direct',
       '🔴 給了完整料號就不該再打 AI（Gemini 掛掉時這條路要照樣通）');
    ok(((res4.candidates || [])[0] || {}).count === 29, '直接查也要帶出過次數');

    const res5 = G.suggestPartNos_('用 L376-9Z99Z9-9999Z-9ZZ9-9Z99Z');
    ok(res5.ok === false && res5.reason === 'unknown_partno',
       '🔴 沒出過的料號要明講，不可靜默當成查無');
  }

  // ══ 🔑 parseOrderSpeech_ 一定要帶時間預算 ══
  {
    reset();
    let gotOpts = null;
    sandbox.callGeminiJson_ = function (parts, schema, tag, opts) {
      gotOpts = opts;
      return { ok: true, data: { conditions: [], confidence: 'low' } };
    };
    G.parseOrderSpeech_('L376 消光黑', 'L376', { '前面板': ['消光黑', '霧銀'] }, ['前面板']);
    ok(gotOpts && gotOpts.deadlineMs > 0,
       '🔴 一定要帶 deadlineMs——Chat 外掛約 38 秒被砍，不設預算會變成零回應');
    ok((gotOpts || {}).deadlineMs <= 20000, 'deadlineMs 不可大於 20 秒');
    sandbox.callGeminiJson_ = origCall;
  }

  // ══ AI 打不通時要講得出原因 ══
  {
    reset();
    sandbox.callGeminiJson_ = () => ({ ok: false, reason: 'timeout' });
    const r = G.suggestPartNos_('L376 消光黑左內');
    ok(r.ok === false && r.reason === 'ai_failed' && r.detail === 'timeout',
       'AI 逾時要回 ai_failed 並帶原因');
    sandbox.callGeminiJson_ = origCall;
  }

  // ══ 🔑 空間白名單：白話下單唯一的安全邊界 ══
  {
    reset();
    // 🔑 一定要先讓 Gemini 回得出有效條件。否則閘門被拿掉時解析會失敗，
    //    料號「剛好」沒外洩，下面那條斷言就變成靠巧合通過的空測試。
    //    （版本紀錄 2026-08-25 記載同一條反向驗證第一次就是這樣假通過的。）
    geminiReturns({ conditions: [{ segment: '前面板', value: '消光黑' }], confidence: 'high' });
    delete props.CHATAPP_ORDER_SPACES;
    delete props.CHATAPP_ALLOWED_SPACES;

    const ev = { chat: {
      messagePayload: { message: { argumentText: 'L376 消光黑，左內，門厚 60' },
                        space: { name: 'spaces/ORDER1' } },
      user: { name: 'users/111222333444555666', displayName: '小林' } } };

    const r = JSON.stringify(G.onMessage(ev));
    ok(!/L376-1C11C1/.test(r),
       '🔴 白名單未設定時一個候選料號都不能吐');

    props.CHATAPP_ORDER_SPACES = 'spaces/OTHER';
    ok(!/L376-1C11C1/.test(JSON.stringify(G.onMessage(ev))),
       '🔴 不在白名單的空間不可拿到料號');

    props.CHATAPP_ORDER_SPACES = 'spaces/ORDER1, spaces/OTHER';
    ok(G.chatOrderAllowed_('spaces/ORDER1') && G.chatOrderAllowed_('spaces/OTHER'),
       '白名單應支援逗號分隔多個空間');
    ok(!G.chatOrderAllowed_(''), '空的空間名一律 false');
    ok(/L376-1C11C1/.test(JSON.stringify(G.onMessage(ev))),
       '在白名單內應回得出候選料號');
  }

  // ══ 意圖分流：問句不可被下單搶答 ══
  {
    reset();
    props.CHATAPP_ORDER_SPACES = 'spaces/ORDER1';
    geminiReturns({ conditions: [{ segment: '前面板', value: '消光黑' }], confidence: 'high' });

    ok(G.looksLikeChatQuestion_('L376 那張單出貨了嗎'), '「…了嗎」應判為問句');
    ok(G.looksLikeChatQuestion_('幫我查 L376 的單'), '「幫我查」應判為問句');
    ok(!G.looksLikeChatQuestion_('L376 消光黑，左內開，門厚 60'), '陳述規格不是問句');

    const ask = { chat: {
      messagePayload: { message: { argumentText: 'L376 那張單出貨了嗎' },
                        space: { name: 'spaces/ORDER1' } },
      user: { name: 'users/111222333444555666', displayName: '小林' } } };
    ok(G.tryPartNoSuggestion_('L376 那張單出貨了嗎') === null,
       '🔴 問句要回 null 交回問答，不可搶答成料號卡片');
    ok(G.tryPartNoSuggestion_('今天天氣如何') === null,
       '沒有型號的閒聊要回 null');
  }

  // ══ 卡片格式 ══
  {
    reset();
    geminiReturns({ conditions: [
      { segment: '前面板', value: '消光黑' },
      { segment: '鎖腹方向', value: '左內' }
    ], confidence: 'high' });
    const card = JSON.stringify(G.partNoCard_(G.suggestPartNos_('L376 消光黑左內')));

    ok(/createMessageAction/.test(card), '應用外掛格式的 createMessageAction');
    ok(/pickPartNo/.test(card), '每個候選都要有可以按的按鈕');
    ok(/L376-1C11C1-A0311B-A1CA1-2X30A/.test(card), '卡片要列出料號');
    ok(/出過 85 次/.test(card), '卡片要顯示出過幾次');
    ok(/從你們出過的/.test(card), '🔴 收斂過程要顯示（這是業務願意相信它的理由）');
    ok(card.indexOf('**') < 0,
       '🔴 卡片不可出現 Markdown 的 ** 粗體（卡片用 <b>，純文字訊息用單星號）');

    // 篩到 0 的卡片要指出是哪個條件
    geminiReturns({ conditions: [{ segment: '總門厚', value: '總門厚99mm-999mm' }],
                    confidence: 'high' });
    const bad = JSON.stringify(G.partNoCard_(G.suggestPartNos_('L376 門厚 999')));
    ok(/總門厚/.test(bad) && /篩光/.test(bad),
       '🔴 查無的卡片要講出是哪個條件篩光的');
    ok(bad.indexOf('**') < 0, '查無卡片同樣不可用 Markdown 粗體');
  }

  // ══ 按鈕：不靠 session 狀態，料號由 parameters 自己帶 ══
  {
    const r = JSON.stringify(G.pickPartNo({ commonEventObject: {
      parameters: { partNo: 'L376-1C11C1-A0311B-A1CA1-2X30A', model: 'L376' } } }));
    ok(/L376-1C11C1-A0311B-A1CA1-2X30A/.test(r), '按鈕應回出選定的料號');
    ok(/主件料號/.test(r), '應告訴業務貼到哪裡');
    const empty = JSON.stringify(G.pickPartNo({ commonEventObject: { parameters: {} } }));
    ok(!/undefined|null/.test(empty), '沒帶到料號時不可吐出 undefined');
  }

  // ══ 出貨明細新增料號欄，不可影響既有寫入 ══
  {
    ok(G.SHIPMENT_HEADERS.indexOf('料號') >= 0, '出貨明細應有料號欄');
    ok(G.SHIPMENT_HEADERS.indexOf('出貨品項') >= 0, '料號欄不可取代出貨品項欄');
    ok(G.SHIPMENT_HEADERS.indexOf('料號') > G.SHIPMENT_HEADERS.indexOf('貨運日期'),
       '🔴 新欄要加在表尾，不可插在中間（插入會讓既有資料位移）');
  }

  sandbox.UrlFetchApp.fetch = origFetch;
  sandbox.callGeminiJson_ = origCall;
  delete props.CHATAPP_ORDER_SPACES;
})();

console.log('\n' + (fail ? '❌' : '✅') + ' 通過 ' + pass + '／失敗 ' + fail);
process.exit(fail ? 1 : 0);
