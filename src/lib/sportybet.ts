import type { BookSport, SportKind, SportySelection, TicketPick } from "./types";
import { isChampionsLeague } from "./intent.ts";

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
const HANDBALL_IDS = new Set(["sr:sport:6", "6"]);
const COUNTRY_FALLBACKS = ["ng", "gh", "ke", "za", "tz", "ug", "zm", "cm"];

export function mapSport(name?: string, id?: string): SportKind {
  const n = (name ?? "").toLowerCase();
  const sid = (id ?? "").toLowerCase();
  if (n.includes("virtual")) return "other";
  if (n.includes("handball") || HANDBALL_IDS.has(sid)) return "handball";
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
  /premier league|laliga|la liga|serie a|bundesliga|ligue 1|champions league|\bucl\b|uefa cl|caf champions|afc champions|concacaf champions|europa league|\buel\b|conference league|eredivisie|primeira|championship|mls|copa libertadores|nations league|pro league|saudi|npfl/i;
const BASKETBALL_LEAGUES =
  /\bnba\b|euroleague|eurocup|ncaa|wnba|nbl|acb|bbl|cba|kbl|b\.?league|fiba|world cup|olympi|eurobasket|americup|afrobasket|aba|adriatic|liga endesa|pro a|lnb|serie a|basketbol super|vtb|nbb|champions league|cebl|nbl australia/i;
const WEAK_BASKETBALL_LEAGUE =
  /3x3|tbt\b|the basketball tournament|development|reserve|u-?1[89]|u-?2[01]|youth|cadet|junior|amateur|friendly|liga nacional|lnbp|libobasquet|liga boliviana|liga uruguaya|liga sudamericana|bcl americas|paraguayan|venezuelan|cuban|nicaragu|hondur|kosovo|albanian|mongolian|n1 league|b2 league|east asia super/i;
const TENNIS_LEAGUES = /atp|wta|us open|australian open|wimbledon|roland|french open|masters|challenger|grand slam/i;
const HANDBALL_LEAGUES =
  /ehf|champions league|bundesliga|starligue|asobal|seha|olympic|world championship|herre|eliteserien|nexe|barcelona|psg|kiel|flensburg|vesszem|pick szeged/i;
/** Simulated / virtual leagues — never real fixtures, always excluded. */
const SIMULATED_LEAGUE =
  /simulat|simulation|virtual|esoccer|e-?soccer|esport|\bsrl\b|fifa|\bpes\b|arcade|\bcrowd\b|robots?/i;

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
): "win" | "dc" | "ou" | "gg" | "dnb" | "hcp" | "ou1h" | "teamou" | "odd" | "corners" {
  const d = (desc ?? "").toLowerCase();
  if (id === "10" || id === "63" || d.includes("double chance")) return "dc";
  if (id === "186" || id === "202" || id === "1" || id === "219" || id === "60") return "win";
  if (id === "187" || id === "188" || id === "16" || id === "14" || id === "223" || id === "66" || d.includes("handicap"))
    return "hcp";
  if (id === "68" || id === "69" || id === "70" || (id === "236" && d.includes("1st")) || (d.includes("1st half") && (d.includes("over") || d.includes("total"))))
    return "ou1h";
  if (id === "227" || id === "228") return "teamou";
  if (id === "8" || d.includes("odd/even") || d.includes("odd or even")) return "odd";
  if (id === "166" || id === "90" || d.includes("corner")) return "corners";
  if (id === "29" || id === "64" || d.includes("gg/ng") || d.includes("both teams to score")) return "gg";
  if (id === "11" || d.includes("draw no bet")) return "dnb";
  if (
    id === "189" ||
    id === "204" ||
    id === "314" ||
    id === "18" ||
    id === "225" ||
    id === "62" ||
    d.includes("over/under") ||
    d.includes("total games")
  )
    return "ou";
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
  else if (market.id === "62") label = `2nd Half O/U ${total}`.trim();
  else if (market.id === "63") label = "1st Half Double Chance";
  else if (market.id === "64") label = "1st Half GG";
  else if (market.id === "8") label = "Odd/Even";
  else if (market.id === "166" || /corner/i.test(market.desc ?? "")) label = `Corners ${total}`.trim();
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
  const picks: TicketPick[] = [];
  const pull = (pred: (m: EventMarket) => boolean, oversOnly = false) => {
    for (const market of markets) {
      if (!pred(market)) continue;
      if (oversOnly) pushOver(picks, ev, "football", market);
      else pushMarket(picks, ev, "football", market);
    }
  };

  // Keep 1X2 in the event pool so research can see the favourite — cookablePick strips it before booking.
  pull((m) => m.id === "1");
  pull((m) => m.id === "10");
  pull((m) => m.id === "11");
  pull((m) => m.id === "29" || /both teams|btts|gg/i.test(m.desc ?? ""));
  pull((m) => m.id === "63" || /1st half.*double chance/i.test(m.desc ?? ""));
  pull((m) => m.id === "64");
  pull((m) => m.id === "16" || m.id === "14" || m.id === "223");
  pull((m) => m.id === "66");

  for (const line of ["0.5", "1.5", "2", "2.5", "3", "3.5", "4.5"]) {
    pull((m) => m.id === "18" && m.specifier === `total=${line}`);
  }
  for (const line of ["0.5", "1", "1.5"]) {
    pull((m) => m.id === "68" && m.specifier === `total=${line}`, true);
  }
  pull((m) => m.id === "62" || /2nd half.*over\/under/i.test(m.desc ?? ""), true);
  pull((m) => (m.id === "227" || m.id === "228") && /total=(0\.5|1\.5)/.test(m.specifier ?? ""), true);
  pull((m) => (m.id === "69" || m.id === "70") && /total=(0\.5|1|1\.5)/.test(m.specifier ?? ""), true);
  pull(
    (m) => /corner/i.test(m.desc ?? "") && /over\/under|total/i.test(m.desc ?? "") && /total=(8\.5|9\.5|10\.5|11\.5)/.test(m.specifier ?? ""),
    true,
  );
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

function isPrematch(ev: EventDetail, now = Date.now()) {
  if (ev.status !== 0 || ev.banned) return false;
  if (typeof ev.period === "number" && ev.period > 0) return false;
  if (/live|started|1st|2nd|3rd|4th|q1|q2|q3|q4|\bht\b|half/i.test(ev.matchStatus ?? "")) return false;
  const t = ev.estimateStartTime ?? 0;
  if (t && t < now + 12 * 60_000) return false;
  return true;
}

function specNum(market: EventMarket, key: string) {
  const n = Number((market.specifier ?? "").match(new RegExp(`${key}=(-?[\\d.]+)`))?.[1]);
  return Number.isFinite(n) ? n : null;
}

function specTotal(market: EventMarket) {
  return specNum(market, "total");
}

function balancedOver(
  markets: EventMarket[],
  minLine: number,
  maxLine: number,
): EventMarket | undefined {
  let best: EventMarket | undefined;
  let bestScore = -999;
  for (const market of markets) {
    const total = specTotal(market);
    const over = openOutcomes(market).find((o) => /over/i.test(o.desc ?? ""));
    const odds = Number(over?.odds);
    if (!over || total == null || total < minLine || total > maxLine) continue;
    if (!Number.isFinite(odds) || odds < 1.4 || odds > 1.72) continue;
    const s = 20 - Math.abs(odds - 1.55) * 16;
    if (s > bestScore) {
      bestScore = s;
      best = market;
    }
  }
  return best ?? mostBalanced(markets.filter((m) => {
    const t = specTotal(m);
    return t != null && t >= minLine && t <= maxLine;
  }));
}

function lowerOverLine(markets: EventMarket[]): EventMarket | undefined {
  const main = mostBalanced(markets);
  const mainTotal = main ? specNum(main, "total") : null;
  let best: EventMarket | undefined;
  let bestScore = -999;
  for (const market of markets) {
    const total = specNum(market, "total");
    const over = openOutcomes(market).find((o) => /over/i.test(o.desc ?? ""));
    const odds = Number(over?.odds);
    if (!over || !inBookWindow(odds) || total == null) continue;
    if (odds > 1.78) continue;
    let s = 20 - Math.abs(odds - 1.52) * 14;
    if (mainTotal != null) {
      const drop = mainTotal - total;
      if (drop >= 3 && drop <= 12) s += 16;
      else if (drop > 12) s += 4;
      else if (drop < 0) s -= 14;
    }
    if (s > bestScore) {
      bestScore = s;
      best = market;
    }
  }
  return best ?? main;
}

function pushOver(
  picks: TicketPick[],
  ev: EventDetail,
  sport: BookSport,
  market: EventMarket | undefined,
) {
  if (!market) return;
  for (const outcome of openOutcomes(market)) {
    if (/under/i.test(outcome.desc ?? "")) continue;
    const pick = toPick(ev, sport, market, outcome);
    if (pick && inBookWindow(pick.odds) && (pick.odds as number) <= 1.78) picks.push(pick);
  }
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
  pushMarket(picks, ev, "basketball", markets.find((m) => m.id === "219") || markets.find((m) => m.id === "186"));
  pushMarket(picks, ev, "basketball", mostBalanced(markets.filter((m) => m.id === "223" || m.id === "14")));
  for (const id of ["225", "18", "227", "228", "68", "69", "70"]) {
    const best = lowerOverLine(markets.filter((m) => m.id === id)) || mostBalanced(markets.filter((m) => m.id === id));
    if (best) pushMarket(picks, ev, "basketball", best);
  }
  pushMarket(
    picks,
    ev,
    "basketball",
    lowerOverLine(markets.filter((m) => m.id === "236" && (m.specifier ?? "").includes("quarternr=1"))),
  );
  return picks;
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

function handballCandidates(ev: EventDetail): TicketPick[] {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];
  pushMarket(picks, ev, "handball", markets.find((m) => m.id === "1"));
  pushMarket(picks, ev, "handball", markets.find((m) => m.id === "10"));
  pushMarket(picks, ev, "handball", markets.find((m) => m.id === "11"));
  pushOver(picks, ev, "handball", lowerOverLine(markets.filter((m) => m.id === "18")));
  pushOver(
    picks,
    ev,
    "handball",
    lowerOverLine(markets.filter((m) => m.id === "18" && /total=4[5-9]\.5|total=5[0-6]\.5/.test(m.specifier ?? ""))),
  );
  const ou = markets.find((m) => m.id === "18" && (m.specifier === "total=48.5" || m.specifier === "total=47.5" || m.specifier === "total=49.5"));
  if (ou) pushOver(picks, ev, "handball", ou);
  pushOver(picks, ev, "handball", lowerOverLine(markets.filter((m) => m.id === "68")));
  return picks;
}

export function cookablePick(p: TicketPick) {
  if (!p.sporty?.eventId || !p.sporty?.marketId) return false;
  if (p.sport === "other") return false;
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
      Number(a === "odd") - Number(b === "odd") ||
      Number(a === "hcp") - Number(b === "hcp"),
  );
  let family = families[0];
  if (hasOu && ouShare < 0.22) family = "ou";
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
  if (!ts || ts < now - 60_000) return false;
  // "soon" = next ~30 hours only (not multi-day fixtures)
  if (window === "soon") return ts <= now + 30 * 3_600_000;
  if (window === "today") {
    // Same Lagos calendar day AND not more than ~36h ahead
    if (watDay(ts).key !== watDay(now).key) return false;
    return ts <= now + 36 * 3_600_000;
  }
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

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

function sportIdOf(sport: BookSport) {
  if (sport === "basketball") return "sr:sport:2";
  if (sport === "tennis") return "sr:sport:5";
  if (sport === "handball") return "sr:sport:6";
  return "sr:sport:1";
}

function preferLeagues(sport: BookSport) {
  if (sport === "basketball") return BASKETBALL_LEAGUES;
  if (sport === "tennis") return TENNIS_LEAGUES;
  if (sport === "handball") return HANDBALL_LEAGUES;
  return FOOTBALL_LEAGUES;
}

function candidatesFor(sport: BookSport, ev: EventDetail) {
  if (sport === "basketball") return basketballCandidates(ev);
  if (sport === "tennis") return tennisCandidates(ev);
  if (sport === "handball") return handballCandidates(ev);
  return footballCandidates(ev);
}

export async function listUpcomingPicks(
  sport: BookSport,
  limit = 14,
  window: CookWindow = "soon",
  mode: "any" | "draw" = "any",
  skipIds: string[] = [],
  league: string | null = null,
): Promise<TicketPick[] | { error: string }> {
  const payload = (await sportyGet(
    `/factsCenter/commonThumbnailEvents?sportId=${encodeURIComponent(sportIdOf(sport))}`,
  )) as SharePayload & { data?: Array<{ name?: string; events?: ShareOutcome[] }> } | null;
  const tours = Array.isArray(payload?.data) ? payload.data : [];
  if (!tours.length) {
    return {
      error:
        league === "champions"
          ? "No Champions League fixtures on SportyBet right now."
          : `No upcoming ${sport} on SportyBet right now.`,
    };
  }

  const prefer = preferLeagues(sport);
  const now = Date.now();
  const skip = new Set(skipIds);
  const ranked = tours
    .flatMap((t) => (t.events ?? []).map((e) => ({ ...e, leagueHint: t.name ?? leagueName(e.sport) })))
    .filter(
      (e) =>
        e.status === 0 &&
        !e.banned &&
        e.eventId &&
        !SIMULATED_LEAGUE.test(e.leagueHint ?? "") &&
        inCookWindow(e.estimateStartTime ?? 0, window, now) &&
        (league !== "champions" || isChampionsLeague(e.leagueHint ?? "")),
    )
    .sort((a, b) => {
      const as = skip.has(String(a.eventId)) ? 1 : 0;
      const bs = skip.has(String(b.eventId)) ? 1 : 0;
      if (as !== bs) return as - bs;
      if (sport === "football") {
        const ra = isChampionsLeague(a.leagueHint ?? "") ? 0 : prefer.test(a.leagueHint ?? "") ? 1 : 5;
        const rb = isChampionsLeague(b.leagueHint ?? "") ? 0 : prefer.test(b.leagueHint ?? "") ? 1 : 5;
        if (ra !== rb) return ra - rb;
      } else {
        const ap = prefer.test(a.leagueHint ?? "") ? 0 : 1;
        const bp = prefer.test(b.leagueHint ?? "") ? 0 : 1;
        if (ap !== bp) return ap - bp;
      }
      return (a.estimateStartTime ?? 0) - (b.estimateStartTime ?? 0);
    });
  const fresh = shuffle(ranked.filter((e) => !skip.has(String(e.eventId))));
  const stale = ranked.filter((e) => skip.has(String(e.eventId)));
  const upcoming = spreadByDay([...fresh, ...stale], window);

  const want = Math.max(1, Math.min(42, limit));
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
      if (SIMULATED_LEAGUE.test(leagueName(ev.sport))) continue;
      if (events >= want) break;
      if (mode === "draw") {
        if (sport !== "football") continue;
        const draw = drawFromEvent(ev);
        if (draw) {
          picks.push(draw);
          events += 1;
        }
      } else {
        const open = candidatesFor(sport, ev);
        const bookable = open.filter(cookablePick);
        if (!bookable.length) continue;
        // Keep 1X2 (and other non-bookable) in the pool so research can see the favourite.
        picks.push(...open);
        events += 1;
      }
    }
  }
  if (!picks.length) {
    return {
      error:
        league === "champions"
          ? "No Champions League fixtures open now. Try later today."
          : `Could not read ${sport} markets on SportyBet.`,
    };
  }
  return picks;
}

