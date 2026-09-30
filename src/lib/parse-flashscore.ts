import { createHash } from "node:crypto";
import { providerCacheStore, type ProviderCacheStore } from "./provider-cache";
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
  now?: number; maxCalls?: number; store?: ProviderCacheStore | false };
export type HistoryEvidenceMap = Map<string, Evidence> & { sourceFailures?: string[] };
const cooldowns = new Map<string, { until: number; reason: string }>();
let fetchedTimes = new WeakMap<object, number>();
const cache = new Map<string, { until: number; value: Promise<unknown> }>();
export function clearFlashscoreCacheForTests() { cache.clear(); cooldowns.clear(); fetchedTimes = new WeakMap(); }

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
    const continentalFootball = pick.sport === "football" &&
      ((providerCountryName(pick.country ?? "") === "international clubs" &&
        providerCountryName(f.competition?.country ?? "") === "europe" && /^uefa /.test(expected)) ||
       (providerCountryName(pick.country ?? "") === "international" &&
        providerCountryName(f.competition?.country ?? "") === "africa" &&
        expected === "africa cup of nations qualification"));
    return !pick.country || internationalEurope || continentalFootball || providerCountryName(pick.country) === providerCountryName(f.competition?.country ?? "");
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
export async function researchFlashscoreEvidence(picks: TicketPick[], config: Config = {}): Promise<HistoryEvidenceMap> {
  const result: HistoryEvidenceMap = new Map<string, Evidence>();
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
  result.sourceFailures = failures;
  const digest = (v: string) => createHash("sha256").update(v).digest("hex");
  const namespace = digest(`${apiKey}:${scraperId}`).slice(0, 24);
  const storage = config.store === false ? undefined : config.store ?? (config.fetcher ? undefined : providerCacheStore);
  const cooldownKey = `parse_cooldown_${namespace}`;
  let cooldown = cooldowns.get(namespace);
  try {
    const raw = await storage?.get(cooldownKey);
    if (raw) { const saved = JSON.parse(raw); if (saved.until > now) cooldown = saved; }
  } catch { /* Cache failure does not invent source data. */ }
  type Saved = { key: string; freshUntil: number; validUntil: number; fetchedAt: number; data: any };
  async function call(endpoint: string, input: object): Promise<any> {
    const identity = endpoint === "get_daily_fixtures" ? { ...input, day_offset: undefined,
      date: new Date(now + Number((input as { day_offset?: number }).day_offset ?? 0) * 86400_000).toISOString().slice(0, 10) } : input;
    const key = digest(JSON.stringify([namespace, endpoint, identity]));
    const slot = `parse_cache_${namespace}_${parseInt(key.slice(0, 4), 16) % 512}`;
    const existing = cache.get(key);
    if (existing && existing.until > now) {
      cacheHits++;
      try { return await existing.value; } catch { return null; }
    }
    const value = (async () => {
      let saved: Saved | undefined;
      try {
        const raw = await storage?.get(slot);
        const entry = raw ? JSON.parse(raw) : null;
        if (entry?.key === key && entry.validUntil > now && entry.fetchedAt <= now && now - entry.fetchedAt < 6 * 3_600_000 && entry.data) saved = entry;
      } catch { /* Read-through cache remains optional. */ }
      const reuse = () => {
        if (!saved) return null;
        cacheHits++;
        if (typeof saved.data === "object") fetchedTimes.set(saved.data, saved.fetchedAt);
        return saved.data;
      };
      if (saved && saved.freshUntil > now) return reuse();
      if (cooldown && cooldown.until > Date.now()) {
        if (!failures.includes(cooldown.reason)) failures.push(cooldown.reason);
        return reuse();
      }
      if (calls >= budget || Date.now() >= deadline) return reuse();
      calls++;
      try {
        const response = await fetcher(`https://api.parse.bot/scraper/${scraperId}/${endpoint}`, {
          method: "POST", headers: { "X-API-Key": apiKey!, "Content-Type": "application/json" },
          body: JSON.stringify(input), signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
        });
        if (!response.ok) {
          // Classify the error; never log the response body or credentials.
          const body = (await response.text()).slice(0, 4000).toLowerCase();
          const credit = /insufficient.{0,30}credit|credit.{0,30}(exhaust|deplet|limit|insufficient)|quota.{0,30}(exceed|exhaust)/.test(body);
          const reason = `Parse HTTP ${response.status}${credit ? ": credits or quota exhausted" : response.status === 429 ? ": request rate or quota limit" : ""}`;
          failures.push(reason);
          if (response.status === 429 || response.status === 402) {
            const retry = response.headers.get("retry-after");
            const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 60_000;
            cooldown = { until: Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000), reason };
            cooldowns.set(namespace, cooldown);
            try { await storage?.set(cooldownKey, JSON.stringify(cooldown)); } catch { /* Local cooldown still applies. */ }
          }
          return reuse();
        }
        const payload = await response.json();
        if (payload.status && payload.status !== "success") {
          failures.push("Parse rejected the history request");
          return reuse();
        }
        const data = payload.data ?? payload;
        const fetchedAt = now;
        if (data && typeof data === "object") fetchedTimes.set(data, fetchedAt);
        succeeded++;
        const entry: Saved = { key, fetchedAt, freshUntil: fetchedAt + (endpoint === "get_daily_fixtures" ? 5 : 30) * 60_000,
          validUntil: fetchedAt + 6 * 3_600_000, data };
        try { await storage?.set(slot, JSON.stringify(entry)); } catch { /* The live result remains usable. */ }
        return data;
      } catch {
        failures.push("Parse history request failed or timed out");
        return reuse();
      }
    })();
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: now + (endpoint === "get_daily_fixtures" ? 5 : 30) * 60_000, value });
    const data = await value;
    if (!data) cache.delete(key);
    return data;
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
        evidence.checkedAt = fetchedTimes.get(preview) ?? now;
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
