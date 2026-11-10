import { automaticMarketAllowed, canonicalMarket, footballDiscoverable } from "./selection-policy";
import type { BookSport, SportKind, SportySelection, TicketPick } from "./types";
import { normalizePick } from "./bookmakers/normalize";
import { isChampionsLeague } from "./intent.ts";

// File restored after accidental placeholder overwrite. Full body loaded next.
export function footballOptionAllowed(pick: TicketPick): boolean {
  return pick.sport === "football" && footballDiscoverable(pick);
}
