import type { AnalyzedSelection, BuiltSlip, RiskMode } from "../types/index.js";

export type OptimizeInput = {
  candidates: AnalyzedSelection[];
  targetOdds?: number;
  minOdds?: number;
  maxOdds?: number;
  gameCount?: number;
  gameCountMin?: number;
  gameCountMax?: number;
  minimumConfidence?: number;
  riskMode?: RiskMode;
};

function combined(odds: number[]): number {
  return odds.reduce((a, b) => a * b, 1);
}

function avgConf(legs: AnalyzedSelection[]): number {
  if (!legs.length) return 0;
  return legs.reduce((s, l) => s + (l.confidenceScore || 0), 0) / legs.length;
}

export function optimizeSlip(input: OptimizeInput): BuiltSlip {
  const risk = input.riskMode ?? "conservative";
  const minConf = (input.minimumConfidence ?? 0) / 100;

  let pool = input.candidates.filter((c) => c.status === "open");
  if (minConf > 0) pool = pool.filter((c) => (c.modelProbability || 0) >= minConf);
  // Conservative: drop fragile low-confidence legs when enough safe ones exist
  if (risk === "conservative" && !input.minimumConfidence) {
    const safe = pool.filter((c) => (c.modelProbability || 0) >= 0.55 && c.odds < 3.2);
    if (safe.length >= (input.gameCount ?? 3)) pool = safe;
  }
  pool = [...pool].sort((a, b) => {
    const conf = (b.modelProbability || 0) - (a.modelProbability || 0);
    if (risk === "conservative") {
      if (Math.abs(conf) > 0.008) return conf;
      return a.odds - b.odds;
    }
    if (risk === "aggressive") return conf || b.odds - a.odds;
    return conf;
  });

  const wantMin = input.gameCountMin ?? input.gameCount ?? 3;
  const wantMax = input.gameCountMax ?? input.gameCount ?? Math.min(12, Math.max(wantMin, 8));
  const target = input.targetOdds;

  const usedEvents = new Set<string>();
  const usedLeagues = new Map<string, number>();
  const legs: AnalyzedSelection[] = [];

  for (const c of pool) {
    if (legs.length >= wantMax) break;
    if (usedEvents.has(c.eventId)) continue;
    const lg = c.league || "unknown";
    if ((usedLeagues.get(lg) || 0) >= 3) continue;
    legs.push(c);
    usedEvents.add(c.eventId);
    usedLeagues.set(lg, (usedLeagues.get(lg) || 0) + 1);
  }

  let best = legs.slice(0, Math.max(wantMin, Math.min(legs.length, wantMax)));
  let bestScore = scoreSlip(best, target, wantMin, wantMax, risk);

  if (target && pool.length > best.length) {
    let cur = [...best];
    while (cur.length > wantMin) {
      const co = combined(cur.map((l) => l.odds));
      if (target && co <= target * 1.05) break;
      cur.sort((a, b) => (a.modelProbability || 0) - (b.modelProbability || 0));
      cur.shift();
      const sc = scoreSlip(cur, target, wantMin, wantMax, risk);
      if (sc > bestScore) {
        best = [...cur];
        bestScore = sc;
      }
    }
    cur = [...best];
    for (const c of pool) {
      if (cur.length >= wantMax) break;
      if (cur.some((x) => x.eventId === c.eventId)) continue;
      const next = [...cur, c];
      const sc = scoreSlip(next, target, wantMin, wantMax, risk);
      if (sc > bestScore) {
        best = next;
        bestScore = sc;
        cur = next;
      }
    }
  }

  if (best.length < wantMin) {
    for (const c of pool) {
      if (best.length >= wantMin) break;
      if (best.some((x) => x.eventId === c.eventId)) continue;
      best.push(c);
    }
  }

  // Final: for each event keep the safest candidate from pool if a safer one exists
  best = best.map((leg) => {
    const alts = pool.filter((p) => p.eventId === leg.eventId);
    if (!alts.length) return leg;
    return alts.reduce((a, b) =>
      (b.modelProbability || 0) > (a.modelProbability || 0) ? b : a,
    );
  });

  return {
    legs: best,
    combinedOdds: combined(best.map((l) => l.odds)),
    averageConfidence: avgConf(best) * (best[0]?.confidenceScore && best[0].confidenceScore > 1 ? 1 : 100),
    targetOdds: target,
    riskMode: risk,
  };
}

function scoreSlip(
  legs: AnalyzedSelection[],
  target: number | undefined,
  wantMin: number,
  wantMax: number,
  risk: RiskMode = "conservative",
): number {
  if (!legs.length) return -1e9;
  const co = combined(legs.map((l) => l.odds));
  const conf = avgConf(legs);
  let s = conf * (risk === "conservative" ? 140 : 100);
  if (target) {
    const ratio = co / target;
    if (ratio >= 0.9 && ratio <= 1.25) s += 30 - Math.abs(1 - ratio) * 40;
    else s -= Math.abs(Math.log(ratio)) * 15;
  }
  if (legs.length >= wantMin && legs.length <= wantMax) s += 10;
  else s -= Math.abs(legs.length - (wantMin + wantMax) / 2) * 2;
  const events = new Set(legs.map((l) => l.eventId));
  s += events.size * 0.5;
  // Penalize any high-risk leg in conservative mode
  if (risk === "conservative") {
    for (const l of legs) {
      if ((l.modelProbability || 0) < 0.55) s -= 8;
      if (l.riskLevel === "higher") s -= 5;
    }
  }
  return s;
}

export function splitSlip(legs: AnalyzedSelection[], parts: number): BuiltSlip[] {
  const n = Math.max(2, Math.min(6, parts));
  const sorted = [...legs].sort((a, b) => (b.modelProbability || 0) - (a.modelProbability || 0));
  const buckets: AnalyzedSelection[][] = Array.from({ length: n }, () => []);
  let i = 0;
  let dir = 1;
  for (const leg of sorted) {
    buckets[i].push(leg);
    i += dir;
    if (i >= n) {
      i = n - 1;
      dir = -1;
    } else if (i < 0) {
      i = 0;
      dir = 1;
    }
  }
  return buckets
    .filter((b) => b.length)
    .map((b) => ({
      legs: b,
      combinedOdds: combined(b.map((l) => l.odds)),
      averageConfidence: avgConf(b) * 100,
      riskMode: "conservative" as RiskMode,
    }));
}

export function removeWeakest(legs: AnalyzedSelection[], count = 1): AnalyzedSelection[] {
  const sorted = [...legs].sort((a, b) => (a.modelProbability || 0) - (b.modelProbability || 0));
  const drop = new Set(sorted.slice(0, count).map((l) => `${l.eventId}:${l.providerSelectionId}`));
  return legs.filter((l) => !drop.has(`${l.eventId}:${l.providerSelectionId}`));
}

export function removeBelowConfidence(legs: AnalyzedSelection[], minPct: number): AnalyzedSelection[] {
  const thr = minPct > 1 ? minPct / 100 : minPct;
  return legs.filter((l) => (l.modelProbability || 0) >= thr);
}
