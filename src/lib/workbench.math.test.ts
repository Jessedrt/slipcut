import assert from "node:assert/strict";
import test from "node:test";
import { buildToOdds, combinedOdds } from "./workbench";

test("target odds prefers stronger mathematics within the five-percent band", () => {
  const picks = [
    { id: "weak-a", odds: 1.25, modelScore: 45 },
    { id: "weak-b", odds: 1.6, modelScore: 45 }, // exact 2.00, but weak
    { id: "strong-a", odds: 1.4, modelScore: 90 },
    { id: "strong-b", odds: 1.4, modelScore: 90 }, // 1.96, inside 5% and much stronger
  ];
  const chosen = buildToOdds(picks, 2);
  assert.deepEqual(
    chosen.map((pick) => pick.id).sort(),
    ["strong-a", "strong-b"],
  );
  assert.ok(Math.abs(Math.log((combinedOdds(chosen) ?? 0) / 2)) <= Math.log(1.05));
});

test("market-only zero scores lose tie-breaks to evidence-qualified selections", () => {
  const picks = [
    { id: "market-only-a", odds: 1.4, modelScore: 0 },
    { id: "market-only-b", odds: 1.4, modelScore: 0 },
    { id: "math-a", odds: 1.39, modelScore: 72 },
    { id: "math-b", odds: 1.39, modelScore: 74 },
  ];
  const chosen = buildToOdds(picks, 2);
  assert.deepEqual(
    chosen.map((pick) => pick.id).sort(),
    ["math-a", "math-b"],
  );
});
