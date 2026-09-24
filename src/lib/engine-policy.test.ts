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



  it("does not fill a card with one repeated market family", () => {
    const fullTime = Array.from({ length: 6 }, (_, index) => {
      const row = pick("18", `Over/Under ${1.5 + index * 0.5}`, `Over ${1.5 + index * 0.5}`);
      row.id = `ft-${index}`;
      row.sporty = {
        eventId: `event-ft-${index}`,
        marketId: "18",
        outcomeId: `out-${index}`,
        specifier: `total=${1.5 + index * 0.5}`,
      };
      return row;
    });

    const firstHalf = pick("68", "1st Half O/U 0.5", "Over 0.5");
    firstHalf.id = "fh";
    firstHalf.sporty = {
      eventId: "event-fh",
      marketId: "68",
      outcomeId: "fh-over",
      specifier: "total=0.5",
    };

    const selected = selectDiversifiedEngineCard([firstHalf, ...fullTime], 5);
    assert.equal(selected.length, 4);
  });

  it("mixes market families and limits repeated lines when enough options exist", () => {
    const rows: TicketPick[] = [];
    for (let index = 0; index < 4; index++) {
      const ft = pick("18", "Over/Under 1.5", "Over 1.5");
      ft.id = `ft-${index}`;
      ft.sporty = {
        eventId: `ft-event-${index}`,
        marketId: "18",
        outcomeId: `ft-out-${index}`,
        specifier: "total=1.5",
      };
      rows.push(ft);
    }

    for (let index = 0; index < 3; index++) {
      const fh = pick("68", "1st Half O/U 0.5", "Over 0.5");
      fh.id = `fh-${index}`;
      fh.sporty = {
        eventId: `fh-event-${index}`,
        marketId: "68",
        outcomeId: `fh-out-${index}`,
        specifier: "total=0.5",
      };
      rows.push(fh);
    }

    const team = pick("227", "Home total 0.5", "Over 0.5");
    team.id = "team-0";
    team.sporty = {
      eventId: "team-event-0",
      marketId: "227",
      outcomeId: "team-out-0",
      specifier: "total=0.5",
    };
    rows.push(team);

    const selected = selectDiversifiedEngineCard(rows, 5);
    assert.equal(selected.length, 5);
    const kinds = selected.map(engineMarketKind);
    assert.ok(new Set(kinds).size >= 2);
    const fullTimeCount = kinds.filter((kind) => kind === "full_time_over").length;
    assert.ok(fullTimeCount <= 3);
  });

  it("rejects handicaps, unders and second-half totals", () => {
    assert.equal(engineMarketKind(pick("16", "Asian Handicap -1.5", "Home (-1.5)")), null);
    assert.equal(engineMarketKind(pick("18", "Over/Under 2.5", "Under 2.5")), null);
    assert.equal(engineMarketKind(pick("62", "2nd Half O/U 1.5", "Over 1.5")), null);
  });
});
