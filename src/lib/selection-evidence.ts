import { researchEspnEvidence } from "./espn-history";
import { canonicalMarket, SELECTION_POLICIES, type SelectionRisk } from "./selection-policy";
import { normalizeName } from "./bookmakers/normalize";
import type { TicketPick } from "./types";

export type HistoryRow = {
  id: string;
  date: string;
  home: string;
  away: string;
  homeValue: number;
  awayValue: number;
  source: string;
  period: ReturnType<typeof canonicalMarket>["period"];
  metric: "score" | "corners" | "cards";
  // Only populated by the source adapter after corroborating the score row.
  corroborated: boolean;
};
export type Evidence = { rows: HistoryRow[]; checkedAt: number; warnings?: string[] };
export type SeriesSummary = {
  values: number[];
  hits: number;
  sample: number;
  hitRate: number;
  mean: number;
  median: number;
  trimmedMean: number;
  deviation: number;
  variation: number;
  outliers: number;
};
export type EvidenceAssessment = {
  score: number;
  summary: string;
  series: SeriesSummary[];
  sources: string[];
  warnings: string[];
};
export function withoutHighOutliers(s: SeriesSummary): number[] {
  const deviations = s.values.map((v) => Math.abs(v - s.median)).sort((a, b) => a - b);
  const mad = (deviations[Math.floor((s.sample - 1) / 2)]! + deviations[Math.floor(s.sample / 2)]!) / 2;
  const highCutoff = s.median + Math.max(3, 3 * 1.4826 * mad);
  return s.values.filter((v) => v <= highCutoff);
}
export function summarize(values: number[], line: number): SeriesSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const sample = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / sample;
  const median = (sorted[Math.floor((sample - 1) / 2)]! + sorted[Math.floor(sample / 2)]!) / 2;
  const trim = sample >= 8 ? Math.max(1, Math.floor(sample * 0.1)) : 0;
  const trimmed = sorted.slice(trim, sample - trim);
  const trimmedMean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const deviation = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / sample);
  const deviations = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = (deviations[Math.floor((sample - 1) / 2)]! + deviations[Math.floor(sample / 2)]!) / 2;
  const outliers = values.filter(
    (v) => Math.abs(v - median) > Math.max(3, 3 * 1.4826 * mad),
  ).length;
  const hits = values.filter((v) => v > line).length;
  return {
    values,
    hits,
    sample,
    hitRate: hits / sample,
    mean,
    median,
    trimmedMean,
    deviation,
    variation: deviation / Math.max(1, Math.abs(mean)),
    outliers,
  };
}
function metricFor(pick: TicketPick): HistoryRow["metric"] {
  const c = canonicalMarket(pick);
  return c.family === "corners" ? "corners" : c.family === "cards" ? "cards" : "score";
}
function same(a: string, b: string) {
  return normalizeName(a) === normalizeName(b);
}
function normalCdf(z: number) {
  // Abramowitz-Stegun approximation; sufficient for ranking betting lines.
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
function projectedOverProbability(series: SeriesSummary[], line: number) {
  const centers = series.map((s) => 0.55 * s.trimmedMean + 0.45 * s.median);
  const projection = centers.reduce((a, b) => a + b, 0) / centers.length;
  const pooledDeviation = Math.sqrt(
    series.reduce((sum, s) => sum + s.deviation ** 2, 0) / series.length,
  );
  const sigma = Math.max(1.5, pooledDeviation);
  const probability = Math.max(0.01, Math.min(0.99, 1 - normalCdf((line - projection) / sigma)));
  return { projection, probability, edge: projection - line };
}
/** Evaluates exact scope from score rows; no full-game substitution for halves/quarters. */
export function assessEvidence(
  pick: TicketPick,
  evidence: Evidence | undefined,
  risk: SelectionRisk,
): EvidenceAssessment | null {
  if (
    !evidence ||
    !Number.isFinite(evidence.checkedAt) ||
    evidence.checkedAt > Date.now() ||
    Date.now() - evidence.checkedAt > 6 * 3_600_000
  )
    return null;
  const c = canonicalMarket(pick),
    p = SELECTION_POLICIES[risk];
  const supported = ["total", "team_total", "corners", "cards", "btts", "winner", "double_chance"];
  if (!supported.includes(c.family) || c.period === "unknown" || c.scope === "unknown") return null;
  if (
    ["total", "team_total", "corners", "cards"].includes(c.family) &&
    (c.outcome !== "over" || c.line === undefined || c.line < 0)
  )
    return null;
  // Split Asian lines require a settlement adapter; skip rather than miscount half wins.
  if (c.line !== undefined && !Number.isInteger(c.line * 2)) return null;
  if (c.family === "btts" && !["yes", "no"].includes(c.outcome)) return null;
  if (c.family === "winner" && c.outcome !== "draw") return null;
  if (c.family === "double_chance" && c.outcome !== "12") return null;
  const unique = new Map<string, HistoryRow>();
  for (const row of evidence.rows) {
    const date = Date.parse(row.date);
    if (
      !row.corroborated ||
      row.period !== c.period ||
      row.metric !== metricFor(pick) ||
      !Number.isFinite(date) ||
      date >= Math.min(pick.kickoff ?? Date.now(), Date.now()) ||
      date < Date.now() - 365 * 86400_000 ||
      !row.source.startsWith("https://") ||
      !row.home ||
      !row.away ||
      same(row.home, row.away) ||
      !Number.isFinite(row.homeValue) ||
      !Number.isFinite(row.awayValue) ||
      row.homeValue < 0 ||
      row.awayValue < 0
    )
      continue;
    const key = `${row.date.slice(0, 10)}:${normalizeName(row.home)}:${normalizeName(row.away)}`;
    unique.set(key, row);
  }
  const rows = [...unique.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const homeRows = rows
    .filter((r) => same(r.home, pick.home) || same(r.away, pick.home))
    .slice(0, 10);
  const awayRows = rows
    .filter((r) => same(r.home, pick.away) || same(r.away, pick.away))
    .slice(0, 10);
  if (homeRows.length < p.minSample || awayRows.length < p.minSample) return null;
  const valueFor = (r: HistoryRow, team: string) =>
    same(r.home, team) ? r.homeValue : r.awayValue;
  const allowedBy = (r: HistoryRow, team: string) =>
    same(r.home, team) ? r.awayValue : r.homeValue;
  let series: number[][];
  let line = c.line ?? 0.5;
  if (
    c.family === "team_total" ||
    (["corners", "cards"].includes(c.family) && c.scope !== "match")
  ) {
    const team = c.scope === "home" ? pick.home : pick.away;
    const opponent = c.scope === "home" ? pick.away : pick.home;
    const offenseRows = c.scope === "home" ? homeRows : awayRows;
    const defenseRows = c.scope === "home" ? awayRows : homeRows;
    series = [
      offenseRows.map((r) => valueFor(r, team)),
      defenseRows.map((r) => allowedBy(r, opponent)),
    ];
    // Team totals need BOTH sides of the matchup. A 1/1 or 2/2 offense sample
    // must not become a 100 score while the opponent-defense side is unknown.
    if (offenseRows.length < 3 || defenseRows.length < 3) return null;
    const splitO = offenseRows.filter((r) => same(c.scope === "home" ? r.home : r.away, team));
    const splitD = defenseRows.filter((r) => same(c.scope === "home" ? r.away : r.home, opponent));
    if (
      (splitO.length >= 3 &&
        splitO.filter((r) => valueFor(r, team) > line).length / splitO.length < p.minHitRate) ||
      (splitD.length >= 3 &&
        splitD.filter((r) => allowedBy(r, opponent) > line).length / splitD.length < p.minHitRate)
    )
      return null;
  } else {
    const get = (r: HistoryRow) =>
      c.family === "btts"
        ? Number(
            c.outcome === "yes"
              ? r.homeValue > 0 && r.awayValue > 0
              : r.homeValue === 0 || r.awayValue === 0,
          )
        : c.family === "winner"
          ? Number(r.homeValue === r.awayValue)
          : c.family === "double_chance"
            ? Number(r.homeValue !== r.awayValue)
            : r.homeValue + r.awayValue;
    if (["btts", "winner", "double_chance"].includes(c.family)) line = 0.5;
    series = [homeRows.map(get), awayRows.map(get)];
    for (const split of [
      homeRows.filter((r) => same(r.home, pick.home)),
      awayRows.filter((r) => same(r.away, pick.away)),
    ]) {
      if (
        split.length >= 3 &&
        split.filter((r) => get(r) > line).length / split.length < p.minHitRate
      )
        return null;
    }
  }
  const stats = series.map((v) => summarize(v, line));
  const numerical = !["btts", "winner", "double_chance"].includes(c.family);
  // Low discrete goal counts naturally have a much larger coefficient of
  // variation than basketball points. Use relative standard error for football
  // score evidence; keep raw point/count dispersion for other sports/metrics.
  const consistency = (s: SeriesSummary) =>
    pick.sport === "football" && metricFor(pick) === "score"
      ? s.variation / Math.sqrt(s.sample) : s.variation;
  if (
    stats.some(
      (s) =>
        s.hitRate < p.minHitRate ||
        (numerical && (s.median <= line || s.trimmedMean <= line || consistency(s) > p.maxVariation)),
    )
  )
    return null;
  // Remove detected high outliers, not two ordinary wins. Dropping the two
  // largest values unconditionally secretly raises an 80% requirement to 90%.
  if (
    numerical &&
    stats.some((s) => {
      const robust = withoutHighOutliers(s);
      if (robust.length === s.sample) return false;
      return robust.filter((v) => v > line).length / robust.length < p.minHitRate;
    })
  )
    return null;
  const smallestSample = Math.min(...stats.map((s) => s.sample));
  const rawHitScore = 100 * Math.min(...stats.map((s) => s.hitRate));
  const sampleConfidence = Math.min(1, smallestSample / 5);
  const hitScore = 50 + (rawHitScore - 50) * sampleConfidence;
  let score = Math.round(hitScore);
  let mathNote = "";
  if (numerical && c.outcome === "over") {
    const math = projectedOverProbability(stats, line);
    const implied = pick.odds && pick.odds > 1 ? 1 / pick.odds : 1;
    const probabilityEdge = math.probability - implied;
    // Require a real mathematical cushion over the line. Price value is used
    // as a ranking input, but low bookmaker odds alone can never qualify a pick.
    const minPointEdge =
      pick.sport === "basketball"
        ? c.family === "team_total" ? 2 : c.period === "match" ? 3 : 1.5
        : 0.15;
    if (math.edge < minPointEdge) return null;
    const projectionScore = Math.max(0, Math.min(100, 50 + 10 * (math.edge / Math.max(1, stats[0]!.deviation))));
    const valueScore = Math.max(0, Math.min(100, 50 + 250 * probabilityEdge));
    score = Math.round(0.45 * hitScore + 0.4 * projectionScore + 0.15 * valueScore);
    mathNote = ` Mathematical projection ${math.projection.toFixed(1)} vs line ${line.toFixed(1)} (edge +${math.edge.toFixed(1)}); estimated Over probability ${(100 * math.probability).toFixed(0)}% vs odds-implied ${(100 * implied).toFixed(0)}%.`;
  }
  if (score < p.minModelScore) return null;
  return {
    score,
    series: stats,
    sources: [...new Set([...homeRows, ...awayRows].map((r) => r.source))],
    summary: stats
      .map(
        (s, i) =>
          `${i === 0 ? "Recent scoring" : c.family === "team_total" ? "Opponent allowed" : "Opponent games"}: ${s.hits} of ${s.sample} ${c.period} results exceeded ${line}; median ${s.median.toFixed(1)}, trimmed mean ${s.trimmedMean.toFixed(1)}.`,
      )
      .join(" ") + mathNote,
    warnings: [
      ...(evidence.warnings ?? []),
      ...(smallestSample < 5
        ? [`Limited historical sample: only ${smallestSample} relevant result${smallestSample === 1 ? "" : "s"} in the smallest series; confidence was reduced.`]
        : []),
    ],
  };
}

/** Optional enrichment cannot discard evidence already returned by source adapters. */
export async function beforeResearchDeadline<T>(work: () => Promise<T>, deadline: number): Promise<T | undefined> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), remaining); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export type HistoryEvidenceMap = Map<string, Evidence> & {
  sourceFailures?: string[];
  fallbackUsed?: boolean;
  fallbackSource?: string;
};

/** Direct structured scores only. Parse and AI research are disabled for picking. */
export async function researchSelectionEvidence(
  picks: TicketPick[],
): Promise<HistoryEvidenceMap> {
  return researchEspnEvidence(picks);
}
