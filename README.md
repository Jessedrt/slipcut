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
- `PARSE_API_KEY` — optional server-side Parse key for FlashScore fixture/history checks
- `PARSE_FLASHSCORE_SCRAPER_ID` — optional canonical scraper override (defaults to `e4c11d5d-7c48-4a9d-9141-7abf0692ddcd`)

You can also paste a key in Telegram (`/keys`). Vercel env is the reliable path.

Keep the Parse key in server environment variables; it is not supported by Telegram `/keys`.
The adapter uses Parse's `get_daily_fixtures` and `get_match_preview` endpoints.
It matches both teams, competition, country when supplied, and kickoff within 15 minutes;
ambiguous, live, postponed or unmatched fixtures are skipped. Final-score history is
evaluated by the existing risk/evidence rules, with ESPN continuing to supply other
supported scopes. FlashScore final scores never substitute for half/quarter or
corner/card statistics. Basketball final scores are used only for markets explicitly
including overtime. SportyBet retains all selection identities and current odds.

Each build permits at most 12 new Parse requests, with 5-minute fixture caching,
30-minute history caching and a 25-second adapter deadline. Cache reuse is per server
instance; cold starts and separate instances can make new calls. Budget/time limits
may leave fixtures unchecked. Without `PARSE_API_KEY`, this optional source is disabled.
Endpoint contracts: [Parse quickstart](https://docs.parse.bot/quickstart) and
[FlashScore marketplace API](https://parse.bot/marketplace/463b4a3c-2c2a-4edb-9c14-d8df8d43eabe/flashscore-com-api).
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
