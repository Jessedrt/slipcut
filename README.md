# SlipCut

Private desk for SportyBet tickets. Football and basketball only.

Load a booking code, cut weak legs, then mint a **new SportyBet code** from the edited slip. Send it on Telegram.

- **Analyze** — live form. Odds stored for size/EV, not used as the score
- **Split / trim / edit / combine**
- **Get SportyBet code** — books the working legs
- **Telegram** — share the code, or talk to the bot (`TELEGRAM_BOT_TOKEN`)

Env vars (Vercel):

- `YDC_API_KEY` — You.com, for analysis
- `TELEGRAM_BOT_TOKEN` — optional bot. Click Telegram in the header after adding it, then Redeploy.
