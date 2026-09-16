import type { AnalyzedSelection, NormalizedMarket, RiskLevel } from "../types/index.js";
import { impliedProbability } from "../markets/catalog.js";

/**
 * Heuristic confidence engine. Anchors to market-implied price with light
 * family adjustments so Goals/BTTS/Handicap/Corners stay competitive with 1X2.
 */
export function analyzeMarket(m: NormalizedMarket): AnalyzedSelection {
  const implied = impliedProbability(m.odds);
  let modelProbability = implied;
  let dataQuality: AnalyzedSelection["dataQuality"] = "medium";
  let reasoning = "Market-implied baseline with family stability adjustment.";

  const cat = m.category.toLowerCase();
  const sel = m.selectionName.toLowerCase();

  if (/double chance|draw no bet/.test(cat)) {
    modelProbability = Math.min(0.93, implied + 0.04);
    reasoning = "Cover market (DC/DNB); slightly more stable than straight 1X2.";
  } else if (/over\/under goals|game total|btts/.test(cat)) {
    modelProbability = Math.min(0.92, implied + 0.03);
    reasoning = "Goals / BTTS family; price-anchored with mild stability boost.";
  } else if (/asian handicap|european handicap|point spread/.test(cat)) {
    modelProbability = Math.min(0.9, implied + 0.02);
    reasoning = "Handicap/spread priced competitively against the board.";
  } else if (/corners|cards|team total/.test(cat)) {
    modelProbability = Math.min(0.88, implied + 0.02);
    reasoning = "Side market with usable liquidity on SportyBet board.";
    dataQuality = "medium";
  } else if (/match result|moneyline/.test(cat)) {
    modelProbability = Math.max(0.05, implied - 0.01);
    reasoning = "Straight result market; confidence close to implied price.";
  } else if (/score markets|correct score/.test(cat)) {
    modelProbability = Math.max(0.05, implied - 0.05);
    reasoning = "High-variance score market; tempered confidence.";
    dataQuality = "low";
  } else if (/first half|quarter/.test(cat) && /over/.test(sel)) {
    modelProbability = Math.max(0.05, implied - 0.03);
    reasoning = "Early-period total — higher variance than full-game lines.";
    dataQuality = "low";
  } else if (/first half|second half|quarter/.test(cat)) {
    modelProbability = Math.max(0.05, implied - 0.015);
    reasoning = "Period market; slightly higher variance than full time.";
  }

  modelProbability = Math.min(0.95, Math.max(0.05, modelProbability));
  const confidenceScore = Math.round(modelProbability * 100) / 10;
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
