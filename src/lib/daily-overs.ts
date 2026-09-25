import { refreshKeys } from "./keys";
import { listDailyOverMarkets } from "./sportybet";
import { getSetting, setSetting } from "./study";
import type { BookSport, TicketPick } from "./types";
import { youAnswer, youKeys } from "./you";

export type DailyOversSport = Extract<BookSport, "football" | "basketball">;
export type DailyOversScope = DailyOversSport | "all";

export type H2hTotals = {
  totals: number[];
  checkedAt: number;
};

export type DailyOverRecommendation = {
  pick: TicketPick;
  sample: number;
  h2hAverage: number;
  h2hHitRate: number;
  pushes: number;
  margin: number;
  score: number;
  h2hTotals: number[];
};

export type DailyOversScan = {
  scope: DailyOversScope;
  scannedEvents: number;
  eventsWithConservativeOver: number;
  h2hVerifiedEvents: number;
  recommendations: DailyOverRecommendation[];
  warnings: string[];
};

type MatchGroup = {
  eventId: string;
  sport: DailyOversSport;
  home: string;
  away: string;
  league: string;
  kickoff?: number;
  picks: TicketPick[];
};

type CacheRow = Record<string, H2hTotals>;

function watDay(ms = Date.now()) {
  return new Date(ms + 3_600_000).toISOString().slice(0, 10);
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(fc|bc|cf|club|basket|basketball|united|city)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchKey(group: Pick<MatchGroup, "sport" | "home" | "away">) {
  const teams = [normalizeName(group.home), normalizeName(group.away)].sort();
  return `${group.sport}|${teams[0]}|${teams[1]}`;
}

function lineOf(pick: TicketPick) {
  const spec = pick.sporty?.specifier ?? "";
  const fromSpec = Number(spec.match(/(?:^|[;,&])\s*total=([+-]?\d+(?:\.\d+)?)/i)?.[1]);
  if (Number.isFinite(fromSpec)) return fromSpec;
  const fromMarket = Number(pick.market.match(/([+-]?\d+(?:\.\d+)?)/)?.[1]);
  if (Number.isFinite(fromMarket)) return fromMarket;
  const fromSelection = Number(pick.selection.match(/([+-]?\d+(?:\.\d+)?)/)?.[1]);
  return Number.isFinite(fromSelection) ? fromSelection : null;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON in H2H response.");
  return JSON.parse(fenced.slice(start, end + 1));
}

function cleanTotals(sport: DailyOversSport, values: unknown) {
  if (!Array.isArray(values)) return [];
  const min = sport === "football" ? 0 : 50;
  const max = sport === "football" ? 15 : 350;
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= min && value <= max)
    .slice(0, 5);
}

async function mapPool<T, R>(items: T[], width: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadCache() {
  const raw = await getSetting(`daily_overs_h2h_v1_${watDay()}`);
  if (!raw) return {} as CacheRow;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as CacheRow) : {};
  } catch {
    return {} as CacheRow;
  }
}

async function saveCache(cache: CacheRow) {
  await setSetting(`daily_overs_h2h_v1_${watDay()}`, JSON.stringify(cache));
}

async function researchBatch(batch: MatchGroup[]) {
  const refs = batch.map((group, index) => {
    const id = String.fromCharCode(65 + index);
    return `${id} ${group.sport === "football" ? "F" : "B"} ${group.home} v ${group.away}`;
  });
  const query = [
    'H2H totals. JSON only {"m":[{"i":"A","t":[2,3,4]}]}.',
    "For each match return totals from up to the last 5 completed head-to-head meetings.",
    "F=football combined goals. B=basketball combined final points incl OT.",
    'If fewer than 3 H2H results can be verified, use "t":[] .',
    ...refs,
  ].join(" ");

  const answer = await youAnswer(query, 10_000);
  const parsed = extractJson(answer) as { m?: unknown };
  const rows = Array.isArray(parsed.m) ? parsed.m : [];
  return batch.map((group, index) => {
    const id = String.fromCharCode(65 + index);
    const row = rows.find(
      (value) =>
        value &&
        typeof value === "object" &&
        String((value as { i?: unknown }).i ?? "").toUpperCase() === id,
    ) as { t?: unknown } | undefined;
    return {
      key: matchKey(group),
      totals: cleanTotals(group.sport, row?.t),
    };
  });
}

