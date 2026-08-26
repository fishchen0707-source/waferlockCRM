# 派工出貨系統截圖腳本（GAS Web App）
#
# ── 為什麼不是沿用 shoot.py ─────────────────────────────────
# shoot.py 打的是 localhost 靜態站，不需要登入。GAS Web App 是 Google 網域限定，
# 一定要帶登入狀態。
#
# ── 為什麼用「專用設定檔」而不是借用你平常的 Chrome ──────────
# 借用預設設定檔會被 Chrome 直接拒絕（2026-08-26 實測）：
#     DevTools remote debugging requires a non-default data directory.
# 這是 Chrome 的安全限制，不是設定問題，無解。
# 所以這裡開一份**獨立的**設定檔，只登入一次、之後一直沿用。
# 好處：跑截圖時不必關掉你正在用的 Chrome，也完全不會動到你的正式設定檔。
#
# ── 為什麼所有元素都要 frame_locator ────────────────────────
# GAS 的畫面實際跑在 googleusercontent.com 的沙箱 iframe 裡，
# 在最外層 page.locator 找不到任何東西（先前用瀏覽器工具讀 DOM 回傳空白就是這個原因）。
#
# ── 用法 ────────────────────────────────────────────────
#   python 教育訓練與流程/shoot_gas.py --login    第一次：開視窗讓你手動登入 Google
#   python 教育訓練與流程/shoot_gas.py --check    驗證登入還在、iframe 進得去、存得出檔
#   python 教育訓練與流程/shoot_gas.py            跑完整批次
import argparse
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "img", "raw")
# 專用設定檔放在專案外的暫存區：它含登入 cookie，不該進版控也不該被同步
PROFILE = os.path.join(os.path.expandvars("%LOCALAPPDATA%"), "waferlock-shoot-profile")

BASE = ("https://script.google.com/a/macros/waferlock.com/s/"
        "AKfycbw_Di2rLjY6grnCtOVMmQyoGGtVNZHoBh3hlA-o7XqUlZQIRriIuXcBwNpA9dTAUV-n8w/exec")

