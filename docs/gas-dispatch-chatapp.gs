/**
 * ============================================================
 * WAFERLOCK — 派工 Chat 應用程式（互動卡片：認領 + 狀態回寫）
 * ============================================================
 * 解決的痛點：簽核後通知助理鍵單，原本用 webhook 發一張「射後不理」的卡片，
 * 沒人認領時會被重複點、白 loading。這支把它換成 Chat 應用程式的互動卡片：
 *   • 卡片上有「我來處理」按鈕，按下去卡片當場對所有人變「🔵 XX 處理中」
 *   • 助理在出貨登錄頁鍵完單，卡片自動變「✅ 已完成」
 *
 * ── 安全閘門（最重要）────────────────────────────────────
 * 所有「主動貼卡片／回寫卡片」的動作都先看指令碼屬性 DISPATCH_ASSISTANT_SPACE。
 * **沒設定就整段不動作**，現有 webhook 通知照常。這讓這支可以先部署、擺著不生效，
 * 等 Chat 應用程式在 GCP 設定好、裝進空間、拿到空間 ID 之後再「開燈」，
 * 中間完全不影響正式簽核流程。每個對外呼叫也都包 try，壞掉不連累主流程。
 *
 * ── 為什麼跟簽核放同一個 Apps Script 專案 ──────────────────
 * 卡片要顯示的欄位（發包單號、客戶、型號）與回寫狀態，都要讀同一批 COL_ 常數
 * 和出貨明細表。分專案就要複製一份，之後各自漂移（同儀表板的教訓）。
 * 一個專案可以同時是「網頁應用程式」和「Chat 應用程式」——進入點不同，互不干擾。
 *
 * ── Chat 應用程式進入點（GCP 的 Chat API 設定頁指定這些函式）──────
 *   onMessage(event)        使用者直接傳訊給應用程式
 *   onAddToSpace(event)     應用程式被加進空間（會 log 空間 ID，方便設定 DISPATCH_ASSISTANT_SPACE）
 *   onRemoveFromSpace(e)    被移除
 *   onCardClick(event)      卡片按鈕被按（靠 event.common.invokedFunction 分派）
 *
 * ── app 認證：服務帳戶 JWT，不走進階 Chat 服務 ──────────────
 * 「主動貼卡片 / 回寫卡片」是以 app 身分呼叫 Chat API，需要 chat.bot 權限。
 * chat.bot 是 app 專屬、**不能由使用者授權**（硬走會撞 invalid_scope）。
 * 所以這裡用「服務帳戶簽 JWT 換 token」的標準做法：
 *   chatAppToken_() 讀屬性裡的服務帳戶金鑰 → 簽 JWT → 換 access token（chat.bot）
 *   再用 UrlFetchApp 直接打 Chat REST API（不用進階 Chat 服務）。
 * 好處：appsscript.json 維持原樣、chat.bot 永不進使用者授權、正式簽核零影響。
 *
 * 互動回應（按鈕→UPDATE_MESSAGE）是「回應」不是「呼叫」，不需要 token，
 * Chat 執行環境自己處理。
 * ============================================================
 */

var CHATAPP_SPACE_PROP = 'DISPATCH_ASSISTANT_SPACE';  // 助理群組空間，格式 spaces/XXXXXXX
var CHATAPP_SA_PROP = 'CHAT_APP_SA_KEY';              // 服務帳戶金鑰 JSON（整個貼進屬性，別進程式碼）
var CHATAPP_TOKEN_CACHE = 'chatapp_sa_token_v1';     // access token 快取（省得每次都簽 JWT）
var CHATCARD_SHEET = 'Chat卡片對照';                   // 案件↔訊息ID 對照（回寫用，不存在自動建）

// ────────────────────────────────────────────── 設定用測試工具（在編輯器手動執行）

