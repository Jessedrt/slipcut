import { describe, expect, it } from "vitest";
import { parseIntentDeterministic } from "../src/ai/intent.js";

describe("intent parser", () => {
  it("parses game count and sport", () => {
    const i = parseIntentDeterministic("Give me 5 football games today");
    expect(i.sport).toBe("football");
    expect(i.gameCount).toBe(5);
    expect(i.action).toBe("cook");
  });

  it("parses target odds and confidence", () => {
    const i = parseIntentDeterministic(
      "Give me 7 football games around 10 odds with at least 70% confidence",
    );
    expect(i.gameCount).toBe(7);
    expect(i.targetOdds).toBe(10);
    expect(i.minimumConfidence).toBe(70);
  });

  it("parses between range", () => {
    const i = parseIntentDeterministic("Give me between 5 and 8 basketball games and target 6 odds");
    expect(i.sport).toBe("basketball");
    expect(i.gameCountMin).toBe(5);
    expect(i.gameCountMax).toBe(8);
    expect(i.targetOdds).toBe(6);
  });

  it("parses split", () => {
    const i = parseIntentDeterministic("Split this ticket into 2");
    expect(i.action).toBe("split_slip");
    expect(i.splitParts).toBe(2);
  });

  it("parses remove weakest", () => {
    const i = parseIntentDeterministic("Remove the weakest two");
    expect(i.action).toBe("edit_slip");
    expect(i.editOp).toBe("remove_weakest");
    expect(i.removeCount).toBe(2);
  });
});
