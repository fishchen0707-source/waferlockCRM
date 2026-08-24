# clasp 部署說明（GAS 專案）

> ⚠️ **最重要的一條：不要對這個 repo 直接跑 `clasp pull`。**
> `pull` 是「用雲端覆蓋本機」。本機的 `.gs` 通常比雲端新（開發都在本機做），
> 直接 pull 會把還沒部署的改動整個蓋掉，而且不會有任何警告。
> 需要雲端檔案時，一律先 pull 到一個丟棄用的暫存資料夾，再挑要的檔案複製回來。

## 這個 repo 有幾個 Apps Script 專案

`.gs` 檔不是全部屬於同一個專案，一個 `.clasp.json` 只能指向一個專案：

| 專案 | 檔案 | 說明 |
|---|---|---|
| 派工簽核 | `gas-dispatch-approval.gs`＋`gas-dispatch-notify.gs` | notify 必須與 approval 同專案，它直接呼叫 approval 的 `getPending_()` |
| 報表 | `gas-dispatch-report.gs` | 自己有 `doGet`，是獨立的 Web App |
| 收信／出貨匯入 | `gas-email-intake.gs`、`gas-shipment-intake.gs` | 歸屬未確認，用前先查 |

所以每個專案各自一份設定檔，用 `-P` 與 `-I` 指定。

## 一次性設定

**1. 登入**（會開瀏覽器，需要您本人操作）

```bash
clasp login
```

**2. 開啟 Apps Script API**（只要做一次）

到 https://script.google.com/home/usersettings 把「Google Apps Script API」打開。沒開的話 clasp 會報 403。

**3. 取得 scriptId**

在 Apps Script 編輯器裡：專案設定 → 「指令碼 ID」。

**4. 建立 `.clasp-dispatch.json`**（放在 repo 根目錄）

```json
{
  "scriptId": "把指令碼ID貼這裡",
  "rootDir": "docs"
}
```

**5. 取得 `appsscript.json`**

clasp 需要 `docs/appsscript.json` 才能 push，但本機還沒有。用暫存資料夾拿，**不要**在 repo 裡 pull：

```bash
mkdir /tmp/gaspull && cd /tmp/gaspull && clasp clone <指令碼ID> && cp appsscript.json "/c/Projects/保固登錄頁面/docs/"
```

## 日常部署

**每次 push 前先看會上傳什麼**（唯讀，不會改動任何東西）：

```bash
clasp -P .clasp-dispatch.json -I .claspignore-dispatch status
```

確認清單只有 `appsscript.json`、`gas-dispatch-approval.gs`、`gas-dispatch-notify.gs` 三個，再推：

```bash
clasp -P .clasp-dispatch.json -I .claspignore-dispatch push
```

## push 之後還要做一件事

`push` 只更新程式碼，**不會更新使用者實際開啟的網址**。Web App 要重新部署才會生效：

```bash
clasp -P .clasp-dispatch.json redeploy <deploymentId>
```

deploymentId 用這個查：

```bash
clasp -P .clasp-dispatch.json deployments
```

⚠️ 一定要用 `redeploy` 更新**既有的** deployment。用 `clasp deploy` 會產生**新的**部署與新網址，
而 `DISPATCH_WEBAPP_URL` 與所有 Chat 通知裡的深連結都還指向舊網址——
症狀是「新功能明明推上去了，但點通知連結進去還是舊畫面」，很難查。

## 兩個部署：一個測試、一個正式

```
AKfycby…  @HEAD   測試網址，永遠跑最新 push 的程式碼
AKfycbw…  @25     正式網址，Chat 通知的深連結都指向這個
```

`push` 之後 **@HEAD 那個網址立刻就會變**，正式網址不會動。
所以正確順序是：**push → 開 @HEAD 網址驗過 → 才更新正式網址**。
這比「壞了再退回」安全，因為使用者從頭到尾看不到壞掉的版本。

查網址：

```bash
clasp -P .clasp-dispatch.json open-web-app AKfycbyLqkAzY77K4wzmzSXemDuUcwhVkZ972KqSEoRL_k7Y
```

## 怎麼退回（三層）

### 第一層：線上網頁退回（最急的時候用這個）

Apps Script 的部署是**版本化**的，退回不需要動程式碼，30 秒生效：

```bash
clasp -P .clasp-dispatch.json versions
```
```bash
clasp -P .clasp-dispatch.json redeploy AKfycbw_Di2rLjY6grnCtOVMmQyoGGtVNZHoBh3hlA-o7XqUlZQIRriIuXcBwNpA9dTAUV-n8w -V 25
```

`-V` 後面換成要退回的版本號。**正式網址不變**，所有 Chat 深連結照樣可用。

> 前提是每次部署前都有先建版本，否則沒有東西可退：
>
> ```bash
> clasp -P .clasp-dispatch.json version "這次改了什麼"
> ```
>
> 先 `version` 再 `redeploy -V <新版號>`，每個上線狀態才都有對應的版本號。

### 第二層：程式碼退回

```bash
git checkout pre-dashboard-20260824
```

重要的上線前狀態都打 tag，`git tag -l -n3` 可以看全部。

### 第三層：雲端原始碼快照

萬一版本與 git 都不可靠（例如有人直接在 Apps Script 編輯器改過線上程式，本機沒有那份），
上線前的雲端原貌留在：

`C:\Projects\_backup_保固登錄頁面_20260824_merge前\_gas雲端快照_v25\`

取雲端現況的正確做法（**不要在 repo 裡 pull**）：

```bash
mkdir /tmp/gaspull && cd /tmp/gaspull && clasp clone <指令碼ID>
```

### push 前一定要做的檢查

雲端可能有本機沒有的改動（有人直接在編輯器改）。push 是**單向覆蓋**，不會警告。
所以每次 push 前先用上面的方式 clone 一份，跟本機比對：

```bash
diff --strip-trailing-cr /tmp/gaspull/gas-dispatch-approval.js docs/gas-dispatch-approval.gs
```

只有「本機是雲端的超集」才可以放心 push。

---

## 部署前的檢查清單

```bash
node scripts/verify-dispatch-approval.js
```
```bash
node scripts/verify-dispatch-report.js
```

兩支都要全過再 push。
