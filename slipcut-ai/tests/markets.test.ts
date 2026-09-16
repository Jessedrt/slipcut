import { describe, expect, it } from "vitest";
import { categorizeMarket, impliedProbability } from "../src/markets/catalog.js";

describe("markets", () => {
  it("categorizes football goals", () => {
    expect(categorizeMarket("18", "Over/Under", "football")).toBe("Over/Under Goals");
  });
  it("categorizes BTTS", () => {
    expect(categorizeMarket("29", "Both Teams To Score", "football")).toBe("BTTS");
  });
  it("implied probability", () => {
    expect(impliedProbability(2)).toBeCloseTo(0.5);
  });
});
