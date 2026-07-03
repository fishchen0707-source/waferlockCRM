-- ==============================================
-- WAFERLOCK 客編（wf_id）原子產號 RPC
-- 修復：計畫書1 §2.2 — crm/LINE/liff 三檔各自產生客編，格式不一致且無並發保護
-- 在 supabase_tech.sql（case_counters 表）之後執行（可重複執行）
-- ==============================================

create table if not exists public.wf_counters (key text primary key, seq int not null);
alter table public.wf_counters enable row level security;
drop policy if exists "allow all anon wf_counters" on public.wf_counters;
create policy "allow all anon wf_counters" on public.wf_counters for all using (true) with check (true);

-- 格式沿用系統中已佔多數的 WF-YYYY-NNNNN（5 碼流水，年度重置），原子遞增避免並發重號
create or replace function public.next_wf_id()
returns text language plpgsql security definer as $$
declare y text := to_char((now() at time zone 'Asia/Taipei'), 'YYYY'); k text; n int;
begin
  k := 'WF' || y;
  insert into public.wf_counters(key, seq) values (k, 1)
    on conflict (key) do update set seq = public.wf_counters.seq + 1
    returning seq into n;
  return 'WF-' || y || '-' || lpad(n::text, 5, '0');
end $$;
grant execute on function public.next_wf_id() to anon, authenticated;
