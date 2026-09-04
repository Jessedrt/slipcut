# SlipCut

Private desk for SportyBet tickets. Football, basketball and tennis.

Load a booking code, cut weak legs, then mint a **new SportyBet code** from the edited slip. Send it on Telegram.

- **Analyze** — market-anchored probability with live research on top
- **Split / trim / edit / combine / retarget markets**
- **Get SportyBet code** — books the working legs
- **Telegram** — share the code, or talk to the bot (`TELEGRAM_BOT_TOKEN`)

---

## How the desk thinks

A price on its own tells you nothing. Every number the bot prints goes through the
same pipeline (`src/lib/odds.ts`, `src/lib/analyze.ts`):

1. **Market prior.** The book's price is de-vigged — the modelled margin for that
   market family (3-way football runs ~11%, basketball totals ~6%) is stripped
   out to get the chance the book really believes it is offering.
2. **Research.** Gemini, Opus (SeekAI) and you.com each score the selection
   independently and return a probability *and* a fair price. A reading whose
   probability contradicts its own fair price is treated as low confidence.
3. **Ensemble.** The engines are averaged in log-odds space, weighted by
   confidence. How far apart they are becomes the disagreement score: when
   engines argue, the desk trusts them less.
4. **Blend.** The research is mixed into the market prior in log-odds space.
   The weight is the trust in the research — high confidence and agreement move
   the price a long way, low confidence barely moves it off the market.
5. **Calibration.** Every slip the desk mints is stored with what it believed,
   and graded when the slip is studied. A Platt scaler fitted on that history
   (`/calibration`) corrects systematic over- or under-confidence. A desk that
   has been calling 70% shots that land 55% automatically starts quoting tighter.

Everything downstream uses the same numbers:

- **Edge** = desk chance − chance the price implies. It is the only reason to bet.
- **EV** = expected return per ₦1. Negative EV is a tax, not a bet.
- **True slip chance** = the product of the legs, widened for correlation. Six
  legs from the same league on the same Saturday is one bet wearing six costumes.
- **Kelly** = fractional stake, haircut for leg count, capped so one slip can
  never hurt the bankroll.

## Commands

| Command | What it does |
| --- | --- |
| `/ev [code]` | Value read: market vs desk chance, edge and EV per leg, plus the whole slip |
| `/why [code] [n]` | Full reasoning on one leg (defaults to the weakest): reasons, risks, fair price, engine agreement |
| `/kelly 50000` | Quarter-Kelly stake for the last slip, against your bankroll |
| `/calibration` | Brier score and reliability buckets — how sharp the desk's numbers actually are |
| `/today`, `/weekend`, `/mix`, `/draw` | Cook a slip |
| `/stake`, `/daily2` | Daily 2-odds slips (Stake.com / SportyBet) |
| `/score` | Live scores for the last slip |
| `/study` | Settle the last slip and bank the lesson |
| `/book`, `/recap` | Slip history and this week |
| `/filter EPL` | Only certain leagues |
| `/lock`, `/grant`, `/who` | Private-desk access |

Plain talk works too, Pidgin included: `12 games football over 1.5`,
`cook 30 odds mix`, `trim am`, `comot game 3`, `e cut`, `stake 2000`, `score`.
You can also paste the slip as **text** (not just a code) and the desk will
score it and tell you what to cut.

## Env vars

Vercel → Settings → Environment Variables → Production, then Redeploy:

- `YDC_API_KEY` — You.com live search (add `YDC_API_KEY_2` for a second)
- `SEEKAI_API_KEY` — SeekAI Claude Opus reasoning
- `GEMINI_API_KEY` — Google Gemini reasoning
- `TELEGRAM_BOT_TOKEN` — the bot

You can also paste a key in Telegram (`/keys`). Vercel env is the reliable path.

Without any AI key the desk still works — it just quotes the de-vigged market
and says so. That is honest, but it means no edge: add a key to get one.

## Layout

| Path | What lives there |
| --- | --- |
| `src/lib/odds.ts` | Pure probability maths: de-vig, EV, Kelly, ensembles, calibration, correlation |
| `src/lib/optimizer.ts` | Slip construction: value ranking, concentration caps, target-price building, staking |
| `src/lib/settle.ts` | Settlement rules — scoreline to won/lost/void (pure, heavily tested) |
| `src/lib/analyze.ts` | Research orchestration and the market-anchored blend |
| `src/lib/research.ts` | Turns a SportyBet pool into a slip worth minting |
| `src/lib/study.ts` | Settle slips, record predictions, fit calibration, lessons |
| `src/lib/telegram.ts` | The bot: commands, keyboards, replies |
| `migrations/` | Schema. `0007_calibration.sql` adds the prediction log and webhook de-dupe |

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # 274 tests: platform scripts + the desk's pure logic
```

The reasoning, settlement and slip-building code is pure and unit tested, so a
change to the maths shows up as a failing test rather than a worse slip.
