# Pocket Police — Technical Design Document

- **Status:** Draft v1.0
- **Owner:** Ritesh Prajapati
- **Last updated:** 2026-07-19
- **Related:** [prd.md](prd.md)

---

## 1. Architecture Overview

```
┌─────────────────────────────┐
│   Mobile App (Expo / RN)    │
│  - Google sign-in           │
│  - Dashboard, People,       │
│    Expenses, Settings       │
└──────────────┬──────────────┘
               │ supabase-js (HTTPS + JWT)
               ▼
┌─────────────────────────────────────────────────────────┐
│                       Supabase                           │
│                                                          │
│  Auth (Google OAuth) ──> issues JWT (auth.uid())         │
│                                                          │
│  Postgres + Row-Level Security                           │
│    profiles · people · expenses · reminder_settings ·    │
│    reminder_logs                                         │
│                                                          │
│                       Edge Function                      │
│                    "send-monthly-reminders"              │
└───────────────────────────────────▲──────────────────────┘
                                     │ HTTPS POST (+ CRON_SECRET)
                                     │
┌────────────────────────────────────────────────────────┐
│   GitHub Actions  (schedule: '0 9 1 * *' — 1st monthly) │
│   .github/workflows/monthly-reminders.yml               │
└───────────────────────────────────┬──────────────────────┘
                                     │ (server-side, service role)
                        ┌────────────┼────────────┐
                        ▼            ▼             ▼
                   Resend/SMTP   Twilio SMS   Twilio WhatsApp
                     (email)                   (template msg)
```

**Key principles**
- The mobile client talks **only** to Supabase; no custom API server in v1.
- All data access is guarded by **Row-Level Security** keyed on `auth.uid()`.
- All third-party sends (email/SMS/WhatsApp) and secrets live **server-side** in Edge Functions, never in the app.

---

## 2. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| Mobile | **React Native + Expo** | One codebase for iOS/Android, fast iteration, first-class Supabase support, EAS builds. |
| Auth | **Supabase Auth (Google OAuth)** | Managed OAuth, integrates with RLS via `auth.uid()`. |
| DB | **Supabase Postgres** | Relational data (users→people→expenses) fits perfectly; RLS for isolation. |
| Server logic | **Supabase Edge Functions (Deno/TS)** | Hold secrets, call Twilio/Resend, do the reminder work. |
| Scheduler | **GitHub Actions** (`schedule` cron) | Free, easy to configure/inspect/re-run; no DB extensions needed. Triggers the Edge Function monthly. |
| Email | **Resend** (fallback: SMTP) | Simple API, good deliverability; swappable. |
| SMS / WhatsApp | **Twilio** | Required by product; single vendor for both channels. |
| State (client) | **React Query (TanStack)** | Caching, optimistic updates, background refetch over Supabase queries. |

---

## 3. Data Model

### 3.1 Entity relationships
```
auth.users (Supabase managed)
    │ 1
    │
profiles (1:1 with auth.users)
    │ 1
    │ *
people
    │ 1
    │ *
expenses

reminder_settings (per user; optional per-person override rows)
reminder_logs     (per send)
```

### 3.2 Schema (Postgres DDL)

```sql
-- Enable required extensions
create extension if not exists pgcrypto;   -- gen_random_uuid()
-- (No pg_cron needed — scheduling is handled by GitHub Actions, see §6.)

-- ── profiles ─────────────────────────────────────────────
-- 1:1 mirror of auth.users, created on first sign-in.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  avatar_url   text,
  currency     text not null default 'USD',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── people (debtors) ─────────────────────────────────────
create table public.people (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  description   text,
  email         text,
  phone         text,        -- E.164 preferred, e.g. +14155550123
  whatsapp      text,        -- E.164 preferred
  reminders_on  boolean not null default true,   -- per-person opt-out
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index people_user_id_idx on public.people(user_id);

-- ── expenses (ledger entries) ────────────────────────────
create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- signed: positive = debtor owes more; negative = debtor paid back
  amount      numeric(12,2) not null,
  note        text,
  incurred_on date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index expenses_person_id_idx on public.expenses(person_id);
create index expenses_user_id_idx   on public.expenses(user_id);

-- ── reminder settings (account-level defaults) ───────────
create table public.reminder_settings (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  reminders_on     boolean not null default true,
  channel_email    boolean not null default true,
  channel_sms      boolean not null default false,
  channel_whatsapp boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- ── reminder logs (audit of every send) ──────────────────
create table public.reminder_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  person_id     uuid not null references public.people(id) on delete cascade,
  channel       text not null check (channel in ('email','sms','whatsapp')),
  amount_owed   numeric(12,2) not null,   -- balance snapshot at send time
  status        text not null check (status in ('sent','failed','skipped')),
  provider_id   text,                      -- Twilio SID / Resend id
  error         text,
  sent_at       timestamptz not null default now()
);
create index reminder_logs_person_idx on public.reminder_logs(person_id);
create index reminder_logs_user_idx   on public.reminder_logs(user_id);
```

