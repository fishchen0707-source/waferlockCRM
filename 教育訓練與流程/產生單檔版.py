# 把「派工出貨手冊.html」＋ img/raw 的截圖打包成**一個檔案**。
#
# 為什麼要有單檔版：手冊要丟到 Google Drive／內網／用 email 寄給人。
# 那些地方一旦把 HTML 和 img 資料夾拆開，或是只轉寄 HTML，圖就全破了。
# 內嵌成 base64 之後只有一個檔，丟到哪都能開。
#
# 為什麼產物不進版控：4.5 MB，而且每次重產內容都會全部改寫，
# git 會被撐爆。要的人自己跑這支就有了。
#
#   python 教育訓練與流程/產生單檔版.py
import base64
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "派工出貨手冊.html")
DST = os.path.join(HERE, "派工出貨手冊_單檔版.html")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

src = io.open(SRC, encoding="utf-8").read()
missing, total = [], 0


def inline(m):
    global total
    rel = m.group(1)
    path = os.path.join(HERE, rel)
    if not os.path.exists(path):
        missing.append(rel)
        return m.group(0)
    data = open(path, "rb").read()
    total += len(data)
    return 'src="data:image/png;base64,' + base64.b64encode(data).decode("ascii") + '"'


out = re.sub(r'src="(img/raw/[^"]+)"', inline, src)

# 兩個檔長得一模一樣，不標的話日後沒人知道該改哪一個
out = out.replace(
    "<span>四角色操作手冊 v1 · 2026-08-26</span>",
    "<span>四角色操作手冊 v1 · 2026-08-26<br>單檔版（圖片已內嵌）</span>")
out = out.replace(
    "系統有更動時，請一併更新本手冊與 <code>教育訓練與流程/shoot_gas.py</code> 重拍截圖。",
    "系統有更動時，請一併更新本手冊與 <code>教育訓練與流程/shoot_gas.py</code> 重拍截圖。<br>"
    "<b>這是單檔版（圖片已內嵌成 base64），可以單獨複製到任何地方開啟。</b>"
    "要改內容請改 <code>教育訓練與流程/派工出貨手冊.html</code> 再重新產生這一份。")

io.open(DST, "w", encoding="utf-8", newline="\n").write(out)

print("內嵌圖片 %.1f MB → 單檔 %.1f MB" % (total / 1048576, os.path.getsize(DST) / 1048576))
print("→ " + DST)
if missing:
    print("⚠ 這些圖找不到，仍然是外部連結（單檔版會破圖）：")
    for m in missing:
        print("   " + m)
elif out.count("img/raw/"):
    print("⚠ 還殘留 %d 個 img/raw 引用" % out.count("img/raw/"))
else:
    print("零外部引用，可以單獨搬走。")
