import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RISK_POLICIES,
  buildSlip,
  validateBuildRequest,
  type BuildDependencies,
  type BuildSlipRequest,
} from "./build-slip.ts";
import { basketballOptionAllowed, footballOptionAllowed } from "./sportybet.ts";
import type { TicketPick } from "./types.ts";

function pick(id: number, odds = 1.5, marketId = "10", eventId = `event-${id}`): TicketPick {
  const market =
    marketId === "10"
      ? "Double Chance"
      : marketId === "11"
        ? "Draw No Bet"
        : marketId === "29"
          ? "GG/NG"
          : marketId === "16"
            ? "Asian Handicap"
            : marketId === "26"
              ? "Odd/Even"
              : marketId === "45"
                ? "Correct Score"
                : "Over/Under 2.5";
  const selection =
    marketId === "29"
      ? "Yes"
      : marketId === "10"
        ? "Home or Away"
        : marketId === "11"
          ? "Home"
          : marketId === "16"
            ? "Home -0.5"
            : marketId === "26"
              ? "Odd"
              : marketId === "45"
                ? "1:0"
                : "Over 2.5";
  return {
    id: `${eventId}-${marketId}-${id}`,
    sport: "football",
    league: "England Premier League",
    country: "England",
    home: `Home ${id}`,
    away: `Away ${id}`,
    market,
    selection,
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

describe("football SportyBet option policy", () => {
  it("removes Home-or-Draw, Draw-or-Away and both Draw-No-Bet sides", () => {
    const homeDraw = { ...pick(1, 1.3, "10"), selection: "Home or Draw" };
    const drawAway = { ...pick(2, 1.3, "10"), selection: "Draw or Away" };
    const homeAway = { ...pick(3, 1.3, "10"), selection: "Home or Away" };
    const homeDnb = { ...pick(4, 1.3, "11"), selection: "Home" };
    const awayDnb = { ...pick(5, 1.3, "11"), selection: "Away" };

    assert.equal(footballOptionAllowed(homeDraw), false);
    assert.equal(footballOptionAllowed(drawAway), false);
    assert.equal(footballOptionAllowed(homeDnb), false);
    assert.equal(footballOptionAllowed(awayDnb), false);
    assert.equal(footballOptionAllowed(homeAway), true);
  });

  it("keeps other SportyBet football market types eligible", () => {
    assert.equal(footballOptionAllowed(pick(1, 1.4, "16")), true);
    assert.equal(footballOptionAllowed(pick(2, 1.4, "26")), true);
    assert.equal(footballOptionAllowed(pick(3, 1.4, "29")), true);
    assert.equal(footballOptionAllowed(pick(4, 1.4, "45")), true);
    assert.equal(footballOptionAllowed(pick(5, 1.4, "18")), true);
  });

  it("still respects the earlier no-Under and no-standard-1X2 rule", () => {
    const under = { ...pick(1, 1.4, "18"), selection: "Under 2.5" };
    const straight: TicketPick = {
      ...pick(2, 1.4, "1"),
      market: "1X2",
      selection: "Home",
      sporty: { eventId: "straight", marketId: "1", outcomeId: "1" },
    };
    assert.equal(footballOptionAllowed(under), false);
    assert.equal(footballOptionAllowed(straight), false);
  });
});

describe("basketball SportyBet option policy", () => {
  const bb = (
    id: string,
    market: string,
    selection: string,
    specifier = "",
  ): TicketPick => ({
    id: `bb-${id}-${selection}`,
    sport: "basketball",
    league: "Euroleague",
    home: "Home",
    away: "Away",
    market,
    selection,
    odds: 1.45,
    kickoff: Date.now() + 3_600_000,
    sporty: { eventId: `bb-${id}`, marketId: id, outcomeId: "o", specifier },
  });

  it("allows only basketball Over totals for full game, team, halves and quarters", () => {
    assert.equal(basketballOptionAllowed(bb("225", "Over/Under (incl. overtime) 164.5", "Over 164.5", "total=164.5")), true);
    assert.equal(basketballOptionAllowed(bb("227", "Home total 82.5", "Over 82.5", "total=82.5")), true);
    assert.equal(basketballOptionAllowed(bb("68", "1st Half Over/Under 81.5", "Over 81.5", "total=81.5")), true);
    assert.equal(basketballOptionAllowed(bb("236", "3rd Quarter Over/Under 40.5", "Over 40.5", "quarternr=3;total=40.5")), true);
    assert.equal(basketballOptionAllowed(bb("999", "2nd Half Home Team Total 39.5", "Over 39.5", "halfnr=2;total=39.5")), true);
  });

  it("removes basketball unders, winners, handicaps and other non-total markets", () => {
    assert.equal(basketballOptionAllowed(bb("225", "Over/Under 164.5", "Under 164.5", "total=164.5")), false);
    assert.equal(basketballOptionAllowed(bb("219", "Winner (incl. overtime)", "Home")), false);
    assert.equal(basketballOptionAllowed(bb("223", "Handicap", "Home -4.5", "hcp=-4.5")), false);
    assert.equal(basketballOptionAllowed(bb("8", "Odd/Even", "Odd")), false);
  });
});

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


  it("allows basketball team and period Overs in every risk mode", async () => {
    const rows: TicketPick[] = [
      {
        ...pick(1, 1.5, "225", "bb-main"),
        sport: "basketball",
        league: "Euroleague",
        market: "Over/Under 165.5",
        selection: "Over 165.5",
        sporty: { eventId: "bb-main", marketId: "225", outcomeId: "over", specifier: "total=165.5" },
      },
      {
        ...pick(2, 1.47, "227", "bb-team"),
        sport: "basketball",
        league: "Euroleague",
        market: "Home total 81.5",
        selection: "Over 81.5",
        sporty: { eventId: "bb-team", marketId: "227", outcomeId: "over", specifier: "total=81.5" },
      },
      {
        ...pick(3, 1.44, "236", "bb-quarter"),
        sport: "basketball",
        league: "Euroleague",
        market: "3rd Quarter Over/Under 40.5",
        selection: "Over 40.5",
        sporty: { eventId: "bb-quarter", marketId: "236", outcomeId: "over", specifier: "quarternr=3;total=40.5" },
      },
    ];

    for (const risk of ["conservative", "balanced", "aggressive"] as const) {
      let reviewedIds: string[] = [];
      const result = await buildSlip(
        { ...base, sport: "basketball", games: 3, risk },
        {
          ...deps(rows),
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
      assert.equal(result.ok, true);
      assert.ok(reviewedIds.includes(rows[0]!.id));
      assert.ok(reviewedIds.includes(rows[1]!.id));
      assert.ok(reviewedIds.includes(rows[2]!.id));
    }
  });

  it("never uses straight basketball Winner markets in any risk mode", async () => {
    const winner: TicketPick = {
      ...pick(1, 1.45, "219", "bb-win"),
      sport: "basketball",
      league: "Euroleague",
      market: "Winner (incl. overtime)",
      selection: "Home",
      sporty: { eventId: "bb-win", marketId: "219", outcomeId: "home" },
    };
    const totalA: TicketPick = {
      ...pick(2, 1.42, "225", "bb-total-a"),
      sport: "basketball",
      league: "Euroleague",
      market: "Over/Under 159.5",
      selection: "Over 159.5",
      sporty: {
        eventId: "bb-total-a",
        marketId: "225",
        outcomeId: "over",
        specifier: "total=159.5",
      },
    };
    const totalB: TicketPick = {
      ...pick(3, 1.5, "225", "bb-total-b"),
      sport: "basketball",
      league: "Euroleague",
      market: "Over/Under 164.5",
      selection: "Over 164.5",
      sporty: {
        eventId: "bb-total-b",
        marketId: "225",
        outcomeId: "over",
        specifier: "total=164.5",
      },
    };

    for (const risk of ["conservative", "balanced", "aggressive"] as const) {
      const result = await buildSlip(
        { ...base, sport: "basketball", games: 2, risk },
        deps([winner, totalA, totalB]),
      );
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.ok(result.selections.length >= 1);
      assert.ok(result.selections.every((row) => row.sporty?.marketId !== "219"));
      assert.ok(result.selections.every((row) => !/winner/i.test(row.market)));
    }
  });

  it("allows multiple qualified full-game basketball totals without Winner picks", async () => {
    const rows: TicketPick[] = [1, 2, 3].map((id) => ({
      ...pick(id, 1.4 + id * 0.04, "225", `bb-total-${id}`),
      sport: "basketball",
      league: "Euroleague",
      market: `Over/Under ${154.5 + id * 5}`,
      selection: `Over ${154.5 + id * 5}`,
      sporty: {
        eventId: `bb-total-${id}`,
        marketId: "225",
        outcomeId: "over",
        specifier: `total=${154.5 + id * 5}`,
      },
    }));

    const result = await buildSlip(
      { ...base, sport: "basketball", games: 3, risk: "conservative" },
      deps(rows),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.actualGames, 3);
    assert.ok(result.selections.every((row) => row.sporty?.marketId === "225"));
  });

  it("builds basketball using totals without requiring a straight winner", async () => {
    const rows: TicketPick[] = [
      {
        ...pick(1, 1.55, "225", "bb-total-a"),
        sport: "basketball",
        league: "Euroleague",
        market: "Over/Under 155.5",
        selection: "Over 155.5",
        sporty: { eventId: "bb-total-a", marketId: "225", outcomeId: "over", specifier: "total=155.5" },
      },
      {
        ...pick(2, 1.48, "225", "bb-total-b"),
        sport: "basketball",
        league: "Euroleague",
        market: "Over/Under 162.5",
        selection: "Over 162.5",
        sporty: { eventId: "bb-total-b", marketId: "225", outcomeId: "over", specifier: "total=162.5" },
      },
    ];
    const result = await buildSlip({ ...base, sport: "basketball", games: 2 }, deps(rows));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.actualGames, 2);
      assert.ok(result.selections.every((row) => row.sporty?.marketId === "225"));
    }
  });

  it("accepts custom target odds above 50", () => {
    const valid = validateBuildRequest({
      sport: "basketball",
      mode: "odds",
      targetOdds: 150,
      risk: "conservative",
      window: "today",
    });
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.value.targetOdds, 150);

    const tooHigh = validateBuildRequest({
      sport: "football",
      mode: "odds",
      targetOdds: 5001,
      risk: "conservative",
      window: "today",
    });
    assert.equal(tooHigh.ok, false);
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
    assert.match(result.notice ?? "", /did not add unsupported games/);
  });

  it("explains when one reviewed game cannot reach a large target", async () => {
    const result = await buildSlip({ ...base, mode: "odds", targetOdds: 500 }, deps([pick(1, 1.53)]));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.actualCombinedOdds, 1.53);
    assert.equal(result.analysis.qualifiedGames, 1);
    assert.match(result.notice ?? "", /Only 1 distinct game/);
    assert.match(result.notice ?? "", /Try Upcoming/);
  });


  it("never uses football Unders or straight 1X2 winners in any risk mode", async () => {
    const straightHome: TicketPick = {
      ...pick(1, 1.45, "1", "fb-home"),
      market: "1X2",
      selection: "Home",
      sporty: { eventId: "fb-home", marketId: "1", outcomeId: "home" },
    };
    const under: TicketPick = {
      ...pick(2, 1.42, "18", "fb-under"),
      market: "Over/Under 2.5",
      selection: "Under 2.5",
      sporty: {
        eventId: "fb-under",
        marketId: "18",
        outcomeId: "under",
        specifier: "total=2.5",
      },
    };
    const over: TicketPick = {
      ...pick(3, 1.38, "18", "fb-over"),
      market: "Over/Under 1.5",
      selection: "Over 1.5",
      sporty: {
        eventId: "fb-over",
        marketId: "18",
        outcomeId: "over",
        specifier: "total=1.5",
      },
    };
    const doubleChance: TicketPick = {
      ...pick(4, 1.3, "10", "fb-dc"),
      market: "Double Chance",
      selection: "Home or Away",
      sporty: {
        eventId: "fb-dc",
        marketId: "10",
        outcomeId: "12",
      },
    };

    for (const risk of ["conservative", "balanced", "aggressive"] as const) {
      const result = await buildSlip(
        { ...base, games: 2, risk },
        deps([straightHome, under, over, doubleChance]),
      );
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.ok(result.selections.every((row) => row.sporty?.marketId !== "1"));
      assert.ok(result.selections.every((row) => !/\bunder\b/i.test(row.selection)));
      assert.ok(result.selections.some((row) => /over/i.test(row.selection) || row.sporty?.marketId === "10"));
    }
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
        selection: "Over 1.5",
        sporty: { eventId, marketId: "18", outcomeId: "over15", specifier: "total=1.5" },
      },
      {
        ...pick(4, 1.46, "18", eventId),
        id: "event-wide-ou-25",
        market: "Over/Under 2.5",
        selection: "Over 2.5",
        sporty: { eventId, marketId: "18", outcomeId: "over25", specifier: "total=2.5" },
      },
      {
        ...pick(5, 1.38, "29", eventId),
        id: "event-wide-btts",
        market: "GG/NG",
        selection: "Yes",
        sporty: { eventId, marketId: "29", outcomeId: "yes" },
      },
      {
        ...pick(6, 1.55, "166", eventId),
        id: "event-wide-corners",
        market: "Corners 9.5",
        selection: "Over 9.5",
        sporty: { eventId, marketId: "166", outcomeId: "corners-over", specifier: "total=9.5" },
      },
      {
        ...pick(7, 1.6, "16", eventId),
        id: "event-wide-handicap",
        market: "Asian Handicap",
        selection: "Home -0.5",
        sporty: { eventId, marketId: "16", outcomeId: "home", specifier: "hcp=-0.5" },
      },
      {
        ...pick(8, 1.72, "45", eventId),
        id: "event-wide-correct-score",
        market: "Correct Score",
        selection: "1:0",
        sporty: { eventId, marketId: "45", outcomeId: "1:0" },
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
