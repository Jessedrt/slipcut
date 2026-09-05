import assert from "node:assert/strict";
import test from "node:test";
import { combinedOdds, parseCommand, trimToOdds } from "./workbench";
import type { AnalyzedPick } from "./types";

function pick(id: string, odds: number, probability: number): AnalyzedPick {
  return {
    id,
    home: `Home ${id}`,
    away: `Away ${id}`,
    market: "Over/Under",
    selection: "Over 1.5",
    league: "Test League",
    sport: "football",
    odds,
    probability,
    confidence: "high",
    summary: "test",
    reasons: [],
    risks: [],
    verdict: "keep",
  };
}

test("500x target reaches or gets close instead of collapsing far below target", () => {
  const input = [
    pick("a", 1.65, 78),
    pick("b", 1.72, 76),
    pick("c", 1.8, 74),
    pick("d", 1.9, 72),
    pick("e", 2.05, 70),
    pick("f", 2.2, 68),
    pick("g", 2.35, 66),
    pick("h", 2.5, 64),
  ];

  const result = trimToOdds(input, 500);
  const odds = combinedOdds(result);
  assert.ok(odds !== null);
  assert.ok(odds >= 450, `expected >= 450x, received ${odds}x`);
  assert.ok(odds <= 675, `expected <= 675x, received ${odds}x`);
});

test("natural-language target commands parse correctly", () => {
  assert.deepEqual(parseCommand("trim to 500x"), { type: "trim", targetOdds: 500 });
  assert.deepEqual(parseCommand("make at least 500 odds"), { type: "trim", targetOdds: 500 });
  assert.deepEqual(parseCommand("build 500x"), { type: "trim", targetOdds: 500 });
});
