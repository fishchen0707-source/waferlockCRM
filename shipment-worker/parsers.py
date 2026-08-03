# -*- coding: utf-8 -*-
"""
貨運單 PDF 解析器（新竹物流託運總表 / 嘉里大榮託運明細表）

背景：
  兩家的 PDF 都有文字圖層，字型為 Identity-H 且帶 ToUnicode CMap，
  但該 CMap 誤把字碼映射到 Big5 碼位而非 Unicode，
  所以標準抽取工具會吐亂碼。recover_big5() 負責還原。

  另外，get_text() 的輸出順序不等於視覺閱讀順序
  （大榮表頭的「食品」欄會被丟到序列最後），
  因此一律以座標（bbox）分列分欄，不依賴文字流順序。

用法：
  python parsers.py <pdf路徑> [<pdf路徑> ...]
"""

import json
import os
import re
import sys

import fitz  # PyMuPDF

CARRIER_HCT = 'hct'      # 新竹物流
CARRIER_KERRY = 'kerry'  # 嘉里大榮


# ---------------------------------------------------------------- 文字還原

def recover_big5(text):
    """還原 ToUnicode CMap 誤映射到 Big5 碼位的文字。

    碼位 < 0x100 的字元其實是 Big5 位元組，需收集成串後一次解碼；
    其餘字元（正常的 Unicode，例如全形空白 U+3000）原樣保留。
    """
    out, buf = [], bytearray()
    for ch in text:
        code = ord(ch)
        if code < 0x100:
            buf.append(code)
        else:
            if buf:
                out.append(bytes(buf).decode('big5', 'replace'))
                buf = bytearray()
            out.append(ch)
    if buf:
        out.append(bytes(buf).decode('big5', 'replace'))
    return ''.join(out)


def _is_cjk(ch):
    return '一' <= ch <= '鿿'


def _join_words(words):
    """把同一欄的多個詞合併回原本的字串。

    同一列：以空白相接（PDF 用空白分隔的欄內詞彙，例如「-福上鎖印 曹世龍收」）。
    跨列（換行）：中文接中文不加空白（「上揚鎖匙」+「刻印店)」→「上揚鎖匙刻印店)」），
                 其餘加空白（「維夫拉克(股)公司」+「Rebecca收」）。
    """
    if not words:
        return ''
    words = sorted(words, key=lambda w: (round(w[1], 1), w[0]))
    parts = [words[0][4]]
    for prev, cur in zip(words, words[1:]):
        same_line = abs(cur[1] - prev[1]) < 4
        if same_line:
            parts.append(' ')
        elif parts[-1] and cur[4] and _is_cjk(parts[-1][-1]) and _is_cjk(cur[4][0]):
            pass  # 中文換行，不補空白
        else:
            parts.append(' ')
        parts.append(cur[4])
    return ''.join(parts).strip()


def _page_words(page):
    """取回本頁所有詞，文字已還原，格式 (x0, y0, x1, y1, text)。"""
    words = []
    for w in page.get_text('words'):
        text = recover_big5(w[4]).strip()
        if text:
            words.append((w[0], w[1], w[2], w[3], text))
    return words


def _clean_phone(text):
    return re.sub(r'\s+', '', text or '')


def _strip_recipient_suffix(name):
    """剝除收貨人名稱結尾的「收」字（曹世龍收 → 曹世龍）。"""
    name = (name or '').strip()
    if len(name) > 1 and name.endswith('收'):
        return name[:-1].strip()
    return name


def _blank(value):
    """把只剩符號或空字串的欄位一律轉成 None，避免假資料進資料庫。"""
    value = (value or '').strip()
    return value or None


# ------------------------------------------------------- 新竹物流託運總表

# 欄位 x 邊界（由樣本表頭座標推得）
_HCT_COLS = [
    ('track_addr', 0, 115),     # 查貨號碼（首列）/ 地址（次列）
    ('station', 115, 178),      # 到著站（首列）/ 指配日期・內容品備註（次列）
    ('recipient', 178, 288),    # 收貨人代號-名稱
    ('pieces', 288, 310),       # 件數
    ('weight', 310, 336),       # 重
    ('phone', 336, 398),        # 收件電話 / 收件電話2
    ('misc', 398, 495),         # 傳票區分 / 代收貨款
    ('order_no', 495, 9999),    # 訂單編號（首列）/ 報值金額（次列）
]

