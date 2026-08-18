# Bingo — Telegram Mini App

A polished, mobile-first **multiplayer Bingo** game that runs inside Telegram. Players use **virtual Birr** (in-game balance only — no real money, no deposits, no withdrawals).

```
Telegram → Telegram Mini App → React + Vite → Vercel → Supabase
                                                    ├── PostgreSQL
                                                    ├── Realtime
                                                    └── Edge Functions
```

## Architecture

- **Frontend** is the interface only. It never decides winners, balances, numbers, or game state.
- **Supabase PostgreSQL** is authoritative for game state and balances.
- **Edge Functions** verify Telegram `initData`, join games, and verify Bingo claims.
- **pg_cron + SQL** draw numbers server-side every few seconds.
- **Realtime** broadcasts game events to every player simultaneously.

## Authentication flow

```
Telegram Bot
    ↓
Open Mini App (Telegram WebApp initData present)
    ↓
Verify initData server-side (HMAC with TELEGRAM_BOT_TOKEN)
    ↓
Create / find the account by telegram_user_id (idempotent — no duplicates)
    ↓
Bingo Home (no separate login page)
```

- The Mini App always runs inside Telegram, so `window.Telegram.WebApp.initData` is present and its HMAC is verified server-side with `TELEGRAM_BOT_TOKEN`.
- `telegram_user_id` is the permanent account identity. The username, first name, last name and photo are stored when available.
- A phone number is **not** required (Telegram Mini Apps do not expose it). If a phone is ever supplied it is stored in `users.phone`; an existing phone stays associated with the account.
- The same Telegram identity always resolves to the same account — no duplicates.
- `dev:<id>` authentication only works when the `DEV_AUTH_ENABLED=true` secret is set. It is disabled by default and must never be enabled in production.

## Project structure

```
bingo/
├── frontend/            React + Vite + TypeScript + Tailwind
├── supabase/
│   ├── migrations/      SQL schema, RLS, functions, cron
│   └── functions/       Edge Functions (Deno)
├── README.md
└── .gitignore
```

## Quick start

### 1. Supabase

1. Create a project at https://supabase.com
2. Enable the `pg_cron` extension (Database → Extensions) — the game loop depends on it.
3. Run the migrations in `supabase/migrations/` in order:
   - `0001_init.sql`
   - `0002_cron.sql`
   - `0003_phone_auth_and_fixes.sql`
   - `0004_game_states_and_loop.sql`
   - `0005_fix_rls_recursion.sql`
4. In Edge Function secrets, add:

```
TELEGRAM_BOT_TOKEN=<your bot token from BotFather>
JWT_SECRET=<JWT secret: Settings → API → JWT Settings>
MINI_APP_URL=https://bingo-telegram-bot.vercel.app
DEV_AUTH_ENABLED=false
```

> `JWT_SECRET` is used to sign short-lived auth tokens for your users
> (`SUPABASE_JWT_SECRET` is also accepted). Never put it in the frontend.
> `TELEGRAM_BOT_TOKEN` and `MINI_APP_URL` are server secrets too.

5. Deploy the Edge Functions:

```bash
supabase functions deploy telegram-auth --no-verify-jwt
supabase functions deploy quick-play --no-verify-jwt
supabase functions deploy join-room --no-verify-jwt
supabase functions deploy start-game --no-verify-jwt
supabase functions deploy claim-bingo --no-verify-jwt
supabase functions deploy tick --no-verify-jwt
supabase functions deploy telegram-bot --no-verify-jwt
```

> Edge Functions use `--no-verify-jwt` because they verify Telegram `initData`
> themselves and sign their own tokens. `create-room` is deployed but disabled:
> normal players can only **join** games, not create them.

### 2. Frontend

```bash
cd frontend
cp .env.example .env   # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TELEGRAM_BOT_USERNAME
npm install
npm run dev
```

Environment variables (frontend — public only):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_TELEGRAM_BOT_USERNAME=
```

### 3. Telegram bot

1. Create a bot with [BotFather](https://t.me/BotFather) (`@Habeshawibingobot` already exists — reuse it).
2. Set the bot description/about:

```
/setdescription — Join live multiplayer Bingo games inside Telegram. Press PLAY BINGO to start!
/setabouttext  — 🎱 Bingo — play live multiplayer Bingo with virtual Birr.
```

3. Point the webhook at the deployed `telegram-bot` function:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot"
```

4. In BotFather, set the Mini App button so pressing it opens the app:

```
/newapp   (or edit the existing app for the bot)
   Web App URL: https://bingo-telegram-bot.vercel.app/
```

The bot now replies to `/start` (or any message) with a welcome message and a
**🎱 PLAY BINGO** button that launches the Mini App.

## Game rules

- Every new user receives **1,000 Birr** (one-time `WELCOME_BONUS`).
- Quick Play: entry **10 Birr**, 2–50 players, auto-starts when 2 players join (a solo public game also auto-starts after 60s so it never stalls).
- Winner takes the full pot (`entry_fee × players`).
- Bingo card: 5×5, columns B(1–15) I(16–30) N(31–45) G(46–60) O(61–75), center FREE.
- Supported patterns: horizontal row, vertical column, main diagonal, anti-diagonal, four corners.
- Numbers (1–75) are drawn server-side, one every 3 seconds, never repeated.
- Bingo is evaluated server-side **after every draw** (continuous detection) and also on demand when the player presses BINGO.
- A winner ends the game in state `WON`; drawing all 75 numbers with no winner ends the game in state `COMPLETED` (no winner).

## Dev mode (local testing without Telegram)

Set `DEV_AUTH_ENABLED=true` as an Edge Function secret. The frontend will show a
dev login field when Telegram is not detected. This is **disabled by default** and
must never be enabled in production.

## Deploying to Vercel

The repo root is a monorepo (the app lives in `frontend/`). A root `vercel.json`
is included so Vercel builds `frontend/` and serves `frontend/dist`.

1. Push this repo to GitHub and import it in Vercel.
2. In Vercel → **Project Settings → Environment Variables**, add the three public vars:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT_USERNAME`.
3. Deploy, then point BotFather's Mini App URL at the `*.vercel.app` URL.
