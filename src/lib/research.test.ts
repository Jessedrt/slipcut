import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cookablePick } from "./sportybet.ts";
import type { TicketPick } from "./types.ts";

function pick(partial: Partial<TicketPick> & Pick<TicketPick, "id" | "home" | "away" | "market" | "selection">): TicketPick {
  return { sport: "football", league: "", ...partial };
}

describe("football quality", () => {
  it("does not treat Southern Premier as Premier League", () => {
    const p = pick({
      id: "w",
      home: "Wimborne Town",
      away: "Bracknell Town FC",
      league: "England Southern Premier League South",
      market: "Draw No Bet",
      selection: "Home",
      odds: 1.59,
      kickoff: Date.now() + 3_600_000,
      sporty: { eventId: "4", marketId: "11", outcomeId: "1" },
    });
    assert.equal(cookablePick(p), false);
  });

  it("blocks live-style 1H team Over 0.5 and Spanish 4th tier", () => {
    assert.equal(
      cookablePick(
        pick({
          id: "q",
          home: "Al Arabi Doha SC",
          away: "Qatar SC",
          league: "Qatar Stars League",
          market: "1H home total 0.5",
          selection: "Over",
          odds: 1.44,
          kickoff: Date.now() + 3_600_000,
          sporty: { eventId: "6", marketId: "69", outcomeId: "1", specifier: "total=0.5" },
        }),
      ),
      false,
    );
    assert.equal(
      cookablePick(
        pick({
          id: "c",
          home: "Celtiga CF",
          away: "CD Boiro",
          league: "Spain Tercera Federacion",
          market: "Double Chance",
          selection: "Home or Draw",
          odds: 1.48,
          kickoff: Date.now() + 3_600_000,
          sporty: { eventId: "5", marketId: "10", outcomeId: "1" },
        }),
      ),
      false,
    );
  });

  it("keeps Serie A and La Liga full-time overs", () => {
    assert.equal(
      cookablePick(
        pick({
          id: "ok",
          home: "Lazio",
          away: "AC Milan",
          league: "Italy Serie A",
          market: "Over/Under 2.5",
          selection: "Over",
          odds: 1.72,
          kickoff: Date.now() + 6 * 3_600_000,
          sporty: { eventId: "9", marketId: "18", outcomeId: "1", specifier: "total=2.5" },
        }),
      ),
      true,
    );
    assert.equal(
      cookablePick(
        pick({
          id: "ok2",
          home: "Real Madrid",
          away: "Barcelona",
          league: "La Liga",
          market: "Over/Under 2.5",
          selection: "Over",
          odds: 1.7,
          kickoff: Date.now() + 6 * 3_600_000,
          sporty: { eventId: "10", marketId: "18", outcomeId: "1", specifier: "total=2.5" },
        }),
      ),
      true,
    );
  });
});
