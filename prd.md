# Pocket Police — Product Requirements Document (PRD)

> **Pocket Police** is your personal debt-collection sidekick: it keeps watch over
> who owes you money — track every person, log each expense against them, and let
> the app do the awkward reminding for you.

- **Status:** Draft v1.0
- **Owner:** Ritesh Prajapati
- **Last updated:** 2026-07-19

---

## 1. Overview

### 1.1 Problem
People constantly lend small amounts to friends, family, and colleagues —
dinner, movie tickets, a cab, a loan. These are hard to track, awkward to
chase, and easy to forget. There is no lightweight tool that both **records**
these informal debts and **automatically reminds** the debtor.

### 1.2 Solution
A mobile app where a signed-in user (the **lender**) manages a list of **people**
(**debtors**) and logs **expenses** (money lent, or money paid back) against each
one. The app computes a running balance per person and a total across all people.
On the 1st of every month it automatically nudges everyone with an outstanding
balance via **email**, and optionally **SMS** and **WhatsApp**.

### 1.3 Goals
- Let a user see, at a glance, how much money is owed to them in total and per person.
- Make logging an expense take under 10 seconds.
- Automate monthly reminders so the user never has to send the "hey, you owe me…" message.
- Keep each user's data completely private and isolated.

### 1.4 Non-goals (v1)
- No actual money movement / payments / UPI / settlement. This is a **ledger**, not a wallet.
- No two-sided accounts (debtors do **not** log in; they are just contacts).
- No group/split-bill logic (Splitwise-style shared expenses). Balances are one-directional.
- No multi-currency conversion (single currency per user).

---

## 2. Users & Personas

| Persona | Description | Needs |
|---|---|---|
| **The Lender** (primary user) | Anyone who lends money informally and wants to keep track. | Fast entry, clear totals, hands-off reminders. |
| **The Debtor** (contact, not a user) | The person who owes money. Receives reminders. | A clear, non-embarrassing reminder of what they owe and why. |

---

## 3. Core Concepts / Data Model (conceptual)

- **User** — the authenticated account (via Google). Owns everything below.
- **Person** — a debtor the user tracks. Fields: `name`, `description`, `email`,
  `phone`, `whatsapp`. Belongs to one user.
- **Expense** — a single ledger entry against a person. Fields: `amount` (signed),
  `note` (what it was for), `date`. Belongs to one person.
  - Positive amount = money the debtor now owes more of (e.g. *dinner +$10*).
  - Negative amount = money the debtor paid back / a credit (e.g. *repaid −$5*).
- **Balance** — derived, never stored: `sum(expenses.amount)` for a person.
  A positive balance means the person owes the user money.

**Example**
```
Person A
  Dinner        +$10
  Burger repaid  −$5
  Balance = $5   → A owes the user $5
```

---

## 4. Features & Requirements

### 4.1 Authentication (P0)
- Sign in with **Google** (OAuth via Supabase Auth).
- First sign-in auto-provisions the user profile.
- Sign out.
- All data scoped to the signed-in user; no cross-user access (enforced by RLS).

### 4.2 Dashboard (P0)
- Show **total outstanding** across all people (sum of all positive balances).
- List all people with their individual balances, sorted by highest balance first.
- Visual cue for who owes the most / who is settled (balance = 0).
- Quick access: tap a person → their detail/ledger; FAB to add a person.
- Optional summary stats: number of debtors, total lent this month, total collected this month.

### 4.3 People Management (P0)
- **Add person**: `name` (required), `description`, `email`, `phone`, `whatsapp`.
  - At least one contact channel recommended (needed for reminders).
- **Edit** and **delete** a person (delete cascades their expenses, with confirmation).
- View a person's detail screen: contact info + full expense ledger + current balance.

### 4.4 Expense Management (P0)
- **Add expense** under a person: `amount` (signed), `note`, `date` (defaults to today).
  - Simple toggle for "they took money" (+) vs "they paid back" (−).
- **Edit** / **delete** an expense.
- Ledger view: chronological list of expenses with running balance.

### 4.5 Monthly Reminders (P0 = email, P1 = SMS/WhatsApp)
- On the **1st of every month**, for each person with a **positive balance**, send a reminder.
- **Email** (P0): includes person's name, total owed, and optionally a breakdown of recent items/notes.
- **SMS** (P1) and **WhatsApp** (P1) via **Twilio**, sent to `phone` / `whatsapp` if present.
- User can configure, per the whole account and/or per person:
  - Which channels are enabled (email / SMS / WhatsApp).
  - Whether reminders are on at all (global + per-person opt-out).
- Reminders only send to channels that have a value on record.
- Each send is logged (see 4.6) to avoid duplicates and to show history.

### 4.6 Reminder History / Notifications Log (P1)
- Record every reminder sent: person, channel, amount at time of send, status (sent/failed), timestamp.
- Surface last-reminded date on the person detail screen.

### 4.7 Settings (P1)
- Default currency (display only in v1).
- Global reminder toggle + default channels.
- Manage account / sign out.

---

## 5. User Stories

1. As a lender, I sign in with Google so I don't manage another password.
2. As a lender, I add a person with their name and WhatsApp number so I can track and reach them.
3. As a lender, I log "Dinner +$10" against Person A in a few taps.
4. As a lender, I log "−$5" when Person A pays me back, so the balance updates automatically.
5. As a lender, I open the dashboard and instantly see Person A owes $5 and my total outstanding.
6. As a lender, on the 1st of the month my debtors get reminded automatically without me lifting a finger.
7. As a lender, I turn off reminders for my brother because I'll never actually chase him.
8. As a lender, I can see when each person was last reminded and whether it delivered.

---

## 6. Success Metrics
- **Activation:** % of new users who add ≥1 person and ≥1 expense in the first session.
- **Retention:** weekly active lenders logging at least one expense.
- **Automation value:** number of reminders sent per month; reminder delivery success rate.
- **Speed:** median time to log an expense (target < 10s).

---

## 7. Assumptions & Open Questions
- **Single currency per user** in v1 (no FX). Confirm default (USD? INR?).
- Debtors are contacts only; they never authenticate. Confirmed.
- Reminder cadence is fixed at monthly-on-the-1st for v1 (configurable cadence is future work).
- WhatsApp via Twilio requires an approved **message template** and a WhatsApp-enabled sender — needs Twilio account setup and template approval before P1 ships.
- SMS/WhatsApp deliverability depends on valid, correctly-formatted (E.164) phone numbers.
- Timezone for the "1st of the month" job — use the user's timezone or a fixed one (e.g. UTC)? Assume UTC in v1, revisit.

---

## 8. Release Plan

| Milestone | Scope |
|---|---|
| **M1 — Core ledger** | Google auth, people CRUD, expense CRUD, dashboard with balances. |
| **M2 — Email reminders** | Monthly scheduled job, email channel, reminder logging, per-person opt-out. |
| **M3 — SMS + WhatsApp** | Twilio SMS + WhatsApp channels, channel settings, delivery status. |
| **M4 — Polish** | Settings, reminder history UI, dashboard stats, empty/error states. |

---

## 9. Tech Stack (summary — see design.md)
- **Mobile app:** React Native + Expo.
- **Backend / DB / Auth:** Supabase (Postgres, Auth, Row-Level Security, Edge Functions, `pg_cron`).
- **Scheduled jobs:** GitHub Actions (monthly cron) → Supabase Edge Function for reminders.
- **Email:** Resend (or SMTP) via Edge Function.
- **SMS / WhatsApp:** Twilio via Edge Function.
