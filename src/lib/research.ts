import { researchScores } from "./analyze.ts";
import { evPerStake, fairProbFromOdds } from "./odds.ts";
import { buildSlip, rankByValue, type Leg, type Slip } from "./optimizer.ts";
import { marketFamily } from "./sportybet.ts";
import { applyLessonScores } from "./study.ts";
import { youKeys } from "./you.ts";
import { refreshKeys, seekaiKeys, geminiKeys } from "./keys.ts";
import type { TicketPick } from "./types.ts";

const WEAK_FB =
  /friendly|women|womens|u-?1[789]|u-?2[013]|reserve|\bii\b|amateur|virtual|esport|simulat|youth|qualification play-off/i;
const WEAK_BB = /friendly|club friendly|virtual|esport|simulat|u-?1[89]/i;
const TOP_FB =
  /premier league|la liga|laliga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|eredivisie|primeira|championship|mls|copa libertadores|nations league|saudi|super lig|liga portugal|pro league/i;
const TOP_BB = /euroleague|ncaa|wnba|acb|nbl|eurocup|bbl/i;
const TOP_TN = /atp|wta|us open|australian open|wimbledon|roland|french open|masters|grand slam|challenger/i;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Desk-only fallback score, used when no research engine is configured.
 *
 * It is deliberately modest: with no live information the honest read is the
 * market price with the margin off, nudged for league quality and for red
 * flags (friendlies, youth fixtures, games about to kick off).
 */
export function deskScore(pick: TicketPick): number {
  const fam = marketFamily(pick.sporty?.marketId, pick.market);
  const market = fairProbFromOdds(pick.odds, fam, pick.sport);
  const league = pick.league ?? "";
  const blob = `${league} ${pick.home} ${pick.away}`;
  const weak =
    (pick.sport === "football" ? WEAK_FB.test(blob) : pick.sport === "basketball" ? WEAK_BB.test(blob) : false) &&
    !TOP_FB.test(league) &&
    !TOP_BB.test(league) &&
    !TOP_TN.test(league);
  const top =
    pick.sport === "football" ? TOP_FB.test(league) : pick.sport === "basketball" ? TOP_BB.test(league) : TOP_TN.test(league);

  // Start from the de-vigged market read, or a coin flip when there is no price.
  let p = market ?? 0.5;
  if (weak) p -= 0.12;
  if (top) p += 0.015; // top leagues are simply better priced/modelled
  if (pick.kickoff && pick.kickoff < Date.now() + 8 * 60_000) p -= 0.18;
  if (pick.odds && pick.odds > 4) p -= 0.02; // long shots need real justification
  return clamp(Math.round(p * 100), 4, 96);
}

function isJunk(pick: TicketPick) {
  const blob = `${pick.league ?? ""} ${pick.home} ${pick.away}`;
  if (pick.sport === "football") return WEAK_FB.test(blob);
  if (pick.sport === "basketball") return WEAK_BB.test(blob) || /\bnba\b/i.test(pick.league ?? "");
  return false;
}

function isTop(pick: TicketPick) {
  const league = pick.league ?? "";
  if (pick.sport === "football") return TOP_FB.test(league);
  if (pick.sport === "basketball") return TOP_BB.test(league);
  if (pick.sport === "tennis") return TOP_TN.test(league);
  return false;
}

function eventKey(p: TicketPick) {
  return p.sporty?.eventId || `${p.home}|${p.away}|${p.kickoff ?? ""}`;
}

/**
 * One selection per event, chosen for value.
 *
 * Two legs from the same match are not two bets — they share a scoreline, and
 * stacking them doubles the variance without doubling the edge.
 */
