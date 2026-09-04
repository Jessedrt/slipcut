/**
 * Pure probability + value math for the desk.
 *
 * The market is the prior, research is the update. Research with high
 * confidence is allowed to move further off the price than before — the
 * old 0.6 cap kept every pick glued to the book and made slips look random.
 */

export type Confidence = "high" | "medium" | "low";

export type Family =
  | "win"
  | "dc"
  | "ou"
  | "gg"
  | "dnb"
  | "hcp"
  | "ou1h"
  | "teamou"
  | "other";

export const MIN_P = 0.02;
export const MAX_P = 0.97;

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function clampProb(p: number): number {
  return clamp(p, MIN_P, MAX_P);
}

export function impliedProb(odds?: number | null): number | null {
  if (!odds || !Number.isFinite(odds) || odds <= 1) return null;
  return clampProb(1 / odds);
}

export function familyMargin(family?: string, sport?: string): number {
  const s = sport ?? "";
  switch (family) {
    case "win":
      return s === "football" ? 1.11 : 1.07;
    case "dc":
      return s === "football" ? 1.12 : 1.08;
    case "hcp":
      return 1.1;
    case "gg":
      return 1.09;
    case "dnb":
      return 1.1;
    case "ou":
    case "ou1h":
    case "teamou":
      return s === "basketball" ? 1.06 : 1.08;
    default:
      return 1.09;
  }
}

export function fairProbFromOdds(
  odds?: number | null,
  family?: string,
  sport?: string,
): number | null {
  const raw = impliedProb(odds);
  if (raw == null) return null;
  return clampProb(raw / familyMargin(family, sport));
}

export function fairOddsFromProb(p?: number | null): number | null {
  if (p == null || !Number.isFinite(p) || p <= 0) return null;
  const fair = clampProb(p);
  return fair >= 1 ? null : 1 / fair;
}

export function logit(p: number): number {
  const q = clamp(p, 0.001, 0.999);
  return Math.log(q / (1 - q));
}

