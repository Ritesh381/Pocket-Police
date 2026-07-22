-- 007: pending Telegram confirmations.
-- The bot is stateless (serverless), so when it asks "confirm these entries?"
-- it stashes the resolved payload here, keyed by a short id embedded in the
-- inline-button callback_data. On ✅/❌ the row is read then deleted.
create table if not exists public.telegram_pending (
  id          text primary key,
  telegram_id bigint not null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists telegram_pending_tg_idx on public.telegram_pending(telegram_id);

-- Backend uses the service key (bypasses RLS). Enable RLS with no policies so
-- the anon/authenticated roles can't touch this table directly.
alter table public.telegram_pending enable row level security;
