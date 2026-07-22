# 🧾 Pocket Police

**Your personal debt-collection sidekick.** Track who owes you money, log every
expense against them, and let the app do the awkward reminding — automatically, on
the 1st of every month, by email (and optionally SMS / WhatsApp).

Built with React Native (Expo) + an Express API on Supabase.

---

## Why

People constantly lend small amounts — dinner, a cab, movie tickets, a loan. It's
hard to track, awkward to chase, and easy to forget. Pocket Police keeps the ledger
**and** does the chasing for you, with a UPI pay link so settling up is one tap.

## Features

- 🔐 **Google sign-in** (Supabase Auth) — your data is private and isolated per user
- 👥 **People & ledger** — add people (name, description, email, phone, WhatsApp) and
  log signed expenses (`+` they took, `−` they paid back); balances compute automatically
- 📊 **Dashboard** — total outstanding, per-person balances, month stats, search + sort
- ✏️ **Full editing** — edit/delete people and expenses; "record a payment" shortcut
- 📅 **Automated monthly reminders** — on the 1st of each month, everyone with a
  positive balance gets a reminder
- ✉️ **Custom email** — editable subject/message/closing with placeholders, an expense
  **history table**, total, and a **UPI QR** to pay
- 📱 **SMS & WhatsApp** via Twilio (optional)
- 🕓 **Reminder history**, per-person reminder toggles, and account settings
- 🌗 **Light + AMOLED dark mode** (follows system), Material icons throughout, INR by default

## Architecture

```
┌──────────────────────┐      HTTPS + JWT      ┌───────────────────────┐
│  Mobile app (Expo)   │ ───────────────────►  │  Express API (Vercel) │
│  Google sign-in      │                       │  JWKS-verifies JWT,   │
│  Dashboard / ledger  │ ◄───────────────────  │  all DB via service   │
└──────────┬───────────┘        JSON           │  key + user scoping   │
           │                                   └───────────┬───────────┘
           │ Supabase Auth (Google OAuth)                  │
           ▼                                               ▼
     ┌───────────────────────────  Supabase  ───────────────────────────┐
     │  Postgres (RLS) · profiles · people · expenses · reminder_*       │
     └───────────────────────────────────────────────────────────────────┘
                                   ▲
             HTTPS POST (CRON_SECRET) │  1st of each month
                                   │
                    ┌──────────────────────────────┐
                    │  GitHub Actions (cron)        │  → triggers the reminder job
                    └──────────────────────────────┘
                                   │
                     SMTP (email) · Twilio (SMS / WhatsApp)
```

**Design principle:** the mobile app never touches the database directly — everything
goes through the Express API, which verifies the Supabase JWT locally (JWKS) and scopes
every query to the signed-in user. Row-Level Security is a second layer of defense.

## Tech stack

| Layer | Tech |
|---|---|
| Mobile | React Native, **Expo SDK 56**, expo-router, `@expo/vector-icons` |
| Backend | Node.js, **Express**, `jose` (JWT/JWKS), Zod |
| Database & Auth | **Supabase** (Postgres + RLS + Google OAuth) |
| Hosting | **Vercel** (serverless) for the API |
| Scheduler | **GitHub Actions** (monthly cron) |
| Email | **SMTP** (Nodemailer) |
| SMS / WhatsApp | **Twilio** |

## Repository structure

```
.
├── mobile/         # Expo React Native app  (see mobile/README.md)
├── backend/        # Express API + reminder engine  (see backend/README.md)
│   ├── src/        # app, routes, services, middleware
│   ├── api/        # Vercel serverless entry
│   └── db/         # SQL migrations
├── .github/        # GitHub Actions monthly-reminders workflow
├── prd.md          # Product requirements
├── design.md       # Technical design
└── DEPLOYMENT.md   # How to deploy (Vercel + Actions + EAS)
```

## Quick start

You'll need: Node 20+, a Supabase project, and the Expo CLI.

```bash
# 1. Backend
cd backend
cp ../.env.example ../.env         # fill in Supabase / SMTP / Twilio / CRON_SECRET
# run db/migrations/001–004 in the Supabase SQL editor
npm install
npm run dev                        # http://localhost:4000

# 2. Mobile app
cd ../mobile
cp .env.example .env               # EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
npm install
npx expo start --dev-client
```

Detailed setup lives in **[backend/README.md](backend/README.md)** and
**[mobile/README.md](mobile/README.md)**.

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full guide:

- **Backend → Vercel** (serverless Express, `api/index.js` + `vercel.json`)
- **Cron → GitHub Actions** (`BACKEND_URL` + `CRON_SECRET` secrets)
- **App → EAS Build** (standalone APK for your phone / friends; or Play Store)

## Data model (short version)

- **profiles** — one per user (Google account), holds name, currency (INR), UPI ID
- **people** — debtors you track; belong to one user
- **expenses** — signed ledger entries (`+` owes more, `−` paid back)
- **balance** — *derived, never stored*: `sum(expenses.amount)` per person
- **reminder_settings / reminder_logs** — channel config + an audit of every send

## License

Personal project — not currently licensed for redistribution.

---

<sub>Built with Claude Code.</sub>
