-- ==============================================
-- 對話處理狀態三態（未處理 pending / 處理中 processing / 已完成 done）
--
-- ① conversations 加 handle_status 欄位（顯示在收件匣客戶姓名旁，對話標頭下拉可切換）
-- ② 更新原子 append RPC：客戶傳新訊息（p_unread_delta>0）時，若該對話已是「已完成」
--    自動翻回「未處理」（客戶又來了新問題，不漏接）；「處理中」維持不變
--    （前端列表會在處理中＋有未讀時亮紅點提醒）。
--    邏輯放在 RPC＝LINE/Meta webhook 不用改程式、不用重新部署就生效。
--
-- 部署：在 Supabase SQL Editor 貼上本檔全文執行一次（可重複執行）。
-- ==============================================

alter table public.conversations
  add column if not exists handle_status text default 'pending';

-- 舊資料補預設值（add column 的 default 不回填既有 NULL 列以外的情況這行保險用，可重複執行）
update public.conversations set handle_status = 'pending' where handle_status is null;

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
    agent_takeover, need_case, biz_inquiry, handle_status
  )
  values (
    p_id, p_wf_id, coalesce(p_name, p_id), coalesce(p_platform, 'line'),
    coalesce(p_av, left(coalesce(p_name, p_id), 1)),
    greatest(p_unread_delta, 0), p_last_msg, p_last_time, jsonb_build_array(p_msg),
    coalesce(p_agent_takeover, false), coalesce(p_need_case, false), coalesce(p_biz_inquiry, false),
    'pending'
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
    biz_inquiry     = coalesce(p_biz_inquiry, public.conversations.biz_inquiry),
    -- 客戶來新訊息（unread 增加）且已結案 → 翻回未處理；其餘維持原狀態
    handle_status   = case
                        when p_unread_delta > 0 and public.conversations.handle_status = 'done'
                        then 'pending'
                        else coalesce(public.conversations.handle_status, 'pending')
                      end;
end;
$$;
