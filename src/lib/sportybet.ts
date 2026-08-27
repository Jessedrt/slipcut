import type { BookSport, SportKind, SportySelection, TicketPick } from "./types";

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
const TENNIS_IDS = new Set(["sr:sport:5", "5"]);
const COUNTRY_FALLBACKS = ["ng", "gh", "ke", "za", "tz", "ug", "zm", "cm"];

export function mapSport(name?: string, id?: string): SportKind {
  const n = (name ?? "").toLowerCase();
  const sid = (id ?? "").toLowerCase();
  if (n.includes("virtual")) return "other";
  if (n.includes("tennis") || TENNIS_IDS.has(sid)) return "tennis";
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
      return { picks: picks.slice(0, 50), shareCode: payload.data.shareCode ?? code };
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
const TENNIS_LEAGUES = /atp|wta|us open|australian open|wimbledon|roland|french open|masters|challenger|grand slam/i;

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
  setScore?: string;
  gameScore?: string[];
  matchStatus?: string;
  period?: number;
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
  return Number.isFinite(odds) && (odds as number) >= 1.16 && (odds as number) <= 2.75;
}

export function marketFamily(
  id?: string,
  desc?: string,
): "win" | "dc" | "ou" | "gg" | "dnb" | "hcp" | "ou1h" | "teamou" {
  const d = (desc ?? "").toLowerCase();
  if (id === "10" || d.includes("double chance")) return "dc";
  if (id === "186" || id === "202") return "win";
  if (id === "187" || id === "188" || id === "16" || id === "14" || id === "223" || id === "66" || d.includes("handicap"))
    return "hcp";
  if (id === "68" || id === "69" || id === "70" || (id === "236" && d.includes("1st")) || (d.includes("1st half") && d.includes("over")))
    return "ou1h";
  if (id === "227" || id === "228") return "teamou";
  if (id === "189" || id === "204" || id === "314" || id === "18" || id === "225" || d.includes("over/under") || d.includes("total games"))
    return "ou";
  if (id === "29" || d.includes("gg/ng")) return "gg";
  if (id === "11" || d.includes("draw no bet")) return "dnb";
  return "win";
}

function toPick(
  ev: EventDetail,
  sport: BookSport,
  market: EventMarket,
  outcome: NonNullable<EventMarket["outcomes"]>[number],
): TicketPick | null {
  if (!ev.eventId || outcome.id == null || !market.id) return null;
  const odds = outcome.odds ? Number(outcome.odds) : undefined;
  const spec = market.specifier ?? "";
  const total = spec.match(/total=([\d.]+)/)?.[1] ?? "";
  const hcp = spec.match(/hcp=([-\d.]+)/)?.[1] ?? "";
  let label = market.desc ?? "Market";
  if (market.id === "18" || market.id === "225") label = `Over/Under ${total}`.trim();
  else if (market.id === "16") label = `Asian Handicap ${hcp}`.trim();
  else if (market.id === "223" || market.id === "14") label = `Handicap ${hcp}`.trim();
  else if (market.id === "68") label = `1st Half O/U ${total}`.trim();
  else if (market.id === "227") label = `Home total ${total}`.trim();
  else if (market.id === "228") label = `Away total ${total}`.trim();
  else if (market.id === "69") label = `1H home total ${total}`.trim();
  else if (market.id === "70") label = `1H away total ${total}`.trim();
  else if (market.id === "66") label = `1st Half Handicap ${hcp}`.trim();
  else if (market.id === "236" && spec.includes("quarternr=1")) label = `1st quarter O/U ${total}`.trim();
  else if (market.id === "186") label = "Winner";
  else if (market.id === "187") label = `Game handicap ${hcp}`.trim();
  else if (market.id === "188") label = `Set handicap ${hcp}`.trim();
  else if (market.id === "189") label = `Total games ${total}`.trim();
  else if (market.id === "202") label = "1st set winner";
  else if (market.id === "204") label = `1st set total ${total}`.trim();
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
  first((m) => m.id === "68" && (m.specifier === "total=0.5" || m.specifier === "total=1.5" || m.specifier === "total=1"));
  const ah = mostBalanced(markets.filter((m) => m.id === "16"));
  const ah1h = mostBalanced(markets.filter((m) => m.id === "66"));
  if (ah) want.push(ah);
  if (ah1h) want.push(ah1h);
  const picks: TicketPick[] = [];
  for (const market of want) {
    for (const outcome of openOutcomes(market)) {
      const pick = toPick(ev, "football", market, outcome);
      if (pick && inBookWindow(pick.odds)) picks.push(pick);
    }
  }
  return picks;
}

