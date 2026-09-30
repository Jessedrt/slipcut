# SlipCut market-selection repair

Market-selection repair verified and pushed to main as `79141cd`. Deployment runtime was not independently verified.

## Previous behavior found

- Shared Conservative policy allowed 1.20–1.82, while football overrode it with 1.20–1.30.
- Balanced allowed 1.16–2.20, with a separate football floor of 1.35.
- AI instructions, Mini App descriptions and the daily scanner repeated conflicting ranges.
- An internal fallback approved markets from price and market shape without match history.
- Football discovery only admitted score Overs, excluding BTTS, corners and cards regardless of available data.
- Basketball construction and engine cards imposed artificial family rotation/quotas.
- Basketball target construction could return more than 15 legs even though booking rejected more than 15.
- Native market descriptions were rewritten in ways that could erase period, team and overtime scope.
- Booking failures discarded the upstream error message. Refresh comparisons omitted the line specifier.

## Backend policy

| Mode | Individual odds, inclusive | Minimum relevant results per team | Minimum exact-line hit rate | Minimum evidence score | Maximum coefficient of variation for numeric totals |
| --- | --- | --- | --- | --- | --- |
| Conservative | 1.20–1.40 | 10 | 80% | 75 | 0.25 |
| Balanced | 1.40–1.80 | 8 | 70% | 65 | 0.45 |

Median and trimmed mean must exceed an Over's actual line. Removing the two highest scores must preserve the mode's hit-rate threshold. At least three relevant home/away split results are required. These consistency checks can reject selections whose unadjusted hit rate meets the table.

The 1.40 boundary is intentionally allowed in both modes, as requested. Evidence criteria remain different. Historical hit rates and model scores are not calibrated win probabilities.

## Execution path

Both `/api/miniapp/build` and Telegram cooking call `buildSlip`. It discovers provider markets, applies canonical sport/market/odds rules, refreshes exact native selection identifiers, obtains historical evidence, evaluates every eligible line, ranks qualified options and deduplicates fixtures before accumulator construction.

Engine cards and the daily Over scanner now use the same evidence requirements. Engine cache version changed so old cards are not reused.

Custom target construction uses the existing deterministic nearest-target search for both sports, restricted to qualified events and the booking limit of 15 legs. The target is considered reasonably close within 5%; unattainable targets return the closest qualified result with an explanation. There is no threshold relaxation or manufactured filler.

## Markets

Football excludes Unders, straight home/away wins, 1X/X2 and home/away Draw No Bet, including aliases. Other single markets remain discoverable. Numeric goals/team totals, period totals, corners/cards, BTTS, draws and home-or-away can be evaluated when their exact evidence and settlement semantics are supported. Unknown market semantics are skipped.

Basketball admits only match/team score Overs for full games, halves and quarters. It rejects moneylines, winners, Unders, spreads, draw markets and unrelated player/other statistics. Team totals use the chosen team's scoring and the opponent's points allowed. Halves and quarters require their own period data. NCAA men's halves are not treated as quarters.

The provider's native description is retained. Canonical normalization is shared with normalized provider picks; backend eligibility recomputes it rather than trusting client metadata.

## Historical sources and limitations

A structured ESPN adapter maps supported leagues and exactly matched team names, loads current/prior-season schedules, and reads completed final scores. Period markets additionally require explicit summary line-scores. Unsupported league/team mappings remain unqualified unless source-corroborated research supplies enough data.

The existing You.com integration can supply additional candidate historical results, but a result must be corroborated against a readable trusted source excerpt containing both teams, the date, exact score pair and period. Missing/unreadable evidence is skipped. Provider outages have no heuristic approval fallback.

A live source check returned 84 published football score records for two teams. That check did not approve a bet, validate a specific live SportyBet fixture or mint a booking code. End-to-end selection/booking identity tests use mocked provider responses. No live Telegram session or real SportyBet code was verified in this workspace.

