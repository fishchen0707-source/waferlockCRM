-- ==============================================
-- WAFERLOCK 師傅端 + 案件編號  Supabase 設定
-- 在 supabase_setup.sql / supabase_schema_v2.sql 之後執行（可重複執行）
-- ==============================================

-- A. repairs 補「現場報告 / 金流」欄位（師傅端回報用）
alter table public.repairs add column if not exists photos        jsonb default '[]'::jsonb;
alter table public.repairs add column if not exists signature      text;
alter table public.repairs add column if not exists charges        jsonb default '[]'::jsonb;
alter table public.repairs add column if not exists charge_total   numeric default 0;
alter table public.repairs add column if not exists payment_method text;   -- cash / transfer / card / free
alter table public.repairs add column if not exists paid           boolean default false;
alter table public.repairs add column if not exists work_note      text;   -- 師傅處理說明

-- B. 案件編號：C/R + YYYYMMDD + 4 碼流水（每日每類重置），原子遞增
create table if not exists public.case_counters (key text primary key, seq int not null);
alter table public.case_counters enable row level security;
drop policy if exists "allow all anon case_counters" on public.case_counters;
create policy "allow all anon case_counters" on public.case_counters for all using (true) with check (true);

create or replace function public.next_case_no(p_prefix text)
returns text language plpgsql security definer as $$
declare d text := to_char((now() at time zone 'Asia/Taipei'), 'YYYYMMDD'); k text; n int;
begin
  k := p_prefix || d;
  insert into public.case_counters(key, seq) values (k, 1)
    on conflict (key) do update set seq = public.case_counters.seq + 1
    returning seq into n;
  return p_prefix || d || lpad(n::text, 4, '0');
end $$;
grant execute on function public.next_case_no(text) to anon, authenticated;

-- C. 師傅登入欄位 + 種子（帳密為 MVP，上線前改用雜湊 / Supabase Auth）
alter table public.workers add column if not exists account      text;
alter table public.workers add column if not exists pin          text;
alter table public.workers add column if not exists line_user_id text;

insert into public.workers (id,name,type,region,district,phone,rating,jobs,active,account,pin) values
 ('W1','壹立工班1（仁哥）','internal','central','台中市','',4.8,42,true,'ren','1111'),
 ('W2','壹立工班2（阿偉）','internal','central','台中市','',4.6,38,true,'wei','2222'),
 ('W3','北區工班A（大明）','internal','north','台北市','',4.9,55,true,'ming','3333')
on conflict (id) do update set account=excluded.account, pin=excluded.pin, active=true;
