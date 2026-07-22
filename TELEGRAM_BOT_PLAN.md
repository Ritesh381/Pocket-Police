# Pocket Police — Telegram Bot (LLM natural-language entry) — Plan

Let users log debts by chatting in plain language with a Telegram bot:

> *"Jenil owes me 250 for dinner and paid back 100. Shubham took 500 for the cab."*

…and have it parsed, confirmed, and written to their Pocket Police ledger.

---

## 0. Key design decision — NO LLM-generated SQL

The tempting version is *"LLM turns the message into a SQL query and we run it."* **We will not do that.** A single crafted message could delete tables, read other users' data, or corrupt balances, and no prompt can fully prevent it.

Instead:

1. The LLM does **structured extraction** — it returns validated JSON describing *intent*, not SQL:
   ```json
   {
     "entries": [
       { "person": "Jenil", "amount": 250, "note": "dinner" },
       { "person": "Jenil", "amount": -100, "note": "paid back" },
       { "person": "Shubham", "amount": 500, "note": "cab" }
     ],
     "needs_clarification": false,
     "clarification": null
   }
   ```
   (`amount` is **signed**: `+` = they owe more, `−` = they paid back — same convention as the app.)
2. The backend **validates** that JSON (Zod), resolves person names against the user's own people, and writes each entry with the **exact same parameterized, user-scoped Supabase code the app already uses**.

Same UX, zero injection surface. This is the standard "tool/function-calling" pattern.

---

## 1. UX flow

```
1. Link      User taps "Connect Telegram" in the app → opens t.me/PocketPoliceBot?start=<token>
             → bot binds telegram_id ↔ user_id. One time.
2. Log       User: "gave jenil 300 for pizza, shubham owes 50 for chai"
3. Parse     Bot → LLM → structured entries
4. Resolve   Match "jenil"/"shubham" to existing people (fuzzy). Unknown → ask to create.
5. Confirm   Bot replies with a summary + inline [✅ Confirm] [✏️ Edit] [❌ Cancel]
6. Write     On confirm → insert expenses (validated) → update balances
7. Reply     "Added ✅  Jenil +₹300 (pizza) · Shubham +₹50 (chai). New balances: Jenil ₹1,646, Shubham ₹607."
```

Extra commands: `/start`, `/link`, `/unlink`, `/balance [name]`, `/who` (list debtors), `/help`, `/remind <name>` (reuse the remind-now endpoint).

---

## 2. Architecture — reuse the existing backend (no new hosting)

The bot is a **webhook** added to the current Express API on Vercel. Telegram POSTs each message to `/api/telegram/webhook`; the function parses, calls the LLM, writes to Supabase, and replies via the Telegram API. Serverless fits perfectly — no always-on process needed.

```
Telegram  ──POST update──►  Vercel  /api/telegram/webhook  (Express)
                                │  1. verify secret header
                                │  2. look up telegram_id → user_id (Supabase)
                                │  3. LLM structured-extract (Gemini/Groq/Claude)
                                │  4. resolve people, validate
                                │  5. confirm → write expenses (service key, scoped to user_id)
                                └──sendMessage──►  Telegram (reply)
```

Why webhook (not long-polling): polling needs a process running 24/7 (not free-friendly on serverless). Webhook is push-based and stateless — ideal for Vercel's free tier.

---

## 3. Account linking (secure)

**Don't use Telegram username as identity** — usernames are unverified, changeable, and spoofable. Use Telegram's **`start` deep-link token**:

1. In the app (Settings → "Connect Telegram"), call `POST /api/telegram/link-token` → backend creates a random single-use token (10-min TTL) in `telegram_link_tokens(token, user_id, expires_at)` and returns `https://t.me/PocketPoliceBot?start=<token>`.
2. App opens that URL. Telegram launches the bot and sends `/start <token>`.
3. Webhook sees the `start` payload, looks up the token → `user_id`, and inserts `telegram_links(telegram_id, user_id)`. Token consumed.
4. From then on, every message from that `telegram_id` is authenticated as that `user_id`.

**The connection is permanent — connect once, stay connected forever.** The
`telegram_links` row never expires; it's only removed if the user explicitly runs
`/unlink` (or deletes their account). Users never re-link.