function mostBalanced(markets: EventMarket[]): EventMarket | undefined {
  let best: EventMarket | undefined;
  let bestGap = 99;
  for (const market of markets) {
    const outs = openOutcomes(market).filter((o) => inBookWindow(Number(o.odds)));
    if (outs.length < 1) continue;
    if (outs.length < 2) {
      const gap = Math.abs(Number(outs[0]?.odds ?? 9) - 1.85) + 1;
      if (gap < bestGap) {
        bestGap = gap;
        best = market;
      }
      continue;
    }
    const a = Number(outs[0]?.odds ?? 9);
    const b = Number(outs[1]?.odds ?? 9);
    const gap = Math.abs(a - b);
    if (gap < bestGap) {
      bestGap = gap;
      best = market;
    }
  }
  return best;
}

function pushMarket(
  picks: TicketPick[],
  ev: EventDetail,
  sport: BookSport,
  market: EventMarket | undefined,
) {
  if (!market) return;
  for (const outcome of openOutcomes(market)) {
    const pick = toPick(ev, sport, market, outcome);
    if (pick && inBookWindow(pick.odds)) picks.push(pick);
  }
}

function basketballCandidates(ev: EventDetail): TicketPick[] {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];
  pushMarket(
    picks,
    ev,
    "basketball",
    markets.find((m) => m.id === "219") ||
      markets.find((m) => /winner/i.test(m.desc ?? "") && openOutcomes(m).length >= 2),
  );
  pushMarket(picks, ev, "basketball", mostBalanced(markets.filter((m) => m.id === "225")));
  pushMarket(picks, ev, "basketball", mostBalanced(markets.filter((m) => m.id === "227")));
  pushMarket(picks, ev, "basketball", mostBalanced(markets.filter((m) => m.id === "228")));
  pushMarket(picks, ev, "basketball", mostBalanced(markets.filter((m) => m.id === "223")));
  pushMarket(picks, ev, "basketball", mostBalanced(markets.filter((m) => m.id === "66")));
  pushMarket(
    picks,
    ev,
    "basketball",
    mostBalanced(markets.filter((m) => m.id === "236" && (m.specifier ?? "").includes("quarternr=1"))),
  );
  return picks.filter((p) => {
    const id = p.sporty?.marketId;
    if (id === "68" || id === "69" || id === "70") return false;
    if (/1st half/i.test(p.market) && /over|under|total/i.test(`${p.selection} ${p.market}`)) return false;
    return true;
  });
}

function tennisCandidates(ev: EventDetail): TicketPick[] {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];
  pushMarket(picks, ev, "tennis", markets.find((m) => m.id === "186"));
  pushMarket(picks, ev, "tennis", mostBalanced(markets.filter((m) => m.id === "188")));
  pushMarket(picks, ev, "tennis", mostBalanced(markets.filter((m) => m.id === "187")));
  pushMarket(picks, ev, "tennis", mostBalanced(markets.filter((m) => m.id === "189")));
  pushMarket(
    picks,
    ev,
    "tennis",
    markets.find((m) => m.id === "202" && (m.specifier ?? "").includes("setnr=1")),
  );
  pushMarket(
    picks,
    ev,
    "tennis",
    mostBalanced(markets.filter((m) => m.id === "204" && (m.specifier ?? "").includes("setnr=1"))),
  );
  return picks;
}

function cookablePick(p: TicketPick) {
  if (p.sport !== "basketball") return true;
  const id = p.sporty?.marketId;
  if (id === "68" || id === "69" || id === "70") return false;
  if (/1st half/i.test(p.market) && /over|under|total/i.test(`${p.selection} ${p.market}`)) return false;
  return true;
}

