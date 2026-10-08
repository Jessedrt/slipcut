export type MathematicalSeries = {
  values: number[];
  sample: number;
  hitRate: number;
  mean: number;
  median: number;
  trimmedMean: number;
  deviation: number;
  variation: number;
  outliers: number;
};

export type RobustHitModel = {
  score: number;
  recencyRate: number;
  bayesianRate: number;
  confidenceFloor: number;
  effectiveSample: number;
};

export type RobustOverModel = RobustHitModel & {
  projection: number;
  probability: number;
  edge: number;
  edgeSigma: number;
  impliedProbability: number;
  valueEdge: number;
  probabilityScore: number;
  projectionScore: number;
  stabilityScore: number;
  valueScore: number;
};

type Risk = "conservative" | "balanced" | "aggressive";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
}

function normalCdf(z: number) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/** Newest value is index 0. Four games is the default half-life. */
export function recencyWeights(length: number, halfLife = 4): number[] {
  if (length <= 0) return [];
  const safeHalfLife = Math.max(1, halfLife);
  return Array.from({ length }, (_, index) => 0.5 ** (index / safeHalfLife));
}

function weightedMean(values: number[], weights: number[]) {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  if (!denominator) return 0;
  return values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) / denominator;
}

function weightedHit(values: number[], line: number, weights: number[]) {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  if (!denominator) return { rate: 0.5, hits: 0, weight: 0 };
  const hits = values.reduce(
    (sum, value, index) => sum + (value > line ? (weights[index] ?? 0) : 0),
    0,
  );
  return { rate: hits / denominator, hits, weight: denominator };
}

/** Lower confidence bound. z=1 is deliberately useful for ranking without turning this into an 80% hard gate. */
export function wilsonLowerBound(hits: number, sample: number, z = 1): number {
  if (sample <= 0) return 0.5;
  const p = clamp(hits / sample);
  const z2 = z * z;
  const denominator = 1 + z2 / sample;
  const centre = p + z2 / (2 * sample);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * sample)) / sample);
  return clamp((centre - margin) / denominator);
}

function robustScale(values: number[], fallback: number) {
  if (!values.length) return Math.max(1, fallback);
  const centre = median(values);
  const mad = median(values.map((value) => Math.abs(value - centre)));
  const madSigma = 1.4826 * mad;
  // Never let a zero-MAD run claim certainty. A fraction of ordinary SD remains as a floor.
  return Math.max(0.75, madSigma, Math.max(0, fallback) * 0.55);
}

function seriesHitModel(series: MathematicalSeries, line: number) {
  const values = series.values;
  const weights = recencyWeights(values.length);
  const weighted = weightedHit(values, line, weights);
  // Beta prior centred at 50%. Three pseudo-games prevents a 1/1 or 2/2 run from becoming certainty.
  const priorStrength = 3;
  const bayesian = (weighted.hits + 0.5 * priorStrength) / (weighted.weight + priorStrength);
  const floor = wilsonLowerBound(series.hits, series.sample, 1);
  const conservativeRate = 0.5 * weighted.rate + 0.32 * bayesian + 0.18 * floor;
  return {
    recencyRate: weighted.rate,
    bayesianRate: bayesian,
    confidenceFloor: floor,
    conservativeRate: clamp(conservativeRate),
    effectiveSample: weighted.weight,
  };
}

export function robustHitScore(series: MathematicalSeries[], line: number): RobustHitModel {
  if (!series.length) {
    return { score: 50, recencyRate: 0.5, bayesianRate: 0.5, confidenceFloor: 0.5, effectiveSample: 0 };
  }
  const models = series.map((item) => seriesHitModel(item, line));
  const rates = models.map((model) => model.conservativeRate);
  const minimum = Math.min(...rates);
  const geometric = Math.exp(rates.reduce((sum, rate) => sum + Math.log(Math.max(0.01, rate)), 0) / rates.length);
  // Both sides of the matchup must agree. The weakest side has more weight than the average.
  const combined = 0.62 * minimum + 0.38 * geometric;
  return {
    score: Math.round(100 * clamp(combined)),
    recencyRate: Math.min(...models.map((model) => model.recencyRate)),
    bayesianRate: Math.min(...models.map((model) => model.bayesianRate)),
    confidenceFloor: Math.min(...models.map((model) => model.confidenceFloor)),
    effectiveSample: Math.min(...models.map((model) => model.effectiveSample)),
  };
}

