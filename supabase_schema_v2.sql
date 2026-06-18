-- ==============================================
-- WAFERLOCK 保固報修系統 — Supabase Schema 草案 v2（擴充）
-- 目的：在現有 supabase_setup.sql 之上，補上「主管 MD 服務流程調整」
--      與「真實 LINE OA 導入」所需的資料結構。
-- 用法：先執行 supabase_setup.sql，再執行本檔（皆為 if not exists / add column if not exists，可重複執行）。
-- 註：RLS 暫時沿用「允許 anon 全權」以利開發；上線前須依 PDPA 收斂（見檔尾備註）。
-- ==============================================

-- ──────────────────────────────────────────────
-- A. CRM 集團階層（集團 → 建案 → 客戶）  〔MD 5 / 盲點無〕
-- ──────────────────────────────────────────────
create table if not exists public.groups (
    id text primary key,            -- 集團代碼，如 GRP-FUHWA
    name text,                      -- 集團名稱，如 馥華創新
    note text,
    created_at timestamptz default now()
);

create table if not exists public.projects (
    id text primary key,            -- 建案代碼，如 PRJ-TTW（總太洲際W）
    group_id text references public.groups(id),
    name text,                      -- 建案名稱
    code text,                      -- 社區代碼前綴，如 W6B1 的「W」
    type text,                      -- b2b_build(建案) / b2b_op(營運單位:飯店月子) / b2c(散客)
    address text,
    -- B2B 分段安裝 / 分段請款  〔MD 1〕
    total_qty integer default 0,    -- 此案總發包數量
    installed_qty integer default 0,-- 已安裝驗收數量
    pending_qty integer default 0,  -- 尚未安裝數量
    package_price numeric,          -- 發包價格
    -- SLA 緊急度分級  〔盲點 3〕
    sla_level text default 'normal',-- normal / high / critical(營運單位紅色警戒)
    third_party_contact text,       -- 第三方系統整合廠商聯絡
    created_at timestamptz default now()
);

-- 客戶歸屬到集團/建案；主從帳號  〔MD 5 / 盲點 5〕
alter table public.customers add column if not exists group_id text;
alter table public.customers add column if not exists project_id text;
alter table public.customers add column if not exists is_primary boolean default true;  -- 主帳號(屋主)
alter table public.customers add column if not exists parent_wf_id text;                -- 子帳號指向主帳號

-- ──────────────────────────────────────────────
-- B. SN 裝置登錄 + 出貨庫防呆  〔MD 2 / 盲點 1, 4〕
-- ──────────────────────────────────────────────
-- 模擬「出貨資料庫」：SN 登錄時比對是否存在（防呆）。實際串接 ERP 後改由 ERP 提供。
create table if not exists public.shipment_stock (
    sn text primary key,
    product_id text,
    order_no text,
    ship_date text,
    valid boolean default true
);

-- 已安裝裝置（師傅先登 SN+安裝日 → 消費者掃 QR 以 SN 關聯）  〔MD 2〕
create table if not exists public.devices (
    sn text primary key,            -- 產品序號（掃碼輸入，避免人工打錯）
    product_id text,
    project_id text,
    unit text,                      -- 戶別，如 W6B1
    install_date text,
    installer_id text,              -- 安裝師傅
    wf_id text,                     -- 關聯的會員/客戶
    has_sn boolean default true,    -- 無 SN 舊品 = false（動態補登用）  〔盲點 4〕
    warranty_start text,
    warranty_end text,
    status text default 'installed',
    created_at timestamptz default now()
);

-- 一鎖多人關聯（一主多從授權）  〔盲點 5〕
create table if not exists public.device_members (
    id text primary key,
    device_sn text,                 -- 對應 devices.sn
    member_wf_id text,              -- 對應 customers.wf_id
    role text,                      -- owner(屋主主帳號) / family / tenant(租客)
    authorized_by text,             -- 由哪個主帳號授權
    status text default 'active',   -- active / revoked（租約期滿一鍵剔除）
    created_at timestamptz default now()
);

-- ──────────────────────────────────────────────
-- C. LINE OA 綁定 + PDPA 同意  〔MD 6 導入 / 決策 5〕
-- ──────────────────────────────────────────────
create table if not exists public.line_users (
    line_user_id text primary key,  -- LINE userId（webhook / LIFF 取得）
    wf_id text,                     -- 綁定的會員
    display_name text,
    picture_url text,
    bound_at timestamptz,
    created_at timestamptz default now()
);