### 3.3 Derived balance
Balance is **never stored** — always computed from expenses. Expose it via a view
for convenient querying from the client:

```sql
create or replace view public.person_balances as
select
  p.id            as person_id,
  p.user_id,
  coalesce(sum(e.amount), 0)::numeric(12,2) as balance
from public.people p
left join public.expenses e on e.person_id = p.id
group by p.id, p.user_id;
```
> Views inherit RLS from their underlying tables when created with
> `security_invoker = on` (Postgres 15+). Set that so the view is queried as the
> calling user.

```sql
alter view public.person_balances set (security_invoker = on);
```

---

## 4. Security — Row-Level Security (RLS)

Every table is isolated per user. Enable RLS and add policies so a user can only
touch rows where `user_id = auth.uid()`.

```sql
alter table public.profiles          enable row level security;
alter table public.people            enable row level security;
alter table public.expenses          enable row level security;
alter table public.reminder_settings enable row level security;
alter table public.reminder_logs     enable row level security;

-- profiles: a user sees/edits only their own row
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- people
create policy "own people" on public.people
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- expenses
create policy "own expenses" on public.expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reminder_settings
create policy "own reminder settings" on public.reminder_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reminder_logs: read-only from client (writes happen server-side via service role)
create policy "read own reminder logs" on public.reminder_logs
  for select using (user_id = auth.uid());
```

**Notes**
- Edge Functions use the **service-role key** (bypasses RLS) to write `reminder_logs`
  and read across all users for the monthly job. This key lives only in function secrets.
- `expenses.user_id` is denormalized (copied from the parent person) purely so RLS
  policies stay simple and fast. Enforce it with a trigger:

```sql
create or replace function public.set_expense_user_id()
returns trigger language plpgsql as $$
begin
  select user_id into new.user_id from public.people where id = new.person_id;
  return new;
end;
$$;
create trigger expenses_set_user_id
  before insert or update on public.expenses
  for each row execute function public.set_expense_user_id();
```

### 4.1 Auto-provision profile on sign-up
```sql
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
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## 5. Authentication Flow

1. App opens → check for existing Supabase session (persisted securely on device).
2. If none, user taps **Continue with Google**.
3. Expo `expo-auth-session` / `supabase.auth.signInWithOAuth({ provider: 'google' })`
   opens the Google consent screen; redirect returns to a deep link (app scheme).
4. Supabase exchanges the code, issues a JWT; `on_auth_user_created` trigger seeds
   `profiles` + `reminder_settings`.
5. Client stores the session; all subsequent DB calls carry the JWT so RLS applies.

**Config needed**
- Google OAuth client (iOS, Android, Web) in Google Cloud Console.
- Redirect URLs + app scheme (`vasulibhai://`) registered in Supabase Auth settings.

---

## 6. Scheduled Monthly Reminders

### 6.1 Trigger — GitHub Actions
A scheduled workflow fires on the 1st of every month and does a single authenticated
`POST` to the Edge Function. GitHub gives us free scheduling, logs, and a
**"Run workflow"** button for manual testing — no DB extensions required.

`.github/workflows/monthly-reminders.yml`
```yaml
name: Monthly Pocket Police Reminders

on:
  schedule:
    - cron: '0 9 1 * *'   # 09:00 UTC on the 1st of every month
  workflow_dispatch: {}     # allow manual runs for testing

jobs:
  send-reminders:
    runs-on: ubuntu-latest
    steps:
      - name: Invoke send-monthly-reminders Edge Function
        run: |
          curl --fail --silent --show-error \
            -X POST "${{ secrets.SUPABASE_FUNCTION_URL }}/send-monthly-reminders" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{}'
```

**Notes**
- `CRON_SECRET` is a shared secret stored in **GitHub repo secrets**; the Edge
  Function verifies it (§6.2 step 1) so only this workflow can trigger a send.
- `SUPABASE_FUNCTION_URL` = `https://<PROJECT_REF>.functions.supabase.co`.
- `--fail` makes the step (and workflow run) go red if the function returns non-2xx,
  so failures are visible in the Actions tab. Optionally add a notification step on failure.
- GitHub cron is best-effort and always **UTC**; scheduled runs can be delayed a few
  minutes under load — fine for a monthly reminder. Keep `workflow_dispatch` for re-runs.

### 6.2 Edge Function — `send-monthly-reminders`
Pseudocode (Deno / TypeScript):

```ts
// 1. Verify the shared CRON_SECRET from the Authorization header
//    (set as an Edge Function secret; must match the GitHub Actions secret).
// 2. Using the service-role client, fetch all people with a POSITIVE balance
//    whose reminders are enabled (account-level AND per-person).
const debtors = await db.rpc('get_debtors_to_remind'); // joins person_balances + settings

// 3. For each debtor, for each enabled channel with a value on record:
for (const d of debtors) {
  if (settings.channel_email && d.email)
    await sendEmail(d);          // Resend
  if (settings.channel_sms && d.phone)
    await sendSms(d);            // Twilio SMS
  if (settings.channel_whatsapp && d.whatsapp)
    await sendWhatsApp(d);       // Twilio WhatsApp (approved template)

  // 4. Insert a reminder_logs row per channel (status sent/failed + provider id).
}
```

