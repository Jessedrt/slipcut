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
 * Find a subset near the requested accumulator price while preferring to remove
 * the weakest legs. Explicit model probability is used when present; otherwise
 * decimal-odds implied probability is the risk signal.
 */
export function riskTrimToOdds<T extends { odds?: number; probability?: number; id?: string }>(
  picks: T[],
  target: number,
): { kept: T[]; removed: T[]; combinedOdds: number | null } {
  const requested = Number.isFinite(target) ? Math.max(1.2, Math.min(1000, target)) : 50;
  const eligible = picks.filter(
    (pick) => Number.isFinite(pick.odds) && (pick.odds as number) > 1.0001,
  );
  const invalid = picks.filter(
    (pick) => !Number.isFinite(pick.odds) || (pick.odds as number) <= 1.0001,
  );
  if (!eligible.length) return { kept: [], removed: [...picks], combinedOdds: null };

  const allOdds = combinedOdds(eligible);
  if (allOdds != null && allOdds <= requested * 1.05) {
    return { kept: eligible, removed: invalid, combinedOdds: allOdds };
  }

  const probabilityOf = (pick: T) => {
    const model = Number(pick.probability);
    if (Number.isFinite(model) && model > 0 && model <= 100) return model;
    const odds = Number(pick.odds);
    return odds > 1 ? Math.min(99, 100 / odds) : 99;
  };

  type State = { indexes: number[]; product: number; strength: number };
  const beamWidth = eligible.length > 18 ? 4500 : 8000;
  let states: State[] = [{ indexes: [], product: 1, strength: 0 }];

  const ordered = eligible
    .map((pick, index) => ({ pick, index, probability: probabilityOf(pick) }))
    .sort((a, b) => b.probability - a.probability || Number(a.pick.odds) - Number(b.pick.odds));

  const distance = (state: State) => {
    if (!state.indexes.length) return Number.POSITIVE_INFINITY;
    if (state.product >= requested) return state.product / requested - 1;
    return 1 + (requested / Math.max(1, state.product) - 1);
  };

  for (const row of ordered) {
    const next = states.slice();
    for (const state of states) {
      const product = state.product * Number(row.pick.odds);
      if (product > requested * 1.5 && state.indexes.length > 0) continue;
      next.push({
        indexes: [...state.indexes, row.index],
        product,
        strength: state.strength + row.probability,
      });
    }
    next.sort((a, b) => {
      const da = distance(a);
      const db = distance(b);
      if (Math.abs(da - db) > 0.015) return da - db;
      const aa = a.indexes.length ? a.strength / a.indexes.length : 0;
      const ab = b.indexes.length ? b.strength / b.indexes.length : 0;
      if (Math.abs(aa - ab) > 0.5) return ab - aa;
      return b.indexes.length - a.indexes.length;
    });
    states = next.slice(0, beamWidth);
  }

  const candidates = states.filter((state) => state.indexes.length);
  candidates.sort((a, b) => {
    const aAtOrAbove = a.product >= requested;
    const bAtOrAbove = b.product >= requested;
    const aClose = a.product >= requested * 0.9 && a.product <= requested * 1.2;
    const bClose = b.product >= requested * 0.9 && b.product <= requested * 1.2;
    if (aClose !== bClose) return aClose ? -1 : 1;
    if (aAtOrAbove !== bAtOrAbove && aClose && bClose) return aAtOrAbove ? -1 : 1;
    const da = distance(a);
    const db = distance(b);
    if (Math.abs(da - db) > 0.01) return da - db;
    const aa = a.strength / a.indexes.length;
    const ab = b.strength / b.indexes.length;
    if (Math.abs(aa - ab) > 0.25) return ab - aa;
    return b.indexes.length - a.indexes.length;
  });

  const best = candidates[0] ?? { indexes: [0], product: Number(eligible[0]!.odds), strength: probabilityOf(eligible[0]!) };
  const keptIndex = new Set(best.indexes);
  const kept = eligible.filter((_, index) => keptIndex.has(index));
  const removed = [...invalid, ...eligible.filter((_, index) => !keptIndex.has(index))]
    .sort((a, b) => probabilityOf(a) - probabilityOf(b));

  return {
    kept,
    removed,
    combinedOdds: kept.length ? kept.reduce((product, pick) => product * Number(pick.odds), 1) : null,
  };
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