_HCT_TRACKING = re.compile(r'^\d{3}-\d{3}-\d{4}$')
_HCT_ACCOUNT = re.compile(r'^\d{11}$')
_HCT_SEND_DATE = re.compile(r'發送日期[：:]\s*(\d{4}/\d{2}/\d{2})')
_HCT_ASSIGN = re.compile(r'指配日期[：:]')
_HCT_DATE_TOKEN = re.compile(r'^\d{4}/\d{2}/\d{2}$')
_HCT_SLOT_TOKEN = re.compile(r'^\d{2}-\d{2}$')
# 「收貨人代號-名稱」，代號可為空、純數字或英數混合（樣本有 102 與 807R）
_HCT_RECIPIENT = re.compile(r'^([0-9A-Za-z]*)-\s*(.*)$', re.S)


def _col_of(x0, cols):
    for name, lo, hi in cols:
        if lo <= x0 < hi:
            return name
    return None


def parse_hct(doc):
    """解析新竹物流託運總表。一個 PDF 可含多個客代區段，各有獨立表頭與小計。"""
    rows = []
    # 區段可跨頁：續頁只有「第 N 頁」，沒有客代與發送日期表頭，故需跨頁沿用
    cur_account = cur_date = None
    for page in doc:
        words = _page_words(page)

        # 區段標記：客代（11 碼數字，靠右）與發送日期，皆位於區段表頭
        accounts = sorted(
            [(w[1], w[4]) for w in words if w[0] > 495 and _HCT_ACCOUNT.match(w[4])]
        )
        dates = []
        for w in words:
            m = _HCT_SEND_DATE.search(w[4])
            if m:
                dates.append((w[1], m.group(1).replace('/', '-')))
        dates.sort()

        anchors = sorted(
            [w for w in words if w[0] < 115 and _HCT_TRACKING.match(w[4])],
            key=lambda w: w[1],
        )
        # 區段小計列（「05188630008合計：3 筆」）是該區段最後一筆的下界，
        # 否則最後一筆會把下一個區段的表頭全部吃進來。
        footers = sorted(w[1] for w in words if '合計' in w[4])

        for idx, anchor in enumerate(anchors):
            top = anchor[1]
            limits = []
            if idx + 1 < len(anchors):
                limits.append(anchors[idx + 1][1] - 2)
            limits += [y - 2 for y in footers if y > top][:1]
            bottom = min(limits) if limits else 1e9
            block = [w for w in words if top - 2 <= w[1] < bottom]

            # 「指配日期」那一列的時段（09-13）x 座標落在收貨人欄範圍內，
            # 必須先整列抽離，否則會污染收貨人；該列剩下的內容即為備註。
            assign_y = next((w[1] for w in block if _HCT_ASSIGN.match(w[4])), None)
            if assign_y is None:
                assign_line = []
            else:
                assign_line = [w for w in block if abs(w[1] - assign_y) < 4]
                block = [w for w in block if abs(w[1] - assign_y) >= 4]

            buckets = {name: [] for name, _, _ in _HCT_COLS}
            for w in block:
                col = _col_of(w[0], _HCT_COLS)
                if col:
                    buckets[col].append(w)

            def on_anchor_line(ws):
                return [w for w in ws if abs(w[1] - top) < 5]

            def below_anchor_line(ws):
                return [w for w in ws if abs(w[1] - top) >= 5]

            address = _join_words(below_anchor_line(buckets['track_addr']))

            # 備註＝「指配日期」列扣掉標籤、日期、配送時段之後的殘餘（如 D310、羅柏杉）
            remark_tokens = [
                w[4] for w in sorted(assign_line, key=lambda w: w[0])
                if not _HCT_ASSIGN.match(w[4])
                and not _HCT_DATE_TOKEN.match(w[4])
                and not _HCT_SLOT_TOKEN.match(w[4])
            ]

            raw_recipient = _join_words(buckets['recipient'])
            m = _HCT_RECIPIENT.match(raw_recipient)
            code, name = (m.group(1), m.group(2)) if m else ('', raw_recipient)

            account, ship_date = cur_account, cur_date
            for y, acc in accounts:
                if y < top:
                    account = acc
            for y, date in dates:
                if y < top:
                    ship_date = date
            cur_account, cur_date = account, ship_date

            rows.append({
                'carrier': CARRIER_HCT,
                'tracking_no': anchor[4],
                'ship_date': ship_date,
                'shipper_account': account,
                'order_no': _blank(_join_words(on_anchor_line(buckets['order_no']))),
                'recipient_code': _blank(code),
                'recipient_name': _strip_recipient_suffix(name),
                'recipient_phone': _clean_phone(_join_words(buckets['phone'])),
                'recipient_address': address,
                'remark': _blank(' '.join(remark_tokens)),
                'pieces': _blank(_join_words(buckets['pieces'])),
                'station': _blank(_join_words(on_anchor_line(buckets['station']))),
            })
    return rows


