/**
 * Settlement rules: turn a finished scoreline into won / lost / void.
 *
 * This is deliberately a separate, database-free module. Getting a leg wrong
 * does not just mis-report one slip — the study loop feeds these results back
 * as lessons and calibration, so a bad rule teaches the desk the wrong thing
 * forever. Keeping it pure means the rules are unit tested (settle.test.ts).
 */

export type LegResult = "won" | "lost" | "void" | "pending";

export type StoredPick = {
  home: string;
  away: string;
  market: string;
  selection: string;
  league: string;
  sport: string;
  eventId?: string;
  family: string;
  kickoff?: number;
};

/**
 * Pull the totals line out of a market label.
 *
 * The old version grabbed the first number it saw, so "1st Half O/U 2.5" could
 * settle against 1 and "Asian Handicap -1.5" against -1. Ordinals (1st/2nd/
 * quarter/period) are skipped, half-point lines are preferred, and the sign is
 * kept for handicaps.
 */
export function lineFromMarket(market: string, selection: string): number | null {
  const ORDINAL = /\d+(?:\.\d+)?\s*(?:st|nd|rd|th)\b|\b(?:half|quarter|period|set|ht)\b/i;
  const candidates: Array<{ raw: string; score: number }> = [];
  for (const source of [selection, market]) {
    const cleaned = source.replace(ORDINAL, " ");
    for (const m of cleaned.matchAll(/-?\d+(?:\.\d+)?/g)) {
      const raw = m[0];
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      // Totals are almost always on a half point (2.5) or a round basket line (210).
      const score = /\.5$/.test(raw) ? 3 : Math.abs(n) >= 20 ? 2 : 1;
      candidates.push({ raw, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return Number(candidates[0]!.raw);
}

/** Families the desk can actually settle from a scoreline. */
const SETTLEABLE = new Set(["win", "dc", "dnb", "gg", "ou", "ou1h"]);

/**
 * Which side of a 1X2 market a selection is on.
 *
 * SportyBet labels these "1", "X" and "2" — not "Home", "Draw", "Away". The
 * old code only matched the words, so every 1X2 and DNB leg was reported as
 * "could not map market" and quietly dropped out of the study loop.
 */
function side1x2(sel: string): "1" | "x" | "2" | null {
  const s = sel.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s === "1" || s.includes("home")) return "1";
  if (s === "2" || s.includes("away")) return "2";
  if (s === "x" || s === "draw") return "x";
  return null;
}

/** Double chance side: 1X, X2 or 12, however the book labels it. */
function dcSide(sel: string): "1x" | "x2" | "12" | null {
  const s = sel.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s === "1x" || s === "x1" || (s.includes("home") && s.includes("draw"))) return "1x";
  if (s === "x2" || s === "2x" || (s.includes("draw") && s.includes("away"))) return "x2";
  if (s === "12" || s === "21" || (s.includes("home") && s.includes("away"))) return "12";
  return null;
}

export function settleFootball(pick: StoredPick, home: number, away: number, finished: boolean): { result: LegResult; note: string } {
  const total = home + away;
  const sel = pick.selection.toLowerCase();
  const fam = pick.family;
  const line = lineFromMarket(pick.market, pick.selection);

  if (fam === "ou" && line != null) {
    const over = !sel.includes("under");
    if (over) {
      if (total > line) return { result: "won", note: `${home}-${away} over ${line}` };
      if (finished) return { result: "lost", note: `${home}-${away} died under ${line}` };
      return { result: "pending", note: `${home}-${away} still under ${line}` };
    }
    if (total > line) return { result: "lost", note: `${home}-${away} busted under ${line}` };
    if (finished) return { result: "won", note: `${home}-${away} held under ${line}` };
    return { result: "pending", note: `${home}-${away} still under ${line}` };
  }

  if (fam === "gg") {
    const yes = !/^no\b/.test(sel) && !sel.includes("ng");
    const both = home > 0 && away > 0;
    if (yes) {
      if (both) return { result: "won", note: `${home}-${away} both scored` };
      if (finished) return { result: "lost", note: `${home}-${away} no GG` };
      return { result: "pending", note: `${home}-${away} waiting on GG` };
    }
    if (both) return { result: "lost", note: `${home}-${away} both scored` };
    if (finished) return { result: "won", note: `${home}-${away} NG` };
    return { result: "pending", note: `${home}-${away} NG so far` };
  }

  if (!finished) return { result: "pending", note: `${home}-${away} still in play` };

  const homeWin = home > away;
  const awayWin = away > home;
  const draw = home === away;

  if (fam === "dc") {
    const side = dcSide(sel);
    if (!side) return { result: "pending", note: `${home}-${away} — I no fit read that double chance` };
    if (side === "1x") {
      return homeWin || draw
        ? { result: "won", note: `${home}-${away} 1X` }
        : { result: "lost", note: `${home}-${away} away win` };
    }
    if (side === "x2") {
      return awayWin || draw
        ? { result: "won", note: `${home}-${away} X2` }
        : { result: "lost", note: `${home}-${away} home win` };
    }
    return homeWin || awayWin
      ? { result: "won", note: `${home}-${away} 12` }
      : { result: "lost", note: `${home}-${away} draw killed 12` };
  }

  if (fam === "dnb") {
    if (draw) return { result: "void", note: `${home}-${away} DNB void` };
    const side = side1x2(sel);
    if (!side || side === "x") {
      return { result: "pending", note: `${home}-${away} — I no fit read that DNB` };
    }
    if (side === "2") {
      return awayWin ? { result: "won", note: `${home}-${away} away DNB` } : { result: "lost", note: `${home}-${away} home won` };
    }
    return homeWin ? { result: "won", note: `${home}-${away} home DNB` } : { result: "lost", note: `${home}-${away} away won` };
  }

  if (fam === "win") {
    const side = side1x2(sel);
    if (!side) return { result: "pending", note: `${home}-${away} — I no fit read that winner` };
    if (side === "x") {
      return draw ? { result: "won", note: `${home}-${away} draw` } : { result: "lost", note: `${home}-${away} no draw` };
    }
    if (side === "2") {
      return awayWin ? { result: "won", note: `${home}-${away} away` } : { result: "lost", note: `${home}-${away} away lost` };
    }
    return homeWin ? { result: "won", note: `${home}-${away} home` } : { result: "lost", note: `${home}-${away} home lost` };
  }

  if ((fam === "ou" || fam === "ou1h" || fam === "teamou") && line == null) {
    return { result: "pending", note: `${home}-${away} — no totals line on that market` };
  }
  if (!SETTLEABLE.has(fam)) {
    // Correct score, handicap, player markets… the scoreline alone cannot settle
    // them. Guess wrong and the study loop poisons its own lessons.
    return { result: "pending", note: `${home}-${away} — I no fit settle ${fam} from the score alone` };
  }
  const side = side1x2(sel) ?? dcSide(sel);
  if (side === "x" || side === "1x" || side === "x2") {
    return draw || (side === "1x" ? homeWin : awayWin)
      ? { result: "won", note: `${home}-${away} ${side.toUpperCase()}` }
      : { result: "lost", note: `${home}-${away} ${side.toUpperCase()} lost` };
  }
  if (side === "2") {
    return awayWin ? { result: "won", note: `${home}-${away} away` } : { result: "lost", note: `${home}-${away} away lost` };
  }
  if (side === "1" || side === "12") {
    return homeWin || (side === "12" && awayWin)
      ? { result: "won", note: `${home}-${away} ${side === "12" ? "12" : "home"}` }
      : { result: "lost", note: `${home}-${away} ${side === "12" ? "12" : "home"} lost` };
  }
  return { result: "pending", note: `${home}-${away} could not map market` };
}

export function settleBasket(pick: StoredPick, home: number, away: number, finished: boolean): { result: LegResult; note: string } {
  const total = home + away;
  const sel = pick.selection.toLowerCase();
  const fam = pick.family;
  const line = lineFromMarket(pick.market, pick.selection);
  if (fam === "ou" && line != null) {
    const over = !sel.includes("under");
    if (over) {
      // Basketball scores only go up, so a cleared line is already money.
      if (total > line) return { result: "won", note: `${home}-${away} over ${line}` };
      return finished
        ? { result: "lost", note: `${home}-${away} finished under ${line}` }
        : { result: "pending", note: `${home}-${away} live total ${total} vs ${line}` };
    }
    // An under can only be confirmed at the whistle, but it can die early.
    if (total > line) return { result: "lost", note: `${home}-${away} busted under ${line}` };
    return finished
      ? { result: "won", note: `${home}-${away} held under ${line}` }
      : { result: "pending", note: `${home}-${away} live total ${total} vs ${line}` };
  }
  if (!finished) return { result: "pending", note: `${home}-${away} live` };
  if (sel.includes("away")) {
    return away > home ? { result: "won", note: `${home}-${away} away` } : { result: "lost", note: `${home}-${away} away lost` };
  }
  return home > away ? { result: "won", note: `${home}-${away} home` } : { result: "lost", note: `${home}-${away} home lost` };
}

export function settleTennis(
  pick: StoredPick,
  home: number,
  away: number,
  finished: boolean,
  setScore?: string,
): { result: LegResult; note: string } {
  const parts = [...String(setScore ?? "").matchAll(/(\d+)\s*[-:]\s*(\d+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  let setsH = home;
  let setsA = away;
  let gamesH = 0;
  let gamesA = 0;
  if (parts.length >= 2) {
    setsH = 0;
    setsA = 0;
    for (const [h, a] of parts) {
      gamesH += h;
      gamesA += a;
      if (h > a) setsH += 1;
      else if (a > h) setsA += 1;
    }
  }
  const fam = pick.family;
  const sel = pick.selection.toLowerCase();
  const line = lineFromMarket(pick.market, pick.selection);
  if (fam === "ou" && line != null && gamesH + gamesA > 0) {
    const total = gamesH + gamesA;
    const over = !sel.includes("under");
    if (over) {
      if (total > line) return { result: "won", note: `${total} games over ${line}` };
      if (finished) return { result: "lost", note: `${total} games under ${line}` };
      return { result: "pending", note: `${total} games so far` };
    }
    if (total > line) return { result: "lost", note: `${total} games busted under ${line}` };
    if (finished) return { result: "won", note: `${total} games under ${line}` };
    return { result: "pending", note: `${total} games so far` };
  }
  if (!finished) return { result: "pending", note: `${setsH}-${setsA} still on court` };
  if (sel.includes("away")) {
    return setsA > setsH
      ? { result: "won", note: `${setsH}-${setsA} away` }
      : { result: "lost", note: `${setsH}-${setsA} away lost` };
  }
  return setsH > setsA
    ? { result: "won", note: `${setsH}-${setsA} home` }
    : { result: "lost", note: `${setsH}-${setsA} home lost` };
}
