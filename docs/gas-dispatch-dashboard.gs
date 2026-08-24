/**
 * ============================================================
 * WAFERLOCK — 派工／出貨 儀表板（Dashboard）
 * ============================================================
 * 這支是「看整條鏈卡在哪」的頁面，不是操作頁。
 * 操作頁（下單／簽核／出貨登錄／倉庫核單）都在 gas-dispatch-approval.gs，
 * 儀表板每一格數字點下去就是跳到那些頁，追溯與退回沿用既有機制。
 *
 * ── 為什麼放在同一個 Apps Script 專案而不是另開一個 ──────────
 * 角色名單來自 **Script Properties**（DISPATCH_ASSISTANTS 等），
 * 而 Script Properties 是綁在單一專案上的。另開專案就要維護第二份名單，
 * 人員異動時一定會漏掉一邊，症狀是「儀表板看得到、點進去說沒權限」，很難查。
 * 欄位常數、讀表邏輯、esc_／htmlPage_ 也全都要複製一份，之後各自漂移。
 *
 * ── 這支檔案的兩條禁令 ──────────────────────────────────
 * 1. **不可以讓例外跑到 doGet 外面**。簽核是有時效的作業，
 *    儀表板掛掉不能連累它，所以每一區讀取各自 try/catch，
 *    單區失敗只顯示「本區無法載入」，其餘照常。
 * 2. 不可以動 CACHE_KEY／WH_CACHE_KEY 等既有快取，本檔用自己的 DASH_CACHE_KEY。
 *
 * ── 新鮮度 vs 速度（2026-08-24 修正）────────────────────
 * 第一版為了新鮮度，刻意呼叫未快取的 getPending_()／getShippable_()，
 * 結果 getDashboardStats 實測 **24～32 秒**（兩趟全分頁掃描），完全不能用。
 *
 * 改為沿用既有的預熱快取：warmCache() 觸發器已經每 10 分鐘把
 * 待簽核／待出貨／待核單三份掃好放進 CacheService，讀它們是毫秒級。
 * 儀表板因此變成純快取讀取，**開頁 1 秒內**。
 *
 * 代價是數字最舊可能是一個預熱週期前的。兩個補償措施：
 *   1. 畫面標示資料時間與「N 分鐘前」，不假裝是即時的
 *   2. 提供「立即重算」按鈕，需要當下數字時自己觸發（會等 20～30 秒，但是使用者自己選的）
 * 要更即時就把 warmCache 的觸發器間隔調短（設定層，不必改程式）。
 * ============================================================
 */

var DASH_CACHE_KEY = 'dispatch_dashboard_v1';
// TTL 必須**大於預熱間隔**（warmCache 觸發器目前 10 分鐘），否則兩次預熱之間
// 快取會過期，那個倒楣的使用者就會踩到 20～30 秒的冷掃描。與既有 CACHE_TTL 同值。
var DASH_CACHE_TTL = 900;  // 秒（15 分鐘），預熱每 10 分鐘，留 5 分鐘餘裕

/**
 * 儀表板頁面。由 gas-dispatch-approval.gs 的 doGet 在 page === 'home' 時呼叫。
 */
function renderDashboard_(email, roles) {
  return htmlPage_(navBlock_('home', roles) + dashBlock_(email, roles));
}

/**
 * 前端輪詢的伺服器端入口（google.script.run 呼叫）。
 *
 * ⚠ 這裡**必須自己再檢查一次身分**：google.script.run 是獨立的請求，
 *   不會經過 doGet 的閘門，前端傳什麼都不能信。
 */
function getDashboardStats() {
  var email = currentUserEmail_();
  if (!email) return { error: '無法辨識身分，請用公司 Google 帳號登入' };
  var roles = rolesFor_(email);
  return dashCounts_(roles);
}

/**
 * 算出各格數字。60 秒快取，多人同時開也只會實際掃一次表。
 *
 * 可見範圍：主管／副主管看得到全部（他們本來就看得到含金額的報表）；
 * 其他角色只看得到自己負責的那幾關——倉庫不需要知道公司今天接了幾張單。
 */
