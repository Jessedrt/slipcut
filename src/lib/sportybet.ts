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

async function mapPool<T, R>(items: T[], width: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => worker()));
  return out;
}

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

function implied(odds?: number) {
  return odds && odds > 1 ? 1 / odds : 0;
}

function inBookWindow(odds?: number) {
  return Number.isFinite(odds) && (odds as number) >= 1.18 && (odds as number) <= 2.35;
}

function marketFamily(id?: string, desc?: string): "win" | "dc" | "ou" | "gg" | "dnb" {
  const d = (desc ?? "").toLowerCase();
  if (id === "10" || d.includes("double chance")) return "dc";
  if (id === "18" || id === "225" || d.includes("over/under")) return "ou";
  if (id === "29" || d.includes("gg/ng")) return "gg";
  if (id === "11" || d.includes("draw no bet")) return "dnb";
  return "win";
}

function toPick(
  ev: EventDetail,
  sport: "football" | "basketball",
  market: EventMarket,
  outcome: NonNullable<EventMarket["outcomes"]>[number],
): TicketPick | null {
  if (!ev.eventId || outcome.id == null || !market.id) return null;
  const odds = outcome.odds ? Number(outcome.odds) : undefined;
  const line = market.specifier?.replace("total=", "") ?? "";
  const label =
    market.id === "18" || market.id === "225"
      ? `${market.desc ?? "Over/Under"} ${line}`.trim()
      : market.desc ?? "Market";
  return {
    id: `${ev.eventId}-${market.id}-${market.specifier ?? ""}-${outcome.id}`,
    sport,
    league: leagueName(ev.sport),
    country: ev.sport?.category?.name,
    home: ev.homeTeamName ?? "Home",
    away: ev.awayTeamName ?? "Away",
    market: label,
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

function openOutcomes(market: EventMarket) {
  return (market.outcomes ?? []).filter((o) => o.isActive === 1 && o.id != null);
}

function footballCandidates(ev: EventDetail): TicketPick[] {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const want: EventMarket[] = [];
  const first = (pred: (m: EventMarket) => boolean) => {
    const hit = markets.find(pred);
    if (hit) want.push(hit);
  };
  first((m) => m.id === "1");
  first((m) => m.id === "10");
  first((m) => m.id === "11");
  first((m) => m.id === "29");
  first((m) => m.id === "18" && m.specifier === "total=1.5");
  first((m) => m.id === "18" && (m.specifier === "total=2.5" || m.specifier === "total=2"));
  first((m) => m.id === "18" && (m.specifier === "total=3.5" || m.specifier === "total=3"));
  const picks: TicketPick[] = [];
  for (const market of want) {
    for (const outcome of openOutcomes(market)) {
      const pick = toPick(ev, "football", market, outcome);
      if (pick && inBookWindow(pick.odds)) picks.push(pick);
    }
  }
  return picks;
}

function basketballCandidates(ev: EventDetail): TicketPick[] {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];
  const winner =
    markets.find((m) => m.id === "219") ||
    markets.find((m) => /winner/i.test(m.desc ?? "") && openOutcomes(m).length >= 2);
  if (winner) {
    for (const outcome of openOutcomes(winner)) {
      const pick = toPick(ev, "basketball", winner, outcome);
      if (pick && inBookWindow(pick.odds)) picks.push(pick);
    }
  }
  const totals = markets.filter((m) => m.id === "225");
  let bestTotal: EventMarket | undefined;
  let bestGap = 99;
  for (const market of totals) {
    const outs = openOutcomes(market);
    if (outs.length < 2) continue;
    const prices = outs.map((o) => Number(o.odds ?? 99));
    const gap = Math.abs((prices[0] ?? 9) - (prices[1] ?? 9));
    if (prices.every((n) => n >= 1.5 && n <= 2.3) && gap < bestGap) {
      bestGap = gap;
      bestTotal = market;
    }
  }
  if (bestTotal) {
    for (const outcome of openOutcomes(bestTotal)) {
      const pick = toPick(ev, "basketball", bestTotal, outcome);
      if (pick && inBookWindow(pick.odds)) picks.push(pick);
    }
  }
  return picks;
}

function pickFromEvent(cands: TicketPick[], used: Record<string, number>): TicketPick | null {
  if (!cands.length) return null;
  const families = [...new Set(cands.map((p) => marketFamily(p.sporty?.marketId, p.market)))];
  families.sort((a, b) => (used[a] ?? 0) - (used[b] ?? 0) || Number(a === "win") - Number(b === "win"));
  const family = families[0];
  const pool = family
    ? cands.filter((p) => marketFamily(p.sporty?.marketId, p.market) === family)
    : cands;
  const pick = pool.slice().sort((a, b) => implied(b.odds) - implied(a.odds))[0];
  if (pick && family) used[family] = (used[family] ?? 0) + 1;
  return pick ?? null;
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
    .slice(0, Math.max(limit + 8, 12));

  const details = await mapPool(upcoming, 6, async (e) => {
    const body = (await sportyGet(
      `/factsCenter/event?eventId=${encodeURIComponent(String(e.eventId))}&productId=3`,
    )) as { data?: EventDetail } | null;
    return body?.data ?? null;
  });

  const used: Record<string, number> = {};
  const picks: TicketPick[] = [];
  for (const ev of details) {
    if (!ev || ev.status !== 0 || ev.banned) continue;
    const cands = sport === "basketball" ? basketballCandidates(ev) : footballCandidates(ev);
    const pick = pickFromEvent(cands, used);
    if (pick) picks.push(pick);
    if (picks.length >= limit) break;
  }
  if (!picks.length) return { error: `Could not read ${sport} markets on SportyBet.` };
  return picks;
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
