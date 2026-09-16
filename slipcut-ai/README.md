# SlipCut AI

AI-powered Telegram assistant for football and basketball analysis, SportyBet market exploration, slip management, optimization, and supported booking-code preparation.

## Overview

Conversational product — not a command-only bot. Users speak naturally:

- "Give me 5 football games today"
- "Give me around 10 odds"
- "Remove the weakest two"
- "Split this ticket into 2"
- "Explore all markets for Arsenal vs Chelsea"
- "Analyze this SportyBet code"

## Features

- Natural-language intent (Zod + deterministic fallback; optional LLM)
- Game-count and target-odds optimization
- **Open market board** — all SportyBet markets from productId=3 are ingested
- Confidence / risk labels (no guarantees)
- Ticket edit, split, book-code load & mint
- Conversation memory per Telegram user
- Fastify health API + Telegraf bot
- Prisma schema, Docker Compose

## SportyBet (verified only)

See docs/SPORTYBET.md. Endpoints are browser-facing interfaces observed in production — **not invented**.

| Capability | Status |
|------------|--------|
| Fixtures list | Verified |
| Full event markets (open board) | Verified |
| Load share code | Verified |
| Mint share code | Verified |
| Auto-wager / deposits | **Not supported** |

## Commands

```bash
cp .env.example .env
npm install
npm run typecheck
npm test
npm run dev
```

Docker: `docker compose up --build`

Production: `npm run build && npm start`

## Safety

Never auto-submits wagers. Never stores bookmaker passwords. Odds may change after code creation.