export function logistic(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

export function evPerStake(probability: number, odds?: number | null): number | null {
  if (!odds || !Number.isFinite(odds) || odds <= 1) return null;
  return clampProb(probability) * odds - 1;
}

export function edge(
  probability: number,
  odds?: number | null,
  family?: string,
  sport?: string,
): number | null {
  const fair = fairProbFromOdds(odds, family, sport);
  if (fair == null) return null;
  return clampProb(probability) - fair;
}

export function kellyFraction(
  probability: number,
  odds: number,
  opts: { fraction?: number; cap?: number; legs?: number } = {},
): number {
  if (!Number.isFinite(odds) || odds <= 1) return 0;
  const p = clampProb(probability);
  const b = odds - 1;
  const full = (p * b - (1 - p)) / b;
  if (!Number.isFinite(full) || full <= 0) return 0;
  const fraction = opts.fraction ?? 0.25;
  const cap = opts.cap ?? 0.05;
  const legs = Math.max(1, opts.legs ?? 1);
  const varianceHaircut = 1 / Math.sqrt(legs);
  return clamp(full * fraction * varianceHaircut, 0, cap);
}

/** How far research can pull us off the market. Higher = clearer desk view. */
export function confidenceWeight(confidence: Confidence | string | undefined): number {
  if (confidence === "high") return 0.75;
  if (confidence === "low") return 0.28;
  return 0.5; // medium / unknown
}

export type EngineScore = {
  engine: string;
  probability: number;
  confidence?: Confidence | string;
};

export function toUnit(p: number): number | null {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return clampProb(n > 1.5 ? n / 100 : n);
}

export type Ensemble = {
  probability: number;
  disagreement: number;
  confidence: Confidence;
};

export function ensembleScores(scores: EngineScore[]): Ensemble | null {
  const rows = scores
    .map((s) => ({ ...s, unit: toUnit(s.probability) }))
    .filter((s): s is EngineScore & { unit: number } => s.unit != null)
    .map((s) => ({ ...s, probability: s.unit }));
  if (!rows.length) return null;
  if (rows.length === 1) {
    const only = rows[0]!;
    return {
      probability: only.probability,
      disagreement: 0,
      confidence: (only.confidence as Confidence) ?? "medium",
    };
  }
  let wsum = 0;
  let acc = 0;
  for (const row of rows) {
    const w = confidenceWeight(row.confidence);
    acc += w * logit(row.probability);
    wsum += w;
  }
  const centre = wsum > 0 ? acc / wsum : logit(rows[0]!.probability);
  let spread = 0;
  for (const row of rows) {
    const w = confidenceWeight(row.confidence);
    spread += w * Math.abs(logit(row.probability) - centre);
  }
  spread = wsum > 0 ? spread / wsum : 0;
  const disagreement = clamp(spread / 0.7, 0, 1);
  const confidence: Confidence =
    disagreement > 0.55 ? "low" : disagreement < 0.22 ? "high" : "medium";
  return { probability: clampProb(logistic(centre)), disagreement, confidence };
}

export function blendWithMarket(modelP: number, marketP: number, weight: number): number {
  const w = clamp(weight, 0, 1);
  if (!Number.isFinite(modelP)) return clampProb(marketP);
  if (!Number.isFinite(marketP)) return clampProb(modelP);
  return clampProb(logistic(w * logit(clampProb(modelP)) + (1 - w) * logit(clampProb(marketP))));
}

export type Outcome = { p: number; won: boolean };
export type Platt = { a: number; b: number; n: number };
export const NEUTRAL_PLATT: Platt = { a: 1, b: 0, n: 0 };

export function fitPlatt(outcomes: Outcome[], iterations = 300): Platt {
  const rows = outcomes
    .map((o) => ({ x: logit(clampProb(o.p)), y: o.won ? 1 : 0 }))
    .filter((r) => Number.isFinite(r.x));
  if (rows.length < 25) return { ...NEUTRAL_PLATT, n: rows.length };
  const positives = rows.filter((r) => r.y === 1).length;
  if (!positives || positives === rows.length) {
    return { ...NEUTRAL_PLATT, n: rows.length };
  }
  let a = 1;
  let b = 0;
  const lr = 0.05;
  const l2 = 1e-3;
  for (let iter = 0; iter < iterations; iter++) {
    let ga = 0;
    let gb = 0;
    for (const r of rows) {
      const z = a * r.x + b;
      const pred = clamp(logistic(z), 1e-6, 1 - 1e-6);
      const err = pred - r.y;
      ga += err * r.x;
      gb += err;
    }
    ga = ga / rows.length + l2 * (a - 1);
    gb = gb / rows.length + l2 * b;
    a -= lr * ga;
    b -= lr * gb;
    a = clamp(a, 0.25, 3);
    b = clamp(b, -2.5, 2.5);
  }
  return { a, b, n: rows.length };
}

export function applyPlatt(p: number, cal: Platt): number {
  if (!cal || !Number.isFinite(cal.a)) return clampProb(p);
  return clampProb(logistic(cal.a * logit(clampProb(p)) + cal.b));
}

export function brier(outcomes: Outcome[]): number | null {
  const rows = outcomes.filter((o) => Number.isFinite(o.p));
  if (!rows.length) return null;
  const total = rows.reduce((sum, o) => {
    const p = clampProb(o.p);
    return sum + (p - (o.won ? 1 : 0)) ** 2;
  }, 0);
  return total / rows.length;
}

export type ReliabilityBin = { low: number; high: number; n: number; hitRate: number; meanP: number };

export function reliability(outcomes: Outcome[], bins = 5): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let i = 0; i < bins; i++) {
    const low = i / bins;
    const high = (i + 1) / bins;
    const rows = outcomes.filter((o) => {
      const p = clampProb(o.p);
      return p >= low && (p < high || (i === bins - 1 && p <= high));
    });
    if (!rows.length) continue;
    const wins = rows.filter((r) => r.won).length;
    out.push({
      low,
      high,
      n: rows.length,
      hitRate: wins / rows.length,
      meanP: rows.reduce((s, r) => s + clampProb(r.p), 0) / rows.length,
    });
  }
  return out;
}

