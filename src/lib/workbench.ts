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
 * Select a subset whose combined odds is as close as possible to the target.
 * If the target can be reached, an at-or-above result always wins over a
 * below-target result. Among those, prefer the smallest overshoot and then
 * the strongest combined probability.
 */
export function trimToOdds(picks: AnalyzedPick[], target: number): AnalyzedPick[] {
  const requested = Number.isFinite(target) ? Math.max(1.2, Math.min(1000, target)) : 500;
  const eligible = picks
    .filter((p) => p.sport !== "other" && Number.isFinite(p.odds) && (p.odds as number) > 1.08 && (p.odds as number) < 6)
    .slice();
  if (!eligible.length) return [];

  type State = { ids: string[]; product: number; score: number };
  const beamWidth = 5000;
  const sorted = eligible.sort((a, b) => {
    const pa = Math.max(1, a.probability) / Math.max(1.01, a.odds as number);
    const pb = Math.max(1, b.probability) / Math.max(1.01, b.odds as number);
    return pb - pa;
  });
  let states: State[] = [{ ids: [], product: 1, score: 0 }];

  for (const pick of sorted) {
    const odds = pick.odds as number;
    const probability = Math.max(1, Math.min(99, pick.probability));
    const next: State[] = states.slice();
    for (const state of states) {
      const product = state.product * odds;
      if (product > requested * 1.35 && state.ids.length > 0) continue;
      next.push({
        ids: [...state.ids, pick.id],
        product,
        score: state.score + Math.log(probability / 100),
      });
    }

    next.sort((a, b) => {
      const distance = (x: State) => {
        if (x.product >= requested) return x.product / requested - 1;
        return 1 + (requested / x.product - 1);
      };
      const da = distance(a);
      const db = distance(b);
      if (Math.abs(da - db) > 0.015) return da - db;
      if (Math.abs(a.score - b.score) > 0.03) return b.score - a.score;
      return a.ids.length - b.ids.length;
    });
    states = next.slice(0, beamWidth);
  }

  const nonEmpty = states.filter((s) => s.ids.length > 0);
  if (!nonEmpty.length) return [sorted[0]!];
  const byId = new Map(eligible.map((p) => [p.id, p]));
  const distance = (s: State) => (s.product >= requested ? s.product / requested - 1 : 1 + (requested / s.product - 1));
  const best = nonEmpty.sort((a, b) => {
    const da = distance(a);
    const db = distance(b);
    if (Math.abs(da - db) > 0.005) return da - db;
    if (Math.abs(a.score - b.score) > 0.02) return b.score - a.score;
    return a.ids.length - b.ids.length;
  })[0]!;

  return best.ids.map((id) => byId.get(id)).filter((p): p is AnalyzedPick => Boolean(p));
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