function pickFromEvent(cands: TicketPick[], used: Record<string, number>): TicketPick | null {
  const pool0 = cands.filter(cookablePick);
  if (!pool0.length) return null;
  const totalUsed = Object.values(used).reduce((n, v) => n + v, 0);
  const families = [...new Set(pool0.map((p) => marketFamily(p.sporty?.marketId, p.market)))];
  const hasOu = families.includes("ou");
  const ouShare = totalUsed ? (used.ou ?? 0) / totalUsed : 0;
  families.sort(
    (a, b) =>
      (used[a] ?? 0) - (used[b] ?? 0) ||
      Number(a === "win") - Number(b === "win") ||
      Number(a === "dnb") - Number(b === "dnb") ||
      Number(a === "teamou") - Number(b === "teamou") ||
      Number(b === "ou") - Number(a === "ou") ||
      Number(b === "ou1h") - Number(a === "ou1h"),
  );
  let family = families[0];
  if (hasOu && ouShare < 0.4) family = "ou";
  const pool = family
    ? pool0.filter((p) => marketFamily(p.sporty?.marketId, p.market) === family)
    : pool0;
  const pick = pool.slice().sort((a, b) => {
    const gameA = a.sporty?.marketId === "225" ? 1 : 0;
    const gameB = b.sporty?.marketId === "225" ? 1 : 0;
    return gameB - gameA || implied(b.odds) - implied(a.odds);
  })[0];
  if (pick && family) used[family] = (used[family] ?? 0) + 1;
  return pick ?? null;
}

function drawFromEvent(ev: EventDetail): TicketPick | null {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const mkt = markets.find((m) => m.id === "1");
  if (!mkt) return null;
  const draw = openOutcomes(mkt).find((o) => selectionBias(o.desc ?? "") === "draw");
  if (!draw) return null;
  const pick = toPick(ev, "football", mkt, draw);
  if (!pick?.odds || pick.odds < 2.2 || pick.odds > 6.5) return null;
  return pick;
}

export type CookWindow = "soon" | "today" | "week" | "fortnight" | "weekend";

function watDay(ms: number) {
  const d = new Date(ms + 3_600_000);
  return { key: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
}

function inCookWindow(ts: number, window: CookWindow, now: number) {
  if (ts < now - 60_000) return false;
  if (window === "soon") return true;
  if (window === "today") return watDay(ts).key === watDay(now).key;
  if (window === "week") return ts <= now + 7 * 86_400_000;
  if (window === "fortnight") return ts <= now + 14 * 86_400_000;
  const { dow } = watDay(ts);
  return (dow === 0 || dow === 6) && ts <= now + 21 * 86_400_000;
}

function spreadByDay<T extends { estimateStartTime?: number }>(events: T[], window: CookWindow): T[] {
  if (window === "soon" || window === "today" || events.length < 3) return events;
  const buckets = new Map<string, T[]>();
  for (const e of events) {
    const key = watDay(e.estimateStartTime ?? 0).key;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }
  const days = [...buckets.keys()].sort();
  const out: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const day of days) {
      const arr = buckets.get(day);
      if (arr?.length) {
        out.push(arr.shift() as T);
        added = true;
      }
    }
  }
  return out;
}

export function windowLabel(window: CookWindow) {
  if (window === "today") return "today";
  if (window === "week") return "1 week";
  if (window === "fortnight") return "2 weeks";
  if (window === "weekend") return "weekends";
  return "";
}