# --------------------------------------------------- 嘉里大榮託運明細表

_KERRY_COLS = [
    ('seq', 0, 30),
    ('track', 30, 145),
    ('station', 145, 176),
    ('code', 176, 205),
    ('recipient', 205, 286),
    ('pieces', 286, 308),
    ('weight', 308, 335),
    ('cai', 335, 358),
    ('flags', 358, 430),
    ('cod', 430, 484),
    ('order_no', 484, 550),   # 出貨單號
    ('value', 550, 9999),
]

_KERRY_TRACKING = re.compile(r'^\d{11}$')
_KERRY_SHIPPER_NO = re.compile(r'^託運人編號[：:]')
_KERRY_SHIPPER_NAME = re.compile(r'^託運人名稱[：:]\s*(.*)$')
_KERRY_SEND_DATE = re.compile(r'^(\d{8})$')
_KERRY_LABELS = ('溫層：', '指配日：', '備註：', '配送時段：')


def parse_kerry(doc):
    """解析嘉里大榮託運明細表。一個 PDF 可含多個託運人帳號分頁。"""
    rows = []
    for page in doc:
        words = _page_words(page)

        # 頁首：託運人編號 / 名稱 / 託運日期
        shipper_account = shipper_name = ship_date = None
        for i, w in enumerate(words):
            if _KERRY_SHIPPER_NO.match(w[4]):
                for cand in words:
                    if abs(cand[1] - w[1]) < 4 and cand[0] > w[0] and cand[4].isdigit():
                        shipper_account = cand[4]
                        break
            m = _KERRY_SHIPPER_NAME.match(w[4])
            if m:
                shipper_name = m.group(1).strip()
            if '託運日期' in w[4]:
                cands = [
                    c[4] for c in words
                    if abs(c[1] - w[1]) < 4 and c[0] > w[0] and _KERRY_SEND_DATE.match(c[4])
                ]
                if cands:
                    d = cands[0]
                    ship_date = f'{d[0:4]}-{d[4:6]}-{d[6:8]}'

        anchors = sorted(
            [w for w in words if 30 <= w[0] < 145 and _KERRY_TRACKING.match(w[4])],
            key=lambda w: w[1],
        )
        # 表尾（「共：3 筆」「已詳閱並同意配送契約」）是最後一筆的下界
        footers = sorted(
            w[1] for w in words if w[4].startswith('共：') or '已詳閱' in w[4]
        )

        for idx, anchor in enumerate(anchors):
            top = anchor[1]
            limits = []
            if idx + 1 < len(anchors):
                limits.append(anchors[idx + 1][1] - 4)
            limits += [y - 4 for y in footers if y > top][:1]
            bottom = min(limits) if limits else 1e9
            # 收貨人可能排在託運單號上方幾點（樣本 y 差約 1pt），故上緣放寬
            block = [w for w in words if top - 6 <= w[1] < bottom]

            buckets = {name: [] for name, _, _ in _KERRY_COLS}
            for w in block:
                col = _col_of(w[0], _KERRY_COLS)
                if col:
                    buckets[col].append(w)

            anchor_line = lambda ws: [w for w in ws if abs(w[1] - top) < 6]
            sub_lines = lambda ws: [w for w in ws if abs(w[1] - top) >= 6]

            # 次列左側（x < 145）依 y 順序為：電話、地址
            left_subs = sorted(
                sub_lines(buckets['seq']) + sub_lines(buckets['track']),
                key=lambda w: (round(w[1], 1), w[0]),
            )
            phone = address = ''
            if left_subs:
                first_y = left_subs[0][1]
                phone = _join_words([w for w in left_subs if abs(w[1] - first_y) < 4])
                rest = [w for w in left_subs if abs(w[1] - first_y) >= 4]
                address = _join_words(rest)

            # 備註：緊接「備註：」標籤之後、同一列的內容
            remark = ''
            for w in block:
                if w[4].startswith('備註：'):
                    tail = w[4][len('備註：'):].strip()
                    same_line = [
                        c[4] for c in block
                        if abs(c[1] - w[1]) < 4 and c[0] > w[0]
                        and not c[4].startswith(_KERRY_LABELS)
                    ]
                    remark = ' '.join([t for t in [tail] + same_line if t]).strip()
                    break

            rows.append({
                'carrier': CARRIER_KERRY,
                'tracking_no': anchor[4],
                'ship_date': ship_date,
                'shipper_account': shipper_account,
                'shipper_name': shipper_name,
                'order_no': _blank(_join_words(anchor_line(buckets['order_no']))),
                'recipient_code': None,  # 大榮無此欄
                'recipient_name': _strip_recipient_suffix(_join_words(buckets['recipient'])),
                'recipient_phone': _clean_phone(phone),
                'recipient_address': address,
                'remark': _blank(remark),
                'pieces': _blank(_join_words(anchor_line(buckets['pieces']))),
                'station': _blank(_join_words(anchor_line(buckets['station']))),
            })
    return rows


