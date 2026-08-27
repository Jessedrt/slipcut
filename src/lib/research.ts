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
  const odds = pick.odds ?? 9;
  let s = 50;
  const league = pick.league ?? "";
  const blob = `${league} ${pick.home} ${pick.away}`;
  if (WEAK.test(blob)) s -= 25;
  if (pick.sport === "football" && TOP_FB.test(league)) s += 8;
  else if (pick.sport === "basketball" && TOP_BB.test(league)) s += 8;
  else if (pick.sport === "tennis" && TOP_TN.test(league)) s += 6;
  else s -= 4;

  if (odds >= 1.4 && odds <= 2.15) s += 12;
  else if (odds < 1.32) s -= 20;
  else if (odds > 2.25) s -= 10;

  const fam = marketFamily(pick.sporty?.marketId, pick.market);
  const sel = `${pick.selection} ${pick.market}`.toLowerCase();
  if (pick.sport === "football") {
    if (/\bunder\b/.test(sel)) s -= 40;
    if (fam === "ou" && /\bover\b/.test(sel)) s += 24;
    else if (fam === "dnb" || fam === "hcp" || fam === "dc" || fam === "win") s -= 30;
    if (fam === "win" && !/\bdraw\b/.test(sel) && odds > 1.9) s -= 12;
  }
  if (pick.sport === "basketball") {
    if (/\bunder\b/.test(sel) || /winner/i.test(pick.market) || pick.sporty?.marketId === "219") s -= 40;
    if (pick.sporty?.marketId === "225" && /\bover\b/.test(sel)) s += 26;
    else if (fam === "ou1h" && /\bover\b/.test(sel)) s += 16;
    else if (fam === "teamou" && /\bover\b/.test(sel)) s += 12;
    else if (fam === "hcp") s -= 20;
  }
  if (pick.kickoff && pick.kickoff < Date.now() + 8 * 60_000) s -= 22;
  return clamp(Math.round(s), 4, 96);
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
  const best: T[] = [];
  for (const arr of groups.values()) {
    const hit = arr.slice().sort((a, b) => deskScore(b) - deskScore(a))[0];
    if (hit) best.push(hit);
  }
  return best;
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
  const unique = bestPerEvent(picks);
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
  const keep = pool
    .slice()
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
    .slice(0, Math.max(1, want)) as T[];
  return { keep, dropped: unique.length - keep.length, researched };
}