export async function listUpcomingPicks(
  sport: BookSport,
  limit = 14,
  window: CookWindow = "soon",
  mode: "any" | "draw" = "any",
): Promise<TicketPick[] | { error: string }> {
  const sportId = sport === "basketball" ? "sr:sport:2" : sport === "tennis" ? "sr:sport:5" : "sr:sport:1";
  const payload = (await sportyGet(
    `/factsCenter/commonThumbnailEvents?sportId=${encodeURIComponent(sportId)}`,
  )) as SharePayload & { data?: Array<{ name?: string; events?: ShareOutcome[] }> } | null;
  const tours = Array.isArray(payload?.data) ? payload.data : [];
  if (!tours.length) return { error: `No upcoming ${sport} on SportyBet right now.` };

  const prefer =
    sport === "basketball" ? BASKETBALL_LEAGUES : sport === "tennis" ? TENNIS_LEAGUES : FOOTBALL_LEAGUES;
  const now = Date.now();
  const upcoming = spreadByDay(
    tours
      .flatMap((t) => (t.events ?? []).map((e) => ({ ...e, leagueHint: t.name ?? leagueName(e.sport) })))
      .filter(
        (e) =>
          e.status === 0 &&
          !e.banned &&
          e.eventId &&
          inCookWindow(e.estimateStartTime ?? 0, window, now),
      )
      .sort((a, b) => {
        const ap = prefer.test(a.leagueHint ?? "") ? 0 : 1;
        const bp = prefer.test(b.leagueHint ?? "") ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (a.estimateStartTime ?? 0) - (b.estimateStartTime ?? 0);
      }),
    window,
  );

  const want = Math.max(1, Math.min(35, limit));
  const deadline = Date.now() + 45_000;
  const picks: TicketPick[] = [];
  const batchSize = want > 20 ? 10 : 8;
  let events = 0;

  for (let i = 0; i < upcoming.length && events < want; i += batchSize) {
    if (Date.now() > deadline) break;
    const batch = upcoming.slice(i, i + batchSize);
    const details = await mapPool(batch, batchSize, async (e) => {
      const body = (await sportyGet(
        `/factsCenter/event?eventId=${encodeURIComponent(String(e.eventId))}&productId=3`,
      )) as { data?: EventDetail } | null;
      return body?.data ?? null;
    });
    for (const ev of details) {
      if (!ev || ev.status !== 0 || ev.banned) continue;
      if (events >= want) break;
      if (mode === "draw") {
        if (sport !== "football") continue;
        const draw = drawFromEvent(ev);
        if (draw) {
          picks.push(draw);
          events += 1;
        }
      } else {
        const cands =
          sport === "basketball"
            ? basketballCandidates(ev)
            : sport === "tennis"
              ? tennisCandidates(ev)
              : footballCandidates(ev);
        const open = cands.filter(cookablePick);
        if (!open.length) continue;
        picks.push(...open);
        events += 1;
      }
    }
  }
  if (!picks.length) return { error: `Could not read ${sport} markets on SportyBet.` };
  return picks;
}

export type MarketTarget = "ou15" | "ou25" | "ou35" | "gg" | "dc" | "dnb" | "win";

export function parseMarketTarget(text: string): MarketTarget | null {
  const t = text.toLowerCase().trim();
  if (t === "ou35" || /over\s*3\.5|o3\.5|ou\s*3\.5/.test(t)) return "ou35";
  if (t === "ou25" || /over\s*2\.5|o2\.5|ou\s*2\.5/.test(t)) return "ou25";
  if (t === "ou15" || /over\s*1\.5|o1\.5|ou\s*1\.5/.test(t)) return "ou15";
  if (t === "gg" || /\bgg\b|btts|both teams/.test(t)) return "gg";
  if (t === "dc" || /double chance|\bdc\b/.test(t)) return "dc";
  if (t === "dnb" || /draw no bet|\bdnb\b/.test(t)) return "dnb";
  if (t === "win" || /1x2|match winner|straight win/.test(t)) return "win";
  return null;
}

export async function getEventDetail(eventId: string): Promise<EventDetail | null> {
  const body = (await sportyGet(
    `/factsCenter/event?eventId=${encodeURIComponent(eventId)}&productId=3`,
  )) as { data?: EventDetail } | null;
  return body?.data ?? null;
}

async function fetchEvent(eventId: string): Promise<EventDetail | null> {
  return getEventDetail(eventId);
}

export type EventScore = {
  home: number;
  away: number;
  finished: boolean;
  live: boolean;
  label: string;
  period?: number;
  clock?: string;
};

export function eventScore(ev: {
  status?: number;
  setScore?: string;
  gameScore?: string[];
  matchStatus?: string;
  period?: number;
} | null): EventScore | null {
  if (!ev) return null;
  const raw = ev.setScore || ev.gameScore?.[0] || "";
  const m = String(raw).match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (!m) {
    const ms0 = String(ev.matchStatus ?? "").toUpperCase();
    if (ev.status === 0 || !ms0) return null;
    const live0 = ev.status === 1;
    return {
      home: 0,
      away: 0,
      finished: false,
      live: live0,
      label: live0 ? "live" : ms0 || "—",
      period: ev.period,
      clock: ev.matchStatus,
    };
  }
  const home = Number(m[1]);
  const away = Number(m[2]);
  const ms = String(ev.matchStatus ?? "").toUpperCase();
  const finished =
    ev.status === 2 ||
    ev.status === 3 ||
    ["FT", "ENDED", "END", "AET", "AP", "FINISHED", "FINAL", "AOT"].includes(ms);
  const live = ev.status === 1 && !finished;
  const clock = ev.matchStatus || (ev.period ? `P${ev.period}` : "");
  const tag = finished ? "FT" : live ? clock || "live" : clock;
  return {
    home,
    away,
    finished,
    live,
    label: `${home}-${away}${tag ? ` ${tag}` : ""}`,
    period: ev.period,
    clock: ev.matchStatus,
  };
}

