-- Telegram bot linking.

-- Permanent binding: one Telegram account <-> one Pocket Police user.
create table if not exists public.telegram_links (
  telegram_id  bigint primary key,
  user_id      uuid not null unique references public.profiles(id) on delete cascade,
  username     text,
  linked_at    timestamptz not null default now()
);
create index if not exists telegram_links_user_idx on public.telegram_links(user_id);

-- Short-lived, single-use tokens for the connect handshake only.
create table if not exists public.telegram_link_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;

-- The app (anon key) can read its own link status; all writes happen server-side
-- via the service key.
drop policy if exists "own telegram link" on public.telegram_links;
create policy "own telegram link" on public.telegram_links
  for select using (user_id = auth.uid());
