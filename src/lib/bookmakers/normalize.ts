import type {
  BookmakerId,
  BookmakerSelectionRef,
  NormalizedMarket,
  NormalizedMarketFamily,
  NormalizedPeriod,
  Ticket,
  TicketPick,
} from "../types";

const TEAM_ALIASES: Record<string, string> = {
  "man utd": "manchester united",
  "man united": "manchester united",
  "man u": "manchester united",
  "man city": "manchester city",
  "psg": "paris saint germain",
  "inter": "inter milan",
  "inter milano": "inter milan",
  "bayern": "bayern munich",
  "bayern munchen": "bayern munich",
  "atletico": "atletico madrid",
  "atletico de madrid": "atletico madrid",
  "spurs": "tottenham hotspur",
  "wolves": "wolverhampton wanderers",
  "newcastle": "newcastle united",
  "west ham": "west ham united",
};

export function normalizeName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(fc|cf|sc|afc|cfc|club|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_ALIASES[cleaned] ?? cleaned;
}

function extractNumber(text: string): number | undefined {
  const hit = text.match(/(?:total|over|under|o\/u|handicap|hcp|games?|corners?)?\s*([+-]?\d+(?:\.\d+)?)/i);
  if (!hit) return undefined;
  const value = Number(hit[1]);
  return Number.isFinite(value) ? value : undefined;
}

function periodOf(text: string): NormalizedPeriod {
  const t = text.toLowerCase();
  if (/\b(first|1st|1h|ht)\s*(half|half-time)?\b|\bhalf\s*time\b/.test(t)) return "first_half";
  if (/\b(second|2nd|2h)\s*half\b/.test(t)) return "second_half";
  if (/\b(first|1st)\s*set\b/.test(t)) return "first_set";
  if (/\b(second|2nd)\s*set\b/.test(t)) return "second_set";
  if (/\b(q1|1st quarter|first quarter)\b/.test(t)) return "q1";
  if (/\b(q2|2nd quarter|second quarter)\b/.test(t)) return "q2";
  if (/\b(q3|3rd quarter|third quarter)\b/.test(t)) return "q3";
  if (/\b(q4|4th quarter|fourth quarter)\b/.test(t)) return "q4";
  return "match";
}

function outcomeOf(selection: string): string {
  const s = normalizeName(selection);
  if (/\b(over)\b/.test(s)) return "over";
  if (/\b(under)\b/.test(s)) return "under";
  if (/^(yes|gg|btts yes)$/.test(s)) return "yes";
  if (/^(no|ng|btts no)$/.test(s)) return "no";
  if (/^(1x|home draw|home or draw)$/.test(s)) return "1x";
  if (/^(x2|draw away|draw or away)$/.test(s)) return "x2";
  if (/^(12|home away|home or away)$/.test(s)) return "12";
  if (/^(1|home|home win|home team)$/.test(s)) return "home";
  if (/^(x|draw|tie)$/.test(s)) return "draw";
  if (/^(2|away|away win|away team)$/.test(s)) return "away";
  if (/\bhome\b/.test(s) && /\bdraw\b/.test(s)) return "1x";
  if (/\baway\b/.test(s) && /\bdraw\b/.test(s)) return "x2";
  return s || "other";
}

export function normalizeMarket(
  market: string,
  selection: string,
  specifier?: string,
): NormalizedMarket {
  const blob = `${market} ${selection} ${specifier ?? ""}`.toLowerCase();
  const period = periodOf(blob);
  let family: NormalizedMarketFamily = "other";
  if (/double chance|\bdc\b/.test(blob)) family = "double_chance";
  else if (/draw no bet|\bdnb\b/.test(blob)) family = "draw_no_bet";
  else if (/both teams.*score|\bbtts\b|\bgg\/?ng\b/.test(blob)) family = "btts";
  else if (/odd\/?even|odd or even/.test(blob)) family = "odd_even";
  else if (/corner/.test(blob)) family = "corners";
  else if (/handicap|\bhcp\b/.test(blob)) family = "handicap";
  else if (/home.*total|away.*total|team total/.test(blob)) family = "team_total";
  else if (/over|under|o\/u|total games|total points|total goals|total/.test(blob)) family = "total";
  else if (/winner|moneyline|1x2|match result|to win|\bhome\b|\baway\b|\bdraw\b/.test(blob)) family = "winner";

  const scope = /home.*total|home team/.test(blob)
    ? "home"
    : /away.*total|away team/.test(blob)
      ? "away"
      : "match";
  const fromSpecifier =
    specifier?.match(/(?:total|hcp)=([+-]?\d+(?:\.\d+)?)/i)?.[1];
  const line = fromSpecifier ? Number(fromSpecifier) : extractNumber(`${market} ${selection}`);

  return {
    family,
    period,
    ...(Number.isFinite(line) ? { line } : {}),
    scope,
    outcome: outcomeOf(selection),
  };
}

