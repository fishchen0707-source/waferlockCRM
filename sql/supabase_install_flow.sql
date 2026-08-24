-- ==============================================
-- 新裝訂單流程欄位 — ERP 出貨段 ＋ 驗收開票 ＋ 請款狀態
--
-- 對應前端改動（waferlock_crm.html，2026-07-07）：
--   1. ERP 出貨閘門：安裝單記 TipTop 出貨單號與出貨日期，未出貨前不能排安裝
--   2. 驗收 Modal 開票資訊：發票類型（electronic/duplicate/triplicate）、統編、抬頭
--      （安裝與維修結案都會寫入；發票實際由 TipTop 開立，CRM 只記錄）
--   3. 請款狀態：unbilled 待請款 → billed 已請款 → invoiced 已開票（先做安裝單）
--
-- 部署方式：在 Supabase SQL Editor 貼上本檔全文執行一次即可（idempotent，可重複執行）。
-- ==============================================

alter table public.installs add column if not exists shipment_no text;
alter table public.installs add column if not exists shipped_date text;
alter table public.installs add column if not exists billing_status text default 'unbilled';
alter table public.installs add column if not exists invoice_type text;
alter table public.installs add column if not exists tax_id text;
alter table public.installs add column if not exists invoice_title text;

alter table public.repairs  add column if not exists invoice_type text;
alter table public.repairs  add column if not exists tax_id text;
alter table public.repairs  add column if not exists invoice_title text;
