-- ============================================================
-- customers 加上 cust_key（客編唯一鍵）
-- 2026-08-12
-- ============================================================
-- 背景：三個寫入點對「同一個客戶」的判定各做一套，每天都在產生髒資料。
--   waferlock_crm.html      正規化地址 + 姓名   ← 正確的定義
--   case-intake/index.ts    只比未正規化的地址   ← 會誤發客編、也會誤合併
--   voicebot-tools/index.ts 只比未正規化的地址   ← 同上
--
-- 兩種錯法都會出事：
--   「臺北市」vs「台北市」→ 同一戶被當成兩個客戶，各發一個客編
--   同地址不同姓名（房東/房客、公司/員工）→ 兩個人被合併到同一個客編，
--     新客戶的維修單會掛到別人底下
--
-- 決策（2026-08-12）：唯一鍵＝**正規化地址 + 姓名**，與 CRM 一致。
--
-- ⚠ 這支 SQL **刻意不做資料回填**。
--   正規化規則寫在 JS/TS（見下方對照），若在 SQL 裡重寫一次，
--   兩邊只要有一點差異，既有資料算出來的 key 就會與新寫入的不一致——
--   那種不一致不會報錯，只會安靜地讓同一個客戶配不起來。
--   回填交給 waferlock_crm.html 下一次同步（custToDb 已加 cust_key，
--   upsert 會把既有客戶補上正確的鍵）。
--
--   在回填完成前，兩支 Edge Function 都保留 fallback：
--   cust_key 查不到時改用「地址比對 + 程式端比姓名」，所以不會因為
--   欄位還是 null 就誤發新客編。
--
-- 正規化定義（三處必須一致，改一處就要改三處）：
--   waferlock_crm.html          normAddr() / custKey()
--   functions/case-intake       normAddr_() / custKey_()
--   functions/voicebot-tools    normAddr_() / custKey_()
--
--   normAddr: 全形→半形（U+FF01~FF5E 減 0xFEE0）→ 臺改台 → 去所有空白 → 轉小寫
--   custKey : normAddr(address) + '|' + trim(name)；任一為空則回 null（不可當鍵）
-- ============================================================

alter table customers add column if not exists cust_key text;

comment on column customers.cust_key is
  '客編唯一鍵：正規化地址|姓名。由寫入端（CRM / Edge Functions）計算，勿在 SQL 內重算——正規化規則以 JS/TS 為準';

-- 不設 unique constraint：既有資料可能已經有重複（同一戶被發了兩個客編），
-- 加 unique 會讓 upsert 直接失敗。先建普通索引供查詢，等資料清乾淨再考慮收緊。
create index if not exists customers_cust_key_idx on customers (cust_key);

-- ============================================================
-- 執行後的檢查
-- ============================================================

-- 1) 還沒有 cust_key 的客戶（回填前應該等於總數）
--    → 開一次 CRM 讓它同步，這個數字應該降到 0
-- select count(*) as 尚未回填 from customers where cust_key is null;

-- 2) 回填後：抓出「同一個 cust_key 卻有多個客編」——這些是過去誤發的重複客戶
--    ⚠ 只是列出來給人看，不要自動合併：合併客編會動到維修單與保固，
--      必須人工確認哪一個才是主檔
-- select cust_key, count(*) as 客編數, array_agg(wf_id order by wf_id) as 客編
--   from customers where cust_key is not null
--   group by cust_key having count(*) > 1
--   order by count(*) desc;

-- 3) 抓出「同地址但姓名不同」——這些在舊邏輯下會被 Edge Function 誤判為同一人
--    看一下有多少，可以評估這個 bug 實際影響了幾筆
-- select address, count(distinct name) as 不同姓名數,
--        array_agg(distinct name) as 姓名, array_agg(distinct wf_id) as 客編
--   from customers where address is not null and address <> ''
--   group by address having count(distinct name) > 1;
