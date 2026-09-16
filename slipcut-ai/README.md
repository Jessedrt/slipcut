# SlipCut AI

Conversational Telegram assistant for football and basketball analysis, SportyBet market exploration, slip management, optimization, and supported booking-code preparation.

## Stack

- Node.js + TypeScript
- Telegraf
- Zod
- Vitest

No Fastify, Prisma, Redis, or Docker in this package.

## Features

- Natural-language intent (Zod + deterministic fallback)
- Open SportyBet market board (`productId=3`)
- Game-count and target-odds optimization
- Ticket edit / split / load code / mint code
- In-memory conversation session per Telegram user

## SportyBet

See [docs/SPORTYBET.md](docs/SPORTYBET.md). Only verified browser-facing endpoints.

## Run

```bash
cp .env.example .env
# set TELEGRAM_BOT_TOKEN
npm install
npm test
npm run typecheck
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Safety

Never auto-submits wagers. Odds may change after code creation.
