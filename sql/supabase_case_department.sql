-- ============================================================
-- 案件權責單位（repairs / installs 補 department）
-- 需人工在 Supabase SQL Editor 執行一次，且必須「早於」前端部署。
--
-- 為什麼順序不能反：前端上線後 upsert 會帶 department，若欄位還沒加，
-- PostgREST 會以「column does not exist」整批拒絕，而 syncToSupabase
-- 只把錯誤推進 console —— 畫面上會是「看起來存了、其實沒存」。
--
-- 設計說明：
--   1. complaints.department 早已存在（supabase_setup.sql L79），本次只補另外兩張表。
--   2. ⚠️ repairs.handling_unit 是「原廠工務／配合鎖店」的【施工】單位，
--      與本次的【權責】單位語義完全不同，不可挪用、不可合併。
--   3. 僅做前端介面隔離，RLS 維持全開（已知風險，與本專案現況一致）。
-- ============================================================

alter table public.repairs  add column if not exists department text;
alter table public.installs add column if not exists department text;

-- 維修單：規則即「一律歸客服課」，舊資料直接回填
update public.repairs set department = '客服課' where department is null;

-- 安裝單：無 created_by 欄位，改由 history[0].by（pushHist 記的建單人姓名）
-- 反查 crm_users.role 取得部門。admin 不是部門，排除。
update public.installs i
   set department = u.role
  from public.crm_users u
 where i.department is null
   and u.role <> 'admin'
   and u.name = (i.history -> 0 ->> 'by');

-- 推不出建單人（history 空、姓名對不上、或建單人是 admin／外部自動進件）→ 歸預設單位。
-- 不留 null 的理由：前端 caseDept() 雖有 fallback，但留 null 等於把歸屬邏輯
-- 分散到兩個地方，日後容易不一致。
update public.installs set department = '客服課' where department is null;

-- 防呆：修掉 option 缺 value 的 bug 曾可能存入的「🏢 客服課」
update public.complaints
   set department = btrim(replace(department, '🏢', ''))
 where department like '%🏢%';

-- ============================================================
-- 執行後請人工核對安裝單這 5 筆推得對不對，不合理的直接手動 update：
--   select id, name, department, history -> 0 ->> 'by' as created_by from installs;
-- ============================================================
