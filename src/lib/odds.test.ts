import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accaTrueChance,
  historyBias,
  applyPlatt,
  blendWithMarket,
  brier,
  combinedPrice,
  confidenceWeight,
  correlationLoad,
  edge,
  ensembleScores,
  evPerStake,
  fairOddsFromProb,
  fairProbFromOdds,
  familyMargin,
  fitPlatt,
  impliedProb,
  kellyFraction,
  logistic,
  logit,
  reliability,
  slipEv,
  slipTrueChance,
  NEUTRAL_PLATT,
} from "./odds.ts";

describe("market math", () => {
  it("implied probability is the inverse of the price", () => {
    assert.equal(impliedProb(2), 0.5);
    assert.equal(impliedProb(1.5), 0.6666666666666666);
  });

  it("rejects prices that cannot be probabilities", () => {
    assert.equal(impliedProb(1), null);
    assert.equal(impliedProb(0), null);
    assert.equal(impliedProb(undefined), null);
    assert.equal(impliedProb(Number.NaN), null);
  });

  it("de-vigging removes the modelled margin, so fair < implied", () => {
    const fair = fairProbFromOdds(2, "ou", "football");
    assert.ok(fair != null && fair < 0.5);
    // 3-way football runs a wider book than a 2-way basketball total.
    assert.ok(familyMargin("win", "football") > familyMargin("ou", "basketball"));
  });

  it("fair odds round-trips through fair probability", () => {
    const odds = fairOddsFromProb(0.6);
    assert.ok(odds != null);
    assert.ok(Math.abs(odds - 1.6667) < 0.01);
  });

  it("a de-vigged 1.50 shot has negative edge at the same probability", () => {
    // The classic trap: 66% "sounds" like a 1.50 shot, but that IS the price.
    const fair = fairProbFromOdds(1.5, "ou", "football") as number;
    const e = edge(fair, 1.5, "ou", "football") as number;
    assert.ok(Math.abs(e) < 1e-9, "edge is zero when we simply agree with the book");
    assert.ok((edge(0.75, 1.5, "ou", "football") as number) > 0);
    assert.ok((edge(0.5, 1.5, "ou", "football") as number) < 0);
  });

  it("EV is per unit staked", () => {
    assert.ok(Math.abs((evPerStake(0.6, 2) as number) - 0.2) < 1e-9);
    assert.ok(Math.abs((evPerStake(0.4, 2) as number) + 0.2) < 1e-9);
    assert.equal(evPerStake(0.6, 1), null);
  });
});

describe("blending research with the market", () => {
  it("weight 0 quotes the market and weight 1 quotes the model", () => {
    assert.ok(Math.abs(blendWithMarket(0.8, 0.5, 0) - 0.5) < 1e-9);
    assert.ok(Math.abs(blendWithMarket(0.8, 0.5, 1) - 0.8) < 1e-9);
  });

  it("blends in logit space, so it never leaves (0,1)", () => {
    const mid = blendWithMarket(0.97, 0.03, 0.5);
    assert.ok(mid > 0.03 && mid < 0.97);
  });

  it("a low-confidence read moves the price, but nowhere near its own claim", () => {
    const out = blendWithMarket(0.9, 0.5, confidenceWeight("low"));
    assert.ok(out > 0.5 && out < 0.65, `expected a shy move, got ${out}`);
    assert.ok(blendWithMarket(0.9, 0.5, confidenceWeight("high")) > out);
  });

  it("confidence ranks high > medium > low and defaults safely", () => {
    assert.ok(confidenceWeight("high") > confidenceWeight("medium"));
    assert.ok(confidenceWeight("medium") > confidenceWeight("low"));
    assert.equal(confidenceWeight("nonsense"), confidenceWeight("medium"));
  });
});