function dashCounts_(roles) {
  var cache = CacheService.getScriptCache();

  var raw = null;
  try {
    var hit = cache.get(DASH_CACHE_KEY);
    if (hit) raw = JSON.parse(hit);
  } catch (err) {
    Logger.log('儀表板快取讀取失敗，改為即時掃描：' + err);   // 快取壞掉不能讓頁面停擺
  }

  if (!raw) {
    raw = scanAll_(true);   // true = 用已預熱的快取，毫秒級
    try {
      cache.put(DASH_CACHE_KEY, JSON.stringify(raw), DASH_CACHE_TTL);
    } catch (err) {
      Logger.log('儀表板快取寫入失敗（不影響顯示）：' + err);
    }
  }

  return packCards_(raw, roles);
}

/**
 * 依角色決定送哪幾格。沒有權限的格子**不送數字**，而不是送了再由前端隱藏。
 * dashCounts_ 與 refreshDashboard 共用，避免兩邊的權限規則各自漂移。
 */
function packCards_(raw, roles) {
  var full = !!(roles.boss || roles.sub);
  var cards = [];
  if (full) {
    cards.push(card_('today', '今日下單', raw.todayOrders, 'query', raw.err.dispatch));
  }
  if (full || roles.sub) {
    cards.push(card_('sub', '待副主管簽核', raw.waitSub, 'approve', raw.err.dispatch));
  }
  if (full || roles.boss) {
    cards.push(card_('boss', '待主管簽核', raw.waitBoss, 'approve', raw.err.dispatch));
  }
  if (full || roles.assistant) {
    cards.push(card_('ship', '已簽核待鍵單', raw.waitShip, 'ship', raw.err.dispatch));
  }
  if (full || roles.warehouse) {
    cards.push(card_('wh', '待倉庫核單', raw.waitWh, 'warehouse', raw.err.shipment));
  }
  if (full || roles.warehouse || roles.assistant) {
    cards.push(card_('ret', '退單處理中', raw.returning, 'warehouse', raw.err.shipment));
  }
  return { cards: cards, at: raw.at, ts: raw.ts || 0 };
}

/**
 * 「立即重算」按鈕的入口：清掉儀表板快取後強制重掃。
 *
 * 會跑 20～30 秒（兩趟全分頁掃描），但這是使用者自己按下去換來的當下數字，
 * 跟「每次開頁都等 30 秒」是完全不同的事。
 * 刻意不順便清掉既有的三份快取——那是簽核／出貨頁在用的，
 * 儀表板不該有權讓別人的頁面變慢。
 */
function refreshDashboard() {
  var email = currentUserEmail_();
  if (!email) return { error: '無法辨識身分，請用公司 Google 帳號登入' };
  var roles = rolesFor_(email);
  try {
    CacheService.getScriptCache().remove(DASH_CACHE_KEY);
  } catch (err) {
    Logger.log('清除儀表板快取失敗（仍會重掃）：' + err);
  }
  var raw = scanAll_(false);   // false = 不吃快取，實際重掃
  try {
    CacheService.getScriptCache().put(DASH_CACHE_KEY, JSON.stringify(raw), DASH_CACHE_TTL);
  } catch (err) {
    Logger.log('儀表板快取寫入失敗（不影響本次顯示）：' + err);
  }
  return packCards_(raw, roles);
}

/**
 * 併進既有 warmCache() 的預熱項目。
 * 由 gas-dispatch-approval.gs 的 warmCache() 在三份快取都更新完之後呼叫，
 * 這樣它讀到的已經是新鮮的快取，不會再多掃一次表。
 */
function warmDashboardCache() {
  var raw = scanAll_(true);   // 三份快取剛被 warmCache 更新過，讀它們即可
  CacheService.getScriptCache().put(DASH_CACHE_KEY, JSON.stringify(raw), DASH_CACHE_TTL);
  return raw;
}

function card_(key, label, value, page, errMsg) {
  return { key: key, label: label, value: value, page: page, err: errMsg || '' };
}

/**
 * 掃出各關卡件數。
 *
 * @param {boolean} useCache true＝讀 warmCache() 已預熱的快取（毫秒級，資料可能舊幾分鐘）；
 *                           false＝強制重掃（20～30 秒，只有「立即重算」按鈕會用）。
 *
 * 兩個來源各自 try/catch——某一張表壞掉時其他格子還是要看得到，
 * 而不是整頁變成一則錯誤訊息。
 */
