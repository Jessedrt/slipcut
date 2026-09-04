/**
 * Slip construction.
 *
 * The old desk built slips by sorting on a heuristic score and multiplying
 * until it hit a target. That ignores the two things that decide whether an
 * accumulator is worth having: **value** (does the price beat the true chance?)
 * and **correlation** (are these legs really independent bets?).
 *
 * Everything here is pure — same input, same slip — so the builders can be
 * tested and reasoned about (see optimizer.test.ts).
 */

import {
  clamp,
  combinedPrice,
  correlationLoad,
  edge as legEdge,
  evPerStake,
  kellyFraction,
  slipTrueChance,
  toUnit,
} from "./odds.ts";
import { SHORT_ODDS } from "./accuracy.ts";
import type { AnalyzedPick, TicketPick } from "./types.ts";

export type Leg = TicketPick & { probability?: number };

export type BuildOptions = {
  /** Combined price to aim for. Omit to just take the best `maxLegs`. */
  target?: number;
  /** Hard cap on legs (SportyBet refuses very large codes). */
  maxLegs?: number;
  /** Do not go under this many legs unless the pool runs out. */
  minLegs?: number;
  /** Reject legs the desk rates below this (0-1). */
  minProb?: number;
  /** Reject single prices above this. */
  maxOdds?: number;
  /** Reject single prices below this (tiny prices add variance, not value). */
  minOdds?: number;
  /** Concentration caps — correlated legs are how accas die. */
  maxPerLeague?: number;
  maxPerSlot?: number;
  /** Require positive expected value on every leg. */
  valueOnly?: boolean;
  /**
   * When the pool cannot fill the slip, return what is there instead of
   * relaxing the quality bar. The desk-cook path sets this: a slip padded
   * with weak long-shot legs is worse than no slip.
   */
  strict?: boolean;
};

/**
 * Balanced-desk defaults. `minProb` is quoted 0-100 like a leg score (40 = a
 * leg the desk rates at 40%); everything else is in the units it sounds like.
 */
export const DEFAULT_BUILD: Required<
  Pick<
    BuildOptions,
    "maxLegs" | "minLegs" | "minProb" | "maxOdds" | "minOdds" | "maxPerLeague" | "maxPerSlot"
  >
> = {
  maxLegs: 20,
  minLegs: 1,
  minProb: 40,
  maxOdds: 6,
  minOdds: 1.12,
  maxPerLeague: 3,
  maxPerSlot: 4,
};

function slotKey(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return "tba";
  const d = new Date(ts);
  return `${d.toISOString().slice(0, 10)}#${Math.floor(d.getUTCHours() / 3)}`;
}