/**
 * 一鍵測試：貼一張假的認領卡片到助理群組空間。
 * 用途：設定服務帳戶＋DISPATCH_ASSISTANT_SPACE 之後，在 Apps Script 編輯器選這支按執行，
 * 立刻驗證「服務帳戶認證 → 以 app 身分貼卡片」整條通不通，不必等真的簽核。
 * 成功 → 群組會出現一張「待鍵單：TEST-…」卡片，可按「我來處理」測認領。
 * 失敗 → 執行記錄會有明確錯誤（多半是金鑰或空間 ID 沒設對）。
 */
/**
 * 列出「派工小幫手」目前在哪些空間，印出**正確的 API 空間 ID**。
 * 用途：瀏覽器網址的 room/XXX 常跟 API 的 spaces/XXX 不同，導致貼卡片 404。
 * 在編輯器執行這支，把 log 印出的 spaces/XXX 設進 DISPATCH_ASSISTANT_SPACE 才會對。
 */
function listMySpaces() {
  var res = chatApi_('get', 'https://chat.googleapis.com/v1/spaces', null);
  var arr = (res && res.spaces) || [];
  if (!arr.length) {
    Logger.log('⚠ 這個 app 目前不在任何空間。請先在 Google Chat 把「派工小幫手」加進助理群組。');
    return arr;
  }
  Logger.log('派工小幫手在以下空間（把要用的那個 name 設進 DISPATCH_ASSISTANT_SPACE）：');
  for (var i = 0; i < arr.length; i++) {
    Logger.log('  ' + (arr[i].displayName || '(無名稱/私訊)') + '　→　' + arr[i].name);
  }
  return arr;
}

function testPostClaimCard() {
  var r = postShipClaimCard_({
    orderNo: 'TEST-' + Utilities.formatDate(new Date(), TZ, 'HHmmss'),
    customer: '測試客戶', model: '（測試卡片）', qty: '1', worker: '—'
  });
  Logger.log(r.posted ? '✅ 已貼出測試卡片：' + r.name
    : '❌ 未貼出：' + r.reason + '（檢查 CHAT_APP_SA_KEY 與 DISPATCH_ASSISTANT_SPACE）');
  return r;
}

// ────────────────────────────────────────────── app 認證（服務帳戶 JWT）

/**
 * 以服務帳戶身分取得 chat.bot 的 access token。快取 55 分鐘（token 有效 60 分）。
 * 金鑰放在指令碼屬性 CHAT_APP_SA_KEY（整份 service account JSON），不硬編碼。
 */
function chatAppToken_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CHATAPP_TOKEN_CACHE);
  if (hit) return hit;

  var raw = PropertiesService.getScriptProperties().getProperty(CHATAPP_SA_PROP);
  if (!raw) throw new Error('未設定 ' + CHATAPP_SA_PROP + '（服務帳戶金鑰），Chat app 無法以自身身分發訊息');
  var sa = JSON.parse(raw);

  var now = Math.floor(Date.now() / 1000);
  var header = { alg: 'RS256', typ: 'JWT' };
  var claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/chat.bot',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  var b64 = function (obj) {
    return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  };
  var toSign = b64(header) + '.' + b64(claim);
  var sig = Utilities.computeRsaSha256Signature(toSign, sa.private_key);
  var assertion = toSign + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');

  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    },
    muteHttpExceptions: true
  });
  var body = JSON.parse(resp.getContentText() || '{}');
  if (!body.access_token) {
    throw new Error('取得 app token 失敗 HTTP ' + resp.getResponseCode() + '：' +
      (body.error_description || body.error || resp.getContentText().slice(0, 200)));
  }
  cache.put(CHATAPP_TOKEN_CACHE, body.access_token, 55 * 60);
  return body.access_token;
}

/** 以 app 身分打 Chat REST API。method=get 查詢、post 建訊息、patch 改訊息。回傳解析後的 JSON。 */
function chatApi_(method, url, payloadObj) {
  var opt = {
    method: method,
    headers: { Authorization: 'Bearer ' + chatAppToken_() },
    muteHttpExceptions: true
  };
  // GET 不帶 body；帶了 payload UrlFetchApp 會出問題
  if (payloadObj != null && method !== 'get') {
    opt.contentType = 'application/json; charset=UTF-8';
    opt.payload = JSON.stringify(payloadObj);
  }
  var resp = UrlFetchApp.fetch(url, opt);
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Chat API ' + method + ' 失敗 HTTP ' + code + '：' + body.slice(0, 300));
  }
  return JSON.parse(body || '{}');
}