export function historyBias(
  won: number,
  lost: number,
  opts: { prior?: number; k?: number; scale?: number } = {},
): number {
  const prior = opts.prior ?? 0.5;
  const k = opts.k ?? 10;
  const scale = opts.scale ?? 40;
  const n = won + lost;
  if (!n) return 0;
  const rate = (won + prior * k) / (n + k);
  const strength = n / (n + k);
  return (rate - prior) * scale * strength * 2;
}

export type SlipLeg = {
  home: string;
  away: string;
  league?: string;
  kickoff?: number;
  sport?: string;
  market?: string;
  selection?: string;
  probability?: number;
  odds?: number;
};

function dayKey(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return "tba";
  return new Date(ts).toISOString().slice(0, 10);
}

function slotKey(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return "tba";
  return `${new Date(ts).toISOString().slice(0, 10)}#${Math.floor(new Date(ts).getUTCHours() / 3)}`;
}

function norm(s?: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function correlationLoad(picks: SlipLeg[]): number {
  if (picks.length < 2) return 0;
  const pairs = (picks.length * (picks.length - 1)) / 2;
  let linked = 0;
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const a = picks[i]!;
      const b = picks[j]!;
      const sameEvent =
        norm(a.home) === norm(b.home) && norm(a.away) === norm(b.away);
      const sharedTeam =
        norm(a.home) === norm(b.home) ||
        norm(a.home) === norm(b.away) ||
        norm(a.away) === norm(b.home) ||
        norm(a.away) === norm(b.away);
      const sameLeague = Boolean(a.league) && norm(a.league) === norm(b.league);
      const sameDay = dayKey(a.kickoff) === dayKey(b.kickoff) && dayKey(a.kickoff) !== "tba";
      const sameSlot = slotKey(a.kickoff) === slotKey(b.kickoff) && slotKey(a.kickoff) !== "tba";
      if (sameEvent) linked += 1;
      else if (sharedTeam) linked += 0.7;
      else if (sameLeague && sameSlot) linked += 0.5;
      else if (sameLeague && sameDay) linked += 0.3;
      else if (sameSlot) linked += 0.2;
      else if (sameLeague) linked += 0.15;
    }
  }
  return clamp(linked / pairs, 0, 1);
}

export const CORRELATION_STRENGTH = 0.35;

export function accaTrueChance(probabilities: number[], load = 0): number {
  const rows = probabilities
    .map((p) => toUnit(p))
    .filter((p): p is number => p != null)
    .map((p) => clampProb(p));
  if (!rows.length) return 0;
  const independent = rows.reduce((acc, p) => acc * p, 1);
  const alpha = 1 - CORRELATION_STRENGTH * clamp(load, 0, 1);
  return clampProb(Math.pow(independent, alpha));
}

export function slipTrueChance(picks: SlipLeg[]): number {
  const probs = picks.map((p) => p.probability ?? 0);
  return accaTrueChance(probs, correlationLoad(picks));
}

export function combinedPrice(picks: SlipLeg[]): number | null {
  if (!picks.length) return null;
  if (picks.some((p) => !p.odds || !Number.isFinite(p.odds) || p.odds <= 1)) return null;
  return picks.reduce((acc, p) => acc * (p.odds as number), 1);
}

export function slipEv(picks: SlipLeg[]): number | null {
  const price = combinedPrice(picks);
  if (price == null) return null;
  const chance = slipTrueChance(picks);
  return chance * price - 1;
}
