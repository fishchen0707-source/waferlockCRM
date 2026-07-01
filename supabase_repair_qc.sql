-- ============================================================
-- WAFERLOCK CRM ─ 維修結案三階段 QC 分類欄位
-- 在 Supabase SQL Editor 跑一次即可（add column if not exists，可重複執行）
--
-- 背景：現行維修結案 work_note 為自由文字，故障原因與處理過程混寫一段，
--       QC 無法依型號統計故障原因、無法抓出需要優化的型號。
--       改為三階段結構化欄位：型號確認 → 故障原因（大類+細項）→ 處理過程。
-- 對應前端：waferlock_tech.html（師傅端結案填寫）、waferlock_crm.html（案件詳情/報表顯示）
-- ============================================================

alter table public.repairs add column if not exists fault_model text;          -- 故障型號（師傅結案時確認/修正客戶原登錄型號）
alter table public.repairs add column if not exists fault_reason_major text;   -- 故障原因大類
alter table public.repairs add column if not exists fault_reason_detail text;  -- 故障原因細項（含手動輸入）
alter table public.repairs add column if not exists handling_result text;      -- 處理過程/結果