// ────────────────────────────────────────────── 回應格式（Workspace 外掛程式）

// ⚠ 外掛程式模式的回應格式跟傳統 Chat app 完全不同：
//   傳統：{ text } 或 { actionResponse:{type:'UPDATE_MESSAGE'}, cardsV2 }
//   外掛：{ hostAppDataAction:{ chatDataAction:{ createMessageAction|updateMessageAction:{ message } }}}
//   回錯格式，函式明明執行成功，Chat 仍顯示「無法處理你的要求」（本專案實測踩過）。

/** 回一則文字訊息（外掛格式）。 */
function chatText_(text) {
  return { hostAppDataAction: { chatDataAction: { createMessageAction: {
    message: { text: text } } } } };
}

/** 更新「按鈕所在」的那張卡片（外掛格式）。 */
function chatUpdateCard_(cardsV2) {
  return { hostAppDataAction: { chatDataAction: { updateMessageAction: {
    message: { cardsV2: cardsV2 } } } } };
}

// ────────────────────────────────────────────── 進入點

/**
 * 使用者直接傳訊給應用程式。這支 app 不是聊天機器人，只回一句導引。
 * 有這個函式，app 在 GCP 設定才算完整（缺 onMessage 會被判定沒 App logic）。
 */
function onMessage(event) {
  return chatText_('我是派工小幫手 🛠️\n我會在主管簽核後，把待鍵單的案件卡片貼到助理群組，' +
    '卡片上按「我來處理」就能認領，其他人就知道有人接手了。');
}

/**
 * 被加進空間時打招呼，並**在 log 印出這個空間的資源名稱**——
 * 這就是要填進指令碼屬性 DISPATCH_ASSISTANT_SPACE 的值（spaces/XXXX）。
 * 加進助理群組後，來這裡（或執行記錄）把那串複製出來設定即可。
 */
function onAddToSpace(event) {
  var space = (event && event.space && event.space.name) || '(未知)';
  Logger.log('✅ 派工小幫手已加入空間：' + space +
    '　→ 若這是助理群組，請把這串設進指令碼屬性 ' + CHATAPP_SPACE_PROP);
  return chatText_('大家好，我是派工小幫手 🛠️\n之後主管一簽核，待鍵單的案件會出現在這裡，按「我來處理」就能認領。');
}

function onRemoveFromSpace(event) {
  Logger.log('派工小幫手被移出空間：' + ((event && event.space && event.space.name) || '(未知)'));
}

/**
 * 「我來處理」按鈕的直接進入點。
 *
 * ⚠ Workspace 外掛程式模式的關鍵差異（實測 "Script function not found: claimShipment" 得知）：
 *   按鈕的 onClick.action.function 值會被 Chat **直接當成函式名呼叫**，
 *   不是像傳統 Chat app 那樣統一進 onCardClick 再靠 invokedFunction 分派。
 *   所以按鈕寫 function:'claimShipment' 就必須有一個頂層 claimShipment(event)。
 */
function claimShipment(event) {
  return handleClaimShipment_(event);
}

/**
 * 傳統 Chat app 模式的統一入口（外掛程式模式用不到，保留以防日後切換模式）。
 */
function onCardClick(event) {
  var fn = (event && event.common && event.common.invokedFunction) || '';
  if (fn === 'claimShipment') return handleClaimShipment_(event);
  return chatText_('（這顆按鈕我還不會處理：' + fn + '）');
}

// ────────────────────────────────────────────── 認領

/**
 * 「我來處理」被按下：
 *   1. 若已被別人認領 → 不覆蓋，回原認領狀態（兩人同時按的競態）
 *   2. 否則記認領（對照表 + 稽核），把卡片改成「🔵 XX 處理中」
 * 認領人身分一律取自 Chat 事件（event.user），不接受前端塞——不限身分不等於可冒名。
 */
