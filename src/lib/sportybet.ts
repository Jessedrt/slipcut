import type { SportKind, TicketPick } from "./types";

export type ShareOutcome = {
  eventId?: string;
  estimateStartTime?: number;
  homeTeamName?: string;
  awayTeamName?: string;
  sport?: {
    id?: string;
    name?: string;
    category?: {
      name?: string;
      tournament?: { name?: string };
    };
  };
  markets?: Array<{
    desc?: string;
    outcomes?: Array<{
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
    outcomes?: ShareOutcome[];
    betType?: string;
  };
};

const FOOTBALL_IDS = new Set(["sr:sport:1", "1"]);
const BASKETBALL_IDS = new Set(["sr:sport:2", "2"]);

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
    };
  });
}
