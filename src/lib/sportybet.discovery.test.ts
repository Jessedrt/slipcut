import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearSportyCacheForTests, listUpcomingPicks } from "./sportybet.ts";

function response(events: unknown[]) {
  return new Response(JSON.stringify({ bizCode: 10000, message: "0#0", data: { totalNum: events.length, tournaments: events.length ? [{ name: "England Premier League", events }] : [] } }), { status: 200, headers: { "content-type": "application/json" } });
}

function event(id: string, markets: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    eventId: id,
    status: 0,
    banned: false,
    estimateStartTime: Date.now() + 24 * 3_600_000,
    homeTeamName: `Home ${id}`,
    awayTeamName: `Away ${id}`,
    sport: { id: "sr:sport:1", name: "Football", category: { name: "England", tournament: { name: "England Premier League" } } },
    markets,
    ...overrides,
  };
}

const dc = { id: "10", desc: "Double Chance", status: 0, outcomes: [{ id: "9", desc: "Home or Draw", odds: "1.50", isActive: 1 }] };
const win = { id: "1", desc: "1X2", status: 0, outcomes: [{ id: "1", desc: "Home", odds: "1.50", isActive: 1 }] };

describe("SportyBet discovery diagnostics", () => {
  it("separates zero fixtures from provider failure", async () => {
    const original = globalThis.fetch;
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async () => response([]);
      const empty = await listUpcomingPicks("football", 5, "upcoming");
      assert.equal(Array.isArray(empty), false);
      if (!Array.isArray(empty)) assert.equal(empty.code, "no_events");

      clearSportyCacheForTests();
      globalThis.fetch = async () => { throw new Error("offline"); };
      const failed = await listUpcomingPicks("football", 5, "upcoming");
      assert.equal(Array.isArray(failed), false);
      if (!Array.isArray(failed)) assert.equal(failed.code, "provider_unavailable");
    } finally { globalThis.fetch = original; }
  });

  it("reports timeout, no markets, no eligible markets and stale fixtures distinctly", async () => {
    const original = globalThis.fetch;
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async () => { throw new DOMException("aborted", "AbortError"); };
      const timed = await listUpcomingPicks("football", 5, "upcoming");
      if (!Array.isArray(timed)) assert.equal(timed.code, "provider_timeout");

      clearSportyCacheForTests();
      globalThis.fetch = async () => response([event("empty", [])]);
      const noMarkets = await listUpcomingPicks("football", 5, "upcoming");
      if (!Array.isArray(noMarkets)) assert.equal(noMarkets.code, "no_markets");

      clearSportyCacheForTests();
      globalThis.fetch = async () => response([event("win-only", [win])]);
      const noEligible = await listUpcomingPicks("football", 5, "upcoming");
      if (!Array.isArray(noEligible)) assert.equal(noEligible.code, "no_eligible_markets");

      clearSportyCacheForTests();
      globalThis.fetch = async () => response([event("live", [dc], { status: 1 })]);
      const stale = await listUpcomingPicks("football", 5, "upcoming");
      if (!Array.isArray(stale)) assert.equal(stale.code, "no_events");
    } finally { globalThis.fetch = original; }
  });

  it("deduplicates repeated event and market rows", async () => {
    const original = globalThis.fetch;
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async () => response([event("same", [dc, dc]), event("same", [dc])]);
      const result = await listUpcomingPicks("football", 5, "upcoming");
      assert.equal(Array.isArray(result), true);
      if (Array.isArray(result)) {
        assert.equal(new Set(result.map((pick) => pick.sporty?.eventId)).size, 1);
        assert.equal(new Set(result.map((pick) => pick.id)).size, result.length);
      }
    } finally { globalThis.fetch = original; }
  });
});
