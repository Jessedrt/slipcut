import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RISK_POLICIES,
  buildSlip,
  validateBuildRequest,
  type BuildDependencies,
  type BuildSlipRequest,
} from "./build-slip.ts";
import type { TicketPick } from "./types.ts";

function pick(id: number, odds = 1.5, marketId = "10", eventId = `event-${id}`): TicketPick {
  return {
    id: `${eventId}-${marketId}-${id}`,
    sport: "football",
    league: "England Premier League",
    country: "England",
    home: `Home ${id}`,
    away: `Away ${id}`,
    market: marketId === "10" ? "Double Chance" : marketId === "29" ? "GG/NG" : "Over/Under 2.5",
    selection: marketId === "29" ? "Yes" : marketId === "10" ? "Home or Draw" : "Over",
    odds,
    kickoff: Date.now() + (id + 2) * 3_600_000,
    sporty: {
      eventId,
      marketId,
      outcomeId: "1",
      ...(marketId === "18" ? { specifier: "total=2.5" } : {}),
    },
  };
}

function deps(rows: TicketPick[]): BuildDependencies {
  return {
    discover: async () => rows,
    record: async () => ({ available: false, rows: [] }),
    review: async (picks) => ({
      reviews: [...new Map(picks.map((item) => [item.sporty?.eventId, item])).values()].map(
        (item) => ({
          pickId: item.id,
          score: 76,
          summary: "AI compared the eligible markets for this event.",
          reasons: ["Offered option fits the market rules."],
          risks: ["Market may change."],
        }),
      ),
      attemptedEvents: new Set(picks.map((item) => item.sporty?.eventId)).size,
      reviewedEvents: new Set(picks.map((item) => item.sporty?.eventId)).size,
    }),
  };
}

const base: BuildSlipRequest = {
  sport: "football",
  mode: "games",
  games: 5,
  risk: "conservative",
  window: "upcoming",
};

