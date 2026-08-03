-- ==============================================
-- 貨運託運單（新竹物流 / 嘉里大榮）— 自動解析後落地
--
-- 背景：
--   出貨後貨運公司會產出託運清單 PDF，目前只丟 Teams 供人工翻查。
--   本表存放自動解析的結果，並記錄「這張託運單屬於哪位客戶／哪張安裝單」的配對結果。
--
-- 資料來源：shipment-worker/parsers.py 解析 PDF → shipment-intake Edge Function 寫入。
--
-- 配對兩條路：
--   Path A（首選）：貨運單上的「訂單編號」(新竹) /「出貨單號」(大榮) 填了 TipTop 出貨單號，
--                   則 order_no 直接對 installs.shipment_no，精確、100%。
--   Path B（備案）：上述欄位空白時，只能靠 address_norm + 電話模糊比對，需人工佇列兜底。
--   ※ 2026/07/30 樣本顯示兩家的欄位都存在但未填，故 Path B 為目前現況。
--
-- 部署方式：在 Supabase SQL Editor 貼上本檔全文執行一次即可（idempotent，可重複執行）。
--
-- ⚠ 安全註記：本表沿用專案現行「allow all anon」RLS 慣例（見 supabase_schema_v2.sql 檔尾），
--   因為 CRM 後台以 anon key 直連。這代表託運單號與收件地址與現有 customers 一樣，
--   落在同一個已知風險範圍內。客戶端查詢頁（track.html）因此一律不得使用 anon key 直查，
--   必須經 track-query Edge Function 以 service role 取數並驗證 LIFF 身分。
-- ==============================================

create table if not exists public.shipments (
    -- 主鍵＝「貨運商:託運單號」，同一份 PDF 重複匯入時自然覆蓋，不會產生重複列
    id text primary key,                    -- 例：hct:343-164-2104 / kerry:74379484429
    carrier text not null,                  -- hct 新竹物流 / kerry 嘉里大榮
    tracking_no text not null,              -- 查貨號碼(新竹) / 託運單號(大榮)
    ship_date text,                         -- 發送日期(新竹) / 託運日期(大榮)，格式 YYYY-MM-DD
    shipper_account text,                   -- 客代(新竹) / 託運人編號(大榮)
    shipper_name text,                      -- 託運人名稱，如「維夫拉克-單」
    station text,                           -- 到著站 / 到站

    -- 貨運單上的原始收件資訊
    order_no text,                          -- 訂單編號(新竹) / 出貨單號(大榮) ← Path A 的配對鍵
    recipient_code text,                    -- 新竹「收貨人代號」，如 102、807R（大榮無此欄）
    recipient_name text,
    recipient_phone text,
    recipient_address text,
    address_norm text,                      -- 正規化後地址，Path B 比對用
    remark text,                            -- 內容品/備註。大榮此欄常帶建案名稱，可輔助配對
    pieces text,                            -- 件數

    -- 配對結果
    wf_id text,                             -- 對到的客編（customers.wf_id）
    install_id text,                        -- 對到的安裝單（installs.id）
    match_score numeric,                    -- 0~1，Path A 命中固定 1
    match_status text default 'pending',    -- pending 待確認 / matched 自動配對 / manual 人工指定
                                            -- new_customer 已建新客戶 / unmatched 對不到 / ignored 忽略(自家調撥等)
    matched_by text,                        -- auto_order_no / auto_dealer_code / auto_addr / <crm_user>

    -- 推播狀態
    notify_status text default 'none',      -- none / sent / failed / skipped
    notified_at timestamptz,

    -- 來源追溯
    source_file text,                       -- 原始 PDF 檔名
    source_file_id text,                    -- Google Drive fileId，取檔端去重用
    raw_row jsonb,                          -- 解析器輸出的原始欄位，解析錯誤時可回溯
    created_at timestamptz default now()
);

create index if not exists idx_shipments_order  on public.shipments(order_no);
create index if not exists idx_shipments_addr   on public.shipments(address_norm);
create index if not exists idx_shipments_status on public.shipments(match_status);
create index if not exists idx_shipments_wf     on public.shipments(wf_id);
create index if not exists idx_shipments_src    on public.shipments(source_file_id);

-- ──────────────────────────────────────────────
-- 待解析佇列
--
-- 為什麼需要這張表：PDF 解析用 PyMuPDF（Python），Deno 端沒有對應品，
-- 所以 Edge Function 只負責「收檔、存 Storage、排隊」，實際解析交給
-- shipment-worker/main.py 輪詢處理。這張表同時扮演三個角色：
--   1. 去重  — id 就是 Google Drive fileId，同一份檔案重送不會重複處理
--   2. 佇列  — worker 撈 status='pending'
--   3. 稽核  — 解析失敗留 error，不會靜默消失
-- ──────────────────────────────────────────────
create table if not exists public.shipment_files (
    id text primary key,                 -- Google Drive fileId
    file_name text,
    storage_path text,                   -- shipment-docs bucket 內的路徑
    carrier text,                        -- 解析後回填 hct / kerry
    status text default 'pending',       -- pending / parsed / failed
    parsed_count integer,                -- 解析出幾筆
    declared_count integer,              -- PDF 自印的合計筆數（對不上代表漏抓）
    error text,                          -- 失敗原因，顯性保留
    created_at timestamptz default now(),
    parsed_at timestamptz
);

create index if not exists idx_shipment_files_status on public.shipment_files(status);

-- 原始 PDF 存放區。內含客戶姓名、電話、地址，一律 private，
-- 不設 anon policy —— 只有 service role（Edge Function / worker）能存取。
insert into storage.buckets (id, name, public)
values ('shipment-docs', 'shipment-docs', false)
on conflict (id) do update set public = false;

-- ──────────────────────────────────────────────
-- customers 擴充：納入 B2B（經銷商／鎖店）與內部調撥
--
-- 2026/07/30 樣本顯示，出貨收件人以鎖店／經銷商為主（福上鎖印、捷豹鎖印行、
-- 大內高手鎖業…），另有工地直送與「維夫拉克(股)公司」自家調撥。
-- 現有 customers 為保固登錄／售後導向，多半不含這些對象，故需分類欄位。
-- ──────────────────────────────────────────────
alter table public.customers add column if not exists customer_type text default 'consumer';
-- consumer 末端消費者 / dealer 經銷商・鎖店 / project 建案・工地 / internal 內部調撥
-- ※ internal 一律不觸發任何客戶通知

alter table public.customers add column if not exists dealer_code text;
-- 對應新竹託運單的「收貨人代號」，有值時為高可信度配對鍵
create index if not exists idx_customers_dealer on public.customers(dealer_code);

-- ──────────────────────────────────────────────
-- RLS（沿用開發期「允許 anon」慣例，見檔頭安全註記）
-- ──────────────────────────────────────────────
alter table public.shipments enable row level security;
alter table public.shipment_files enable row level security;

drop policy if exists "allow all anon shipments" on public.shipments;
create policy "allow all anon shipments" on public.shipments
    for all using (true) with check (true);

-- shipment_files 只有 Edge Function 與 worker（service role）會用，
-- service role 本來就繞過 RLS，因此刻意不開 anon policy。
drop policy if exists "allow all anon shipment_files" on public.shipment_files;

-- ──────────────────────────────────────────────
-- Realtime 發布（CRM 託運單配對頁需要即時更新）
-- ──────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.shipments;
exception when duplicate_object then
  null;  -- 已加入過，重複執行不報錯
end $$;
