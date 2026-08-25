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

export function formatOdds(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 100) return `${Math.round(n)}×`;
  if (n >= 10) return `${n.toFixed(1)}×`;
  return `${n.toFixed(2)}×`;
}

export function buildToOdds<T extends { odds?: number }>(picks: T[], target: number): T[] {
  const cap = Math.max(1.2, Math.min(1000, target));
  const pool = picks
    .filter((p) => p.odds && p.odds > 1.08 && p.odds < 6)
    .slice()
    .sort((a, b) => (a.odds as number) - (b.odds as number));
  const kept: T[] = [];
  let prod = 1;
  for (const pick of pool) {
    const next = prod * (pick.odds as number);
    if (kept.length && next > cap * 1.15) continue;
    kept.push(pick);
    prod = next;
    if (prod >= cap * 0.9) break;
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

export function trimToOdds(picks: AnalyzedPick[], target: number): AnalyzedPick[] {
  const eligible = picks
    .filter((p) => p.sport !== "other")
    .slice()
    .sort((a, b) => b.probability - a.probability);
  if (!eligible.length) return [];
  let kept = eligible;
  while (kept.length > 1) {
    const odds = combinedOdds(kept);
    if (odds == null) {
      if (kept.length <= 8) break;
      kept = kept.slice(0, -1);
      continue;
    }
    if (odds <= target) break;
    kept = kept.slice(0, -1);
  }
  return kept;
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
  | { type: "sport"; sport: "football" | "basketball" }
  | { type: "dropOther" }
  | { type: "unknown"; hint: string };

export function parseCommand(raw: string): DeskCommand {
  const t = raw.trim().toLowerCase();
  if (!t) return { type: "unknown", hint: "Try: split into 3 · trim to 50x · keep 6 games" };

  const split = t.match(/split(?:\s+into)?\s+(\d+)/);
  if (split) return { type: "split", parts: Number(split[1]) };

  const trim = t.match(/trim(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*[x×k]?/);
  if (trim) return { type: "trim", targetOdds: Number(trim[1]) };

  const keep = t.match(/keep\s+(\d+)\s*(?:legs?|picks?|games?)?/);
  if (keep && !/football|basket/.test(t)) return { type: "keepLegs", count: Number(keep[1]) };

  const th = t.match(/(?:threshold|bar|above)\s+(\d{2})/);
  if (th) return { type: "threshold", value: Number(th[1]) };

  if (/only\s+football|keep\s+football/.test(t)) return { type: "sport", sport: "football" };
  if (/only\s+basket|keep\s+basket/.test(t)) return { type: "sport", sport: "basketball" };
  if (/drop\s+(other|tennis|virtuals?)/.test(t)) return { type: "dropOther" };

  return {
    type: "unknown",
    hint: "Try: split into 3 · trim to 50x · keep 6 games · keep football",
  };
}

export function copyRebuild(picks: Array<{
  home: string;
  away: string;
  market: string;
  selection: string;
  league?: string;
}>) {
  if (!picks.length) return "Empty slip.";
  return picks
    .map((p, i) => {
      const line = `${i + 1}. ${p.home} vs ${p.away}\n   ${p.market} — ${p.selection}`;
      const extra = p.league ? `\n   ${p.league}` : "";
      return line + extra;
    })
    .join("\n\n");
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
