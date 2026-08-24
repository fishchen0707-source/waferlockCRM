-- ==============================================
-- 經銷/通路候選庫（來源：Skype 出貨群組七年紀錄 2017-04~2026-08）
--
-- 背景：
--   從「台中/台北/高雄成品出貨」＋「維修收入-開發票」四個 Skype 群組
--   （共 13.6 萬則訊息）解析出 1,156 個經銷/通路帳號代號，並以「收貨地址/
--   電話是否穩定一致」交叉驗證過，排除了誤判為經銷商的公司總機/業務員共用電話。
--
--   本表刻意與 public.customers 分開，不直接寫入正式客戶資料：
--   1. 這批資料未逐筆人工確認過（僅規則分類，UNRESOLVED 佔比高達 78%，
--      本表只收錄規則判斷為 DEALER_CHANNEL 且近一年仍活躍的子集）
--   2. customers.dealer_code 欄位語意已被另一支模組（sql/supabase_shipments.sql
--      的貨運單自動配對）定義為「新竹物流收貨人代號」，與本表的 Skype 帳號簡稱
--      是不同的識別系統，不可混用，故本表獨立存放
--
--   用途：客服歸戶時查詢比對「這個地址/電話有沒有出過貨歷史」；日後逐筆
--   確認後，由人工建立正式 customers 記錄（customer_type='dealer'），
--   並回填 promoted_wf_id 註記已轉正，避免重複建檔。
--
-- 部署方式：在 Supabase SQL Editor 貼上本檔全文執行一次即可（idempotent，可重複執行）。
-- ==============================================

create table if not exists public.dealer_candidates_skype (
    short_name text primary key,        -- Skype 出貨紀錄裡的帳號簡稱，非正式公司全名
    shipment_count integer,             -- 出貨次數（訊息去重後）
    regions text,                       -- 曾出貨的倉別，例：台中/高雄
    first_date text,
    last_date text,
    active_1y boolean default false,    -- 近 1 年（截至 2026-08-17）仍有出貨紀錄
    active_2y boolean default false,
    similar_names text,                 -- 疑似同一實體的其他代號（電話交叉比對，僅 2~4 個代號的小群組才標記，避免誤併）
    shared_contact_phone boolean default false,  -- true=電話對到 >=5 個不同代號，較可能是公司總機/業務員/代收窗口，非單一經銷商
    phone_sample text,
    address_sample text,
    status text default 'pending',      -- pending 待人工確認 / confirmed 確認為經銷商但未建檔 / promoted 已建 customers 記錄 / rejected 確認非經銷商
    promoted_wf_id text,                -- 轉正後對應的 customers.wf_id，避免重複建檔
    source text default 'skype_shipment_chat_2017_2026',
    imported_at timestamptz default now()
);

create index if not exists idx_dealer_cand_status on public.dealer_candidates_skype(status);
create index if not exists idx_dealer_cand_active on public.dealer_candidates_skype(active_1y);

alter table public.dealer_candidates_skype enable row level security;
drop policy if exists "allow all anon dealer_candidates_skype" on public.dealer_candidates_skype;
create policy "allow all anon dealer_candidates_skype" on public.dealer_candidates_skype
    for all using (true) with check (true);
