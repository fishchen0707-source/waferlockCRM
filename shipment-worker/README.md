# shipment-worker — 貨運託運單 PDF 解析與客戶配對

把新竹物流／嘉里大榮的託運清單 PDF 解析成結構化資料，配對到 CRM 客戶，寫進 `shipments` 表。
客服因此不必再進 Teams 翻當天的 PDF 找客戶的追蹤號碼。

## 為什麼是獨立的 Python worker

PDF 解析用 PyMuPDF，Supabase Edge Function（Deno）沒有對應品。所以分工是：

```
Drive「貨運單」資料夾
   └─ docs/gas-shipment-intake.gs（每 5 分鐘）
        └─ Edge Function shipment-intake ── 收檔、存 Storage、排進 shipment_files 佇列
             └─ 本 worker ── 解析 PDF、配對客戶、寫入 shipments
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `parsers.py` | PDF → 結構化欄位。兩家各一支座標式解析器 |
| `matching.py` | 地址／電話正規化與配對引擎 |
| `main.py` | 輪詢 `shipment_files` 佇列的 worker |
| `test_matching.py` | 配對引擎測試，`python test_matching.py` |

## 兩個必須知道的坑

**1. PDF 文字是 Big5 亂碼，但可以還原。**
兩家的字型都是 Identity-H 並帶 ToUnicode CMap，但那份 CMap 把字碼映射到 **Big5 碼位**而非
Unicode，所以 PyMuPDF／pypdf 直接抽取會得到亂碼。`parsers.recover_big5()` 負責還原，
已對兩家實測 100% 正確。**不需要 OCR。**

**2. 不可依賴文字流順序，必須用座標。**
`get_text()` 的輸出順序不等於視覺閱讀順序（大榮表頭的「食品」欄會被丟到序列最後）。
兩支解析器都以 bbox 分列分欄。

## 地址正規化有兩套，不要混用

| 函式 | 用途 | 可否修改 |
|---|---|---|
| `waferlock_crm.html` 的 `normAddr()` | 客編 `custKey` 的一部分，是**識別鍵** | ❌ 改了會讓既有客戶的客編歸戶錯亂 |
| `matching.norm_addr_match()` | 只用於**比對**，不作為 key 儲存 | ✅ 可放心加強 |

兩者的共同基底（全形→半形、臺→台、去空白、轉小寫）刻意保持一致。

## 配對兩條路

- **Path A（首選）**：託運單上的「訂單編號」(新竹) /「出貨單號」(大榮) 若填了 TipTop 出貨單號，
  直接對 `installs.shipment_no`，精確、score 1.0、可全自動。
- **Path B（目前現況）**：上述欄位空白時，靠地址正規化 + 電話模糊比對。有失敗率，
  低信心一律進 CRM「託運單配對」頁由人工處理。

> 2026/07/30 樣本顯示兩家的欄位都**存在但未填**。若能請出貨同仁在建託運單時填入出貨單號，
> 配對準確率可直接從約七成拉到 100%，並省下人工佇列。這是本專案投報率最高的一件事。

## 執行

```bash
pip install -r requirements.txt
```

環境變數：

| 變數 | 說明 |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 讀寫 `shipments`、下載 Storage |
| `SHIPMENT_BUCKET` | 預設 `shipment-docs` |

```bash
python main.py              # 跑一次（適合排程）
python main.py --loop 300   # 每 300 秒輪詢一次
```

單獨試解析（不碰資料庫，適合拿到新版型時先勘查）：

```bash
python parsers.py 某份託運單.pdf
```

會印出每一筆並輸出 `./output/<檔名>.json`，同時拿解析筆數對 PDF 自印的「合計 N 筆」，
對不上會明確警告——這是防止安靜漏抓的主要防線。

## 配對門檻

預設 `>=0.9` 自動配對、`0.6~0.9` 進人工佇列、`<0.6` unmatched。
要調整不必改程式，在 `config` 表新增一列：

| key | value |
|---|---|
| `shipment_match_thresholds` | `{"matched":0.92,"pending":0.7}` |