describe("buildSlip", () => {
  it("excludes historically below-average families only after comparable sample thresholds", async () => {
    const record = async () => ({ available: true, rows: [
      { sport: "football", family: "dc", band: "medium", won: 10, lost: 20 },
      { sport: "football", family: "ou", band: "medium", won: 25, lost: 5 },
    ] });
    const result = await buildSlip({ ...base, games: 2 }, {
      ...deps([pick(1), pick(2), pick(3, 1.5, "18")]), record,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.analysis.rejected.belowHistoricalAverage, 2);
    assert.equal(result.selections.length, 1);
    assert.equal(result.selections[0]?.trackRecord.status, "qualified");
  });
  it("builds a football game-count slip and removes duplicate events", async () => {
    const rows = [pick(1), pick(2), pick(3), pick(4), pick(5), pick(6, 1.6, "18", "event-1")];
    const result = await buildSlip(base, deps(rows));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selections.length, 5);
    assert.equal(new Set(result.selections.map((item) => item.sporty?.eventId)).size, 5);
    assert.equal(result.analysis.rejected.duplicateEvents, 0);
    assert.equal(result.analysis.selected, 5);
  });


  it("keeps basketball team totals out of conservative and balanced builds", async () => {
    const gameTotal: TicketPick = {
      ...pick(1, 1.5, "225", "bb-main"),
      sport: "basketball",
      league: "Euroleague",
      market: "Over/Under 165.5",
      selection: "Over",
      sporty: { eventId: "bb-main", marketId: "225", outcomeId: "over", specifier: "total=165.5" },
    };
    const teamTotal: TicketPick = {
      ...pick(2, 1.47, "227", "bb-team"),
      sport: "basketball",
      league: "Euroleague",
      market: "Home total 61.5",
      selection: "Over",
      sporty: { eventId: "bb-team", marketId: "227", outcomeId: "over", specifier: "total=61.5" },
    };

    for (const risk of ["conservative", "balanced"] as const) {
      let reviewedIds: string[] = [];
      const result = await buildSlip(
        { ...base, sport: "basketball", games: 2, risk },
        {
          ...deps([gameTotal, teamTotal]),
          review: async (picks) => {
            reviewedIds = picks.map((row) => row.id);
            return {
              reviews: picks.map((row) => ({
                pickId: row.id,
                score: 80,
                summary: "Reviewed.",
                reasons: [],
                risks: [],
              })),
              attemptedEvents: new Set(picks.map((row) => row.sporty?.eventId)).size,
              reviewedEvents: new Set(picks.map((row) => row.sporty?.eventId)).size,
            };
          },
        },
      );
      assert.ok(!reviewedIds.includes(teamTotal.id));
      assert.ok(reviewedIds.includes(gameTotal.id));
      assert.equal(result.ok, true);
    }

    let aggressiveIds: string[] = [];
    await buildSlip(
      { ...base, sport: "basketball", games: 2, risk: "aggressive" },
      {
        ...deps([gameTotal, teamTotal]),
        review: async (picks) => {
          aggressiveIds = picks.map((row) => row.id);
          return {
            reviews: picks.map((row) => ({
              pickId: row.id,
              score: 80,
              summary: "Reviewed.",
              reasons: [],
              risks: [],
            })),
            attemptedEvents: new Set(picks.map((row) => row.sporty?.eventId)).size,
            reviewedEvents: new Set(picks.map((row) => row.sporty?.eventId)).size,
          };
        },
      },
    );
    assert.ok(aggressiveIds.includes(teamTotal.id));
  });


  it("does not pad a basketball card with Winner markets", async () => {
    const rows: TicketPick[] = [];
    for (let id = 1; id <= 6; id++) {
      rows.push({
        ...pick(id, 1.4 + id * 0.01, "219", `bb-win-${id}`),
        sport: "basketball",
        league: "Euroleague",
        market: "Winner (incl. overtime)",
        selection: "Home",
        sporty: {
          eventId: `bb-win-${id}`,
          marketId: "219",
          outcomeId: "home",
        },
      });
    }
    for (let id = 1; id <= 4; id++) {
      rows.push({
        ...pick(20 + id, 1.32 + id * 0.02, "225", `bb-ou-${id}`),
        sport: "basketball",
        league: "Euroleague",
        market: "Over/Under (incl. overtime) 159.5",
        selection: "Over 159.5",
        sporty: {
          eventId: `bb-ou-${id}`,
          marketId: "225",
          outcomeId: "over",
          specifier: "total=159.5",
        },
      });
    }

    const result = await buildSlip(
      { ...base, sport: "basketball", games: 8, risk: "conservative" },
      deps(rows),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const winnerCount = result.selections.filter(
      (row) => row.sporty?.marketId === "219",
    ).length;
    const totalCount = result.selections.filter(
      (row) => row.sporty?.marketId === "225",
    ).length;
    assert.ok(result.selections.length >= 2);
    assert.ok(winnerCount <= Math.ceil(result.selections.length / 2));
    assert.ok(totalCount > 0);
  });

  it("returns fewer basketball legs instead of issuing a single-family card", async () => {
    const winners: TicketPick[] = [1, 2, 3, 4, 5].map((id) => ({
      ...pick(id, 1.4, "219", `bb-only-${id}`),
      sport: "basketball",
      league: "Euroleague",
      market: "Winner (incl. overtime)",
      selection: "Home",
      sporty: {
        eventId: `bb-only-${id}`,
        marketId: "219",
        outcomeId: "home",
      },
    }));

    const result = await buildSlip(
      { ...base, sport: "basketball", games: 5, risk: "conservative" },
      deps(winners),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selections.length, 1);
    assert.match(result.notice ?? "", /market-diversity/i);
  });

  it("builds basketball using the same service", async () => {
    const rows: TicketPick[] = [
      {
        ...pick(1, 1.55, "225", "bb-total"),
        sport: "basketball",
        league: "Euroleague",
        market: "Over/Under 155.5",
        selection: "Over 155.5",
        sporty: { eventId: "bb-total", marketId: "225", outcomeId: "over", specifier: "total=155.5" },
      },
      {
        ...pick(2, 1.45, "219", "bb-win"),
        sport: "basketball",
        league: "Euroleague",
        market: "Winner (incl. overtime)",
        selection: "Home",
        sporty: { eventId: "bb-win", marketId: "219", outcomeId: "home" },
      },
    ];
    const result = await buildSlip({ ...base, sport: "basketball", games: 2 }, deps(rows));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.actualGames, 2);
  });

  it("builds toward target odds without adding unsupported legs", async () => {
    const result = await buildSlip(
      { ...base, mode: "odds", targetOdds: 3 },
      deps([pick(1, 1.5), pick(2, 1.6), pick(3, 1.7)]),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok((result.actualCombinedOdds ?? 0) >= 2.4);
    assert.ok(result.selections.length <= 3);
  });

  it("returns the lower actual odds when the target cannot be reached", async () => {
    const result = await buildSlip(
      { ...base, mode: "odds", targetOdds: 10 },
      deps([pick(1, 1.3), pick(2, 1.3)]),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.targetReached, false);
    assert.match(result.notice ?? "", /No unsupported leg was added/);
  });


  it("uses 1.20 as the conservative minimum odds", async () => {
    assert.equal(RISK_POLICIES.conservative.minOdds, 1.2);
    const allowed = await buildSlip(
      { ...base, games: 2 },
      deps([pick(1, 1.2), pick(2, 1.21)]),
    );
    assert.equal(allowed.ok, true);

    const tooShort = await buildSlip(
      { ...base, games: 2 },
      deps([pick(1, 1.19), pick(2, 1.19)]),
    );
    assert.equal(tooShort.ok, false);
    if (!tooShort.ok) assert.equal(tooShort.code, "no_eligible_markets");
  });

  it("reviews more than three market options from the same event", async () => {
    const eventId = "event-wide";
    const rows: TicketPick[] = [
      pick(1, 1.32, "10", eventId),
      { ...pick(2, 1.34, "11", eventId), market: "Draw No Bet", selection: "Home" },
      {
        ...pick(3, 1.28, "18", eventId),
        id: "event-wide-ou-15",
        market: "Over/Under 1.5",
        selection: "Over",
        sporty: { eventId, marketId: "18", outcomeId: "over15", specifier: "total=1.5" },
      },
      {
        ...pick(4, 1.46, "18", eventId),
        id: "event-wide-ou-25",
        market: "Over/Under 2.5",
        selection: "Over",
        sporty: { eventId, marketId: "18", outcomeId: "over25", specifier: "total=2.5" },
      },
      {
        ...pick(5, 1.38, "18", eventId),
        id: "event-wide-under-35",
        market: "Over/Under 3.5",
        selection: "Under",
        sporty: { eventId, marketId: "18", outcomeId: "under35", specifier: "total=3.5" },
      },
      {
        ...pick(6, 1.55, "166", eventId),
        id: "event-wide-corners",
        market: "Corners 9.5",
        selection: "Over",
        sporty: { eventId, marketId: "166", outcomeId: "corners-over", specifier: "total=9.5" },
      },
    ];

    let reviewed = 0;
    const result = await buildSlip(
      { ...base, games: 2 },
      {
        discover: async () => rows,
        record: async () => ({ available: false, rows: [] }),
        review: async (picks) => {
          reviewed = picks.length;
          return {
            reviews: [{
              pickId: picks[0]!.id,
              score: 80,
              summary: "Compared the wider market set.",
              reasons: [],
              risks: [],
            }],
            attemptedEvents: 1,
            reviewedEvents: 1,
          };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.ok(reviewed >= 5);
    if (result.ok) assert.equal(result.analysis.marketOptionsReviewed, reviewed);
  });

  it("documents distinct risk policies and aggressive accepts a wider price", async () => {
    assert.ok(RISK_POLICIES.conservative.maxOdds < RISK_POLICIES.balanced.maxOdds);
    assert.ok(RISK_POLICIES.balanced.maxOdds < RISK_POLICIES.aggressive.maxOdds);
    const risky = pick(1, 2.5, "18");
    const conservative = await buildSlip(base, deps([risky]));
    const aggressive = await buildSlip(
      { ...base, games: 2, risk: "aggressive" },
      deps([risky, pick(2, 2.4, "18")]),
    );
    assert.equal(conservative.ok, false);
    assert.equal(aggressive.ok, true);
  });

  it("preserves structured discovery failures", async () => {
    const result = await buildSlip(base, {
      ...deps([]),
      discover: async () => ({ error: "timeout", code: "provider_timeout", retryable: true }),
    });
    assert.deepEqual(result, {
      ok: false,
      error: "timeout",
      code: "provider_timeout",
      retryable: true,
    });
  });

  it("reports risk and score rejection diagnostics without weakening filters", async () => {
    const highPrice = pick(1, 2.4, "18");
    const weak = pick(2, 1.5);
    const result = await buildSlip(base, {
      discover: async () => [highPrice, weak],
      review: async (picks) => ({
        reviews: [
          {
            pickId: picks[0]!.id,
            score: 20,
            summary: "AI reviewed the market.",
            reasons: [],
            risks: [],
          },
        ],
        attemptedEvents: 1,
        reviewedEvents: 1,
      }),
    });
    assert.equal(result.ok, false);
  });

  it("does not build a rule-only slip when AI is unavailable", async () => {
    const result = await buildSlip(
      { ...base, games: 2 },
      {
        discover: async () => [pick(1), pick(2)],
        review: async () => {
          throw new Error("AI unavailable");
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "analysis_failed");
  });

  it("does not substitute rule-ranked games when AI omits every event", async () => {
    const result = await buildSlip(base, {
      discover: async () => [pick(1), pick(2)],
      review: async () => ({ reviews: [], attemptedEvents: 2, reviewedEvents: 0 }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "analysis_failed");
  });

  it("returns a controlled error if AI analysis times out", async () => {
    const result = await buildSlip(base, {
      discover: async () => [pick(1)],
      review: async () => new Promise(() => {}),
      analysisTimeoutMs: 5,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "analysis_failed");
      assert.match(result.error, /too long/);
    }
  });

  it("excludes games that AI did not review and never fills requested count with rules", async () => {
    const result = await buildSlip(
      { ...base, games: 2 },
      {
        discover: async () => [pick(1), pick(2)],
        review: async (picks) => ({
          reviews: [
            {
              pickId: picks[0]!.id,
              score: 80,
              summary: "AI compared choices.",
              reasons: [],
              risks: [],
            },
          ],
          attemptedEvents: 2,
          reviewedEvents: 1,
        }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.analysis.researched, 1);
    assert.equal(result.actualGames, 1);
    assert.equal(result.analysis.rejected.notReviewedByAI, 1);
    assert.ok(result.selections.every((p) => p.analysisBasis === "ai_assisted_unverified"));
    assert.match(result.notice ?? "", /only 1 passed/);
  });

  it("allows AI to select a different eligible market within the same event", async () => {
    const first = pick(1, 1.5, "10");
    const alternate = pick(2, 1.6, "18", "event-1");
    const result = await buildSlip(
      { ...base, games: 2 },
      {
        discover: async () => [first, alternate, pick(3)],
        review: async (picks) => {
          assert.ok(picks.some((item) => item.id === first.id));
          assert.ok(picks.some((item) => item.id === alternate.id));
          return {
            reviews: [alternate, pick(3)].map((item) => ({
              pickId: item.id,
              score: 85,
              summary: "Compared eligible options.",
              reasons: [],
              risks: [],
            })),
            attemptedEvents: 2,
            reviewedEvents: 2,
          };
        },
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.ok(result.selections.some((item) => item.id === alternate.id));
  });
});

describe("build request validation", () => {
  it("rejects zero and large game counts", () => {
    assert.equal(validateBuildRequest({ ...base, games: 0 }).ok, false);
    assert.equal(validateBuildRequest({ ...base, games: 16 }).ok, false);
  });
  it("accepts the supported game-count and target-odds shapes", () => {
    assert.equal(validateBuildRequest(base).ok, true);
    assert.equal(
      validateBuildRequest({ ...base, mode: "odds", targetOdds: 5, games: undefined }).ok,
      true,
    );
  });
});
