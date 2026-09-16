import type { NormalizedMarket, Sport } from "../types/index.js";

/** Map SportyBet market id/desc → category for UX grouping. All markets stay open. */
export function categorizeMarket(marketId: string, desc: string, sport: Sport): string {
  const d = `${marketId} ${desc}`.toLowerCase();
  if (sport === "basketball") {
    if (/moneyline|winner|match result|219|186/.test(d)) return "Moneyline";
    if (/spread|handicap|223|14|187/.test(d)) return "Point Spread";
    if (/total|over\/under|225|18|188|189/.test(d)) return "Game Total";
    if (/1st half|first half|68|66/.test(d)) return "First Half";
    if (/2nd half|second half|62/.test(d)) return "Second Half";
    if (/quarter|q1|q2|q3|q4/.test(d)) return "Quarter";
    if (/team total|227|228/.test(d)) return "Team Total";
    return "Other";
  }
  if (/\b1x2\b|match result|^1$|winner/.test(d) && !/half/.test(d)) return "Match Result";
  if (/double chance|10\b|63/.test(d)) return "Double Chance";
  if (/draw no bet|11\b|dnb/.test(d)) return "Draw No Bet";
  if (/both teams|btts|gg|29/.test(d)) return "BTTS";
  if (/over\/under|total|18|225|68|62/.test(d) && !/corner|card|team/.test(d)) return "Over/Under Goals";
  if (/asian handicap|16\b/.test(d)) return "Asian Handicap";
  if (/european handicap|14\b|223/.test(d)) return "European Handicap";
  if (/1st half|first half|68|63|64|66/.test(d)) return "First Half";
  if (/2nd half|second half|62/.test(d)) return "Second Half";
  if (/corner|166/.test(d)) return "Corners";
  if (/card|booking/.test(d)) return "Cards";
  if (/correct score|winning margin/.test(d)) return "Score Markets";
  if (/team total|227|228|69|70/.test(d)) return "Team Totals";
  if (/odd\/even|8\b/.test(d)) return "Odd/Even";
  if (/clean sheet|next goal|goal time/.test(d)) return "Specials";
  return "Other";
}

export function impliedProbability(odds: number): number {
  if (!odds || odds <= 1) return 0;
  return 1 / odds;
}

export function rankMarkets(markets: NormalizedMarket[]): NormalizedMarket[] {
  return [...markets].sort((a, b) => {
    const score = (m: NormalizedMarket) => {
      const imp = impliedProbability(m.odds);
      let s = imp;
      if (m.odds >= 1.25 && m.odds <= 1.85) s += 0.05;
      if (m.status !== "open") s -= 1;
      return s;
    };
    return score(b) - score(a);
  });
}

export const FOOTBALL_CATEGORY_BUTTONS = [
  "Match Result", "Goals", "BTTS", "Handicap", "First Half", "Corners", "Cards", "Team Markets", "More",
] as const;

export const BASKETBALL_CATEGORY_BUTTONS = [
  "Moneyline", "Point Spread", "Game Total", "Team Total", "First Half", "Quarter", "More",
] as const;
