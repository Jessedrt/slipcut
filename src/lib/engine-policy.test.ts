import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { engineMarketKind, enginePriceAllowed, selectDiversifiedEngineCard } from "./engine.ts";
import type { TicketPick } from "./types.ts";

function pick(marketId: string, market: string, selection: string): TicketPick {
  return {
    id: `${marketId}-${selection}`,
    sport: "football",
    league: "Premier League",
    home: "A",
    away: "B",
    market,
    selection,
    odds: 1.35,
    kickoff: Date.now() + 86_400_000,
    sporty: { eventId: "event", marketId, outcomeId: "out", specifier: `total=${selection.match(/Over ([0-9.]+)/)?.[1] ?? "1.5"}` },
  };
}

describe("engine market policy", () => {
  it("classifies allowed exact-scope Over families", () => {
    assert.equal(engineMarketKind(pick("68", "1st Half O/U 1.5", "Over 1.5")), "first_half_over");
    assert.equal(engineMarketKind(pick("227", "Home total 1.5", "Over 1.5")), "team_over");
    assert.equal(engineMarketKind(pick("228", "Away total 1.5", "Over 1.5")), "team_over");
    assert.equal(engineMarketKind(pick("18", "Over/Under 2.5", "Over 2.5")), "full_time_over");
    assert.equal(engineMarketKind(pick("225", "Over/Under 160.5", "Over 160.5")), "full_time_over");
  });

  it("enforces the shared Conservative band for engine cards", () => {
    for (const [odds, allowed] of [
      [1.19, false],
      [1.2, true],
      [1.4, true],
      [1.41, false],
      [1.55, false],
    ] as const) {
      assert.equal(
        enginePriceAllowed({ ...pick("18", "Over/Under 1.5", "Over 1.5"), odds }),
        allowed,
      );
    }
  });
  it("keeps evidence rank without artificial family quotas and deduplicates events", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...pick("18", "Over/Under 1.5", "Over 1.5"),
      id: `${i}`,
      sporty: { eventId: `${i}`, marketId: "18", outcomeId: "over", specifier: "total=1.5" },
    }));
    const result = selectDiversifiedEngineCard([rows[0]!, rows[0]!, ...rows.slice(1)], 5);
    assert.equal(result.length, 5);
    assert.deepEqual(result, rows.slice(0, 5));
  });
});

it("diversifies equal evidence markets and cards without demoting stronger evidence", () => {
  const row = (id: string, score: number, btts = false) => ({ ...pick(btts ? "29" : "18", btts ? "Both Teams To Score" : "Over/Under 1.5", btts ? "Yes" : "Over 1.5"),
    id, modelScore: score, sporty: { eventId: id, marketId: btts ? "29" : "18", outcomeId: btts ? "yes" : "over", specifier: btts ? "" : "total=1.5" } });
  const rows = [row("a", 80), row("b", 80), row("c", 80, true), row("d", 79, true)];
  assert.deepEqual(selectDiversifiedEngineCard(rows, 3).map(p => p.id), ["a", "c", "b"]);
  assert.deepEqual(selectDiversifiedEngineCard(rows, 2, new Map([["a", 1], ["c", 1]])).map(p => p.id), ["b", "c"]);
  assert.equal(selectDiversifiedEngineCard(rows, 3, new Map([["a", 5], ["b", 5], ["c", 5]]))[0]?.id, "a");
  const alternative = { ...rows[2]!, id: "alternative", sporty: { ...rows[2]!.sporty, eventId: "b" } };
  const result = selectDiversifiedEngineCard([rows[0]!, rows[1]!, alternative], 3);
  assert.deepEqual(result.map(p => p.id), ["a", "alternative"]);
});
it("engine football classifier admits supported single families beyond score Overs", () => {
  for (const [id, market, selection, expected] of [
    ["29", "Both Teams To Score", "Yes", "btts"],
    ["10", "Double Chance", "Home or Away", "home_or_away"],
    ["1", "1X2", "Draw", "draw"],
    ["90", "Second Half Over/Under 1.5", "Over 1.5", "second_half_over"],
    ["999", "Corners Over/Under 1.5", "Over 1.5", "corners"],
  ]) assert.equal(engineMarketKind(pick(id!, market!, selection!)), expected);
  assert.equal(engineMarketKind(pick("10", "Double Chance", "Home or Draw")), null);
});
