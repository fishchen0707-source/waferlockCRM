-- ============================================================
-- WAFERLOCK CRM ─ Storage：施工/簽收照片改存物件儲存（根治開頁慢）
-- 在 Supabase SQL Editor 跑一次即可（冪等，可重複執行）
--
-- 背景：師傅端拍的照片原本以 base64 直接存進 repairs/installs 的 photos 欄位，
--       導致 11+9 筆就撐到 21MB，CRM 開頁要拉 7 秒。改存 Storage 後表只留 URL。
-- 對應前端：waferlock_crm.html / waferlock_tech.html 的 uploadPhotos()
-- ============================================================

-- 1) 建立 public bucket（公開讀取，URL 可直接 <img> 顯示）
insert into storage.buckets (id, name, public)
values ('work-photos', 'work-photos', true)
on conflict (id) do update set public = true;

-- 2) 物件存取 policy（沿用專案現況：RLS 全開、anon 可讀寫此 bucket）
--    public bucket 的「讀」其實由 public URL 自動允許，這裡仍補 select policy 以防萬一。
drop policy if exists "work_photos_read"   on storage.objects;
drop policy if exists "work_photos_insert" on storage.objects;
drop policy if exists "work_photos_update" on storage.objects;

create policy "work_photos_read"   on storage.objects
  for select using (bucket_id = 'work-photos');

create policy "work_photos_insert" on storage.objects
  for insert with check (bucket_id = 'work-photos');

create policy "work_photos_update" on storage.objects
  for update using (bucket_id = 'work-photos');
