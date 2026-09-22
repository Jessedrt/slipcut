# SlipCut deployment

Production tracks `main` on the Vercel **slipcut** project. Keep recovery PRs on Preview until tested and approved.

## Required Production environment variables

- `TELEGRAM_BOT_TOKEN`: the bot credential, stored as a sensitive environment variable.
- `DATABASE_URL`: a working **persistent PostgreSQL** connection string with the permissions needed by `migrations/`. Use a managed database and keep the URL secret. Configure the Vercel project, not just a local `.env` file.

The embedded PGLite fallback is only appropriate for local development. Production logs from September 22, 2026 show it trying to load a missing `/var/task/_libs/pglite.data` file when `DATABASE_URL` is absent. The webhook now responds with a clear 503 instead of acknowledging a request that it could not process. Other server routes may still require a correctly configured database.

## Webhook authentication

`npm run build` invokes `scripts/set-webhook.mjs`. It only registers the webhook when `VERCEL_ENV=production`, so Preview cannot redirect the live bot. Registration uses Telegram's `secret_token`, derived from the bot token using SHA-256; the webhook checks Telegram's `X-Telegram-Bot-Api-Secret-Token` header. No extra variable is required. Optionally set `TELEGRAM_WEBHOOK_SECRET` (1–256 ASCII letters, digits, `_` or `-`) for an explicit override; the build and runtime must use the same value. Do not publish either secret.

Deploy only after `npm run typecheck`, `npm run lint`, `npm test` and a Preview build pass. After Production deployment, test Telegram `/start`, loading a valid booking code, trimming and minting a new code with an authorized test account. A successful Preview homepage is **not** a bot or booking-code end-to-end test. Do not use real stakes for deployment tests.

Last previously shipped selection filter: `QUALITY_COOK_V4`. Do not assume the later Outcomes-refresh/mint enhancement was validated; it is not included in the recovery baseline.
