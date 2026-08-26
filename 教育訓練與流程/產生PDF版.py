# 把手冊產生成 PDF，給「要放雲端硬碟讓人直接點開看」用。
#
# 為什麼要 PDF 而不是直接放 HTML：
#   Google Drive／OneDrive 都**不渲染 HTML**，點下去只有下載鈕，手機上尤其麻煩。
#   PDF 是這兩家都原生預覽的格式，電腦手機點了就看，而且不必公開到網路上。
#
# 🔑 這支腳本存在的真正理由是「切圖」：
#   手冊裡有幾張整頁截圖高達 2824px（出貨登錄、倉庫核單的完整清單）。
#   A4 一頁的內容區高寬比大約 1.45，這種圖塞進一頁會被縮到 161pt 寬——
#   等於一條看不清楚的細長條（2026-08-26 第一次試做就是這樣）。
#   瀏覽器**不會**把單一張 <img> 拆到兩頁，所以只能事先切開。
#
#   python 教育訓練與流程/產生PDF版.py
import base64
import io
import math
import os
import re
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "派工出貨手冊.html")
DST = os.path.join(HERE, "派工出貨手冊.pdf")
TMP = os.path.join(HERE, "img", "_pdf_slices")

# A4 直式、上下左右留白之後，內容區高寬比大約 1.45。
# 抓 1.35 當門檻留一點餘裕，超過就切。
MAX_RATIO = 1.35
OVERLAP = 40          # 切點上下各留一點重疊，免得剛好切在一行字中間

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

os.makedirs(TMP, exist_ok=True)

PRINT_CSS = """
@page { size: A4; margin: 14mm 12mm; }
.sidebar { display: none !important; }
main { margin-left: 0 !important; max-width: none !important; padding: 0 !important; }
/* 每個角色一章從新的一頁開始，列印出來才好翻 */
h2 { break-before: page; page-break-before: always; }
h2:first-of-type { break-before: auto; page-break-before: auto; }
h3, .steps, table, .note, .warn { break-inside: avoid; page-break-inside: avoid; }
.fig { break-inside: avoid; page-break-inside: avoid; }
.fig img { max-height: 235mm; width: auto; max-width: 100%; }
"""


def slice_tall(rel):
    """把過高的圖切成好幾段。回傳 [(相對路徑, 第幾段, 共幾段)]。"""
    path = os.path.join(HERE, rel)
    im = Image.open(path)
    w, h = im.size
    if h / w <= MAX_RATIO:
        return [(rel, 1, 1)]

    n = math.ceil((h / w) / MAX_RATIO)
    step = math.ceil(h / n)
    base = os.path.splitext(os.path.basename(rel))[0]
    out = []
    for i in range(n):
        top = max(0, i * step - (OVERLAP if i else 0))
        bottom = min(h, (i + 1) * step + (OVERLAP if i < n - 1 else 0))
        name = f"{base}__{i + 1}of{n}.png"
        im.crop((0, top, w, bottom)).save(os.path.join(TMP, name))
        out.append((f"img/_pdf_slices/{name}", i + 1, n))
    print(f"  切開 {rel}（{w}x{h}，高寬比 {h / w:.1f}）→ {n} 段")
    return out


FIG_RE = re.compile(
    r'<div class="fig([^"]*)">\s*<img src="(img/raw/[^"]+)" alt="([^"]*)">\s*'
    r'<div class="cap">(.*?)</div>\s*</div>',
    re.S)


def expand(m):
    cls, rel, alt, cap = m.groups()
    parts = slice_tall(rel)
    if len(parts) == 1:
        return m.group(0)
    out = []
    for p, i, n in parts:
        tail = f'　<b>（{i} / {n} 段，接下頁）</b>' if i < n else f'　<b>（{i} / {n} 段）</b>'
        out.append(f'<div class="fig{cls}">\n  <img src="{p}" alt="{alt}">\n'
                   f'  <div class="cap">{cap}{tail}</div>\n</div>')
    return "\n".join(out)


def inline(m):
    rel = m.group(1)
    path = os.path.join(HERE, rel)
    if not os.path.exists(path):
        print(f"  ⚠ 找不到 {rel}")
        return m.group(0)
    data = open(path, "rb").read()
    return 'src="data:image/png;base64,' + base64.b64encode(data).decode("ascii") + '"'


print("① 處理過高的截圖")
html = FIG_RE.sub(expand, io.open(SRC, encoding="utf-8").read())

print("② 內嵌圖片")
html = re.sub(r'src="(img/(?:raw|_pdf_slices)/[^"]+)"', inline, html)

work = os.path.join(TMP, "_print.html")
io.open(work, "w", encoding="utf-8", newline="\n").write(html)

print("③ 輸出 PDF")
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page()
    pg.goto("file:///" + work.replace("\\", "/"), wait_until="load")
    pg.wait_for_timeout(4000)
    pg.add_style_tag(content=PRINT_CSS)
    pg.emulate_media(media="print")
    pg.wait_for_timeout(1500)
    pg.pdf(path=DST, format="A4", print_background=True,
           margin={"top": "14mm", "bottom": "14mm", "left": "12mm", "right": "12mm"})
    b.close()

print("完成 %.1f MB → %s" % (os.path.getsize(DST) / 1048576, DST))
