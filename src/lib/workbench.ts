import type { AnalyzedPick } from "./types";

export function combinedOdds(picks: { odds?: number }[]): number | null {
  if (!picks.length) return null;
  if (picks.some((p) => !p.odds || p.odds <= 1)) return null;
  return picks.reduce((acc, p) => acc * (p.odds as number), 1);
}

export function expectedValue(probability: number, odds?: number): number | null {
  if (!odds || odds <= 1 || !Number.isFinite(probability)) return null;
  return (probability / 100) * odds - 1;
}

export function formatKickoff(ms?: number) {
  if (!ms) return "";
  const d = new Date(ms + 3_600_000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${hh}:${mm} WAT`;
}

export function uniqueEvents<T extends { sporty?: { eventId?: string }; home?: string; away?: string; kickoff?: number }>(
  picks: T[],
): { picks: T[]; dropped: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of picks) {
    const id = p.sporty?.eventId || `${p.home ?? ""}|${p.away ?? ""}|${p.kickoff ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return { picks: out, dropped: picks.length - out.length };
}

export function formatOdds(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 100) return `${Math.round(n)}×`;
  if (n >= 10) return `${n.toFixed(1)}×`;
  return `${n.toFixed(2)}×`;
}

export function buildToOdds<T extends { odds?: number }>(picks: T[], target: number): T[] {
  const cap = Math.max(1.2, Math.min(1000, target));
  const pool = picks
    .filter((p) => p.odds && p.odds > 1.08 && p.odds < 8)
    .slice()
    .sort((a, b) => (a.odds as number) - (b.odds as number));
  const kept: T[] = [];
  let prod = 1;
  for (const pick of pool) {
    const o = pick.odds as number;
    const next = prod * o;
    if (kept.length && next > cap * 1.25) continue;
    kept.push(pick);
    prod = next;
    if (prod >= cap * 0.95) break;
  }
  if (prod < cap * 0.9) {
    for (const pick of pool) {
      if (kept.includes(pick)) continue;
      const o = pick.odds as number;
      if (!o) continue;
      kept.push(pick);
      prod *= o;
      if (prod >= cap * 0.95) break;
    }
  }
  return kept;
}

export function formatEv(n: number) {
  const pct = Math.round(n * 1000) / 10;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

export function splitEven<T>(items: T[], parts: number): T[][] {
  const n = Math.max(2, Math.min(8, Math.floor(parts)));
  if (items.length === 0) return [];
  if (items.length < n) return items.map((item) => [item]);
  const buckets: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => {
    const row = Math.floor(i / n);
    const col = row % 2 === 0 ? i % n : n - 1 - (i % n);
    buckets[col]?.push(item);
  });
  return buckets.filter((b) => b.length);
}

/**
 * Remove risk from an existing accumulator until its price is near the requested
 * target. The weakest model probability is removed first whenever doing so does
 * not materially undershoot the target; implied probability is the fallback.
 */
export function riskTrimToOdds<T extends { odds?: number; probability?: number }>(
  picks: T[],
  target: number,
): { kept: T[]; removed: T[]; combinedOdds: number | null } {
  const requested = Number.isFinite(target) ? Math.max(1.2, Math.min(1000, target)) : 50;
  const kept = picks.filter(
    (pick) => Number.isFinite(pick.odds) && (pick.odds as number) > 1.0001,
  );
  const removed = picks.filter(
    (pick) => !Number.isFinite(pick.odds) || (pick.odds as number) <= 1.0001,
  );

  const probabilityOf = (pick: T) => {
    const model = Number(pick.probability);
    if (Number.isFinite(model) && model > 0 && model <= 100) return model;
    const odds = Number(pick.odds);
    return odds > 1 ? 100 / odds : 100;
  };
  const productOf = (rows: T[]) =>
    rows.length ? rows.reduce((product, pick) => product * Number(pick.odds), 1) : 1;

  let current = productOf(kept);
  if (current <= requested * 1.05) {
    return { kept, removed, combinedOdds: kept.length ? current : null };
  }

  while (kept.length > 1 && current > requested * 1.05) {
    const candidates = kept.map((pick, index) => {
      const next = current / Number(pick.odds);
      const below = next < requested;
      const undershoot = below ? requested / Math.max(1, next) - 1 : 0;
      const overshoot = next >= requested ? next / requested - 1 : 0;
      return {
        pick,
        index,
        next,
        probability: probabilityOf(pick),
        acceptable: next >= requested * 0.85,
        distance: below ? 1 + undershoot : overshoot,
      };
    });

    const acceptable = candidates.filter((candidate) => candidate.acceptable);
    const pool = acceptable.length ? acceptable : candidates;
    pool.sort((a, b) => {
      // Primary goal: cut the riskiest leg. If two legs are similarly risky,
      // choose the one that lands closest to the requested multiplier.
      if (Math.abs(a.probability - b.probability) > 3) return a.probability - b.probability;
      if (Math.abs(a.distance - b.distance) > 0.01) return a.distance - b.distance;
      return Number(b.pick.odds) - Number(a.pick.odds);
    });

    let chosen = pool[0]!;
    if (!acceptable.length) {
      // Every single removal would undershoot. At that point hitting the target
      // matters more than blindly deleting the absolute weakest leg.
      chosen = candidates.slice().sort((a, b) => {
        if (Math.abs(a.distance - b.distance) > 0.01) return a.distance - b.distance;
        return a.probability - b.probability;
      })[0]!;
    }

    removed.push(chosen.pick);
    kept.splice(chosen.index, 1);
    current = chosen.next;
  }

  return { kept, removed, combinedOdds: kept.length ? productOf(kept) : null };
}

export function trimToOdds(picks: AnalyzedPick[], target: number): AnalyzedPick[] {
  return riskTrimToOdds(
    picks.filter((pick) => pick.sport !== "other"),
    target,
  ).kept;
}

export function keepTop(picks: AnalyzedPick[], count: number): AnalyzedPick[] {
  const n = Math.max(1, Math.min(count, picks.length));
  return picks
    .filter((p) => p.sport !== "other")
    .slice()
    .sort((a, b) => b.probability - a.probability)
    .slice(0, n);
}

export type DeskCommand =
  | { type: "split"; parts: number }
  | { type: "trim"; targetOdds: number }
  | { type: "keepLegs"; count: number }
  | { type: "threshold"; value: number }
  | { type: "sport"; sport: "football" | "basketball" | "tennis" | "handball" }
  | { type: "dropOther" }
  | { type: "unknown"; hint: string };

export function parseCommand(raw: string): DeskCommand {
  const t = raw.trim().toLowerCase();
  if (!t) return { type: "unknown", hint: "Try: split into 3 · trim to 500x · keep 6 games" };

  const split = t.match(/split(?:\s+into)?\s+(\d+)/);
  if (split) return { type: "split", parts: Number(split[1]) };

  const trimOdds = t.match(/(?:trim|build|make|target|cook)(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*(?:odds|[x×])?/);
  if (trimOdds) return { type: "trim", targetOdds: Number(trimOdds[1]) };

  const trimGames = t.match(/trim(?:\s+to)?\s+(\d+)\s*(?:games?|legs?)?/);
  if (trimGames) return { type: "keepLegs", count: Number(trimGames[1]) };

  const keep = t.match(/keep\s+(\d+)\s*(?:legs?|picks?|games?)?/);
  if (keep && !/football|basket/.test(t)) return { type: "keepLegs", count: Number(keep[1]) };

  const th = t.match(/(?:threshold|bar|above)\s+(\d{2})/);
  if (th) return { type: "threshold", value: Number(th[1]) };

  if (/only\s+football|keep\s+football/.test(t)) return { type: "sport", sport: "football" };
  if (/only\s+tennis|keep\s+tennis/.test(t)) return { type: "sport", sport: "tennis" };
  if (/only\s+handball|keep\s+handball/.test(t)) return { type: "sport", sport: "handball" };
  if (/only\s+basket|keep\s+basket/.test(t)) return { type: "sport", sport: "basketball" };
  if (/drop\s+(other|tennis|virtuals?)/.test(t)) return { type: "dropOther" };

  return {
    type: "unknown",
    hint: "Try: trim to 500x · split into 3 · keep 6 games · keep football",
  };
}

export function copyRebuild(picks: Array<{
  home: string;
  away: string;
  market: string;
  selection: string;
  league?: string;
  odds?: number;
  kickoff?: number;
}>) {
  if (!picks.length) return "Empty slip.";
  return picks
    .map((p, i) => {
      const when = formatKickoff(p.kickoff);
      const price = p.odds ? formatOdds(p.odds) : "";
      const bits = [`${p.home} vs ${p.away}`, p.selection, price, when].filter(Boolean);
      return `${i + 1}  ${bits.join("  ·  ")}`;
    })
    .join("\n");
}

export function copySplitBook(slips: AnalyzedPick[][]) {
  return slips
    .map((slip, i) => {
      const odds = combinedOdds(slip);
      const head = `SLIP ${i + 1} · ${slip.length} games${odds ? ` · ${formatOdds(odds)}` : ""}`;
      return `${head}\n${copyRebuild(slip)}`;
    })
    .join("\n\n—\n\n");
}
