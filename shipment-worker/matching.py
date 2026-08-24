# -*- coding: utf-8 -*-
"""
託運單 → CRM 客戶／安裝單 的配對引擎。

兩條路：
  Path A：託運單上的「訂單編號」(新竹) /「出貨單號」(大榮) 有填 TipTop 出貨單號
          → 直接對 installs.shipment_no，精確、score 1.0。
  Path B：上述欄位空白時的備案，靠地址正規化 + 電話比對，有失敗率，需人工佇列兜底。

⚠ 關於地址正規化的兩套函式，請勿混用：
  waferlock_crm.html 的 normAddr()  → 客編（custKey）的一部分，是**識別鍵**。
                                      它只做全形轉半形、臺→台、去空白。
                                      **絕對不要為了配對而加強它**——那會改變既有客戶的
                                      客編歸戶結果，造成資料錯亂。
  本檔的 norm_addr_match()          → 只用於**比對**，不作為任何 key 儲存。
                                      可以放心做激進的正規化。

  兩者的共同基底（全形→半形、臺→台、去空白、轉小寫）刻意保持一致。
"""

import re

# ------------------------------------------------------------ 中文數字

_CN_DIGIT = {
    '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
}
_CN_RUN = re.compile(r'[零〇一二兩三四五六七八九十百]+')


def _cn_to_int(text):
    """把一串中文數字轉成整數：三十五→35、十二→12、一百二十三→123。"""
    total = section = num = 0
    for ch in text:
        if ch in _CN_DIGIT:
            num = _CN_DIGIT[ch]
        elif ch == '十':
            section += (num or 1) * 10
            num = 0
        elif ch == '百':
            section += (num or 1) * 100
            num = 0
    return total + section + num


def _cn_numerals_to_arabic(text):
    """把所有中文數字轉成阿拉伯數字。

    刻意「全轉」而不限定在樓/段/號等位置：路名裡的數字（文心南三路、九如一路、
    三重區）也會一併轉換。這在語意上不正確，但因為比對雙方都套用同一支函式，
    「文心南三路」與「文心南3路」會收斂到同一個字串，反而提高命中率。
    正規化只需要一致，不需要正確。
    """
    return _CN_RUN.sub(lambda m: str(_cn_to_int(m.group(0))), text)


# ------------------------------------------------------------ 地址

_FULLWIDTH = re.compile(r'[！-～]')
_ZIPCODE = re.compile(r'^\d{3,5}')
# 里名緊接在「區/鄉/鎮/市」之後、且後面接得上路名時才移除。
# 少了前面的 lookbehind，正則會從左邊貪婪咬進行政區（「龍井區東海里」被吃成
# 「井區東海里」），把縣市區都刪掉。
_LI = re.compile(r'(?<=[區鄉鎮市])[一-鿿]{1,4}里(?=[一-鿿]{1,5}(?:路|街|大道|巷|段))')
_LIN = re.compile(r'\d+鄰')
_FLOOR_F = re.compile(r'(\d+)f')
_NOISE = re.compile(r'台灣|中華民國|r\.?o\.?c\.?')


def norm_addr_base(text):
    """與 waferlock_crm.html 的 normAddr() 對齊的基底正規化。"""
    text = str(text or '')
    text = _FULLWIDTH.sub(lambda m: chr(ord(m.group(0)) - 0xFEE0), text)
    return text.replace('臺', '台').replace(' ', '').replace('　', '').lower()


def norm_addr_match(text):
    """配對專用的強正規化。只用於比對，不可當作 key 儲存。"""
    s = norm_addr_base(text)
    s = re.sub(r'\s+', '', s)
    s = _NOISE.sub('', s)
    s = _ZIPCODE.sub('', s)          # 開頭的郵遞區號：235新北市… → 新北市…
    s = _cn_numerals_to_arabic(s)
    s = _LIN.sub('', s)              # 12鄰
    s = _LI.sub('', s)               # 東海里遠東街 → 遠東街
    s = _FLOOR_F.sub(r'\1樓', s)     # 11f → 11樓
    s = s.replace('之', '-')         # 12樓之1 → 12樓-1
    s = re.sub(r'[()（）,，.。;；:：]', '', s)
    return s


def edit_distance(a, b, cap=3):
    """Levenshtein 距離。超過 cap 就提早放棄回傳 cap+1，避免長字串白算。"""
    if a == b:
        return 0
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


# ------------------------------------------------------------ 電話

