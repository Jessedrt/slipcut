import { canonicalMarket } from "./selection-policy";
import type { TicketPick } from "./types";

function marketKey(pick: TicketPick) {
  const c = canonicalMarket(pick);
  return JSON.stringify([pick.sport, c.family, c.period, c.scope, c.outcome, c.line]);
}

/** Diversity only breaks equal evidence scores. Never trade evidence for variety. */
export function rankDistinctSelections<T extends TicketPick & { modelScore?: number }>(
  options: T[], priorUses: ReadonlyMap<string, number> = new Map(),
): T[] {
  const pool = [...options].sort((a, b) => (b.modelScore ?? 0) - (a.modelScore ?? 0));
  const events = new Set<string>(), markets = new Map<string, number>(), result: T[] = [];
  while (pool.length) {
    const score = pool[0]!.modelScore ?? 0;
    const tied: T[] = [];
    while (pool.length && (pool[0]!.modelScore ?? 0) === score) tied.push(pool.shift()!);
    while (tied.length) {
      tied.sort((a, b) =>
        (priorUses.get(a.id) ?? 0) - (priorUses.get(b.id) ?? 0) ||
        (markets.get(marketKey(a)) ?? 0) - (markets.get(marketKey(b)) ?? 0) ||
        (a.odds ?? 0) - (b.odds ?? 0) || a.id.localeCompare(b.id));
      const pick = tied.shift()!;
      const event = pick.sporty?.eventId ?? `${pick.sport}:${pick.home}:${pick.away}:${pick.kickoff}`;
      if (events.has(event)) continue;
      events.add(event);
      const key = marketKey(pick);
      markets.set(key, (markets.get(key) ?? 0) + 1);
      result.push(pick);
    }
  }
  return result;
}
