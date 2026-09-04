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
  /premier league|la liga|laliga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|eredivisie|primeira|championship|mls|copa libertadores|nations league|saudi|super lig|liga portugal|pro league|belgian|jupiler|swiss|austrian|scottish|turkish/i;
const TOP_BB = /euroleague|ncaa|wnba|acb|nbl|eurocup|bbl/i;
const TOP_TN = /atp|wta|us open|australian open|wimbledon|roland|french open|masters|grand slam|challenger/i;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Desk-only fallback when no engine answers. Anchored on de-vigged price. */
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

  let p = market ?? 0.5;
  if (weak) p -= 0.18;
  if (!top) p -= 0.08; // punish obscure leagues hard when we have no research
  if (top) p += 0.03;
  if (pick.kickoff && pick.kickoff < Date.now() + 8 * 60_000) p -= 0.18;
  if (pick.odds && pick.odds > 3.5) p -= 0.04;
  // Prefer safer market families when desk-only
  if (fam === "dc" || fam === "dnb") p += 0.02;
  if (fam === "ou" || fam === "ou1h") p += 0.01;
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
  keep: T[];
  dropped: number;
  researched: boolean;
  trueChance: number;
  ev: number | null;
  notes: string[];
};

export async function researchPicks<T extends TicketPick>(
  picks: T[],
  want: number,
  opts: { target?: number } = {},
): Promise<ResearchResult<T>> {
  // Keys from env work even if the database is down.
  try {
    await refreshKeys();
  } catch {
    /* env keys still available */
  }

  const clean = picks.filter((p) => !isJunk(p) && p.sport !== "other");
  const oneEach = bestPerEvent(clean);

  const seeded = oneEach.map((p) => ({
    ...p,
    probability: deskScore(p),
  })) as Array<T & { probability: number }>;

  const canResearch = Boolean(geminiKeys().length || seekaiKeys().length || youKeys().length);
  let researched = false;
  if (canResearch && seeded.length) {
    const shortlist = seeded
      .slice()
      .sort((a, b) => {
        const topA = isTop(a) ? 1 : 0;
        const topB = isTop(b) ? 1 : 0;
        return topB - topA || (b.probability ?? 0) - (a.probability ?? 0);
      })
      .slice(0, Math.min(seeded.length, Math.max(want + 4, 10)));
    const scored = await withTimeout(researchScores(shortlist), 32_000);
    if (scored?.researched) {
      researched = true;
      const byId = new Map(scored.scored.map((row) => [row.id, row]));
      for (const p of seeded) {
        const row = byId.get(p.id);
        if (row && Number.isFinite(row.probability)) {
          p.probability = clamp(Math.round(0.15 * p.probability + 0.85 * row.probability), 4, 96);
        }
      }
    }
  }

  let lessoned: Array<T & { probability: number }>;
  try {
    lessoned = (await applyLessonScores(seeded)) as Array<T & { probability: number }>;
  } catch {
    lessoned = seeded;
  }

  // With live research: mid-40s is fine. Without it: ONLY top leagues, high bar.
  const bar = researched ? 42 : 58;
  let pool = lessoned.filter((p) => {
    if (p.probability < bar) return false;
    if (!researched && !isTop(p)) return false;
    return true;
  });

  // If still empty and researched, relax slightly. If not researched, stay strict on top leagues.
  if (!pool.length) {
    pool = researched
      ? lessoned.filter((p) => p.probability >= 40).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0)).slice(0, want + 4)
      : lessoned
          .filter((p) => isTop(p))
          .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
          .slice(0, Math.max(want, 4));
  }

  const slip: Slip = buildSlip(pool as Leg[], {
    target: opts.target,
    maxLegs: Math.max(1, want),
    minProb: researched ? 40 : 55,
    maxPerLeague: 4,
    maxPerSlot: 5,
  });

  const keep = (slip.legs.length
    ? slip.legs
    : rankByValue(pool as Leg[]).slice(0, Math.max(1, want))) as T[];

  const notes = [...slip.notes];
  if (!researched) {
    notes.unshift("desk read only — Gemini no answer this round, so only big leagues.");
  }

  return {
    keep,
    dropped: Math.max(0, oneEach.length - keep.length),
    researched,
    trueChance: Math.round(slip.trueChance * 100),
    ev: slip.ev,
    notes,
  };
}

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
