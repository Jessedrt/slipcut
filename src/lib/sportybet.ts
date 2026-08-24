import type { SportKind, SportySelection, TicketPick } from "./types";

export type ShareOutcome = {
  eventId?: string;
  estimateStartTime?: number;
  homeTeamName?: string;
  awayTeamName?: string;
  status?: number;
  banned?: boolean;
  sport?: {
    id?: string;
    name?: string;
    category?: {
      name?: string;
      tournament?: { name?: string };
    };
  };
  markets?: Array<{
    id?: string;
    desc?: string;
    specifier?: string;
    outcomes?: Array<{
      id?: string;
      desc?: string;
      odds?: string;
    }>;
  }>;
};

export type SharePayload = {
  bizCode?: number;
  message?: string;
  data?: {
    shareCode?: string;
    shareURL?: string;
    outcomes?: ShareOutcome[];
    unavailableOutcomes?: unknown[];
    betType?: string;
    deadline?: number;
  };
};

const FOOTBALL_IDS = new Set(["sr:sport:1", "1"]);
const BASKETBALL_IDS = new Set(["sr:sport:2", "2"]);
const COUNTRY_FALLBACKS = ["ng", "gh", "ke", "za", "tz", "ug", "zm", "cm"];

export function mapSport(name?: string, id?: string): SportKind {
  const n = (name ?? "").toLowerCase();
  const sid = (id ?? "").toLowerCase();
  if (n.includes("virtual")) return "other";
  if (n.includes("basket") || BASKETBALL_IDS.has(sid)) return "basketball";
  if (
    (n.includes("football") && !n.includes("american")) ||
    n.includes("soccer") ||
    FOOTBALL_IDS.has(sid)
  ) {
    return "football";
  }
  return "other";
}

function sportyFromOutcome(o: ShareOutcome): SportySelection | undefined {
  const market = o.markets?.[0];
  const selection = market?.outcomes?.[0];
  if (!o.eventId || !market?.id || selection?.id == null) return undefined;
  return {
    eventId: String(o.eventId),
    marketId: String(market.id),
    outcomeId: String(selection.id),
    specifier: market.specifier ? String(market.specifier) : undefined,
  };
}

export function picksFromShare(payload: SharePayload): TicketPick[] {
  const outcomes = payload.data?.outcomes ?? [];
  return outcomes.map((o, i) => {
    const market = o.markets?.[0];
    const selection = market?.outcomes?.[0];
    const oddsRaw = selection?.odds;
    const odds = oddsRaw ? Number(oddsRaw) : undefined;
    return {
      id: `${o.eventId ?? "ev"}-${i}`,
      sport: mapSport(o.sport?.name, o.sport?.id),
      league: o.sport?.category?.tournament?.name ?? "",
      country: o.sport?.category?.name,
      home: o.homeTeamName ?? "Home",
      away: o.awayTeamName ?? "Away",
      market: market?.desc ?? "Market",
      selection: selection?.desc ?? "Selection",
      odds: Number.isFinite(odds) ? odds : undefined,
      kickoff: o.estimateStartTime,
      sporty: sportyFromOutcome(o),
    };
  });
}

export async function fetchShare(code: string, country: string): Promise<SharePayload | null> {
  const url = `https://www.sportybet.com/api/${country}/orders/share/${encodeURIComponent(code)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: sportyHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as SharePayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadBookingCode(code: string, preferred?: string): Promise<{
  picks: TicketPick[];
  shareCode: string;
} | { error: string }> {
  const order = [preferred, ...COUNTRY_FALLBACKS].filter(
    (c, i, arr): c is string => Boolean(c) && arr.indexOf(c) === i,
  );
  let lastMessage = "Booking code not found.";
  for (const country of order) {
    const payload = await fetchShare(code, country);
    if (!payload) continue;
    if (payload.bizCode === 10000 && payload.data) {
      const picks = picksFromShare(payload);
      if (!picks.length) return { error: "That code loaded, but the slip had no selections." };
      return { picks: picks.slice(0, 20), shareCode: payload.data.shareCode ?? code };
    }
    lastMessage = payload.message || lastMessage;
  }
  return { error: lastMessage };
}

export type MintResult = {
  shareCode: string;
  shareURL: string;
  unavailable: number;
};

export async function mintShare(
  selections: SportySelection[],
  country = "ng",
): Promise<MintResult | { error: string }> {
  if (!selections.length) return { error: "No SportyBet selections to book." };
  const body = {
    selections: selections.map((s) => ({
      eventId: s.eventId,
      marketId: s.marketId,
      outcomeId: s.outcomeId,
      ...(s.specifier ? { specifier: s.specifier } : {}),
    })),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`https://www.sportybet.com/api/${country}/orders/share`, {
      method: "POST",
      signal: controller.signal,
      headers: { ...sportyHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as SharePayload;
    const code = payload.data?.shareCode;
    if (payload.bizCode === 10000 && code) {
      const shareURL =
        payload.data?.shareURL || `https://www.sportybet.com/${country}/?shareCode=${code}`;
      return {
        shareCode: code,
        shareURL,
        unavailable: Array.isArray(payload.data?.unavailableOutcomes)
          ? payload.data.unavailableOutcomes.length
          : 0,
      };
    }
    return { error: payload.message || "SportyBet did not return a booking code." };
  } catch {
    return { error: "Could not reach SportyBet to mint a code." };
  } finally {
    clearTimeout(timer);
  }
}