export type MarketTarget = "ou15" | "ou25" | "ou35" | "gg" | "dc" | "dnb" | "win";

export type CookAsk = {
  period: "ft" | "1h" | "q1" | "any";
  side: "over" | "under" | "any";
  line?: number;
  family?: "ou" | "ou1h" | "teamou" | "gg" | "dc" | "dnb" | "win" | "hcp" | "odd" | "corners";
};

export function parseCookAsks(text: string): CookAsk[] {
  const t = text
    .toLowerCase()
    .replace(/full[-\s]?times?/g, "fulltime")
    .replace(/full[-\s]?games?/g, "fulltime")
    .replace(/half[-\s]?times?/g, "halftime");
  const asks: CookAsk[] = [];
  const add = (a: CookAsk) => {
    const key = JSON.stringify(a);
    if (!asks.some((x) => JSON.stringify(x) === key)) asks.push(a);
  };

  const has1h = /1st\s*half|first\s*half|\b1h\b|halftime/.test(t);
  const hasFt = /fulltime|\bft\b/.test(t);
  const hasQ1 = /1st\s*quarter|first\s*quarter|\bq1\b/.test(t);
  const hasOver = /\bovers?\b|\bover\b/.test(t);
  const hasUnder = /\bunders?\b|\bunder\b/.test(t);
  const side: CookAsk["side"] = hasUnder && !hasOver ? "under" : hasOver || has1h || hasFt || hasQ1 ? "over" : "any";

  const lines: number[] = [];
  if (/over\s*3\.5|o\s*3\.5|ou\s*3\.5|o3\.5/.test(t)) lines.push(3.5);
  if (/over\s*2\.5|o\s*2\.5|ou\s*2\.5|o2\.5/.test(t)) lines.push(2.5);
  if (/(?:over\s*2|o\s*2|ou\s*2)(?!\.5|\.\d)/.test(t)) lines.push(2);
  if (/over\s*1\.5|o\s*1\.5|ou\s*1\.5|o1\.5/.test(t)) lines.push(1.5);
  if (/over\s*0\.5|o0\.5|ou\s*0\.5/.test(t)) lines.push(0.5);

  if (/\bgg\b|btts|both teams/.test(t)) add({ period: /1st\s*half|first\s*half|\b1h\b/.test(t) ? "1h" : "any", side: "any", family: "gg" });
  if (/draw no bet|\bdnb\b/.test(t)) add({ period: "any", side: "any", family: "dnb" });
  if (/double chance|\bdc\b/.test(t) || (/home or away/.test(t) && !hasOver)) add({ period: /1st\s*half|first\s*half|\b1h\b/.test(t) ? "1h" : "any", side: "any", family: "dc" });
  if (/corners?/.test(t)) add({ period: "any", side: side === "any" ? "over" : side, family: "corners" });
  // handicap / 1x2 win no longer primary cook options
  if (/team totals?|home total|away total|individual over/.test(t)) {
    add({ period: "ft", side: side === "any" ? "over" : side, family: "teamou" });
  }

  const periods: CookAsk["period"][] = [];
  if (hasFt) periods.push("ft");
  if (has1h) periods.push("1h");
  if (hasQ1) periods.push("q1");
  if (!periods.length && (lines.length || hasOver || hasUnder)) periods.push("ft");

  for (const period of periods) {
    const family = period === "1h" ? "ou1h" : "ou";
    if (lines.length) {
      for (const line of lines) add({ period, side: side === "any" ? "over" : side, line, family });
    } else if (hasOver || hasUnder || has1h || hasFt || hasQ1) {
      add({ period, side: side === "any" ? "over" : side, family });
    }
  }
  return asks;
}

