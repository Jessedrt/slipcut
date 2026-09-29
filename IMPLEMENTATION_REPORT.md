# SlipCut market-selection repair

Implemented and verified locally. Not pushed, merged or deployed.

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
