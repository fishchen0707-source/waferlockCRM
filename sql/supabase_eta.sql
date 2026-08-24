-- ============================================================
-- 師傅端「定位回推抵達時間（ETA）」差異化功能 — 資料層
-- 🔴 需在 Supabase SQL Editor 手動執行；未執行前 ETA 寫回會在 sync 階段失敗。
-- 對應前端：waferlock_tech.html（接案估算/寫入）、waferlock_crm.html（顯示）
-- ============================================================

-- customers：geocode 快取（OSM Nominatim 轉座標結果，避免重複呼叫）
alter table customers add column if not exists lat double precision;
alter table customers add column if not exists lng double precision;

-- repairs：ETA 與個人化校準所需欄位
-- 註：原始 GPS 座標「不入庫」（符合「限當次使用」）；校準只需距離與兩個時戳。
alter table repairs add column if not exists eta_at timestamptz;         -- 回推的預計抵達時刻
alter table repairs add column if not exists eta_text text;             -- 顯示字串（如「14:05–14:25」）
alter table repairs add column if not exists accepted_at timestamptz;   -- 接案時戳（校準起點）
alter table repairs add column if not exists arrived_at timestamptz;    -- 實際抵達時戳（結案時寫，校準用）
alter table repairs add column if not exists est_distance_km double precision; -- 接案當下算出的距離（km）
alter table repairs add column if not exists eta_source text;           -- 'gps' | 'manual'（校準只採計 gps）
