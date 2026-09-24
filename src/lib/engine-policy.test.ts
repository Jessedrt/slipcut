import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { engineMarketKind, enginePriceAllowed } from "./engine.ts";
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



  it("caps engine prices conservatively", () => {
    const firstHalfHigh = pick("68", "1st Half O/U 1.5", "Over 1.5");
    firstHalfHigh.odds = 1.87;
    assert.equal(enginePriceAllowed(firstHalfHigh), false);

    const firstHalfSafe = pick("68", "1st Half O/U 0.5", "Over 0.5");
    firstHalfSafe.odds = 1.38;
    assert.equal(enginePriceAllowed(firstHalfSafe), true);

    const fullTimeSafe = pick("18", "Over/Under 1.5", "Over 1.5");
    fullTimeSafe.odds = 1.52;
    assert.equal(enginePriceAllowed(fullTimeSafe), true);

    const fullTimeHigh = pick("18", "Over/Under 2.5", "Over 2.5");
    fullTimeHigh.odds = 1.72;
    assert.equal(enginePriceAllowed(fullTimeHigh), false);

    const belowFloor = pick("18", "Over/Under 1.5", "Over 1.5");
    belowFloor.odds = 1.19;
    assert.equal(enginePriceAllowed(belowFloor), false);
  });

  it("rejects handicaps, unders and second-half totals", () => {
    assert.equal(engineMarketKind(pick("16", "Asian Handicap -1.5", "Home (-1.5)")), null);
    assert.equal(engineMarketKind(pick("18", "Over/Under 2.5", "Under 2.5")), null);
    assert.equal(engineMarketKind(pick("62", "2nd Half O/U 1.5", "Over 1.5")), null);
  });
});
