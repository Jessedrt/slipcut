import { listDailyBasketballOverMarkets } from "./sportybet";
import { canonicalMarket, riskOddsAllowed, SELECTION_POLICIES } from "./selection-policy";
import { assessEvidence, researchSelectionEvidence, summarize } from "./selection-evidence";
import { uniqueEvents } from "./workbench";
import type { TicketPick } from "./types";
export type DailyOversSport = "basketball";
export type DailyOverRecommendation = {
  pick: TicketPick;
  sample: number;
  average: number;
  hitRate: number;
  pushes: number;
  margin: number;
  score: number;
  totals: number[];
  summary: string;
};
export type DailyOversScan = {
  scannedEvents: number;
  eventsWithConservativeOver: number;
  evidenceQualifiedEvents: number;
  recommendations: DailyOverRecommendation[];
  warnings: string[];
};
/** Summary helper only. Live recommendations additionally require scoped, source-corroborated evidence. */
export function evaluateDailyOverPick(
  pick: TicketPick,
  totals: number[],
): DailyOverRecommendation | null {
  const c = canonicalMarket(pick),
    p = SELECTION_POLICIES.conservative;
  if (
    pick.sport !== "basketball" ||
    c.family !== "total" ||
    c.period !== "match" ||
    c.outcome !== "over" ||
    c.line === undefined ||
    !riskOddsAllowed(pick.odds, "conservative") ||
    totals.length < p.minSample ||
    totals.some((v) => !Number.isFinite(v) || v < 0)
  )
    return null;
  const s = summarize(totals, c.line);
  const robust = [...totals].sort((a, b) => a - b).slice(0, -2);
  if (
    s.hitRate < p.minHitRate ||
    s.median <= c.line ||
    s.trimmedMean <= c.line ||
    s.variation > p.maxVariation ||
    robust.filter((v) => v > c.line!).length / robust.length < p.minHitRate
  )
    return null;
  return {
    pick,
    sample: s.sample,
    average: s.mean,
    hitRate: s.hitRate,
    pushes: totals.filter((v) => v === c.line).length,
    margin: s.trimmedMean - c.line,
    score: Math.round(s.hitRate * 100 - 10 * s.variation),
    totals,
    summary: `${s.hits}/${s.sample} exceeded ${c.line}; median ${s.median.toFixed(1)}, trimmed mean ${s.trimmedMean.toFixed(1)}.`,
  };
}
export async function scanDailyOvers(): Promise<DailyOversScan> {
  const discovered = await listDailyBasketballOverMarkets();
  if (!Array.isArray(discovered))
    return {
      scannedEvents: 0,
      eventsWithConservativeOver: 0,
      evidenceQualifiedEvents: 0,
      recommendations: [],
      warnings: [discovered.error],
    };
  const candidates = discovered.filter((p) => riskOddsAllowed(p.odds, "conservative"));
  const evidence = await researchSelectionEvidence(candidates);
  const qualified = candidates
    .flatMap((p) => {
      const a = assessEvidence(p, evidence.get(p.id), "conservative");
      if (!a) return [];
      const row = evaluateDailyOverPick(p, a.series[0]!.values);
      return row ? [{ ...row, score: a.score, summary: a.summary }] : [];
    })
    .sort((a, b) => b.score - a.score);
  const selected = uniqueEvents(qualified.map((r) => r.pick)).picks;
  return {
    scannedEvents: uniqueEvents(discovered).picks.length,
    eventsWithConservativeOver: uniqueEvents(candidates).picks.length,
    evidenceQualifiedEvents: selected.length,
    recommendations: selected.map((p) => qualified.find((r) => r.pick.id === p.id)!),
    warnings: selected.length
      ? []
      : [
          "Insufficient scoped, source-corroborated statistics. No H2H-only or odds-only fallback was used.",
        ],
  };
}
