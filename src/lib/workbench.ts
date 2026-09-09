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
  return `${Math.round(n * 100) / 100}×`;
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
  items.forEach((item, i) => buckets[i % n].push(item));
  return buckets.filter((b) => b.length > 0);
}

export function keepTop<T extends { probability?: number }>(picks: T[], n: number): T[] {
  return picks
    .slice()
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
    .slice(0, Math.max(1, n));
}

export function trimToOdds<T extends { odds?: number; probability?: number }>(
  picks: T[],
  target: number,
): T[] {
  const scored = picks
    .slice()
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99));
  return buildToOdds(scored, target);
}

export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = text.trim().match(/^\/([a-zA-Z]+)(?:@\w+)?(?:\s+(.*))?$/);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() };
}
