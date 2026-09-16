import type { NormalizedMarket, Sport } from "../types/index.js";
import { categorizeMarket } from "../markets/catalog.js";
import { COUNTRY_FALLBACKS, sportyGet, sportyPost } from "./client.js";
import { env } from "../config/env.js";

type RawMarket = {
  id?: string;
  desc?: string;
  specifier?: string;
  outcomes?: Array<{ id?: string; desc?: string; odds?: string | number }>;
};

type RawEvent = {
  eventId?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  estimateStartTime?: number;
  status?: number;
  banned?: boolean;
  sport?: { category?: { name?: string; tournament?: { name?: string } } };
  markets?: RawMarket[];
};

function sportId(sport: Sport): string {
  return sport === "basketball" ? "sr:sport:2" : "sr:sport:1";
}

export async function listFixtures(sport: Sport, country = env.SPORTYBET_COUNTRY): Promise<
  Array<{ eventId: string; home: string; away: string; league: string; kickoff?: number }>
> {
  const payload = (await sportyGet(
    `/factsCenter/commonThumbnailEvents?sportId=${encodeURIComponent(sportId(sport))}`,
    country,
  )) as { bizCode?: number; data?: Array<{ name?: string; events?: RawEvent[] }> } | null;

  if (!payload || payload.bizCode !== 10000 || !Array.isArray(payload.data)) return [];

  const out: Array<{ eventId: string; home: string; away: string; league: string; kickoff?: number }> = [];
  for (const tour of payload.data) {
    for (const e of tour.events ?? []) {
      if (!e.eventId || e.status !== 0 || e.banned) continue;
      out.push({
        eventId: String(e.eventId),
        home: e.homeTeamName || "Home",
        away: e.awayTeamName || "Away",
        league: tour.name || e.sport?.category?.tournament?.name || "",
        kickoff: e.estimateStartTime,
      });
    }
  }
  return out;
}

/** Fetch full market board — ALL markets from productId=3 */
export async function getEventMarkets(
  eventId: string,
  sport: Sport,
  meta?: { home?: string; away?: string; league?: string; kickoff?: number },
  country = env.SPORTYBET_COUNTRY,
): Promise<NormalizedMarket[]> {
  const body = (await sportyGet(
    `/factsCenter/event?eventId=${encodeURIComponent(eventId)}&productId=3`,
    country,
  )) as { bizCode?: number; data?: RawEvent } | null;

  const ev = body?.data;
  if (!ev) return [];

  const home = meta?.home || ev.homeTeamName || "Home";
  const away = meta?.away || ev.awayTeamName || "Away";
  const league = meta?.league || ev.sport?.category?.tournament?.name || "";
  const kickoff = meta?.kickoff ?? ev.estimateStartTime;
  const markets = ev.markets ?? [];
  const normalized: NormalizedMarket[] = [];

  for (const m of markets) {
    if (!m.id) continue;
    for (const o of m.outcomes ?? []) {
      const odds = Number(o.odds);
      if (!o.id || !Number.isFinite(odds) || odds <= 1) continue;
      const marketName = m.desc || `Market ${m.id}`;
      const selectionName = o.desc || o.id;
      normalized.push({
        providerMarketId: String(m.id),
        providerSelectionId: String(o.id),
        eventId,
        sport,
        category: categorizeMarket(String(m.id), marketName, sport),
        marketName,
        selectionName,
        odds,
        line: m.specifier,
        specifier: m.specifier,
        status: ev.banned || ev.status !== 0 ? "suspended" : "open",
        home,
        away,
        league,
        kickoff,
      });
    }
  }
  return normalized;
}

export async function loadBookingCode(code: string): Promise<
  | { ok: true; code: string; selections: NormalizedMarket[] }
  | { ok: false; error: string }
> {
  let last = "Booking code not found.";
  for (const country of [env.SPORTYBET_COUNTRY, ...COUNTRY_FALLBACKS]) {
    const payload = (await sportyGet(`/orders/share/${encodeURIComponent(code)}`, country)) as {
      bizCode?: number;
      message?: string;
      data?: {
        shareCode?: string;
        outcomes?: Array<{
          eventId?: string;
          homeTeamName?: string;
          awayTeamName?: string;
          estimateStartTime?: number;
          sport?: { category?: { tournament?: { name?: string } }; id?: string };
          markets?: RawMarket[];
        }>;
      };
    } | null;
    if (!payload) continue;
    if (payload.bizCode === 10000 && payload.data?.outcomes) {
      const selections: NormalizedMarket[] = [];
      for (const o of payload.data.outcomes) {
        if (!o.eventId) continue;
        const sport: Sport = String(o.sport?.id || "").includes("2") ? "basketball" : "football";
        for (const m of o.markets ?? []) {
          for (const out of m.outcomes ?? []) {
            const odds = Number(out.odds);
            if (!m.id || !out.id || !Number.isFinite(odds)) continue;
            selections.push({
              providerMarketId: String(m.id),
              providerSelectionId: String(out.id),
              eventId: String(o.eventId),
              sport,
              category: categorizeMarket(String(m.id), m.desc || "", sport),
              marketName: m.desc || "",
              selectionName: out.desc || "",
              odds,
              specifier: m.specifier,
              status: "open",
              home: o.homeTeamName || "",
              away: o.awayTeamName || "",
              league: o.sport?.category?.tournament?.name,
              kickoff: o.estimateStartTime,
            });
          }
        }
      }
      if (!selections.length) return { ok: false, error: "Code loaded but had no selections." };
      return { ok: true, code: payload.data.shareCode || code, selections };
    }
    last = payload.message || last;
  }
  return { ok: false, error: last };
}

export async function mintShareCode(
  selections: Array<{ eventId: string; marketId: string; outcomeId: string; specifier?: string }>,
): Promise<{ ok: true; code: string; url: string } | { ok: false; error: string }> {
  if (!selections.length) return { ok: false, error: "No selections to book." };
  const body = {
    selections: selections.map((s) => ({
      eventId: s.eventId,
      marketId: s.marketId,
      outcomeId: s.outcomeId,
      ...(s.specifier ? { specifier: s.specifier } : {}),
    })),
  };
  const payload = (await sportyPost("/orders/share", body, env.SPORTYBET_COUNTRY)) as {
    bizCode?: number;
    message?: string;
    data?: { shareCode?: string; shareURL?: string };
  } | null;
  const code = payload?.data?.shareCode;
  if (payload?.bizCode === 10000 && code) {
    return {
      ok: true,
      code,
      url: payload.data?.shareURL || `https://www.sportybet.com/${env.SPORTYBET_COUNTRY}/?shareCode=${code}`,
    };
  }
  return { ok: false, error: payload?.message || "Could not create SportyBet code." };
}
