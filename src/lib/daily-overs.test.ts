import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateDailyOverPick } from "./daily-overs.ts";
import type { TicketPick } from "./types.ts";

function overPick(
  sport: "football" | "basketball",
  line: number,
  odds: number,
): TicketPick {
  return {
    id: `${sport}-${line}`,
    sport,
    league: sport === "football" ? "Premier League" : "Euroleague",
    home: "Home",
    away: "Away",
    market:
      sport === "football"
        ? `Over/Under ${line}`
        : `Over/Under (incl. overtime) ${line}`,
    selection: `Over ${line}`,
    odds,
    kickoff: Date.now() + 3_600_000,
    sporty: {
      eventId: `event-${sport}-${line}`,
      marketId: sport === "football" ? "18" : "225",
      outcomeId: "over",
      specifier: `total=${line}`,
    },
  };
}

describe("daily H2H over evaluator", () => {
  it("qualifies a football Over only when H2H hit-rate and average cushion are strong enough", () => {
    const qualified = evaluateDailyOverPick(
      "football",
      overPick("football", 1.5, 1.42),
      [3, 2, 4, 3, 1],
    );
    assert.ok(qualified);
    assert.equal(qualified?.sample, 5);
    assert.equal(qualified?.h2hHitRate, 0.8);
    assert.ok((qualified?.h2hAverage ?? 0) > 2.5);

    const weakCushion = evaluateDailyOverPick(
      "football",
      overPick("football", 2.5, 1.55),
      [3, 2, 4, 3, 1],
    );
    assert.equal(weakCushion, null);
  });

  it("treats pushes as non-hits for whole-number Over lines", () => {
    const result = evaluateDailyOverPick(
      "football",
      overPick("football", 2, 1.38),
      [2, 3, 4, 2, 3],
    );
    assert.ok(result);
    assert.equal(result?.pushes, 2);
    assert.equal(result?.h2hHitRate, 0.6);
  });

  it("requires a larger points cushion for basketball totals", () => {
    const strong = evaluateDailyOverPick(
      "basketball",
      overPick("basketball", 159.5, 1.48),
      [170, 168, 180, 176, 165],
    );
    assert.ok(strong);
    assert.equal(strong?.h2hHitRate, 1);

    const weak = evaluateDailyOverPick(
      "basketball",
      overPick("basketball", 175.5, 1.5),
      [170, 168, 180, 176, 165],
    );
    assert.equal(weak, null);
  });

  it("rejects short or expensive prices outside the conservative scan band", () => {
    assert.equal(
      evaluateDailyOverPick(
        "football",
        overPick("football", 1.5, 1.19),
        [3, 3, 2, 4, 2],
      ),
      null,
    );
    assert.equal(
      evaluateDailyOverPick(
        "football",
        overPick("football", 1.5, 1.9),
        [3, 3, 2, 4, 2],
      ),
      null,
    );
  });
});
