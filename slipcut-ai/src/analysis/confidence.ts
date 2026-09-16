import type { AnalyzedSelection, NormalizedMarket, RiskLevel } from "../types/index.js";
import { impliedProbability } from "../markets/catalog.js";

/**
 * Heuristic confidence engine (deterministic).
 * Does not claim guarantees. Uses odds structure + market family quality as prior.
 * Replaceable with sports-stats models when provider data is wired.
 */
export function analyzeMarket(m: NormalizedMarket): AnalyzedSelection {
  const implied = impliedProbability(m.odds);
  let modelProbability = implied;
  let dataQuality: AnalyzedSelection["dataQuality"] = "medium";
  let reasoning = "Market-implied baseline with family stability adjustment.";

  const cat = m.category.toLowerCase();
  if (/double chance|draw no bet|over\/under|btts|game total/.test(cat)) {
    modelProbability = Math.min(0.92, implied + 0.03);
    reasoning = "Stable market family; probability anchored to de-vigged price.";
    dataQuality = "medium";
  } else if (/match result|moneyline|correct score/.test(cat)) {
    modelProbability = Math.max(0.05, implied - 0.02);
    reasoning = "Higher variance market; confidence tempered vs price.";
  } else if (/1st half|first half|quarter/.test(cat) && /over/.test(m.selectionName.toLowerCase())) {
    modelProbability = Math.max(0.05, implied - 0.04);
    reasoning = "Early-period totals are higher variance.";
    dataQuality = "low";
  }

  modelProbability = Math.min(0.95, Math.max(0.05, modelProbability));
  const confidenceScore = Math.round(modelProbability * 10 * 10) / 10;
  const riskLevel: RiskLevel =
    modelProbability >= 0.72 ? "lower" : modelProbability >= 0.55 ? "medium" : "higher";

  return {
    ...m,
    modelProbability,
    confidenceScore,
    dataQuality,
    riskLevel,
    reasoning,
    impliedProbability: implied,
  };
}

export function analyzeMany(markets: NormalizedMarket[]): AnalyzedSelection[] {
  return markets.map(analyzeMarket);
}
