# Deploying Pocket Police

This guide covers deploying all three moving parts:

| Part | Where | What it does |
|---|---|---|
| **Backend** (Express API) | **Vercel** (serverless) | Handles all app requests + the reminder engine |
| **Monthly cron** | **GitHub Actions** | Triggers the reminder job on the 1st of each month |
| **Mobile app** | **EAS Build** (Expo) | The Android app your users install |
| Database + Auth | **Supabase** | Already set up |

**Order matters:** deploy the **backend first** (you need its URL for the cron and the app).

---

## 0. Push the repo to GitHub

Vercel and GitHub Actions both deploy from a GitHub repo.

```bash
# from the project root
gh repo create pocket-police --private --source=. --remote=origin --push
```

Or create a repo on github.com and:
```bash
git remote add origin https://github.com/<you>/pocket-police.git
git push -u origin main
```

> `.env` files are gitignored — your secrets are **not** pushed. You'll re-enter them
> in Vercel and GitHub below.

---

## 1. Backend → Vercel

The backend is already prepared for Vercel: `backend/api/index.js` (serverless entry)
and `backend/vercel.json` (routes every request into the Express app) are in the repo.

### 1a. Import the project
1. [vercel.com](https://vercel.com) → **Add New… → Project** → import your GitHub repo.
2. **Root Directory:** set to **`backend`** (important — the API lives there, not the repo root).
3. **Framework Preset:** *Other*. Leave Build/Output commands empty — Vercel auto-detects the `api/` function.

### 1b. Set environment variables
In the import screen (or later under **Project → Settings → Environment Variables**),
add these for the **Production** (and Preview) environment. Copy the values from your
local `.env`:

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | Your project URL |
| `SUPABASE_SECRET_KEY` | Service key — server only |
| `SUPABASE_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `CRON_SECRET` | Long random string (must match the GitHub secret in step 2) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | Email sending |
| `REMINDER_FROM_EMAIL` | e.g. `Pocket Police <you@gmail.com>` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Optional (SMS/WhatsApp) |
| `TWILIO_SMS_FROM` / `TWILIO_WHATSAPP_FROM` | Optional |
| `CORS_ORIGINS` | `*` is fine (native apps aren't subject to CORS) |

> Don't set `PORT` — Vercel manages it. `SUPABASE_PUBLISHABLE_KEY` isn't needed here
> (it's used by the app, not the backend).

### 1c. Deploy & test
Click **Deploy**. When it finishes you get a URL like `https://pocket-police.vercel.app`.

```bash
curl https://<your-app>.vercel.app/health
# → {"ok":true,"service":"pocket-police-backend"}
```

Test an authed route by pasting a Supabase JWT:
```bash
curl https://<your-app>.vercel.app/api/dashboard   # → 401 without a token (expected)
```

**Redeploys are automatic:** every push to `main` redeploys the backend.

> **Reminder-job note:** `vercel.json` sets `maxDuration: 60` (seconds). The monthly job
> sends messages sequentially, so ~60s comfortably covers dozens of recipients. On the
> Hobby plan the ceiling is 60s; if you ever outgrow it, batch the sends or move the job
> to a queue.

---

## 2. Monthly cron → GitHub Actions

The workflow already exists: `.github/workflows/monthly-reminders.yml`. It runs at
**09:00 UTC on the 1st of each month** and POSTs to your backend's cron endpoint.

### 2a. Add repo secrets
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `BACKEND_URL` | `https://<your-app>.vercel.app` (no trailing slash) |
| `CRON_SECRET` | The **same** value you set in Vercel |

### 2b. Test it now (don't wait for the 1st)
GitHub repo → **Actions** tab → **Monthly Pocket Police Reminders** → **Run workflow**.
Set **dryRun = true** to preview without sending, or `false` to actually send. Watch the
run log — a green check means the backend was reached and the job ran.

> GitHub scheduled runs are best-effort UTC and can be delayed a few minutes — fine for a
> monthly reminder. The `workflow_dispatch` button is always available for manual runs.

---

## 3. Mobile app → EAS Build

You've already built development builds. For a shareable app that talks to the **deployed**
backend (not your laptop), you build a **preview** (APK) or **production** (Play Store) build.

### 3a. Point the app at the deployed backend
Dev builds auto-detect your laptop's backend over Wi-Fi. Standalone builds can't — they
need the Vercel URL baked in. Provide these to EAS as environment variables
(**Project → Environment Variables** on expo.dev, or `eas env:create`), for the
`preview` and `production` environments:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://<your-app>.vercel.app` |
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your publishable key |

(These are all client-safe values — the anon key is protected by RLS and is embedded in
the app bundle anyway.)

### 3b. Supabase redirect URLs
Confirm **Supabase → Authentication → URL Configuration → Redirect URLs** contains
**both** schemes:
```
vasulibhai://auth-callback
vasulibhaidev://auth-callback
```
The `development` EAS profile installs a separate app (`Pocket Police (dev)`) with its own
scheme, `vasulibhaidev://` (see `app.config.js`). Google sign-in fails silently in a dev
build if only the production scheme is allowlisted.

### 3c. Build a shareable APK (preview)
```bash
cd mobile
eas build --profile preview --platform android
```
This produces an installable **APK** with a download link. Share it, install on any Android
(allow "install from unknown sources"), and it'll talk to your Vercel backend.

### 3d. Production (Google Play)
```bash
cd mobile
eas build --profile production --platform android   # builds an .aab for the Play Store
eas submit --platform android                        # uploads to Play Console (needs a Play dev account)
```
For the Play Store you'll also need: a Google Play Developer account ($25 one-time), a
privacy policy URL, and store assets (icon, screenshots, description).

> **iOS** (optional): `eas build --profile production --platform ios` + `eas submit` — requires
> an Apple Developer account ($99/yr). The codebase is already cross-platform.

### 3e. When to rebuild
- **JS/UI changes** → no rebuild; users get them on next app open only if you ship an EAS
  Update (`eas update`) or a new build. (Dev builds hot-reload from Metro; standalone builds don't.)
- **Native/dependency/scheme/app-name changes** → new `eas build` required.

---

## Environment variable reference (backend)

Set these in Vercel. Local dev reads them from the project-root `.env` via `--env-file`.

```
SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL   # required
CRON_SECRET                                            # required for the cron endpoint
SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, REMINDER_FROM_EMAIL  # email
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM, TWILIO_WHATSAPP_FROM  # optional
CORS_ORIGINS                                           # optional (default *)
```

---

## Post-deploy checklist

- [ ] `GET /health` on the Vercel URL returns ok
- [ ] All DB migrations run in Supabase (`backend/db/migrations/001`–`004`)
- [ ] GitHub secrets `BACKEND_URL` + `CRON_SECRET` set; a manual workflow run is green
- [ ] `CRON_SECRET` is identical in Vercel and GitHub
- [ ] EAS env vars point the app at the Vercel URL
- [ ] `vasulibhai://auth-callback` is in Supabase redirect URLs
- [ ] Signed in on a preview build and loaded the dashboard end-to-end
- [ ] Sent a real (or dry-run) reminder and saw it in the Reminder history screen
