# 從歷史出貨紀錄回答三個問題：
#   ① 每款鎖實際出過哪些料號、各幾次？（→ 業務用白話篩料號的資料來源）
#   ② 業務在主件之外額外加了哪些零件？有沒有規則？
#   ③ 每個參數段最常用的值是什麼？（→ 預設值的依據）
#
# ── 為什麼需要這支 ──────────────────────────────────────
# 料號是組出來的，理論組合數上看百萬（見 scripts/parse-order-specs.py）。
# 但**實際出過的只有幾百種**——L376 十年來只出過 271 種。
# 這個落差是整件事的關鍵：與其讓業務逐段選 20 個參數去「生」一個料號
# （生出來的還可能是 TIPTOP 裡沒有的新料號），不如拿她的白話去**篩歷史**，
# 候選必定存在、必定出過貨、還附帶「出過幾次」當排序依據。
#
# ── 資料來源都不在版控裡 ──────────────────────────────
#   Skype 對話紀錄：含真實客戶姓名、電話、地址 → 已 gitignore
#   BOM：由工程單位維護，放進 git 會變第二份副本
# 所以這支跑之前要先確認檔案在不在，不在就明講、不要靜默跳過。
#
#   python scripts/analyze-shipment-history.py L376
#
# ── 除了印出統計，還會產出給小幫手用的 CSV ──────────────
# docs/歷史料號_<型號>.csv：一列一個歷史料號，每個參數段攤平成一欄。
# 這份 CSV 貼進試算表的「歷史料號」分頁之後，GAS 端就只要做字串比對，
# **不必把 835 KB 的料號參數字典搬進 Apps Script**。
# 重活（拆段、查字典、翻中文）留在這裡做，GAS 只做確定性的篩選。
import collections
import csv
import json
import os
import re
import sys
import warnings

warnings.filterwarnings("ignore")
from openpyxl import load_workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAT = os.path.join(ROOT, "teams對話紀錄", "Skype對話紀錄.xlsx")
DICT = os.path.join(ROOT, "docs", "料號參數字典.json")
# 出貨相關的分頁。全部訊息那個分頁是彙總，會重複計算，刻意不掃。
SHEETS = ["台中成品出貨", "出貨-台北出貨8-14新群組", "高雄成品出貨"]
OUT_DIR = os.path.join(ROOT, "docs")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def die(msg):
    print("🔴 " + msg)
    sys.exit(1)


def load_dict(model):
    if not os.path.exists(DICT):
        die(f"找不到 {DICT}，請先跑 scripts/parse-order-specs.py")
    d = json.load(open(DICT, encoding="utf-8"))
    if model not in d:
        die(f"字典裡沒有 {model}。有的是：{'、'.join(sorted(d)[:12])}…")
    segs = [s for s in d[model]["segments"] if s["type"] != "sep"]
    return segs


def scan(model, segs):
    """掃出貨群組，抓出所有『長度對得上遮罩』的完整料號。

    ⚠ 一定要比對長度。只用前綴比對會撈到一堆半截的東西
      （例如訊息裡寫 L376-1C11 就沒了），那些拆段會錯位。
    """
    if not os.path.exists(CHAT):
        die(f"找不到 {CHAT}（含個資，不進版控；請自行放置）")
    want = sum(len(s["mask"]) for s in segs)
    pat = re.compile(r"\b" + model + r"(?:-[A-Z0-9]{2,10}){2,}\b")

    wb = load_workbook(CHAT, read_only=True, data_only=True)
    seen, scanned = collections.Counter(), 0
    for name in SHEETS:
        if name not in wb.sheetnames:
            print(f"  ⚠ 沒有分頁「{name}」，跳過")
            continue
        for i, row in enumerate(wb[name].iter_rows(values_only=True), start=1):
            if i == 1 or len(row) < 4 or not row[3]:
                continue
            scanned += 1
            m = pat.search(str(row[3]))
            if m and len(m.group(0).replace("-", "")) == want:
                seen[m.group(0)] += 1
    wb.close()
    return seen, scanned


def split(pn, segs):
    body = pn.replace("-", "")
    pos, out = 0, {}
    for s in segs:
        out[s["name"]] = body[pos:pos + len(s["mask"])].upper()
        pos += len(s["mask"])
    return out


