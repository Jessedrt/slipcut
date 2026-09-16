import { describe, expect, it } from "vitest";
import { optimizeSlip, splitSlip, removeWeakest } from "../src/slips/optimizer.js";
import type { AnalyzedSelection } from "../src/types/index.js";

function leg(partial: Partial<AnalyzedSelection> & { odds: number; eventId: string }): AnalyzedSelection {
  return {
    providerMarketId: "18",
    providerSelectionId: "1",
    sport: "football",
    category: "Over/Under Goals",
    marketName: "Over/Under",
    selectionName: "Over 1.5",
    status: "open",
    home: "A",
    away: "B",
    modelProbability: 0.7,
    confidenceScore: 7,
    dataQuality: "medium",
    riskLevel: "lower",
    reasoning: "test",
    impliedProbability: 1 / partial.odds,
    ...partial,
  };
}

describe("optimizer", () => {
  const candidates = [
    leg({ eventId: "1", odds: 1.3, modelProbability: 0.8, home: "H1" }),
    leg({ eventId: "2", odds: 1.4, modelProbability: 0.75, home: "H2" }),
    leg({ eventId: "3", odds: 1.5, modelProbability: 0.7, home: "H3" }),
    leg({ eventId: "4", odds: 1.6, modelProbability: 0.65, home: "H4" }),
    leg({ eventId: "5", odds: 1.25, modelProbability: 0.85, home: "H5" }),
    leg({ eventId: "6", odds: 1.9, modelProbability: 0.55, home: "H6" }),
  ];

  it("respects game count", () => {
    const slip = optimizeSlip({ candidates, gameCount: 3 });
    expect(slip.legs.length).toBe(3);
  });

  it("moves toward target odds", () => {
    const slip = optimizeSlip({ candidates, gameCount: 4, targetOdds: 5 });
    expect(slip.legs.length).toBeGreaterThan(0);
    expect(slip.combinedOdds).toBeGreaterThan(1);
  });

  it("splits into balanced parts", () => {
    const slips = splitSlip(candidates, 2);
    expect(slips.length).toBe(2);
    expect(slips[0].legs.length + slips[1].legs.length).toBe(candidates.length);
  });

  it("removes weakest", () => {
    const next = removeWeakest(candidates, 1);
    expect(next.length).toBe(candidates.length - 1);
    expect(next.find((l) => l.eventId === "6")).toBeFalsy();
  });
});