function scanAll_(useCache) {
  var out = {
    todayOrders: 0, waitSub: 0, waitBoss: 0, waitShip: 0, waitWh: 0, returning: 0,
    err: { dispatch: '', shipment: '' },
    at: Utilities.formatDate(new Date(), TZ, 'HH:mm'),
    ts: new Date().getTime()   // 前端用這個算「N 分鐘前」，不假裝數字是即時的
  };
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  // ── 發包單：待副簽、待主簽、今日下單（未簽核的部分）──
  var pend = null;
  try {
    pend = useCache ? getPendingCached_().rows : getPending_();
    for (var i = 0; i < pend.length; i++) {
      if (pend[i].stage === 'sub') out.waitSub++;
      else if (pend[i].stage === 'boss') out.waitBoss++;
      if (isToday_(pend[i].applyAt, today)) out.todayOrders++;
    }
  } catch (err) {
    out.err.dispatch = String(err);
  }

  // ── 已簽核待鍵單，以及今日下單（已簽核的部分）──
  // 今日下單量＝今天申請的單，不分簽核與否，所以兩邊都要算。
  // getShippable_() 是「已簽核但還沒出現在出貨登錄」的單，與上面的待核清單不重疊。
  try {
    var shippable = useCache ? getShippableCached_().rows : getShippable_();
    out.waitShip = shippable.length;
    for (var j = 0; j < shippable.length; j++) {
      if (isToday_(shippable[j].applyAt, today)) out.todayOrders++;
    }
  } catch (err) {
    if (!out.err.dispatch) out.err.dispatch = String(err);
  }

  // ── 出貨登錄：待倉庫核單、退單處理中 ──
  try {
    out.waitWh = (useCache ? getWarehouseCached_().rows : getWarehousePending_()).length;
    out.returning = countReturning_();
  } catch (err) {
    out.err.shipment = String(err);
  }

  return out;
}

/**
 * 申請日是不是今天。
 * 試算表的日期欄可能是日期物件被格式化過的字串，也可能是純文字，
 * 格式不保證一致（實際資料看過 yyyy-MM-dd 與 yyyy/MM/dd 都有），
 * 所以正規化後再比，不直接用 indexOf。
 */
function isToday_(v, todayStr) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return s.replace(/\//g, '-').indexOf(todayStr) === 0;
}

/**
 * 退單處理中的筆數。
 * 退單欄格式：「🔄 退單 <發起人> <時間>｜<原因>」＝申請中；
 *             「✅ 已處理 …」＝處理完。只有 🔄 開頭的才算還在處理中。
 */
function countReturning_() {
  var s = openShipmentSheet_();
  var last = s.sheet.getLastRow();
  if (last < 2) return 0;
  var c = s.col[COL_S_RETURN];
  if (!c) return 0;   // 還沒有這一欄＝退單功能尚未部署到雲端，回 0 而不是報錯
  var vals = s.sheet.getRange(2, c, last - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').indexOf('🔄') === 0) n++;
  }
  return n;
}

/**
 * 儀表板 HTML。
 * 骨架先送出、數字由前端輪詢填入——這樣開頁不必等掃表，
 * 也讓「掃表失敗」不會變成「整頁打不開」。
 */
