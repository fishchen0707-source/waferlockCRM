-- ============================================================
-- WAFERLOCK CRM ─ 金流：回報/驗收付款交易欄位
-- 在 Supabase SQL Editor 跑一次即可（add column if not exists，可重複執行）
--
-- 背景：驗收流程除拍照、簽名外，加「收費/付款」交易（現金/轉帳/刷卡/免費）。
--       目前前端用 mockPayment 產生虛擬交易，欄位即為日後串接金流 API 的回填欄位。
-- 對應前端：waferlock_tech.html（師傅維修/安裝回報）、waferlock_crm.html（驗收 + 竣工顯示）
-- ============================================================

-- installs：補齊付款欄位（repairs 已於既有版本有 payment_method/paid）
alter table public.installs add column if not exists payment_method text;     -- cash / transfer / card / free
alter table public.installs add column if not exists paid            boolean; -- 是否已收款

-- installs + repairs：模擬交易（日後 API 回填）
alter table public.installs add column if not exists txn_id  text;        -- 交易編號（CASH-/TRF-/CARD-…）
alter table public.installs add column if not exists paid_at timestamptz; -- 收款時間
alter table public.repairs  add column if not exists txn_id  text;
alter table public.repairs  add column if not exists paid_at timestamptz;