function bestPerEvent<T extends TicketPick>(picks: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of picks) {
    const key = eventKey(p);
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const out: T[] = [];
  for (const arr of groups.values()) {
    const scored = arr as Array<T & { probability?: number }>;
    const ranked = scored
      .slice()
      .sort((a, b) => {
        const av = evPerStake((a.probability ?? 50) / 100, a.odds) ?? (a.probability ?? 50) / 100 - 1;
        const bv = evPerStake((b.probability ?? 50) / 100, b.odds) ?? (b.probability ?? 50) / 100 - 1;
        return bv - av;
      });
    out.push(ranked[0]!);
  }
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        t = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export type ResearchResult<T> = {
  /** Legs to mint, best first. */
  keep: T[];
  /** How many candidates the pool lost along the way. */
  dropped: number;
  /** True when at least one research engine answered. */
  researched: boolean;
  /** Combined true chance of the returned slip (0-100). */
  trueChance: number;
  /** Expected value of the returned slip, per 1 staked. */
  ev: number | null;
  notes: string[];
};

/**
 * Turn a raw SportyBet pool into a slip worth minting.
 *
 * Pipeline: drop junk → one leg per event → research (blended with the
 * de-vigged market) → learned bias from settled history → value ranking with
 * concentration caps → slip built to the requested size or price.
 */
export async function researchPicks<T extends TicketPick>(
  picks: T[],
  want: number,
  opts: { target?: number } = {},
): Promise<ResearchResult<T>> {
  await refreshKeys();
  const clean = picks.filter((p) => !isJunk(p) && p.sport !== "other");
  const oneEach = bestPerEvent(clean);

  // Seed with the market read so a research timeout still leaves us with an
  // honest number rather than a coin flip.
  const seeded = oneEach.map((p) => ({
    ...p,
    probability: deskScore(p),
  })) as Array<T & { probability: number }>;

  const canResearch = Boolean(geminiKeys().length || seekaiKeys().length || youKeys().length);
  let researched = false;
  if (canResearch && seeded.length) {
    // Research is the expensive part; score the most promising candidates only.
    const shortlist = seeded
      .slice()
      .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
      .slice(0, Math.min(seeded.length, Math.max(want + 10, 18)));
    const scored = await withTimeout(researchScores(shortlist), 55_000);
    if (scored?.researched) {
      researched = true;
      const byId = new Map(scored.scored.map((row) => [row.id, row]));
      for (const p of seeded) {
        const row = byId.get(p.id);
        // Research and the market each get a say; research leads when we have it.
        if (row && Number.isFinite(row.probability)) {
          p.probability = clamp(Math.round(0.25 * p.probability + 0.75 * row.probability), 4, 96);
        }
      }
    }
  }

  const lessoned = (await applyLessonScores(seeded)) as Array<T & { probability: number }>;

  // Quality bar: with research we trust the blended number; without it we only
  // trust selections from leagues we can actually read.
  const bar = researched ? 45 : 58;
  const pool = lessoned.filter(
    (p) => p.probability >= bar && (researched || isTop(p) || p.probability >= 66),
  );
  const candidates = pool.length ? pool : lessoned.filter((p) => isTop(p)).slice(0, Math.max(1, Math.min(want, 8)));

  // The builder's floor matches the bar the pool already passed, so a leg is
  // never accepted by one filter and quietly dropped by the other.
  const slip: Slip = buildSlip(candidates as Leg[], {
    target: opts.target,
    maxLegs: Math.max(1, want),
    minProb: bar,
  });

  const keep = (slip.legs.length ? slip.legs : rankByValue(candidates as Leg[]).slice(0, Math.max(1, want))) as T[];
  return {
    keep,
    dropped: Math.max(0, oneEach.length - keep.length),
    researched,
    trueChance: Math.round(slip.trueChance * 100),
    ev: slip.ev,
    notes: slip.notes,
  };
}

/** How concentrated a slip is, for the "this is one bet, not ten" warning. */
export function concentrationNote(picks: TicketPick[]): string | null {
  if (picks.length < 4) return null;
  const leagues = new Map<string, number>();
  for (const p of picks) {
    const key = (p.league ?? "").toLowerCase();
    if (!key) continue;
    leagues.set(key, (leagues.get(key) ?? 0) + 1);
  }
  const top = [...leagues.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 4 && top[1] / picks.length > 0.5) {
    return `${top[1]} of ${picks.length} legs na ${top[0]} — dem dey move together o.`;
  }
  return null;
}
