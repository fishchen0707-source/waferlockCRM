-- ============================================================
-- WAFERLOCK CRM ─ v3：統一工單（安裝 + 維修）欄位擴充
-- 在 Supabase SQL Editor 跑一次即可（add column if not exists，可重複執行）
--
-- 對應前端：WorkOrderForm 整併安裝/維修建單，新增共同欄位；
--           送出時仍依類別寫回既有 installs / repairs 兩張表（不做資料遷移）。
-- ============================================================

-- 共同新欄位（installs 與 repairs 同步加，加欄不改舊欄）──────────
do $$
declare t text;
begin
  foreach t in array array['installs','repairs'] loop
    execute format('alter table public.%I add column if not exists tenant_type        text',    t); -- 承租身份 owner/family/tenant
    execute format('alter table public.%I add column if not exists landlord_confirmed boolean', t); -- 租客高風險：房東已確認
    execute format('alter table public.%I add column if not exists source_channel     text',    t); -- 來源通路
    execute format('alter table public.%I add column if not exists community_note     text',    t); -- 社區特殊需求
    execute format('alter table public.%I add column if not exists zip                text',    t); -- 郵遞區號
    execute format('alter table public.%I add column if not exists category2          text',    t); -- 工單類別細項
    execute format('alter table public.%I add column if not exists time_range         text',    t); -- 時間範圍 morning/noon/night
    execute format('alter table public.%I add column if not exists qty                integer', t); -- 台數
    execute format('alter table public.%I add column if not exists work_hours         numeric', t); -- 預估工時（可小數，如 1.5）
    execute format('alter table public.%I add column if not exists flag_bomber        boolean', t); -- 轟炸戶
    execute format('alter table public.%I add column if not exists note               text',    t); -- 通用備註（repairs 本就有；installs 新增）
  end loop;
end $$;
