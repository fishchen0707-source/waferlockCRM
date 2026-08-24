# -*- coding: utf-8 -*-
"""
配對引擎測試。無需測試框架，直接 `python test_matching.py`。

每個測試都對應一個「錯了會出事」的行為，而不是只驗證函式有回傳值：
  - 地址正規化錯 → 配不到客戶，客服得繼續人工翻 PDF（系統等於沒做）
  - 地址正規化過頭 → 不同住戶被視為同一人，追蹤號碼推錯人＝洩漏他人地址
  - 低信心卻自動掛上 → 同上，這是本系統最嚴重的失效模式

測試資料取自 2026/07/30 的真實託運單（新竹 + 大榮）。
"""

import sys

from matching import (
    _cn_to_int,
    edit_distance,
    match_row,
    norm_addr_match,
    norm_name,
    norm_phone,
)

_failures = []


def check(label, actual, expected):
    if actual != expected:
        _failures.append(f'{label}\n    實際: {actual!r}\n    預期: {expected!r}')


def check_true(label, cond, detail=''):
    if not cond:
        _failures.append(f'{label}{(chr(10) + "    " + detail) if detail else ""}')


# ---------------------------------------------------------------- 中文數字
# 錯了會讓「三十五號」變成「305號」，門牌整個對不上。
def test_cn_numerals():
    check('中文數字 十', _cn_to_int('十'), 10)
    check('中文數字 十二', _cn_to_int('十二'), 12)
    check('中文數字 二十', _cn_to_int('二十'), 20)
    check('中文數字 三十五', _cn_to_int('三十五'), 35)
    check('中文數字 一百二十三', _cn_to_int('一百二十三'), 123)
    check('中文數字 一', _cn_to_int('一'), 1)


# ------------------------------------------------------------ 地址正規化
# 以下每一組都是「同一個地點的兩種寫法」，必須收斂成同一字串，
# 否則貨運單上的地址永遠對不到 CRM 裡的客戶。
def test_addr_equivalence():
    same = [
        (
            '郵遞區號前綴 + 臺/台 + 里名 + 中文樓層',
            '434臺中市龍井區東海里遠東街47號四樓之11',
            '台中市龍井區遠東街47號4樓之11',
        ),
        (
            '路名中文數字 + 之一',
            '台中市南屯區文心南三路408號5樓之一',
            '台中市南屯區文心南3路408號5樓之1',
        ),
        (
            '郵遞區號 + 之1 與 -1 互通',
            '235新北市中和區建八路2號12樓之1',
            '新北市中和區建8路2號12樓-1',
        ),
        (
            '英文樓層 F 與中文樓',
            '高雄市三民區九如一路807號11F',
            '高雄市三民區九如一路807號11樓',
        ),
        (
            '全形字元與空白',
            '台南市永康區永大路二段６７７巷３號',
            '台南市永康區永大路2段677巷3號',
        ),
    ]
    for label, a, b in same:
        na, nb = norm_addr_match(a), norm_addr_match(b)
        check_true(f'地址應視為相同：{label}', na == nb, f'{na!r} != {nb!r}')


def test_addr_not_over_normalized():
    """正規化不能把不同地址壓成一樣——這是推錯人的直接成因。"""
    different = [
        ('不同樓別', '新北市中和區橋和路122號13樓之2', '新北市中和區橋和路122號13樓之3'),
        ('不同門牌', '嘉義市東區林森東路35號', '嘉義市東區林森東路36號'),
        ('不同行政區', '台北市大安區臥龍街151巷9號', '台北市信義區臥龍街151巷9號'),
        ('不同縣市同路名', '台中市南屯區文心南三路408號', '台南市南屯區文心南三路408號'),
    ]
    for label, a, b in different:
        na, nb = norm_addr_match(a), norm_addr_match(b)
        check_true(f'地址不可視為相同：{label}', na != nb, f'兩者都變成 {na!r}')


def test_addr_keeps_district():
    """里名移除不可誤傷行政區（曾發生正則貪婪吃掉「龍井區」的 bug）。"""
    out = norm_addr_match('434臺中市龍井區東海里遠東街47號四樓之11')
    check_true('保留縣市', '台中市' in out, out)
    check_true('保留行政區', '龍井區' in out, out)
    check_true('移除里名', '東海里' not in out, out)


def test_phone_and_name():
    check('電話去符號', norm_phone('0911-313-275'), '0911313275')
    check('電話國碼還原', norm_phone('+886-911-313-275'), '0911313275')
    check('電話市話', norm_phone('02-82272137'), '0282272137')
    check('公司後綴移除', norm_name('大內高手鎖業有限公司'), '大內高手鎖業')
    check('股份有限公司', norm_name('廣程不銹鋼材料股份有限公司'), '廣程不銹鋼材料')


def test_edit_distance():
    check('相同字串', edit_distance('abc', 'abc'), 0)
    check('一字之差', edit_distance('abc', 'abd'), 1)
    check('超過上限提早放棄', edit_distance('abcdefgh', 'zzzzzzzz', cap=2), 3)


