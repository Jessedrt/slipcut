import { marketFamily } from "./sportybet.ts";
import type { TicketPick } from "./types.ts";

/**
 * Pure accuracy-led gate (no database). The DB-backed stats loader lives in
 * ./accuracy.ts so this file can be unit-tested in isolation.
 */

/** Minimum total settled legs before the average-based gate is trusted. */
const MIN_TOTAL_SAMPLES = 10;
/** Minimum settled legs in a single (sport, family) group before it is scored. */
const MIN_GROUP_SAMPLES = 5;

export type GroupRate = {
  won: number;
  lost: number;
  rate: number;
};

export type AccuracyStats = {
  /** Engine-wide settled hit rate (won / (won + lost)), 0..1. */
  average: number;
  /** Total settled legs considered. */
  sampleCount: number;
  /** Rates keyed by `${sport}|${family}`. */
  groups: Record<string, GroupRate>;
};

/**
 * Whether a given sport+family is allowed under the accuracy restriction.
 *
 * - The `win` / 1X2 family (draws + straight home/away wins) is always dropped
 *   for football and basketball.
 * - Until the engine has enough settled legs the gate is permissive (it cannot
 *   judge a record it has not built yet).
 * - Once there is history, a group is only kept if its settled record is at or
 *   above the engine-wide average. Groups with too little data are left in so
 *   the engine can keep learning; only proven-below-average groups are removed.
 */
export function groupAllowed(
  sport: string,
  family: string,
  stats: AccuracyStats,
): boolean {
  if ((sport === "football" || sport === "basketball") && family === "win") {
    return false;
  }
  if (stats.sampleCount < MIN_TOTAL_SAMPLES) return true;
  const g = stats.groups[`${sport}|${family}`];
  if (!g) return true; // no record yet — not proven below average, keep learning
  if (g.won + g.lost < MIN_GROUP_SAMPLES) return true;
  return g.rate >= stats.average;
}

export function pickFamily(pick: TicketPick): string {
  return marketFamily(pick.sporty?.marketId, pick.market);
}

/**
 * Filter a pool of picks down to those the accuracy-led engine is allowed to
 * use. Returns the kept picks and how many were dropped by the gate.
 */
export function accuracyFilter<T extends TicketPick>(
  picks: T[],
  stats: AccuracyStats,
): { kept: T[]; dropped: number } {
  const kept = picks.filter((p) => groupAllowed(p.sport, pickFamily(p), stats));
  return { kept, dropped: picks.length - kept.length };
}
