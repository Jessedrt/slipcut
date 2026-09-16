import type { AnalyzedSelection, NormalizedMarket, RiskLevel } from "../types/index.js";
import { impliedProbability } from "../markets/catalog.js";

/**
 * Confidence engine biased toward safer selections.
 * Higher modelProbability = safer for multi-leg slips.
 */
export function analyzeMarket(m: NormalizedMarket): AnalyzedSelection {
  const implied = impliedProbability(m.odds);
  let modelProbability = implied;
  let dataQuality: AnalyzedSelection["dataQuality"] = "medium";
  let reasoning = "Anchored to market-implied probability.";

  const cat = m.category.toLowerCase();
  const sel = m.selectionName.toLowerCase();
  const odds = m.odds;

  if (/double chance|draw no bet/.test(cat)) {
    modelProbability = Math.min(0.94, implied + 0.06);
    reasoning = "Cover market (DC/DNB) — typically safer than straight 1X2.";
    dataQuality = "high";
  } else if (/over\/under goals|game total/.test(cat)) {
    if (/over 0\.5|under 0\.5/.test(sel) && /first half|1st half|quarter/.test(cat + " " + m.marketName.toLowerCase())) {
      modelProbability = Math.max(0.05, implied - 0.08);
      reasoning = "Fragile early-period 0.5 line — treated as higher risk.";
      dataQuality = "low";
    } else if (/over 2\.5|under 2\.5|over 1\.5|under 3\.5/.test(sel) || odds <= 1.75) {
      modelProbability = Math.min(0.92, implied + 0.04);
      reasoning = "Main total line with solid board liquidity.";
      dataQuality = "high";
    } else {
      modelProbability = Math.min(0.9, implied + 0.02);
      reasoning = "Goals total — price-anchored.";
    }
  } else if (/btts/.test(cat)) {
    if (/yes/.test(sel) && odds >= 1.4 && odds <= 2.1) {
      modelProbability = Math.min(0.9, implied + 0.03);
      reasoning = "BTTS Yes in a reasonable price band.";
    } else if (/no/.test(sel) && odds <= 1.85) {
      modelProbability = Math.min(0.91, implied + 0.035);
      reasoning = "BTTS No at short price — often safer in low-scoring spots.";
      dataQuality = "high";
    } else {
      modelProbability = Math.min(0.88, implied + 0.015);
      reasoning = "BTTS market.";
    }
  } else if (/asian handicap|european handicap|point spread/.test(cat)) {
    if (odds <= 1.7) {
      modelProbability = Math.min(0.9, implied + 0.03);
      reasoning = "Short-priced handicap/spread — safer end of the line.";
      dataQuality = "high";
    } else {
      modelProbability = Math.min(0.86, implied + 0.01);
      reasoning = "Handicap/spread.";
    }
  } else if (/corners|cards/.test(cat)) {
    if (odds <= 1.65) {
      modelProbability = Math.min(0.88, implied + 0.025);
      reasoning = "Short side-market price.";
    } else {
      modelProbability = Math.max(0.05, implied - 0.01);
      reasoning = "Side market — moderate confidence.";
    }
  } else if (/match result|moneyline/.test(cat)) {
    if (odds <= 1.45) {
      modelProbability = Math.min(0.9, implied + 0.02);
      reasoning = "Strong favorite moneyline/1X2.";
      dataQuality = "high";
    } else if (odds <= 1.75) {
      modelProbability = Math.min(0.86, implied);
      reasoning = "Moderate favorite result market.";
    } else {
      modelProbability = Math.max(0.05, implied - 0.03);
      reasoning = "Longer-priced result — higher variance.";
    }
  } else if (/score markets|correct score/.test(cat)) {
    modelProbability = Math.max(0.05, implied - 0.08);
    reasoning = "Correct score / high variance — deprioritized for safety.";
    dataQuality = "low";
  } else if (/first half|quarter|second half/.test(cat)) {
    if (/over 0\.5/.test(sel)) {
      modelProbability = Math.max(0.05, implied - 0.06);
      reasoning = "Early/period Over 0.5 is fragile — lower safety rank.";
      dataQuality = "low";
    } else if (odds <= 1.55) {
      modelProbability = Math.min(0.87, implied + 0.02);
      reasoning = "Short period market.";
    } else {
      modelProbability = Math.max(0.05, implied - 0.02);
      reasoning = "Period market — slightly higher variance.";
    }
  } else if (/team total/.test(cat) && odds <= 1.7) {
    modelProbability = Math.min(0.88, implied + 0.02);
    reasoning = "Team total at a short price.";
  }

  if (odds >= 3.5) {
    modelProbability = Math.min(modelProbability, implied - 0.05);
    modelProbability = Math.max(0.05, modelProbability);
    reasoning += " Long price reduced for safety ranking.";
  }

  if (odds >= 1.2 && odds <= 1.65) {
    modelProbability = Math.min(0.95, modelProbability + 0.015);
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

/** Single safest open selection for one event. */
export function pickSafest(markets: AnalyzedSelection[]): AnalyzedSelection | null {
  const open = markets.filter((m) => m.status === "open" && m.odds > 1 && m.odds < 4);
  if (!open.length) return null;
  open.sort((a, b) => {
    const d = (b.modelProbability || 0) - (a.modelProbability || 0);
    if (Math.abs(d) > 0.01) return d;
    const q = (x: AnalyzedSelection) => (x.dataQuality === "high" ? 2 : x.dataQuality === "medium" ? 1 : 0);
    if (q(b) !== q(a)) return q(b) - q(a);
    return a.odds - b.odds;
  });
  return open[0] || null;
}

/** Top N safest distinct market families for one event. */
export function pickSafestN(markets: AnalyzedSelection[], n = 3): AnalyzedSelection[] {
  const open = markets.filter((m) => m.status === "open" && m.odds > 1 && m.odds < 4);
  open.sort((a, b) => (b.modelProbability || 0) - (a.modelProbability || 0));
  const out: AnalyzedSelection[] = [];
  const seenCat = new Set<string>();
  for (const m of open) {
    if (seenCat.has(m.category)) continue;
    seenCat.add(m.category);
    out.push(m);
    if (out.length >= n) break;
  }
  if (out.length < n) {
    for (const m of open) {
      if (out.some((x) => x.providerSelectionId === m.providerSelectionId && x.providerMarketId === m.providerMarketId))
        continue;
      out.push(m);
      if (out.length >= n) break;
    }
  }
  return out;
}
