-- 008: Telegram chat history for multi-turn context
create table if not exists public.telegram_chat_history (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists telegram_chat_history_user_idx on public.telegram_chat_history(user_id, created_at desc);

alter table public.telegram_chat_history enable row level security;
