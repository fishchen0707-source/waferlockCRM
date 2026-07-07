-- ==============================================
-- 原子 append 對話訊息 RPC — 修正 conversations.msgs 並行寫入互相覆蓋的問題
--
-- 背景：現有寫法（CRM 前端 / LINE webhook / Meta webhook / rtc-callback-request /
-- rtc-recording）全部是「SELECT 讀出 msgs → 應用層 append → 整包 UPDATE/UPSERT 寫回」。
-- 當兩個寫入者（例如：客服在 CRM 回覆 vs 客戶同時傳 LINE 訊息、或平台重送事件）幾乎同時
-- 發生時，後寫入者手上的 msgs 快照是舊的，整包寫回會把先寫入者剛存的那則訊息蓋掉——
-- 訊息無聲消失，且沒有任何錯誤訊息。
--
-- 解法：把「append 一則訊息」收斂成單一 SQL 陳述式內完成的原子操作。PostgreSQL 對同一列的
-- 並行 UPDATE 會用列鎖序列化——後到的陳述式會等前一個 commit 後，才讀到「msgs || 新訊息」
-- 這個運算式的最新值，因此不會發生「後寫蓋掉先寫」。
--
-- 部署方式：在 Supabase SQL Editor 貼上本檔全文執行一次即可（可重複執行，CREATE OR REPLACE）。
-- 執行後不需要額外設定 RLS（本專案 RLS 全開，function 沿用呼叫者權限）。
-- ==============================================

create or replace function public.append_conversation_message(
  p_id text,
  p_msg jsonb,
  p_last_msg text,
  p_last_time text,
  p_wf_id text default null,
  p_name text default null,
  p_platform text default null,
  p_av text default null,
  p_unread_delta int default 1,
  p_agent_takeover boolean default null,
  p_need_case boolean default null,
  p_biz_inquiry boolean default null
) returns void
language plpgsql
as $$
begin
  insert into public.conversations (
    id, wf_id, name, platform, av, unread, last_msg, last_time, msgs,
    agent_takeover, need_case, biz_inquiry
  )
  values (
    p_id, p_wf_id, coalesce(p_name, p_id), coalesce(p_platform, 'line'),
    coalesce(p_av, left(coalesce(p_name, p_id), 1)),
    greatest(p_unread_delta, 0), p_last_msg, p_last_time, jsonb_build_array(p_msg),
    coalesce(p_agent_takeover, false), coalesce(p_need_case, false), coalesce(p_biz_inquiry, false)
  )
  on conflict (id) do update set
    msgs           = coalesce(public.conversations.msgs, '[]'::jsonb) || p_msg,
    unread          = greatest(public.conversations.unread + p_unread_delta, 0),
    last_msg        = p_last_msg,
    last_time       = p_last_time,
    wf_id           = coalesce(p_wf_id, public.conversations.wf_id),
    name            = coalesce(p_name, public.conversations.name),
    agent_takeover  = coalesce(p_agent_takeover, public.conversations.agent_takeover),
    need_case       = coalesce(p_need_case, public.conversations.need_case),
    biz_inquiry     = coalesce(p_biz_inquiry, public.conversations.biz_inquiry);
end;
$$;

-- 呼叫範例（前端 / Edge Function 皆可用同一支）：
--   supabase.rpc('append_conversation_message', {
--     p_id: convId, p_msg: {id,from,text,time,ts}, p_last_msg: text, p_last_time: time,
--     p_wf_id: wfId, p_name: name, p_platform: 'line', p_av: name[0], p_unread_delta: 1
--   })