describe("ensembling engines", () => {
  it("agreement keeps the consensus and reports high confidence", () => {
    const e = ensembleScores([
      { engine: "a", probability: 60, confidence: "high" },
      { engine: "b", probability: 62, confidence: "high" },
    ]);
    assert.ok(e != null);
    assert.ok(Math.abs(e.probability - 0.61) < 0.015);
    assert.equal(e.confidence, "high");
  });

  it("disagreement is detected and lowers confidence", () => {
    const e = ensembleScores([
      { engine: "a", probability: 85, confidence: "high" },
      { engine: "b", probability: 40, confidence: "high" },
    ]);
    assert.ok(e != null);
    assert.equal(e.confidence, "low");
    assert.ok(e.disagreement > 0.5);
    // With engines this far apart we should not be quoting either extreme.
    assert.ok(e.probability > 0.45 && e.probability < 0.8);
  });

  it("a confident engine outweighs a guessing one", () => {
    const e = ensembleScores([
      { engine: "a", probability: 70, confidence: "high" },
      { engine: "b", probability: 40, confidence: "low" },
    ]);
    assert.ok(e != null);
    assert.ok(e.probability > 0.55, `expected the confident read to lead, got ${e.probability}`);
  });

  it("returns null when nothing came back", () => {
    assert.equal(ensembleScores([]), null);
    assert.equal(ensembleScores([{ engine: "a", probability: Number.NaN }]), null);
  });
});

describe("calibration", () => {
  it("logit and logistic are inverses", () => {
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      assert.ok(Math.abs(logistic(logit(p)) - p) < 1e-12);
    }
  });

  it("needs a real sample before it fits anything", () => {
    assert.deepEqual(fitPlatt([{ p: 0.8, won: true }]), { ...NEUTRAL_PLATT, n: 1 });
    const oneSided = fitPlatt(
      Array.from({ length: 40 }, () => ({ p: 0.7, won: true })),
    );
    assert.equal(oneSided.a, 1);
  });

  it("pulls an over-confident desk back toward the middle", () => {
    // Claimed 80%, landed 50% — the scaler must shrink future 80% claims.
    const outcomes = [
      ...Array.from({ length: 40 }, (_, i) => ({ p: 0.8, won: i % 2 === 0 })),
      ...Array.from({ length: 40 }, (_, i) => ({ p: 0.4, won: i % 2 === 0 })),
    ];
    const cal = fitPlatt(outcomes);
    assert.ok(cal.a < 1, `expected a < 1 for an over-confident desk, got ${cal.a}`);
    assert.ok(applyPlatt(0.8, cal) < 0.8);
    assert.ok(applyPlatt(0.8, cal) > 0.5);
  });

  it("leaves a well-calibrated desk alone", () => {
    const outcomes: Array<{ p: number; won: boolean }> = [];
    for (let i = 0; i < 200; i++) {
      const p = i % 2 === 0 ? 0.7 : 0.3;
      outcomes.push({ p, won: (i % 10) / 10 < p });
    }
    const cal = fitPlatt(outcomes);
    const scaled = applyPlatt(0.7, cal);
    assert.ok(Math.abs(scaled - 0.7) < 0.12, `expected a small correction, got ${scaled}`);
  });

  it("Brier score separates a good forecaster from a coin flip", () => {
    const sharp = [
      { p: 0.9, won: true },
      { p: 0.1, won: false },
      { p: 0.8, won: true },
    ];
    const hopeless = [
      { p: 0.5, won: true },
      { p: 0.5, won: false },
      { p: 0.5, won: true },
    ];
    assert.ok((brier(sharp) as number) < (brier(hopeless) as number));
    assert.equal(brier([]), null);
  });

  it("reliability bins show where the desk is lying to itself", () => {
    const outcomes = [
      ...Array.from({ length: 20 }, (_, i) => ({ p: 0.8, won: i < 5 })), // 25% hit rate
      ...Array.from({ length: 20 }, (_, i) => ({ p: 0.3, won: i < 6 })), // 30% hit rate
    ];
    const bins = reliability(outcomes, 4);
    const top = bins.find((b) => b.low >= 0.5);
    assert.ok(top != null);
    assert.ok(top.meanP - top.hitRate > 0.4, "the 70-100% bucket should look badly off");
  });
});

