import assert from "node:assert/strict";
import test from "node:test";
import {
  mathematicalSelectionScore,
  recencyWeights,
  robustHitScore,
  robustOverModel,
  wilsonLowerBound,
  type MathematicalSeries,
} from "./selection-math";

function series(values: number[], line: number): MathematicalSeries {
  const sorted = [...values].sort((a, b) => a - b);
  const sample = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / sample;
  const median = (sorted[Math.floor((sample - 1) / 2)]! + sorted[Math.floor(sample / 2)]!) / 2;
  const trim = sample >= 8 ? Math.max(1, Math.floor(sample * 0.1)) : 0;
  const trimmed = sorted.slice(trim, sample - trim);
  const trimmedMean = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sample);
  return {
    values,
    hits: values.filter((value) => value > line).length,
    sample,
    hitRate: values.filter((value) => value > line).length / sample,
    mean,
    median,
    trimmedMean,
    deviation,
    variation: deviation / Math.max(1, Math.abs(mean)),
    outliers: 0,
  };
}

test("recency weights favour newer results", () => {
  const weights = recencyWeights(6);
  assert.equal(weights[0], 1);
  assert.ok(weights[0]! > weights[2]!);
  assert.ok(weights[2]! > weights[5]!);
});

test("tiny perfect samples are shrunk instead of scoring as certainty", () => {
  const oneOfOne = robustHitScore([series([2], 1)], 1);
  const tenOfTen = robustHitScore([series(Array(10).fill(2), 1)], 1);
  assert.ok(oneOfOne.score < 80);
  assert.ok(tenOfTen.score > oneOfOne.score);
  assert.ok(wilsonLowerBound(1, 1) < 0.7);
});

test("recent misses hurt more than equally many old misses", () => {
  const recentGood = robustHitScore([series([2, 2, 2, 2, 0, 0], 1)], 1);
  const recentBad = robustHitScore([series([0, 0, 2, 2, 2, 2], 1)], 1);
  assert.ok(recentGood.score > recentBad.score);
});

test("one extreme score cannot dominate the robust projection", () => {
  const normal = series([166, 171, 168, 174, 170, 169, 173, 167, 172, 171], 160.5);
  const outlier = series([166, 171, 168, 174, 170, 169, 173, 167, 172, 260], 160.5);
  const normalModel = robustOverModel([normal, normal], 160.5, 1.4);
  const outlierModel = robustOverModel([outlier, normal], 160.5, 1.4);
  assert.ok(outlierModel.projection - normalModel.projection < 8);
  assert.ok(outlierModel.probability < 0.99);
});

test("consistent evidence outranks volatile evidence around the same line", () => {
  const stable = series([166, 168, 165, 169, 167, 170, 166, 168, 167, 169], 160.5);
  const volatile = series([125, 205, 131, 198, 140, 191, 145, 187, 150, 184], 160.5);
  const stableModel = robustOverModel([stable, stable], 160.5, 1.45);
  const volatileModel = robustOverModel([volatile, volatile], 160.5, 1.45);
  assert.ok(stableModel.stabilityScore > volatileModel.stabilityScore);
  assert.ok(
    mathematicalSelectionScore(stableModel, "conservative") >
      mathematicalSelectionScore(volatileModel, "conservative"),
  );
});

test("price value matters more in aggressive mode than conservative mode", () => {
  const base = {
    probabilityScore: 72,
    score: 68,
    projectionScore: 70,
    stabilityScore: 70,
  };
  const lowValue = { ...base, valueScore: 35 };
  const highValue = { ...base, valueScore: 85 };
  const conservativeLift =
    mathematicalSelectionScore(highValue, "conservative") -
    mathematicalSelectionScore(lowValue, "conservative");
  const aggressiveLift =
    mathematicalSelectionScore(highValue, "aggressive") -
    mathematicalSelectionScore(lowValue, "aggressive");
  assert.ok(aggressiveLift > conservativeLift);
});
