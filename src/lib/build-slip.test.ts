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
    research: async <T extends TicketPick>(picks: T[]) => ({
      keep: picks.map((item) => ({ ...item, probability: 76 })) as T[],
      dropped: 0,
      researched: true,
      aiScoredIds: picks.map((item) => item.id),
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
  it("builds a football game-count slip and removes duplicate events", async () => {
    const rows = [pick(1), pick(2), pick(3), pick(4), pick(5), pick(6, 1.6, "18", "event-1")];
    const result = await buildSlip(base, deps(rows));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selections.length, 5);
    assert.equal(new Set(result.selections.map((item) => item.sporty?.eventId)).size, 5);
    assert.equal(result.analysis.rejected.duplicateEvents, 1);
    assert.equal(result.analysis.selected, 5);
  });

  it("builds basketball using the same service", async () => {
    const rows = [1, 2, 3].map((id) => ({
      ...pick(id, 1.55, "225"),
      sport: "basketball" as const,
      league: "Euroleague",
      market: "Over/Under 155.5",
      sporty: { eventId: `bb-${id}`, marketId: "225", outcomeId: "1", specifier: "total=155.5" },
    }));
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
      research: async (picks) => ({
        keep: picks.map((item) => ({ ...item, probability: 40 })),
        dropped: 0,
        researched: true,
        aiScoredIds: picks.map((item) => item.id),
      }),
    });
    assert.equal(result.ok, false);
  });

  it("labels a rule-only fallback honestly and does not expose an invented probability", async () => {
    const result = await buildSlip(
      { ...base, games: 2 },
      {
        discover: async () => [pick(1), pick(2)],
        research: async (picks) => ({
          keep: picks.map((item) => ({ ...item, probability: 95 })),
          dropped: 0,
          researched: false,
          aiScoredIds: [],
        }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.analysis.researched, 0);
    assert.equal(result.analysis.researchFallbackUsed, true);
    assert.equal(result.selections[0]?.analysisBasis, "market_rules");
    assert.match(result.selections[0]?.summary ?? "", /Market-only/);
    assert.equal(result.selections[0]?.probability, undefined);
    assert.notEqual(result.selections[0]?.modelScore, 95);
    assert.match(result.selections[0]?.risks[0] ?? "", /were independently verified/);
  });

  it("only marks picks whose AI score was actually returned as AI-assisted", async () => {
    const result = await buildSlip(
      { ...base, games: 2 },
      {
        discover: async () => [pick(1), pick(2)],
        research: async (picks) => ({
          keep: picks.map((item) => ({ ...item, probability: 80 })),
          dropped: 0,
          researched: true,
          aiScoredIds: [picks[0]!.id],
        }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.analysis.researched, 1);
    assert.equal(
      result.selections.filter((p) => p.analysisBasis === "ai_assisted_unverified").length,
      1,
    );
    assert.equal(result.selections.filter((p) => p.analysisBasis === "market_rules").length, 1);
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