describe("learning from settled legs", () => {
  it("says nothing when there is no evidence", () => {
    assert.equal(historyBias(0, 0), 0);
  });

  it("barely moves on a couple of legs", () => {
    const thin = historyBias(0, 2); // lost both
    assert.ok(thin < 0 && Math.abs(thin) < 8, `expected a nudge, got ${thin}`);
  });

  it("moves properly once the sample is real", () => {
    const solid = historyBias(3, 17); // 15% win rate over 20 legs
    assert.ok(solid < -8, `expected a clear penalty, got ${solid}`);
  });

  it("never runs away, however bad the record", () => {
    const hopeless = historyBias(0, 500);
    assert.ok(hopeless > -40 && hopeless < 0);
  });

  it("rewards a market that keeps landing", () => {
    assert.ok(historyBias(18, 2) > 5);
  });

  it("an even record earns nothing", () => {
    assert.ok(Math.abs(historyBias(20, 20)) < 0.001);
  });
});

describe("accumulators", () => {
  const leg = (home: string, away: string, extra: Record<string, unknown> = {}) => ({
    home,
    away,
    probability: 0.7,
    odds: 1.5,
    ...extra,
  });

  it("ten 70% shots are not a 70% slip", () => {
    const picks = Array.from({ length: 10 }, (_, i) => leg(`H${i}`, `A${i}`));
    const chance = slipTrueChance(picks);
    assert.ok(chance < 0.1, `expected a modest accumulator chance, got ${chance}`);
  });

  it("correlated legs land more often than independence suggests", () => {
    const independent = Array.from({ length: 6 }, (_, i) =>
      leg(`H${i}`, `A${i}`, { league: `L${i}`, kickoff: Date.now() + i * 86_400_000 }),
    );
    const correlated = Array.from({ length: 6 }, () =>
      leg("Arsenal", "Chelsea", { league: "Premier League", kickoff: Date.now() }),
    );
    assert.ok(correlationLoad(correlated) > correlationLoad(independent));
    assert.ok(slipTrueChance(correlated) > slipTrueChance(independent));
  });

  it("load is bounded and zero for a slip of one", () => {
    assert.equal(correlationLoad([leg("A", "B")]), 0);
    const load = correlationLoad([
      leg("A", "B", { league: "x", kickoff: 1 }),
      leg("C", "D", { league: "x", kickoff: 1 }),
    ]);
    assert.ok(load > 0 && load <= 1);
  });

  it("correlation raises the accumulator chance but keeps it under the weakest leg", () => {
    const probs = [0.6, 0.6, 0.6];
    const independent = accaTrueChance(probs, 0);
    const correlated = accaTrueChance(probs, 1);
    assert.ok(correlated > independent);
    assert.ok(correlated < 0.6);
  });

  it("price and EV need every leg priced", () => {
    const priced = [leg("A", "B"), leg("C", "D")];
    assert.ok(Math.abs((combinedPrice(priced) as number) - 2.25) < 1e-9);
    // One missing price and the whole accumulator is unpriceable.
    assert.equal(combinedPrice([leg("A", "B"), { home: "C", away: "D" }]), null);
    assert.equal(slipEv([]), null);
  });

  it("separates value from glare: same price, different true chance", () => {
    const strong = [leg("A", "B"), leg("C", "D")]; // both 70%
    const weak = [
      { ...leg("A", "B"), probability: 0.5 },
      { ...leg("C", "D"), probability: 0.5 },
    ];
    assert.ok((slipEv(strong) as number) > 0, "2.25× on two 70% shots is good value");
    assert.ok((slipEv(weak) as number) < 0, "2.25× on two coin flips is not");
  });
});

describe("kelly", () => {
  it("refuses to stake on a negative-edge bet", () => {
    assert.equal(kellyFraction(0.4, 2), 0);
  });

  it("grows with the edge but stays capped", () => {
    const small = kellyFraction(0.6, 2);
    const big = kellyFraction(0.9, 2);
    assert.ok(big > small);
    assert.ok(big <= 0.05);
  });

  it("shrinks the stake as legs pile up", () => {
    const single = kellyFraction(0.7, 3);
    const acca = kellyFraction(0.7, 3, { legs: 20 });
    assert.ok(acca < single, "a 20-leg acca deserves a smaller stake");
  });

  it("never stakes on broken prices", () => {
    assert.equal(kellyFraction(0.9, 1), 0);
    assert.equal(kellyFraction(0.9, Number.NaN), 0);
  });
});
