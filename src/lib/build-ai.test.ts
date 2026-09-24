import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBuildAIReviews, selectExistingAIScores } from "./build-ai.ts";
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
  it("maps compact game and option numbers to the supplied SportyBet identifiers", () => {
    const groups = [
      [option("long-provider-id-a", "event-a"), option("long-provider-id-b", "event-a")],
      [option("c", "event-b")],
    ];
    const reviews = parseBuildAIReviews(
      JSON.stringify({
        games: [
          {
            g: 1,
            o: 2,
            score: 74,
            summary: "Second option has the better market fit.",
            reasons: [],
            risks: [],
          },
          { g: 2, o: 1, score: 68, summary: "Eligible market.", reasons: [], risks: [] },
        ],
      }),
      groups,
    );
    assert.deepEqual(
      reviews.map((row) => row.pickId),
      ["long-provider-id-b", "c"],
    );
  });

  it("rejects out-of-range game and option numbers without substituting a market", () => {
    const groups = [[option("a", "event-a")]];
    assert.deepEqual(
      parseBuildAIReviews(
        JSON.stringify({
          games: [
            { g: 1, o: 2, score: 98, summary: "Not supplied" },
            { g: 2, o: 1, score: 88, summary: "Not supplied" },
          ],
        }),
        groups,
      ),
      [],
    );
  });
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

  it("uses the established AI scorer only when it returned a real structured explanation", () => {
    const groups = [[option("a", "event-a"), option("b", "event-a")], [option("c", "event-b")]];
    const scored = [
      {
        ...groups[0]![0]!,
        probability: 55,
        summary: "AI compared the two prices.",
        reasons: ["Market fit"],
        risks: ["Price may change"],
        confidence: "medium" as const,
        verdict: "keep" as const,
      },
      {
        ...groups[0]![1]!,
        probability: 78,
        summary: "AI preferred the second market.",
        reasons: ["Better line"],
        risks: [],
        confidence: "medium" as const,
        verdict: "keep" as const,
      },
      {
        ...groups[1]![0]!,
        probability: 50,
        summary: "Not enough to score this pick cleanly.",
        reasons: [],
        risks: [],
        confidence: "low" as const,
        verdict: "drop" as const,
      },
    ];
    assert.deepEqual(
      selectExistingAIScores(groups, scored).map((review) => review.pickId),
      ["b"],
    );
  });
});
