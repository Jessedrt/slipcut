import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBuildAIReviews } from "./build-ai.ts";
import type { TicketPick } from "./types.ts";

const option = (id: string, eventId: string): TicketPick => ({
  id,
  sport: "football",
  home: "Home",
  away: "Away",
  league: "Premier League",
  market: "Double Chance",
  selection: "Home or Draw",
  odds: 1.5,
  sporty: { eventId, marketId: "10", outcomeId: "1" },
});

describe("required AI market review", () => {
  it("accepts only real supplied outcomes for their matching event", () => {
    const groups = [[option("a", "event-a"), option("b", "event-a")], [option("c", "event-b")]];
    const reviews = parseBuildAIReviews(
      JSON.stringify({
        events: [
          {
            eventId: "event-a",
            pickId: "b",
            score: 74,
            summary: "B fits the price.",
            reasons: ["Eligible market"],
            risks: [],
          },
          { eventId: "event-b", pickId: "b", score: 98, summary: "Wrong event" },
          { eventId: "event-a", pickId: "a", score: 95, summary: "Duplicate event" },
          { eventId: "event-b", pickId: "invented", score: 99, summary: "Fabricated outcome" },
        ],
      }),
      groups,
    );
    assert.deepEqual(
      reviews.map((row) => row.pickId),
      ["b"],
    );
  });

  it("rejects malformed or missing scores instead of filling them in", () => {
    const groups = [[option("a", "event-a")]];
    for (const score of [null, "75", -1, 101]) {
      assert.deepEqual(
        parseBuildAIReviews(
          JSON.stringify({
            events: [{ eventId: "event-a", pickId: "a", score, summary: "Market fit" }],
          }),
          groups,
        ),
        [],
      );
    }
    assert.deepEqual(parseBuildAIReviews("not JSON", groups), []);
  });
});