Supporting SQL helper (`get_debtors_to_remind`) — a `security definer` function that
returns each user's debtors with positive balance and merged channel settings, so the
function does one round-trip instead of N.

### 6.3 Channel implementations
- **Email (Resend):** `POST https://api.resend.com/emails` with a templated HTML body:
  greeting, amount owed (formatted in the user's currency), optional recent-item list,
  and a soft "please settle when convenient" tone.
- **SMS (Twilio):** `POST /2010-04-01/Accounts/{SID}/Messages.json`, `From` = Twilio number,
  `To` = person's phone (E.164), short plain-text body.
- **WhatsApp (Twilio):** same Messages API, `From`/`To` prefixed `whatsapp:`, using an
  **approved template** (WhatsApp requires pre-approved templates for business-initiated msgs).

### 6.4 Idempotency & failure handling
- Query `reminder_logs` for the current month/person/channel before sending to avoid
  duplicates if the job is retried.
- Wrap each send in try/catch; log `failed` with the provider error rather than aborting
  the whole batch. Process debtors in batches to respect provider rate limits.

---

## 7. Mobile App Structure

### 7.1 Screens
| Screen | Purpose |
|---|---|
| **Auth / Sign-in** | Google sign-in, session bootstrap. |
| **Dashboard** | Total outstanding + list of people sorted by balance; FAB to add person. |
| **Person Detail** | Contact info, current balance, expense ledger, "add expense", reminder toggle, last-reminded. |
| **Add/Edit Person** | Form: name, description, email, phone, whatsapp. |
| **Add/Edit Expense** | Amount, +/− toggle, note, date. |
| **Settings** | Currency, global reminders + default channels, sign out. |
| **Reminder History** (P1) | List of sent reminders with status. |

### 7.2 Suggested project layout
```
app/
  (auth)/sign-in.tsx
  (tabs)/index.tsx           # Dashboard
  (tabs)/settings.tsx
  person/[id].tsx            # Person detail + ledger
  person/new.tsx
  person/[id]/expense/new.tsx
lib/
  supabase.ts                # client init
  queries/                   # React Query hooks (people, expenses, balances)
  format.ts                  # currency/amount formatting
components/
  PersonRow.tsx  ExpenseRow.tsx  BalancePill.tsx  AmountInput.tsx
supabase/
  migrations/                # SQL above
  functions/send-monthly-reminders/index.ts
.github/
  workflows/monthly-reminders.yml   # scheduled cron trigger
```

### 7.3 Client data access
- Use `supabase-js` wrapped in **React Query** hooks:
  - `usePeople()` → people + joined balance (from `person_balances`).
  - `usePerson(id)`, `useExpenses(personId)`.
  - Mutations (`addExpense`, `addPerson`, …) with **optimistic updates** so the
    balance updates instantly, then reconcile on server response.
- Amounts stored as `numeric(12,2)`; format on display with the user's `currency`.

---

## 8. Secrets & Configuration

| Secret | Where | Used by |
|---|---|---|
| Supabase URL + anon key | App env (`app.config`) | Client (safe, RLS-guarded). |
| Supabase service-role key | Edge Function secrets | Monthly reminder job. |
| `CRON_SECRET` | Edge Function secret **+ GitHub repo secret** | Authenticating the GitHub Actions → function call (same value both sides). |
| `SUPABASE_FUNCTION_URL` | GitHub repo secret | The Actions workflow's POST target. |
| Google OAuth client IDs | Supabase Auth config | Sign-in. |
| Resend API key | Edge Function secret | Email. |
| Twilio SID / auth token / from-numbers | Edge Function secrets | SMS + WhatsApp. |

> Never ship the service-role key, Twilio, or Resend credentials in the mobile bundle.

---

## 9. Edge Cases & Considerations
- **Negative / zero balances:** only positive balances trigger reminders; settled people are shown but not chased.
- **Missing contact channel:** skip that channel, log `skipped`; don't error.
- **Deleting a person:** cascades expenses and logs (FK `on delete cascade`); confirm in UI.
- **Currency:** display-only in v1; all math is currency-agnostic on `numeric`.
- **Phone format:** validate/normalize to E.164 on save; warn if likely invalid.
- **Timezone:** monthly job runs at a fixed UTC time in v1; per-user TZ is future work.
- **Duplicate reminders:** guarded by the current-month log check (§6.4).
- **WhatsApp template approval:** blocking dependency for the WhatsApp channel; email works day one.

---

## 10. Future Work
- Configurable reminder cadence (weekly/biweekly, custom day).
- Debtor-facing "settle up" acknowledgement link.
- Multi-currency with FX.
- Export ledger (CSV/PDF).
- Push notifications to the lender (e.g. "3 people reminded today").
- Recurring/auto expenses (e.g. monthly subscriptions someone owes you for).
- Charts: lending trends over time.
```
