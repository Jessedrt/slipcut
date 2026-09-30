import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearSportyCacheForTests, listUpcomingPicks, listDailyBasketballOverMarkets } from "./sportybet.ts";

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

const over = { id: "18", desc: "Over/Under", specifier: "total=1.5", status: 0, outcomes: [{ id: "over", desc: "Over 1.5", odds: "1.50", isActive: 1 }] };
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
      globalThis.fetch = async () => response([event("live", [over], { status: 1 })]);
      const stale = await listUpcomingPicks("football", 5, "upcoming");
      if (!Array.isArray(stale)) assert.equal(stale.code, "no_events");
    } finally { globalThis.fetch = original; }
  });

  it("accepts real football competitions outside the old strong-league allow-list", async () => {
    const original = globalThis.fetch;
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            bizCode: 10000,
            message: "0#0",
            data: {
              totalNum: 1,
              tournaments: [
                {
                  name: "World Cup Qualification CAF",
                  events: [
                    event("qualifier", [over], {
                      sport: {
                        id: "sr:sport:1",
                        name: "Football",
                        category: {
                          name: "International",
                          tournament: { name: "World Cup Qualification CAF" },
                        },
                      },
                    }),
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );

      const result = await listUpcomingPicks("football", 5, "upcoming");
      assert.equal(Array.isArray(result), true);
      if (Array.isArray(result)) assert.ok(result.length > 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("deduplicates repeated event and market rows", async () => {
    const original = globalThis.fetch;
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async () => response([event("same", [over, over]), event("same", [over])]);
      const result = await listUpcomingPicks("football", 5, "upcoming");
      assert.equal(Array.isArray(result), true);
      if (Array.isArray(result)) {
        assert.equal(new Set(result.map((pick) => pick.sporty?.eventId)).size, 1);
        assert.equal(new Set(result.map((pick) => pick.id)).size, result.length);
      }
    } finally { globalThis.fetch = original; }
  });

  it("hydrates a fixture from SportyBet event detail so additional score-Over markets can be considered", async () => {
    const original = globalThis.fetch;
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes("/factsCenter/event?")) {
          return new Response(
            JSON.stringify({
              bizCode: 10000,
              message: "0#0",
              data: event("full", [
                over,
                {
                  id: "999",
                  desc: "2nd Half Home Team Total 0.5",
                  specifier: "halfnr=2;total=0.5",
                  status: 0,
                  outcomes: [
                    { id: "over", desc: "Over 0.5", odds: "1.65", isActive: 1 },
                    { id: "under", desc: "Under 0.5", odds: "2.10", isActive: 1 },
                  ],
                },
              ]),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return response([event("full", [over])]);
      };

      const result = await listUpcomingPicks("football", 5, "upcoming");
      assert.equal(Array.isArray(result), true);
      if (Array.isArray(result)) {
        assert.ok(result.some((pick) => pick.sporty?.marketId === "999"));
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  it("requests a timeline feed for Today instead of the provider day shortcut", async () => {
    const original = globalThis.fetch;
    let requested = "";
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async (input) => {
        requested = String(input);
        return response([]);
      };
      await listUpcomingPicks("football", 5, "today");
      assert.match(requested, /todayGames=false/);
      assert.match(requested, /timeline=48/);
      assert.match(requested, /marketId=/);
    } finally { globalThis.fetch = original; }
  });

  for (const window of ["today", "tomorrow", "upcoming"] as const) {
    it(`discovers basketball ${window} independently across Lagos/UTC midnight`, async (t) => {
      const original = globalThis.fetch;
      t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T23:01:00Z") });
      const total = { ...over, id: "225", specifier: "total=162.5", outcomes: [{ id: "over", desc: "Over 162.5", odds: "1.60", isActive: 1 }] };
      const rows = [
        ["today", "2026-09-29T23:30:00Z"],
        ["tomorrow", "2026-09-30T23:30:00Z"],
        ["later", "2026-10-06T23:30:00Z"],
      ].map(([id, date]) => event(id!, [total], { estimateStartTime: Date.parse(date!),
        sport: { id: "sr:sport:2", name: "Basketball", category: { name: "USA", tournament: { name: "NBA" } } } }));
      const queries: URL[] = [];
      try {
        clearSportyCacheForTests();
        globalThis.fetch = async (input) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/event")) {
            const row = rows.find((r) => r.eventId === url.searchParams.get("eventId"));
            return Response.json({ bizCode: 10000, data: row });
          }
          queries.push(url);
          // Reproduces the live provider failure: successful empty Today shortcut.
          return Response.json({ bizCode: 10000, data: url.searchParams.get("todayGames") === "true"
            ? null : { totalNum: rows.length, tournaments: [{ name: "NBA", events: rows }] } });
        };
        const result = await listUpcomingPicks("basketball", 5, window);
        assert.ok(Array.isArray(result));
        assert.deepEqual([...new Set(result.map((p) => p.sporty?.eventId))].sort(),
          window === "today" ? ["today"] : window === "tomorrow" ? ["tomorrow"] : ["later", "today", "tomorrow"]);
        assert.equal(queries[0]!.searchParams.get("sportId"), "sr:sport:2");
        assert.equal(queries[0]!.searchParams.get("todayGames"), "false");
        assert.equal(queries[0]!.searchParams.get("timeline"), window === "today" ? "48" : window === "tomorrow" ? "72" : "720");
        assert.ok(result.every((p) => p.sport === "basketball" && p.selection.startsWith("Over")));
      } finally { globalThis.fetch = original; t.mock.timers.reset(); }
    });
  }

  it("daily basketball scanning also avoids the provider Today shortcut", async (t) => {
    const original = globalThis.fetch;
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T23:01:00Z") });
    try {
      clearSportyCacheForTests();
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        assert.equal(url.searchParams.get("todayGames"), "false");
        assert.equal(url.searchParams.get("sportId"), "sr:sport:2");
        const row = event("daily", [{ ...over, id: "225" }], {
          estimateStartTime: Date.parse("2026-09-29T23:30:00Z"),
          sport: { id: "sr:sport:2", name: "Basketball", category: { name: "USA", tournament: { name: "NBA" } } },
        });
        return Response.json({ bizCode: 10000, data: { totalNum: 1, tournaments: [{ name: "NBA", events: [row] }] } });
      };
      const result = await listDailyBasketballOverMarkets();
      assert.ok(Array.isArray(result));
      assert.equal(result[0]?.sporty?.eventId, "daily");
    } finally { globalThis.fetch = original; t.mock.timers.reset(); }
  });
});
