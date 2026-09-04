import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accuracyFilter, groupAllowed, type AccuracyStats } from "./accuracy-gate.ts";
import type { TicketPick } from "./types.ts";

function pick(sport: string, market: string, marketId: string): TicketPick {
  return {
    id: `${sport}-${marketId}`,
    sport,
    league: "EPL",
    home: "A",
    away: "B",
    market,
    selection: "Over 2.5",
    sporty: { eventId: "1", marketId, outcomeId: "1" },
  };
}

function stats(
  average = 0.5,
  sampleCount = 40,
  groups: AccuracyStats["groups"] = {},
): AccuracyStats {
  return { average, sampleCount, groups };
}

describe("accuracy-led engine gate", () => {
  it("always drops the win/1X2 family for football and basketball", () => {
    const s = stats(0.5, 40, {});
    assert.equal(groupAllowed("football", "win", s), false);
    assert.equal(groupAllowed("basketball", "win", s), false);
    assert.equal(groupAllowed("tennis", "win", s), true);
  });

  it("is permissive until the engine has enough settled history", () => {
    const s = stats(0.5, 3, {});
    assert.equal(groupAllowed("football", "ou", s), true);
    assert.equal(groupAllowed("football", "dc", s), true);
  });

  it("only keeps a group whose settled record beats the engine average", () => {
    // double chance at 0.8 beats 0.5 average -> allowed
    const s = stats(0.5, 40, {
      "football|dc": { won: 8, lost: 2, rate: 0.8 },
      "football|ou": { won: 2, lost: 8, rate: 0.2 },
    });
    assert.equal(groupAllowed("football", "dc", s), true);
    assert.equal(groupAllowed("football", "ou", s), false);
  });

  it("keeps a group with no record yet (not proven below average)", () => {
    const s = stats(0.5, 40, {});
    assert.equal(groupAllowed("football", "gg", s), true);
  });

  it("filters a pool to only allowed picks and reports the drop count", () => {
    const s = stats(0.5, 40, {
      "football|dc": { won: 8, lost: 2, rate: 0.8 },
      "football|ou": { won: 8, lost: 2, rate: 0.8 },
      "football|win": { won: 8, lost: 2, rate: 0.8 },
    });
    const picks = [
      pick("football", "Double Chance", "10"),
      pick("football", "Over/Under 2.5", "18"),
      pick("football", "1X2", "1"),
    ];
    const { kept, dropped } = accuracyFilter(picks, s);
    assert.equal(kept.length, 2);
    assert.equal(dropped, 1);
    // the dropped one is the win/1X2 family
    assert.equal(kept.some((p) => (p.sporty?.marketId ?? "") === "1"), false);
  });
});
