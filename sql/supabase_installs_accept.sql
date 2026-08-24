-- ============================================================
-- 安裝單「師傅接單」— 資料層
-- 🔴 需在 Supabase SQL Editor 手動執行；未執行前師傅端接單會寫入失敗。
-- 對應前端：waferlock_tech.html（接單）、waferlock_crm.html（顯示等待/已接單）、
--           track.html + track-query（客戶進度條的「師傅接單」那一格）
--
-- 背景：維修單本來就有接案流程（repairs.accepted_at，見 supabase_eta.sql），
--       但安裝單沒有——CRM 指派師傅時同時排定時段，單子就直接出現在師傅清單裡，
--       沒有「接單」這個動作，也就沒有任何欄位能證明師傅確實看到並接下這張單。
--       客戶進度條需要這一格，故補上。
--
-- 型別刻意與 repairs.accepted_at 一致（timestamptz）：同名同語意的欄位不應該一個
-- 用 text 一個用 timestamptz。專案其他日期欄位（shipped_date、completed_date）是 text，
-- 那是「日期」；這裡記的是「時刻」，沿用既有的 accepted_at 慣例。
-- ============================================================

alter table public.installs add column if not exists accepted_at timestamptz;
