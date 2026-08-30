import { analyzePicks } from "./analyze";
import { marketFamily } from "./sportybet";
import { applyLessonScores } from "./study";
import { youKeys } from "./you";
import { seekaiKeys } from "./keys";
import type { TicketPick } from "./types";

const WEAK_FB =
  /friendly|women|womens|u-?1[789]|u-?2[013]|reserve|\bii\b|amateur|virtual|esport|simulat|youth|qualification play-off/i;
const WEAK_BB = /friendly|club friendly|virtual|esport|simulat|u-?1[89]/i;
const WEAK =
  /friendly|u-?1[789]|u-?2[013]|reserve|\bii\b|amateur|virtual|esport|simulat|youth|qualification play-off/i;
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
  if (WEAK.test(blob) && !TOP_FB.test(league) && !TOP_BB.test(league) && !TOP_TN.test(league)) s -= 28;
  if (pick.sport === "football" && TOP_FB.test(league)) s += 8;
  else if (pick.sport === "basketball" && TOP_BB.test(league)) s += 8;
  else if (pick.sport === "tennis" && TOP_TN.test(league)) s += 6;
  else s -= 4;

  if (odds >= 1.4 && odds <= 2.15) s += 12;
  else if (odds < 1.32) s -= 12;
  else if (odds > 2.25) s -= 8;

  const fam = marketFamily(pick.sporty?.marketId, pick.market);
  const sel = (pick.selection ?? "").toLowerCase();
  if (pick.sport === "football" && fam === "win" && !/\bdraw\b/.test(sel) && odds > 2.05) s -= 6;
  if (pick.sport === "basketball") {
    if (odds > 1.85) s -= 14;
    const total = Number((pick.sporty?.specifier ?? pick.market).match(/([\d.]+)/)?.[1] ?? NaN);
    if ((fam === "ou" || pick.sporty?.marketId === "225") && Number.isFinite(total) && total >= 220) s -= 8;
  }
  if (pick.kickoff && pick.kickoff < Date.now() + 8 * 60_000) s -= 22;
  return clamp(Math.round(s), 4, 96);
}