function handleClaimShipment_(event) {
  var p = (event.common && event.common.parameters) || {};
  var orderNo = String(p.orderNo || '').trim();
  var shipNo = String(p.shipNo || '').trim();
  var user = event.user || {};
  var byName = user.displayName || user.email || '(不明使用者)';
  var at = Utilities.formatDate(new Date(), TZ, 'MM/dd HH:mm');

  var info = { orderNo: orderNo, shipNo: shipNo,
    customer: String(p.customer || ''), model: String(p.model || ''),
    qty: String(p.qty || ''), worker: String(p.worker || ''),
    link: deepLink_({ page: 'ship', dn: orderNo }) };

  var updated = { status: 'claimed', by: byName, at: at };
  try {
    var existing = readCardState_(orderNo);
    if (existing && existing.status === 'claimed' && existing.by && existing.by !== byName) {
      // 已被別人認領：尊重先到的，卡片維持顯示原認領人
      updated = { status: 'claimed', by: existing.by, at: existing.at || at };
    } else {
      setCardClaim_(orderNo, byName, at);
      try {
        appendAudit_(chatCardSpreadsheet_(), {
          at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
          who: user.email || byName, role: '助理', orderNo: orderNo || shipNo,
          action: '認領鍵單', note: 'Chat 卡片認領' + (shipNo ? '｜出貨單號 ' + shipNo : ''),
          sheet: CHATCARD_SHEET, row: ''
        });
      } catch (eA) { Logger.log('認領稽核寫入失敗（認領本身已成功）：' + eA); }
    }
  } catch (err) {
    Logger.log('認領處理失敗，仍嘗試更新卡片：' + err);
  }

  return chatUpdateCard_(buildShipCard_(info, updated));
}

// ────────────────────────────────────────────── 卡片

/**
 * 建鍵單案件卡片。state.status：open（待認領）/ claimed（處理中）/ done（已完成）。
 * open 才有「我來處理」按鈕；claimed/done 只剩狀態列與深連結，按鈕消失不能再點。
 */
function buildShipCard_(info, state) {
  var header = { title: '待鍵單：' + (info.orderNo || info.shipNo || '案件'),
    subtitle: (info.customer || '') + (info.model ? '　' + info.model : '') +
      (info.qty ? ' ×' + info.qty : '') };

  var lines = [];
  if (info.worker) lines.push('承包商：' + esc_(info.worker));
  if (info.customer) lines.push('客戶：' + esc_(info.customer));
  if (info.model) lines.push('型號：' + esc_(info.model) + (info.qty ? ' × ' + esc_(info.qty) : ''));

  var statusWidget;
  if (state.status === 'claimed') {
    statusWidget = { textParagraph: { text: '<b>🔵 ' + esc_(state.by) + ' 處理中</b>　' + esc_(state.at || '') } };
  } else if (state.status === 'done') {
    statusWidget = { textParagraph: { text: '<b>✅ 已完成</b>　' + esc_(state.by || '') + '　' + esc_(state.at || '') } };
  } else {
    statusWidget = { textParagraph: { text: '<b>⏳ 待認領</b>　按「我來處理」接手' } };
  }

  var buttons = [];
  // 只有「待認領」狀態才放認領按鈕；認領/完成後拿掉，避免重複點
  if (state.status === 'open') {
    buttons.push({ text: '✋ 我來處理',
      onClick: { action: { function: 'claimShipment', parameters: [
        { key: 'orderNo', value: info.orderNo || '' },
        { key: 'shipNo', value: info.shipNo || '' },
        { key: 'customer', value: info.customer || '' },
        { key: 'model', value: info.model || '' },
        { key: 'qty', value: info.qty || '' },
        { key: 'worker', value: info.worker || '' }
      ] } } });
  }
  if (info.link) {
    buttons.push({ text: '➡ 開這一筆鍵單', onClick: { openLink: { url: info.link } } });
  }

  var widgets = [];
  if (lines.length) widgets.push({ textParagraph: { text: lines.join('<br>') } });
  widgets.push(statusWidget);
  if (buttons.length) widgets.push({ buttonList: { buttons: buttons } });

  return [{ cardId: 'ship-' + (info.orderNo || info.shipNo || 'x'),
    card: { header: header, sections: [{ widgets: widgets }] } }];
}