async function h2hForGroups(groups: MatchGroup[]) {
  await refreshKeys();
  if (!youKeys().length) {
    return {
      rows: new Map<string, H2hTotals>(),
      warning: "You.com is not configured, so H2H totals could not be verified.",
    };
  }

  const cache = await loadCache();
  const out = new Map<string, H2hTotals>();
  const uncached: MatchGroup[] = [];

  for (const group of groups) {
    const key = matchKey(group);
    const hit = cache[key];
    if (hit && Array.isArray(hit.totals)) out.set(key, hit);
    else uncached.push(group);
  }

  const batches = chunks(uncached, 3);
  const researched = await mapPool(batches, 3, async (batch) => {
    try {
      return await researchBatch(batch);
    } catch {
      return batch.map((group) => ({ key: matchKey(group), totals: [] as number[] }));
    }
  });

  const checkedAt = Date.now();
  for (const batch of researched) {
    for (const row of batch) {
      const value = { totals: row.totals, checkedAt };
      cache[row.key] = value;
      out.set(row.key, value);
    }
  }
  if (uncached.length) await saveCache(cache).catch(() => {});

  return { rows: out };
}

function scorePick(
  group: MatchGroup,
  pick: TicketPick,
  totals: number[],
): DailyOverRecommendation | null {
  const line = lineOf(pick);
  const odds = pick.odds ?? 0;
  if (line == null || !Number.isFinite(odds) || odds < 1.2 || odds > 1.82) return null;
  if (totals.length < 3) return null;

  const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const hits = totals.filter((value) => value > line).length;
  const pushes = totals.filter((value) => value === line).length;
  const hitRate = hits / totals.length;
  const margin = average - line;
  const minMargin = group.sport === "football" ? 0.5 : 5;
  if (hitRate < 0.6 || margin < minMargin) return null;

  const marginScale =
    group.sport === "football"
      ? Math.min(18, Math.max(0, margin * 7))
      : Math.min(18, Math.max(0, margin / 1.5));
  const priceBonus = Math.max(0, 8 - Math.abs(odds - 1.45) * 12);
  const score = Math.round(hitRate * 72 + marginScale + priceBonus);

  return {
    pick,
    sample: totals.length,
    h2hAverage: average,
    h2hHitRate: hitRate,
    pushes,
    margin,
    score,
    h2hTotals: totals,
  };
}

function bestForGroup(group: MatchGroup, totals: number[]) {
  return group.picks
    .map((pick) => scorePick(group, pick, totals))
    .filter((row): row is DailyOverRecommendation => Boolean(row))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.h2hHitRate - a.h2hHitRate ||
        (a.pick.odds ?? 99) - (b.pick.odds ?? 99),
    )[0] ?? null;
}

export async function scanDailyOvers(
  scope: DailyOversScope = "all",
): Promise<DailyOversScan> {
  const sports: DailyOversSport[] =
    scope === "all" ? ["football", "basketball"] : [scope];

  const discovered = await Promise.all(
    sports.map(async (sport) => ({ sport, result: await listDailyOverMarkets(sport) })),
  );

  const warnings: string[] = [];
  const groups: MatchGroup[] = [];
  let scannedEvents = 0;

  for (const row of discovered) {
    if (!Array.isArray(row.result)) {
      warnings.push(row.result.error);
      continue;
    }
    const byEvent = new Map<string, MatchGroup>();
    for (const pick of row.result) {
      const eventId = pick.sporty?.eventId;
      if (!eventId) continue;
      const current = byEvent.get(eventId) ?? {
        eventId,
        sport: row.sport,
        home: pick.home,
        away: pick.away,
        league: pick.league,
        kickoff: pick.kickoff,
        picks: [],
      };
      current.picks.push(pick);
      byEvent.set(eventId, current);
    }
    scannedEvents += byEvent.size;

    for (const group of byEvent.values()) {
      const conservative = group.picks.filter((pick) => {
        const odds = pick.odds ?? 0;
        const line = lineOf(pick);
        return line != null && odds >= 1.2 && odds <= 1.82;
      });
      if (conservative.length) groups.push({ ...group, picks: conservative });
    }
  }

  const research = await h2hForGroups(groups);
  if (research.warning) warnings.push(research.warning);

  const recommendations: DailyOverRecommendation[] = [];
  let verified = 0;
  for (const group of groups) {
    const totals = research.rows.get(matchKey(group))?.totals ?? [];
    if (totals.length >= 3) verified += 1;
    const best = bestForGroup(group, totals);
    if (best) recommendations.push(best);
  }

  recommendations.sort(
    (a, b) =>
      b.score - a.score ||
      b.h2hHitRate - a.h2hHitRate ||
      (a.pick.kickoff ?? 0) - (b.pick.kickoff ?? 0),
  );

  return {
    scope,
    scannedEvents,
    eventsWithConservativeOver: groups.length,
    h2hVerifiedEvents: verified,
    recommendations,
    warnings,
  };
}
