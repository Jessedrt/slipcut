import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { engineMarketKind, enginePriceAllowed, selectDiversifiedEngineCard } from "./engine.ts";
import type { TicketPick } from "./types.ts";

function pick(marketId: string, market: string, selection: string): TicketPick {
  return {
    id: `${marketId}-${selection}`,
    sport: "football",
    league: "Premier League",
    home: "A",
    away: "B",
    market,
    selection,
    odds: 1.35,
    kickoff: Date.now() + 86_400_000,
    sporty: { eventId: "event", marketId, outcomeId: "out", specifier: "total=1.5" },
  };
}

describe("engine market policy", () => {
  it("keeps only the requested over families", () => {
    assert.equal(engineMarketKind(pick("68", "1st Half O/U 1.5", "Over 1.5")), "first_half_over");
    assert.equal(engineMarketKind(pick("227", "Home total 1.5", "Over 1.5")), "team_over");
    assert.equal(engineMarketKind(pick("228", "Away total 1.5", "Over 1.5")), "team_over");
    assert.equal(engineMarketKind(pick("18", "Over/Under 2.5", "Over 2.5")), "full_time_over");
    assert.equal(engineMarketKind(pick("225", "Over/Under 160.5", "Over 160.5")), "full_time_over");
  });

  it("enforces the shared Conservative band for engine cards", () => {
    for (const [odds, allowed] of [
      [1.19, false],
      [1.2, true],
      [1.4, true],
      [1.41, false],
      [1.55, false],
    ] as const) {
      assert.equal(
        enginePriceAllowed({ ...pick("18", "Over/Under 1.5", "Over 1.5"), odds }),
        allowed,
      );
    }
  });
  it("keeps evidence rank without artificial family quotas and deduplicates events", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...pick("18", "Over/Under 1.5", "Over 1.5"),
      id: `${i}`,
      sporty: { eventId: `${i}`, marketId: "18", outcomeId: "over", specifier: "total=1.5" },
    }));
    const result = selectDiversifiedEngineCard([rows[0]!, rows[0]!, ...rows.slice(1)], 5);
    assert.equal(result.length, 5);
    assert.deepEqual(result, rows.slice(0, 5));
  });
});