def write_csv(model, segs, seen):
    """產出「歷史料號」分頁用的 CSV：一列一個料號，參數段攤平成欄。

    欄值刻意放**中文說明**而不是代碼（放「消光黑」不是放「C」）。三個理由：
      ① GAS 端篩選就變成純字串比對，不必載入 835 KB 的字典
      ② AI 的 prompt 直接餵這些中文值當可選項，白話對應關係最短
      ③ 人打開分頁看得懂，出錯時查得出來

    只輸出 choice 段。fixed 段（鎖=L、產品型號=376）每一列都一樣，是雜訊。
    """
    cols = [s for s in segs if s["type"] == "choice"]
    if not cols:
        die(f"{model} 沒有任何可選參數段，不產 CSV")

    # 段名是 GAS 端的欄位鍵。重名會讓後面那個安靜蓋掉前面那個——
    # split() 也是用段名當 key，同樣會中招。寧可停下來也不要產出一份錯的表。
    names = [s["name"] for s in cols]
    dup = [n for n in set(names) if names.count(n) > 1]
    if dup:
        die(f"{model} 有重名的參數段 {dup}，會讓欄位互相覆蓋。請先修 docs/料號參數字典.json")

    desc = {s["name"]: {o["code"].upper(): o["desc"] for o in s["options"]} for s in cols}
    miss = collections.Counter()   # (段名, 代碼) → 幾筆查不到說明

    rows = []
    for pn, cnt in seen.most_common():
        seg = split(pn, segs)
        line = [pn, cnt]
        for s in cols:
            code = seg[s["name"]]
            d = desc[s["name"]].get(code)
            if d is None:
                # 查不到就寫代碼原值，**不塞空白**——空白會讓人以為這段沒有值，
                # 而實際上是規格表沒收錄這個代碼（多半是舊料號用了已下架的選項）。
                miss[(s["name"], code)] += cnt
                d = code
            line.append(d)
        rows.append(line)

    out = os.path.join(OUT_DIR, f"歷史料號_{model}.csv")
    # utf-8-sig：Excel 直接點開才不會變亂碼（貼進 Google 試算表兩種都行）
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["料號", "出過次數"] + names)
        w.writerows(rows)

    print(f"\n✅ 已寫出 {out}")
    print(f"   {len(rows)} 列 × {len(names) + 2} 欄（料號、出過次數，＋{len(names)} 個參數段）")

    if miss:
        # 顯性失敗：這些代碼規格表裡查不到，欄位放的是代碼不是中文。
        # 業務用白話篩的時候篩不到它們——要讓人知道，不能靜默。
        total_miss = sum(miss.values())
        print(f"\n⚠ 有 {len(miss)} 種代碼在規格表裡查不到說明"
              f"（影響 {total_miss} 次出貨，該欄位填的是代碼原值）：")
        for (name, code), c in miss.most_common(10):
            print(f"     【{name}】{code}　{c} 次")
        print("   → 這些值業務用白話篩不到。若常出現，要回頭補 docs/料號參數字典.json")
    else:
        print("   每一段的代碼都查得到中文說明，沒有漏的。")


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "L376"
    segs = load_dict(model)
    seen, scanned = scan(model, segs)
    total = sum(seen.values())
    if not total:
        die(f"掃了 {scanned:,} 則訊息，一筆 {model} 的完整料號都沒找到")

    print(f"{model}　掃 {scanned:,} 則訊息")
    print(f"  出過 {len(seen)} 種不同料號，共 {total} 次\n")

    print("最常出貨的十種：")
    for pn, c in seen.most_common(10):
        print(f"  {pn}   {c} 次")

    desc = {s["name"]: {o["code"].upper(): o["desc"] for o in s["options"]} for s in segs}
    print(f"\n每一段最常用的值（可當預設值，但**佔比低的不要當預設**）：")
    for s in segs:
        if len(s["options"]) <= 1:
            continue
        c = collections.Counter(split(pn, segs)[s["name"]] for pn in seen.elements())
        top, n = c.most_common(1)[0]
        print(f"  {s['name'][:10]:<12}{top:<4}{n / total * 100:>5.1f}%   "
              f"{desc[s['name']].get(top, '（代碼不在規格表）')[:34]}")

    # 只差一段的配對＝最容易看錯的，這是防呆功能要擋的東西
    print("\n只差一段的料號配對（最容易看錯，防呆要擋這個）：")
    top = [p for p, _ in seen.most_common(40)]
    shown = 0
    for i in range(len(top)):
        for j in range(i + 1, len(top)):
            a, b = split(top[i], segs), split(top[j], segs)
            diff = [k for k in a if a[k] != b[k]]
            if len(diff) == 1 and shown < 5:
                k = diff[0]
                print(f"  {top[i]}（{seen[top[i]]}次）")
                print(f"  {top[j]}（{seen[top[j]]}次）")
                print(f"     只差【{k}】{a[k]} vs {b[k]}"
                      f"　{desc[k].get(a[k],'?')[:18]} / {desc[k].get(b[k],'?')[:18]}\n")
                shown += 1

    # 放最後：上面的統計是給人核對用的，就算這裡因為字典有問題而中止，
    # 人也已經看到掃描結果了。
    write_csv(model, segs, seen)


if __name__ == "__main__":
    main()