// ────────────────────────────────────────────── 主動貼卡片 / 回寫（進階 Chat 服務）

/**
 * 主動把「待認領」卡片貼到助理群組空間。由 notifyAssistant_ 呼叫。
 *
 * **閘門**：DISPATCH_ASSISTANT_SPACE 沒設就直接 return，不動作——
 * 這讓整支在 Chat 應用程式還沒裝好之前完全休眠，webhook 通知照舊。
 */
function postShipClaimCard_(rec) {
  var space = String(PropertiesService.getScriptProperties()
    .getProperty(CHATAPP_SPACE_PROP) || '').trim();
  if (!space) return { posted: false, reason: '未設定 ' + CHATAPP_SPACE_PROP + '（Chat 卡片休眠中）' };

  var info = { orderNo: rec.orderNo || '', shipNo: rec.shipNo || '',
    customer: rec.customer || '', project: rec.project || '',
    model: rec.model || '', qty: rec.qty || '', worker: rec.worker || '',
    link: deepLink_({ page: 'ship', dn: rec.orderNo }) };

  // POST https://chat.googleapis.com/v1/{space}/messages
  // space 形如 spaces/XXX，斜線是路徑分隔，不能 encodeURIComponent（會變 %2F 打錯 API）
  var msg = chatApi_('post',
    'https://chat.googleapis.com/v1/' + space + '/messages',
    { cardsV2: buildShipCard_(info, { status: 'open' }) });
  // 存訊息名稱，之後鍵完單才找得到這張卡去回寫
  try { recordCardPosted_(info, space, msg.name); }
  catch (eR) { Logger.log('卡片對照寫入失敗（卡片已貼出）：' + eR); }
  return { posted: true, name: msg.name };
}

/**
 * 助理在出貨登錄頁鍵完單後，把對應卡片改成「✅ 已完成」。由 fillShipmentAs_ 呼叫。
 * 找不到卡片（沒貼過、或閘門關著時建的單）就安靜跳過——不是每張單都有卡片。
 */
function markShipClaimDone_(orderNo, byEmail) {
  var st = readCardState_(orderNo);
  if (!st || !st.messageName) return { done: false, reason: '查無卡片' };

  var at = Utilities.formatDate(new Date(), TZ, 'MM/dd HH:mm');
  var info = { orderNo: orderNo, shipNo: st.shipNo || '', customer: st.customer || '',
    model: st.model || '', qty: st.qty || '', worker: st.worker || '',
    link: deepLink_({ page: 'ship', dn: orderNo }) };

  // PATCH https://chat.googleapis.com/v1/{message.name}?updateMask=cardsV2
  chatApi_('patch',
    'https://chat.googleapis.com/v1/' + st.messageName + '?updateMask=cardsV2',
    { cardsV2: buildShipCard_(info, { status: 'done', by: byEmail, at: at }) });
  try { setCardDone_(orderNo, byEmail, at); } catch (eS) { Logger.log('卡片對照更新完成狀態失敗：' + eS); }
  return { done: true };
}

// ────────────────────────────────────────────── 對照表（案件↔訊息ID↔狀態）

function chatCardSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('DISPATCH_SHEET_ID');
  if (!id) throw new Error('未設定指令碼屬性 DISPATCH_SHEET_ID');
  return SpreadsheetApp.openById(id);
}

var CHATCARD_HEAD = ['發包單號', '出貨單號', '客戶', '型號', '數量', '承包商',
  'space', 'messageName', '狀態', '認領人', '認領時間', '完成人', '完成時間', '建立時間'];