function normLeague(s?: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Leg probability as a 0-1 fraction.
 *
 * The desk scores legs 0-100 (that is what the models and the UI speak) while
 * the maths works in fractions — normalising here means a 70 never gets read
 * as "certain", which would flatten every ranking into a tie.
 */
function probOf(p: Leg): number {
  return toUnit(Number(p.probability)) ?? 0;
}

/**
 * Value of a leg to a slip: expected value first, true chance as the tiebreak.
 * Without odds we fall back to the rated chance so the builder still works on
 * tickets where SportyBet hid the prices.
 */
export function legValue(p: Leg): number {
  const p01 = probOf(p);
  const ev = evPerStake(p01, p.odds);
  if (ev != null) return ev;
  return p01 - 1;
}

export function legEdgePct(p: Leg, family?: string): number | null {
  return legEdge(probOf(p), p.odds, family, p.sport);
}

/** Best-legs-first ordering: value, then safety. */
export function rankByValue(picks: Leg[]): Leg[] {
  return picks.slice().sort((a, b) => legValue(b) - legValue(a) || probOf(b) - probOf(a));
}

/** Safest-legs-first ordering (used for "sure 3" style asks). */
export function rankBySafety(picks: Leg[]): Leg[] {
  return picks.slice().sort((a, b) => probOf(b) - probOf(a) || legValue(b) - legValue(a));
}

/**
 * Thin a ranked list so no league or kickoff window dominates.
 *
 * Ten legs from the same league on the same Saturday is one bet wearing ten
 * costumes — a single red-card trend or a weather front kills all of them at
 * once. Capping concentration is the cheapest variance reduction available.
 */
export function diversify(picks: Leg[], opts: BuildOptions = {}): Leg[] {
  const maxLeague = opts.maxPerLeague ?? DEFAULT_BUILD.maxPerLeague;
  const maxSlot = opts.maxPerSlot ?? DEFAULT_BUILD.maxPerSlot;
  const leagues = new Map<string, number>();
  const slots = new Map<string, number>();
  const teams = new Set<string>();
  const out: Leg[] = [];
  for (const pick of picks) {
    const league = normLeague(pick.league);
    const slot = slotKey(pick.kickoff);
    if (league && (leagues.get(league) ?? 0) >= maxLeague) continue;
    if (slot !== "tba" && (slots.get(slot) ?? 0) >= maxSlot) continue;
    const pair = [pick.home, pick.away].map((t) => t.toLowerCase()).sort().join("|");
    if (teams.has(pair)) continue; // never back the same fixture twice
    teams.add(pair);
    if (league) leagues.set(league, (leagues.get(league) ?? 0) + 1);
    if (slot !== "tba") slots.set(slot, (slots.get(slot) ?? 0) + 1);
    out.push(pick);
  }
  return out;
}

export function eligiblePool(picks: Leg[], opts: BuildOptions = {}): Leg[] {
  // Thresholds are quoted the same way legs are scored (0-100), but the maths
  // is in fractions — normalise so a 52 bar is never compared against 0.59.
  const minProb = toUnit(opts.minProb ?? DEFAULT_BUILD.minProb) ?? DEFAULT_BUILD.minProb;
  const maxOdds = opts.maxOdds ?? DEFAULT_BUILD.maxOdds;
  const minOdds = opts.minOdds ?? DEFAULT_BUILD.minOdds;
  return picks.filter((p) => {
    if (p.sport === "other") return false;
    if (probOf(p) < minProb) return false;
    if (p.odds != null) {
      if (!Number.isFinite(p.odds) || p.odds <= 1) return false;
      if (p.odds < minOdds || p.odds > maxOdds) return false;
    }
    if (opts.valueOnly) {
      const ev = evPerStake(probOf(p), p.odds);
      if (ev != null && ev <= 0) return false;
    }
    return true;
  });
}

export type Slip = {
  legs: Leg[];
  price: number | null;
  trueChance: number;
  ev: number | null;
  load: number;
  /** True when the pool could not reach the requested price. */
  short: boolean;
  notes: string[];
};

function summarise(legs: Leg[], short: boolean, notes: string[]): Slip {
  return {
    legs,
    price: combinedPrice(legs),
    trueChance: slipTrueChance(legs),
    ev: legs.length ? (combinedPrice(legs) != null ? slipTrueChance(legs) * (combinedPrice(legs) as number) - 1 : null) : null,
    load: correlationLoad(legs),
    short,
    notes,
  };
}

/**
 * Take the `count` strongest legs the pool can offer.
 *
 * Ranked for safety (this is what "sure 4" means to a punter) but filtered for
 * value and concentration first, so the strongest legs are not all the same
 * league.
 */
export function bestLegs(picks: Leg[], count: number, opts: BuildOptions = {}): Slip {
  const notes: string[] = [];
  const wanted = Math.max(1, Math.floor(count));
  const pool = diversify(rankBySafety(eligiblePool(picks, opts)), opts);
  const take = pool.slice(0, Math.min(wanted, opts.maxLegs ?? DEFAULT_BUILD.maxLegs));
  if (!take.length) {
    // Strict mode: a thin pool is an empty slip, never a padded one.
    if (opts.strict) {
      notes.push("Pool thin — nothing cleared the bar, so no slip.");
      return summarise([], true, notes);
    }
    const relaxed = diversify(rankBySafety(picks.filter((p) => p.sport !== "other")), {
      ...opts,
      minProb: 0,
    });
    const fallback = relaxed.slice(0, Math.min(wanted, opts.maxLegs ?? DEFAULT_BUILD.maxLegs));
    if (fallback.length) notes.push("Pool thin — I dropped the quality bar to fill the slip.");
    return summarise(fallback, fallback.length < wanted, notes);
  }
  if (take.length < wanted) notes.push(`Only ${take.length} legs cleared the bar.`);
  return summarise(take, take.length < wanted, notes);
}

/**
 * Build the strongest slip that lands on a target price.
 *
 * Strategy: rank by value, add legs while we are still short of the target,
 * then trim back toward the target by dropping whichever leg leaves the best
 * combination of "closest to target" and "highest true chance". Value leads so
 * the legs we pick are the ones being underpriced, not merely the safest.
 */
export function buildToTarget(picks: Leg[], target: number, opts: BuildOptions = {}): Slip {
  const notes: string[] = [];
  const cap = clamp(target, 1.05, 5000);
  const maxLegs = opts.maxLegs ?? DEFAULT_BUILD.maxLegs;
  const minLegs = opts.minLegs ?? DEFAULT_BUILD.minLegs;
  const pool = diversify(rankByValue(eligiblePool(picks, opts)), opts);

  if (!pool.length) {
    // Strict mode: never reach for the unfiltered pool to "make a card".
    if (opts.strict) {
      return summarise([], true, [
        `Pool no reach ${cap.toFixed(2)}× — no leg cleared the market bar.`,
      ]);
    }
    const relaxed = diversify(rankByValue(picks.filter((p) => p.sport !== "other")), {
      ...opts,
      minProb: 0,
    });
    return summarise(relaxed.slice(0, maxLegs), true, [
      "Pool thin — I dropped the quality bar to fill the slip.",
    ]);
  }

  let kept: Leg[] = [];
  let product = 1;
  for (const pick of pool) {
    if (kept.length >= maxLegs) break;
    if (kept.length >= minLegs && product >= cap) break;
    const price = pick.odds ?? 1;
    kept.push(pick);
    product *= price;
    if (product >= cap) break;
  }

  // Overshoot: drop the leg that gets us closest to the target while keeping
  // the strongest true chance.
  let guard = 0;
  while (kept.length > minLegs && product > cap * 1.35 && guard++ < 50) {
    let best: { index: number; score: number } | null = null;
    for (let i = 0; i < kept.length; i++) {
      const trial = kept.filter((_, j) => j !== i);
      const trialPrice = combinedPrice(trial);
      if (trialPrice == null) continue;
      const closeness = -Math.abs(Math.log(trialPrice / cap));
      const score = closeness + slipTrueChance(trial) * 0.6;
      if (!best || score > best.score) best = { index: i, score };
    }
    if (!best) break;
    kept = kept.filter((_, j) => j !== best!.index);
    product = combinedPrice(kept) ?? 1;
  }

  const short = product < cap * 0.75;
  if (short) {
    notes.push(`Pool no reach ${cap.toFixed(2)}× — best I could hold is ${product.toFixed(2)}×.`);
  }
  const ev = kept.length ? product * slipTrueChance(kept) - 1 : null;
  if (ev != null && ev < 0) {
    notes.push("Price is short of the true chance — this one is for fun, not for profit.");
  }
  return summarise(kept, short, notes);
}

/** Choose between "N legs" and "target price" asks. */
export function buildSlip(picks: Leg[], opts: BuildOptions = {}): Slip {
  if (opts.target && opts.target > 1.05) return buildToTarget(picks, opts.target, opts);
  return bestLegs(picks, opts.maxLegs ?? DEFAULT_BUILD.maxLegs, opts);
}

/**
 * Recommended stake for a slip: fractional Kelly on the *accumulator*, haircut
 * for leg count, then capped so one slip can never hurt the bankroll.
 */
export function planStake(
  picks: Leg[],
  bankroll: number,
  opts: { fraction?: number; cap?: number } = {},
): { stake: number; fraction: number; trueChance: number; price: number | null; ev: number | null } {
  const price = combinedPrice(picks);
  const trueChance = slipTrueChance(picks);
  if (!picks.length || price == null || !Number.isFinite(bankroll) || bankroll <= 0) {
    return { stake: 0, fraction: 0, trueChance, price, ev: null };
  }
  const f = kellyFraction(trueChance, price, {
    fraction: opts.fraction ?? 0.25,
    cap: opts.cap ?? 0.03,
    legs: picks.length,
  });
  return {
    stake: Math.round(bankroll * f),
    fraction: f,
    trueChance,
    price,
    ev: trueChance * price - 1,
  };
}

/** Rank a ticket's legs weakest-first, for "why did this cut?" reporting. */
export function weakestFirst(picks: AnalyzedPick[]): AnalyzedPick[] {
  return picks
    .slice()
    .sort((a, b) => Number(a.probability) - Number(b.probability) || legValue(b) - legValue(a));
}

// ---- ladder cards ----------------------------------------------------------


/**
 * Ladder card limits. The caps are what keep a "1000× card" honest: a hard
 * leg count, a hard price cap per leg (beyond this it is a long shot, not a
 * leg), and concentration caps so one league or one kickoff slot cannot carry
 * the whole card.
 */
export const LADDER_LIMITS = {
  maxLegs: 15,
  /** Longest single price a ladder leg may carry. */
  maxOdds: 4.0,
  maxPerLeague: 3,
  maxPerSlot: 4,
} as const;

/**
 * Short-odds first (the desk's default style), then the safest leg (its
 * probability is the market family's own settled hit rate), then the shortest
 * price. This ordering is what makes 20×/50×/100× cards land on short DC/O/U
 * legs without any separate "band" filter.
 */
export function rankLadder(legs: Leg[]): Leg[] {
  const inBand = (p: Leg) =>
    p.odds != null && p.odds >= SHORT_ODDS.min && p.odds <= SHORT_ODDS.max ? 0 : 1;
  const prob = (p: Leg) => toUnit(p.probability ?? 50) ?? 0;
  return legs
    .slice()
    .sort(
      (a, b) =>
        inBand(a) - inBand(b) || // short-odds band first
        prob(b) - prob(a) || // then the safest
        (a.odds ?? 9) - (b.odds ?? 9), // then the shortest price
    );
}

export type LadderCardSpec = {
  legs: Leg[];
  price: number | null;
  /** 0-1, from the leg probabilities (family hit rates — never inflated). */
  trueChance: number;
  ev: number | null;
  /** True when the pool could not reach the target. */
  short: boolean;
  notes: string[];
};

/**
 * Build one ladder card toward `target`.
 *
 * Walks the short-odds-ranked, diversified pool adding legs until the product
 * reaches the target. When the pool runs out first, the card is **short** (or
 * empty) and says so — it never reaches past the pool for weak long-shot
 * legs to "make a card". That padding is exactly what the old desk did to
 * fill 100× slips from thin leagues.
 */
export function buildLadderCard(
  legs: Leg[],
  target: number,
  limits: Partial<typeof LADDER_LIMITS> = {},
): LadderCardSpec {
  const maxLegs = limits.maxLegs ?? LADDER_LIMITS.maxLegs;
  const maxOdds = limits.maxOdds ?? LADDER_LIMITS.maxOdds;
  const capPrice = clamp(target, 1.05, 5000);
  const ranked = diversify(rankLadder(legs), {
    maxPerLeague: limits.maxPerLeague ?? LADDER_LIMITS.maxPerLeague,
    maxPerSlot: limits.maxPerSlot ?? LADDER_LIMITS.maxPerSlot,
  });
  const pool = ranked.filter((p) => (p.odds ?? 9) <= maxOdds);
  const kept: Leg[] = [];
  let product = 1;
  for (const pick of pool) {
    if (kept.length >= maxLegs) break;
    kept.push(pick);
    product *= pick.odds ?? 1;
    if (product >= capPrice) break;
  }
  const price = combinedPrice(kept);
  const trueChance = slipTrueChance(kept);
  const ev = price != null ? trueChance * price - 1 : null;
  const short = kept.length > 0 && product < capPrice * 0.75;
  const notes: string[] = [];
  if (short) notes.push(`pool no reach ${target}× — best is ${product.toFixed(1)}×`);
  return { legs: kept, price, trueChance, ev, short, notes };
}
