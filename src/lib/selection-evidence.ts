import { researchEspnEvidence } from "./espn-history";
import { researchFlashscoreEvidence } from "./parse-flashscore";
import { canonicalMarket, SELECTION_POLICIES, type SelectionRisk } from "./selection-policy";
import { normalizeName } from "./bookmakers/normalize";
import { refreshKeys } from "./keys";
import { youAnswer, youContents, youKeys } from "./you";
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
    const splitO = offenseRows.filter((r) => same(c.scope === "home" ? r.home : r.away, team));
    const splitD = defenseRows.filter((r) => same(c.scope === "home" ? r.away : r.home, opponent));
    if (splitO.length < 3 || splitD.length < 3) return null;
    if (
      splitO.filter((r) => valueFor(r, team) > line).length / splitO.length < p.minHitRate ||
      splitD.filter((r) => allowedBy(r, opponent) > line).length / splitD.length < p.minHitRate
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
        split.length < 3 ||
        split.filter((r) => get(r) > line).length / split.length < p.minHitRate
      )
        return null;
    }
  }
  const stats = series.map((v) => summarize(v, line));
  const numerical = !["btts", "winner", "double_chance"].includes(c.family);
  if (
    stats.some(
      (s) =>
        s.hitRate < p.minHitRate ||
        (numerical && (s.median <= line || s.trimmedMean <= line || s.variation > p.maxVariation)),
    )
  )
    return null;
  // Remove detected high outliers, not two ordinary wins. Dropping the two
  // largest values unconditionally secretly raises an 80% requirement to 90%.
  if (
    numerical &&
    stats.some((s) => {
      const deviations = s.values.map((v) => Math.abs(v - s.median)).sort((a, b) => a - b);
      const mad = (deviations[Math.floor((s.sample - 1) / 2)]! + deviations[Math.floor(s.sample / 2)]!) / 2;
      const highCutoff = s.median + Math.max(3, 3 * 1.4826 * mad);
      const robust = s.values.filter((v) => v <= highCutoff);
      if (robust.length === s.sample) return false;
      return robust.filter((v) => v > line).length / robust.length < p.minHitRate;
    })
  )
    return null;
  const score = Math.round(
    100 * Math.min(...stats.map((s) => s.hitRate)) -
      (numerical ? 10 * Math.max(...stats.map((s) => s.variation)) : 0),
  );
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
      .join(" "),
    warnings: evidence.warnings ?? [],
  };
}

const TRUSTED =
  /(^|\.)(espn\.com|nba\.com|wnba\.com|fiba\.basketball|euroleaguebasketball\.net|basketball-reference\.com|fbref\.com|worldfootball\.net|soccerway\.com|flashscore\.com)$/;
