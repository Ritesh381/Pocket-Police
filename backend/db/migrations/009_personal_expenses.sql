-- 009: Personal Expenses, Categories, and Budgets
-- Pivot Pocket Police into a personal expense tracker with debt tracking as secondary.

-- ── Categories (system presets + custom user categories) ──
create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade, -- null = global system preset
  name        text not null,
  icon        text not null default 'attach-money', -- MaterialIcons name
  color       text not null default '#6366f1',
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists expense_categories_user_idx on public.expense_categories(user_id);

-- Seed global system categories if not existing
insert into public.expense_categories (name, icon, color, is_system)
values
  ('Food & Dining', 'restaurant', '#f59e0b', true),
  ('Shopping', 'shopping-bag', '#ec4899', true),
  ('Transport & Cab', 'directions-car', '#3b82f6', true),
  ('Groceries', 'shopping-cart', '#10b981', true),
  ('Bills & Utilities', 'receipt', '#8b5cf6', true),
  ('Entertainment', 'movie', '#6366f1', true),
  ('Health & Medical', 'medical-services', '#ef4444', true),
  ('Travel', 'flight', '#14b8a6', true),
  ('Education', 'school', '#06b6d4', true),
  ('Others', 'category', '#6b7280', true)
on conflict do nothing;

-- ── Personal Expenses ────────────────────────────────────
create table if not exists public.personal_expenses (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  category_id              uuid references public.expense_categories(id) on delete set null,
  amount                   numeric(12,2) not null check (amount > 0),
  note                     text,
  payment_mode             text not null default 'upi' check (payment_mode in ('upi', 'cash', 'card', 'bank_transfer', 'other')),
  incurred_on              date not null default current_date,
  linked_friend_expense_id uuid references public.expenses(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists personal_expenses_user_idx on public.personal_expenses(user_id);
create index if not exists personal_expenses_date_idx on public.personal_expenses(incurred_on desc);
create index if not exists personal_expenses_category_idx on public.personal_expenses(category_id);

-- ── Monthly Budgets ──────────────────────────────────────
create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  month_year    text not null, -- e.g. "2026-07"
  monthly_limit numeric(12,2) not null check (monthly_limit > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(user_id, month_year)
);

create index if not exists budgets_user_month_idx on public.budgets(user_id, month_year);

-- ── Row-Level Security ───────────────────────────────────
alter table public.expense_categories enable row level security;
alter table public.personal_expenses   enable row level security;
alter table public.budgets             enable row level security;

drop policy if exists "read system or own categories" on public.expense_categories;
create policy "read system or own categories" on public.expense_categories
  for select using (is_system = true or user_id = auth.uid());

drop policy if exists "own categories" on public.expense_categories;
create policy "own categories" on public.expense_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own personal expenses" on public.personal_expenses;
create policy "own personal expenses" on public.personal_expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own budgets" on public.budgets;
create policy "own budgets" on public.budgets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