function isJunk(pick: TicketPick) {
  const blob = `${pick.league ?? ""} ${pick.home} ${pick.away}`;
  if (pick.sport === "football") return WEAK_FB.test(blob);
  if (pick.sport === "basketball") return WEAK_BB.test(blob) && !TOP_BB.test(pick.league ?? "");
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

function familyOf(p: TicketPick) {
  return marketFamily(p.sporty?.marketId, p.market);
}

function bias(sel: string) {
  const s = sel.toLowerCase();
  if (s.includes("under")) return "under";
  if (s.includes("over")) return "over";
  if (s.includes("home") && s.includes("away")) return "12";
  if (s.includes("home") && s.includes("draw")) return "1x";
  if (s.includes("draw") && s.includes("away")) return "x2";
  if (s.includes("home")) return "home";
  if (s.includes("away")) return "away";
  if (s.includes("draw")) return "draw";
  if (s === "yes" || /\bgg\b/.test(s)) return "yes";
  if (s === "no" || /\bng\b/.test(s)) return "no";
  return "other";
}

function findOdds(arr: TicketPick[], pred: (p: TicketPick) => boolean) {
  return arr.find(pred)?.odds;
}

function footballMarketScore(pick: TicketPick, all: TicketPick[], used: Record<string, number>) {
  let s = deskScore(pick);
  const fam = familyOf(pick);
  const side = bias(pick.selection);
  const home = findOdds(all, (p) => p.sporty?.marketId === "1" && bias(p.selection) === "home");
  const away = findOdds(all, (p) => p.sporty?.marketId === "1" && bias(p.selection) === "away");
  const over15 = findOdds(all, (p) => /1\.5/.test(p.market) && bias(p.selection) === "over");
  const over25 = findOdds(all, (p) => /2\.5/.test(p.market) && bias(p.selection) === "over");
  const over35 = findOdds(all, (p) => /3\.5/.test(p.market) && bias(p.selection) === "over");
  const ggYes = findOdds(all, (p) => familyOf(p) === "gg" && bias(p.selection) === "yes");
  const fav = home && away ? (home <= away ? "home" : "away") : home ? "home" : away ? "away" : null;
  const favOdds = fav === "home" ? home : fav === "away" ? away : undefined;
  const open = Boolean(home && away && home >= 1.72 && away >= 1.72);
  const onFav =
    Boolean(fav) &&
    (side === fav ||
      (side === "1x" && fav === "home") ||
      (side === "x2" && fav === "away"));

  if (over25 && over25 >= 1.48 && over25 <= 1.92 && fam === "ou" && side === "over" && /2\.5/.test(pick.market)) s += 18;
  if (over15 && over15 >= 1.36 && over15 <= 1.62 && fam === "ou" && side === "over" && /1\.5/.test(pick.market)) s += 12;
  if (over35 && over35 >= 1.55 && over35 <= 2.05 && fam === "ou" && side === "over" && /3\.5/.test(pick.market)) s += 8;
  if (over25 && over25 >= 2.08 && fam === "ou" && side === "over") s -= 12;
  if (over25 && over25 >= 2.05 && fam === "ou" && side === "under" && /2\.5/.test(pick.market)) s += 14;
  if (over15 && over15 >= 1.85 && fam === "ou" && side === "under" && /1\.5/.test(pick.market)) s += 8;

  if (favOdds && favOdds <= 1.48 && onFav && (fam === "dnb" || fam === "dc")) s += 16;
  if (favOdds && favOdds <= 1.42 && onFav && fam === "win" && (pick.odds ?? 9) >= 1.32 && (pick.odds ?? 9) <= 1.7) s += 11;
  if (fav && side !== fav && side !== "1x" && side !== "x2" && side !== "12" && fam === "win") s -= 16;
  if (open && fam === "dc" && side === "12") s += 15;
  if (open && over25 && over25 <= 1.78 && fam === "gg" && side === "yes") s += 11;
  if (fam === "hcp" && onFav && (pick.odds ?? 9) >= 1.48 && (pick.odds ?? 9) <= 2.05) s += 13;
  if (fam === "hcp" && !onFav && favOdds && favOdds <= 1.55) s -= 10;
  if (ggYes && ggYes >= 1.48 && ggYes <= 1.9 && fam === "gg" && side === "yes" && over25 && over25 <= 1.85) s += 9;

  s -= (used[fam] ?? 0) * 8;
  return s;
}

function footballShapePick<T extends TicketPick>(picks: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of picks) {
    const key = eventKey(p);
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const used: Record<string, number> = {};
  const best: T[] = [];
  for (const arr of groups.values()) {
    const ranked = arr
      .map((p) => ({ p, s: footballMarketScore(p, arr, used) }))
      .sort((a, b) => b.s - a.s);
    const hit = ranked[0];
    if (!hit || hit.s < 38) continue;
    best.push(hit.p);
    const fam = familyOf(hit.p);
    used[fam] = (used[fam] ?? 0) + 1;
  }
  return best;
}

function bestPerEvent<T extends TicketPick>(picks: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of picks) {
    const key = eventKey(p);
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const used: Record<string, number> = {};
  const best: T[] = [];
  for (const arr of groups.values()) {
    const families = [...new Set(arr.map(familyOf))];
    families.sort((a, b) => (used[a] ?? 0) - (used[b] ?? 0));
    const fam = families[0];
    const pool = fam ? arr.filter((p) => familyOf(p) === fam) : arr;
    const hit = pool.slice().sort((a, b) => deskScore(b) - deskScore(a))[0];
    if (!hit) continue;
    best.push(hit);
    used[familyOf(hit)] = (used[familyOf(hit)] ?? 0) + 1;
  }
  return best;
}

function mixFamilies<T extends TicketPick>(ranked: T[], want: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const p of ranked) {
    const f = familyOf(p);
    const arr = buckets.get(f) ?? [];
    arr.push(p);
    buckets.set(f, arr);
  }
  const keys = [...buckets.keys()];
  const idx: Record<string, number> = {};
  const keep: T[] = [];
  while (keep.length < want) {
    let added = false;
    for (const k of keys) {
      const i = idx[k] ?? 0;
      const arr = buckets.get(k) ?? [];
      if (i >= arr.length) continue;
      keep.push(arr[i]);
      idx[k] = i + 1;
      added = true;
      if (keep.length >= want) break;
    }
    if (!added) break;
  }
  return keep;
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
  const clean = picks.filter((p) => !isJunk(p));
  const football = footballShapePick(clean.filter((p) => p.sport === "football"));
  const other = bestPerEvent(clean.filter((p) => p.sport !== "football"));
  const unique = [...football, ...other];
  const seeded = unique.map((p) => ({
    ...p,
    probability: deskScore(p) + (isTop(p) ? 6 : 0),
  }));
  const lessoned = await applyLessonScores(seeded);
  lessoned.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0) || Number(isTop(b)) - Number(isTop(a)));

  const shortlist = lessoned.slice(0, Math.min(lessoned.length, Math.max(want + 10, want * 2)));
  let researched = false;

  if ((seekaiKeys().length || youKeys().length) && shortlist.length) {
    const sample = shortlist.slice(0, Math.min(12, shortlist.length));
    const ai = await withTimeout(analyzePicks(sample, 45), 36_000);
    if (ai?.picks?.length) {
      researched = true;
      const byId = new Map(ai.picks.map((row) => [row.id, row]));
      for (const p of shortlist) {
        const live = byId.get(p.id);
        if (typeof live?.probability !== "number") continue;
        const conf = live.confidence === "high" ? 4 : live.confidence === "low" ? -6 : 0;
        p.probability = clamp(Math.round(0.25 * (p.probability ?? 50) + 0.75 * live.probability + conf), 4, 96);
      }
      shortlist.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
    }
  }

  const bar = researched ? 45 : isTop(shortlist[0] ?? ({} as T)) ? 58 : 62;
  const strong = shortlist.filter((p) => (p.probability ?? 0) >= bar && (researched || isTop(p) || (p.probability ?? 0) >= 66));
  const keep = strong.slice(0, Math.max(1, want)) as T[];
  if (!keep.length && shortlist.length) {
    const fallback = shortlist.filter((p) => isTop(p)).slice(0, Math.max(1, Math.min(want, 8))) as T[];
    return { keep: fallback.length ? fallback : (shortlist.slice(0, 1) as T[]), dropped: unique.length - 1, researched };
  }
  return { keep, dropped: unique.length - keep.length, researched };
}