/** Research responses are only candidates for evidence. Corroborate against readable source text. */
export async function researchSelectionEvidence(
  picks: TicketPick[],
): Promise<Map<string, Evidence>> {
  const deadline = Date.now() + 35_000;
  await refreshKeys();
  const [espn, flashscore] = await Promise.allSettled([
    researchEspnEvidence(picks), researchFlashscoreEvidence(picks),
  ]);
  const result = espn.status === "fulfilled" ? espn.value : new Map<string, Evidence>();
  if (flashscore.status === "fulfilled") {
    for (const pick of picks) {
      const candidate = flashscore.value.get(pick.id);
      if (!candidate) continue;
      const existing = result.get(pick.id);
      // Keep each assessment on a single source rather than double-counting games.
      const strength = (e: Evidence) => assessEvidence(pick, e, "conservative") ? 2 : assessEvidence(pick, e, "balanced") ? 1 : 0;
      if (!existing || strength(candidate) > strength(existing) ||
          (strength(candidate) === strength(existing) && candidate.rows.length > existing.rows.length))
        result.set(pick.id, candidate);
    }
  }
  if (!youKeys().length) return result;
  const groups = new Map<string, TicketPick[]>();
  for (const pick of picks) {
    const present = result.get(pick.id);
    if (present && assessEvidence(pick, present, "balanced")) continue;
    const c = canonicalMarket(pick);
    const key = `${pick.sporty?.eventId}:${c.period}:${metricFor(pick)}`;
    groups.set(key, [...(groups.get(key) ?? []), pick]);
  }
  const jobs = [...groups.values()];
  let cursor = 0;
  const sources = new Map<string, Promise<string>>();
  await Promise.all(
    Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length && Date.now() < deadline) {
        const group = jobs[cursor++]!;
        const pick = group[0]!;
        const c = canonicalMarket(pick);
        try {
          const query = `Last 10 games each ${pick.home} / ${pick.away} (${pick.sport}), ONLY ${c.period} ${metricFor(pick)}. JSON {"rows":[{"date":"YYYY-MM-DD","home":"team","away":"team","homeValue":0,"awayValue":0,"source":"https://result-page"}]}. Exact sourced results, no estimates; omit missing scope. ESPN/official league/FIBA/FBref.`;
          // A truncated query must never lose its scope/schema.
          if (query.length > 400) continue;
          const answer = await youAnswer(query, 10_000);
          const json = answer.match(/\{[\s\S]*\}/)?.[0];
          const parsed = json ? JSON.parse(json) : null;
          if (!Array.isArray(parsed?.rows)) continue;
          const rows: HistoryRow[] = [];
          for (const raw of parsed.rows.slice(0, 24)) {
            if (Date.now() >= deadline) break;
            if (
              !raw ||
              typeof raw.source !== "string" ||
              typeof raw.home !== "string" ||
              typeof raw.away !== "string" ||
              typeof raw.date !== "string" ||
              typeof raw.homeValue !== "number" ||
              typeof raw.awayValue !== "number"
            )
              continue;
            const url = new URL(raw.source);
            if (
              url.protocol !== "https:" ||
              !TRUSTED.test(url.hostname) ||
              url.username ||
              url.password
            )
              continue;
            if (!sources.has(raw.source))
              sources.set(
                raw.source,
                youContents(raw.source).catch(() => ""),
              );
            const source = (await sources.get(raw.source))!.toLowerCase();
            // Require a single result excerpt containing both exact team names, date,
            // score pair and period; never corroborate from unrelated numbers on a page.
            const periodLabel =
              c.period === "match"
                ? /final|full.time|result/
                : c.period === "first_half"
                  ? /first half|1st half|half.time/
                  : c.period === "second_half"
                    ? /second half|2nd half/
                    : new RegExp(`${c.period}|${c.period.slice(1)}(?:st|nd|rd|th) quarter`);
            const matched = source
              .split(/\n/)
              .some(
                (span) =>
                  span.includes(raw.home.toLowerCase()) &&
                  span.includes(raw.away.toLowerCase()) &&
                  span.includes(raw.date) &&
                  new RegExp(`\\b${raw.homeValue}\\s*[-:–]\\s*${raw.awayValue}\\b`).test(span) &&
                  periodLabel.test(span) &&
                  (metricFor(pick) === "score" || span.includes(metricFor(pick))),
              );
            if (!matched) continue;
            rows.push({
              ...raw,
              id: `${raw.date}:${raw.home}:${raw.away}`,
              period: c.period,
              metric: metricFor(pick),
              corroborated: true,
            });
          }
          const evidence = {
            rows,
            checkedAt: Date.now(),
            warnings: [
              "Injuries, pace, season ratings, rest and travel were not independently verified.",
            ],
          };
          for (const option of group) {
            if ((result.get(option.id)?.rows.length ?? 0) < evidence.rows.length)
              result.set(option.id, evidence);
          }
        } catch {
          /* Missing or unverifiable history never becomes positive evidence. */
        }
      }
    }),
  );
  return result;
}
