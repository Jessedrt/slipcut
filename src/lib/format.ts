import type { AnalyzedPick, TicketPick } from "./types.ts";

export function pct(n: number) {
  return `${Math.round(n)}%`;
}

export function combinedChance(picks: AnalyzedPick[]): number | null {
  if (!picks.length) return null;
  const product = picks.reduce((acc, p) => acc * Math.max(0, Math.min(100, p.probability)) / 100, 1);
  return product * 100;
}

export function applyThreshold(picks: AnalyzedPick[], threshold: number) {
  const kept: AnalyzedPick[] = [];
  const dropped: AnalyzedPick[] = [];
  const ignored: AnalyzedPick[] = [];
  for (const pick of picks) {
    if (pick.sport === "other" || pick.verdict === "ignore") {
      ignored.push({ ...pick, verdict: "ignore" });
    } else if (pick.probability >= threshold) {
      kept.push({ ...pick, verdict: "keep" });
    } else {
      dropped.push({ ...pick, verdict: "drop" });
    }
  }
  return { kept, dropped, ignored };
}

export function slipLabel(picks: TicketPick[], shareCode?: string) {
  if (shareCode) return shareCode;
  if (!picks.length) return "Empty slip";
  if (picks.length === 1) return `${picks[0].home} vs ${picks[0].away}`;
  return `${picks[0].home} vs ${picks[0].away} +${picks.length - 1}`;
}

export function copyKeepers(picks: AnalyzedPick[]) {
  if (!picks.length) return "No keepers.";
  return picks
    .map((p, i) => {
      const chance = `${Math.round(p.probability)}%`;
      return `${i + 1}. ${p.home} vs ${p.away}\n   ${p.market} — ${p.selection}  (${chance} form)`;
    })
    .join("\n");
}

export function kickoffLabel(ts?: number) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
