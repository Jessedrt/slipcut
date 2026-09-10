import type { BookSport, SportKind, SportySelection, TicketPick } from "./types";
import { isChampionsLeague } from "./intent.ts";

// TEMP: full file restored via next commit — open markets shim
export function mapSport(name?: string, id?: string): SportKind {
  const n = (name ?? "").toLowerCase();
  const sid = (id ?? "").toLowerCase();
  if (n.includes("virtual")) return "other";
  if (n.includes("handball")) return "handball";
  if (n.includes("tennis")) return "tennis";
  if (n.includes("basket") || n.includes("nba")) return "basketball";
  if ((n.includes("football") && !n.includes("american")) || n.includes("soccer")) return "football";
  return "other";
}

export function cookablePick(p: TicketPick) {
  if (!p.sporty?.eventId || !p.sporty?.marketId) return false;
  if (p.sport === "other") return false;
  return true;
}

export function sportyOf(picks: TicketPick[]): SportySelection[] {
  return picks.map((p) => p.sporty).filter((s): s is SportySelection => Boolean(s?.eventId));
}

export async function loadBookingCode(code: string, preferred?: string): Promise<{ picks: TicketPick[]; shareCode: string } | { error: string }> {
  return { error: "SportyBet module is being restored — try again in a minute." };
}

export async function mintShare(): Promise<{ error: string }> {
  return { error: "SportyBet module is being restored — try again in a minute." };
}

export async function listUpcomingPicks(): Promise<{ error: string }> {
  return { error: "SportyBet module is being restored — try again in a minute." };
}

export function windowLabel() { return ""; }
export function cookablePickName() { return ""; }
export type CookWindow = "soon" | "today" | "week" | "fortnight" | "weekend";
