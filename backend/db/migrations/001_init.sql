-- Vasuli Bhai — initial schema
-- Run this in the Supabase SQL editor (or via the CLI) once.
-- See design.md §3–4 for rationale.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ── profiles ─────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  avatar_url   text,
  currency     text not null default 'INR',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── people (debtors) ─────────────────────────────────────
create table if not exists public.people (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  description   text,
  email         text,
  phone         text,
  whatsapp      text,
  reminders_on  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists people_user_id_idx on public.people(user_id);

-- ── expenses (ledger entries) ────────────────────────────
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      numeric(12,2) not null,   -- signed: + owes more, - paid back
  note        text,
  incurred_on date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists expenses_person_id_idx on public.expenses(person_id);
create index if not exists expenses_user_id_idx   on public.expenses(user_id);

-- ── reminder settings (account-level) ────────────────────
create table if not exists public.reminder_settings (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  reminders_on     boolean not null default true,
  channel_email    boolean not null default true,
  channel_sms      boolean not null default false,
  channel_whatsapp boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- ── reminder logs (audit of every send) ──────────────────
create table if not exists public.reminder_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  person_id     uuid not null references public.people(id) on delete cascade,
  channel       text not null check (channel in ('email','sms','whatsapp')),
  amount_owed   numeric(12,2) not null,
  status        text not null check (status in ('sent','failed','skipped')),
  provider_id   text,
  error         text,
  sent_at       timestamptz not null default now()
);
create index if not exists reminder_logs_person_idx on public.reminder_logs(person_id);
create index if not exists reminder_logs_user_idx   on public.reminder_logs(user_id);

-- ── derived balance view ─────────────────────────────────
create or replace view public.person_balances as
select
  p.id            as person_id,
  p.user_id,
  coalesce(sum(e.amount), 0)::numeric(12,2) as balance
from public.people p
left join public.expenses e on e.person_id = p.id
group by p.id, p.user_id;

alter view public.person_balances set (security_invoker = on);

-- ── keep expenses.user_id in sync with parent person ─────
create or replace function public.set_expense_user_id()
returns trigger language plpgsql as $$
begin
  select user_id into new.user_id from public.people where id = new.person_id;
  return new;
end;
$$;
drop trigger if exists expenses_set_user_id on public.expenses;
create trigger expenses_set_user_id
  before insert or update on public.expenses
  for each row execute function public.set_expense_user_id();

-- ── auto-provision profile + settings on sign-up ─────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  insert into public.reminder_settings (user_id)
  values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row-Level Security ───────────────────────────────────
-- The backend uses the service key (bypasses RLS) and scopes every query by
-- user_id. These policies are defense-in-depth for any direct client access.
alter table public.profiles          enable row level security;
alter table public.people            enable row level security;
alter table public.expenses          enable row level security;
alter table public.reminder_settings enable row level security;
alter table public.reminder_logs     enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own people" on public.people;
create policy "own people" on public.people
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own reminder settings" on public.reminder_settings;
create policy "own reminder settings" on public.reminder_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read own reminder logs" on public.reminder_logs;
create policy "read own reminder logs" on public.reminder_logs
  for select using (user_id = auth.uid());