function selectionBias(selection: string): string {
  const s = selection.toLowerCase();
  if (s.includes("under")) return "under";
  if (s.includes("over")) return "over";
  if (s === "no" || s.includes("ng")) return "no";
  if (s === "yes" || s.includes("gg")) return "yes";
  if (s.includes("home") && s.includes("away")) return "12";
  if (s.includes("home") && s.includes("draw")) return "1x";
  if (s.includes("draw") && s.includes("away")) return "x2";
  if (s.includes("home")) return "home";
  if (s.includes("away")) return "away";
  if (s.includes("draw")) return "draw";
  return "other";
}

function chooseOutcome(
  market: EventMarket,
  prefer: string,
): NonNullable<EventMarket["outcomes"]>[number] | undefined {
  const outs = openOutcomes(market);
  const hit = outs.find((o) => selectionBias(o.desc ?? "") === prefer);
  return hit ?? outs[0];
}

function marketForTarget(ev: EventDetail, sport: TicketPick["sport"], target: MarketTarget): EventMarket | null {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  if (sport === "basketball") {
    if (target === "win") {
      return markets.find((m) => m.id === "219") ?? null;
    }
    const line = target === "ou15" ? "1.5" : target === "ou35" ? "3.5" : "2.5";
    const totals = markets.filter((m) => m.id === "225");
    return (
      totals.find((m) => (m.specifier ?? "").includes(line)) ??
      totals.find((m) => {
        const outs = openOutcomes(m);
        const prices = outs.map((o) => Number(o.odds ?? 99));
        return prices.every((n) => n >= 1.45 && n <= 2.4);
      }) ??
      null
    );
  }
  if (target === "win") return markets.find((m) => m.id === "1") ?? null;
  if (target === "dc") return markets.find((m) => m.id === "10") ?? null;
  if (target === "dnb") return markets.find((m) => m.id === "11") ?? null;
  if (target === "gg") return markets.find((m) => m.id === "29") ?? null;
  const spec = target === "ou15" ? "total=1.5" : target === "ou35" ? "total=3.5" : "total=2.5";
  return (
    markets.find((m) => m.id === "18" && m.specifier === spec) ??
    markets.find((m) => m.id === "18" && (m.specifier === spec.replace(".5", ""))) ??
    null
  );
}

function preferForTarget(target: MarketTarget, original: TicketPick): string {
  const bias = selectionBias(original.selection);
  if (target.startsWith("ou")) return bias === "under" ? "under" : "over";
  if (target === "gg") return bias === "no" ? "no" : "yes";
  if (target === "dc") {
    if (bias === "home" || bias === "1x") return "1x";
    if (bias === "away" || bias === "x2") return "x2";
    return "12";
  }
  if (target === "dnb" || target === "win") {
    if (bias === "away" || bias === "x2") return "away";
    if (bias === "home" || bias === "1x") return "home";
    return "away";
  }
  return "over";
}

export async function retargetPicks(
  picks: TicketPick[],
  target: MarketTarget,
): Promise<TicketPick[]> {
  const ids = [...new Set(picks.map((p) => p.sporty?.eventId).filter(Boolean))] as string[];
  const details = await mapPool(ids, 6, fetchEvent);
  const byId = new Map<string, EventDetail>();
  ids.forEach((id, i) => {
    const ev = details[i];
    if (ev) byId.set(id, ev);
  });
  const next: TicketPick[] = [];
  for (const pick of picks) {
    const eventId = pick.sporty?.eventId;
    const ev = eventId ? byId.get(eventId) : undefined;
    if (!ev) {
      next.push(pick);
      continue;
    }
    const market = marketForTarget(ev, pick.sport, target);
    const outcome = market ? chooseOutcome(market, preferForTarget(target, pick)) : undefined;
    const swapped = market && outcome ? toPick(ev, pick.sport === "basketball" ? "basketball" : "football", market, outcome) : null;
    next.push(swapped ?? pick);
  }
  return next;
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
