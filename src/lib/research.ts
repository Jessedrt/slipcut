import { analyzePicks } from "./analyze";
import { marketFamily } from "./sportybet";
import { applyLessonScores } from "./study";
import { youKeys } from "./you";
import type { TicketPick } from "./types";

const WEAK =
  /friendly|women|womens|u-?1[789]|u-?2[013]|reserve|\bii\b|amateur|virtual|esport|simulat|youth|qualification play-off/i;
const TOP_FB =
  /premier league|la liga|laliga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|eredivisie|primeira|championship|mls|copa libertadores|nations league|saudi|super lig|liga portugal|pro league/i;
const TOP_BB = /nba|euroleague|ncaa|wnba|acb|nbl/i;
const TOP_TN = /atp|wta|us open|australian open|wimbledon|roland|french open|masters|grand slam|challenger/i;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function deskScore(pick: TicketPick): number {
  let s = 52;
  const league = pick.league ?? "";
  const blob = `${league} ${pick.home} ${pick.away}`;
  if (WEAK.test(blob)) s -= 28;
  if (pick.sport === "football" && TOP_FB.test(league)) s += 14;
  else if (pick.sport === "basketball" && TOP_BB.test(league)) s += 14;
  else if (pick.sport === "tennis" && TOP_TN.test(league)) s += 10;
  else s -= 6;

  const fam = marketFamily(pick.sporty?.marketId, pick.market);
  const sel = `${pick.selection} ${pick.market}`.toLowerCase();
  if (pick.sport === "football") {
    if (/\bunder\b/.test(sel)) s -= 40;
    if (fam === "ou" && /1\.5/.test(sel)) s += 8;
    if (fam === "ou" && /2\.5/.test(sel)) s += 3;
    if (fam === "dc" || fam === "dnb") s += 7;
    if (fam === "hcp") s += 6;
    if (fam === "gg") s += 2;
    if (fam === "win" && !/\bdraw\b/.test(sel) && (pick.odds ?? 9) > 1.9) s -= 12;
    if (/\bdraw\b/.test(sel) && TOP_FB.test(league)) s += 4;
  }
  if (pick.sport === "basketball") {
    if (fam === "hcp" || fam === "ou" || fam === "ou1h") s += 5;
    if (fam === "win" && (pick.odds ?? 9) > 1.85) s -= 8;
  }
  if (pick.sport === "tennis" && fam === "win" && (pick.odds ?? 9) > 1.8) s -= 10;

  if (pick.odds && pick.odds > 1 && pick.odds <= 1.4) s += 7;
  else if (pick.odds && pick.odds <= 1.65) s += 4;
  else if (pick.odds && pick.odds >= 2.4 && !/\bdraw\b/.test(sel)) s -= 8;

  if (pick.kickoff && pick.kickoff < Date.now() + 8 * 60_000) s -= 22;
  return clamp(Math.round(s), 4, 96);
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

export async function researchPicks<T extends TicketPick>(
  picks: T[],
  want: number,
): Promise<{ keep: T[]; dropped: number; researched: boolean }> {
  const unique: T[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const key = p.sporty?.eventId || `${p.home}|${p.away}|${p.kickoff ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  const seeded = unique.map((p) => ({ ...p, probability: deskScore(p) }));
  const lessoned = await applyLessonScores(seeded);
  lessoned.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));

  const shortlist = lessoned.slice(0, Math.min(lessoned.length, Math.max(want + 8, want * 2)));
  let researched = false;

  if (youKeys().length && shortlist.length) {
    const ai = await withTimeout(analyzePicks(shortlist.slice(0, 8), 45), 9_000);
    if (ai?.picks?.length) {
      researched = true;
      const byId = new Map(ai.picks.map((row) => [row.id, row.probability]));
      for (const p of shortlist) {
        const live = byId.get(p.id);
        if (typeof live !== "number") continue;
        p.probability = clamp(Math.round(0.45 * (p.probability ?? 50) + 0.55 * live), 4, 96);
      }
      shortlist.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
    }
  }

  const bar = researched ? 48 : 44;
  const strong = shortlist.filter((p) => (p.probability ?? 0) >= bar);
  const pool = strong.length >= Math.min(want, 3) ? strong : shortlist;
  const keep = pool.slice(0, Math.max(1, want)) as T[];
  return { keep, dropped: unique.length - keep.length, researched };
}
