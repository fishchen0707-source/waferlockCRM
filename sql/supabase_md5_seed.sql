-- ============================================================
-- WAFERLOCK CRM ─ MD 5：集團 → 建案 階層（建表 + 種子資料）
-- 在 Supabase SQL Editor 跑一次即可（if not exists / on conflict，可重複執行）
--
-- 資料來源：集團與建案名稱皆取自各建商官網／維基／實價登錄等公開資料
--          （WebSearch / WebFetch 查證，截至 2026-06）。
-- 地址為行政區層級（部分依公開資料、部分為建商主要推案區域）。
-- ============================================================

-- 1. 資料表（與 supabase_schema_v2.sql 一致，精簡必要欄位）──────────
create table if not exists public.groups (
  id text primary key,
  name text,
  note text,
  created_at timestamptz default now()
);

create table if not exists public.projects (
  id text primary key,
  group_id text references public.groups(id),
  name text,
  code text,
  type text,              -- b2b_build(建案) / b2b_op(營運單位) / b2c(散客)
  address text,
  total_qty integer default 0,
  installed_qty integer default 0,
  pending_qty integer default 0,
  package_price numeric,
  sla_level text default 'normal',
  created_at timestamptz default now()
);

alter table public.customers add column if not exists group_id text;
alter table public.customers add column if not exists project_id text;

alter table public.groups   enable row level security;
alter table public.projects enable row level security;
drop policy if exists groups_all   on public.groups;
drop policy if exists projects_all on public.projects;
create policy groups_all   on public.groups   for all using (true) with check (true);
create policy projects_all on public.projects for all using (true) with check (true);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.groups';   exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.projects'; exception when others then null; end;
end $$;

-- 2. 集團（10 間真實台灣大型建商）────────────────────────────────
insert into public.groups (id,name,note) values
  ('GRP-01','遠雄建設','遠雄企業團'),
  ('GRP-02','興富發建設','興富發集團'),
  ('GRP-03','國泰建設','國泰金控體系'),
  ('GRP-04','華固建設','華固建設'),
  ('GRP-05','冠德建設','冠德企業'),
  ('GRP-06','長虹建設','長虹建設'),
  ('GRP-07','皇翔建設','皇翔建設'),
  ('GRP-08','潤泰創新','潤泰集團'),
  ('GRP-09','太子建設','太子建設開發'),
  ('GRP-10','鄉林建設','鄉林集團（台中）')
on conflict (id) do nothing;

