-- ==============================================
-- WAFERLOCK 派工排程 / 工務時刻表  Supabase 設定
-- 在前面幾份 SQL 之後執行（可重複執行）
-- ==============================================

-- A. bookings：時段佔用「唯一真實來源」
--    每小時一格（hour=起始小時，9 表示 09:00-10:00 … 21 表示 21:00-22:00）
--    維修佔 1 列、安裝佔 2 列（連續兩小時）
create table if not exists public.bookings (
  id text primary key,
  worker_id text,
  date     text,           -- YYYY-MM-DD
  hour     int,            -- 9 ~ 21
  ref_type text,           -- repair / install
  ref_id   text,
  created_at timestamptz default now()
);
-- 同師傅同日同時段不可重複 → DB 層擋滿工
create unique index if not exists bookings_slot_uniq on public.bookings(worker_id, date, hour);

-- B. repairs / installs 補排程顯示欄位
alter table public.repairs  add column if not exists sched_date  text;
alter table public.repairs  add column if not exists sched_start int;
alter table public.repairs  add column if not exists sched_span  int;
alter table public.installs add column if not exists sched_date  text;
alter table public.installs add column if not exists sched_start int;
alter table public.installs add column if not exists sched_span  int;
alter table public.installs add column if not exists worker_id   text;  -- 統一用 workers 排程（保留 locksmith_id 為相容）

-- C. RLS（開發期 allow-all）
alter table public.bookings enable row level security;
drop policy if exists "allow all anon bookings" on public.bookings;
create policy "allow all anon bookings" on public.bookings for all using (true) with check (true);

-- D. Realtime
alter publication supabase_realtime add table public.bookings;