function chatCardSheet_() {
  var ss = chatCardSpreadsheet_();
  var sh = ss.getSheetByName(CHATCARD_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CHATCARD_SHEET);
    sh.appendRow(CHATCARD_HEAD);
    sh.setFrozenRows(1);
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var i = 0; i < head.length; i++) {
    var k = normHeader_(head[i]);
    if (k && !col[k]) col[k] = i + 1;
  }
  // 表頭被清過就補回來，資料才不會落在沒標題的欄
  if (!col[normHeader_('發包單號')]) {
    sh.getRange(1, 1, 1, CHATCARD_HEAD.length).setValues([CHATCARD_HEAD]);
    col = {};
    for (var j = 0; j < CHATCARD_HEAD.length; j++) col[normHeader_(CHATCARD_HEAD[j])] = j + 1;
  }
  return { ss: ss, sheet: sh, col: col };
}

/** 用發包單號找對照列（無則 0）。發包單號空時退用出貨單號比對。 */
function findCardRow_(orderNo, shipNo) {
  var s = chatCardSheet_();
  var last = s.sheet.getLastRow();
  if (last < 2) return { s: s, row: 0 };
  var cO = s.col[normHeader_('發包單號')], cS = s.col[normHeader_('出貨單號')];
  var vals = s.sheet.getRange(2, 1, last - 1, s.sheet.getLastColumn()).getValues();
  for (var i = 0; i < vals.length; i++) {
    var o = String(vals[i][cO - 1] || '').trim(), sh = String(vals[i][cS - 1] || '').trim();
    if ((orderNo && o === orderNo) || (!orderNo && shipNo && sh === shipNo)) {
      return { s: s, row: i + 2, values: vals[i] };
    }
  }
  return { s: s, row: 0 };
}

function recordCardPosted_(info, space, messageName) {
  var s = chatCardSheet_();
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  var row = {};
  row[normHeader_('發包單號')] = info.orderNo || '';
  row[normHeader_('出貨單號')] = info.shipNo || '';
  row[normHeader_('客戶')] = info.customer || '';
  row[normHeader_('型號')] = info.model || '';
  row[normHeader_('數量')] = info.qty || '';
  row[normHeader_('承包商')] = info.worker || '';
  row[normHeader_('space')] = space;
  row[normHeader_('messageName')] = messageName;
  row[normHeader_('狀態')] = 'open';
  row[normHeader_('建立時間')] = stamp;
  var width = s.sheet.getLastColumn();
  var out = [];
  for (var c = 0; c < width; c++) out.push('');
  for (var k in row) if (s.col[k]) out[s.col[k] - 1] = row[k];
  s.sheet.appendRow(out);
}

/** 讀某案件目前的卡片狀態，回 {status, by, at, messageName, shipNo, customer, model, qty, worker} 或 null。 */
function readCardState_(orderNo, shipNo) {
  var hit = findCardRow_(orderNo, shipNo);
  if (!hit.row) return null;
  var v = hit.values, col = hit.s.col;
  var get = function (name) { var c = col[normHeader_(name)]; return c ? String(v[c - 1] || '').trim() : ''; };
  return { status: get('狀態') || 'open', by: get('認領人'), at: get('認領時間'),
    messageName: get('messageName'), shipNo: get('出貨單號'), customer: get('客戶'),
    model: get('型號'), qty: get('數量'), worker: get('承包商') };
}

function setCardClaim_(orderNo, byName, at) {
  var hit = findCardRow_(orderNo);
  if (!hit.row) return;
  var s = hit.s;
  s.sheet.getRange(hit.row, s.col[normHeader_('狀態')]).setValue('claimed');
  s.sheet.getRange(hit.row, s.col[normHeader_('認領人')]).setValue(byName);
  s.sheet.getRange(hit.row, s.col[normHeader_('認領時間')]).setValue(at);
}

function setCardDone_(orderNo, byName, at) {
  var hit = findCardRow_(orderNo);
  if (!hit.row) return;
  var s = hit.s;
  s.sheet.getRange(hit.row, s.col[normHeader_('狀態')]).setValue('done');
  s.sheet.getRange(hit.row, s.col[normHeader_('完成人')]).setValue(byName);
  s.sheet.getRange(hit.row, s.col[normHeader_('完成時間')]).setValue(at);
}