export function formatCookAsks(asks: CookAsk[]): string {
  if (!asks.length) return "";
  return asks
    .map((a) => {
      if (a.family === "gg") return "GG";
      if (a.family === "dnb") return "DNB";
      if (a.family === "dc") return "DC";
      if (a.family === "hcp") return "handicap";
      if (a.family === "win") return "1X2";
      if (a.family === "teamou") return a.side === "under" ? "team Under" : "team Over";
      if (a.family === "corners") return "corners";
      if (a.family === "odd") return "odd/even";
      const when = a.period === "1h" ? "1H " : a.period === "q1" ? "Q1 " : a.period === "ft" ? "FT " : "";
      const side = a.side === "under" ? "Under" : a.side === "over" ? "Over" : "O/U";
      return `${when}${side}${a.line != null ? ` ${a.line}` : ""}`.trim();
    })
    .join(" + ");
}

function pickPeriod(p: TicketPick): "ft" | "1h" | "q1" | "other" {
  const id = p.sporty?.marketId;
  if (id === "236" || /1st quarter/i.test(p.market)) return "q1";
  if (id === "68" || id === "69" || id === "70" || id === "63" || id === "64" || /1st half|1h /i.test(p.market)) return "1h";
  if (id === "18" || id === "225" || id === "227" || id === "228") return "ft";
  const fam = marketFamily(p.sporty?.marketId, p.market);
  if (fam === "ou1h") return "1h";
  if (fam === "ou" || fam === "teamou") return "ft";
  return "other";
}

