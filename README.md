# SlipCut

Private desk for SportyBet tickets. Football and basketball only.

Load a booking code, cut weak legs, then mint a **new SportyBet code** from the edited slip. Send it on Telegram.

- **Analyze** — live form. Odds stored for size/EV, not used as the score
- **Split / trim / edit / combine**
- **Get SportyBet code** — books the working legs
- **Telegram** — share the code, or talk to the bot (`TELEGRAM_BOT_TOKEN`)

Env vars (Vercel → Settings → Environment Variables → Production, then Redeploy):

- `YDC_API_KEY` — You.com live search (add `YDC_API_KEY_2` for a second)
- `SEEKAI_API_KEY` — SeekAI Claude Opus reasoning
- `GEMINI_API_KEY` — Google Gemini reasoning
- `TELEGRAM_BOT_TOKEN` — the bot

You can also paste a key in Telegram (`/keys`). Vercel env is the reliable path.
