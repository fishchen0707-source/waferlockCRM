-- ============================================================
-- 當單（作廢安裝單）＋ 客編作廢
-- 需人工在 Supabase SQL Editor 執行一次。
--
-- 設計說明：
--   1. 「當單」用既有 installs.status 存新值 'voided'，不另開狀態表。
--      師傅端（waferlock_tech.html）用 .in('status',['pending','arrived','installed'])
--      撈單，'voided' 自然不會出現，無需改師傅端。
--   2. 客編「不回收」——作廢後號碼永久留缺號，next_wf_id() 繼續往下編，
--      因此本次不動 wf_counters 與 next_wf_id()。
--      （回收號碼會與 customers.wf_id 主鍵及案件外鍵衝突，已評估後放棄。）
-- ============================================================

-- 安裝單：當單理由與經手紀錄
alter table public.installs   add column if not exists void_reason text;
alter table public.installs   add column if not exists voided_at   text;
alter table public.installs   add column if not exists voided_by   text;

-- 客戶主檔：作廢旗標（客編停用，號碼不回收）
alter table public.customers  add column if not exists disabled        boolean default false;
alter table public.customers  add column if not exists disabled_reason text;
alter table public.customers  add column if not exists disabled_at     text;

-- 既有資料補預設值（避免 null 與 false 在前端判斷不一致）
update public.customers set disabled = false where disabled is null;
