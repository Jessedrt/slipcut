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
# SlipCut recommendation track record

The Mini App Build flow still requires an AI review of each selected game. It
also consults a separate, persistent ledger of **actual pre-kickoff
recommendations**. Only unambiguous, full-time football double chance and
both-teams-to-score selections, and full-game football/basketball totals, are
currently gradeable from SportyBet's final score. Other markets remain
eligible under the existing analysis rules but cannot claim a verified record.

The ledger deduplicates the same event/market/outcome and does not record stale
events. The authenticated Build route records its returned recommendations,
even if the user later removes a leg or does not mint a booking code. The
existing `/api/cron/longshot` daily Vercel cron grades pending recommendations
after kickoff; it requires a configured `CRON_SECRET` and a matching Bearer
authorization header. The grader does not count unfinished games, scoreless
provider responses, pushes, or AET/penalty results as wins or losses.

The filter compares a market family's settled hit rate against the same
sport's **same-odds-band** baseline over the past 365 days. At least 60
comparable settled recommendations and 25 in the family are required before it
can exclude a below-average family. With less history, or without persistent
`DATABASE_URL` storage, the record is explicitly labelled insufficient or
unavailable and existing AI analysis still runs. Hit rates are not calibrated
win probabilities, proof of betting value, or guarantees. The older Telegram
Engine's manually studied-slip statistics are not imported into this ledger.