Remaining limitations:

- Statistical coverage varies by league, team-name mapping and source readability. Some valid markets will return insufficient data.
- Quarter-goal Asian lines, unknown props and unsupported settlement types are skipped until a matching evaluator exists.
- Injuries, pace, season ratings, rest and travel are not independently integrated; the result explicitly identifies these missing inputs.
- Corners/cards require exact sourced corner/card records; goal scores are never substituted.
- SportyBet rejection identifies the failed leg when native identifiers are supplied. If the provider omits that detail, the error says it did not identify the outcome.
- Current public provider endpoints can change or fail; validation fails closed.

## Booking

`mintReviewedSlip` refreshes the same fixture/market/outcome/specifier set, refuses substitutions and partial codes, rechecks generated picks' risk bands after a price change, and preserves provider errors. The Mini App retains risk metadata in its booking request. Existing manually imported slips retain their separate review flow; automatic selection restrictions do not silently rewrite them.

## Verification

- `npm test`: 160 script tests and 201 backend tests passed (361 total).
- `npm run typecheck`: passed.
- `npm run build:dev`: passed, producing the local Vercel/Nitro build.
- `git diff --check`: passed.
- The production build command was not run because it also migrates databases and sets Telegram webhooks.

Tests cover all requested Conservative/Balanced odds boundaries; blacklist aliases; all basketball period/team Over combinations; team offense/opponent defense; exact-line hits; outliers; missing/incorrect period evidence; weak samples; future/unconfirmed/duplicate history; same-fixture alternatives; custom targets 2/3/5/10/20/50; provider suspension/price changes; research timeout; full provider-discovery-to-booking identity flow; structured score objects; NCAA periods; and substitution prevention.

## Changed files

- `src/lib/selection-policy.ts` — central risk, canonical market and eligibility rules (new).
- `src/lib/selection-evidence.ts` — exact-scope statistical evaluation and corroborated research (new).
- `src/lib/espn-history.ts` — structured historical-score adapter (new).
- `src/lib/build-slip.ts` — backend discovery/validation/evidence/ranking/construction path.
- `src/lib/sportybet.ts` — broader eligible discovery, scope preservation and refresh validation.
- `src/lib/bookmakers/normalize.ts`, `src/lib/types.ts` — shared canonical market representation.
- `src/lib/build-ai.ts` — centralized instructions and removal of unsupported fallback approvals.
- `src/lib/book-slip.ts` — exact identity, risk-band and provider error checks.
- `src/lib/engine.ts`, `src/lib/daily-overs.ts` — eliminate parallel policy/evidence bypasses.
- `src/lib/telegram.ts`, `src/components/mini-app-refresh.tsx` — correct policy/evidence descriptions; no unrelated redesign.
- `src/lib/build-slip.test.ts`, `src/lib/build-ai.test.ts`, `src/lib/book-slip.test.ts`, `src/lib/engine-policy.test.ts`, `src/lib/daily-overs.test.ts` — regression coverage.

## Parse FlashScore integration

Added `src/lib/parse-flashscore.ts` and its six regression tests; updated the shared
`researchSelectionEvidence` execution path, `package.json` test list and README configuration.
Build and daily scanner both call this shared evidence path. Parse and ESPN research run
in parallel. A fixture must match sport, exact normalized teams, competition, country
when supplied and kickoff within 15 minutes. Ambiguous or non-upcoming fixtures are skipped.
The documented canonical scraper is `e4c11d5d-7c48-4a9d-9141-7abf0692ddcd`, overridable
with `PARSE_FLASHSCORE_SCRAPER_ID`. Authentication uses server-only `PARSE_API_KEY`.

`get_daily_fixtures` discovers real fixture IDs; `get_match_preview` supplies completed
score history. Current SportyBet odds/IDs are preserved. Duplicate, missing, conflicting,
future or explicitly unfinished results are rejected. A single source is chosen for an
assessment, so overlapping ESPN/FlashScore history is not counted twice. The existing
exact-line, outlier, sample-size and risk requirements still decide qualification.
Final scores do not justify halves, quarters, corners or cards. Basketball final scores
only support markets explicitly including overtime; unsupported scopes retain ESPN coverage.

