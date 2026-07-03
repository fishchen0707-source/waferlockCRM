-- ==============================================
-- WAFERLOCK 日期格式統一遷移：M/D/YYYY → YYYY-MM-DD
-- 修復：計畫書1 §2.6 — today() 舊實作輸出 M/D/YYYY（無補零、斜線），
--       與 ISO 格式並存，導致字串範圍比較（.gte()）永遠比不出結果。
-- 前置：waferlock_crm.html / waferlock_tech.html / waferlock_LINE.html / liff-bind.html
--       的 today()/todayStr() 已改輸出 YYYY-MM-DD（新資料不會再是 M/D/YYYY）。
--       本腳本只處理「既有」資料，只影響格式為 M/D/YYYY 的資料列（已是
--       YYYY-MM-DD 的資料列不會被觸碰，可重複執行）。
--
-- 範圍：僅涵蓋純日期欄位（date/reg_date/install_date/created_date/
--       completed_date/closed_date）。不包含 repairs.created_at /
--       complaints.created_at ——這兩欄是 today()+' '+now() 組成的
--       日期+時間文字（now() 用 zh-TW 12小時制含「上午/下午」），
--       格式更複雜、不是報表 .gte() 篩選會踩到的欄位，本次不動，
--       如需一併處理建議另開一支腳本並先在少量資料上驗證。
--
-- 執行前建議：先用下方「執行前檢查」SELECT 確認命中筆數是否符合預期，
-- 再執行 UPDATE。
-- ==============================================

-- ── 執行前檢查：各表各欄位有幾筆是 M/D/YYYY 格式 ──
-- select 'customers.reg_date' col, count(*) from public.customers where reg_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'customers.install_date', count(*) from public.customers where install_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'installs.created_date', count(*) from public.installs where created_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'installs.completed_date', count(*) from public.installs where completed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'repairs.date', count(*) from public.repairs where date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'repairs.completed_date', count(*) from public.repairs where completed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'complaints.date', count(*) from public.complaints where date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'complaints.closed_date', count(*) from public.complaints where closed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';

-- ── customers ──
update public.customers set reg_date = to_char(to_date(reg_date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where reg_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';
update public.customers set install_date = to_char(to_date(install_date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where install_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';

-- ── installs ──
update public.installs set created_date = to_char(to_date(created_date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where created_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';
update public.installs set completed_date = to_char(to_date(completed_date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where completed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';

-- ── repairs ──
update public.repairs set date = to_char(to_date(date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where date ~ '^\d{1,2}/\d{1,2}/\d{4}$';
update public.repairs set completed_date = to_char(to_date(completed_date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where completed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';

-- ── complaints ──
update public.complaints set date = to_char(to_date(date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where date ~ '^\d{1,2}/\d{1,2}/\d{4}$';
update public.complaints set closed_date = to_char(to_date(closed_date,'MM/DD/YYYY'),'YYYY-MM-DD')
  where closed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';

-- ── 執行後驗證：應皆為 0（代表已無殘留的 M/D/YYYY 格式）──
-- select 'customers.reg_date' col, count(*) from public.customers where reg_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'customers.install_date', count(*) from public.customers where install_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'installs.created_date', count(*) from public.installs where created_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'installs.completed_date', count(*) from public.installs where completed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'repairs.date', count(*) from public.repairs where date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'repairs.completed_date', count(*) from public.repairs where completed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'complaints.date', count(*) from public.complaints where date ~ '^\d{1,2}/\d{1,2}/\d{4}$'
-- union all select 'complaints.closed_date', count(*) from public.complaints where closed_date ~ '^\d{1,2}/\d{1,2}/\d{4}$';
