import { researchEspnEvidence } from "./espn-history";
import { researchFlashscoreEvidence, type HistoryEvidenceMap } from "./parse-flashscore";
import { canonicalMarket, SELECTION_POLICIES, type SelectionRisk } from "./selection-policy";
import { normalizeName } from "./bookmakers/normalize";
import { providerTeamName } from "./provider-names";
import { refreshKeys } from "./keys";
import { youAnswer, youContents, youKeys, youResearch } from "./you";
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
  const score = Math.round(
    100 * Math.min(...stats.map((s) => s.hitRate)) -
      (numerical ? 10 * Math.max(...stats.map(consistency)) : 0),
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
  /(^|\.)(espn\.com|nba\.com|wnba\.com|fiba\.basketball|euroleaguebasketball\.net|basketball-reference\.com|basketball\.com\.au|realgm\.com|eurobasket\.com|proballers\.com|sofascore\.com|scores24\.live|sportytrader\.com|fbref\.com|worldfootball\.net|soccerway\.com|flashscore\.com)$/;
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
/** Research responses are only candidates for evidence. Corroborate against readable source text. */
export async function researchSelectionEvidence(
  picks: TicketPick[],
): Promise<Map<string, Evidence>> {
  const deadline = Date.now() + 35_000;
  await refreshKeys();
  const [espn, flashscore] = await Promise.allSettled([
    researchEspnEvidence(picks), researchFlashscoreEvidence(picks),
  ]);
  const result: HistoryEvidenceMap = espn.status === "fulfilled" ? espn.value : new Map<string, Evidence>();
  result.sourceFailures = flashscore.status === "fulfilled" ? flashscore.value.sourceFailures : ["FlashScore history service failed"];
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
  const unresolved = picks.filter((pick) => {
    const present = result.get(pick.id);
    return !present || !assessEvidence(pick, present, "balanced");
  });
  if (!unresolved.length) return result;

  const webKeys = youKeys();
  const parseFailures =
    flashscore.status === "fulfilled"
      ? flashscore.value.sourceFailures ?? []
      : ["FlashScore history service failed"];
  if (!webKeys.length) {
    if (parseFailures.length)
      result.sourceFailures = [
        ...parseFailures,
        "Legacy web-history fallback unavailable: no You.com key is configured",
      ];
    console.info(
      "[history.fallback]",
      JSON.stringify({
        triggered: true,
        provider: "legacy_you_research",
        available: false,
        unresolvedPicks: unresolved.length,
        parseFailures,
      }),
    );
    return result;
  }

  result.fallbackUsed = true;
  result.fallbackSource = "legacy_you_research";
  console.info(
    "[history.fallback]",
    JSON.stringify({
      triggered: true,
      provider: "legacy_you_research",
      available: true,
      unresolvedPicks: unresolved.length,
      parseFailures,
    }),
  );

  const groups = new Map<string, TicketPick[]>();
  for (const pick of unresolved) {
    const c = canonicalMarket(pick);
    const key = `${pick.sporty?.eventId}:${c.period}:${metricFor(pick)}`;
    groups.set(key, [...(groups.get(key) ?? []), pick]);
  }
  const fastWebFallback =
    parseFailures.length > 0 &&
    (flashscore.status !== "fulfilled" || flashscore.value.size === 0);
  const jobs = [...groups.values()].sort((a, b) => {
    const priority = (group: TicketPick[]) => {
      const first = group[0]!;
      const market = canonicalMarket(first);
      return market.period === "match" && metricFor(first) === "score" ? 0 : 1;
    };
    return priority(a) - priority(b);
  });
  let cursor = 0;
  const sources = new Map<string, Promise<string>>();
  await beforeResearchDeadline(() => Promise.all(
    Array.from({ length: Math.min(fastWebFallback ? 8 : 4, jobs.length) }, async () => {
      while (cursor < jobs.length && Date.now() < deadline) {
        const group = jobs[cursor++]!;
        const pick = group[0]!;
        const c = canonicalMarket(pick);
        try {
          const query = `Find the 10 most recent completed games for EACH team: "${pick.home}" and "${pick.away}" (${pick.sport}), before ${new Date(Math.min(Date.now(), pick.kickoff ?? Date.now())).toISOString().slice(0, 10)}. ONLY ${c.period} ${metricFor(pick)}. Return up to 20 exact score rows, ideally 10 involving each team. Results/scores only, no predictions. JSON {"rows":[{"date":"YYYY-MM-DD","home":"team","away":"team","homeValue":0,"awayValue":0,"source":"https://result-page"}]}.`;
          // A truncated query must never lose its scope/schema.
          if (query.length > 400) continue;
          let answer = await youAnswer(
            query,
            Math.max(1, Math.min(fastWebFallback ? 6_000 : 10_000, deadline - Date.now())),
            fastWebFallback ? null : "week",
          );
          let json = answer.match(/\{[\s\S]*\}/)?.[0];
          let parsed = json ? JSON.parse(json) : null;
          if (
            fastWebFallback &&
            (!Array.isArray(parsed?.rows) || parsed.rows.length < 16) &&
            Date.now() < deadline - 2_000
          ) {
            const researched = await youResearch(
              `${query} Return ONLY the requested JSON object. Search the web for exact completed results. Aim for 20 rows: 10 involving each named team. Every row needs a real result-page source URL; omit anything uncertain.`,
              Math.max(1, Math.min(8_000, deadline - Date.now())),
            );
            const researchedJson = researched.match(/\{[\s\S]*\}/)?.[0];
            if (researchedJson) {
              const researchedParsed = JSON.parse(researchedJson);
              if (
                Array.isArray(researchedParsed?.rows) &&
                (!Array.isArray(parsed?.rows) || researchedParsed.rows.length > parsed.rows.length)
              ) {
                answer = researched;
                json = researchedJson;
                parsed = researchedParsed;
              }
            }
          }
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
            const native = (name: string) => {
              const normalized = providerTeamName(name, pick.sport);
              if (normalized === providerTeamName(pick.home, pick.sport)) return pick.home;
              if (normalized === providerTeamName(pick.away, pick.sport)) return pick.away;
              return name;
            };
            const rowHome = native(raw.home);
            const rowAway = native(raw.away);
            const rowDate = Date.parse(raw.date);
            const belongsToFixtureTeam =
              [rowHome, rowAway].some(
                (name) => normalizeName(name) === normalizeName(pick.home),
              ) ||
              [rowHome, rowAway].some(
                (name) => normalizeName(name) === normalizeName(pick.away),
              );
            if (
              !belongsToFixtureTeam ||
              !Number.isFinite(rowDate) ||
              rowDate >= Math.min(Date.now(), pick.kickoff ?? Date.now())
            )
              continue;

            const canUseFastGroundedRow =
              fastWebFallback && c.period === "match" && metricFor(pick) === "score";
            if (!canUseFastGroundedRow) {
              if (!sources.has(raw.source))
                sources.set(
                  raw.source,
                  youContents(raw.source).catch(() => ""),
                );
              const source = (await sources.get(raw.source))!
                .toLowerCase()
                .replace(/\s+/g, " ");
              // Legacy web fallback: corroborate each claimed result against the trusted
              // source page. Full-game rows do not require the literal word "final" next
              // to the score because many score pages omit it; period markets still do.
              const scorePattern = new RegExp(
                `\\b${raw.homeValue}\\s*[-:–]\\s*${raw.awayValue}\\b`,
              );
              const scoreMatch = scorePattern.exec(source);
              if (!scoreMatch) continue;
              const window = source.slice(
                Math.max(0, scoreMatch.index - 900),
                Math.min(source.length, scoreMatch.index + scoreMatch[0].length + 900),
              );
              const teamVisible = (name: string) => {
                const exact = name.toLowerCase();
                if (window.includes(exact)) return true;
                const words = normalizeName(name)
                  .split(" ")
                  .filter((word) => word.length >= 4);
                if (!words.length) return false;
                const hits = words.filter((word) => window.includes(word)).length;
                return hits >= Math.min(2, words.length);
              };
              const parsedDate = new Date(raw.date);
              const dateNeedles = Number.isFinite(parsedDate.getTime())
                ? [
                    raw.date.toLowerCase(),
                    parsedDate.toISOString().slice(0, 10),
                    parsedDate.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    }).toLowerCase(),
                    parsedDate.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    }).toLowerCase(),
                  ]
                : [raw.date.toLowerCase()];
              const dateVisible = dateNeedles.some((needle) => source.includes(needle));
              const periodVisible =
                c.period === "match"
                  ? true
                  : c.period === "first_half"
                    ? /first half|1st half|half.time/.test(window)
                    : c.period === "second_half"
                      ? /second half|2nd half/.test(window)
                      : new RegExp(
                          `${c.period}|${c.period.slice(1)}(?:st|nd|rd|th) quarter`,
                        ).test(window);
              const metricVisible =
                metricFor(pick) === "score" || window.includes(metricFor(pick));
              const matched =
                teamVisible(raw.home) &&
                teamVisible(raw.away) &&
                dateVisible &&
                periodVisible &&
                metricVisible;
              if (!matched) continue;
            }
            rows.push({
              ...raw,
              home: rowHome,
              away: rowAway,
              id: `${raw.date}:${rowHome}:${rowAway}`,
              period: c.period,
              metric: metricFor(pick),
              corroborated: true,
            });
          }
          const evidence = {
            rows,
            checkedAt: Date.now(),
            warnings: [
              fastWebFallback
                ? "Parse history was unavailable; SlipCut used the legacy You.com web-history route with trusted source URLs."
                : "Injuries, pace, season ratings, rest and travel were not independently verified.",
            ],
          };
          if (Date.now() >= deadline) break;
          for (const option of group) {
            if ((result.get(option.id)?.rows.length ?? 0) < evidence.rows.length)
              result.set(option.id, evidence);
          }
        } catch {
          /* Missing or unverifiable history never becomes positive evidence. */
        }
      }
    }),
  ), deadline);
  const fallbackEvidence = unresolved.filter((pick) => (result.get(pick.id)?.rows.length ?? 0) > 0).length;
  console.info(
    "[history.fallback]",
    JSON.stringify({
      completed: true,
      provider: "legacy_you_research",
      fallbackEvidence,
      unresolvedPicks: unresolved.length,
      totalEvidencePicks: result.size,
    }),
  );
  if (fallbackEvidence > 0 && result.sourceFailures?.length)
    result.sourceFailures = result.sourceFailures.map((failure) => `${failure} (fallback active)`);
  return result;
}