export function sportyOf(picks: TicketPick[]): SportySelection[] {
  return picks.map((p) => p.sporty).filter((s): s is SportySelection => Boolean(s?.eventId));
}

const FOOTBALL_LEAGUES =
  /premier league|laliga|la liga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|eredivisie|primeira|championship|mls|copa libertadores|nations league|pro league|saudi/i;
const BASKETBALL_LEAGUES = /nba|euroleague|eurocup|ncaa|wnba|nbl|acb|bbl/i;

type EventMarket = {
  id?: string;
  desc?: string;
  specifier?: string;
  status?: number;
  outcomes?: Array<{ id?: string; desc?: string; odds?: string; isActive?: number }>;
};

type EventDetail = {
  eventId?: string;
  estimateStartTime?: number;
  status?: number;
  banned?: boolean;
  homeTeamName?: string;
  awayTeamName?: string;
  sport?: ShareOutcome["sport"];
  markets?: EventMarket[];
};

async function sportyGet(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://www.sportybet.com/api/ng${path}`, {
      signal: controller.signal,
      headers: sportyHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function leagueName(sport?: ShareOutcome["sport"]) {
  return sport?.category?.tournament?.name ?? "";
}

function pickMainMarket(markets: EventMarket[], sport: "football" | "basketball") {
  const open = markets.filter((m) => m.status === 0 && (m.outcomes ?? []).some((o) => o.isActive === 1));
  if (sport === "football") {
    return open.find((m) => m.id === "1" || /^1x2$/i.test(m.desc ?? "")) ?? null;
  }
  return (
    open.find((m) => m.id === "219") ||
    open.find((m) => /winner/i.test(m.desc ?? "") && (m.outcomes ?? []).length >= 2) ||
    null
  );
}

function favoriteOutcome(market: EventMarket) {
  const live = (market.outcomes ?? []).filter((o) => o.isActive === 1 && o.id != null);
  return live
    .slice()
    .sort((a, b) => Number(a.odds ?? 99) - Number(b.odds ?? 99))[0];
}

function eventToPick(ev: EventDetail, sport: "football" | "basketball"): TicketPick | null {
  if (!ev.eventId || ev.status !== 0 || ev.banned) return null;
  const market = pickMainMarket(ev.markets ?? [], sport);
  const outcome = market ? favoriteOutcome(market) : undefined;
  if (!market?.id || outcome?.id == null) return null;
  const odds = outcome.odds ? Number(outcome.odds) : undefined;
  return {
    id: `${ev.eventId}-${market.id}-${outcome.id}`,
    sport,
    league: leagueName(ev.sport),
    country: ev.sport?.category?.name,
    home: ev.homeTeamName ?? "Home",
    away: ev.awayTeamName ?? "Away",
    market: market.desc ?? "Market",
    selection: outcome.desc ?? "Selection",
    odds: Number.isFinite(odds) ? odds : undefined,
    kickoff: ev.estimateStartTime,
    sporty: {
      eventId: String(ev.eventId),
      marketId: String(market.id),
      outcomeId: String(outcome.id),
      specifier: market.specifier ? String(market.specifier) : undefined,
    },
  };
}

export async function listUpcomingPicks(
  sport: "football" | "basketball",
  limit = 14,
): Promise<TicketPick[] | { error: string }> {
  const sportId = sport === "basketball" ? "sr:sport:2" : "sr:sport:1";
  const payload = (await sportyGet(
    `/factsCenter/commonThumbnailEvents?sportId=${encodeURIComponent(sportId)}`,
  )) as SharePayload & { data?: Array<{ name?: string; events?: ShareOutcome[] }> } | null;
  const tours = Array.isArray(payload?.data) ? payload.data : [];
  if (!tours.length) return { error: `No upcoming ${sport} on SportyBet right now.` };

  const prefer = sport === "basketball" ? BASKETBALL_LEAGUES : FOOTBALL_LEAGUES;
  const now = Date.now();
  const upcoming = tours
    .flatMap((t) => (t.events ?? []).map((e) => ({ ...e, leagueHint: t.name ?? leagueName(e.sport) })))
    .filter((e) => e.status === 0 && !e.banned && e.eventId && (e.estimateStartTime ?? 0) > now - 60_000)
    .sort((a, b) => {
      const ap = prefer.test(a.leagueHint ?? "") ? 0 : 1;
      const bp = prefer.test(b.leagueHint ?? "") ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.estimateStartTime ?? 0) - (b.estimateStartTime ?? 0);
    })
    .slice(0, Math.max(limit, 8));

  const details = await Promise.all(
    upcoming.map(async (e) => {
      const body = (await sportyGet(
        `/factsCenter/event?eventId=${encodeURIComponent(String(e.eventId))}&productId=3`,
      )) as { data?: EventDetail } | null;
      return body?.data ?? null;
    }),
  );

  const picks: TicketPick[] = [];
  details.forEach((ev, i) => {
    if (!ev) return;
    const pick = eventToPick(ev, sport);
    if (pick) picks.push(pick);
  });
  if (!picks.length) return { error: `Could not read ${sport} markets on SportyBet.` };
  return picks.slice(0, limit);
}

function sportyHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 SlipCut",
    Clientid: "web",
    OperId: "2",
    Platform: "web",
  };
}