function pickLine(p: TicketPick): number | null {
  const spec = p.sporty?.specifier ?? "";
  const fromSpec = Number(spec.match(/total=([\d.]+)/)?.[1]);
  if (Number.isFinite(fromSpec)) return fromSpec;
  const fromMkt = Number((p.market ?? "").match(/(\d+(?:\.\d+)?)/)?.[1]);
  return Number.isFinite(fromMkt) ? fromMkt : null;
}

export function pickMatchesAsks(p: TicketPick, asks: CookAsk[]): boolean {
  if (!asks.length) return true;
  const fam = marketFamily(p.sporty?.marketId, p.market);
  const period = pickPeriod(p);
  const sel = (p.selection ?? "").toLowerCase();
  const over = /\bover\b/.test(sel);
  const under = /\bunder\b/.test(sel);
  const line = pickLine(p);
  return asks.some((ask) => {
    if (ask.family === "gg") {
      if (ask.period === "1h") return fam === "gg" && period === "1h";
      return fam === "gg";
    }
    if (ask.family === "dnb") return fam === "dnb";
    if (ask.family === "dc") return fam === "dc";
    if (ask.family === "hcp") return fam === "hcp";
    if (ask.family === "win") return fam === "win";
    if (ask.family === "corners") return fam === "corners";
    if (ask.family === "odd") return fam === "odd";
    if (ask.family === "teamou") {
      if (fam !== "teamou") return false;
      if (ask.side === "over" && !over) return false;
      if (ask.side === "under" && !under) return false;
      return true;
    }
    if (ask.period === "1h" && period !== "1h") return false;
    if (ask.period === "ft" && period !== "ft") return false;
    if (ask.period === "q1" && period !== "q1") return false;
    if (ask.period === "ft" && (fam === "teamou" || p.sporty?.marketId === "227" || p.sporty?.marketId === "228"))
      return false;
    if (ask.side === "over" && !over) return false;
    if (ask.side === "under" && !under) return false;
    if (ask.line != null && line != null && line !== ask.line) return false;
    if (ask.family === "ou" && fam !== "ou" && fam !== "ou1h") return false;
    if (ask.family === "ou1h" && fam !== "ou1h") return false;
    return fam === "ou" || fam === "ou1h" || over || under;
  });
}

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