# ---------------------------------------------------------------- 配對
_CUSTOMERS = [
    {'wf_id': 'WF001', 'name': '大內高手鎖業有限公司', 'phone': '02-2926-6999',
     'address': '新北市中和區橋和路122號13樓之2', 'dealer_code': None},
    {'wf_id': 'WF002', 'name': '維夫拉克(股)公司', 'phone': '02-82272137',
     'address': '235新北市中和區建八路2號12樓之1', 'dealer_code': '102'},
    {'wf_id': 'WF003', 'name': '蔡易達', 'phone': '0972-985377',
     'address': '台中市龍井區遠東街47號4樓之11', 'dealer_code': None},
    {'wf_id': 'WF004', 'name': '王小明', 'phone': '0911-000-000',
     'address': '台北市信義區松高路1號', 'dealer_code': None},
]
_INSTALLS = [
    {'id': 'I-001', 'wf_id': 'WF001', 'shipment_no': 'SO-2026073001', 'tracking_no': None},
    {'id': 'I-002', 'wf_id': 'WF003', 'shipment_no': 'SO-2026073002', 'tracking_no': None},
]


def test_path_a_wins():
    """有我方單號時必須走精確查表，且優先於任何地址比對。"""
    row = {'order_no': 'SO-2026073001', 'recipient_address': '完全不相干的地址',
           'recipient_phone': '', 'recipient_name': '', 'recipient_code': ''}
    r = match_row(row, _CUSTOMERS, _INSTALLS)
    check('Path A 客編', r['wf_id'], 'WF001')
    check('Path A 安裝單', r['install_id'], 'I-001')
    check('Path A 分數', r['match_score'], 1.0)
    check('Path A 來源', r['matched_by'], 'auto_order_no')
    check('Path A 狀態', r['match_status'], 'matched')


def test_dealer_code():
    row = {'order_no': '', 'recipient_code': '102', 'recipient_name': '維夫拉克(股)公司',
           'recipient_phone': '02-82272137', 'recipient_address': '任意地址'}
    r = match_row(row, _CUSTOMERS, _INSTALLS)
    check('收貨人代號配對', r['wf_id'], 'WF002')
    check('收貨人代號來源', r['matched_by'], 'auto_dealer_code')


def test_addr_exact_with_phone():
    """真實樣本：貨運單寫「434臺中市…東海里…四樓之11」，CRM 寫簡化版，應對上。"""
    row = {'order_no': '', 'recipient_code': '',
           'recipient_name': '蔡易達', 'recipient_phone': '0972-985377',
           'recipient_address': '434臺中市龍井區東海里遠東街47號四樓之11'}
    r = match_row(row, _CUSTOMERS, _INSTALLS)
    check('地址+電話配對客編', r['wf_id'], 'WF003')
    check('地址+電話分數', r['match_score'], 1.0)
    check('地址+電話狀態', r['match_status'], 'matched')
    check('連帶帶出安裝單', r['install_id'], 'I-002')


def test_weak_evidence_never_auto_matched():
    """證據薄弱時只能進人工佇列。自動掛上＝把追蹤號碼推給錯的人。"""
    row = {'order_no': '', 'recipient_code': '',
           'recipient_name': '王小明', 'recipient_phone': '',
           'recipient_address': '台北市信義區松高路999號'}
    r = match_row(row, _CUSTOMERS, _INSTALLS)
    check_true('弱證據不可自動配對', r['match_status'] != 'matched',
               f"狀態={r['match_status']} 分數={r['match_score']}")


def test_no_match_returns_nothing():
    """對不到就必須是 unmatched 且不帶客編，不可硬塞一個最接近的。"""
    row = {'order_no': '', 'recipient_code': '',
           'recipient_name': '路人甲', 'recipient_phone': '0900-000-000',
           'recipient_address': '花蓮縣吉安鄉中央路三段100號'}
    r = match_row(row, _CUSTOMERS, _INSTALLS)
    check('對不到狀態', r['match_status'], 'unmatched')
    check('對不到不可帶客編', r['wf_id'], None)
    check('對不到不可帶安裝單', r['install_id'], None)


def test_construction_site_address_goes_to_queue():
    """樣本裡的「373號對面工地」是非標準地址，本來就該落到人工佇列。"""
    row = {'order_no': '', 'recipient_code': '',
           'recipient_name': '楊再興主任', 'recipient_phone': '0987-505-970',
           'recipient_address': '台南市永康區永華路373號對面工地'}
    r = match_row(row, _CUSTOMERS, _INSTALLS)
    check_true('工地地址不可自動配對', r['match_status'] != 'matched',
               f"狀態={r['match_status']}")


if __name__ == '__main__':
    tests = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    for t in tests:
        t()
    if _failures:
        print(f'✗ 失敗 {len(_failures)} 項：\n')
        for f in _failures:
            print(f'  - {f}\n')
        sys.exit(1)
    print(f'✓ 全部通過（{len(tests)} 組測試）')