-- 3. 建案（每集團 10 個，共 100；名稱取自公開資料）──────────────
insert into public.projects (id,group_id,name,type,address,total_qty) values
  -- 遠雄建設
  ('PRJ-0101','GRP-01','遠雄常御','b2b_build','台北市內湖區',180),
  ('PRJ-0102','GRP-01','遠雄新東方','b2b_build','台北市內湖區',160),
  ('PRJ-0103','GRP-01','遠雄名門居','b2b_build','台北市內湖區',140),
  ('PRJ-0104','GRP-01','遠雄峰邑','b2b_build','台北市內湖區',120),
  ('PRJ-0105','GRP-01','遠雄賦邑','b2b_build','台北市內湖區',130),
  ('PRJ-0106','GRP-01','遠雄晴空樹','b2b_build','台北市內湖區',200),
  ('PRJ-0107','GRP-01','遠雄CASA','b2b_build','新北市新莊區',260),
  ('PRJ-0108','GRP-01','遠雄和光','b2b_build','新北市板橋區',220),
  ('PRJ-0109','GRP-01','遠雄U-TOWN','b2b_build','新北市汐止區',280),
  ('PRJ-0110','GRP-01','遠雄一品','b2b_build','台中市西屯區',160),
  -- 興富發建設
  ('PRJ-0201','GRP-02','興富發大禾','b2b_build','新北市三重區',240),
  ('PRJ-0202','GRP-02','富江翠','b2b_build','新北市板橋區',200),
  ('PRJ-0203','GRP-02','興富發大悅','b2b_build','新北市三重區',220),
  ('PRJ-0204','GRP-02','紅樹林莊園','b2b_build','新北市淡水區',180),
  ('PRJ-0205','GRP-02','森學苑','b2b_build','台北市內湖區',160),
  ('PRJ-0206','GRP-02','松江1號院','b2b_build','台北市中山區',120),
  ('PRJ-0207','GRP-02','台北時代廣場','b2b_build','台北市中山區',150),
  ('PRJ-0208','GRP-02','双美館','b2b_build','台北市內湖區',140),
  ('PRJ-0209','GRP-02','双湖匯','b2b_build','台北市內湖區',130),
  ('PRJ-0210','GRP-02','國家一號院','b2b_build','新北市林口區',300),
  -- 國泰建設
  ('PRJ-0301','GRP-03','國泰一品','b2b_build','台北市內湖區',160),
  ('PRJ-0302','GRP-03','國泰新莊園','b2b_build','新北市新莊區',240),
  ('PRJ-0303','GRP-03','國泰金城','b2b_build','新北市板橋區',200),
  ('PRJ-0304','GRP-03','國泰雙璽','b2b_build','台北市中山區',90),
  ('PRJ-0305','GRP-03','國泰朋','b2b_build','台北市大安區',70),
  ('PRJ-0306','GRP-03','國泰田','b2b_build','桃園市青埔',220),
  ('PRJ-0307','GRP-03','國泰上城','b2b_build','新北市中和區',260),
  ('PRJ-0308','GRP-03','國泰豐格','b2b_build','台中市南屯區',180),
  ('PRJ-0309','GRP-03','國泰悅','b2b_build','台北市士林區',110),
  ('PRJ-0310','GRP-03','國泰豐和','b2b_build','台中市西屯區',200),
  -- 華固建設
  ('PRJ-0401','GRP-04','華固天鑄','b2b_build','台北市北投區',80),
  ('PRJ-0402','GRP-04','華固名鑄','b2b_build','台北市中山區',60),
  ('PRJ-0403','GRP-04','華固敦品','b2b_build','台北市大安區',90),
  ('PRJ-0404','GRP-04','華固樂慕','b2b_build','台北市內湖區',120),
  ('PRJ-0405','GRP-04','華固松疆','b2b_build','台北市松山區',75),
  ('PRJ-0406','GRP-04','華固翡儷','b2b_build','台北市大安區',70),
  ('PRJ-0407','GRP-04','華固大安學府','b2b_build','台北市大安區',85),
  ('PRJ-0408','GRP-04','華固譽誠','b2b_build','台北市中正區',100),
  ('PRJ-0409','GRP-04','華固織幸','b2b_build','新北市三重區',160),
  ('PRJ-0410','GRP-04','華固四季匯','b2b_build','新北市新店區',180),
  -- 冠德建設
  ('PRJ-0501','GRP-05','冠德崇德綻','b2b_build','台中市北屯區',200),
  ('PRJ-0502','GRP-05','冠德K TOWER','b2b_build','台北市中山區',90),
  ('PRJ-0503','GRP-05','冠德心禾匯','b2b_build','新北市新莊區',240),
  ('PRJ-0504','GRP-05','冠德安沐居','b2b_build','新北市三重區',220),
  ('PRJ-0505','GRP-05','冠德心天匯','b2b_build','新北市中和區',200),
  ('PRJ-0506','GRP-05','冠德大直湛','b2b_build','台北市中山區',70),
  ('PRJ-0507','GRP-05','冠德文心綻','b2b_build','台中市南屯區',180),
  ('PRJ-0508','GRP-05','冠德天韻','b2b_build','新北市新店區',160),
  ('PRJ-0509','GRP-05','冠德青璞匯','b2b_build','桃園市中壢區',260),
  ('PRJ-0510','GRP-05','冠德領袖','b2b_build','新北市新店區',150),
  -- 長虹建設
  ('PRJ-0601','GRP-06','長虹天璽','b2b_build','台北市內湖區',80),
  ('PRJ-0602','GRP-06','長虹天際','b2b_build','台北市內湖區',100),
  ('PRJ-0603','GRP-06','長虹陶都','b2b_build','新北市鶯歌區',160),
  ('PRJ-0604','GRP-06','長虹新世界','b2b_build','新北市板橋區',200),
  ('PRJ-0605','GRP-06','長虹凱旋','b2b_op','高雄市前鎮區',120),
  ('PRJ-0606','GRP-06','長虹晴空樹','b2b_build','新北市新莊區',220),
  ('PRJ-0607','GRP-06','長虹江翠','b2b_build','新北市板橋區',160),
  ('PRJ-0608','GRP-06','長虹陽明','b2b_build','台北市北投區',100),
  ('PRJ-0609','GRP-06','長虹明日','b2b_build','新北市三重區',180),
  ('PRJ-0610','GRP-06','長虹虹頂','b2b_build','桃園市桃園區',240),
  -- 皇翔建設
  ('PRJ-0701','GRP-07','皇翔御琚','b2b_build','台北市中正區',60),
  ('PRJ-0702','GRP-07','皇翔柏金','b2b_build','台北市信義區',55),
  ('PRJ-0703','GRP-07','皇翔柏悅','b2b_build','台北市信義區',50),
  ('PRJ-0704','GRP-07','幸薈','b2b_build','台北市中山區',90),
  ('PRJ-0705','GRP-07','ASTER ONE','b2b_build','台北市大安區',70),
  ('PRJ-0706','GRP-07','皇翔MRT','b2b_build','新北市土城區',180),
  ('PRJ-0707','GRP-07','皇翔紫鼎','b2b_build','台北市大安區',65),
  ('PRJ-0708','GRP-07','皇翔玉鼎','b2b_build','新北市板橋區',160),
  ('PRJ-0709','GRP-07','皇翔大苑','b2b_build','台北市信義區',45),
  ('PRJ-0710','GRP-07','皇翔謙岳','b2b_build','新北市新店區',150),
  -- 潤泰創新
  ('PRJ-0801','GRP-08','潤泰南港之星','b2b_op','台北市南港區',320),
  ('PRJ-0802','GRP-08','潤泰敦峰','b2b_build','台北市大安區',60),
  ('PRJ-0803','GRP-08','潤泰CITY PARK','b2b_build','新北市三重區',240),
  ('PRJ-0804','GRP-08','潤泰華山松江','b2b_build','台北市中正區',90),
  ('PRJ-0805','GRP-08','潤泰印象左岸','b2b_build','新北市新莊區',220),
  ('PRJ-0806','GRP-08','潤泰菁英匯','b2b_build','新北市板橋區',200),
  ('PRJ-0807','GRP-08','潤泰京采','b2b_build','台北市中山區',100),
  ('PRJ-0808','GRP-08','潤泰峰匯','b2b_build','新北市板橋區',180),
  ('PRJ-0809','GRP-08','潤泰御之苑','b2b_build','新北市新店區',150),
  ('PRJ-0810','GRP-08','潤泰青山鎮','b2b_build','新北市汐止區',300),
  -- 太子建設
  ('PRJ-0901','GRP-09','太子國際村','b2b_build','台南市東區',240),
  ('PRJ-0902','GRP-09','太子信義','b2b_build','台北市大安區',80),
  ('PRJ-0903','GRP-09','太子苑','b2b_build','台南市中西區',160),
  ('PRJ-0904','GRP-09','太子天廈','b2b_build','台中市西屯區',120),
  ('PRJ-0905','GRP-09','太子假期','b2b_build','高雄市左營區',200),
  ('PRJ-0906','GRP-09','太子鳳凰城','b2b_build','台南市永康區',280),
  ('PRJ-0907','GRP-09','太子作新民','b2b_build','台南市北區',180),
  ('PRJ-0908','GRP-09','太子優生活','b2b_build','桃園市中壢區',220),
  ('PRJ-0909','GRP-09','太子西雅圖','b2b_build','新竹市東區',160),
  ('PRJ-0910','GRP-09','太子峰雲','b2b_build','台南市東區',140),
  -- 鄉林建設
  ('PRJ-1001','GRP-10','鄉林皇居','b2b_build','台中市西屯區',160),
  ('PRJ-1002','GRP-10','鄉林美術館','b2b_build','台中市西區',18),
  ('PRJ-1003','GRP-10','鄉林天韻','b2b_build','台中市西屯區',120),
  ('PRJ-1004','GRP-10','鄉林圓頂','b2b_build','台中市南屯區',140),
  ('PRJ-1005','GRP-10','鄉林君悅','b2b_build','台中市西屯區',180),
  ('PRJ-1006','GRP-10','鄉林登峰','b2b_build','台中市北屯區',200),
  ('PRJ-1007','GRP-10','鄉林凱撒','b2b_build','台中市西屯區',150),
  ('PRJ-1008','GRP-10','鄉林雅典','b2b_build','台中市南屯區',130),
  ('PRJ-1009','GRP-10','鄉林新月灣','b2b_build','台中市西屯區',220),
  ('PRJ-1010','GRP-10','鄉林雲峰','b2b_build','雲林縣斗六市',110)
on conflict (id) do nothing;
