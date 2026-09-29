import { normalizeName } from "./bookmakers/normalize";
import { canonicalMarket } from "./selection-policy";
import type { Evidence, HistoryRow } from "./selection-evidence";
import type { TicketPick } from "./types";

type Score = { value?: number; period?: number };
type Competitor = {
  homeAway?: string;
  score?: string | { value?: number };
  team?: { displayName?: string; shortDisplayName?: string; name?: string };
  linescores?: Score[];
};
type Event = {
  id?: string;
  date?: string;
  status?: { type?: { completed?: boolean } };
  competitions?: Array<{ status?: { type?: { completed?: boolean } }; competitors?: Competitor[] }>;
  links?: Array<{ href?: string }>;
};
const leagues: Array<[RegExp, string]> = [
  [/england premier league|^premier league$/i, "soccer/eng.1"],
  [/england championship/i, "soccer/eng.2"],
  [/la ?liga|laliga/i, "soccer/esp.1"],
  [/italy serie a|^serie a$/i, "soccer/ita.1"],
  [/bundesliga/i, "soccer/ger.1"],
  [/ligue 1/i, "soccer/fra.1"],
  [/eredivisie/i, "soccer/ned.1"],
  [/liga portugal|primeira/i, "soccer/por.1"],
  [/major league soccer|\bmls\b/i, "soccer/usa.1"],
  [/\beuroleague\b/i, "basketball/euroleague"],
  [/\bwnba\b/i, "basketball/wnba"],
  [/\bnba\b/i, "basketball/nba"],
  [/ncaa.*women|women.*ncaa/i, "basketball/womens-college-basketball"],
  [/\bncaa\b/i, "basketball/mens-college-basketball"],
];
export function espnLeague(pick: TicketPick): string | undefined {
  return leagues.find(
    ([re, path]) =>
      path.startsWith(pick.sport === "football" ? "soccer/" : "basketball/") &&
      re.test(pick.league),
  )?.[1];
}
function score(
  c: Competitor,
  period: ReturnType<typeof canonicalMarket>["period"],
  path: string,
  includeOvertime: boolean,
): number | null {
  if (period === "match" && (path.startsWith("soccer/") || includeOvertime)) {
    const raw = typeof c.score === "object" ? c.score.value : c.score;
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const halves = path === "basketball/mens-college-basketball" || path.startsWith("soccer/");
  const count = halves ? 2 : 4;
  let periods: number[] = [];
  if (period === "match") periods = Array.from({ length: count }, (_, i) => i + 1);
  else if (period === "first_half") periods = halves ? [1] : [1, 2];
  else if (period === "second_half") periods = halves ? [2] : [3, 4];
  else if (period.startsWith("q") && !halves) periods = [Number(period.slice(1))];
  if (!periods.length) return null;
  const values = periods.map((p) => c.linescores?.find((s) => s.period === p)?.value);
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}
/** Exact team matching and explicit period scores; no estimation or scope fallback. */
export function evidenceFromEspn(
  pick: TicketPick,
  path: string,
  events: Event[],
  checkedAt = Date.now(),
): Evidence {
  const c = canonicalMarket(pick);
  const rows: HistoryRow[] = [];
  if (!["total", "team_total", "btts", "winner", "double_chance"].includes(c.family))
    return { rows, checkedAt };
  const includeOvertime =
    /incl(?:uding|\.)?.*overtime|overtime.*incl/i.test(pick.market) ||
    ["225", "227", "228"].includes(pick.sporty?.marketId ?? "");
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!ev.id || !ev.date || !(comp?.status?.type?.completed ?? ev.status?.type?.completed))
      continue;
    const h = comp?.competitors?.find((c) => c.homeAway === "home"),
      a = comp?.competitors?.find((c) => c.homeAway === "away");
    if (!h || !a) continue;
    // Use a native exact alias that matches the requested team, if available.
    const name = (team: Competitor) => {
      const names = [team.team?.displayName, team.team?.shortDisplayName, team.team?.name].filter(
        (n): n is string => !!n,
      );
      return (
        names.find((n) =>
          [pick.home, pick.away].some((t) => normalizeName(t) === normalizeName(n)),
        ) ??
        names[0] ??
        ""
      );
    };
    const home = name(h),
      away = name(a);
    if (
      ![home, away].some((n) =>
        [pick.home, pick.away].some((t) => normalizeName(t) === normalizeName(n)),
      )
    )
      continue;
    const homeValue = score(h, c.period, path, includeOvertime),
      awayValue = score(a, c.period, path, includeOvertime);
    if (homeValue === null || awayValue === null) continue;
    rows.push({
      id: ev.id,
      date: ev.date,
      home,
      away,
      homeValue,
      awayValue,
      period: c.period,
      metric: "score",
      source:
        ev.links?.find((l) => l.href?.startsWith("https://www.espn.com/"))?.href ??
        `https://www.espn.com/${path.startsWith("soccer") ? "soccer" : "basketball"}/game/_/gameId/${ev.id}`,
      corroborated: true,
    });
  }
  return {
    rows,
    checkedAt,
    warnings: ["Injuries, pace, season ratings, rest and travel were not independently verified."],
  };
}
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
async function espnJson(url: string, deadline: number): Promise<any> {
  if (Date.now() >= deadline) return null;
  const prior = cache.get(url);
  if (prior && Date.now() - prior.at < 15 * 60_000) return prior.value;
  if (cache.size > 1000) cache.clear();
  const value = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(8000, Math.max(1, deadline - Date.now())),
    );
    try {
      const response = await fetch(url, { signal: controller.signal });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(url, { at: Date.now(), value });
  return value;
}
export async function researchEspnEvidence(picks: TicketPick[]): Promise<Map<string, Evidence>> {
  const result = new Map<string, Evidence>();
  const deadline = Date.now() + 28_000;
  const paths = [...new Set(picks.map(espnLeague).filter((p): p is string => !!p))];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (cursor < paths.length && Date.now() < deadline) {
        const path = paths[cursor++]!;
        const group = picks.filter((p) => espnLeague(p) === path);
        const base = `https://site.api.espn.com/apis/site/v2/sports/${path}`;
        const teams = await espnJson(`${base}/teams?limit=1000`, deadline);
        const list = teams?.sports?.[0]?.leagues?.[0]?.teams;
        if (!Array.isArray(list)) continue;
        const required = new Set(
          group.flatMap((p) => [normalizeName(p.home), normalizeName(p.away)]),
        );
        const ids = list
          .filter((t) =>
            [t.team?.displayName, t.team?.shortDisplayName, t.team?.name].some(
              (n) => typeof n === "string" && required.has(normalizeName(n)),
            ),
          )
          .map((t) => t.team?.id)
          .filter(Boolean);
        const year = new Date().getUTCFullYear();
        const jobs = ids.flatMap((id) =>
          [year, year - 1].map(
            (season) => `${base}/teams/${encodeURIComponent(id)}/schedule?season=${season}`,
          ),
        );
        const all: Event[] = [];
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(6, jobs.length) }, async () => {
            while (next < jobs.length && Date.now() < deadline) {
              const data = await espnJson(jobs[next++]!, deadline);
              if (Array.isArray(data?.events)) all.push(...data.events);
            }
          }),
        );
        const events = [
          ...new Map(
            all
              .filter(
                (e) =>
                  e.id &&
                  e.date &&
                  Date.parse(e.date) < Date.now() &&
                  (e.competitions?.[0]?.status?.type?.completed ?? e.status?.type?.completed),
              )
              .sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!))
              .map((e) => [e.id, e]),
          ).values(),
        ];
        // Schedule responses expose exact final scores. Period markets additionally
        // require summary line-scores; absence never causes a full-game substitution.
        if (
          group.some(
            (p) =>
              canonicalMarket(p).period !== "match" ||
              (p.sport === "basketball" &&
                !/overtime/i.test(p.market) &&
                !["225", "227", "228"].includes(p.sporty?.marketId ?? "")),
          )
        ) {
          const wanted = new Set<string>();
          for (const p of group)
            for (const team of [p.home, p.away]) {
              const recent = events
                .filter((e) =>
                  e.competitions?.[0]?.competitors?.some((c) =>
                    [c.team?.displayName, c.team?.shortDisplayName, c.team?.name].some(
                      (n) => typeof n === "string" && normalizeName(n) === normalizeName(team),
                    ),
                  ),
                )
                .slice(0, 10);
              recent.forEach((e) => wanted.add(e.id!));
            }
          const summaries = events.filter((e) => wanted.has(e.id!));
          let at = 0;
          await Promise.all(
            Array.from({ length: Math.min(6, summaries.length) }, async () => {
              while (at < summaries.length && Date.now() < deadline) {
                const ev = summaries[at++]!;
                const data = await espnJson(
                  `${base}/summary?event=${encodeURIComponent(ev.id!)}`,
                  deadline,
                );
                const competitors = data?.header?.competitions?.[0]?.competitors;
                if (Array.isArray(competitors) && ev.competitions?.[0]) {
                  // Preserve final schedule scores and copy only identified period arrays.
                  for (const c of ev.competitions[0].competitors ?? []) {
                    const source = competitors.find(
                      (s) =>
                        s.homeAway === c.homeAway &&
                        normalizeName(s.team?.displayName ?? "") ===
                          normalizeName(c.team?.displayName ?? ""),
                    );
                    if (Array.isArray(source?.linescores)) c.linescores = source.linescores;
                  }
                }
              }
            }),
          );
        }
        for (const pick of group) result.set(pick.id, evidenceFromEspn(pick, path, events));
      }
    }),
  );
  return result;
}
