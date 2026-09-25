import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateDailyOverPick } from "./daily-overs.ts";
import type { TicketPick } from "./types.ts";

function overPick(line: number, odds: number): TicketPick {
  return {
    id: `basketball-${line}`,
    sport: "basketball",
    league: "Euroleague",
    home: "Home",
    away: "Away",
    market: `Over/Under (incl. overtime) ${line}`,
    selection: `Over ${line}`,
    odds,
    kickoff: Date.now() + 3_600_000,
    sporty: {
      eventId: `event-basketball-${line}`,
      marketId: "225",
      outcomeId: "over",
      specifier: `total=${line}`,
    },
  };
}

describe("basketball daily H2H over evaluator", () => {
  it("qualifies an Over when H2H hit-rate and average cushion are strong enough", () => {
    const strong = evaluateDailyOverPick(
      overPick(159.5, 1.48),
      [170, 168, 180, 176, 165],
    );
    assert.ok(strong);
    assert.equal(strong?.sample, 5);
    assert.equal(strong?.h2hHitRate, 1);
    assert.equal(strong?.h2hAverage, 171.8);
  });

  it("rejects an Over when the average-total cushion is too small", () => {
    const weak = evaluateDailyOverPick(
      overPick(175.5, 1.5),
      [170, 168, 180, 176, 165],
    );
    assert.equal(weak, null);
  });

  it("treats whole-number pushes as non-hits", () => {
    const result = evaluateDailyOverPick(
      overPick(160, 1.38),
      [160, 168, 172, 160, 170],
    );
    assert.ok(result);
    assert.equal(result?.pushes, 2);
    assert.equal(result?.h2hHitRate, 0.6);
  });

  it("requires at least three verified H2H totals", () => {
    assert.equal(
      evaluateDailyOverPick(overPick(159.5, 1.45), [170, 168]),
      null,
    );
  });

  it("rejects prices outside the conservative scan band", () => {
    assert.equal(
      evaluateDailyOverPick(overPick(159.5, 1.19), [170, 168, 180, 176, 165]),
      null,
    );
    assert.equal(
      evaluateDailyOverPick(overPick(159.5, 1.9), [170, 168, 180, 176, 165]),
      null,
    );
  });
});