def norm_phone(text):
    """只留數字；國碼 886 還原成 0 開頭。空值回傳空字串。"""
    digits = re.sub(r'\D', '', str(text or ''))
    if digits.startswith('886'):
        digits = '0' + digits[3:]
    return digits


# ------------------------------------------------------------ 收貨人姓名

_COMPANY_NOISE = re.compile(r'股份有限公司|有限公司|企業社|實業社|工作室|\(股\)|公司')


def norm_name(text):
    """收貨人名稱正規化：去公司後綴與空白，供寬鬆比對用。"""
    s = norm_addr_base(text)
    return _COMPANY_NOISE.sub('', s).strip()


# ------------------------------------------------------------ 配對

# 門檻預設值。實際應由 config 表覆寫（見 load_thresholds），不要在此硬編碼決策。
DEFAULT_THRESHOLDS = {
    'matched': 0.9,   # >= 此值自動掛上
    'pending': 0.6,   # >= 此值進人工佇列，低於則 unmatched
}


def match_row(row, customers, installs=None, thresholds=None):
    """替一筆託運單找出對應的客戶／安裝單。

    參數：
      row        — parsers.py 產出的 dict
      customers  — [{wf_id, name, address, phone, dealer_code, customer_type}, ...]
      installs   — [{id, shipment_no, address, name, phone, shipped_date}, ...]
      thresholds — 覆寫 DEFAULT_THRESHOLDS

    回傳 dict：wf_id / install_id / match_score / match_status / matched_by。
    永遠不會丟例外——配不到就是 unmatched，交給人工佇列。
    """
    th = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    installs = installs or []

    def verdict(wf_id, install_id, score, by):
        if score >= th['matched']:
            status = 'matched'
        elif score >= th['pending']:
            status = 'pending'
        else:
            status = 'unmatched'
            wf_id = install_id = None
        return {
            'wf_id': wf_id,
            'install_id': install_id,
            'match_score': round(score, 2),
            'match_status': status,
            'matched_by': by if status != 'unmatched' else None,
        }

    # ---- Path A：貨運單上有我方單號，精確查表 ----
    order_no = (row.get('order_no') or '').strip()
    if order_no:
        for ins in installs:
            if (ins.get('shipment_no') or '').strip() == order_no:
                return verdict(ins.get('wf_id'), ins.get('id'), 1.0, 'auto_order_no')

    # ---- Path B：模糊比對 ----
    ship_addr = norm_addr_match(row.get('recipient_address'))
    ship_phone = norm_phone(row.get('recipient_phone'))
    ship_name = norm_name(row.get('recipient_name'))

    # B1. 新竹「收貨人代號」對 customers.dealer_code —— 貨運商系統裡的固定代號，可信度最高
    code = (row.get('recipient_code') or '').strip()
    if code:
        for c in customers:
            if (c.get('dealer_code') or '').strip() == code:
                return verdict(c.get('wf_id'), None, 1.0, 'auto_dealer_code')

    if not ship_addr:
        return verdict(None, None, 0.0, None)

    best = (0.0, None, None)  # (score, wf_id, install_id)
    for c in customers:
        cust_addr = norm_addr_match(c.get('address'))
        cust_phone = norm_phone(c.get('phone'))
        cust_name = norm_name(c.get('name'))
        if not cust_addr:
            continue

        phone_hit = bool(ship_phone and cust_phone and ship_phone == cust_phone)

        if cust_addr == ship_addr:
            score = 1.0 if phone_hit else 0.95
        elif phone_hit and edit_distance(cust_addr, ship_addr, cap=2) <= 2:
            score = 0.85
        elif (ship_name and cust_name and ship_name == cust_name
              and cust_addr[:6] == ship_addr[:6]):
            # 同名 + 同縣市區，證據薄弱，只夠進人工佇列
            score = 0.6
        else:
            continue

        if score > best[0]:
            best = (score, c.get('wf_id'), None)

    # 對到客戶後，再往下找該客戶「已出貨、尚無託運單號」的安裝單，縮小誤配面
    score, wf_id, _ = best
    install_id = None
    if wf_id:
        for ins in installs:
            if ins.get('wf_id') != wf_id:
                continue
            if ins.get('tracking_no'):
                continue
            if ins.get('shipment_no'):
                install_id = ins.get('id')
                break

    by = 'auto_addr' if score > 0 else None
    return verdict(wf_id, install_id, score, by)
