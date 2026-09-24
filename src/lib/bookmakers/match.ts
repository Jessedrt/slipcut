import type { TicketPick } from "../types";
import { normalizeName, normalizePick } from "./normalize";

export type MatchOptions = {
  kickoffToleranceMs?: number;
  minTeamScore?: number;
  ambiguityMargin?: number;
};

export type MatchResult<T> =
  | { ok: true; candidate: T; score: number; kickoffDeltaMs?: number; swapped: boolean }
  | { ok: false; reason: "no_match" | "ambiguous"; score: number };

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const next = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    next[0] = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        next[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = next[j]!;
  }
  return prev[b.length]!;
}

function tokenSet(value: string) {
  return new Set(normalizeName(value).split(" ").filter(Boolean));
}

function jaccard(a: string, b: string) {
  const aa = tokenSet(a);
  const bb = tokenSet(b);
  if (!aa.size && !bb.size) return 1;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  const union = new Set([...aa, ...bb]).size;
  return union ? intersection / union : 0;
}

export function stringSimilarity(a: string, b: string): number {
  const aa = normalizeName(a);
  const bb = normalizeName(b);
  if (aa === bb) return 1;
  if (!aa || !bb) return 0;
  const edit = 1 - levenshtein(aa, bb) / Math.max(aa.length, bb.length);
  return Math.max(0, Math.min(1, 0.58 * edit + 0.42 * jaccard(aa, bb)));
}

function scoreOrientation(source: TicketPick, candidate: TicketPick, swapped: boolean) {
  const home = stringSimilarity(source.home, swapped ? candidate.away : candidate.home);
  const away = stringSimilarity(source.away, swapped ? candidate.home : candidate.away);
  const league =
    source.league && candidate.league ? stringSimilarity(source.league, candidate.league) : 0.5;
  return { home, away, league, teamScore: 0.5 * home + 0.5 * away };
}

export function matchEvent<T extends TicketPick>(
  sourceRaw: TicketPick,
  candidates: T[],
  options: MatchOptions = {},
): MatchResult<T> {
  const source = normalizePick(sourceRaw);
  const tolerance = options.kickoffToleranceMs ?? 20 * 60_000;
  const minTeamScore = options.minTeamScore ?? 0.72;
  const ambiguityMargin = options.ambiguityMargin ?? 0.035;

  const scored = candidates.flatMap((candidateRaw) => {
    if (candidateRaw.sport !== source.sport) return [];
    const candidate = normalizePick(candidateRaw);
    const direct = scoreOrientation(source, candidate, false);
    const swapped = scoreOrientation(source, candidate, true);
    const useSwap = swapped.teamScore > direct.teamScore;
    const names = useSwap ? swapped : direct;
    if (names.teamScore < minTeamScore) return [];

    let timeScore = 0.5;
    let kickoffDeltaMs: number | undefined;
    if (source.kickoff && candidate.kickoff) {
      kickoffDeltaMs = Math.abs(source.kickoff - candidate.kickoff);
      if (kickoffDeltaMs > tolerance) return [];
      timeScore = Math.max(0, 1 - kickoffDeltaMs / tolerance);
    }
    const score =
      0.42 * names.home +
      0.42 * names.away +
      0.10 * names.league +
      0.06 * timeScore -
      (useSwap && source.sport !== "tennis" ? 0.04 : 0);

    return [{ candidate: candidateRaw, score, kickoffDeltaMs, swapped: useSwap }];
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.7) return { ok: false, reason: "no_match", score: best?.score ?? 0 };
  const second = scored[1];
  if (second && best.score - second.score < ambiguityMargin) {
    return { ok: false, reason: "ambiguous", score: best.score };
  }
  return { ok: true, ...best };
}

function sameLine(a?: number, b?: number) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.001;
}

export function marketMatches(sourceRaw: TicketPick, candidateRaw: TicketPick): boolean {
  const source = normalizePick(sourceRaw).normalizedMarket!;
  const candidate = normalizePick(candidateRaw).normalizedMarket!;
  if (source.family !== candidate.family) return false;
  if (source.period !== candidate.period) return false;
  if ((source.scope ?? "match") !== (candidate.scope ?? "match")) return false;
  if (!sameLine(source.line, candidate.line)) return false;
  return normalizeName(source.outcome) === normalizeName(candidate.outcome);
}

export function matchSelection<T extends TicketPick>(
  source: TicketPick,
  candidates: T[],
  options: MatchOptions = {},
): MatchResult<T> {
  const byMarket = candidates.filter((candidate) => marketMatches(source, candidate));
  return matchEvent(source, byMarket, options);
}

export type TicketMatchResult<T extends TicketPick> = {
  matched: Array<{ source: TicketPick; target: T; score: number }>;
  unmatched: Array<{ source: TicketPick; reason: "no_match" | "ambiguous" }>;
};

export function matchTicket<T extends TicketPick>(
  source: TicketPick[],
  candidates: T[],
  options: MatchOptions = {},
): TicketMatchResult<T> {
  const matched: TicketMatchResult<T>["matched"] = [];
  const unmatched: TicketMatchResult<T>["unmatched"] = [];
  const used = new Set<string>();
  for (const pick of source) {
    const available = candidates.filter((candidate) => !used.has(candidate.id));
    const result = matchSelection(pick, available, options);
    if (!result.ok) {
      unmatched.push({ source: pick, reason: result.reason });
      continue;
    }
    used.add(result.candidate.id);
    matched.push({ source: pick, target: result.candidate, score: result.score });
  }
  return { matched, unmatched };
}