export function normalizePick(pick: TicketPick): TicketPick {
  const sportyRef: BookmakerSelectionRef | undefined = pick.sporty
    ? {
        bookmaker: "sportybet",
        eventId: pick.sporty.eventId,
        marketId: pick.sporty.marketId,
        outcomeId: pick.sporty.outcomeId,
        specifier: pick.sporty.specifier,
      }
    : undefined;
  return {
    ...pick,
    normalizedHome: normalizeName(pick.home),
    normalizedAway: normalizeName(pick.away),
    normalizedLeague: normalizeName(pick.league),
    normalizedMarket:
      pick.normalizedMarket ?? normalizeMarket(pick.market, pick.selection, pick.sporty?.specifier),
    bookmakerRefs: {
      ...(pick.bookmakerRefs ?? {}),
      ...(sportyRef ? { sportybet: sportyRef } : {}),
    },
  };
}

export function normalizeTicket(ticket: Ticket): Ticket {
  return { ...ticket, picks: ticket.picks.map(normalizePick) };
}

export function bookmakerRef(
  pick: TicketPick,
  bookmaker: BookmakerId,
): BookmakerSelectionRef | undefined {
  if (pick.bookmakerRefs?.[bookmaker]) return pick.bookmakerRefs[bookmaker];
  if (bookmaker === "sportybet" && pick.sporty) {
    return {
      bookmaker,
      eventId: pick.sporty.eventId,
      marketId: pick.sporty.marketId,
      outcomeId: pick.sporty.outcomeId,
      specifier: pick.sporty.specifier,
    };
  }
  return undefined;
}

export function eventKey(pick: TicketPick): string {
  for (const bookmaker of ["sportybet", "bet9ja", "1xbet"] as const) {
    const id = bookmakerRef(pick, bookmaker)?.eventId;
    if (id) return `${bookmaker}:${id}`;
  }
  const p = normalizePick(pick);
  const minute = p.kickoff ? Math.round(p.kickoff / 60_000) : 0;
  return `${p.sport}:${p.normalizedHome}:${p.normalizedAway}:${minute}`;
}

export type RelayBookPick = {
  home: string;
  away: string;
  competition?: string;
  market: string;
  pick: string;
  odds?: number;
};

function relayPeriodPrefix(period: NormalizedPeriod) {
  if (period === "first_half") return "HT ";
  if (period === "second_half") return "2H ";
  return "";
}

export function toRelayBookPick(pick: TicketPick): RelayBookPick | null {
  const p = normalizePick(pick);
  const m = p.normalizedMarket!;
  const prefix = relayPeriodPrefix(m.period);
  let market = "";
  let selected = "";

  if (m.family === "winner") {
    market = m.period === "first_half" ? "HT 1X2" : "1X2";
    selected = m.outcome === "home" ? "Home" : m.outcome === "draw" ? "Draw" : m.outcome === "away" ? "Away" : pick.selection;
  } else if (m.family === "double_chance") {
    market = `${prefix}DC`.trim();
    selected = m.outcome.toUpperCase();
  } else if (m.family === "draw_no_bet" && m.period === "match") {
    market = "DNB";
    selected = m.outcome === "home" ? "Home" : m.outcome === "away" ? "Away" : pick.selection;
  } else if (m.family === "btts") {
    market = `${prefix}BTTS`.trim();
    selected = m.outcome === "yes" ? "Yes" : m.outcome === "no" ? "No" : pick.selection;
  } else if (m.family === "total" || m.family === "team_total") {
    if (!Number.isFinite(m.line)) return null;
    if (m.family === "team_total") {
      if (m.period !== "match") return null;
      market = m.scope === "home" ? "Home O/U" : m.scope === "away" ? "Away O/U" : "O/U";
    } else {
      market = m.period === "first_half" ? "HT O/U" : m.period === "second_half" ? "2H O/U" : "O/U";
    }
    selected = `${m.outcome === "under" ? "Under" : "Over"} ${m.line}`;
  } else if (m.family === "corners") {
    market = "Corners";
    selected = pick.selection;
  } else {
    return null;
  }

  return {
    home: pick.home,
    away: pick.away,
    ...(pick.league ? { competition: pick.league } : {}),
    market,
    pick: selected,
    ...(Number.isFinite(pick.odds) ? { odds: pick.odds } : {}),
  };
}