function dashBlock_(email, roles) {
  var base = webAppUrl_() || '';

  var css = '<style>' +
    '.dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px;margin-bottom:12px}' +
    '.dcard{background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08);' +
      'text-decoration:none;color:inherit;display:block;border-left:4px solid #CBD5E1}' +
    '.dcard .dl{font-size:12px;color:#64748B;margin-bottom:6px}' +
    '.dcard .dv{font-size:30px;font-weight:800;color:#0F2744;line-height:1}' +
    '.dcard .du{font-size:11.5px;color:#94A3B8;margin-left:4px;font-weight:400}' +
    '.dcard.hot{border-left-color:#DC2626}.dcard.hot .dv{color:#DC2626}' +
    '.dcard.warn{border-left-color:#D97706}.dcard.warn .dv{color:#B45309}' +
    '.dcard.ok{border-left-color:#16A34A}' +
    '.dcard .de{font-size:11px;color:#DC2626;margin-top:6px;line-height:1.5}' +
    '.dbar{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#64748B;margin-bottom:10px}' +
    '.dbar .dot{width:7px;height:7px;border-radius:50%;background:#CBD5E1}' +
    '.dskel{color:#CBD5E1}' +
    '.dbtn{margin-left:auto;background:#0F2744;color:#fff;border:0;border-radius:6px;' +
      'padding:5px 11px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '.dbtn:disabled{background:#94A3B8;cursor:wait}' +
    '.dage{color:#B45309;font-weight:700}' +
    '</style>';

  var body = '<div class="hd"><div class="ic">📊</div>' +
    '<div><h1>派工出貨儀表板</h1><p>' + esc_(email) + '</p></div></div>' + css +
    '<div class="dbar"><span class="dot" id="ddot"></span><span id="dat">載入中…</span>' +
    '<button class="dbtn" id="dbtn" onclick="hardRefresh()">↻ 立即重算</button></div>' +
    '<div class="dgrid" id="dgrid">' +
      '<div class="dcard"><div class="dl">讀取中</div><div class="dv dskel">—</div></div>' +
    '</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;line-height:1.7">' +
      '數字點下去會跳到對應的作業頁，可以在那裡追溯單據或申請退單。<br>' +
      '數字每 10 分鐘由背景自動更新一次；需要當下的即時數字，按「立即重算」（約 20～30 秒）。' +
    '</div>';

  // 前端輪詢。HtmlService 沙箱裡不能 fetch 自己的 /exec，只能用 google.script.run。
  var js = '<script>' +
    'var BASE=' + JSON.stringify(base) + ';' +
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){' +
      'return({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]||"&quot;";});}' +
    // 0 件不上色：沒事的關卡不該引起注意，有事的才要跳出來
    'function tone(k,v){if(!v)return"ok";if(k==="ret")return"hot";' +
      'if(k==="today")return"";return"warn";}' +
    'function draw(res){' +
      'var dot=document.getElementById("ddot"),at=document.getElementById("dat");' +
      'if(res&&res.error){at.textContent=res.error;dot.style.background="#DC2626";return;}' +
      // 沒有任何角色的人直接打 ?page=home 進來會是零格，要講清楚而不是留白
      'if(!res.cards||!res.cards.length){document.getElementById("dgrid").innerHTML=' +
        '"<div class=\\"dcard\\"><div class=\\"dl\\">沒有可顯示的項目</div>"+' +
        '"<div style=\\"font-size:12px;color:#64748B;line-height:1.7\\">您的帳號目前不在任何一份角色名單中"+' +
        '"（簽核／助理／倉庫）。若這不正確，請聯絡系統管理者加入。</div></div>";' +
        'at.innerHTML="資料時間 "+esc(res.at);dot.style.background="#94A3B8";return;}' +
      'var h="";' +
      'for(var i=0;i<res.cards.length;i++){var c=res.cards[i];' +
        'var href=BASE?BASE+"?page="+c.page:"#";' +
        'h+="<a class=\\"dcard "+tone(c.key,c.value)+"\\" target=\\"_top\\" href=\\""+esc(href)+"\\">"+' +
          '"<div class=\\"dl\\">"+esc(c.label)+"</div>"+' +
          '"<div class=\\"dv\\">"+(c.err?"—":c.value)+"<span class=\\"du\\">件</span></div>"+' +
          '(c.err?"<div class=\\"de\\">本區讀取失敗，其餘數字仍為最新</div>":"")+"</a>";}' +
      'document.getElementById("dgrid").innerHTML=h;' +
      'at.innerHTML="資料時間 "+esc(res.at)+age(res.ts);dot.style.background="#16A34A";}' +
    // 誠實標示資料幾分鐘前——使用者才知道什麼時候該按「立即重算」
    'function age(ts){if(!ts)return"";var m=Math.floor((Date.now()-ts)/60000);' +
      'if(m<1)return" <span class=\\"dage\\">（剛更新）</span>";' +
      'return" <span class=\\"dage\\">（"+m+" 分鐘前）</span>";}' +
    'function hardRefresh(){var b=document.getElementById("dbtn");' +
      'b.disabled=true;b.textContent="重算中…";' +
      'document.getElementById("dat").textContent="重新掃描試算表，約需 20～30 秒…";' +
      'document.getElementById("ddot").style.background="#D97706";' +
      'google.script.run.withSuccessHandler(function(r){' +
        'b.disabled=false;b.textContent="↻ 立即重算";draw(r);})' +
      '.withFailureHandler(function(e){b.disabled=false;b.textContent="↻ 立即重算";fail(e);})' +
      '.refreshDashboard();}' +
    'function fail(e){document.getElementById("dat").textContent="更新失敗："+e;' +
      'document.getElementById("ddot").style.background="#DC2626";}' +
    'function poll(){google.script.run.withSuccessHandler(draw).withFailureHandler(fail)' +
      '.getDashboardStats();}' +
    'poll();setInterval(poll,60000);' +
    '</script>';

  return body + js;
}