# ---------------------------------------------------------------- 進入點

def detect_carrier(doc):
    head = recover_big5(doc[0].get_text())
    if '新竹' in head:
        return CARRIER_HCT
    if '大榮' in head or '嘉里' in head:
        return CARRIER_KERRY
    return None


_HCT_GRAND = re.compile(r'全合計[：:]\s*(\d+)')
_HCT_SECTION_TOTAL = re.compile(r'\d{11}合計[：:]\s*(\d+)')
_KERRY_TOTAL = re.compile(r'共[：:]\s*(\d+)\s*筆')


def declared_count(doc, carrier):
    """讀出 PDF 自己印的總筆數，用來驗證解析有沒有漏抓。讀不到回傳 None。"""
    text = '\n'.join(recover_big5(page.get_text()) for page in doc)
    if carrier == CARRIER_HCT:
        m = _HCT_GRAND.search(text)
        if m:
            return int(m.group(1))
        totals = _HCT_SECTION_TOTAL.findall(text)
        return sum(int(t) for t in totals) if totals else None
    if carrier == CARRIER_KERRY:
        totals = _KERRY_TOTAL.findall(text)
        return sum(int(t) for t in totals) if totals else None
    return None


def parse_pdf(path):
    """解析單一 PDF。

    回傳 dict：carrier / rows / declared / ok。
    ok 為 False 代表解析筆數與 PDF 自印的合計對不上——這種情況必須顯性失敗，
    不可當成解析成功，否則會安靜地漏掉幾筆託運單。
    無法辨識貨運商時丟 ValueError。
    """
    doc = fitz.open(path)
    carrier = detect_carrier(doc)
    if carrier == CARRIER_HCT:
        rows = parse_hct(doc)
    elif carrier == CARRIER_KERRY:
        rows = parse_kerry(doc)
    else:
        raise ValueError(f'無法辨識貨運商：{path}')

    declared = declared_count(doc, carrier)
    return {
        'carrier': carrier,
        'rows': rows,
        'declared': declared,
        'ok': declared is None or declared == len(rows),
    }


def main(paths):
    os.makedirs('output', exist_ok=True)
    total = 0
    skipped = []
    mismatched = []
    for path in paths:
        name = os.path.basename(path)
        try:
            result = parse_pdf(path)
        except Exception as exc:
            skipped.append(f'{name} → {exc}')
            continue

        carrier, rows, declared = result['carrier'], result['rows'], result['declared']
        out_path = os.path.join('output', f'{os.path.splitext(name)[0]}.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)

        check = '筆數核對相符' if result['ok'] else f'⚠ 與 PDF 自印合計 {declared} 筆不符'
        print(f'\n===== {name}（{carrier}）解析 {len(rows)} 筆｜{check} → {out_path}')
        for r in rows:
            print(
                f"  {r['tracking_no']} | {r['recipient_name']} | {r['recipient_phone']} "
                f"| {r['recipient_address']} | 訂單編號={r['order_no']} | 備註={r['remark']}"
            )
        total += len(rows)
        if not result['ok']:
            mismatched.append(f'{name}：解析 {len(rows)} 筆，PDF 自印 {declared} 筆')

    print(f'\n完成：共解析 {total} 筆，來源 {len(paths) - len(skipped)} 份 PDF。')
    if skipped:
        print(f'跳過 {len(skipped)} 份：')
        for s in skipped:
            print(f'  - {s}')
    if mismatched:
        print(f'⚠ 筆數不符 {len(mismatched)} 份（可能漏抓，勿當成功）：')
        for m in mismatched:
            print(f'  - {m}')
    return 1 if (skipped or mismatched) else 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1:]))
