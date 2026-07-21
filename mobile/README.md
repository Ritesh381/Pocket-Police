# Pocket Police — Mobile App (Expo)

React Native app (Expo SDK 57, expo-router). Google sign-in via Supabase; all data
goes through the Express backend. Amounts display in **INR (₹)** by default.

## Test on your Android phone (development build)

We use a **development build** (a custom APK) instead of Expo Go, so the app runs
our exact SDK regardless of the Expo Go version on the phone. Build once, then
develop with live reload like normal.

### One-time: build & install the dev APK

1. **Free Expo account** — sign up at https://expo.dev if you don't have one.

2. **Log in and build** (from `mobile/`):
   ```bash
   npx eas-cli login
   npx eas-cli build --profile development --platform android
   ```
   - First run: say **yes** to create the EAS project and to generate a keystore
     (EAS manages signing for you).
   - The cloud build takes ~10–15 min and ends with a **download URL + QR code**.

3. **Install on the phone** — open that link on your Android, download the APK,
   and install it (allow "install from unknown sources" if prompted). You now have
   a **Pocket Police (dev)** app icon.

4. **Add the redirect URL in Supabase** (for Google sign-in):
   Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs** → add:
   ```
   vasulibhai://auth-callback
   ```
   (The dev build uses this custom scheme — cleaner than Expo Go's `exp://` URL.)

### Every time you develop

- **Phone + Mac on the same Wi-Fi.** The app auto-detects the backend at your Mac's
  LAN IP (currently `100.129.160.24:4000`). Avoid guest/hotspot networks that isolate
  devices.

Open **two terminals**:

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — mobile (Metro for the dev build)
cd mobile && npx expo start --dev-client
```

Open the **Pocket Police (dev)** app on your phone → it connects to Metro (scan the QR
or pick it from the dev launcher) → the app loads with live reload.

> Rebuild the APK only when native dependencies change. Day-to-day JS/UI changes
> just need `npx expo start --dev-client` — no rebuild.

## What you can do in the app
- Sign in with Google
- Dashboard: total outstanding, per-person balances, this-month lent/collected
- Add people (name, description, email, phone, WhatsApp)
- Open a person → see balance + ledger, call/WhatsApp/email them
- Add expenses: "took money" (+) or "paid back" (−) with a note
- Long-press a ledger entry to delete it
- Settings: toggle monthly reminders + channels, sign out

## Troubleshooting
- **"Network error reaching http://…:4000"** → backend not running, or phone not on
  the same Wi-Fi, or network isolation. Check the `API:` line on the sign-in screen.
- **Google sign-in bounces back without logging in** → the `Redirect:` value on the
  sign-in screen isn't in Supabase's allowed Redirect URLs (step 3).
- **Nothing loads after sign-in** → confirm the DB migration ran and the backend
  `/health` responds: `curl http://localhost:4000/health`.

## Config
- `mobile/.env` holds `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  (the publishable key — safe to ship in the app). Backend URL auto-detects; override
  with `EXPO_PUBLIC_API_URL` if needed.