os.makedirs(OUT, exist_ok=True)
os.makedirs(PROFILE, exist_ok=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def snap(page, name):
    path = os.path.join(OUT, name + ".png")
    page.screenshot(path=path)
    kb = os.path.getsize(path) // 1024
    print(f"  截圖 {name}.png ({kb} KB)")
    return kb


def content_frame(page, timeout=45000):
    """取得**真正有內容**的那個 frame。

    ⚠ 不能用 frame_locator("iframe").first —— GAS 實際有三層 frame
    （2026-08-26 實測）：[0] 最外層 script.google.com、[1] googleusercontent
    的空殼、[2] 才是真正的畫面。抓 .first 會拿到空殼，等文字永遠等不到。

    ⚠ 也不能用「第一個 body 有字的 frame」（第一版就是這樣寫的，
    2026-08-26 拍簽核頁時截到整張白圖）：外層殼偶爾會先帶幾個字回來，
    比真正的畫面早一步。所以改成**掃完全部 frame、挑字最多的那個**，
    而且要求至少 MIN_TEXT 個字才算數。
    """
    MIN_TEXT = 40
    waited = 0
    while waited < timeout:
        best, best_len = None, 0
        for fr in page.frames:
            try:
                n = len((fr.inner_text("body") or "").strip())
            except Exception:
                continue
            if n > best_len:
                best, best_len = fr, n
        if best is not None and best_len >= MIN_TEXT:
            return best
        page.wait_for_timeout(1000)
        waited += 1000
    raise TimeoutError("等不到有內容的 frame（可能未登入或載入失敗）")


def open_page(page, query, wait_text=None):
    """開一個 GAS 分頁並等內容真的出現。

    GAS 載入分兩段：外層殼先回來，內容還在 iframe 裡跑。
    只等 load 事件會截到整片空白（先前實測連續截到好幾張白圖）。
    """
    page.goto(f"{BASE}?{query}", wait_until="load")
    frame = content_frame(page)
    if wait_text:
        waited = 0
        while waited < 30000:
            if wait_text in (frame.inner_text("body") or ""):
                break
            page.wait_for_timeout(1000)
            waited += 1000
    # 有些頁（報表）開頁後還在跑，畫面停在「統計中…」。等它算完再拍，
    # 不然拍回來的是進度文字，手冊上什麼也教不了。
    waited = 0
    while waited < 60000:
        body = frame.inner_text("body") or ""
        if not any(k in body for k in ("統計中", "載入中", "查詢中")):
            break
        page.wait_for_timeout(2000)
        waited += 2000

    page.wait_for_timeout(1500)   # 讓字體與版面穩定，避免截到跳動中的畫面
    return frame


def do_login(ctx, wait_minutes=5):
    """開視窗讓人手動登入，然後**自動偵測**登入完成。

    刻意不用 input() 等 Enter：這支多半是被自動化流程叫起來的，
    那種情境下沒有終端機可以按 Enter，會直接卡死。改成輪詢畫面狀態。
    """
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(BASE, wait_until="load")
    print()
    print("=" * 58)
    print("  請在剛跳出來的瀏覽器視窗登入 fish.chen@waferlock.com")
    print(f"  登入完成後我會自動偵測（最多等 {wait_minutes} 分鐘）")
    print("=" * 58)
    print()

    deadline = wait_minutes * 60
    waited = 0
    while waited < deadline:
        try:
            frame = page.frame_locator("iframe").first
            if frame.locator("text=@waferlock.com").first.count():
                print("\n偵測到登入成功，設定檔已保存：")
                print(f"  {PROFILE}")
                print("以後跑截圖不必再登入，也不必關掉你自己的 Chrome。")
                return True
        except Exception:
            pass
        page.wait_for_timeout(5000)
        waited += 5
        if waited % 30 == 0:
            print(f"  等待中… {waited}s")
    print("\n逾時。若其實已經登入好了，直接跑 --check 確認即可。")
    return False


def do_check(page):
    print("開查詢頁…")
    frame = open_page(page, "page=query", wait_text="查詢")
    body = frame.inner_text("body") or ""
    import re
    m = re.search(r"[\w.\-]+@waferlock\.com", body)
    print(f"  登入身分：{m.group(0) if m else '⚠ 抓不到'}")
    kb = snap(page, "00-check")
    if kb > 15:
        print("\n可行：登入有效、iframe 進得去、檔案存得出來")
        print(f"  {os.path.join(OUT, '00-check.png')}")
    else:
        print(f"\n檔案只有 {kb} KB，可能截到空白頁")


def do_diag(page):
    """卡住時用這支：把實際看到的東西印出來，不要用猜的。"""
    page.goto(f"{BASE}?page=query", wait_until="load")
    page.wait_for_timeout(8000)
    print(f"網址：{page.url}")
    print(f"標題：{page.title()}")
    frames = page.frames
    print(f"frame 數量：{len(frames)}")
    for i, fr in enumerate(frames):
        try:
            txt = (fr.inner_text("body") or "").strip().replace("\n", " ")[:160]
        except Exception as e:
            txt = f"(讀不到：{e})"
        print(f"  [{i}] {fr.url[:70]}")
        print(f"      {txt}")
    snap(page, "00-diag")




# ── 唯讀批次：不動任何資料，純粹把每個頁面拍下來 ──────────────
# 刻意跟「建測試單」分開成兩個指令。這一批重跑幾次都沒有副作用，
# 拍壞了直接再跑一次；建單那批會在正式試算表留下紀錄，不能亂跑。
#
# 編號從 30 開始：img/ 底下 01–29 是既有 CRM 手冊的圖，不能撞號。
PAGES = [
    # (檔名, 網址參數, 等這段文字出現, 進頁後要先點的按鈕 id)
    ("30-gas-home",          "page=home",      "首頁",     None),
    ("31-gas-order-install", "page=order",     "下單",     "#k0"),
    ("32-gas-order-parts",   "page=order",     "下單",     "#k1"),
    ("33-gas-order-quick",   "page=order",     "下單",     "#k2"),
    ("34-gas-approve",       "page=approve",   "簽核",     None),
    ("35-gas-ship",          "page=ship",      "出貨登錄", None),
    ("36-gas-warehouse",     "page=warehouse", "倉庫核單", None),
    ("37-gas-shipdoc",       "page=shipdoc",   "貨運單",   None),
    ("38-gas-query",         "page=query",     "查詢",     None),
    ("39-gas-report",        "page=report",    "報表",     None),
]


# ── 去識別化 ──────────────────────────────────────────────
# 正式環境的清單頁拍下來就是真實訂單：客戶姓名、聯絡電話、送貨地址、
# 承包商、售價與進價全都在圖上（2026-08-26 首批實拍確認）。
# 這份手冊要發給業務／助理／主管／倉庫四個部門，那些資料不能跟著散出去，
# 進價更是一露出來就等於把成本結構攤開。
#
# 為什麼用「替換成範例值」而不是「打上馬賽克」：
#   手冊要教的是「這一格要看什麼、要填什麼」。黑條會讓讀者看不懂那格是什麼，
#   換成【範例】的資料反而更好讀，而且一眼就知道不是真單。
#
# ⚠ 這只換畫面上的字，不動任何資料。用的是 class 名稱定位
#   （.whcust／.whto／.whrow／表格的 th+td），改版時如果 class 換了會失效——
#   所以每張圖都還是要人眼看過再放進手冊，這支只是把大部分工作做掉。
DEIDENT_JS = r"""
(function () {
  var CUST = ['【範例】王小明', '【範例】陳美玲', '【範例】林大同'];
  var WORKER = ['【範例】阿明工班', '【範例】大同鎖行'];
  var ci = 0, wi = 0, n = 0;
  function cust() { return CUST[ci++ % CUST.length]; }
  function worker() { return WORKER[wi++ % WORKER.length]; }

  // ① 簽核卡片：<tr><th>標籤</th><td>值</td></tr>
  Array.prototype.forEach.call(document.querySelectorAll('tr'), function (tr) {
    var th = tr.querySelector('th'), td = tr.querySelector('td');
    if (!th || !td) return;
    var k = (th.textContent || '').trim();
    if (k === '客戶') { td.textContent = cust() + '（範例通路）'; n++; }
    else if (k === '承包商') { td.textContent = worker(); n++; }
    else if (/報價|總價|售價|進價|金額/.test(k)) { td.textContent = 'NT$ 3,000'; n++; }
  });

  // ② 出貨／倉庫卡片：<div class="whrow"><b>標籤</b>值</div>
  Array.prototype.forEach.call(document.querySelectorAll('.whrow'), function (el) {
    var b = el.querySelector('b');
    if (!b) return;
    var k = (b.textContent || '').trim(), v = null;
    if (k === '承包商') v = worker();
    else if (k === '客人' || k === '貨指寄') v = cust() + '　0911-111111';
    else if (k === '售價' || k === '進價') v = 'NT$ 3,000';
    else if (k === '發票' || k === '發票號碼') v = 'AB-12345678';
    else if (k === '通路單號') v = '範例訂單-0001';
    if (v === null) return;
    while (b.nextSibling) el.removeChild(b.nextSibling);
    el.appendChild(document.createTextNode(v));
    n++;
  });

  // ③ 卡片標題的客戶名（span 是通路，留著——那不是個資）
  Array.prototype.forEach.call(document.querySelectorAll('.whcust'), function (el) {
    var sp = el.querySelector('span');
    el.textContent = cust();
    if (sp) { el.appendChild(document.createTextNode('　')); el.appendChild(sp); }
    n++;
  });

  // ④ 送貨資料／客人資料整塊（公司、聯絡人、電話、地址擠在同一塊，逐行拆不划算）
  Array.prototype.forEach.call(document.querySelectorAll('.whto'), function (el) {
    el.innerHTML = '【範例】範例實業社　王小明　0911-111111<br>新竹縣竹北市範例路 1 號 1F';
    n++;
  });

  // ⑧ 報表的「疑似同一承包商的不同寫法」：整段就是真實承包商與負責人姓名，
  //    而且是成對列出的，比長條圖更容易認人。這一段沒有 <b> 標籤，
  //    用「.whrow 但沒有 b」來認（前面第 ② 條處理的是有 b 的那種）。
  Array.prototype.forEach.call(document.querySelectorAll('.whrow'), function (el) {
    if (el.querySelector('b')) return;
    if (!/／|\//.test(el.textContent || '')) return;
    el.textContent = '【範例】阿明工班　/　阿明　/　阿明工程行';
    n++;
  });

  // ⑦ 報表：整份承包商名單就是供應商全表，加上金額能反推毛利與進價，
  //    兩樣都不該印在一份要發給四個部門的手冊上。
  //    做法是換名字＋只留前 8 筆示意，讓讀者看得懂這張圖在排什麼就夠了。
  Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
    var t = card.querySelector('.ometa b');
    var title = t ? (t.textContent || '').trim() : '';
    var rows = card.querySelectorAll('.brow');
    if (title === '各承包商') {
      Array.prototype.forEach.call(rows, function (row, i) {
        var lab = row.querySelector('.blab');
        if (lab) lab.textContent = '【範例】承包商 ' + String.fromCharCode(65 + (i % 26));
        if (i >= 8) row.style.display = 'none';
        n++;
      });
      if (rows.length > 8) {
        var d = document.createElement('div');
        d.className = 'note';
        d.textContent = '（手冊只保留前 8 筆示意，實際會列出全部承包商）';
        card.appendChild(d);
      }
    }
    Array.prototype.forEach.call(card.querySelectorAll('.bval'), function (el) {
      var before = el.innerHTML;
      // ⚠ 毛利寫成「毛利 133,400」，沒有 NT$ 前綴——只比對 NT$ 會整個漏掉，
      //   而毛利正是最不能外流的數字（一露出來就等於把進價反推出來）
      el.innerHTML = before
        .replace(/NT\$\s*[\d,]+/g, 'NT$ 123,456')
        .replace(/毛利\s*[\d,]+/g, '毛利 12,345');
      if (el.innerHTML !== before) n++;
    });
  });

  // ⑤ 舊流程快選清單：<div class="pick"><b>單號</b>　客戶（案名）<div class="sub">分頁｜承包商｜型號</div></div>
  //    這一條是首批漏掉的——整排真實客戶與承包商就掛在畫面中段
  Array.prototype.forEach.call(document.querySelectorAll('.pick'), function (el) {
    var b = el.querySelector('b'), sub = el.querySelector('.sub');
    if (!b) return;
    while (b.nextSibling) el.removeChild(b.nextSibling);
    el.appendChild(document.createTextNode('　' + cust() + '（範例通路）'));
    if (sub) {
      // 分頁（電商-Vivi 這種）是內部業務代號，不是個資，留著；只換承包商那一段
      var parts = (sub.textContent || '').split('｜');
      if (parts.length >= 2) parts[1] = worker();
      sub.textContent = parts.join('｜');
      el.appendChild(sub);
    }
    n++;
  });

  // ⑥ 欄位提示字（placeholder）裡寫死的真實客戶、承包商、電話與地址。
  //    這些是**程式碼裡的常數**，不是資料——代表每個進得了那一頁的人都看得到。
  //    下單頁一頁就有六個（客人姓名、客人電話、收件公司、電話、地址、出貨備註）。
  //    ⚠ 這一條當初只寫了兩個名字就以為做完了，實際上要逐頁把提示字抓出來看才知道有幾個。
  var PH_MAP = [
    [/宇泰鎖印\s*李建男|李建男/g, '範例鎖行 王小明'],
    [/大內高手鎖業有限公司|大內高手/g, '範例鎖業有限公司'],
    [/孫明恩/g, '王小明'],
    [/0953-644733/g, '0911-111111'],
    [/02-29266999/g, '02-1234-5678'],
    [/新北市中和區橋和路122號13樓之2/g, '新竹縣竹北市範例路 1 號'],
    [/MOMO\s*26080229339090-001-001-001/g, 'MOMO 範例訂單-0001']
  ];
  Array.prototype.forEach.call(document.querySelectorAll('[placeholder]'), function (el) {
    var t = el.placeholder, before = t;
    PH_MAP.forEach(function (r) { t = t.replace(r[0], r[1]); });
    if (t !== before) { el.placeholder = t; n++; }
  });

  // ⑦ 報表：整份承包商名單就是供應商全表，加上金額能反推毛利與進價，
  //    兩樣都不該印在一份要發給四個部門的手冊上。
  //    做法是換名字＋只留前 8 筆示意，讓讀者看得懂這張圖在排什麼就夠了。
  Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
    var t = card.querySelector('.ometa b');
    var title = t ? (t.textContent || '').trim() : '';
    var rows = card.querySelectorAll('.brow');
    if (title === '各承包商') {
      Array.prototype.forEach.call(rows, function (row, i) {
        var lab = row.querySelector('.blab');
        if (lab) lab.textContent = '【範例】承包商 ' + String.fromCharCode(65 + (i % 26));
        if (i >= 8) row.style.display = 'none';
        n++;
      });
      if (rows.length > 8) {
        var d = document.createElement('div');
        d.className = 'note';
        d.textContent = '（手冊只保留前 8 筆示意，實際會列出全部承包商）';
        card.appendChild(d);
      }
    }
    Array.prototype.forEach.call(card.querySelectorAll('.bval'), function (el) {
      var before = el.innerHTML;
      // ⚠ 毛利寫成「毛利 133,400」，沒有 NT$ 前綴——只比對 NT$ 會整個漏掉，
      //   而毛利正是最不能外流的數字（一露出來就等於把進價反推出來）
      el.innerHTML = before
        .replace(/NT\$\s*[\d,]+/g, 'NT$ 123,456')
        .replace(/毛利\s*[\d,]+/g, '毛利 12,345');
      if (el.innerHTML !== before) n++;
    });
  });

  // ⑤ 舊流程快選清單：<div class="pick"><b>單號</b>　客戶（案名）<div class="sub">分頁｜承包商｜型號</div></div>
  //    這一條是首批漏掉的——整排真實客戶與承包商就掛在畫面中段
  Array.prototype.forEach.call(document.querySelectorAll('.pick'), function (el) {
    var b = el.querySelector('b'), sub = el.querySelector('.sub');
    if (!b) return;
    while (b.nextSibling) el.removeChild(b.nextSibling);
    el.appendChild(document.createTextNode('　' + cust() + '（範例通路）'));
    if (sub) {
      // 分頁（電商-Vivi 這種）是內部業務代號，不是個資，留著；只換承包商那一段
      var parts = (sub.textContent || '').split('｜');
      if (parts.length >= 2) parts[1] = worker();
      sub.textContent = parts.join('｜');
      el.appendChild(sub);
    }
    n++;
  });

  // ⑥ 欄位提示字裡寫死的真實承包商與人名（程式碼裡的常數，不是資料）
  Array.prototype.forEach.call(document.querySelectorAll('input[placeholder]'), function (el) {
    var t = el.placeholder;
    if (/宇泰|李建男/.test(t)) { el.placeholder = '例：範例鎖行 王小明'; n++; }
    else if (/孫明恩|0953-644733/.test(t)) {
      el.placeholder = t.replace(/孫明恩/g, '王小明').replace(/0953-644733/g, '0911-111111');
      n++;
    }
  });

  // ⑤ 保險絲：上面四條沒蓋到的地方，至少把電話號碼掃掉
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false), node;
  var RE = /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g;
  while ((node = w.nextNode())) {
    if (RE.test(node.nodeValue)) { node.nodeValue = node.nodeValue.replace(RE, '0911-111111'); n++; }
    RE.lastIndex = 0;
  }
  return n;
})()
"""

# body 的高度是版面撐出來的（min-height 佔滿視窗），內容只有上面一小塊。
# 直接拍 body 會得到一張 2800px 高、下面兩千多 px 全白的圖。
TRIM_JS = r"""
(function () {
  var b = document.body;
  b.style.minHeight = '0';
  b.style.height = 'auto';
  var max = 0;
  Array.prototype.forEach.call(b.querySelectorAll('*'), function (el) {
    var r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) max = Math.max(max, r.bottom + window.scrollY);
  });
  if (max > 0) b.style.height = Math.ceil(max + 24) + 'px';
  return Math.ceil(max);
})()
"""


def prep(page, frame, deident=True):
    """截圖前的整理，三步驟，順序不能換：

    ① 去識別化 —— 替換文字會改變版面高度，先量高度就白量了
    ② 把視窗撐到內容高度 —— ⚠ 這步是必要的，不是為了好看：
       Chromium 對「超出視窗高度」的部分不會繪製，直接拍 body 會得到
       上面幾百 px 有東西、下面兩千多 px 全白的圖（2026-08-26 首批就是這樣，
       出貨登錄頁其實有第三張卡片，只是沒被畫出來）
    ③ 收掉 body 撐出來的多餘留白
    """
    if deident:
        try:
            hits = frame.evaluate(DEIDENT_JS)
            if hits:
                print(f"  去識別化 {hits} 處")
        except Exception as e:
            print(f"  ⚠ 去識別化失敗，這張要人工檢查：{e}")

    try:
        need = int(frame.evaluate(TRIM_JS) or 0)
    except Exception:
        need = 0
    if need > 800:
        h = min(need + 160, 6000)     # 上限防止某頁把記憶體吃爆
        page.set_viewport_size({"width": 1440, "height": h})
        page.wait_for_timeout(1200)   # 等重排與繪製
        try:
            frame.evaluate(TRIM_JS)   # 版面變了，高度重量一次
        except Exception:
            pass


def snap_frame(page, frame, name):
    """拍**整頁內容**，不是只拍看得到的那一螢幕。

    畫面跑在 iframe 裡，page.screenshot() 只會拍到視窗大小那一塊，
    捲軸下面的欄位就沒了——手冊要教「表單有哪些欄位」，截半張沒有意義。
    所以改拍 iframe 裡的 body 這個元素，Playwright 會把整個元素高度拍完。
    """
    path = os.path.join(OUT, name + ".png")
    try:
        frame.locator("body").screenshot(path=path)
    except Exception as e:
        print(f"  （整頁拍失敗，退回拍視窗：{e}）")
        page.screenshot(path=path)
    kb = os.path.getsize(path) // 1024
    flag = "  ⚠ 疑似空白" if kb < 15 else ""
    print(f"  {name}.png ({kb} KB){flag}")
    return kb


def do_pages(page, only=None, deident=True):
    todo = [x for x in PAGES if not only or x[0] == only]
    if only and not todo:
        print(f"沒有這張：{only}")
        return
    thin = []
    for name, query, wait_text, click_id in todo:
        print(f"{name} … {query}" + (f" → 點 {click_id}" if click_id else ""))
        try:
            frame = open_page(page, query, wait_text=wait_text)
            if click_id:
                frame.click(click_id, timeout=10000)
                page.wait_for_timeout(1200)   # 等欄位展開
            prep(page, frame, deident=deident)
            if snap_frame(page, frame, name) < 15:
                thin.append(name)
            page.set_viewport_size({"width": 1440, "height": 900})
        except Exception as e:
            print(f"  ✗ 失敗：{e}")
            thin.append(name + "（失敗）")

    print()
    print(f"完成 {len(todo) - len(thin)}/{len(todo)} 張 → {OUT}")
    if thin:
        print("以下需要人工確認：")
        for n in thin:
            print(f"  - {n}")



# ── 主線：建一筆測試單，把四個角色接力的畫面拍下來 ──────────────
# ⚠ 這會在**正式環境**寫入一筆真的發包單，並發 Chat 通知給真的主管與助理。
#    使用者已同意（「可以，建測試單就好」）。所有欄位都用【驗收測試】開頭、
#    備註寫明「請勿處理」，讓收到通知的人一眼知道不用理它。
#    單號會記進版本紀錄，方便日後清理。
TEST_ORDER = {
    "customer":  "【驗收測試】客戶A",
    "model":     "L901",
    "qty":       "1",
    "price":     "3000",
    "note":      "【驗收測試】教育訓練手冊截圖用，請勿處理",
    "items":     "L901GEA10001AA-01 X1",
    "toName":    "【驗收測試】範例鎖業有限公司",
    "toPhone":   "02-1234-5678",
    "toAddr":    "新竹縣竹北市範例路 1 號",
    "shipNote":  "【驗收測試】請勿出貨",
    "channelNo": "範例訂單-0001",
    "custName":  "【驗收測試】王小明",
    "custPhone": "0911-111111",
    "custAddr":  "新竹縣竹北市範例路 1 號",
    "workItem":  "裝外門",
    "workTime":  "平日1-4",
    "salePrice": "3000",
    # 進價刻意不填：那是最敏感的數字，截圖裡不需要它也看得懂流程
}


def do_order(page, submit=False):
    """填一筆測試單。預設**只填不送**——送出是不可逆的，要另外加 --submit。"""
    frame = open_page(page, "page=order", wait_text="下單")
    frame.click("#k0")            # 發包安裝
    page.wait_for_timeout(1500)

    for k, v in TEST_ORDER.items():
        try:
            frame.fill("#" + k, v)
        except Exception as e:
            print(f"  ⚠ 填不進 {k}：{str(e)[:60]}")

    # 承包商與案名是下拉，選「其他」才會冒出文字框——不能直接打字進去。
    # 選真的承包商會讓這筆測試單掛在別人頭上，所以一律走「其他」。
    for sel, txt, val in (("#worker", "#workerX", "【驗收測試】承包商"),
                          ("#project", "#projectX", "【驗收測試】通路")):
        try:
            frame.select_option(sel, "其他")
            page.wait_for_timeout(400)
            frame.fill(txt, val)
        except Exception as e:
            print(f"  ⚠ {sel} 選不到「其他」：{str(e)[:60]}")
    try:
        frame.select_option("#invoice", "二聯")
    except Exception as e:
        print(f"  ⚠ 發票別選不到：{str(e)[:60]}")

    prep(page, frame)
    snap_frame(page, frame, "40-gas-order-filled")
    page.set_viewport_size({"width": 1440, "height": 900})

    if not submit:
        print("\n只填不送。確認 40-gas-order-filled.png 沒問題後，加 --submit 再跑一次。")
        return

    frame.click("#sub")
    waited = 0
    while waited < 90000:
        msg = (frame.inner_text("#msg") or "").strip()
        if msg and "處理中" not in msg:
            break
        page.wait_for_timeout(2000)
        waited += 2000
    print("\n送出結果：")
    print("  " + ((frame.inner_text("#msg") or "").strip().replace("\n", "\n  ") or "（沒有訊息）"))
    prep(page, frame)
    snap_frame(page, frame, "41-gas-order-done")
    page.set_viewport_size({"width": 1440, "height": 900})



# ── Chat 截圖 ────────────────────────────────────────────
# ⚠ Chat 空間裡混著真實訂單的通知（客戶名、地址、電話都在裡面）。
#    所以**不拍整個視窗**，只把「我們自己那筆測試單」的那一則訊息裁出來。
#    做法是用單號把訊息氣泡找出來、量它的座標，再用 clip 只拍那一塊。
CHAT_URL = "https://chat.google.com/"

FIND_BUBBLE_JS = """
(key) => {
  var best = null, bestArea = Infinity;
  var all = document.querySelectorAll('div,section,article');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if ((el.textContent || '').indexOf(key) < 0) continue;
    var r = el.getBoundingClientRect();
    // 門檻放到 220：卡片本身約 280px 寬，設 300 會挑到外層的整列訊息，
    // 裁出來就會夾到上一則訊息的尾巴（2026-08-26 首次拍到的就是那樣）
    if (r.width < 220 || r.height < 120) continue;
    var area = r.width * r.height;
    if (area < bestArea) { bestArea = area; best = r; }
  }
  if (!best) return null;
  return { x: Math.max(0, best.left - 8), y: Math.max(0, best.top - 8),
           width: best.width + 16, height: best.height + 16 };
}
"""


def open_chat(page, space):
    page.goto(CHAT_URL, wait_until="load")
    page.wait_for_timeout(14000)
    fr = page.frames[0]
    # 「您不會在這部裝置上收到通知」的提示框會蓋住畫面右上角，先關掉
    for label in ("停用", "關閉"):
        try:
            fr.click(f"text={label}", timeout=2500)
            page.wait_for_timeout(800)
            break
        except Exception:
            pass
    fr.click(f"text={space}", timeout=20000)
    page.wait_for_timeout(9000)
    return fr


def snap_bubble(page, frame, key, name):
    """只拍含 key 的那一則訊息。找不到就明講，不要拍整頁——
    整頁會把上面別人的真實訂單通知一起拍進去。"""
    rect = frame.evaluate(FIND_BUBBLE_JS, key)
    if not rect:
        print(f"  ✗ 找不到含「{key}」的訊息，這張沒拍（不改拍整頁，會夾帶真實訂單）")
        return False
    path = os.path.join(OUT, name + ".png")
    page.screenshot(path=path, clip=rect)
    print(f"  {name}.png ({os.path.getsize(path) // 1024} KB)")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", action="store_true", help="第一次使用：手動登入 Google")
    ap.add_argument("--check", action="store_true", help="驗證登入與存檔")
    ap.add_argument("--diag", action="store_true", help="卡住時印出實際的 frame 與內容")
    ap.add_argument("--only", help="只重拍指定的那一張（填檔名，如 34-gas-approve）")
    ap.add_argument("--order", action="store_true", help="填一筆【驗收測試】的發包安裝單（預設只填不送）")
    ap.add_argument("--submit", action="store_true", help="搭配 --order：真的按下送出（會寫入正式環境並發 Chat）")
    ap.add_argument("--raw", action="store_true",
                    help="不做去識別化（只在自己要核對真實資料時用，產出不可放進手冊）")
    args = ap.parse_args()

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE,
            channel="chrome",
            headless=False,          # headless 會讓 Google 登入失效
            viewport={"width": 1440, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            if args.login:
                do_login(ctx)
            elif args.diag:
                do_diag(page)
            elif args.check:
                do_check(page)
            elif args.order:
                do_order(page, submit=args.submit)
            else:
                do_pages(page, args.only, deident=not args.raw)
        finally:
            ctx.close()


if __name__ == "__main__":
    main()
