-- ==============================================
-- WAFERLOCK CRM - Supabase 資料庫設定 SQL
-- 請到 Supabase 後台 → SQL Editor → 貼上執行
-- ==============================================

-- 1. customers 表
create table if not exists public.customers (
    wf_id text primary key,
    name text,
    phone text,
    email text,
    address text,
    district text,
    area text,
    channel text,
    product_id text,
    serial_no text,
    install_date text,
    warranty_months integer,
    warranty_end text,
    tags jsonb default '[]'::jsonb,
    reg_type text,
    reg_date text,
    line_uid text,
    fb_id text,
    ig_id text,
    repair_ids jsonb default '[]'::jsonb,
    complaint_ids jsonb default '[]'::jsonb,
    site text,
    unit text,
    order_no text
);

-- 2. repairs 表
create table if not exists public.repairs (
    id text primary key,
    wf_id text,
    name text,
    phone text,
    district text,
    area text,
    building text,
    date text,
    type text,
    issue text,
    space text,
    status text,
    urgency text,
    worker_id text,
    scheduled_date text,
    "desc" text,
    contact_name text,
    contact_phone text,
    site text,
    unit text,
    handling_unit text,
    note text,
    warranty_in boolean,
    created_by text,
    created_at text,
    unread boolean default false,
    arrival_pushed boolean default false,
    rating integer,
    receipt_no text,
    audit_note text,
    completed_date text
);

-- 3. complaints 表
create table if not exists public.complaints (
    id text primary key,
    wf_id text,
    name text,
    phone text,
    date text,
    created_at text,
    created_by text,
    call_channel text,
    department text,
    cat1 text,
    cat2 text,
    cat3 text,
    process text,
    status text,
    closed_date text,
    timeline jsonb default '[]'::jsonb
);

-- 4. installs 表
create table if not exists public.installs (
    id text primary key,
    name text,
    phone text,
    address text,
    channel text,
    product_id text,
    serial_no text,
    locksmith_id text,
    status text,
    created_date text,
    created_ts bigint,
    arrival_pushed boolean default false,
    photos jsonb default '[]'::jsonb,
    signature text,
    verify jsonb default '{}'::jsonb,
    taught jsonb default '{}'::jsonb,
    work_note text,
    completed_date text,
    wf_id text,
    warranty_end text
);

-- 5. conversations 表
create table if not exists public.conversations (
    id text primary key,
    wf_id text,
    name text,
    platform text,
    av text,
    unread integer default 0,
    last_msg text,
    last_time text,
    msgs jsonb default '[]'::jsonb,
    agent_takeover boolean default false,
    need_case boolean default false,
    biz_inquiry boolean default false
);

-- 6. config 表
create table if not exists public.config (
    key text primary key,
    value text
);

-- 🔏 啟用 RLS 與開啟匿名存取政策
alter table public.customers enable row level security;
alter table public.repairs enable row level security;
alter table public.complaints enable row level security;
alter table public.installs enable row level security;
alter table public.conversations enable row level security;
alter table public.config enable row level security;

-- 允許任何人 (Anon/Authenticated) 進行所有操作 (SELECT, INSERT, UPDATE, DELETE)
create policy "Allow all for anon customers" on public.customers for all using (true) with check (true);
create policy "Allow all for anon repairs" on public.repairs for all using (true) with check (true);
create policy "Allow all for anon complaints" on public.complaints for all using (true) with check (true);
create policy "Allow all for anon installs" on public.installs for all using (true) with check (true);
create policy "Allow all for anon conversations" on public.conversations for all using (true) with check (true);
create policy "Allow all for anon config" on public.config for all using (true) with check (true);

-- 🔊 將資料表加入 Realtime 發布，以便跨分頁/跨裝置同步
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.repairs;
alter publication supabase_realtime add table public.complaints;
alter publication supabase_realtime add table public.installs;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.config;
