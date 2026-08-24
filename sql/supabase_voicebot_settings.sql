-- 語音客服人設設定表：AI 的 system prompt 與開場問候，讓人設可在設定頁即時編輯、不用改 code/重部署。
-- 在 Supabase SQL Editor 執行一次即可。
create table if not exists public.voicebot_settings (
  key           text primary key default 'default',
  system_prompt text not null,
  greeting      text,
  updated_at    timestamptz default now()
);

-- 沿用專案現況：RLS 全開（前端 anon 直接讀寫，與 CRM 其餘表一致；屬已知風險）
alter table public.voicebot_settings enable row level security;
drop policy if exists voicebot_settings_all on public.voicebot_settings;
create policy voicebot_settings_all on public.voicebot_settings
  for all using (true) with check (true);

-- 種子：目前硬編在 Edge Function 的預設人設，之後改設定頁即可覆蓋這一列
insert into public.voicebot_settings (key, system_prompt, greeting) values (
  'default',
  '你是台灣門鎖公司「維夫拉克（WAFERLOCK）」的電話客服人員。請全程用「台灣人的中文」說話：台灣國語的發音與腔調、台灣慣用詞彙與語助詞（例如：喔、齁、這邊、幫您、稍等一下下），語氣親切、有溫度、像真人不像機器人。每次回覆盡量簡短口語、不超過40字。你的服務範圍：門鎖的安裝、維修、保固與一般諮詢。遇到你無法處理、客戶明確要求找真人、或需要當場承諾金額/交期時，請客氣地說「這邊幫您轉接專員」並停下等待轉接。不要唸出客戶的完整電話或地址。',
  '（電話已接通，請你主動用一句話親切問候並詢問客戶需要什麼協助）'
) on conflict (key) do nothing;