Only the **one-time handshake token** (`telegram_link_tokens`) is short-lived — it
exists purely for the ~2 seconds between tapping "Connect" and tapping "Start", is
single-use, and is deleted the moment linking succeeds. Its expiry is a security
measure for the handshake and has **no effect** on the permanence of the connection
(same idea as the short-lived code in an OAuth redirect: the code expires, the login
doesn't).

---

## 4. Data model additions (migration 006)

```sql
-- Maps a Telegram account to a Pocket Police user.
create table if not exists public.telegram_links (
  telegram_id  bigint primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  username     text,
  linked_at    timestamptz not null default now()
);
create index if not exists telegram_links_user_idx on public.telegram_links(user_id);

-- Short-lived tokens used to bind a Telegram account during linking.
create table if not exists public.telegram_link_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;
-- Backend uses the service key; app can read its own link status:
create policy "own telegram link" on public.telegram_links
  for select using (user_id = auth.uid());
```

---

## 5. LLM: structured extraction

Use **function/tool calling** (or JSON-mode) so the model is forced to return the schema — no free-text parsing.

**System prompt (sketch):** "You extract debt ledger entries. Output only the tool call. `amount` is signed: positive when the person received money / owes more, negative when they paid back. Split multi-person messages into one entry per person per item. If a person or amount is ambiguous, set needs_clarification=true and ask a short question. Never invent amounts."

**Output schema (Zod on the backend):**
```
entries: Array<{ person: string; amount: number; note?: string; date?: string }>
needs_clarification: boolean
clarification?: string
```

**Person resolution (deterministic, in code — not the LLM):**
- Exact/case-insensitive match to one of the user's `people.name` → use it.
- Fuzzy single match (e.g. Levenshtein / includes) → use it, show which in the confirm step.
- No match → offer "Create new person 'X'?" button.
- Multiple matches → ask which one.

The confirm step is the safety net: nothing writes until the user taps ✅.

---

## 6. LLM options (free-first)

| Option | Cost | Notes |
|---|---|---|
| **Google Gemini** (`gemini-2.0-flash` / `2.5-flash`) | **Free tier** (generous daily quota) | Great default for this. Native JSON/function-calling. Just an API key. |
| **Groq** (Llama 3.x / other OSS) | **Free tier**, very fast | Good, OpenAI-compatible API. |
| **Claude Haiku** (`claude-haiku-4-5`) | Paid, but very cheap (~fractions of a ¢/msg) | Best extraction quality & instruction-following; use if free tiers get flaky at scale. |

**Recommendation:** start on **Gemini Flash free tier** (zero cost, ample for personal/friends use). Keep the LLM call behind a small `extract()` adapter so swapping to Claude Haiku later is a one-file change. Extraction is a tiny, structured task — Flash handles it well.

---

## 7. Security & guardrails

- **Webhook auth:** register with a `secret_token`; verify the `X-Telegram-Bot-Api-Secret-Token` header on every request. Reject otherwise.
- **No raw SQL** from the model (see §0). All writes go through validated, parameterized inserts scoped to the linked `user_id`.
- **Per-user isolation:** the bot can only touch the linked user's rows (same guarantee as the API).
- **Confirmation before write** for anything the LLM produced.
- **Rate limit** LLM calls per telegram_id (e.g. 20/min) to cap abuse/cost.
- **Idempotency:** ignore Telegram retries by tracking `update_id`.
- **Secrets:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY` in Vercel env (never in the app).

---

## 8. How to deploy the bot — for FREE

Everything reuses infrastructure you already pay $0 for.

**Step 1 — Create the bot (free):**
- Telegram → **@BotFather** → `/newbot` → name it → get the **bot token**.

**Step 2 — Get a free LLM key:**
- **Gemini:** [aistudio.google.com](https://aistudio.google.com) → "Get API key" (free tier). *(or Groq: console.groq.com)*

**Step 3 — Add env vars to Vercel** (Project → Settings → Environment Variables):
```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=<random string>
GEMINI_API_KEY=<key>
```

**Step 4 — Ship the webhook endpoint** (part of the existing backend): `POST /api/telegram/webhook`. Push → Vercel auto-deploys. No new service, no new bill.

**Step 5 — Register the webhook once** (tell Telegram where to send updates):
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://pocket-police.vercel.app/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

That's it — the bot is live and free:
- **Bot:** free (Telegram).
- **Hosting:** free (Vercel serverless — the webhook is just another route).
- **LLM:** free (Gemini/Groq free tier).
- **DB:** free (existing Supabase).

**Free alternatives** if you ever want the bot off Vercel: **Cloudflare Workers**, **Deno Deploy**, or **Supabase Edge Functions** — all have free webhook-friendly tiers. **Render/Railway** free tiers also work but sleep when idle (a webhook cold-start adds a few seconds). Vercel-alongside-the-API is the least work.

---

## 9. Build milestones

| Phase | Scope |
|---|---|
| **M1 — Plumbing** | `telegram_links` + token tables, `/api/telegram/webhook` (verify secret, echo), `/start <token>` linking, app "Connect Telegram" button. |
| **M2 — Extraction** | `extract()` LLM adapter (Gemini), Zod validation, person resolution, confirm inline keyboard, write on ✅. |
| **M3 — Commands** | `/balance`, `/who`, `/remind <name>` (reuse remind endpoint), `/unlink`, `/help`. |
| **M4 — Polish** | rate limiting, `update_id` dedupe, ambiguity prompts, multi-person summaries, nice formatting. |

---

## 10. Example conversation

```
You:  gave jenil 300 for pizza and he paid me back 100. new guy Aman owes 500 for concert
Bot:  Here's what I understood — confirm?
      • Jenil  +₹300  pizza
      • Jenil  −₹100  paid back
      • Aman   +₹500  concert   (new person — create?)
      [✅ Confirm & create Aman]   [✏️ Edit]   [❌ Cancel]
You:  (tap ✅)
Bot:  Done ✅
      Jenil now owes ₹1,546 · Aman (new) owes ₹500.
```

---

## Open questions
- **Group chats?** v1 = private 1:1 chat only (identity is clear). Group support later.
- **Read-back commands** beyond balance (e.g. "what did Jenil buy last month")? Same structured pattern, read-only.
- **Editing/deleting via chat?** Possible, but higher risk — keep destructive ops confirmation-gated or app-only in v1.
