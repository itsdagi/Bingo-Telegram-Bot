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
3. Run the migrations in `supabase/migrations/` (in order).
4. In Edge Functions secrets, add:

```
TELEGRAM_BOT_TOKEN=<your bot token from BotFather>
JWT_SECRET=<JWT secret: Settings → API → JWT Settings>
```

> `JWT_SECRET` is used to sign short-lived auth tokens for your users.
> (`SUPABASE_JWT_SECRET` is also accepted.) Never put it in the frontend.

5. Deploy the Edge Functions:

```bash
supabase functions deploy telegram-auth --no-verify-jwt
supabase functions deploy create-room --no-verify-jwt
supabase functions deploy join-room --no-verify-jwt
supabase functions deploy quick-play --no-verify-jwt
supabase functions deploy start-game --no-verify-jwt
supabase functions deploy claim-bingo --no-verify-jwt
supabase functions deploy tick --no-verify-jwt
```

> Edge Functions use `--no-verify-jwt` because they verify Telegram `initData`
> themselves and sign their own tokens.

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

1. Create a bot with [BotFather](https://t.me/BotFather).
2. Run `/newapp` and set the Mini App URL to your Vercel URL (`https://bingo.vercel.app`).
3. Open the bot in Telegram and press the app button.

## Game rules

- Every new user receives **1,000 Birr** (one-time `WELCOME_BONUS`).
- Quick Play: entry **10 Birr**, 2–50 players, auto-starts at 2 players.
- Rooms: creator picks entry (5/10/25/50 Birr), 2–50 players, creator starts.
- Winner takes the full pot (`entry_fee × players`).
- Bingo card: 5×5, columns B(1–15) I(16–30) N(31–45) G(46–60) O(61–75), center FREE.
- Supported patterns: horizontal, vertical, main diagonal, anti-diagonal.

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