Calls are limited to 12 new executions per build, cached per server instance (fixtures
5 minutes, previews 30 minutes), and bounded by a 25-second adapter deadline. Only the
next seven UTC dates are queried; unmatched names/competitions or timezone differences
may cause skips. Budget/deadline limits may leave some fixtures unchecked. There is no
new scoreboard UI or booking-code behavior.

Verification: 160 script tests + 207 backend tests = 367 passing; typecheck,
development build and diff whitespace check passed. Tests use documented response shapes
with mocked authentication, fixture mapping, caching, failure and scope cases. Public API
metadata was inspected, but `PARSE_API_KEY` is absent locally, so authenticated live
Parse calls and production runtime activation have not been verified.

## Basketball Today discovery repair — September 30, 2026

Root cause identified before editing: `listUpcomingPicks` sent
`todayGames=true` to `/api/ng/factsCenter/pcUpcomingEvents` for Today. At
2026-09-29 23:58 UTC (September 30 00:58 Africa/Lagos), SportyBet returned HTTP
200 / bizCode 10000 with no data. An otherwise identical basketball request
(`sportId=sr:sport:2`, `marketId=219,225`, timeline 48) with `todayGames=false`
returned 71 real fixtures, 54 on September 30 in Lagos. The sport ID and
`data.tournaments[].events[]` parser were correct. Zero occurred upstream of
league, market, statistics and Conservative/Balanced filtering. The provider's
internal reason for its empty Today shortcut is undocumented; the mismatch
with the application's Lagos day was demonstrated directly.

Changed only the provider day shortcut in builder discovery and the daily
basketball scanner to `false`. Existing local Lagos date filtering now decides
Today/Tomorrow, using 48/72-hour provider timelines respectively. Upcoming uses
its existing timeline. Corrected one stale football comment; no score-Over-only
restriction was restored. No UI or booking code changes, odds widening, new
league restrictions or statistical thresholds were introduced.

Live patched `listUpcomingPicks('basketball', 6, window)` checks on September 30
01:02 Lagos time, using real HTTP requests and event-detail hydration:

| Window | Parsed upstream fixtures | Fixtures in local window | Returned events in six-event check | Over market candidates |
| --- | ---: | ---: | ---: | ---: |
| Today | 71 | 54 | 6 | 566 |
| Tomorrow | 81 | 16 | 6 | 298 |
| Upcoming | 100 | 86 | 6 | 295 |

Each request returned HTTP 200/bizCode 10000. Today returned only September 30
Lagos kickoffs; Tomorrow returned only October 1 Lagos kickoffs. Every returned
candidate was basketball and passed the existing canonical Over-focused market
filter. Candidate counts precede risk/statistical qualification and do not imply
approved accumulator legs. Upcoming's existing single-page discovery parsed
100 of provider totalNum 129; pagination was outside this repair.

Added independent Today/Tomorrow/Upcoming regressions across Lagos/UTC midnight
and a daily-scanner regression. Replaced the old test requiring the broken
Today shortcut. Added a duplicate-preset invariant: current `[2,3,5,10,20]`
labels are unique and the target group is rendered once. No duplicate exists
in the current source; UI design was preserved.

Verification: 161 script tests + 211 backend tests = 372 passing. Typecheck,
development build and `git diff --check` passed. Changes: `src/lib/sportybet.ts`,
`src/lib/sportybet.discovery.test.ts`, `scripts/target-presets.test.mjs`, and
this report. Conservative remains 1.20–1.40 inclusive; Balanced remains
1.40–1.80 inclusive. Football canonical blacklist and basketball exact-scope
evidence requirements remain enforced by their existing backend tests.
