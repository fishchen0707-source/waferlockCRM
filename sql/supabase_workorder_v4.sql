-- ============================================================
-- WAFERLOCK CRM ─ v4：地址選取 + 工單收費品項 欄位擴充
-- 在 Supabase SQL Editor 跑一次即可（add column if not exists，可重複執行）
--
-- 對應前端：
--  1) 地址選取畫面（中華郵政風格）→ customers 需要 zip 欄位。
--  2) 統一工單表單下方「購買/收費品項」建單即存（金流依據）→ installs 需要 charges/charge_total
--     （repairs 已於 v0.3 既有 charges/charge_total，不需再加）。
-- ============================================================

-- 1) 客戶郵遞區號
alter table public.customers add column if not exists zip text;

-- 2) 安裝工單收費品項（repairs 已有，這裡補 installs）
alter table public.installs add column if not exists charges      jsonb default '[]'::jsonb;
alter table public.installs add column if not exists charge_total numeric;