create table if not exists public.consents (
    id text primary key,
    subject text,                   -- line_user_id 或 wf_id
    subject_type text,              -- line / member
    consent_type text,              -- pdpa_basic / marketing
    agreed boolean default false,
    version text,                   -- 同意條款版本
    agreed_at timestamptz,
    ip text
);

-- ──────────────────────────────────────────────
-- D. 工班 / 派工調度  〔MD 4 / 決策 2(全新工務端)〕
-- ──────────────────────────────────────────────
create table if not exists public.workers (
    id text primary key,
    name text,
    type text,                      -- internal(原廠工務) / external(配合鎖店)
    region text,                    -- north / central / south
    district text,
    phone text,
    rating numeric,
    jobs integer default 0,
    active boolean default true
);

-- ──────────────────────────────────────────────
-- E. 報修單擴充欄位  〔MD 3 身份 / MD 多媒體 / 不保固 / SLA〕
-- ──────────────────────────────────────────────
alter table public.repairs add column if not exists is_owner boolean;            -- 是否屋主
alter table public.repairs add column if not exists reporter_role text;          -- 屋主/家人/租客
alter table public.repairs add column if not exists requires_landlord_confirm boolean default false; -- 租客高風險需房東確認
alter table public.repairs add column if not exists sla_level text default 'normal'; -- normal/high/critical
alter table public.repairs add column if not exists warranty_judgment text;      -- in / out / in_but_excluded(保內但不保固)
alter table public.repairs add column if not exists exclude_reason text;         -- 如：鹼性電池漏液
alter table public.repairs add column if not exists videos jsonb default '[]'::jsonb; -- 報修錄影
alter table public.repairs add column if not exists device_sn text;              -- 關聯 SN（可空，無 SN 舊品）
alter table public.repairs add column if not exists project_id text;             -- 關聯建案

-- ──────────────────────────────────────────────
-- F. B2B 分段請款紀錄  〔MD 1〕
-- ──────────────────────────────────────────────
create table if not exists public.billings (
    id text primary key,
    project_id text,
    billed_qty integer,             -- 本次請款的已安裝驗收數量
    unit_price numeric,
    amount numeric,
    period text,                    -- 請款期別
    status text default 'pending',  -- pending / submitted / paid
    created_by text,
    created_at timestamptz default now()
);

-- ──────────────────────────────────────────────
-- G. ERP 串接（先模擬）— outbox / 同步狀態  〔決策 3〕
-- ──────────────────────────────────────────────
create table if not exists public.erp_sync (
    id text primary key,
    entity text,                    -- repair / install / billing / device
    entity_id text,
    action text,                    -- create / update / close
    payload jsonb default '{}'::jsonb,
    status text default 'pending',  -- pending / sent / ack / error（模擬時手動切換）
    erp_ref text,                   -- ERP 回傳單號（模擬）
    created_at timestamptz default now(),
    synced_at timestamptz
);

-- ──────────────────────────────────────────────
-- H. RLS（開發期沿用允許 anon；上線前收斂）
-- ──────────────────────────────────────────────
alter table public.groups          enable row level security;
alter table public.projects        enable row level security;
alter table public.shipment_stock  enable row level security;
alter table public.devices         enable row level security;
alter table public.device_members  enable row level security;
alter table public.line_users      enable row level security;
alter table public.consents        enable row level security;
alter table public.workers         enable row level security;
alter table public.billings        enable row level security;
alter table public.erp_sync        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['groups','projects','shipment_stock','devices','device_members','line_users','consents','workers','billings','erp_sync']
  loop
    execute format('drop policy if exists "allow all anon %1$s" on public.%1$s;', t);
    execute format('create policy "allow all anon %1$s" on public.%1$s for all using (true) with check (true);', t);
  end loop;
end $$;

-- ──────────────────────────────────────────────
-- I. Realtime 發布
-- ──────────────────────────────────────────────
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.device_members;
alter publication supabase_realtime add table public.line_users;
alter publication supabase_realtime add table public.workers;
alter publication supabase_realtime add table public.billings;
alter publication supabase_realtime add table public.erp_sync;

-- ==============================================
-- 上線前待辦（PDPA / 安全）：
-- 1. 關閉「allow all anon」，改為：客戶端只能讀寫自己 line_user_id 綁定的資料；
--    客服/工務後台走 Supabase Auth 角色（authenticated + role claim）。
-- 2. Channel Access Token / Secret 放 Supabase Edge Function secrets，絕不進前端。
-- 3. consents 表須在綁定前完成 pdpa_basic 同意才寫入 line_users。
-- ==============================================
