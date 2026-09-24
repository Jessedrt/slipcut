import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRecord, gradeRecommendations, gradeable, oddsBand, recordRecommendations, settleRecorded } from "./track-record.ts";
import { getEventDetail } from "./sportybet.ts";
import type { Sql } from "./db.ts";
import type { TicketPick } from "./types.ts";

function pick(id = "ev-1", marketId = "10", selection = "Home or Draw", odds = 1.5): TicketPick {
  return {
    id, sport: "football", home: "A", away: "B", league: "League",
    market: marketId === "10" ? "Double Chance" : "Over/Under 2.5",
    selection, odds, kickoff: Date.now() + 86_400_000,
    sporty: { eventId: id, marketId, outcomeId: "out-1", specifier: marketId === "18" ? "total=2.5" : undefined },
  };
}

describe("recommendation track record", () => {
  it("abstains on missing and thin data, compares the same sport and odds band", () => {
    const p = pick();
    assert.equal(evaluateRecord(p, { available: false, rows: [] }).status, "unavailable");
    assert.equal(evaluateRecord(p, { available: true, rows: [] }).status, "insufficient_history");
    assert.equal(oddsBand(1.49), "short");
    const rows = [
      { sport: "football", family: "dc", band: "medium", won: 10, lost: 20 },
      { sport: "football", family: "ou", band: "medium", won: 25, lost: 5 },
      { sport: "basketball", family: "dc", band: "medium", won: 100, lost: 0 },
    ];
    assert.equal(evaluateRecord(p, { available: true, rows }).status, "below_average");
    assert.equal(evaluateRecord(pick("x", "18", "Over", 1.5), { available: true, rows }).status, "qualified");
    assert.equal(evaluateRecord(pick("x", "10", "Home or Draw", 1.3), { available: true, rows }).status, "insufficient_history");
  });

  it("grades only clear full-time markets, excluding pushes and unsupported families", () => {
    assert.equal(settleRecorded(pick(), 1, 1), "won");
    assert.equal(settleRecorded(pick(), 0, 1), "lost");
    assert.equal(settleRecorded(pick("b", "18", "Under"), 2, 1), "lost");
    assert.equal(settleRecorded(pick("b", "18", "Over"), 1, 2), "won");
    assert.equal(settleRecorded({ ...pick("b", "18", "Over"), sporty: { eventId: "b", marketId: "18", outcomeId: "1", specifier: "total=2" } }, 1, 1), null);
    assert.equal(gradeable({ ...pick(), selection: "Unknown" }), false);
    assert.equal(gradeable({ ...pick(), market: "Corners", sporty: { eventId: "1", marketId: "90", outcomeId: "1" } }), false);
  });

  it("deduplicates recommendations and never stores stale events", async () => {
    const keys = new Set<string>();
    const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(parts.join("?"), /on conflict \(id\) do nothing/);
      const key = String(values[0]);
      if (keys.has(key)) return [];
      keys.add(key);
      return [{ id: key }];
    }) as Sql;
    assert.equal(await recordRecommendations([pick(), pick(), { ...pick("old"), kickoff: Date.now() - 1000 }], async () => sql, true), 1);
    assert.equal(keys.size, 1);
    assert.equal(await recordRecommendations([pick()], async () => sql, false), 0);
  });

  it("grades confirmed full-time scores but leaves unavailable scores pending", async () => {
    const updates: string[] = [];
    const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.join("?");
      if (query.includes("select id, event_id")) return [
        { id: "a", event_id: "ev-a", market_id: "10", outcome_id: "1", specifier: "", sport: "football", market: "Double Chance", selection: "Home or Draw", odds: 1.5, kickoff: Date.now() - 86_400_000 },
        { id: "b", event_id: "ev-b", market_id: "10", outcome_id: "1", specifier: "", sport: "football", market: "Double Chance", selection: "Home or Draw", odds: 1.5, kickoff: Date.now() - 86_400_000 },
      ];
      if (query.includes("set result =")) updates.push(String(values[0]));
      return [];
    }) as Sql;
    const detail = async (id: string) => id === "ev-a"
      ? ({ status: 2, setScore: "2:1", matchStatus: "FT" } as Awaited<ReturnType<typeof getEventDetail>>)
      : null;
    const result = await gradeRecommendations(async () => sql, detail, true);
    assert.deepEqual(result, { checked: 2, settled: 1 });
    assert.deepEqual(updates, ["won"]);
  });
});
