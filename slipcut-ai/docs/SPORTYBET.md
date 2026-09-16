# SportyBet integration findings (verified)

**Do not invent endpoints.** These were observed from SportyBet browser-facing traffic and the existing SlipCut production adapter.

## Base

- Host: `https://www.sportybet.com`
- Country path segment: `ng` (also `gh`, `ke`, `za`, …)
- Headers used by the web client:
  - `Accept: application/json`
  - `Clientid: web`
  - `OperId: 2`
  - `Platform: web`
  - `User-Agent: Mozilla/5.0 …`

## Fixtures (thumbnail list)

```
GET /api/{country}/factsCenter/commonThumbnailEvents?sportId={sportId}
```

- Football: `sr:sport:1`
- Basketball: `sr:sport:2`
- Response `bizCode === 10000` on success
- `data[]` = tournaments with `name`, `events[]` (`eventId`, teams, `estimateStartTime`, `status`)

## Event + markets

```
GET /api/{country}/factsCenter/event?eventId={eventId}&productId=3
```

- Returns event detail including `markets[]` with `id`, `desc`, `specifier`, `outcomes[]` (`id`, `desc`, `odds`)
- **All markets returned by this endpoint are ingested** — no hardcoded allowlist of market families in the explorer path.

## Load booking / share code

```
GET /api/{country}/orders/share/{code}
```

- Try preferred country then fallbacks (`ng`, `gh`, `ke`, …)

## Create share / booking code

```
POST /api/{country}/orders/share
Content-Type: application/json

{
  "selections": [
    { "eventId", "marketId", "outcomeId", "specifier?" }
  ]
}
```

- Success: `bizCode === 10000` and `data.shareCode`
- Share URL pattern: `https://www.sportybet.com/{country}/?shareCode={code}`

## Verified capabilities

| Feature | Status |
|---------|--------|
| List football fixtures | Working (when not geo/WAF blocked) |
| List basketball fixtures | Working |
| Event markets (open board) | Working — full market list from productId=3 |
| Load share code | Working |
| Mint share code | Working |
| Auto-place wager | **Not implemented / not supported** — user stays in control |
| Deposits / withdrawals | **Not implemented** |

## Notes

- Some environments receive HTTP 403 from SportyBet (WAF/geo). Production servers that previously worked should keep working; local probes may fail.
- Odds must be refreshed before minting a code.
- Suspended / missing markets must be surfaced to the user with alternatives.
