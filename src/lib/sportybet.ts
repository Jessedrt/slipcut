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
    status?: number;
    outcomes?: Array<{
      id?: number | string;
      desc?: string;
      odds?: string | number;
      isActive?: number;
    }>;
  }>;
};

const FOOTBALL_IDS = new Set(["sr:sport:1", "1"]);
const BASKETBALL_IDS = new Set(["sr:sport:2", "2"]);
const TENNIS_IDS = new Set(["sr:sport:5", "5"]);
const HANDBALL_IDS = new Set(["sr:sport:6", "6"]);

export function mapSport(name?: string, id?: string): SportKind {
  const n = (name ?? "").toLowerCase();
  const sid = (id ?? "").toLowerCase();
  if (n.includes("virtual")) return "other";
  if (n.includes("handball") || HANDBALL_IDS.has(sid)) return "handball";
  if (n.includes("tennis") || TENNIS_IDS.has(sid)) return "tennis";
  if (n.includes("basket") || BASKETBALL_IDS.has(sid)) return "basketball";
  if ((n.includes("football") && !n.includes("american")) || n.includes("soccer") || FOOTBALL_IDS.has(sid))
    return "football";
  return "other";
}
