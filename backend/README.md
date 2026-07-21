# Pocket Police — Backend (Express API)

Express API that sits between the mobile app and Supabase. The app signs in with
Google via Supabase Auth and sends the resulting JWT as a `Bearer` token; this
backend verifies it locally (JWKS) and performs all DB work with the Supabase
**secret** key, scoping every query to the authenticated user.

## Setup

1. **Env** — the app reads the project-root `.env` (one level up). Copy the
   template and fill it in:
   ```bash
   cp ../.env.example ../.env   # you already have Supabase keys in ../.env
   ```
   Your existing `.env` already has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`. Add `CRON_SECRET` (any long random
   string) and, when ready, the Resend / Twilio keys.

2. **Database** — run the migration once in the Supabase SQL editor:
   `db/migrations/001_init.sql`

3. **Install & run**
   ```bash
   npm install
   npm run dev      # http://localhost:4000, restarts on change
   ```
   Health check: `curl http://localhost:4000/health`

## API

All `/api/*` routes below require `Authorization: Bearer <supabase-user-jwt>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/me` | Get profile (auto-provisions) |
| PATCH | `/api/me` | Update name / currency |
| GET | `/api/dashboard` | Totals + people with balances |
| GET | `/api/people` | List people (with balances) |
| POST | `/api/people` | Add person `{name, description?, email?, phone?, whatsapp?}` |
| GET | `/api/people/:id` | Person + balance |
| PATCH | `/api/people/:id` | Update person |
| DELETE | `/api/people/:id` | Delete person (expenses cascade) |
| GET | `/api/people/:id/expenses` | Ledger with running balance |
| POST | `/api/people/:id/expenses` | Add expense `{amount, note?, incurred_on?}` |
| PATCH | `/api/expenses/:id` | Update expense |
| DELETE | `/api/expenses/:id` | Delete expense |
| GET | `/api/settings` | Reminder settings |
| PATCH | `/api/settings` | Toggle reminders/channels |
| GET | `/api/reminders/logs` | Reminder history |

Cron-only (protected by `CRON_SECRET`, not a user JWT):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/cron/send-monthly-reminders` | Run monthly reminders (`?dryRun=1` to preview) |

**Amount convention:** positive = the person owes more (e.g. dinner `+10`);
negative = they paid back (e.g. `-5`). Balance = sum of a person's expenses.

## Monthly reminders

Scheduled by GitHub Actions (`.github/workflows/monthly-reminders.yml`) which POSTs
to the cron endpoint on the 1st of each month. Set these **GitHub repo secrets**:
`BACKEND_URL` (public URL of this deployed backend) and `CRON_SECRET` (same value
as in `.env`).

Test the job locally without waiting for the 1st:
```bash
npm run reminders:manual -- --dry   # preview, no sends
npm run reminders:manual            # live
```
