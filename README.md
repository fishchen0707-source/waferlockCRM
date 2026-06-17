# 電子鎖保固卡 + 保固登錄系統（WordPress）

## 專案結構

```
保固登錄頁面/
├── README.md                          ← 本文件
├── warranty-card/
│   └── warranty-card.html             ← 保固卡（A6 雙面、可直接列印 / 交印刷廠）
├── wp-plugin/
│   └── lock-warranty/
│       ├── lock-warranty.php          ← WordPress 外掛主程式
│       └── assets/
│           ├── form.css               ← 登錄表單樣式
│           └── form.js                ← 表單驗證 + AJAX 送出
└── demo.html                          ← 登錄頁靜態預覽（不需 WordPress 即可開啟看設計）
```

## 設計決策與假設

| 項目 | 決定 | 理由 |
|---|---|---|
| 架構 | 自訂外掛（CPT + AJAX + REST API） | 資料結構自己掌控，之後串 ERP / LINE / 簡訊不被第三方外掛綁死 |
| 資料儲存 | 自訂文章類型 `warranty_record` + post meta | 用 WP 原生機制，免建資料表，後台直接管理 |
| 序號格式 | 2 碼英文 + 8~12 碼英數（CONFIG 可改） | 先佔位，待你提供實際序號規則後修改 `SN_PATTERN` |
| 保固期 | 購買日起 2 年（CONFIG 可改） | 業界電子鎖常見保固期 |
| 防濫用 | nonce + honeypot + 同序號擋重複登錄 | 不引入第三方 CAPTCHA，保持輕量 |

## 安裝步驟

1. 將 `wp-plugin/lock-warranty/` 整個資料夾上傳到 `wp-content/plugins/`
2. WordPress 後台 → 外掛 → 啟用「電子鎖保固登錄」
3. 新增一個頁面（例如網址 `/warranty/`），內容放短代碼：`[lock_warranty_form]`
4. 後台左側選單會出現「保固登錄」，所有客戶登錄資料在此管理
5. 修改 `lock-warranty.php` 開頭的 `CONFIG` 區（序號規則、保固月數、通知信箱、產品型號清單）

## 保固卡

`warranty-card/warranty-card.html` 用瀏覽器開啟 → Ctrl+P 列印，尺寸 A6（105×148mm）雙面。
- 正面：品牌、產品型號、序號欄、購買日期欄、經銷商章
- 背面：保固條款摘要 + **QR Code 直連登錄頁**
- QR Code 目前指向佔位網址 `https://example.com/warranty/`，正式上線前改成你的網域

## 之後的串接擴充點（已預留）

| 需求 | 怎麼接 |
|---|---|
| ERP / 外部系統查詢保固 | `GET /wp-json/lock-warranty/v1/check?sn=序號`（公開，只回傳保固狀態與到期日，不洩漏個資） |
| ERP 拉完整登錄資料 | `GET /wp-json/lock-warranty/v1/records`（需 WP 應用程式密碼驗證，管理員權限） |
| 登錄成功後通知（LINE Notify、簡訊） | 程式內 `do_action( 'lock_warranty_registered', $post_id, $data )` hook，寫一個 add_action 即可掛上 |
| WooCommerce 訂單帶入 | 表單欄位支援 URL 參數預填（`?sn=xxx&model=xxx`），出貨信夾帶連結即可 |
| 序號白名單驗證 | `lock_warranty_validate_sn` filter，之後可改成查資料庫或打 ERP API |

## 待你確認的事項

1. 實際序號格式（目前是佔位規則）
2. 產品型號清單（CONFIG 內目前是範例型號）
3. 保固年限是否 2 年、不同型號是否不同年限
4. 正式登錄頁網址（要更新保固卡 QR Code）
5. 客服通知信箱
