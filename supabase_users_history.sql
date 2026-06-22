-- ============================================================
-- WAFERLOCK CRM ─ 使用者登入 + 案件異動紀錄
-- 在 Supabase SQL Editor 跑一次即可
-- ============================================================

-- 1. CRM 使用者（操作人）表 ─────────────────────────────
create table if not exists crm_users (
  id        text primary key,
  name      text not null,
  account   text unique not null,
  pin       text not null,            -- MVP 明文，上線前需改 hash
  role      text not null default '客服課', -- 'admin' 或 部門名稱
  active     boolean default true,
  created_at timestamptz default now()
);

alter table crm_users enable row level security;
drop policy if exists "crm_users_all" on crm_users;
create policy "crm_users_all" on crm_users for all using (true) with check (true);

-- 預設帳號（密碼皆為 1234，請上線前修改）
insert into crm_users (id,name,account,pin,role) values
  ('U-ADMIN','系統管理員','admin','1234','admin'),
  ('U-CS01', '客服-小美','meimei','1234','客服課'),
  ('U-CS02', '客服-阿明','aming','1234','客服課'),
  ('U-SALES','業務-阿哲','ache','1234','內銷課')
on conflict (account) do nothing;

-- 2. 案件異動紀錄欄位（repairs / installs）──────────────
-- history 為 jsonb 陣列：[{ts,by,action}]
alter table repairs  add column if not exists history jsonb default '[]'::jsonb;
alter table installs add column if not exists history jsonb default '[]'::jsonb;

-- 3. 加入 realtime publication（若尚未加入）───────────────
do $$
begin
  begin execute 'alter publication supabase_realtime add table crm_users'; exception when others then null; end;
end$$;
