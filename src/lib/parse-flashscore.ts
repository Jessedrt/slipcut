import { normalizeName } from "./bookmakers/normalize";
import { providerTeamName, providerCountryName } from "./provider-names";
import { canonicalMarket } from "./selection-policy";
import type { Evidence, HistoryRow } from "./selection-evidence";
import type { TicketPick } from "./types";

const CANONICAL = "e4c11d5d-7c48-4a9d-9141-7abf0692ddcd";
type Fixture = {
  match_id?: string; status?: string; start_time?: string;
  home_team?: { name?: string }; away_team?: { name?: string };
  competition?: { name?: string; country?: string };
};
type Result = {
  match_id?: string; date?: string; home_team?: string; away_team?: string;
  home_score?: string | number; away_score?: string | number; score?: string;
  status?: string;
};
type Preview = { match_id?: string; home_team?: string; away_team?: string;
  home_form?: Result[]; away_form?: Result[]; h2h?: Result[] };
type Config = { apiKey?: string; scraperId?: string; fetcher?: typeof fetch;
  now?: number; maxCalls?: number };
const cache = new Map<string, { until: number; value: Promise<unknown> }>();
export function clearFlashscoreCacheForTests() { cache.clear(); }

/** Require an unambiguous fixture, with the same sport, teams, competition and time. */
export function matchFlashscoreFixture(pick: TicketPick, fixtures: Fixture[]): Fixture | undefined {
  if (!pick.kickoff) return;
  const team = (name: string) => providerTeamName(name, pick.sport);
  const matches = fixtures.filter((f) => {
    if (!f.match_id || !["not_started", "scheduled"].includes(f.status ?? "")) return false;
    if (team(f.home_team?.name ?? "") !== team(pick.home) ||
        team(f.away_team?.name ?? "") !== team(pick.away)) return false;
    const time = Date.parse(f.start_time ?? "");
    if (!Number.isFinite(time) || Math.abs(time - pick.kickoff!) > 15 * 60_000) return false;
    const league = normalizeName(f.competition?.name ?? "");
    const expected = normalizeName(pick.league);
    if (!league || !expected || !(league.includes(expected) || expected.includes(league) ||
      (f.competition?.country && expected === normalizeName(`${f.competition.country} ${f.competition.name?.split(":").at(-1) ?? ""}`)))) return false;
    const internationalEurope = pick.sport === "basketball" &&
      /^(euroleague|eurocup|fiba europe cup)$/.test(expected) &&
      providerCountryName(pick.country ?? "") === "international" &&
      providerCountryName(f.competition?.country ?? "") === "europe";
    return !pick.country || internationalEurope || providerCountryName(pick.country) === providerCountryName(f.competition?.country ?? "");
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/** Preview results document final scores only. Never reinterpret these as period scores. */
export function evidenceFromFlashscore(pick: TicketPick, preview: Preview, now = Date.now()): Evidence {
  const rows: HistoryRow[] = [];
  const c = canonicalMarket(pick);
  const team = (name: string) => providerTeamName(name, pick.sport);
  const evidence: Evidence = { rows, checkedAt: now, warnings: [
    "FlashScore final-score history; injuries, pace, rest and travel were not independently verified.",
  ] };
  if (c.period !== "match" || !["total", "team_total", "btts", "winner", "double_chance"].includes(c.family)) return evidence;
  // Basketball final scores can include overtime; regulation markets need explicit period data.
  if (pick.sport === "basketball" && !/incl(?:uding|\.)?.*overtime|overtime.*incl/i.test(pick.market) &&
      !["225", "227", "228"].includes(pick.sporty?.marketId ?? "")) return evidence;
  if (!preview.match_id || team(preview.home_team ?? "") !== team(pick.home) ||
      team(preview.away_team ?? "") !== team(pick.away)) return evidence;
  const seen = new Set<string>();
  for (const r of [...(preview.home_form ?? []), ...(preview.away_form ?? []), ...(preview.h2h ?? [])]) {
    if (!r.match_id || seen.has(r.match_id) || !r.date || !r.home_team || !r.away_team ||
        (r.status && r.status !== "finished")) continue;
    const date = Date.parse(r.date);
    if (!Number.isFinite(date) || date >= Math.min(now, pick.kickoff ?? now)) continue;
    const names = [r.home_team, r.away_team].map(team);
    if (!names.includes(team(pick.home)) && !names.includes(team(pick.away))) continue;
    const pair = r.score?.match(/^(\d+)\s*:\s*(\d+)$/);
    const value = (v: unknown): number | undefined => {
      if (typeof v !== "number" && !(typeof v === "string" && /^\d+$/.test(v))) return;
      const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : undefined;
    };
    const homeValue = value(r.home_score ?? pair?.[1]), awayValue = value(r.away_score ?? pair?.[2]);
    if (homeValue === undefined || awayValue === undefined) continue;
    // Conflicting score fields indicate an unreliable provider row.
    if (pair && (homeValue !== Number(pair[1]) || awayValue !== Number(pair[2]))) continue;
    seen.add(r.match_id);
    const native = (name: string) => team(name) === team(pick.home) ? pick.home : team(name) === team(pick.away) ? pick.away : name;
    rows.push({ id: `flashscore:${r.match_id}`, date: r.date, home: native(r.home_team),
      away: native(r.away_team), homeValue, awayValue, period: "match", metric: "score",
      source: `https://www.flashscore.com/match/${encodeURIComponent(r.match_id)}/`, corroborated: true });
  }
  return evidence;
}

/** Server-side Parse adapter. Bounded calls, cached data, no bookmaker odds substitution. */
export async function researchFlashscoreEvidence(picks: TicketPick[], config: Config = {}): Promise<Map<string, Evidence>> {
  const result = new Map<string, Evidence>();
  const apiKey = config.apiKey ?? process.env.PARSE_API_KEY;
  const scraperId = config.scraperId ?? process.env.PARSE_FLASHSCORE_SCRAPER_ID ?? CANONICAL;
  if (!apiKey || !/^[a-zA-Z0-9-]+$/.test(scraperId)) {
    console.info("[flashscore.parse]", JSON.stringify({ configured: Boolean(apiKey), validScraperId: /^[a-zA-Z0-9-]+$/.test(scraperId), calls: 0 }));
    return result;
  }
  const now = config.now ?? Date.now(), deadline = Date.now() + 25_000;
  const fetcher = config.fetcher ?? fetch;
  const budget = Math.max(0, Math.min(30, config.maxCalls ?? 12));
  let calls = 0;
  let succeeded = 0, cacheHits = 0;
  const failures: string[] = [];
  async function call(endpoint: string, input: object): Promise<any> {
    const key = JSON.stringify([apiKey, scraperId, endpoint, input]);
    const existing = cache.get(key);
    if (existing && existing.until > now) {
      cacheHits++;
      try { return await existing.value; } catch { return null; }
    }
    if (calls >= budget || Date.now() >= deadline) return null;
    calls++;
    const value = (async () => {
      const response = await fetcher(`https://api.parse.bot/scraper/${scraperId}/${endpoint}`, {
        method: "POST", headers: { "X-API-Key": apiKey!, "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
      });
      if (!response.ok) {
        failures.push(`${endpoint}:HTTP_${response.status}`);
        throw new Error("Parse request failed");
      }
      const payload = await response.json();
      if (payload.status && payload.status !== "success") {
        failures.push(`${endpoint}:provider_rejected`);
        throw new Error("Parse response rejected");
      }
      succeeded++;
      return payload.data ?? payload;
    })();
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: now + (endpoint === "get_daily_fixtures" ? 5 : 30) * 60_000, value });
    try { return await value; } catch {
      if (!failures.some((f) => f.startsWith(`${endpoint}:`))) failures.push(`${endpoint}:request_failed`);
      cache.delete(key); return null;
    }
  }
  const day = (time: number) => Math.floor(time / 86400_000);
  const daily = new Map<string, Fixture[]>(), previews = new Map<string, Promise<Preview | null>>();
  const dailyJobs = new Map<string, Promise<void>>();
  const groups = new Map<string, TicketPick[]>();
  for (const pick of picks) {
    const c = canonicalMarket(pick);
    if (!pick.kickoff || c.period !== "match" || !["total", "team_total", "btts", "winner", "double_chance"].includes(c.family)) continue;
    const key = `${pick.sport}:${pick.sporty?.eventId ?? `${pick.home}:${pick.away}`}:${pick.kickoff}`;
    groups.set(key, [...(groups.get(key) ?? []), pick]);
  }
  const jobs = [...groups.values()];
  let cursor = 0;
  const unmatched = new Map<string, unknown>();
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
  while (cursor < jobs.length) {
    const options = jobs[cursor++]!;
    const pick = options[0]!;
    if (!pick.kickoff || !["football", "basketball"].includes(pick.sport)) continue;
    // Only documented final-score scopes consume Parse credits; ESPN handles periods.
    const c = canonicalMarket(pick);
    if (c.period !== "match" || !["total", "team_total", "btts", "winner", "double_chance"].includes(c.family)) continue;
    const offset = day(pick.kickoff) - day(now);
    if (offset < 0 || offset > 7) continue;
    const key = `${pick.sport}:${offset}`;
    if (!dailyJobs.has(key)) dailyJobs.set(key, (async () => {
      const data = await call("get_daily_fixtures", { sport: pick.sport, day_offset: offset, exclude_youth: true });
      daily.set(key, data?.sport === pick.sport && Array.isArray(data.matches) ? data.matches : []);
    })());
    await dailyJobs.get(key);
    const fixture = matchFlashscoreFixture(pick, daily.get(key)!);
    if (!fixture?.match_id) {
      const event = pick.sporty?.eventId ?? `${pick.home}:${pick.away}`;
      if (unmatched.size < 5 && !unmatched.has(event)) {
        const candidates = daily.get(key)!.filter((f) =>
          Math.abs(Date.parse(f.start_time ?? "") - pick.kickoff!) <= 15 * 60_000 ||
          [f.home_team?.name, f.away_team?.name].some((name) =>
            name && [pick.home, pick.away].some((team) => normalizeName(name) === normalizeName(team))),
        ).sort((a, b) => {
          // Diagnostic ordering only; never used to approve a fixture mapping.
          const relevance = (f: Fixture) => Number(normalizeName(f.competition?.name ?? "").includes(normalizeName(pick.league))) * 100 +
            [f.home_team?.name, f.away_team?.name].reduce((score, name, i) => score +
              normalizeName(name ?? "").split(" ").filter((word) => word.length > 3 && normalizeName(i ? pick.away : pick.home).includes(word)).length, 0);
          return relevance(b) - relevance(a);
        }).slice(0, 1).map((f) => ({ home: f.home_team?.name, away: f.away_team?.name,
          league: f.competition?.name, country: f.competition?.country, kickoff: f.start_time, status: f.status }));
        unmatched.set(event, { expected: { home: pick.home, away: pick.away, league: pick.league,
          country: pick.country, kickoff: new Date(pick.kickoff).toISOString() }, candidates });
      }
      continue;
    }
    if (!previews.has(fixture.match_id)) {
      previews.set(fixture.match_id, (async () => {
        const preview = await call("get_match_preview", { match_id: fixture.match_id });
        return preview?.match_id === fixture.match_id ? preview : null;
      })());
    }
    const preview = await previews.get(fixture.match_id);
    if (preview) {
      for (const option of options) {
        const evidence = evidenceFromFlashscore(option, preview, now);
        if (evidence.rows.length) result.set(option.id, evidence);
      }
    }
  }
  }));
  console.info("[flashscore.parse]", JSON.stringify({ configured: true, calls, succeeded,
    cacheHits, mappedFixtures: previews.size, evidencePicks: result.size, failures,
    fixtureCounts: Object.fromEntries([...daily].map(([key, fixtures]) => [key, fixtures.length])),
    unmatched: [...unmatched.values()] }));
  return result;
}