export function robustOverModel(
  series: MathematicalSeries[],
  line: number,
  odds?: number,
): RobustOverModel {
  const hit = robustHitScore(series, line);
  const models = series.map((item) => {
    const weights = recencyWeights(item.values.length);
    const recentCentre = weightedMean(item.values, weights);
    const centre = 0.46 * recentCentre + 0.32 * item.trimmedMean + 0.22 * item.median;
    const sigma = robustScale(item.values, item.deviation);
    const normalProbability = clamp(1 - normalCdf((line - centre) / sigma), 0.01, 0.99);
    const hitModel = seriesHitModel(item, line);
    const empiricalProbability =
      0.52 * hitModel.recencyRate + 0.32 * hitModel.bayesianRate + 0.16 * hitModel.confidenceFloor;
    // Distribution model and empirical hit model must agree; neither gets to dominate alone.
    const probability = clamp(0.52 * normalProbability + 0.48 * empiricalProbability, 0.01, 0.99);
    return { centre, sigma, probability };
  });

  const centres = models.map((model) => model.centre);
  const probabilities = models.map((model) => model.probability);
  const projection = centres.reduce((sum, value) => sum + value, 0) / Math.max(1, centres.length);
  const pooledSigma = Math.sqrt(
    models.reduce((sum, model) => sum + model.sigma ** 2, 0) / Math.max(1, models.length),
  );
  const weakestProbability = probabilities.length ? Math.min(...probabilities) : 0.5;
  const geometricProbability = probabilities.length
    ? Math.exp(probabilities.reduce((sum, value) => sum + Math.log(Math.max(0.01, value)), 0) / probabilities.length)
    : 0.5;
  let probability = 0.6 * weakestProbability + 0.4 * geometricProbability;

  // Shrink toward 50% when the effective sample is thin. Eight weighted games is treated as mature.
  const sampleConfidence = clamp(hit.effectiveSample / 8);
  probability = 0.5 + (probability - 0.5) * (0.68 + 0.32 * sampleConfidence);
  probability = clamp(probability, 0.02, 0.98);

  const edge = projection - line;
  const edgeSigma = edge / Math.max(0.75, pooledSigma);
  const impliedProbability = odds && odds > 1 ? clamp(1 / odds) : 1;
  const valueEdge = probability - impliedProbability;
  const averageVariation = series.length
    ? series.reduce((sum, item) => sum + item.variation, 0) / series.length
    : 1;
  const outlierRate = series.length
    ? series.reduce((sum, item) => sum + item.outliers / Math.max(1, item.sample), 0) / series.length
    : 1;

  return {
    ...hit,
    projection,
    probability,
    edge,
    edgeSigma,
    impliedProbability,
    valueEdge,
    probabilityScore: 100 * probability,
    projectionScore: 100 * clamp(0.5 + 0.16 * edgeSigma),
    stabilityScore: 100 * clamp(1 - 0.72 * averageVariation - 0.28 * outlierRate),
    valueScore: 100 * clamp(0.5 + 2.2 * valueEdge),
  };
}

export function mathematicalSelectionScore(
  model: Pick<RobustOverModel, "probabilityScore" | "score" | "projectionScore" | "stabilityScore" | "valueScore">,
  risk: Risk,
): number {
  const weights =
    risk === "conservative"
      ? { probability: 0.34, hit: 0.27, projection: 0.20, stability: 0.14, value: 0.05 }
      : risk === "balanced"
        ? { probability: 0.32, hit: 0.25, projection: 0.20, stability: 0.12, value: 0.11 }
        : { probability: 0.29, hit: 0.22, projection: 0.22, stability: 0.10, value: 0.17 };
  return Math.round(
    weights.probability * model.probabilityScore +
      weights.hit * model.score +
      weights.projection * model.projectionScore +
      weights.stability * model.stabilityScore +
      weights.value * model.valueScore,
  );
}
